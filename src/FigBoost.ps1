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

$PatchMarker = "FIGMA_ZH_OFFICIAL_MAIN_HOOK_V6"
$UpdaterDisableMarker = "FIGMA_ZH_DISABLE_BUILTIN_UPDATER"
$PatcherVersion = "0.3.4"
$PayloadFile = "i.js"
$MainPayloadFile = "m.js"
$FeatureConfigFile = "features.json"
$BackupFile = "app.asar.figma-zh-official-preload-original"
$LicenseCommentTarget = "/*! Bundled license information:"
$OfficialReleasesXmlUrl = "https://desktop.figma.com/win/releases.xml"
$OfficialInstallerUrl = "https://desktop.figma.com/win/FigmaSetup.exe"
$EmbeddedPayloadFiles = @{}
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

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
  } else {
    Write-Host $Message
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
    return (($sha.ComputeHash($Bytes) | ForEach-Object { $_.ToString("x2") }) -join "")
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
  $dictionary = Read-PayloadText "payload\src\dictionary\zh-CN.js"
  $core = Read-PayloadText "payload\src\content\localizer-core.js"
  $content = Read-PayloadText "payload\src\content\content.js"
  $version = if ($manifest.version) { $manifest.version } else { "unknown" }

  return @(
    '"use strict";'
    ';(() => {'
    "  const version = $(ConvertTo-JsString $version);"
    '  if (window.__FIGMA_ZH_OFFICIAL_PRELOAD_INJECTED__ === version) return;'
    '  window.__FIGMA_ZH_OFFICIAL_PRELOAD_INJECTED__ = version;'
    '  try {'
    $dictionary
    $core
    $content
    '  } catch (error) {'
    '    console.error("[FigmaZh] official preload injection failed", error);'
    '  }'
    '})();'
  ) -join "`n"
}

function Build-MainPayload {
  return Read-PayloadText "payload\src\main\menu-localizer.js"
}

