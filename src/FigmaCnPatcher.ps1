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
$PatcherVersion = "0.3.0"
$PayloadFile = "i.js"
$MainPayloadFile = "m.js"
$BackupFile = "app.asar.figma-zh-official-preload-original"
$LicenseCommentTarget = "/*! Bundled license information:"
$OfficialReleaseJsonUrl = "https://desktop.figma.com/win/RELEASE.json"
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
  if ($Name -match '^app-(\d+)\.(\d+)\.(\d+)$') {
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
      (Test-Path -LiteralPath (Join-Path $_.FullName "resources\app.asar"))
    } |
    Sort-Object @{
      Expression = { (Get-SemverParts $_.Name)[0] }
      Descending = $true
    }, @{
      Expression = { (Get-SemverParts $_.Name)[1] }
      Descending = $true
    }, @{
      Expression = { (Get-SemverParts $_.Name)[2] }
      Descending = $true
    }

  if (-not $items -or $items.Count -eq 0) {
    throw "No complete app-* Figma version directory found in: $figmaRoot"
  }
  return $items[0].FullName
}

function Get-FigmaVersionFromAppDir {
  param([string]$AppDir)
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

function Get-OfficialLatestFigmaRelease {
  param([string]$CurrentVersion = "0.0.0")
  $releaseUrl = "{0}?id=Figma&localVersion={1}&arch=x64&osVersion={2}&minUpdateStage=0" -f @(
    $OfficialReleaseJsonUrl,
    [Uri]::EscapeDataString($CurrentVersion),
    [Uri]::EscapeDataString([Environment]::OSVersion.Version.ToString())
  )
  $response = Invoke-WebRequest -Uri $releaseUrl -UseBasicParsing -TimeoutSec 20
  $release = $response.Content | ConvertFrom-Json
  if (-not $release.version) { throw "Official Figma release response did not include a version." }
  return [pscustomobject]@{
    Version = [string]$release.version
    Name = [string]$release.name
    PackageUrl = "https://desktop.figma.com/win/Figma-$($release.version)-full.nupkg"
    ReleasesUrl = $releaseUrl.Replace("RELEASE.json", "RELEASES")
    ReleaseUrl = $releaseUrl
  }
}

function Resolve-Target {
  param([string]$SelectedAppDir)
  $resolvedAppDir = if ($SelectedAppDir) { (Resolve-Path -LiteralPath $SelectedAppDir).Path } else { Find-LatestFigmaAppDir }
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
    return Install-Patch $currentTarget.AppDir $SelectedRuntimeDir -Force:$Force
  }

  Assert-FigmaClosed -Force:$Force
  $figmaRoot = Split-Path -Parent $currentTarget.AppDir
  $updater = Join-Path $figmaRoot "Update.exe"
  if (-not (Test-Path -LiteralPath $updater)) { throw "Figma Update.exe not found: $updater" }

  $feedDir = Join-Path ([System.IO.Path]::GetTempPath()) ("figma-official-update-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $feedDir | Out-Null
  try {
    Invoke-WebRequest -Uri $release.ReleasesUrl -OutFile (Join-Path $feedDir "RELEASES") -UseBasicParsing -TimeoutSec 60
    Invoke-WebRequest -Uri $release.PackageUrl -OutFile (Join-Path $feedDir ("Figma-$($release.Version)-full.nupkg")) -UseBasicParsing -TimeoutSec 900
    $process = Start-Process -FilePath $updater -ArgumentList @("--update", $feedDir) -PassThru
    if (-not $process.WaitForExit(600000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "Figma official updater did not finish within 10 minutes."
    }
    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
      throw "Figma official updater exited with code $($process.ExitCode)."
    }
  } finally {
    Remove-Item -LiteralPath $feedDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  Start-Sleep -Seconds 3
  $target = Resolve-Target ""
  if ((Compare-VersionString $target.FigmaVersion $release.Version) -lt 0) {
    throw "Figma update did not reach official version $($release.Version). Current version: $($target.FigmaVersion)."
  }
  return Install-Patch $target.AppDir $SelectedRuntimeDir -Force:$Force
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
    New-Item -ItemType Directory -Force -Path (Join-Path $validOlderAppDir "resources") | Out-Null
    New-Item -ItemType Directory -Force -Path $incompleteNewerAppDir | Out-Null
    New-FakeAsar (Join-Path $validOlderAppDir "resources\app.asar")
    $env:LOCALAPPDATA = $fakeLocalAppData
    $detectedAppDir = Find-LatestFigmaAppDir
    if ($detectedAppDir -ne $validOlderAppDir) { throw "Self-test did not skip incomplete update directory." }
    $env:LOCALAPPDATA = $originalLocalAppData
    if ((Compare-VersionString "126.4.10" "126.3.12") -le 0) { throw "Self-test version compare failed." }
    if ((Compare-VersionString "126.3.12" "126.4.10") -ge 0) { throw "Self-test version compare failed." }
    if ((Compare-VersionString "126.3.12" "126.3.12") -ne 0) { throw "Self-test version compare failed." }
    $installStatus = Install-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck
    if (-not $installStatus.Patched) { throw "Self-test install did not mark the app as patched." }
    if (-not $installStatus.HasBackup) { throw "Self-test did not create a backup." }
    if (-not $installStatus.HasRuntimePayload) { throw "Self-test did not write the runtime payload." }
    if (-not $installStatus.HasRuntimeMainPayload) { throw "Self-test did not write the main runtime payload." }
    if ($installStatus.PayloadVersion -ne "0.8.17") { throw "Self-test payload version mismatch." }
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
  if ($script:ValueCurrentFigma) { $script:ValueCurrentFigma.Text = "Figma $($Status.FigmaVersion)" }
  if ($script:ValueCurrentPath) { $script:ValueCurrentPath.Text = "客户端目录：$($Status.AppDir)" }
  if ($script:ValueCurrentPatch) { $script:ValueCurrentPatch.Text = "补丁状态：$(if ($Status.Patched) { "已安装" } else { "未安装" })" }
  if ($script:ValueOfficialLatest -and ($Status.PSObject.Properties.Name -contains "OfficialLatestVersion")) {
    $script:ValueOfficialLatest.Text = "官方最新版：$($Status.OfficialLatestVersion)$(if ($Status.IsOfficialLatest) { "（已是最新）" } else { "（可更新）" })"
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
  $form.Height = 630
  $form.MinimumSize = New-Object System.Drawing.Size(860, 610)
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
  $currentGroup.Height = 108
  $currentGroup.Anchor = "Top,Left,Right"
  $currentGroup.BackColor = [System.Drawing.Color]::White

  $script:ValueCurrentFigma = New-Object System.Windows.Forms.Label
  $script:ValueCurrentFigma.Text = "未检测"
  $script:ValueCurrentFigma.Left = 18
  $script:ValueCurrentFigma.Top = 28
  $script:ValueCurrentFigma.Width = 190
  $script:ValueCurrentFigma.Height = 28
  $script:ValueCurrentFigma.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 13, [System.Drawing.FontStyle]::Bold)

  $script:ValueOfficialLatest = New-Object System.Windows.Forms.Label
  $script:ValueOfficialLatest.Text = "官方最新版：未检查"
  $script:ValueOfficialLatest.Left = 220
  $script:ValueOfficialLatest.Top = 32
  $script:ValueOfficialLatest.Width = 240
  $script:ValueOfficialLatest.Height = 22

  $script:ValueCurrentPatch = New-Object System.Windows.Forms.Label
  $script:ValueCurrentPatch.Text = "补丁状态：未检测"
  $script:ValueCurrentPatch.Left = 480
  $script:ValueCurrentPatch.Top = 32
  $script:ValueCurrentPatch.Width = 160
  $script:ValueCurrentPatch.Height = 22

  $script:ValueCurrentPath = New-Object System.Windows.Forms.Label
  $script:ValueCurrentPath.Text = "客户端目录：未检测"
  $script:ValueCurrentPath.Left = 18
  $script:ValueCurrentPath.Top = 66
  $script:ValueCurrentPath.Width = 790
  $script:ValueCurrentPath.Height = 22
  $script:ValueCurrentPath.AutoEllipsis = $true

  $currentGroup.Controls.AddRange(@($script:ValueCurrentFigma, $script:ValueOfficialLatest, $script:ValueCurrentPatch, $script:ValueCurrentPath))

  $labelApp = New-Object System.Windows.Forms.Label
  $labelApp.Text = "Figma客户端目录"
  $labelApp.Left = 18
  $labelApp.Top = 214
  $labelApp.Width = 160
  $labelApp.Height = 18

  $appInput = New-InputBox 18 236 730
  $txtApp = $appInput.TextBox
  try { $txtApp.Text = Find-LatestFigmaAppDir } catch { $txtApp.Text = "" }

  $btnBrowse = New-Object System.Windows.Forms.Button
  $btnBrowse.Text = "浏览"
  $btnBrowse.Left = 764
  $btnBrowse.Top = 236
  $btnBrowse.Width = 100
  $btnBrowse.Height = 34
  $btnBrowse.Anchor = "Top,Right"

  $labelRuntime = New-Object System.Windows.Forms.Label
  $labelRuntime.Text = "运行时目录"
  $labelRuntime.Left = 18
  $labelRuntime.Top = 276
  $labelRuntime.Width = 160
  $labelRuntime.Height = 18

  $runtimeInput = New-InputBox 18 298 730
  $txtRuntime = $runtimeInput.TextBox
  $txtRuntime.Text = $RuntimeDir

  $labelNotice = New-Object System.Windows.Forms.Label
  $labelNotice.Text = "提示：安装或卸载时会自动强制关闭 Figma，请先保存未同步的工作。"
  $labelNotice.Left = 18
  $labelNotice.Top = 340
  $labelNotice.Width = 700
  $labelNotice.Anchor = "Top,Left,Right"
  $labelNotice.ForeColor = [System.Drawing.Color]::FromArgb(150, 70, 0)

  $btnStatus = New-Object System.Windows.Forms.Button
  $btnStatus.Text = "自动检查路径和版本"
  $btnStatus.Left = 18
  $btnStatus.Top = 374
  $btnStatus.Width = 170
  $btnStatus.Height = 34

  $btnInstall = New-Object System.Windows.Forms.Button
  $btnInstall.Text = "安装补丁"
  $btnInstall.Left = 202
  $btnInstall.Top = 374
  $btnInstall.Width = 130
  $btnInstall.Height = 34

  $btnUninstall = New-Object System.Windows.Forms.Button
  $btnUninstall.Text = "卸载补丁"
  $btnUninstall.Left = 344
  $btnUninstall.Top = 374
  $btnUninstall.Width = 130
  $btnUninstall.Height = 34

  $btnCheckUpdate = New-Object System.Windows.Forms.Button
  $btnCheckUpdate.Text = "检查/更新官方最新版"
  $btnCheckUpdate.Left = 486
  $btnCheckUpdate.Top = 374
  $btnCheckUpdate.Width = 180
  $btnCheckUpdate.Height = 34
  $btnCheckUpdate.BackColor = [System.Drawing.Color]::FromArgb(18, 119, 242)
  $btnCheckUpdate.ForeColor = [System.Drawing.Color]::White
  $btnCheckUpdate.FlatStyle = "Flat"

  $statusGroup = New-Object System.Windows.Forms.GroupBox
  $statusGroup.Text = "当前检测结果"
  $statusGroup.Left = 18
  $statusGroup.Top = 420
  $statusGroup.Width = 846
  $statusGroup.Height = 120
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

  $runAction = {
    param([scriptblock]$Action, [scriptblock]$OnSuccess, [string]$FailurePrefix = "操作失败")
    try {
      $form.UseWaitCursor = $true
      $result = & $Action
      if ($result) {
        Set-StatusLabels $result
        if ($OnSuccess) { & $OnSuccess $result }
      }
    } catch {
      Show-ErrorMessage "$FailurePrefix：`r`n`r`n$($_.Exception.Message)"
    } finally {
      $form.UseWaitCursor = $false
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

  $btnStatus.Add_Click({
    & $runAction {
      $latest = Find-LatestFigmaAppDir
      $txtApp.Text = $latest
      Get-CompleteStatus $latest $txtRuntime.Text
    } {
      param($result)
      Show-InfoMessage ("检测完成。`r`n`r`nFigma 路径：$($result.AppDir)`r`nFigma 版本：$($result.FigmaVersion)`r`n词库版本：v$($result.PayloadVersion)`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })")
    } "检测失败"
  })
  $btnCheckUpdate.Add_Click({
    & $runAction {
      $latest = Find-LatestFigmaAppDir
      $txtApp.Text = $latest
      $status = Get-CompleteStatus $latest $txtRuntime.Text -CheckOfficial
      if ($status.IsOfficialLatest) { return $status }
      $choice = [System.Windows.Forms.MessageBox]::Show(
        "检测到官方最新版 Figma $($status.OfficialLatestVersion)，当前电脑是 $($status.FigmaVersion)。`r`n`r`n点击 是 会下载官方更新包并自动更新，更新完成后会自动安装汉化补丁。",
        "发现官方新版",
        "YesNo",
        "Question"
      )
      if ($choice -ne "Yes") { return $status }
      $updated = Update-FigmaOfficial $txtRuntime.Text -Force
      $txtApp.Text = $updated.AppDir
      return Get-CompleteStatus $updated.AppDir $txtRuntime.Text -CheckOfficial
    } {
      param($result)
      if ($result.PSObject.Properties.Name -contains "OfficialLatestVersion") {
        Show-InfoMessage ("检测完成。`r`n`r`n当前版本：$($result.FigmaVersion)`r`n官方最新版：$($result.OfficialLatestVersion)`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })")
      }
    } "检查或更新失败"
  })
  $btnInstall.Add_Click({
    & $runAction {
      Install-Patch $txtApp.Text $txtRuntime.Text -Force
    } {
      param($result)
      if ($result.AlreadyPatched) {
        Show-InfoMessage ("该补丁已安装，不需要重复安装。`r`n`r`nFigma 版本：$($result.FigmaVersion)`r`n词库版本：v$($result.PayloadVersion)")
      } else {
        Show-InfoMessage ("安装成功。`r`n`r`nFigma 版本：$($result.FigmaVersion)`r`n词库版本：v$($result.PayloadVersion)`r`n补丁状态：已安装")
      }
    } "安装失败"
  })
  $btnUninstall.Add_Click({
    & $runAction {
      $target = Resolve-Target $txtApp.Text
      Uninstall-Patch $target.AppDir $txtRuntime.Text -Force
    } {
      param($result)
      Show-InfoMessage ("卸载成功。`r`n`r`nFigma 版本：$($result.FigmaVersion)`r`n补丁状态：未安装")
    } "卸载失败"
  })

  $form.Controls.AddRange(@(
    $header, $currentGroup,
    $labelApp, $appInput.Panel, $btnBrowse, $labelRuntime, $runtimeInput.Panel, $labelNotice,
    $btnStatus, $btnInstall, $btnUninstall, $btnCheckUpdate, $statusGroup
  ))

  try {
    $initialAppDir = Find-LatestFigmaAppDir
    $txtApp.Text = $initialAppDir
    Set-StatusLabels (Get-CompleteStatus $initialAppDir $txtRuntime.Text)
  } catch {
    $script:ValueCurrentFigma.Text = "未检测到完整 Figma 客户端"
    $script:ValueCurrentPath.Text = $_.Exception.Message
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
