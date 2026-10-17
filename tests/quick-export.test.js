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
  w.HTMLElement.prototype.getClientRects = function () {
    for (let element = this; element; element = element.parentElement) {
      if (element.hidden || element.style.display === "none") return [];
    }
    return [{ width: 200, height: 28 }];
  };
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

function emptyExport(f, label = "Add export settings") {
  const panel = f.w.document.querySelector('[data-testid="fullscreen-export-panel"]');
  panel.innerHTML = `<button aria-label="${label}">+</button>`;
  const add = panel.querySelector("button");
  add.getClientRects = () => [{ width: 24, height: 24 }];
  let additions = 0, exports = 0;
  add.onclick = () => additions++;
  return {
    panel, additions: () => additions, exports: () => exports,
    render() {
      panel.insertAdjacentHTML("beforeend", '<input value="1x"><select><option>PNG</option></select><button id="new-export">Export Home</button>');
      const button = panel.querySelector("#new-export");
      button.getClientRects = () => [{ width: 200, height: 28 }];
      button.onclick = () => exports++;
    }
  };
}

test("empty native settings are added once, then asynchronously exported with native defaults", async t => {
  for (const native of [false, true]) {
    const f = fixture(t), empty = emptyExport(f, native ? "添加导出设置" : "Add export settings");
    if (native) { f.w.__FIGBOOST_NATIVE_QUICK_EXPORT__ = true; f.w.eval(source); }
    const invoke = () => native ? f.w.__figboostQuickExport() : f.press();
    assert.equal(invoke(), true);
    assert.equal(invoke(), true);
    assert.equal(f.w.__figboostQuickExport(undefined, true), true);
    assert.equal(empty.additions(), 1);
    empty.render();
    empty.panel.querySelector("input").focus(); // Native add may autofocus its scale field.
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(empty.exports(), 1);
    assert.equal(empty.panel.querySelector("input").value, "1x");
    assert.equal(empty.panel.querySelector("select").value, "PNG");
    empty.panel.append("unrelated redraw");
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(empty.exports(), 1);
  }
});

test("initialization leaves existing, mixed, hidden and disabled settings alone", t => {
  for (const state of ["existing", "mixed", "hidden", "disabled", "repeat"]) {
    const f = fixture(t), empty = emptyExport(f);
    if (state === "existing") empty.panel.insertAdjacentHTML("beforeend", '<input value="4x">');
    if (state === "mixed") empty.panel.append("Click + to replace mixed export settings");
    if (state === "hidden") empty.panel.hidden = true;
    if (state === "disabled") empty.panel.querySelector("button").disabled = true;
    f.press({ repeat: state === "repeat" });
    assert.equal(empty.additions(), 0, state);
  }
});

test("empty selection ignores cached export actions and controls from a previous selection", async t => {
  const f = fixture(t), empty = emptyExport(f);
  // Figma 126.10.7 retains this subtree when switching from page export to a
  // frame with no settings. It is present in the DOM but has no layout boxes.
  empty.panel.insertAdjacentHTML("beforeend", '<div class="cachedSubtree displayContents" style="display: none"><input value="4x"><button role="combobox">PNG</button><button>导出 Previous page</button></div>');
  assert.equal(f.press(), true);
  assert.equal(empty.additions(), 1);
  empty.render();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(empty.exports(), 1);
  assert.equal(empty.panel.querySelector('.cachedSubtree input').value, "4x");
});

test("pending export cancels when selection, route, editing or user input changes, or payload reloads", async t => {
  for (const change of ["selection", "route", "editing", "dialog", "pointer", "key", "reload"]) {
    const f = fixture(t), empty = emptyExport(f);
    assert.equal(f.press(), true);
    if (change === "selection") f.w.document.getElementById("hidden-input-activedescendant").setAttribute("aria-label", "Board");
    if (change === "route") f.w.history.replaceState({}, "", "/design/other");
    if (change === "editing") f.w.document.querySelector("#name").focus();
    if (change === "dialog") f.w.document.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-modal="true"></div>');
    if (change === "pointer") f.w.dispatchEvent(new f.w.Event("pointerdown"));
    if (change === "key") f.w.dispatchEvent(new f.w.KeyboardEvent("keydown", { code: "ArrowDown" }));
    if (change === "reload") f.w.eval(source);
    empty.render();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(empty.exports(), 0, change);
  }
});

test("pending export expires and can be retried without a stale observer", async t => {
  const f = fixture(t), empty = emptyExport(f);
  f.press();
  await new Promise(resolve => setTimeout(resolve, 2100));
  empty.render();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(empty.exports(), 0);
  assert.equal(f.press(), true);
  assert.equal(empty.exports(), 1);
});
