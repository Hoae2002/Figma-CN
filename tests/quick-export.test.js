"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../payload/src/content/content.js"), "utf8");

function fixture(t, url = "https://www.figma.com/design/test") {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="hidden-input-activedescendant" aria-label="Figma Design, 5 items selected" tabindex="0"></div>
    <div data-testid="fullscreen-export-panel"><input value="4x"><select><option>PNG</option></select><button id="export">Export 5 layers</button></div>
    <input id="name"><textarea></textarea><div contenteditable="true"><span id="text">Text</span></div>
    <input id="canvas-input" readonly role="application" aria-hidden="true">
  </body></html>`, { url, runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, button = w.document.querySelector("#export");
  // jsdom has no layout; Chromium regression separately checks real visibility.
  button.getClientRects = () => [{ width: 200, height: 28 }];
  let clicks = 0;
  button.addEventListener("click", () => clicks++);
  w.eval(source);
  function press(overrides = {}, target = w.document.body) {
    const event = new w.KeyboardEvent("keydown", { key: "S", code: "KeyS", ctrlKey: true, shiftKey: true, altKey: true, bubbles: true, cancelable: true, ...overrides });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }
  return { w, button, press, clicks: () => clicks };
}

test("quick export clicks the native action once and preserves export settings", t => {
  const f = fixture(t);
  let figmaHandlers = 0;
  f.w.document.addEventListener("keydown", () => figmaHandlers++);
  assert.equal(f.press(), true);
  assert.equal(f.press({ repeat: true }), true);
  assert.equal(f.clicks(), 1);
  assert.equal(figmaHandlers, 0);
  assert.equal(f.w.document.querySelector("[value='4x']").value, "4x");
  assert.equal(f.w.document.querySelector("select").value, "PNG");
  f.w.eval(source); // A retry or payload replacement must not stack listeners.
  f.press();
  assert.equal(f.clicks(), 2);
});

test("desktop native handling disables the renderer shortcut on reinjection", t => {
  const f = fixture(t);
  f.w.__FIGBOOST_NATIVE_QUICK_EXPORT__ = true;
  f.w.eval(source);
  assert.equal(f.press(), false);
  assert.equal(f.clicks(), 0, "desktop must not also handle the renderer key event");
  assert.equal(f.w.__figboostQuickExport(), true);
  assert.equal(f.clicks(), 1, "desktop dispatch must click the sidebar action directly");
  f.w.document.querySelector('#name').focus();
  assert.equal(f.w.__figboostQuickExport(), false);
  assert.equal(f.clicks(), 1, "desktop dispatch must protect text input too");
});

test("single Chinese export label and legacy file route work from the canvas input", t => {
  const f = fixture(t, "https://www.figma.com/file/test");
  f.button.textContent = "导出 首页";
  const input = f.w.document.querySelector("#canvas-input");
  input.focus();
  assert.equal(f.press({}, input), true);
  assert.equal(f.clicks(), 1);
});

test("focused canvas remains eligible when Figma exposes its application input", t => {
  const f = fixture(t), input = f.w.document.querySelector("#canvas-input");
  f.w.__FIGBOOST_NATIVE_QUICK_EXPORT__ = true;
  f.w.eval(source);
  input.setAttribute("aria-hidden", "false");
  input.setAttribute("aria-label", "Figma Design, 5 items selected");
  input.focus();
  assert.equal(f.w.__figboostQuickExport(), true);
  assert.equal(f.clicks(), 1);
  const text = f.w.document.querySelector("#name");
  text.readOnly = true;
  text.focus();
  assert.equal(f.w.__figboostQuickExport(), false, "ordinary read-only text fields remain protected");
  assert.equal(f.clicks(), 1);
});

test("text editing, IME and other key combinations keep their normal behavior", t => {
  const f = fixture(t);
  for (const selector of ["#name", "textarea", "[contenteditable]"]) {
    const input = f.w.document.querySelector(selector);
    input.focus();
    assert.equal(f.press({}, input), false);
    input.blur();
  }
  assert.equal(f.press({}, f.w.document.querySelector("#text")), false);
  for (const keys of [{ ctrlKey: false }, { shiftKey: false }, { altKey: false }, { metaKey: true }, { isComposing: true }, { code: "KeyA", key: "a" }]) {
    assert.equal(f.press(keys), false);
  }
  assert.equal(f.clicks(), 0);
});

test("file browser, prototype and community routes do not register an active shortcut", t => {
  for (const route of ["/files/team/test", "/proto/test", "/community", "/board/test"]) {
    const f = fixture(t, "https://www.figma.com" + route);
    assert.equal(f.press(), false);
    assert.equal(f.clicks(), 0);
  }
});

test("missing selection never exports the page; selected virtualized layers still work", t => {
  const f = fixture(t), canvas = f.w.document.getElementById("hidden-input-activedescendant");
  canvas.setAttribute("aria-label", "Board");
  assert.equal(f.press(), false);
  canvas.insertAdjacentHTML("afterend", '<div data-testid="layer-row-with-children" aria-selected="true"></div>');
  assert.equal(f.press(), true);
  assert.equal(f.clicks(), 1);
});

test("hidden, disabled and absent native actions are ignored without adding export settings", t => {
  const f = fixture(t), panel = f.button.parentElement;
  f.button.disabled = true;
  assert.equal(f.press(), false);
  f.button.disabled = false;
  f.button.setAttribute("aria-disabled", "true");
  assert.equal(f.press(), false);
  f.button.removeAttribute("aria-disabled");
  panel.hidden = true;
  assert.equal(f.press(), false);
  panel.hidden = false;
  f.button.style.visibility = "hidden";
  assert.equal(f.press(), false);
  f.button.style.visibility = "visible";
  f.button.textContent = "Export"; // Collapsed panel heading, not the native action.
  assert.equal(f.press(), false);
  f.button.textContent = "Export Home";
  f.w.document.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-modal="true"></div>');
  assert.equal(f.press(), false);
  f.w.document.querySelector("[role=dialog]").remove();
  panel.remove();
  assert.equal(f.press(), false);
  assert.equal(f.clicks(), 0);
});
