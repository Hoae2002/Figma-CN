---
name: fullscreen-screenshot-verification
description: Use when Codex needs to verify a desktop UI, Figma Desktop/FigBoost behavior, Electron popup/menu placement, click targeting, or any visual regression where a full-screen screenshot is needed for evidence or coordinate positioning. Prefer this before declaring a UI element missing when prior cropped/window screenshots may have missed it.
---

# Fullscreen Screenshot Verification

## Core Rule

Capture the complete virtual desktop first. Do not rely on cropped window screenshots, titlebar-only screenshots, or fixed-height captures to prove whether a popup, menu, tooltip, or button is present.

Use cropped screenshots only as secondary evidence after a full-screen capture has been saved and inspected.

## Windows Workflow

1. Bring the target window to the foreground and wait briefly for rendering.
2. Capture `System.Windows.Forms.SystemInformation.VirtualScreen`, including `Left` and `Top`. This supports multi-monitor layouts and negative coordinates.
3. Save the PNG to an absolute path, normally under `$env:TEMP` or a repo-local verification folder.
4. Inspect the PNG with `view_image` before making a claim.
5. Use the full-screen image and the target window rect to calculate click coordinates. Redo the full-screen capture after each important click.
6. If the screenshot dimensions do not match the virtual screen dimensions, treat the capture as invalid and retake it.

PowerShell pattern:

```powershell
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
$out
```

## Evidence Standard

For desktop UI verification, final handoff should state:

- the full-screen screenshot path;
- what was visible or missing in that screenshot;
- the click coordinates used, if a click was part of the verification;
- any blocker that prevented a full-screen screenshot or real-client proof.

Do not mark visual verification complete from a partial screenshot when the task depends on screen position or popup visibility.
