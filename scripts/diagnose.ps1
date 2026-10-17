param(
  [string]$RuntimeDir = 'C:\FZ',
  [string]$AppDir = '',
  [string]$OutputPath = ''
)

# Read installed files and Figma process paths only. Never launch or stop Figma.
$ErrorActionPreference = 'Stop'
$report = New-Object 'System.Collections.Generic.List[string]'
function Add-Line([string]$Value) {
  if ($env:USERPROFILE) { $Value = $Value.Replace($env:USERPROFILE, '%USERPROFILE%') }
  $report.Add($Value)
}
function Get-FileInfo([string]$Path) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { Add-Line "Missing: $Path"; return }
  $file = Get-Item -LiteralPath $Path
  Add-Line "$Path | bytes=$($file.Length) | modified=$($file.LastWriteTimeUtc.ToString('o')) | sha256=$((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash)"
}
function Read-AsarFile([string]$Path, [string]$Name) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $prefix = New-Object byte[] 16
    if ($stream.Read($prefix, 0, 16) -ne 16) { throw 'Truncated ASAR prefix' }
    $headerSize = [BitConverter]::ToUInt32($prefix, 4)
    $jsonSize = [BitConverter]::ToUInt32($prefix, 12)
    if ($headerSize -lt 8 -or $headerSize -gt 16777216 -or $jsonSize -gt ($headerSize - 8) -or (8L + $headerSize) -gt $stream.Length) { throw 'Invalid ASAR header size' }
    $json = New-Object byte[] $jsonSize
    if ($stream.Read($json, 0, $json.Length) -ne $json.Length) { throw 'Truncated ASAR header' }
    $header = [Text.Encoding]::UTF8.GetString($json) | ConvertFrom-Json
    $entry = $header.files.$Name
    if (!$entry -or $entry.unpacked -or $null -eq $entry.offset -or $null -eq $entry.size) { throw "No packed $Name entry" }
    $size = [long]$entry.size
    $offset = [long]$entry.offset
    if ($size -lt 0 -or $size -gt 67108864 -or $offset -lt 0 -or $offset -gt ($stream.Length - 8L - $headerSize) -or $size -gt ($stream.Length - 8L - $headerSize - $offset)) { throw 'Invalid ASAR entry bounds' }
    $stream.Position = 8L + $headerSize + $offset
    $data = New-Object byte[] $size
    $read = 0
    while ($read -lt $data.Length) {
      $count = $stream.Read($data, $read, $data.Length - $read)
      if (!$count) { throw 'Truncated ASAR entry' }
      $read += $count
    }
    return [Text.Encoding]::UTF8.GetString($data)
  } finally { $stream.Dispose() }
}

Add-Line 'FigBoost read-only diagnostic v1'
Add-Line "UTC: $([DateTime]::UtcNow.ToString('o'))"
Add-Line 'Scope: installed patch files, selected Figma application code excerpts, Figma executable paths/start times.'
Add-Line 'Does not collect documents, cookies, account data or translation history. Does not change/restart Figma or send data.'
Add-Line 'Disk files do not prove which payload is currently loaded or what the live page DOM contains.'
Add-Line "RuntimeDir: $RuntimeDir"

