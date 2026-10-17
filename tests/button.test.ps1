# Isolated WinForms control tests; no real Figma or desktop input is used.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\src\ActionButton.cs'))) -ReferencedAssemblies System.Windows.Forms, System.Drawing
function Assert-Button([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Pump-Frames {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  while ($clock.ElapsedMilliseconds -lt 220) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 10 }
}
function Send-ControlEvent($Button, [string]$Name, $EventArgs) {
  $method = $Button.GetType().GetMethod($Name, [Reflection.BindingFlags]'Instance,NonPublic')
  [void]$method.Invoke($Button, @($EventArgs.PSObject.BaseObject))
}
function Read-State($Button, [string]$Name) { return [FigBoost.UI.ActionButton].GetField($Name, [Reflection.BindingFlags]'Instance,NonPublic').GetValue($Button) }
function Count-GreenPixels($Button) {
  $bitmap = New-Object Drawing.Bitmap($Button.Width, $Button.Height)
  try {
    $Button.DrawToBitmap($bitmap, $Button.ClientRectangle)
    $count = 0
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      for ($y = 0; $y -lt $bitmap.Height; $y++) {
        $pixel = $bitmap.GetPixel($x, $y)
        if ($pixel.G -gt 150 -and $pixel.R -lt 80 -and $pixel.B -lt 100) { $count++ }
      }
    }
    return $count
  } finally { $bitmap.Dispose() }
}
function Assert-CleanCorners($Button) {
  $bitmap = New-Object Drawing.Bitmap($Button.Width, $Button.Height)
  try {
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try { $graphics.Clear([Drawing.Color]::Black) } finally { $graphics.Dispose() }
    $Button.DrawToBitmap($bitmap, $Button.ClientRectangle)
    if (-not [Windows.Forms.SystemInformation]::HighContrast) {
      foreach ($left in @(0, ($Button.Width - 8))) {
        foreach ($top in @(0, ($Button.Height - 8))) {
          for ($x = $left; $x -lt $left + 8; $x++) {
            for ($y = $top; $y -lt $top + 8; $y++) {
              $pixel = $bitmap.GetPixel($x, $y)
              Assert-Button ([Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B)) -ge 160) 'Native dark corner strokes leaked into the rounded button.'
            }
          }
        }
      }
    }
  } finally { $bitmap.Dispose() }
}
$form = New-Object Windows.Forms.Form
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.Location = New-Object Drawing.Point(-32000, -32000)
$button = New-Object FigBoost.UI.ActionButton
$button.Text = 'Update'
$button.SetBounds(10, 10, 160, 40)
$button.Configure([Drawing.Color]::White, [Drawing.Color]::Black, [Drawing.Color]::LightGray)
$form.Controls.Add($button)
try {
  $form.Show()
  $timer = Read-State $button 'animation'
  Pump-Frames
  Assert-Button (-not $timer.Enabled) 'Idle button is running an animation timer.'
  $button.NotifyDefault($true)
  Assert-CleanCorners $button
  Send-ControlEvent $button 'OnMouseEnter' ([EventArgs]::Empty)
  Pump-Frames
  Assert-Button ((Read-State $button 'hoverAmount') -eq 1 -and -not $timer.Enabled) 'Hover did not settle or stop its timer.'
  Assert-CleanCorners $button
  $down = New-Object Windows.Forms.MouseEventArgs([Windows.Forms.MouseButtons]::Left, 1, 20, 20, 0)
  Send-ControlEvent $button 'OnMouseDown' $down
  Pump-Frames
  Assert-Button ((Read-State $button 'pressAmount') -eq 1) 'Pointer press has no feedback.'
  Assert-CleanCorners $button
  Send-ControlEvent $button 'OnMouseLeave' ([EventArgs]::Empty)
  Pump-Frames
  Assert-Button ((Read-State $button 'pressAmount') -eq 0) 'Dragging out retained the pressed appearance.'
  Send-ControlEvent $button 'OnMouseUp' $down
  $script:clicks = 0
  $button.Add_Click({ $script:clicks++ })
  $button.PerformClick()
  Assert-Button ($script:clicks -eq 1) 'Native click action was lost or duplicated.'
  Pump-Frames
  Assert-Button ((Read-State $button 'pressAmount') -eq 0 -and -not $timer.Enabled) 'Click did not release or stop its timer.'
  $key = New-Object Windows.Forms.KeyEventArgs([Windows.Forms.Keys]::Space)
  Send-ControlEvent $button 'OnKeyDown' $key
  Pump-Frames
  Assert-Button ((Read-State $button 'pressAmount') -eq 1) 'Space key has no press feedback.'
  Send-ControlEvent $button 'OnLostFocus' ([EventArgs]::Empty)
  Pump-Frames
  Assert-Button ((Read-State $button 'pressAmount') -eq 0) 'Focus loss retained a keyboard press.'
  Send-ControlEvent $button 'OnMouseEnter' ([EventArgs]::Empty)
  $button.Enabled = $false
  Assert-Button (-not $timer.Enabled) 'Disabled button retained an animation timer.'
  Assert-CleanCorners $button
  $button.PerformClick()
  Assert-Button ($script:clicks -eq 1) 'Disabled button executed an action.'
  $button.Enabled = $true
  Send-ControlEvent $button 'OnMouseDown' $down
  $button.Visible = $false
  Assert-Button (-not $timer.Enabled) 'Hidden button retained an animation timer.'
  $button.Visible = $true
  Pump-Frames
  Assert-Button ((Read-State $button 'pressAmount') -eq 0) 'Reopened button retained a pressed appearance.'
  $button.Configure([Drawing.Color]::FromArgb(37, 99, 235), [Drawing.Color]::White, [Drawing.Color]::Transparent)
  Assert-CleanCorners $button
  $indicator = New-Object FigBoost.UI.UpdateIndicatorButton
  $indicator.SetBounds(180, 10, 36, 36)
  $form.Controls.Add($indicator)
  $normalPixels = Count-GreenPixels $indicator
  Send-ControlEvent $indicator 'OnMouseEnter' ([EventArgs]::Empty)
  Pump-Frames
  $hoverPixels = Count-GreenPixels $indicator
  Send-ControlEvent $indicator 'OnMouseDown' $down
  Pump-Frames
  $pressedPixels = Count-GreenPixels $indicator
  if (-not [Windows.Forms.SystemInformation]::HighContrast) {
    Assert-Button ($hoverPixels -gt $normalPixels) 'Update arrow does not grow on hover.'
    Assert-Button ($pressedPixels -lt $hoverPixels) 'Update arrow does not shrink on press.'
  }
  Send-ControlEvent $indicator 'OnMouseLeave' ([EventArgs]::Empty)
  Pump-Frames
  Assert-Button ((Read-State $indicator 'pressAmount') -eq 0) 'Dragging out leaves update arrow pressed.'
  Send-ControlEvent $indicator 'OnMouseUp' $down
  Send-ControlEvent $indicator 'OnKeyDown' $key
  Pump-Frames
  Assert-Button ((Read-State $indicator 'pressAmount') -eq 1) 'Update arrow lacks keyboard press feedback.'
  Send-ControlEvent $indicator 'OnLostFocus' ([EventArgs]::Empty)
  Pump-Frames
  $script:indicatorClicks = 0
  $indicator.Add_Click({ $script:indicatorClicks++ })
  $indicator.PerformClick()
  $indicator.Enabled = $false
  $indicator.PerformClick()
  Assert-Button ($script:indicatorClicks -eq 1) 'Update arrow click is duplicated or ignores disabled state.'
  Assert-Button (-not (Read-State $indicator 'animation').Enabled) 'Disabled update arrow retains animation timer.'
  Write-Host 'Button tests passed: hover, press, drag cancellation, native clicks, keyboard focus, disabled/hidden state, idle timers and clean rounded corners.'
} finally { $form.Dispose() }
