"use strict";
const { app, BrowserWindow, webContents, ipcMain, net, safeStorage } = require("electron");
const path = require("path");
const { fileURLToPath } = require("url");
const { createService, googleTransport } = require("./translation-service.js");
const P = require(require("fs").existsSync(path.join(__dirname, "translation-policy.js")) ? "./translation-policy.js" : "../shared/translation-policy.js");
const WORLD = 1004;
function isFigmaURL(value) {
  try { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "figma.com" || url.hostname.endsWith(".figma.com")) && !url.username && !url.password; } catch (_) { return false; }
}
function createHost(options = {}) {
  const service = createService({ dir: path.join(process.env.LOCALAPPDATA || app.getPath("userData"), "FigBoost", "translation"), safeStorage, transport: options.transport || googleTransport(net) });
  const attached = new Map(), originals = new WeakMap();
  let settingsWindow = null, pickerTarget = null;
  const settingsFile = path.join(__dirname, "translation-settings.html");
  function isSettingsSource(event) {
    if (!settingsWindow || event.sender !== settingsWindow.webContents) return false;
    const frame = event.senderFrame, main = event.sender.mainFrame;
    if (!frame || !main || frame.processId !== main.processId || frame.routingId !== main.routingId) return false;
    try { return path.resolve(fileURLToPath(event.sender.getURL())).toLowerCase() === path.resolve(settingsFile).toLowerCase(); } catch (_) { return false; }
  }
  const execute = (contents, code) => contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
  function snapshot() { return service.snapshot(); }
  function safePayloadSnapshot() { const s = snapshot(); delete s.usage; delete s.lastError; return s; }
  async function attach(contents, payload) {
    if (!isFigmaURL(contents.getURL()) || typeof contents.executeJavaScriptInIsolatedWorld !== "function") return false;
    const existing = attached.get(contents.id);
    if (existing && existing.url === contents.getURL()) return true;
    const record = { contents, url: contents.getURL(), busy: false, disposed: false, epoch: Symbol() };
    attached.set(contents.id, record);
    try {
      await execute(contents, payload);
      await execute(contents, `window.__FIGBOOST_TRANSLATION_RUNTIME__.apply(${JSON.stringify(safePayloadSnapshot())})`);
    } catch (_) { attached.delete(contents.id); return false; }
    if (!contents.__figBoostTranslationEvents) {
      contents.__figBoostTranslationEvents = true;
      contents.on("did-start-navigation", (_e, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) attached.delete(contents.id); });
      contents.once("destroyed", () => attached.delete(contents.id));
    }
    return true;
  }
  async function poll(record) {
    const c = record.contents;
    if (record.busy || c.isDestroyed() || !isFigmaURL(c.getURL())) return;
    if (c.getURL() !== record.url) { record.url = c.getURL(); await execute(c, `window.__FIGBOOST_TRANSLATION_RUNTIME__.apply(${JSON.stringify({ ...safePayloadSnapshot(), revision: -2 })})`).catch(() => {}); }
    record.busy = true;
    try {
      const batch = await execute(c, "window.__FIGBOOST_TRANSLATION_RUNTIME__ && window.__FIGBOOST_TRANSLATION_RUNTIME__.drain()");
      if (!batch) return;
      for (const action of (batch.actions || []).slice(0, 10)) if (action.action === "exclude") await service.command("exclude", action.data);
      const epoch = record.epoch, url = c.getURL();
      const requests = (batch.requests || []).slice(0, 50);
      // Do not hold the polling loop while the network is pending.
      void Promise.all(requests.map(async job => ({ id: job.id, entry: await service.translate(job.c) }))).then(results => {
        if (c.isDestroyed() || attached.get(c.id) !== record || record.epoch !== epoch || c.getURL() !== url) return;
        return execute(c, `window.__FIGBOOST_TRANSLATION_RUNTIME__?.accept(${JSON.stringify(results)})`);
      }).catch(() => {});
    } catch (_) {} finally { record.busy = false; }
  }
  const timer = setInterval(() => { for (const record of attached.values()) void poll(record); }, 250);
  timer.unref();
  service.onChange(() => {
    const code = `window.__FIGBOOST_TRANSLATION_RUNTIME__?.apply(${JSON.stringify(safePayloadSnapshot())})`;
    for (const { contents } of attached.values()) if (!contents.isDestroyed()) execute(contents, code).catch(() => {});
  });
  async function startPicker() {
    const candidate = pickerTarget && attached.get(pickerTarget.id) || [...attached.values()].find(r => !r.contents.isDestroyed() && r.contents.isFocused()) || [...attached.values()].find(r => !r.contents.isDestroyed());
    if (!candidate) throw new Error("请先打开 Figma 文件页面，再点选排除");
    await execute(candidate.contents, "window.__FIGBOOST_TRANSLATION_RUNTIME__.startPicker()");
    if (settingsWindow) settingsWindow.hide();
    const owner = BrowserWindow.fromWebContents(candidate.contents); if (owner) owner.show();
    candidate.contents.focus();
  }
  function openSettings() {
    const focused = webContents.getFocusedWebContents();
    if (focused && attached.has(focused.id)) pickerTarget = focused;
    if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
    settingsWindow = new BrowserWindow({ show: options.showSettings !== false, width: 980, height: 800, minWidth: 720, minHeight: 580, title: "FigBoost · 汉化设置", backgroundColor: "#202020", autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, "translation-settings-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    settingsWindow.webContents.__FIGBOOST_SKIP_RENDERER_INJECTION__ = true;
    settingsWindow.removeMenu();
    settingsWindow.webContents.on("will-navigate", event => event.preventDefault());
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    settingsWindow.on("closed", () => { settingsWindow = null; });
    settingsWindow.loadFile(settingsFile);
  }
  ipcMain.handle("figboost:translation-settings", async (event, action, data) => {
    if (!isSettingsSource(event)) return { ok: false, error: "无效的设置来源" };
    try {
      if (JSON.stringify(data || {}).length > 20000) throw new Error("设置内容过大");
      if (action === "pick") { await startPicker(); return { ok: true, state: snapshot() }; }
      if (action === "ruleStatus") {
        const reports = await Promise.all([...attached.values()].map(r => execute(r.contents, "window.__FIGBOOST_TRANSLATION_RUNTIME__?.ruleStatus()").catch(() => [])));
        return { ok: true, rules: snapshot().rules.map(rule => ({ ...rule, matched: reports.flat().some(r => r && r.anchor === rule.anchor && r.region === rule.region && r.matched) })) };
      }
      return { ok: true, state: await service.command(action, data) };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  function nativeLabel(item, builtin, safe = false) {
    const prior = originals.get(item);
    const original = prior && item.label === prior.translated ? prior.original : item.label;
    if (typeof original !== "string") return original;
    const s = service.localState(), c = { text: original, region: "native", context: "menu" }, k = P.key(original, "native", "menu");
    let translated = original;
    const override = s.overrides[k];
    if (s.settings.enabled && P.mode(s.settings, "native") !== "original" && !P.excluded(c, s.rules)) {
      if (override) translated = override.keepOriginal ? original : override.translation;
      else {
        translated = builtin(original);
        if (translated === original && safe) {
          if (s.learned[k]) translated = s.learned[k].translation;
          else void service.translate(c);
        }
      }
    }
    originals.set(item, { original, translated });
    return translated;
  }
  return { attach, openSettings, nativeLabel, originalLabel: item => { const prior = originals.get(item); return prior && item.label === prior.translated ? prior.original : item.label; }, enabled: () => service.localState().settings.enabled, nativeMode: () => P.mode(service.localState().settings, "native"), close: () => { clearInterval(timer); service.close(); } };
}
module.exports = { createHost, isFigmaURL };
