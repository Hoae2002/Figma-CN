"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { JSDOM } = require("jsdom");
const P = require("../payload/src/shared/translation-policy.js");
function fixture(t, html, custom = {}, exact = {}, pageUrl = "https://www.figma.com/design/test", dictionaryOverrides = {}) {
  const dom = new JSDOM(html, { url: pageUrl, pretendToBeVisual: true, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  // Content assertions use a deterministic clock. Budget tests below advance it
  // explicitly; jsdom selector/style timings do not represent Chromium frames.
  w.performance.now = () => 0;
  for (const f of ["shared/translation-policy.js", "content/localizer-core.js", "content/translation-runtime.js"]) w.eval(fs.readFileSync(path.join(__dirname, "../payload/src", f), "utf8"));
  const runtime = w.__FIGBOOST_TRANSLATION_RUNTIME__;
  const localizer = w.FigmaZhLocalizer.createLocalizer({ exact, phrases: [], uiTerms: {}, commonTerms: {}, patterns: [], ...dictionaryOverrides }, {
    beginBatch: runtime.beginBatch,
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

test("single and multiple page selection menus translate ordering actions while page names stay original", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const labels = ["Move up", "Move down", "Move to top", "Move to bottom"];
  const expected = ["上移", "下移", "移至顶部", "移至底部"];
  const { document } = fixture(t, `<aside aria-label="Left sidebar">${labels.map(label => `<div data-testid="page-name">${label}</div>`).join("")}</aside>
    <div role="menu"><div role="menuitem">Rename page</div>${labels.map(label => `<div role="menuitem"><i18n-text>${label}</i18n-text></div>`).join("")}</div>`,
    {}, dictionary.exact, "https://www.figma.com/design/test", dictionary);
  const menu = document.querySelector('[role="menu"]');
  assert.deepEqual([...menu.querySelectorAll('i18n-text')].map(e => e.textContent), expected);
  menu.innerHTML = `<div role="menuitem">Rename 7 pages</div>${labels.map(label => `<div role="menuitem"><i18n-text>${label}</i18n-text></div>`).join("")}`;
  await tick();
  assert.deepEqual([...menu.querySelectorAll('i18n-text')].map(e => e.textContent), expected);
  assert.deepEqual([...document.querySelectorAll('[data-testid="page-name"]')].map(e => e.textContent), labels);
});

test("admin drafts and settings translate system headings and split upgrade prose without changing names", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const upgrade = "Upgrade to the Professional plan or to an Organization and get access to shared team libraries, advanced security features and";
  const description = "Connect GitHub to link your repositories to your design components, improve MCP results, and clone repositories for editing.";
  for (const [route, title] of [["drafts", "Unassigned drafts"], ["settings", "Settings"]]) {
    const { document, snapshot, runtime } = fixture(t, `<main>
      <div data-testid="admin-settings-header"><h1><i18n-text>${title}</i18n-text></h1></div>
      <section data-testid="settings-section-Plan"><h2><div>Plan</div></h2><i18n-text>${upgrade} <a href="/pricing"><i18n-text>more…</i18n-text></a></i18n-text></section>
      <section data-testid="settings-section-Resources"><h2><div>Resources</div></h2></section>
      <h1>${title}</h1><h2>Plan</h2><h2>Resources</h2><h2 data-testid="folder-name">${title}</h2>
      <span>MCP connectors in Figma</span><span>Let users connect third-party MCP servers to bring tools and context into Figma</span>
      </main><div role="dialog" aria-labelledby="github-title"><h2 id="github-title">GitHub</h2><h2>Connected accounts</h2>
      <p>${description}</p><p>Upgrade plan to add more GitHub accounts</p><p>Your current plan supports one account only.</p>
      <h2>Hoae2002</h2><span>Connected since Jun 4, 2026</span><button>Manage in GitHub</button><button>Remove from Figma</button></div>`,
      {}, dictionary.exact, `https://www.figma.com/files/team/test/team-admin-console/${route}`, dictionary);
    assert.equal(document.querySelector('[data-testid="admin-settings-header"] h1').textContent, dictionary.exact[title]);
    assert.equal(document.querySelector('main > h1').textContent, title);
    assert.equal(document.querySelector('[data-testid="folder-name"]').textContent, title);
    assert.equal(document.querySelector('main > h2').textContent, "Plan");
    assert.equal(document.querySelector('[role="dialog"] h2:last-of-type').textContent, "Hoae2002");
    if (route === "settings") {
      assert.equal(document.querySelector('[data-testid="settings-section-Plan"] h2').textContent, "套餐");
      assert.equal(document.querySelector('[data-testid="settings-section-Resources"] h2').textContent, "资源");
      assert.equal(document.querySelector('[data-testid="settings-section-Plan"] > i18n-text').textContent, "升级到专业版或组织版套餐，以使用共享团队库、高级安全功能以及 更多…");
      assert.equal(document.querySelector('[role="dialog"] h2:nth-of-type(2)').textContent, "已连接账户");
    } else {
      assert.equal(document.querySelector('[data-testid="settings-section-Plan"] h2').textContent, "Plan");
      assert.equal(document.querySelector('[role="dialog"] h2:nth-of-type(2)').textContent, "Connected accounts");
    }
    for (const element of document.querySelectorAll('main > span,[role="dialog"] p')) {
      assert.ok(Object.values(dictionary.exact).includes(element.textContent));
    }
    assert.equal(document.querySelector('[role="dialog"] > span').textContent, "连接于 2026 年 6 月 4 日");
    assert.deepEqual([...document.querySelectorAll('[role="dialog"] button')].map(e => e.textContent), ["在 GitHub 中管理", "从 Figma 移除"]);
    runtime.apply({ ...snapshot, revision: 2, settings: { ...snapshot.settings, enabled: false } });
    assert.equal(document.querySelector('[data-testid="admin-settings-header"] h1').textContent, title);
  }
});

test("admin member labels translate while names and unrelated headings stay original", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const labels = ["Education status", "Verified", "Unverified", "Unverified users", "Limited access", "Joined", "Joined prior to tracking"];
  const { document, localizer } = fixture(t, `<main><div data-testid="admin-settings-header"><h1><i18n-text>People</i18n-text></h1></div>
    <h1>People</h1><h2>Filter</h2><h2 data-testid="folder-name">People</h2>
    ${labels.map(s => `<span>${s}</span>`).join("")}
    <span data-testid="team-name">Design Team</span><span data-testid="file-name">Verified</span>
    <input value="People"><button>Remove from Design Team</button><button>Remove from 振易科技</button></main>
    <div data-testid="table-filter-popover"><h2>Filter</h2><span>Unverified users</span></div>`, {}, dictionary.exact,
    "https://www.figma.com/files/team/test/team-admin-console/members", dictionary);
  assert.equal(document.querySelector('[data-testid="admin-settings-header"] h1').textContent, "成员");
  assert.equal(document.querySelector('[data-testid="table-filter-popover"] h2').textContent, "筛选");
  labels.forEach((s, i) => assert.equal(document.querySelectorAll('main > span')[i].textContent, dictionary.exact[s]));
  assert.equal(document.querySelector('main > h1').textContent, "People");
  assert.equal(document.querySelector('main > h2').textContent, "Filter");
  assert.equal(document.querySelector('[data-testid="folder-name"]').textContent, "People");
  assert.equal(document.querySelector('[data-testid="team-name"]').textContent, "Design Team");
  assert.equal(document.querySelector('[data-testid="file-name"]').textContent, "Verified");
  assert.equal(document.querySelector('input').value, "People");
  assert.deepEqual([...document.querySelectorAll('button')].map(e => e.textContent), ["从 Design Team 移除", "从 振易科技 移除"]);
  document.querySelector('[data-testid="admin-settings-header"] h1').innerHTML = '<i18n-text>People</i18n-text>';
  await tick();
  assert.equal(document.querySelector('[data-testid="admin-settings-header"] h1').textContent, "成员");
  localizer.stop();
});
test("file browser system dialog titles translate without exposing same-named user headings", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const titles = ["Settings", "Edit description", "Upload Font", "Change view history preference"];
  const html = titles.map((title, index) => `<div role="dialog" aria-labelledby="dialog-title-${index}">
    <h2 id="dialog-title-${index}"><i18n-text>${title}</i18n-text></h2>
    <h2 data-testid="folder-name">${title}</h2><h2>${title}</h2>
    <input value="${title}"><textarea>${title}</textarea>
  </div><main><h2>${title}</h2></main>`).join("");
  const { document, runtime, localizer, snapshot } = fixture(t, html, {}, dictionary.exact,
    "https://www.figma.com/files/team/test/all-folders", dictionary);
  titles.forEach((title, index) => assert.equal(document.getElementById(`dialog-title-${index}`).textContent, dictionary.exact[title]));
  for (const element of document.querySelectorAll('h2:not([id]),textarea')) assert.ok(titles.includes(element.textContent));
  for (const element of document.querySelectorAll('input')) assert.ok(titles.includes(element.value));
  document.getElementById('dialog-title-0').innerHTML = '<i18n-text>Settings</i18n-text>';
  localizer.enqueue(document.getElementById('dialog-title-0'));
  await tick();
  assert.equal(document.getElementById('dialog-title-0').textContent, "设置");
  assert.equal(runtime.drain().requests.length, 0);
  runtime.apply({ ...snapshot, revision: 2, settings: { ...snapshot.settings, enabled: false } });
  titles.forEach((title, index) => assert.equal(document.getElementById(`dialog-title-${index}`).textContent, title));
});

test("reconnecting the same settings revision requeues requests and rejects old replies", async t => {
  const { document, runtime, snapshot } = fixture(t, '<div role="toolbar"><button>Save</button></div>', {}, {}, "https://www.figma.com/community");
  const first = runtime.drain().requests[0];
  runtime.apply(snapshot, true);
  await tick();
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
test("folder card timestamps translate split i18n text without changing protected card content", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const times = ["1 minute ago", "19 hours ago", "5 days ago", "25 days ago", "4 months ago", "9 months ago", "just now"];
  const { document, runtime, localizer, snapshot } = fixture(t, `<main>${times.map((time, index) => `
    <div role="group" aria-label="Updated 4 months ago">
      <button data-card-main-action aria-label="Updated 4 months ago"></button>
      <h2>Updated 4 months ago</h2>
      <button aria-description="Design file"><i18n-text>Updated <span>${time}</span></i18n-text></button>
      <span data-testid="folder-name"><i18n-text>Updated ${time}</i18n-text></span>
      <span data-fpl-sr-only="true">Updated 4 months ago, </span>
      <i18n-text data-timestamp="${index}">Updated <span>${time}</span></i18n-text>
      <i18n-text data-whole>Updated ${time}</i18n-text>
    </div>`).join("")}</main>`, {}, {}, "https://www.figma.com/files/team/test/all-folders", dictionary);
  const labels = [...document.querySelectorAll("[data-timestamp]")];
  const expected = ["已更新 1 分钟前", "已更新 19 小时前", "已更新 5 天前", "已更新 25 天前", "已更新 4 个月前", "已更新 9 个月前", "已更新 刚刚"];
  assert.deepEqual(labels.map(label => label.textContent), expected);
  assert.deepEqual([...document.querySelectorAll("[data-whole]")].map(label => label.textContent),
    ["1 分钟前更新", "19 小时前更新", "5 天前更新", "25 天前更新", "4 个月前更新", "9 个月前更新", "刚刚更新"]);
  labels[0].querySelector("span").textContent = "2 minutes ago";
  await tick();
  assert.equal(labels[0].textContent, "已更新 2 分钟前");
  localizer.enqueue(document.body);
  await tick();
  for (const card of document.querySelectorAll("[role=group]")) {
    assert.equal(card.getAttribute("aria-label"), "Updated 4 months ago");
    assert.equal(card.querySelector("h2").textContent, "Updated 4 months ago");
    assert.equal(card.querySelector("[data-fpl-sr-only]").textContent, "Updated 4 months ago, ");
    assert.ok(card.querySelector("[aria-description]").textContent.startsWith("Updated "));
    assert.ok(card.querySelector("[data-testid]").textContent.startsWith("Updated "));
  }
  assert.equal(runtime.drain().requests.length, 0);
  runtime.apply({ ...snapshot, revision: 2, settings: { enabled: false, communityOnline: false } });
  assert.equal(labels[0].textContent, "Updated 2 minutes ago");
  assert.deepEqual(labels.slice(1).map(label => label.textContent), times.slice(1).map(time => `Updated ${time}`));
  runtime.apply({ ...snapshot, revision: 3 });
  assert.deepEqual(labels.slice(1).map(label => label.textContent), expected.slice(1));
});

test("file browser metadata translates whole and split labels across redraws and mode changes", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const times = ["1 second ago", "9 minutes ago", "18 hours ago", "22 days ago", "2 weeks ago", "1 month ago", "2 months ago", "1 year ago", "just now", "yesterday"];
  const translated = ["1 秒前", "9 分钟前", "18 小时前", "22 天前", "2 周前", "1 个月前", "2 个月前", "1 年前", "刚刚", "昨天"];
  for (const [action, prefix, suffix, route] of [
    ["Edited", "编辑于", "编辑", "folder/123"],
    ["Edited", "编辑于", "编辑", "drafts"],
    ["Viewed", "查看于", "查看", "recents-and-sharing/recently-viewed"],
    ["Trashed by you", "由你删除于", "由你删除", "trashed"]
  ]) {
    const { document, runtime, localizer, snapshot } = fixture(t, `<main>${times.map(time => `
      <div role="group" aria-label="${action} ${time}">
        <button data-card-main-action aria-label="${action} ${time}"></button>
        <h2><i18n-text>${action} ${time}</i18n-text></h2>
        <span class="generic_tile_title_contents--itemsViewTitle--test"><i18n-text>${action} ${time}</i18n-text></span>
        <i18n-text data-whole>${action} ${time}</i18n-text>
        <i18n-text data-split>${action} <span>${time}</span></i18n-text>
      </div>`).join("")}</main>`, {}, {}, `https://www.figma.com/files/team/test/${route}`, dictionary);
    const whole = [...document.querySelectorAll("[data-whole]")];
    const split = [...document.querySelectorAll("[data-split]")];
    assert.deepEqual(whole.map(e => e.textContent), translated.map(time => `${time}${suffix}`), route);
    assert.deepEqual(split.map(e => e.textContent), translated.map(time => `${prefix} ${time}`), route);
    split[0].querySelector("span").textContent = "2 years ago";
    whole[0].textContent = `${action} 2 years ago`;
    await tick();
    localizer.enqueue(document.body);
    await tick();
    assert.equal(split[0].textContent, `${prefix} 2 年前`);
    assert.equal(whole[0].textContent, `2 年前${suffix}`);
    for (const [index, card] of [...document.querySelectorAll("[role=group]")].entries()) {
      const name = `${action} ${times[index]}`;
      assert.equal(card.getAttribute("aria-label"), name);
      assert.equal(card.querySelector("button").getAttribute("aria-label"), name);
      assert.equal(card.querySelector("h2").textContent, name);
      assert.equal(card.querySelector("[class]").textContent, name);
    }
    assert.equal(runtime.drain().requests.length, 0);
    runtime.apply({ ...snapshot, revision: 2, settings: { enabled: false, communityOnline: false } });
    assert.equal(split[0].textContent, `${action} 2 years ago`);
    assert.equal(whole[0].textContent, `${action} 2 years ago`);
    runtime.apply({ ...snapshot, revision: 3 });
    assert.equal(split[0].textContent, `${prefix} 2 年前`);
    assert.equal(whole[0].textContent, `2 年前${suffix}`);
  }
});

test("trash title is scoped to its system route while list names and metadata stay separate", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const { w, document, localizer, runtime } = fixture(t, `
    <h1><span>Trash</span></h1><h2>Trash</h2><h1><button>Trash</button></h1>
    <div data-testid="folder-name"><h1>Trash</h1></div>
    <button role="combobox">All types</button><button role="tab">Shared folders</button>
    <main><table><tbody>${["Untitled", "Trash", "All types", "Shared folders", "Edited 1 year ago"].map(name => `
      <tr><td><button data-card-main-action aria-label="${name}, Design file"></button></td>
      <td><div class="generic_tile_title_contents--itemsViewTitle--kn9Ur"><span>${name}</span></div></td>
      <td><span>1 year ago</span></td></tr>`).join("")}</tbody><thead><tr><th>Trashed</th><th>Previous Location</th></tr></thead></table>
      <h1>Trash</h1></main>`, {}, {}, "https://www.figma.com/files/team/test/trashed", dictionary);
  assert.equal(document.querySelector("h1").textContent, "回收站");
  assert.equal(document.querySelector("h2").textContent, "Trash");
  assert.equal(document.querySelector("h1 button").textContent, "Trash");
  assert.equal(document.querySelector("[data-testid]").textContent, "Trash");
  assert.equal(document.querySelector("main h1").textContent, "Trash");
  assert.equal(document.querySelector("[role=combobox]").textContent, "所有类型");
  assert.equal(document.querySelector("[role=tab]").textContent, "共享文件夹");
  assert.deepEqual([...document.querySelectorAll("td:nth-child(2)")].map(e => e.textContent),
    ["Untitled", "Trash", "All types", "Shared folders", "Edited 1 year ago"]);
  assert.ok([...document.querySelectorAll("td:nth-child(3)")].every(e => e.textContent === "1 年前"));
  assert.equal(document.querySelector("th").textContent, "删除时间");
  assert.equal(document.querySelectorAll("th")[1].textContent, "原位置");
  w.history.pushState({}, "", "/files/team/test/folder/123");
  document.querySelector("h1 span").textContent = "Trash";
  localizer.enqueue(document.body);
  await tick();
  assert.equal(document.querySelector("h1").textContent, "Trash");
  assert.equal(runtime.drain().requests.length, 0);
});

