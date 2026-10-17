const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const test = require("node:test");

// Boot the shipped main script, with no Figma process or external network.
function boot({ enabled = true, response = 1, offline = false, missing = false, current = "126.10.7", contents = [] } = {}) {
  const calls = { requests: [], spawns: [], dialogs: [], timers: [], settings: 0, windows: [], attached: [] };
  const handlers = new Map();
  const config = { enabledFeatures: ["auto-check-official-latest", "bulk-export-figma-files"], patcherPath: "E:/FigBoost/FigBoost.exe", runtimeDir: "C:/FZ" };
  let applicationMenu = null;
  class Menu {
    popup(options) {}
    static buildFromTemplate(template) {
      return Object.assign(new Menu(), { items: template.map(item => {
        const result = { ...item, submenu: Array.isArray(item.submenu) ? Menu.buildFromTemplate(item.submenu) : item.submenu };
        // MenuItem.click has a different signature from template.click.
        if (item.click) result.click = (event, window) => item.click(result, window, event);
        return result;
      }) });
    }
    static getApplicationMenu() { return applicationMenu; }
    static setApplicationMenu(menu) { applicationMenu = menu; }
  }
  class BrowserWindow {
    constructor() { this.webContents = {}; calls.windows.push(this); }
    static getFocusedWindow() { return null; }
    static getAllWindows() { return []; }
    once() {}
    setMenu() {}
    loadURL() {}
    isDestroyed() { return !!this.closed; }
    close() { this.closed = true; }
  }
  const labels = new WeakMap();
  const translationHost = {
    enabled: () => enabled,
    nativeLabel(item, translate) {
      if (!labels.has(item)) labels.set(item, item.label);
      return enabled ? translate(labels.get(item)) : labels.get(item);
    },
    openSettings() { calls.settings++; },
    attach(contents) { calls.attached.push(contents); return Promise.resolve(true); }
  };
  const electron = {
    app: { on() {}, getVersion: () => current, whenReady: () => Promise.resolve() },
    autoUpdater: { checkForUpdates() { throw Error("Built-in updater must not run"); } },
    Menu, BrowserWindow, clipboard: {},
    dialog: { async showMessageBox(options) { calls.dialogs.push(options); return { response }; } },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    webContents: { getAllWebContents: () => contents, getFocusedWebContents: () => contents[0] || null }
  };
  const https = { get(url, options, callback) {
    calls.requests.push(url);
    const request = new EventEmitter();
    request.destroy = () => {};
    queueMicrotask(() => {
      if (offline) { request.emit("error", Error("offline")); return; }
      const result = new EventEmitter();
      result.statusCode = 200; result.setEncoding = () => {};
      callback(result);
      result.emit("data", Buffer.from(url.endsWith(".exe") ? "Figma-126.10.8-full.nupkg" : "Figma 126.10.8"));
      result.emit("end");
    });
    return request;
  } };
  const sourcePath = path.join(__dirname, "../payload/src/main/menu-localizer.js");
  const context = {
    Buffer, URL, Date, AbortController, __dirname: path.dirname(sourcePath),
    global: { __FIGBOOST_TRANSLATION_HOST__: translationHost },
    setTimeout(fn, delay) { calls.timers.push({ fn, delay }); return { unref() {} }; },
    setInterval(fn, delay) { calls.timers.push({ fn, delay }); return { unref() {} }; },
    require(name) {
      if (name === "electron") return electron;
      if (name === "https") return https;
      if (name === "fs") return { readFileSync: () => JSON.stringify(config), existsSync: () => !missing };
      if (name === "child_process") return { spawn(...args) { calls.spawns.push(args); return { unref() {} }; } };
      return require(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), context);
  return { calls, handlers, config, electron, global: context.global };
}

test("native update entry is visible and routed through FigBoost in both language modes", async () => {
  for (const enabled of [true, false]) {
    for (const originalLabel of ["Check for Updates...", "Check for Updates…"]) {
      const state = boot({ enabled });
      let originalCalls = 0;
      const menu = state.electron.Menu.buildFromTemplate([{ label: "Help", submenu: [
        { id: "checkForUpdates", label: originalLabel, visible: false, enabled: false, click() { originalCalls++; } },
        { label: "Save Local Copy…", click() { originalCalls++; } },
        { id: "recent-file", label: "Check for Updates…", click() { originalCalls++; } }
      ] }]);
      const entry = menu.items[0].submenu.items[0];
      assert.equal(entry.label, enabled ? "检查更新" : originalLabel);
      assert.equal(entry.visible, true); assert.equal(entry.enabled, true);
      // Reopening a menu must neither check online nor replace unrelated actions.
      menu.popup({}); menu.popup({});
      assert.equal(state.calls.requests.length, 0);
      const result = await entry.click();
      assert.equal(result.declined, true);
      assert.equal(originalCalls, 0);
      assert.equal(state.calls.requests.length, 2);
      assert.equal(state.calls.spawns.length, 0);
      assert.ok(state.calls.windows.every(window => window.closed));
      menu.items[0].submenu.items[1].click();
      assert.equal(originalCalls, 1);
      menu.items[0].submenu.items[2].click();
      assert.equal(originalCalls, 2, "a same-named file must keep its original click handler");
    }
  }
});

test("manual updates work without feature installation and reapply localization only after confirmation", async () => {
  const state = boot({ response: 0 }); state.config.enabledFeatures = [];
  const result = await state.global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__();
  assert.equal(result.updateStarted, true);
  const [exe, args, options] = state.calls.spawns[0];
  assert.equal(exe, state.config.patcherPath);
  assert.deepEqual(Array.from(args), ["-UpdateFigma", "-ShowProgress", "-RuntimeDir", state.config.runtimeDir, "-ForceClose"]);
  assert.equal(options.detached, true);
  assert.match(state.calls.dialogs[0].detail, /自动安装汉化补丁/);
});

test("offline, missing patcher, current version and repeated clicks cannot launch an update", async () => {
  for (const options of [{ offline: true }, { missing: true }, { current: "126.10.8" }]) {
    const state = boot(options);
    const first = state.global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__();
    assert.equal((await state.global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__()).checking, true);
    await first;
    assert.equal(state.calls.spawns.length, 0);
    assert.equal(state.global.__FIGMA_ZH_OFFICIAL_UPDATE_CHECKING__, false);
    assert.ok(state.calls.windows.every(window => window.closed));
    assert.equal((await state.global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__()).skipped, true);
  }
});

test("legacy feature flags cannot register exports or start background discovery/update work", async () => {
  const state = boot();
  await Promise.resolve();
  // Run all boot-time callbacks once, including the existing native menu refresh.
  for (const timer of [...state.calls.timers]) timer.fn();
  assert.equal(state.global.__FIGBOOST_FEATURE_ENABLED__("bulk-export-figma-files"), false);
  assert.equal(state.global.__FIGBOOST_FEATURE_ENABLED__("auto-check-official-latest"), false);
  assert.equal(state.handlers.has("figboost:bulk-export-files"), false);
  assert.equal(state.global.__FIGBOOST_BULK_EXPORT_FILES__, undefined);
  assert.equal(state.global.__FIGMA_ZH_AUTO_UPDATER_GUARD__, undefined);
  assert.equal(state.calls.requests.length, 0);
  assert.equal(state.calls.windows.length, 0);
  assert.equal(state.handlers.has("figboost:open-feature-menu"), false);
  assert.equal(state.global.__FIGBOOST_OPEN_FEATURE_MENU__, undefined);
  assert.equal(state.calls.settings, 0);
});

test("native titlebar gets no renderer payload and stale settings routes cannot open a window", async () => {
  function makeContents(url) {
    const contents = new EventEmitter();
    contents.scripts = [];
    contents.getURL = () => url;
    contents.executeJavaScript = code => { contents.scripts.push(code); return Promise.resolve(); };
    contents.setWindowOpenHandler = handler => { contents.openWindow = handler; };
    return contents;
  }
  const titlebar = makeContents("file:///Figma/titlebar.html");
  const page = makeContents("https://www.figma.com/design/test");
  const state = boot({ contents: [titlebar, page] });
  for (const timer of [...state.calls.timers]) timer.fn();
  await Promise.resolve();
  assert.equal(titlebar.scripts.length, 0);
  assert.ok(state.calls.attached.includes(page), "Figma content must still receive localization");
  for (const url of ["figboost://translation-settings", "figboost://open-feature-menu"]) {
    let prevented = false;
    titlebar.emit("will-navigate", { preventDefault() { prevented = true; } }, url);
    assert.equal(prevented, true);
    assert.equal(titlebar.openWindow({ url }).action, "deny");
  }
  assert.equal(state.calls.settings, 0);
  assert.equal(state.calls.windows.length, 0);
  assert.equal(state.calls.requests.length, 0);
});

function quickExportFixture() {
  const contents = new EventEmitter();
  let url = "https://www.figma.com/design/test", allowed = true, exported = 0, prevented = 0;
  contents.getURL = () => url;
  contents.isDestroyed = () => false;
  contents.executeJavaScriptInIsolatedWorld = () => Promise.resolve(allowed);
  const state = boot({ contents: [contents] });
  const owner = {};
  state.electron.BrowserWindow.getFocusedWindow = () => owner;
  const menu = state.electron.Menu.buildFromTemplate([{ label: "File", submenu: [{
    label: "Export…", action: "export-selected-exportables", accelerator: "CmdOrCtrl+Shift+E",
    click(item, window, event) {
      assert.equal(item.action, "export-selected-exportables");
      assert.equal(window, owner);
      assert.equal(event.triggeredByAccelerator, true);
      exported++;
    }
  }] }]);
  state.electron.Menu.setApplicationMenu(menu);
  return {
    state, contents, item: menu.items[0].submenu.items[0],
    navigate(value) { url = value; }, allow(value) { allowed = value; },
    press(input = {}) {
      contents.emit("before-input-event", { preventDefault() { prevented++; } }, {
        type: "keyDown", control: true, shift: true, code: "KeyS", key: "S", ...input
      });
    },
    exported: () => exported, prevented: () => prevented
  };
}

test("desktop quick export calls the existing native command once and preserves its accelerator", async () => {
  const f = quickExportFixture();
  f.press(); f.press(); f.press({ isAutoRepeat: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.exported(), 1, "overlapping events must not double-export");
  assert.equal(f.prevented(), 3);
  assert.equal(f.item.accelerator, "CmdOrCtrl+Shift+E");
  f.press({ code: "KeyE", key: "E" });
  assert.equal(f.prevented(), 3, "the original native shortcut remains untouched");
  f.navigate("https://www.figma.com/file/legacy"); f.press();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.exported(), 2);
});

test("desktop export ignores other routes, disabled commands, IME and other combinations", async () => {
  const f = quickExportFixture();
  for (const url of ["https://www.figma.com/files/test", "https://www.figma.com/proto/test", "https://figma.com.evil.test/design/test", "file:///Figma/titlebar.html"]) {
    f.navigate(url); f.press();
  }
  f.navigate("https://www.figma.com/design/test");
  for (const input of [{ type: "keyUp" }, { control: false }, { shift: false }, { alt: true }, { meta: true }, { isComposing: true }, { code: "KeyA", key: "S" }]) f.press(input);
  f.item.enabled = false; f.press();
  f.state.electron.Menu.setApplicationMenu(null); f.press();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.exported(), 0); assert.equal(f.prevented(), 0);
});

test("desktop export protects editing and cannot export a different tab after its async focus check", async () => {
  const f = quickExportFixture();
  f.allow(false); f.press();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.exported(), 0);
  f.allow(true); f.press(); f.navigate("https://www.figma.com/design/other");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.exported(), 0);
  f.press(); f.state.electron.webContents.getFocusedWebContents = () => null;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.exported(), 0);
});
