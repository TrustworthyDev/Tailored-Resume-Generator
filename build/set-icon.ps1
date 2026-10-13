# Embed an .ico as an exe's main icon via the Win32 resource-update API.
# afterPack.js falls back to this when rcedit fails on the large Electron exe
# ("Unable to commit changes"). Replaces the exe's first icon group in place,
# keeping its id and language so Explorer and shortcuts pick it up.
param([Parameter(Mandatory)][string]$Exe, [Parameter(Mandatory)][string]$Ico)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public static class IconStamp {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string f, IntPtr h, uint flags);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool FreeLibrary(IntPtr h);
  delegate bool EnumNameProc(IntPtr mod, IntPtr type, IntPtr name, IntPtr p);
  delegate bool EnumLangProc(IntPtr mod, IntPtr type, IntPtr name, ushort lang, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EnumResourceNames(IntPtr mod, IntPtr type, EnumNameProc cb, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EnumResourceLanguages(IntPtr mod, IntPtr type, IntPtr name, EnumLangProc cb, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string f, bool del);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint cb);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr h, bool discard);

  static readonly IntPtr RT_ICON = (IntPtr)3, RT_GROUP_ICON = (IntPtr)14;

  public static string Stamp(string exe, string ico) {
    // Find the exe's first icon group (the one Explorer shows) and its language.
    IntPtr mod = LoadLibraryEx(exe, IntPtr.Zero, 0x2 | 0x20);
    if (mod == IntPtr.Zero) throw new Exception("LoadLibraryEx failed: " + Marshal.GetLastWin32Error());
    IntPtr group = IntPtr.Zero; ushort lang = 0; bool found = false;
    try {
      EnumResourceNames(mod, RT_GROUP_ICON, (m, t, n, p) => {
        if (((long)n >> 16) != 0) throw new Exception("icon group has a string name; not supported");
        group = n; return false;
      }, IntPtr.Zero);
      if (group == IntPtr.Zero) throw new Exception("no icon group found");
      EnumResourceLanguages(mod, RT_GROUP_ICON, group, (m, t, n, l, p) => { lang = l; found = true; return false; }, IntPtr.Zero);
    } finally { FreeLibrary(mod); }
    if (!found) throw new Exception("icon group language not found");

    // ICO -> one RT_ICON per image (ids 1..N) + a GRPICONDIR pointing at them.
    byte[] f = File.ReadAllBytes(ico);
    int count = BitConverter.ToUInt16(f, 4);
    var grp = new MemoryStream(); var w = new BinaryWriter(grp);
    w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)count);
    IntPtr h = BeginUpdateResource(exe, false);
    if (h == IntPtr.Zero) throw new Exception("BeginUpdateResource failed: " + Marshal.GetLastWin32Error());
    for (int i = 0; i < count; i++) {
      int o = 6 + i * 16;
      int size = BitConverter.ToInt32(f, o + 8), off = BitConverter.ToInt32(f, o + 12);
      byte[] img = new byte[size]; Array.Copy(f, off, img, 0, size);
      if (!UpdateResource(h, RT_ICON, (IntPtr)(i + 1), lang, img, (uint)size)) {
        EndUpdateResource(h, true); throw new Exception("UpdateResource(RT_ICON) failed: " + Marshal.GetLastWin32Error());
      }
      w.Write(f, o, 12);            // width, height, colors, reserved, planes, bitcount, bytes
      w.Write((ushort)(i + 1));     // resource id instead of file offset
    }
    byte[] g = grp.ToArray();
    if (!UpdateResource(h, RT_GROUP_ICON, group, lang, g, (uint)g.Length)) {
      EndUpdateResource(h, true); throw new Exception("UpdateResource(RT_GROUP_ICON) failed: " + Marshal.GetLastWin32Error());
    }
    if (!EndUpdateResource(h, false)) throw new Exception("EndUpdateResource failed: " + Marshal.GetLastWin32Error());
    return "group=" + (long)group + " lang=" + lang + " images=" + count;
  }
}
'@

[IconStamp]::Stamp((Resolve-Path $Exe).Path, (Resolve-Path $Ico).Path)
