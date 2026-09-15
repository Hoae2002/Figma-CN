(function () {
  "use strict";
  const P = window.FigBoostTranslationPolicy;
  if (!P || window.__FIGBOOST_TRANSLATION_RUNTIME__) return;
  let state = { settings: { enabled: false, communityOnline: false }, learned: {}, revision: -1 };
  let retryTimer = null;
  let generation = 0, sequence = 0, localizer = null;
  const requests = new Map(), outgoing = [], attempted = new Set();
  function candidate(node, source) {
    return P.candidate(node.nodeType === 3 ? node.parentElement : node, source);
  }
  function allowElement(element, source) {
    const c = P.candidate(element, source);
    return state.settings.enabled && !!c;
  }
  function resolveTranslation(source, node, builtin, attr) {
    const c = candidate(node, source);
    const element = node.nodeType === 3 ? node.parentElement : node;
    if (!c || !allowElement(element, source)) return null;
    const k = P.key(c.text, c.region, c.context);
    // The maintained Figma dictionary is authoritative. Machine cache and
    // Google are fallbacks only when the dictionary has no usable result.
    if (typeof builtin === "string" && builtin !== source && P.normalize(builtin) !== c.text) return builtin;
    const communityOnline = c.region === "community" && state.settings.communityOnline === true;
    if (communityOnline && state.learned[k]) return window.FigmaZhLocalizer.preserveOuterWhitespace(source, state.learned[k].translation);
    // Outside Community, dictionary misses stay in English. Legacy global
    // Google cache entries therefore cannot be replayed after this update.
    if (!communityOnline) return null;
    if (!P.validCandidate(c)) return null;
    // User-facing tooltips can contain names. Only standalone UI labels are sent.
    if (/["“”‘’]/.test(c.text) || element.querySelector("input,textarea,[contenteditable='true'],[data-testid*='name']")) return null;
    const standaloneLabel = element.closest("label,h1,h2,h3,h4,h5,h6,[role='heading']")
      || /(?:^|[-_])(?:label|heading|help-text)$/.test(c.anchor || "")
      || ["community", "menus", "right", "left", "toolbar", "home"].includes(c.region);
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
          if (allowElement(element, source)) localizer.enqueue(node);
        }
      }
    }
  }
  window.__FIGBOOST_TRANSLATION_RUNTIME__ = {
    bind: value => { localizer = value; }, allowElement, resolveTranslation, apply, accept,
    drain: () => ({ requests: outgoing.splice(0, 50) })
  };
})();
