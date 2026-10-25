$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CompanionPowerRequest {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@
try {
    # ES_CONTINUOUS | ES_SYSTEM_REQUIRED. Display sleep remains enabled.
    if([CompanionPowerRequest]::SetThreadExecutionState([uint32]2147483649) -eq 0){throw 'Power request failed'}
    [Console]::WriteLine('ready')
    # Closing the supervisor's stdin pipe releases the request, including on a crash.
    while($null -ne [Console]::ReadLine()){}
} finally {
    [void][CompanionPowerRequest]::SetThreadExecutionState([uint32]2147483648)
}
