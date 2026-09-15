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
  console.log("Electron regression passed: dictionary-only regular pages and native menus, Community-only Google fallback, UI switch and cache reuse, isolated settings with default-session 404, removed exclusion capability, protected inputs, untrusted IPC rejection and responsive layout.");
}).then(() => finish(0)).catch(error => { console.error(error.stack); finish(1); });
function finish(code) {
  if (host) host.close();
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  // user-data can remain locked until Electron exits; only remove our runtime and translation fixtures.
  for (const dir of [runtime, path.join(temp, "FigBoost")]) fs.rmSync(dir, { recursive: true, force: true });
  app.exit(code);
}
