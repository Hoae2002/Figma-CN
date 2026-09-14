(function () {
  "use strict";
  const P = window.FigBoostTranslationPolicy;
  if (!P || window.__FIGBOOST_TRANSLATION_RUNTIME__) return;
  let state = { settings: { enabled: true, online: false, regions: {} }, overrides: {}, learned: {}, rules: [], revision: -1 };
  let generation = 0, sequence = 0, localizer = null;
  const requests = new Map(), outgoing = [], actions = [], attempted = new Set(), temporary = new WeakSet();
  const ownOriginals = new WeakMap();
  function candidate(node, source) {
    return P.candidate(node.nodeType === 3 ? node.parentElement : node, source);
  }
  function isTemporary(element) { for (let e = element; e; e = e.parentElement) if (temporary.has(e)) return true; return false; }
  function allowElement(element, source) {
    const c = P.candidate(element, source);
    return state.settings.enabled && !!c && P.mode(state.settings, c.region) !== "original" && !isTemporary(element);
  }
  function resolveTranslation(source, node, builtin, attr) {
    const c = candidate(node, source);
    const element = node.nodeType === 3 ? node.parentElement : node;
    if (!c || !allowElement(element, source) || P.excluded(c, state.rules)) return null;
    const k = P.key(c.text, c.region, c.context), custom = state.overrides[k];
    ownOriginals.set(element, c);
    if (custom) return custom.keepOriginal ? null : window.FigmaZhLocalizer.preserveOuterWhitespace(source, custom.translation);
    if (builtin) return builtin;
    if (state.learned[k]) return window.FigmaZhLocalizer.preserveOuterWhitespace(source, state.learned[k].translation);
    if (!state.settings.online || !state.hasKey || P.mode(state.settings, c.region) !== "hybrid" || !P.validCandidate(c)) return null;
    // User-facing tooltips can contain names. Only standalone UI labels are sent.
    if (/["“”‘’]/.test(c.text) || element.querySelector("input,textarea,[contenteditable='true'],[data-testid*='name']")) return null;
    if (c.context === "label" && !element.closest("label") && !/(?:^|[-_])(?:label|heading|help-text)$/.test(c.anchor || "")) return null;
    if (requests.size >= 1000) return null;
    const token = `${k}:${attr || "text"}`;
    let job = requests.get(token);
    if (!job && !attempted.has(token)) {
      job = { id: ++sequence, generation, c, nodes: [] }; requests.set(token, job); attempted.add(token); outgoing.push({ id: job.id, c });
    }
    if (job && !job.nodes.some(n => n.node === node && n.attr === attr)) job.nodes.push({ node, attr, source });
    return null;
  }
  function apply(snapshot) {
    if (!snapshot || snapshot.revision === state.revision) return;
    if (localizer) localizer.stop();
    state = snapshot; generation++; requests.clear(); outgoing.length = 0; attempted.clear();
    if (localizer && state.settings.enabled) localizer.start(document.body);
  }
  function accept(results) {
    for (const result of results || []) {
      for (const [token, job] of requests) {
        if (job.id !== result.id) continue;
        requests.delete(token);
        if (job.generation !== generation || !result.entry) continue;
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
    hint.textContent = "点选不翻译的界面文字；Esc 退出。没有稳定定位的元素仅本次有效。";
    Object.assign(hint.style, { position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647", background: "#252525", color: "white", padding: "12px 18px", borderRadius: "8px", pointerEvents: "none", font: "13px sans-serif" });
    document.body.appendChild(hint);
    let target = null, priorOutline = "", priorOffset = "";
    function clearHighlight() { if (target) { target.style.outline = priorOutline; target.style.outlineOffset = priorOffset; } }
    function move(event) {
      clearHighlight(); target = event.target.closest("button,[role='menuitem'],label,[data-testid],span,p");
      if (!target || !P.regionOf(target)) { target = null; return; }
      priorOutline = target.style.outline; priorOffset = target.style.outlineOffset;
      target.style.outline = "2px solid #5daaff"; target.style.outlineOffset = "2px";
    }
    function block(event) { event.preventDefault(); event.stopImmediatePropagation(); }
    function click(event) {
      block(event);
      if (!target) return;
      const c = ownOriginals.get(target) || P.candidate(target, target.textContent);
      if (!c || !c.text || c.text.length > 260) { hint.textContent = "请选择一段较短的界面文字。"; return; }
      if (P.validCandidate(c) && c.anchor) { actions.push({ action: "exclude", data: c }); state.rules.push(c); }
      else temporary.add(target);
      hint.textContent = c.anchor && P.validCandidate(c) ? "已排除，可在汉化设置中恢复。" : "已排除，仅本次页面有效。";
      if (localizer) { localizer.stop(); generation++; requests.clear(); outgoing.length = 0; if (state.settings.enabled) localizer.start(document.body); }
      clearHighlight(); target = null;
    }
    function key(event) { if (event.key === "Escape") { block(event); cancelPicker(); } else if (event.key === "Enter" || event.key === " ") block(event); }
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
