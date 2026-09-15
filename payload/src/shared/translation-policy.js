(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FigBoostTranslationPolicy = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const regions = { community: "社区页面", toolbar: "工具栏", menus: "页面菜单", right: "右侧属性面板", left: "左侧面板", home: "文件首页导航", floating: "提示与弹窗", native: "原生桌面菜单", other: "未识别界面（受保护）" };
  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  const key = (text, region, context) => JSON.stringify(["en", "zh-CN", region, context || "label", normalize(text)]);
  function safeText(text) {
    return typeof text === "string" && text.length <= 260 && /[A-Za-z]/.test(text)
      && !/[\u3400-\u9fff<>@{}\\/\r\n\u0000-\u001f]/.test(text)
      && !/(?:https?:|www\.|[\w-]+\.(?:com|org|net|fig|png|jpg|svg|js|ts|json)\b|\b[0-9a-f]{8}-|\b\d{3,}\b)/i.test(text);
  }
  const protectedSelector = [
    "canvas", "svg", "iframe", "webview", "code", "pre", "input", "textarea", "select", "option",
    "[contenteditable]:not([contenteditable='false'])", "[role='textbox']", "[role='treeitem']", "[role='treegrid']",
    "[aria-label$=', file name']", "[aria-label='Left sidebar'] [role='grid']",
    "[data-figma-zh-skip]", "[data-testid*='canvas']", "[data-testid*='viewport']", "[aria-label='Canvas']", "[aria-label='Canvas viewport']",
    "[class^='canvas--']", "[class*=' canvas--']", "[class^='canvas_']", "[class*=' canvas_']",
    "[data-testid*='comment']", "[class*='comment']", "[data-testid*='plugin']", "[class*='plugin']",
    "[data-testid*='file-name']", "[data-testid*='file_name']", "[data-testid*='project-name']",
    "[data-testid*='filename' i]", "[data-testid*='file-title' i]", "[data-testid*='project-title' i]",
    "[data-testid*='workspace-name' i]", "[data-testid*='folder-name' i]", "[class*='file_title']",
    "[data-testid='ProfileButton']", "[aria-label^='Plan: ']", "[data-card-main-action]",
    "button[aria-description='Folder']", "button[aria-description$=' file']",
    "nav section button[aria-description]", "main [role='group'][aria-label]",
    "[data-testid*='team-name']", "[data-testid*='layer-name']", "[data-testid*='component-name']",
    "[data-testid*='variable-name']", "[data-testid*='font']", "[class*='font_picker']",
    "[data-testid*='variant-value']", "[data-testid*='property-value']", "[data-testid*='variable-value']",
    "[class*='variant_value']", "[class*='property_value']", "[class*='variable_value']",
    "[class*='variant_name']", "[data-testid*='variant-name']", "[data-testid*='property-name']",
    "[class*='file_name']", "[class*='project_name']", "[class*='team_name']", "[class*='layer_name']",
    "[class*='component_name']", "[class*='variable_name']", "[data-testid*='resource-name']",
    "a[href*='/design/']", "a[href*='/file/']", "a[href*='/board/']", "a[href*='/proto/']",
    "a[href*='/slides/']", "a[href*='/team/']", "a[href*='/project/']"
  ].join(",");
  function isCommunityLocation(location) {
    if (!location) return false;
    const route = `${location.pathname || ""}${location.search || ""}${location.hash || ""}`.toLowerCase();
    return /(?:^|[/?#=&])community(?:[/?#=&]|$)/.test(route);
  }
  function regionOf(element) {
    if (!element || !element.closest || element.closest(protectedSelector)) return null;
    const view = element.ownerDocument && element.ownerDocument.defaultView;
    // Community is the only online-translation boundary. Classify the whole
    // route first so layout changes cannot leak candidates into other regions.
    if (view && isCommunityLocation(view.location)) return "community";
    const tests = [
      ["menus", "[role='menu'],[role='menuitem'],[role='listbox'],[role='option'],[aria-haspopup='menu'],[aria-haspopup='listbox'],[data-testid*='context-menu']"],
      ["floating", "[role='tooltip'],[role='dialog'],[role='alertdialog']"],
      ["right", "[aria-label='Right sidebar'],[data-testid*='properties-panel'],[data-testid*='right-panel'],[class*='properties_panel'],[class*='right_panel']"],
      ["left", "[aria-label='Left sidebar'],[data-testid*='left-panel'],[class*='left_panel'],[data-testid*='layers-panel']"],
      ["toolbar", "[role='toolbar'],[data-testid*='toolbar'],[class*='toolbar']"],
      ["home", "nav,[role='navigation'],[data-testid*='file-browser-sidebar']"]
    ];
    for (const [region, selector] of tests) if (element.closest(selector)) return region;
    if (view && /^\/files(?:\/|$)/.test(view.location.pathname)) return "home";
    return "other";
  }
  function contextOf(element) {
    const control = element.closest("button,[role='button'],[role='menuitem'],label,[role='tooltip'],[role='tab'],[role='option'],[role='combobox'],[role='radio'],[role='checkbox'],[role='switch']");
    return control ? (control.getAttribute("role") || control.tagName.toLowerCase()) : "label";
  }
  function anchorOf(element) {
    const anchor = element.closest("[data-testid]");
    if (!anchor) return null;
    const value = anchor.getAttribute("data-testid");
    return /^[a-z][a-z_-]{2,100}$/i.test(value || "") ? value : null;
  }
  function candidate(element, text) {
    const region = regionOf(element);
    if (!region) return null;
    const anchors = []; for (let e = element; e; e = e.parentElement) if (e.hasAttribute("data-testid")) anchors.push(e.getAttribute("data-testid"));
    return { text: normalize(text), region, context: contextOf(element), anchor: anchorOf(element), anchors };
  }
  function mode(settings, region) { return settings.regions && settings.regions[region] || "hybrid"; }
  function excluded(c, rules) {
    return (rules || []).some(r => r.region === c.region && (r.scope === "region" || (r.scope === "element" ? r.anchor === c.anchor || (c.anchors || []).includes(r.anchor) : r.scope === "text" && r.text === c.text && r.context === c.context)));
  }
  function validCandidate(c) {
    return !!c && Object.hasOwn(regions, c.region) && c.region !== "other" && safeText(c.text)
      && typeof c.context === "string" && /^[a-z:-]{1,40}$/.test(c.context);
  }
  return { regions, normalize, key, safeText, protectedSelector, isCommunityLocation, regionOf, contextOf, anchorOf, candidate, mode, excluded, validCandidate };
});
