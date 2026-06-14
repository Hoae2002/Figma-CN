(function () {
  "use strict";

  const IS_TEST_PAGE = Boolean(window.__FIGMA_ZH_TEST__);
  const IS_FIGMA_PAGE = /(^|\.)figma\.com$/.test(location.hostname);
  const IS_TITLEBAR_PAGE = Boolean(window.__FIGBOOST_TITLEBAR_BUTTON_ENABLED__);
  const SHOULD_INSTALL_UPDATE_BUTTON = IS_TEST_PAGE || (IS_TITLEBAR_PAGE && !IS_FIGMA_PAGE);
  if (!IS_TEST_PAGE && !IS_FIGMA_PAGE && !IS_TITLEBAR_PAGE) return;

  const DEFAULT_SETTINGS = {
    enabled: true,
    debug: false,
    fallbackTerms: true
  };

  function installAntiFlashStyle() {
    if (document.getElementById("figma-zh-anti-flash-style")) return true;
    if (!document.head) return false;
    const style = document.createElement("style");
    style.id = "figma-zh-anti-flash-style";
    style.textContent = [
      "[data-figma-zh-tooltip='1']{width:max-content!important;inline-size:max-content!important;min-width:0!important;max-width:min(360px,calc(100vw - 24px))!important;}",
      "[data-figma-zh-tooltip='1']>[data-figma-zh-localized='1']{width:auto!important;inline-size:auto!important;min-width:0!important;}",
      "[data-figma-zh-tooltip='1'] [data-figma-zh-localized='1']{white-space:normal!important;}",
      "[data-figma-zh-pending='1']{visibility:hidden!important;}",
      "[data-figma-zh-compact-text='1']{white-space:nowrap!important;word-break:keep-all!important;overflow-wrap:normal!important;}",
      "[data-figma-zh-tooltip='1'] [data-figma-zh-compact-text='1']{white-space:nowrap!important;word-break:keep-all!important;overflow-wrap:normal!important;width:auto!important;inline-size:auto!important;min-inline-size:max-content!important;}"
    ].join("");
    document.head.appendChild(style);
    return true;
  }

  function scheduleAntiFlashStyleInstall() {
    if (installAntiFlashStyle()) return;

    const observer = new MutationObserver(() => {
      if (installAntiFlashStyle()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true });

    document.addEventListener("DOMContentLoaded", () => {
      if (installAntiFlashStyle()) observer.disconnect();
    }, { once: true });
  }

  function getFigBoostUpdateBridge() {
    return typeof window.__FIGBOOST_CHECK_OFFICIAL_UPDATE__ === "function"
      ? window.__FIGBOOST_CHECK_OFFICIAL_UPDATE__
      : null;
  }

  function isFigBoostUpdateButtonEnabled() {
    return Boolean(window.__FIGBOOST_UPDATE_BUTTON_ENABLED__ || getFigBoostUpdateBridge() || window.__FIGMA_ZH_TEST_UPDATE_BUTTON__);
  }

  const FIGBOOST_MENU_ITEMS = [
    {
      id: "check-official-update",
      label: "检查更新",
      busyLabel: "检查中...",
      title: "检查 Figma 官方新版",
      run: runOfficialUpdateCheck
    }
  ];

  function findTopBarHost() {
    if (IS_TITLEBAR_PAGE && document.body) return { element: document.body, placement: "titlebar" };

    const selectors = [
      "[class*='tab_bar']",
      "[class*='tabbar']",
      "[role='tablist']"
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.getBoundingClientRect().height >= 24) {
        return { element, placement: "tab" };
      }
    }
    return null;
  }

  function installFigBoostMenuStyle() {
    if (document.getElementById("figboost-menu-style")) return true;
    if (!document.head) return false;
    const style = document.createElement("style");
    style.id = "figboost-menu-style";
    style.textContent = [
      ".figboost-menu-wrap{z-index:2147483000;pointer-events:auto;font:12px/16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222;}",
      ".figboost-menu-wrap[data-placement='tab']{position:absolute;right:234px;top:50%;transform:translateY(-50%);}",
      ".figboost-menu-wrap[data-placement='titlebar']{position:fixed;right:234px;top:0;border-left:solid 1px var(--color-bordertranslucent);}",
      ".figboost-menu-button{box-sizing:border-box;width:50px;height:37px;min-width:0;min-height:0;margin:0;padding:0;border:0;border-radius:0;background:transparent;color:#b6b6b6;display:flex;align-items:center;justify-content:center;cursor:pointer;font:inherit;line-height:0;appearance:none;-webkit-appearance:none;outline:0;box-shadow:none;transform:none;-webkit-app-region:no-drag;}",
      ".figboost-menu-wrap[data-placement='titlebar'] .figboost-menu-button{background-color:unset;display:flex;align-items:center;justify-content:center;width:50px;height:38px;-webkit-app-region:no-drag;color:var(--color-text-secondary);fill:var(--color-text-secondary);--fpl-icon-color:var(--color-text-secondary);pointer-events:bounding-box;}",
      ".figboost-menu-button:hover,.figboost-menu-button[aria-expanded='true'],.figboost-menu-button[aria-pressed='true']{background:#424242;color:#d6d6d6;}",
      ".figboost-menu-wrap[data-placement='titlebar'] .figboost-menu-button:hover,.figboost-menu-wrap[data-placement='titlebar'] .figboost-menu-button:focus-visible{background-color:var(--color-bghovertransparent)!important;color:var(--color-text)!important;fill:var(--color-text)!important;--fpl-icon-color:var(--color-text)!important;}",
      ".figboost-menu-wrap[data-placement='titlebar'] .figboost-menu-button:active,.figboost-menu-wrap[data-placement='titlebar'] .figboost-menu-button[aria-pressed='true']{background-color:var(--color-bgtransparent-secondary-hover)!important;color:var(--color-text)!important;fill:var(--color-text)!important;--fpl-icon-color:var(--color-text)!important;}",
      ".figboost-menu-button:active{background:#424242;color:#d6d6d6;box-shadow:none;transform:none;}",
      ".figboost-menu-button:focus{outline:0;}",
      ".figboost-menu-button:focus-visible{outline:1px solid #6a6a6a;outline-offset:-1px;}",
      ".figboost-menu-button:disabled{cursor:default;opacity:.55;}",
      ".figboost-menu-button svg{width:12px;height:12px;display:block;stroke:currentColor;}",
      ".figboost-menu-panel{box-sizing:border-box;position:absolute;top:34px;right:0;min-width:148px;padding:6px 0;border:1px solid rgba(0,0,0,.12);border-radius:6px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.14);}",
      ".figboost-menu-wrap[data-placement='titlebar'] .figboost-menu-panel{top:44px;}",
      ".figboost-menu-panel[hidden]{display:none;}",
      ".figboost-menu-item{box-sizing:border-box;width:100%;min-height:28px;padding:6px 12px;border:0;background:transparent;color:#222;text-align:left;font:12px/16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;cursor:pointer;}",
      ".figboost-menu-item:hover,.figboost-menu-item:focus{background:rgba(0,0,0,.06);outline:0;}",
      ".figboost-menu-item:disabled{cursor:default;opacity:.55;background:transparent;}"
    ].join("");
    document.head.appendChild(style);
    return true;
  }

  async function runOfficialUpdateCheck() {
    const bridge = getFigBoostUpdateBridge();
    if (bridge) {
      await bridge();
      return;
    }

    await new Promise((resolve) => {
      const done = () => {
        window.removeEventListener("figboost:update-check-finished", done);
        resolve();
      };
      window.addEventListener("figboost:update-check-finished", done, { once: true });
      window.location.href = `figboost://check-official-update?ts=${Date.now()}`;
      setTimeout(done, 45000);
    });
  }

  function closeFigBoostMenu(wrap) {
    const panel = wrap.querySelector(".figboost-menu-panel");
    const button = wrap.querySelector(".figboost-menu-button");
    if (!panel || !button) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function toggleFigBoostMenu(wrap) {
    const panel = wrap.querySelector(".figboost-menu-panel");
    const button = wrap.querySelector(".figboost-menu-button");
    if (!panel || !button) return;
    const nextHidden = !panel.hidden;
    panel.hidden = nextHidden;
    button.setAttribute("aria-expanded", nextHidden ? "false" : "true");
  }

  function ensureFigBoostMenuDismissHandlers() {
    if (window.__FIGBOOST_MENU_DISMISS_HANDLERS__) return;
    window.__FIGBOOST_MENU_DISMISS_HANDLERS__ = true;
    document.addEventListener("pointerdown", (event) => {
      const current = document.getElementById("figboost-menu");
      if (current && !current.contains(event.target)) closeFigBoostMenu(current);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const current = document.getElementById("figboost-menu");
      if (current) closeFigBoostMenu(current);
    });
  }

  function installUpdateButton() {
    if (!isFigBoostUpdateButtonEnabled() || document.getElementById("figboost-menu")) return;
    if (!document.body || !installFigBoostMenuStyle()) return;

    const host = findTopBarHost();
    if (!host) return;
    const wrap = document.createElement("div");
    wrap.id = "figboost-menu";
    wrap.className = "figboost-menu-wrap";
    wrap.dataset.placement = host.placement;

    const button = document.createElement("button");
    button.id = "figboost-menu-button";
    button.className = "figboost-menu-button";
    button.type = "button";
    button.title = "FigBoost";
    button.setAttribute("aria-label", "FigBoost");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.5" y="3" width="9" height="9.5" rx="1" stroke-width="1.4"/><path d="M6 1.8v2.4M10 1.8v2.4M5.8 6.2h4.4M5.8 8.6h2.7" stroke-width="1.4" stroke-linecap="round"/></svg>';
    let titlebarUpdateBusy = false;
    button.addEventListener("click", async () => {
      if (host.placement === "titlebar") {
        if (titlebarUpdateBusy) return;
        titlebarUpdateBusy = true;
        button.setAttribute("aria-pressed", "true");
        try {
          await FIGBOOST_MENU_ITEMS[0].run();
        } catch (error) {
          window.alert(`${FIGBOOST_MENU_ITEMS[0].label}失败：${error && error.message ? error.message : String(error)}`);
        } finally {
          titlebarUpdateBusy = false;
        }
        return;
      }
      toggleFigBoostMenu(wrap);
    });

    const panel = document.createElement("div");
    panel.className = "figboost-menu-panel";
    panel.hidden = true;
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", "FigBoost");
    for (const item of FIGBOOST_MENU_ITEMS) {
      const menuItem = document.createElement("button");
      menuItem.className = "figboost-menu-item";
      menuItem.dataset.figboostMenuItem = item.id;
      menuItem.type = "button";
      menuItem.textContent = item.label;
      menuItem.title = item.title;
      menuItem.setAttribute("role", "menuitem");
      menuItem.addEventListener("click", async () => {
        if (menuItem.disabled) return;
        const oldText = menuItem.textContent;
        menuItem.disabled = true;
        menuItem.textContent = item.busyLabel;
        closeFigBoostMenu(wrap);
        try {
          await item.run();
        } catch (error) {
          window.alert(`${item.label}失败：${error && error.message ? error.message : String(error)}`);
        } finally {
          menuItem.textContent = oldText;
          menuItem.disabled = false;
        }
      });
      panel.appendChild(menuItem);
    }

    wrap.appendChild(button);
    wrap.appendChild(panel);
    ensureFigBoostMenuDismissHandlers();

    const position = window.getComputedStyle(host.element).position;
    if (position === "static" && host.element !== document.body) host.element.style.position = "relative";
    host.element.appendChild(wrap);
  }

  function scheduleUpdateButtonInstall() {
    if (!isFigBoostUpdateButtonEnabled()) return;

    let observer = null;
    const run = () => {
      installUpdateButton();
      if (document.getElementById("figboost-menu") && observer) {
        observer.disconnect();
        observer = null;
      }
    };
    run();
    if (document.getElementById("figboost-menu")) return;

    document.addEventListener("DOMContentLoaded", run, { once: true });
    observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(run, 1000);
    setTimeout(run, 3000);
  }

  scheduleAntiFlashStyleInstall();
  if (SHOULD_INSTALL_UPDATE_BUTTON) scheduleUpdateButtonInstall();
  if (IS_TITLEBAR_PAGE && !IS_FIGMA_PAGE && !IS_TEST_PAGE) return;

  const extensionApi = typeof chrome === "undefined" ? null : chrome;
  const storage = extensionApi && extensionApi.storage && extensionApi.storage.sync;
  const dictionary = window.FIGMA_ZH_DICTIONARY || { exact: {}, phrases: [], version: "unknown" };
  const core = window.FigmaZhLocalizer;
  if (!core) return;

  const localizer = core.createLocalizer(dictionary, {
    debug: false,
    budgetMs: 24,
    chunkSize: 220,
    floatingTextLimit: 260,
    immediateTextLimit: 120
  });

  window.__figmaZhLocalizer = localizer;
  window.__figmaZhScanUntranslated = (options) => localizer.scanUntranslated(options);

  function applySettings(settings) {
    const next = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    localizer.setOptions({
      debug: Boolean(next.debug),
      fallbackTerms: true
    });
    if (next.enabled) {
      localizer.start(document.body || document.documentElement);
    } else {
      localizer.stop();
    }
  }

  function loadSettings() {
    if (!storage) {
      applySettings(DEFAULT_SETTINGS);
      return;
    }

    storage.get(DEFAULT_SETTINGS, (settings) => {
      if (extensionApi.runtime && extensionApi.runtime.lastError) {
        applySettings(DEFAULT_SETTINGS);
        return;
      }
      applySettings(settings);
    });
  }

  if (storage && extensionApi.storage.onChanged) {
    extensionApi.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      if (!changes.enabled && !changes.debug && !changes.fallbackTerms) return;

      storage.get(DEFAULT_SETTINGS, applySettings);
    });
  }

  if (extensionApi && extensionApi.runtime && extensionApi.runtime.onMessage) {
    extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message) return false;
      if (message.type === "FIGMA_ZH_GET_STATS") {
        sendResponse(localizer.getStats());
        return true;
      }
      if (message.type === "FIGMA_ZH_SCAN_UNTRANSLATED") {
        sendResponse(localizer.scanUntranslated({ limit: message.limit || 200 }));
        return true;
      }
      return false;
    });
  }

  loadSettings();
})();
