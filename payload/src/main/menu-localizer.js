(function () {
  "use strict";

  const { app, dialog, Menu } = require("electron");
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
    app.on("browser-window-created", scheduleLocalize);
    app.on("browser-window-focus", scheduleLocalize);
    setInterval(localizeMenu, 5000).unref();
  }
})();
