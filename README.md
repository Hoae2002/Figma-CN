# Figma 客户端汉化补丁

Windows 图形界面补丁器，用于给官方 Figma Desktop 客户端注入汉化脚本。

## 使用

运行：

```powershell
.\dist\FigmaCnPatcher.exe
```

界面里有三个操作：

- 检查状态：检测当前 Figma app 目录是否已打补丁。
- 安装补丁：备份 `resources\app.asar`，原地写入主进程注入 hook，并生成 `C:\FZ\i.js` 汉化运行时。
- 卸载补丁：从备份恢复原始 `app.asar`。

安装或卸载前请先关闭 Figma。界面里也提供了“强制关闭 Figma”选项。

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
