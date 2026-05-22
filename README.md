# Figma 客户端汉化补丁

Windows 图形界面补丁器，用于给官方原生 Figma Desktop 客户端注入汉化脚本。

这是基于官方原生客户端的补丁程序，不是第三方重打包客户端，也不替换 Figma 安装包。

当前补丁程序版本：`0.3.0`

当前词库版本：`0.8.17`

## 使用

运行：

```powershell
.\FigmaCnPatcher.exe
```

下载仓库后直接双击根目录里的 `FigmaCnPatcher.exe` 即可使用，不需要进入 `dist` 目录。

界面里有三个操作：

- 自动检查路径和版本：自动查找最新完整 Figma 客户端目录，跳过更新残留目录，显示 Figma 版本和补丁状态。
- 检查/更新官方最新版：连接 Figma 官方更新接口，判断当前客户端是否为官方最新版；发现新版时下载官方更新包自动更新，更新完成后重新安装汉化补丁。
- 安装补丁：强制关闭 Figma，备份 `resources\app.asar`，原地写入主进程注入 hook，并生成 `C:\FZ\i.js` 汉化运行时。成功或失败都会弹窗提示。
- 重复安装：如果检测到补丁已安装，会提示“该补丁已安装，不需要重复安装”。
- 用户命名保护：文件名、项目名、团队名等用户自己命名的内容不会被词库自动汉化。
- 卸载补丁：强制关闭 Figma，从备份恢复原始 `app.asar`。成功或失败都会弹窗提示。

安装或卸载时会自动强制关闭 Figma，请先保存未同步的工作。

## 说明

- 默认会自动选择 `%LOCALAPPDATA%\Figma` 下版本号最高的 `app-*` 目录。
- 备份文件名为 `resources\app.asar.figma-zh-official-preload-original`。
- Figma 更新后会创建新的 `app-*` 目录，需要对新版本重新安装补丁。
- 这是对官方 Figma Desktop 的非官方修改，遇到客户端启动异常时请先卸载补丁恢复。

## 开发和测试

运行内置回归测试：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\src\FigmaCnPatcher.ps1 -SelfTest
```

重新打包 exe：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1
```
