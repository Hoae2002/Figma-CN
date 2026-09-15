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
    if (state.learned[k]) return window.FigmaZhLocalizer.preserveOuterWhitespace(source, state.learned[k].translation);
    if (!P.validCandidate(c)) return null;
    // User-facing tooltips can contain names. Only standalone UI labels are sent.
    if (/["“”‘’]/.test(c.text) || element.querySelector("input,textarea,[contenteditable='true'],[data-testid*='name']")) return null;
    if (c.context === "label" && !element.closest("label,h1,h2,h3,h4,h5,h6,[role='heading']") && !/(?:^|[-_])(?:label|heading|help-text)$/.test(c.anchor || "")) return null;
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
    hint.textContent = "点选不翻译的区域；按住 Alt 选择上层区域，Esc 退出。";
    Object.assign(hint.style, { position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647", background: "#252525", color: "white", padding: "12px 18px", borderRadius: "8px", pointerEvents: "none", font: "13px sans-serif" });
    document.body.appendChild(hint);
    let target = null, priorOutline = "", priorOffset = "";
    function clearHighlight() { if (target) { target.style.outline = priorOutline; target.style.outlineOffset = priorOffset; } }
    function move(event) {
      clearHighlight(); target = event.target.closest("button,[role='menuitem'],label,[data-testid],span,p");
      if (target && event.altKey) target = target.parentElement;
      if (!target || !P.regionOf(target) || P.regionOf(target) === "other") { target = null; return; }
      priorOutline = target.style.outline; priorOffset = target.style.outlineOffset;
      target.style.outline = "2px solid #5daaff"; target.style.outlineOffset = "2px";
    }
    function block(event) { event.preventDefault(); event.stopImmediatePropagation(); }
    function click(event) {
      block(event);
      if (!target) return;
      const c = ownOriginals.get(target) || P.candidate(target, target.textContent);
      if (!c) return;
      // Persist only an anchor on the selected node; never silently widen to an ancestor.
      c.anchor = target.getAttribute("data-testid");
      if (!/^[a-z][a-z_-]{2,100}$/i.test(c.anchor || "")) c.anchor = null;
      const rule = { ...c, text: c.text.slice(0, 100), scope: "element" };
      if (c.anchor) { actions.push({ action: "exclude", data: rule }); state.rules.push(rule); }
      else temporary.add(target);
      hint.textContent = c.anchor ? "已排除此区域，可在汉化设置中恢复。" : "已排除，仅本次页面有效；可在设置中排除整个面板。";
      if (localizer) { localizer.stop(); generation++; requests.clear(); outgoing.length = 0; attempted.clear(); if (state.settings.enabled) localizer.start(document.body); }
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