function Build-MainHook {
  param([string]$RuntimeDir)
  $payloadPath = Join-Path $RuntimeDir $PayloadFile
  $mainPayloadPath = Join-Path $RuntimeDir $MainPayloadFile
  $marker = ConvertTo-JsString $PatchMarker
  $payload = ConvertTo-JsString $payloadPath
  $mainPayload = ConvertTo-JsString $mainPayloadPath
  return ";(()=>{const M=$marker;try{const E=require(""electron""),F=require(""fs""),R=require(""path""),P=$payload,Q=$mainPayload;try{global.__FIGMA_ZH_RUNTIME_DIR__=R.dirname(Q);F.existsSync(Q)&&eval(F.readFileSync(Q,""utf8""))}catch(e){}let C;function p(){return C||(C=F.readFileSync(P,""utf8""))}function b(){try{if(!global.__FIGBOOST_FEATURE_ENABLED__||!global.__FIGBOOST_FEATURE_ENABLED__(""auto-check-official-latest""))return"""";return ""(()=>{try{window.__FIGBOOST_UPDATE_BUTTON_ENABLED__=true;const{ipcRenderer}=require('electron');if(ipcRenderer&&!window.__FIGBOOST_CHECK_OFFICIAL_UPDATE__)Object.defineProperty(window,'__FIGBOOST_CHECK_OFFICIAL_UPDATE__',{value:()=>ipcRenderer.invoke('figboost:check-official-update')})}catch(e){window.__FIGBOOST_UPDATE_BUTTON_ENABLED__=true}})();""}catch(e){return""""}}function d(w){try{w.executeJavaScript(""window.dispatchEvent(new CustomEvent('figboost:update-check-finished'))"",true).catch(()=>{})}catch(e){}}function h(w,e,u){try{if(!/^figboost:\/\/check-official-update/i.test(u||""""))return!1;e&&e.preventDefault&&e.preventDefault();let f=global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__;if(typeof f===""function"")Promise.resolve(f()).finally(()=>d(w));else d(w);return!0}catch(x){d(w);return!0}}function j(w){if(!w||w._fz)return;w._fz=1;w.on(""will-navigate"",(e,u)=>h(w,e,u));if(w.setWindowOpenHandler)w.setWindowOpenHandler(({url})=>h(w,null,url)?{action:""deny""}:{action:""allow""});const r=()=>{try{let u=w.getURL();/^https:\/\/([^\/]+\.)?figma\.com/i.test(u)&&w.executeJavaScript(b()+p(),true).catch(()=>{})}catch(e){}};w.on(""dom-ready"",r);w.on(""did-finish-load"",r)}E.app.on(""web-contents-created"",(_,w)=>j(w));E.webContents.getAllWebContents().forEach(j)}catch(e){}})();"
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
    patcherPath = Get-PatcherExecutablePath
    runtimeDir = $RuntimeDir
    preferredAppDir = ""
  }
}

function Write-FeatureConfig {
  param([string]$RuntimeDir, [string[]]$EnabledFeatures)
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  $current = Read-FeatureConfig $RuntimeDir
  $config = [pscustomobject]@{
    enabledFeatures = @($EnabledFeatures | Sort-Object -Unique)
    patcherPath = Get-PatcherExecutablePath
    runtimeDir = $RuntimeDir
    preferredAppDir = [string]$current.preferredAppDir
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
  $config = Read-FeatureConfig $SelectedRuntimeDir
  $features = @($config.enabledFeatures)
  if ($features -notcontains $FeatureId) { $features += $FeatureId }
  Write-FeatureConfig $SelectedRuntimeDir $features | Out-Null
  Write-RuntimeFiles $SelectedRuntimeDir
  $target = Resolve-Target $appDir
  $status = Get-PatchStatus $target $SelectedRuntimeDir
  if (-not $status.Patched -or -not $status.HasBuiltInUpdaterDisabled) {
    return Install-Patch $appDir $SelectedRuntimeDir -Force -ShortcutRoots $ShortcutRoots
  }
  Repair-FigmaShortcuts $appDir $ShortcutRoots
  return $status
}

function Uninstall-Feature {
  param([string]$FeatureId, [string]$SelectedRuntimeDir)
  $config = Read-FeatureConfig $SelectedRuntimeDir
  $features = @($config.enabledFeatures | Where-Object { $_ -ne $FeatureId })
  Write-FeatureConfig $SelectedRuntimeDir $features | Out-Null
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
    PayloadVersion = Get-PayloadVersion
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
  $running = Get-Process -Name "Figma" -ErrorAction SilentlyContinue
  if ($running) {
    if (-not $Force) {
      throw "Figma is running. Close Figma first, or enable Force close Figma."
    }
    $running | Stop-Process -Force
  }
}

function Install-Patch {
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$Force, [switch]$SkipProcessCheck, [string[]]$ShortcutRoots = $null)
  if (-not $SkipProcessCheck) { Assert-FigmaClosed -Force:$Force }
  $appDir = Resolve-ManagedFigmaAppDir $SelectedRuntimeDir $SelectedAppDir
  $target = Resolve-Target $appDir
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
  Repair-FeatureConfigEncoding $SelectedRuntimeDir
  $result = Patch-Asar $target $SelectedRuntimeDir
  Write-Log "Install result: $($result | ConvertTo-Json -Compress)"
  $status = Get-PatchStatus $target $SelectedRuntimeDir
  $status | Add-Member -NotePropertyName AlreadyPatched -NotePropertyValue ([bool]$result.AlreadyPatched) -Force
  Repair-FigmaShortcuts $target.AppDir $ShortcutRoots
  return $status
}

function Uninstall-Patch {
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$Force, [switch]$SkipProcessCheck)
  if (-not $SkipProcessCheck) { Assert-FigmaClosed -Force:$Force }
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
  Assert-FigmaClosed -Force:$Force
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
    $repeatInstallStatus = Install-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck -ShortcutRoots @($shortcutRoot)
    if (-not $repeatInstallStatus.AlreadyPatched) { throw "Self-test repeat install did not report already patched." }
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
    if (-not $featureUpgradeHook.Contains("figboost:\/\/check-official-update")) { throw "Self-test hook does not handle manual update fallback navigation." }
    if (-not $featureUpgradeHook.Contains("__FIGBOOST_UPDATE_BUTTON_ENABLED__")) { throw "Self-test hook does not enable update button injection." }
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
    Write-Host "Self-test passed."
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
  $script:ValuePatcher.Text = "v$($Status.PatcherVersion)"
  $script:ValuePayload.Text = "v$($Status.PayloadVersion)"
  $script:ValueFigmaVersion.Text = $Status.FigmaVersion
  $script:ValuePatchState.Text = if ($Status.Patched) { "已安装" } else { "未安装" }
  if ($script:ValueUpdaterGuardState) { $script:ValueUpdaterGuardState.Text = if ($Status.HasBuiltInUpdaterDisabled) { "已启用" } else { "未启用" } }
  $script:ValueBackupState.Text = if ($Status.HasBackup) { "已存在" } else { "未找到" }
  $script:ValueRuntimeState.Text = if ($Status.HasRuntimePayload) { "已生成" } else { "未生成" }
  if ($script:ValueCurrentFigma) { $script:ValueCurrentFigma.Text = "当前版本：$($Status.FigmaVersion)" }
  if ($script:ValueCurrentPath) { $script:ValueCurrentPath.Text = "客户端目录：$($Status.AppDir)" }
  if ($script:ValueCurrentPatch) { $script:ValueCurrentPatch.Text = "补丁状态：$(if ($Status.Patched) { "已安装" } else { "未安装" })" }
  if ($script:ValueOfficialLatest -and ($Status.PSObject.Properties.Name -contains "OfficialLatestVersion")) {
    $compare = Compare-VersionString $Status.FigmaVersion $Status.OfficialLatestVersion
    $latestState = if ($compare -lt 0) {
      "可更新"
    } elseif ($compare -eq 0) {
      "已是最新"
    } else {
      "当前版本较新"
    }
    $script:ValueOfficialLatest.Text = "官方最新版：$($Status.OfficialLatestVersion)（$latestState）"
  }
}

function Show-InfoMessage {
  param([string]$Text, [string]$Title = "FigBoost")
  [System.Windows.Forms.MessageBox]::Show($Text, $Title, "OK", "Information") | Out-Null
}

function Show-ErrorMessage {
  param([string]$Text)
  [System.Windows.Forms.MessageBox]::Show($Text, "FigBoost", "OK", "Error") | Out-Null
}

function Show-Gui {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "FigBoost v$PatcherVersion"
  $form.StartPosition = "CenterScreen"
  $form.Width = 900
  $form.Height = 650
  $form.MinimumSize = New-Object System.Drawing.Size(860, 630)
  $form.BackColor = [System.Drawing.Color]::FromArgb(246, 248, 251)
  $form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
  try {
    $exePath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
  } catch {}

  function New-InputBox {
    param([int]$Left, [int]$Top, [int]$Width)
    $panel = New-Object System.Windows.Forms.Panel
    $panel.Left = $Left
    $panel.Top = $Top
    $panel.Width = $Width
    $panel.Height = 34
    $panel.BorderStyle = "FixedSingle"
    $panel.BackColor = [System.Drawing.SystemColors]::Window
    $panel.Anchor = "Top,Left,Right"

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Left = 8
    $textBox.Top = 7
    $textBox.Width = $Width - 16
    $textBox.BorderStyle = "None"
    $textBox.BackColor = [System.Drawing.SystemColors]::Window
    $textBox.Anchor = "Top,Left,Right"
    $panel.Controls.Add($textBox)

    return [pscustomobject]@{ Panel = $panel; TextBox = $textBox }
  }

  function New-RoundedButtonPath {
    param([System.Drawing.Rectangle]$Bounds, [int]$Radius)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $path.AddArc($Bounds.Left, $Bounds.Top, $diameter, $diameter, 180, 90)
    $path.AddArc($Bounds.Right - $diameter, $Bounds.Top, $diameter, $diameter, 270, 90)
    $path.AddArc($Bounds.Right - $diameter, $Bounds.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($Bounds.Left, $Bounds.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
  }

  function Set-RoundedButtonRegion {
    param([System.Windows.Forms.Button]$Button)
    $rect = $Button.ClientRectangle
    if ($rect.Width -le 0 -or $rect.Height -le 0) { return }
    $path = New-RoundedButtonPath $rect 4
    $Button.Region = New-Object System.Drawing.Region($path)
    $path.Dispose()
  }

  function Set-ButtonStyle {
    param(
      [System.Windows.Forms.Button]$Button,
      [System.Drawing.Color]$BackColor,
      [System.Drawing.Color]$ForeColor,
      [System.Drawing.Color]$BorderColor
    )
    $Button.FlatStyle = "Flat"
    $Button.FlatAppearance.BorderSize = 0
    $Button.FlatAppearance.MouseOverBackColor = [System.Windows.Forms.ControlPaint]::Light($BackColor)
    $Button.FlatAppearance.MouseDownBackColor = [System.Windows.Forms.ControlPaint]::Dark($BackColor)
    $Button.BackColor = $BackColor
    $Button.ForeColor = $ForeColor
    $Button.TextAlign = "MiddleCenter"
    $Button.Padding = New-Object System.Windows.Forms.Padding(0, 2, 0, 0)
    $Button.Margin = New-Object System.Windows.Forms.Padding(0)
    $Button.UseVisualStyleBackColor = $false
    $Button.Tag = [pscustomobject]@{ BorderColor = $BorderColor }
    Set-RoundedButtonRegion $Button
    $Button.Add_Resize({ param($sender, $eventArgs) Set-RoundedButtonRegion $sender })
    $Button.Add_Paint({
      param($sender, $eventArgs)
      $rect = $sender.ClientRectangle
      if ($rect.Width -le 3 -or $rect.Height -le 3) { return }
      $rect.X += 1
      $rect.Y += 1
      $rect.Width -= 3
      $rect.Height -= 3
      $eventArgs.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
      $path = New-RoundedButtonPath $rect 4
      $pen = New-Object System.Drawing.Pen($sender.Tag.BorderColor, 1)
      $eventArgs.Graphics.DrawPath($pen, $path)
      $pen.Dispose()
      $path.Dispose()
    })
  }

  $header = New-Object System.Windows.Forms.Panel
  $header.Left = 0
  $header.Top = 0
  $header.Width = 900
  $header.Height = 72
  $header.Anchor = "Top,Left,Right"
  $header.BackColor = [System.Drawing.Color]::FromArgb(29, 36, 48)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = "FigBoost"
  $title.Left = 22
  $title.Top = 14
  $title.Width = 300
  $title.Height = 26
  $title.ForeColor = [System.Drawing.Color]::White
  $title.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 13, [System.Drawing.FontStyle]::Bold)

  $subtitle = New-Object System.Windows.Forms.Label
  $subtitle.Text = "给官方 Figma Desktop 安装中文界面补丁"
  $subtitle.Left = 22
  $subtitle.Top = 42
  $subtitle.Width = 620
  $subtitle.Height = 20
  $subtitle.ForeColor = [System.Drawing.Color]::FromArgb(196, 207, 222)
  $header.Controls.AddRange(@($title, $subtitle))

  $currentGroup = New-Object System.Windows.Forms.GroupBox
  $currentGroup.Text = "当前电脑 Figma 客户端信息"
  $currentGroup.Left = 18
  $currentGroup.Top = 88
  $currentGroup.Width = 846
  $currentGroup.Height = 86
  $currentGroup.Anchor = "Top,Left,Right"
  $currentGroup.BackColor = [System.Drawing.Color]::White

  $script:ValueCurrentFigma = New-Object System.Windows.Forms.Label
  $script:ValueCurrentFigma.Text = "未检测"
  $script:ValueCurrentFigma.Left = 18
  $script:ValueCurrentFigma.Top = 28
  $script:ValueCurrentFigma.Width = 200
  $script:ValueCurrentFigma.Height = 28
  $script:ValueCurrentFigma.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 13, [System.Drawing.FontStyle]::Bold)

  $script:ValueOfficialLatest = New-Object System.Windows.Forms.Label
  $script:ValueOfficialLatest.Text = "官方最新版：未检查"
  $script:ValueOfficialLatest.Left = 220
  $script:ValueOfficialLatest.Top = 32
  $script:ValueOfficialLatest.Width = 270
  $script:ValueOfficialLatest.Height = 22

  $script:ValueCurrentPatch = New-Object System.Windows.Forms.Label
  $script:ValueCurrentPatch.Text = "补丁状态：未检测"
  $script:ValueCurrentPatch.Left = 510
  $script:ValueCurrentPatch.Top = 32
  $script:ValueCurrentPatch.Width = 150
  $script:ValueCurrentPatch.Height = 22

  $script:ValueCurrentPath = New-Object System.Windows.Forms.Label
  $script:ValueCurrentPath.Text = "客户端目录：未检测"
  $script:ValueCurrentPath.Left = 18
  $script:ValueCurrentPath.Top = 58
  $script:ValueCurrentPath.Width = 790
  $script:ValueCurrentPath.Height = 22
  $script:ValueCurrentPath.AutoEllipsis = $true

  $currentGroup.Controls.AddRange(@($script:ValueCurrentFigma, $script:ValueOfficialLatest, $script:ValueCurrentPatch, $script:ValueCurrentPath))

  $labelApp = New-Object System.Windows.Forms.Label
  $labelApp.Text = "Figma 客户端 app-* 目录"
  $labelApp.Left = 18
  $labelApp.Top = 190
  $labelApp.Width = 160
  $labelApp.Height = 18

  $appInput = New-InputBox 18 212 730
  $txtApp = $appInput.TextBox
  $txtApp.Text = ""

  $btnBrowse = New-Object System.Windows.Forms.Button
  $btnBrowse.Text = "浏览"
  $btnBrowse.Left = 764
  $btnBrowse.Top = 212
  $btnBrowse.Width = 100
  $btnBrowse.Height = 34
  $btnBrowse.Anchor = "Top,Right"

  $btnApplyAppPath = New-Object System.Windows.Forms.Button
  $btnApplyAppPath.Text = "保存客户端路径"
  $btnApplyAppPath.Left = 630
  $btnApplyAppPath.Top = 212
  $btnApplyAppPath.Width = 118
  $btnApplyAppPath.Height = 34
  $btnApplyAppPath.Anchor = "Top,Right"
  $appInput.Panel.Width = 596
  $txtApp.Width = 564

  $labelRuntime = New-Object System.Windows.Forms.Label
  $labelRuntime.Text = "补丁文件保存目录"
  $labelRuntime.Left = 18
  $labelRuntime.Top = 252
  $labelRuntime.Width = 160
  $labelRuntime.Height = 18

  $runtimeInput = New-InputBox 18 274 730
  $txtRuntime = $runtimeInput.TextBox
  $txtRuntime.Text = $RuntimeDir

  $btnBrowseRuntime = New-Object System.Windows.Forms.Button
  $btnBrowseRuntime.Text = "浏览"
  $btnBrowseRuntime.Left = 764
  $btnBrowseRuntime.Top = 274
  $btnBrowseRuntime.Width = 100
  $btnBrowseRuntime.Height = 34
  $btnBrowseRuntime.Anchor = "Top,Right"

  $labelNotice = New-Object System.Windows.Forms.Label
  $labelNotice.Text = "安装或卸载汉化补丁会先关闭 Figma。请先保存未同步的工作。"
  $labelNotice.Left = 18
  $labelNotice.Top = 316
  $labelNotice.Width = 700
  $labelNotice.Anchor = "Top,Left,Right"
  $labelNotice.ForeColor = [System.Drawing.Color]::FromArgb(150, 70, 0)

  $btnStatus = New-Object System.Windows.Forms.Button
  $btnStatus.Text = "检测当前 Figma"
  $btnStatus.Left = 18
  $btnStatus.Top = 350
  $btnStatus.Width = 170
  $btnStatus.Height = 34

  $btnInstall = New-Object System.Windows.Forms.Button
  $btnInstall.Text = "安装汉化补丁"
  $btnInstall.Left = 202
  $btnInstall.Top = 350
  $btnInstall.Width = 130
  $btnInstall.Height = 34

  $btnUninstall = New-Object System.Windows.Forms.Button
  $btnUninstall.Text = "卸载汉化补丁"
  $btnUninstall.Left = 344
  $btnUninstall.Top = 350
  $btnUninstall.Width = 130
  $btnUninstall.Height = 34

  $btnFeatureManager = New-Object System.Windows.Forms.Button
  $btnFeatureManager.Text = "管理附加功能"
  $btnFeatureManager.Left = 486
  $btnFeatureManager.Top = 350
  $btnFeatureManager.Width = 180
  $btnFeatureManager.Height = 34

  foreach ($button in @($btnBrowse, $btnApplyAppPath, $btnBrowseRuntime, $btnStatus, $btnInstall, $btnUninstall, $btnFeatureManager)) {
    if ($button -ne $btnFeatureManager) {
      Set-ButtonStyle $button `
        ([System.Drawing.Color]::FromArgb(244, 247, 251)) `
        ([System.Drawing.Color]::FromArgb(28, 35, 45)) `
        ([System.Drawing.Color]::FromArgb(140, 154, 174))
    } else {
      Set-ButtonStyle $button `
        ([System.Drawing.Color]::FromArgb(18, 119, 242)) `
        ([System.Drawing.Color]::White) `
        ([System.Drawing.Color]::Transparent)
    }
  }

  $progressLabel = New-Object System.Windows.Forms.Label
  $progressLabel.Text = "准备就绪"
  $progressLabel.Left = 18
  $progressLabel.Top = 394
  $progressLabel.Width = 846
  $progressLabel.Height = 18
  $progressLabel.Anchor = "Top,Left,Right"
  $progressLabel.ForeColor = [System.Drawing.Color]::FromArgb(74, 85, 104)
  $progressLabel.Visible = $false

  $progressBar = New-Object System.Windows.Forms.ProgressBar
  $progressBar.Left = 18
  $progressBar.Top = 414
  $progressBar.Width = 846
  $progressBar.Height = 12
  $progressBar.Anchor = "Top,Left,Right"
  $progressBar.Minimum = 0
  $progressBar.Maximum = 100
  $progressBar.Value = 0
  $progressBar.Visible = $false

  $statusGroup = New-Object System.Windows.Forms.GroupBox
  $statusGroup.Text = "当前检测结果"
  $statusGroup.Left = 18
  $statusGroup.Top = 438
  $statusGroup.Width = 846
  $statusGroup.Height = 118
  $statusGroup.Anchor = "Top,Left,Right"

  function New-StatusLabel {
    param([string]$Text, [int]$Top, [int]$Left = 18)
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Text
    $label.Left = $Left
    $label.Top = $Top
    $label.Width = 120
    return $label
  }

  function New-StatusValue {
    param([int]$Top)
    $label = New-Object System.Windows.Forms.Label
    $label.Text = "未检测"
    $label.Left = 145
    $label.Top = $Top
    $label.Width = 590
    $label.AutoEllipsis = $true
    return $label
  }

  $script:ValuePatcher = New-StatusValue 22
  $script:ValuePatcher.Text = "v$PatcherVersion"
  $script:ValuePayload = New-StatusValue 44
  $script:ValuePayload.Text = "v$(Get-PayloadVersion)"
  $script:ValueFigmaVersion = New-StatusValue 66
  $script:ValuePatchState = New-StatusValue 22
  $script:ValuePatchState.Left = 510
  $script:ValueBackupState = New-StatusValue 44
  $script:ValueBackupState.Left = 510
  $script:ValueRuntimeState = New-StatusValue 66
  $script:ValueRuntimeState.Left = 510
  $script:ValueUpdaterGuardState = New-StatusValue 88
  $script:ValueUpdaterGuardState.Left = 510

  $statusGroup.Controls.AddRange(@(
    (New-StatusLabel "补丁程序版本：" 22),
    $script:ValuePatcher,
    (New-StatusLabel "词库版本：" 44),
    $script:ValuePayload,
    (New-StatusLabel "Figma 版本：" 66),
    $script:ValueFigmaVersion,
    (New-StatusLabel "补丁状态：" 22 390),
    $script:ValuePatchState,
    (New-StatusLabel "备份状态：" 44 390),
    $script:ValueBackupState,
    (New-StatusLabel "运行时文件：" 66 390),
    $script:ValueRuntimeState,
    (New-StatusLabel "内置更新拦截：" 88 390),
    $script:ValueUpdaterGuardState
  ))

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

  $runAction = {
    param([scriptblock]$Action, [scriptblock]$OnSuccess, [string]$FailurePrefix = "操作失败", [string]$ProgressText = "正在处理...")
    try {
      $form.UseWaitCursor = $true
      Set-ProgressState 8 $ProgressText
      $result = & $Action
      Set-ProgressState 100 "操作完成"
      if ($result) {
        Set-StatusLabels $result
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

  $featureDefinitions = @(
    [pscustomobject]@{
      Id = "auto-check-official-latest"
      Title = "在 Figma 顶部显示 FigBoost 菜单"
      Description = "在 Figma 界面顶部显示 FigBoost 入口；菜单中可检查官方最新版，发现新版后询问是否更新。"
      ProgressText = "正在安装 FigBoost 菜单功能..."
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
        return "附加功能已安装。`r`n`r`n之后打开 Figma 时，顶部会显示 FigBoost 入口；打开菜单即可检查官方最新版，发现新版后会先询问再更新。`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })"
      }
      UninstallProgressText = "正在卸载附加功能..."
      UninstallFailurePrefix = "附加功能卸载失败"
      UninstallAction = {
        Set-ProgressState 35 "正在关闭附加功能..."
        Uninstall-Feature "auto-check-official-latest" $txtRuntime.Text
        $current = Resolve-ManagedFigmaAppDir $txtRuntime.Text $txtApp.Text
        Repair-FigmaShortcuts $current
        if ($current) { return Get-CompleteStatus $current $txtRuntime.Text }
        return $null
      }
      UninstallSuccessMessage = {
        param($result)
        $patchState = if ($result) { "`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })" } else { "" }
        return "附加功能已卸载。`r`n`r`n之后打开 Figma 时不再显示《检查更新》按钮；汉化补丁不受影响。$patchState"
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

  $btnBrowse.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "选择 Figma app-* 目录"
    if ($txtApp.Text) { $dialog.SelectedPath = $txtApp.Text }
    if ($dialog.ShowDialog($form) -eq "OK") {
      $txtApp.Text = $dialog.SelectedPath
    }
  })

  $btnBrowseRuntime.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "选择补丁文件保存目录"
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
        Assert-FigmaClosed -Force
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
    } "保存客户端路径失败" "正在保存客户端路径..."
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
  $btnFeatureManager.Add_Click({ Show-FeatureInstallDialog })
  $btnInstall.Add_Click({
    & $runAction {
      Set-ProgressState 30 "正在安装汉化补丁..."
      Install-Patch $txtApp.Text $txtRuntime.Text -Force
    } {
      param($result)
      if ($result.AlreadyPatched) {
        Show-InfoMessage ("该补丁已安装，不需要重复安装。`r`n`r`nFigma 版本：$($result.FigmaVersion)`r`n词库版本：v$($result.PayloadVersion)")
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
    $btnStatus, $btnInstall, $btnUninstall, $btnFeatureManager, $progressLabel, $progressBar, $statusGroup
  ))

  try {
    $preferredAppDir = Get-PreferredAppDir $txtRuntime.Text
    $initialAppDir = if ($preferredAppDir) { $preferredAppDir } else { Find-CurrentFigmaAppDir }
    $txtApp.Text = $initialAppDir
    Set-StatusLabels (Get-CompleteStatus $initialAppDir $txtRuntime.Text)
  } catch {
    $script:ValueCurrentFigma.Text = "未检测到 Figma"
    $script:ValueCurrentPatch.Text = "补丁状态：未检测"
    $script:ValueCurrentPath.Text = "客户端目录：未找到完整的 Figma 客户端"
  }

  [void]$form.ShowDialog()
}

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
