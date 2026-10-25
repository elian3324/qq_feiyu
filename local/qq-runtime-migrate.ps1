param([ValidateSet('bundled','qq-9.9.35-52892')][string]$Profile='qq-9.9.35-52892')
if($env:COMPANION_ENABLE_NATIVE_TOOLS -ne '1'){Write-Host '高级原生迁移工具仅供具备相应授权的本机部署。请先阅读 docs/ADVANCED_INTEGRATION.md，并显式设置 COMPANION_ENABLE_NATIVE_TOOLS=1。';exit 1}
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskGatewayDir=Join-Path $taskRoot 'gateway\napcat'
$taskControlNode=(Get-Command node -ErrorAction Stop).Source
$taskProfileFile=Join-Path $taskGatewayDir 'runtime-profile.json'
$taskRuntime=& $taskControlNode (Join-Path $PSScriptRoot 'gateway-runtime.cjs') $taskGatewayDir | ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'Cannot validate current runtime'}
$taskGatewayId=(Get-Content -LiteralPath (Join-Path $taskRoot 'logs\gateway.pid') -Raw).Trim()
if($taskGatewayId -notmatch '^\d+$'){throw 'Invalid gateway process record'}
$taskParent=Get-CimInstance Win32_Process -Filter "ProcessId=$taskGatewayId"
$taskMatched=$false
foreach($taskEntry in $taskRuntime.processEntries){if($taskParent -and $taskParent.ExecutablePath -eq $taskEntry.node -and $taskParent.CommandLine.Contains($taskEntry.entry)){$taskMatched=$true}}
if(-not $taskMatched){throw 'Gateway process path does not match this project'}
$taskChildren=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$taskGatewayId" | Where-Object {$_.Name -eq 'node.exe' -and $_.ExecutablePath -eq $taskParent.ExecutablePath})
$taskCfg=Get-Content -LiteralPath (Join-Path $taskRoot 'ai-companion-kit\packages\companion\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskConfigFiles=@((Join-Path $taskRoot 'ai-companion-kit\packages\companion\config.json'))+@(Get-ChildItem -LiteralPath (Join-Path $taskGatewayDir 'napcat\config') -File | Select-Object -ExpandProperty FullName)
$taskHashes=@{};foreach($taskFile in $taskConfigFiles){$taskHashes[$taskFile]=(Get-FileHash -LiteralPath $taskFile).Hash}
function Get-TaskGuid {
 try{
  $taskSession=Invoke-RestMethod 'http://127.0.0.1:6099/api/local-session' -Method Post -Headers @{'X-NapCat-Local-Login'='1'} -ContentType 'application/json' -Body '{}' -TimeoutSec 4
  if($taskSession.code -ne 0){return $null}
  $taskResponse=Invoke-RestMethod 'http://127.0.0.1:6099/api/QQLogin/GetDeviceGUID' -Method Post -Headers @{Authorization=('Bearer '+$taskSession.data.Credential)} -ContentType 'application/json' -Body '{}' -TimeoutSec 4
  if($taskResponse.code -eq 0){return $taskResponse.data.guid}
 }catch{}
 return $null
}
$taskBeforeGuid=Get-TaskGuid
$taskStamp=Get-Date -Format 'yyyyMMdd-HHmmss'
foreach($taskName in @('gateway.stdout.log','gateway.stderr.log')){
 $taskLog=Join-Path $taskRoot ('logs\'+$taskName)
 if(Test-Path -LiteralPath $taskLog){Copy-Item -LiteralPath $taskLog -Destination (Join-Path $taskRoot ('logs\before-qq-runtime-'+$taskStamp+'-'+$taskName))}
}
$taskMutex=New-Object Threading.Mutex($false,'Local\AICompanionGatewayDeepseekQQFeiyu')
$taskLocked=$taskMutex.WaitOne(0)
if(-not $taskLocked){throw 'Another gateway startup is active'}
try{
 [IO.File]::WriteAllText($taskProfileFile,(@{profile=$Profile}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 $taskNext=& $taskControlNode (Join-Path $PSScriptRoot 'gateway-runtime.cjs') $taskGatewayDir | ConvertFrom-Json
 if($LASTEXITCODE -ne 0){throw 'Selected native bundle is incomplete'}
 & $taskNext.node (Join-Path $PSScriptRoot 'qq-native-load.cjs') (Join-Path $taskNext.nativeDir 'wrapper.node')
 if($LASTEXITCODE -ne 0){throw 'Selected native bundle cannot load'}
 # No files in the old native bundle or account cache are removed or overwritten.
 # Stop only the verified project gateway and its verified native worker.
 Stop-Process -Id $taskParent.ProcessId -Force
 foreach($taskChild in $taskChildren){
  $taskCurrent=Get-CimInstance Win32_Process -Filter "ProcessId=$($taskChild.ProcessId)" -ErrorAction SilentlyContinue
  if($taskCurrent -and $taskCurrent.ExecutablePath -eq $taskChild.ExecutablePath -and $taskCurrent.CreationDate -eq $taskChild.CreationDate){Stop-Process -Id $taskCurrent.ProcessId -Force}
 }
}catch{
 [IO.File]::WriteAllText($taskProfileFile,(@{profile=$taskRuntime.profile}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 throw
}finally{if($taskLocked){$taskMutex.ReleaseMutex()};$taskMutex.Dispose()}
& (Join-Path $PSScriptRoot 'gateway.ps1') -EnsureRunningOnly
$taskRestored=$false;$taskNeedsLogin=$false
for($taskAttempt=0;$taskAttempt -lt 45;$taskAttempt++){
 Start-Sleep -Seconds 2
 try{
  $taskHeaders=@{Authorization=('Bearer '+$taskCfg.onebot.accessToken)}
  $taskStatus=Invoke-RestMethod ($taskCfg.onebot.httpUrl+'/get_status') -Method Post -Headers $taskHeaders -ContentType 'application/json' -Body '{}' -TimeoutSec 2
  $taskLogin=Invoke-RestMethod ($taskCfg.onebot.httpUrl+'/get_login_info') -Method Post -Headers $taskHeaders -ContentType 'application/json' -Body '{}' -TimeoutSec 2
  if($taskStatus.status -eq 'ok' -and $taskStatus.data.online -eq $true -and [string]$taskLogin.data.user_id -eq [string]$taskCfg.botQQ){$taskRestored=$true;break}
 }catch{}
}
$taskPreserved=$true;foreach($taskFile in $taskConfigFiles){if($taskHashes[$taskFile] -ne (Get-FileHash -LiteralPath $taskFile).Hash){$taskPreserved=$false}}
$taskAfterGuid=Get-TaskGuid
$taskGuidPreserved=if($taskBeforeGuid -and $taskAfterGuid){$taskBeforeGuid -eq $taskAfterGuid}else{$null}
$taskNewId=(Get-Content -LiteralPath (Join-Path $taskRoot 'logs\gateway.pid') -Raw).Trim()
$taskNewProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$taskNewId"
$taskReceipt=[ordered]@{at=[DateTime]::UtcNow.ToString('o');oldVersion=$taskRuntime.version;newVersion=$taskNext.version;profile=$Profile;nativeLoadPassed=$true;selectedRuntimeRunning=($taskNewProcess.ExecutablePath -eq $taskNext.node);qqOnline=$taskRestored;configurationPreserved=$taskPreserved;deviceGuidPreserved=$taskGuidPreserved;originalNativeFilesPreserved=$true;accountCacheCleared=$false;verifiedLongTerm=$false}
[IO.File]::WriteAllText((Join-Path $taskRoot 'logs\qq-native-upgrade.json'),($taskReceipt|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$taskReceipt|ConvertTo-Json
