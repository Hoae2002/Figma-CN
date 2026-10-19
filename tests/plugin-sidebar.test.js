"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../payload/src/content/plugin-sidebar.js"), "utf8");
const key = "figboost:plugin-sidebar:v1:42";
const plugin = (id, name = "Plugin " + id) => ({ id, name, description: "描述", icon: "", commands: [] });
const seed = () => ({ plugins: [plugin("1"), plugin("2")], saved: ["1", "2"], recent: [], favorites: [], groups: [] });
const response = data => ({ ok: true, json: async () => data });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(t, data = seed(), fetcher = async () => response({ meta: [], pagination: {} })) {
  const dom = new JSDOM('<!doctype html><html><body><button aria-label="Main menu"></button></body></html>', { url: "https://www.figma.com/design/test?fuid=42", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{ width: 200, height: 28 }]; };
  if (data !== null) w.localStorage.setItem(key, JSON.stringify(data));
  w.fetch = fetcher; w.eval(source);
  t.after(() => { w.__figboostPluginSidebar.destroy(); w.close(); });
  const root = () => w.document.querySelector("#figboost-plugin-sidebar")?.shadowRoot;
  const click = title => { const b = [...root().querySelectorAll("button")].find(b => b.getAttribute("aria-label") === title); assert.ok(b, title); b.click(); };
  const saved = () => JSON.parse(w.localStorage.getItem(key));
  return { w, root, click, saved, status: () => root().querySelector('[role="status"]').textContent };
}
test("search, star, group deduplication and deletion persist across reinjection", t => {
  const f = fixture(t); f.click("FigBoost 插件侧边栏");
  const input = f.root().querySelector('input[type="search"]'); input.value = "plugin 1"; input.dispatchEvent(new f.w.Event("input"));
  assert.equal(f.root().querySelectorAll(".plugin").length, 1);
  f.click("星标 Plugin 1"); assert.deepEqual(f.saved().favorites, ["1"]);
  f.click("新建分组"); f.root().querySelector('[aria-label="分组名称"]').value = "3D 项目插件"; f.click("保存分组");
  f.click("已保存"); f.click("将 Plugin 1 加入分组"); f.click("加入 3D 项目插件");
  f.click("将 Plugin 1 加入分组"); assert.equal(f.root().querySelector('[aria-label="加入 3D 项目插件"]').disabled, true);
  f.w.eval(source); assert.equal(f.w.document.querySelectorAll("#figboost-plugin-sidebar").length, 1);
  f.click("FigBoost 插件侧边栏"); f.click("3D 项目插件"); assert.equal(f.root().querySelectorAll(".plugin").length, 1);
  f.click("管理分组 3D 项目插件"); f.click("删除分组"); f.click("确认删除分组");
  f.w.eval(source); assert.equal(f.saved().groups.length, 0); assert.deepEqual(f.saved().saved, ["1", "2"]);
});
test("blank or duplicate group names are rejected and Escape cancels editing", t => {
  const f = fixture(t); f.click("FigBoost 插件侧边栏"); f.click("新建分组"); f.click("保存分组");
  assert.match(f.status(), /请输入/); assert.equal(f.saved().groups.length, 0);
  f.root().querySelector('[aria-label="分组名称"]').value = "测试"; f.click("保存分组");
  f.click("新建分组"); f.root().querySelector('[aria-label="分组名称"]').value = "测试"; f.click("保存分组");
  assert.match(f.status(), /同名/); f.root().querySelector("input").dispatchEvent(new f.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(f.root().querySelector(".editor").hidden, true);
});
test("pagination supports absolute and relative links and deduplicates plugins", async t => {
  const urls = [];
  const f = fixture(t, seed(), async url => {
    urls.push(url); const page = new URL(url).searchParams.get("page");
    return response({ meta: [{ content: { plugin: plugin(page || "1") } }], pagination: { next_page: page === "3" ? null : page === "2" ? "/api/resource_saves?page=3" : "https://www.figma.com/api/resource_saves?page=2" } });
  });
  await f.w.__figboostPluginSidebar.refresh(); assert.equal(urls.length, 3);
  assert.deepEqual(f.saved().saved, ["1", "2", "3"]);
  assert.ok(urls.every(url => new URL(url).searchParams.get("include_content") === "true"));
});
test("partial refresh failure and pagination loops preserve the full previous cache", async t => {
  let count = 0;
  const f = fixture(t, seed(), async () => { if (++count === 2) throw Error("offline"); return response({ meta: [], pagination: { next_page: "/api/resource_saves?page=2" } }); });
  await f.w.__figboostPluginSidebar.refresh(); assert.deepEqual(f.saved(), seed()); assert.match(f.status(), /保留原列表/);
  f.w.fetch = async () => response({ meta: [], pagination: { next_page: "/api/resource_saves?page=2" } });
  await f.w.__figboostPluginSidebar.refresh(); assert.deepEqual(f.saved(), seed()); assert.match(f.status(), /分页异常/);
});
test("cross-origin pagination is rejected before any external request", async t => {
  const urls = []; const f = fixture(t, seed(), async url => { urls.push(url); return response({ meta: [], pagination: { next_page: "https://example.com/api/resource_saves" } }); });
  await f.w.__figboostPluginSidebar.refresh(); assert.equal(urls.length, 1); assert.deepEqual(f.saved(), seed());
});
test("recent metadata cannot turn an unsaved plugin into a saved plugin", async t => {
  const f = fixture(t, seed(), async url => response(new URL(url).pathname.endsWith("batch") ? { meta: [plugin("3")] } : { meta: [{ content: { plugin: plugin("1") } }], pagination: {} }));
  f.w.localStorage.setItem("recent-plugins-figma-design", JSON.stringify([{ id: "3", last_added_at_by_user_id: { "42": 9 } }, { id: "1" }]));
  await f.w.__figboostPluginSidebar.refresh(); assert.deepEqual(f.saved().saved, ["1"]); assert.deepEqual(f.saved().recent, ["3", "1"]);
});

test("native relative icon URLs render correctly for recent plugins", async t => {
  const data = seed(); data.plugins[0].icon = "/community/icon?resource_id=1&resource_type=plugin";
  const f = fixture(t, data);
  assert.equal(f.root().querySelector('.icon img').src, "https://www.figma.com/community/icon?resource_id=1&resource_type=plugin");
});
test("refresh is single flight and stale requests cannot overwrite an account switch", async t => {
  let resolve, calls = 0;
  const f = fixture(t, seed(), () => { calls++; return new Promise(r => { resolve = r; }); });
  const pending = f.w.__figboostPluginSidebar.refresh(); await f.w.__figboostPluginSidebar.refresh(); assert.equal(calls, 1);
  f.w.history.pushState({}, "", "/design/test?fuid=43"); await new Promise(r => setTimeout(r, 1250));
  resolve(response({ meta: [], pagination: {} })); await pending;
  assert.deepEqual(f.saved(), seed()); assert.equal(f.w.localStorage.getItem("figboost:plugin-sidebar:v1:43"), null);
});
test("route changes remove the sidebar and reinjection cleans the old instance", async t => {
  const f = fixture(t); f.w.history.pushState({}, "", "/community"); await new Promise(r => setTimeout(r, 1250));
  assert.equal(f.root(), undefined); f.w.history.pushState({}, "", "/design/again?fuid=42"); f.w.eval(source);
  assert.ok(f.root()); f.w.__figboostPluginSidebar.destroy(); assert.equal(f.root(), undefined);
});
test("native menu launch is single flight, chooses exact names and records recent only on success", async t => {
  const f = fixture(t); const w = f.w, main = w.document.querySelector("button"); let runs = 0;
  function menu(name, action) { const el = w.document.createElement("div"); el.setAttribute("role", "menuitem"); el.textContent = name; el.addEventListener("click", action); w.document.body.append(el); }
  main.onclick = () => menu("Plugins", () => menu("Saved plugins", () => { menu("Plugin 10", () => { throw Error("wrong plugin"); }); menu("Plugin 1", () => runs++); }));
  f.click("FigBoost 插件侧边栏"); f.click("运行 Plugin 1"); f.click("运行 Plugin 1");
  await tick(); await tick(); assert.equal(runs, 1); assert.deepEqual(f.saved().recent, ["1"]);
});
test("missing menus time out and allow a subsequent retry without recording success", async t => {
  const f = fixture(t); f.click("FigBoost 插件侧边栏"); f.click("运行 Plugin 1");
  await new Promise(r => setTimeout(r, 1900)); assert.match(f.status(), /未找到插件菜单/); assert.deepEqual(f.saved().recent, []);
  assert.equal(f.root().querySelector('[aria-label="运行 Plugin 1"]').disabled, false);
});

test("an unsaved recent plugin can launch directly from the native Plugins submenu", async t => {
  const data = seed(); data.saved = ["2"]; data.recent = ["1"];
  const f = fixture(t, data), w = f.w; let runs = 0;
  const menu = (name, action) => { const e = w.document.createElement("div"); e.setAttribute("role", "menuitem"); e.textContent = name; e.onclick = action; w.document.body.append(e); };
  w.document.querySelector("button").onclick = () => menu("Plugins", () => menu("Plugin 1", () => runs++));
  f.click("FigBoost 插件侧边栏"); f.click("最近使用"); f.click("运行 Plugin 1"); await tick(); await tick();
  assert.equal(runs, 1); assert.deepEqual(f.saved().saved, ["2"]);
});
test("malformed storage, malformed native recents and unsafe content cannot execute markup", async t => {
  const data = seed(); data.plugins[0].name = '<img src=x onerror="window.bad=1">'; data.plugins[0].icon = "javascript:alert(1)";
  const f = fixture(t, data); assert.equal(f.root().querySelector(".name img"), null); assert.equal(f.root().querySelector(".icon img"), null);
  f.w.localStorage.setItem(key, "{"); f.w.localStorage.setItem("recent-plugins-figma-design", "{}"); f.w.eval(source);
  await f.w.__figboostPluginSidebar.refresh(); assert.equal(f.saved().plugins.length, 0); assert.equal(f.w.bad, undefined);
});
test("typing in the sidebar does not reach canvas shortcuts and storage failure is visible", t => {
  const f = fixture(t); let keys = 0; f.w.document.addEventListener("keydown", () => keys++);
  f.root().querySelector("input").dispatchEvent(new f.w.KeyboardEvent("keydown", { key: "s", bubbles: true, composed: true })); assert.equal(keys, 0);
  f.w.Storage.prototype.setItem = () => { throw Error("quota"); }; f.click("星标 Plugin 1"); assert.match(f.status(), /保存失败/);
  f.click("新建分组"); f.root().querySelector('[aria-label="分组名称"]').value = "无法保存"; f.click("保存分组");
  assert.match(f.status(), /保存失败/);
});

test("nested plugin commands follow each native submenu and survive cache reload", async t => {
  const data = seed(); data.plugins[0] = { id: "1", current_plugin_version_id: "v1", versions: { v1: { plugin_id: "1", name: "Nested", manifest: { menu: [{ name: "Tools", menu: [{ name: "Open", command: "open" }] }] } } } };
  const f = fixture(t, data), w = f.w; let runs = 0;
  function menu(name, action) { const el = w.document.createElement("div"); el.role = "menuitem"; el.setAttribute("role", "menuitem"); el.textContent = name; el.onclick = action; w.document.body.append(el); }
  w.document.querySelector("button").onclick = () => menu("Plugins", () => menu("Saved plugins", () => menu("Nested", () => menu("Tools", () => menu("Open", () => runs++)))));
  f.click("FigBoost 插件侧边栏"); f.click("星标 Nested"); w.eval(source); f.click("FigBoost 插件侧边栏");
  f.click("运行 Nested"); f.click("运行命令 Tools / Open"); await tick(); await tick();
  assert.equal(runs, 1); assert.match(f.status(), /Tools \/ Open/);
});
