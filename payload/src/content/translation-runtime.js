(function () {
  "use strict";
  const P = window.FigBoostTranslationPolicy;
  if (!P || window.__FIGBOOST_TRANSLATION_RUNTIME__) return;
  let state = { settings: { enabled: false, regions: {} }, learned: {}, rules: [], revision: -1 };
  let retryTimer = null;
  let generation = 0, sequence = 0, localizer = null;
  const requests = new Map(), outgoing = [], actions = [], attempted = new Set(), temporary = new WeakSet();
  const ownOriginals = new WeakMap();
  function candidate(node, source) {
    return P.candidate(node.nodeType === 3 ? node.parentElement : node, source);
  }
  function isTemporary(element) { for (let e = element; e; e = e.parentElement) if (temporary.has(e)) return true; return false; }
  function allowElement(element, source) {
    const c = P.candidate(element, source);
    return state.settings.enabled && !!c && P.mode(state.settings, c.region) !== "original" && !P.excluded(c, state.rules) && !isTemporary(element);
  }
  function resolveTranslation(source, node, builtin, attr) {
    const c = candidate(node, source);
    const element = node.nodeType === 3 ? node.parentElement : node;
    if (!c || !allowElement(element, source) || P.excluded(c, state.rules)) return null;
    const k = P.key(c.text, c.region, c.context);
    ownOriginals.set(element, c);
    // The maintained Figma dictionary is authoritative. Machine cache and
    // Google are fallbacks only when the dictionary has no usable result.
    if (typeof builtin === "string" && builtin !== source && P.normalize(builtin) !== c.text) return builtin;
    if (state.learned[k]) return window.FigmaZhLocalizer.preserveOuterWhitespace(source, state.learned[k].translation);
    if (!P.validCandidate(c)) return null;
    // User-facing tooltips can contain names. Only standalone UI labels are sent.
    if (/["“”‘’]/.test(c.text) || element.querySelector("input,textarea,[contenteditable='true'],[data-testid*='name']")) return null;
    const standaloneLabel = element.closest("label,h1,h2,h3,h4,h5,h6,[role='heading']")
      || /(?:^|[-_])(?:label|heading|help-text)$/.test(c.anchor || "")
      || ["menus", "right", "left", "toolbar", "home"].includes(c.region);
    if (c.context === "label" && !standaloneLabel) return null;
    if (requests.size >= 1000) return null;
    const token = `${k}:${attr || "text"}`;
    let job = requests.get(token);
    if (!job && !attempted.has(token)) {
      job = { id: ++sequence, generation, c, nodes: [] }; requests.set(token, job); attempted.add(token); outgoing.push({ id: job.id, c });
    }
    if (job && !job.nodes.some(n => n.node === node && n.attr === attr)) job.nodes.push({ node, attr, source });
    return null;
  }
  function apply(snapshot, reconnect = false) {
    if (!snapshot || (!reconnect && snapshot.revision === state.revision)) return;
    if (localizer) localizer.stop();
    clearTimeout(retryTimer); retryTimer = null;
    state = snapshot; generation++; requests.clear(); outgoing.length = 0; attempted.clear();
    if (localizer && state.settings.enabled) localizer.start(document.body);
  }
  function accept(results) {
    for (const result of results || []) {
      for (const [token, job] of requests) {
        if (job.id !== result.id) continue;
        requests.delete(token);
        if (job.generation !== generation) continue;
        if (!result.entry) {
          if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; attempted.clear(); if (localizer && state.settings.enabled) localizer.enqueue(document.body); }, 65000);
          continue;
        }
        state.learned[P.key(job.c.text, job.c.region, job.c.context)] = result.entry;
        for (const { node, attr, source } of job.nodes) {
          if (!node.isConnected || (attr ? node.getAttribute(attr) : node.nodeValue) !== source) continue;
          const element = node.nodeType === 3 ? node.parentElement : node;
          if (allowElement(element, source) && !P.excluded(job.c, state.rules)) localizer.enqueue(node);
        }
      }
    }
  }
  let cancelPicker = null;
  function startPicker() {
    if (cancelPicker) cancelPicker();
    const hint = document.createElement("div");
    hint.setAttribute("data-figma-zh-skip", "1"); hint.setAttribute("role", "status");
    hint.textContent = "可先打开下拉或右键菜单，再点选排除；Alt 选择上层区域，Shift 强制选择触发按钮，Esc 退出。";
    Object.assign(hint.style, { position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647", background: "#252525", color: "white", padding: "12px 18px", borderRadius: "8px", pointerEvents: "none", font: "13px sans-serif" });
    document.body.appendChild(hint);
    let target = null, priorOutline = "", priorOffset = "";
    function clearHighlight() { if (target) { target.style.outline = priorOutline; target.style.outlineOffset = priorOffset; } }
    const pickable = "[data-testid],button,[role='button'],[role='menuitem'],[role='option'],[role='tab'],[role='combobox'],[role='checkbox'],[role='radio'],[role='switch'],label,[role='tooltip'],[role='dialog'],[role='alertdialog'],[role='menu'],[role='listbox'],[role='toolbar'],nav,[role='navigation'],section,h1,h2,h3,h4,h5,h6,span,p";
    const upperPickable = "[data-testid],[role='menu'],[role='listbox'],[role='dialog'],[role='alertdialog'],[role='toolbar'],nav,[role='navigation'],section,[aria-label='Left sidebar'],[aria-label='Right sidebar']";
    function upperTarget(base) {
      for (let e = base && base.parentElement; e && e !== document.body; e = e.parentElement) {
        if (e.matches(upperPickable) && P.regionOf(e) && P.regionOf(e) !== "other") return e;
      }
      return base;
    }
    function move(event) {
      clearHighlight(); target = event.target.closest(pickable);
      if (target && event.altKey) target = upperTarget(target);
      if (!target || !P.regionOf(target) || P.regionOf(target) === "other") { target = null; return; }
      priorOutline = target.style.outline; priorOffset = target.style.outlineOffset;
      target.style.outline = "2px solid #5daaff"; target.style.outlineOffset = "2px";
    }
    function popupTrigger(element) { return element && element.closest("[aria-haspopup='menu'],[aria-haspopup='listbox'],[aria-haspopup='dialog'],[role='combobox']"); }
    function passThrough(event) {
      if (event.shiftKey) return false;
      if (event.button === 2 || event.type === "contextmenu") return true;
      const trigger = popupTrigger(event.target);
      return Boolean(trigger && trigger.getAttribute("aria-expanded") !== "true");
    }
    function block(event) { if (passThrough(event)) return; event.preventDefault(); event.stopImmediatePropagation(); }
    function click(event) {
      if (passThrough(event)) return;
      block(event);
      if (!target) return;
      const c = ownOriginals.get(target) || P.candidate(target, target.textContent);
      if (!c) return;
      const rule = c.anchor
        ? { ...c, text: c.text.slice(0, 100), scope: "element" }
        : { text: c.text.slice(0, 100), region: c.region, context: c.context, scope: "text" };
      if (rule.scope === "text" && (!P.safeText(rule.text) || !rule.context)) { temporary.add(target); hint.textContent = "已排除，仅本次页面有效；可在设置中排除整个面板。"; }
      else { actions.push({ action: "exclude", data: rule }); state.rules.push(rule); hint.textContent = rule.scope === "element" ? "已排除此区域，可在汉化设置中恢复。" : "已按同一区域的这条文案排除，可在汉化设置中恢复。"; }
      if (localizer) { localizer.stop(); generation++; requests.clear(); outgoing.length = 0; attempted.clear(); if (state.settings.enabled) localizer.start(document.body); }
      clearHighlight(); target = null;
    }
    function key(event) { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); cancelPicker(); } }
    cancelPicker = () => { clearHighlight(); hint.remove(); document.removeEventListener("pointermove", move, true); document.removeEventListener("click", click, true); document.removeEventListener("keydown", key, true); for (const name of ["pointerdown", "mousedown", "pointerup", "mouseup", "contextmenu"]) document.removeEventListener(name, block, true); cancelPicker = null; };
    document.addEventListener("pointermove", move, true); document.addEventListener("click", click, true); document.addEventListener("keydown", key, true);
    for (const name of ["pointerdown", "mousedown", "pointerup", "mouseup", "contextmenu"]) document.addEventListener(name, block, true);
  }
  window.__FIGBOOST_TRANSLATION_RUNTIME__ = {
    bind: value => { localizer = value; }, allowElement, resolveTranslation, apply, accept, startPicker,
    drain: () => ({ requests: outgoing.splice(0, 50), actions: actions.splice(0, 10) }),
    ruleStatus: () => state.rules.map(r => ({ ...r, matched: Array.from(document.querySelectorAll("[data-testid]")).some(e => e.getAttribute("data-testid") === r.anchor) }))
  };
})();
