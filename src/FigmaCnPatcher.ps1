param(
  [switch]$SelfTest,
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status,
  [switch]$CheckLatest,
  [switch]$UpdateFigma,
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
if ($args -contains "-ForceClose" -or $args -contains "/ForceClose") { $ForceClose = $true }

$PatchMarker = "FIGMA_ZH_OFFICIAL_MAIN_HOOK_V3"
$PatcherVersion = "0.3.4"
$PayloadFile = "i.js"
$MainPayloadFile = "m.js"
$BackupFile = "app.asar.figma-zh-official-preload-original"
$LicenseCommentTarget = "/*! Bundled license information:"
$OfficialReleasesXmlUrl = "https://desktop.figma.com/win/releases.xml"
$OfficialInstallerUrl = "https://desktop.figma.com/win/FigmaSetup.exe"
$EmbeddedPayloadFiles = @{}

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
      $link = [string]$item.link
      $releases += New-FigmaReleaseInfo $version ([string]$item.title) $(if ($link) { $link } else { $OfficialInstallerUrl }) $OfficialReleasesXmlUrl
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
  return ";(()=>{const M=$marker;try{const E=require(""electron""),F=require(""fs""),P=$payload,Q=$mainPayload;try{F.existsSync(Q)&&eval(F.readFileSync(Q,""utf8""))}catch(e){}let C;function p(){return C||(C=F.readFileSync(P,""utf8""))}function j(w){if(!w||w._fz)return;w._fz=1;const r=()=>{try{let u=w.getURL();/^https:\/\/([^\/]+\.)?figma\.com/i.test(u)&&w.executeJavaScript(p(),true).catch(()=>{})}catch(e){}};w.on(""dom-ready"",r);w.on(""did-finish-load"",r)}E.app.on(""web-contents-created"",(_,w)=>j(w));E.webContents.getAllWebContents().forEach(j)}catch(e){}})();"
}

function Write-RuntimeFiles {
  param([string]$RuntimeDir)
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $RuntimeDir $PayloadFile), (Build-Payload), [System.Text.Encoding]::UTF8)
  [System.IO.File]::WriteAllText((Join-Path $RuntimeDir $MainPayloadFile), (Build-MainPayload), [System.Text.Encoding]::UTF8)
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
    MainSha256 = Get-Sha256Hex $main.Bytes
  }
}

function Get-CompleteStatus {
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$CheckOfficial)
  $target = Resolve-Target $SelectedAppDir
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
  $source = [System.Text.Encoding]::UTF8.GetString($main.Bytes)
  if ($source.Contains($PatchMarker)) {
    return [pscustomobject]@{ Changed = $false; AlreadyPatched = $true }
  }

  $needle = [System.Text.Encoding]::UTF8.GetBytes($LicenseCommentTarget)
  $targetIndex = Get-BytesIndex $main.Bytes $needle
  if ($targetIndex -lt 0) {
    throw "Cannot find bundled license comment injection target"
  }

  $hook = Build-MainHook $RuntimeDir
  $hookBytes = [System.Text.Encoding]::UTF8.GetBytes($hook)
  $chunkSize = $main.Bytes.Length - $targetIndex
  if ($hookBytes.Length -gt $chunkSize) {
    throw "Main hook is too large for in-place patch: $($hookBytes.Length) bytes"
  }

  $nextBytes = New-Object byte[] $main.Bytes.Length
  [Array]::Copy($main.Bytes, $nextBytes, $main.Bytes.Length)
  $replacement = New-Object byte[] $chunkSize
  for ($i = 0; $i -lt $replacement.Length; $i++) { $replacement[$i] = 32 }
  [Array]::Copy($hookBytes, 0, $replacement, 0, $hookBytes.Length)
  [Array]::Copy($replacement, 0, $nextBytes, $targetIndex, $replacement.Length)

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
  return [pscustomobject]@{ Changed = $true; Hash = $nextHash }
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
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$Force, [switch]$SkipProcessCheck)
  if (-not $SkipProcessCheck) { Assert-FigmaClosed -Force:$Force }
  $target = Resolve-Target $SelectedAppDir
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
  $result = Patch-Asar $target $SelectedRuntimeDir
  Write-Log "Install result: $($result | ConvertTo-Json -Compress)"
  $status = Get-PatchStatus $target $SelectedRuntimeDir
  $status | Add-Member -NotePropertyName AlreadyPatched -NotePropertyValue ([bool]$result.AlreadyPatched) -Force
  Repair-FigmaShortcuts $target.AppDir
  return $status
}

