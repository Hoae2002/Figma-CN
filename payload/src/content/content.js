(function () {
  "use strict";

  const IS_TEST_PAGE = Boolean(window.__FIGMA_ZH_TEST__);
  const IS_FIGMA_PAGE = /(^|\.)figma\.com$/.test(location.hostname);
  if (!IS_TEST_PAGE && !IS_FIGMA_PAGE) return;

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

  function findTopBarHost() {
    const selectors = [
      "[class*='top_bar']",
      "[class*='topbar']",
      "[class*='tab_bar']",
      "[class*='tabbar']",
      "[role='tablist']",
      "header"
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.getBoundingClientRect().height >= 28) return element;
    }
    return null;
  }

  function installUpdateButtonStyle() {
    if (document.getElementById("figboost-update-button-style")) return true;
    if (!document.head) return false;
    const style = document.createElement("style");
    style.id = "figboost-update-button-style";
    style.textContent = [
      ".figboost-update-button{box-sizing:border-box;height:24px;padding:0 10px;border:1px solid rgba(24,119,242,.35);border-radius:4px;background:rgba(255,255,255,.94);color:#185abd;font:12px/22px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.08);}",
      ".figboost-update-button:hover{background:#f7fbff;border-color:rgba(24,119,242,.65);}",
      ".figboost-update-button:disabled{cursor:default;opacity:.68;}",
      ".figboost-update-button-wrap{z-index:2147483000;pointer-events:auto;}",
      ".figboost-update-button-wrap[data-placement='host']{position:absolute;right:104px;top:50%;transform:translateY(-50%);}",
      ".figboost-update-button-wrap[data-placement='fixed']{position:fixed;right:118px;top:8px;}"
    ].join("");
    document.head.appendChild(style);
    return true;
  }

  function installUpdateButton() {
    const bridge = getFigBoostUpdateBridge();
    if (!bridge || document.getElementById("figboost-update-button")) return;
    if (!document.body || !installUpdateButtonStyle()) return;

    const host = findTopBarHost();
    const wrap = document.createElement("div");
    wrap.className = "figboost-update-button-wrap";
    wrap.dataset.placement = host ? "host" : "fixed";
    const button = document.createElement("button");
    button.id = "figboost-update-button";
    button.className = "figboost-update-button";
    button.type = "button";
    button.textContent = "检查更新";
    button.title = "检查 Figma 官方新版";
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = "检查中...";
      try {
        await bridge();
      } catch (error) {
        window.alert(`检查更新失败：${error && error.message ? error.message : String(error)}`);
      } finally {
        button.textContent = oldText;
        button.disabled = false;
      }
    });
    wrap.appendChild(button);

    if (host) {
      const position = window.getComputedStyle(host).position;
      if (position === "static") host.style.position = "relative";
      host.appendChild(wrap);
    } else {
      document.body.appendChild(wrap);
    }
  }

  function scheduleUpdateButtonInstall() {
    const run = () => installUpdateButton();
    run();
    document.addEventListener("DOMContentLoaded", run, { once: true });
    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(run, 1000);
    setTimeout(run, 3000);
  }

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

  scheduleAntiFlashStyleInstall();
  scheduleUpdateButtonInstall();
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
