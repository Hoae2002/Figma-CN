const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadCore() {
  const sourcePath = path.join(__dirname, "..", "payload", "src", "content", "localizer-core.js");
  const source = fs.readFileSync(sourcePath, "utf8").replace(
    "window.FigmaZhLocalizer = {",
    "window.FigmaZhLocalizer = { createTranslator,"
  );
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return context.window.FigmaZhLocalizer;
}

const core = loadCore();

test("normalizes text while preserving translated outer whitespace", () => {
  assert.equal(core.normalizeText("  Open\n  file  "), "Open file");
  assert.equal(core.preserveOuterWhitespace("\tOpen file \n", "打开文件"), "\t打开文件 \n");
});

test("translator covers exact, pattern, phrase, fallback, and MCP status paths", () => {
  const translator = core.createTranslator({
    exact: { "Open file": "打开文件" },
    phrases: [["Selected colors", "所选颜色"]],
    patterns: [["^Group (\\d+)$", "组 $1"]],
    uiTerms: { Stroke: "描边", Fill: "填充" },
    commonTerms: { settings: "设置" }
  });

  assert.equal(translator.translate("  Open file \n"), "  打开文件 \n");
  assert.equal(translator.translate("Group 12"), "组 12");
  assert.equal(translator.translate("Selected colors"), "所选颜色");
  assert.equal(translator.translate("Fill / Stroke"), "填充 / 描边");
  assert.equal(translator.translate("MCP server enabled on localhost:3845"), "MCP 服务器已启用：localhost:3845");
});

test("translator rejects protected and partially untranslated content", () => {
  const translator = core.createTranslator({
    uiTerms: { Fill: "填充" },
    patterns: [["^Hello (.+)$", "你好 $1"]]
  });

  assert.equal(translator.translate("C:\\Users\\demo\\file.fig"), null);
  assert.equal(translator.translate("demo@example.com"), null);
  assert.equal(translator.translate("Fill mystery"), null);
  assert.equal(translator.translate("Hello designer"), null);
  assert.equal(translator.translate("Fill", { fallbackTerms: false }), null);
});

test("untranslated classification separates UI and protected tokens", () => {
  const translator = core.createTranslator({ exact: {} });

  assert.equal(translator.classifyUntranslated("Missing action"), "ui");
  assert.equal(translator.classifyUntranslated("GitHub"), "protected");
  assert.equal(translator.classifyUntranslated("already translated 中文"), "ui");
  assert.equal(translator.classifyUntranslated("纯中文"), "none");
});

test("bundled dictionary covers current Community UI wording", () => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const translator = core.createTranslator(dictionary);
  assert.equal(translator.translate("Explore community-made libraries, plugins, icon sets, and more"), "探索社区创作者制作的资源库、插件、图标集等内容");
  assert.equal(translator.translate("Figma creations"), "Figma 创作");
  assert.equal(translator.translate("Try it..."), "试用…");
});

test("bundled dictionary covers current editor overlays", () => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const translator = core.createTranslator(dictionary);
  assert.equal(translator.translate("Add min width…"), "添加最小宽度…");
  assert.equal(translator.translate("Add max width…"), "添加最大宽度…");
  assert.equal(translator.translate("Add min height…"), "添加最小高度…");
  assert.equal(translator.translate("Add max height…"), "添加最大高度…");
  assert.equal(translator.translate("Alignment"), "对齐方式");
  assert.equal(translator.translate("Fonts"), "字体");
  assert.equal(translator.translate("Search"), "搜索");
  assert.equal(translator.translate("No colors available"), "没有可用颜色");
});

test("bundled dictionary covers the current clipboard, navigation, variable, and category labels", () => {
  const dictionary = require("../payload/src/dictionary/zh-CN.js");
  const translator = core.createTranslator(dictionary);
  const expected = {
    "Frame link copied to clipboard": "画框链接已复制到剪贴板",
    "Go to folder": "转到文件夹",
    "Find...": "查找…",
    "Variable collection": "变量集合",
    "Name": "名称",
    "Light": "浅色",
    "Content generation": "内容生成",
    "Shaders": "着色器",
    "Styling": "样式",
    "Format & resize": "格式与调整尺寸",
    "Fun & creative": "趣味与创意",
    "Product & brand": "产品与品牌"
  };

  for (const [source, translation] of Object.entries(expected)) {
    assert.equal(dictionary.exact[source], translation, source);
    assert.equal(translator.translate(source), translation, source);
  }
});
