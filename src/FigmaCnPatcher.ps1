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
$PatcherVersion = "0.2.2"
$PayloadFile = "i.js"
$BackupFile = "app.asar.figma-zh-official-preload-original"
$LicenseCommentTarget = "/*! Bundled license information:"
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

function Get-FigmaVersionFromAppDir {
  param([string]$AppDir)
  $name = Split-Path -Leaf $AppDir
  if ($name -match '^app-(.+)$') { return $Matches[1] }
  return "unknown"
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
  param([string]$SelectedAppDir, [string]$SelectedRuntimeDir, [switch]$Force, [switch]$SkipProcessCheck)
  if (-not $SkipProcessCheck) { Assert-FigmaClosed -Force:$Force }
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
    $installStatus = Install-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck
    if (-not $installStatus.Patched) { throw "Self-test install did not mark the app as patched." }
    if (-not $installStatus.HasBackup) { throw "Self-test did not create a backup." }
    if (-not $installStatus.HasRuntimePayload) { throw "Self-test did not write the runtime payload." }
    if ($installStatus.PayloadVersion -ne "0.8.14") { throw "Self-test payload version mismatch." }
    $repeatInstallStatus = Install-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck
    if (-not $repeatInstallStatus.AlreadyPatched) { throw "Self-test repeat install did not report already patched." }
    $uninstallStatus = Uninstall-Patch $fakeAppDir $fakeRuntime -SkipProcessCheck
    if ($uninstallStatus.Patched) { throw "Self-test uninstall did not restore the original app.asar." }
    Write-Host "Self-test passed."
  } finally {
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
  $form.Width = 820
  $form.Height = 430
  $form.MinimumSize = New-Object System.Drawing.Size(780, 400)
  $form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

  $labelApp = New-Object System.Windows.Forms.Label
  $labelApp.Text = "Figma客户端目录"
  $labelApp.Left = 18
  $labelApp.Top = 20
  $labelApp.Width = 160

  $txtApp = New-Object System.Windows.Forms.TextBox
  $txtApp.Left = 18
  $txtApp.Top = 44
  $txtApp.Width = 650
  $txtApp.Anchor = "Top,Left,Right"
  try { $txtApp.Text = Find-LatestFigmaAppDir } catch { $txtApp.Text = "" }

  $btnBrowse = New-Object System.Windows.Forms.Button
  $btnBrowse.Text = "浏览"
  $btnBrowse.Left = 682
  $btnBrowse.Top = 42
  $btnBrowse.Width = 100
  $btnBrowse.Anchor = "Top,Right"

  $labelRuntime = New-Object System.Windows.Forms.Label
  $labelRuntime.Text = "运行时目录"
  $labelRuntime.Left = 18
  $labelRuntime.Top = 82
  $labelRuntime.Width = 160

  $txtRuntime = New-Object System.Windows.Forms.TextBox
  $txtRuntime.Left = 18
  $txtRuntime.Top = 106
  $txtRuntime.Width = 650
  $txtRuntime.Anchor = "Top,Left,Right"
  $txtRuntime.Text = $RuntimeDir

  $labelNotice = New-Object System.Windows.Forms.Label
  $labelNotice.Text = "提示：安装或卸载时会自动强制关闭 Figma，请先保存未同步的工作。"
  $labelNotice.Left = 18
  $labelNotice.Top = 142
  $labelNotice.Width = 700
  $labelNotice.Anchor = "Top,Left,Right"
  $labelNotice.ForeColor = [System.Drawing.Color]::FromArgb(150, 70, 0)

  $btnStatus = New-Object System.Windows.Forms.Button
  $btnStatus.Text = "自动检查路径和版本"
  $btnStatus.Left = 18
  $btnStatus.Top = 178
  $btnStatus.Width = 170

  $btnInstall = New-Object System.Windows.Forms.Button
  $btnInstall.Text = "安装补丁"
  $btnInstall.Left = 202
  $btnInstall.Top = 178
  $btnInstall.Width = 130

  $btnUninstall = New-Object System.Windows.Forms.Button
  $btnUninstall.Text = "卸载补丁"
  $btnUninstall.Left = 344
  $btnUninstall.Top = 178
  $btnUninstall.Width = 130

  $statusGroup = New-Object System.Windows.Forms.GroupBox
  $statusGroup.Text = "当前检测结果"
  $statusGroup.Left = 18
  $statusGroup.Top = 222
  $statusGroup.Width = 764
  $statusGroup.Height = 154
  $statusGroup.Anchor = "Top,Left,Right"

  function New-StatusLabel {
    param([string]$Text, [int]$Top)
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Text
    $label.Left = 18
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

  $script:ValuePatcher = New-StatusValue 24
  $script:ValuePatcher.Text = "v$PatcherVersion"
  $script:ValuePayload = New-StatusValue 46
  $script:ValuePayload.Text = "v$(Get-PayloadVersion)"
  $script:ValueFigmaVersion = New-StatusValue 68
  $script:ValuePatchState = New-StatusValue 90
  $script:ValueBackupState = New-StatusValue 112
  $script:ValueRuntimeState = New-StatusValue 134

  $statusGroup.Controls.AddRange(@(
    (New-StatusLabel "补丁程序版本：" 24),
    $script:ValuePatcher,
    (New-StatusLabel "词库版本：" 46),
    $script:ValuePayload,
    (New-StatusLabel "Figma 版本：" 68),
    $script:ValueFigmaVersion,
    (New-StatusLabel "补丁状态：" 90),
    $script:ValuePatchState,
    (New-StatusLabel "备份状态：" 112),
    $script:ValueBackupState,
    (New-StatusLabel "运行时文件：" 134),
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
      $target = Resolve-Target $latest
      Get-PatchStatus $target $txtRuntime.Text
    } {
      param($result)
      Show-InfoMessage ("检测完成。`r`n`r`nFigma 路径：$($result.AppDir)`r`nFigma 版本：$($result.FigmaVersion)`r`n词库版本：v$($result.PayloadVersion)`r`n补丁状态：$(if ($result.Patched) { "已安装" } else { "未安装" })")
    } "检测失败"
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
    $labelApp, $txtApp, $btnBrowse, $labelRuntime, $txtRuntime, $labelNotice,
    $btnStatus, $btnInstall, $btnUninstall, $statusGroup
  ))

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
