# Update tests use a fake app and isolated user directory; never touch the real Figma client.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'src\FigBoost.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Invalid installer syntax.' }
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [Management.Automation.Language.FunctionDefinitionAst]) { Invoke-Expression $statement.Extent.Text }
  if ($statement -is [Management.Automation.Language.AssignmentStatementAst] -and $statement.Left.Extent.Text -match '^\$(PatchMarker|UpdaterDisableMarker|OfficialUpdateTakeoverEnabled|PatcherVersion|PayloadFile|MainPayloadFile|FeatureConfigFile|BackupFile|LicenseCommentTarget|EmbeddedPayloadFiles|Utf8NoBom|UpdateRepository|UpdateCommitApi|script:UpdatedPayloadFiles)$') { Invoke-Expression $statement.Extent.Text }
}
function Get-BaseDir { return $repo }
function Assert-Equal($Actual, $Expected, $Message) { if ($Actual -cne $Expected) { throw "$Message (actual=$Actual expected=$Expected)" } }
function Assert-Throws([scriptblock]$Action, [string]$Message) {
  $thrown = $false
  try { & $Action | Out-Null } catch { $thrown = $true }
  if (-not $thrown) { throw $Message }
}
function Copy-Object($Value) { return ($Value | ConvertTo-Json -Depth 8 -Compress | ConvertFrom-Json) }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('figboost-updater-test-' + [Guid]::NewGuid().ToString('N'))
$originalLocalAppData = $env:LOCALAPPDATA
$SelfTest = $true
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $env:LOCALAPPDATA = Join-Path $temp 'user'
  $files = [ordered]@{}
  $build = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'scripts\build.ps1'), [ref]$tokens, [ref]$errors)
  $paths = $build.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -eq '$payloadFiles' }
  Invoke-Expression $paths.Extent.Text
  foreach ($path in $payloadFiles) { $files[$path] = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $repo $path))) }
  $currentVersion = [version](Get-PayloadVersion)
  $nextVersion = "$($currentVersion.Major).$($currentVersion.Minor).$($currentVersion.Build + 1)"
  $manifest = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($files['payload\manifest.json'])) | ConvertFrom-Json
  $manifest.version = $nextVersion
  $files['payload\manifest.json'] = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($manifest | ConvertTo-Json -Depth 8)))
  $package = [pscustomobject]@{ schema = 1; version = $nextVersion; minPatcherVersion = $PatcherVersion; files = [pscustomobject]$files }
  $packageBytes = [Text.Encoding]::UTF8.GetBytes(($package | ConvertTo-Json -Depth 6 -Compress))
  $descriptor = [pscustomobject]@{ version = $nextVersion; minPatcherVersion = $PatcherVersion; size = $packageBytes.Length; sha256 = (Get-Sha256Hex $packageBytes) }
  $script:metadata = [pscustomobject]@{ schema = 1; client = (Copy-Object $descriptor); payload = (Copy-Object $descriptor) }
  $script:commitSha = 'a' * 40
  $script:requests = @()
  function Invoke-RestMethod {
    param($Uri, $Headers, [switch]$UseBasicParsing, $TimeoutSec)
    $script:requests += $Uri
    if ($Uri -eq $UpdateCommitApi) { return [pscustomobject]@{ sha = $script:commitSha } }
    if ($Uri -eq "$UpdateRepository/$script:commitSha/updates/latest.json") { return (Copy-Object $script:metadata) }
    throw "Unexpected update endpoint: $Uri"
  }
  function Invoke-WebRequest {
    param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec)
    [IO.File]::WriteAllBytes($OutFile, $script:packageBytes)
  }
  $script:packageBytes = $packageBytes
  Add-Type -AssemblyName System.Windows.Forms
  $workerResult = @(Invoke-UpdateWorker { param($left, $right) "$left|$right" } @('first', 'second'))[-1]
  Assert-Equal $workerResult 'first|second' 'Background update task lost parameters.'
  $info = Get-LatestFigBoostUpdate
  Assert-Equal $info.payload.DownloadUrl "$UpdateRepository/$script:commitSha/updates/payload.json" 'Payload download must be commit-pinned.'
  Assert-Equal $info.client.DownloadUrl "$UpdateRepository/$script:commitSha/FigBoost.exe" 'Client download must be commit-pinned.'
  $script:commitSha = 'invalid'
  Assert-Throws { Get-LatestFigBoostUpdate } 'Invalid commit hash accepted.'
  $script:commitSha = 'a' * 40
  $script:metadata.payload.sha256 = ''
  Assert-Throws { Get-LatestFigBoostUpdate } 'Missing download hash accepted.'
  $script:metadata.payload = Copy-Object $descriptor
  $download = Join-Path $temp 'download.json'
  Save-VerifiedUpdateDownload $info.payload $download
  Assert-Equal (Get-Sha256Hex ([IO.File]::ReadAllBytes($download))) $info.payload.sha256 'Downloaded payload differs.'
  $bad = Copy-Object $info.payload
  $bad.sha256 = '0' * 64
  Assert-Throws { Save-VerifiedUpdateDownload $bad $download } 'Corrupt payload accepted.'
  Assert-Equal (Test-Path -LiteralPath $download) $false 'Failed download must be removed.'
  $bad.DownloadUrl = 'https://example.com/untrusted.exe'
  Assert-Throws { Save-VerifiedUpdateDownload $bad $download } 'Untrusted download URL accepted.'
  $bad = Copy-Object $package
  $bad.minPatcherVersion = '9999.0.0'
  Assert-Throws { ConvertFrom-PayloadUpdate $bad } 'Incompatible payload accepted.'
  $bad = Copy-Object $package
  $bad.files.PSObject.Properties.Remove('payload\src\content\content.js')
  Assert-Throws { ConvertFrom-PayloadUpdate $bad } 'Incomplete payload accepted.'
  $bad.files | Add-Member -NotePropertyName '..\escape.js' -NotePropertyValue 'YQ=='
  Assert-Throws { ConvertFrom-PayloadUpdate $bad } 'Unexpected file path accepted.'
  $bad = Copy-Object $package
  $bad.version = '1.2.0'
  Assert-Throws { ConvertFrom-PayloadUpdate $bad } 'Mismatched manifest version accepted.'
  $bad = Copy-Object $package
  $bad.files.'payload\manifest.json' = '!invalidbase64!'
  Assert-Throws { ConvertFrom-PayloadUpdate $bad } 'Invalid base64 accepted.'

  $app = Join-Path $temp 'app-1.2.3'
  $runtime = Join-Path $temp 'runtime'
  New-Item -ItemType Directory -Path (Join-Path $app 'resources') | Out-Null
  New-Item -ItemType File -Path (Join-Path $app 'Figma.exe') | Out-Null
  New-FakeAsar (Join-Path $app 'resources\app.asar')
  Install-Patch $app $runtime -SkipProcessCheck -ShortcutRoots @($temp) | Out-Null
  Write-FeatureConfig $runtime @('bulk-export-files') | Out-Null
  Set-PreferredAppDir $runtime $app | Out-Null
  $featurePath = Get-FeatureConfigPath $runtime
  $originalFeatures = [IO.File]::ReadAllText($featurePath)
  $personal = Join-Path $env:LOCALAPPDATA 'FigBoost\translation\cache.json'
  New-Item -ItemType Directory -Path (Split-Path -Parent $personal) -Force | Out-Null
  [IO.File]::WriteAllText($personal, '{"personal":"preserve"}')
  $originalAsar = Get-Sha256Hex ([IO.File]::ReadAllBytes((Join-Path $app 'resources\app.asar')))
  $installed = Install-PayloadUpdate $package $app $runtime
  Assert-Equal $installed.PayloadVersion $nextVersion 'Updated installed version is incorrect.'
  Assert-Equal (Get-InstalledPayloadVersion $runtime) $nextVersion 'Runtime must embed the new version.'
  Assert-Equal ([IO.File]::ReadAllText($featurePath)) $originalFeatures 'Feature config or saved paths changed.'
  Assert-Equal ([IO.File]::ReadAllText($personal)) '{"personal":"preserve"}' 'Personal cache changed.'
  Assert-Equal (Get-Sha256Hex ([IO.File]::ReadAllBytes((Join-Path $app 'resources\app.asar')))) $originalAsar 'Dictionary update must preserve app.asar.'
  $cache = Get-PayloadUpdateCachePath
  $cachedText = [IO.File]::ReadAllText($cache)
  $script:UpdatedPayloadFiles = @{}
  $EmbeddedPayloadFiles = @{} + $files
  $EmbeddedPayloadFiles['payload\manifest.json'] = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $repo 'payload\manifest.json')))
  Initialize-PayloadUpdate
  Assert-Equal (Get-PayloadVersion) $nextVersion 'Cached update did not survive a restart.'
  Install-Patch $app $runtime -SkipProcessCheck -ShortcutRoots @($temp) | Out-Null
  Assert-Equal (Get-InstalledPayloadVersion $runtime) $nextVersion 'Reinstall downgraded updated payload.'
  $script:UpdatedPayloadFiles = @{}
  $EmbeddedPayloadFiles['payload\manifest.json'] = $files['payload\manifest.json']
  Initialize-PayloadUpdate
  Assert-Equal $script:UpdatedPayloadFiles.Count 0 'Equal embedded version must supersede cache.'
  $EmbeddedPayloadFiles = @{}
  $before = [IO.File]::ReadAllText((Join-Path $runtime 'i.js'))
  $OfficialUpdateTakeoverEnabled = $true
  [void](Patch-Asar (Resolve-Target $app) $runtime)
  $OfficialUpdateTakeoverEnabled = $false
  $legacyAsarHash = Get-Sha256Hex ([IO.File]::ReadAllBytes((Join-Path $app 'resources\app.asar')))
  # Lock the cache so the final atomic replacement fails after runtime writing.
  $lock = [IO.File]::Open($cache, 'Open', 'Read', 'Read')
  try { Assert-Throws { Install-PayloadUpdate $package $app $runtime } 'Locked cache update did not fail.' }
  finally { $lock.Dispose() }
  Assert-Equal ([IO.File]::ReadAllText((Join-Path $runtime 'i.js'))) $before 'Failed update did not restore old runtime.'
  Assert-Equal ([IO.File]::ReadAllText($cache)) $cachedText 'Failed update replaced cached package.'
  Assert-Equal $script:UpdatedPayloadFiles.Count 0 'Failed update did not restore active payload.'
  Assert-Equal (Get-Sha256Hex ([IO.File]::ReadAllBytes((Join-Path $app 'resources\app.asar')))) $legacyAsarHash 'Failed migration must restore the previous ASAR.'
  $migrated = Install-PayloadUpdate $package $app $runtime
  Assert-Equal $migrated.HasBuiltInUpdaterDisabled $false 'Bundled payload update must restore the native updater.'
  $script:UpdatedPayloadFiles = @{}

  $nextPackage = Copy-Object $package
  $nextPackage.version = "$($currentVersion.Major).$($currentVersion.Minor).$($currentVersion.Build + 2)"
  $manifest.version = $nextPackage.version
  $nextPackage.files.'payload\manifest.json' = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($manifest | ConvertTo-Json -Depth 8)))
  $dictionaryPath = Join-Path $runtime 'zh-CN.js'
  $oldDictionary = [IO.File]::ReadAllText($dictionaryPath)
  $nextPackage.files.'payload\src\dictionary\zh-CN.js' = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($oldDictionary + "`n// Updated dictionary fixture"))
  $lock = [IO.File]::Open((Join-Path $runtime 'i.js'), 'Open', 'Read', 'Read')
  try { Assert-Throws { Install-PayloadUpdate $nextPackage $app $runtime } 'Locked runtime update did not fail.' }
  finally { $lock.Dispose() }
  Assert-Equal ([IO.File]::ReadAllText($dictionaryPath)) $oldDictionary 'Partial runtime write did not restore the original dictionary.'
  Assert-Equal ([IO.File]::ReadAllText($cache)) $cachedText 'Partial runtime write changed the cache.'

  # Dictionary-only upgrades of older installs also initialize manual update paths.
  Remove-Item -LiteralPath $featurePath -Force
  Install-PayloadUpdate $package $app $runtime | Out-Null
  $manualConfig = Read-FeatureConfig $runtime
  Assert-Equal ([string]$manualConfig.patcherPath) (ConvertTo-JsonSafePath (Get-PatcherExecutablePath)) 'Dictionary update did not configure the native updater.'
  Assert-Equal @($manualConfig.enabledFeatures).Count 0 'Dictionary update enabled suspended features.'
  Remove-Item -LiteralPath $featurePath -Force
  $lock = [IO.File]::Open($cache, 'Open', 'Read', 'Read')
  try { Assert-Throws { Install-PayloadUpdate $package $app $runtime } 'Locked cache update did not fail without feature config.' }
  finally { $lock.Dispose() }
  Assert-Equal (Test-Path -LiteralPath $featurePath) $false 'Failed update did not roll back newly created feature config.'

  # Execute the real post-exit replacement helper against a tiny fake executable.
  $helperDir = Join-Path $temp "client with space's"
  New-Item -ItemType Directory -Path $helperDir | Out-Null
  $fakeClient = Join-Path $helperDir 'FigBoost.exe'
  $newClient = Join-Path $helperDir 'new.exe'
  Add-Type -TypeDefinition 'using System; using System.IO; public class UpdateFixture { public static void Main(string[] args) { var apply = Array.IndexOf(args, "-ApplyBundledUpdate") >= 0; File.WriteAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, apply ? "applied.txt" : "launched.txt"), args); if (apply && File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fail-apply"))) Environment.Exit(1); } }' -OutputAssembly $newClient -OutputType WindowsApplication
  [IO.File]::WriteAllText($fakeClient, 'old-client')
  $newHash = (Get-FileHash -LiteralPath $newClient).Hash
  $helperText = New-PatcherUpdateScript $fakeClient $newClient 2147483647 "C:\cache path's\" "C:\Figma path's\app-1.2.3" $nextVersion
  $helperPath = Join-Path $helperDir 'replace.ps1'
  [IO.File]::WriteAllText($helperPath, $helperText, (New-Object Text.UTF8Encoding($true)))
  $helper = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $helperPath + '"')) -WindowStyle Hidden -PassThru
  if (-not $helper.WaitForExit(10000)) { $helper.Kill(); throw 'Update helper timed out.' }
  Assert-Equal (Get-FileHash -LiteralPath $fakeClient).Hash $newHash 'Client helper did not replace the executable.'
  $launchPath = Join-Path $helperDir 'launched.txt'
  for ($i = 0; $i -lt 30 -and -not (Test-Path -LiteralPath $launchPath); $i++) { Start-Sleep -Milliseconds 100 }
  $launchArgs = [IO.File]::ReadAllLines($launchPath)
  Assert-Equal ($launchArgs -join '|') "-RuntimeDir|C:\cache path's\|-AppDir|C:\Figma path's\app-1.2.3" 'Client upgrade lost or misquoted paths.'
  $applyArgs = [IO.File]::ReadAllLines((Join-Path $helperDir 'applied.txt'))
  Assert-Equal ($applyArgs -join '|') "-RuntimeDir|C:\cache path's\|-AppDir|C:\Figma path's\app-1.2.3|-ApplyBundledUpdate|-ExpectedPayloadVersion|$nextVersion" 'Unified helper failed to apply the bundled payload before relaunch.'
  Assert-Equal (Test-Path -LiteralPath $newClient) $false 'Client helper left a downloaded executable.'

  Copy-Item -LiteralPath $fakeClient -Destination $newClient
  [IO.File]::WriteAllText($fakeClient, 'old-client')
  [IO.File]::WriteAllText((Join-Path $helperDir 'fail-apply'), '')
  Remove-Item -LiteralPath $launchPath -Force
  # Suppress only the failure message box; execute the actual rollback helper.
  $failureReport = Join-Path $helperDir 'failed.txt'
  $failureHelper = $helperText -replace '(?m)^.*\[Windows.Forms.MessageBox\]::Show.*$', ("[IO.File]::WriteAllText('" + $failureReport.Replace("'", "''") + "', 'failed')")
  [IO.File]::WriteAllText($helperPath, $failureHelper, (New-Object Text.UTF8Encoding($true)))
  $helper = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $helperPath + '"')) -WindowStyle Hidden -PassThru
  if (-not $helper.WaitForExit(10000)) { $helper.Kill(); throw 'Rollback helper timed out.' }
  Assert-Equal ([IO.File]::ReadAllText($fakeClient)) 'old-client' 'Bundle application failure did not restore the old executable.'
  Assert-Equal (Test-Path -LiteralPath $failureReport) $true 'Bundle failure was not reported.'
  Assert-Equal (Test-Path -LiteralPath $launchPath) $false 'Failed bundle was relaunched as a successful update.'

  # The bundled route ignores an old cache, validates the expected version, and
  # updates only existing localization using the same rollback-protected writer.
  $EmbeddedPayloadFiles = @{} + $files
  $script:UpdatedPayloadFiles = @{}
  Assert-Throws { Install-BundledUpdate $app $runtime '999.0.0' } 'Wrong embedded release was accepted.'
  Install-BundledUpdate $app $runtime $nextVersion
  Assert-Equal (Get-InstalledPayloadVersion $runtime) $nextVersion 'Bundled update was not installed.'
  Assert-Equal ([IO.File]::ReadAllText($personal)) '{"personal":"preserve"}' 'Bundled update changed personal data.'
  $emptyRuntime = Join-Path $temp 'unpatched-runtime'
  Install-BundledUpdate '' $emptyRuntime $nextVersion
  Assert-Equal (Test-Path -LiteralPath $emptyRuntime) $false 'Updating FigBoost installed localization without consent.'
  $lock = [IO.File]::Open($cache, 'Open', 'Read', 'Read')
  try { Assert-Throws { Install-BundledUpdate $app $runtime $nextVersion } 'Bundled write failure was swallowed.' }
  finally { $lock.Dispose() }
  Assert-Equal (Get-InstalledPayloadVersion $runtime) $nextVersion 'Failed bundle application changed runtime.'

  $release = [pscustomobject]@{ client = [pscustomobject]@{ version = $PatcherVersion }; payload = [pscustomobject]@{ version = $nextVersion; minPatcherVersion = $PatcherVersion } }
  Assert-Equal (Test-FigBoostUpdateAvailable $release) $false 'Same bundle reports an update.'
  $release.payload.version = $nextPackage.version
  Assert-Equal (Test-FigBoostUpdateAvailable $release) $true 'Dictionary-only release should still trigger a combined update.'
  $release.client.version = '0.0.1'
  Assert-Equal (Test-FigBoostUpdateAvailable $release) $false 'Combined update allowed a client downgrade.'
  $release.client.version = '999.0.0'
  $release.payload.minPatcherVersion = '998.0.0'
  Assert-Equal (Test-FigBoostUpdateAvailable $release) $true 'New client must satisfy new dictionary compatibility.'
  Write-Host 'Updater tests passed: pinned downloads, checksums, compatibility, apply, restart cache, rollback, config preservation, and real replacement helper.'
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  $resolved = [IO.Path]::GetFullPath($temp)
  if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup target.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}
