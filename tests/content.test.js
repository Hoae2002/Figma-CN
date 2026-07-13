const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadContent(overrides = {}) {
  const sourcePath = path.join(__dirname, "..", "payload", "src", "content", "content.js");
  const marker = "  scheduleAntiFlashStyleInstall();";
  const source = fs.readFileSync(sourcePath, "utf8").replace(marker, `
  window.__FIGBOOST_TEST_HOOKS__ = {
    findTopBarHost,
    getFigBoostMenuBounds,
    getFigBoostUpdateBridge,
    getFigBoostFeatureMenuBridge,
    getFigBoostBulkExportBridge,
    isFigBoostUpdateButtonEnabled,
    openFigBoostFeatureMenuFromTitlebar,
    toggleFigBoostMenu,
    getCurrentHref: () => window.location.href
  };
  return;
${marker}`);
  const window = {
    __FIGMA_ZH_TEST__: true,
    innerWidth: 1000,
    location: { href: "" },
    ...overrides.window
  };
  const document = {
    body: {},
    querySelector: () => null,
    ...overrides.document
  };
  const context = {
    document,
    location: { hostname: "www.figma.com" },
    setTimeout,
    URLSearchParams,
    window
  };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return window.__FIGBOOST_TEST_HOOKS__;
}

test("bridge discovery only returns callable renderer bridges", () => {
  const update = () => {};
  const bulk = () => {};
  const hooks = loadContent({ window: {
    __FIGBOOST_CHECK_OFFICIAL_UPDATE__: update,
    __FIGBOOST_OPEN_FEATURE_MENU__: "not callable",
    __FIGBOOST_BULK_EXPORT_FILES__: bulk
  } });

  assert.equal(hooks.getFigBoostUpdateBridge(), update);
  assert.equal(hooks.getFigBoostFeatureMenuBridge(), null);
  assert.equal(hooks.getFigBoostBulkExportBridge(), bulk);
  assert.equal(hooks.isFigBoostUpdateButtonEnabled(), true);
});

test("tab host selection rejects undersized candidates", () => {
  const small = { getBoundingClientRect: () => ({ height: 20 }) };
  const tab = { getBoundingClientRect: () => ({ height: 32 }) };
  const hooks = loadContent({ document: {
    querySelector: (selector) => selector === "[class*='tab_bar']" ? small : tab
  } });

  const result = hooks.findTopBarHost();
  assert.equal(result.element, tab);
  assert.equal(result.placement, "tab");
});

test("menu bounds and fallback URL use rounded button geometry", () => {
  const hooks = loadContent();
  const bounds = hooks.getFigBoostMenuBounds({
    getBoundingClientRect: () => ({ left: 10.4, top: 3.6, right: 60.4, bottom: 41.7, width: 50, height: 38.1 })
  });

  assert.equal(JSON.stringify(bounds), JSON.stringify({ left: 10, top: 4, right: 60, bottom: 42, width: 50, height: 38 }));
  hooks.openFigBoostFeatureMenuFromTitlebar(bounds);
  assert.equal(hooks.getCurrentHref(), "figboost://open-feature-menu?left=10&top=4&right=60&bottom=42&width=50&height=38");
});

test("DOM menu toggling positions titlebar panels inside the viewport", () => {
  const hooks = loadContent();
  const panel = { hidden: true, style: {} };
  const attributes = {};
  const button = {
    getBoundingClientRect: () => ({ bottom: 40.2, right: 995.2 }),
    setAttribute: (name, value) => { attributes[name] = value; }
  };
  const wrap = {
    dataset: { placement: "titlebar" },
    querySelector: (selector) => selector.includes("panel") ? panel : button
  };

  hooks.toggleFigBoostMenu(wrap);
  assert.equal(panel.hidden, false);
  assert.equal(panel.style.top, "46px");
  assert.equal(panel.style.right, "8px");
  assert.equal(attributes["aria-expanded"], "true");
});
