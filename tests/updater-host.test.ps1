# Exercise the actual background updater inside the same host used by FigBoost.exe.
# All downloads are fixtures; this test never opens or changes Figma.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$temp = Join-Path ([IO.Path]::GetTempPath()) ('figboost-updater-host-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'src\FigBoost.ps1'), [ref]$null, [ref]$null)
  $names = @('Invoke-UpdateWorker', 'Assert-UpdateVersion', 'Get-LatestFigBoostUpdate', 'Save-VerifiedUpdateDownload', 'Get-Sha256Hex')
  $definitions = $ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -in $names } | ForEach-Object { $_.Extent.Text }
  $harness = @'
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$PatcherVersion = '0.0.0'; $UpdateRepository = ''; $UpdateCommitApi = ''
__FUNCTIONS__
try {
  $result = @(Invoke-UpdateWorker {
    param($directory)
    # A packaged host cannot rely on module-provided Get-FileHash being available.
    function Get-FileHash { throw 'Get-FileHash is unavailable in this host.' }
    function Invoke-WebRequest {
      param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec)
      [IO.File]::WriteAllBytes($OutFile, [byte[]](97, 98, 99))
    }
    $expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    foreach ($name in @('FigBoost.exe', 'updates/payload.json')) {
      $path = Join-Path $directory 'download'
      $release = [pscustomobject]@{ DownloadUrl = ('https://raw.githubusercontent.com/Hoae2002/Figma-CN/' + ('a' * 40) + '/' + $name); size = 3; sha256 = $expected.ToUpperInvariant() }
      Save-VerifiedUpdateDownload $release $path
      if ([IO.File]::ReadAllText($path) -cne 'abc') { throw 'Valid download was lost.' }
      foreach ($failure in @('hash', 'size')) {
        $release.sha256 = if ($failure -eq 'hash') { '0' * 64 } else { $expected }
        $release.size = if ($failure -eq 'size') { 4 } else { 3 }
        $rejected = $false
        try { Save-VerifiedUpdateDownload $release $path } catch { $rejected = $true }
        if (-not $rejected -or [IO.File]::Exists($path)) { throw "Invalid $failure was accepted or retained." }
      }
    }
    'passed'
  } @('__TEMP__'))[-1]
  if ($result -cne 'passed') { throw 'Background updater returned no result.' }
  $UpdatePreview = $true
  $preview = @(Invoke-UpdateWorker { Get-LatestFigBoostUpdate })[-1]
  if ($preview.client.version -ne '999.0.0' -or $preview.payload.version -ne '999.0.0') { throw 'Compiled preview worker did not return the simulated release.' }
  [IO.File]::WriteAllText('__REPORT__', 'passed')
} catch { [IO.File]::WriteAllText('__REPORT__', $_.ToString()); exit 1 }
'@
  $report = Join-Path $temp 'result.txt'
  $harness = $harness.Replace('__FUNCTIONS__', ($definitions -join "`r`n")).Replace('__TEMP__', $temp.Replace("'", "''")).Replace('__REPORT__', $report.Replace("'", "''"))
  $source = Join-Path $temp 'test.ps1'
  $exe = Join-Path $temp 'test.exe'
  [IO.File]::WriteAllText($source, $harness, (New-Object Text.UTF8Encoding($true)))
  Import-Module ps2exe -ErrorAction Stop
  Invoke-ps2exe -inputFile $source -outputFile $exe -STA -noConsole -noOutput -DPIAware | Out-Null
  $process = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Compiled updater test timed out.' }
  if (-not (Test-Path -LiteralPath $report)) { throw 'Compiled updater test produced no report.' }
  $result = [IO.File]::ReadAllText($report)
  if ($process.ExitCode -ne 0 -or $result -cne 'passed') { throw "Compiled updater failed: $result" }
  Write-Host 'Compiled updater download validation passed (client, payload, hash and size rejection).'
} finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
