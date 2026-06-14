(function () {
  "use strict";

  const { app, autoUpdater, clipboard, dialog, ipcMain, Menu, BrowserWindow, webContents } = require("electron");
  const fs = require("fs");
  const https = require("https");
  const path = require("path");
  const { spawn } = require("child_process");
  const labels = {
    "New Window": "新建窗口",
    "New Tab": "新建标签页",
    "Open File Browser": "打开文件浏览器",
    "Open File URL From Clipboard": "从剪贴板打开文件 URL",
    "Close Window": "关闭窗口",
    "Close Tab": "关闭标签页",
    "Reopen Closed Tab": "重新打开关闭的标签页",
    "Recently Closed Tabs": "最近关闭的标签页",
    "Plugins": "插件",
    "Interface Scale": "界面缩放",
    "Preferences": "偏好设置",
    "Help": "帮助",
    "About Figma": "关于 Figma",
    "Check for Updates...": "检查更新...",
    "Check for Updates…": "检查更新…",
    "Copyright © 2026 Figma, Inc.": "版权所有 © 2026 Figma, Inc.",
    "Default": "默认",
    "Exit": "退出",
    "Figma Desktop App version 126.3.12": "Figma 桌面应用版本 126.3.12",
    "Install now": "立即安装",
    "Install on next launch": "下次启动时安装",
    "Manage Plugins...": "管理插件...",
    "Manage Plugins…": "管理插件…",
    "Reset to Default": "重置为默认值",
    "Make Larger": "放大",
    "Make Smaller": "缩小",
    "Show Figma in System Tray": "在系统托盘中显示 Figma",
    "Help Page": "帮助页面",
    "Support Forum": "支持论坛",
    "Video Tutorials": "视频教程",
    "Release Notes": "发行说明",
    "Legal Summary": "法律摘要",
    "Troubleshooting": "故障排查",
    "Log Out": "退出登录",
    "Toggle Web App Developer Tools": "切换网页应用开发者工具",
    "Toggle Tab Bar Developer Tools": "切换标签栏开发者工具",
    "Save Debug Info...": "保存调试信息...",
    "Save Debug Info…": "保存调试信息…",
    "Save Network Log...": "保存网络日志...",
    "Save Network Log…": "保存网络日志…",
    "Save Performance Log...": "保存性能日志...",
    "Save Performance Log…": "保存性能日志…",
    "Disable Hardware Acceleration": "禁用硬件加速",
    "Prefer High-Performance CPU": "优先使用高性能 CPU",
    "Prefer High-Performance GPU": "优先使用高性能 GPU",
    "Graphics Backend": "图形后端",
    "WebGL1": "WebGL1",
    "WebGL2": "WebGL2",
    "WebGPU": "WebGPU",
    "Missing a new feature? Try reloading your tabs and check again. If you experience any other issues, please contact support.": "缺少新功能？请重新加载标签页后再检查。如果遇到其他问题，请联系支持。",
    "No Update Available": "没有可用更新",
    "Reload All Tabs": "重新加载全部标签页",
    "Replace": "替换",
    "Replace Existing Files": "替换现有文件",
    "Replace existing files?": "要替换现有文件吗？",
    "Reset Figma and Restart": "重置 Figma 并重启",
    "Update Available": "有可用更新",
    "Copy Link": "复制链接",
    "Rename File": "重命名文件",
    "Reload Tab": "重新加载标签页",
    "Move to New Window": "移动到新窗口",
    "Pin Tab": "固定标签页",
    "Close Other Tabs": "关闭其他标签页",
    "Close All Tabs": "关闭全部标签页",
    "A new version of Figma is ready to be installed.": "新版 Figma 已准备好安装。",
    "You are already using the latest version of Figma.": "您已经在使用最新版 Figma。",
    "{appName} Desktop App version {version}": "{appName} 桌面应用版本 {version}",
    "Copyright © {year} Figma, Inc.": "版权所有 © {year} Figma, Inc.",
    "About {appName}": "关于 {appName}",
    "This version of {appName} is not intended for use on Windows on Arm. Please download {appName} again from the Figma Downloads page to ensure that the correct version is installed.": "此版本的 {appName} 不适用于 Windows on Arm。请从 Figma 下载页面重新下载 {appName}，以确保安装正确版本。",
    "Open downloads page": "打开下载页面",
    "Update {appName}": "更新 {appName}",
    "This is likely happening because your corporate network is using a proxy.{lineBreak}This can be resolved by adding non-Figma origins used by your proxy to your AllowedOriginHosts setting. Click the button below to visit our Help Center for details.": "这很可能是因为你的企业网络正在使用代理。{lineBreak}可通过将代理使用的非 Figma 来源添加到 AllowedOriginHosts 设置来解决。点击下方按钮访问帮助中心了解详情。",
    "Blocked Navigation to ''{hostname}''": "已阻止导航到“{hostname}”",
    "Visit Help Center": "访问帮助中心",
    "Do not ask me again": "不再询问",
    "Closing this tab will stop all in-progress and pending imports.": "关闭此标签页将停止所有进行中和待处理的导入。",
    "Keep Tab Open": "保持标签页打开",
    "File import in progress": "文件正在导入",
    "Changes are currently being saved. Your changes will be lost if you close the window now.": "更改正在保存。如果现在关闭窗口，你的更改将会丢失。",
    "Discard Unsaved Changes?": "放弃未保存的更改？",
    "Export failed": "导出失败",
    "The clipboard does not contain a valid Figma URL.": "剪贴板中没有有效的 Figma URL。",
    "Invalid Figma URL": "无效的 Figma URL",
    "Changes are currently being saved. Your changes will be lost if you log out now.": "更改正在保存。如果现在退出登录，你的更改将会丢失。",
    "Log Out & Discard Changes": "退出登录并放弃更改",
    "Hang tight! Still merging…": "请稍候，仍在合并…",
    "Remove Other Desktop App": "移除其他桌面应用",
    "Multiple Installations Not Supported": "不支持多个安装",
    "You are already using the latest version of {appName}.{lineBreak}Missing a new feature? Try reloading your tabs and check again. If you experience any other issues, please contact support.": "你已经在使用最新版 {appName}。{lineBreak}缺少新功能？请重新加载标签页后再检查。如果遇到其他问题，请联系支持。",
    "Please enable Camera & Microphone for {appName} in System Preferences → Security & Privacy → Privacy.": "请在系统偏好设置 → 安全性与隐私 → 隐私中为 {appName} 启用摄像头和麦克风。",
    "Please enable Camera for {appName} in System Preferences → Security & Privacy → Privacy.": "请在系统偏好设置 → 安全性与隐私 → 隐私中为 {appName} 启用摄像头。",
    "Please enable Microphone for {appName} in System Preferences → Security & Privacy → Privacy.": "请在系统偏好设置 → 安全性与隐私 → 隐私中为 {appName} 启用麦克风。",
    "Reloading the tab won’t lose your changes, but you’ll have to reconnect to sync the changes.": "重新加载标签页不会丢失你的更改，但你需要重新连接才能同步更改。",
    "{numFiles, plural, one {Replace existing file?} other {Replace existing files?}}": "{numFiles, plural, one {替换现有文件？} other {替换现有文件？}}",
    "{appName} was unable to reset app data and restart. Please contact support for assistance.": "{appName} 无法重置应用数据并重启。请联系支持获取帮助。",
    "{appName} Reset Failed": "{appName} 重置失败",
    "{appName} app data will reset and the app will restart. You will need to log back into {appName} after this is done.": "{appName} 应用数据将被重置，应用将重新启动。完成后你需要重新登录 {appName}。",
    "Reset {appName} and Restart?": "重置 {appName} 并重启？",
    "{appName} needs to be restarted to apply changes.": "{appName} 需要重启才能应用更改。",
    "Restart to apply changes": "重启以应用更改",
    "Save Debug Info": "保存调试信息",
    "Saving file failed": "保存文件失败",
    "Complete the specific action in Figma that you’d like information about. You’ll get a prompt after 30 seconds to save the network log file.": "请在 Figma 中完成你想收集信息的具体操作。30 秒后会提示你保存网络日志文件。",
    "Saving a network log": "正在保存网络日志",
    "Complete the specific action in Figma that you’d like information about. You’ll get a prompt after 30 seconds to save the performance log file.": "请在 Figma 中完成你想收集信息的具体操作。30 秒后会提示你保存性能日志文件。",
    "Saving a performance log": "正在保存性能日志",
    "A new version of {appName} is ready to be installed.": "新版本 {appName} 已准备好安装。",
    "{appName} was not able to install the update:": "{appName} 无法安装更新：",
    "Download update manually": "手动下载更新",
    "Update Error": "更新错误",
    "Microphone access required to talk in Figma Audio. Please enable microphone for {appName} in System Preferences → Security & Privacy → Privacy → Microphone.": "使用 Figma Audio 通话需要麦克风权限。请在系统偏好设置 → 安全性与隐私 → 隐私 → 麦克风中为 {appName} 启用麦克风。",
    "Choose plugin directory location": "选择插件目录位置",
    "Choose plugin name and directory location": "选择插件名称和目录位置",
    "Figma failed to load": "Figma 加载失败",
    "Oops something went wrong": "糟糕，出了点问题",
    "Error navigating to ''{url}'': {error}": "导航到“{url}”时出错：{error}",
    "Add to Dictionary": "添加到词典",
    "Color Management": "色彩管理",
    "Managed": "已管理",
    "Debug Figma Agent": "调试 Figma Agent",
    "(empty)": "（空）",
    "Enable Trackpad Haptic Feedback": "启用触控板触觉反馈",
    "Export As…": "导出为…",
    "Export Slides to PDF…": "将幻灯片导出为 PDF…",
    "Export Slides to…": "导出幻灯片到…",
    "Export All Slides to PDF…": "将全部幻灯片导出为 PDF…",
    "Import From CSV…": "从 CSV 导入…",
    "{interfaceScalePercent}%": "{interfaceScalePercent}%",
    "Hide {appName}": "隐藏 {appName}",
    "Quit {appName}": "退出 {appName}",
    "Open Test Websocket Page": "打开测试 WebSocket 页面",
    "Save Local Copy…": "保存本地副本…",
    "Select All": "全选",
    "Toggle Browser Preview Developer Tools": "切换浏览器预览开发者工具",
    "Add to Tab Group": "添加到标签组",
    "Close Tab Group": "关闭标签组",
    "Move to Another Window": "移动到另一个窗口",
    "Group {number}": "组 {number}",
    "New Tab Group": "新建标签组",
    "Open in Browser": "在浏览器中打开",
    "{numOtherTabs, plural, =1 {{tabName} and # Other Tab} other {{tabName} and # Other Tabs}}": "{numOtherTabs, plural, =1 {{tabName} 和另外 # 个标签页} other {{tabName} 和另外 # 个标签页}}",
    "Pin": "固定",
    "Reload": "重新加载",
    "Remove from Tab Group": "从标签组中移除",
    "Unpin": "取消固定",
    "{pluginName} (Community)": "{pluginName}（社区）"
  };

  const labelPatterns = [
    [/^Figma Desktop App version (.+)$/, "Figma 桌面应用版本 $1"],
    [/^Copyright © (\d{4}) Figma, Inc\.$/, "版权所有 © $1 Figma, Inc."],
    [/^→\s*Install now$/, "→ 立即安装"],
    [/^→\s*Install on next launch$/, "→ 下次启动时安装"],
    [/^(\d+) files including "(.+)" already exist\. Replacing them will overwrite their existing contents\.$/, "$1 个文件（包括“$2”）已存在。替换后将覆盖其现有内容。"]
  ];

  function localizeText(value) {
    if (typeof value !== "string") return value;
    if (labels[value]) return labels[value];
    for (const [pattern, replacement] of labelPatterns) {
      if (pattern.test(value)) return value.replace(pattern, replacement);
    }
    return value;
  }

  function localizeItems(items) {
    let changed = false;
    for (const item of items || []) {
      const label = localizeText(item.label);
      if (item.label && label !== item.label) {
        item.label = label;
        changed = true;
      }
      if (item.submenu && item.submenu.items) {
        changed = localizeItems(item.submenu.items) || changed;
      }
    }
    return changed;
  }

  function localizeTemplate(items) {
    for (const item of items || []) {
      if (item.label) item.label = localizeText(item.label);
      if (Array.isArray(item.submenu)) localizeTemplate(item.submenu);
      if (item.submenu && item.submenu.items) localizeItems(item.submenu.items);
    }
  }

  function localizeMenu() {
    const menu = Menu.getApplicationMenu();
    if (!menu) return;
    if (localizeItems(menu.items)) Menu.setApplicationMenu(menu);
  }

  function scheduleLocalize() {
    setTimeout(localizeMenu, 0);
    setTimeout(localizeMenu, 300);
    setTimeout(localizeMenu, 1000);
  }

  function localizeDialogOptions(options) {
    if (!options || typeof options !== "object") return options;
    const next = { ...options };
    for (const key of ["title", "message", "detail"]) next[key] = localizeText(next[key]);
    if (Array.isArray(next.buttons)) next.buttons = next.buttons.map(localizeText);
    return next;
  }

  function hookDialogMethod(name) {
    if (!dialog || typeof dialog[name] !== "function") return;
    const original = dialog[name].bind(dialog);
    dialog[name] = function (...args) {
      const looksLikeOptions = (value) => !!(
        value
        && typeof value === "object"
        && ("title" in value || "message" in value || "detail" in value || Array.isArray(value.buttons))
      );
      const optionIndex = looksLikeOptions(args[1]) ? 1 : 0;
      if (args[optionIndex]) args[optionIndex] = localizeDialogOptions(args[optionIndex]);
      return original(...args);
    };
  }

  function hookAboutPanelOptions() {
    if (!app || typeof app.setAboutPanelOptions !== "function") return;
    const original = app.setAboutPanelOptions.bind(app);
    app.setAboutPanelOptions = function (options) {
      if (options && typeof options === "object") {
        options = { ...options };
        for (const key of ["title", "message", "detail", "applicationVersion", "version", "copyright"]) {
          options[key] = localizeText(options[key]);
        }
      }
      return original(options);
    };
  }

  function compareVersions(left, right) {
    const leftParts = String(left || "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
    const rightParts = String(right || "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
    const count = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < count; index += 1) {
      const l = leftParts[index] || 0;
      const r = rightParts[index] || 0;
      if (l > r) return 1;
      if (l < r) return -1;
    }
    return 0;
  }

  function getRuntimeDir() {
    return global.__FIGMA_ZH_RUNTIME_DIR__ || __dirname;
  }

  function readFeatureConfig() {
    try {
      const runtimeDir = getRuntimeDir();
      const text = fs.readFileSync(path.join(runtimeDir, "features.json"), "utf8").replace(/^\uFEFF/, "");
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function isFeatureEnabled(config, featureId) {
    return !!(config && Array.isArray(config.enabledFeatures) && config.enabledFeatures.includes(featureId));
  }

  global.__FIGBOOST_FEATURE_ENABLED__ = (featureId) => isFeatureEnabled(readFeatureConfig(), featureId);

  function getText(url) {
    return new Promise((resolve, reject) => {
      const request = https.get(url, { timeout: 20000 }, (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve(body));
      });
      request.on("timeout", () => request.destroy(new Error("request timeout")));
      request.on("error", reject);
    });
  }

  function getPartialText(url, maxBytes) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const chunks = [];
      let total = 0;
      const done = (error, value) => {
        if (finished) return;
        finished = true;
        if (error) reject(error);
        else resolve(value);
      };
      const request = https.get(url, {
        timeout: 30000,
        headers: { Range: `bytes=0-${maxBytes - 1}` }
      }, (response) => {
        if (![200, 206].includes(response.statusCode)) {
          response.resume();
          done(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        response.on("data", (chunk) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total >= maxBytes) {
            done(null, Buffer.concat(chunks, Math.min(total, maxBytes)).toString("latin1"));
            request.destroy();
          }
        });
        response.on("end", () => {
          done(null, Buffer.concat(chunks, total).toString("latin1"));
        });
      });
      request.on("timeout", () => request.destroy(new Error("request timeout")));
      request.on("error", (error) => {
        if (!finished) reject(error);
      });
    });
  }

  async function getOfficialInstallerVersion() {
    const text = await getPartialText("https://desktop.figma.com/win/FigmaSetup.exe", 2 * 1024 * 1024);
    const match = /Figma-(\d+\.\d+\.\d+)-full\.nupkg/.exec(text);
    if (!match) throw new Error("Cannot parse official installer version.");
    return match[1];
  }

  async function getOfficialFeedVersion() {
    const text = await getText("https://desktop.figma.com/win/releases.xml");
    const versions = [];
    const pattern = /Figma\s+(\d+\.\d+\.\d+)/g;
    let match;
    while ((match = pattern.exec(text))) versions.push(match[1]);
    if (!versions.length) throw new Error("Cannot parse official feed version.");
    return versions.sort((a, b) => compareVersions(b, a))[0];
  }

  async function getOfficialVersionInfo() {
    const versions = [];
    let installerVersion = null;
    let feedVersion = null;
    try {
      installerVersion = await getOfficialInstallerVersion();
      versions.push(installerVersion);
    } catch (_) {}
    try {
      feedVersion = await getOfficialFeedVersion();
      versions.push(feedVersion);
    } catch (_) {}
    if (!versions.length) throw new Error("Cannot parse official latest version.");
    return {
      installerVersion,
      feedVersion,
      latestVersion: versions.sort((a, b) => compareVersions(b, a))[0]
    };
  }

  async function getOfficialLatestVersion() {
    return (await getOfficialVersionInfo()).latestVersion;
  }

  async function shouldSuppressBuiltInUpdateCheck() {
    const info = await getOfficialVersionInfo();
    const currentVersion = app.getVersion();
    if (!info.installerVersion) return false;
    if (info.feedVersion && compareVersions(info.feedVersion, info.installerVersion) > 0) return false;
    return compareVersions(currentVersion, info.installerVersion) >= 0;
  }

  function hookBuiltInUpdateChecks() {
    if (!autoUpdater || global.__FIGMA_ZH_AUTO_UPDATER_GUARD__) return;
    global.__FIGMA_ZH_AUTO_UPDATER_GUARD__ = true;
    for (const methodName of ["checkForUpdates", "checkForUpdatesAndNotify"]) {
      if (typeof autoUpdater[methodName] !== "function") continue;
      const original = autoUpdater[methodName].bind(autoUpdater);
      autoUpdater[methodName] = function (...args) {
        shouldSuppressBuiltInUpdateCheck()
          .then((suppress) => {
            if (!suppress) original(...args);
          })
          .catch(() => original(...args));
      };
    }
  }

  function showOfficialUpdateCheckingWindow() {
    const owner = BrowserWindow.getFocusedWindow();
    const progressWindow = new BrowserWindow({
      width: 420,
      height: 190,
      useContentSize: true,
      parent: owner || undefined,
      modal: Boolean(owner),
      show: false,
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "\u6b63\u5728\u68c0\u67e5\u66f4\u65b0",
      backgroundColor: "#ffffff",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    progressWindow.webContents.__FIGBOOST_SKIP_RENDERER_INJECTION__ = true;
    progressWindow.setMenu(null);
    if (typeof progressWindow.removeMenu === "function") progressWindow.removeMenu();
    progressWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html,body{box-sizing:border-box;width:100%;height:100%;margin:0;overflow:hidden;background:#fff;color:#111;}
    body{padding:26px 30px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI",sans-serif;}
    .title{font-size:20px;line-height:28px;font-weight:700;margin-bottom:8px;}
    .sub{font-size:14px;line-height:22px;color:#4a5568;margin-bottom:22px;white-space:nowrap;}
    .bar{height:5px;overflow:hidden;border-radius:999px;background:#e6e8ec;}
    .bar:before{content:"";display:block;width:42%;height:100%;border-radius:999px;background:#1677ff;animation:move 1s ease-in-out infinite;}
    @keyframes move{0%{transform:translateX(-105%);}100%{transform:translateX(245%);}}
  </style>
</head>
<body>
  <div class="title">&#27491;&#22312;&#26816;&#26597;&#26356;&#26032;</div>
  <div class="sub">&#27491;&#22312;&#33719;&#21462; Figma &#23448;&#26041;&#26368;&#26032;&#29256;&#26412;&#65292;&#35831;&#31245;&#20505;&#8230;</div>
  <div class="bar"></div>
</body>
</html>
`)}`);
    progressWindow.once("ready-to-show", () => {
      if (progressWindow.isDestroyed()) return;
      if (typeof progressWindow.showInactive === "function") progressWindow.showInactive();
      else progressWindow.show();
    });
    return {
      close() {
        if (!progressWindow.isDestroyed()) progressWindow.close();
      }
    };
  }

  async function checkOfficialUpdateManually() {
    const now = Date.now();
    if (global.__FIGMA_ZH_OFFICIAL_UPDATE_CHECKING__) {
      await dialog.showMessageBox({
        type: "info",
        title: "正在检查更新",
        message: "正在检查 Figma 官方新版，请稍候。"
      });
      return { checking: true };
    }
    if (global.__FIGMA_ZH_OFFICIAL_UPDATE_LAST_CHECK__ && now - global.__FIGMA_ZH_OFFICIAL_UPDATE_LAST_CHECK__ < 1500) return { skipped: true };
    global.__FIGMA_ZH_OFFICIAL_UPDATE_CHECKING__ = true;
    global.__FIGMA_ZH_OFFICIAL_UPDATE_LAST_CHECK__ = now;
    const config = readFeatureConfig();
    const checkingWindow = showOfficialUpdateCheckingWindow();
    try {
      if (!isFeatureEnabled(config, "auto-check-official-latest")) {
        checkingWindow.close();
        return { disabled: true };
      }
      const patcherPath = config && config.patcherPath;
      const runtimeDir = config && config.runtimeDir;
      if (!patcherPath || !runtimeDir || !fs.existsSync(patcherPath)) {
        checkingWindow.close();
        await dialog.showMessageBox({
          type: "error",
          title: "检查更新失败",
          message: "找不到 FigBoost 更新程序",
          detail: "请重新打开 FigBoost，确认补丁文件保存目录后再安装附加功能。"
        });
        return { ok: false };
      }
      let latestVersion;
      try {
        latestVersion = await getOfficialLatestVersion();
      } catch (error) {
        checkingWindow.close();
        await dialog.showMessageBox({
          type: "error",
          title: "检查更新失败",
          message: "无法获取 Figma 官方最新版",
          detail: error && error.message ? error.message : String(error)
        });
        return { ok: false };
      }
      const currentVersion = app.getVersion();
      if (compareVersions(currentVersion, latestVersion) >= 0) {
        checkingWindow.close();
        await dialog.showMessageBox({
          type: "info",
          title: "当前已是官方最新版",
          message: `当前 Figma 版本 ${currentVersion} 已是官方最新版。`
        });
        return { latest: true };
      }
      checkingWindow.close();
      const result = await dialog.showMessageBox({
        type: "question",
        buttons: ["更新", "稍后"],
        defaultId: 0,
        cancelId: 1,
        title: "发现 Figma 新版本",
        message: `检测到官方最新版 Figma ${latestVersion}`,
        detail: `当前版本是 ${currentVersion}。\n\n点击“更新”会关闭 Figma，下载并安装官方最新版，更新完成后会自动安装汉化补丁。`
      });
      if (result.response !== 0) return { declined: true };
      try {
        const child = spawn(patcherPath, ["-UpdateFigma", "-ShowProgress", "-RuntimeDir", runtimeDir, "-ForceClose"], {
          detached: true,
          stdio: "ignore"
        });
        child.unref();
      } catch (error) {
        dialog.showMessageBox({
          type: "error",
          title: "更新启动失败",
          message: "无法启动补丁更新程序",
          detail: error && error.message ? error.message : String(error)
        }).catch(() => {});
        return { ok: false };
      }
      return { updateStarted: true };
    } finally {
      checkingWindow.close();
      global.__FIGMA_ZH_OFFICIAL_UPDATE_CHECKING__ = false;
    }
  }

  function registerManualOfficialUpdateCheck() {
    if (!ipcMain || global.__FIGBOOST_UPDATE_IPC_REGISTERED__) return;
    global.__FIGBOOST_UPDATE_IPC_REGISTERED__ = true;
    global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__ = checkOfficialUpdateManually;
    ipcMain.handle("figboost:check-official-update", () => checkOfficialUpdateManually());
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function showMessageBoxForOwner(owner, options) {
    return owner && !owner.isDestroyed()
      ? dialog.showMessageBox(owner, options)
      : dialog.showMessageBox(options);
  }

  function showOpenDialogForOwner(owner, options) {
    return owner && !owner.isDestroyed()
      ? dialog.showOpenDialog(owner, options)
      : dialog.showOpenDialog(options);
  }

  function createBulkExportProgressWindow(owner) {
    const progressWindow = new BrowserWindow({
      width: 520,
      height: 220,
      useContentSize: true,
      parent: undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "\u6279\u91cf\u5bfc\u51fa\u753b\u677f\u6587\u4ef6",
      backgroundColor: "#ffffff",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    progressWindow.webContents.__FIGBOOST_SKIP_RENDERER_INJECTION__ = true;
    progressWindow.setMenu(null);
    if (typeof progressWindow.removeMenu === "function") progressWindow.removeMenu();
    progressWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html,body{box-sizing:border-box;width:100%;height:100%;margin:0;overflow:hidden;background:#fff;color:#111;}
    body{padding:26px 30px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI",sans-serif;}
    .title{font-size:20px;line-height:28px;font-weight:700;margin-bottom:8px;}
    .sub{font-size:14px;line-height:22px;color:#4a5568;margin-bottom:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .bar{height:5px;overflow:hidden;border-radius:999px;background:#e6e8ec;margin-bottom:16px;}
    .bar:before{content:"";display:block;width:42%;height:100%;border-radius:999px;background:#1677ff;animation:move 1s ease-in-out infinite;}
    .foot{font-size:12px;line-height:18px;color:#718096;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    @keyframes move{0%{transform:translateX(-105%);}100%{transform:translateX(245%);}}
  </style>
</head>
<body>
  <div class="title" id="title">&#27491;&#22312;&#26816;&#32034;&#30011;&#26495;&#25991;&#20214;</div>
  <div class="sub" id="sub">&#27491;&#22312;&#20351;&#29992;&#24403;&#21069; Figma &#30331;&#24405;&#20250;&#35805;&#25195;&#25551;&#21487;&#35265;&#25991;&#20214;&#8230;</div>
  <div class="bar"></div>
  <div class="foot" id="foot">&#35831;&#31245;&#20505;</div>
  <script>
    window.setFigBoostExportStatus = function (payload) {
      if (!payload) return;
      if (payload.title) document.getElementById("title").textContent = payload.title;
      if (payload.sub) document.getElementById("sub").textContent = payload.sub;
      if (payload.foot) document.getElementById("foot").textContent = payload.foot;
    };
  </script>
</body>
</html>
`)}`);
    progressWindow.once("ready-to-show", () => {
      if (!progressWindow.isDestroyed()) progressWindow.show();
    });
    return {
      update(payload) {
        if (progressWindow.isDestroyed()) return;
        progressWindow.webContents.executeJavaScript(
          `window.setFigBoostExportStatus(${JSON.stringify(payload || {})})`,
          true
        ).catch(() => {});
      },
      close() {
        if (!progressWindow.isDestroyed()) progressWindow.close();
      }
    };
  }

  function getFigmaFileCategory(file) {
    const categories = Array.isArray(file && file.categories) ? file.categories.filter(Boolean) : [];
    if (categories.length) return categories[0];
    const source = String(file && file.sourceUrl || "");
    if (/\/files\/drafts/i.test(source)) return "\u8349\u7a3f";
    if (/\/files\/recent/i.test(source)) return "\u6700\u8fd1";
    if (/\/files\/team/i.test(source)) return "\u56e2\u961f\u6587\u4ef6";
    if (/\/files\/project/i.test(source)) return "\u9879\u76ee";
    return "\u5176\u4ed6";
  }

  async function showBulkExportSelectionWindow(owner, files) {
    const selectionWindow = new BrowserWindow({
      width: 820,
      height: 660,
      minWidth: 720,
      minHeight: 520,
      parent: owner || undefined,
      modal: Boolean(owner),
      show: false,
      autoHideMenuBar: true,
      title: "\u9009\u62e9\u8981\u5bfc\u51fa\u7684\u753b\u677f\u6587\u4ef6",
      backgroundColor: "#ffffff",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    selectionWindow.webContents.__FIGBOOST_SKIP_RENDERER_INJECTION__ = true;
    selectionWindow.setMenu(null);
    if (typeof selectionWindow.removeMenu === "function") selectionWindow.removeMenu();
    const safeFiles = files.map((file, index) => ({
      index,
      key: file.key,
      name: file.name,
      url: file.url,
      category: getFigmaFileCategory(file),
      sourceUrl: file.sourceUrl || ""
    }));
    selectionWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    *{box-sizing:border-box}
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#f7f8fa;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI",sans-serif}
    body{display:flex;flex-direction:column}
    header{padding:18px 22px 14px;background:#fff;border-bottom:1px solid #e6e8ec}
    h1{margin:0 0 6px;font-size:20px;line-height:28px}
    .summary{font-size:13px;line-height:20px;color:#5f6b7a}
    .toolbar{display:flex;align-items:center;gap:8px;padding:10px 22px;background:#fff;border-bottom:1px solid #e6e8ec}
    button{height:32px;border:1px solid #ccd2dc;border-radius:6px;background:#fff;color:#18202d;padding:0 12px;font-size:13px;cursor:pointer}
    button.primary{border-color:#1677ff;background:#1677ff;color:#fff}
    button:disabled{opacity:.45;cursor:not-allowed}
    .spacer{flex:1}
    .list{flex:1;overflow:auto;padding:12px 18px 18px}
    .group{margin:0 0 12px;background:#fff;border:1px solid #e6e8ec;border-radius:8px;overflow:hidden}
    .group-title{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fbfcfe;border-bottom:1px solid #edf0f4;font-size:13px;font-weight:650}
    .row{display:grid;grid-template-columns:28px 1fr;gap:8px;align-items:center;padding:9px 12px;border-top:1px solid #f0f2f5}
    .row:first-of-type{border-top:none}
    .name{font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .url{font-size:11px;line-height:16px;color:#7b8494;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    footer{display:flex;align-items:center;gap:10px;padding:12px 22px;background:#fff;border-top:1px solid #e6e8ec}
    .count{font-size:13px;color:#42526b}
  </style>
</head>
<body>
  <header>
    <h1>&#36873;&#25321;&#35201;&#23548;&#20986;&#30340;&#30011;&#26495;&#25991;&#20214;</h1>
    <div class="summary" id="summary"></div>
  </header>
  <div class="toolbar">
    <button id="selectAll">&#20840;&#36873;</button>
    <button id="selectNone">&#20840;&#19981;&#36873;</button>
    <div class="spacer"></div>
    <input id="filter" placeholder="&#25628;&#32034;&#25991;&#20214;&#21517;" style="height:32px;width:220px;border:1px solid #ccd2dc;border-radius:6px;padding:0 10px;font-size:13px">
  </div>
  <div class="list" id="list"></div>
  <footer>
    <div class="count" id="count"></div>
    <div class="spacer"></div>
    <button id="cancel">&#21462;&#28040;</button>
    <button class="primary" id="export">&#36873;&#25321;&#20301;&#32622;&#24182;&#23548;&#20986;</button>
  </footer>
  <script>
    const files = ${JSON.stringify(safeFiles)};
    let selected = new Set(files.map((file) => file.key));
    let filterText = "";
    const byCategory = () => files.reduce((map, file) => {
      if (filterText && !file.name.toLowerCase().includes(filterText)) return map;
      const group = file.category || "\\u5176\\u4ed6";
      if (!map.has(group)) map.set(group, []);
      map.get(group).push(file);
      return map;
    }, new Map());
    const updateCount = () => {
      document.getElementById("summary").textContent = "\\u5171\\u68c0\\u7d22\\u5230 " + files.length + " \\u4e2a Figma Design \\u6587\\u4ef6\\uff0c\\u6309\\u6765\\u6e90\\u5206\\u7c7b\\u663e\\u793a\\u3002";
      document.getElementById("count").textContent = "\\u5df2\\u9009\\u62e9 " + selected.size + " / " + files.length + " \\u4e2a";
      document.getElementById("export").disabled = selected.size === 0;
    };
    const render = () => {
      const list = document.getElementById("list");
      list.innerHTML = "";
      for (const [category, groupFiles] of byCategory().entries()) {
        const group = document.createElement("section");
        group.className = "group";
        const title = document.createElement("div");
        title.className = "group-title";
        const groupCheck = document.createElement("input");
        groupCheck.type = "checkbox";
        groupCheck.checked = groupFiles.every((file) => selected.has(file.key));
        groupCheck.indeterminate = !groupCheck.checked && groupFiles.some((file) => selected.has(file.key));
        groupCheck.onchange = () => {
          for (const file of groupFiles) groupCheck.checked ? selected.add(file.key) : selected.delete(file.key);
          render();
        };
        title.appendChild(groupCheck);
        title.appendChild(document.createTextNode(category + " (" + groupFiles.length + ")"));
        group.appendChild(title);
        for (const file of groupFiles) {
          const row = document.createElement("label");
          row.className = "row";
          const check = document.createElement("input");
          check.type = "checkbox";
          check.checked = selected.has(file.key);
          check.onchange = () => {
            check.checked ? selected.add(file.key) : selected.delete(file.key);
            updateCount();
            render();
          };
          const info = document.createElement("div");
          const name = document.createElement("div");
          name.className = "name";
          name.textContent = file.name || "Untitled";
          const url = document.createElement("div");
          url.className = "url";
          url.textContent = file.sourceUrl || file.url;
          info.appendChild(name);
          info.appendChild(url);
          row.appendChild(check);
          row.appendChild(info);
          group.appendChild(row);
        }
        list.appendChild(group);
      }
      updateCount();
    };
    document.getElementById("selectAll").onclick = () => { selected = new Set(files.map((file) => file.key)); render(); };
    document.getElementById("selectNone").onclick = () => { selected = new Set(); render(); };
    document.getElementById("filter").oninput = (event) => { filterText = event.target.value.trim().toLowerCase(); render(); };
    document.getElementById("cancel").onclick = () => { window.__FIGBOOST_SELECTION_RESULT__ = { canceled: true }; };
    document.getElementById("export").onclick = () => { window.__FIGBOOST_SELECTION_RESULT__ = { canceled: false, keys: Array.from(selected) }; };
    render();
  </script>
</body>
</html>
`)}`);
    selectionWindow.once("ready-to-show", () => {
      if (!selectionWindow.isDestroyed()) selectionWindow.show();
    });
    while (!selectionWindow.isDestroyed()) {
      const result = await selectionWindow.webContents.executeJavaScript("window.__FIGBOOST_SELECTION_RESULT__ || null", true).catch(() => null);
      if (result) {
        selectionWindow.close();
        if (result.canceled) return null;
        const keys = new Set(result.keys || []);
        return files.filter((file) => keys.has(file.key));
      }
      await sleep(200);
    }
    return null;
  }

  function cleanDiscoveredFileName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeWindowsFileName(value) {
    let name = cleanDiscoveredFileName(value)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim();
    if (!name) name = "Untitled";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`;
    return name.slice(0, 180);
  }

  function getFileNameFromUrlSlug(slug, key) {
    try {
      const decoded = decodeURIComponent(String(slug || "").replace(/\+/g, " "));
      const cleaned = cleanDiscoveredFileName(decoded.replace(/[-_]+/g, " "));
      if (cleaned) return cleaned;
    } catch (_) {}
    return key || "Untitled";
  }

  function toFigmaAbsoluteUrl(href) {
    try {
      const url = new URL(href, "https://www.figma.com");
      if (!/(^|\.)figma\.com$/i.test(url.hostname)) return null;
      url.hostname = "www.figma.com";
      url.hash = "";
      return url.toString();
    } catch (_) {
      return null;
    }
  }

  function getFigmaPageCategory(sourceUrl, sourceTitle) {
    const url = String(sourceUrl || "");
    const title = cleanDiscoveredFileName(String(sourceTitle || "").replace(/\s*[-|]\s*Figma.*$/i, ""));
    if (/\/files\/drafts/i.test(url)) return "\u8349\u7a3f";
    if (/\/files\/recent/i.test(url)) return "\u6700\u8fd1";
    if (/\/files\/team/i.test(url)) return title && !/^Figma$/i.test(title) ? `\u56e2\u961f / ${title}` : "\u56e2\u961f\u6587\u4ef6";
    if (/\/files\/project/i.test(url)) return title ? `\u9879\u76ee / ${title}` : "\u9879\u76ee";
    if (/\/files/i.test(url)) return title && !/^Figma$/i.test(title) ? title : "\u6240\u6709\u9879\u76ee";
    return title || "\u5176\u4ed6";
  }

  function extractFigmaFileLink(href, label, sourceUrl, sourceTitle) {
    const url = toFigmaAbsoluteUrl(href);
    if (!url) return null;
    const match = /^https:\/\/www\.figma\.com\/(?:file|design)\/([A-Za-z0-9]+)(?:\/([^?#]+))?/i.exec(url);
    if (!match) return null;
    const name = cleanDiscoveredFileName(label) || getFileNameFromUrlSlug(match[2], match[1]);
    const category = getFigmaPageCategory(sourceUrl, sourceTitle);
    return {
      key: match[1],
      name,
      url,
      sourceUrl,
      categories: [category]
    };
  }

  function shouldScanFigmaPage(href) {
    const url = toFigmaAbsoluteUrl(href);
    if (!url) return false;
    try {
      const parsed = new URL(url);
      if (!parsed.pathname.startsWith("/files")) return false;
      if (/\/(?:file|design)\//i.test(parsed.pathname)) return false;
      if (/deleted|trash|community/i.test(parsed.pathname)) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function shouldReadVisibleFigmaPage(url) {
    const absoluteUrl = toFigmaAbsoluteUrl(url);
    if (!absoluteUrl) return false;
    try {
      const parsed = new URL(absoluteUrl);
      if (!parsed.pathname.startsWith("/files")) return false;
      if (/\/files\/(?:recent|drafts)\b/i.test(parsed.pathname)) return false;
      if (/desktop_new_tab/i.test(absoluteUrl)) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  async function loadFigmaPage(window, url) {
    try {
      await window.loadURL(url);
    } catch (_) {}
    await sleep(700);
  }

  async function readFigmaPageLinks(window) {
    return window.webContents.executeJavaScript(`(async () => {
      const scrollTargets = () => {
        const targets = [document.scrollingElement, document.documentElement, document.body].filter(Boolean);
        for (const element of Array.from(document.querySelectorAll("div,main,section"))) {
          if (element.scrollHeight > element.clientHeight + 120) targets.push(element);
        }
        return Array.from(new Set(targets));
      };
      let lastLinkCount = -1;
      let stableCount = 0;
      for (let index = 0; index < 14 && stableCount < 3; index += 1) {
        for (const target of scrollTargets()) target.scrollTop = target.scrollHeight;
        window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
        await new Promise((resolve) => setTimeout(resolve, 260));
        const nextLinkCount = document.querySelectorAll("a[href]").length;
        if (nextLinkCount === lastLinkCount) stableCount += 1;
        else stableCount = 0;
        lastLinkCount = nextLinkCount;
      }
      const visibleText = (element) => (element && element.innerText || element && element.textContent || "")
        .replace(/\\s+/g, " ")
        .trim();
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 80 && rect.height > 24 && style.visibility !== "hidden" && style.display !== "none";
      };
      const candidates = [];
      const seenTexts = new Set();
      Array.from(document.querySelectorAll("a[href],button,[role='button'],[tabindex],div,li")).forEach((element) => {
        if (!isVisible(element)) return;
        const text = visibleText(element);
        if (!text || text.length > 220 || seenTexts.has(text)) return;
        if (!/(\\d+\\s*(files?|文件)|草稿|最近|所有项目|团队|项目|文件夹|All projects|Drafts|Recent|Teams?|Projects?|Folders?)/i.test(text)) return;
        seenTexts.add(text);
        candidates.push({
          text,
          href: element.href || element.getAttribute("href") || "",
          rect: (() => {
            const rect = element.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          })()
        });
      });
      return {
        title: document.title || "",
        url: location.href,
        links: Array.from(document.querySelectorAll("a[href]")).map((link) => ({
          href: link.href,
          label: [
            link.getAttribute("aria-label"),
            link.getAttribute("title"),
            link.textContent
          ].filter(Boolean).join(" ")
        })),
        candidates
      };
    })();`, true);
  }

  async function clickFigmaPageCandidate(window, candidateText) {
    return window.webContents.executeJavaScript(`(() => {
      const targetText = ${JSON.stringify(candidateText)};
      const visibleText = (element) => (element && element.innerText || element && element.textContent || "")
        .replace(/\\s+/g, " ")
        .trim();
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 80 && rect.height > 24 && style.visibility !== "hidden" && style.display !== "none";
      };
      const candidates = Array.from(document.querySelectorAll("a[href],button,[role='button'],[tabindex],div,li"))
        .filter((element) => isVisible(element) && visibleText(element) === targetText);
      const element = candidates[0];
      if (!element) return false;
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) || element;
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    })();`, true);
  }

  function mergeDiscoveredPage(page, filesByKey, queue, seenPages) {
    for (const link of page.links || []) {
      const file = extractFigmaFileLink(link.href, link.label, page.url, page.title);
      if (file) {
        if (!filesByKey.has(file.key)) {
          filesByKey.set(file.key, file);
        } else {
          const existing = filesByKey.get(file.key);
          existing.categories = Array.from(new Set([...(existing.categories || []), ...(file.categories || [])]));
        }
        continue;
      }
      const nextPage = shouldScanFigmaPage(link.href) ? toFigmaAbsoluteUrl(link.href) : null;
      if (nextPage && !seenPages.has(nextPage) && !queue.includes(nextPage)) queue.push(nextPage);
    }
  }

  function enqueueFigmaProjectCandidates(page, queue, seenPages) {
    for (const candidate of page.candidates || []) {
      if (!/\d+\s*(files?|文件)|团队|项目|文件夹|Teams?|Projects?|Folders?/i.test(candidate.text)) continue;
      const job = {
        url: page.url,
        clickText: candidate.text
      };
      const marker = `${job.url}#${job.clickText}`;
      if (!seenPages.has(marker) && !queue.some((item) => item && item.url === job.url && item.clickText === job.clickText)) {
        queue.push(job);
      }
    }
  }

  async function discoverFigmaFiles(progress) {
    const owner = BrowserWindow.getFocusedWindow();
    const createScanWindow = () => {
      const scanWindow = new BrowserWindow({
        width: 1280,
        height: 900,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      scanWindow.webContents.__FIGBOOST_SKIP_RENDERER_INJECTION__ = true;
      return scanWindow;
    };
    const queue = [
      "https://www.figma.com/files",
      "https://www.figma.com/files/recent",
      "https://www.figma.com/files/team",
      "https://www.figma.com/files/projects"
    ];
    const seenPages = new Set();
    const filesByKey = new Map();
    const scanWindows = [createScanWindow(), createScanWindow(), createScanWindow()];
    let scannedCount = 0;
    const maxPages = 260;
    try {
      for (const contents of webContents.getAllWebContents()) {
        try {
          if (!contents || contents.isDestroyed() || contents.__FIGBOOST_SKIP_RENDERER_INJECTION__) continue;
          if (!/^https:\/\/([^/]+\.)?figma\.com/i.test(contents.getURL())) continue;
          if (/\/files\/drafts\b/i.test(contents.getURL())) continue;
          const page = await readFigmaPageLinks({ webContents: contents });
          mergeDiscoveredPage(page, filesByKey, queue, seenPages);
          enqueueFigmaProjectCandidates(page, queue, seenPages);
        } catch (_) {}
      }
      while (queue.length && seenPages.size < maxPages) {
        const job = queue.shift();
        const pageUrl = typeof job === "string" ? job : job && job.url;
        const clickText = typeof job === "object" && job ? job.clickText : "";
        const pageMarker = clickText ? `${pageUrl}#${clickText}` : pageUrl;
        if (!pageUrl || seenPages.has(pageMarker)) continue;
        seenPages.add(pageMarker);
        if (progress) {
          progress.update({
            sub: clickText ? "\u6b63\u5728\u6253\u5f00\u9879\u76ee\uff1a" + clickText : "\u6b63\u5728\u626b\u63cf\u9875\u9762\uff1a" + pageUrl,
            foot: `\u5df2\u68c0\u7d22 ${filesByKey.size} \u4e2a\u6587\u4ef6\uff0c${seenPages.size} \u4e2a\u9875\u9762`
          });
        }
        const scanWindow = scanWindows[seenPages.size % scanWindows.length];
        await loadFigmaPage(scanWindow, pageUrl);
        if (clickText) {
          const clicked = await clickFigmaPageCandidate(scanWindow, clickText);
          if (!clicked) continue;
          await sleep(900);
        }
        let page;
        try {
          page = await readFigmaPageLinks(scanWindow);
        } catch (_) {
          continue;
        }
        mergeDiscoveredPage(page, filesByKey, queue, seenPages);
        const candidates = (page.candidates || [])
          .filter((candidate) => /\d+\s*(files?|文件)|团队|项目|文件夹|Teams?|Projects?|Folders?/i.test(candidate.text))
          .slice(0, 40);
        for (const candidate of candidates) {
          if (seenPages.size >= maxPages) break;
          const marker = `${pageUrl}#${candidate.text}`;
          if (seenPages.has(marker)) continue;
          seenPages.add(marker);
          if (progress) {
            progress.update({
              sub: "\u6b63\u5728\u6253\u5f00\u9879\u76ee\uff1a" + candidate.text,
              foot: `\u5df2\u68c0\u7d22 ${filesByKey.size} \u4e2a\u6587\u4ef6\uff0c${seenPages.size} \u4e2a\u9875\u9762`
            });
          }
          await loadFigmaPage(scanWindow, pageUrl);
          const clicked = await clickFigmaPageCandidate(scanWindow, candidate.text);
          if (!clicked) continue;
          await sleep(900);
          let childPage;
          try {
            childPage = await readFigmaPageLinks(scanWindow);
          } catch (_) {
            continue;
          }
          mergeDiscoveredPage(childPage, filesByKey, queue, seenPages);
        }
      }
    } finally {
      for (const scanWindow of scanWindows) {
        if (!scanWindow.isDestroyed()) scanWindow.close();
      }
      if (owner && !owner.isDestroyed()) owner.focus();
    }
    return Array.from(filesByKey.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }

  function createTimestampExportDir(rootDir) {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    let dir = path.join(rootDir, stamp);
    let index = 2;
    while (fs.existsSync(dir)) {
      dir = path.join(rootDir, `${stamp}-${index}`);
      index += 1;
    }
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function getUniqueExportPath(exportDir, fileName, usedPaths) {
    const base = sanitizeWindowsFileName(fileName);
    let candidate = path.join(exportDir, `${base}.fig`);
    let index = 2;
    while (usedPaths.has(candidate.toLowerCase()) || fs.existsSync(candidate)) {
      candidate = path.join(exportDir, `${base} (${index}).fig`);
      index += 1;
    }
    usedPaths.add(candidate.toLowerCase());
    return candidate;
  }

  async function waitForStableFile(filePath, timeoutMs) {
    const start = Date.now();
    let lastSize = -1;
    let stableCount = 0;
    while (Date.now() - start < timeoutMs) {
      if (fs.existsSync(filePath)) {
        const size = fs.statSync(filePath).size;
        if (size > 0 && size === lastSize) {
          stableCount += 1;
          if (stableCount >= 2) return;
        } else {
          stableCount = 0;
          lastSize = size;
        }
      }
      await sleep(800);
    }
    throw new Error("\u7b49\u5f85\u672c\u5730\u526f\u672c\u6587\u4ef6\u751f\u6210\u8d85\u65f6");
  }

  function waitForDownloadToPath(contents, targetPath, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const session = contents.session;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        session.removeListener("will-download", onDownload);
      };
      const onDownload = (_, item) => {
        try {
          item.setSavePath(targetPath);
          item.once("done", (_event, state) => {
            cleanup();
            if (state === "completed") resolve();
            else reject(new Error(`\u4e0b\u8f7d\u672c\u5730\u526f\u672c\u5931\u8d25\uff1a${state}`));
          });
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("\u7b49\u5f85 Figma \u672c\u5730\u526f\u672c\u4e0b\u8f7d\u8d85\u65f6"));
      }, timeoutMs);
      session.once("will-download", onDownload);
    });
  }

  function findMenuItem(patterns) {
    const menu = Menu.getApplicationMenu();
    const tests = patterns.map((pattern) => pattern instanceof RegExp ? pattern : new RegExp(pattern, "i"));
    const visit = (items) => {
      for (const item of items || []) {
        const label = String(item.label || "");
        if (tests.some((pattern) => pattern.test(label))) return item;
        const found = item.submenu && visit(item.submenu.items);
        if (found) return found;
      }
      return null;
    };
    return menu && visit(menu.items);
  }

  function clickMenuItem(patterns, owner, missingMessage) {
    const item = findMenuItem(patterns);
    if (!item || typeof item.click !== "function") throw new Error(missingMessage);
    item.click(item, owner || BrowserWindow.getFocusedWindow(), { triggeredByAccelerator: false });
  }

  function getFigmaDesktopInternals() {
    try {
      const windowManager = typeof V !== "undefined" ? V : null;
      const openUrl = typeof io === "function" ? io : null;
      if (windowManager && typeof windowManager.newWindow === "function" && openUrl) {
        return { windowManager, openUrl };
      }
    } catch (_) {}
    return null;
  }

  function moveExportWindowToBackground(browserWindow, owner) {
    if (!browserWindow || browserWindow.isDestroyed()) return;
    try { browserWindow.setSkipTaskbar(true); } catch (_) {}
    try { browserWindow.setBounds({ x: -32000, y: -32000, width: 1280, height: 900 }); } catch (_) {}
    try { browserWindow.showInactive(); } catch (_) {}
    if (owner && !owner.isDestroyed()) {
      try { owner.focus(); } catch (_) {}
    }
  }

  function createFigmaExportContext(owner) {
    const internals = getFigmaDesktopInternals();
    if (!internals) return { owner, close() {} };
    try {
      const desktopWindow = internals.windowManager.newWindow();
      const browserWindow = desktopWindow && desktopWindow.browserWindow;
      moveExportWindowToBackground(browserWindow, owner);
      return {
        internals,
        desktopWindow,
        browserWindow,
        owner: browserWindow || owner,
        close() {
          try {
            if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close();
          } catch (_) {}
        }
      };
    } catch (_) {
      return { owner, close() {} };
    }
  }

  async function withSaveDialogTarget(targetPath, task) {
    const originalShowSaveDialog = dialog.showSaveDialog;
    const originalShowSaveDialogSync = dialog.showSaveDialogSync;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: targetPath });
    dialog.showSaveDialogSync = () => targetPath;
    try {
      return await task();
    } finally {
      dialog.showSaveDialog = originalShowSaveDialog;
      dialog.showSaveDialogSync = originalShowSaveDialogSync;
    }
  }

  function getFigmaFileKey(url) {
    const match = /\/(?:file|design)\/([A-Za-z0-9]+)/.exec(String(url || ""));
    return match && match[1];
  }

  function findFigmaWebContentsByFileKey(fileKey) {
    if (!fileKey) return null;
    return webContents.getAllWebContents().find((contents) => {
      if (!contents || contents.isDestroyed()) return false;
      return contents.getURL().includes(`/file/${fileKey}`) || contents.getURL().includes(`/design/${fileKey}`);
    }) || null;
  }

  async function waitForFigmaFileWebContents(fileUrl, timeoutMs) {
    const fileKey = getFigmaFileKey(fileUrl);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const contents = findFigmaWebContentsByFileKey(fileKey);
      if (contents && !contents.isLoading()) return contents;
      await sleep(500);
    }
    throw new Error("\u7b49\u5f85 Figma \u6253\u5f00\u753b\u677f\u6587\u4ef6\u8d85\u65f6");
  }

  function getActiveWebContentsFromExportContext(exportContext) {
    try {
      const view = exportContext && exportContext.desktopWindow && exportContext.desktopWindow.activeView;
      return view && view.webContents && !view.webContents.isDestroyed() ? view.webContents : null;
    } catch (_) {
      return null;
    }
  }

  async function waitForExportContextFileWebContents(exportContext, fileUrl, timeoutMs) {
    const fileKey = getFigmaFileKey(fileUrl);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const active = getActiveWebContentsFromExportContext(exportContext);
      if (active && (active.getURL().includes(`/file/${fileKey}`) || active.getURL().includes(`/design/${fileKey}`)) && !active.isLoading()) {
        return active;
      }
      await sleep(500);
    }
    throw new Error("\u7b49\u5f85 Figma \u540e\u53f0\u7a97\u53e3\u6253\u5f00\u753b\u677f\u6587\u4ef6\u8d85\u65f6");
  }

  async function openFigmaFileInDesktop(owner, fileUrl, exportContext) {
    if (exportContext && exportContext.internals && exportContext.desktopWindow) {
      exportContext.internals.openUrl(fileUrl, {
        targetWindow: exportContext.desktopWindow,
        isExternalOpen: true,
        openInBackground: false,
        source: "figboost-bulk-export"
      });
      moveExportWindowToBackground(exportContext.browserWindow, owner);
      const contents = await waitForExportContextFileWebContents(exportContext, fileUrl, 90000);
      await sleep(2500);
      return { owner: exportContext.browserWindow || owner, contents, exportContext };
    }
    const previousClipboard = clipboard.readText();
    try {
      clipboard.writeText(fileUrl);
      clickMenuItem([
        /Open File URL From Clipboard/i,
        /\u4ece\u526a\u8d34\u677f\u6253\u5f00\u6587\u4ef6\s*URL/i
      ], owner, "\u627e\u4e0d\u5230 Figma \u7684\u201c\u4ece\u526a\u8d34\u677f\u6253\u5f00\u6587\u4ef6 URL\u201d\u547d\u4ee4");
    } finally {
      clipboard.writeText(previousClipboard || "");
    }
    const contents = await waitForFigmaFileWebContents(fileUrl, 90000);
    owner = BrowserWindow.fromWebContents(contents) || owner || BrowserWindow.getFocusedWindow();
    if (owner && !owner.isDestroyed()) {
      owner.show();
      owner.focus();
    }
    await sleep(3000);
    return { owner, contents };
  }

  async function triggerFigmaSaveLocalCopy(owner, exportContext) {
    if (exportContext && exportContext.desktopWindow && typeof exportContext.desktopWindow.postMessageToActiveWebBinding === "function") {
      exportContext.desktopWindow.postMessageToActiveWebBinding("handleAction", "save-as", "os-menu");
      return;
    }
    clickMenuItem([
      /Save Local Copy/i,
      /\u4fdd\u5b58\u672c\u5730\u526f\u672c/i
    ], owner, "\u627e\u4e0d\u5230 Figma \u7684\u201c\u4fdd\u5b58\u672c\u5730\u526f\u672c\u201d\u547d\u4ee4");
  }

  async function exportFigmaFileLocalCopy(file, targetPath, exportContext) {
    const owner = BrowserWindow.getFocusedWindow();
    const opened = await openFigmaFileInDesktop(owner, file.url, exportContext);
    await withSaveDialogTarget(targetPath, async () => {
      const download = waitForDownloadToPath(opened.contents, targetPath, 300000);
      await triggerFigmaSaveLocalCopy(opened.owner, opened.exportContext);
      await download;
    });
    await waitForStableFile(targetPath, 300000);
  }

  async function bulkExportFigmaFiles() {
    if (global.__FIGBOOST_BULK_EXPORT_RUNNING__) {
      await dialog.showMessageBox({
        type: "info",
        title: "\u6b63\u5728\u6279\u91cf\u5bfc\u51fa",
        message: "\u753b\u677f\u6587\u4ef6\u6b63\u5728\u6279\u91cf\u5bfc\u51fa\uff0c\u8bf7\u7a0d\u5019\u3002"
      });
      return { running: true };
    }
    global.__FIGBOOST_BULK_EXPORT_RUNNING__ = true;
    const owner = BrowserWindow.getFocusedWindow();
    const progress = createBulkExportProgressWindow(owner);
    try {
      let files = await discoverFigmaFiles(progress);
      if (!files.length) {
        progress.close();
        await showMessageBoxForOwner(owner, {
          type: "info",
          title: "\u672a\u68c0\u7d22\u5230\u6587\u4ef6",
          message: "\u6ca1\u6709\u68c0\u7d22\u5230\u5f53\u524d\u8d26\u53f7\u53ef\u89c1\u7684 Figma Design \u6587\u4ef6\u3002",
          detail: "\u8bf7\u786e\u8ba4 Figma Desktop \u5df2\u767b\u5f55\uff0c\u5e76\u4e14\u5f53\u524d\u8d26\u53f7\u6709\u6743\u9650\u8bbf\u95ee\u76f8\u5e94\u56e2\u961f\u6216\u9879\u76ee\u3002"
        });
        return { files: 0 };
      }
      progress.update({
        title: "\u68c0\u7d22\u5b8c\u6210",
        sub: `\u5171\u68c0\u7d22\u5230 ${files.length} \u4e2a Figma Design \u6587\u4ef6`,
        foot: "\u8bf7\u5728\u5217\u8868\u4e2d\u52fe\u9009\u8981\u5bfc\u51fa\u7684\u6587\u4ef6"
      });
      progress.close();
      files = await showBulkExportSelectionWindow(owner, files);
      if (!files || !files.length) return { canceled: true };
      const selected = await showOpenDialogForOwner(owner, {
        title: "\u9009\u62e9\u6279\u91cf\u5bfc\u51fa\u4fdd\u5b58\u4f4d\u7f6e",
        properties: ["openDirectory", "createDirectory"]
      });
      if (selected.canceled || !selected.filePaths || !selected.filePaths[0]) {
        return { canceled: true, files: files.length };
      }
      const exportDir = createTimestampExportDir(selected.filePaths[0]);
      const usedPaths = new Set();
      const succeeded = [];
      const failed = [];
      const exportContext = createFigmaExportContext(owner);
      const exportProgress = createBulkExportProgressWindow(owner);
      try {
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          const targetPath = getUniqueExportPath(exportDir, file.name, usedPaths);
          exportProgress.update({
            title: "\u6b63\u5728\u6279\u91cf\u5bfc\u51fa",
            sub: `${index + 1}/${files.length} ${file.name}`,
            foot: exportDir
          });
          try {
            await exportFigmaFileLocalCopy(file, targetPath, exportContext);
            succeeded.push({ file, targetPath });
          } catch (error) {
            failed.push({
              file,
              error: error && error.message ? error.message : String(error)
            });
          }
        }
      } finally {
        exportContext.close();
        exportProgress.close();
      }
      progress.close();
      const failedDetail = failed.slice(0, 8).map((entry) => `${entry.file.name}: ${entry.error}`).join("\n");
      await showMessageBoxForOwner(owner, {
        type: failed.length ? "warning" : "info",
        title: "\u6279\u91cf\u5bfc\u51fa\u5b8c\u6210",
        message: `\u6210\u529f ${succeeded.length} \u4e2a\uff0c\u5931\u8d25 ${failed.length} \u4e2a\u3002`,
        detail: `\u5bfc\u51fa\u76ee\u5f55\uff1a${exportDir}${failedDetail ? "\n\n\u5931\u8d25\u6587\u4ef6\uff1a\n" + failedDetail : ""}`
      });
      return { ok: true, exportDir, succeeded: succeeded.length, failed: failed.length };
    } catch (error) {
      progress.close();
      await showMessageBoxForOwner(owner, {
        type: "error",
        title: "\u6279\u91cf\u5bfc\u51fa\u5931\u8d25",
        message: "\u65e0\u6cd5\u6279\u91cf\u5bfc\u51fa\u753b\u677f\u6587\u4ef6",
        detail: error && error.message ? error.message : String(error)
      });
      return { ok: false };
    } finally {
      progress.close();
      global.__FIGBOOST_BULK_EXPORT_RUNNING__ = false;
    }
  }

  function registerBulkFigmaFileExport() {
    if (!ipcMain || global.__FIGBOOST_BULK_EXPORT_IPC_REGISTERED__) return;
    global.__FIGBOOST_BULK_EXPORT_IPC_REGISTERED__ = true;
    global.__FIGBOOST_BULK_EXPORT_FILES__ = bulkExportFigmaFiles;
    ipcMain.handle("figboost:bulk-export-files", () => bulkExportFigmaFiles());
  }

  function buildFigBoostFeatureMenuTemplate() {
    return [
      {
        label: "检查更新",
        click: () => {
          checkOfficialUpdateManually();
        }
      },
      { type: "separator" },
      {
        label: "\u6279\u91cf\u5bfc\u51fa\u753b\u677f\u6587\u4ef6...",
        click: () => {
          bulkExportFigmaFiles();
        }
      }
    ];
  }

  function findOwnerWindowForWebContents(sender) {
    if (!sender || !BrowserWindow) return null;

    const directOwner = BrowserWindow.fromWebContents(sender);
    if (directOwner) return directOwner;

    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents === sender) return window;
      if (typeof window.getBrowserViews !== "function") continue;
      if (window.getBrowserViews().some((view) => view.webContents === sender)) return window;
    }
    return null;
  }

  function normalizeFigBoostMenuBounds(bounds) {
    if (!bounds || typeof bounds !== "object") return null;
    const left = Number(bounds.left);
    const bottom = Number(bounds.bottom);
    if (!Number.isFinite(left) || !Number.isFinite(bottom)) return null;
    return {
      x: Math.max(0, Math.round(left)),
      y: Math.max(0, Math.round(bottom))
    };
  }

  function parseFigBoostMenuBoundsFromUrl(url) {
    try {
      const params = new URL(url).searchParams;
      const bounds = {};
      for (const key of ["left", "top", "right", "bottom", "width", "height"]) {
        bounds[key] = Number(params.get(key));
      }
      return bounds;
    } catch (_) {
      return null;
    }
  }

  function dispatchFeatureMenuClosed(contents) {
    try {
      contents.executeJavaScript(
        "window.dispatchEvent(new CustomEvent('figboost:feature-menu-closed'))",
        true
      ).catch(() => {});
    } catch (_) {}
  }

  function openFigBoostFeatureMenu(sender, bounds) {
    const owner = findOwnerWindowForWebContents(sender)
      || BrowserWindow.getFocusedWindow();
    const point = normalizeFigBoostMenuBounds(bounds);
    const menu = Menu.buildFromTemplate(buildFigBoostFeatureMenuTemplate());
    const popupOptions = {};
    if (owner) popupOptions.window = owner;
    if (point) {
      popupOptions.x = point.x;
      popupOptions.y = point.y;
    }
    global.__FIGBOOST_ACTIVE_FEATURE_MENUS__.add(menu);
    popupOptions.callback = () => {
      global.__FIGBOOST_ACTIVE_FEATURE_MENUS__.delete(menu);
      if (sender) dispatchFeatureMenuClosed(sender);
    };
    menu.popup(popupOptions);
    return { ok: true };
  }

  function registerFigBoostFeatureMenu() {
    if (!ipcMain || global.__FIGBOOST_FEATURE_MENU_IPC_REGISTERED__) return;
    global.__FIGBOOST_FEATURE_MENU_IPC_REGISTERED__ = true;
    if (!global.__FIGBOOST_ACTIVE_FEATURE_MENUS__) global.__FIGBOOST_ACTIVE_FEATURE_MENUS__ = new Set();
    global.__FIGBOOST_OPEN_FEATURE_MENU__ = openFigBoostFeatureMenu;
    ipcMain.handle("figboost:open-feature-menu", (event, bounds) => {
      return openFigBoostFeatureMenu(event && event.sender, bounds);
    });
  }

  let rendererPayloadCache = null;

  function getRendererPayload() {
    if (rendererPayloadCache !== null) return rendererPayloadCache;
    const payloadPath = global.__FIGMA_ZH_RENDERER_PAYLOAD_PATH__
      || path.join(getRuntimeDir(), "figma-zh-official-preload.js");
    rendererPayloadCache = fs.readFileSync(payloadPath, "utf8");
    return rendererPayloadCache;
  }

  function buildFigBoostRendererBridgeScript(showTitlebarButton) {
    try {
      if (!global.__FIGBOOST_FEATURE_ENABLED__
        || !global.__FIGBOOST_FEATURE_ENABLED__("auto-check-official-latest")) {
        return "";
      }
      return `(() => {
        try {
          window.__FIGBOOST_UPDATE_BUTTON_ENABLED__ = true;
          ${showTitlebarButton ? "window.__FIGBOOST_TITLEBAR_BUTTON_ENABLED__ = true;" : ""}
          const { ipcRenderer } = require("electron");
          if (ipcRenderer && !window.__FIGBOOST_CHECK_OFFICIAL_UPDATE__) {
            Object.defineProperty(window, "__FIGBOOST_CHECK_OFFICIAL_UPDATE__", {
              value: () => ipcRenderer.invoke("figboost:check-official-update")
            });
          }
          if (ipcRenderer && !window.__FIGBOOST_OPEN_FEATURE_MENU__) {
            Object.defineProperty(window, "__FIGBOOST_OPEN_FEATURE_MENU__", {
              value: (bounds) => ipcRenderer.invoke("figboost:open-feature-menu", bounds)
            });
          }
          if (ipcRenderer && !window.__FIGBOOST_BULK_EXPORT_FILES__) {
            Object.defineProperty(window, "__FIGBOOST_BULK_EXPORT_FILES__", {
              value: () => ipcRenderer.invoke("figboost:bulk-export-files")
            });
          }
        } catch (_) {
          window.__FIGBOOST_UPDATE_BUTTON_ENABLED__ = true;
          ${showTitlebarButton ? "window.__FIGBOOST_TITLEBAR_BUTTON_ENABLED__ = true;" : ""}
        }
      })();`;
    } catch (_) {
      return "";
    }
  }

  function dispatchUpdateCheckFinished(contents) {
    try {
      contents.executeJavaScript(
        "window.dispatchEvent(new CustomEvent('figboost:update-check-finished'))",
        true
      ).catch(() => {});
    } catch (_) {}
  }

  function handleFigBoostNavigation(contents, event, url) {
    try {
      if (/^figboost:\/\/open-feature-menu/i.test(url || "")) {
        if (event && event.preventDefault) event.preventDefault();
        const openMenu = global.__FIGBOOST_OPEN_FEATURE_MENU__;
        if (typeof openMenu === "function") openMenu(contents, parseFigBoostMenuBoundsFromUrl(url));
        return true;
      }
      if (/^figboost:\/\/bulk-export-files/i.test(url || "")) {
        if (event && event.preventDefault) event.preventDefault();
        const bulkExport = global.__FIGBOOST_BULK_EXPORT_FILES__;
        if (typeof bulkExport === "function") {
          Promise.resolve(bulkExport()).finally(() => dispatchUpdateCheckFinished(contents));
        } else {
          dispatchUpdateCheckFinished(contents);
        }
        return true;
      }
      if (!/^figboost:\/\/check-official-update/i.test(url || "")) return false;
      if (event && event.preventDefault) event.preventDefault();
      const checkUpdate = global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__;
      if (typeof checkUpdate === "function") {
        Promise.resolve(checkUpdate()).finally(() => dispatchUpdateCheckFinished(contents));
      } else {
        dispatchUpdateCheckFinished(contents);
      }
      return true;
    } catch (_) {
      dispatchUpdateCheckFinished(contents);
      return true;
    }
  }

  function injectRendererPayload(contents) {
    if (!contents || contents.__FIGBOOST_RENDERER_INJECTED__ || contents.__FIGBOOST_SKIP_RENDERER_INJECTION__) return;
    contents.__FIGBOOST_RENDERER_INJECTED__ = true;
    contents.on("will-navigate", (event, url) => handleFigBoostNavigation(contents, event, url));
    if (contents.setWindowOpenHandler) {
      contents.setWindowOpenHandler(({ url }) => (
        handleFigBoostNavigation(contents, null, url) ? { action: "deny" } : { action: "allow" }
      ));
    }
    const run = () => {
      try {
        if (contents.__FIGBOOST_SKIP_RENDERER_INJECTION__) return;
        const url = contents.getURL();
        const isFigmaPage = /^https:\/\/([^/]+\.)?figma\.com/i.test(url);
        const bridge = buildFigBoostRendererBridgeScript(!isFigmaPage);
        const payload = getRendererPayload();
        contents.executeJavaScript(bridge + payload, true).catch(() => {});
      } catch (_) {}
    };
    setTimeout(run, 0);
    setTimeout(run, 1000);
    contents.on("dom-ready", run);
    contents.on("did-finish-load", run);
  }

  function registerRendererInjection() {
    if (!webContents || global.__FIGBOOST_RENDERER_INJECTION_REGISTERED__) return;
    global.__FIGBOOST_RENDERER_INJECTION_REGISTERED__ = true;
    app.on("web-contents-created", (_, contents) => injectRendererPayload(contents));
    webContents.getAllWebContents().forEach(injectRendererPayload);
  }

  if (!global.__FIGMA_ZH_MENU_LOCALIZER__) {
    global.__FIGMA_ZH_MENU_LOCALIZER__ = true;
    const buildFromTemplate = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = function (template) {
      localizeTemplate(template);
      return buildFromTemplate(template);
    };
    const popup = Menu.prototype.popup;
    Menu.prototype.popup = function (...args) {
      localizeItems(this.items);
      return popup.apply(this, args);
    };
    hookDialogMethod("showMessageBox");
    hookDialogMethod("showMessageBoxSync");
    hookAboutPanelOptions();
    hookBuiltInUpdateChecks();
    registerManualOfficialUpdateCheck();
    registerBulkFigmaFileExport();
    registerFigBoostFeatureMenu();
    registerRendererInjection();
    app.whenReady().then(scheduleLocalize).catch(() => {});
    app.on("browser-window-created", scheduleLocalize);
    app.on("browser-window-focus", scheduleLocalize);
    setInterval(localizeMenu, 5000).unref();
  }
})();
