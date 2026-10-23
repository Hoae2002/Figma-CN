const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadMenuHelpers() {
  const sourcePath = path.join(__dirname, "..", "payload", "src", "main", "menu-localizer.js");
  const marker = "  if (!global.__FIGMA_ZH_MENU_LOCALIZER__) {";
  const source = fs.readFileSync(sourcePath, "utf8").replace(marker, `
  global.__FIGBOOST_TEST_HOOKS__ = {
    localizeShellUpdateText, localizeText, localizeItems, localizeTemplate, localizeDialogOptions,
    compareVersions, isFeatureEnabled, formatDuration, getFigBoostRemainingTimeout,
    throwIfFigBoostDeadlineExceeded, cleanDiscoveredFileName, sanitizeWindowsFileName,
    getFileNameFromUrlSlug, getFigmaFilePathForEditorType, toFigmaAbsoluteUrl,
    getFigmaPageCategory, extractFigmaFileLink, isFigmaProjectOverviewPage,
    shouldScanFigmaPage, shouldReadVisibleFigmaPage, mergeDiscoveredPage,
    getUniqueExportPath, getFigmaFileKey, normalizeFigBoostMenuBounds,
    parseFigBoostMenuBoundsFromUrl
  };
  return;
${marker}`);

  function Menu() {}
  Menu.prototype.popup = function (options) {};
  const electron = {
    app: {}, autoUpdater: {}, clipboard: {}, dialog: {}, ipcMain: {},
    Menu, BrowserWindow: {}, webContents: {}
  };
  const context = {
    AbortController,
    Buffer,
    Date,
    URL,
    __dirname: path.dirname(sourcePath),
    global: {},
    require(name) {
      return name === "electron" ? electron : require(name);
    }
  };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return context.global.__FIGBOOST_TEST_HOOKS__;
}

const helpers = loadMenuHelpers();

test("no-update dialog translates combined paragraphs while retaining spacing and actions", () => {
  const first = "You are already using the latest version of Figma.";
  const second = "Missing a new feature? Try reloading your tabs and check again. If you experience any other issues, please contact support.";
  for (const separator of ["\n\n", "\r\n\r\n", " "]) {
    const options = { title: "Figma", message: "No Update Available", detail: first + separator + second,
      buttons: ["Reload All Tabs", "OK"], defaultId: 1, cancelId: 1, noLink: false };
    const result = helpers.localizeDialogOptions(options);
    assert.equal(result.detail, "您已经在使用最新版 Figma。" + separator + "缺少新功能？请重新加载标签页后再检查。如果遇到其他问题，请联系支持。");
    assert.equal(result.message, "没有可用更新");
    assert.equal(result.buttons[0], "重新加载全部标签页");
    for (const key of ["title", "defaultId", "cancelId", "noLink"]) assert.equal(result[key], options[key]);
    assert.equal(options.detail, first + separator + second);
  }
  assert.equal(helpers.localizeText("Custom note: " + first + "\n\n" + second), "Custom note: " + first + "\n\n" + second);
});

test("shell update label follows redraws and language changes without changing clicks or tab names", async () => {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<span role="tab">Update now</span><button id="unrelated">Update now</button><div class="tab_bar--updateButtonWrapper--PR7-P"><button id="update"><span>Update now</span></button></div>', { runScripts: "outside-only" });
  try {
    const { document } = dom.window;
    const button = document.querySelector("#update");
    let clicked = 0;
    button.onclick = () => clicked++;
    const original = button.onclick;
    const run = label => dom.window.eval(`(${helpers.localizeShellUpdateText.toString()})(${JSON.stringify(label)})`);
    assert.equal(helpers.localizeText("Update now"), "立即更新");
    assert.equal(require("../payload/src/dictionary/zh-CN.js").exact["Update now"], "立即更新");
    run("立即更新");
    assert.equal(button.textContent, "立即更新");
    assert.equal(document.querySelector('[role="tab"]').textContent, "Update now");
    assert.equal(document.querySelector("#unrelated").textContent, "Update now");
    assert.equal(button.onclick, original);
    button.click(); assert.equal(clicked, 1);
    button.innerHTML = '<span>Update now</span>';
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button.textContent, "立即更新");
    run("Update now");
    assert.equal(button.textContent, "Update now");
    run("立即更新");
    button.click(); assert.equal(clicked, 2);
    await new Promise(resolve => setImmediate(resolve));
  } finally { dom.window.close(); }
});

