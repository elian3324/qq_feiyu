using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Scoped execution requests and temporary AC display idle. Never change sleep/button settings.
public sealed class XiaojingScreenSession : NativeWindow, IDisposable
{
    [StructLayout(LayoutKind.Sequential)] struct DetailReason {
        public IntPtr Module; public uint Id, Count; public IntPtr Strings;
    }
    [StructLayout(LayoutKind.Explicit)] struct ReasonUnion {
        [FieldOffset(0)] public IntPtr Simple;
        [FieldOffset(0)] public DetailReason Detailed;
    }
    [StructLayout(LayoutKind.Sequential)] struct ReasonContext {
        public uint Version, Flags; public ReasonUnion Reason;
    }
    [StructLayout(LayoutKind.Sequential)] struct PowerStatus {
        public byte AC, Flags, Percent, Saver; public uint Life, FullLife;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr PowerCreateRequest(ref ReasonContext reason);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool PowerSetRequest(IntPtr handle, int kind);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool PowerClearRequest(IntPtr handle, int kind);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out PowerStatus status);
    [DllImport("powrprof.dll")] static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr scheme);
    [DllImport("powrprof.dll")] static extern uint PowerReadACValueIndex(IntPtr root, ref Guid scheme, ref Guid subgroup, ref Guid setting, out uint value);
    [DllImport("powrprof.dll")] static extern uint PowerWriteACValueIndex(IntPtr root, ref Guid scheme, ref Guid subgroup, ref Guid setting, uint value);
    [DllImport("powrprof.dll")] static extern uint PowerSetActiveScheme(IntPtr root, ref Guid scheme);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr RegisterPowerSettingNotification(IntPtr window, ref Guid setting, uint flags);
    [DllImport("user32.dll")] static extern bool UnregisterPowerSettingNotification(IntPtr handle);
    static readonly Guid DisplayGuid = new Guid("6fe69556-704a-47a0-8f24-c28d936fda47");
    IntPtr request, notification;
    bool systemSet, executionSet, disposed;
    public int DisplayState { get; private set; }
    public int DisplayOffEvents { get; private set; }
    public static bool PluggedIn {
        get { PowerStatus status; return GetSystemPowerStatus(out status) && status.AC == 1; }
    }
    public static string ActiveScheme {
        get {
            IntPtr pointer; uint error = PowerGetActiveScheme(IntPtr.Zero, out pointer);
            if (error != 0) throw new Win32Exception((int)error);
            try { return ((Guid)Marshal.PtrToStructure(pointer, typeof(Guid))).ToString(); }
            finally { LocalFree(pointer); }
        }
    }
    public static uint DisplaySeconds(string schemeId) {
        Guid scheme = new Guid(schemeId), subgroup = new Guid("7516b95f-f776-4464-8c53-06167f40cc99"), setting = new Guid("3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e");
        uint seconds; uint error = PowerReadACValueIndex(IntPtr.Zero, ref scheme, ref subgroup, ref setting, out seconds);
        if (error != 0) throw new Win32Exception((int)error); return seconds;
    }
    public static void SetDisplaySeconds(string schemeId, uint seconds) {
        Guid scheme = new Guid(schemeId), subgroup = new Guid("7516b95f-f776-4464-8c53-06167f40cc99"), setting = new Guid("3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e");
        uint error = PowerWriteACValueIndex(IntPtr.Zero, ref scheme, ref subgroup, ref setting, seconds);
        if (error != 0) throw new Win32Exception((int)error);
        if (new Guid(ActiveScheme) == scheme) {
            error = PowerSetActiveScheme(IntPtr.Zero, ref scheme);
            if (error != 0) throw new Win32Exception((int)error);
        }
    }
    public XiaojingScreenSession() {
        DisplayState = -1;
        IntPtr text = Marshal.StringToHGlobalUni("小助手 QQ 机器人：关屏期间保持后台运行和连接");
        try {
            ReasonContext reason = new ReasonContext(); reason.Version = 0; reason.Flags = 1; reason.Reason.Simple = text;
            request = PowerCreateRequest(ref reason);
            if (request == IntPtr.Zero || request == new IntPtr(-1)) throw new Win32Exception();
            if (!PowerSetRequest(request, 1)) throw new Win32Exception(); systemSet = true;
            if (!PowerSetRequest(request, 3)) throw new Win32Exception(); executionSet = true;
            CreateHandle(new CreateParams { Caption = "XiaojingScreenPowerObserver", Style = 0 });
            Guid guid = DisplayGuid;
            notification = RegisterPowerSettingNotification(Handle, ref guid, 0);
            if (notification == IntPtr.Zero) throw new Win32Exception();
        } catch { Dispose(); throw; }
        finally { Marshal.FreeHGlobal(text); }
    }
    protected override void WndProc(ref Message message) {
        if (message.Msg == 0x218 && message.WParam.ToInt32() == 0x8013 && message.LParam != IntPtr.Zero) {
            Guid guid = (Guid)Marshal.PtrToStructure(message.LParam, typeof(Guid));
            if (guid == DisplayGuid && Marshal.ReadInt32(message.LParam, 16) == 4) {
                DisplayState = Marshal.ReadInt32(message.LParam, 20);
                if (DisplayState == 0) DisplayOffEvents++;
            }
        }
        base.WndProc(ref message);
    }
    public void Pump() { Application.DoEvents(); }
    public void WakeDisplay() {
        // One zero-distance mouse motion wakes this PC; SC_MONITORPOWER(-1) did
        // not. This is only for ending/cancelling the mode, never a keepalive loop.
        if (DisplayState != 1) mouse_event(1, 0, 0, 0, UIntPtr.Zero);
    }
    public void Dispose() {
        if (disposed) return; disposed = true;
        if (notification != IntPtr.Zero) UnregisterPowerSettingNotification(notification);
        if (Handle != IntPtr.Zero) DestroyHandle();
        if (request != IntPtr.Zero && request != new IntPtr(-1)) {
            if (executionSet) PowerClearRequest(request, 3);
            if (systemSet) PowerClearRequest(request, 1);
            CloseHandle(request);
        }
    }
}