test("shared file sender labels translate the prefix without translating captured or split names", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const html = `<main>${["Save", "JIU", "Richard", "过期的荷尔蒙", "Shared folders"].map(name => `
    <div role="group" aria-label="From ${name}"><h2><i18n-text>From ${name}</i18n-text></h2>
    <i18n-text data-whole>From ${name}</i18n-text><i18n-text data-split>From <span>${name}</span></i18n-text></div>`).join("")}</main>`;
  const { document, runtime, localizer } = fixture(t, html, {}, {},
    "https://www.figma.com/files/team/test/recents-and-sharing/shared-with-you", dictionary);
  const names = ["Save", "JIU", "Richard", "过期的荷尔蒙", "Shared folders"];
  for (const selector of ["[data-whole]", "[data-split]"]) {
    assert.deepEqual([...document.querySelectorAll(selector)].map(e => e.textContent), names.map(name => `来自 ${name}`));
  }
  localizer.enqueue(document.body);
  await tick();
  assert.deepEqual([...document.querySelectorAll("h2")].map(e => e.textContent), names.map(name => `From ${name}`));
  assert.deepEqual([...document.querySelectorAll("[data-split] span")].map(e => e.textContent), names);
  assert.equal(runtime.drain().requests.length, 0);
  const outside = fixture(t, html, {}, {}, "https://www.figma.com/files/team/test/drafts", dictionary);
  assert.deepEqual([...outside.document.querySelectorAll("[data-whole]")].map(e => e.textContent), names.map(name => `From ${name}`));
});

