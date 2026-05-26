(function () {
  "use strict";

  const { app, dialog, Menu } = require("electron");
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
    "Graphics Backend": "图形后端",
    "Missing a new feature? Try reloading your tabs and check again. If you experience any other issues, please contact support.": "缺少新功能？请重新加载标签页后再检查。如果遇到其他问题，请联系支持。",
    "No Update Available": "没有可用更新",
    "Reload All Tabs": "重新加载全部标签页",
    "Replace": "替换",
    "Replace Existing Files": "替换现有文件",
    "Replace existing files?": "要替换现有文件吗？",
    "Reset Figma and Restart": "重置 Figma 并重启",
    "Copy Link": "复制链接",
    "Rename File": "重命名文件",
    "Reload Tab": "重新加载标签页",
    "Move to New Window": "移动到新窗口",
    "Pin Tab": "固定标签页",
    "Close Other Tabs": "关闭其他标签页",
    "Close All Tabs": "关闭全部标签页",
    "You are already using the latest version of Figma.": "您已经在使用最新版 Figma。"
  };

  const labelPatterns = [
    [/^Figma Desktop App version (.+)$/, "Figma 桌面应用版本 $1"],
    [/^Copyright © (\d{4}) Figma, Inc\.$/, "版权所有 © $1 Figma, Inc."],
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

  async function getOfficialLatestVersion() {
    const versions = [];
    try {
      versions.push(await getOfficialInstallerVersion());
    } catch (_) {}
    try {
      versions.push(await getOfficialFeedVersion());
    } catch (_) {}
    if (!versions.length) throw new Error("Cannot parse official latest version.");
    return versions.sort((a, b) => compareVersions(b, a))[0];
  }

  function scheduleOfficialUpdateCheck(delayMs) {
    setTimeout(checkOfficialUpdateOnStartup, delayMs).unref();
  }

  async function checkOfficialUpdateOnStartup() {
    const now = Date.now();
    if (global.__FIGMA_ZH_OFFICIAL_UPDATE_CHECKING__) return;
    if (global.__FIGMA_ZH_OFFICIAL_UPDATE_LAST_CHECK__ && now - global.__FIGMA_ZH_OFFICIAL_UPDATE_LAST_CHECK__ < 5000) return;
    global.__FIGMA_ZH_OFFICIAL_UPDATE_CHECKING__ = true;
    global.__FIGMA_ZH_OFFICIAL_UPDATE_LAST_CHECK__ = now;
    const config = readFeatureConfig();
    try {
      if (!isFeatureEnabled(config, "auto-check-official-latest")) return;
      const patcherPath = config && config.patcherPath;
      const runtimeDir = config && config.runtimeDir;
      if (!patcherPath || !runtimeDir || !fs.existsSync(patcherPath)) return;
      let latestVersion;
      try {
        latestVersion = await getOfficialLatestVersion();
      } catch (_) {
        return;
      }
      const currentVersion = app.getVersion();
      if (compareVersions(currentVersion, latestVersion) >= 0) return;
      const result = await dialog.showMessageBox({
        type: "question",
        buttons: ["更新", "稍后"],
        defaultId: 0,
        cancelId: 1,
        title: "发现 Figma 新版本",
        message: `检测到官方最新版 Figma ${latestVersion}`,
        detail: `当前版本是 ${currentVersion}。\n\n点击“更新”会关闭 Figma，下载并安装官方最新版，更新完成后会自动安装汉化补丁。`
      });
      if (result.response !== 0) return;
      try {
        const child = spawn(patcherPath, ["-UpdateFigma", "-RuntimeDir", runtimeDir, "-ForceClose"], {
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
      }
    } finally {
      global.__FIGMA_ZH_OFFICIAL_UPDATE_CHECKING__ = false;
    }
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
    app.whenReady().then(scheduleLocalize).catch(() => {});
    app.whenReady().then(() => scheduleOfficialUpdateCheck(1500)).catch(() => {});
    app.on("second-instance", () => scheduleOfficialUpdateCheck(800));
    app.on("browser-window-created", scheduleLocalize);
    app.on("browser-window-created", () => scheduleOfficialUpdateCheck(1500));
    app.on("browser-window-focus", scheduleLocalize);
    setInterval(localizeMenu, 5000).unref();
  }
})();
