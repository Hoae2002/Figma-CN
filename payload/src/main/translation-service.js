"use strict";
const fs = require("fs"), path = require("path");
const P = require(fs.existsSync(path.join(__dirname, "translation-policy.js")) ? "./translation-policy.js" : "../shared/translation-policy.js");
const defaults = () => ({ schema: 2, revision: 0, settings: { enabled: true, regions: {} }, learned: {}, rules: [] });
const validTranslation = s => typeof s === "string" && s.trim() && s.length <= 2000 && !/[<>\u0000-\u0008]/.test(s);
function validateState(s) {
  if (!s || ![1, 2].includes(s.schema) || !s.settings || typeof s.settings.enabled !== "boolean" || !s.learned || !Array.isArray(s.rules) || !Number.isSafeInteger(s.revision)) throw Error("缓存格式不兼容");
  if (s.schema === 1) {
    // Preserve machine results and exclusions, never use old credentials or manual entries.
    s = { schema: 2, revision: s.revision + 1, settings: { enabled: s.settings.enabled, regions: Object.fromEntries(Object.entries(s.settings.regions || {}).filter(([, v]) => v === "original")) }, learned: s.learned, rules: s.rules };
  }
  for (const [k, e] of Object.entries(s.learned)) if (!P.validCandidate(e) || !validTranslation(e.translation) || k !== P.key(e.text, e.region, e.context)) throw Error("缓存数据损坏");
  for (const r of s.rules) {
    const validRegion = r && Object.hasOwn(P.regions, r.region) && r.region !== "other";
    const validElement = r && r.scope === "element" && /^[a-z][a-z_-]{2,100}$/i.test(r.anchor || "");
    const validText = r && r.scope === "text" && P.safeText(r.text) && typeof r.context === "string" && /^[a-z:-]{1,40}$/.test(r.context);
    if (!validRegion || (r.scope !== "region" && !validElement && !validText)) throw Error("排除规则损坏");
  }
  return s;
}
function readState(file) {
  let error = "";
  for (const target of [file, file + ".bak"]) {
    try { return { state: validateState(JSON.parse(fs.readFileSync(target, "utf8").replace(/^\uFEFF/, ""))), recovered: target !== file, error }; }
    catch (e) { if (e.code !== "ENOENT") error = "缓存读取失败，已尝试最近备份。"; }
  }
  return { state: defaults(), recovered: !!error, error };
}
// Google web translation without a developer key. Preserve phrase boundaries.
function googleTransport(net) {
  return texts => {
    if (texts.length !== 1) return Promise.reject(Error("网页翻译每次处理一段文案"));
    return new Promise((resolve, reject) => {
      const query = new URLSearchParams({ client: "gtx", sl: "en", tl: "zh-CN", dt: "t", dj: "1", q: texts[0] });
      const request = net.request({ method: "GET", url: `https://translate.googleapis.com/translate_a/single?${query}`, redirect: "error", useSessionCookies: false });
      let done = false;
      const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => { finish(Object.assign(Error("翻译暂时连接不上，已保留原文"), { transient: true })); request.abort(); }, 8000);
      request.on("error", () => finish(Object.assign(Error("翻译暂时连接不上，已保留原文"), { transient: true })));
      request.on("response", response => {
        let body = "";
        response.on("data", chunk => { body += chunk; if (body.length > 100000) { finish(Error("翻译响应过大")); request.abort(); } });
        response.on("error", () => finish(Error("翻译响应中断")));
        response.on("end", () => {
          if (response.statusCode !== 200) return finish(Object.assign(Error("翻译服务暂时受限，已保留原文"), { transient: response.statusCode >= 500 }));
          try { const data = JSON.parse(body); const value = data.sentences.filter(s => typeof s.trans === "string").map(s => s.trans).join(""); if (!validTranslation(value)) throw Error(); finish(null, [value]); }
          catch (_) { finish(Error("翻译响应无效，已保留原文")); }
        });
      });
      request.end();
    });
  };
}
function createService({ dir, transport, now = () => new Date(), debounceMs = 180, cooldownMs = 60000 }) {
  // Separate file leaves schema-1 encrypted settings recoverable for rollback.
  const file = path.join(dir, "cache.json");
  const loaded = readState(fs.existsSync(file) || fs.existsSync(file + ".bak") ? file : path.join(dir, "state.json"));
  let state = loaded.state, lastError = loaded.error, blockedUntil = 0, active = 0, timer, closed = false;
  let preserveBackup = loaded.recovered;
  const pending = new Map(), waiting = [], listeners = new Set();
  function persist() {
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + ".tmp", JSON.stringify(state), "utf8");
    if (fs.existsSync(file) && !preserveBackup) fs.copyFileSync(file, file + ".bak");
    fs.renameSync(file + ".tmp", file); preserveBackup = false;
  }
  function change() { state.revision++; persist(); for (const fn of listeners) fn(); }
  function snapshot() { return JSON.parse(JSON.stringify({ ...state, lastError, blocked: now().getTime() < blockedUntil })); }
  function allowed(c) { return !closed && state.settings.enabled && P.validCandidate(c) && P.mode(state.settings, c.region) !== "original" && !P.excluded(c, state.rules); }
  function finish(job, value) { pending.delete(job.key); job.resolve(value); }
  async function run(job) {
    try {
      let values;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!allowed(job.c) || job.revision !== state.revision) return finish(job, null);
        try { values = await transport([job.c.text]); break; }
        catch (e) { if (attempt || !e.transient) throw e; await new Promise(r => setTimeout(r, 500)); }
      }
      if (!Array.isArray(values) || values.length !== 1 || !validTranslation(values[0])) throw Error("翻译响应无效，未缓存");
      if (!allowed(job.c) || job.revision !== state.revision) return finish(job, null);
      const entry = { ...job.c, translation: values[0].trim(), source: "google-web", updatedAt: now().toISOString() };
      delete state.learned[job.key]; state.learned[job.key] = entry;
      const keys = Object.keys(state.learned); for (const key of keys.slice(0, Math.max(0, keys.length - 10000))) delete state.learned[key];
      persist(); lastError = ""; finish(job, entry);
    } catch (e) { lastError = e.message; blockedUntil = now().getTime() + cooldownMs; finish(job, null); }
    finally { active--; pump(); }
  }
  function pump() {
    while (waiting.length && active < 2) {
      const job = waiting.shift();
      if (!allowed(job.c) || job.revision !== state.revision || now().getTime() < blockedUntil) { finish(job, null); continue; }
      active++; void run(job);
    }
  }
  function translate(c) {
    if (!allowed(c)) return Promise.resolve(null);
    const key = P.key(c.text, c.region, c.context);
    if (state.learned[key]) return Promise.resolve(state.learned[key]);
    if (now().getTime() < blockedUntil) return Promise.resolve(null);
    if (pending.has(key)) return pending.get(key).promise;
    if (pending.size >= 1000) return Promise.resolve(null);
    const job = { c: { text: P.normalize(c.text), region: c.region, context: c.context }, key, revision: state.revision };
    if (c.anchor) job.c.anchor = c.anchor;
    job.promise = new Promise(resolve => { job.resolve = resolve; }); pending.set(key, job); waiting.push(job);
    if (!timer) timer = setTimeout(() => { timer = null; pump(); }, debounceMs);
    return job.promise;
  }
  async function command(action, data = {}) {
    if (action === "snapshot") return snapshot();
    if (action === "settings") {
      if (typeof data.enabled !== "boolean") throw Error("汉化开关无效");
      state.settings.enabled = data.enabled; blockedUntil = 0;
    } else if (action === "exclude") {
      if (!Object.hasOwn(P.regions, data.region) || data.region === "other") throw Error("无法排除此区域");
      const rule = data.scope === "region"
        ? { region: data.region, scope: "region", text: P.regions[data.region] }
        : data.scope === "text"
          ? { region: data.region, scope: "text", context: data.context, text: String(data.text || "").slice(0, 100) }
          : { region: data.region, scope: "element", anchor: data.anchor, text: String(data.text || "界面区域").slice(0, 100) };
      if (rule.scope === "element" && !/^[a-z][a-z_-]{2,100}$/i.test(rule.anchor || "")) throw Error("此区域仅本次有效");
      if (rule.scope === "text" && (!P.safeText(rule.text) || !/^[a-z:-]{1,40}$/.test(rule.context || ""))) throw Error("无法保存此文案排除");
      if (!state.rules.some(r => r.region === rule.region && r.scope === rule.scope && r.anchor === rule.anchor && r.text === rule.text && r.context === rule.context)) state.rules.push(rule);
    } else if (action === "removeRule") {
      if (!Number.isInteger(data.index) || data.index < 0 || data.index >= state.rules.length) throw Error("排除项无效");
      const [removed] = state.rules.splice(data.index, 1);
      if (removed.scope === "region") delete state.settings.regions[removed.region];
    } else throw Error("不支持的操作");
    lastError = ""; change(); return snapshot();
  }
  for (const [region, mode] of Object.entries(state.settings.regions || {})) if (mode === "original" && !state.rules.some(r => r.region === region && r.scope === "region")) state.rules.push({ region, scope: "region", text: P.regions[region] });
  return { snapshot, command, translate, localState: () => state, onChange: fn => listeners.add(fn), close: () => { closed = true; clearTimeout(timer); while (waiting.length) finish(waiting.shift(), null); } };
}
module.exports = { createService, googleTransport, readState, defaults };