test("resources system heading translates only on its own routes", t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  for (const route of ["resources/internal", "resources/community", "folder/123"]) {
    const { document } = fixture(t, `<h1>Resources</h1><h1><button>Resources</button></h1>
      <span data-testid="folder-name"><h1>Resources</h1></span><main><h2>Resources</h2></main>`,
      {}, {}, `https://www.figma.com/files/team/test/${route}`, dictionary);
    assert.equal(document.querySelector("h1").textContent, route.startsWith("resources/") ? "资源" : "Resources");
    assert.equal(document.querySelector("button").textContent, "Resources");
    assert.equal(document.querySelector("[data-testid]").textContent, "Resources");
    assert.equal(document.querySelector("h2").textContent, "Resources");
  }
});

test("timestamp exception cannot translate arbitrary card prose, headings or non-file routes", t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const html = `<main><div role="group" aria-label="Private folder">
    <h2><i18n-text>Updated <span>4 months ago</span></i18n-text></h2>
    <span>Updated 4 months ago</span>
    <i18n-text>Updated private roadmap</i18n-text>
    <i18n-text>Edited private roadmap</i18n-text>
    <i18n-text>Trashed by Alice 2 months ago</i18n-text>
    <i18n-text>Viewed private roadmap</i18n-text>
    <a href="/design/private"><i18n-text>Updated 4 months ago</i18n-text></a>
  </div></main>`;
  for (const url of ["https://www.figma.com/files/team/test/all-folders", "https://www.figma.com/design/test", "https://www.figma.com/files/team/test/community"]) {
    const { document, runtime } = fixture(t, html, {}, {}, url, dictionary);
    assert.equal(document.querySelector("h2").textContent, "Updated 4 months ago", url);
    assert.equal(document.querySelector("span:not(h2 span)").textContent, "Updated 4 months ago", url);
    assert.ok(document.body.textContent.includes("Updated private roadmap"), url);
    assert.ok(document.body.textContent.includes("Edited private roadmap"), url);
    assert.ok(document.body.textContent.includes("Trashed by Alice 2 months ago"), url);
    assert.ok(document.body.textContent.includes("Viewed private roadmap"), url);
    assert.equal(document.querySelector("a").textContent, "Updated 4 months ago", url);
    assert.equal(runtime.drain().requests.length, 0, url);
  }
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

test("page names stay original with the full dictionary, repeated scans and translated landmarks", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const { document, runtime, localizer, snapshot } = fixture(t, `<section aria-label="Left sidebar">
    <button>Pages</button><div role="grid"><div role="row"><span title="Page 29">Page 29</span></div><div>Design</div></div>
    <div data-testid="page-name">Save</div><div class="pages_panel--pageName--abc">Drafts</div>
    <div class="pages_panel--pageRow--abc"><span>Linear</span></div>
  </section><section aria-label="Right sidebar"><h2>Position</h2></section>`, {}, {}, undefined, dictionary);
  const left = document.querySelector("section");
  assert.equal(left.getAttribute("aria-label"), "Left sidebar");
  assert.equal(left.querySelector("button").textContent, "页面");
  assert.equal(document.querySelector("h2").textContent, "位置");
  left.setAttribute("aria-label", "左侧边栏");
  localizer.enqueue(document.body);
  await tick();
  runtime.apply({ ...snapshot, revision: 2 });
  for (const [selector, text] of [["[title]", "Page 29"], ["[role=grid]", "Page 29Design"], ["[data-testid]", "Save"], ["[class*=pageName]", "Drafts"], ["[class*=pageRow]", "Linear"]]) {
    assert.equal(left.querySelector(selector).textContent, text, selector);
  }
  assert.equal(left.querySelector("[title]").title, "Page 29");
  assert.equal(runtime.drain().requests.length, 0);
});

