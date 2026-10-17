param(
  [switch]$SelfTest,
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status,
  [switch]$CheckLatest,
  [switch]$UpdateFigma,
  [switch]$ShowProgress,
  [string]$AppDir = "",
  [string]$RuntimeDir = "C:\FZ",
  [switch]$ForceClose
)

$ErrorActionPreference = "Stop"

if ($args -contains "-SelfTest" -or $args -contains "/SelfTest") { $SelfTest = $true }
if ($args -contains "-Install" -or $args -contains "/Install") { $Install = $true }
if ($args -contains "-Uninstall" -or $args -contains "/Uninstall") { $Uninstall = $true }
if ($args -contains "-Status" -or $args -contains "/Status") { $Status = $true }
if ($args -contains "-CheckLatest" -or $args -contains "/CheckLatest") { $CheckLatest = $true }
if ($args -contains "-UpdateFigma" -or $args -contains "/UpdateFigma") { $UpdateFigma = $true }
if ($args -contains "-ShowProgress" -or $args -contains "/ShowProgress") { $ShowProgress = $true }
if ($args -contains "-ForceClose" -or $args -contains "/ForceClose") { $ForceClose = $true }

$PatchMarker = "FIGMA_ZH_OFFICIAL_MAIN_HOOK_V7"
$UpdaterDisableMarker = "FIGMA_ZH_DISABLE_BUILTIN_UPDATER"
$PatcherVersion = "0.5.37"
$PayloadFile = "i.js"
$MainPayloadFile = "m.js"
$FeatureConfigFile = "features.json"
$BackupFile = "app.asar.figma-zh-official-preload-original"
$LicenseCommentTarget = "/*! Bundled license information:"
$OfficialReleasesXmlUrl = "https://desktop.figma.com/win/releases.xml"
$OfficialInstallerUrl = "https://desktop.figma.com/win/FigmaSetup.exe"
$EmbeddedPayloadFiles = @{}
$EmbeddedButtonSource = ""
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:UpdatedPayloadFiles = @{}
$UpdateRepository = "https://raw.githubusercontent.com/Hoae2002/Figma-CN"
$UpdateCommitApi = "https://api.github.com/repos/Hoae2002/Figma-CN/commits/main"

function Assert-UpdateVersion {
  param([string]$Version)
  if ($Version -notmatch '^\d{1,4}\.\d{1,4}\.\d{1,4}$') { throw "更新版本号无效。" }
}

function Get-LatestFigBoostUpdate {
  $headers = @{ "User-Agent" = "FigBoost/$PatcherVersion"; "Accept" = "application/vnd.github+json" }
  $commit = Invoke-RestMethod -Uri $UpdateCommitApi -Headers $headers -UseBasicParsing -TimeoutSec 20
  if ([string]$commit.sha -notmatch '^[a-f0-9]{40}$') { throw "无法读取更新发布版本。" }
  $base = "$UpdateRepository/$($commit.sha)"
  $info = Invoke-RestMethod -Uri "$base/updates/latest.json" -Headers $headers -UseBasicParsing -TimeoutSec 20
  if ($info.schema -ne 1) { throw "更新格式不受支持，请手动下载新版 FigBoost。" }
  foreach ($item in @($info.client, $info.payload)) {
    Assert-UpdateVersion ([string]$item.version)
    if ([string]$item.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or [long]$item.size -le 0 -or [long]$item.size -gt 20971520) { throw "更新文件校验信息无效。" }
  }
  Assert-UpdateVersion ([string]$info.payload.minPatcherVersion)
  $info.client | Add-Member -NotePropertyName DownloadUrl -NotePropertyValue "$base/FigBoost.exe" -Force
  $info.payload | Add-Member -NotePropertyName DownloadUrl -NotePropertyValue "$base/updates/payload.json" -Force
  return $info
}

function Save-VerifiedUpdateDownload {
  param([object]$Release, [string]$Destination)
  if ([string]$Release.DownloadUrl -notmatch '^https://raw\.githubusercontent\.com/Hoae2002/Figma-CN/[a-f0-9]{40}/(FigBoost\.exe|updates/payload\.json)$') { throw "更新下载地址无效。" }
  try {
    Invoke-WebRequest -Uri $Release.DownloadUrl -OutFile $Destination -UseBasicParsing -TimeoutSec 120 | Out-Null
    $file = Get-Item -LiteralPath $Destination
    if ($file.Length -ne [long]$Release.size -or (Get-Sha256Hex ([IO.File]::ReadAllBytes($Destination))) -ine $Release.sha256) { throw "下载文件校验失败，请重新检查更新。" }
  } catch {
    Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    throw
  }
}

function Get-PayloadUpdateCachePath {
  return (Join-Path $env:LOCALAPPDATA "FigBoost\updates\payload.json")
}

function ConvertFrom-PayloadUpdate {
  param([object]$Package)
  if ($Package.schema -ne 1) { throw "词库更新格式不受支持。" }
  Assert-UpdateVersion ([string]$Package.version)
  Assert-UpdateVersion ([string]$Package.minPatcherVersion)
  if ((Compare-VersionString $PatcherVersion $Package.minPatcherVersion) -lt 0) { throw "此词库需要 FigBoost v$($Package.minPatcherVersion) 或更高版本，请先升级 FigBoost。" }
  $paths = @(
    "payload\manifest.json", "payload\src\dictionary\zh-CN.js", "payload\src\content\localizer-core.js",
    "payload\src\content\content.js", "payload\src\main\menu-localizer.js", "payload\src\shared\translation-policy.js",
    "payload\src\content\translation-runtime.js", "payload\src\main\translation-service.js", "payload\src\main\translation-host.js",
    "payload\src\main\translation-settings-preload.js", "payload\src\main\translation-settings.html",
    "payload\src\main\translation-settings.css", "payload\src\main\translation-settings.js"
  )
  if (@($Package.files.PSObject.Properties).Count -ne $paths.Count) { throw "词库更新文件不完整。" }
  $files = @{}
  foreach ($path in $paths) {
    $value = [string]$Package.files.$path
    if (-not $value) { throw "词库更新缺少文件：$path" }
    $bytes = [Convert]::FromBase64String($value)
    if ($bytes.Length -eq 0 -or $bytes.Length -gt 5242880) { throw "词库更新文件大小无效。" }
    $files[$path] = $value
  }
  $manifest = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($files['payload\manifest.json'])) | ConvertFrom-Json
  if ($manifest.version -ne $Package.version) { throw "词库更新版本不一致。" }
  return $files
}

function Initialize-PayloadUpdate {
  # Source-mode tests and development always use the checkout, never a user's cache.
  if ($EmbeddedPayloadFiles.Count -eq 0) { return }
  $cache = Get-PayloadUpdateCachePath
  if (-not (Test-Path -LiteralPath $cache)) { return }
  try {
    $package = [IO.File]::ReadAllText($cache, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ((Compare-VersionString $package.version (Get-PayloadVersion)) -gt 0) { $script:UpdatedPayloadFiles = ConvertFrom-PayloadUpdate $package }
  } catch { Write-Log "Ignored invalid payload update cache: $($_.Exception.Message)" }
}

function Get-InstalledPayloadVersion {
  param([string]$SelectedRuntimeDir)
  $path = Join-Path $SelectedRuntimeDir $PayloadFile
  if (Test-Path -LiteralPath $path) {
    $reader = [IO.File]::OpenText($path)
    try {
      $buffer = New-Object char[] 1024
      $length = $reader.Read($buffer, 0, $buffer.Length)
      $prefix = New-Object string($buffer, 0, $length)
      if ($prefix -match 'const version = "(\d+\.\d+\.\d+)";') { return $Matches[1] }
    } finally { $reader.Dispose() }
  }
  return ""
}

function Install-PayloadUpdate {
  param([object]$Package, [string]$SelectedAppDir, [string]$SelectedRuntimeDir)
  $files = ConvertFrom-PayloadUpdate $Package
  if ((Compare-VersionString $Package.version (Get-PayloadVersion)) -lt 0) { throw "不能安装比当前内置词库更旧的版本。" }
  $target = Resolve-Target (Resolve-ManagedFigmaAppDir $SelectedRuntimeDir $SelectedAppDir)
  $status = Get-PatchStatus $target $SelectedRuntimeDir
  if (-not $status.Patched -or -not $status.HasRuntimePayload -or -not $status.HasRuntimeMainPayload) { throw "请先安装汉化补丁，再更新词库。" }
  $installed = Get-InstalledPayloadVersion $SelectedRuntimeDir
  if ($installed -and (Compare-VersionString $Package.version $installed) -lt 0) { throw "不能降级已安装的词库。" }
  $cache = Get-PayloadUpdateCachePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cache) | Out-Null
  $staged = "$cache.$([Guid]::NewGuid().ToString('N')).tmp"
  $originalFiles = @{}
  foreach ($name in @('zh-CN.js', 'translation-policy.js', 'translation-service.js', 'translation-host.js', 'translation-settings-preload.js', 'translation-settings.html', 'translation-settings.css', 'translation-settings.js', $PayloadFile, $MainPayloadFile, $FeatureConfigFile)) {
    $path = Join-Path $SelectedRuntimeDir $name
    $originalFiles[$path] = if (Test-Path -LiteralPath $path) { [IO.File]::ReadAllBytes($path) } else { $null }
  }
  $previous = $script:UpdatedPayloadFiles
  $restart = $false
  try {
    [IO.File]::WriteAllText($staged, ($Package | ConvertTo-Json -Depth 5 -Compress), $Utf8NoBom)
    $restart = Stop-FigmaForPatch $target.AppDir -Force
    $script:UpdatedPayloadFiles = $files
    Write-RuntimeFiles $SelectedRuntimeDir
    # Older installs may have no optional-feature file. Manual native updates need only updater paths.
    if (-not (Test-Path -LiteralPath (Get-FeatureConfigPath $SelectedRuntimeDir))) { [void](Write-FeatureConfig $SelectedRuntimeDir @()) }
    if (Test-Path -LiteralPath $cache) { [IO.File]::Replace($staged, $cache, [System.Management.Automation.Language.NullString]::Value) } else { [IO.File]::Move($staged, $cache) }
  } catch {
    $script:UpdatedPayloadFiles = $previous
    foreach ($path in $originalFiles.Keys) {
      if ($null -eq $originalFiles[$path]) {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
      } elseif (-not (Test-Path -LiteralPath $path) -or (Get-Sha256Hex ([IO.File]::ReadAllBytes($path))) -ine (Get-Sha256Hex $originalFiles[$path])) {
        [IO.File]::WriteAllBytes($path, $originalFiles[$path])
      }
    }
    throw
  } finally {
    Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
    if ($restart) { [void](Start-FigmaClient $target.AppDir) }
  }
  return Get-PatchStatus $target $SelectedRuntimeDir
}

function Invoke-UpdateWorker {
  param([scriptblock]$Action, [object[]]$Arguments = @())
  $worker = [PowerShell]::Create()
  try {
    $setup = '$ErrorActionPreference = "Stop"; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;'
    foreach ($name in @('Assert-UpdateVersion', 'Get-LatestFigBoostUpdate', 'Get-Sha256Hex', 'Save-VerifiedUpdateDownload')) { $setup += (Get-Command $name).Definition.Insert(0, "function $name {") + "}`n" }
    foreach ($name in @('PatcherVersion', 'UpdateRepository', 'UpdateCommitApi')) { $setup += "`$$name = '" + (Get-Variable $name -ValueOnly).Replace("'", "''") + "';`n" }
    [void]$worker.AddScript($setup + "function Invoke-Work {" + $Action.ToString() + "}`nInvoke-Work @args")
    foreach ($argument in $Arguments) { [void]$worker.AddArgument($argument) }
    $pending = $worker.BeginInvoke()
    while (-not $pending.IsCompleted) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 30 }
    $result = $worker.EndInvoke($pending)
    if ($worker.HadErrors) { throw $worker.Streams.Error[0] }
    return $result
  } finally { $worker.Dispose() }
}

function Get-BaseDir {
  $scriptDir = if ($PSScriptRoot) {
    $PSScriptRoot
  } elseif ($PSCommandPath) {
    Split-Path -Parent $PSCommandPath
  } else {
    [AppDomain]::CurrentDomain.BaseDirectory
  }
  if (Test-Path -LiteralPath (Join-Path $scriptDir "payload")) {
    return $scriptDir
  }
  return (Split-Path -Parent $scriptDir)
}

function Write-Log {
  param([string]$Message)
  if ($script:LogBox) {
    $script:LogBox.AppendText("[$(Get-Date -Format 'HH:mm:ss')] $Message`r`n")
  } elseif (($SelfTest -or $Install -or $Uninstall -or $Status -or $CheckLatest -or $UpdateFigma) -and $Host.Name -eq "ConsoleHost") {
    Write-Host $Message
  } else {
    try {
      $logDir = Join-Path $env:LOCALAPPDATA "FigBoost"
      New-Item -ItemType Directory -Force -Path $logDir | Out-Null
      Add-Content -LiteralPath (Join-Path $logDir "FigBoost.log") -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" -Encoding UTF8
    } catch {
    }
  }
}

function ConvertTo-JsString {
  param([string]$Value)
  return ($Value | ConvertTo-Json -Compress)
}

function Get-SemverParts {
  param([string]$Name)
  if ($Name -match '^(?:app-)?(\d+)\.(\d+)\.(\d+)') {
    return @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
  }
  return $null
}

function Find-LatestFigmaAppDir {
  $figmaRoot = Join-Path $env:LOCALAPPDATA "Figma"
  if (-not (Test-Path -LiteralPath $figmaRoot)) {
    throw "Figma directory not found: $figmaRoot"
  }

  $items = Get-ChildItem -LiteralPath $figmaRoot -Directory |
    Where-Object {
      (Get-SemverParts $_.Name) -and
      (Test-FigmaAppDir $_.FullName)
    } |
    Sort-Object @{
      Expression = { (Get-SemverParts (Get-FigmaVersionFromAppDir $_.FullName))[0] }
      Descending = $true
    }, @{
      Expression = { (Get-SemverParts (Get-FigmaVersionFromAppDir $_.FullName))[1] }
      Descending = $true
    }, @{
      Expression = { (Get-SemverParts (Get-FigmaVersionFromAppDir $_.FullName))[2] }
      Descending = $true
    }

  if (-not $items -or $items.Count -eq 0) {
    throw "No complete app-* Figma version directory found in: $figmaRoot"
  }
  return $items[0].FullName
}

function Test-OfficialFigmaAppDir {
  param([string]$AppDir)
  if (-not $AppDir) { return $false }
  try {
    $resolvedAppDir = (Resolve-Path -LiteralPath $AppDir).Path
    $figmaRoot = Join-Path $env:LOCALAPPDATA "Figma"
    if (-not (Test-Path -LiteralPath $figmaRoot)) { return $false }
    $resolvedFigmaRoot = (Resolve-Path -LiteralPath $figmaRoot).Path
    return (
      ((Split-Path -Parent $resolvedAppDir) -ieq $resolvedFigmaRoot) -and
      ((Split-Path -Leaf $resolvedAppDir) -match '^app-\d+\.\d+\.\d+')
    )
  } catch {
    return $false
  }
}

function Find-FigmaAppDirAtLeastVersion {
  param([string]$Version)
  $figmaRoot = Join-Path $env:LOCALAPPDATA "Figma"
  if (-not (Test-Path -LiteralPath $figmaRoot)) {
    throw "Figma directory not found: $figmaRoot"
  }

  $items = Get-ChildItem -LiteralPath $figmaRoot -Directory |
    Where-Object {
      (Get-SemverParts $_.Name) -and
      (Test-FigmaAppDir $_.FullName) -and
      ((Compare-VersionString (Get-FigmaVersionFromAppDir $_.FullName) $Version) -ge 0)
    } |
    Sort-Object @{
      Expression = { (Get-SemverParts (Get-FigmaVersionFromAppDir $_.FullName))[0] }
      Descending = $true
    }, @{
      Expression = { (Get-SemverParts (Get-FigmaVersionFromAppDir $_.FullName))[1] }
      Descending = $true
    }, @{
      Expression = { (Get-SemverParts (Get-FigmaVersionFromAppDir $_.FullName))[2] }
      Descending = $true
    }

  if (-not $items -or $items.Count -eq 0) {
    throw "Cannot find updated Figma app directory for version $Version in: $figmaRoot"
  }
  return $items[0].FullName
}

function Test-FigmaAppDir {
  param([string]$Path)
  if (-not $Path) { return $false }
  return (
    (Test-Path -LiteralPath (Join-Path $Path "Figma.exe")) -and
    (Test-Path -LiteralPath (Join-Path $Path "resources\app.asar"))
  )
}

