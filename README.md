# FigBoost

Windows 图形界面补丁器，用于给官方原生 Figma Desktop 客户端注入汉化脚本。

这是基于官方原生客户端的补丁程序，不是第三方重打包客户端，也不替换 Figma 安装包。

当前补丁程序版本：`0.4.0`

当前内置词库版本：`1.0.6`，运行载荷版本：`1.1.0`

## 使用

运行：

```powershell
.\FigBoost.exe
```

下载仓库后直接双击根目录里的 `FigBoost.exe` 即可使用，不需要进入 `dist` 目录。

界面里的主要操作：

- 自动检查路径和版本：自动查找最新完整 Figma 客户端目录，跳过更新残留目录，显示 Figma 版本和补丁状态。
- 安装补丁：检测到尚未安装或运行脚本需要升级时关闭 Figma，备份 `resources\app.asar`，原地写入主进程注入 hook，并在界面选择的运行时目录生成汉化运行时。成功或失败都会弹窗提示。
- 功能安装：安装“自动检查客户端是否为最新版本”功能。安装后每次打开 Figma 会检查官方最新版；发现新版时会弹窗提示，确认后显示更新进度，下载官方安装器完成更新，并自动重新安装汉化补丁。
- 重复安装：比较运行脚本与支持文件，完全相同时不关闭或重启 Figma；旧版运行脚本会刷新，个人翻译数据保留。
- 用户命名保护：文件名、项目名、团队名等用户自己命名的内容不会被词库自动汉化。
- 卸载补丁：强制关闭 Figma，从备份恢复原始 `app.asar`。成功或失败都会弹窗提示。

实际安装或卸载补丁时会自动强制关闭 Figma，请先保存未同步的工作。

## 说明

- 默认会自动选择 `%LOCALAPPDATA%\Figma` 下版本号最高的 `app-*` 目录。
- 备份文件名为 `resources\app.asar.figma-zh-official-preload-original`。
- Figma 更新后会创建新的 `app-*` 目录，需要对新版本重新安装补丁。
- 安装补丁后会禁用 Figma 客户端内置更新器，避免官方内置更新流程把客户端回退到旧版本；更新请使用补丁器提供的自动更新流程。
- 这是对官方 Figma Desktop 的非官方修改，遇到客户端启动异常时请先卸载补丁恢复。

## 词库优先与谷歌补译（0.4.0）

1. 安装或更新补丁后，打开 Figma 顶部 FigBoost 菜单中的“汉化设置”。该入口不依赖自动更新功能。
2. 默认仅使用本地词库。需要在线补译时，在自己的 Google Cloud 项目启用 **Cloud Translation Basic v2** 和结算，创建仅允许此 API 的密钥。
3. 在“翻译服务”中保存密钥、测试连接，再开启谷歌补译。不要将密钥提交到仓库或分享给其他人。
4. 本地未命中的安全界面标签会逐步补译并存入个人词库。请求期间保持原文；离线时仍使用内置及已学习词条。
5. “翻译范围”可按区域选择保持原文、仅本地、或本地＋谷歌；“去 Figma 点选排除”后点击元素，Esc 退出。缺少稳定定位的元素仅本次页面有效。
6. “个人词库”支持搜索、人工修正、删除和保持原文。删除允许再次补译，保持原文会阻止该词条翻译。人工修正优先于内置词库，内置词库优先于机器学习。

保护边界：不改写画布、输入框值、组件变体值、图层/文件等用户命名和代码；第三方插件、不明确的区域和无法确认的动态段落不自动上传。未知界面结构可能保持英文，更新适配规则后才能覆盖。点选排除只适用于页面元素，原生菜单使用区域及词条设置；原生菜单中的安全新标签在后续打开时使用补译。

个人设置、词条、排除规则和加密密钥存放在 `%LOCALAPPDATA%\FigBoost\translation\state.json`，最近有效备份为 `state.json.bak`。密钥通过 Windows DPAPI 加密，不回填到页面、不写入日志；该加密不能防止同一 Windows 用户下的恶意进程。升级或卸载汉化默认保留个人数据。

默认本机每日最多发送 20,000 字符，可调整。失败重试和主动连接测试也计入统计；统计并非 Google 账单。配额或鉴权失败后暂停自动请求，修正配置并测试连接后恢复。Google 实际费用以自己的 Cloud 项目账单为准。

验证边界：自动测试使用合成 DOM 和独立隐藏 Electron 窗口，不控制真实 Figma。Google 联网验收需要使用者自己的有效密钥；真实客户端覆盖率、控件定位与显示效果由使用者验收。

## 开发和测试

安装开发依赖并运行行为、安装和独立 Electron 回归：

```powershell
npm ci
npm test
npm run test:electron
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

测试依赖只用于开发，不随 exe 分发。安装自测对 Figma 进程控制已隔离，不会关闭或启动真实客户端。

单独运行安装回归测试：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\src\FigBoost.ps1 -SelfTest
```

重新打包 exe：

```powershell
Install-Module ps2exe -Scope CurrentUser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1
```
