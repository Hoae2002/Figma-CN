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
  const localizer = w.FigmaZhLocalizer.createLocalizer({ exact, phrases: [], uiTerms: {}, commonTerms: {}, patterns: [] }, { allowElement: runtime.allowElement, resolveTranslation: runtime.resolveTranslation });
  runtime.bind(localizer);
  const snapshot = { schema: 1, revision: 1, settings: { enabled: true, online: true, regions: {} }, hasKey: true, learned: {}, overrides: {}, rules: [], ...custom };
  runtime.apply(snapshot);
  return { w, runtime, localizer, snapshot, document: w.document };
}
const tick = () => new Promise(r => setTimeout(r, 50));
test("reconnecting the same settings revision requeues requests and rejects old replies", async t => {
  const { document, runtime, snapshot } = fixture(t, '<div role="toolbar"><button>Save</button></div>');
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
test("built-in dictionary is bypassed and every safe label uses machine translation", t => {
  const { document, runtime } = fixture(t, '<div role="toolbar"><button>Save</button></div>', {}, { Save: "保存" });
  assert.equal(document.querySelector("button").textContent, "Save"); assert.equal(runtime.drain().requests.length, 1);
});
test("unknown UI stays visible then uses learned translation; local offline reuse works", async t => {
  const { document, runtime, snapshot } = fixture(t, '<div role="toolbar"><button>New gizmo</button></div>');
  const button = document.querySelector("button"); assert.equal(button.textContent, "New gizmo"); assert.equal(button.closest("[data-figma-zh-pending]"), null);
  const job = runtime.drain().requests[0]; assert.ok(job);
  const entry = { ...job.c, translation: "新控件" }; runtime.accept([{ id: job.id, entry }]); await tick();
  assert.equal(button.textContent, "新控件");
  runtime.apply({ ...snapshot, revision: 2, settings: { ...snapshot.settings, online: false }, learned: { [P.key(job.c.text, job.c.region, job.c.context)]: entry } });
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
  const { document, runtime } = fixture(t, '<div role="toolbar"><button>New gizmo</button><button>New widget</button></div>');
  const jobs = runtime.drain().requests, buttons = document.querySelectorAll("button");
  buttons[0].textContent = "Changed"; buttons[1].remove();
  runtime.accept(jobs.map(job => ({ id: job.id, entry: { ...job.c, translation: "错误覆盖" } }))); await tick();
  assert.equal(buttons[0].textContent, "Changed"); assert.equal(buttons[1].textContent, "New widget");
});
test("switch off during request invalidates responses and restores only our own current text", async t => {
  const { document, runtime, snapshot } = fixture(t, '<div role="toolbar"><button>Save</button><button>New gizmo</button></div>', {}, { Save: "保存" });
  const jobs = runtime.drain().requests, buttons = document.querySelectorAll("button");
  buttons[0].firstChild.nodeValue = "Figma changed this";
  runtime.apply({ ...snapshot, revision: 2, settings: { ...snapshot.settings, enabled: false } });
  runtime.accept(jobs.map(job => ({ id: job.id, entry: { ...job.c, translation: "错误覆盖" } }))); await tick();
  assert.equal(buttons[0].textContent, "Figma changed this"); assert.equal(buttons[1].textContent, "New gizmo");
});
test("manual overrides are ignored while cached translations and original regions work", t => {
  const k = P.key("Save", "toolbar", "button");
  const { runtime, snapshot, document } = fixture(t, '<div role="toolbar"><button>Save</button></div>', { overrides: { [k]: { translation: "存储" } }, learned: { [k]: { translation: "缓存译文" } } }, { Save: "保存" });
  assert.equal(document.querySelector("button").textContent, "缓存译文");
  runtime.apply({ ...snapshot, revision: 2, settings: { ...snapshot.settings, regions: { toolbar: "original" } } });
  assert.equal(document.querySelector("button").textContent, "Save");
});
test("persistent exclusions survive recreated elements and block gradient special handling", async t => {
  const rules = [{ text: "Save", region: "toolbar", context: "button", anchor: "save-action" }];
  const { document, runtime } = fixture(t, '<div role="toolbar"><button data-testid="save-action">Save</button></div><div role="menu" data-testid="gradient-menu"><span>Linear</span><span>Radial</span><span>Angular</span></div>', { rules, settings: { enabled: true, online: true, regions: { menus: "original" } } }, { Save: "保存", Linear: "线性" });
  assert.equal(document.querySelector("button").textContent, "Save");
  document.querySelector("button").outerHTML = '<button data-testid="save-action">Save</button>'; await tick();
  assert.equal(document.querySelector("button").textContent, "Save"); assert.equal(document.querySelector("[role=menu]").textContent, "LinearRadialAngular"); assert.equal(runtime.drain().requests.length, 0);
});
test("picker consumes original actions and stores stable exclusion using English source", async t => {
  const { document, runtime, w } = fixture(t, '<div role="toolbar"><button data-testid="save-action">Save</button></div>', {}, { Save: "保存" });
  const button = document.querySelector("button"); let clicked = 0; button.addEventListener("click", () => clicked++);
  runtime.startPicker(); button.dispatchEvent(new w.MouseEvent("pointermove", { bubbles: true })); button.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const data = runtime.drain().actions[0]; assert.equal(data.data.text, "Save"); assert.equal(data.data.anchor, "save-action"); assert.equal(clicked, 0); assert.equal(button.textContent, "Save");
  document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); assert.equal(document.querySelector("[role=status]"), null);
});
test("user names matching system dictionary labels remain original", t => {
  const { document, runtime } = fixture(t, '<nav><span data-testid="file-title">Drafts</span><span data-testid="project-title">Recent</span><span data-testid="folder-name">Save</span></nav>', {}, { Drafts: "草稿", Recent: "最近", Save: "保存" });
  assert.equal(document.querySelector("nav").textContent, "DraftsRecentSave"); assert.equal(runtime.drain().requests.length, 0);
});
test("unknown dialog prose is not automatically treated as a safe UI label", t => {
  const { runtime } = fixture(t, '<div role="dialog"><p>Alice invited you to Private Workspace</p></div>');
  assert.equal(runtime.drain().requests.length, 0);
});

test('container exclusion protects new descendants and recreated controls', async t => {
  const { document, runtime, snapshot } = fixture(t, '<div role="toolbar"><div data-testid="action-group"><button data-testid="save-action">Save</button></div></div>');
  runtime.drain();
  runtime.apply({ ...snapshot, revision: 2, rules: [{ scope: 'element', region: 'toolbar', anchor: 'action-group', text: 'Actions' }] });
  document.querySelector('[data-testid="action-group"]').innerHTML = '<button data-testid="new-action">New gizmo</button>';
  await tick();
  assert.equal(runtime.drain().requests.length, 0);
  assert.equal(document.querySelector('button').textContent, 'New gizmo');
});

test('whole-area exclusion blocks every label including cached results', t => {
  const { document, runtime } = fixture(t, '<div role="toolbar"><button>Save</button></div>', {
    rules: [{ scope: 'region', region: 'toolbar' }],
    learned: { [P.key('Save', 'toolbar', 'button')]: { text: 'Save', region: 'toolbar', context: 'button', translation: '保存' } }
  });
  assert.equal(document.querySelector('button').textContent, 'Save');
  assert.equal(runtime.drain().requests.length, 0);
});

test('current Figma sidebar landmarks admit headings and buttons, protect names and layer grids', t => {
  const {runtime} = fixture(t, `<body class="feature_flag_canvas_ui3"><section role="region" aria-label="Left sidebar"><button>Pages</button><div role="grid"><button>Private page</button></div><div role="treegrid"><button>Private layer</button></div><button aria-label="Private file, file name">Private file</button></section><section aria-label="Right sidebar"><h2>Position</h2><span>Selection colors</span><button>Share</button></section></body>`);
  const texts = runtime.drain().requests.map(j => j.c.text);
  assert.deepEqual(Array.from(texts).sort(), ['Left sidebar','Pages','Position','Right sidebar','Selection colors','Share'].sort());
});

test('current Figma files page is not hidden by body canvas feature flags and protects user file names', t => {
  const {runtime} = fixture(t, `<body class="feature_flag_canvas_ui3 feature_flag_new_canvas">
    <nav aria-label="Sidebar">
      <ul><li><button><span>Drafts</span></button></li><li><div><span>Community</span></div></li></ul>
      <section><button><i18n-text>Starred</i18n-text></button><div><button aria-description="Design file"><span>Private sidebar file</span></button></div></section>
    </nav>
    <div data-testid="file-browser-desktop-header"><h1><span>Recents</span></h1></div>
    <div role="tablist"><button role="tab"><span>Recently viewed</span></button></div>
    <div role="combobox"><span>All files</span></div>
    <main><div role="listitem"><div role="group" aria-label="Private card file"><h2>Private card file</h2><button aria-label="Add to Starred"></button></div></div></main>
  </body>`, {}, {}, "https://www.figma.com/files/team/test/recents-and-sharing/recently-viewed");
  const texts = runtime.drain().requests.map(job => job.c.text);
  for (const expected of ['Drafts', 'Community', 'Starred', 'Recents', 'Recently viewed', 'All files']) assert.ok(texts.includes(expected), expected);
  assert.ok(!texts.includes('Private sidebar file'));
  assert.ok(!texts.includes('Private card file'));
});
