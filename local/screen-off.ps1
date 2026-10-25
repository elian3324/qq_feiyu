$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QqBotPowerControl {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window,uint msg,IntPtr wparam,IntPtr lparam);
}
'@
Write-Host '保持此窗口以防自动睡眠；关闭窗口或按 Ctrl+C 解除。移动鼠标可亮屏。不会启动机器人。'
try{
    [QqBotPowerControl]::SetThreadExecutionState(2147483649)|Out-Null
    [QqBotPowerControl]::SendMessage([IntPtr]65535,274,[IntPtr]61808,[IntPtr]2)|Out-Null
    while($true){Start-Sleep -Seconds 5}
}finally{[QqBotPowerControl]::SetThreadExecutionState(2147483648)|Out-Null}
