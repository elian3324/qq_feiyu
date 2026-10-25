param([ValidateSet('initialize','configure','start','stop','restart','doctor','logs','diary-read','diary-write','pause','resume','autonomy','chat','phone','gateway','screen-off','stickers','install','bridge-start','bridge-config','bridge-restart','supervisor','qzone-enable','mcp-refresh')][string]$Action='initialize')
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskConfig=Join-Path $taskRoot 'ai-companion-kit\packages\companion\config.json'

function Assert-LocalFile([string]$File) {
    $taskFull=[IO.Path]::GetFullPath($File)
    if(-not $taskFull.StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'File must stay inside this project.'}
    return $taskFull
}
function Save-LocalJson([string]$File,$Value) {
    $taskFull=Assert-LocalFile $File
    [IO.Directory]::CreateDirectory((Split-Path $taskFull -Parent))|Out-Null
    [IO.File]::WriteAllText($taskFull,($Value|ConvertTo-Json -Depth 40),[Text.UTF8Encoding]::new($false))
}
function Read-LocalEnvironment {
    $taskEnv=Join-Path $taskRoot '.env'
    if(-not(Test-Path -LiteralPath $taskEnv)){return}
    foreach($taskLine in [IO.File]::ReadAllLines($taskEnv)) {
        if($taskLine -match '^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
            $taskName=$Matches[1];$taskValue=$Matches[2]
            if($taskValue.Length -ge 2 -and (($taskValue.StartsWith('"') -and $taskValue.EndsWith('"')) -or ($taskValue.StartsWith("'") -and $taskValue.EndsWith("'")))){$taskValue=$taskValue.Substring(1,$taskValue.Length-2)}
            if($taskValue -and -not [Environment]::GetEnvironmentVariable($taskName,'Process')){[Environment]::SetEnvironmentVariable($taskName,$taskValue,'Process')}
        }
    }
}
function Write-McpConfiguration([switch]$Force) {
    $taskNodeCommand=Get-Command node -ErrorAction SilentlyContinue
    $taskNodePath=if($taskNodeCommand){$taskNodeCommand.Source}else{'node'}
    $taskCommon=@{command=$taskNodePath;args=@(('--env-file='+(Join-Path $taskRoot '.env')),(Join-Path $taskRoot 'local\mcp.mjs'),'phone');env=@{COMPANION_CONFIG=$taskConfig}}
    $taskSpace=@{command=$taskNodePath;args=@(('--env-file='+(Join-Path $taskRoot '.env')),(Join-Path $taskRoot 'local\mcp.mjs'),'qzone');env=@{COMPANION_CONFIG=$taskConfig}}
    $taskPhoneFile=Join-Path $taskRoot 'MCP配置.json'
    if($Force -or -not(Test-Path -LiteralPath $taskPhoneFile)){Save-LocalJson $taskPhoneFile @{mcpServers=@{'qq-phone'=$taskCommon}}}
    $taskSpaceFile=Join-Path $taskRoot 'MCP空间配置.json'
    if($Force -or -not(Test-Path -LiteralPath $taskSpaceFile)){Save-LocalJson $taskSpaceFile @{mcpServers=@{'qq-space'=$taskSpace}}}
}
function Initialize-LocalFiles {
    $taskCopies=@(
        @('.env.example','.env'),
        @('ai-companion-kit\packages\companion\config.example.json','ai-companion-kit\packages\companion\config.json'),
        @('ai-companion-kit\packages\companion\role.example.md','ai-companion-kit\packages\companion\role.md'),
        @('local\features-settings.example.json','local\features-settings.json')
    )
    foreach($taskPair in $taskCopies){
        $taskDestination=Assert-LocalFile (Join-Path $taskRoot $taskPair[1])
        if(-not(Test-Path -LiteralPath $taskDestination)){Copy-Item -LiteralPath (Join-Path $taskRoot $taskPair[0]) -Destination $taskDestination}
    }
    foreach($taskDir in @('data','logs','data\stickers')){[IO.Directory]::CreateDirectory((Join-Path $taskRoot $taskDir))|Out-Null}
    $taskLibrary=Join-Path $taskRoot 'data\stickers\library.json'
    if(-not(Test-Path -LiteralPath $taskLibrary)){
        [IO.File]::WriteAllText($taskLibrary,'[]',[Text.UTF8Encoding]::new($false))
        & (Join-Path $taskRoot 'local\build-stickers.ps1')
    }
    Read-LocalEnvironment
    Write-McpConfiguration
}
function Get-NodeExecutable {return (Get-Command node -ErrorAction Stop).Source}
function Invoke-LocalNode([string[]]$NodeArguments){
    $taskNode=Get-NodeExecutable
    Push-Location $taskRoot
    try {& $taskNode @NodeArguments;if($LASTEXITCODE -ne 0){throw 'Node command failed; see the local configuration and guide.'}}
    finally {Pop-Location}
}
function Stop-LocalBot([string]$MarkerName='instance.json') {
    $taskMarker=Join-Path $taskRoot ('logs\'+$MarkerName)
    if(-not(Test-Path -LiteralPath $taskMarker)){Write-Host '本副本没有进程标记；未停止任何进程。';return}
    $taskInstance=Get-Content -LiteralPath $taskMarker -Raw -Encoding UTF8|ConvertFrom-Json
    if([IO.Path]::GetFullPath([string]$taskInstance.root).TrimEnd('\','/') -ne $taskRoot.TrimEnd('\','/')){throw 'Instance root mismatch; refusing to stop.'}
    $taskProcessId=[int]$taskInstance.pid
    if($taskProcessId -le 0){throw 'Invalid process ID.'}
    $taskProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$taskProcessId)
    if(-not $taskProcess){Write-Host '本副本进程已退出。';return}
    $taskEntry=[string]$taskInstance.entry
    $taskAllowedEntries=@((Join-Path $taskRoot 'local\run.mjs'),(Join-Path $taskRoot 'local\service.mjs'),(Join-Path $taskRoot 'qq-bridge\src\bridge-entry.mjs'))
    if($taskEntry -notin $taskAllowedEntries){throw 'Unexpected project entry; refusing to stop.'}
    $taskCommand=[string]$taskProcess.CommandLine
    if(-not $taskCommand.Contains($taskEntry) -or -not $taskCommand.Contains('--release-root='+$taskRoot) -or [IO.Path]::GetFileName([string]$taskProcess.ExecutablePath) -ne 'node.exe'){throw 'Process identity mismatch; refusing to stop.'}
    $taskCreated=[DateTimeOffset]$taskProcess.CreationDate
    $taskRecorded=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$taskInstance.startedAtMs)
    if([Math]::Abs(($taskCreated.ToUniversalTime()-$taskRecorded.ToUniversalTime()).TotalSeconds) -gt 5){throw 'Process creation time mismatch; refusing to stop.'}
    # The exact executable, absolute entry, project marker, PID and creation time
    # must all match. Never kill by executable name or terminate another gateway.
    & taskkill.exe /PID $taskProcessId /T /F | Out-Null
    if($LASTEXITCODE -ne 0){throw 'This instance could not be stopped.'}
    Write-Host '已停止本副本机器人及其子工具进程；未操作 QQ 或网关进程。'
}
function Stop-LocalGateway {
    $taskProfile=Join-Path $taskRoot 'local\gateway-launcher.local.json'
    $taskMarker=Join-Path $taskRoot 'logs\gateway-launcher.json'
    if(-not(Test-Path -LiteralPath $taskProfile) -or -not(Test-Path -LiteralPath $taskMarker)){return}
    $taskLaunch=Get-Content -LiteralPath $taskProfile -Raw -Encoding UTF8|ConvertFrom-Json
    if($taskLaunch.allowStop -ne $true){Write-Host '独立网关保持运行；没有启用本副本的网关停止授权。';return}
    $taskHeld=Get-Content -LiteralPath $taskMarker -Raw -Encoding UTF8|ConvertFrom-Json
    $taskProcessId=[int]$taskHeld.pid
    if($taskProcessId -le 0){throw 'Invalid gateway process marker.'}
    $taskProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$taskProcessId)
    if(-not $taskProcess){return}
    $taskCreated=[DateTimeOffset]$taskProcess.CreationDate
    $taskRecorded=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$taskHeld.startedAtMs)
    if([string]$taskProcess.ExecutablePath -ne [string]$taskHeld.command -or [Math]::Abs(($taskCreated.ToUniversalTime()-$taskRecorded).TotalSeconds) -gt 5 -or -not ([string]$taskProcess.CommandLine).Contains($taskRoot+[IO.Path]::DirectorySeparatorChar)){
        throw 'Gateway identity is not isolated to this project; stop it manually.'
    }
    & taskkill.exe /PID $taskProcessId /T /F | Out-Null
    if($LASTEXITCODE -ne 0){throw 'The registered gateway could not be stopped.'}
    Write-Host '已停止当前副本登记且获准停止的隔离网关。'
}
try {
    switch($Action){
        'initialize' {Initialize-LocalFiles;Write-Host '已创建缺少的本地模板和 MCP 配置；未覆盖已有账号、人设和密钥。'}
        'mcp-refresh' {Initialize-LocalFiles;Write-McpConfiguration -Force;Write-Host '已重新生成两个本机 MCP 配置文件。'}
        'configure' {Initialize-LocalFiles;& (Join-Path $taskRoot 'local\configure.ps1');Write-McpConfiguration;Write-Host '请同时在 .env 中填写自己的 ONEBOT_ACCESS_TOKEN。'}
        'start' {
            if(-not(Test-Path -LiteralPath $taskConfig) -or -not(Test-Path -LiteralPath (Join-Path $taskRoot '.env'))){Initialize-LocalFiles;& (Join-Path $taskRoot 'local\configure.ps1')}
            foreach($taskRequired in @('ai-companion-kit\node_modules\@modelcontextprotocol\sdk\package.json','local\media-runtime\node_modules\silk-wasm\package.json')){
                if(-not(Test-Path -LiteralPath (Join-Path $taskRoot $taskRequired))){throw '请先双击 安装依赖.cmd 或按 README 安装依赖。'}
            }
            Read-LocalEnvironment
            Invoke-LocalNode @('--env-file=.env',(Join-Path $taskRoot 'local\start.mjs'))
        }
        'stop' {foreach($taskMarkerName in @('supervisor-instance.json','instance.json','bridge-instance.json')){Stop-LocalBot $taskMarkerName};Stop-LocalGateway}
        'restart' {Stop-LocalBot 'supervisor-instance.json';Stop-LocalBot;& $PSCommandPath -Action start}
        'supervisor' {Initialize-LocalFiles;Invoke-LocalNode @('--env-file=.env',(Join-Path $taskRoot 'local\start.mjs'),'--supervise')}
        'bridge-config' {
            Initialize-LocalFiles
            $taskBridgeConfig=Join-Path $taskRoot 'qq-bridge\config.json'
            if(-not(Test-Path -LiteralPath $taskBridgeConfig)){Copy-Item -LiteralPath (Join-Path $taskRoot 'qq-bridge\config.example.json') -Destination $taskBridgeConfig}
            $taskRole=Join-Path $taskRoot 'qq-bridge\roles\default.md'
            if(-not(Test-Path -LiteralPath $taskRole)){Copy-Item -LiteralPath (Join-Path $taskRoot 'qq-bridge\roles\default.example.md') -Destination $taskRole}
            Write-Host '请配置自己的 DSH、网关、管理员及白名单；详见 docs/DSH_BRIDGE.md。'
            & notepad.exe $taskBridgeConfig
        }
        'bridge-start' {
            Read-LocalEnvironment
            if(-not(Test-Path -LiteralPath (Join-Path $taskRoot 'qq-bridge\config.json'))){throw '请先双击 配置DSH桥接.cmd。'}
            Invoke-LocalNode @('--env-file=.env',(Join-Path $taskRoot 'qq-bridge\src\launch.mjs'))
        }
        'bridge-restart' {Stop-LocalBot 'bridge-instance.json';& $PSCommandPath -Action bridge-start}
        'qzone-enable' {
            Initialize-LocalFiles
            $taskCfg=Get-Content -LiteralPath $taskConfig -Raw -Encoding UTF8|ConvertFrom-Json
            $taskCfg.qzone.enabled=$true
            Save-LocalJson $taskConfig $taskCfg
            Write-Host '已启用空间工具。自主发布仍由独立开关控制；完整空间读取/互动需要文档指定的网关或授权本地适配器。'
        }
        'doctor' {
            Write-Host '仅检查本地文件和命令是否存在，不联网、不启动机器人。'
            foreach($taskName in @('node','npm','python','ffmpeg','adb','git')){Write-Host ($taskName+': '+[bool](Get-Command $taskName -ErrorAction SilentlyContinue))}
            foreach($taskName in @('.env','ai-companion-kit\packages\companion\config.json','ai-companion-kit\packages\companion\role.md','ai-companion-kit\node_modules','local\media-runtime\node_modules')){Write-Host ($taskName+': '+(Test-Path -LiteralPath (Join-Path $taskRoot $taskName)))}
        }
        'logs' {
            $taskLogs=Join-Path $taskRoot 'logs'
            if(-not(Test-Path -LiteralPath $taskLogs)){Write-Host '尚无本地日志。';break}
            Get-ChildItem -LiteralPath $taskLogs -File|Where-Object {$_.Extension -in @('.log','.jsonl')}|Sort-Object LastWriteTime -Descending|Select-Object -First 10 Name,LastWriteTime,Length|Format-Table
            $taskChoice=Read-Host '输入要查看的日志文件名；留空只显示列表'
            if($taskChoice){
                if([IO.Path]::GetFileName($taskChoice) -ne $taskChoice){throw 'Please enter a filename inside this project logs directory.'}
                $taskLogFile=Assert-LocalFile (Join-Path $taskLogs $taskChoice)
                if(-not(Test-Path -LiteralPath $taskLogFile -PathType Leaf)){throw 'Log file not found.'}
                Get-Content -LiteralPath $taskLogFile -Encoding UTF8 -Tail 200
            }
            Write-Host '日志可能含私人数据；不要直接上传。聊天主进程输出显示在启动窗口。'
        }
        'diary-read' {Read-LocalEnvironment;Invoke-LocalNode @('--env-file=.env',(Join-Path $taskRoot 'local\diary-cli.mjs'),'list')}
        'diary-write' {Read-LocalEnvironment;Invoke-LocalNode @('--env-file=.env',(Join-Path $taskRoot 'local\diary-cli.mjs'),'write')}
        'pause' {Initialize-LocalFiles;Invoke-LocalNode @((Join-Path $taskRoot 'local\autonomy-control.mjs'),'pause')}
        'resume' {Initialize-LocalFiles;Invoke-LocalNode @((Join-Path $taskRoot 'local\autonomy-control.mjs'),'resume')}
        'autonomy' {Initialize-LocalFiles;& (Join-Path $taskRoot 'local\autonomy-config.ps1')}
        'chat' {Initialize-LocalFiles;& (Join-Path $taskRoot 'local\chat-autonomy-config.ps1')}
        'phone' {Initialize-LocalFiles;& (Join-Path $taskRoot 'local\phone-setup.ps1')}
        'stickers' {Initialize-LocalFiles;& (Join-Path $taskRoot 'local\build-stickers.ps1')}
        'gateway' {Read-LocalEnvironment;& (Join-Path $taskRoot 'local\gateway.ps1') -StartConfiguredGateway}
        'screen-off' {& (Join-Path $taskRoot 'local\screen-off.ps1')}
        'install' {
            Push-Location $taskRoot
            try {
                $taskNpm=(Get-Command npm.cmd -ErrorAction Stop).Source
                foreach($taskPrefix in @('ai-companion-kit','local/media-runtime','qq-bridge')){& $taskNpm --prefix $taskPrefix ci --ignore-scripts;if($LASTEXITCODE -ne 0){throw 'Dependency installation failed.'}}
            } finally {Pop-Location}
        }
    }
} catch {Write-Host ('操作失败：'+$_.Exception.Message) -ForegroundColor Red;exit 1}
