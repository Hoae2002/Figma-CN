# FigBoost

Windows 图形界面补丁器，用于给官方原生 Figma Desktop 客户端注入汉化脚本。

这是基于官方原生客户端的补丁程序，不是第三方重打包客户端，也不替换 Figma 安装包。

当前补丁程序版本：`0.5.9`，桌面运行载荷版本：`1.2.9`。

`0.5.9` 修复切换选中对象时右侧属性面板先闪现英文的问题。本地词库译文会在浏览器绘制前使用最多 4ms 的同步时间片应用，超出部分继续进入 6ms 后台队列；社区首次在线补译仍异步显示原文。`0.5.8` 的布局读取清理、单次候选识别和内容保护继续保留。升级后需重新应用补丁并重启 Figma。

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
- 用户命名保护：文件名、项目名、团队名等用户自己命名的内容不参与自动汉化。
- 卸载补丁：强制关闭 Figma，从备份恢复原始 `app.asar`。成功或失败都会弹窗提示。

实际安装或卸载补丁时会自动强制关闭 Figma，请先保存未同步的工作。

## 说明

- 默认会自动选择 `%LOCALAPPDATA%\Figma` 下版本号最高的 `app-*` 目录。
- 备份文件名为 `resources\app.asar.figma-zh-official-preload-original`。
- Figma 更新后会创建新的 `app-*` 目录，需要对新版本重新安装补丁。
- 安装补丁后会禁用 Figma 客户端内置更新器，避免官方内置更新流程把客户端回退到旧版本；更新请使用补丁器提供的自动更新流程。
- 这是对官方 Figma Desktop 的非官方修改，遇到客户端启动异常时请先卸载补丁恢复。

## 词库汉化与社区补译（0.5.9）

1. 安装或更新补丁后默认开启词库汉化。无需申请 Google Cloud、填写 API 密钥或设置字符额度。
2. 编辑器、文件页、页面菜单和桌面菜单只使用随补丁维护的 Figma 专业词库，未命中的文案保持英文，不会发送给 Google。
3. Community 页面可以单独开启“社区 Google 补译”。社区同样先匹配内置词库；词库未命中的安全英文文案才发送给 Google，结果经过 UI 设计术语校正后保存在本机，重启和离线时自动复用。
4. 从 Figma 顶部 FigBoost 菜单打开“汉化设置”。关闭“词库汉化”会恢复全部界面原文；关闭“社区 Google 补译”只停用社区机器翻译，社区的内置词库译文仍然保留。

**保护边界：**不改写画布、输入值、组件变体值、图层/文件/项目/组件等用户命名、字体族、插件／工具名称和代码。字体下拉选项及右侧 Tools 区域的资源名称保留原文；区域标题等 Figma 系统文案仍使用词库。第三方插件、无法识别的新区域、可能包含用户内容的动态段落保留原文，不发送翻译。安全识别仍需随 Figma 页面结构更新，不能保证所有英文都能覆盖。原生菜单只使用内置词库；系统弹窗的标题、正文和动态详情保持原文。

**连接与缓存：**Community 补译采用固定 Google 网页翻译入口，无内置共享密钥。免密钥入口没有官方 Cloud API 的可用性保证，可能受网络、限流或接口变化影响。最多两个并发请求，每次保留独立文案边界，8 秒超时、临时故障重试一次；失败时保留原文，冷却后自动重试。已缓存的社区文字仍然可用。不会调用用户旧版 Cloud 密钥。

社区补译缓存和两个汉化开关保存在 `%LOCALAPPDATA%\FigBoost\translation\cache.json`，备份为 `cache.json.bak`，最多保留 10,000 条机器结果。升级时会保留已学习的机器译文，并丢弃旧版排除规则和区域模式；旧版在非社区区域产生的机器缓存不会再使用，新产生的机器缓存只有社区文案。旧版 `state.json` 及加密凭据不再读取。更新和卸载默认保留个人数据。内置词库随桌面载荷发布并优先匹配，不会覆盖或改写用户缓存文件。

实现参考 [TWP / Translate Web Pages](https://github.com/FilipePS/Traduzir-paginas-web) 的动态翻译、请求合并与缓存思路，以及 [KISS Translator](https://github.com/fishjar/kiss-translator) 的免密钥 Google 接入方式；针对 Electron 独立实现，没有复制完整扩展或使用其共享密钥。

验证采用合成 DOM 和独立隐藏 Electron 环境，不控制真实 Figma。免密钥生产请求路径已用公开测试文案验证；真实客户端覆盖率与显示效果由使用者验收。

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