test("attribute-only updates never rescan a panel's descendant text", async t => {
  const { document, localizer } = fixture(t, '<section aria-label="Right sidebar"><button>Save</button><span>Unknown label</span></section>', {}, { Save: "保存", Position: "位置" });
  await tick();
  const before = localizer.getStats().processedNodes;
  const section = document.querySelector("section");
  section.setAttribute("title", "Position");
  section.setAttribute("aria-label", "Right sidebar");
  await tick();
  assert.equal(section.title, "位置");
  assert.equal(localizer.getStats().processedNodes, before);
  assert.equal(section.querySelector("button").textContent, "保存");
});

test("same-mode snapshots, reconnections and editor routes preserve translated text without restore writes", async t => {
  const { w, document, runtime, localizer, snapshot } = fixture(t, '<div role="toolbar"><button>Save</button></div>', {}, { Save: "保存" });
  await tick();
  const writes = [];
  const observer = new w.MutationObserver(records => writes.push(...records));
  observer.observe(document.body, { subtree: true, characterData: true, characterDataOldValue: true });
  const before = localizer.getStats().processedNodes;
  for (let revision = 2; revision < 20; revision++) runtime.apply({ ...snapshot, revision });
  localizer.start(document.body);
  assert.equal(localizer.getStats().processedNodes, before);
  runtime.apply(snapshot, true);
  w.history.replaceState({}, "", "/design/another");
  runtime.apply({ ...snapshot, revision: 20 });
  await tick();
  assert.equal(document.querySelector("button").textContent, "保存");
  assert.equal(writes.length, 0);
  observer.disconnect();
});

