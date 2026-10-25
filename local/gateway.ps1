param([switch]$OpenBrowser,[switch]$EnsureRunningOnly,[switch]$StartConfiguredGateway)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskProfile=Join-Path $PSScriptRoot 'gateway-launcher.local.json'
if(-not(Test-Path -LiteralPath $taskProfile)){
    Write-Host '请自行启动获得授权的 NapCat，或参考 local/gateway-launcher.example.json 创建本地启动配置。'
    Write-Host '不下载网关，不复制登录状态；配置说明见 docs/GATEWAY.md。'
    exit 0
}
$taskLaunch=Get-Content -LiteralPath $taskProfile -Raw -Encoding UTF8|ConvertFrom-Json
if($taskLaunch.provider -ne 'napcat' -or $taskLaunch.allowLaunch -ne $true){throw 'Only an explicitly authorized NapCat launcher may be started.'}
if($EnsureRunningOnly -and $taskLaunch.autoRecover -ne $true){exit 0}
if(-not $StartConfiguredGateway -and -not $EnsureRunningOnly){exit 0}
if(-not $taskLaunch.command -or -not(Test-Path -LiteralPath $taskLaunch.command -PathType Leaf)){throw 'Configure your own installed NapCat launcher.'}
$taskMarker=Join-Path $taskRoot 'logs/gateway-launcher.json'
if(Test-Path -LiteralPath $taskMarker){
    $taskHeld=Get-Content -LiteralPath $taskMarker -Raw -Encoding UTF8|ConvertFrom-Json
    $taskProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$taskHeld.pid)
    if($taskProcess -and [string]$taskProcess.ExecutablePath -eq [string]$taskHeld.command){Write-Host '本副本登记的网关启动器仍在运行。';exit 0}
}
$taskWorking=if($taskLaunch.workingDirectory){$taskLaunch.workingDirectory}else{Split-Path $taskLaunch.command -Parent}
if(-not(Test-Path -LiteralPath $taskWorking -PathType Container)){throw 'Gateway working directory not found.'}
[IO.Directory]::CreateDirectory((Join-Path $taskRoot 'logs'))|Out-Null
$taskParameters=@{FilePath=$taskLaunch.command;WorkingDirectory=$taskWorking;WindowStyle='Hidden';PassThru=$true}
if(@($taskLaunch.arguments).Count){$taskParameters.ArgumentList=@($taskLaunch.arguments)}
$taskStarted=Start-Process @taskParameters
[IO.File]::WriteAllText($taskMarker,(@{pid=$taskStarted.Id;command=$taskLaunch.command;startedAtMs=([DateTimeOffset]$taskStarted.StartTime).ToUnixTimeMilliseconds()}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Write-Host '已运行本地配置指定的 NapCat 启动器；登录、端口和账号由自己的网关管理。'
