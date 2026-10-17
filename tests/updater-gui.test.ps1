# Exercise the real WinForms entry and states using a fake Figma installation and update service.
param([switch]$Windows10)
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
$temp = Join-Path ([IO.Path]::GetTempPath()) ('figboost-update-gui-' + [Guid]::NewGuid().ToString('N'))
$originalLocalAppData = $env:LOCALAPPDATA
$SelfTest = $true
$RuntimeDir = Join-Path $temp 'runtime'
$AppDir = Join-Path $temp 'app-1.2.3'
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir 'resources') | Out-Null
New-Item -ItemType File -Path (Join-Path $AppDir 'Figma.exe') | Out-Null
function Get-BaseDir { return $repo }
function Find-CurrentFigmaAppDir { return $AppDir }
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
      $entry = Get-ChildControl $main '检查 FigBoost 更新'
      Assert-Gui ($null -ne $entry) 'Update entry missing.'
      Assert-Gui ($entry.Right -le $main.ClientSize.Width) 'Update entry extends outside main window.'
      $main.Size = $main.MinimumSize
      $main.PerformLayout()
      $features = Get-ChildControl $main '管理附加功能'
      Assert-Gui ($entry.Left -ge $features.Right -and $entry.Right -le $main.ClientSize.Width) 'Minimum-size window overlaps or clips the update entry.'
      $textSize = [Windows.Forms.TextRenderer]::MeasureText($entry.Text, $entry.Font)
      Assert-Gui ($entry.Width -ge $textSize.Width) 'Minimum-size update label is clipped.'
      $script:phase = 1
      $entry.PerformClick()
    } elseif ($script:phase -eq 1 -and $dialog -and $script:requestCount -eq 1) {
      $client = Get-ChildControl $dialog '升级客户端'
      $payload = Get-ChildControl $dialog '更新词库'
      Assert-Gui (-not $client.Enabled -and -not $payload.Enabled) 'Current versions must not enable update actions.'
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
      Assert-Gui (-not (Get-ChildControl $dialog '升级客户端').Enabled) 'Failed check left stale upgrade enabled.'
      $script:phase = 3
      (Get-ChildControl $dialog '重新检查').PerformClick()
    } elseif ($script:phase -eq 3 -and $dialog -and $script:requestCount -eq 3) {
      Assert-Gui ((Get-ChildControl $dialog '升级客户端').Enabled) 'Retry did not enable available client upgrade.'
      Assert-Gui ((Get-ChildControl $dialog '更新词库').Enabled) 'Available compatible dictionary update disabled.'
      $script:phase = 4
      (Get-ChildControl $dialog '重新检查').PerformClick()
    } elseif ($script:phase -eq 4 -and $dialog -and $script:requestCount -eq 4) {
      Assert-Gui (-not (Get-ChildControl $dialog '更新词库').Enabled) 'Incompatible dictionary update was enabled.'
      $script:phase = 5
      Remove-Item -LiteralPath (Join-Path $RuntimeDir 'i.js') -Force
      (Get-ChildControl $dialog '重新检查').PerformClick()
    } elseif ($script:phase -eq 5 -and $dialog -and $script:requestCount -eq 5) {
      Assert-Gui (-not (Get-ChildControl $dialog '更新词库').Enabled) 'Dictionary update enabled without an installed patch.'
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
  $timer.Start()
  Show-Gui
  if ($script:failure) { throw $script:failure }
  Assert-Gui ($script:phase -eq 6) 'GUI checks did not complete.'
  Write-Host 'Updater GUI tests passed: entry, bounds, current version, offline error, retry, client update and payload update states.'
} finally {
  $timer.Dispose()
  $env:LOCALAPPDATA = $originalLocalAppData
  $resolved = [IO.Path]::GetFullPath($temp)
  if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup target.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}
