# Exercise the shipped executable's new command mode against an isolated fake client.
# -SelfTest suppresses every real Figma process and shortcut operation.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'src\FigBoost.ps1'), [ref]$null, [ref]$null)
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [Management.Automation.Language.FunctionDefinitionAst]) { Invoke-Expression $statement.Extent.Text }
  if ($statement -is [Management.Automation.Language.AssignmentStatementAst] -and $statement.Left.Extent.Text -match '^\$(PatchMarker|UpdaterDisableMarker|OfficialUpdateTakeoverEnabled|PatcherVersion|PayloadFile|MainPayloadFile|FeatureConfigFile|BackupFile|LicenseCommentTarget|EmbeddedPayloadFiles|Utf8NoBom|script:UpdatedPayloadFiles)$') { Invoke-Expression $statement.Extent.Text }
}
function Get-BaseDir { return $repo }
function Assert-Bundle($Condition, $Message) { if (-not $Condition) { throw $Message } }
$exe = Join-Path $repo 'FigBoost.exe'
Assert-Bundle ((Get-Item $exe).VersionInfo.FileVersion -eq "$PatcherVersion.0") 'Build the current FigBoost.exe before running bundle tests.'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('figboost-bundle-' + [Guid]::NewGuid().ToString('N'))
$originalLocalAppData = $env:LOCALAPPDATA
$SelfTest = $true
try {
  $env:LOCALAPPDATA = Join-Path $temp 'user'
  $app = Join-Path $temp "client 中文 path's\app-1.2.3"
  $runtime = Join-Path $temp "runtime 中文 path's"
  New-Item -ItemType Directory -Path (Join-Path $app 'resources') -Force | Out-Null
  New-Item -ItemType File -Path (Join-Path $app 'Figma.exe') | Out-Null
  New-FakeAsar (Join-Path $app 'resources\app.asar')
  Install-Patch $app $runtime -SkipProcessCheck -ShortcutRoots @($temp) | Out-Null
  $version = Get-PayloadVersion
  $payloadPath = Join-Path $runtime 'i.js'
  $originalPayload = [IO.File]::ReadAllText($payloadPath)
  $originalFeatures = [IO.File]::ReadAllText((Get-FeatureConfigPath $runtime))
  $OfficialUpdateTakeoverEnabled = $true
  [void](Patch-Asar (Resolve-Target $app) $runtime)
  $OfficialUpdateTakeoverEnabled = $false
  $oldPayload = $originalPayload.Replace("const version = `"$version`";", 'const version = "0.0.1";')
  [IO.File]::WriteAllText($payloadPath, $oldPayload, $Utf8NoBom)
  function Run-Bundle($ExpectedVersion, $RuntimePath) {
    $arguments = '-SelfTest -ApplyBundledUpdate -ExpectedPayloadVersion ' + $ExpectedVersion + ' -AppDir "' + $app + '" -RuntimeDir "' + $RuntimePath + '"'
    $process = Start-Process -FilePath $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'Compiled bundle update timed out.' }
    return $process.ExitCode
  }
  Assert-Bundle ((Run-Bundle '999.0.0' $runtime) -ne 0) 'Compiled bundle accepted mismatched release metadata.'
  Assert-Bundle ([IO.File]::ReadAllText($payloadPath) -ceq $oldPayload) 'Rejected release changed installed files.'
  Assert-Bundle ((Run-Bundle $version $runtime) -eq 0) 'Compiled bundle application failed.'
  Assert-Bundle (-not (Get-PatchStatus (Resolve-Target $app) $runtime).HasBuiltInUpdaterDisabled) 'Compiled bundle did not restore the native updater.'
  Assert-Bundle ((Get-InstalledPayloadVersion $runtime) -eq $version) 'Compiled bundle did not apply the embedded dictionary.'
  Assert-Bundle ([IO.File]::ReadAllText($payloadPath) -ceq $originalPayload) 'Shipped renderer, including plugin sidebar, differs from source.'
  Assert-Bundle ([IO.File]::ReadAllText((Get-FeatureConfigPath $runtime)) -ceq $originalFeatures) 'Compiled update changed existing preferences.'
  Assert-Bundle ([IO.File]::ReadAllText((Join-Path $runtime 'zh-CN.js')) -ceq [IO.File]::ReadAllText((Join-Path $repo 'payload\src\dictionary\zh-CN.js'))) 'Shipped dictionary differs from source.'
  $emptyRuntime = Join-Path $temp 'uninstalled'
  Assert-Bundle ((Run-Bundle $version $emptyRuntime) -eq 0) 'FigBoost-only update failed without localization.'
  Assert-Bundle (-not (Test-Path $emptyRuntime)) 'Compiled updater installed localization without user action.'
  Write-Host 'Compiled bundled update passed: actual exe, embedded dictionary, version rejection, selected paths, settings preservation and uninstalled client.'
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  $resolved = [IO.Path]::GetFullPath($temp)
  if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup target.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}
