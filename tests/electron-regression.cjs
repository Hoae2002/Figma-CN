"use strict";
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "figboost-electron-"));
app.setPath("userData", path.join(temp, "user-data")); process.env.LOCALAPPDATA = temp;
app.disableHardwareAcceleration();
const root = path.join(__dirname, "../payload/src"), runtime = path.join(temp, "runtime"); fs.mkdirSync(runtime);
for (const file of ["shared/translation-policy.js", "main/translation-service.js", "main/translation-host.js", "main/translation-settings-preload.js", "main/translation-settings.html", "main/translation-settings.css", "main/translation-settings.js"]) fs.copyFileSync(path.join(root, file), path.join(runtime, path.basename(file)));
const payload = ["dictionary/zh-CN.js", "shared/translation-policy.js", "content/localizer-core.js", "content/translation-runtime.js", "content/content.js"].map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 40; i++) { if (await fn()) return; await wait(100); } throw Error("Regression condition timed out"); }
let host;
app.whenReady().then(async () => {
  const calls = [];
  const { createHost, isFigmaURL } = require(path.join(runtime, "translation-host.js"));
  assert.equal(isFigmaURL("https://figma.com.evil.test"), false);
  assert.equal(isFigmaURL("https://www.figma.com/design/test"), true);
  host = createHost({ showSettings: false, transport: async texts => { calls.push(texts); return texts.map(() => "新控件"); } });
  const isolatedSession = session.fromPartition("figboost-test");
  await isolatedSession.protocol.handle("https", () => new Response('<!doctype html><html><body><div role="toolbar"><button id="save">Save</button><button id="new" data-testid="novel-action">Gizmo frobnication</button><input value="Default"></div></body></html>', { headers: { "content-type": "text/html" } }));
  const page = new BrowserWindow({ show: false, webPreferences: { session: isolatedSession, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await page.loadURL("https://www.figma.com/design/fixture");
  assert.equal(await host.attach(page.webContents, payload), true);
  assert.equal(await page.webContents.executeJavaScript("typeof window.__FIGBOOST_TRANSLATION_RUNTIME__"), "undefined");
  assert.equal(await page.webContents.executeJavaScript("document.querySelector('#save').textContent"), "保存");
  host.openSettings();
  const settings = BrowserWindow.getAllWindows().find(w => w !== page);
  settings.webContents.on("console-message", (_event, details) => { if (details.level === "error") console.error("Settings console:", details.message); });
  try { await until(() => settings.webContents.executeJavaScript("document.querySelector('#message')?.textContent === '设置已加载'").catch(() => false)); }
  catch (e) { console.error("Settings state:", settings.webContents.getURL(), await settings.webContents.executeJavaScript("({message:document.querySelector('#message')?.textContent, bridge:typeof window.figBoostSettings})")); throw e; }
  async function command(action, data) { const result = await settings.webContents.executeJavaScript(`window.figBoostSettings.invoke(${JSON.stringify(action)},${JSON.stringify(data || {})})`); assert.equal(result.ok, true, result.error); return result; }
  await command("saveKey", { key: "test-key-abcdefghijklmnopqrstuvwxyz" });
  await command("settings", { enabled: true, online: true, dailyLimit: 20000, regions: {} });
  await until(async () => (await page.webContents.executeJavaScript("document.querySelector('#new').textContent")) === "新控件");
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], ["Gizmo frobnication"]);
  assert.equal(await page.webContents.executeJavaScript("document.querySelector('input').value"), "Default");
  const snap = (await command("snapshot")).state;
  assert.equal(snap.credential, undefined); assert.equal(Object.keys(snap.learned).length, 1);
  // Actual settings DOM interactions, including persistence and safe text rendering.
  await settings.webContents.executeJavaScript("document.querySelector('[data-tab=dictionary]').click(); document.querySelector('#original').value='Gizmo frobnication'; document.querySelector('#entry-region').value='toolbar'; document.querySelector('#context').value='button'; document.querySelector('#translation').value='人工修正'; document.querySelector('#entry-form').requestSubmit();");
  await until(async () => (await page.webContents.executeJavaScript("document.querySelector('#new').textContent")) === "人工修正");
  await command("settings", { enabled: true, online: false, dailyLimit: 20000, regions: { toolbar: "original" } });
  await until(async () => (await page.webContents.executeJavaScript("document.querySelector('#save').textContent")) === "Save");
  // Other windows cannot invoke the settings capability, even with the same preload.
  const outsider = new BrowserWindow({ show: false, webPreferences: { preload: path.join(runtime, "translation-settings-preload.js"), sandbox: true, contextIsolation: true } });
  await outsider.loadURL("data:text/html,<html><body>untrusted</body></html>");
  const rejected = await outsider.webContents.executeJavaScript("window.figBoostSettings.invoke('snapshot')"); assert.equal(rejected.ok, false);
  const item = { label: "Save" }; const translated = host.nativeLabel(item, value => value === "Save" ? "保存" : value); item.label = translated;
  assert.equal(host.originalLabel(item), "Save");
  await command("settings", { enabled: false, online: false, dailyLimit: 20000, regions: {} });
  assert.equal(host.nativeLabel(item, () => "保存"), "Save");
  for (const width of [980, 1440, 1920]) { settings.setContentSize(width, 850); for (const tab of ["service", "scope", "dictionary"]) { await settings.webContents.executeJavaScript(`document.querySelector('[data-tab=${tab}]').click()`); assert.equal(await settings.webContents.executeJavaScript("document.documentElement.scrollWidth <= innerWidth"), true); } }
  assert.equal(fs.readFileSync(path.join(temp, "FigBoost/translation/state.json"), "utf8").includes("test-key-"), false);
  console.log("Electron regression passed: isolated-world queue, encrypted settings IPC, learning, manual correction, original mode, untrusted sender rejection, native restoration and 980/1440/1920px layout.");
}).then(() => finish(0)).catch(error => { console.error(error.stack); finish(1); });
function finish(code) {
  if (host) host.close();
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  // user-data can remain locked until Electron exits; only remove our runtime and translation fixtures.
  for (const dir of [runtime, path.join(temp, "FigBoost")]) fs.rmSync(dir, { recursive: true, force: true });
  app.exit(code);
}