test("widget development and spelling menus translate without changing commands or checked languages", () => {
  const action = () => {};
  const items = [{ label: "Check spelling", checked: true, click: action, submenu: { items: [
    { label: "English (Canada)", checked: true, click: action },
    { label: "English (Liberia)", checked: false },
    { label: "English (Philippines)", checked: false },
    { label: "English (United States)", checked: false },
    { label: "zh-Latn-CN-x-ext", checked: false }
  ] } }];
  assert.equal(helpers.localizeItems(items), true);
  assert.equal(items[0].label, "启用拼写检查");
  assert.equal(items[0].checked, true);
  assert.equal(items[0].click, action);
  assert.deepEqual(items[0].submenu.items.map(item => item.label), ["英语（加拿大）", "英语（利比里亚）", "英语（菲律宾）", "英语（美国）", "中文（拉丁字母，zh-Latn-CN-x-ext）"]);
  assert.deepEqual(items[0].submenu.items.map(item => item.checked), [true, false, false, false, false]);
  assert.equal(items[0].submenu.items[0].click, action);
  const template = [{ submenu: [
    { label: "New widget...", click: action }, { label: "Import widget from manifest...", click: action },
    { label: "New widget…", click: action }, { label: "Import widget from manifest…", click: action }
  ] }];
  helpers.localizeTemplate(template);
  assert.deepEqual(template[0].submenu.map(item => item.label), ["新建小部件…", "从清单导入小部件…", "新建小部件…", "从清单导入小部件…"]);
  assert.ok(template[0].submenu.every(item => item.click === action));
});

test("stable native menu dictionary remains available without the translation host", () => {
  assert.equal(helpers.localizeText("New Window"), "新建窗口");
  assert.equal(helpers.localizeText("Reopen Closed Tab or Window"), "重新打开关闭的标签页或窗口");
  assert.equal(helpers.localizeText("Recently Closed"), "最近关闭");
  const items = [{ label: "Help", submenu: { items: [{ label: "Reload" }] } }];
  assert.equal(helpers.localizeItems(items), true);
  assert.equal(items[0].label, "帮助");
  assert.equal(items[0].submenu.items[0].label, "重新加载");
  const options = helpers.localizeDialogOptions({ title: "Update Available", detail: "C:\\private\\file.fig", buttons: ["Install now"] });
  assert.equal(options.title, "有可用更新");
  assert.equal(options.detail, "C:\\private\\file.fig");
  assert.equal(options.buttons[0], "立即安装");
});

test("compares variable-length versions numerically", () => {
  assert.equal(helpers.compareVersions("126.10.1", "126.9.20"), 1);
  assert.equal(helpers.compareVersions("1.2", "1.2.0"), 0);
  assert.equal(helpers.compareVersions("1.2.0", "1.2.1"), -1);
  assert.equal(helpers.compareVersions(null, "0.0.0"), 0);
});

test("formats durations and enforces deadlines", () => {
  assert.equal(helpers.formatDuration(0), "00:00");
  assert.equal(helpers.formatDuration(65_999), "01:05");
  assert.equal(helpers.formatDuration(3_661_000), "1:01:01");
  assert.equal(helpers.getFigBoostRemainingTimeout(0, 8000), 8000);
  assert.equal(helpers.getFigBoostRemainingTimeout(Date.now() - 10, 8000), 1);
  assert.throws(
    () => helpers.throwIfFigBoostDeadlineExceeded(Date.now() - 1, "timed out"),
    (error) => error.message === "timed out" && error.figBoostDeadlineExceeded === true
  );
});