test("a mutation burst shares one time budget and resumes before paint without hiding the panel", async t => {
  const { w, document, localizer } = fixture(t, "<main></main>", {}, { Save: "保存" });
  let clock = 0;
  w.performance.now = () => clock++;
  const frames = [];
  w.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  w.cancelAnimationFrame = () => {};
  // More than one root in the same observer delivery used to bypass batching.
  for (let index = 0; index < 100; index++) {
    const button = document.createElement("button");
    button.textContent = "Save";
    document.querySelector("main").append(button);
  }
  await Promise.resolve();
  await Promise.resolve();
  const translatedCount = () => [...document.querySelectorAll("button")].filter(button => button.textContent === "保存").length;
  assert.ok(translatedCount() > 0 && translatedCount() < 100);
  assert.equal(document.querySelector("[data-figma-zh-pending]"), null);
  assert.equal(frames.length, 1);
  for (let attempts = 0; localizer.getStats().queueSize && attempts < 200; attempts++) {
    const frame = frames.shift();
    assert.ok(frame);
    frame();
    assert.ok(localizer.getStats().lastBatchMs <= 11);
    await Promise.resolve();
  }
  assert.equal(localizer.getStats().queueSize, 0);
  assert.equal(translatedCount(), 100);
  // Figma can recycle a translated text node back to its English source.
  document.querySelector("button").firstChild.nodeValue = "Save";
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(document.querySelector("button").textContent, "保存");
});

