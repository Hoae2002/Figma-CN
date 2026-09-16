"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { JSDOM } = require("jsdom");
const P = require("../payload/src/shared/translation-policy.js");
function fixture(t, html, custom = {}, exact = {}, pageUrl = "https://www.figma.com/design/test") {
  const dom = new JSDOM(html, { url: pageUrl, pretendToBeVisual: true, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  for (const f of ["shared/translation-policy.js", "content/localizer-core.js", "content/translation-runtime.js"]) w.eval(fs.readFileSync(path.join(__dirname, "../payload/src", f), "utf8"));
  const runtime = w.__FIGBOOST_TRANSLATION_RUNTIME__;
  const localizer = w.FigmaZhLocalizer.createLocalizer({ exact, phrases: [], uiTerms: {}, commonTerms: {}, patterns: [] }, {
    allowElement: runtime.allowElement,
    allowProtectedElement: runtime.allowProtectedElement,
    resolveTranslation: runtime.resolveTranslation
  });
  runtime.bind(localizer);
  const snapshot = { schema: 3, revision: 1, settings: { enabled: true, communityOnline: true }, learned: {}, ...custom };
  runtime.apply(snapshot);
  return { w, runtime, localizer, snapshot, document: w.document };
}
const tick = () => new Promise(r => setTimeout(r, 50));
test("reconnecting the same settings revision requeues requests and rejects old replies", async t => {
  const { document, runtime, snapshot } = fixture(t, '<div role="toolbar"><button>Save</button></div>', {}, {}, "https://www.figma.com/community");
  const first = runtime.drain().requests[0];
  runtime.apply(snapshot, true);
  const second = runtime.drain().requests[0];
  assert.ok(second.id > first.id);
  runtime.accept([{ id: first.id, entry: { ...first.c, translation: "旧结果" } }]);
  assert.equal(document.querySelector('button').textContent, 'Save');
  runtime.accept([{ id: second.id, entry: { ...second.c, translation: "保存" } }]);
  await tick();
  assert.equal(document.querySelector('button').textContent, '保存');
});
test("built-in dictionary wins over learned machine cache and does not request Google", t => {
  const k = P.key("Save", "toolbar", "button");
  const { document, runtime } = fixture(t, '<div role="toolbar"><button>Save</button></div>', { learned: { [k]: { text: "Save", region: "toolbar", context: "button", translation: "机器缓存" } } }, { Save: "保存" });
  assert.equal(document.querySelector("button").textContent, "保存"); assert.equal(runtime.drain().requests.length, 0);
});
test("unknown UI stays visible then uses learned translation; local offline reuse works", async t => {
  const { document, runtime, snapshot } = fixture(t, '<div role="toolbar"><button>New gizmo</button></div>', {}, {}, "https://www.figma.com/community");
  const button = document.querySelector("button"); assert.equal(button.textContent, "New gizmo"); assert.equal(button.closest("[data-figma-zh-pending]"), null);
  const job = runtime.drain().requests[0]; assert.ok(job);
  const entry = { ...job.c, translation: "新控件" }; runtime.accept([{ id: job.id, entry }]); await tick();
  assert.equal(button.textContent, "新控件");
  runtime.apply({ ...snapshot, revision: 2, learned: { [P.key(job.c.text, job.c.region, job.c.context)]: entry } });
  assert.equal(button.textContent, "新控件"); assert.equal(runtime.drain().requests.length, 0);
});
test("no editing events, input values, named content, canvas, code or plugin text are translated", async t => {
  const { document, runtime, w } = fixture(t, `<div role="toolbar"><input value="Default"><textarea>Default</textarea><div contenteditable="true">Default</div><span data-testid="component-name">Default</span><span data-testid="variable-name">Default</span><span data-testid="font-picker">Regular</span><div role="treeitem">Save</div><a href="/design/private">Save</a><code>Save</code><div data-testid="plugin-panel">Save</div><div data-testid="canvas">Save</div></div>`, {}, { Default: "默认", Save: "保存", Regular: "常规" });
  let events = 0; document.addEventListener("input", () => events++); document.addEventListener("change", () => events++);
  document.querySelector("input").dispatchEvent(new w.Event("blur")); await tick();
  assert.equal(events, 0); assert.equal(document.querySelector("input").value, "Default");
  for (const e of document.querySelectorAll("textarea,[contenteditable],[data-testid],a,code,[role=treeitem]")) assert.ok(!/[\u3400-\u9fff]/.test(e.textContent));
  assert.equal(runtime.drain().requests.length, 0);
});
test("response cannot overwrite reused or detached nodes", async t => {
  const { document, runtime } = fixture(t, '<div role="toolbar"><button>New gizmo</button><button>New widget</button></div>', {}, {}, "https://www.figma.com/community");
  const jobs = runtime.drain().requests, buttons = document.querySelectorAll("button");
  buttons[0].textContent = "Changed"; buttons[1].remove();
  runtime.accept(jobs.map(job => ({ id: job.id, entry: { ...job.c, translation: "错误覆盖" } }))); await tick();
  assert.equal(buttons[0].textContent, "Changed"); assert.equal(buttons[1].textContent, "New widget");
});
test("switch off during request invalidates responses and restores only our own current text", async t => {
  const { document, runtime, snapshot } = fixture(t, '<div role="toolbar"><button>Save</button><button>New gizmo</button></div>', {}, { Save: "保存" }, "https://www.figma.com/community");
  const jobs = runtime.drain().requests, buttons = document.querySelectorAll("button");
  buttons[0].firstChild.nodeValue = "Figma changed this";
  runtime.apply({ ...snapshot, revision: 2, settings: { ...snapshot.settings, enabled: false } });
  runtime.accept(jobs.map(job => ({ id: job.id, entry: { ...job.c, translation: "错误覆盖" } }))); await tick();
  assert.equal(buttons[0].textContent, "Figma changed this"); assert.equal(buttons[1].textContent, "New gizmo");
});
test("cached translations remain the fallback when the dictionary misses", t => {
  const k = P.key("Save", "community", "button");
  const { runtime, snapshot, document } = fixture(t, '<div role="toolbar"><button>Save</button></div>', { learned: { [k]: { translation: "缓存译文" } } }, {}, "https://www.figma.com/community");
  assert.equal(document.querySelector("button").textContent, "缓存译文");
  runtime.apply({ ...snapshot, revision: 2, settings: { ...snapshot.settings, enabled: false } });
  assert.equal(document.querySelector("button").textContent, "Save");
});
test("legacy exclusion fields no longer block dictionary translation", t => {
  const { document, runtime } = fixture(t, '<div role="toolbar"><button data-testid="save-action">Save</button></div>', {
    settings: { enabled: true, communityOnline: true, regions: { toolbar: "original" } },
    rules: [{ scope: "element", region: "toolbar", anchor: "save-action", text: "Save" }]
  }, { Save: "保存" });
  assert.equal(document.querySelector("button").textContent, "保存");
  assert.equal(runtime.drain().requests.length, 0);
});
test("user names matching system dictionary labels remain original", t => {
  const { document, runtime } = fixture(t, '<nav><span data-testid="file-title">Drafts</span><span data-testid="project-title">Recent</span><span data-testid="folder-name">Save</span></nav>', {}, { Drafts: "草稿", Recent: "最近", Save: "保存" });
  assert.equal(document.querySelector("nav").textContent, "DraftsRecentSave"); assert.equal(runtime.drain().requests.length, 0);
});
test("unknown dialog prose is not automatically treated as a safe UI label", t => {
  const { runtime } = fixture(t, '<div role="dialog"><p>Alice invited you to Private Workspace</p></div>');
  assert.equal(runtime.drain().requests.length, 0);
});

test('current Figma sidebar landmarks use only the built-in dictionary', t => {
  const {runtime, document} = fixture(t, `<body class="feature_flag_canvas_ui3"><section role="region" aria-label="Left sidebar"><button>Pages</button><div role="grid"><button>Private page</button></div><div role="treegrid"><button>Private layer</button></div><button aria-label="Private file, file name">Private file</button></section><section aria-label="Right sidebar"><h2>Position</h2><span>Selection colors</span><button>Share</button></section></body>`, {}, { Pages: "页面", Position: "位置", "Selection colors": "选区颜色", Share: "分享" });
  assert.equal(runtime.drain().requests.length, 0);
  assert.match(document.body.textContent, /页面/); assert.match(document.body.textContent, /位置/); assert.match(document.body.textContent, /选区颜色/); assert.match(document.body.textContent, /分享/);
});
test('right sidebar system headings translate while installed tool names stay original', t => {
  const {runtime, document} = fixture(t, `<section aria-label="Right sidebar">
    <div><div><h2>Page</h2></div><div>Page value</div></div>
    <div><div><h2>Style</h2></div><button>Add</button></div>
    <div><div><h2>Export</h2></div><button>Add export</button></div>
    <div data-testid="properties-section"><div><h2>Tools</h2><button aria-label="Add tool">+</button></div><div>
      <div role="listitem"><span>Chinese content filling assistant</span><button aria-label="Remove">-</button></div>
      <div role="listitem"><span>Create table</span><button aria-label="Remove">-</button></div>
      <div role="listitem"><span>IconPark</span><button aria-label="Remove">-</button></div>
      <div role="listitem"><span>Open noise and texture</span><button aria-label="Remove">-</button></div>
    </div></div>
  </section>`, {}, {
    Page: "页面", Style: "样式", Export: "导出", Tools: "工具",
    "Chinese content filling assistant": "错误译文一", "Create table": "错误译文二",
    IconPark: "错误译文三", "Open noise and texture": "错误译文四"
  });
  assert.equal(runtime.drain().requests.length, 0);
  for (const expected of ["页面", "样式", "导出", "工具"]) assert.ok(document.body.textContent.includes(expected), expected);
  for (const original of ["Chinese content filling assistant", "Create table", "IconPark", "Open noise and texture"]) {
    assert.ok(document.body.textContent.includes(original), original);
  }
  assert.ok(!document.body.textContent.includes("错误译文"));
});
test('font family values and dropdown options never enter either translation path', t => {
  const {runtime, document} = fixture(t, `<section aria-label="Right sidebar">
    <div><h2>Typography</h2>
      <button role="combobox" aria-label="Font family"><span>Source Han Sans CN</span></button>
      <button role="combobox"><span>Futura</span></button>
      <button role="combobox"><span>Medium</span></button><span>18</span>
    </div>
  </section><div role="listbox" aria-label="Font family"><div role="option">Noto Sans SC</div><div role="option">Acme Brand Sans</div></div>`, {}, {
    Typography: "排版", "Source Han Sans CN": "错误字体一", Futura: "错误字体二", "Noto Sans SC": "错误字体三", "Acme Brand Sans": "错误字体四"
  });
  assert.equal(runtime.drain().requests.length, 0);
  assert.ok(document.body.textContent.includes("排版"));
  for (const original of ["Source Han Sans CN", "Futura", "Noto Sans SC", "Acme Brand Sans"]) assert.ok(document.body.textContent.includes(original), original);
  assert.ok(!document.body.textContent.includes("错误字体"));
});
test('current floating menus, typography labels and search placeholders use the dictionary', t => {
  const {runtime, document} = fixture(t, `<section aria-label="Right sidebar"><div><h2>Typography</h2><button role="combobox" aria-label="Font family"><span>Source Han Sans CN</span></button><button role="combobox"><span>Medium</span></button><span>15</span><div>Alignment</div></div></section>
    <div role="menu"><button>Add min width…</button><button>Add max width…</button><button>Add min height…</button><button>Add max height…</button></div>
    <div class="library-popover"><input value="Private query" placeholder="Search"><p>No colors available</p></div>
    <div role="tooltip"><span>Fonts</span></div>`, {}, {
    Typography: "排版", Alignment: "对齐方式", Fonts: "字体", Search: "搜索", "No colors available": "没有可用颜色",
    "Add min width…": "添加最小宽度…", "Add max width…": "添加最大宽度…",
    "Add min height…": "添加最小高度…", "Add max height…": "添加最大高度…"
  });
  assert.equal(runtime.drain().requests.length, 0);
  for (const expected of ["排版", "对齐方式", "字体", "没有可用颜色", "添加最小宽度…", "添加最大宽度…", "添加最小高度…", "添加最大高度…"]) {
    assert.ok(document.body.textContent.includes(expected), expected);
  }
  const search = document.querySelector("input");
  assert.equal(search.placeholder, "搜索");
  assert.equal(search.value, "Private query");
  assert.ok(document.body.textContent.includes("Source Han Sans CN"));
});

test('current clipboard, navigation, variable, and category labels use the exact dictionary', t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const exact = Object.fromEntries([
    "Frame link copied to clipboard", "Go to folder", "Find...", "Variable collection", "Name", "Light",
    "Content generation", "Shaders", "Styling", "Format & resize", "Fun & creative", "Product & brand"
  ].map(source => [source, dictionary.exact[source]]));
  const {runtime, document} = fixture(t, `<section aria-label="Right sidebar">
      <h2>Variable collection</h2><div>Name</div><div>Light</div>
      <input value="Private query" placeholder="Find...">
    </section>
    <div role="menu"><a href="/design/private">Go to folder</a></div>
    <div role="tooltip">Frame link copied to clipboard</div>
    <div role="menu"><button>Content generation</button><button>Shaders</button><button>Styling</button><button>Format & resize</button><button>Fun & creative</button><button>Product & brand</button></div>`, {}, exact);

  assert.equal(runtime.drain().requests.length, 0);
  for (const expected of ["变量集合", "名称", "浅色", "转到文件夹", "画框链接已复制到剪贴板", "内容生成", "着色器", "样式", "格式与调整尺寸", "趣味与创意", "产品与品牌"]) {
    assert.ok(document.body.textContent.includes(expected), expected);
  }
  const search = document.querySelector("input");
  assert.equal(search.placeholder, "查找…");
  assert.equal(search.value, "Private query");
});

test('requested Figma commands remain translatable inside protected menu and dialog wrappers', t => {
  const exact = {
    "Go to folder": "转到文件夹",
    "Show/Hide comments": "显示/隐藏评论",
    "New widget...": "新建小部件…",
    "Import widget from manifest...": "从清单导入小部件…",
    "Permissions from folder Design Team": "权限继承自文件夹 Design Team",
    "People can access this file because they have access to Design Team.": "这些人员可以访问此文件，因为他们有权访问文件夹 Design Team。"
  };
  const {runtime, document} = fixture(t, `<div role="menu">
      <a href="/design/private">Go to folder</a>
      <button class="comment-action">Show/Hide comments</button>
      <button data-testid="plugin-widget-action">New widget...</button>
      <button data-testid="plugin-widget-import">Import widget from manifest...</button>
    </div>
    <div role="dialog" data-testid="folder-name-dialog">
      <h2>Permissions from folder Design Team</h2>
      <p>People can access this file because they have access to Design Team.</p>
    </div>`, {}, exact);

  assert.equal(runtime.drain().requests.length, 0);
  for (const expected of ["转到文件夹", "显示/隐藏评论", "新建小部件…", "从清单导入小部件…", "权限继承自文件夹 Design Team", "这些人员可以访问此文件，因为他们有权访问文件夹 Design Team。"]) {
    assert.ok(document.body.textContent.includes(expected), expected);
  }
});

test('the restored stable engine translates an ordinary rebuilt panel before its first frame', async t => {
  const { document, runtime } = fixture(t, '<main></main>', {}, { Save: "保存" });
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  for (let index = 0; index < 100; index += 1) {
    const button = document.createElement("button");
    button.textContent = "Save";
    menu.append(button);
  }
  document.body.append(menu);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal([...menu.querySelectorAll("button")].filter(button => button.textContent === "保存").length, 100);
  assert.equal(runtime.drain().requests.length, 0);
});
test('a newly rendered dictionary label is translated in the observer pre-paint slice', async t => {
  const { document } = fixture(t, '<main></main>', {}, { Position: "位置" });
  const panel = document.createElement("section");
  panel.setAttribute("aria-label", "Right sidebar");
  panel.innerHTML = "<span>Position</span>";
  document.body.append(panel);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(panel.textContent, "位置");
});
test('current Figma files page uses dictionary only and protects user file names', t => {
  const {runtime, document} = fixture(t, `<body class="feature_flag_canvas_ui3 feature_flag_new_canvas">
    <nav aria-label="Sidebar">
      <ul><li><button><span>Drafts</span></button></li><li><div><span>Community</span></div></li></ul>
      <section><button><i18n-text>Starred</i18n-text></button><div><button aria-description="Design file"><span>Private sidebar file</span></button></div></section>
    </nav>
    <div data-testid="file-browser-desktop-header"><h1><span>Recents</span></h1></div>
    <div role="tablist"><button role="tab"><span>Recently viewed</span></button></div>
    <div role="combobox"><span>All files</span></div>
    <main><div role="listitem"><div role="group" aria-label="Private card file"><h2>Private card file</h2><button aria-label="Add to Starred"></button></div></div></main>
  </body>`, {}, { Drafts: "草稿", Community: "社区", Starred: "已加星标", Recents: "最近", "Recently viewed": "最近查看", "All files": "所有文件" }, "https://www.figma.com/files/team/test/recents-and-sharing/recently-viewed");
  assert.equal(runtime.drain().requests.length, 0);
  for (const expected of ["草稿", "社区", "已加星标", "最近", "最近查看", "所有文件"]) assert.ok(document.body.textContent.includes(expected), expected);
  assert.ok(document.body.textContent.includes('Private sidebar file'));
  assert.ok(document.body.textContent.includes('Private card file'));
});
test("Community route owns Google requests and its switch preserves dictionary translation", t => {
  const { runtime, document, snapshot } = fixture(t, '<nav><button>Save</button><button>New design resource</button></nav>', {}, { Save: "保存" }, "https://www.figma.com/files/team/test/community");
  assert.equal(P.regionOf(document.querySelector("button")).toString(), "community");
  assert.equal(document.querySelectorAll("button")[0].textContent, "保存");
  assert.equal(runtime.drain().requests.length, 1);
  runtime.apply({ ...snapshot, revision: 2, settings: { ...snapshot.settings, communityOnline: false } });
  assert.equal(document.querySelectorAll("button")[0].textContent, "保存");
  assert.equal(document.querySelectorAll("button")[1].textContent, "New design resource");
  assert.equal(runtime.drain().requests.length, 0);
});
