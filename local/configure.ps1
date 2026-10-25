param([switch]$NoGui)
if(-not(Test-Path -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'ai-companion-kit\packages\companion\config.json'))){& (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\windows-controls.ps1') -Action initialize}
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskFile = Join-Path $taskRoot 'ai-companion-kit\packages\companion\config.json'
$taskCfg = Get-Content -LiteralPath $taskFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($NoGui) { exit 0 }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$taskForm = New-Object Windows.Forms.Form
$taskForm.Text = 'AI Companion - 百炼与 QQ 配置'
$taskForm.ClientSize = New-Object Drawing.Size(660, 425)
$taskForm.StartPosition = 'CenterScreen'
$taskForm.FormBorderStyle = 'FixedDialog'
$taskForm.MaximizeBox = $false
$taskForm.Font = New-Object Drawing.Font('Microsoft YaHei UI',10)
$taskFields = @{}
$taskRows = @(
    @('API Key（留空保留已保存的 Key）','apiKey',''),
    @('百炼接口地址','baseUrl',$taskCfg.baseUrl),
    @('模型名称','model',$taskCfg.model),
    @('你的管理员 QQ 号','ownerQQ',($taskCfg.ownerIds -join '')),
    @('机器人 QQ 小号','botQQ',$taskCfg.botQQ)
)
for ($taskI=0; $taskI -lt $taskRows.Count; $taskI++) {
    $taskLabel = New-Object Windows.Forms.Label
    $taskLabel.Text = $taskRows[$taskI][0]
    $taskLabel.SetBounds(20,20+58*$taskI,610,22)
    $taskForm.Controls.Add($taskLabel)
    $taskBox = New-Object Windows.Forms.TextBox
    $taskBox.Text = [string]$taskRows[$taskI][2]
    $taskBox.SetBounds(20,43+58*$taskI,610,27)
    if ($taskI -eq 0) { $taskBox.UseSystemPasswordChar = $true }
    $taskFields[$taskRows[$taskI][1]] = $taskBox
    $taskForm.Controls.Add($taskBox)
}
$taskNote = New-Object Windows.Forms.Label
$taskNote.Text = 'Key 只保存在本机。保存后双击“一键启动”；首次需用机器人小号扫码。'
$taskNote.SetBounds(20,320,610,42)
$taskForm.Controls.Add($taskNote)
$taskSave = New-Object Windows.Forms.Button
$taskSave.Text = '保存配置'
$taskSave.SetBounds(490,373,140,34)
$taskSave.Add_Click({
    try {
        $taskOwner = $taskFields.ownerQQ.Text.Trim()
        $taskBot = $taskFields.botQQ.Text.Trim()
        if ($taskOwner -notmatch '^[1-9][0-9]{4,11}$') { throw '请填写有效的管理员 QQ 号。' }
        if ($taskBot -notmatch '^[1-9][0-9]{4,11}$') { throw '请填写有效的机器人 QQ 小号。' }
        if ($taskOwner -eq $taskBot) { throw '管理员 QQ 与机器人小号需要不同。' }
        $taskUri = [uri]$taskFields.baseUrl.Text.Trim()
        if ($taskUri.Scheme -ne 'https' -or $taskUri.Host -notmatch '(^|\.)(aliyuncs\.com|aliyun\.com)$') { throw '请填写百炼官方 HTTPS 接口地址。' }
        $taskKey = $taskFields.apiKey.Text.Trim()
        if ($taskKey) { $taskCfg.apiKey = $taskKey }
        if (-not $taskCfg.apiKey -and -not $env:DASHSCOPE_API_KEY -and -not $env:AI_API_KEY -and -not $env:DEEPSEEK_API_KEY) { throw '请填写所选 AI 提供方的 API Key。' }
        if (-not $taskFields.model.Text.Trim()) { throw '请填写模型名称。' }
        $taskCfg.baseUrl = $taskUri.AbsoluteUri.TrimEnd('/')
        $taskCfg.model = $taskFields.model.Text.Trim()
        $taskCfg.ownerIds = @($taskOwner)
        $taskCfg.allow.private = @($taskOwner)
        $taskCfg.botQQ = $taskBot
        [IO.File]::WriteAllText($taskFile,($taskCfg | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
        $taskForm.DialogResult = [Windows.Forms.DialogResult]::OK
        $taskForm.Close()
    } catch { [Windows.Forms.MessageBox]::Show($_.Exception.Message,'配置未保存') | Out-Null }
})
$taskForm.Controls.Add($taskSave)
$taskForm.AcceptButton = $taskSave
$taskResult = $taskForm.ShowDialog()
$taskForm.Dispose()
if ($taskResult -ne [Windows.Forms.DialogResult]::OK) { exit 2 }
