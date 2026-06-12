(function () {
  "use strict";

  const { app, autoUpdater, dialog, ipcMain, Menu } = require("electron");
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
      const optionIndex = args[0] && typeof args[0] === "object" && !("title" in args[0] || "message" in args[0] || "detail" in args[0]) ? 1 : 0;
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
    try {
      if (!isFeatureEnabled(config, "auto-check-official-latest")) return { disabled: true };
      const patcherPath = config && config.patcherPath;
      const runtimeDir = config && config.runtimeDir;
      if (!patcherPath || !runtimeDir || !fs.existsSync(patcherPath)) {
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
        await dialog.showMessageBox({
          type: "info",
          title: "当前已是官方最新版",
          message: `当前 Figma 版本 ${currentVersion} 已是官方最新版。`
        });
        return { latest: true };
      }
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
      global.__FIGMA_ZH_OFFICIAL_UPDATE_CHECKING__ = false;
    }
  }

  function registerManualOfficialUpdateCheck() {
    if (!ipcMain || global.__FIGBOOST_UPDATE_IPC_REGISTERED__) return;
    global.__FIGBOOST_UPDATE_IPC_REGISTERED__ = true;
    global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__ = checkOfficialUpdateManually;
    ipcMain.handle("figboost:check-official-update", () => checkOfficialUpdateManually());
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
    app.whenReady().then(scheduleLocalize).catch(() => {});
    app.on("browser-window-created", scheduleLocalize);
    app.on("browser-window-focus", scheduleLocalize);
    setInterval(localizeMenu, 5000).unref();
  }
})();
