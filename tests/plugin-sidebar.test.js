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

test("direct icons take priority, fail over safely and retain alternatives in the cache", async t => {
  const raw = { id: "1", current_plugin_version_id: "v1", versions: { v1: { name: "Icon test", direct_icon_url: "https://cdn.figma.com/icon.png", redirect_icon_url: "/community/icon?resource_id=1" } } };
  const f = fixture(t, seed(), async () => response({ meta: [{ icon_url: "https://www.figma.com/community/resource/one/icon", content: { plugin: raw } }], pagination: {} }));
  await f.w.__figboostPluginSidebar.refresh();
  let img = f.root().querySelector(".icon img");
  assert.equal(img.src, "https://cdn.figma.com/icon.png");
  img.dispatchEvent(new f.w.Event("error"));
  assert.equal(img.src, "https://www.figma.com/community/icon?resource_id=1");
  f.w.eval(source); img = f.root().querySelector(".icon img");
  assert.equal(img.src, "https://cdn.figma.com/icon.png"); img.dispatchEvent(new f.w.Event("error")); img.dispatchEvent(new f.w.Event("error"));
  assert.equal(img.src, "https://www.figma.com/community/resource/one/icon");
});

test("broken cached icons refresh metadata once and update cached recent icons", async t => {
  const data = seed(); data.plugins[0].icon = "https://www.figma.com/expired/icon";
  let calls = 0;
  const f = fixture(t, data, async () => { calls++; return response({ meta: [{ content: { plugin: { id: "1", name: "Plugin 1", direct_icon_url: "https://cdn.figma.com/new.png" } } }], pagination: {} }); });
  f.root().querySelector(".icon img").dispatchEvent(new f.w.Event("error")); await tick();
  assert.equal(calls, 1); assert.equal(f.root().querySelector(".icon img").src, "https://cdn.figma.com/new.png");
  f.root().querySelector(".icon img").dispatchEvent(new f.w.Event("error")); await tick(); assert.equal(calls, 1);
  f.w.localStorage.setItem("recent-plugins-figma-design", JSON.stringify([{ id: "2" }]));
  f.w.fetch = async url => response(new URL(url).pathname.endsWith("batch") ? { meta: [{ id: "2", name: "Plugin 2", direct_icon_url: "https://cdn.figma.com/recent.png" }] } : { meta: [], pagination: {} });
  await f.w.__figboostPluginSidebar.refresh();
  assert.equal(f.saved().plugins.find(p => p.id === "2").icon, "https://cdn.figma.com/recent.png");
});

test("sidebar wheel scrolls its own pane and never reaches canvas or browser zoom", t => {
  const f = fixture(t); f.click("FigBoost 插件侧边栏");
  let canvasWheels = 0; f.w.document.addEventListener("wheel", () => canvasWheels++);
  const list = f.root().querySelector(".action-list"), groups = f.root().querySelector(".group-list");
  function wheel(target, options) { const event = new f.w.WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true, composed: true, ...options }); target.dispatchEvent(event); return event; }
  assert.equal(wheel(list.querySelector(".name")).defaultPrevented, true); assert.equal(list.scrollTop, 120);
  wheel(list, { deltaY: 2, deltaMode: 1, ctrlKey: true }); assert.equal(list.scrollTop, 152);
  wheel(groups, { deltaY: 40 }); assert.equal(groups.scrollTop, 40); assert.equal(list.scrollTop, 152);
  wheel(f.root().querySelector(".header")); assert.equal(list.scrollTop, 272); assert.equal(canvasWheels, 0);
  const outside = wheel(f.w.document.body); assert.equal(outside.defaultPrevented, false); assert.equal(canvasWheels, 1);
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

test("switching to a direct plugin closes the previous command chooser", async t => {
  const data = seed(); data.plugins[0].commands = [{ name: "Open", command: "open" }];
  const f = fixture(t, data), w = f.w;
  const native = w.document.createElement("button"); native.setAttribute("aria-label", "Run Plugin 2"); w.document.body.append(native);
  f.click("FigBoost 插件侧边栏"); f.click("运行 Plugin 1");
  assert.equal(f.root().querySelector(".editor").hidden, false);
  f.click("运行 Plugin 2"); await tick();
  assert.equal(f.root().querySelector(".editor").hidden, true);
});

test("launch follows controlled submenus, ignores stale names and matches localized labels with shortcuts", async t => {
  const data = seed(); data.plugins[0].commands = [{ name: "Open", command: "open" }];
  const f = fixture(t, data), w = f.w; let runs = 0, wrong = 0;
  function pane(id) { const p = w.document.createElement("div"); p.id = id; p.role = "menu"; w.document.body.append(p); return p; }
  function item(p, name, action, next) {
    const e = w.document.createElement("div"); e.role = "menuitem";
    const text = w.document.createElement("span"); text.textContent = name; e.append(text);
    if (name === "打开") { text.firstChild.__figmaZhOriginalText = "Open"; text.firstChild.__figmaZhTranslatedText = "打开"; }
    if (name === "Plugin 1") { const shortcut = w.document.createElement("span"); shortcut.textContent = "Ctrl+Alt+1"; e.append(shortcut); }
    if (next) { e.setAttribute("aria-controls", next); e.setAttribute("aria-expanded", "false"); }
    e.onclick = () => { if (next) e.setAttribute("aria-expanded", "true"); action(); }; p.append(e); return e;
  }
  item(pane("stale"), "Open", () => wrong++);
  w.document.querySelector("button").onclick = () => item(pane("main"), "Plugins", () =>
    item(pane("plugins"), "Saved plugins", () => item(pane("saved"), "Plugin 1", () =>
      item(pane("commands"), "打开", () => runs++), "commands"), "saved"), "plugins");
  f.click("FigBoost 插件侧边栏"); f.click("运行 Plugin 1"); f.click("运行命令 Open");
  await tick(); await tick();
  assert.equal(runs, 1); assert.equal(wrong, 0); assert.deepEqual(f.saved().recent, ["1"]);
});

test("failed launch closes native menus outside the shadow root and allows a clean retry", async t => {
  const data = seed(); data.plugins[1].commands = [{ name: "Open", command: "open" }];
  const f = fixture(t, data), w = f.w, main = w.document.querySelector("button"); let escapes = 0, runs = 0;
  main.onclick = () => main.setAttribute("aria-expanded", main.getAttribute("aria-expanded") === "true" ? "false" : "true");
  w.document.body.addEventListener("keydown", e => { if (e.key === "Escape") { escapes++; main.setAttribute("aria-expanded", "false"); } });
  f.click("FigBoost 插件侧边栏"); f.root().querySelector("input").focus(); f.click("运行 Plugin 1");
  await new Promise(r => setTimeout(r, 1900));
  assert.equal(escapes, 1); assert.equal(main.getAttribute("aria-expanded"), "false");
  assert.match(f.status(), /插件入口/); assert.deepEqual(f.saved().recent, []);
  f.click("运行 Plugin 2");
  assert.equal(f.root().querySelector('[role="status"]').dataset.error, "false");
  assert.equal(f.root().querySelector(".editor").hidden, false);
  const native = w.document.createElement("button"); native.setAttribute("aria-label", "Run Plugin 1"); native.onclick = () => runs++; w.document.body.append(native);
  f.click("运行 Plugin 1"); await tick(); assert.equal(runs, 1); assert.deepEqual(f.saved().recent, ["1"]);
});
