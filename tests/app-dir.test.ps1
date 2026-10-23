# Exercise official-update path selection in an isolated installation tree.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'src\FigBoost.ps1'), [ref]$null, [ref]$null)
$functions = @('Get-SemverParts', 'Compare-VersionString', 'Test-FigmaAppDir', 'Test-OfficialFigmaAppDir', 'Get-FigmaVersionFromAppDir', 'Find-LatestFigmaAppDir', 'Get-FeatureConfigPath', 'Read-FeatureConfig', 'Get-PreferredAppDir', 'Resolve-ManagedFigmaAppDir')
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [Management.Automation.Language.FunctionDefinitionAst] -and $statement.Name -in $functions) {
    Invoke-Expression $statement.Extent.Text
  }
}
function Assert-Path($Expected, $Actual, $Message) {
  if ($Expected -ne $Actual) { throw "$Message Expected: $Expected; actual: $Actual" }
}
function Find-CurrentFigmaAppDir { return $script:detectedAppDir }
$FeatureConfigFile = 'features.json'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('FigBoost-path-' + [guid]::NewGuid().ToString('N'))
$originalLocalAppData = $env:LOCALAPPDATA
try {
  $env:LOCALAPPDATA = $fixture
  $runtime = Join-Path $fixture 'runtime'
  $older = Join-Path $fixture 'Figma\app-126.10.10'
  $newer = Join-Path $fixture 'Figma\app-126.10.11'
  $incomplete = Join-Path $fixture 'Figma\app-126.10.12'
  $custom = Join-Path $fixture 'custom\app-126.10.9'
  foreach ($path in @($older, $newer, $custom)) {
    New-Item -ItemType Directory -Path (Join-Path $path 'resources') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $path 'Figma.exe') | Out-Null
    New-Item -ItemType File -Path (Join-Path $path 'resources\app.asar') | Out-Null
  }
  New-Item -ItemType Directory -Path $runtime, $incomplete -Force | Out-Null
  New-Item -ItemType File -Path (Join-Path $incomplete 'Figma.exe') | Out-Null
  $configPath = Join-Path $runtime $FeatureConfigFile
  function Save-TestPreference($Path) {
    @{ preferredAppDir = $Path; enabledFeatures = @('auto-check-official-latest') } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
  }
  Save-TestPreference $older
  $before = [IO.File]::ReadAllText($configPath)
  $script:detectedAppDir = $newer
  Assert-Path $newer (Resolve-ManagedFigmaAppDir $runtime $older) 'Saved official path must follow an installed update.'
  $script:detectedAppDir = $older
  Assert-Path $newer (Resolve-ManagedFigmaAppDir $runtime $older) 'Old process or shortcut must not pin the saved version.'
  Assert-Path $before ([IO.File]::ReadAllText($configPath)) 'Detection must not rewrite user settings.'
  Save-TestPreference ''
  Assert-Path $newer (Resolve-ManagedFigmaAppDir $runtime $older) 'Selected official path must follow an installed update.'
  Assert-Path $newer (Resolve-ManagedFigmaAppDir $runtime) 'Detected old official path must follow an installed update.'
  Save-TestPreference $custom
  Assert-Path $custom (Resolve-ManagedFigmaAppDir $runtime $older) 'Saved custom location must remain preferred.'
  Save-TestPreference ''
  Assert-Path $custom (Resolve-ManagedFigmaAppDir $runtime $custom) 'Explicit custom location must remain selected.'
  Save-TestPreference $newer
  Assert-Path $newer (Resolve-ManagedFigmaAppDir $runtime $older) 'Current version must not downgrade.'
  Remove-Item -LiteralPath (Join-Path $newer 'resources\app.asar')
  Save-TestPreference $older
  Assert-Path $older (Resolve-ManagedFigmaAppDir $runtime) 'Incomplete updates must not replace the complete installation.'
  Save-TestPreference (Join-Path $fixture 'missing')
  $script:detectedAppDir = $custom
  Assert-Path $custom (Resolve-ManagedFigmaAppDir $runtime) 'Missing preference must use detection.'
  Write-Host 'App directory regression tests passed (10 checks).'
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  if ($fixture -and (Split-Path -Leaf $fixture) -like 'FigBoost-path-*' -and (Split-Path -Parent $fixture) -eq [IO.Path]::GetTempPath().TrimEnd('\')) {
    Remove-Item -LiteralPath $fixture -Recurse -Force
  }
}