$appDirs = New-Object 'System.Collections.Generic.List[string]'
if ($AppDir) { $appDirs.Add($AppDir) }
Add-Line ''
Add-Line '[Running Figma processes]'
foreach ($process in @(Get-Process -Name Figma -ErrorAction SilentlyContinue)) {
  try {
    $exe = $process.Path
    Add-Line "pid=$($process.Id) | exe=$exe | started=$($process.StartTime.ToUniversalTime().ToString('o'))"
    if ($exe) { $appDirs.Add((Split-Path -Parent $exe)) }
  } catch { Add-Line "pid=$($process.Id) | process details unavailable" }
}
$defaultRoot = Join-Path $env:LOCALAPPDATA 'Figma'
if (Test-Path -LiteralPath $defaultRoot -PathType Container) {
  foreach ($dir in @(Get-ChildItem -LiteralPath $defaultRoot -Directory -Filter 'app-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 3)) { $appDirs.Add($dir.FullName) }
}

Add-Line ''
Add-Line '[Runtime files]'
foreach ($name in @('i.js', 'm.js', 'zh-CN.js', 'translation-policy.js', 'translation-host.js', 'translation-service.js')) {
  $path = Join-Path $RuntimeDir $name
  try {
    Get-FileInfo $path
    if (!(Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    if ((Get-Item -LiteralPath $path).Length -gt 20971520) { Add-Line 'Text inspection skipped: file exceeds 20 MiB'; continue }
    $source = [IO.File]::ReadAllText($path)
    if ($name -eq 'i.js') {
      $version = [regex]::Match($source, 'const\s+version\s*=\s*["'']([\d.]+)["'']')
      Add-Line "Payload version: $($version.Groups[1].Value)"
      Add-Line "Timestamp metadata guard: $($source.Contains('fileBrowserTimestampSource'))"
      Add-Line "Split time-unit rule: $($source.Contains('^years? ago$'))"
      Add-Line "Isolated translation runtime: $($source.Contains('__FIGBOOST_TRANSLATION_RUNTIME__'))"
    }
    if ($name -eq 'm.js') {
      Add-Line "Missing native update-menu recovery: $($source.Contains('function ensureNativeUpdateEntry'))"
      Add-Line "Native popup hook: $($source.Contains('Menu.prototype.popup = function'))"
      Add-Line "Renderer injection registration: $($source.Contains('registerRendererInjection();'))"
    }
    if ($name -eq 'translation-host.js') { Add-Line "Isolated-world support required: $($source.Contains('executeJavaScriptInIsolatedWorld'))" }
  } catch { Add-Line "Cannot inspect ${path}: $($_.Exception.Message)" }
}

Add-Line ''
Add-Line '[Figma installations]'
foreach ($dir in @($appDirs | Select-Object -Unique)) {
  Add-Line "AppDir: $dir"
  $exe = Join-Path $dir 'Figma.exe'
  if (Test-Path -LiteralPath $exe -PathType Leaf) {
    Add-Line "Figma product version: $((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion)"
  }
  foreach ($name in @('app.asar', 'app.asar.figma-zh-official-preload-original')) {
    $path = Join-Path $dir "resources\$name"
    try {
      Get-FileInfo $path
      if (!(Test-Path -LiteralPath $path -PathType Leaf)) { continue }
      $source = Read-AsarFile $path 'main.js'
      Add-Line "Main hook V7: $($source.Contains('FIGMA_ZH_OFFICIAL_MAIN_HOOK_V7'))"
      Add-Line "Built-in updater disabled: $($source.Contains('FIGMA_ZH_DISABLE_BUILTIN_UPDATER'))"
      # Only bounded excerpts of application code; no user profile/cache files.
      foreach ($needle in @('FIGMA_ZH_OFFICIAL_MAIN_HOOK_V7', 'checkForUpdates', 'check_for_updates', 'Updater not enabled. Reason:', 'Check for updates')) {
        $offset = 0
        for ($hit = 0; $hit -lt 3; $hit++) {
          $index = $source.IndexOf($needle, $offset, [StringComparison]::Ordinal)
          if ($index -lt 0) { break }
          $start = [Math]::Max(0, $index - 240)
          $length = [Math]::Min(1100, $source.Length - $start)
          Add-Line "Excerpt [$needle] #$($hit + 1): $($source.Substring($start, $length))"
          $offset = $index + $needle.Length
        }
      }
    } catch { Add-Line "Cannot inspect ${path}: $($_.Exception.Message)" }
  }
}

if (!$OutputPath) { $OutputPath = Join-Path ([Environment]::GetFolderPath('Desktop')) "FigBoost-diagnostic-$([DateTime]::Now.ToString('yyyyMMdd-HHmmss')).txt" }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
[IO.File]::WriteAllLines($OutputPath, $report, (New-Object Text.UTF8Encoding($true)))
Write-Output "Report saved: $OutputPath"
