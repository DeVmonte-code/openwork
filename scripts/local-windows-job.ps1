$ErrorActionPreference = "Stop"

$nativeCode = @'
using System;
using System.Runtime.InteropServices;

public static class LocalWindowsJobNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref ExtendedLimitInformation information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);

    public static string LastError(string operation)
    {
        return operation + " failed (Windows error " + Marshal.GetLastWin32Error() + ").";
    }
}
'@

try {
    Add-Type -TypeDefinition $nativeCode
    $job = [LocalWindowsJobNative]::CreateJobObject([IntPtr]::Zero, $null)
    if ($job -eq [IntPtr]::Zero) {
        throw [LocalWindowsJobNative]::LastError("CreateJobObject")
    }

    $limits = New-Object -TypeName 'LocalWindowsJobNative+ExtendedLimitInformation'
    $basicLimits = New-Object -TypeName 'LocalWindowsJobNative+BasicLimitInformation'
    $basicLimits.LimitFlags = 0x2000
    $limits.BasicLimitInformation = $basicLimits
    $size = [uint32][Runtime.InteropServices.Marshal]::SizeOf($limits)
    if (-not [LocalWindowsJobNative]::SetInformationJobObject($job, 9, [ref]$limits, $size)) {
        throw [LocalWindowsJobNative]::LastError("SetInformationJobObject")
    }

    [Console]::Out.WriteLine("READY")
    [Console]::Out.Flush()

    while ($null -ne ($line = [Console]::In.ReadLine())) {
        if ($line -eq "STOP") {
            break
        }
        if ($line -match '^ASSIGN ([0-9]+)$') {
            $processId = [uint32]$Matches[1]
            $process = [LocalWindowsJobNative]::OpenProcess(0x0101, $false, $processId)
            if ($process -eq [IntPtr]::Zero) {
                [Console]::Out.WriteLine("ERROR " + [LocalWindowsJobNative]::LastError("OpenProcess"))
                [Console]::Out.Flush()
                continue
            }
            try {
                if (-not [LocalWindowsJobNative]::AssignProcessToJobObject($job, $process)) {
                    [Console]::Out.WriteLine("ERROR " + [LocalWindowsJobNative]::LastError("AssignProcessToJobObject"))
                } else {
                    [Console]::Out.WriteLine("ASSIGNED")
                }
                [Console]::Out.Flush()
            } finally {
                [void][LocalWindowsJobNative]::CloseHandle($process)
            }
            continue
        }
        [Console]::Out.WriteLine("ERROR Invalid guardian command.")
        [Console]::Out.Flush()
    }
} catch {
    [Console]::Out.WriteLine("ERROR " + $_.Exception.Message)
    [Console]::Out.Flush()
    exit 1
} finally {
    if ($job -and $job -ne [IntPtr]::Zero) {
        [void][LocalWindowsJobNative]::CloseHandle($job)
    }
}