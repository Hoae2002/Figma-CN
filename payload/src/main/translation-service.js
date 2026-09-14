"use strict";
const fs = require("fs");
const path = require("path");
const P = require(require("fs").existsSync(require("path").join(__dirname, "translation-policy.js")) ? "./translation-policy.js" : "../shared/translation-policy.js");
const defaults = () => ({ schema: 1, revision: 0, settings: { enabled: true, online: false, dailyLimit: 20000, regions: {} }, learned: {}, overrides: {}, rules: [], usage: { day: "", characters: 0 }, credential: "" });
function validateState(s) {
  if (!s || s.schema !== 1 || !s.settings || !s.learned || !s.overrides || !Array.isArray(s.rules) || !s.usage) throw new Error("个人词库格式不兼容");
  if (typeof s.credential !== "string" || !Number.isSafeInteger(s.revision) || !Number.isSafeInteger(s.usage.characters) || s.usage.characters < 0) throw new Error("个人词库数据损坏");
  if (typeof s.settings.enabled !== "boolean" || typeof s.settings.online !== "boolean" || !Number.isSafeInteger(s.settings.dailyLimit) || s.settings.dailyLimit < 1 || s.settings.dailyLimit > 10000000 || !s.settings.regions || typeof s.settings.regions !== "object") throw new Error("个人设置数据损坏");
  for (const [region, mode] of Object.entries(s.settings.regions)) if (!Object.hasOwn(P.regions, region) || !["original", "local", "hybrid"].includes(mode)) throw new Error("个人区域设置损坏");
  for (const r of s.rules) if (!P.validCandidate(r) || !/^[a-z][a-z_-]{2,100}$/i.test(r.anchor || "")) throw new Error("排除规则损坏");
  for (const table of [s.learned, s.overrides]) for (const [k, entry] of Object.entries(table)) {
    if (!entry || typeof entry.text !== "string" || typeof entry.translation !== "string" || k !== P.key(entry.text, entry.region, entry.context)) throw new Error("个人词条格式不兼容");
  }
  return s;
}
function readState(file) {
  let error = "";
  for (const target of [file, file + ".bak"]) {
    try { return { state: validateState(JSON.parse(fs.readFileSync(target, "utf8").replace(/^\uFEFF/, ""))), recovered: target !== file, error }; }
    catch (e) { if (e.code !== "ENOENT") error = "个人数据读取失败，已尝试最近备份。"; }
  }
  return { state: defaults(), recovered: !!error, error };
}
function googleTransport(net) {
  return (texts, apiKey) => new Promise((resolve, reject) => {
    const request = net.request({ method: "POST", url: "https://translation.googleapis.com/language/translate/v2", redirect: "error", useSessionCookies: false });
    let completed = false;
    const finish = (err, data) => { if (completed) return; completed = true; clearTimeout(timer); err ? reject(err) : resolve(data); };
    const timer = setTimeout(() => { finish(Object.assign(new Error("翻译请求超时"), { transient: true })); request.abort(); }, 8000);
    request.setHeader("Content-Type", "application/json");
    request.setHeader("X-Goog-Api-Key", apiKey);
    request.on("error", () => finish(Object.assign(new Error("无法连接谷歌翻译，请检查网络或代理"), { transient: true })));
    request.on("response", response => {
      let body = "";
      response.on("data", chunk => { body += chunk; if (body.length > 100000) { finish(new Error("翻译响应过大")); request.abort(); } });
      response.on("error", () => finish(new Error("翻译响应中断")));
      response.on("end", () => {
        const status = response.statusCode;
        if (status !== 200) return finish(Object.assign(new Error(status === 400 || status === 401 || status === 403 ? "密钥、API 权限或结算配置无效" : status === 429 ? "谷歌配额不足或请求受限" : "谷歌翻译暂时不可用"), { transient: status >= 500, fatal: [400, 401, 403, 429].includes(status) }));
        try { finish(null, JSON.parse(body).data.translations.map(item => item.translatedText)); }
        catch (_) { finish(new Error("谷歌返回了无效数据")); }
      });
    });
    request.end(JSON.stringify({ q: texts, source: "en", target: "zh-CN", format: "text" }));
  });
}
function createService({ dir, safeStorage, transport, now = () => new Date(), debounceMs = 180 }) {
  const file = path.join(dir, "state.json");
  const loaded = readState(file);
  let state = loaded.state, lastError = loaded.error, blocked = false, failures = 0, active = 0, timer;
  let preserveBackup = loaded.recovered;
  const pending = new Map(), waiting = [], listeners = new Set();
  function persist() {
    fs.mkdirSync(dir, { recursive: true });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    if (fs.existsSync(file) && !preserveBackup) fs.copyFileSync(file, file + ".bak");
    fs.renameSync(temp, file);
    preserveBackup = false;
  }
  function change() { state.revision++; persist(); for (const fn of listeners) fn(); }
  function day() { return now().toLocaleDateString("en-CA"); }
  function resetDay() { if (state.usage.day !== day()) state.usage = { day: day(), characters: 0 }; }
  function snapshot() { resetDay(); const { credential, ...safe } = state; return JSON.parse(JSON.stringify({ ...safe, hasKey: !!credential, lastError, blocked })); }
  function apiKey() {
    if (!state.credential || !safeStorage.isEncryptionAvailable()) throw new Error("请先保存 API 密钥；系统加密能力须可用");
    return safeStorage.decryptString(Buffer.from(state.credential, "base64"));
  }
  function allowed(c) { return state.settings.enabled && state.settings.online && P.validCandidate(c) && P.mode(state.settings, c.region) === "hybrid" && !P.excluded(c, state.rules) && !(state.overrides[P.key(c.text, c.region, c.context)] || {}).keepOriginal; }
  function validTranslation(s) { return typeof s === "string" && s.trim() && s.length <= 2000 && !/[<>\u0000-\u0008]/.test(s); }
  async function send(texts) {
    const key = apiKey();
    for (let attempt = 0; attempt < 2; attempt++) {
      resetDay();
      const count = texts.reduce((sum, s) => sum + Array.from(s).length, 0);
      if (state.usage.characters + count > state.settings.dailyLimit) throw new Error("已达到本机每日字符上限，继续使用本地词库");
      state.usage.characters += count;
      persist();
      try { return await transport(texts, key); }
      catch (e) { if (attempt || !e.transient) throw e; await new Promise(resolve => setTimeout(resolve, 500)); }
    }
  }
  function finish(job, value) { pending.delete(job.key); job.resolve(value); }
  async function run(batch) {
    try {
      const values = await send(batch.map(j => j.c.text));
      if (!Array.isArray(values) || values.length !== batch.length || !values.every(validTranslation)) throw new Error("翻译结果格式不正确，未保存");
      batch.forEach((job, i) => {
        const value = values[i].trim();
        if (allowed(job.c) && job.revision === state.revision && value !== job.c.text) state.learned[job.key] = { ...job.c, translation: value, source: "google", updatedAt: now().toISOString() };
      });
      // Learned data changes do not invalidate other concurrent requests.
      persist();
      lastError = ""; failures = 0;
      batch.forEach(job => finish(job, state.learned[job.key] || null));
    } catch (e) {
      lastError = e.message; failures++;
      if (e.fatal || failures >= 3) blocked = true;
      batch.forEach(job => finish(job, null));
    } finally { active--; pump(); }
  }
  function pump() {
    while (waiting.length && active < 2) {
      const batch = []; let chars = 0;
      while (waiting.length && batch.length < 50) {
        const job = waiting[0];
        if (blocked || !allowed(job.c) || job.revision !== state.revision) { waiting.shift(); finish(job, null); continue; }
        if (chars + Array.from(job.c.text).length > 5000) break;
        waiting.shift(); batch.push(job); chars += Array.from(job.c.text).length;
      }
      if (batch.length) { active++; void run(batch); }
    }
  }
  function translate(c) {
    if (!P.validCandidate(c)) return Promise.resolve(null);
    const k = P.key(c.text, c.region, c.context);
    if (!allowed(c)) return Promise.resolve(null);
    if (state.overrides[k]) return Promise.resolve(state.overrides[k]);
    if (state.learned[k]) return Promise.resolve(state.learned[k]);
    if (blocked || !state.credential) return Promise.resolve(null);
    if (pending.has(k)) return pending.get(k).promise;
    if (pending.size >= 1000) return Promise.resolve(null);
    const job = { c: { text: P.normalize(c.text), region: c.region, context: c.context, ...(c.anchor ? { anchor: c.anchor } : {}) }, key: k, revision: state.revision };
    job.promise = new Promise(resolve => { job.resolve = resolve; }); pending.set(k, job); waiting.push(job);
    clearTimeout(timer); timer = setTimeout(pump, debounceMs);
    return job.promise;
  }
  async function command(action, data = {}) {
    if (action === "snapshot") return snapshot();
    if (action === "saveKey") {
      if (typeof data.key !== "string" || !/^[\w-]{20,200}$/.test(data.key.trim())) throw new Error("请输入有效的 API 密钥");
      if (!safeStorage.isEncryptionAvailable()) throw new Error("系统加密不可用，未保存密钥");
      state.credential = safeStorage.encryptString(data.key.trim()).toString("base64"); blocked = false; failures = 0;
    } else if (action === "clearKey") { state.credential = ""; state.settings.online = false; }
    else if (action === "test") {
      // Explicit connection test works with automatic translation disabled.
      try { const values = await send(["Translation connection test"]); if (!values || !validTranslation(values[0])) throw new Error("翻译响应无效"); blocked = false; failures = 0; lastError = ""; }
      catch (e) { lastError = e.message; throw e; }
      return snapshot();
    } else if (action === "settings") {
      if (!Number.isSafeInteger(data.dailyLimit) || data.dailyLimit < 1 || data.dailyLimit > 10000000) throw new Error("每日字符上限须为 1 至 10000000 的整数");
      const regions = {};
      for (const [region, mode] of Object.entries(data.regions || {})) {
        if (!Object.hasOwn(P.regions, region) || !["original", "local", "hybrid"].includes(mode)) throw new Error("区域设置无效");
        regions[region] = region === "other" && mode === "hybrid" ? "local" : mode;
      }
      state.settings = { enabled: !!data.enabled, online: !!data.online, dailyLimit: data.dailyLimit, regions };
      blocked = false; failures = 0;
    } else if (action === "override") {
      if (!data || !Object.hasOwn(P.regions, data.region) || typeof data.text !== "string" || !data.text.trim() || data.text.length > 260 || !/^[a-z:-]{1,40}$/.test(data.context || "")) throw new Error("词条原文或区域无效");
      if (!data.keepOriginal && !validTranslation(data.translation)) throw new Error("请输入有效译文");
      const entry = { text: P.normalize(data.text), region: data.region, context: data.context, translation: data.keepOriginal ? "" : data.translation.trim(), keepOriginal: !!data.keepOriginal, source: "manual" };
      state.overrides[P.key(entry.text, entry.region, entry.context)] = entry;
    } else if (action === "deleteEntry") { delete state.learned[data.key]; delete state.overrides[data.key]; }
    else if (action === "exclude") {
      if (!P.validCandidate(data) || !/^[a-z][a-z_-]{2,100}$/i.test(data.anchor || "")) throw new Error("此元素没有稳定定位，只能本次排除");
      const rule = { text: data.text, region: data.region, context: data.context, anchor: data.anchor };
      if (!state.rules.some(r => JSON.stringify(r) === JSON.stringify(rule))) state.rules.push(rule);
    } else if (action === "removeRule") { if (!Number.isInteger(data.index)) throw new Error("排除项无效"); state.rules.splice(data.index, 1); }
    else throw new Error("不支持的操作");
    lastError = ""; change(); return snapshot();
  }
  return { snapshot, command, translate, localState: () => ({ settings: state.settings, learned: state.learned, overrides: state.overrides, rules: state.rules }), onChange: fn => listeners.add(fn), close: () => { clearTimeout(timer); while (waiting.length) finish(waiting.shift(), null); } };
}
module.exports = { createService, googleTransport, readState, defaults };