test("canvas subtrees are pruned and disabled queues cannot write after a scheduled frame", async t => {
  const { w, document, localizer, runtime, snapshot } = fixture(t, "<main></main>", {}, { Save: "保存" });
  const visitedBefore = localizer.getStats().processedNodes;
  const canvas = document.createElement("div");
  canvas.setAttribute("data-testid", "canvas");
  canvas.innerHTML = "<span>Save</span>".repeat(1000);
  document.querySelector("main").append(canvas);
  await tick();
  assert.equal(localizer.getStats().processedNodes, visitedBefore);
  let canceled = null, frame;
  w.requestAnimationFrame = callback => { frame = callback; return 123; };
  w.cancelAnimationFrame = handle => { canceled = handle; };
  localizer.enqueue(document.body);
  runtime.apply({ ...snapshot, revision: 2, settings: { ...snapshot.settings, enabled: false } });
  assert.equal(canceled, 123);
  frame();
  assert.equal(canvas.querySelector("span").textContent, "Save");
  assert.equal(localizer.getStats().queueSize, 0);
});

test("tool-section protection refreshes when a property panel is reused", async t => {
  const { document } = fixture(t, '<section aria-label="Right sidebar"><h2>Position</h2><div role="listitem"><span>Save</span></div></section>', {}, { Position: "位置", Tools: "工具", Save: "保存", Export: "导出" });
  assert.equal(document.querySelector("span").textContent, "保存");
  document.querySelector("h2").textContent = "Tools";
  document.querySelector("span").textContent = "Save";
  await tick();
  assert.equal(document.querySelector("h2").textContent, "工具");
  assert.equal(document.querySelector("span").textContent, "Save");
  document.querySelector("h2").textContent = "Position";
  document.querySelector("span").textContent = "Export";
  await tick();
  assert.equal(document.querySelector("span").textContent, "导出");
});

