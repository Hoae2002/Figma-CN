(function () {
  "use strict";

  const { app, Menu } = require("electron");
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
    "Exit": "退出",
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
    "Reload All Tabs": "重新加载全部标签页",
    "Reset Figma and Restart": "重置 Figma 并重启",
    "Copy Link": "复制链接",
    "Rename File": "重命名文件",
    "Reload Tab": "重新加载标签页",
    "Move to New Window": "移动到新窗口",
    "Pin Tab": "固定标签页",
    "Close Other Tabs": "关闭其他标签页",
    "Close All Tabs": "关闭全部标签页"
  };

  function localizeItems(items) {
    let changed = false;
    for (const item of items || []) {
      if (item.label && labels[item.label]) {
        item.label = labels[item.label];
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
      if (item.label && labels[item.label]) item.label = labels[item.label];
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
    app.whenReady().then(scheduleLocalize).catch(() => {});
    app.on("browser-window-created", scheduleLocalize);
    app.on("browser-window-focus", scheduleLocalize);
    setInterval(localizeMenu, 5000).unref();
  }
})();
