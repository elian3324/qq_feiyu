if(-not(Test-Path -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'ai-companion-kit\packages\companion\config.json'))){& (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\windows-controls.ps1') -Action initialize}
$ErrorActionPreference='Stop'
$chatTaskRoot=Split-Path $PSScriptRoot -Parent
$chatTaskFile=Join-Path $chatTaskRoot 'ai-companion-kit\packages\companion\config.json'
$chatTaskCfg=Get-Content -LiteralPath $chatTaskFile -Raw -Encoding UTF8|ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$chatTaskForm=[Windows.Forms.Form]::new();$chatTaskForm.Text='小助手 - 主动私聊设置';$chatTaskForm.ClientSize=[Drawing.Size]::new(690,690);$chatTaskForm.StartPosition='CenterScreen';$chatTaskForm.Font=[Drawing.Font]::new('Microsoft YaHei UI',10)
$chatTaskEnable=[Windows.Forms.CheckBox]::new();$chatTaskEnable.Text='允许主动私聊配置中的管理员';$chatTaskEnable.Checked=[bool]$chatTaskCfg.autonomy.chat.enabled;$chatTaskEnable.SetBounds(20,15,640,28);$chatTaskForm.Controls.Add($chatTaskEnable)
$chatTaskDry=[Windows.Forms.CheckBox]::new();$chatTaskDry.Text='私聊仅预览（不发送，不影响空间功能）';$chatTaskDry.Checked=[bool]$chatTaskCfg.autonomy.chat.dryRun;$chatTaskDry.SetBounds(20,50,640,28);$chatTaskForm.Controls.Add($chatTaskDry)
$chatTaskUnlimited=[Windows.Forms.CheckBox]::new();$chatTaskUnlimited.Text='不限制每日主动次数';$chatTaskUnlimited.Checked=($chatTaskCfg.autonomy.chat.dailyLimitEnabled -eq $false);$chatTaskUnlimited.SetBounds(20,85,640,28);$chatTaskForm.Controls.Add($chatTaskUnlimited)
$chatTaskFree=[Windows.Forms.CheckBox]::new();$chatTaskFree.Text='按心情自由主动，不设未回复降频（仍遵守轻量间隔）';$chatTaskFree.Checked=($chatTaskCfg.autonomy.chat.cooldownEnabled -eq $false);$chatTaskFree.SetBounds(20,115,640,28);$chatTaskForm.Controls.Add($chatTaskFree)
function Get-ChatTaskValue($chatTaskInput,$chatTaskDefault){if($null -eq $chatTaskInput){return $chatTaskDefault};return $chatTaskInput}
$chatTaskWake=if($chatTaskCfg.autonomy.chat.wakeMinutes){$chatTaskCfg.autonomy.chat.wakeMinutes}else{@(30,90)}
$chatTaskRows=@(
 @('max','备用每日上限（启用限额时生效，0~8）',(Get-ChatTaskValue $chatTaskCfg.autonomy.chat.maxPerDay 2)),
 @('gap','备用发送间隔小时（启用冷却时生效）',(Get-ChatTaskValue $chatTaskCfg.autonomy.chat.minIntervalHours 4)),
 @('idle','管理员停止聊天多久后才可主动：小时（0~168）',(Get-ChatTaskValue $chatTaskCfg.autonomy.chat.ownerInactivityHours 0.5)),
 @('start','允许主动私聊：开始时间 HH:mm',(Get-ChatTaskValue $chatTaskCfg.autonomy.chat.activeStart '09:00')),
 @('end','允许主动私聊：结束时间 HH:mm',(Get-ChatTaskValue $chatTaskCfg.autonomy.chat.activeEnd '23:00')),
 @('wakeMin','后台思考最短间隔分钟（1~1440）',$chatTaskWake[0]),
 @('wakeMax','后台思考最长间隔分钟（1~1440）',$chatTaskWake[1]),
 @('quiet','管理员说不要打扰后的暂停小时（1~24）',(Get-ChatTaskValue $chatTaskCfg.autonomy.chat.busyQuietHours 8)),
 @('lightGap','轻量防连发：主动消息至少间隔分钟（0~1440）',(Get-ChatTaskValue $chatTaskCfg.autonomy.chat.minIntervalMinutes 0)),
 @('lightIdle','轻量防打断：停止聊天多少分钟后可主动（0~1440）',(Get-ChatTaskValue $chatTaskCfg.autonomy.chat.ownerIdleMinutes 0)))
$chatTaskFields=@{}
for($chatTaskIndex=0;$chatTaskIndex -lt $chatTaskRows.Count;$chatTaskIndex++){
 $chatTaskLabel=[Windows.Forms.Label]::new();$chatTaskLabel.Text=$chatTaskRows[$chatTaskIndex][1];$chatTaskLabel.SetBounds(20,155+40*$chatTaskIndex,490,28);$chatTaskForm.Controls.Add($chatTaskLabel)
 $chatTaskText=[Windows.Forms.TextBox]::new();$chatTaskText.Text=[string]$chatTaskRows[$chatTaskIndex][2];$chatTaskText.SetBounds(520,153+40*$chatTaskIndex,145,28);$chatTaskForm.Controls.Add($chatTaskText);$chatTaskFields[$chatTaskRows[$chatTaskIndex][0]]=$chatTaskText
}
$chatTaskFields.max.Enabled=-not $chatTaskUnlimited.Checked;$chatTaskFields.gap.Enabled=-not $chatTaskFree.Checked;$chatTaskFields.idle.Enabled=-not $chatTaskFree.Checked
$chatTaskUnlimited.Add_CheckedChanged({$chatTaskFields.max.Enabled=-not $chatTaskUnlimited.Checked})
$chatTaskFree.Add_CheckedChanged({$chatTaskFields.gap.Enabled=-not $chatTaskFree.Checked;$chatTaskFields.idle.Enabled=-not $chatTaskFree.Checked})
$chatTaskNote=[Windows.Forms.Label]::new();$chatTaskNote.Text="轻量间隔在自由模式也生效，不限制正常聊天回复。`n免打扰仍有效，默认 23:00~09:00 不主动。`n保存后约 60 秒内生效；全局暂停和全局仅预览仍优先。";$chatTaskNote.SetBounds(20,565,650,70);$chatTaskForm.Controls.Add($chatTaskNote)
$chatTaskSave=[Windows.Forms.Button]::new();$chatTaskSave.Text='保存设置';$chatTaskSave.SetBounds(520,645,145,32)
$chatTaskSave.Add_Click({try{
 $chatTaskMax=[int]$chatTaskFields.max.Text;$chatTaskGap=[double]$chatTaskFields.gap.Text;$chatTaskIdle=[double]$chatTaskFields.idle.Text
 $chatTaskLow=[int]$chatTaskFields.wakeMin.Text;$chatTaskHigh=[int]$chatTaskFields.wakeMax.Text;$chatTaskQuiet=[double]$chatTaskFields.quiet.Text
 $chatTaskLightGap=[double]$chatTaskFields.lightGap.Text;$chatTaskLightIdle=[double]$chatTaskFields.lightIdle.Text
 if([double]::IsNaN($chatTaskLightGap) -or [double]::IsNaN($chatTaskLightIdle) -or $chatTaskLightGap -lt 0 -or $chatTaskLightGap -gt 1440 -or $chatTaskLightIdle -lt 0 -or $chatTaskLightIdle -gt 1440){throw '轻量限制应为 0~1440 分钟，0 表示关闭该项。'}
 if($chatTaskMax -lt 0 -or $chatTaskMax -gt 8 -or $chatTaskGap -lt 0 -or ($chatTaskGap -lt 1 -and -not $chatTaskFree.Checked) -or $chatTaskGap -gt 168 -or $chatTaskIdle -lt 0 -or $chatTaskIdle -gt 168 -or $chatTaskLow -lt 1 -or $chatTaskHigh -gt 1440 -or $chatTaskHigh -lt $chatTaskLow -or $chatTaskQuiet -lt 1 -or $chatTaskQuiet -gt 24){throw '次数或间隔超出范围。'}
 $chatTaskStart=$chatTaskFields.start.Text.Trim();$chatTaskEnd=$chatTaskFields.end.Text.Trim()
 if($chatTaskStart -notmatch '^([01]\d|2[0-3]):[0-5]\d$' -or $chatTaskEnd -notmatch '^([01]\d|2[0-3]):[0-5]\d$' -or $chatTaskStart -ge $chatTaskEnd){throw '允许时段必须为同一天内的 HH:mm，开始早于结束。'}
 $chatTaskCfg=Get-Content -LiteralPath $chatTaskFile -Raw -Encoding UTF8|ConvertFrom-Json
 $chatTaskUpdates=@{enabled=$chatTaskEnable.Checked;dryRun=$chatTaskDry.Checked;dailyLimitEnabled=(-not $chatTaskUnlimited.Checked);cooldownEnabled=(-not $chatTaskFree.Checked);maxPerDay=$chatTaskMax;minIntervalHours=$chatTaskGap;ownerInactivityHours=$chatTaskIdle;activeStart=$chatTaskStart;activeEnd=$chatTaskEnd;wakeMinutes=@($chatTaskLow,$chatTaskHigh);busyQuietHours=$chatTaskQuiet;minIntervalMinutes=$chatTaskLightGap;ownerIdleMinutes=$chatTaskLightIdle}
 foreach($chatTaskKey in $chatTaskUpdates.Keys){$chatTaskCfg.autonomy.chat|Add-Member -NotePropertyName $chatTaskKey -NotePropertyValue $chatTaskUpdates[$chatTaskKey] -Force}
 $chatTaskTemp=$chatTaskFile+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 try{[IO.File]::WriteAllText($chatTaskTemp,($chatTaskCfg|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false));[IO.File]::Replace($chatTaskTemp,$chatTaskFile,$null)}finally{if(Test-Path -LiteralPath $chatTaskTemp){Remove-Item -LiteralPath $chatTaskTemp}}
 $chatTaskForm.Close()
}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'配置未保存')|Out-Null}})
$chatTaskForm.Controls.Add($chatTaskSave);$chatTaskForm.AcceptButton=$chatTaskSave;[void]$chatTaskForm.ShowDialog();$chatTaskForm.Dispose()
