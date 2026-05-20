param(
  [switch]$SelfTest,
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status,
  [string]$AppDir = "",
  [string]$RuntimeDir = "C:\FZ",
  [switch]$ForceClose
)

$ErrorActionPreference = "Stop"

if ($args -contains "-SelfTest" -or $args -contains "/SelfTest") { $SelfTest = $true }
if ($args -contains "-Install" -or $args -contains "/Install") { $Install = $true }
if ($args -contains "-Uninstall" -or $args -contains "/Uninstall") { $Uninstall = $true }
if ($args -contains "-Status" -or $args -contains "/Status") { $Status = $true }
if ($args -contains "-ForceClose" -or $args -contains "/ForceClose") { $ForceClose = $true }

$PatchMarker = "FIGMA_ZH_OFFICIAL_MAIN_HOOK_V2"
$PayloadFile = "i.js"
$BackupFile = "app.asar.figma-zh-official-preload-original"
$LicenseCommentTarget = "/*! Bundled license information:"

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
    Where-Object { Get-SemverParts $_.Name } |
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
    throw "No app-* Figma version directory found in: $figmaRoot"
  }
  return $items[0].FullName
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

function Build-Payload {
  $baseDir = Get-BaseDir
  $manifest = [System.IO.File]::ReadAllText((Join-Path $baseDir "payload\manifest.json"), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  $dictionary = [System.IO.File]::ReadAllText((Join-Path $baseDir "payload\src\dictionary\zh-CN.js"), [System.Text.Encoding]::UTF8)
  $core = [System.IO.File]::ReadAllText((Join-Path $baseDir "payload\src\content\localizer-core.js"), [System.Text.Encoding]::UTF8)
  $content = [System.IO.File]::ReadAllText((Join-Path $baseDir "payload\src\content\content.js"), [System.Text.Encoding]::UTF8)
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

function Build-MainHook {
  param([string]$RuntimeDir)
  $payloadPath = Join-Path $RuntimeDir $PayloadFile
  $marker = ConvertTo-JsString $PatchMarker
  $payload = ConvertTo-JsString $payloadPath
  return ";(()=>{const M=$marker;try{const E=require(""electron""),F=require(""fs""),P=$payload;let C;function p(){return C||(C=F.readFileSync(P,""utf8""))}function j(w){if(!w||w._fz)return;w._fz=1;const r=()=>{try{let u=w.getURL();/^https:\/\/([^\/]+\.)?figma\.com/i.test(u)&&w.executeJavaScript(p(),true).catch(()=>{})}catch(e){}};w.on(""dom-ready"",r);w.on(""did-finish-load"",r)}E.app.on(""web-contents-created"",(_,w)=>j(w));E.webContents.getAllWebContents().forEach(j)}catch(e){}})();"
}

function Write-RuntimeFiles {
  param([string]$RuntimeDir)
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $RuntimeDir $PayloadFile), (Build-Payload), [System.Text.Encoding]::UTF8)
}

function Get-PatchStatus {
  param($Target, [string]$RuntimeDir)
  $asar = Read-Asar $Target.AsarPath
  $main = Get-AsarFileSlice $asar "main.js"
  $source = [System.Text.Encoding]::UTF8.GetString($main.Bytes)
  return [pscustomobject]@{
    AppDir = $Target.AppDir
    AsarPath = $Target.AsarPath
    BackupPath = $Target.BackupPath
    RuntimeDir = (Resolve-Path -LiteralPath $RuntimeDir -ErrorAction SilentlyContinue).Path
    Patched = $source.Contains($PatchMarker)
    HasBackup = Test-Path -LiteralPath $Target.BackupPath
    HasRuntimePayload = Test-Path -LiteralPath (Join-Path $RuntimeDir $PayloadFile)
    MainSha256 = Get-Sha256Hex $main.Bytes
  }
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
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$Force)
  Assert-FigmaClosed -Force:$Force
  $target = Resolve-Target $SelectedAppDir
  if (-not (Test-Path -LiteralPath $target.BackupPath)) {
    Copy-Item -LiteralPath $target.AsarPath -Destination $target.BackupPath -Force
    Write-Log "Backup created: $($target.BackupPath)"
  } else {
    Write-Log "Using existing backup: $($target.BackupPath)"
  }
  Write-RuntimeFiles $SelectedRuntimeDir
  $result = Patch-Asar $target $SelectedRuntimeDir
  Write-Log "Install result: $($result | ConvertTo-Json -Compress)"
  return Get-PatchStatus $target $SelectedRuntimeDir
}

function Uninstall-Patch {
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$Force)
  Assert-FigmaClosed -Force:$Force
  $target = Resolve-Target $SelectedAppDir
  if (-not (Test-Path -LiteralPath $target.BackupPath)) {
    throw "Backup not found: $($target.BackupPath)"
  }
  Copy-Item -LiteralPath $target.BackupPath -Destination $target.AsarPath -Force
  Write-Log "Restored original app.asar from backup."
  return Get-PatchStatus $target $SelectedRuntimeDir
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
  New-Item -ItemType Directory -Force -Path (Join-Path $temp "app-1.2.3\resources") | Out-Null
  $fakeAppDir = Join-Path $temp "app-1.2.3"
  $fakeAsar = Join-Path $fakeAppDir "resources\app.asar"
  $fakeRuntime = Join-Path $temp "runtime"
  try {
    New-FakeAsar $fakeAsar
    $installStatus = Install-Patch $fakeAppDir $fakeRuntime
    if (-not $installStatus.Patched) { throw "Self-test install did not mark the app as patched." }
    if (-not $installStatus.HasBackup) { throw "Self-test did not create a backup." }
    if (-not $installStatus.HasRuntimePayload) { throw "Self-test did not write the runtime payload." }
    $uninstallStatus = Uninstall-Patch $fakeAppDir $fakeRuntime
    if ($uninstallStatus.Patched) { throw "Self-test uninstall did not restore the original app.asar." }
    Write-Host "Self-test passed."
  } finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Format-StatusText {
  param($Status)
  return @(
    "Figma app: $($Status.AppDir)"
    "Patched: $($Status.Patched)"
    "Backup: $($Status.HasBackup)"
    "Runtime payload: $($Status.HasRuntimePayload)"
    "Main SHA256: $($Status.MainSha256)"
  ) -join "`r`n"
}