function Uninstall-Patch {
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$Force, [switch]$SkipProcessCheck)
  if (-not $SkipProcessCheck) { Assert-FigmaClosed -Force:$Force }
  $target = Resolve-Target $SelectedAppDir
  if (-not (Test-Path -LiteralPath $target.BackupPath)) {
    throw "Backup not found: $($target.BackupPath)"
  }
  Copy-Item -LiteralPath $target.BackupPath -Destination $target.AsarPath -Force
  Write-Log "Restored original app.asar from backup."
  return Get-PatchStatus $target $SelectedRuntimeDir
}

function Update-FigmaOfficial {
  param([string]$SelectedRuntimeDir, [switch]$Force)
  $currentTarget = Resolve-Target ""
  $release = Get-OfficialLatestFigmaRelease $currentTarget.FigmaVersion
  if ((Compare-VersionString $currentTarget.FigmaVersion $release.Version) -ge 0) {
    Repair-FigmaShortcuts $currentTarget.AppDir
    return Install-Patch $currentTarget.AppDir $SelectedRuntimeDir -Force:$Force
  }

  Assert-FigmaClosed -Force:$Force
  $installerExt = [System.IO.Path]::GetExtension(([Uri]$release.InstallerUrl).AbsolutePath)
  if (-not $installerExt) { $installerExt = ".exe" }
  $installer = Join-Path ([System.IO.Path]::GetTempPath()) "FigmaSetup-official-latest$installerExt"
  try {
    Invoke-WebRequest -Uri $release.InstallerUrl -OutFile $installer -UseBasicParsing -TimeoutSec 900
    if ($installerExt -ieq ".msi") {
      $process = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", $installer, "/qn", "/norestart") -PassThru
    } else {
      $process = Start-Process -FilePath $installer -ArgumentList "/S" -PassThru
    }
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

  Start-Sleep -Seconds 3
  $target = Resolve-Target ""
  if ((Compare-VersionString $target.FigmaVersion $release.Version) -lt 0) {
    throw "Figma update did not reach official version $($release.Version). Current version: $($target.FigmaVersion)."
  }
  Repair-FigmaShortcuts $target.AppDir
  return Install-Patch $target.AppDir $SelectedRuntimeDir -Force:$Force
}

function Repair-FigmaShortcuts {
  param([string]$AppDir)
  if (-not (Test-FigmaAppDir $AppDir)) { return }
  $figmaRoot = Split-Path -Parent $AppDir
  $target = Join-Path $AppDir "Figma.exe"
  $launcher = Join-Path $figmaRoot "Figma.exe"
  $iconSource = if (Test-Path -LiteralPath $launcher) { $launcher } else { $target }
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
        if ($shortcut.TargetPath -and (Split-Path -Leaf $shortcut.TargetPath) -ieq "Figma.exe") {
          $shortcut.TargetPath = $target
          $shortcut.WorkingDirectory = $AppDir
          $shortcut.IconLocation = "$iconSource,0"
          $shortcut.Save()
        }
      }
    }
  } catch {}
}

