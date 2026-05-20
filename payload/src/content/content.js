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
