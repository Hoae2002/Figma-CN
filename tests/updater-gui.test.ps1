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
function Invoke-UpdateWorker {
  param([scriptblock]$Action, [object[]]$Arguments)
  $script:requestCount++
  $activeDialog = [Windows.Forms.Application]::OpenForms | Where-Object { $_.Text -eq 'FigBoost 更新' } | Select-Object -First 1
  Assert-Gui (-not (Get-ChildControl $activeDialog '重新检查').Enabled) 'Repeated check not blocked during a request.'
  Assert-Gui (-not (Get-ChildControl $activeDialog '关闭').Enabled) 'Busy close action must be disabled.'
  $activeDialog.Close()
  Assert-Gui $activeDialog.Visible 'Closing while updating should be prevented.'
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
      $textSize = [Windows.Forms.TextRenderer]::MeasureText($control.Text, $control.Font)
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
    $main = $windows | Where-Object { $_.Text -eq "FigBoost v$PatcherVersion" } | Select-Object -First 1
    $dialog = $windows | Where-Object { $_.Text -eq 'FigBoost 更新' } | Select-Object -First 1
    if ($script:phase -eq 0 -and $main) {
      $entry = Get-ChildControl $main '更新 FigBoost 与词库'
      Assert-Gui ($null -ne $entry) 'Update entry missing.'
      Assert-Gui ($entry.Right -le $main.ClientSize.Width) 'Update entry extends outside main window.'
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
      $script:phase = 1
      $entry.PerformClick()
    } elseif ($script:phase -eq 1 -and $dialog -and $script:requestCount -eq 1) {
      $client = Get-ChildControl $dialog '更新软件'
      $payload = Get-ChildControl $dialog '更新词库'
      Assert-Gui (-not $client.Enabled -and -not $payload.Enabled) 'Current versions must not enable update actions.'
      Assert-Gui (-not $client.Visible -and -not $payload.Visible) 'Current versions must hide update actions.'
      Assert-Gui ($null -ne (Get-ChildControl $dialog '已是最新版本')) 'No-update result must match the hidden actions.'
      Assert-Gui ($dialog.Controls.Find('ClientUpdateVersion', $true)[0].Text -eq "v$PatcherVersion") 'Current software version must appear only once.'
      Assert-Gui ($dialog.Controls.Find('PayloadUpdateVersion', $true)[0].Text -eq ("v" + (Get-PayloadVersion))) 'Current dictionary version must appear only once.'
      Assert-Gui ($null -ne (Get-ChildControl $dialog '获取工具功能改进与问题修复') -and $null -ne (Get-ChildControl $dialog '补充中文翻译，改善界面汉化')) 'Update purposes are unclear.'
      Assert-HomeLayout $dialog
      foreach ($group in @($client.Parent, $payload.Parent)) {
        foreach ($child in $group.Controls) {
          Assert-Gui ($child.Right -le $group.ClientSize.Width -and $child.Bottom -le $group.ClientSize.Height) 'Update content is clipped.'
        }
      }
      Assert-Gui ((Get-ChildControl $dialog '关闭').Enabled) 'Close action unavailable.'
      $script:phase = 2
      (Get-ChildControl $dialog '重新检查').PerformClick()
    } elseif ($script:phase -eq 2 -and $dialog -and $script:requestCount -eq 2) {
      Assert-Gui ($null -ne (Get-ChildControl $dialog '检查失败，请确认网络后重新检查。')) 'Offline failure not shown.'
      Assert-Gui (-not (Get-ChildControl $dialog '更新软件').Enabled) 'Failed check left stale upgrade enabled.'
      Assert-Gui (-not (Get-ChildControl $dialog '更新软件').Visible -and -not (Get-ChildControl $dialog '更新词库').Visible) 'Failed check must hide update actions.'
      Assert-HomeLayout $dialog
      $script:phase = 3
      (Get-ChildControl $dialog '重新检查').PerformClick()
    } elseif ($script:phase -eq 3 -and $dialog -and $script:requestCount -eq 3) {
      Assert-Gui ((Get-ChildControl $dialog '更新软件').Enabled) 'Retry did not enable available client upgrade.'
      Assert-Gui ((Get-ChildControl $dialog '更新词库').Enabled) 'Available compatible dictionary update disabled.'
      Assert-Gui ((Get-ChildControl $dialog '更新软件').Visible -and (Get-ChildControl $dialog '更新词库').Visible) 'Available updates must show their actions.'
      Assert-Gui ($dialog.Controls.Find('ClientUpdateVersion', $true)[0].Text -eq "v$PatcherVersion → v999.0.0") 'Software upgrade path missing.'
      Assert-Gui ($dialog.Controls.Find('PayloadUpdateVersion', $true)[0].Text -eq ("v" + (Get-PayloadVersion) + " → v999.0.0")) 'Dictionary upgrade path missing.'
      Assert-Gui ($null -ne (Get-ChildControl $dialog '软件更新后重启 FigBoost；词库更新会重启 Figma，请先保存工作。')) 'Update consequences missing.'
      Assert-HomeLayout $dialog
      $script:phase = 4
      (Get-ChildControl $dialog '重新检查').PerformClick()
    } elseif ($script:phase -eq 4 -and $dialog -and $script:requestCount -eq 4) {
      Assert-Gui (-not (Get-ChildControl $dialog '更新词库').Enabled) 'Incompatible dictionary update was enabled.'
      Assert-Gui ($dialog.Controls.Find('PayloadUpdateVersion', $true)[0].Text.EndsWith('请先更新软件')) 'Incompatible dictionary lacks a next step.'
      Assert-HomeLayout $dialog
      $script:phase = 5
      Remove-Item -LiteralPath (Join-Path $RuntimeDir 'i.js') -Force
      (Get-ChildControl $dialog '重新检查').PerformClick()
    } elseif ($script:phase -eq 5 -and $dialog -and $script:requestCount -eq 5) {
      Assert-Gui (-not (Get-ChildControl $dialog '更新词库').Enabled) 'Dictionary update enabled without an installed patch.'
      Assert-Gui ($null -ne (Get-ChildControl $dialog '未安装汉化，请先在主页安装')) 'Missing installation lacks a next step.'
      $script:phase = 6
      (Get-ChildControl $dialog '关闭').PerformClick()
      $main.Close()
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
  Show-Gui
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