test("file browser timestamps translate without measuring static rows as tooltips", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const { w, document } = fixture(t, '<main></main>', {}, {},
    'https://www.figma.com/files/team/test/recents-and-sharing/recently-viewed', dictionary);
  w.getComputedStyle = () => { assert.fail('static file metadata must not trigger style or layout reads after each text write'); };
  w.Element.prototype.getBoundingClientRect = () => { assert.fail('static file rows must not force layout'); };
  document.querySelector('main').innerHTML = '<table><tbody>' + Array.from({ length: 18 }, () =>
    '<tr><td><span class="generic_tile_title_contents--itemsViewTitle--test">2 months ago</span></td>' +
    '<td><span>2 months ago</span></td><td><span>1 year ago</span></td></tr>').join('') + '</tbody></table>' +
    '<div role="group" aria-label="Private file"><h2>Private file</h2><i18n-text>Edited <span>2 months ago</span></i18n-text></div>';
  await tick();
  assert.ok([...document.querySelectorAll('td:nth-child(2)')].every(cell => cell.textContent === '2 个月前'));
  assert.ok([...document.querySelectorAll('td:nth-child(3)')].every(cell => cell.textContent === '1 年前'));
  assert.ok([...document.querySelectorAll('td:first-child')].every(cell => cell.textContent === '2 months ago'));
  assert.equal(document.querySelector('i18n-text').textContent, '编辑于 2 个月前');
});

test("file time labels finish before paint even when a view rebuild exhausts the general budget", async t => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const { w, document, localizer } = fixture(t, '<main></main>', {}, {},
    'https://www.figma.com/files/team/test/recents-and-sharing/recently-viewed', dictionary);
  let clock = 0;
  w.performance.now = () => clock++;
  w.requestAnimationFrame = () => 1;
  w.cancelAnimationFrame = () => {};
  localizer.setOptions({ budgetMs: 1 });
  document.querySelector('main').innerHTML = '<button>Save</button>'.repeat(250) + '<table><tbody>' +
    Array.from({length: 18}, () => '<tr><td><span class="generic_tile_title_contents--itemsViewTitle--test">2 months ago</span></td><td><span>2 months ago</span></td><td><span>1 year ago</span></td></tr>').join('') + '</tbody></table>' +
    '<div role="group" aria-label="Edited 2 months ago"><h2>Edited 2 months ago</h2><i18n-text>Edited <span>2 months ago</span></i18n-text></div>';
  await Promise.resolve(); await Promise.resolve();
  assert.ok([...document.querySelectorAll('td:nth-child(2)')].every(cell => cell.textContent === '2 个月前'));
  assert.ok([...document.querySelectorAll('td:nth-child(3)')].every(cell => cell.textContent === '1 年前'));
  assert.equal(document.querySelector('i18n-text').textContent, '编辑于 2 个月前');
  assert.equal(document.querySelector('h2').textContent, 'Edited 2 months ago');
  assert.ok([...document.querySelectorAll('td:first-child')].every(cell => cell.textContent === '2 months ago'));
  assert.ok(localizer.getStats().queueSize > 0, 'the remaining general scan still yields');
  assert.ok([...document.querySelectorAll('button')].some(button => button.textContent === 'Save'));
});

test("static property labels translate without layout reads, including attribute-marked labels", async t => {
  const { w, document } = fixture(t, '<main></main>', {}, { Position: "位置", Opacity: "不透明度" });
  w.getComputedStyle = () => { assert.fail('property labels must not measure ancestor styles'); };
  w.Element.prototype.getBoundingClientRect = () => { assert.fail('property labels must not force layout'); };
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'Right sidebar');
  panel.innerHTML = '<div><span title="Position">Position</span></div><div><span>Opacity</span></div>';
  document.body.append(panel);
  await tick();
  assert.equal(panel.textContent, '位置不透明度');
  assert.equal(panel.querySelector('span').title, '位置');
  assert.equal(panel.querySelector('span').getAttribute('data-figma-zh-compact-text'), '1');
});

test("a queued panel rebuild replaces its detached walker instead of losing new children", async t => {
  const { w, document, localizer } = fixture(t, '<section aria-label="Right sidebar"></section>', {}, { Save: "保存", Export: "导出" });
  const frames = [];
  w.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  w.cancelAnimationFrame = () => {};
  localizer.setOptions({ chunkSize: 3 });
  const panel = document.querySelector('section');
  panel.innerHTML = '<div><span>Save</span></div>'.repeat(8);
  await Promise.resolve(); await Promise.resolve();
  assert.ok(localizer.getStats().queueSize > 0);
  panel.innerHTML = '<div><span>Export</span></div>'.repeat(8);
  await Promise.resolve(); await Promise.resolve();
  for (let rounds = 0; localizer.getStats().queueSize && rounds < 50; rounds++) {
    assert.ok(frames.length);
    frames.shift()();
    await Promise.resolve(); await Promise.resolve();
  }
  assert.equal(localizer.getStats().queueSize, 0);
  assert.equal(panel.textContent, '导出'.repeat(8));
});

