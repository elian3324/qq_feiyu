$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskDir=Join-Path $taskRoot 'data\stickers'
[IO.Directory]::CreateDirectory($taskDir) | Out-Null
$taskItems=@(
 @('hug','抱抱','抱抱,交流,友好表达','小猫抱抱，适合管理员私聊的抱抱','owner'),
 @('happy','嘿嘿','开心,大笑,笑话','小猫开心笑，适合轻松好笑的聊天','owner,private,group'),
 @('sad','委屈巴巴','委屈,友好表达','小猫含泪委屈，适合轻微玩笑，不用于严肃求助','owner,private,group'),
 @('shy','害羞啦','害羞,友好表达','小猫脸红害羞','owner'),
 @('confused','喵？','疑惑,好奇','小猫歪头疑惑','owner,private,group'),
 @('speechless','无语喵','无语,吐槽','小猫半眯眼，无语但不恶意','owner,private,group'),
 @('shock','震惊喵','震惊,惊讶','小猫惊讶张嘴','owner,private,group'),
 @('proud','哼哼','得意,傲娇','小猫得意地笑','owner,private,group'),
 @('comfort','给你抱抱','安慰,鼓励','温柔小猫送安慰，不代替认真倾听','owner,private,group'),
 @('goodnight','晚安喵','晚安,休息','小猫闭眼睡觉','owner,private,group'),
 @('angry','哼唧','生气,傲娇','小猫假装生气，适合玩笑','owner'),
 @('touched','好感动','感动,感谢','小猫含泪微笑表示感谢','owner,private,group'),
 @('clingy','要交流','交流,友好表达','小猫软萌求交流','owner')
)
$taskPink=[Drawing.Color]::FromArgb(255,232,239)
$taskPen=[Drawing.Pen]::new([Drawing.Color]::FromArgb(98,67,79),5)
$taskFont=[Drawing.Font]::new('Microsoft YaHei',25,[Drawing.FontStyle]::Bold)
$taskFormat=[Drawing.StringFormat]::new();$taskFormat.Alignment='Center'
$taskLibrary=@()
foreach($taskItem in $taskItems) {
 $taskBmp=[Drawing.Bitmap]::new(360,340)
 $taskG=[Drawing.Graphics]::FromImage($taskBmp);$taskG.SmoothingMode='AntiAlias';$taskG.Clear([Drawing.Color]::FromArgb(255,248,250))
 $taskG.FillEllipse([Drawing.SolidBrush]::new($taskPink),25,20,310,270)
 $taskEars=[Drawing.Point[]]@([Drawing.Point]::new(82,125),[Drawing.Point]::new(84,50),[Drawing.Point]::new(140,87),[Drawing.Point]::new(220,87),[Drawing.Point]::new(276,50),[Drawing.Point]::new(278,125))
 $taskG.FillPolygon([Drawing.Brushes]::White,$taskEars);$taskG.DrawPolygon($taskPen,$taskEars)
 $taskG.FillEllipse([Drawing.Brushes]::White,65,75,230,180);$taskG.DrawEllipse($taskPen,65,75,230,180)
 $taskG.FillEllipse([Drawing.Brushes]::LightPink,90,167,38,20);$taskG.FillEllipse([Drawing.Brushes]::LightPink,232,167,38,20)
 if($taskItem[0] -in @('goodnight','speechless','angry')) { $taskG.DrawLine($taskPen,112,140,149,140);$taskG.DrawLine($taskPen,211,140,248,140) }
 else { $taskG.FillEllipse([Drawing.Brushes]::Black,125,126,15,26);$taskG.FillEllipse([Drawing.Brushes]::Black,220,126,15,26) }
 if($taskItem[0] -in @('sad','touched')) { $taskG.FillEllipse([Drawing.Brushes]::LightSkyBlue,127,154,12,38);$taskG.FillEllipse([Drawing.Brushes]::LightSkyBlue,223,154,12,38) }
 $taskG.FillEllipse([Drawing.Brushes]::LightPink,169,160,22,15)
 if($taskItem[0] -eq 'shock') { $taskG.DrawEllipse($taskPen,166,188,28,34) }
 elseif($taskItem[0] -eq 'sad') {$taskG.DrawArc($taskPen,158,198,44,25,185,170)}
 else {$taskG.DrawArc($taskPen,154,170,52,43,10,160)}
 $taskG.DrawLine($taskPen,63,170,37,163);$taskG.DrawLine($taskPen,65,187,35,193);$taskG.DrawLine($taskPen,297,170,323,163);$taskG.DrawLine($taskPen,295,187,325,193)
 if($taskItem[0] -in @('hug','comfort','clingy')) { $taskG.FillEllipse([Drawing.Brushes]::LightPink,140,220,80,42);$taskG.DrawEllipse($taskPen,140,220,80,42) }
 $taskG.DrawString($taskItem[1],$taskFont,[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(110,65,85)),[Drawing.RectangleF]::new(0,280,360,58),$taskFormat)
 $taskFile=Join-Path $taskDir ($taskItem[0]+'.png');$taskBmp.Save($taskFile,[Drawing.Imaging.ImageFormat]::Png);$taskG.Dispose();$taskBmp.Dispose()
 $taskLibrary+=@{id=$taskItem[0];file=($taskItem[0]+'.png');tags=@($taskItem[2].Split(','));description=$taskItem[3];audience=@($taskItem[4].Split(','));source='Original local procedural cat artwork, MIT; generated procedural artwork'}
}
[IO.File]::WriteAllText((Join-Path $taskDir 'library.json'),($taskLibrary|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$taskPen.Dispose();$taskFont.Dispose();$taskFormat.Dispose()
Write-Output 'Created 13 original local cat stickers and tagged catalog.'