function Find-ShortcutFigmaAppDir {
  $shortcutRoots = @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("CommonDesktopDirectory")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  try {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($root in $shortcutRoots) {
      $links = Get-ChildItem -LiteralPath $root -Filter "*.lnk" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*Figma*" }
      foreach ($link in $links) {
        $shortcut = $shell.CreateShortcut($link.FullName)
        $target = [string]$shortcut.TargetPath
        if ($target -and (Split-Path -Leaf $target) -ieq "Figma.exe") {
          $appDir = Split-Path -Parent $target
          if (Test-FigmaAppDir $appDir) { return $appDir }
        }
      }
    }
  } catch {}

  return $null
}

function Find-CurrentFigmaAppDir {
  $runningProcesses = Get-Process -Name "Figma" -ErrorAction SilentlyContinue
  foreach ($process in $runningProcesses) {
    $processPath = ""
    try { $processPath = [string]$process.Path } catch {}
    if ($processPath -and (Split-Path -Leaf $processPath) -ieq "Figma.exe") {
      $appDir = Split-Path -Parent $processPath
      if (Test-FigmaAppDir $appDir) { return $appDir }
    }
  }

  $shortcutAppDir = Find-ShortcutFigmaAppDir
  if ($shortcutAppDir) { return $shortcutAppDir }

  return Find-LatestFigmaAppDir
}

function Get-FigmaVersionFromAppDir {
  param([string]$AppDir)
  $exePath = Join-Path $AppDir "Figma.exe"
  if (Test-Path -LiteralPath $exePath) {
    $versionInfo = (Get-Item -LiteralPath $exePath).VersionInfo
    foreach ($version in @($versionInfo.ProductVersion, $versionInfo.FileVersion)) {
      if ($version -and $version -match '(\d+\.\d+\.\d+)') {
        return $Matches[1]
      }
    }
  }
  $name = Split-Path -Leaf $AppDir
  if ($name -match '^app-(.+)$') { return $Matches[1] }
  return "unknown"
}

function Compare-VersionString {
  param([string]$Left, [string]$Right)
  $leftParts = @($Left -split '\.' | ForEach-Object { [int]$_ })
  $rightParts = @($Right -split '\.' | ForEach-Object { [int]$_ })
  $count = [Math]::Max($leftParts.Count, $rightParts.Count)
  for ($i = 0; $i -lt $count; $i++) {
    $l = if ($i -lt $leftParts.Count) { $leftParts[$i] } else { 0 }
    $r = if ($i -lt $rightParts.Count) { $rightParts[$i] } else { 0 }
    if ($l -gt $r) { return 1 }
    if ($l -lt $r) { return -1 }
  }
  return 0
}

function New-FigmaReleaseInfo {
  param([string]$Version, [string]$Name, [string]$InstallerUrl, [string]$ReleaseUrl)
  return [pscustomobject]@{
    Version = $Version
    Name = $Name
    InstallerUrl = $InstallerUrl
    ReleaseUrl = $ReleaseUrl
  }
}

function Get-FigmaInstallerVersionFromText {
  param([string]$Text)
  if ($Text -match 'Figma-(\d+\.\d+\.\d+)-full\.nupkg') { return $Matches[1] }
  return $null
}

function New-PatcherUpdateScript {
  param([string]$CurrentExe, [string]$TempExe, [int]$ProcessId, [string]$SelectedRuntimeDir, [string]$SelectedAppDir)
  $currentExeLiteral = $currentExe.Replace("'", "''")
  $tempExeLiteral = $tempExe.Replace("'", "''")
  # Windows paths cannot contain quotes; double trailing slashes before the closing quote.
  $runtimeArgument = '"' + ($SelectedRuntimeDir -replace '(\\+)$', '$1$1') + '"'
  $appArgument = '"' + ($SelectedAppDir -replace '(\\+)$', '$1$1') + '"'
  $argumentsLiteral = ("-RuntimeDir $runtimeArgument -AppDir $appArgument").Replace("'", "''")
  return @"
`$ErrorActionPreference = 'Stop'
try {
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { Wait-Process -Id $ProcessId -Timeout 60 -ErrorAction Stop }
  Copy-Item -LiteralPath '$currentExeLiteral' -Destination '$currentExeLiteral.update-backup' -Force
  try {
    for (`$attempt = 0; `$attempt -lt 30; `$attempt++) {
      try { Copy-Item -LiteralPath '$tempExeLiteral' -Destination '$currentExeLiteral' -Force; break }
      catch { if (`$attempt -eq 29) { throw }; Start-Sleep -Milliseconds 300 }
    }
    Start-Process -FilePath '$currentExeLiteral' -ArgumentList '$argumentsLiteral'
  } catch {
    Copy-Item -LiteralPath '$currentExeLiteral.update-backup' -Destination '$currentExeLiteral' -Force
    throw
  }
  Remove-Item -LiteralPath '$currentExeLiteral.update-backup' -Force -ErrorAction SilentlyContinue
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [Windows.Forms.MessageBox]::Show(('FigBoost 升级失败，原版本已保留。' + [Environment]::NewLine + `$_.Exception.Message), 'FigBoost', 'OK', 'Error') | Out-Null
} finally {
  Remove-Item -LiteralPath '$tempExeLiteral' -Force -ErrorAction SilentlyContinue
}
"@
}

function Invoke-PatcherSelfUpdate {
  param([object]$Release, [string]$TempExe, [string]$SelectedRuntimeDir, [string]$SelectedAppDir)
  $currentExe = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  if ((Split-Path -Leaf $currentExe) -ine 'FigBoost.exe') { throw "请在打包后的 FigBoost.exe 中升级客户端。" }
  if ((Get-Item -LiteralPath $TempExe).Length -ne [long]$Release.size -or (Get-Sha256Hex ([IO.File]::ReadAllBytes($TempExe))) -ine $Release.sha256) { throw "客户端更新文件校验失败。" }
  $downloadVersion = (Get-Item -LiteralPath $TempExe).VersionInfo.FileVersion
  if ($downloadVersion -ne "$($Release.version).0") { throw "客户端更新文件版本不匹配。" }
  $psExe = (Get-Command powershell.exe -ErrorAction Stop).Source
  $script = New-PatcherUpdateScript $currentExe $TempExe $PID $SelectedRuntimeDir $SelectedAppDir
  $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($script))
  Start-Process -FilePath $psExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded) -WindowStyle Hidden
}

function Get-OfficialLatestFigmaInstallerRelease {
  $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($OfficialInstallerUrl)
  $request.Method = "GET"
  $request.Timeout = 30000
  $request.ReadWriteTimeout = 30000
  $request.AddRange(0, 2097151)
  $response = $request.GetResponse()
  try {
    $stream = $response.GetResponseStream()
    $memory = New-Object System.IO.MemoryStream
    try {
      $stream.CopyTo($memory)
      $text = [System.Text.Encoding]::GetEncoding(28591).GetString($memory.ToArray())
    } finally {
      $memory.Dispose()
      $stream.Dispose()
    }
  } finally {
    $response.Dispose()
  }
  $version = Get-FigmaInstallerVersionFromText $text
  if (-not $version) { throw "Cannot parse official Figma version from installer metadata." }
  return New-FigmaReleaseInfo $version "Figma $version" $OfficialInstallerUrl $OfficialInstallerUrl
}

function Get-OfficialLatestFigmaFeedRelease {
  $response = Invoke-WebRequest -Uri $OfficialReleasesXmlUrl -UseBasicParsing -TimeoutSec 20
  [xml]$xml = $response.Content
  $items = @($xml.rss.channel.item)
  if (-not $items -or $items.Count -eq 0) { throw "Official Figma releases feed did not include a version." }

  $releases = @()
  foreach ($item in $items) {
    if ([string]$item.title -match 'Figma\s+(\d+\.\d+\.\d+)') {
      $version = $Matches[1]
      $releases += New-FigmaReleaseInfo $version ([string]$item.title) $OfficialInstallerUrl $OfficialReleasesXmlUrl
    }
  }
  if ($releases.Count -eq 0) { throw "Cannot parse official Figma version from releases feed." }
  return Select-LatestFigmaRelease $releases
}

function Select-LatestFigmaRelease {
  param([object[]]$Releases)
  $latest = $null
  foreach ($release in $Releases) {
    if (-not $latest -or (Compare-VersionString $release.Version $latest.Version) -gt 0) {
      $latest = $release
    }
  }
  return $latest
}

function Get-OfficialLatestFigmaRelease {
  param([string]$CurrentVersion = "0.0.0")
  $releases = @()
  $errors = @()
  try {
    $releases += Get-OfficialLatestFigmaInstallerRelease
  } catch {
    $errors += $_.Exception.Message
  }
  try {
    $releases += Get-OfficialLatestFigmaFeedRelease
  } catch {
    $errors += $_.Exception.Message
  }
  if ($releases.Count -eq 0) {
    throw "Cannot determine official Figma latest version. $($errors -join ' ')"
  }
  return Select-LatestFigmaRelease $releases
}

function Resolve-Target {
  param([string]$SelectedAppDir)
  $resolvedAppDir = if ($SelectedAppDir) { (Resolve-Path -LiteralPath $SelectedAppDir).Path } else { Find-CurrentFigmaAppDir }
  $resourcesDir = Join-Path $resolvedAppDir "resources"
  $asarPath = Join-Path $resourcesDir "app.asar"
  $backupPath = Join-Path $resourcesDir $BackupFile
  if (-not (Test-Path -LiteralPath $asarPath)) {
    throw "app.asar not found: $asarPath"
  }
  return [pscustomobject]@{
    AppDir = $resolvedAppDir
    FigmaVersion = Get-FigmaVersionFromAppDir $resolvedAppDir
    ResourcesDir = $resourcesDir
    AsarPath = $asarPath
    BackupPath = $backupPath
  }
}

function Get-Sha256Hex {
  param([byte[]]$Bytes)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-BytesIndex {
  param([byte[]]$Bytes, [byte[]]$Needle)
  if ($Needle.Length -eq 0 -or $Bytes.Length -lt $Needle.Length) { return -1 }
  for ($i = 0; $i -le $Bytes.Length - $Needle.Length; $i++) {
    $matched = $true
    for ($j = 0; $j -lt $Needle.Length; $j++) {
      if ($Bytes[$i + $j] -ne $Needle[$j]) {
        $matched = $false
        break
      }
    }
    if ($matched) { return $i }
  }
  return -1
}

function Read-Asar {
  param([string]$AsarPath)
  $bytes = [System.IO.File]::ReadAllBytes($AsarPath)
  $headerSize = [BitConverter]::ToUInt32($bytes, 4)
  $jsonSize = [BitConverter]::ToUInt32($bytes, 12)
  $headerStart = 16
  $dataStart = 8 + [int]$headerSize
  $headerText = [System.Text.Encoding]::UTF8.GetString($bytes, $headerStart, [int]$jsonSize)
  return [pscustomobject]@{
    Bytes = $bytes
    Header = $headerText | ConvertFrom-Json
    HeaderText = $headerText
    HeaderStart = $headerStart
    DataStart = $dataStart
  }
}

function Get-AsarFileSlice {
  param($Asar, [string]$FileName)
  $entry = $Asar.Header.files.$FileName
  if (-not $entry) {
    throw "$FileName not found in app.asar"
  }
  $start = $Asar.DataStart + [int64]$entry.offset
  $size = [int]$entry.size
  $fileBytes = New-Object byte[] $size
  [Array]::Copy($Asar.Bytes, [int]$start, $fileBytes, 0, $size)
  return [pscustomobject]@{
    Entry = $entry
    Start = [int]$start
    End = [int]($start + $size)
    Bytes = $fileBytes
  }
}

function Read-PayloadText {
  param([string]$RelativePath)
  if ($script:UpdatedPayloadFiles -and $script:UpdatedPayloadFiles.ContainsKey($RelativePath)) {
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($script:UpdatedPayloadFiles[$RelativePath]))
  }
  if ($EmbeddedPayloadFiles.ContainsKey($RelativePath)) {
    $bytes = [System.Convert]::FromBase64String($EmbeddedPayloadFiles[$RelativePath])
    return [System.Text.Encoding]::UTF8.GetString($bytes)
  }
  return [System.IO.File]::ReadAllText((Join-Path (Get-BaseDir) $RelativePath), [System.Text.Encoding]::UTF8)
}

function Get-PayloadVersion {
  $manifest = Read-PayloadText "payload\manifest.json" | ConvertFrom-Json
  if ($manifest.version) { return [string]$manifest.version }
  return "unknown"
}

function Build-Payload {
  $manifest = Read-PayloadText "payload\manifest.json" | ConvertFrom-Json
  $core = Read-PayloadText "payload\src\content\localizer-core.js"
  $content = Read-PayloadText "payload\src\content\content.js"
  $version = if ($manifest.version) { $manifest.version } else { "unknown" }

  return @(
    '"use strict";'
    ';(() => {'
    "  const version = $(ConvertTo-JsString $version);"
    '  if (window.__FIGMA_ZH_OFFICIAL_PRELOAD_INJECTED__ === version && window.__FIGBOOST_TRANSLATION_RUNTIME__ && window.__figmaZhLocalizer) return;'
    '  try {'
    (Read-PayloadText "payload\src\shared\translation-policy.js")
    (Read-PayloadText "payload\src\dictionary\zh-CN.js")
    $core
    (Read-PayloadText "payload\src\content\translation-runtime.js")
    $content
    '  window.__FIGMA_ZH_OFFICIAL_PRELOAD_INJECTED__ = version;'
    '  } catch (error) {'
    '    console.error("[FigmaZh] official preload injection failed", error);'
    '  }'
    '})();'
  ) -join "`n"
}

function Build-MainPayload {
  return ('try { global.__FIGBOOST_TRANSLATION_HOST__ = require(require("path").join(global.__FIGMA_ZH_RUNTIME_DIR__, "translation-host.js")).createHost(); } catch (e) { console.error("FigBoost translation service unavailable"); }' + "`n" + (Read-PayloadText "payload\src\main\menu-localizer.js"))
}

function Build-MainHook {
  param([string]$RuntimeDir)
  $payloadPath = Join-Path $RuntimeDir $PayloadFile
  $mainPayloadPath = Join-Path $RuntimeDir $MainPayloadFile
  $marker = ConvertTo-JsString $PatchMarker
  $payload = ConvertTo-JsString $payloadPath
  $mainPayload = ConvertTo-JsString $mainPayloadPath
  return ";(()=>{const M=$marker;try{const F=require(""fs""),R=require(""path""),P=$payload,Q=$mainPayload;global.__FIGMA_ZH_RUNTIME_DIR__=R.dirname(Q);global.__FIGMA_ZH_RENDERER_PAYLOAD_PATH__=P;F.existsSync(Q)&&eval(F.readFileSync(Q,""utf8""))}catch(e){}})();"
}

function Disable-BuiltInUpdaterInMain {
  param([byte[]]$MainBytes)
  $source = [System.Text.Encoding]::UTF8.GetString($MainBytes)
  if ($source.Contains($UpdaterDisableMarker)) {
    return [pscustomobject]@{ Bytes = $MainBytes; Changed = $false }
  }

  $anchor = "Updater not enabled. Reason:"
  $anchorIndex = $source.IndexOf($anchor, [StringComparison]::Ordinal)
  if ($anchorIndex -lt 0) {
    throw "Cannot find built-in updater guard target"
  }

  $functionStart = $source.LastIndexOf("function ", $anchorIndex, [StringComparison]::Ordinal)
  $nextFunction = $source.IndexOf("function ", $anchorIndex + $anchor.Length, [StringComparison]::Ordinal)
  if ($functionStart -lt 0 -or $nextFunction -lt 0 -or $nextFunction -le $functionStart) {
    throw "Cannot locate built-in updater guard function bounds"
  }

  $openBrace = $source.IndexOf("{", $functionStart, [StringComparison]::Ordinal)
  if ($openBrace -lt 0 -or $openBrace -ge $nextFunction) {
    throw "Cannot locate built-in updater guard function body"
  }

  $prefix = $source.Substring($functionStart, $openBrace - $functionStart + 1)
  $replacementText = "$prefix" + "return!1/*$UpdaterDisableMarker*/}"
  $replacementBytes = [System.Text.Encoding]::UTF8.GetBytes($replacementText)
  $functionStartByte = [System.Text.Encoding]::UTF8.GetByteCount($source.Substring(0, $functionStart))
  $nextFunctionByte = [System.Text.Encoding]::UTF8.GetByteCount($source.Substring(0, $nextFunction))
  $segmentByteLength = $nextFunctionByte - $functionStartByte
  if ($replacementBytes.Length -gt $segmentByteLength) {
    throw "Built-in updater guard patch is too large"
  }

  $nextBytes = New-Object byte[] $MainBytes.Length
  [Array]::Copy($MainBytes, $nextBytes, $MainBytes.Length)
  $replacement = New-Object byte[] $segmentByteLength
  for ($i = 0; $i -lt $replacement.Length; $i++) { $replacement[$i] = 32 }
  [Array]::Copy($replacementBytes, 0, $replacement, 0, $replacementBytes.Length)
  [Array]::Copy($replacement, 0, $nextBytes, $functionStartByte, $replacement.Length)
  return [pscustomobject]@{ Bytes = $nextBytes; Changed = $true }
}