function Show-Gui {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "Figma 客户端汉化补丁"
  $form.StartPosition = "CenterScreen"
  $form.Width = 760
  $form.Height = 520
  $form.MinimumSize = New-Object System.Drawing.Size(720, 460)

  $labelApp = New-Object System.Windows.Forms.Label
  $labelApp.Text = "Figma app-* 目录"
  $labelApp.Left = 18
  $labelApp.Top = 20
  $labelApp.Width = 160

  $txtApp = New-Object System.Windows.Forms.TextBox
  $txtApp.Left = 18
  $txtApp.Top = 44
  $txtApp.Width = 580
  $txtApp.Anchor = "Top,Left,Right"
  try { $txtApp.Text = Find-LatestFigmaAppDir } catch { $txtApp.Text = "" }

  $btnBrowse = New-Object System.Windows.Forms.Button
  $btnBrowse.Text = "浏览"
  $btnBrowse.Left = 610
  $btnBrowse.Top = 42
  $btnBrowse.Width = 110
  $btnBrowse.Anchor = "Top,Right"

  $labelRuntime = New-Object System.Windows.Forms.Label
  $labelRuntime.Text = "运行时目录"
  $labelRuntime.Left = 18
  $labelRuntime.Top = 82
  $labelRuntime.Width = 160

  $txtRuntime = New-Object System.Windows.Forms.TextBox
  $txtRuntime.Left = 18
  $txtRuntime.Top = 106
  $txtRuntime.Width = 580
  $txtRuntime.Anchor = "Top,Left,Right"
  $txtRuntime.Text = $RuntimeDir

  $chkForce = New-Object System.Windows.Forms.CheckBox
  $chkForce.Text = "安装或卸载前强制关闭 Figma"
  $chkForce.Left = 18
  $chkForce.Top = 142
  $chkForce.Width = 260

  $btnStatus = New-Object System.Windows.Forms.Button
  $btnStatus.Text = "检查状态"
  $btnStatus.Left = 18
  $btnStatus.Top = 178
  $btnStatus.Width = 130

  $btnInstall = New-Object System.Windows.Forms.Button
  $btnInstall.Text = "安装补丁"
  $btnInstall.Left = 160
  $btnInstall.Top = 178
  $btnInstall.Width = 130

  $btnUninstall = New-Object System.Windows.Forms.Button
  $btnUninstall.Text = "卸载补丁"
  $btnUninstall.Left = 302
  $btnUninstall.Top = 178
  $btnUninstall.Width = 130

  $script:LogBox = New-Object System.Windows.Forms.TextBox
  $script:LogBox.Left = 18
  $script:LogBox.Top = 224
  $script:LogBox.Width = 702
  $script:LogBox.Height = 235
  $script:LogBox.Multiline = $true
  $script:LogBox.ScrollBars = "Vertical"
  $script:LogBox.ReadOnly = $true
  $script:LogBox.Anchor = "Top,Bottom,Left,Right"

  $runAction = {
    param([scriptblock]$Action)
    try {
      $form.UseWaitCursor = $true
      $result = & $Action
      if ($result) { Write-Log (Format-StatusText $result) }
    } catch {
      Write-Log "Error: $($_.Exception.Message)"
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Figma 客户端汉化补丁", "OK", "Error") | Out-Null
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
      $target = Resolve-Target $txtApp.Text
      Get-PatchStatus $target $txtRuntime.Text
    }
  })
  $btnInstall.Add_Click({
    & $runAction { Install-Patch $txtApp.Text $txtRuntime.Text -Force:$chkForce.Checked }
  })
  $btnUninstall.Add_Click({
    & $runAction { Uninstall-Patch $txtApp.Text $txtRuntime.Text -Force:$chkForce.Checked }
  })

  $form.Controls.AddRange(@(
    $labelApp, $txtApp, $btnBrowse, $labelRuntime, $txtRuntime, $chkForce,
    $btnStatus, $btnInstall, $btnUninstall, $script:LogBox
  ))

  Write-Log "Ready. Close Figma before installing or uninstalling."
  [void]$form.ShowDialog()
}

if ($SelfTest) {
  Invoke-SelfTest
  return
}

if ($Install -or $Uninstall -or $Status) {
  if ($Install) {
    Install-Patch $AppDir $RuntimeDir -Force:$ForceClose | ConvertTo-Json -Depth 8
  } elseif ($Uninstall) {
    Uninstall-Patch $AppDir $RuntimeDir -Force:$ForceClose | ConvertTo-Json -Depth 8
  } else {
    $target = Resolve-Target $AppDir
    Get-PatchStatus $target $RuntimeDir | ConvertTo-Json -Depth 8
  }
  return
}

Show-Gui