test("sanitizes Windows export names and resolves URL slugs", () => {
  assert.equal(helpers.cleanDiscoveredFileName("  Design\n system  "), "Design system");
  assert.equal(helpers.sanitizeWindowsFileName("CON"), "_CON");
  assert.equal(helpers.sanitizeWindowsFileName("a<b>:c?. "), "a_b__c_");
  assert.equal(helpers.sanitizeWindowsFileName("   "), "Untitled");
  assert.equal(helpers.getFileNameFromUrlSlug("my%20design-file", "KEY"), "my design file");
  assert.equal(helpers.getFileNameFromUrlSlug("%E0%A4%A", "KEY"), "KEY");
});

test("maps editor types and accepts only Figma-owned URLs", () => {
  assert.equal(helpers.getFigmaFilePathForEditorType("DESIGN"), "design");
  assert.equal(helpers.getFigmaFilePathForEditorType(1), "board");
  assert.equal(helpers.getFigmaFilePathForEditorType("slides"), "slides");
  assert.equal(helpers.getFigmaFilePathForEditorType("unknown"), "");
  assert.equal(helpers.toFigmaAbsoluteUrl("https://evil.example/design/abc"), null);
  assert.equal(helpers.toFigmaAbsoluteUrl("not a url").startsWith("https://www.figma.com/"), true);
  assert.equal(helpers.toFigmaAbsoluteUrl("https://help.figma.com/design/abc#part"), "https://www.figma.com/design/abc");
});

test("extracts design files and excludes overview placeholders", () => {
  const file = helpers.extractFigmaFileLink(
    "/design/ABC123/my-file",
    "",
    "https://www.figma.com/files/project/42",
    "Project Alpha"
  );
  assert.equal(file.key, "ABC123");
  assert.equal(file.name, "my file");
  assert.equal(file.projectPath, "Project Alpha");
  assert.equal(helpers.extractFigmaFileLink("/board/ABC123/demo", "Demo", "/files", ""), null);
  assert.equal(
    helpers.extractFigmaFileLink("/design/ABC123", "ABC123", "/desktop_new_tab?team_id=1", ""),
    null
  );
});

test("filters scan and visible-page routes", () => {
  assert.equal(helpers.shouldScanFigmaPage("/files/team/1/all-projects"), true);
  assert.equal(helpers.shouldScanFigmaPage("/files/recent"), false);
  assert.equal(helpers.shouldScanFigmaPage("/design/ABC123/file"), false);
  assert.equal(helpers.shouldReadVisibleFigmaPage("/desktop_new_tab?team_id=1"), true);
  assert.equal(helpers.shouldReadVisibleFigmaPage("/desktop_new_tab"), false);
  assert.equal(helpers.shouldReadVisibleFigmaPage("/files/trash"), false);
});

test("merges discovered files without duplicating categories or queued pages", () => {
  const files = new Map();
  const queue = [];
  const seen = new Set();
  const page = {
    url: "https://www.figma.com/files/project/42",
    title: "Project Alpha",
    links: [
      { href: "/design/ABC123/file-one", label: "File One" },
      { href: "/files/project/84", label: "Project Beta" }
    ]
  };
  assert.equal(helpers.mergeDiscoveredPage(page, files, queue, seen), 1);
  assert.equal(files.size, 1);
  assert.equal(queue.length, 1);
  assert.equal(helpers.mergeDiscoveredPage(page, files, queue, seen), 0);
  assert.equal(queue.length, 1);
});

test("normalizes feature-menu geometry and navigation query bounds", () => {
  const point = helpers.normalizeFigBoostMenuBounds({ left: -4.4, right: 81.7, bottom: 40.6 });
  assert.equal(JSON.stringify(point), JSON.stringify({ x: 0, y: 41, right: 82 }));
  assert.equal(helpers.normalizeFigBoostMenuBounds({ left: "x", bottom: 2 }), null);

  const bounds = helpers.parseFigBoostMenuBoundsFromUrl("figboost://open-feature-menu?left=10&top=2&right=60&bottom=40&width=50&height=38");
  assert.equal(JSON.stringify(bounds), JSON.stringify({ left: 10, top: 2, right: 60, bottom: 40, width: 50, height: 38 }));
  assert.equal(helpers.getFigmaFileKey("https://www.figma.com/slides/XYZ789/demo"), "XYZ789");
});
