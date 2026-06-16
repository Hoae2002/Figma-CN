---
name: fullscreen-screenshot-verification
description: Use when Codex needs to verify a desktop UI, Figma Desktop/FigBoost behavior, Electron popup/menu placement, click targeting, or any visual regression where a full-screen screenshot is needed for evidence or coordinate positioning. Prefer this before declaring a UI element missing when prior cropped/window screenshots may have missed it.
---

# Fullscreen Screenshot Verification

## Core Rule

Capture the complete virtual desktop first. Do not rely on cropped window screenshots, titlebar-only screenshots, or fixed-height captures to prove whether a popup, menu, tooltip, or button is present.

Use cropped screenshots only as secondary evidence after a full-screen capture has been saved and inspected.

Never hard-code a 1080p capture size. On 2K, 4K, scaled, or multi-monitor desktops, use the actual virtual screen bounds. If the primary display is 2K, the screenshot must be 2K-sized unless the virtual desktop dimensions are larger because of multiple monitors.

On Windows, make the capture process DPI-aware before reading screen bounds. Without DPI awareness, a 2K display with 125%-175% scaling may be captured as scaled logical pixels instead of physical pixels.

## Windows Workflow

1. Bring the target window to the foreground and wait briefly for rendering.
2. Set the current PowerShell process to DPI-aware before reading bounds.
3. Capture `System.Windows.Forms.SystemInformation.VirtualScreen`, including `Left` and `Top`. This supports multi-monitor layouts and negative coordinates.
4. Save the PNG to an absolute path, normally under `$env:TEMP` or a repo-local verification folder.
5. Inspect the PNG with `view_image` before making a claim.
6. Use the full-screen image and the target window rect to calculate click coordinates. Redo the full-screen capture after each important click.
7. If the screenshot dimensions do not match the virtual screen dimensions, treat the capture as invalid and retake it.
8. If `VirtualScreen.Width` or `VirtualScreen.Height` is greater than 1920x1080, explicitly verify that the saved PNG uses those larger dimensions. Do not downscale it for inspection or evidence.

PowerShell pattern:

```powershell
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DpiAwareness {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@
[void][DpiAwareness]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$out = Join-Path $env:TEMP "ui-verification-fullscreen.png"
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
$bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
[pscustomobject]@{
  Path = $out
  Left = $bounds.Left
  Top = $bounds.Top
  Width = $bounds.Width
  Height = $bounds.Height
}
```

## Evidence Standard

For desktop UI verification, final handoff should state:

- the full-screen screenshot path;
- the captured width and height, especially on 2K or larger displays;
- what was visible or missing in that screenshot;
- the click coordinates used, if a click was part of the verification;
- any blocker that prevented a full-screen screenshot or real-client proof.

Do not mark visual verification complete from a partial screenshot when the task depends on screen position or popup visibility.