test("direct label rewrites precede a large panel scan in the same mutation delivery", async t => {
  const { w, document } = fixture(t, '<section aria-label="Right sidebar"><span>Position</span></section>', {}, { Position: "位置", Save: "保存" });
  let clock = 0;
  w.performance.now = () => clock++;
  w.requestAnimationFrame = () => 1;
  w.cancelAnimationFrame = () => {};
  const panel = document.querySelector('section');
  const bulk = document.createElement('div');
  bulk.innerHTML = '<button>Save</button>'.repeat(200);
  panel.append(bulk);
  panel.querySelector('span').firstChild.nodeValue = 'Position';
  await Promise.resolve(); await Promise.resolve();
  assert.equal(panel.querySelector('span').textContent, '位置');
  assert.ok(bulk.textContent.includes('Save'), 'bulk work still yields to the frame budget');
});

test("canvas accessibility mirrors do not consume a rebuilt property panel's slice", async t => {
  const { w, document, runtime, localizer } = fixture(t,
    '<div id="hidden-input-activedescendant"></div><section aria-label="Right sidebar"></section>',
    {}, { Dimensions: "尺寸", Variants: "变体", Position: "位置", Layout: "布局" });
  const mirror = document.querySelector('#hidden-input-activedescendant');
  const panel = document.querySelector('section');
  const originalStyle = w.getComputedStyle;
  w.getComputedStyle = element => {
    assert.ok(!mirror.contains(element), 'the invisible canvas mirror must never trigger layout reads');
    return originalStyle.call(w, element);
  };
  const before = localizer.getStats().processedNodes;
  // Figma delivers its canvas accessibility tree before the visible panel.
  mirror.innerHTML = '<div><dl><dt>Variants</dt><dt>Dimensions</dt></dl></div>'.repeat(300);
  panel.innerHTML = '<h2>Position</h2><h2>Layout</h2>';
  await Promise.resolve(); await Promise.resolve();
  assert.equal(panel.textContent, '位置布局');
  assert.equal(mirror.textContent, 'VariantsDimensions'.repeat(300));
  assert.equal(localizer.getStats().processedNodes - before, 2);
  assert.equal(runtime.drain().requests.length, 0);
  assert.equal(P.candidate(mirror.querySelector('dt'), 'Variants'), null);
});

test("control attributes wait behind visible labels within a shared mutation budget", async t => {
  const { w, document, runtime, localizer } = fixture(t,
    '<section aria-label="Right sidebar"></section>', {}, { Save: "保存", Position: "位置", Layout: "布局" });
  let clock = 0;
  w.performance.now = () => clock;
  w.requestAnimationFrame = () => 1;
  w.cancelAnimationFrame = () => {};
  localizer.setOptions({ allowElement(element, source) {
    if (!source) clock += 2; // Model costly attribute/context checks, independently of text.
    return runtime.allowElement(element, source);
  } });
  const panel = document.querySelector('section');
  panel.innerHTML = '<input value="Private value" title="Save">'.repeat(60) + '<h2>Position</h2><h2>Layout</h2>';
  await Promise.resolve(); await Promise.resolve();
  assert.equal(panel.textContent, '位置布局');
  assert.ok(localizer.getStats().queueSize > 0, 'remaining attribute work must still yield');
  assert.equal(panel.querySelector('input').value, 'Private value');
});

test("ancestor caches refresh after an existing label moves into named content", async t => {
  const { document } = fixture(t,
    '<section aria-label="Right sidebar"><span>Save</span></section><section aria-label="Left sidebar"><div role="grid"></div></section>',
    {}, { Save: "保存" });
  const label = document.querySelector('span');
  assert.equal(label.textContent, '保存');
  document.querySelector('[role="grid"]').append(label);
  label.firstChild.nodeValue = 'Save';
  await Promise.resolve(); await Promise.resolve();
  assert.equal(label.textContent, 'Save', 'a previously allowed node must obey its new protected ancestors');
  document.querySelector('[aria-label="Right sidebar"]').append(label);
  label.firstChild.nodeValue = 'Save';
  await Promise.resolve(); await Promise.resolve();
  assert.equal(label.textContent, '保存', 'moving back must not retain a stale protected result');
});