function New-FakeAsar {
  param([string]$AsarPath)
  $mainText = 'console.log("figma");' + "`n" + $LicenseCommentTarget + " test license block with enough room for the hook " + ("x" * 1200)
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
  $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("figma-cn-patcher-test-" + [Guid]::NewGuid().ToString("N"))
  $originalLocalAppData = $env:LOCALAPPDATA
  New-Item -ItemType Directory -Force -Path (Join-Path $temp "app-1.2.3\resources") | Out-Null
  $fakeAppDir = Join-Path $temp "app-1.2.3"
  $fakeAsar = Join-Path $fakeAppDir "resources\app.asar"
  $fakeRuntime = Join-Path $temp "runtime"
  try {
    New-FakeAsar $fakeAsar
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
    $installStatus = Install-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck
    if (-not $installStatus.Patched) { throw "Self-test install did not mark the app as patched." }
    if (-not $installStatus.HasBackup) { throw "Self-test did not create a backup." }
    if (-not $installStatus.HasRuntimePayload) { throw "Self-test did not write the runtime payload." }
    if (-not $installStatus.HasRuntimeMainPayload) { throw "Self-test did not write the main runtime payload." }
    if ($installStatus.PayloadVersion -ne (Get-PayloadVersion)) { throw "Self-test payload version mismatch." }
    $repeatInstallStatus = Install-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck
    if (-not $repeatInstallStatus.AlreadyPatched) { throw "Self-test repeat install did not report already patched." }
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
  param([string]$Text, [string]$Title = "Figma 客户端汉化补丁")
  [System.Windows.Forms.MessageBox]::Show($Text, $Title, "OK", "Information") | Out-Null
}

function Show-ErrorMessage {
  param([string]$Text)
  [System.Windows.Forms.MessageBox]::Show($Text, "Figma 客户端汉化补丁", "OK", "Error") | Out-Null
}

function Show-Gui {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "Figma 客户端汉化补丁 v$PatcherVersion"
  $form.StartPosition = "CenterScreen"
  $form.Width = 900
  $form.Height = 625
  $form.MinimumSize = New-Object System.Drawing.Size(860, 605)
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
  $title.Text = "Figma 客户端汉化补丁"
  $title.Left = 22
  $title.Top = 14
  $title.Width = 300
  $title.Height = 26
  $title.ForeColor = [System.Drawing.Color]::White
  $title.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 13, [System.Drawing.FontStyle]::Bold)

  $subtitle = New-Object System.Windows.Forms.Label
  $subtitle.Text = "基于官方原生客户端，支持检查官方最新版并自动更新后安装补丁"
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

  $btnRefreshLatest = New-Object System.Windows.Forms.Button
  $btnRefreshLatest.Text = "刷新"
  $btnRefreshLatest.Left = 746
  $btnRefreshLatest.Top = 26
  $btnRefreshLatest.Width = 82
  $btnRefreshLatest.Height = 30
  $btnRefreshLatest.Anchor = "Top,Right"

  $script:ValueCurrentPath = New-Object System.Windows.Forms.Label
  $script:ValueCurrentPath.Text = "客户端目录：未检测"
  $script:ValueCurrentPath.Left = 18
  $script:ValueCurrentPath.Top = 58
  $script:ValueCurrentPath.Width = 790
  $script:ValueCurrentPath.Height = 22
  $script:ValueCurrentPath.AutoEllipsis = $true

  $currentGroup.Controls.AddRange(@($script:ValueCurrentFigma, $script:ValueOfficialLatest, $script:ValueCurrentPatch, $btnRefreshLatest, $script:ValueCurrentPath))

  $labelApp = New-Object System.Windows.Forms.Label
  $labelApp.Text = "Figma客户端目录"
  $labelApp.Left = 18
  $labelApp.Top = 190
  $labelApp.Width = 160
  $labelApp.Height = 18

  $appInput = New-InputBox 18 212 730
  $txtApp = $appInput.TextBox
  try { $txtApp.Text = Find-CurrentFigmaAppDir } catch { $txtApp.Text = "" }

  $btnBrowse = New-Object System.Windows.Forms.Button
  $btnBrowse.Text = "浏览"
  $btnBrowse.Left = 764
  $btnBrowse.Top = 212
  $btnBrowse.Width = 100
  $btnBrowse.Height = 34
  $btnBrowse.Anchor = "Top,Right"

  $labelRuntime = New-Object System.Windows.Forms.Label
  $labelRuntime.Text = "运行时目录"
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
  $labelNotice.Text = "提示：安装或卸载时会自动强制关闭 Figma，请先保存未同步的工作。"
  $labelNotice.Left = 18
  $labelNotice.Top = 316
  $labelNotice.Width = 700
  $labelNotice.Anchor = "Top,Left,Right"
  $labelNotice.ForeColor = [System.Drawing.Color]::FromArgb(150, 70, 0)

  $btnStatus = New-Object System.Windows.Forms.Button
  $btnStatus.Text = "自动检查路径和版本"
  $btnStatus.Left = 18
  $btnStatus.Top = 350
  $btnStatus.Width = 170
  $btnStatus.Height = 34

  $btnInstall = New-Object System.Windows.Forms.Button
  $btnInstall.Text = "安装补丁"
  $btnInstall.Left = 202
  $btnInstall.Top = 350
  $btnInstall.Width = 130
  $btnInstall.Height = 34

  $btnUninstall = New-Object System.Windows.Forms.Button
  $btnUninstall.Text = "卸载补丁"
  $btnUninstall.Left = 344
  $btnUninstall.Top = 350
  $btnUninstall.Width = 130
  $btnUninstall.Height = 34

  $btnCheckUpdate = New-Object System.Windows.Forms.Button
  $btnCheckUpdate.Text = "检查/更新官方最新版"
  $btnCheckUpdate.Left = 486
  $btnCheckUpdate.Top = 350
  $btnCheckUpdate.Width = 180
  $btnCheckUpdate.Height = 34

  foreach ($button in @($btnBrowse, $btnBrowseRuntime, $btnStatus, $btnInstall, $btnUninstall, $btnCheckUpdate, $btnRefreshLatest)) {
    if ($button -ne $btnCheckUpdate) {
      Set-ButtonStyle $button `
        ([System.Drawing.Color]::FromArgb(244, 247, 251)) `
        ([System.Drawing.Color]::FromArgb(28, 35, 45)) `
        ([System.Drawing.Color]::FromArgb(140, 154, 174))
    } else {
      Set-ButtonStyle $button `
        ([System.Drawing.Color]::FromArgb(18, 119, 242)) `
        ([System.Drawing.Color]::White) `
        ([System.Drawing.Color]::FromArgb(12, 92, 190))
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
  $statusGroup.Height = 96
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
    $script:ValueRuntimeState
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
        if ($OnSuccess) { & $OnSuccess $result }
      }
    } catch {
      Set-ProgressState 0 "操作失败"
      Show-ErrorMessage "$FailurePrefix：`r`n`r`n$($_.Exception.Message)"
    } finally {
      $form.UseWaitCursor = $false
      Hide-ProgressState
    }
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
    $dialog.Description = "选择汉化补丁运行时目录"
    $dialog.ShowNewFolderButton = $true
    if ($txtRuntime.Text -and (Test-Path -LiteralPath $txtRuntime.Text)) { $dialog.SelectedPath = $txtRuntime.Text }
    if ($dialog.ShowDialog($form) -eq "OK") {
      $txtRuntime.Text = $dialog.SelectedPath
    }
  })

  $btnRefreshLatest.Add_Click({
    try {
      $form.UseWaitCursor = $true
      Set-ProgressState 20 "正在刷新官方最新版本..."
      $release = Get-OfficialLatestFigmaRelease
      $script:ValueOfficialLatest.Text = "官方最新版：$($release.Version)"
      try {
        $current = if ($txtApp.Text -and (Test-FigmaAppDir $txtApp.Text)) { $txtApp.Text } else { Find-CurrentFigmaAppDir }
        $txtApp.Text = $current
        Set-StatusLabels (Get-CompleteStatus $current $txtRuntime.Text -CheckOfficial)
      } catch {
        $script:ValueCurrentFigma.Text = "未检测到 Figma"
        $script:ValueCurrentPatch.Text = "补丁状态：未检测"
        $script:ValueCurrentPath.Text = "客户端目录：未找到完整的 Figma 客户端"
      }
    } catch {
      Show-ErrorMessage "刷新失败：`r`n`r`n$($_.Exception.Message)"
    } finally {
      $form.UseWaitCursor = $false
      Hide-ProgressState
    }
  })

  $btnStatus.Add_Click({
    & $runAction {
      $current = Find-CurrentFigmaAppDir
      $txtApp.Text = $current
      Get-CompleteStatus $current $txtRuntime.Text
    } {
      param($result)
      Show-InfoMessage ("检测完成。`r`n`r`nFigma 路径：$($result.AppDir)`r`nFigma 版本：$($result.FigmaVersion)`r`n词库版本：v$($result.PayloadVersion)`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })")
    } "检测失败" "正在检测当前版本..."
  })
  $btnCheckUpdate.Add_Click({
    & $runAction {
      Set-ProgressState 12 "正在检查官方最新版本..."
      $current = Find-CurrentFigmaAppDir
      $txtApp.Text = $current
      $status = Get-CompleteStatus $current $txtRuntime.Text -CheckOfficial
      if ($status.IsOfficialLatest) { return $status }
      $choice = [System.Windows.Forms.MessageBox]::Show(
        "检测到官方最新版 Figma $($status.OfficialLatestVersion)，当前电脑是 $($status.FigmaVersion)。`r`n`r`n点击 是 会下载官方更新包并自动更新，更新完成后会自动安装汉化补丁。",
        "发现官方新版",
        "YesNo",
        "Question"
      )
      if ($choice -ne "Yes") { return $status }
      Set-ProgressState 35 "正在下载并安装官方新版..."
      $updated = Update-FigmaOfficial $txtRuntime.Text -Force
      $txtApp.Text = $updated.AppDir
      Set-ProgressState 92 "正在安装汉化补丁..."
      return Get-CompleteStatus $updated.AppDir $txtRuntime.Text -CheckOfficial
    } {
      param($result)
      if ($result.PSObject.Properties.Name -contains "OfficialLatestVersion") {
        Show-InfoMessage ("检测完成。`r`n`r`n当前版本：$($result.FigmaVersion)`r`n官方最新版：$($result.OfficialLatestVersion)`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })")
      }
    } "检查或更新失败" "正在检查或更新官方版本..."
  })
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
    $labelApp, $appInput.Panel, $btnBrowse, $labelRuntime, $runtimeInput.Panel, $btnBrowseRuntime, $labelNotice,
    $btnStatus, $btnInstall, $btnUninstall, $btnCheckUpdate, $progressLabel, $progressBar, $statusGroup
  ))

  try {
    $initialAppDir = Find-CurrentFigmaAppDir
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
    Update-FigmaOfficial $RuntimeDir -Force:$ForceClose | ConvertTo-Json -Depth 8
  } elseif ($CheckLatest) {
    Get-CompleteStatus $AppDir $RuntimeDir -CheckOfficial | ConvertTo-Json -Depth 8
  } else {
    $target = Resolve-Target $AppDir
    Get-PatchStatus $target $RuntimeDir | ConvertTo-Json -Depth 8
  }
  return
}

Show-Gui
