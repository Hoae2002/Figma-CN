# Simulate official updates using the production updater and dialog; never touch Figma.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'src\FigBoost.ps1'), [ref]$null, [ref]$null)
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [Management.Automation.Language.FunctionDefinitionAst] -and $statement.Name -in @('Update-FigmaOfficial', 'Invoke-UpdateFigmaOfficialWithProgress', 'Compare-VersionString')) {
    # Keep failure acknowledgement deterministic without blocking on a native message box.
    $source = $statement.Extent.Text.Replace('[System.Windows.Forms.MessageBox]::Show($label.Text, "Figma 客户端更新", "OK", "Error")', '(Show-TestError $label.Text)')
    Invoke-Expression $source
  }
}
Add-Type -AssemblyName System.Windows.Forms
function Assert-Test([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Show-TestError($Message) { $script:errorShown = $Message }
function Resolve-ManagedFigmaAppDir { 'current' }
function Resolve-Target($Path) { [pscustomobject]@{ FigmaVersion = $(if ($Path -eq 'updated') { '2.0.0' } else { '1.0.0' }); AppDir = $Path } }
function Get-OfficialLatestFigmaRelease {
  Assert-Test ($ProgressPreference -eq 'SilentlyContinue') 'Release check must suppress host progress.'
  [pscustomobject]@{ Version = $(if ($script:mode -eq 'current') { '1.0.0' } else { '2.0.0' }); InstallerUrl = "https://example.invalid/setup.$script:fixtureId" }
}
function Assert-FigmaClosed { $true }
function Repair-FigmaShortcuts { }
function Select-UpdatedFigmaAppDir { 'updated' }
function Start-Sleep { }
function Invoke-WebRequest {
  param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec)
  Assert-Test ($ProgressPreference -eq 'SilentlyContinue') 'Installer download must suppress host progress.'
  $script:downloads++
  [IO.File]::WriteAllText($OutFile, 'fixture')
}
function Start-Process {
  param($FilePath, $ArgumentList, [switch]$PassThru)
  $process = [pscustomobject]@{ ExitCode = 0 }
  $process | Add-Member ScriptMethod WaitForExit { param($Timeout) return $true }
  $process
}
function Install-Patch {
  if ($script:mode -eq 'failure') { throw 'Simulated patch failure.' }
  $script:patchCompleted = $true
  [pscustomobject]@{ FigmaVersion = '2.0.0'; Patched = $true }
}
# Retained updater flows require explicit test opt-in.
$OfficialUpdateTakeoverEnabled = $false
$blocked = $false
try { Update-FigmaOfficial 'fixture' } catch { $blocked = $_.Exception.Message -like '*FigBoost*' }
Assert-Test $blocked 'Paused official updater must reject old command-line requests.'
$OfficialUpdateTakeoverEnabled = $true
$script:fixtureId = [Guid]::NewGuid().ToString('N')
$script:downloads = 0
$ProgressPreference = 'Continue'
foreach ($script:mode in @('current', 'upgrade', 'failure')) {
  $script:patchCompleted = $false; $script:errorShown = ''; $script:failureVisible = $false; $script:timedOut = $false
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $timer = New-Object Windows.Forms.Timer
  $timer.Interval = 50
  $timer.Add_Tick({
    $dialog = [Windows.Forms.Application]::OpenForms | Where-Object Text -eq 'Figma 客户端更新' | Select-Object -First 1
    if (-not $dialog) { return }
    if ($script:errorShown) {
      $close = $dialog.Controls | Where-Object { $_ -is [Windows.Forms.Button] } | Select-Object -First 1
      $script:failureVisible = $dialog.Visible -and $close.Enabled -and (@($dialog.Controls | Where-Object Text -like '更新失败：*').Count -eq 1)
      $dialog.Close()
    } elseif ($clock.ElapsedMilliseconds -gt 5000) {
      $script:timedOut = $true
      $dialog.Close()
    }
  })
  try {
    $timer.Start()
    Invoke-UpdateFigmaOfficialWithProgress 'fixture' -Force
    Assert-Test (-not $script:timedOut) "$script:mode dialog did not close automatically."
    Assert-Test ($ProgressPreference -eq 'Continue') 'Update progress preference leaked into its caller.'
    if ($script:mode -eq 'failure') {
      Assert-Test $script:failureVisible 'Failure must retain the visible dialog, error and enabled close button.'
    } else {
      Assert-Test $script:patchCompleted 'Dialog closed before patch installation completed.'
      Assert-Test (-not $script:errorShown) 'Successful update unexpectedly showed an error.'
    }
  } finally { $timer.Stop(); $timer.Dispose() }
}
Assert-Test ($script:downloads -eq 2) 'Upgrade download branch was not exercised.'
Write-Host 'Official update GUI passed: silent host progress, auto-close after success/current-version repair, failure remains visible.'
