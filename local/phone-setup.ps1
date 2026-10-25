param([string]$Serial='',[switch]$NoInstallKeyboard,[string]$KeyboardApk='')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskAdb=if($env:PHONE_ADB){$env:PHONE_ADB}else{(Get-Command adb -ErrorAction Stop).Source}
$taskDevices=& $taskAdb devices
if($LASTEXITCODE -ne 0){throw 'ADB could not list your devices.'}
$taskOnline=@($taskDevices|Where-Object {$_ -match '^([^\s]+)\s+device$'}|ForEach-Object {($_ -split '\s+')[0]})
if(-not $Serial){if($taskOnline.Count -ne 1){throw 'Connect and authorize exactly one device, or specify -Serial.'};$Serial=$taskOnline[0]}
if($Serial -notin $taskOnline){throw 'The selected device is not authorized and online.'}
if(-not $NoInstallKeyboard -and $KeyboardApk){
    if(-not(Test-Path -LiteralPath $KeyboardApk -PathType Leaf)){throw 'Provide your own authorized keyboard APK.'}
    & $taskAdb -s $Serial install -r $KeyboardApk
    if($LASTEXITCODE -ne 0){throw 'Keyboard installation failed.'}
}
$taskSettings=@{phoneSerial=$Serial}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'features-settings.json'),($taskSettings|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$taskFile=Join-Path $taskRoot 'ai-companion-kit/packages/companion/config.json'
$taskCfg=Get-Content -LiteralPath $taskFile -Raw -Encoding UTF8|ConvertFrom-Json
$taskCfg.phone.enabled=$true
[IO.File]::WriteAllText($taskFile,($taskCfg|ConvertTo-Json -Depth 40),[Text.UTF8Encoding]::new($false))
Write-Host '已保存自己的设备并启用手机工具；重启本副本后生效。中文输入键盘请自行确认来源和授权。'
