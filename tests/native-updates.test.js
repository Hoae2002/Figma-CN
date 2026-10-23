const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const test = require("node:test");

// Boot the shipped main script, with no Figma process or external network.
function boot({ takeover = false, enabled = true, response = 1, offline = false, missing = false, current = "126.10.7", contents = [] } = {}) {
  const calls = { requests: [], spawns: [], dialogs: [], timers: [], settings: 0, windows: [], attached: [] };
  const handlers = new Map();
  const config = { enabledFeatures: ["auto-check-official-latest", "bulk-export-figma-files"], patcherPath: "E:/FigBoost/FigBoost.exe", runtimeDir: "C:/FZ" };
  let applicationMenu = null;
  class MenuItem {
    constructor(options) {
      Object.assign(this, options);
      if (options.click) this.click = (event, window) => options.click(this, window, event);
    }
  }
  class Menu {
    popup(options) {}
    append(item) { this.items.push(item); }
    insert(index, item) { this.items.splice(index, 0, item); }
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
    Menu, MenuItem, BrowserWindow, clipboard: {},
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
  const source = fs.readFileSync(sourcePath, "utf8");
  vm.runInNewContext(takeover ? source.replace("const OFFICIAL_UPDATE_TAKEOVER_ENABLED = false;", "const OFFICIAL_UPDATE_TAKEOVER_ENABLED = true;") : source, context);
  return { calls, handlers, config, electron, global: context.global };
}

test("paused takeover preserves native updater actions and never registers update IPC", async () => {
  for (const enabled of [true, false]) {
    const state = boot({ enabled });
    const updater = state.electron.autoUpdater.checkForUpdates;
    let originalCalls = 0;
    const menu = state.electron.Menu.buildFromTemplate([{ label: "Help", submenu: [
      { id: "checkForUpdates", label: "Check for Updates…", visible: false, enabled: false, click() { originalCalls++; } }
    ] }]);
    const entry = menu.items[0].submenu.items[0];
    menu.popup({}); menu.popup({});
    entry.click();
    assert.equal(originalCalls, 1);
    assert.equal(entry.visible, false);
    assert.equal(entry.enabled, false);
    assert.equal(entry.label, enabled ? "检查更新" : "Check for Updates…");
    const missing = state.electron.Menu.buildFromTemplate([
      { label: "Preferences", submenu: [] }, { label: "Help", submenu: [] },
      { label: "About Figma" }, { label: "Exit", role: "quit" }
    ]);
    missing.popup({});
    assert.equal(missing.items.length, 4);
    for (const timer of [...state.calls.timers]) timer.fn();
    assert.equal(state.electron.autoUpdater.checkForUpdates, updater);
    assert.equal(state.global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__, undefined);
    assert.equal(state.handlers.has("figboost:check-official-update"), false);
    assert.equal(state.calls.requests.length, 0);
    assert.equal(state.calls.spawns.length, 0);
  }
});

test("native update entry is visible and routed through FigBoost when explicitly enabled", async () => {
  for (const enabled of [true, false]) {
    for (const originalLabel of ["Check for Updates...", "Check for Updates…"]) {
      const state = boot({ enabled, takeover: true });
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

test("older native app menus restore missing or ID-less update commands without duplicates", async () => {
  for (const enabled of [true, false]) {
    for (const missing of [true, false]) {
      const state = boot({ enabled, takeover: true, current: "126.6.9" });
      let unrelatedCalls = 0;
      const menu = state.electron.Menu.buildFromTemplate([
        { label: "Preferences", submenu: [] }, { label: "Help", submenu: [] },
        { label: "About Figma" },
        ...(!missing ? [{ label: "Check for Updates…", visible: false, enabled: false }] : []),
        { type: "separator" }, { label: "Exit", role: "quit" },
        { id: "recent-file", label: "Check for Updates…", click() { unrelatedCalls++; } }
      ]);
      menu.popup({}); menu.popup({});
      const entries = menu.items.filter(item => item.click === state.global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__);
      assert.equal(entries.length, 1);
      assert.equal(menu.items.indexOf(entries[0]), 3);
      assert.equal(entries[0].visible, true);
      assert.equal(entries[0].enabled, true);
      assert.equal(entries[0].label, enabled ? "检查更新" : "Check for Updates…");
      assert.equal(state.calls.requests.length, 0);
      assert.equal((await entries[0].click()).declined, true);
      menu.items.find(item => item.id === "recent-file").click();
      assert.equal(unrelatedCalls, 1);
    }
  }
  const state = boot();
  const fileMenu = state.electron.Menu.buildFromTemplate([{ label: "About Figma" }, { label: "Exit" }]);
  fileMenu.popup({});
  assert.equal(fileMenu.items.length, 2, "file names alone must not identify the native app menu");
});

test("manual updates work without feature installation and reapply localization only after confirmation", async () => {
  const state = boot({ response: 0, takeover: true }); state.config.enabledFeatures = [];
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
    const state = boot({ ...options, takeover: true });
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

test("native shell gets only scoped update text and stale settings routes cannot open a window", async () => {
  function makeContents(url) {
    const contents = new EventEmitter();
    contents.scripts = [];
    contents.getURL = () => url;
    contents.executeJavaScript = code => { contents.scripts.push(code); return Promise.resolve(); };
    contents.executeJavaScriptInIsolatedWorld = (world, scripts) => { contents.scripts.push(...scripts.map(item => item.code)); assert.equal(world, 1005); return Promise.resolve(); };
    contents.setWindowOpenHandler = handler => { contents.openWindow = handler; };
    return contents;
  }
  const titlebar = makeContents("file:///Figma/titlebar.html");
  const shell = makeContents("file:///Figma/resources/app.asar/shell.html");
  const page = makeContents("https://www.figma.com/design/test");
  const state = boot({ contents: [titlebar, shell, page] });
  for (const timer of [...state.calls.timers]) timer.fn();
  await Promise.resolve();
  assert.equal(titlebar.scripts.length, 0);
  assert.ok(shell.scripts.length > 0);
  assert.ok(shell.scripts.every(code => code.includes('tab_bar--updateButtonWrapper--') && !code.includes('__FIGBOOST_TRANSLATION_RUNTIME__')));
  assert.ok(!state.calls.attached.includes(shell));
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

function quickExportFixture(contents) {
  let exported = 0, dispatched = 0;
  if (!contents) {
    const page = new EventEmitter();
    page.getURL = () => "https://www.figma.com/design/test";
    contents = [page];
  }
  for (const page of contents) page.executeJavaScriptInIsolatedWorld = (world, scripts, userGesture) => {
    assert.equal(world, 1004);
    assert.equal(scripts[0].code, "window.__figboostQuickExport?.()");
    assert.equal(userGesture, true);
    dispatched++;
    return Promise.resolve(true);
  };
  const state = boot({ contents });
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
    state, menu, item: menu.items[0].submenu.items[0], alias: menu.items[0].submenu.items[1],
    press(window = owner) { this.alias.click({ triggeredByAccelerator: true }, window); },
    exported: () => exported, dispatched: () => dispatched
  };
}

test("desktop quick export registers Ctrl+Shift+Alt+S and preserves the original native command", () => {
  const f = quickExportFixture();
  assert.equal(f.alias.accelerator, "Control+Shift+Alt+S");
  assert.equal(f.alias.visible, false);
  assert.equal(f.alias.action, undefined, "Figma must continue updating the original action's enabled state");
  assert.equal(f.item.accelerator, "CmdOrCtrl+Shift+E");
  f.press();
  assert.equal(f.dispatched(), 1);
  assert.equal(f.exported(), 0, "the export-list menu command must not run");
});

test("desktop export uses sidebar availability independently from the export-list command", () => {
  const f = quickExportFixture();
  f.item.enabled = false; f.press();
  f.item.enabled = true; f.press(null);
  assert.equal(f.dispatched(), 1, "renderer guards determine whether the sidebar action is available");
  f.press();
  assert.equal(f.dispatched(), 2, "missing native owner must not dispatch");
  assert.equal(f.exported(), 0);
});

test("native menu refreshes cannot duplicate the alias and unrelated menus stay unchanged", () => {
  const f = quickExportFixture();
  for (const timer of [...f.state.calls.timers]) timer.fn();
  assert.equal(f.menu.items[0].submenu.items.filter(item => item.id === "figboost-quick-export").length, 1);
  const plainMenu = f.state.electron.Menu.buildFromTemplate([{ label: "Export user file" }]);
  assert.equal(plainMenu.items.length, 1, "labels alone must not create an export capability");
});

test("forwarded editor input requires all three modifiers and ignores other routes and repeats", () => {
  const contents = new EventEmitter();
  let url = "https://www.figma.com/design/test", prevented = 0;
  contents.getURL = () => url;
  const f = quickExportFixture([contents]);
  const press = (input = {}) => contents.emit("before-input-event", { preventDefault() { prevented++; } }, {
    type: "keyDown", control: true, shift: true, alt: true, code: "KeyS", key: "S", ...input
  });
  for (const input of [{ control: false }, { shift: false }, { alt: false }, { meta: true }, { isComposing: true }, { type: "keyUp" }, { code: "KeyA", key: "S" }]) press(input);
  for (const otherURL of ["https://www.figma.com/files/test", "https://www.figma.com/proto/test", "https://figma.com.evil.test/design/test", "file:///Figma/titlebar.html"]) {
    url = otherURL; press();
  }
  assert.equal(prevented, 0); assert.equal(f.dispatched(), 0);
  url = "https://www.figma.com/design/test";
  press(); press({ isAutoRepeat: true });
  assert.equal(prevented, 2); assert.equal(f.dispatched(), 1);
  assert.equal(f.exported(), 0);
});