function Write-RuntimeFiles {
  param([string]$RuntimeDir)
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  foreach ($relative in @("dictionary\zh-CN.js", "shared\translation-policy.js", "main\translation-service.js", "main\translation-host.js", "main\translation-settings-preload.js", "main\translation-settings.html", "main\translation-settings.css", "main\translation-settings.js")) {
    [System.IO.File]::WriteAllText((Join-Path $RuntimeDir (Split-Path $relative -Leaf)), (Read-PayloadText ("payload\src\" + $relative)), (New-Object System.Text.UTF8Encoding($false)))
  }
  [System.IO.File]::WriteAllText((Join-Path $RuntimeDir $PayloadFile), (Build-Payload), [System.Text.Encoding]::UTF8)
  [System.IO.File]::WriteAllText((Join-Path $RuntimeDir $MainPayloadFile), (Build-MainPayload), [System.Text.Encoding]::UTF8)
}

function Get-PatcherExecutablePath {
  $currentProcessPath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  if ($currentProcessPath -and (Split-Path -Leaf $currentProcessPath) -ieq "FigBoost.exe") {
    return $currentProcessPath
  }
  $candidate = Join-Path (Get-BaseDir) "FigBoost.exe"
  if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  return $currentProcessPath
}

function Get-FeatureConfigPath {
  param([string]$RuntimeDir)
  return (Join-Path $RuntimeDir $FeatureConfigFile)
}

function ConvertTo-JsonSafePath {
  param([string]$Value)
  if (-not $Value) { return "" }
  return $Value.Replace("\", "/")
}

function Read-FeatureConfig {
  param([string]$RuntimeDir)
  $path = Get-FeatureConfigPath $RuntimeDir
  if (Test-Path -LiteralPath $path) {
    try {
      $config = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
      if ($config.PSObject.Properties.Name -notcontains "enabledFeatures") { $config | Add-Member -NotePropertyName enabledFeatures -NotePropertyValue @() }
      if ($config.PSObject.Properties.Name -notcontains "preferredAppDir") { $config | Add-Member -NotePropertyName preferredAppDir -NotePropertyValue "" }
      return $config
    } catch {}
  }
  return [pscustomobject]@{
    enabledFeatures = @()
    patcherPath = ConvertTo-JsonSafePath (Get-PatcherExecutablePath)
    runtimeDir = ConvertTo-JsonSafePath $RuntimeDir
    preferredAppDir = ""
  }
}

function Write-FeatureConfig {
  param([string]$RuntimeDir, [string[]]$EnabledFeatures)
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  $current = Read-FeatureConfig $RuntimeDir
  $config = [pscustomobject]@{
    enabledFeatures = @($EnabledFeatures | Sort-Object -Unique)
    patcherPath = ConvertTo-JsonSafePath (Get-PatcherExecutablePath)
    runtimeDir = ConvertTo-JsonSafePath $RuntimeDir
    preferredAppDir = ConvertTo-JsonSafePath ([string]$current.preferredAppDir)
  }
  [System.IO.File]::WriteAllText((Get-FeatureConfigPath $RuntimeDir), ($config | ConvertTo-Json -Depth 6), $Utf8NoBom)
  return $config
}

function Get-PreferredAppDir {
  param([string]$RuntimeDir)
  $config = Read-FeatureConfig $RuntimeDir
  $preferred = [string]$config.preferredAppDir
  if ($preferred -and (Test-FigmaAppDir $preferred)) {
    return (Resolve-Path -LiteralPath $preferred).Path
  }
  return ""
}

function Resolve-ManagedFigmaAppDir {
  param([string]$RuntimeDir, [string]$SelectedAppDir = "")
  $preferred = Get-PreferredAppDir $RuntimeDir
  if ($preferred) { return $preferred }
  if ($SelectedAppDir -and (Test-FigmaAppDir $SelectedAppDir)) {
    return (Resolve-Path -LiteralPath $SelectedAppDir).Path
  }
  return Find-CurrentFigmaAppDir
}

function Set-PreferredAppDir {
  param([string]$RuntimeDir, [string]$AppDir)
  if (-not $AppDir) { throw "请先选择 Figma app-* 目录。" }
  if (-not (Test-Path -LiteralPath $AppDir)) { throw "客户端目录不存在：$AppDir" }
  $resolvedAppDir = (Resolve-Path -LiteralPath $AppDir).Path
  if (-not (Test-FigmaAppDir $resolvedAppDir)) {
    throw "无效的 Figma app-* 目录：$resolvedAppDir"
  }
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  $config = Read-FeatureConfig $RuntimeDir
  $next = [pscustomobject]@{
    enabledFeatures = @($config.enabledFeatures | Sort-Object -Unique)
    patcherPath = Get-PatcherExecutablePath
    runtimeDir = $RuntimeDir
    preferredAppDir = $resolvedAppDir
  }
  [System.IO.File]::WriteAllText((Get-FeatureConfigPath $RuntimeDir), ($next | ConvertTo-Json -Depth 6), $Utf8NoBom)
  return $resolvedAppDir
}

function Test-DirectoryEmpty {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  $item = Get-Item -LiteralPath $Path
  if (-not $item.PSIsContainer) { return $false }
  $child = Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop | Select-Object -First 1
  return (-not $child)
}

function Move-FigmaAppDir {
  param([string]$SourceAppDir, [string]$DestinationDir, [string]$RuntimeDir)
  if (-not $SourceAppDir) { throw "未找到可迁移的 Figma 客户端目录。" }
  if (-not $DestinationDir) { throw "请先输入目标客户端目录。" }
  $source = (Resolve-Path -LiteralPath $SourceAppDir).Path
  if (-not (Test-FigmaAppDir $source)) {
    throw "源目录不是有效的 Figma app-* 目录：$source"
  }

  $destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DestinationDir)
  $comparison = [StringComparison]::OrdinalIgnoreCase
  if ($destination.Equals($source, $comparison)) {
    $selected = Set-PreferredAppDir $RuntimeDir $source
    return [pscustomobject]@{ AppDir = $selected; Migrated = $false; SourceAppDir = $source }
  }
  if ($destination.StartsWith($source.TrimEnd('\') + "\", $comparison)) {
    throw "目标目录不能位于源客户端目录内部：$destination"
  }
  if ((Test-Path -LiteralPath $destination) -and (Test-FigmaAppDir $destination)) {
    $selected = Set-PreferredAppDir $RuntimeDir $destination
    return [pscustomobject]@{ AppDir = $selected; Migrated = $false; SourceAppDir = $source }
  }
  if (-not (Test-DirectoryEmpty $destination)) {
    throw "目标目录不是空目录，也不是完整的 Figma 客户端目录：$destination"
  }

  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse -Force
  if (-not (Test-FigmaAppDir $destination)) {
    throw "复制完成后目标目录仍不是有效的 Figma 客户端目录：$destination"
  }
  $selected = Set-PreferredAppDir $RuntimeDir $destination
  return [pscustomobject]@{ AppDir = $selected; Migrated = $true; SourceAppDir = $source }
}

function Sync-FigmaAppDir {
  param([string]$SourceAppDir, [string]$DestinationDir)
  if (-not $SourceAppDir) { throw "未找到更新后的 Figma 客户端目录。" }
  if (-not $DestinationDir) { throw "未找到要覆盖的 Figma 客户端目录。" }
  $source = (Resolve-Path -LiteralPath $SourceAppDir).Path
  $destination = (Resolve-Path -LiteralPath $DestinationDir).Path
  if (-not (Test-FigmaAppDir $source)) {
    throw "源目录不是有效的 Figma app-* 目录：$source"
  }
  if (-not (Test-FigmaAppDir $destination)) {
    throw "目标目录不是有效的 Figma 客户端目录：$destination"
  }
  $comparison = [StringComparison]::OrdinalIgnoreCase
  if ($destination.Equals($source, $comparison)) {
    return $destination
  }
  if ($destination.StartsWith($source.TrimEnd('\') + "\", $comparison)) {
    throw "目标目录不能位于源客户端目录内部：$destination"
  }
  if ($source.StartsWith($destination.TrimEnd('\') + "\", $comparison)) {
    throw "源目录不能位于目标客户端目录内部：$source"
  }

  Get-ChildItem -LiteralPath $destination -Force | Remove-Item -Recurse -Force
  Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse -Force
  if (-not (Test-FigmaAppDir $destination)) {
    throw "覆盖完成后目标目录仍不是有效的 Figma 客户端目录：$destination"
  }
  return $destination
}

function Select-UpdatedFigmaAppDir {
  param([string]$RuntimeDir, [string]$ReleaseVersion)
  $preferred = Get-PreferredAppDir $RuntimeDir
  $updatedOfficialAppDir = Find-FigmaAppDirAtLeastVersion $ReleaseVersion
  if ($preferred -and (-not (Test-OfficialFigmaAppDir $preferred))) {
    $syncedAppDir = Sync-FigmaAppDir $updatedOfficialAppDir $preferred
    return Set-PreferredAppDir $RuntimeDir $syncedAppDir
  }
  return Set-PreferredAppDir $RuntimeDir $updatedOfficialAppDir
}

function Repair-FeatureConfigEncoding {
  param([string]$RuntimeDir)
  $path = Get-FeatureConfigPath $RuntimeDir
  if (-not (Test-Path -LiteralPath $path)) { return }
  $config = Read-FeatureConfig $RuntimeDir
  [System.IO.File]::WriteAllText($path, ($config | ConvertTo-Json -Depth 6), $Utf8NoBom)
}

function Test-FeatureInstalled {
  param([string]$RuntimeDir, [string]$FeatureId)
  $config = Read-FeatureConfig $RuntimeDir
  return @($config.enabledFeatures) -contains $FeatureId
}

function Install-Feature {
  param([string]$FeatureId, [string]$SelectedAppDir, [string]$SelectedRuntimeDir, [string[]]$ShortcutRoots = $null)
  $appDir = Resolve-ManagedFigmaAppDir $SelectedRuntimeDir $SelectedAppDir
  $restartAfterInstall = Stop-FigmaForPatch $appDir -Force
  $config = Read-FeatureConfig $SelectedRuntimeDir
  $features = @($config.enabledFeatures)
  if ($features -notcontains $FeatureId) { $features += $FeatureId }
  Write-FeatureConfig $SelectedRuntimeDir $features | Out-Null
  Write-RuntimeFiles $SelectedRuntimeDir
  $target = Resolve-Target $appDir
  $status = Get-PatchStatus $target $SelectedRuntimeDir
  if (-not $status.Patched -or -not $status.HasBuiltInUpdaterDisabled) {
    $status = Install-Patch $appDir $SelectedRuntimeDir -Force -SkipProcessCheck -ShortcutRoots $ShortcutRoots
    $status.RestartedFigma = $restartAfterInstall -and (Start-FigmaClient $target.AppDir)
    return $status
  }
  Repair-FigmaShortcuts $appDir $ShortcutRoots
  $status | Add-Member -NotePropertyName RestartedFigma -NotePropertyValue ($restartAfterInstall -and (Start-FigmaClient $target.AppDir)) -Force
  return $status
}

function Uninstall-Feature {
  param([string]$FeatureId, [string]$SelectedRuntimeDir, [string]$SelectedAppDir = "", [string[]]$ShortcutRoots = $null)
  $appDir = ""
  $restartAfterUninstall = $false
  if ($SelectedAppDir) {
    $appDir = Resolve-ManagedFigmaAppDir $SelectedRuntimeDir $SelectedAppDir
    $restartAfterUninstall = Stop-FigmaForPatch $appDir -Force
  }
  $config = Read-FeatureConfig $SelectedRuntimeDir
  $features = @($config.enabledFeatures | Where-Object { $_ -ne $FeatureId })
  Write-FeatureConfig $SelectedRuntimeDir $features | Out-Null
  if ($appDir) {
    Repair-FigmaShortcuts $appDir $ShortcutRoots
    $status = Get-CompleteStatus $appDir $SelectedRuntimeDir
    $status | Add-Member -NotePropertyName RestartedFigma -NotePropertyValue ($restartAfterUninstall -and (Start-FigmaClient $appDir)) -Force
    return $status
  }
}

function Get-FeatureInstallEmptySelectionMessage {
  param([int]$CheckedFeatureCount)
  if ($CheckedFeatureCount -gt 0) { return "所选功能已经安装，不需要重复安装。" }
  return "请先勾选要安装的附加功能。"
}

function Get-PatchStatus {
  param($Target, [string]$RuntimeDir)
  $asar = Read-Asar $Target.AsarPath
  $main = Get-AsarFileSlice $asar "main.js"
  $source = [System.Text.Encoding]::UTF8.GetString($main.Bytes)
  return [pscustomobject]@{
    PatcherVersion = $PatcherVersion
    PayloadVersion = $(if (Get-InstalledPayloadVersion $RuntimeDir) { Get-InstalledPayloadVersion $RuntimeDir } else { Get-PayloadVersion })
    AppDir = $Target.AppDir
    FigmaVersion = $Target.FigmaVersion
    AsarPath = $Target.AsarPath
    BackupPath = $Target.BackupPath
    RuntimeDir = (Resolve-Path -LiteralPath $RuntimeDir -ErrorAction SilentlyContinue).Path
    Patched = $source.Contains($PatchMarker)
    HasBackup = Test-Path -LiteralPath $Target.BackupPath
    HasRuntimePayload = Test-Path -LiteralPath (Join-Path $RuntimeDir $PayloadFile)
    HasRuntimeMainPayload = Test-Path -LiteralPath (Join-Path $RuntimeDir $MainPayloadFile)
    HasFeatureConfig = Test-Path -LiteralPath (Join-Path $RuntimeDir $FeatureConfigFile)
    HasBuiltInUpdaterDisabled = $source.Contains($UpdaterDisableMarker)
    MainSha256 = Get-Sha256Hex $main.Bytes
  }
}

function Get-CompleteStatus {
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$CheckOfficial)
  $target = Resolve-Target (Resolve-ManagedFigmaAppDir $SelectedRuntimeDir $SelectedAppDir)
  $status = Get-PatchStatus $target $SelectedRuntimeDir
  if ($CheckOfficial) {
    $release = Get-OfficialLatestFigmaRelease $status.FigmaVersion
    $status | Add-Member -NotePropertyName OfficialLatestVersion -NotePropertyValue $release.Version -Force
    $status | Add-Member -NotePropertyName IsOfficialLatest -NotePropertyValue ((Compare-VersionString $status.FigmaVersion $release.Version) -ge 0) -Force
  }
  return $status
}

function Patch-Asar {
  param($Target, [string]$RuntimeDir)
  $asar = Read-Asar $Target.AsarPath
  $main = Get-AsarFileSlice $asar "main.js"
  $nextBytes = $main.Bytes
  $changed = $false
  $source = [System.Text.Encoding]::UTF8.GetString($nextBytes)
  $alreadyPatched = $source.Contains($PatchMarker)

  $updaterPatch = Disable-BuiltInUpdaterInMain $nextBytes
  $nextBytes = $updaterPatch.Bytes
  if ($updaterPatch.Changed) { $changed = $true }

  if (-not $alreadyPatched) {
    $needle = [System.Text.Encoding]::UTF8.GetBytes($LicenseCommentTarget)
    $targetIndex = Get-BytesIndex $nextBytes $needle
    if ($targetIndex -lt 0) {
      throw "Cannot find bundled license comment injection target"
    }

    $hook = Build-MainHook $RuntimeDir
    $hookBytes = [System.Text.Encoding]::UTF8.GetBytes($hook)
    $chunkSize = $nextBytes.Length - $targetIndex
    if ($hookBytes.Length -gt $chunkSize) {
      throw "Main hook is too large for in-place patch: $($hookBytes.Length) bytes"
    }

    $hookedBytes = New-Object byte[] $nextBytes.Length
    [Array]::Copy($nextBytes, $hookedBytes, $nextBytes.Length)
    $replacement = New-Object byte[] $chunkSize
    for ($i = 0; $i -lt $replacement.Length; $i++) { $replacement[$i] = 32 }
    [Array]::Copy($hookBytes, 0, $replacement, 0, $hookBytes.Length)
    [Array]::Copy($replacement, 0, $hookedBytes, $targetIndex, $replacement.Length)
    $nextBytes = $hookedBytes
    $changed = $true
  }

  if (-not $changed) {
    return [pscustomobject]@{ Changed = $false; AlreadyPatched = $true }
  }

  $oldHash = $null
  if ($main.Entry.integrity -and $main.Entry.integrity.hash) {
    $oldHash = [string]$main.Entry.integrity.hash
  }
  $nextHash = Get-Sha256Hex $nextBytes
  $nextHeaderText = $asar.HeaderText
  if ($oldHash) {
    $nextHeaderText = $nextHeaderText.Replace($oldHash, $nextHash)
  }
  $nextHeaderBytes = [System.Text.Encoding]::UTF8.GetBytes($nextHeaderText)
  if ($nextHeaderBytes.Length -ne [System.Text.Encoding]::UTF8.GetByteCount($asar.HeaderText)) {
    throw "In-place patch changed asar header byte length"
  }

  [Array]::Copy($nextHeaderBytes, 0, $asar.Bytes, $asar.HeaderStart, $nextHeaderBytes.Length)
  [Array]::Copy($nextBytes, 0, $asar.Bytes, $main.Start, $nextBytes.Length)
  [System.IO.File]::WriteAllBytes($Target.AsarPath, $asar.Bytes)
  return [pscustomobject]@{ Changed = $true; Hash = $nextHash; AlreadyPatched = $alreadyPatched }
}

function Assert-FigmaClosed {
  param([switch]$Force)
  if ($SelfTest) { return $false }
  return Stop-FigmaForPatch "" -Force:$Force
}

function Stop-FigmaForPatch {
  param([string]$AppDir, [switch]$Force)
  if ($SelfTest) { return $false }
  $running = Get-Process -Name "Figma" -ErrorAction SilentlyContinue
  if ($running) {
    if (-not $Force) {
      throw "Figma is running. Close Figma first, or enable Force close Figma."
    }
    $targetExe = if ($AppDir) { Join-Path $AppDir "Figma.exe" } else { "" }
    $restartAfterInstall = $false
    foreach ($process in @($running)) {
      try {
        $processPath = $process.MainModule.FileName
        if ((-not $targetExe) -or $processPath.Equals($targetExe, [StringComparison]::OrdinalIgnoreCase)) {
          $restartAfterInstall = $true
        }
      } catch {
        if (-not $targetExe) { $restartAfterInstall = $true }
      }
    }
    $running | Stop-Process -Force
    return $restartAfterInstall
  }
  return $false
}

function Start-FigmaClient {
  param([string]$AppDir)
  if ($SelfTest) { return $false }
  if (-not $AppDir) { return $false }
  $appExe = Join-Path $AppDir "Figma.exe"
  if (-not (Test-Path -LiteralPath $appExe)) { return $false }
  try {
    Start-Process -FilePath $appExe -WorkingDirectory $AppDir | Out-Null
    Write-Log "Restarted Figma client: $appExe"
    return $true
  } catch {
    Write-Log "Failed to restart Figma client: $($_.Exception.Message)"
    return $false
  }
}

function Install-Patch {
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$Force, [switch]$SkipProcessCheck, [string[]]$ShortcutRoots = $null)
  $appDir = Resolve-ManagedFigmaAppDir $SelectedRuntimeDir $SelectedAppDir
  $target = Resolve-Target $appDir
  $existingStatus = Get-PatchStatus $target $SelectedRuntimeDir
  $runtimeCurrent = $false
  if ($existingStatus.HasRuntimePayload -and $existingStatus.HasRuntimeMainPayload) {
    $runtimeCurrent = ([System.IO.File]::ReadAllText((Join-Path $SelectedRuntimeDir $PayloadFile)) -eq (Build-Payload)) -and ([System.IO.File]::ReadAllText((Join-Path $SelectedRuntimeDir $MainPayloadFile)) -eq (Build-MainPayload))
    foreach ($relative in @("dictionary\zh-CN.js", "shared\translation-policy.js", "main\translation-service.js", "main\translation-host.js", "main\translation-settings-preload.js", "main\translation-settings.html", "main\translation-settings.css", "main\translation-settings.js")) {
      $supportPath = Join-Path $SelectedRuntimeDir (Split-Path $relative -Leaf)
      if (-not (Test-Path -LiteralPath $supportPath) -or [System.IO.File]::ReadAllText($supportPath) -ne (Read-PayloadText ("payload\src\" + $relative))) { $runtimeCurrent = $false }
    }
  }
  if ($runtimeCurrent -and $existingStatus.Patched -and $existingStatus.HasRuntimePayload -and $existingStatus.HasRuntimeMainPayload -and $existingStatus.HasBuiltInUpdaterDisabled) {
    [void](Write-FeatureConfig $SelectedRuntimeDir @((Read-FeatureConfig $SelectedRuntimeDir).enabledFeatures))
    $existingStatus | Add-Member -NotePropertyName AlreadyPatched -NotePropertyValue $true -Force
    $existingStatus | Add-Member -NotePropertyName RestartedFigma -NotePropertyValue $false -Force
    return $existingStatus
  }
  $restartAfterInstall = $false
  if (-not $SkipProcessCheck) { $restartAfterInstall = Stop-FigmaForPatch $appDir -Force:$Force }
  if (-not (Test-Path -LiteralPath $target.BackupPath)) {
    Copy-Item -LiteralPath $target.AsarPath -Destination $target.BackupPath -Force
    Write-Log "Backup created: $($target.BackupPath)"
  } else {
    Write-Log "Using existing backup: $($target.BackupPath)"
    $currentAsar = Read-Asar $target.AsarPath
    $currentMain = Get-AsarFileSlice $currentAsar "main.js"
    $currentSource = [System.Text.Encoding]::UTF8.GetString($currentMain.Bytes)
    if (-not $currentSource.Contains($PatchMarker)) {
      Copy-Item -LiteralPath $target.BackupPath -Destination $target.AsarPath -Force
      Write-Log "Restored original app.asar before updating patch hook."
    }
  }
  Write-RuntimeFiles $SelectedRuntimeDir
  [void](Write-FeatureConfig $SelectedRuntimeDir @((Read-FeatureConfig $SelectedRuntimeDir).enabledFeatures))
  $result = Patch-Asar $target $SelectedRuntimeDir
  Write-Log "Install result: $($result | ConvertTo-Json -Compress)"
  $status = Get-PatchStatus $target $SelectedRuntimeDir
  $status | Add-Member -NotePropertyName AlreadyPatched -NotePropertyValue ([bool]$result.AlreadyPatched -and $runtimeCurrent) -Force
  Repair-FigmaShortcuts $target.AppDir $ShortcutRoots
  $status | Add-Member -NotePropertyName RestartedFigma -NotePropertyValue ($restartAfterInstall -and (Start-FigmaClient $target.AppDir)) -Force
  return $status
}

function Uninstall-Patch {
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$Force, [switch]$SkipProcessCheck)
  if (-not $SkipProcessCheck) { [void](Assert-FigmaClosed -Force:$Force) }
  $target = Resolve-Target (Resolve-ManagedFigmaAppDir $SelectedRuntimeDir $SelectedAppDir)
  if (-not (Test-Path -LiteralPath $target.BackupPath)) {
    throw "Backup not found: $($target.BackupPath)"
  }
  Copy-Item -LiteralPath $target.BackupPath -Destination $target.AsarPath -Force
  Write-Log "Restored original app.asar from backup."
  return Get-PatchStatus $target $SelectedRuntimeDir
}

function Update-FigmaOfficial {
  param([string]$SelectedRuntimeDir, [switch]$Force, [scriptblock]$Progress)
  if ($Progress) { & $Progress 5 "正在检测当前 Figma 版本..." }
  $currentTarget = Resolve-Target (Resolve-ManagedFigmaAppDir $SelectedRuntimeDir)
  if ($Progress) { & $Progress 15 "正在检查官方最新版..." }
  $release = Get-OfficialLatestFigmaRelease $currentTarget.FigmaVersion
  if ((Compare-VersionString $currentTarget.FigmaVersion $release.Version) -ge 0) {
    if ($Progress) { & $Progress 70 "当前已经是官方最新版，正在安装汉化补丁..." }
    Repair-FigmaShortcuts $currentTarget.AppDir
    $status = Install-Patch $currentTarget.AppDir $SelectedRuntimeDir -Force:$Force
    if ($Progress) { & $Progress 100 "补丁安装完成。" }
    return $status
  }

  if ($Progress) { & $Progress 25 "正在关闭 Figma 客户端..." }
  [void](Assert-FigmaClosed -Force:$Force)
  $installerExt = [System.IO.Path]::GetExtension(([Uri]$release.InstallerUrl).AbsolutePath)
  if (-not $installerExt) { $installerExt = ".exe" }
  $installer = Join-Path ([System.IO.Path]::GetTempPath()) "FigmaSetup-official-latest$installerExt"
  try {
    if ($Progress) { & $Progress 35 "正在下载 Figma $($release.Version) 官方安装包..." }
    Invoke-WebRequest -Uri $release.InstallerUrl -OutFile $installer -UseBasicParsing -TimeoutSec 900
    if ($Progress) { & $Progress 55 "正在运行官方安装程序..." }
    if ($installerExt -ieq ".msi") {
      $process = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", $installer, "/qn", "/norestart") -PassThru
    } else {
      $process = Start-Process -FilePath $installer -ArgumentList "/S" -PassThru
    }
    if ($Progress) { & $Progress 65 "正在等待官方安装完成..." }
    if (-not $process.WaitForExit(600000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "Figma official updater did not finish within 10 minutes."
    }
    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
      throw "Figma official updater exited with code $($process.ExitCode)."
    }
  } finally {
    Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
  }

  if ($Progress) { & $Progress 78 "正在检测更新后的客户端版本..." }
  Start-Sleep -Seconds 3
  if ($Progress) { & $Progress 82 "正在应用更新后的客户端目录..." }
  $targetAppDir = Select-UpdatedFigmaAppDir $SelectedRuntimeDir $release.Version
  $target = Resolve-Target $targetAppDir
  if ((Compare-VersionString $target.FigmaVersion $release.Version) -lt 0) {
    throw "Figma update did not reach official version $($release.Version). Current version: $($target.FigmaVersion)."
  }
  if ($Progress) { & $Progress 88 "正在修复快捷方式并安装汉化补丁..." }
  Repair-FigmaShortcuts $target.AppDir
  $status = Install-Patch $target.AppDir $SelectedRuntimeDir -Force:$Force
  if ($Progress) { & $Progress 100 "Figma 更新完成，汉化补丁已安装。" }
  return $status
}

function Invoke-UpdateFigmaOfficialWithProgress {
  param([string]$SelectedRuntimeDir, [switch]$Force)
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "Figma 客户端更新"
  $form.StartPosition = "CenterScreen"
  $form.Width = 520
  $form.Height = 180
  $form.FormBorderStyle = "FixedDialog"
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.BackColor = [System.Drawing.Color]::FromArgb(246, 248, 251)
  $form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

  $label = New-Object System.Windows.Forms.Label
  $label.Left = 22
  $label.Top = 24
  $label.Width = 460
  $label.Height = 42
  $label.Text = "准备更新..."

  $progressBar = New-Object System.Windows.Forms.ProgressBar
  $progressBar.Left = 22
  $progressBar.Top = 74
  $progressBar.Width = 460
  $progressBar.Height = 18
  $progressBar.Minimum = 0
  $progressBar.Maximum = 100

  $button = New-Object System.Windows.Forms.Button
  $button.Text = "关闭"
  $button.Left = 402
  $button.Top = 108
  $button.Width = 80
  $button.Height = 28
  $button.Enabled = $false
  $button.Add_Click({ $form.Close() })

  $form.Controls.AddRange(@($label, $progressBar, $button))
  $form.Add_Shown({
    try {
      $progress = {
        param([int]$Percent, [string]$Message)
        $progressBar.Value = [Math]::Max(0, [Math]::Min(100, $Percent))
        $label.Text = $Message
        $form.Refresh()
        [System.Windows.Forms.Application]::DoEvents()
      }
      $result = Update-FigmaOfficial $SelectedRuntimeDir -Force:$Force -Progress $progress
      $label.Text = "更新完成。Figma $($result.FigmaVersion)，补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })。"
      $progressBar.Value = 100
    } catch {
      $label.Text = "更新失败：$($_.Exception.Message)"
      $progressBar.Value = 0
      [System.Windows.Forms.MessageBox]::Show($label.Text, "Figma 客户端更新", "OK", "Error") | Out-Null
    } finally {
      $button.Enabled = $true
      $form.Refresh()
    }
  })

  [void]$form.ShowDialog()
}

function Repair-FigmaShortcuts {
  param([string]$AppDir, [string[]]$ShortcutRoots = $null)
  if (-not (Test-FigmaAppDir $AppDir)) { return }
  $figmaRoot = Split-Path -Parent $AppDir
  $launcher = Join-Path $figmaRoot "Figma.exe"
  $appExe = Join-Path $AppDir "Figma.exe"
  $target = if (Test-Path -LiteralPath $launcher) { $launcher } else { $appExe }
  $workingDirectory = Split-Path -Parent $target
  $shortcutRoots = if ($ShortcutRoots) {
    @($ShortcutRoots)
  } else {
    @(
      [Environment]::GetFolderPath("Desktop"),
      [Environment]::GetFolderPath("CommonDesktopDirectory")
    )
  }
  $shortcutRoots = @($shortcutRoots | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

  try {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($root in $shortcutRoots) {
      $links = Get-ChildItem -LiteralPath $root -Filter "*.lnk" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*Figma*" }
      foreach ($link in $links) {
        $shortcut = $shell.CreateShortcut($link.FullName)
        if ($shortcut.TargetPath -and (Split-Path -Leaf $shortcut.TargetPath) -ieq "Figma.exe") {
          $shortcut.TargetPath = $target
          $shortcut.WorkingDirectory = $workingDirectory
          $shortcut.IconLocation = "$target,0"
          $shortcut.Save()
        }
      }
    }
  } catch {}
}

function New-FakeAsar {
  param([string]$AsarPath)
  $mainText = 'console.log("汉化补丁");function fakeUpdaterGuard(){console.log("Updater not enabled. Reason: test");return true}function nextFakeUpdaterBlock(){return true}' + "`n" + $LicenseCommentTarget + " test license block with enough room for the hook " + ("x" * 2200)
  $mainBytes = [System.Text.Encoding]::UTF8.GetBytes($mainText)
  $hash = Get-Sha256Hex $mainBytes
  $headerText = (@{
    files = @{
      "main.js" = @{
        size = $mainBytes.Length
        offset = "0"
        integrity = @{ hash = $hash }
      }
    }
  } | ConvertTo-Json -Compress -Depth 8)
  $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($headerText)
  $total = 16 + $headerBytes.Length + $mainBytes.Length
  $bytes = New-Object byte[] $total
  [BitConverter]::GetBytes([uint32]($headerBytes.Length + 8)).CopyTo($bytes, 4)
  [BitConverter]::GetBytes([uint32]$headerBytes.Length).CopyTo($bytes, 12)
  [Array]::Copy($headerBytes, 0, $bytes, 16, $headerBytes.Length)
  [Array]::Copy($mainBytes, 0, $bytes, 16 + $headerBytes.Length, $mainBytes.Length)
  [System.IO.File]::WriteAllBytes($AsarPath, $bytes)
}

function Invoke-SelfTest {
  $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("figboost-test-" + [Guid]::NewGuid().ToString("N"))
  $originalLocalAppData = $env:LOCALAPPDATA
  New-Item -ItemType Directory -Force -Path (Join-Path $temp "app-1.2.3\resources") | Out-Null
  $fakeAppDir = Join-Path $temp "app-1.2.3"
  $fakeAsar = Join-Path $fakeAppDir "resources\app.asar"
  $fakeRuntime = Join-Path $temp "runtime"
  $fakePreferredAppDir = Join-Path $temp "app-3.0.0"
  $shortcutRoot = Join-Path $temp "desktop"
  try {
    New-Item -ItemType Directory -Force -Path $shortcutRoot | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $fakeAppDir "Figma.exe") | Out-Null
    New-FakeAsar $fakeAsar
    New-Item -ItemType Directory -Force -Path (Join-Path $fakePreferredAppDir "resources") | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $fakePreferredAppDir "Figma.exe") | Out-Null
    New-FakeAsar (Join-Path $fakePreferredAppDir "resources\app.asar")
    $fakeLocalAppData = Join-Path $temp "localappdata"
    $fakeFigmaRoot = Join-Path $fakeLocalAppData "Figma"
    $validOlderAppDir = Join-Path $fakeFigmaRoot "app-10.1.0"
    $incompleteNewerAppDir = Join-Path $fakeFigmaRoot "app-99.9.9"
    $mismatchedNewerAppDir = Join-Path $fakeFigmaRoot "app-99.8.0"
    New-Item -ItemType Directory -Force -Path (Join-Path $validOlderAppDir "resources") | Out-Null
    New-Item -ItemType Directory -Force -Path $incompleteNewerAppDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $mismatchedNewerAppDir "resources") | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $validOlderAppDir "Figma.exe") | Out-Null
    New-FakeAsar (Join-Path $validOlderAppDir "resources\app.asar")
    New-FakeAsar (Join-Path $mismatchedNewerAppDir "resources\app.asar")
    $versionedExe = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
    if (-not $versionedExe) { $versionedExe = (Get-Command powershell.exe -ErrorAction Stop).Source }
    Copy-Item -LiteralPath $versionedExe -Destination (Join-Path $mismatchedNewerAppDir "Figma.exe") -Force
    $env:LOCALAPPDATA = $fakeLocalAppData
    $detectedAppDir = Find-LatestFigmaAppDir
    if ($detectedAppDir -ne $validOlderAppDir) { throw "Self-test did not skip incomplete or mismatched update directory." }
    if ((Get-FigmaVersionFromAppDir $mismatchedNewerAppDir) -eq "99.8.0") { throw "Self-test used folder name instead of executable version." }
    $env:LOCALAPPDATA = $originalLocalAppData
    if ((Compare-VersionString "126.4.10" "126.3.12") -le 0) { throw "Self-test version compare failed." }
    if ((Compare-VersionString "126.3.12" "126.4.10") -ge 0) { throw "Self-test version compare failed." }
    if ((Compare-VersionString "126.3.12" "126.3.12") -ne 0) { throw "Self-test version compare failed." }
    if ((Get-FigmaInstallerVersionFromText "PK Figma-126.4.11-full.nupkg") -ne "126.4.11") { throw "Self-test installer version parse failed." }
    $selectedRelease = Select-LatestFigmaRelease @(
      (New-FigmaReleaseInfo "126.3.12" "Figma 126.3.12" "msi" "feed"),
      (New-FigmaReleaseInfo "126.4.11" "Figma 126.4.11" "setup" "installer")
    )
    if ($selectedRelease.Version -ne "126.4.11") { throw "Self-test official latest selection failed." }
    $installStatus = Install-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck -ShortcutRoots @($shortcutRoot)
    if (-not $installStatus.Patched) { throw "Self-test install did not mark the app as patched." }
    if (-not $installStatus.HasBackup) { throw "Self-test did not create a backup." }
    if (-not $installStatus.HasRuntimePayload) { throw "Self-test did not write the runtime payload." }
    if (-not $installStatus.HasRuntimeMainPayload) { throw "Self-test did not write the main runtime payload." }
    if (-not $installStatus.HasBuiltInUpdaterDisabled) { throw "Self-test did not disable the built-in updater." }
    if ($installStatus.PayloadVersion -ne (Get-PayloadVersion)) { throw "Self-test payload version mismatch." }
    $manualUpdateConfig = Read-FeatureConfig $fakeRuntime
    if (-not $manualUpdateConfig.patcherPath -or $manualUpdateConfig.runtimeDir -ne (ConvertTo-JsonSafePath $fakeRuntime)) { throw "Self-test normal install did not configure manual updates." }
    if (@($manualUpdateConfig.enabledFeatures).Count -ne 0) { throw "Self-test normal install enabled an optional feature." }
    $manualUpdateConfig.patcherPath = "missing-old-patcher.exe"
    [System.IO.File]::WriteAllText((Get-FeatureConfigPath $fakeRuntime), ($manualUpdateConfig | ConvertTo-Json -Depth 6), $Utf8NoBom)
    $repeatInstallStatus = Install-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck -ShortcutRoots @($shortcutRoot)
    if (-not $repeatInstallStatus.AlreadyPatched) { throw "Self-test repeat install did not report already patched." }
    if ((Read-FeatureConfig $fakeRuntime).patcherPath -ne (ConvertTo-JsonSafePath (Get-PatcherExecutablePath))) { throw "Self-test repeat install did not refresh the manual updater path." }
    $personalData = Join-Path $temp "personal-data.json"
    [System.IO.File]::WriteAllText($personalData, '{"preserve":true}')
    [System.IO.File]::WriteAllText((Join-Path $fakeRuntime "translation-service.js"), "old-version")
    $refreshStatus = Install-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck -ShortcutRoots @($shortcutRoot)
    if ($refreshStatus.AlreadyPatched) { throw "Self-test did not report refreshed runtime." }
    if ([System.IO.File]::ReadAllText((Join-Path $fakeRuntime "translation-service.js")) -ne (Read-PayloadText "payload\src\main\translation-service.js")) { throw "Self-test runtime upgrade failed." }
    if ([System.IO.File]::ReadAllText($personalData) -ne '{"preserve":true}') { throw "Self-test upgrade changed personal data." }

    $asar = Read-Asar (Join-Path $fakeAppDir "resources\app.asar")
    $main = Get-AsarFileSlice $asar "main.js"
    $mainSource = [System.Text.Encoding]::UTF8.GetString($main.Bytes)
    $oldHook = $mainSource.Replace($PatchMarker, "FIGMA_ZH_OFFICIAL_MAIN_HOOK_V3").Replace("global.__FIGMA_ZH_RUNTIME_DIR__=R.dirname(Q);", "")
    [Array]::Copy([System.Text.Encoding]::UTF8.GetBytes($oldHook), 0, $asar.Bytes, $main.Start, $oldHook.Length)
    [System.IO.File]::WriteAllBytes((Join-Path $fakeAppDir "resources\app.asar"), $asar.Bytes)
    $upgradeStatus = Install-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck -ShortcutRoots @($shortcutRoot)
    if (-not $upgradeStatus.Patched) { throw "Self-test old hook upgrade did not mark the app as patched." }
    $upgradedAsar = Read-Asar (Join-Path $fakeAppDir "resources\app.asar")
    $upgradedMain = Get-AsarFileSlice $upgradedAsar "main.js"
    $upgradedSource = [System.Text.Encoding]::UTF8.GetString($upgradedMain.Bytes)
    if (-not $upgradedSource.Contains("global.__FIGMA_ZH_RUNTIME_DIR__=R.dirname(Q);")) { throw "Self-test old hook upgrade did not write runtime dir support." }
    if (-not $upgradedSource.Contains($UpdaterDisableMarker)) { throw "Self-test old hook upgrade did not preserve built-in updater disable." }
    $featureStatus = Install-Feature "auto-check-official-latest" $fakeAppDir $fakeRuntime @($shortcutRoot)
    if (-not $featureStatus.Patched) { throw "Self-test feature install did not preserve patched status." }
    if (-not (Test-FeatureInstalled $fakeRuntime "auto-check-official-latest")) { throw "Self-test feature config did not mark feature installed." }
    $savedPreferredAppDir = Set-PreferredAppDir $fakeRuntime $fakePreferredAppDir
    if ($savedPreferredAppDir -ne $fakePreferredAppDir) { throw "Self-test preferred app dir was not resolved as expected." }
    if ((Get-PreferredAppDir $fakeRuntime) -ne $fakePreferredAppDir) { throw "Self-test preferred app dir was not saved." }
    Install-Feature "auto-check-official-latest" $fakeAppDir $fakeRuntime @($shortcutRoot) | Out-Null
    if ((Get-PreferredAppDir $fakeRuntime) -ne $fakePreferredAppDir) { throw "Self-test feature config did not preserve preferred app dir." }
    Uninstall-Feature "auto-check-official-latest" $fakeRuntime
    if (Test-FeatureInstalled $fakeRuntime "auto-check-official-latest") { throw "Self-test feature uninstall did not clear feature config." }
    if ((Get-PreferredAppDir $fakeRuntime) -ne $fakePreferredAppDir) { throw "Self-test feature uninstall did not preserve preferred app dir." }
    Uninstall-Feature "auto-check-official-latest" $fakeRuntime
    if (Test-FeatureInstalled $fakeRuntime "auto-check-official-latest") { throw "Self-test repeat feature uninstall changed feature config." }
    Install-Feature "auto-check-official-latest" $fakeAppDir $fakeRuntime @($shortcutRoot) | Out-Null
    Remove-Item -LiteralPath (Join-Path $fakePreferredAppDir "Figma.exe") -Force
    if (Get-PreferredAppDir $fakeRuntime) { throw "Self-test preferred app dir did not ignore invalid directories." }
    New-Item -ItemType File -Force -Path (Join-Path $fakePreferredAppDir "Figma.exe") | Out-Null
    $migrationTarget = Join-Path $temp "moved-figma"
    $migrationResult = Move-FigmaAppDir $fakeAppDir $migrationTarget $fakeRuntime
    if (-not $migrationResult.Migrated) { throw "Self-test migration did not report a copied client." }
    if (-not (Test-FigmaAppDir $migrationTarget)) { throw "Self-test migration did not create a valid target client." }
    if ((Get-PreferredAppDir $fakeRuntime) -ne $migrationTarget) { throw "Self-test migration did not save preferred app dir." }
    $invalidMigrationTarget = Join-Path $temp "invalid-target"
    New-Item -ItemType Directory -Force -Path $invalidMigrationTarget | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $invalidMigrationTarget "keep.txt") | Out-Null
    $invalidMigrationFailed = $false
    try {
      Move-FigmaAppDir $fakeAppDir $invalidMigrationTarget $fakeRuntime | Out-Null
    } catch {
      $invalidMigrationFailed = $true
    }
    if (-not $invalidMigrationFailed) { throw "Self-test migration allowed a non-empty invalid target." }
    if (-not (Test-Path -LiteralPath (Join-Path $invalidMigrationTarget "keep.txt"))) { throw "Self-test migration overwrote invalid target contents." }
    $existingTargetResult = Move-FigmaAppDir $fakeAppDir $fakePreferredAppDir $fakeRuntime
    if ($existingTargetResult.Migrated) { throw "Self-test migration copied over an existing valid target." }
    if ((Get-PreferredAppDir $fakeRuntime) -ne $fakePreferredAppDir) { throw "Self-test existing target did not update preferred app dir." }
    New-Item -ItemType Directory -Force -Path $shortcutRoot | Out-Null
    $launcherPath = Join-Path $temp "Figma.exe"
    New-Item -ItemType File -Force -Path $launcherPath | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcutPath = Join-Path $shortcutRoot "Figma.lnk"
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $fakeAppDir "Figma.exe"
    $shortcut.WorkingDirectory = $fakeAppDir
    $shortcut.IconLocation = "$($shortcut.TargetPath),0"
    $shortcut.Save()
    Repair-FigmaShortcuts $fakeAppDir @($shortcutRoot)
    if (-not (Test-Path -LiteralPath $shortcutPath)) { throw "Self-test shortcut repair deleted shortcut." }
    $repairedShortcut = $shell.CreateShortcut($shortcutPath)
    if ($repairedShortcut.TargetPath -ne $launcherPath) { throw "Self-test shortcut repair did not prefer root launcher." }
    if ($repairedShortcut.WorkingDirectory -ne $temp) { throw "Self-test shortcut repair did not use launcher working directory." }
    Remove-Item -LiteralPath $launcherPath -Force
    Repair-FigmaShortcuts $fakeAppDir @($shortcutRoot)
    if (-not (Test-Path -LiteralPath $shortcutPath)) { throw "Self-test fallback shortcut repair deleted shortcut." }
    $fallbackShortcut = $shell.CreateShortcut($shortcutPath)
    if ($fallbackShortcut.TargetPath -ne (Join-Path $fakeAppDir "Figma.exe")) { throw "Self-test shortcut repair did not fall back to app executable." }
    if ($fallbackShortcut.WorkingDirectory -ne $fakeAppDir) { throw "Self-test shortcut repair did not use app working directory." }
    Set-PreferredAppDir $fakeRuntime $fakePreferredAppDir | Out-Null
    $shortcut.TargetPath = Join-Path $fakeAppDir "Figma.exe"
    $shortcut.WorkingDirectory = $fakeAppDir
    $shortcut.IconLocation = "$($shortcut.TargetPath),0"
    $shortcut.Save()
    if ((Resolve-ManagedFigmaAppDir $fakeRuntime $fakeAppDir) -ne $fakePreferredAppDir) { throw "Self-test managed path did not prefer saved app dir." }
    Install-Patch $fakePreferredAppDir $fakeRuntime -SkipProcessCheck -ShortcutRoots @($shortcutRoot) | Out-Null
    Install-Feature "auto-check-official-latest" $fakeAppDir $fakeRuntime @($shortcutRoot) | Out-Null
    $preferredShortcut = $shell.CreateShortcut($shortcutPath)
    if ($preferredShortcut.TargetPath -ne (Join-Path $fakePreferredAppDir "Figma.exe")) { throw "Self-test feature install did not repair shortcut to preferred app dir." }
    if ($preferredShortcut.WorkingDirectory -ne $fakePreferredAppDir) { throw "Self-test feature install shortcut working directory is wrong." }
    Uninstall-Feature "auto-check-official-latest" $fakeRuntime
    Repair-FigmaShortcuts (Resolve-ManagedFigmaAppDir $fakeRuntime $fakeAppDir) @($shortcutRoot)
    if (-not (Test-Path -LiteralPath $shortcutPath)) { throw "Self-test feature uninstall shortcut repair deleted shortcut." }
    $uninstalledFeatureShortcut = $shell.CreateShortcut($shortcutPath)
    if ($uninstalledFeatureShortcut.TargetPath -ne (Join-Path $fakePreferredAppDir "Figma.exe")) { throw "Self-test feature uninstall changed shortcut away from preferred app dir." }
    $officialUpdateAppDir = Join-Path $fakeFigmaRoot "app-11.0.0"
    New-Item -ItemType Directory -Force -Path (Join-Path $officialUpdateAppDir "resources") | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $officialUpdateAppDir "Figma.exe") | Out-Null
    New-FakeAsar (Join-Path $officialUpdateAppDir "resources\app.asar")
    $env:LOCALAPPDATA = $fakeLocalAppData
    Set-PreferredAppDir $fakeRuntime $validOlderAppDir | Out-Null
    $selectedOfficialUpdate = Select-UpdatedFigmaAppDir $fakeRuntime "11.0.0"
    if ($selectedOfficialUpdate -ne $officialUpdateAppDir) { throw "Self-test official update did not select the updated app dir." }
    if ((Get-PreferredAppDir $fakeRuntime) -ne $officialUpdateAppDir) { throw "Self-test official update did not save the updated app dir." }
    $managedUpdateSourceDir = Join-Path $fakeFigmaRoot "app-12.0.0"
    $managedUpdateTargetDir = Join-Path $temp "managed-app-12.0.0"
    New-Item -ItemType Directory -Force -Path (Join-Path $managedUpdateSourceDir "resources") | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $managedUpdateSourceDir "Figma.exe") | Out-Null
    New-FakeAsar (Join-Path $managedUpdateSourceDir "resources\app.asar")
    New-Item -ItemType File -Force -Path (Join-Path $managedUpdateSourceDir "updated-client.txt") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $managedUpdateTargetDir "resources") | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $managedUpdateTargetDir "Figma.exe") | Out-Null
    New-FakeAsar (Join-Path $managedUpdateTargetDir "resources\app.asar")
    New-Item -ItemType File -Force -Path (Join-Path $managedUpdateTargetDir "old-client.txt") | Out-Null
    Set-PreferredAppDir $fakeRuntime $managedUpdateTargetDir | Out-Null
    $selectedManagedUpdate = Select-UpdatedFigmaAppDir $fakeRuntime "12.0.0"
    if ($selectedManagedUpdate -ne $managedUpdateTargetDir) { throw "Self-test managed update did not preserve the custom app dir." }
    if ((Get-PreferredAppDir $fakeRuntime) -ne $managedUpdateTargetDir) { throw "Self-test managed update did not keep the custom app dir saved." }
    if (-not (Test-Path -LiteralPath (Join-Path $managedUpdateTargetDir "updated-client.txt"))) { throw "Self-test managed update did not copy updated client files." }
    if (Test-Path -LiteralPath (Join-Path $managedUpdateTargetDir "old-client.txt")) { throw "Self-test managed update did not overwrite old client files." }
    $preferredBeforeFailedUpdate = Get-PreferredAppDir $fakeRuntime
    $failedUpdatePreservedPreferred = $false
    try {
      Select-UpdatedFigmaAppDir $fakeRuntime "99.0.0" | Out-Null
    } catch {
      $failedUpdatePreservedPreferred = ((Get-PreferredAppDir $fakeRuntime) -eq $preferredBeforeFailedUpdate)
    }
    if (-not $failedUpdatePreservedPreferred) { throw "Self-test failed update changed preferred app dir." }
    $env:LOCALAPPDATA = $originalLocalAppData
    if ((Get-FeatureInstallEmptySelectionMessage 1) -ne "所选功能已经安装，不需要重复安装。") { throw "Self-test installed feature prompt is incorrect." }
    if ((Get-FeatureInstallEmptySelectionMessage 0) -ne "请先勾选要安装的附加功能。") { throw "Self-test empty feature prompt is incorrect." }
    $featureUpgradeAppDir = Join-Path $temp "app-2.0.0"
    New-Item -ItemType Directory -Force -Path (Join-Path $featureUpgradeAppDir "resources") | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $featureUpgradeAppDir "Figma.exe") | Out-Null
    $featureUpgradeAsarPath = Join-Path $featureUpgradeAppDir "resources\app.asar"
    $featureUpgradeBackupPath = Join-Path $featureUpgradeAppDir "resources\$BackupFile"
    New-FakeAsar $featureUpgradeAsarPath
    Copy-Item -LiteralPath $featureUpgradeAsarPath -Destination $featureUpgradeBackupPath -Force
    $featureUpgradeAsar = Read-Asar $featureUpgradeAsarPath
    $featureUpgradeMain = Get-AsarFileSlice $featureUpgradeAsar "main.js"
    $featureUpgradeBytes = $featureUpgradeMain.Bytes
    $featureUpgradeNeedle = [System.Text.Encoding]::UTF8.GetBytes($LicenseCommentTarget)
    $featureUpgradeIndex = Get-BytesIndex $featureUpgradeBytes $featureUpgradeNeedle
    if ($featureUpgradeIndex -lt 0) { throw "Self-test feature upgrade cannot find injection target." }
    $featureUpgradeHook = Build-MainHook $fakeRuntime
    $featureUpgradeHookBytes = [System.Text.Encoding]::UTF8.GetBytes($featureUpgradeHook)
    [Array]::Copy($featureUpgradeHookBytes, 0, $featureUpgradeBytes, $featureUpgradeIndex, $featureUpgradeHookBytes.Length)
    [Array]::Copy($featureUpgradeBytes, 0, $featureUpgradeAsar.Bytes, $featureUpgradeMain.Start, $featureUpgradeBytes.Length)
    [System.IO.File]::WriteAllBytes($featureUpgradeAsarPath, $featureUpgradeAsar.Bytes)
    Set-PreferredAppDir $fakeRuntime $featureUpgradeAppDir | Out-Null
    $featureUpgradeStatus = Install-Feature "auto-check-official-latest" $featureUpgradeAppDir $fakeRuntime @($shortcutRoot)
    if (-not $featureUpgradeStatus.HasBuiltInUpdaterDisabled) { throw "Self-test feature install did not upgrade updater guard." }
    $featureConfigPath = Get-FeatureConfigPath $fakeRuntime
    if (-not (Test-Path -LiteralPath $featureConfigPath)) { throw "Self-test feature config was not written." }
    $runtimeMainSource = [System.IO.File]::ReadAllText((Join-Path $fakeRuntime "m.js"), [System.Text.Encoding]::UTF8)
    $runtimeContentSource = [System.IO.File]::ReadAllText((Join-Path $fakeRuntime "i.js"), [System.Text.Encoding]::UTF8)
    if ($runtimeMainSource.Contains("__FIGMA_ZH_OFFICIAL_UPDATE_CHECKED__")) { throw "Self-test runtime still uses one-shot update check." }
    if ($runtimeMainSource.Contains("scheduleOfficial" + "UpdateCheck")) { throw "Self-test runtime still schedules automatic update checks." }
    if ($runtimeMainSource.Contains('"second-instance"')) { throw "Self-test runtime still checks updates on second instance." }
    if (-not $runtimeMainSource.Contains("figboost:check-official-update")) { throw "Self-test runtime does not register manual update IPC." }
    if (-not $runtimeMainSource.Contains("// registerFigBoostFeatureMenu();")) { throw "Self-test runtime does not suspend feature menu registration." }
    if (-not $featureUpgradeHook.Contains("__FIGMA_ZH_RENDERER_PAYLOAD_PATH__")) { throw "Self-test hook does not pass renderer payload path." }
    $featureUpgradeMainPayload = Build-MainPayload
    if (-not $featureUpgradeMainPayload.Contains("figboost:\/\/check-official-update")) { throw "Self-test main payload does not handle manual update fallback navigation." }
    if (-not $featureUpgradeMainPayload.Contains("figboost:\/\/open-feature-menu")) { throw "Self-test main payload does not handle feature menu fallback navigation." }
    if (-not $featureUpgradeMainPayload.Contains("__FIGBOOST_OPEN_FEATURE_MENU__")) { throw "Self-test main payload does not expose feature menu bridge." }
    if (-not $runtimeContentSource.Contains("const SHOULD_INSTALL_UPDATE_BUTTON = false;")) { throw "Self-test content payload does not suspend the titlebar button." }
    if (-not $featureUpgradeMainPayload.Contains("if (!isFigmaPage) return;")) { throw "Self-test main payload still injects into native titlebar pages." }
    if (-not $runtimeMainSource.Contains("autoUpdater")) { throw "Self-test runtime does not guard built-in updater." }
    if (-not $runtimeMainSource.Contains("shouldSuppressBuiltInUpdateCheck")) { throw "Self-test runtime does not include downgrade suppression." }
    if (-not $runtimeMainSource.Contains('"-ShowProgress"')) { throw "Self-test runtime update launch does not request progress UI." }
    if (-not $runtimeContentSource.Contains("检查更新")) { throw "Self-test content payload does not include update menu item text." }
    if (-not $runtimeContentSource.Contains("figboost-menu-button")) { throw "Self-test content payload does not include FigBoost menu button." }
    if (-not $runtimeContentSource.Contains("figboost-menu-item")) { throw "Self-test content payload does not include FigBoost menu item." }
    if (-not $runtimeContentSource.Contains("__FIGBOOST_CHECK_OFFICIAL_UPDATE__")) { throw "Self-test content payload does not call the update bridge." }
    if (-not $runtimeContentSource.Contains("figboost://check-official-update")) { throw "Self-test content payload does not include update fallback navigation." }
    $uninstallStatus = Uninstall-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck
    if ($uninstallStatus.Patched) { throw "Self-test uninstall did not restore the original app.asar." }
    Write-Log "Self-test passed."
  } finally {
    $env:LOCALAPPDATA = $originalLocalAppData
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Format-StatusText {
  param($Status)
  return @(
    "补丁程序版本：$($Status.PatcherVersion)"
    "词库版本：$($Status.PayloadVersion)"
    "Figma 路径：$($Status.AppDir)"
    "Figma 版本：$($Status.FigmaVersion)"
    "补丁状态：$(if ($Status.Patched) { "已安装" } else { "未安装" })"
    "内置更新拦截：$(if ($Status.HasBuiltInUpdaterDisabled) { "已启用" } else { "未启用" })"
    "备份状态：$(if ($Status.HasBackup) { "已存在" } else { "未找到" })"
    "运行时文件：$(if ($Status.HasRuntimePayload) { "已生成" } else { "未生成" })"
  ) -join "`r`n"
}

function Set-StatusLabels {
  param($Status)
  $Status = @($Status)[-1]
  $script:ValueCurrentFigma.Text = "Figma $($Status.FigmaVersion)"
  $script:ValueCurrentPatch.Text = if ($Status.Patched) { "汉化：已安装" } else { "汉化：未安装" }
  $script:ValueCurrentPatch.ForeColor = if ($Status.Patched) { [System.Drawing.Color]::FromArgb(28, 113, 78) } else { [System.Drawing.Color]::FromArgb(100, 110, 125) }
  $script:ValueCurrentPayload.Text = if ($Status.Patched -and $Status.HasRuntimePayload) { "已安装词库：v$($Status.PayloadVersion)" } else { "可用词库：v$(Get-PayloadVersion)" }
}

function Show-InfoMessage {
  param([string]$Text, [string]$Title = "FigBoost")
  [System.Windows.Forms.MessageBox]::Show($Text, $Title, "OK", "Information") | Out-Null
}

function Show-ErrorMessage {
  param([string]$Text)
  [System.Windows.Forms.MessageBox]::Show($Text, "FigBoost", "OK", "Error") | Out-Null
}

function Test-IsWindows11OrNewer {
  try {
    $currentVersion = Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
    $buildText = if ($currentVersion.CurrentBuildNumber) { $currentVersion.CurrentBuildNumber } else { $currentVersion.CurrentBuild }
    $build = [int]$buildText
    return ($build -ge 22000)
  } catch {
    return ([Environment]::OSVersion.Version.Build -ge 22000)
  }
}

function Initialize-ActionButton {
  if ('FigBoost.UI.ActionButton' -as [type]) { return }
  $source = if ($EmbeddedButtonSource) {
    [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EmbeddedButtonSource))
  } else { [IO.File]::ReadAllText((Join-Path (Get-BaseDir) 'src\ActionButton.cs')) }
  Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms, System.Drawing
}

function Show-Gui {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  Initialize-ActionButton

  $isWindows11OrNewer = Test-IsWindows11OrNewer
  $form = New-Object System.Windows.Forms.Form
  $form.Text = "FigBoost v$PatcherVersion"
  $form.StartPosition = "CenterScreen"
  $form.ClientSize = New-Object System.Drawing.Size(856, 576)
  if ($isWindows11OrNewer) { $form.ClientSize = New-Object System.Drawing.Size(936, 576) }
  $form.MinimumSize = $form.Size
  $form.BackColor = [System.Drawing.Color]::FromArgb(246, 248, 251)
  $form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
  try {
    $exePath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
  } catch {}

  function New-PathDisplay {
    param([int]$Left, [int]$Top, [int]$Width)
    $panel = New-Object FigBoost.UI.PathPanel
    $panel.Left = $Left
    $panel.Top = $Top
    $panel.Width = $Width
    $panel.Height = 34
    $panel.BackColor = [System.Drawing.Color]::FromArgb(237, 240, 244)
    $panel.Anchor = "Top,Left,Right"
    $panel.TabStop = $false

    $valueLabel = New-Object System.Windows.Forms.Label
    $valueLabel.SetBounds(8, 7, ($Width - 16), 20)
    $valueLabel.AutoEllipsis = $true
    $valueLabel.UseMnemonic = $false
    $valueLabel.TextAlign = "MiddleLeft"
    $valueLabel.TabStop = $false
    $valueLabel.Cursor = [System.Windows.Forms.Cursors]::Default
    $valueLabel.BackColor = $panel.BackColor
    $valueLabel.ForeColor = [System.Drawing.Color]::FromArgb(100, 116, 139)
    $valueLabel.Anchor = "Top,Left,Right"
    $panel.Controls.Add($valueLabel)

    return [pscustomobject]@{ Panel = $panel; ValueLabel = $valueLabel }
  }

  function Set-ButtonStyle {
    param(
      [FigBoost.UI.ActionButton]$Button,
      [System.Drawing.Color]$BackColor,
      [System.Drawing.Color]$ForeColor,
      [System.Drawing.Color]$BorderColor
    )
    $Button.Configure($BackColor, $ForeColor, $BorderColor)
  }

  function New-HomeLabel {
    param([string]$Text, [int]$Left, [int]$Top, [int]$Width, [int]$Height = 22)
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Text
    $label.SetBounds($Left, $Top, $Width, $Height)
    $label.ForeColor = [System.Drawing.Color]::FromArgb(74, 85, 104)
    return $label
  }

  $contentWidth = $form.ClientSize.Width - 48
  $header = New-Object System.Windows.Forms.Panel
  $header.SetBounds(0, 0, $form.ClientSize.Width, 88)
  $header.Anchor = "Top,Left,Right"
  $header.BackColor = [System.Drawing.Color]::FromArgb(29, 36, 48)
  $title = New-HomeLabel "FigBoost" 24 14 300 30
  $title.ForeColor = [System.Drawing.Color]::White
  $title.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 16, [System.Drawing.FontStyle]::Bold)
  $subtitle = New-HomeLabel "为 Figma Desktop 安装中文界面" 24 50 430
  $subtitle.ForeColor = [System.Drawing.Color]::FromArgb(196, 207, 222)

  $btnFigBoostUpdate = New-Object FigBoost.UI.ActionButton
  $btnFigBoostUpdate.Text = "更新 FigBoost 与词库"
  $btnFigBoostUpdate.SetBounds(($form.ClientSize.Width - 224), 26, 200, 36)
  $btnFigBoostUpdate.Anchor = "Top,Right"
  $header.Controls.AddRange(@($title, $subtitle, $btnFigBoostUpdate))

  $currentGroup = New-Object System.Windows.Forms.Panel
  $currentGroup.Name = "FigmaSummary"
  $currentGroup.SetBounds(24, 112, $contentWidth, 100)
  $currentGroup.Anchor = "Top,Left,Right"
  $currentGroup.BackColor = [System.Drawing.Color]::White
  $script:ValueCurrentFigma = New-HomeLabel "未检测到 Figma" 20 16 400 30
  $script:ValueCurrentFigma.ForeColor = [System.Drawing.Color]::FromArgb(28, 35, 45)
  $script:ValueCurrentFigma.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 13, [System.Drawing.FontStyle]::Bold)
  $script:ValueCurrentPatch = New-HomeLabel "汉化：未检测" 20 58 190
  $script:ValueCurrentPayload = New-HomeLabel "可用词库：v$(Get-PayloadVersion)" 230 58 350
  $script:ValueCurrentPayload.Anchor = "Top,Left,Right"
  $btnStatus = New-Object FigBoost.UI.ActionButton
  $btnStatus.Text = "重新检测"
  $btnStatus.SetBounds(($contentWidth - 140), 32, 120, 36)
  $btnStatus.Anchor = "Top,Right"
  $currentGroup.Controls.AddRange(@($script:ValueCurrentFigma, $script:ValueCurrentPatch, $script:ValueCurrentPayload, $btnStatus))

  $labelApp = New-HomeLabel "Figma 客户端位置" 24 232 $contentWidth
  $labelApp.ForeColor = [System.Drawing.Color]::FromArgb(28, 35, 45)
  $appInput = New-PathDisplay 24 256 ($contentWidth - 272)
  $txtApp = $appInput.ValueLabel
  $txtApp.AccessibleName = "Figma 客户端位置"
  $btnApplyAppPath = New-Object FigBoost.UI.ActionButton
  $btnApplyAppPath.Name = "ApplyAppPath"
  $btnApplyAppPath.Text = "保存路径"
  $btnApplyAppPath.SetBounds(($form.ClientSize.Width - 284), 256, 136, 34)
  $btnApplyAppPath.Anchor = "Top,Right"
  $btnBrowse = New-Object FigBoost.UI.ActionButton
  $btnBrowse.Text = "选择目录"
  $btnBrowse.AccessibleName = "选择 Figma 客户端目录"
  $btnBrowse.SetBounds(($form.ClientSize.Width - 136), 256, 112, 34)
  $btnBrowse.Anchor = "Top,Right"
  $labelAppHint = New-HomeLabel '使用“选择目录”更换客户端位置，或选择空目录迁移客户端。' 24 298 $contentWidth
  $labelAppHint.Anchor = "Top,Left,Right"

  $labelRuntime = New-HomeLabel "汉化文件存放位置" 24 332 $contentWidth
  $labelRuntime.ForeColor = [System.Drawing.Color]::FromArgb(28, 35, 45)
  $runtimeInput = New-PathDisplay 24 356 ($contentWidth - 124)
  $txtRuntime = $runtimeInput.ValueLabel
  $txtRuntime.Text = $RuntimeDir
  $txtRuntime.AccessibleName = "汉化文件存放位置"
  $btnBrowseRuntime = New-Object FigBoost.UI.ActionButton
  $btnBrowseRuntime.Text = "选择目录"
  $btnBrowseRuntime.AccessibleName = "选择汉化文件存放目录"
  $btnBrowseRuntime.SetBounds(($form.ClientSize.Width - 136), 356, 112, 34)
  $btnBrowseRuntime.Anchor = "Top,Right"
  $labelRuntimeHint = New-HomeLabel "Figma 运行时需要读取这些文件，请保留此目录。" 24 398 $contentWidth
  $labelRuntimeHint.Anchor = "Top,Left,Right"

  $labelNotice = New-HomeLabel "安装、更新或卸载汉化可能关闭 Figma，请先保存工作。" 24 436 $contentWidth
  $labelNotice.Anchor = "Top,Left,Right"
  $labelNotice.ForeColor = [System.Drawing.Color]::FromArgb(150, 70, 0)

  $btnInstall = New-Object FigBoost.UI.ActionButton
  $btnInstall.Text = "安装或更新汉化"
  $btnInstall.SetBounds(24, 468, 156, 40)
  $btnUninstall = New-Object FigBoost.UI.ActionButton
  $btnUninstall.Text = "卸载汉化"
  $btnUninstall.SetBounds(192, 468, 120, 40)
  <# Suspended: optional feature manager (board discovery and batch export).
  $btnFeatureManager = New-Object System.Windows.Forms.Button
  $btnFeatureManager.Text = "管理附加功能"
  $btnFeatureManager.SetBounds(($form.ClientSize.Width - 184), 468, 160, 40)
  $btnFeatureManager.Anchor = "Top,Right"
  #>

  foreach ($button in @($btnBrowse, $btnApplyAppPath, $btnBrowseRuntime, $btnStatus, $btnInstall, $btnUninstall, $btnFigBoostUpdate)) {
    if ($button -eq $btnInstall) {
      Set-ButtonStyle $button ([System.Drawing.Color]::FromArgb(37, 99, 235)) ([System.Drawing.Color]::White) ([System.Drawing.Color]::Transparent)
    } else {
      Set-ButtonStyle $button ([System.Drawing.Color]::White) ([System.Drawing.Color]::FromArgb(28, 35, 45)) ([System.Drawing.Color]::FromArgb(209, 217, 227))
    }
  }

  $toolTip = New-Object System.Windows.Forms.ToolTip
  $toolTip.SetToolTip($btnInstall, "安装汉化补丁，或应用当前可用的词库。获取新版请使用右上角更新入口。")
  $toolTip.SetToolTip($btnFigBoostUpdate, "检查并升级 FigBoost 补丁器，或下载最新汉化词库。")
  $toolTip.SetToolTip($btnStatus, "重新读取本机 Figma 版本和汉化状态，不检查在线更新。")
  $toolTip.SetToolTip($btnUninstall, "移除汉化补丁并恢复原始客户端，保留个人汉化设置。")
  $toolTip.SetToolTip($txtRuntime, $txtRuntime.Text)
  $txtApp.Add_TextChanged({ $toolTip.SetToolTip($txtApp, $txtApp.Text) })
  $txtRuntime.Add_TextChanged({ $toolTip.SetToolTip($txtRuntime, $txtRuntime.Text) })

  $refreshPathAction = {
    $btnApplyAppPath.Enabled = -not [string]::IsNullOrWhiteSpace($txtApp.Text)
    $existingClient = $false
    try { $existingClient = Test-FigmaAppDir $txtApp.Text } catch {}
    if ($existingClient) {
      $btnApplyAppPath.Text = "保存路径"
      $labelAppHint.Text = "已找到 Figma 客户端。保存后将优先使用此路径。"
    } elseif ($btnApplyAppPath.Enabled) {
      $btnApplyAppPath.Text = "迁移到此目录"
      $labelAppHint.Text = "迁移需要空目录：会关闭 Figma，将客户端复制到此处，并更新快捷方式。"
    } else {
      $btnApplyAppPath.Text = "保存路径"
      $labelAppHint.Text = '使用“选择目录”更换客户端位置，或选择空目录迁移客户端。'
    }
  }
  $txtApp.Add_TextChanged($refreshPathAction)
  & $refreshPathAction

  $progressLabel = New-HomeLabel "" 24 528 $contentWidth
  $progressLabel.Anchor = "Top,Left,Right"
  $progressLabel.Visible = $false
  $progressBar = New-Object System.Windows.Forms.ProgressBar
  $progressBar.SetBounds(24, 554, $contentWidth, 6)
  $progressBar.Anchor = "Top,Left,Right"
  $progressBar.Minimum = 0
  $progressBar.Maximum = 100
  $progressBar.Visible = $false

  function Set-ProgressState {
    param([int]$Percent, [string]$Message)
    $value = [Math]::Max(0, [Math]::Min(100, $Percent))
    $progressLabel.Visible = $true
    $progressBar.Visible = $true
    $progressBar.Value = $value
    $progressLabel.Text = $Message
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
  }

  function Hide-ProgressState {
    $progressBar.Value = 0
    $progressLabel.Text = ""
    $progressLabel.Visible = $false
    $progressBar.Visible = $false
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
  }

  function Show-FigBoostUpdateDialog {
    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = "FigBoost 更新"
    $dialog.StartPosition = "CenterParent"
    $dialog.ClientSize = New-Object System.Drawing.Size(620, 352)
    $dialog.FormBorderStyle = 'FixedDialog'
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false
    $dialog.Font = $form.Font
    $dialog.BackColor = $form.BackColor
    $state = @{ Busy = $false; Info = $null }

    $message = New-Object System.Windows.Forms.Label
    $message.SetBounds(20, 18, 580, 32)
    $message.Font = New-Object Drawing.Font($dialog.Font.FontFamily, 13, [Drawing.FontStyle]::Bold)
    $message.ForeColor = [Drawing.Color]::FromArgb(28, 35, 45)
    $message.AutoEllipsis = $true

    $clientGroup = New-Object System.Windows.Forms.Panel
    $clientGroup.BackColor = [Drawing.Color]::White
    $clientGroup.SetBounds(20, 62, 580, 90)
    $clientTitle = New-HomeLabel 'FigBoost 软件' 18 12 370
    $clientTitle.Font = New-Object Drawing.Font($dialog.Font.FontFamily, 10, [Drawing.FontStyle]::Bold)
    $clientTitle.ForeColor = [Drawing.Color]::FromArgb(28, 35, 45)
    $clientDescription = New-HomeLabel '获取工具功能改进与问题修复' 18 36 370 20
    $clientLabel = New-HomeLabel "v$PatcherVersion" 18 60 380 20
    $clientLabel.Name = 'ClientUpdateVersion'
    $clientButton = New-Object FigBoost.UI.ActionButton
    $clientButton.Text = '更新软件'
    $clientButton.SetBounds(432, 28, 130, 34)
    $clientGroup.Controls.AddRange(@($clientTitle, $clientDescription, $clientLabel, $clientButton))

    $payloadGroup = New-Object System.Windows.Forms.Panel
    $payloadGroup.BackColor = [Drawing.Color]::White
    $payloadGroup.SetBounds(20, 164, 580, 90)
    $payloadTitle = New-HomeLabel '汉化词库' 18 12 370
    $payloadTitle.Font = $clientTitle.Font
    $payloadTitle.ForeColor = $clientTitle.ForeColor
    $payloadDescription = New-HomeLabel '补充中文翻译，改善界面汉化' 18 36 370 20
    $payloadLabel = New-HomeLabel '' 18 60 398 20
    $payloadLabel.Name = 'PayloadUpdateVersion'
    $payloadButton = New-Object FigBoost.UI.ActionButton
    $payloadButton.Text = '更新词库'
    $payloadButton.SetBounds(432, 28, 130, 34)
    $payloadGroup.Controls.AddRange(@($payloadTitle, $payloadDescription, $payloadLabel, $payloadButton))

    $notice = New-HomeLabel '' 20 266 580 20
    $retry = New-Object FigBoost.UI.ActionButton
    $retry.Text = '重新检查'
    $retry.SetBounds(328, 304, 130, 32)
    $close = New-Object FigBoost.UI.ActionButton
    $close.Text = '关闭'
    $close.SetBounds(470, 304, 130, 32)
    foreach ($button in @($clientButton, $payloadButton, $retry, $close)) {
      Set-ButtonStyle $button ([Drawing.Color]::White) ([Drawing.Color]::FromArgb(28, 35, 45)) ([Drawing.Color]::FromArgb(205, 214, 226))
    }
    $dialog.Controls.AddRange(@($message, $clientGroup, $payloadGroup, $notice, $retry, $close))
    $dialog.CancelButton = $close

    function Refresh-UpdateActions {
      $installed = Get-InstalledPayloadVersion $txtRuntime.Text
      $clientLabel.Text = "v$PatcherVersion"
      $payloadLabel.Text = if ($installed) { "v$installed" } else { '未安装汉化，请先在主页安装' }
      $notice.Text = ''
      $clientButton.Enabled = $false
      $payloadButton.Enabled = $false
      $clientButton.Visible = $false
      $payloadButton.Visible = $false
      $retry.Enabled = -not $state.Busy
      $close.Enabled = -not $state.Busy
      if ($state.Info) {
        $clientNew = (Compare-VersionString $state.Info.client.version $PatcherVersion) -gt 0
        if ($clientNew) { $clientLabel.Text = "v$PatcherVersion → v$($state.Info.client.version)" }
        $compatible = (Compare-VersionString $PatcherVersion $state.Info.payload.minPatcherVersion) -ge 0
        $payloadNew = $installed -and (Compare-VersionString $state.Info.payload.version $installed) -gt 0
        if ($payloadNew) {
          $payloadLabel.Text = "v$installed → v$($state.Info.payload.version)$(if (-not $compatible) { ' · 请先更新软件' })"
          $notice.Text = '更新词库会重启 Figma，请先保存工作。'
        }
        if ($clientNew) {
          $notice.Text = if ($payloadNew) { '软件更新后重启 FigBoost；词库更新会重启 Figma，请先保存工作。' } else { '软件更新后会自动重新打开 FigBoost。' }
        }
        $clientButton.Visible = $clientNew
        $payloadButton.Visible = [bool]$payloadNew
        $clientButton.Enabled = -not $state.Busy -and $clientNew
        $payloadButton.Enabled = -not $state.Busy -and $compatible -and $payloadNew -and (Compare-VersionString $state.Info.payload.version (Get-PayloadVersion)) -ge 0
      }
      $dialog.Refresh()
    }
    $check = {
      if ($state.Busy) { return }
      $state.Busy = $true
      $message.Text = '正在检查更新…'
      Refresh-UpdateActions
      try {
        $state.Info = @(Invoke-UpdateWorker { Get-LatestFigBoostUpdate })[-1]
        Refresh-UpdateActions
        $message.Text = if ($clientButton.Visible -or $payloadButton.Visible) { '有可用更新' } elseif (-not (Get-InstalledPayloadVersion $txtRuntime.Text)) { '软件已是最新版' } else { '已是最新版本' }
      } catch {
        $state.Info = $null
        $message.Text = '检查失败，请确认网络后重新检查。'
        Write-Log "FigBoost update check failed: $($_.Exception.Message)"
      } finally { $state.Busy = $false; Refresh-UpdateActions }
    }
    $clientButton.Add_Click({
      if ($state.Busy -or -not $state.Info) { return }
      $state.Busy = $true
      Refresh-UpdateActions
      $download = Join-Path ([IO.Path]::GetTempPath()) ("FigBoost-update-$([Guid]::NewGuid().ToString('N')).exe")
      try {
        $message.Text = '正在下载并校验客户端，完成后将重新打开 FigBoost…'
        $dialog.Refresh()
        Invoke-UpdateWorker { param($release, $path) Save-VerifiedUpdateDownload $release $path } @($state.Info.client, $download)
        Invoke-PatcherSelfUpdate $state.Info.client $download $txtRuntime.Text $txtApp.Text
        $download = '' # The replacement helper owns this file after the current process exits.
        $state.Busy = $false
        $dialog.Close()
        $form.Close()
      } catch {
        $message.Text = '客户端升级失败，可重新尝试。'
        Show-ErrorMessage $_.Exception.Message
      } finally {
        if ($download) { Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue }
        $state.Busy = $false
        Refresh-UpdateActions
      }
    })
    $payloadButton.Add_Click({
      if ($state.Busy -or -not $state.Info) { return }
      $state.Busy = $true
      Refresh-UpdateActions
      $download = Join-Path ([IO.Path]::GetTempPath()) ("FigBoost-payload-$([Guid]::NewGuid().ToString('N')).json")
      try {
        $message.Text = '正在下载并校验词库…'
        $dialog.Refresh()
        Invoke-UpdateWorker { param($release, $path) Save-VerifiedUpdateDownload $release $path } @($state.Info.payload, $download)
        $package = [IO.File]::ReadAllText($download, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($package.version -ne $state.Info.payload.version -or $package.minPatcherVersion -ne $state.Info.payload.minPatcherVersion) { throw '词库更新信息不一致，请重新检查更新。' }
        [void](ConvertFrom-PayloadUpdate $package)
        $choice = [Windows.Forms.MessageBox]::Show($dialog, '词库已准备好。应用时会关闭并重新打开正在运行的 Figma，请先保存工作。现在应用？', '更新词库', 'YesNo', 'Question')
        if ($choice -ne 'Yes') { $message.Text = '已取消应用，当前词库未改动。'; return }
        $message.Text = '正在应用词库…'
        $dialog.Refresh()
        $result = Install-PayloadUpdate $package $txtApp.Text $txtRuntime.Text
        Set-StatusLabels $result
        $message.Text = "词库已更新至 v$($package.version)。"
      } catch {
        $message.Text = '词库更新失败，原词库已保留。'
        Show-ErrorMessage $_.Exception.Message
      } finally {
        Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
        $state.Busy = $false
        Refresh-UpdateActions
      }
    })
    $retry.Add_Click($check)
    $close.Add_Click({ $dialog.Close() })
    $dialog.Add_FormClosing({ param($sender, $eventArgs) if ($state.Busy) { $eventArgs.Cancel = $true } })
    $dialog.Add_Shown($check)
    Refresh-UpdateActions
    [void]$dialog.ShowDialog($form)
    $dialog.Dispose()
  }

  $runAction = {
    param([scriptblock]$Action, [scriptblock]$OnSuccess, [string]$FailurePrefix = "操作失败", [string]$ProgressText = "正在处理...")
    try {
      $form.UseWaitCursor = $true
      Set-ProgressState 8 $ProgressText
      $result = @(& $Action)[-1]
      Set-ProgressState 100 "操作完成"
      if ($result) {
        Set-StatusLabels $result
        & $refreshPathAction
      }
      if ($OnSuccess) { & $OnSuccess $result }
    } catch {
      Set-ProgressState 0 "操作失败"
      Show-ErrorMessage "$FailurePrefix：`r`n`r`n$($_.Exception.Message)"
    } finally {
      $form.UseWaitCursor = $false
      Hide-ProgressState
    }
  }

  <# Suspended: retain the feature manager implementation for future use.
  $featureDefinitions = @(
    [pscustomobject]@{
      Id = "auto-check-official-latest"
      Title = "自动更新 Figma 客户端"
      Description = "自动检查 Figma 官方最新版；发现新版后可直接更新，并自动重新安装汉化补丁。"
      ProgressText = "正在安装 Figma 自动更新功能..."
      FailurePrefix = "附加功能安装失败"
      Action = {
        Set-ProgressState 35 "正在写入功能配置..."
        $current = Resolve-ManagedFigmaAppDir $txtRuntime.Text $txtApp.Text
        $txtApp.Text = $current
        Set-ProgressState 65 "正在确保客户端补丁已安装..."
        Install-Feature "auto-check-official-latest" $current $txtRuntime.Text
        return Get-CompleteStatus $current $txtRuntime.Text
      }
      IsInstalled = { Test-FeatureInstalled $txtRuntime.Text "auto-check-official-latest" }
      SuccessMessage = {
        param($result)
        return "Figma 自动更新功能已安装。`r`n`r`n发现官方新版后可直接更新，并自动重新安装汉化补丁。`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })"
      }
      UninstallProgressText = "正在卸载附加功能..."
      UninstallFailurePrefix = "附加功能卸载失败"
      UninstallAction = {
        Set-ProgressState 35 "正在关闭 Figma 并卸载附加功能..."
        $current = Resolve-ManagedFigmaAppDir $txtRuntime.Text $txtApp.Text
        $txtApp.Text = $current
        Uninstall-Feature "auto-check-official-latest" $txtRuntime.Text $current
      }
      UninstallSuccessMessage = {
        param($result)
        $patchState = if ($result) { "`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })" } else { "" }
        return "Figma 自动更新功能已卸载。`r`n`r`n汉化补丁不受影响。$patchState"
      }
    },
    [pscustomobject]@{
      Id = "bulk-export-figma-files"
      Title = "检索画板与批量导出"
      Description = "在 FigBoost 菜单中增加批量导出画板文件入口；可检索当前账号可见的团队项目文件，并按项目勾选导出本地 .fig 副本。"
      ProgressText = "正在安装检索画板与批量导出功能..."
      FailurePrefix = "附加功能安装失败"
      Action = {
        Set-ProgressState 35 "正在写入功能配置..."
        $current = Resolve-ManagedFigmaAppDir $txtRuntime.Text $txtApp.Text
        $txtApp.Text = $current
        Set-ProgressState 55 "正在确保 FigBoost 菜单入口已启用..."
        Install-Feature "auto-check-official-latest" $current $txtRuntime.Text | Out-Null
        Set-ProgressState 75 "正在启用批量导出功能..."
        Install-Feature "bulk-export-figma-files" $current $txtRuntime.Text
        return Get-CompleteStatus $current $txtRuntime.Text
      }
      IsInstalled = { Test-FeatureInstalled $txtRuntime.Text "bulk-export-figma-files" }
      SuccessMessage = {
        param($result)
        return "附加功能已安装。`r`n`r`n之后打开 Figma 顶部 FigBoost 菜单，即可使用批量导出画板文件。`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })"
      }
      UninstallProgressText = "正在卸载检索画板与批量导出功能..."
      UninstallFailurePrefix = "附加功能卸载失败"
      UninstallAction = {
        Set-ProgressState 35 "正在关闭 Figma 并卸载批量导出功能..."
        $current = Resolve-ManagedFigmaAppDir $txtRuntime.Text $txtApp.Text
        $txtApp.Text = $current
        Uninstall-Feature "bulk-export-figma-files" $txtRuntime.Text $current
      }
      UninstallSuccessMessage = {
        param($result)
        $patchState = if ($result) { "`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })" } else { "" }
        return "附加功能已卸载。`r`n`r`n之后打开 Figma 顶部 FigBoost 菜单时，不再显示批量导出画板文件；汉化补丁不受影响。$patchState"
      }
    }
  )

  function Show-FeatureInstallDialog {
    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = "附加功能"
    $dialog.StartPosition = "CenterParent"
    $dialog.Width = 560
    $dialog.Height = 420
    $dialog.MinimumSize = New-Object System.Drawing.Size(520, 360)
    $dialog.BackColor = [System.Drawing.Color]::FromArgb(246, 248, 251)
    $dialog.Font = $form.Font
    $dialog.ShowInTaskbar = $false

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = "管理附加功能"
    $titleLabel.Left = 18
    $titleLabel.Top = 18
    $titleLabel.Width = 500
    $titleLabel.Height = 24
    $titleLabel.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 11, [System.Drawing.FontStyle]::Bold)

    $hintLabel = New-Object System.Windows.Forms.Label
    $hintLabel.Text = "这里管理 FigBoost 的可选小功能。安装或卸载功能不会卸载汉化补丁。"
    $hintLabel.Left = 18
    $hintLabel.Top = 46
    $hintLabel.Width = 500
    $hintLabel.Height = 22
    $hintLabel.ForeColor = [System.Drawing.Color]::FromArgb(74, 85, 104)

    $featureList = New-Object System.Windows.Forms.CheckedListBox
    $featureList.Left = 18
    $featureList.Top = 82
    $featureList.Width = 506
    $featureList.Height = 170
    $featureList.Anchor = "Top,Left,Right"
    $featureList.CheckOnClick = $true
    $featureList.DisplayMember = "Title"
    $featureList.DrawMode = "OwnerDrawFixed"
    $featureList.ItemHeight = 24
    $installedFeatureIds = @{}
    foreach ($feature in $featureDefinitions) {
      $installed = [bool](& $feature.IsInstalled)
      if ($installed) { $installedFeatureIds[$feature.Id] = $true }
      [void]$featureList.Items.Add($feature, $false)
    }

    $descriptionBox = New-Object System.Windows.Forms.TextBox
    $descriptionBox.Left = 18
    $descriptionBox.Top = 266
    $descriptionBox.Width = 506
    $descriptionBox.Height = 54
    $descriptionBox.Anchor = "Top,Left,Right"
    $descriptionBox.Multiline = $true
    $descriptionBox.ReadOnly = $true
    $descriptionBox.BorderStyle = "FixedSingle"
    $descriptionBox.BackColor = [System.Drawing.Color]::White

    $btnRunFeatures = New-Object System.Windows.Forms.Button
    $btnRunFeatures.Text = "安装所选功能"
    $btnRunFeatures.Left = 314
    $btnRunFeatures.Top = 336
    $btnRunFeatures.Width = 130
    $btnRunFeatures.Height = 34
    $btnRunFeatures.Anchor = "Bottom,Right"

    $btnUninstallFeatures = New-Object System.Windows.Forms.Button
    $btnUninstallFeatures.Text = "卸载所选功能"
    $btnUninstallFeatures.Left = 172
    $btnUninstallFeatures.Top = 336
    $btnUninstallFeatures.Width = 130
    $btnUninstallFeatures.Height = 34
    $btnUninstallFeatures.Anchor = "Bottom,Right"

    $btnClose = New-Object System.Windows.Forms.Button
    $btnClose.Text = "关闭"
    $btnClose.Left = 456
    $btnClose.Top = 336
    $btnClose.Width = 68
    $btnClose.Height = 34
    $btnClose.Anchor = "Bottom,Right"

    Set-ButtonStyle $btnRunFeatures `
      ([System.Drawing.Color]::FromArgb(18, 119, 242)) `
      ([System.Drawing.Color]::White) `
      ([System.Drawing.Color]::Transparent)
    Set-ButtonStyle $btnUninstallFeatures `
      ([System.Drawing.Color]::FromArgb(255, 255, 255)) `
      ([System.Drawing.Color]::FromArgb(180, 40, 40)) `
      ([System.Drawing.Color]::FromArgb(210, 150, 150))
    Set-ButtonStyle $btnClose `
      ([System.Drawing.Color]::FromArgb(244, 247, 251)) `
      ([System.Drawing.Color]::FromArgb(28, 35, 45)) `
      ([System.Drawing.Color]::FromArgb(140, 154, 174))

    $updateDescription = {
      if ($featureList.SelectedItem) {
        $status = if ($installedFeatureIds.ContainsKey($featureList.SelectedItem.Id)) { "已安装" } else { "未安装" }
        $descriptionBox.Text = "$($featureList.SelectedItem.Description)`r`n`r`n状态：$status"
      }
    }

    $featureList.Add_SelectedIndexChanged({
      & $updateDescription
    })
    $featureList.Add_DrawItem({
      param($sender, $eventArgs)
      if ($eventArgs.Index -lt 0) { return }
      $feature = $featureList.Items[$eventArgs.Index]
      $isInstalled = $installedFeatureIds.ContainsKey($feature.Id)
      $eventArgs.Graphics.FillRectangle([System.Drawing.Brushes]::White, $eventArgs.Bounds)
      if (($eventArgs.State -band [System.Windows.Forms.DrawItemState]::Selected) -ne 0) {
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(18, 119, 242))
        $eventArgs.Graphics.DrawRectangle($pen, $eventArgs.Bounds.Left, $eventArgs.Bounds.Top, $eventArgs.Bounds.Width - 1, $eventArgs.Bounds.Height - 1)
        $pen.Dispose()
      }
      $titleBounds = New-Object System.Drawing.Rectangle($eventArgs.Bounds.Left + 18, $eventArgs.Bounds.Top, $eventArgs.Bounds.Width - 100, $eventArgs.Bounds.Height)
      $statusBounds = New-Object System.Drawing.Rectangle($eventArgs.Bounds.Right - 88, $eventArgs.Bounds.Top, 82, $eventArgs.Bounds.Height)
      $flags = [System.Windows.Forms.TextFormatFlags]::Left -bor [System.Windows.Forms.TextFormatFlags]::VerticalCenter -bor [System.Windows.Forms.TextFormatFlags]::EndEllipsis
      [System.Windows.Forms.TextRenderer]::DrawText($eventArgs.Graphics, $feature.Title, $eventArgs.Font, $titleBounds, $featureList.ForeColor, $flags)
      $statusText = if ($isInstalled) { "已安装" } else { "未安装" }
      $statusColor = if ($isInstalled) { [System.Drawing.Color]::FromArgb(38, 120, 83) } else { [System.Drawing.Color]::FromArgb(100, 112, 128) }
      [System.Windows.Forms.TextRenderer]::DrawText($eventArgs.Graphics, $statusText, $eventArgs.Font, $statusBounds, $statusColor, $flags)
    })

    $btnClose.Add_Click({ $dialog.Close() })
    $btnRunFeatures.Add_Click({
      $checkedFeatures = @($featureList.CheckedItems)
      $selectedFeatures = @($checkedFeatures | Where-Object { -not $installedFeatureIds.ContainsKey($_.Id) })
      if ($selectedFeatures.Count -eq 0) {
        Show-InfoMessage (Get-FeatureInstallEmptySelectionMessage $checkedFeatures.Count) "附加功能"
        return
      }
      $dialog.Close()
      foreach ($feature in $selectedFeatures) {
        & $runAction $feature.Action {
          param($result)
          $message = & $feature.SuccessMessage $result
          if ($message) { Show-InfoMessage $message "附加功能" }
        } $feature.FailurePrefix $feature.ProgressText
      }
    })
    $btnUninstallFeatures.Add_Click({
      $selectedFeatures = @($featureList.CheckedItems | Where-Object { $installedFeatureIds.ContainsKey($_.Id) })
      if ($featureList.SelectedItem -and $installedFeatureIds.ContainsKey($featureList.SelectedItem.Id) -and ($selectedFeatures -notcontains $featureList.SelectedItem)) {
        $selectedFeatures += $featureList.SelectedItem
      }
      if ($selectedFeatures.Count -eq 0) {
        Show-InfoMessage "请选择已安装的功能后再卸载。`r`n`r`n卸载只关闭附加功能，不卸载汉化补丁。" "附加功能"
        return
      }
      $dialog.Close()
      foreach ($feature in $selectedFeatures) {
        & $runAction $feature.UninstallAction {
          param($result)
          $message = & $feature.UninstallSuccessMessage $result
          if ($message) { Show-InfoMessage $message "附加功能" }
        } $feature.UninstallFailurePrefix $feature.UninstallProgressText
      }
    })

    $dialog.Controls.AddRange(@($titleLabel, $hintLabel, $featureList, $descriptionBox, $btnUninstallFeatures, $btnRunFeatures, $btnClose))
    [void]$dialog.ShowDialog($form)
  }

  #>

  $btnBrowse.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "选择包含 Figma.exe 的 app-* 文件夹"
    if ($txtApp.Text) { $dialog.SelectedPath = $txtApp.Text }
    if ($dialog.ShowDialog($form) -eq "OK") {
      $txtApp.Text = $dialog.SelectedPath
    }
  })

  $btnBrowseRuntime.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "选择汉化文件存放目录"
    $dialog.ShowNewFolderButton = $true
    if ($txtRuntime.Text -and (Test-Path -LiteralPath $txtRuntime.Text)) { $dialog.SelectedPath = $txtRuntime.Text }
    if ($dialog.ShowDialog($form) -eq "OK") {
      $txtRuntime.Text = $dialog.SelectedPath
    }
  })

  $btnApplyAppPath.Add_Click({
    & $runAction {
      Set-ProgressState 35 "正在应用客户端路径..."
      if ($txtApp.Text -and (Test-FigmaAppDir $txtApp.Text)) {
        $selected = [pscustomobject]@{
          AppDir = Set-PreferredAppDir $txtRuntime.Text $txtApp.Text
          Migrated = $false
        }
      } else {
        Set-ProgressState 45 "正在关闭 Figma 并复制客户端..."
        [void](Assert-FigmaClosed -Force)
        $sourceAppDir = Find-CurrentFigmaAppDir
        $selected = Move-FigmaAppDir $sourceAppDir $txtApp.Text $txtRuntime.Text
      }
      Repair-FigmaShortcuts $selected.AppDir
      $txtApp.Text = $selected.AppDir
      $status = Get-CompleteStatus $selected.AppDir $txtRuntime.Text
      $status | Add-Member -NotePropertyName Migrated -NotePropertyValue ([bool]$selected.Migrated) -Force
      return $status
    } {
      param($result)
      $title = if ($result.Migrated) { "客户端已迁移" } else { "客户端路径已应用" }
      Show-InfoMessage ("$title。`r`n`r`nFigma 路径：$($result.AppDir)`r`nFigma 版本：$($result.FigmaVersion)")
    } "应用客户端路径失败" "正在应用客户端路径..."
  })

  $btnStatus.Add_Click({
    & $runAction {
      $current = Resolve-ManagedFigmaAppDir $txtRuntime.Text $txtApp.Text
      $txtApp.Text = $current
      Get-CompleteStatus $current $txtRuntime.Text
    } {
      param($result)
      Show-InfoMessage ("检测完成。`r`n`r`nFigma 路径：$($result.AppDir)`r`nFigma 版本：$($result.FigmaVersion)`r`n词库版本：v$($result.PayloadVersion)`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })")
    } "检测失败" "正在检测当前版本..."
  })
  # $btnFeatureManager.Add_Click({ Show-FeatureInstallDialog })
  $btnFigBoostUpdate.Add_Click({ Show-FigBoostUpdateDialog })
  $btnInstall.Add_Click({
    & $runAction {
      Set-ProgressState 30 "正在安装汉化补丁..."
      Install-Patch $txtApp.Text $txtRuntime.Text -Force
    } {
      param($result)
      if ($result.AlreadyPatched) {
        Show-InfoMessage ("汉化已是当前可用版本。如需获取新词库，请使用右上角更新入口。`r`n`r`nFigma 版本：$($result.FigmaVersion)`r`n词库版本：v$($result.PayloadVersion)")
      } else {
        Show-InfoMessage ("安装成功。`r`n`r`nFigma 版本：$($result.FigmaVersion)`r`n词库版本：v$($result.PayloadVersion)`r`n补丁状态：已安装")
      }
    } "安装失败" "正在安装汉化补丁..."
  })
  $btnUninstall.Add_Click({
    & $runAction {
      Set-ProgressState 35 "正在卸载汉化补丁..."
      $target = Resolve-Target $txtApp.Text
      Uninstall-Patch $target.AppDir $txtRuntime.Text -Force
    } {
      param($result)
      Show-InfoMessage ("卸载成功。`r`n`r`nFigma 版本：$($result.FigmaVersion)`r`n补丁状态：未安装")
    } "卸载失败" "正在卸载汉化补丁..."
  })

  $form.Controls.AddRange(@(
    $header, $currentGroup,
    $labelApp, $appInput.Panel, $btnApplyAppPath, $btnBrowse, $labelRuntime, $runtimeInput.Panel, $btnBrowseRuntime, $labelNotice,
    $btnInstall, $btnUninstall, $progressLabel, $progressBar, $labelAppHint, $labelRuntimeHint
  ))

  try {
    $preferredAppDir = Get-PreferredAppDir $txtRuntime.Text
    $initialAppDir = if ($AppDir -and (Test-FigmaAppDir $AppDir)) { $AppDir } elseif ($preferredAppDir) { $preferredAppDir } else { Find-CurrentFigmaAppDir }
    $txtApp.Text = $initialAppDir
    Set-StatusLabels (Get-CompleteStatus $initialAppDir $txtRuntime.Text)
  } catch {
    $script:ValueCurrentFigma.Text = "未检测到 Figma"
    $script:ValueCurrentPatch.Text = "汉化：未检测"
    $labelAppHint.Text = "未找到完整客户端，请选择包含 Figma.exe 的 app-* 文件夹。"
  }

  [void]$form.ShowDialog()
  $toolTip.Dispose()
  $form.Dispose()
}

Initialize-PayloadUpdate

if ($SelfTest) {
  Invoke-SelfTest
  return
}

if ($Install -or $Uninstall -or $Status -or $CheckLatest -or $UpdateFigma) {
  if ($Install) {
    Install-Patch $AppDir $RuntimeDir -Force:$ForceClose | ConvertTo-Json -Depth 8
  } elseif ($Uninstall) {
    Uninstall-Patch $AppDir $RuntimeDir -Force:$ForceClose | ConvertTo-Json -Depth 8
  } elseif ($UpdateFigma) {
    if ($ShowProgress) {
      Invoke-UpdateFigmaOfficialWithProgress $RuntimeDir -Force:$ForceClose
    } else {
      Update-FigmaOfficial $RuntimeDir -Force:$ForceClose | ConvertTo-Json -Depth 8
    }
  } elseif ($CheckLatest) {
    Get-CompleteStatus $AppDir $RuntimeDir -CheckOfficial | ConvertTo-Json -Depth 8
  } else {
    $target = Resolve-Target (Resolve-ManagedFigmaAppDir $RuntimeDir $AppDir)
    Get-PatchStatus $target $RuntimeDir | ConvertTo-Json -Depth 8
  }
  return
}

Show-Gui
