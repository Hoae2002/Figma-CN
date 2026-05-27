# FigBoost

Windows 图形界面补丁器，用于给官方原生 Figma Desktop 客户端注入汉化脚本。

这是基于官方原生客户端的补丁程序，不是第三方重打包客户端，也不替换 Figma 安装包。

当前补丁程序版本：`0.3.4`

当前词库版本：`0.8.18`

## 使用

运行：

```powershell
.\FigBoost.exe
```

下载仓库后直接双击根目录里的 `FigBoost.exe` 即可使用，不需要进入 `dist` 目录。

界面里的主要操作：

- 自动检查路径和版本：自动查找最新完整 Figma 客户端目录，跳过更新残留目录，显示 Figma 版本和补丁状态。
- 安装补丁：强制关闭 Figma，备份 `resources\app.asar`，原地写入主进程注入 hook，并在界面选择的运行时目录生成汉化运行时。成功或失败都会弹窗提示。
- 功能安装：安装“自动检查客户端是否为最新版本”功能。安装后每次打开 Figma 会检查官方最新版；发现新版时会弹窗提示，确认后显示更新进度，下载官方安装器完成更新，并自动重新安装汉化补丁。
- 重复安装：如果检测到补丁已安装，会提示“该补丁已安装，不需要重复安装”。
- 用户命名保护：文件名、项目名、团队名等用户自己命名的内容不会被词库自动汉化。
- 卸载补丁：强制关闭 Figma，从备份恢复原始 `app.asar`。成功或失败都会弹窗提示。

安装或卸载时会自动强制关闭 Figma，请先保存未同步的工作。

## 说明

- 默认会自动选择 `%LOCALAPPDATA%\Figma` 下版本号最高的 `app-*` 目录。
- 备份文件名为 `resources\app.asar.figma-zh-official-preload-original`。
- Figma 更新后会创建新的 `app-*` 目录，需要对新版本重新安装补丁。
- 安装补丁后会禁用 Figma 客户端内置更新器，避免官方内置更新流程把客户端回退到旧版本；更新请使用补丁器提供的自动更新流程。
- 这是对官方 Figma Desktop 的非官方修改，遇到客户端启动异常时请先卸载补丁恢复。

## 开发和测试

运行内置回归测试：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\src\FigBoost.ps1 -SelfTest
```

重新打包 exe：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1
```
