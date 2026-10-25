param([Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskCache=Join-Path $taskRoot '.cache\downloads'
$taskDestination=Join-Path $taskRoot 'local-resources\node'
foreach($taskPath in @($taskCache,$taskDestination)){
    $taskResolved=[IO.Path]::GetFullPath($taskPath)
    if(-not $taskResolved.StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Installer destination escapes this project.'}
    [IO.Directory]::CreateDirectory($taskResolved)|Out-Null
}
$taskArchive=Join-Path $taskCache ('node-v'+$Version+'-win-x64.zip')
Invoke-WebRequest -Uri ('https://nodejs.org/dist/v'+$Version+'/node-v'+$Version+'-win-x64.zip') -OutFile $taskArchive
Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskDestination
Write-Host '已下载并解压你指定的 Node 版本。请核验官方校验值、阅读其 LICENSE 并将解压目录加入自己的 PATH。'
Write-Host '本脚本不会安装、启动机器人或处理 QQ 登录。'
