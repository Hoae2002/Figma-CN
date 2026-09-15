"use strict";
const fs = require("fs"), path = require("path");
const P = require(fs.existsSync(path.join(__dirname, "translation-policy.js")) ? "./translation-policy.js" : "../shared/translation-policy.js");
const defaults = () => ({ schema: 3, revision: 0, settings: { enabled: true, communityOnline: true }, learned: {} });
const validTranslation = s => typeof s === "string" && s.trim() && s.length <= 2000 && !/[<>\u0000-\u0008]/.test(s);
const UI_GLOSSARY = [
  [/\bcomponent properties\b/i, [[/组件的?属性|部件属性|构件属性/g, "组件属性"]]],
  [/\bauto[- ]?layout\b/i, [[/自动排版|自动版式/g, "自动布局"]]],
  [/\bdesign systems?\b/i, [[/设计体系|设计制度/g, "设计系统"]]],
  [/\bwireframes?\b/i, [[/线框模型|线框架构|线框(?!图)/g, "线框图"]]],
  [/\bcomponents?\b/i, [[/组成部分|部件|构件/g, "组件"]]],
  [/\bvariants?\b/i, [[/变种|变型/g, "变体"]]],
  [/\binstances?\b/i, [[/事例|例子/g, "实例"]]],
  [/\bframes?\b/i, [[/框架|帧/g, "画框"]]],
  [/\blayers?\b/i, [[/层次|图层层级/g, "图层"]]],
  [/\bstyles?\b/i, [[/款式|风格/g, "样式"]]],
  [/\bassets?\b/i, [[/资产/g, "资源"]]],
  [/\blibraries?\b/i, [[/图书馆|程序库/g, "资源库"]]],
  [/\bplugins?\b/i, [[/外挂|附加组件/g, "插件"]]],
  [/\bwidgets?\b/i, [[/小部件|窗口小部件/g, "小组件"]]],
  [/\bprototypes?\b/i, [[/原型机|样机/g, "原型"]]],
  [/\bmockups?\b/i, [[/模型|模拟图/g, "视觉稿"]]],
  [/\bconstraints?\b/i, [[/限制条件|制约因素/g, "约束"]]],
  [/\bstrokes?\b/i, [[/中风|笔划|行程/g, "描边"]]],
  [/\bfills?\b/i, [[/灌装|填写内容/g, "填充"]]],
  [/\bcorner radius\b/i, [[/角半径/g, "圆角"]]],
  [/\bFigma Make\b/i, [[/Figma\s*制作\s*/g, "Figma Make "]]],
];
function refineUiTranslation(source, translation) {
  let value = String(translation || "").trim();
  for (const [sourcePattern, replacements] of UI_GLOSSARY) {
    sourcePattern.lastIndex = 0;
    if (!sourcePattern.test(source)) continue;
    for (const [wrong, preferred] of replacements) value = value.replace(wrong, preferred);
  }
  return value;
}
function validateState(s) {
  if (!s || ![1, 2, 3].includes(s.schema) || !s.settings || typeof s.settings.enabled !== "boolean" || !s.learned || !Number.isSafeInteger(s.revision)) throw Error("缓存格式不兼容");
  if (s.schema < 3) {
    // Keep machine results, but retire every legacy exclusion and region mode.
    s = { schema: 3, revision: s.revision + 1, settings: { enabled: s.settings.enabled, communityOnline: s.settings.communityOnline !== false }, learned: s.learned };
  }
  if (s.settings.communityOnline === undefined) s.settings.communityOnline = true;
  if (typeof s.settings.communityOnline !== "boolean") throw Error("社区补译设置无效");
  for (const [k, e] of Object.entries(s.learned)) if (!P.validCandidate(e) || !validTranslation(e.translation) || k !== P.key(e.text, e.region, e.context)) throw Error("缓存数据损坏");
  return s;
}
function readState(file) {
  let error = "";
  for (const target of [file, file + ".bak"]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(target, "utf8").replace(/^\uFEFF/, ""));
      const state = validateState(parsed);
      return { state, recovered: target !== file, migrated: state.schema !== parsed.schema, error };
    }
    catch (e) { if (e.code !== "ENOENT") error = "缓存读取失败，已尝试最近备份。"; }
  }
  return { state: defaults(), recovered: !!error, migrated: false, error };
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
  if (loaded.migrated) persist();
  function change() { state.revision++; persist(); for (const fn of listeners) fn(); }
  function snapshot() { return JSON.parse(JSON.stringify({ ...state, lastError, blocked: now().getTime() < blockedUntil })); }
  function allowed(c) { return !closed && state.settings.enabled && state.settings.communityOnline && c && c.region === "community" && P.validCandidate(c); }
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
      const translation = refineUiTranslation(job.c.text, values[0]);
      if (!validTranslation(translation)) throw Error("翻译响应无效，未缓存");
      const entry = { ...job.c, translation, source: "google-web-ui", updatedAt: now().toISOString() };
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
      let changed = false;
      if (Object.hasOwn(data, "enabled")) { if (typeof data.enabled !== "boolean") throw Error("汉化开关无效"); state.settings.enabled = data.enabled; changed = true; }
      if (Object.hasOwn(data, "communityOnline")) { if (typeof data.communityOnline !== "boolean") throw Error("社区补译开关无效"); state.settings.communityOnline = data.communityOnline; changed = true; }
      if (!changed) throw Error("汉化设置无效");
      blockedUntil = 0;
    } else throw Error("不支持的操作");
    lastError = ""; change(); return snapshot();
  }
  return { snapshot, command, translate, localState: () => state, onChange: fn => listeners.add(fn), close: () => { closed = true; clearTimeout(timer); while (waiting.length) finish(waiting.shift(), null); } };
}
module.exports = { createService, googleTransport, readState, defaults, refineUiTranslation };
