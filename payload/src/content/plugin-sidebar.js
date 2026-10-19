// Standalone FigBoost sidebar. FigmaEX's bundled sidebar was inspected for its
// resource API/menu integration; no Vue bundle, account service or updater is loaded.
(function () {
  "use strict";
  if (!/(^|\.)figma\.com$/.test(location.hostname) && !window.__FIGMA_ZH_TEST__) return;
  window.__figboostPluginSidebar?.destroy();
  const KEY_PREFIX = "figboost:plugin-sidebar:v1:";
  const MENU_ITEMS = '[role="menuitem"],[role="menuitemcheckbox"]';
  let host, root, panel, toggle, list, groups, status, search, editor, clearSearch;
  let state, storageKey, active = "saved", query = "", opened = false;
  let loading = false, running = false, disposed = false, generation = 0, routeTimer;
  const controllers = new Set();
  const blank = () => ({ plugins: [], saved: [], recent: [], favorites: [], groups: [] });
  const ids = value => Array.isArray(value) ? [...new Set(value.filter(x => typeof x === "string" && /^\d+$/.test(x)))] : [];
  const label = el => (el?.getAttribute("aria-label") || el?.textContent || "").trim();
  const visible = el => el?.isConnected && el.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"]');
  const isEditor = () => /^\/(design|file)\/[^/]+/.test(location.pathname);
  function accountKey() {
    let account = new URL(location.href).searchParams.get("fuid");
    try { account ||= localStorage.getItem("figment:userId") || sessionStorage.getItem("segment:userId"); } catch (_) {}
    return KEY_PREFIX + (/^\d+$/.test(account || "") ? account : "local");
  }
  function normalize(raw, resource) {
    if (!raw || typeof raw !== "object") return null;
    const version = raw.versions?.[raw.current_plugin_version_id] || raw;
    const id = String(version.plugin_id || raw.id || "");
    const name = version.name || resource?.name;
    if (!/^\d+$/.test(id) || typeof name !== "string" || !name.trim()) return null;
    const menus = version.manifest?.menu || raw.commands || [];
    const commands = [];
    function flatten(items, parents = []) {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (typeof item?.name !== "string") continue;
        if (Array.isArray(item.menu)) flatten(item.menu, [...parents, item.name]);
        else commands.push({ name: item.name, command: String(item.command || ""),
          path: Array.isArray(item.path) && item.path.every(x => typeof x === "string") ? item.path : [...parents, item.name] });
      }
    }
    flatten(menus);
    return { id, name: name.trim(), description: String(resource?.tagline || version.tagline || raw.description || ""),
      icon: safeIcon(resource?.icon_url || version.redirect_icon_url || raw.icon), commands };
  }
  function safeIcon(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try { const url = new URL(value, location.origin); return url.protocol === "https:" ? url.href : ""; } catch (_) { return ""; }
  }
  function readState() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey));
      if (!value || !Array.isArray(value.plugins) || !Array.isArray(value.groups)) return blank();
      const plugins = value.plugins.map(x => normalize(x)).filter(Boolean);
      const seen = new Set();
      return { plugins, saved: ids(value.saved), recent: ids(value.recent), favorites: ids(value.favorites),
        groups: value.groups.filter(g => typeof g?.id === "string" && g.id.startsWith("group-") && typeof g.name === "string" && !seen.has(g.id) && seen.add(g.id))
          .map(g => ({ id: g.id, name: g.name.slice(0, 80), plugins: ids(g.plugins) })) };
    } catch (_) { return blank(); }
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); return true; }
    catch (_) { announce("本地保存失败，本次修改仅在当前页面有效。请检查浏览器存储空间。", true); return false; }
  }
  function announce(text, error = false) {
    if (status) { status.textContent = text; status.dataset.error = String(error); }
  }
  async function request(path, options = {}) {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) throw Error("插件接口地址无效");
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url.href, { ...options, credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw Error(`插件列表请求失败（${response.status}）`);
      const data = await response.json();
      if (data.error) throw Error("插件列表暂时不可用");
      return data;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  function nativeRecent() {
    try {
      const raw = JSON.parse(localStorage.getItem("recent-plugins-figma-design") || "[]");
      if (!Array.isArray(raw)) return [];
      return ids(raw.filter(x => x && x.id).sort((a, b) => {
        const time = x => Math.max(0, ...Object.values(x.last_added_at_by_user_id || {}).map(Number).filter(Number.isFinite));
        return time(b) - time(a);
      }).map(x => String(x.id)));
    } catch (_) { return []; }
  }
  async function refresh() {
    if (loading || !host || !isEditor()) return;
    loading = true;
    const token = generation;
    announce("正在同步已保存插件…"); renderGroups();
    try {
      let next = "/api/resource_saves?page_size=50&resource_type=plugin&include_content=true&include_private_resources=false";
      const visited = new Set(), collected = new Map();
      while (next) {
        const url = new URL(next, location.origin);
        url.searchParams.set("include_content", "true");
        url.searchParams.set("resource_type", "plugin");
        if (visited.has(url.href) || visited.size >= 100) throw Error("插件列表分页异常，请稍后重试");
        visited.add(url.href);
        const data = await request(url.href);
        if (!Array.isArray(data.meta)) throw Error("插件列表数据格式已变化");
        for (const item of data.meta) {
          const plugin = normalize(item?.content?.plugin, item);
          if (plugin) collected.set(plugin.id, plugin);
        }
        next = data.pagination?.next_page || null;
      }
      const savedFromPages = [...collected.keys()];
      const recent = nativeRecent();
      const unknown = recent.filter(id => !collected.has(id) && !state.plugins.some(p => p.id === id));
      let recentError = false;
      for (let offset = 0; offset < unknown.length; offset += 50) {
        try {
          const data = await request("/api/plugins/batch", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-bypass": "yes" },
            body: JSON.stringify({ ids: unknown.slice(offset, offset + 50), include_pending: true, org_id: null }) });
          if (!Array.isArray(data.meta)) throw Error("最近插件格式已变化");
          for (const raw of data.meta) { const plugin = normalize(raw); if (plugin) collected.set(plugin.id, plugin); }
        } catch (_) { recentError = true; }
      }
      if (disposed || token !== generation || !isEditor()) return;
      const merged = new Map(state.plugins.map(p => [p.id, p]));
      for (const [id, p] of collected) merged.set(id, p);
      // Only the resource-saves response owns saved membership, never recent metadata.
      // Batch-only entries are excluded using the list collected before batching.
      state.saved = savedFromPages;
      state.plugins = [...merged.values()];
      state.recent = ids([...state.recent, ...recent]).slice(0, 50);
      if (persist()) announce(recentError ? "已同步收藏；部分最近插件未能读取，可稍后重试。" : `已同步 ${state.saved.length} 个已保存插件`);
      render();
    } catch (error) {
      if (!disposed && token === generation) announce(`${error.name === "AbortError" ? "插件列表请求超时" : error.message}，已保留原列表。点击刷新重试。`, true);
    } finally { if (token === generation) { loading = false; renderGroups(); } }
  }
  function button(text, title, action, className = "") {
    const el = document.createElement("button"); el.type = "button"; el.textContent = text;
    el.title = title; el.setAttribute("aria-label", title); el.className = className;
    el.addEventListener("click", action); return el;
  }
  function element(tag, className, text) {
    const el = document.createElement(tag); el.className = className;
    if (text !== undefined) el.textContent = text; return el;
  }
  function members(id = active) {
    return id === "saved" ? state.saved : id === "recent" ? state.recent : id === "favorites" ? state.favorites : state.groups.find(g => g.id === id)?.plugins || [];
  }
  function renderGroups() {
    if (!groups) return;
    groups.replaceChildren();
    for (const g of [{ id: "recent", name: "最近使用" }, { id: "saved", name: "已保存" }, { id: "favorites", name: "星标" }, ...state.groups]) {
      const row = element("div", "group-row");
      const b = button("", g.name, () => { active = g.id; query = ""; search.value = ""; editor.hidden = true; render(); }, "group");
      b.append(element("span", "name", g.name));
      b.dataset.id = g.id;
      b.classList.toggle("active", active === g.id);
      b.setAttribute("aria-pressed", String(active === g.id));
      b.appendChild(element("span", "len count", String(members(g.id).length))); row.appendChild(b);
      if (g.id.startsWith("group-")) row.appendChild(button("⋯", `管理分组 ${g.name}`, () => editGroup(g), "manage"));
      groups.appendChild(row);
    }
    groups.appendChild(button("＋ 新建分组", "新建分组", () => editGroup(), "new-group group"));
  }
  function render() {
    if (!list) return;
    renderGroups(); list.replaceChildren(); clearSearch.hidden = !query;
    const selected = new Set(members());
    const q = query.trim().toLocaleLowerCase();
    // Search includes all cached groups; an empty search restores the selected group.
    const items = (q ? state.plugins : members().map(id => state.plugins.find(p => p.id === id)).filter(Boolean))
      .filter(p => !q || `${p.name} ${p.description}`.toLocaleLowerCase().includes(q));
    if (!items.length) list.appendChild(element("p", "empty", q ? "没有匹配的插件" : "暂无插件。可先在 Figma 中保存插件，再点击刷新。"));
    for (const p of items) {
      const row = element("div", "ActionItem plugin"); row.dataset.pluginId = p.id;
      const run = button("", `运行 ${p.name}`, () => chooseCommand(p), "run"); run.disabled = running;
      const icon = element("span", "main-icon icon", p.name.slice(0, 1));
      if (p.icon) { const img = document.createElement("img"); img.src = p.icon; img.alt = ""; img.referrerPolicy = "no-referrer"; img.addEventListener("error", () => img.remove(), { once: true }); icon.appendChild(img); }
      const info = element("span", "action-info info"); info.append(element("span", "name", p.name), element("span", "note-name description", p.description));
      run.append(info); row.appendChild(run);
      const controls = element("div", "buttons");
      const starred = state.favorites.includes(p.id);
      const star = button("", `${starred ? "取消星标" : "星标"} ${p.name}`, () => {
        state.favorites = starred ? state.favorites.filter(id => id !== p.id) : [...state.favorites, p.id]; persist(); render();
      }, "star-but star"); star.classList.toggle("isStar", starred); star.setAttribute("aria-pressed", String(starred)); controls.appendChild(star);
      controls.appendChild(button("＋", `将 ${p.name} 加入分组`, () => chooseGroup(p), "note-but add"));
      if (active.startsWith("group-") && selected.has(p.id)) controls.appendChild(button("−", `从当前分组移除 ${p.name}`, () => {
        const group = state.groups.find(g => g.id === active); group.plugins = group.plugins.filter(id => id !== p.id); persist(); render();
      }, "note-but remove"));
      icon.title = p.name; icon.addEventListener("click", () => { if (!running) chooseCommand(p); });
      icon.setAttribute("role", "button"); icon.setAttribute("aria-label", `运行 ${p.name}`);
      icon.addEventListener("keydown", event => { if (!running && ["Enter", " "].includes(event.key)) { event.preventDefault(); chooseCommand(p); } });
      row.append(controls, icon);
      list.appendChild(row);
    }
    exposeControls();
  }
  function editGroup(group) {
    editor.replaceChildren(); editor.hidden = false;
    const input = document.createElement("input"); input.maxLength = 80; input.value = group?.name || ""; input.placeholder = "分组名称"; input.setAttribute("aria-label", "分组名称");
    const save = () => {
      const name = input.value.trim();
      if (!name) { announce("请输入分组名称。", true); input.focus(); return; }
      if (state.groups.some(g => g !== group && g.name === name)) { announce("已有同名分组。", true); return; }
      if (group) group.name = name;
      else { group = { id: "group-" + crypto.randomUUID(), name, plugins: [] }; state.groups.push(group); active = group.id; }
      const saved = persist(); editor.hidden = true; render(); if (saved) announce("分组已保存");
    };
    editor.append(input, button("保存", "保存分组", save), button("取消", "取消编辑", () => { editor.hidden = true; }));
    input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); save(); } });
    if (group) editor.appendChild(button("删除分组", "删除分组", () => {
      editor.replaceChildren(element("span", "", "删除此分组？插件仍会保留。"), button("确认删除", "确认删除分组", () => {
        state.groups = state.groups.filter(g => g.id !== group.id); if (active === group.id) active = "saved";
        const saved = persist(); editor.hidden = true; render(); if (saved) announce("分组已删除");
      }), button("取消", "取消删除", () => editGroup(group)));
    }));
    input.focus();
  }
  function chooseGroup(plugin) {
    editor.replaceChildren(); editor.hidden = false;
    if (!state.groups.length) { editGroup(); announce("先新建分组，再点击插件右侧的＋。 "); return; }
    for (const group of state.groups) {
      const b = button(group.name, `加入 ${group.name}`, () => {
        group.plugins = ids([...group.plugins, plugin.id]); const saved = persist(); editor.hidden = true; render(); if (saved) announce(`已加入 ${group.name}`);
      }); b.disabled = group.plugins.includes(plugin.id); editor.appendChild(b);
    }
    editor.appendChild(button("取消", "取消加入分组", () => { editor.hidden = true; }));
  }
  function chooseCommand(plugin) {
    if (running) return;
    if (!plugin.commands.length) { runPlugin(plugin); return; }
    editor.replaceChildren(); editor.hidden = false;
    for (const command of plugin.commands) {
      const name = command.path.join(" / ");
      editor.appendChild(button(name, `运行命令 ${name}`, () => { editor.hidden = true; runPlugin(plugin, command.path); }));
    }
    editor.appendChild(button("取消", "取消运行", () => { editor.hidden = true; }));
  }
  function waitFor(find, token, timeout = 1800) {
    const started = performance.now();
    return new Promise((resolve, reject) => {
      function poll() {
        if (disposed || token !== generation || !isEditor()) return reject(Error("页面已切换，插件启动已取消"));
        const result = find(); if (result) return resolve(result);
        if (performance.now() - started >= timeout) return reject(Error("未找到插件菜单，请在 Figma 中确认该插件已保存"));
        setTimeout(poll, 40);
      }
      poll();
    });
  }
  function pointer(el, click = true) {
    const options = { bubbles: true, cancelable: true, view: window, pointerType: "mouse", pointerId: 1, isPrimary: true };
    for (const type of ["pointerover", "pointerenter", "mouseover", "mousemove", ...(click ? ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] : [])]) {
      el.dispatchEvent(new (type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent)(type, options));
    }
  }
  function menuItem(names) {
    return Array.from(document.querySelectorAll(MENU_ITEMS)).find(el => visible(el) && names.includes(label(el)));
  }
  async function runPlugin(plugin, command) {
    if (running) return false;
    running = true; render(); announce(`正在打开 ${plugin.name}…`);
    const token = generation;
    let openedMenu = false;
    try {
      const native = Array.from(document.querySelectorAll("button")).find(el => visible(el) && !el.disabled && label(el) === `Run ${plugin.name}`);
      if (native && !command) pointer(native);
      else {
        const main = document.querySelector('[aria-label="Main menu"],[aria-label="主菜单"],[data-tooltip*="main-menu"]');
        if (!visible(main)) throw Error("未找到 Figma 主菜单，请退出演示或全屏隐藏界面模式后重试");
        if (main.getAttribute("aria-expanded") !== "true") pointer(main);
        openedMenu = true;
        const plugins = await waitFor(() => menuItem(["Plugins", "插件"]), token); pointer(plugins);
        // Native recent plugins can be run without being in Saved plugins.
        const entry = await waitFor(() => menuItem([plugin.name]) || menuItem(["Saved plugins", "Installed plugins", "已保存插件", "已保存的插件", "全部插件"]), token);
        pointer(entry);
        if (label(entry) !== plugin.name) { const target = await waitFor(() => menuItem([plugin.name]), token); pointer(target); }
        for (const name of command || []) { const item = await waitFor(() => menuItem([name]), token); pointer(item); }
      }
      if (token !== generation) return false;
      state.recent = ids([plugin.id, ...state.recent]).slice(0, 50);
      if (persist()) announce(`已发送 ${plugin.name}${command ? " / " + command.join(" / ") : ""} 的原生运行操作`); return true;
    } catch (error) {
      if (token === generation && !disposed) announce(error.message + "。可通过 Figma 原生插件菜单重试。", true);
      if (openedMenu) document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      return false;
    } finally { if (token === generation) { running = false; render(); } }
  }
  function setOpen(value, focus = true) {
    opened = value; panel.classList.toggle("expanded", value); toggle.setAttribute("aria-expanded", String(value));
    if (!value) editor.hidden = true;
    exposeControls();
    if (value) { if (focus) search.focus(); if (!state.plugins.length) refresh(); } else if (focus) toggle.focus();
  }
  function exposeControls() {
    if (!root) return;
    for (const el of root.querySelectorAll('.area-groups,.find-input,.setting-but')) el.inert = !opened;
    for (const el of root.querySelectorAll('.run,.buttons button,.reseize-hand')) el.tabIndex = opened ? 0 : -1;
    for (const el of root.querySelectorAll('.main-icon')) { el.tabIndex = opened ? -1 : 0; el.setAttribute("aria-hidden", String(opened)); }
  }
  function position() {
    if (!host) return;
    const native = document.querySelector('[aria-label="Right sidebar"],[aria-label="右侧边栏"]');
    const bounds = native?.getBoundingClientRect();
    const right = bounds && bounds.width > 0 ? Math.max(14, innerWidth - bounds.left + 14) : 254;
    host.style.right = innerWidth < 700 ? "12px" : String(Math.min(right, Math.max(12, innerWidth - 80))) + "px";
    host.style.top = Math.max(13, bounds?.top || 13) + "px";
  }
  function mount() {
    host = document.createElement("div"); host.id = "figboost-plugin-sidebar"; host.setAttribute("data-figma-zh-skip", "1");
    host.style.cssText = "position:fixed;z-index:90;pointer-events:none";
    root = host.attachShadow({ mode: "open" });
    // Original FigmaEX 1.5.100 CSS modules 15401 (ExBar), 25116 (ActionItem),
    // 74692 (GroupPad), plus its shared dark theme. Only selectors are scoped
    // for Shadow DOM and accessible buttons; dimensions, colors and assets are retained.
    const originalCss = ".FigmaExApp{font-family:Inter,PingFang SC,Microsoft YaHei,Source Han Sans SC,Noto Sans CJK SC,WenQuanYi Micro Hei,sans-serif}\n.FigmaExApp .ExBar{position:fixed;z-index:0;display:flex;place-items:flex-start;align-items:stretch;right:253px;top:71px;width:54px;height:auto;min-height:104px;flex-direction:row-reverse;background:rgba(0,0,0,0);border-radius:8px;transition:none;overflow:hidden}\n.FigmaExApp .ExBar .area-actions{display:flex;place-items:flex-start;flex-direction:column;overflow:hidden;padding-bottom:10px;background:#fff;width:240px;flex:none;order:1}\n.FigmaExApp .ExBar .area-groups{display:flex;place-items:flex-start;flex-direction:column;overflow:hidden;position:relative;z-index:20;flex:none;width:160px;order:2}\n.FigmaExApp .ExBar *{user-select:none}\n.FigmaExApp .ExBar.resizeing{transition:none}\n.FigmaExApp .ExBar.mini:not(.expanded):not(.focus){height:54px;min-height:42px;padding-bottom:0}\n.FigmaExApp .ExBar.mini:not(.expanded):not(.focus) .reseize-hand{display:none}\n.FigmaExApp .ExBar.expanded{width:400px;transition:none}\n.FigmaExApp .ExBar.expanded .header .logo-but:not(.color){opacity:0}\n.FigmaExApp .ExBar .action-list{overflow:hidden;overflow-y:auto;overscroll-behavior:none;width:240px;flex:none;direction:rtl;height:calc(100% - 54px)}\n.FigmaExApp .ExBar .action-list>*{direction:ltr}\n.FigmaExApp .ExBar .action-list::-webkit-scrollbar{width:8px !important}\n.FigmaExApp .ExBar .action-list::-webkit-scrollbar-thumb{border-radius:13px;border:2px solid #fff;transition:all .5s}\n.FigmaExApp .ExBar .action-list::-webkit-scrollbar-thumb:hover{background-color:rgba(0,0,0,.2);transition:all .5s}\n.FigmaExApp .ExBar .action-list::-webkit-scrollbar-thumb{background-color:rgba(112,109,158,.21)}\n.FigmaExApp .ExBar .action-list .empty-found{width:100%;font-size:13px;text-align:center;margin-top:0;color:rgba(115,115,126,.4705882353);line-height:20px;height:54px;display:flex;place-items:center;place-content:center}\n.FigmaExApp .ExBar .mSortlist[data-type=actions_top]{border-bottom:1px solid rgba(0,0,0,.0901960784)}\n.FigmaExApp .ExBar .over-shadow{height:10px;width:54px;background:linear-gradient(#ffffff 0, rgba(255, 255, 255, 0.6588235294) 50%, rgba(255, 255, 255, 0) 100%);position:absolute;top:50px;z-index:2}\n.FigmaExApp .ExBar .header{background:#f8f8fd;height:54px;border-radius:0;width:240px;display:flex;place-items:center;padding:0 20px;box-sizing:border-box;flex:none}\n.FigmaExApp .ExBar .header .find-input{display:flex;align-items:center}\n.FigmaExApp .ExBar .header .find-input input{width:114px;min-width:50px;height:30px;border-radius:6px;background:rgba(0,0,0,0);font-size:13px}\n.FigmaExApp .ExBar .header .find-input input ::-webkit-input-placeholder{color:rgba(117,117,117,.73)}\n.FigmaExApp .ExBar .header .title{font-size:14px;font-weight:500}\n.FigmaExApp .ExBar .header .logo-but{position:absolute;right:10px;top:10px;width:34px;height:34px;background:url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzQiIGhlaWdodD0iMzQiIHZpZXdCb3g9IjAgMCAzNCAzNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgZmlsdGVyPSJ1cmwoI2ZpbHRlcjBfaSkiPgo8ZyBjbGlwLXBhdGg9InVybCgjY2xpcDApIj4KPHBhdGggZD0iTTAgMTdDMCA4Ljk4NjEyIDAgNC45NzkxOCAyLjQ4OTU5IDIuNDg5NTlDNC45NzkxOCAwIDguOTg2MTIgMCAxNyAwQzI1LjAxMzkgMCAyOS4wMjA4IDAgMzEuNTEwNCAyLjQ4OTU5QzM0IDQuOTc5MTggMzQgOC45ODYxMiAzNCAxN0MzNCAyNS4wMTM5IDM0IDI5LjAyMDggMzEuNTEwNCAzMS41MTA0QzI5LjAyMDggMzQgMjUuMDEzOSAzNCAxNyAzNEM4Ljk4NjEyIDM0IDQuOTc5MTggMzQgMi40ODk1OSAzMS41MTA0QzAgMjkuMDIwOCAwIDI1LjAxMzkgMCAxN1oiIGZpbGw9IiNFQUYxRkYiLz4KPGcgZmlsdGVyPSJ1cmwoI2ZpbHRlcjFfZikiPgo8Y2lyY2xlIGN4PSIxNi45OTk5IiBjeT0iMzMuNTc1IiByPSI1LjEiIGZpbGw9IiNGMEY0RkYiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyMl9mKSI+CjxjaXJjbGUgY3g9IjE2Ljk5OTkiIGN5PSIyMS42NzUiIHI9IjUuMSIgZmlsbD0iI0YwRjRGRiIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXIzX2YpIj4KPGNpcmNsZSBjeD0iMTYuOTk5OSIgY3k9IjkuNzc0OTkiIHI9IjUuMSIgZmlsbD0iI0YwRjRGRiIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXI0X2IpIj4KPHJlY3QgeD0iMjUuNSIgeT0iMzQiIHdpZHRoPSIxNyIgaGVpZ2h0PSIzNCIgdHJhbnNmb3JtPSJyb3RhdGUoLTE4MCAyNS41IDM0KSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC42Ii8+CjwvZz4KPGcgZmlsdGVyPSJ1cmwoI2ZpbHRlcjVfaSkiPgo8cmVjdCB4PSIxMS44OTk5IiB5PSI0LjY3NDk5IiB3aWR0aD0iMTAuMiIgaGVpZ2h0PSIxMC4yIiByeD0iMi41NSIgZmlsbD0iI0RCRTdGRiIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXI2X2kpIj4KPHJlY3QgeD0iMTEuODk5OSIgeT0iMTYuNTc1IiB3aWR0aD0iMTAuMiIgaGVpZ2h0PSIxMC4yIiByeD0iMi41NSIgZmlsbD0iI0RCRTdGRiIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXI3X2kpIj4KPHJlY3QgeD0iMTEuODk5OSIgeT0iMjguMDcyNiIgd2lkdGg9IjEwLjIiIGhlaWdodD0iMTAuMiIgcng9IjIuNTUiIGZpbGw9IiNEQkU3RkYiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyOF9mKSI+CjxyZWN0IHg9IjE0LjAyNDkiIHk9IjYuMzc1IiB3aWR0aD0iNS41MjUiIGhlaWdodD0iMC4yMTI1IiByeD0iMC4xMDYyNSIgZmlsbD0id2hpdGUiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyOV9mKSI+CjxyZWN0IHg9IjE0LjAyNDkiIHk9IjE4LjciIHdpZHRoPSI1LjUyNSIgaGVpZ2h0PSIwLjIxMjUiIHJ4PSIwLjEwNjI1IiBmaWxsPSJ3aGl0ZSIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXIxMF9mKSI+CjxyZWN0IHg9IjE0LjAyNDkiIHk9IjMwLjE3NSIgd2lkdGg9IjUuNTI1IiBoZWlnaHQ9IjAuMjEyNSIgcng9IjAuMTA2MjUiIGZpbGw9IndoaXRlIi8+CjwvZz4KPC9nPgo8L2c+CjxkZWZzPgo8ZmlsdGVyIGlkPSJmaWx0ZXIwX2kiIHg9IjAiIHk9IjAiIHdpZHRoPSIzNCIgaGVpZ2h0PSIzNCIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIwIiByZXN1bHQ9IkJhY2tncm91bmRJbWFnZUZpeCIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJzaGFwZSIvPgo8ZmVDb2xvck1hdHJpeCBpbj0iU291cmNlQWxwaGEiIHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAxMjcgMCIgcmVzdWx0PSJoYXJkQWxwaGEiLz4KPGZlT2Zmc2V0Lz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMiIvPgo8ZmVDb21wb3NpdGUgaW4yPSJoYXJkQWxwaGEiIG9wZXJhdG9yPSJhcml0aG1ldGljIiBrMj0iLTEiIGszPSIxIi8+CjxmZUNvbG9yTWF0cml4IHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAuODM4NTQyIDAgMCAwIDAgMC44Nzc1NDQgMCAwIDAgMCAwLjk1ODMzMyAwIDAgMCAwLjUgMCIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluMj0ic2hhcGUiIHJlc3VsdD0iZWZmZWN0MV9pbm5lclNoYWRvdyIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyMV9mIiB4PSItNS4xMDAxIiB5PSIxMS40NzUiIHdpZHRoPSI0NC4yIiBoZWlnaHQ9IjQ0LjIiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJCYWNrZ3JvdW5kSW1hZ2VGaXgiIHJlc3VsdD0ic2hhcGUiLz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iOC41IiByZXN1bHQ9ImVmZmVjdDFfZm9yZWdyb3VuZEJsdXIiLz4KPC9maWx0ZXI+CjxmaWx0ZXIgaWQ9ImZpbHRlcjJfZiIgeD0iLTUuMTAwMSIgeT0iLTAuNDI0OTg4IiB3aWR0aD0iNDQuMiIgaGVpZ2h0PSI0NC4yIiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+CjxmZUZsb29kIGZsb29kLW9wYWNpdHk9IjAiIHJlc3VsdD0iQmFja2dyb3VuZEltYWdlRml4Ii8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW49IlNvdXJjZUdyYXBoaWMiIGluMj0iQmFja2dyb3VuZEltYWdlRml4IiByZXN1bHQ9InNoYXBlIi8+CjxmZUdhdXNzaWFuQmx1ciBzdGREZXZpYXRpb249IjguNSIgcmVzdWx0PSJlZmZlY3QxX2ZvcmVncm91bmRCbHVyIi8+CjwvZmlsdGVyPgo8ZmlsdGVyIGlkPSJmaWx0ZXIzX2YiIHg9Ii01LjEwMDEiIHk9Ii0xMi4zMjUiIHdpZHRoPSI0NC4yIiBoZWlnaHQ9IjQ0LjIiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJCYWNrZ3JvdW5kSW1hZ2VGaXgiIHJlc3VsdD0ic2hhcGUiLz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iOC41IiByZXN1bHQ9ImVmZmVjdDFfZm9yZWdyb3VuZEJsdXIiLz4KPC9maWx0ZXI+CjxmaWx0ZXIgaWQ9ImZpbHRlcjRfYiIgeD0iNi44IiB5PSItMS43IiB3aWR0aD0iMjAuNCIgaGVpZ2h0PSIzNy40IiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+CjxmZUZsb29kIGZsb29kLW9wYWNpdHk9IjAiIHJlc3VsdD0iQmFja2dyb3VuZEltYWdlRml4Ii8+CjxmZUdhdXNzaWFuQmx1ciBpbj0iQmFja2dyb3VuZEltYWdlIiBzdGREZXZpYXRpb249IjAuODUiLz4KPGZlQ29tcG9zaXRlIGluMj0iU291cmNlQWxwaGEiIG9wZXJhdG9yPSJpbiIgcmVzdWx0PSJlZmZlY3QxX2JhY2tncm91bmRCbHVyIi8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW49IlNvdXJjZUdyYXBoaWMiIGluMj0iZWZmZWN0MV9iYWNrZ3JvdW5kQmx1ciIgcmVzdWx0PSJzaGFwZSIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyNV9pIiB4PSIxMS44OTk5IiB5PSI0LjY3NDk5IiB3aWR0aD0iMTAuMiIgaGVpZ2h0PSIxMC4yIiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+CjxmZUZsb29kIGZsb29kLW9wYWNpdHk9IjAiIHJlc3VsdD0iQmFja2dyb3VuZEltYWdlRml4Ii8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW49IlNvdXJjZUdyYXBoaWMiIGluMj0iQmFja2dyb3VuZEltYWdlRml4IiByZXN1bHQ9InNoYXBlIi8+CjxmZUNvbG9yTWF0cml4IGluPSJTb3VyY2VBbHBoYSIgdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDEyNyAwIiByZXN1bHQ9ImhhcmRBbHBoYSIvPgo8ZmVPZmZzZXQvPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIxIi8+CjxmZUNvbXBvc2l0ZSBpbjI9ImhhcmRBbHBoYSIgb3BlcmF0b3I9ImFyaXRobWV0aWMiIGsyPSItMSIgazM9IjEiLz4KPGZlQ29sb3JNYXRyaXggdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMC44MzMzMzMgMCAwIDAgMCAwLjg4NzU5NyAwIDAgMCAwIDEgMCAwIDAgMSAwIi8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW4yPSJzaGFwZSIgcmVzdWx0PSJlZmZlY3QxX2lubmVyU2hhZG93Ii8+CjwvZmlsdGVyPgo8ZmlsdGVyIGlkPSJmaWx0ZXI2X2kiIHg9IjExLjg5OTkiIHk9IjE2LjU3NSIgd2lkdGg9IjEwLjIiIGhlaWdodD0iMTAuMiIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIwIiByZXN1bHQ9IkJhY2tncm91bmRJbWFnZUZpeCIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJzaGFwZSIvPgo8ZmVDb2xvck1hdHJpeCBpbj0iU291cmNlQWxwaGEiIHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAxMjcgMCIgcmVzdWx0PSJoYXJkQWxwaGEiLz4KPGZlT2Zmc2V0Lz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMSIvPgo8ZmVDb21wb3NpdGUgaW4yPSJoYXJkQWxwaGEiIG9wZXJhdG9yPSJhcml0aG1ldGljIiBrMj0iLTEiIGszPSIxIi8+CjxmZUNvbG9yTWF0cml4IHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAuODMzMzMzIDAgMCAwIDAgMC44ODc1OTcgMCAwIDAgMCAxIDAgMCAwIDEgMCIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluMj0ic2hhcGUiIHJlc3VsdD0iZWZmZWN0MV9pbm5lclNoYWRvdyIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyN19pIiB4PSIxMS44OTk5IiB5PSIyOC4wNzI2IiB3aWR0aD0iMTAuMiIgaGVpZ2h0PSIxMC4yIiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+CjxmZUZsb29kIGZsb29kLW9wYWNpdHk9IjAiIHJlc3VsdD0iQmFja2dyb3VuZEltYWdlRml4Ii8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW49IlNvdXJjZUdyYXBoaWMiIGluMj0iQmFja2dyb3VuZEltYWdlRml4IiByZXN1bHQ9InNoYXBlIi8+CjxmZUNvbG9yTWF0cml4IGluPSJTb3VyY2VBbHBoYSIgdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDEyNyAwIiByZXN1bHQ9ImhhcmRBbHBoYSIvPgo8ZmVPZmZzZXQvPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIxIi8+CjxmZUNvbXBvc2l0ZSBpbjI9ImhhcmRBbHBoYSIgb3BlcmF0b3I9ImFyaXRobWV0aWMiIGsyPSItMSIgazM9IjEiLz4KPGZlQ29sb3JNYXRyaXggdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMC44MzMzMzMgMCAwIDAgMCAwLjg4NzU5NyAwIDAgMCAwIDEgMCAwIDAgMSAwIi8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW4yPSJzaGFwZSIgcmVzdWx0PSJlZmZlY3QxX2lubmVyU2hhZG93Ii8+CjwvZmlsdGVyPgo8ZmlsdGVyIGlkPSJmaWx0ZXI4X2YiIHg9IjEyLjMyNDkiIHk9IjQuNjc1IiB3aWR0aD0iOC45MjUiIGhlaWdodD0iMy42MTI1IiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+CjxmZUZsb29kIGZsb29kLW9wYWNpdHk9IjAiIHJlc3VsdD0iQmFja2dyb3VuZEltYWdlRml4Ii8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW49IlNvdXJjZUdyYXBoaWMiIGluMj0iQmFja2dyb3VuZEltYWdlRml4IiByZXN1bHQ9InNoYXBlIi8+CjxmZUdhdXNzaWFuQmx1ciBzdGREZXZpYXRpb249IjAuODUiIHJlc3VsdD0iZWZmZWN0MV9mb3JlZ3JvdW5kQmx1ciIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyOV9mIiB4PSIxMi4zMjQ5IiB5PSIxNyIgd2lkdGg9IjguOTI1IiBoZWlnaHQ9IjMuNjEyNSIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIwIiByZXN1bHQ9IkJhY2tncm91bmRJbWFnZUZpeCIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJzaGFwZSIvPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIwLjg1IiByZXN1bHQ9ImVmZmVjdDFfZm9yZWdyb3VuZEJsdXIiLz4KPC9maWx0ZXI+CjxmaWx0ZXIgaWQ9ImZpbHRlcjEwX2YiIHg9IjEyLjMyNDkiIHk9IjI4LjQ3NSIgd2lkdGg9IjguOTI1IiBoZWlnaHQ9IjMuNjEyNSIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIwIiByZXN1bHQ9IkJhY2tncm91bmRJbWFnZUZpeCIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJzaGFwZSIvPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIwLjg1IiByZXN1bHQ9ImVmZmVjdDFfZm9yZWdyb3VuZEJsdXIiLz4KPC9maWx0ZXI+CjxjbGlwUGF0aCBpZD0iY2xpcDAiPgo8cGF0aCBkPSJNMCAxN0MwIDguOTg2MTIgMCA0Ljk3OTE4IDIuNDg5NTkgMi40ODk1OUM0Ljk3OTE4IDAgOC45ODYxMiAwIDE3IDBDMjUuMDEzOSAwIDI5LjAyMDggMCAzMS41MTA0IDIuNDg5NTlDMzQgNC45NzkxOCAzNCA4Ljk4NjEyIDM0IDE3QzM0IDI1LjAxMzkgMzQgMjkuMDIwOCAzMS41MTA0IDMxLjUxMDRDMjkuMDIwOCAzNCAyNS4wMTM5IDM0IDE3IDM0QzguOTg2MTIgMzQgNC45NzkxOCAzNCAyLjQ4OTU5IDMxLjUxMDRDMCAyOS4wMjA4IDAgMjUuMDEzOSAwIDE3WiIgZmlsbD0id2hpdGUiLz4KPC9jbGlwUGF0aD4KPC9kZWZzPgo8L3N2Zz4K);transition:all .3s ease;cursor:pointer}\n.FigmaExApp .ExBar .header .logo-but.color{background:url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzQiIGhlaWdodD0iMzQiIHZpZXdCb3g9IjAgMCAzNCAzNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwKSI+CjxwYXRoIGQ9Ik0wIDE3QzAgOC45ODYxMiAwIDQuOTc5MTggMi40ODk1OSAyLjQ4OTU5QzQuOTc5MTggMCA4Ljk4NjEyIDAgMTcgMEMyNS4wMTM5IDAgMjkuMDIwOCAwIDMxLjUxMDQgMi40ODk1OUMzNCA0Ljk3OTE4IDM0IDguOTg2MTIgMzQgMTdDMzQgMjUuMDEzOSAzNCAyOS4wMjA4IDMxLjUxMDQgMzEuNTEwNEMyOS4wMjA4IDM0IDI1LjAxMzkgMzQgMTcgMzRDOC45ODYxMiAzNCA0Ljk3OTE4IDM0IDIuNDg5NTkgMzEuNTEwNEMwIDI5LjAyMDggMCAyNS4wMTM5IDAgMTdaIiBmaWxsPSIjRUFFQkZGIi8+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXIwX2YpIj4KPGNpcmNsZSBjeD0iMTYuOTk5OSIgY3k9IjMzLjU3NSIgcj0iNS4xIiBmaWxsPSIjMUFCQ0ZFIi8+CjwvZz4KPGcgZmlsdGVyPSJ1cmwoI2ZpbHRlcjFfZikiPgo8Y2lyY2xlIGN4PSIxNi45OTk5IiBjeT0iMjEuNjc1IiByPSI1LjEiIGZpbGw9IiNBMjU5RkYiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyMl9mKSI+CjxjaXJjbGUgY3g9IjE2Ljk5OTkiIGN5PSI5Ljc3NDk5IiByPSI1LjEiIGZpbGw9IiNGMjRFMUUiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyM19iKSI+CjxyZWN0IHg9IjI1LjUiIHk9IjM0IiB3aWR0aD0iMTciIGhlaWdodD0iMzQiIHRyYW5zZm9ybT0icm90YXRlKC0xODAgMjUuNSAzNCkiIGZpbGw9IndoaXRlIiBmaWxsLW9wYWNpdHk9IjAuNSIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXI0X2QpIj4KPHJlY3QgeD0iMTEuODk5OSIgeT0iNC42NzQ5OSIgd2lkdGg9IjEwLjIiIGhlaWdodD0iMTAuMiIgcng9IjIuNTUiIGZpbGw9IiNGMjRFMUUiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyNV9kKSI+CjxyZWN0IHg9IjExLjg5OTkiIHk9IjE2LjU3NSIgd2lkdGg9IjEwLjIiIGhlaWdodD0iMTAuMiIgcng9IjIuNTUiIGZpbGw9IiNBMjU5RkYiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyNl9kKSI+CjxyZWN0IHg9IjExLjg5OTkiIHk9IjI4LjA3MjYiIHdpZHRoPSIxMC4yIiBoZWlnaHQ9IjEwLjIiIHJ4PSIyLjU1IiBmaWxsPSIjMUFCQ0ZFIi8+CjwvZz4KPG1hc2sgaWQ9Im1hc2swIiBtYXNrLXR5cGU9ImFscGhhIiBtYXNrVW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4PSIxMSIgeT0iNCIgd2lkdGg9IjEyIiBoZWlnaHQ9IjExIj4KPHJlY3QgeD0iMTEuODk5OSIgeT0iNC42NzQ5OSIgd2lkdGg9IjEwLjIiIGhlaWdodD0iMTAuMiIgcng9IjIuNTUiIGZpbGw9IiNGMjRFMUUiLz4KPC9tYXNrPgo8ZyBtYXNrPSJ1cmwoI21hc2swKSI+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXI3X2YpIj4KPHJlY3QgeD0iMTIuNzUiIHk9IjUuNTI0OTkiIHdpZHRoPSI4LjUiIGhlaWdodD0iOC41IiByeD0iMi41NSIgZmlsbD0iI0ZGNzM0QSIgZmlsbC1vcGFjaXR5PSIwLjgiLz4KPC9nPgo8L2c+CjxtYXNrIGlkPSJtYXNrMSIgbWFzay10eXBlPSJhbHBoYSIgbWFza1VuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeD0iMTEiIHk9IjE2IiB3aWR0aD0iMTIiIGhlaWdodD0iMTEiPgo8cmVjdCB4PSIxMS44OTk5IiB5PSIxNi41NzUiIHdpZHRoPSIxMC4yIiBoZWlnaHQ9IjEwLjIiIHJ4PSIyLjU1IiBmaWxsPSIjRjI0RTFFIi8+CjwvbWFzaz4KPGcgbWFzaz0idXJsKCNtYXNrMSkiPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyOF9mKSI+CjxyZWN0IHg9IjEyLjc1IiB5PSIxNy40MjUiIHdpZHRoPSI4LjUiIGhlaWdodD0iOC41IiByeD0iMi41NSIgZmlsbD0iI0FGNzFGRiIvPgo8L2c+CjwvZz4KPG1hc2sgaWQ9Im1hc2syIiBtYXNrLXR5cGU9ImFscGhhIiBtYXNrVW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4PSIxMSIgeT0iMjgiIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMSI+CjxyZWN0IHg9IjExLjg5OTkiIHk9IjI4LjA1IiB3aWR0aD0iMTAuMiIgaGVpZ2h0PSIxMC4yIiByeD0iMi41NSIgZmlsbD0iI0YyNEUxRSIvPgo8L21hc2s+CjxnIG1hc2s9InVybCgjbWFzazIpIj4KPGcgZmlsdGVyPSJ1cmwoI2ZpbHRlcjlfZikiPgo8cmVjdCB4PSIxMi43NSIgeT0iMjguOSIgd2lkdGg9IjguNSIgaGVpZ2h0PSI4LjUiIHJ4PSIyLjU1IiBmaWxsPSIjMzhDNUZGIi8+CjwvZz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyMTBfZikiPgo8cmVjdCB4PSIxNC4wMjQ5IiB5PSI2LjM3NSIgd2lkdGg9IjUuNTI1IiBoZWlnaHQ9IjAuMjEyNSIgcng9IjAuMTA2MjUiIGZpbGw9IndoaXRlIiBmaWxsLW9wYWNpdHk9IjAuNyIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXIxMV9mKSI+CjxyZWN0IHg9IjE0LjAyNDkiIHk9IjE4LjciIHdpZHRoPSI1LjUyNSIgaGVpZ2h0PSIwLjIxMjUiIHJ4PSIwLjEwNjI1IiBmaWxsPSJ3aGl0ZSIgZmlsbC1vcGFjaXR5PSIwLjciLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyMTJfZikiPgo8cmVjdCB4PSIxNC4wMjQ5IiB5PSIzMC4xNzUiIHdpZHRoPSI1LjUyNSIgaGVpZ2h0PSIwLjIxMjUiIHJ4PSIwLjEwNjI1IiBmaWxsPSJ3aGl0ZSIgZmlsbC1vcGFjaXR5PSIwLjciLz4KPC9nPgo8L2c+CjxkZWZzPgo8ZmlsdGVyIGlkPSJmaWx0ZXIwX2YiIHg9Ii01LjEwMDEiIHk9IjExLjQ3NSIgd2lkdGg9IjQ0LjIiIGhlaWdodD0iNDQuMiIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIwIiByZXN1bHQ9IkJhY2tncm91bmRJbWFnZUZpeCIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJzaGFwZSIvPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSI4LjUiIHJlc3VsdD0iZWZmZWN0MV9mb3JlZ3JvdW5kQmx1ciIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyMV9mIiB4PSItNS4xMDAxIiB5PSItMC40MjQ5ODgiIHdpZHRoPSI0NC4yIiBoZWlnaHQ9IjQ0LjIiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJCYWNrZ3JvdW5kSW1hZ2VGaXgiIHJlc3VsdD0ic2hhcGUiLz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iOC41IiByZXN1bHQ9ImVmZmVjdDFfZm9yZWdyb3VuZEJsdXIiLz4KPC9maWx0ZXI+CjxmaWx0ZXIgaWQ9ImZpbHRlcjJfZiIgeD0iLTUuMTAwMSIgeT0iLTEyLjMyNSIgd2lkdGg9IjQ0LjIiIGhlaWdodD0iNDQuMiIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIwIiByZXN1bHQ9IkJhY2tncm91bmRJbWFnZUZpeCIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJzaGFwZSIvPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSI4LjUiIHJlc3VsdD0iZWZmZWN0MV9mb3JlZ3JvdW5kQmx1ciIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyM19iIiB4PSI2LjgiIHk9Ii0xLjciIHdpZHRoPSIyMC40IiBoZWlnaHQ9IjM3LjQiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz4KPGZlR2F1c3NpYW5CbHVyIGluPSJCYWNrZ3JvdW5kSW1hZ2UiIHN0ZERldmlhdGlvbj0iMC44NSIvPgo8ZmVDb21wb3NpdGUgaW4yPSJTb3VyY2VBbHBoYSIgb3BlcmF0b3I9ImluIiByZXN1bHQ9ImVmZmVjdDFfYmFja2dyb3VuZEJsdXIiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJlZmZlY3QxX2JhY2tncm91bmRCbHVyIiByZXN1bHQ9InNoYXBlIi8+CjwvZmlsdGVyPgo8ZmlsdGVyIGlkPSJmaWx0ZXI0X2QiIHg9IjEwLjE5OTkiIHk9IjMuMzk5OTkiIHdpZHRoPSIxMy42IiBoZWlnaHQ9IjEzLjYiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz4KPGZlQ29sb3JNYXRyaXggaW49IlNvdXJjZUFscGhhIiB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMTI3IDAiLz4KPGZlT2Zmc2V0IGR5PSIwLjQyNSIvPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIwLjg1Ii8+CjxmZUNvbG9yTWF0cml4IHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAuNzM4NjE1IDAgMCAwIDAgMC42NTM0MDMgMCAwIDAgMCAwLjgwODMzMyAwIDAgMCAwLjQgMCIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluMj0iQmFja2dyb3VuZEltYWdlRml4IiByZXN1bHQ9ImVmZmVjdDFfZHJvcFNoYWRvdyIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9ImVmZmVjdDFfZHJvcFNoYWRvdyIgcmVzdWx0PSJzaGFwZSIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyNV9kIiB4PSIxMC4xOTk5IiB5PSIxNS4zIiB3aWR0aD0iMTMuNiIgaGVpZ2h0PSIxMy42IiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+CjxmZUZsb29kIGZsb29kLW9wYWNpdHk9IjAiIHJlc3VsdD0iQmFja2dyb3VuZEltYWdlRml4Ii8+CjxmZUNvbG9yTWF0cml4IGluPSJTb3VyY2VBbHBoYSIgdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDEyNyAwIi8+CjxmZU9mZnNldCBkeT0iMC40MjUiLz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMC44NSIvPgo8ZmVDb2xvck1hdHJpeCB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMCAwIDAgMCAwLjczNzI1NSAwIDAgMCAwIDAuNjU0OTAyIDAgMCAwIDAgMC44MDc4NDMgMCAwIDAgMC40IDAiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJlZmZlY3QxX2Ryb3BTaGFkb3ciLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJlZmZlY3QxX2Ryb3BTaGFkb3ciIHJlc3VsdD0ic2hhcGUiLz4KPC9maWx0ZXI+CjxmaWx0ZXIgaWQ9ImZpbHRlcjZfZCIgeD0iMTAuMTk5OSIgeT0iMjYuNzk3NiIgd2lkdGg9IjEzLjYiIGhlaWdodD0iMTMuNiIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIwIiByZXN1bHQ9IkJhY2tncm91bmRJbWFnZUZpeCIvPgo8ZmVDb2xvck1hdHJpeCBpbj0iU291cmNlQWxwaGEiIHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAxMjcgMCIvPgo8ZmVPZmZzZXQgZHk9IjAuNDI1Ii8+CjxmZUdhdXNzaWFuQmx1ciBzdGREZXZpYXRpb249IjAuODUiLz4KPGZlQ29sb3JNYXRyaXggdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMC43MzcyNTUgMCAwIDAgMCAwLjY1NDkwMiAwIDAgMCAwIDAuODA3ODQzIDAgMCAwIDAuNCAwIi8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW4yPSJCYWNrZ3JvdW5kSW1hZ2VGaXgiIHJlc3VsdD0iZWZmZWN0MV9kcm9wU2hhZG93Ii8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW49IlNvdXJjZUdyYXBoaWMiIGluMj0iZWZmZWN0MV9kcm9wU2hhZG93IiByZXN1bHQ9InNoYXBlIi8+CjwvZmlsdGVyPgo8ZmlsdGVyIGlkPSJmaWx0ZXI3X2YiIHg9IjkuMzUiIHk9IjIuMTI0OTkiIHdpZHRoPSIxNS4zIiBoZWlnaHQ9IjE1LjMiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJCYWNrZ3JvdW5kSW1hZ2VGaXgiIHJlc3VsdD0ic2hhcGUiLz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMS43IiByZXN1bHQ9ImVmZmVjdDFfZm9yZWdyb3VuZEJsdXIiLz4KPC9maWx0ZXI+CjxmaWx0ZXIgaWQ9ImZpbHRlcjhfZiIgeD0iOS4zNSIgeT0iMTQuMDI1IiB3aWR0aD0iMTUuMyIgaGVpZ2h0PSIxNS4zIiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+CjxmZUZsb29kIGZsb29kLW9wYWNpdHk9IjAiIHJlc3VsdD0iQmFja2dyb3VuZEltYWdlRml4Ii8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW49IlNvdXJjZUdyYXBoaWMiIGluMj0iQmFja2dyb3VuZEltYWdlRml4IiByZXN1bHQ9InNoYXBlIi8+CjxmZUdhdXNzaWFuQmx1ciBzdGREZXZpYXRpb249IjEuNyIgcmVzdWx0PSJlZmZlY3QxX2ZvcmVncm91bmRCbHVyIi8+CjwvZmlsdGVyPgo8ZmlsdGVyIGlkPSJmaWx0ZXI5X2YiIHg9IjkuMzUiIHk9IjI1LjUiIHdpZHRoPSIxNS4zIiBoZWlnaHQ9IjE1LjMiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJCYWNrZ3JvdW5kSW1hZ2VGaXgiIHJlc3VsdD0ic2hhcGUiLz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMS43IiByZXN1bHQ9ImVmZmVjdDFfZm9yZWdyb3VuZEJsdXIiLz4KPC9maWx0ZXI+CjxmaWx0ZXIgaWQ9ImZpbHRlcjEwX2YiIHg9IjEyLjMyNDkiIHk9IjQuNjc1IiB3aWR0aD0iOC45MjUiIGhlaWdodD0iMy42MTI1IiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+CjxmZUZsb29kIGZsb29kLW9wYWNpdHk9IjAiIHJlc3VsdD0iQmFja2dyb3VuZEltYWdlRml4Ii8+CjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW49IlNvdXJjZUdyYXBoaWMiIGluMj0iQmFja2dyb3VuZEltYWdlRml4IiByZXN1bHQ9InNoYXBlIi8+CjxmZUdhdXNzaWFuQmx1ciBzdGREZXZpYXRpb249IjAuODUiIHJlc3VsdD0iZWZmZWN0MV9mb3JlZ3JvdW5kQmx1ciIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyMTFfZiIgeD0iMTIuMzI0OSIgeT0iMTciIHdpZHRoPSI4LjkyNSIgaGVpZ2h0PSIzLjYxMjUiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJCYWNrZ3JvdW5kSW1hZ2VGaXgiIHJlc3VsdD0ic2hhcGUiLz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMC44NSIgcmVzdWx0PSJlZmZlY3QxX2ZvcmVncm91bmRCbHVyIi8+CjwvZmlsdGVyPgo8ZmlsdGVyIGlkPSJmaWx0ZXIxMl9mIiB4PSIxMi4zMjQ5IiB5PSIyOC40NzUiIHdpZHRoPSI4LjkyNSIgaGVpZ2h0PSIzLjYxMjUiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJCYWNrZ3JvdW5kSW1hZ2VGaXgiIHJlc3VsdD0ic2hhcGUiLz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMC44NSIgcmVzdWx0PSJlZmZlY3QxX2ZvcmVncm91bmRCbHVyIi8+CjwvZmlsdGVyPgo8Y2xpcFBhdGggaWQ9ImNsaXAwIj4KPHBhdGggZD0iTTAgMTdDMCA4Ljk4NjEyIDAgNC45NzkxOCAyLjQ4OTU5IDIuNDg5NTlDNC45NzkxOCAwIDguOTg2MTIgMCAxNyAwQzI1LjAxMzkgMCAyOS4wMjA4IDAgMzEuNTEwNCAyLjQ4OTU5QzM0IDQuOTc5MTggMzQgOC45ODYxMiAzNCAxN0MzNCAyNS4wMTM5IDM0IDI5LjAyMDggMzEuNTEwNCAzMS41MTA0QzI5LjAyMDggMzQgMjUuMDEzOSAzNCAxNyAzNEM4Ljk4NjEyIDM0IDQuOTc5MTggMzQgMi40ODk1OSAzMS41MTA0QzAgMjkuMDIwOCAwIDI1LjAxMzkgMCAxN1oiIGZpbGw9IndoaXRlIi8+CjwvY2xpcFBhdGg+CjwvZGVmcz4KPC9zdmc+Cg==)}\n.FigmaExApp .ExBar .header .setting-but,.FigmaExApp .ExBar .header .clear-but{font-size:12px;margin-left:auto;margin-right:34px;color:#a9a9d5;cursor:pointer;display:flex;place-items:center}\n.FigmaExApp .ExBar .header .setting-but img,.FigmaExApp .ExBar .header .clear-but img{opacity:.5;width:16px;height:16px}\n.FigmaExApp .ExBar .header .setting-but:hover,.FigmaExApp .ExBar .header .clear-but:hover{color:#8080d4}\n.FigmaExApp .ExBar .header .setting-but:hover img,.FigmaExApp .ExBar .header .clear-but:hover img{opacity:.7}\n.FigmaExApp .ExBar .header .clear-but{margin-right:15px}\n.FigmaExApp .ExBar .reseize-hand{height:10px;display:flex;place-items:center;place-content:flex-end;cursor:ns-resize;position:absolute;bottom:0;right:0;width:100%;z-index:10;background:#fff}\n.FigmaExApp .ExBar .reseize-hand .dot{height:3px;background:rgba(234,234,241,.9411764706);width:18px;border-radius:10px;margin-right:17px}\n.FigmaExApp .ExBar .reseize-hand:hover .dot{background:#e4e4ef}\n:host .FigmaExApp .ExBar{right:262px;top:13px;border-radius:13px;box-shadow:var(--elevation-100)}\n.FigmaExApp .ActionItem{display:flex;place-items:center;place-content:space-between;height:44px;padding:2px 10px;cursor:default;user-select:none;background:#fff;transition:background .2s ease-in-out}\n.FigmaExApp .ActionItem *{user-select:none}\n.FigmaExApp .ActionItem:hover{background:rgba(235,235,248,.6705882353)}\n.FigmaExApp .ActionItem:active{transition:all .1s ease;background:rgba(202,202,227,.67)}\n.FigmaExApp .ActionItem .main-icon{width:32px;height:32px;background-size:32px 32px;border-radius:8px;height:32px;width:32px;flex:none;transition:all}\n.FigmaExApp .ActionItem .buttons{display:flex}\n.FigmaExApp .ActionItem .buttons button{display:none}\n.FigmaExApp .ActionItem .note-name-edit{border-bottom:1px solid #3f4ad9;font-size:12px;cursor:text}\n.FigmaExApp .ActionItem .note-but,.FigmaExApp .ActionItem .star-but,.FigmaExApp .ActionItem .info-but{background-image:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij48cGF0aCBmaWxsPSJub25lIiBkPSJNMCAwaDI0djI0SDB6Ii8+PHBhdGggZD0iTTEyLjkgNi44NThsNC4yNDIgNC4yNDNMNy4yNDIgMjFIM3YtNC4yNDNsOS45LTkuOXptMS40MTQtMS40MTRsMi4xMjEtMi4xMjJhMSAxIDAgMCAxIDEuNDE0IDBsMi44MjkgMi44MjlhMSAxIDAgMCAxIDAgMS40MTRsLTIuMTIyIDIuMTIxLTQuMjQyLTQuMjQyeiIgZmlsbD0icmdiYSg0NCw2MCwxMDMsMSkiLz48L3N2Zz4K);background-size:13px 13px;background-position:center;background-repeat:no-repeat;width:22px;height:22px;flex:none;position:absolute;right:10px;pointer-events:none;opacity:0;transition:all .2s ease;position:relative}\n.FigmaExApp .ActionItem .buttons .star-but.isStar{display:flex !important;opacity:.8 !important}\n.FigmaExApp .ActionItem .info-but{background-image:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij48cGF0aCBmaWxsPSJub25lIiBkPSJNMCAwaDI0djI0SDB6Ii8+PHBhdGggZmlsbD0icmdiYSg0NCw2MCwxMDMsMSkiICBkPSJNMTIgMjJDNi40NzcgMjIgMiAxNy41MjMgMiAxMlM2LjQ3NyAyIDEyIDJzMTAgNC40NzcgMTAgMTAtNC40NzcgMTAtMTAgMTB6bS0xLTExdjZoMnYtNmgtMnptMC00djJoMlY3aC0yeiIvPjwvc3ZnPgo=)}\n.FigmaExApp .ActionItem .star-but{background-image:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij48cGF0aCBmaWxsPSJub25lIiBkPSJNMCAwaDI0djI0SDB6Ii8+PHBhdGggZmlsbD0icmdiYSg0NCw2MCwxMDMsMSkiIGQ9Ik0xMiAxOC4yNmwtNy4wNTMgMy45NDggMS41NzUtNy45MjhMLjU4NyA4Ljc5Mmw4LjAyNy0uOTUyTDEyIC41bDMuMzg2IDcuMzQgOC4wMjcuOTUyLTUuOTM1IDUuNDg4IDEuNTc1IDcuOTI4eiIvPjwvc3ZnPgo=)}\n.FigmaExApp .ActionItem:hover .buttons button{display:flex}\n.FigmaExApp .ActionItem:hover .note-but,.FigmaExApp .ActionItem:hover .star-but,.FigmaExApp .ActionItem:hover .info-but{pointer-events:auto;opacity:.4}\n.FigmaExApp .ActionItem:hover .note-but:hover,.FigmaExApp .ActionItem:hover .star-but:hover,.FigmaExApp .ActionItem:hover .info-but:hover{opacity:.6}\n.FigmaExApp .ActionItem:hover .note-but:hover:before,.FigmaExApp .ActionItem:hover .star-but:hover:before,.FigmaExApp .ActionItem:hover .info-but:hover:before{content:\"\";background:rgba(157,157,224,.37);width:100%;height:100%;left:0;top:0;position:absolute;border-radius:4px}\n.FigmaExApp .ActionItem:hover .note-but:active,.FigmaExApp .ActionItem:hover .star-but:active,.FigmaExApp .ActionItem:hover .info-but:active{opacity:.8}\n.FigmaExApp .ActionItem.IconRound .main-icon{border-radius:64px}\n.FigmaExApp .ActionItem.IconBorder .main-icon{border:1px solid #c9c7d9}\n.FigmaExApp .ActionItem .action-info{display:flex;place-items:flex-start;place-content:center;flex-direction:column;flex:1;padding-left:6px;font-style:normal;font-weight:500;font-size:12px;line-height:14px;color:#1d232f;overflow:hidden;text-overflow:ellipsis;padding-right:10px}\n.FigmaExApp .ActionItem .action-info div{width:100%;white-space:nowrap;min-width:0;text-overflow:ellipsis;overflow:hidden}\n.FigmaExApp .ActionItem .action-info .name{font-weight:500;height:20px;display:flex;align-items:center}\n.FigmaExApp .ActionItem .action-info .note-name{color:#7e91bc;font-weight:400;transform:scale(0.94);transform-origin:left center}\n.FigmaExApp .GroupPad{width:140px;min-width:140px;padding:10px;background:rgba(238,238,246,.9098039216);padding-right:5px;box-sizing:border-box}\n.FigmaExApp .GroupPad:before{content:\"\";position:absolute;top:0;left:0;backdrop-filter:blur(50px);width:100%;height:100%;z-index:-1}\n.FigmaExApp .GroupPad .icon{margin-right:7px}\n.FigmaExApp .GroupPad button{display:flex;white-space:nowrap;padding:6px;box-sizing:border-box;border-radius:4px;font-size:12px;place-items:center;place-content:flex-start;background-color:rgba(0,0,0,0);cursor:pointer;color:#6d5e80;width:100%}\n.FigmaExApp .GroupPad button:hover{color:#673d9d}\n.FigmaExApp .GroupPad .group-list{width:100%;margin-bottom:8px;overflow:hidden;overflow-y:auto;overscroll-behavior:none;max-height:calc(100% - 36px);flex:none;direction:ltr;margin-bottom:8px;padding-right:4px;box-sizing:border-box}\n.FigmaExApp .GroupPad .group-list::-webkit-scrollbar{width:4px !important}\n.FigmaExApp .GroupPad .group-list::-webkit-scrollbar-thumb{border-radius:13px;transition:all .5s}\n.FigmaExApp .GroupPad .group-list::-webkit-scrollbar-thumb:hover{background-color:rgba(0,0,0,.2);transition:all .5s}\n.FigmaExApp .GroupPad .group-list::-webkit-scrollbar-thumb{background-color:rgba(112,109,158,.21)}\n.FigmaExApp .GroupPad .group-list .smooth-dnd-container>div:not(:last-child){margin-bottom:1px}\n.FigmaExApp .GroupPad .group-list .group{position:relative;font-size:13px;color:#413a4a;height:30px;display:flex;place-content:flex-start;place-items:center;cursor:pointer;border-radius:4px;padding:0 10px;margin-bottom:1px}\n.FigmaExApp .GroupPad .group-list .group .len{margin-left:auto;color:rgba(77,77,93,.368627451);font-size:12px}\n.FigmaExApp .GroupPad .group-list .group .installed-loading-icon{margin-left:auto;font-size:13px;color:rgba(77,77,93,.368627451);flex:none}\n.FigmaExApp .GroupPad .group-list .group .name{text-overflow:ellipsis;overflow:hidden;white-space:nowrap}\n.FigmaExApp .GroupPad .group-list .group:hover{background:#dedee8;color:#413a4a}\n.FigmaExApp .GroupPad .group-list .group.active{background:#d5d5e3;color:#1f1f38}\n.FigmaExApp .GroupPad .group-list .group.active .len{color:rgba(72,72,118,.53)}\n.FigmaExApp .GroupPad .group-list .group input.name-input{width:auto;flex:auto;min-width:10px;background:rgba(0,0,0,0);border-bottom:1px solid #3f4ad9;font-size:12px;cursor:text;display:none}\n.FigmaExApp .GroupPad .group-list .group.isEdit .name-input{display:block}\n.FigmaExApp .GroupPad .group-list .group.isEdit .name{display:none}\n.FigmaExApp .GroupPad .group-list .group[data-id=recent]{position:relative;overflow:visible;margin-bottom:4px}\n.FigmaExApp .GroupPad .group-list .group[data-id=recent]:before{content:\"\";position:absolute;left:0;right:0;bottom:-3px;margin:auto;width:calc(100% - 21px);height:1px;background:#d5d5e3}\n.FigmaExApp .GroupPad .group-list .new-group.group{place-content:center;color:#7c7a7a;text-shadow:0 1px rgba(255,255,255,.5882352941)}\n.FigmaExApp .GroupPad .group-list .new-group.group .oIcon{font-size:15px}\n.FigmaExApp .GroupPad .group-list .group-list-name{font-size:12px;padding:0 8px;font-weight:bold;color:rgba(124,122,122,.6509803922);margin-top:8px;margin-bottom:3px}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar,:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .area-actions{background:rgba(44,44,44,.9960784314)}\n:host([data-theme=\"dark\"]) .FigmaExApp .GroupPad{background:rgba(29,29,32,.65)}\n:host([data-theme=\"dark\"]) .FigmaExApp .GroupPad .group-list .group.active{background:#3c3c44;color:#f2f2f2}\n:host([data-theme=\"dark\"]) .FigmaExApp .GroupPad .group-list .group.active .len{color:rgba(215,215,225,.53)}\n:host([data-theme=\"dark\"]) .FigmaExApp .GroupPad .group-list .group{color:rgba(197,197,197,.8901960784)}\n:host([data-theme=\"dark\"]) .FigmaExApp .GroupPad .group-list .group:hover{background:#3c3c44}\n:host([data-theme=\"dark\"]) .FigmaExApp .GroupPad .group-list .group .len{color:rgba(221,221,229,.37)}\n:host([data-theme=\"dark\"]) .FigmaExApp .GroupPad .group-list .group[data-id=recent]:before{background:#404052}\n:host([data-theme=\"dark\"]) .FigmaExApp .GroupPad .group-list .new-group.group .oIcon{font-size:15px;filter:invert(1)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .reseize-hand{background:rgba(44,44,44,0)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .header{background:rgba(44,44,44,0)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ActionItem{background:rgba(0,0,0,0)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .reseize-hand .dot{background:rgba(244,244,244,.18)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ActionItem .action-info .note-name{color:rgba(255,255,255,.3843137255)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ActionItem .action-info{color:rgba(255,255,255,.831372549)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .header .logo-but{opacity:0}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .header .logo-but.color{opacity:.9}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .ActionItem:hover{background:rgba(23,23,23,.4196078431)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ActionItem .buttons>button,:host([data-theme=\"dark\"]) .SearchList .ActionItem .info-but{filter:invert(1) grayscale(1)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .action-list::-webkit-scrollbar-thumb{border:0px solid #fff}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .action-list::-webkit-scrollbar-thumb{background-color:rgba(165,165,165,.39)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .action-list::-webkit-scrollbar-thumb:hover{background-color:rgba(165,165,165,.69)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .find-input .clear-but img{filter:inset(1)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .find-input input{font-size:12px;color:rgba(255,255,255,.8196078431)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ActionItem.IconBorder .main-icon{border:1px solid #606060}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .header .setting-but img,:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .header .clear-but img{filter:invert(1)}\n:host([data-theme=\"dark\"]) .FigmaExApp .ExBar .top-list{border-bottom:1px solid rgba(255,255,255,.1215686275)}";
    const assets = {"settings":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KICAgIDxwYXRoIGZpbGw9Im5vbmUiIGQ9Ik0wIDBoMjR2MjRIMHoiIC8+CiAgICA8cGF0aAogICAgICAgICAgICBkPSJNOS45NTQgMi4yMWE5Ljk5IDkuOTkgMCAwIDEgNC4wOTEtLjAwMkEzLjk5MyAzLjk5MyAwIDAgMCAxNiA1LjA3YTMuOTkzIDMuOTkzIDAgMCAwIDMuNDU3LjI2MUE5Ljk5IDkuOTkgMCAwIDEgMjEuNSA4Ljg3NiAzLjk5MyAzLjk5MyAwIDAgMCAyMCAxMmMwIDEuMjY0LjU4NiAyLjM5MSAxLjUwMiAzLjEyNGExMC4wNDMgMTAuMDQzIDAgMCAxLTIuMDQ2IDMuNTQzIDMuOTkzIDMuOTkzIDAgMCAwLTMuNDU2LjI2MSAzLjk5MyAzLjk5MyAwIDAgMC0xLjk1NCAyLjg2IDkuOTkgOS45OSAwIDAgMS00LjA5MS4wMDRBMy45OTMgMy45OTMgMCAwIDAgOCAxOC45MjdhMy45OTMgMy45OTMgMCAwIDAtMy40NTctLjI2QTkuOTkgOS45OSAwIDAgMSAyLjUgMTUuMTIxIDMuOTkzIDMuOTkzIDAgMCAwIDQgMTEuOTk5YTMuOTkzIDMuOTkzIDAgMCAwLTEuNTAyLTMuMTI0IDEwLjA0MyAxMC4wNDMgMCAwIDEgMi4wNDYtMy41NDNBMy45OTMgMy45OTMgMCAwIDAgOCA1LjA3MWEzLjk5MyAzLjk5MyAwIDAgMCAxLjk1NC0yLjg2ek0xMiAxNWEzIDMgMCAxIDAgMC02IDMgMyAwIDAgMCAwIDZ6IgogICAgLz4KPC9zdmc+Cg==","clear":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KICAgIDxwYXRoIGZpbGw9Im5vbmUiIGQ9Ik0wIDBoMjR2MjRIMHoiIC8+CiAgICA8cGF0aAogICAgICAgICAgICBkPSJNMTIgMTAuNTg2bDQuOTUtNC45NSAxLjQxNCAxLjQxNC00Ljk1IDQuOTUgNC45NSA0Ljk1LTEuNDE0IDEuNDE0LTQuOTUtNC45NS00Ljk1IDQuOTUtMS40MTQtMS40MTQgNC45NS00Ljk1LTQuOTUtNC45NUw3LjA1IDUuNjM2eiIKICAgIC8+Cjwvc3ZnPgo="};
    const style = document.createElement("style");
    style.textContent = originalCss + String.raw`
      :host{all:initial;color:#1d232f;--surface:#fff;--text:#413a4a;--focus:#7e91bc}
      :host([data-theme=dark]){--surface:#2c2c2c;--text:#c5c5c5;--focus:#a9a9d5}
      *{box-sizing:border-box} [hidden]{display:none!important}button,input{font:inherit;color:inherit;border:0;margin:0;padding:0;outline:none;background:transparent}button{cursor:pointer;text-align:left}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:1px solid var(--focus);outline-offset:-1px}
      :host .FigmaExApp .ExBar{position:relative;right:0;top:0;pointer-events:auto;height:400px;max-height:calc(100dvh - 80px);box-shadow:var(--elevation-100,none)}
      .FigmaExApp .ExBar.expanded{width:min(400px,calc(100vw - 24px))}.FigmaExApp .ExBar .area-actions{height:100%;min-height:0}.FigmaExApp .ExBar .area-groups{height:100%;min-width:0;flex-shrink:1}
      .FigmaExApp .ExBar .header .logo-but{background-size:34px 34px}.FigmaExApp .ExBar.expanded .header .logo-but.color{opacity:1}.FigmaExApp .ExBar .find-input{min-width:0}.FigmaExApp .ExBar .find-input input{outline:none}.FigmaExApp .ExBar .find-input input:focus-visible{box-shadow:inset 0 -1px var(--focus)}.FigmaExApp .ExBar .find-input input::placeholder{color:#a9a9bd}.FigmaExApp .ExBar .header .clear-but{margin-left:0;margin-right:0}.FigmaExApp .ExBar .header .setting-but{margin-left:auto}
      .FigmaExApp .ExBar .action-list{min-height:0;flex:1}.FigmaExApp .ActionItem{gap:0}.FigmaExApp .ActionItem .run{display:flex;align-items:center;flex:1;min-width:0;height:100%;overflow:hidden}.FigmaExApp .ActionItem .action-info{min-width:0;text-align:left}.FigmaExApp .ActionItem .action-info .name,.FigmaExApp .ActionItem .action-info .note-name{display:block;width:100%;white-space:nowrap;min-width:0;text-overflow:ellipsis;overflow:hidden}.FigmaExApp .ActionItem .action-info .name{line-height:20px}.FigmaExApp .ActionItem .note-name{line-height:14px}
      .FigmaExApp .ActionItem .main-icon{position:relative;display:grid;place-items:center;overflow:hidden;font-size:12px;color:#7e91bc;cursor:pointer}.FigmaExApp .ActionItem .main-icon img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.FigmaExApp .ActionItem .buttons{flex:none}.FigmaExApp .ActionItem .buttons button{background-color:transparent;right:0}.FigmaExApp .ActionItem .buttons .add,.FigmaExApp .ActionItem .buttons .remove{background-image:none;font-size:16px;text-align:center;color:#2c3c67}.FigmaExApp .ActionItem:focus-within .buttons button{display:flex;pointer-events:auto;opacity:.6}.FigmaExApp .ActionItem .buttons .isStar{pointer-events:auto}
      .FigmaExApp .GroupPad .group-list{max-height:100%}.group-row{position:relative}.FigmaExApp .GroupPad .group-list .group{width:100%;text-align:left}.FigmaExApp .GroupPad .group-list .new-group{font-weight:400}.FigmaExApp .GroupPad .manage{position:absolute;right:0;top:0;width:20px;display:none;padding:0;height:30px;justify-content:center;background:var(--surface)}.FigmaExApp .GroupPad .group-row:hover .manage,.FigmaExApp .GroupPad .group-row:focus-within .manage{display:flex}.FigmaExApp .GroupPad .group-row:hover .len{visibility:hidden}
      .editor{position:absolute;z-index:50;bottom:10px;left:10px;right:10px;max-height:180px;overflow:auto;display:flex;flex-wrap:wrap;gap:6px;padding:10px;border-radius:4px;background:var(--surface);color:var(--text);box-shadow:0 2px 12px #0003;font-size:12px}.editor input{min-width:0;flex:1;border-bottom:1px solid #7e91bc;padding:4px}.editor button{padding:4px 6px}.editor button:hover{background:#8882}.status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.status[data-error=true]{bottom:10px;left:10px;right:10px;width:auto;height:auto;clip-path:none;padding:10px;font-size:12px;background:var(--surface);color:#cf4949;border-radius:4px;z-index:60;box-shadow:0 2px 12px #0003}.empty{font-size:12px;color:#a9a9bd;padding:12px;line-height:20px}
    `;
    const app = element("div", "FigmaExApp");
    panel = element("section", "ExBar panel"); panel.id = "panel"; panel.setAttribute("aria-label", "FigBoost 插件侧边栏");
    const groupPad = element("nav", "GroupPad area-groups"); groupPad.setAttribute("aria-label", "插件分组"); groups = element("div", "group-list groups"); groupPad.append(groups);
    const content = element("div", "area-actions");
    const header = element("div", "header"); const find = element("div", "find-input");
    search = document.createElement("input"); search.type = "search"; search.className = "search"; search.placeholder = "搜索插件"; search.setAttribute("aria-label", "搜索插件");
    search.addEventListener("input", () => { query = search.value; render(); });
    clearSearch = button("", "清空搜索", () => { query = search.value = ""; render(); search.focus(); }, "clear-but");
    function imageButton(title, src, action, className) { const b = button("", title, action, className); const img = document.createElement("img"); img.src = src; img.alt = ""; b.append(img); return b; }
    const clearIcon = document.createElement("img"); clearIcon.src = assets.clear; clearIcon.alt = ""; clearSearch.append(clearIcon);
    find.append(search, clearSearch);
    toggle = button("", "FigBoost 插件侧边栏", () => setOpen(true), "logo-but color"); toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", "panel");
    const refresh = imageButton("刷新插件", assets.settings, () => window.__figboostPluginSidebar.refresh(), "setting-but");
    header.append(find, refresh, toggle); header.addEventListener("mouseenter", () => setOpen(true, false));
    list = element("div", "action-list list"); content.append(header, list, element("div", "reseize-hand"));
    const handle = content.querySelector(".reseize-hand"); handle.append(element("div", "dot"));
    handle.setAttribute("role", "separator"); handle.setAttribute("aria-label", "调整插件栏高度"); handle.setAttribute("aria-orientation", "horizontal"); handle.tabIndex = 0;
    const heightKey = storageKey + ":height";
    function resize(height, save = false) {
      const next = Math.max(104, Math.min(innerHeight - 80, height)); panel.style.height = next + "px"; handle.setAttribute("aria-valuenow", String(Math.round(next)));
      if (save) { try { localStorage.setItem(heightKey, String(next)); } catch (_) {} }
    }
    try { const height = Number(localStorage.getItem(heightKey)); if (height > 0) resize(height); } catch (_) {}
    let dragHeight;
    handle.addEventListener("pointerdown", event => { if (event.button !== 0) return; event.preventDefault(); dragHeight = panel.getBoundingClientRect().height; handle.setPointerCapture(event.pointerId); });
    handle.addEventListener("pointermove", event => { if (handle.hasPointerCapture(event.pointerId)) resize(event.clientY - panel.getBoundingClientRect().top); });
    handle.addEventListener("pointerup", event => { if (handle.hasPointerCapture(event.pointerId)) { resize(panel.getBoundingClientRect().height, true); handle.releasePointerCapture(event.pointerId); } });
    handle.addEventListener("pointercancel", () => { if (dragHeight) resize(dragHeight); });
    handle.addEventListener("keydown", event => { if (["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); resize(panel.getBoundingClientRect().height + (event.key === "ArrowDown" ? 20 : -20), true); } });
    editor = element("div", "editor"); editor.hidden = true; status = element("div", "status", "点击刷新，同步 Figma 已保存插件"); status.setAttribute("role", "status");
    panel.append(groupPad, content, editor, status); app.append(panel); root.append(style, app);
    panel.addEventListener("mouseleave", () => { if (!query && editor.hidden) setOpen(false, false); });
    root.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); if (!editor.hidden) editor.hidden = true; else setOpen(false); } });
    for (const type of ["pointerdown", "mousedown", "click", "dblclick", "contextmenu", "keyup", "keypress"]) root.addEventListener(type, e => e.stopPropagation());
    document.body.appendChild(host); render(); position();
  }
  function syncRoute() {
    if (disposed || !document.body) return;
    const key = accountKey();
    if (!isEditor() || key !== storageKey) {
      generation++; for (const c of controllers) c.abort(); controllers.clear();
      host?.remove(); host = null; root = panel = groups = list = status = null;
      loading = running = opened = false; active = "saved"; query = "";
    }
    if (!isEditor()) return;
    if (!host?.isConnected) { storageKey = key; state = readState(); mount(); }
    host.dataset.theme = document.body.dataset.preferredTheme === "dark" || document.documentElement.classList.contains("figma-dark") ? "dark" : "light";
    position();
  }
  function onStorage(event) { if (event.key === storageKey) { state = readState(); if (!state.groups.some(g => g.id === active) && active.startsWith("group-")) active = "saved"; render(); } }
  function onResize() { position(); }
  function destroy() {
    disposed = true; generation++; clearInterval(routeTimer);
    for (const c of controllers) c.abort();
    // Pending menu waits finish on their next tick and reject through runPlugin.
    host?.remove(); window.removeEventListener("storage", onStorage); window.removeEventListener("resize", onResize);
    document.removeEventListener("DOMContentLoaded", syncRoute);
  }
  window.__figboostPluginSidebar = { refresh, destroy };
  window.addEventListener("storage", onStorage); window.addEventListener("resize", onResize);
  document.addEventListener("DOMContentLoaded", syncRoute, { once: true });
  // A small route check handles Figma pushState without patching its router or
  // observing the entire changing canvas subtree.
  routeTimer = setInterval(syncRoute, 1200); syncRoute();
})();
