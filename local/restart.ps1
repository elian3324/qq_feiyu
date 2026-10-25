param([switch]$DryRun,[switch]$SkipModelCheck,[switch]$KeepGatewayConfig)
$ErrorActionPreference='Stop'
if($DryRun){Write-Host '请在本地配置中使用自主行为预演选项；此入口不会把 --dry-run 当作离线检查。';exit 1}
& (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\windows-controls.ps1') -Action restart
