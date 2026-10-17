"use strict";
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "figboost-electron-"));
app.setPath("userData", path.join(temp, "user-data")); process.env.LOCALAPPDATA = temp;
app.disableHardwareAcceleration();
const root = path.join(__dirname, "../payload/src"), runtime = path.join(temp, "runtime"); fs.mkdirSync(runtime);
for (const file of ["dictionary/zh-CN.js", "shared/translation-policy.js", "main/translation-service.js", "main/translation-host.js", "main/translation-settings-preload.js", "main/translation-settings.html", "main/translation-settings.css", "main/translation-settings.js"]) fs.copyFileSync(path.join(root, file), path.join(runtime, path.basename(file)));
const payload = require("node:child_process").execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "build-renderer-fixture.ps1")], { encoding: "utf8", windowsHide: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 40; i++) { if (await fn()) return; await wait(100); } throw Error("Regression condition timed out"); }
let host;
app.whenReady().then(async () => {
  // Figma restricts file:// in its default session to its own bundled pages.
  // Reproduce the real host's 404 without launching or modifying Figma.
  await session.defaultSession.protocol.handle("file", () => new Response("Not found", { status: 404 }));
  const calls = []; let releaseNew;
  const slowNew = new Promise(resolve => { releaseNew = resolve; });
  const { createHost, isFigmaURL } = require(path.join(runtime, "translation-host.js"));
  assert.equal(isFigmaURL("https://figma.com.evil.test"), false);
  assert.equal(isFigmaURL("https://www.figma.com/design/test"), true);
  host = createHost({ showSettings: false, transport: async texts => { calls.push(texts); if (texts[0] === "Gizmo frobnication") await slowNew; return texts.map(text => text === "Save" ? "保存" : "新控件"); } });
  const isolatedSession = session.fromPartition("figboost-test");
  await isolatedSession.protocol.handle("https", () => new Response('<!doctype html><html><body><div role="toolbar"><button id="save">Save</button><button id="new" data-testid="novel-action">Gizmo frobnication</button><input value="Default"></div></body></html>', { headers: { "content-type": "text/html" } }));
  const page = new BrowserWindow({ show: false, webPreferences: { session: isolatedSession, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await page.loadURL("https://www.figma.com/community");
  assert.equal(await host.attach(page.webContents, payload), true);
  assert.equal(await page.webContents.executeJavaScript("typeof window.__FIGBOOST_TRANSLATION_RUNTIME__"), "undefined");
  await until(async () => (await page.webContents.executeJavaScript("document.querySelector('#save').textContent")) === "保存");
  // A slow sibling must not delay an already-completed label in the same drain batch.
  assert.equal(await page.webContents.executeJavaScript("document.querySelector('#new').textContent"), "Gizmo frobnication");
  releaseNew();
  host.openSettings();
  const settings = BrowserWindow.getAllWindows().find(w => w !== page);
  assert.notEqual(settings.webContents.session, session.defaultSession);
  settings.webContents.on("console-message", (_event, details) => { if (details.level === "error") console.error("Settings console:", details.message); });
  try { await until(() => settings.webContents.executeJavaScript("document.querySelector('#message')?.textContent === '设置已加载'").catch(() => false)); }
  catch (e) { console.error("Settings state:", settings.webContents.getURL(), await settings.webContents.executeJavaScript("({message:document.querySelector('#message')?.textContent, bridge:typeof window.figBoostSettings})")); throw e; }
  assert.equal(await settings.webContents.executeJavaScript("document.styleSheets.length > 0 && getComputedStyle(document.documentElement).backgroundColor === 'rgb(32, 32, 32)'"), true);
  const blocked = await session.defaultSession.fetch(require("node:url").pathToFileURL(path.join(runtime, "translation-settings.html")).href);
  assert.equal(blocked.status, 404);
  assert.equal(await blocked.text(), "Not found");
  async function command(action, data) { const result = await settings.webContents.executeJavaScript(`window.figBoostSettings.invoke(${JSON.stringify(action)},${JSON.stringify(data || {})})`); assert.equal(result.ok, true, result.error); return result; }
  await until(async () => (await page.webContents.executeJavaScript("document.querySelector('#new').textContent")) === "新控件");
  assert.equal(calls.length, 1);
  assert.equal(await page.webContents.executeJavaScript("document.querySelector('input').value"), "Default");
  const snap = (await command("snapshot")).state;
  assert.equal(snap.pages.connected, 1);
  assert.equal(snap.credential, undefined); assert.equal(Object.keys(snap.learned).length, 1);
  assert.equal(await settings.webContents.executeJavaScript("document.querySelector('input[type=password]') === null"), true);
  await settings.webContents.executeJavaScript("document.querySelector('#community-online').click()");
  await until(async () => (await page.webContents.executeJavaScript("document.querySelector('#new').textContent")) === "Gizmo frobnication");
  assert.equal(await page.webContents.executeJavaScript("document.querySelector('#save').textContent"), "保存");
  await settings.webContents.executeJavaScript("document.querySelector('#community-online').click()");
  await until(async () => (await page.webContents.executeJavaScript("document.querySelector('#new').textContent")) === "新控件");
  assert.equal(calls.length, 1);
  await settings.webContents.executeJavaScript("document.querySelector('#enabled').click()");
  await until(async () => (await page.webContents.executeJavaScript("document.querySelector('#save').textContent")) === "Save");
  await settings.webContents.executeJavaScript("document.querySelector('#enabled').click()");
  await until(async () => (await page.webContents.executeJavaScript("document.querySelector('#save').textContent")) === "保存");
  assert.equal(calls.length, 1);
  assert.equal(await settings.webContents.executeJavaScript("document.querySelector('#exclude-form') === null && document.querySelector('#rules') === null"), true);
  assert.equal((await settings.webContents.executeJavaScript("window.figBoostSettings.invoke('exclude',{scope:'region',region:'community'})")).ok, false);
  // Other windows cannot invoke the settings capability, even with the same preload.
  const outsider = new BrowserWindow({ show: false, webPreferences: { preload: path.join(runtime, "translation-settings-preload.js"), sandbox: true, contextIsolation: true } });
  await outsider.loadURL("data:text/html,<html><body>untrusted</body></html>");
  const rejected = await outsider.webContents.executeJavaScript("window.figBoostSettings.invoke('snapshot')"); assert.equal(rejected.ok, false);
  const item = { label: "Save" };
  assert.equal(host.nativeLabel(item, value => value, true), "保存");
  item.label = host.nativeLabel(item, value => value, true);
  assert.equal(item.label, "保存"); assert.equal(host.originalLabel(item), "Save");
  await command("settings", { enabled: false });
  assert.equal(host.nativeLabel(item, () => "builtin", true), "Save");
  for (const width of [600, 760, 1440, 1920]) { settings.setContentSize(width, 850); assert.equal(await settings.webContents.executeJavaScript("document.documentElement.scrollWidth <= innerWidth"), true); }
  assert.ok(fs.existsSync(path.join(temp, "FigBoost/translation/cache.json")));
  // Reproduce a failed first injection, then verify automatic recovery with the
  // installer's actual wrapper instead of a raw concatenation of source files.
  const retryPage = new BrowserWindow({ show: false, webPreferences: { session: isolatedSession, nodeIntegration: true, contextIsolation: true, sandbox: false } });
  await retryPage.loadURL("https://www.figma.com/design/retry");
  const execute = retryPage.webContents.executeJavaScriptInIsolatedWorld.bind(retryPage.webContents);
  let failOnce = true;
  retryPage.webContents.executeJavaScriptInIsolatedWorld = (...args) => {
    if (failOnce) { failOnce = false; return Promise.reject(new Error("Page not ready")); }
    return execute(...args);
  };
  assert.equal(await host.attach(retryPage.webContents, payload), false);
  assert.equal((await command("snapshot")).state.pages.pending, 1);
  await wait(5200);
  await until(async () => (await command("snapshot")).state.pages.connected === 2);
  await command("settings", { enabled: true });
  await until(async () => (await retryPage.webContents.executeJavaScript("document.querySelector('#save').textContent")) === "保存");
  assert.equal((await command("snapshot")).state.pages.pending, 0);
  const editor = code => retryPage.webContents.executeJavaScriptInIsolatedWorld(1004, [{ code }]);
  // Exercise the real Chromium DOM/observer/RAF path with the complete embedded
  // dictionary. These are synthetic documents; no real Figma client is opened.
  await editor(`(() => {
    const sidebar = document.createElement('section');
    sidebar.setAttribute('aria-label', 'Left sidebar');
    sidebar.innerHTML = '<button>Pages</button><div role="grid"><span title="Page 29">Page 29</span><span>Design</span></div>';
    document.body.append(sidebar);
    const panel = document.createElement('section'); panel.id = 'stress-panel';
    panel.setAttribute('aria-label', 'Right sidebar');
    panel.innerHTML = '<button>Save</button>'.repeat(600);
    document.body.append(panel);
  })()`);
  try { await until(() => editor(`document.querySelector('#stress-panel').textContent === '保存'.repeat(600) && window.__figmaZhLocalizer.getStats().queueSize === 0`)); }
  catch (error) {
    console.error('Chromium stress state:', await editor(`({ hidden: document.hidden, translated: document.querySelector('#stress-panel').textContent.split('保存').length - 1, stats: window.__figmaZhLocalizer.getStats() })`));
    throw error;
  }
  assert.equal(await editor(`document.querySelector('[role=grid]').textContent`), "Page 29Design");
  assert.equal(await editor(`document.querySelector('[role=grid] [title]').title`), "Page 29");
  const beforeAttributes = await editor(`window.__figmaZhLocalizer.getStats().processedNodes`);
  await editor(`document.querySelector('#stress-panel').title = 'Position'`);
  await until(() => editor(`document.querySelector('#stress-panel').title === '位置'`));
  assert.equal(await editor(`window.__figmaZhLocalizer.getStats().processedNodes`), beforeAttributes);
  await editor(`(() => {
    window.__stressWrites = [];
    const observer = new MutationObserver(records => window.__stressWrites.push(...records));
    observer.observe(document.querySelector('#stress-panel'), { subtree: true, characterData: true });
  })()`);
  const currentSnapshot = (await command('snapshot')).state;
  await editor(`window.__FIGBOOST_TRANSLATION_RUNTIME__.apply(${JSON.stringify(currentSnapshot)}, true)`);
  await until(() => editor(`window.__figmaZhLocalizer.getStats().queueSize === 0`));
  assert.equal(await editor(`window.__stressWrites.length`), 0);
  // Recycled text nodes must regain their translation without restoring siblings.
  await editor(`document.querySelector('#stress-panel button').firstChild.nodeValue = 'Save'`);
  await until(() => editor(`document.querySelector('#stress-panel button').textContent === '保存'`));
  // Sample after the observer microtask, before a renderer can paint the next
  // task. The recording shows ordinary nested property labels, not buttons.
  const redraw = await editor(`(async () => {
    const mirror = document.createElement('div'); mirror.id = 'hidden-input-activedescendant'; document.body.append(mirror);
    const panel = document.createElement('section'); panel.id = 'redraw-panel';
    panel.setAttribute('aria-label', 'Right sidebar'); document.body.append(panel);
    const labels = ['Content', 'Position', 'Alignment', 'Constraints', 'Rotation', 'Layout', 'Resizing', 'Appearance', 'Opacity', 'Corner radius', 'Blend mode', 'Typography', 'Line height', 'Letter spacing'].flatMap(text => [text, text]);
    const expected = ${JSON.stringify(['Content', 'Position', 'Alignment', 'Constraints', 'Rotation', 'Layout', 'Resizing', 'Appearance', 'Opacity', 'Corner radius', 'Blend mode', 'Typography', 'Line height', 'Letter spacing'].flatMap(text => [require('../payload/src/dictionary/zh-CN.js').exact[text], require('../payload/src/dictionary/zh-CN.js').exact[text]]))};
    const failures = [];
    for (let round = 0; round < 12; round++) {
      mirror.innerHTML = '<div><dl><dt>Variants</dt><dt>Dimensions</dt></dl></div>'.repeat(300);
      panel.innerHTML = '<input value="Private value" title="Save">'.repeat(60) + labels.map(text => '<div><div><div><div><div><div><span>' + text + '</span><svg><path></path></svg><input value="24" aria-label="Width"><div><div><span>24</span></div></div></div></div></div></div></div></div>').join('');
      await Promise.resolve(); await Promise.resolve();
      const actual = [...panel.querySelectorAll('span')].filter(element => element.textContent !== '24').map(element => element.textContent);
      if (actual.some((text, index) => text !== expected[index])) failures.push({ round, actual });
      if (mirror.textContent !== 'VariantsDimensions'.repeat(300)) failures.push({ round, mirror: 'changed' });
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return failures;
  })()`);
  assert.deepEqual(redraw, [], 'property labels must stay localized at every redraw, before paint');
  const fileRedraw = await editor(`(async () => {
    history.replaceState({}, '', '/files/team/test/recents-and-sharing/recently-viewed');
    document.body.replaceChildren(document.createElement('main'));
    const main = document.querySelector('main');
    const originalStyle = window.getComputedStyle;
    const originalRect = Element.prototype.getBoundingClientRect;
    let measurements = 0;
    window.getComputedStyle = (...args) => { measurements++; return originalStyle(...args); };
    Element.prototype.getBoundingClientRect = function(...args) { measurements++; return originalRect.apply(this, args); };
    const failures = [];
    try {
      for (let round = 0; round < 12; round++) {
        const list = round % 2 === 0;
        main.innerHTML = list ? '<table><tbody>' + Array.from({length: 45}, () =>
          '<tr><td><button data-card-main-action aria-label="Untitled, Design file"></button></td><td><span class="generic_tile_title_contents--itemsViewTitle--test">Untitled</span></td><td><span data-time>2 months ago</span></td><td><span data-time>1 year ago</span></td></tr>').join('') + '</tbody></table>' :
          '<div role="list">' + Array.from({length: 45}, () => '<div role="group" aria-label="Untitled"><h2>Untitled</h2><i18n-text data-time>Edited <span>2 months ago</span></i18n-text></div>').join('') + '</div>';
        await Promise.resolve(); await Promise.resolve();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const labels = [...main.querySelectorAll('[data-time]')].slice(0, list ? 36 : 18);
        if (labels.some(e => /[A-Za-z]/.test(e.textContent))) failures.push({round, text: labels.map(e => e.textContent)});
        if ([...main.querySelectorAll('h2,[class*="itemsViewTitle"]')].some(e => e.textContent !== 'Untitled')) failures.push({round, names: 'changed'});
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    } finally { window.getComputedStyle = originalStyle; Element.prototype.getBoundingClientRect = originalRect; }
    return {failures, measurements};
  })()`);
  assert.deepEqual(fileRedraw.failures, [], 'visible grid/list times must be localized before paint');
  assert.equal(fileRedraw.measurements, 0, 'file metadata must not trigger tooltip layout measurements');
  await until(() => editor(`window.__figmaZhLocalizer.getStats().queueSize === 0`));
  const idleProcessed = await editor(`window.__figmaZhLocalizer.getStats().processedNodes`);
  await wait(350);
  assert.equal(await editor(`window.__figmaZhLocalizer.getStats().processedNodes`), idleProcessed, 'idle localization must not keep scanning');
  // Exercise the actual Electron MenuItem implementation: the installed Figma
  // updater guard hides this native entry, so restoring visibility is required.
  global.__FIGMA_ZH_RUNTIME_DIR__ = runtime;
  global.__FIGBOOST_TRANSLATION_HOST__ = host;
  require(path.join(root, 'main/menu-localizer.js'));
  const { Menu } = require('electron');
  let originalUpdates = 0;
  const nativeMenu = Menu.buildFromTemplate([{ label: 'Help', submenu: [
    { id: 'checkForUpdates', label: 'Check for Updates…', visible: false, enabled: false, click() { originalUpdates++; } },
    { label: 'Save Local Copy…' }
  ] }]);
  const updateEntry = nativeMenu.items[0].submenu.items[0];
  assert.equal(updateEntry.visible, true);
  assert.equal(updateEntry.enabled, true);
  assert.equal(updateEntry.label, '检查更新');
  assert.equal(updateEntry.click, global.__FIGBOOST_CHECK_OFFICIAL_UPDATE__);
  assert.equal(originalUpdates, 0);
  assert.equal(global.__FIGBOOST_BULK_EXPORT_FILES__, undefined);
  console.log('Electron native update regression passed: original menu position restored, FigBoost callback installed, batch export IPC disabled; idle localization has zero scans.');
  console.log('Chromium file-browser regression passed: 12 grid/list redraws, zero English time samples and zero layout measurements; file names preserved.');
  console.log("Chromium localization regression passed: 12 nested property-panel redraws have zero untranslated samples before paint; 600 labels converge, page names remain original, attributes do not rescan text, reconnects make zero restore writes, recycled labels translate again.");
  console.log("Electron regression passed: dictionary-only regular pages and native menus, Community-only Google fallback, UI switch and cache reuse, isolated settings with default-session 404, removed exclusion capability, protected inputs, untrusted IPC rejection and responsive layout.");
}).then(() => finish(0)).catch(error => { console.error(error.stack); finish(1); });
function finish(code) {
  if (host) host.close();
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  // user-data can remain locked until Electron exits; only remove our runtime and translation fixtures.
  for (const dir of [runtime, path.join(temp, "FigBoost")]) fs.rmSync(dir, { recursive: true, force: true });
  app.exit(code);
}
