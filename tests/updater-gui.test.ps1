# Exercise the real WinForms entry and states using a fake Figma installation and update service.
param([switch]$Windows10, [switch]$MissingClient)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'src\FigBoost.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Invalid installer syntax.' }
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [Management.Automation.Language.FunctionDefinitionAst]) { Invoke-Expression $statement.Extent.Text }
  if ($statement -is [Management.Automation.Language.AssignmentStatementAst] -and $statement.Left.Extent.Text -match '^\$(PatchMarker|UpdaterDisableMarker|PatcherVersion|PayloadFile|MainPayloadFile|FeatureConfigFile|BackupFile|LicenseCommentTarget|EmbeddedPayloadFiles|Utf8NoBom|UpdateRepository|UpdateCommitApi|script:UpdatedPayloadFiles)$') { Invoke-Expression $statement.Extent.Text }
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PathInputProbe {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, int message, IntPtr keys, IntPtr point);
}
'@
$temp = Join-Path ([IO.Path]::GetTempPath()) ('figboost-update-gui-' + [Guid]::NewGuid().ToString('N'))
$originalLocalAppData = $env:LOCALAPPDATA
$SelfTest = $true
$RuntimeDir = Join-Path $temp 'runtime'
$AppDir = Join-Path $temp 'app-1.2.3'
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir 'resources') | Out-Null
New-Item -ItemType File -Path (Join-Path $AppDir 'Figma.exe') | Out-Null
function Get-BaseDir { return $repo }
function Find-CurrentFigmaAppDir { if ($MissingClient) { throw 'Simulated missing Figma.' }; return $AppDir }
function Test-IsWindows11OrNewer { return (-not $Windows10) }
$script:requestCount = 0
$script:autoCheckCount = 0
$script:downloadCount = 0
$script:handoffCount = 0
function Invoke-PatcherSelfUpdate {
  param($Release, $TempExe, $SelectedRuntimeDir, $SelectedAppDir, $PayloadVersion)
  Assert-Gui ($Release.version -eq '999.0.0' -and $PayloadVersion -eq '999.0.0') 'Unified handoff lost release versions.'
  Assert-Gui ($SelectedRuntimeDir -eq $RuntimeDir -and $SelectedAppDir -eq $AppDir) 'Unified handoff lost selected paths.'
  Assert-Gui (Test-Path -LiteralPath $TempExe) 'Executable download missing.'
  Remove-Item -LiteralPath $TempExe -Force
  $script:handoffCount++
}
function Invoke-UpdateWorker {
  param([scriptblock]$Action, [object[]]$Arguments)
  $activeDialog = [Windows.Forms.Application]::OpenForms | Where-Object { $_.Text -eq 'FigBoost 更新' } | Select-Object -First 1
  if (-not $activeDialog) {
    $script:autoCheckCount++
    if ($Windows10) { throw 'Simulated automatic check offline.' }
    return [pscustomobject]@{ client = [pscustomobject]@{ version = '999.0.0' }; payload = [pscustomobject]@{ version = '999.0.0'; minPatcherVersion = $PatcherVersion } }
  }
  Assert-Gui (-not (Get-ChildControl $activeDialog '立即更新').Enabled) 'Repeated update not blocked during a request.'
  $activeDialog.Close()
  Assert-Gui $activeDialog.Visible 'Closing while updating should be prevented.'
  if ($Action.ToString().Contains('Save-VerifiedUpdateDownload')) {
    $script:downloadCount++
    Assert-Gui ($Arguments[1].EndsWith('.exe')) 'Unified update must download only the executable.'
    if ($script:downloadCount -eq 1) { throw 'Simulated download failure.' }
    [IO.File]::WriteAllText($Arguments[1], 'fixture')
    return
  }
  $script:requestCount++
  if ($script:requestCount -eq 2) { throw 'Simulated offline check.' }
  $clientVersion = if ($script:requestCount -ge 3) { '999.0.0' } else { $PatcherVersion }
  $payloadVersion = if ($script:requestCount -ge 3) { '999.0.0' } else { Get-PayloadVersion }
  $minimum = if ($script:requestCount -eq 4) { '9999.0.0' } else { $PatcherVersion }
  return [pscustomobject]@{ client = [pscustomobject]@{ version = $clientVersion }; payload = [pscustomobject]@{ version = $payloadVersion; minPatcherVersion = $minimum } }
}
function Get-ChildControl($Parent, [string]$Text) {
  foreach ($control in $Parent.Controls) {
    if ($control.Text -eq $Text) { return $control }
    $found = Get-ChildControl $control $Text
    if ($found) { return $found }
  }
  return $null
}
function Assert-Gui([bool]$Condition, [string]$Reason) { if (-not $Condition) { throw $Reason } }
function Get-AccessibleControl($Parent, [string]$Name) {
  foreach ($control in $Parent.Controls) {
    if ($control.AccessibleName -eq $Name) { return $control }
    $found = Get-AccessibleControl $control $Name
    if ($found) { return $found }
  }
}
function Assert-HomeLayout($Parent) {
  $visible = @($Parent.Controls | Where-Object { $_.Visible })
  foreach ($control in $visible) {
    Assert-Gui ($control.Left -ge 0 -and $control.Top -ge 0 -and $control.Right -le $Parent.ClientSize.Width -and $control.Bottom -le $Parent.ClientSize.Height) ("Control outside parent: " + $control.Text)
    if ($control -is [Windows.Forms.Button] -or $control -is [Windows.Forms.Label]) {
      $textSize = [Windows.Forms.TextRenderer]::MeasureText($control.Text, $control.Font, (New-Object Drawing.Size($control.Width, 0)), [Windows.Forms.TextFormatFlags]::WordBreak)
      Assert-Gui (($control.AutoEllipsis -or $control.Width -ge $textSize.Width) -and $control.Height -ge $textSize.Height) ("Home text clipped: " + $control.Text)
    }
    if ($control -is [Windows.Forms.Button] -and $control.Text -ne '安装或更新汉化') {
      Assert-Gui ([Math]::Abs($control.ForeColor.B - $control.ForeColor.R) -lt 50) ('Secondary action should use neutral text: ' + $control.Text)
      Assert-Gui ([Math]::Abs($control.BackColor.B - $control.BackColor.R) -lt 50) ('Secondary action should use a neutral fill: ' + $control.Text)
    }
    Assert-HomeLayout $control
  }
  for ($i = 0; $i -lt $visible.Count; $i++) {
    for ($j = $i + 1; $j -lt $visible.Count; $j++) {
      Assert-Gui (-not $visible[$i].Bounds.IntersectsWith($visible[$j].Bounds)) ("Home controls overlap: " + $visible[$i].Text + ' / ' + $visible[$j].Text)
    }
  }
  $install = Get-ChildControl $Parent '安装或更新汉化'
  if ($install) {
    Assert-Gui ($install.BackColor.ToArgb() -ne [Drawing.Color]::White.ToArgb() -and $install.ForeColor.ToArgb() -eq [Drawing.Color]::White.ToArgb()) 'Installation is not the primary action.'
    $features = Get-ChildControl $Parent '管理附加功能'
    Assert-Gui ($null -eq $features) 'Suspended feature manager remains visible.'
  }
}
$script:uiError = $null
function Show-InfoMessage { param([string]$Text, [string]$Title) }
function Show-ErrorMessage { param([string]$Text) $script:uiError = $Text }
# Never write real shortcuts when exercising the main-window install/migration actions.
function Start-Process { param([string]$FilePath) $script:openedUrl = $FilePath }
function Repair-FigmaShortcuts { param([string]$AppDir, [string[]]$ShortcutRoots) }
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 100
$script:phase = 0
$script:failure = $null
$script:started = [DateTime]::UtcNow
$timer.Add_Tick({
  try {
    if (([DateTime]::UtcNow - $script:started).TotalSeconds -gt 15) { throw 'GUI regression timed out.' }
    $windows = @([Windows.Forms.Application]::OpenForms)
    $mainTitle = "FigBoost v$PatcherVersion"
    $main = $windows | Where-Object { $_.Text -eq $mainTitle } | Select-Object -First 1
    $dialog = $windows | Where-Object { $_.Text -eq 'FigBoost 更新' } | Select-Object -First 1
    if ($script:reopenUpdate -and $main -and -not $dialog) {
      $script:reopenUpdate = $false
      $script:restartMain = $true
      $script:openNext = $true
      $main.Close()
      return
    }
    if ($script:openNext -and $main -and -not $dialog) {
      $script:openNext = $false
      $main.Controls.Find('UpdateIndicator', $true)[0].PerformClick()
      return
    }
    if ($dialog) {
      Assert-Gui (@($dialog.Controls | Where-Object { $_ -is [Windows.Forms.Button] }).Count -eq 1) 'Update dialog must contain only one action button.'
      Assert-Gui ($null -eq (Get-ChildControl $dialog '重新检查') -and $null -eq (Get-ChildControl $dialog '关闭')) 'Removed dialog actions remain.'
    }
    if ($script:phase -eq 0 -and $main -and $script:autoCheckCount -gt 0) {
      $entry = Get-ChildControl $main '检查更新'
      Assert-Gui ($null -eq $entry) 'Manual update button remains.'
      Assert-Gui ($script:autoCheckCount -eq 1) 'Startup must check once.'
      $indicator = $main.Controls.Find('UpdateIndicator', $true)[0]
      Assert-Gui ($indicator.Visible -eq (-not $Windows10)) 'Startup indicator does not match the automatic check.'
      Assert-Gui ($indicator.AccessibleName -eq '发现新版本，更新 FigBoost 与词库' -and $indicator.TabStop) 'Update indicator must have a keyboard-accessible name.'
      $github = $main.Controls.Find('ProjectGitHub', $true)[0]
      Assert-Gui ($github.Visible -and $github.TabStop -and $github.AccessibleName -eq 'GitHub 项目地址') 'GitHub entry missing or inaccessible.'
      Assert-Gui ($indicator.Width -eq 44 -and $indicator.Height -eq 44 -and $indicator.Right -lt $github.Left) 'Upgrade target is too small or overlaps GitHub.'
      $github.PerformClick()
      Assert-Gui ($script:openedUrl -eq 'https://github.com/Hoae2002/Figma-CN') 'GitHub link opens the wrong repository.'
      $script:phase = 10 # Prevent timer re-entry while actions process WinForms events.
      Assert-Gui (@($main.Controls | Where-Object { $_.Text -eq '选择目录' }).Count -eq 2) 'Directory buttons should not include an ellipsis.'
      Assert-HomeLayout $main
      $main.Size = New-Object Drawing.Size(($main.Width + 160), ($main.Height + 100))
      $main.PerformLayout()
      Assert-HomeLayout $main
      $main.Size = $main.MinimumSize
      $main.PerformLayout()
      Assert-HomeLayout $main
      Assert-Gui ($null -eq (Get-ChildControl $main '当前检测结果')) 'Redundant result group remains.'
      Assert-Gui ($null -eq (Get-ChildControl $main '官方最新版：未检查')) 'Unchecked official-version field remains.'
      $pathBox = Get-AccessibleControl $main 'Figma 客户端位置'
      $runtimeBox = Get-AccessibleControl $main '汉化文件存放位置'
      foreach ($box in @($pathBox, $runtimeBox)) {
        Assert-Gui ($box -is [Windows.Forms.Label] -and -not $box.CanSelect -and -not $box.TabStop) 'Paths must be display-only without text selection or keyboard focus.'
        Assert-Gui ($box.BackColor.ToArgb() -ne [Drawing.Color]::White.ToArgb() -and $box.BackColor.ToArgb() -eq $box.Parent.BackColor.ToArgb()) 'Read-only paths must have a consistent muted background.'
        [void](Get-ChildControl $main '重新检测').Focus()
        [void][PathInputProbe]::SendMessage($box.Handle, 0x0201, [IntPtr]1, [IntPtr]0x00080008)
        [void][PathInputProbe]::SendMessage($box.Handle, 0x0202, [IntPtr]0, [IntPtr]0x00080008)
        Assert-Gui (-not $box.Focused) 'Clicking a path must not move keyboard focus into its text.'
        Assert-Gui ($box.AutoEllipsis -and -not $box.UseMnemonic -and $box.Cursor -eq [Windows.Forms.Cursors]::Default) 'Long paths must remain readable without an input cursor or mnemonic processing.'
      }
      $pathAction = $main.Controls.Find('ApplyAppPath', $true)[0]
      $pathBox.Text = ''
      Assert-Gui (-not $pathAction.Enabled) 'Empty path allowed a save or migration action.'
      if ($MissingClient) {
        Assert-Gui ($null -ne (Get-ChildControl $main '未检测到 Figma')) ("Missing-client state is unclear: " + $script:ValueCurrentFigma.Text)
        Assert-Gui ($null -ne (Get-ChildControl $main '汉化：未检测')) 'Missing-client state reports an installed patch.'
        $script:phase = 6
        $main.Close()
        $timer.Stop()
        return
      }
      $pathBox.Text = Join-Path $temp 'migrated-client'
      Assert-Gui ($pathAction.Text -eq '迁移到此目录') 'New path hides migration behind a save label.'
      Assert-Gui ($null -ne (Get-ChildControl $main '迁移需要空目录：会关闭 Figma，将客户端复制到此处，并更新快捷方式。')) 'Migration consequence missing.'
      $pathAction.PerformClick()
      Assert-Gui (Test-FigmaAppDir $pathBox.Text) 'Migration action failed to copy the fake client.'
      Assert-Gui ($pathAction.Text -eq '保存路径') 'Migrated client still shows migration action.'
      $pathBox.Text = $AppDir
      Assert-Gui ($pathAction.Text -eq '保存路径') 'Existing client not identified as a save action.'
      $pathAction.PerformClick()
      Assert-Gui ((Get-PreferredAppDir $RuntimeDir) -eq $AppDir) 'Save path did not persist the chosen client.'
      (Get-ChildControl $main '重新检测').PerformClick()
      Assert-Gui ($script:requestCount -eq 0) 'Local detection unexpectedly checks online updates.'
      (Get-ChildControl $main '卸载汉化').PerformClick()
      Assert-Gui ($null -ne (Get-ChildControl $main '汉化：未安装')) 'Uninstall does not refresh the summary.'
      (Get-ChildControl $main '安装或更新汉化').PerformClick()
      Assert-Gui ($null -ne (Get-ChildControl $main '汉化：已安装')) 'Install does not refresh the summary.'
      Assert-Gui ($null -ne (Get-ChildControl $main ("已安装词库：v" + (Get-PayloadVersion)))) 'Installed dictionary version missing.'
      Assert-Gui ($null -eq $script:uiError) ("Home action failed: " + $script:uiError)
      Assert-HomeLayout $main
      if ($Windows10) {
        $script:phase = 6
        $main.Close()
        $timer.Stop()
        return
      }
      $script:phase = 1
      $indicator.PerformClick()
    } elseif ($script:phase -eq 1 -and $dialog -and $script:requestCount -eq 1) {
      Assert-Gui (-not (Get-ChildControl $dialog '立即更新').Visible) 'Current version must hide the update action.'
      Assert-Gui (-not $main.Controls.Find('UpdateIndicator', $true)[0].Visible) 'Current version must hide the indicator.'
      Assert-Gui ($null -eq (Get-ChildControl $dialog '更新软件') -and $null -eq (Get-ChildControl $dialog '更新词库')) 'Separate update actions remain.'
      Assert-Gui ($null -ne (Get-ChildControl $dialog '已是最新版本')) 'Current-version feedback missing.'
      Assert-Gui ($dialog.Controls.Find('ClientUpdateVersion', $true)[0].Text -eq "FigBoost：v$PatcherVersion") 'Current software version incorrect.'
      Assert-Gui ($dialog.Controls.Find('PayloadUpdateVersion', $true)[0].Text -eq ("内置词库：v" + (Get-PayloadVersion))) 'Bundled dictionary version incorrect.'
      Assert-HomeLayout $dialog
      $script:phase = 2
      $script:reopenUpdate = $true
      $dialog.Close()
    } elseif ($script:phase -eq 2 -and $dialog -and $script:requestCount -eq 2) {
      Assert-Gui ($null -ne (Get-ChildControl $dialog '检查失败，请确认网络后重新检查。')) 'Offline failure not shown.'
      Assert-Gui (-not (Get-ChildControl $dialog '立即更新').Enabled) 'Failed check left stale update enabled.'
      Assert-HomeLayout $dialog
      $script:phase = 3
      $script:reopenUpdate = $true
      $dialog.Close()
    } elseif ($script:phase -eq 3 -and $dialog -and $script:requestCount -eq 3) {
      Assert-Gui ((Get-ChildControl $dialog '立即更新').Enabled) 'Unified update is unavailable.'
      Assert-Gui $main.Controls.Find('UpdateIndicator', $true)[0].Visible 'Available release must show green indicator.'
      Assert-Gui ($dialog.Controls.Find('ClientUpdateVersion', $true)[0].Text -eq "FigBoost：v$PatcherVersion → v999.0.0") 'Software upgrade path missing.'
      Assert-Gui ($dialog.Controls.Find('PayloadUpdateVersion', $true)[0].Text -eq ("内置词库：v" + (Get-PayloadVersion) + " → v999.0.0")) 'Dictionary upgrade path missing.'
      Assert-Gui ($null -ne (Get-ChildControl $dialog '软件与汉化词库一起更新')) 'Combined update explanation missing.'
      Assert-HomeLayout $dialog
      Assert-HomeLayout $main
      $script:phase = 30
      (Get-ChildControl $dialog '立即更新').PerformClick()
    } elseif ($script:phase -eq 30 -and $dialog) {
      Assert-Gui ($null -ne (Get-ChildControl $dialog '更新失败，请重试。')) 'Download failure not shown.'
      Assert-Gui ((Get-ChildControl $dialog '立即更新').Enabled) 'Download failure cannot be retried.'
      $script:uiError = $null
      $script:phase = 4
      $script:reopenUpdate = $true
      $dialog.Close()
    } elseif ($script:phase -eq 4 -and $dialog -and $script:requestCount -eq 4) {
      Assert-Gui (-not (Get-ChildControl $dialog '立即更新').Enabled) 'Inconsistent release was enabled.'
      Assert-Gui (-not $main.Controls.Find('UpdateIndicator', $true)[0].Visible) 'Invalid release left a stale indicator.'
      Assert-HomeLayout $dialog
      $script:phase = 5
      Remove-Item -LiteralPath (Join-Path $RuntimeDir 'i.js') -Force
      $script:reopenUpdate = $true
      $dialog.Close()
    } elseif ($script:phase -eq 5 -and $dialog -and $script:requestCount -eq 5) {
      Assert-Gui ((Get-ChildControl $dialog '立即更新').Enabled) 'FigBoost update must work without installed localization.'
      $script:phase = 6
      (Get-ChildControl $dialog '立即更新').PerformClick()
      Assert-Gui ($script:handoffCount -eq 1 -and $script:downloadCount -eq 2) 'Unified update did not hand off exactly one executable after retry.'
      $timer.Stop()
    }
  } catch {
    $script:failure = $_
    $timer.Stop()
    foreach ($window in @([Windows.Forms.Application]::OpenForms)) { $window.Close() }
  }
})
try {
  $env:LOCALAPPDATA = Join-Path $temp 'user'
  New-FakeAsar (Join-Path $AppDir 'resources\app.asar')
  Install-Patch $AppDir $RuntimeDir -SkipProcessCheck -ShortcutRoots @($temp) | Out-Null
  if ($MissingClient) {
    $AppDir = ""
    function Get-PreferredAppDir { return "" }
  }
  $timer.Start()
  do { $script:restartMain = $false; Show-Gui } while ($script:restartMain -and -not $script:failure)
  if ($script:failure) { throw $script:failure }
  Assert-Gui ($script:phase -eq 6) 'GUI checks did not complete.'
  Write-Host 'GUI tests passed: home layout, path/save/migration, local detection, install/uninstall, missing-client and update states.'
} finally {
  $timer.Dispose()
  $env:LOCALAPPDATA = $originalLocalAppData
  $resolved = [IO.Path]::GetFullPath($temp)
  if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup target.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}
