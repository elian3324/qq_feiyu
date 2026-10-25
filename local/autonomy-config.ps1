if(-not(Test-Path -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'ai-companion-kit\packages\companion\config.json'))){& (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\windows-controls.ps1') -Action initialize}
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskFile=Join-Path $taskRoot 'ai-companion-kit\packages\companion\config.json'
$taskCfg=Get-Content -LiteralPath $taskFile -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$taskForm=[Windows.Forms.Form]::new();$taskForm.Text='小助手 - 自主行为设置';$taskForm.ClientSize=[Drawing.Size]::new(760,750);$taskForm.StartPosition='CenterScreen';$taskForm.Font=[Drawing.Font]::new('Microsoft YaHei UI',10)
$taskChecks=@{}
$taskRows=@(@('chat','允许偶尔主动私聊管理员',$taskCfg.autonomy.chat.enabled),@('qzone','QQ 空间自主行为总开关',$taskCfg.autonomy.qzone.enabled),@('publishEnabled','允许自主发表说说（默认好友可见）',$taskCfg.autonomy.qzone.publishEnabled),@('readOwnerEnabled','后台查看管理员动态和评论',$taskCfg.autonomy.qzone.readOwnerEnabled),@('commentEnabled','允许主动评论管理员新动态',$taskCfg.autonomy.qzone.commentEnabled),@('replyEnabled','允许回复管理员评论和多轮交流',$taskCfg.autonomy.qzone.replyEnabled),@('likeEnabled','允许自主点赞管理员动态',$taskCfg.autonomy.qzone.likeEnabled),@('dry','仅预览：生成草稿但不发送',$taskCfg.autonomy.dryRun),@('paused','暂停全部自主行为',$taskCfg.autonomy.paused))
for($taskI=0;$taskI -lt $taskRows.Count;$taskI++) {$taskBox=[Windows.Forms.CheckBox]::new();$taskBox.Text=$taskRows[$taskI][1];$taskBox.Checked=[bool]$taskRows[$taskI][2];$taskBox.SetBounds(20,12+32*$taskI,720,28);$taskForm.Controls.Add($taskBox);$taskChecks[$taskRows[$taskI][0]]=$taskBox}
$taskFields=@{}
$taskWake=if($taskCfg.autonomy.qzone.wakeMinutes){$taskCfg.autonomy.qzone.wakeMinutes}else{@(30,90)}
$taskValues=@(@('timezone','时区',$taskCfg.autonomy.timezone),@('chatMax','主动私聊每日最多次数（0~8）',$taskCfg.autonomy.chat.maxPerDay),@('chatGap','主动私聊最短间隔小时（1~168）',$taskCfg.autonomy.chat.minIntervalHours),@('postDay','自主说说每日上限（0~5）',$taskCfg.autonomy.qzone.maxPerDay),@('postWeek','自主说说每周上限（0~20）',$taskCfg.autonomy.qzone.maxPerWeek),@('wakeMin','独立思考间隔：最短分钟（10~1440）',$taskWake[0]),@('wakeMax','独立思考间隔：最长分钟（10~1440）',$taskWake[1]),@('poll','空间后台检查间隔秒（60~86400）',$taskCfg.autonomy.qzone.pollIntervalSeconds),@('interactionGap','互动最短间隔分钟（1~1440）',$taskCfg.autonomy.qzone.minInteractionIntervalMinutes))
for($taskI=0;$taskI -lt $taskValues.Count;$taskI++) {$taskLabel=[Windows.Forms.Label]::new();$taskLabel.Text=$taskValues[$taskI][1];$taskLabel.SetBounds(20,310+34*$taskI,530,28);$taskForm.Controls.Add($taskLabel);$taskText=[Windows.Forms.TextBox]::new();$taskText.Text=[string]$taskValues[$taskI][2];$taskText.SetBounds(560,308+34*$taskI,175,28);$taskForm.Controls.Add($taskText);$taskFields[$taskValues[$taskI][0]]=$taskText}
$taskFields.chatMax.Enabled=($taskCfg.autonomy.chat.dailyLimitEnabled -ne $false);$taskFields.chatGap.Enabled=($taskCfg.autonomy.chat.cooldownEnabled -ne $false)
$taskUnlimited=[Windows.Forms.CheckBox]::new();$taskUnlimited.Text='不限制评论、回复、点赞每日次数';$taskUnlimited.Checked=($taskCfg.autonomy.qzone.interactionDailyLimitEnabled -eq $false);$taskUnlimited.SetBounds(20,622,370,28);$taskForm.Controls.Add($taskUnlimited)
$taskAllDay=[Windows.Forms.CheckBox]::new();$taskAllDay.Text='允许全天空间活动';$taskAllDay.Checked=($taskCfg.autonomy.qzone.activeHoursEnabled -eq $false);$taskAllDay.SetBounds(400,622,330,28);$taskForm.Controls.Add($taskAllDay)
$taskNote=[Windows.Forms.Label]::new();$taskNote.Text="说说每日/每周额度和互动冷却仍按设置执行；唤醒不强制发布。`n保存后约 60 秒内生效；更多参数见《QQ空间自主互动说明》。";$taskNote.SetBounds(20,657,720,42);$taskForm.Controls.Add($taskNote)
$taskSave=[Windows.Forms.Button]::new();$taskSave.Text='保存设置';$taskSave.SetBounds(585,705,150,34)
$taskChatButton=[Windows.Forms.Button]::new();$taskChatButton.Text='主动私聊详细设置';$taskChatButton.SetBounds(20,705,230,34)
$taskChatButton.Add_Click({& (Join-Path $PSScriptRoot 'chat-autonomy-config.ps1');$taskFresh=Get-Content -LiteralPath $taskFile -Raw -Encoding UTF8|ConvertFrom-Json;$taskChecks.chat.Checked=[bool]$taskFresh.autonomy.chat.enabled;$taskFields.chatMax.Text=[string]$taskFresh.autonomy.chat.maxPerDay;$taskFields.chatGap.Text=[string]$taskFresh.autonomy.chat.minIntervalHours;$taskFields.chatMax.Enabled=($taskFresh.autonomy.chat.dailyLimitEnabled -ne $false);$taskFields.chatGap.Enabled=($taskFresh.autonomy.chat.cooldownEnabled -ne $false)})
$taskForm.Controls.Add($taskChatButton)
$taskSave.Add_Click({try {
 $taskLiveCfg=Get-Content -LiteralPath $taskFile -Raw -Encoding UTF8|ConvertFrom-Json
 $taskMax=[int]$taskFields.chatMax.Text;$taskGap=[double]$taskFields.chatGap.Text;$taskDay=[int]$taskFields.postDay.Text;$taskWeek=[int]$taskFields.postWeek.Text
 $taskMin=[int]$taskFields.wakeMin.Text;$taskWakeMax=[int]$taskFields.wakeMax.Text;$taskPoll=[int]$taskFields.poll.Text;$taskInteraction=[int]$taskFields.interactionGap.Text
 if($taskMax -lt 0 -or $taskMax -gt 8 -or $taskGap -lt 0 -or ($taskGap -lt 1 -and $taskLiveCfg.autonomy.chat.cooldownEnabled -ne $false) -or $taskGap -gt 168 -or $taskDay -lt 0 -or $taskDay -gt 5 -or $taskWeek -lt 0 -or $taskWeek -gt 20 -or $taskMin -lt 10 -or $taskWakeMax -gt 1440 -or $taskWakeMax -lt $taskMin -or $taskPoll -lt 60 -or $taskPoll -gt 86400 -or $taskInteraction -lt 1 -or $taskInteraction -gt 1440) {throw '次数或间隔超出范围。'}
 $taskNode=(Get-Command node -ErrorAction Stop).Source
 $taskZone=$taskFields.timezone.Text.Trim()
 if($taskZone -notmatch '^[A-Za-z_]+/[A-Za-z_]+(?:/[A-Za-z_]+)?$') {throw '请填写 IANA 时区，例如 Asia/Shanghai。'}
 & $taskNode -e "try { new Intl.DateTimeFormat('en',{timeZone:process.argv[1]}) } catch { process.exit(1) }" $taskZone
 if($LASTEXITCODE -ne 0) {throw '时区名称无效，请使用例如 Asia/Shanghai。'}
 $taskCfg=Get-Content -LiteralPath $taskFile -Raw -Encoding UTF8 | ConvertFrom-Json
 $taskCfg.autonomy.chat.enabled=$taskChecks.chat.Checked;$taskCfg.autonomy.qzone.enabled=$taskChecks.qzone.Checked;$taskCfg.autonomy.dryRun=$taskChecks.dry.Checked;$taskCfg.autonomy.paused=$taskChecks.paused.Checked
 $taskCfg.autonomy.timezone=$taskZone;$taskCfg.autonomy.chat.maxPerDay=$taskMax;$taskCfg.autonomy.chat.minIntervalHours=$taskGap
 foreach($taskFlag in @('publishEnabled','readOwnerEnabled','commentEnabled','replyEnabled','likeEnabled')) {$taskCfg.autonomy.qzone|Add-Member -NotePropertyName $taskFlag -NotePropertyValue $taskChecks[$taskFlag].Checked -Force}
 $taskUpdates=@{maxPerDay=$taskDay;maxPerWeek=$taskWeek;wakeMinutes=@($taskMin,$taskWakeMax);pollIntervalSeconds=$taskPoll;minInteractionIntervalMinutes=$taskInteraction}
 foreach($taskKey in $taskUpdates.Keys) {$taskCfg.autonomy.qzone|Add-Member -NotePropertyName $taskKey -NotePropertyValue $taskUpdates[$taskKey] -Force}
 $taskCfg.autonomy.qzone|Add-Member -NotePropertyName interactionDailyLimitEnabled -NotePropertyValue (-not $taskUnlimited.Checked) -Force
 $taskCfg.autonomy.qzone|Add-Member -NotePropertyName activeHoursEnabled -NotePropertyValue (-not $taskAllDay.Checked) -Force
 $taskTemp=$taskFile+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 try {[IO.File]::WriteAllText($taskTemp,($taskCfg|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false));[IO.File]::Replace($taskTemp,$taskFile,$null)}finally{if(Test-Path -LiteralPath $taskTemp){Remove-Item -LiteralPath $taskTemp}}
 $taskForm.Close()
}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'配置未保存')|Out-Null}})
$taskForm.Controls.Add($taskSave);$taskForm.AcceptButton=$taskSave;[void]$taskForm.ShowDialog();$taskForm.Dispose()
