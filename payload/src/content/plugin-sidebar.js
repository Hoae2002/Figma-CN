// Standalone FigBoost sidebar. FigmaEX's bundled sidebar was inspected for its
// resource API/menu integration; no Vue bundle, account service or updater is loaded.
(function () {
  "use strict";
  if (!/(^|\.)figma\.com$/.test(location.hostname) && !window.__FIGMA_ZH_TEST__) return;
  window.__figboostPluginSidebar?.destroy();
  const KEY_PREFIX = "figboost:plugin-sidebar:v1:";
  const MENU_ITEMS = '[role="menuitem"],[role="menuitemcheckbox"]';
  let host, root, panel, toggle, list, groups, status, search, editor;
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
      const b = button(g.name, g.name, () => { active = g.id; query = ""; search.value = ""; editor.hidden = true; render(); }, "group");
      b.setAttribute("aria-pressed", String(active === g.id));
      b.appendChild(element("span", "count", String(members(g.id).length))); row.appendChild(b);
      if (g.id.startsWith("group-")) row.appendChild(button("⋯", `管理分组 ${g.name}`, () => editGroup(g), "manage"));
      groups.appendChild(row);
    }
    groups.appendChild(button("＋ 新建分组", "新建分组", () => editGroup(), "new-group"));
  }
  function render() {
    if (!list) return;
    renderGroups(); list.replaceChildren();
    const selected = new Set(members());
    const q = query.trim().toLocaleLowerCase();
    // Search includes all cached groups; an empty search restores the selected group.
    const items = (q ? state.plugins : members().map(id => state.plugins.find(p => p.id === id)).filter(Boolean))
      .filter(p => !q || `${p.name} ${p.description}`.toLocaleLowerCase().includes(q));
    if (!items.length) list.appendChild(element("p", "empty", q ? "没有匹配的插件" : "暂无插件。可先在 Figma 中保存插件，再点击刷新。"));
    for (const p of items) {
      const row = element("div", "plugin"); row.dataset.pluginId = p.id;
      const run = button("", `运行 ${p.name}`, () => chooseCommand(p), "run"); run.disabled = running;
      const icon = element("span", "icon", p.name.slice(0, 1));
      if (p.icon) { const img = document.createElement("img"); img.src = p.icon; img.alt = ""; img.referrerPolicy = "no-referrer"; img.addEventListener("error", () => img.remove(), { once: true }); icon.appendChild(img); }
      const info = element("span", "info"); info.append(element("strong", "name", p.name), element("span", "description", p.description));
      run.append(icon, info); row.appendChild(run);
      const starred = state.favorites.includes(p.id);
      const star = button(starred ? "★" : "☆", `${starred ? "取消星标" : "星标"} ${p.name}`, () => {
        state.favorites = starred ? state.favorites.filter(id => id !== p.id) : [...state.favorites, p.id]; persist(); render();
      }, "star"); star.setAttribute("aria-pressed", String(starred)); row.appendChild(star);
      row.appendChild(button("＋", `将 ${p.name} 加入分组`, () => chooseGroup(p), "add"));
      if (active.startsWith("group-") && selected.has(p.id)) row.appendChild(button("−", `从当前分组移除 ${p.name}`, () => {
        const group = state.groups.find(g => g.id === active); group.plugins = group.plugins.filter(id => id !== p.id); persist(); render();
      }, "remove"));
      list.appendChild(row);
    }
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
  function setOpen(value) {
    opened = value; panel.hidden = !value; toggle.setAttribute("aria-expanded", String(value));
    if (value) { search.focus(); if (!state.plugins.length) refresh(); } else toggle.focus();
  }
  function position() {
    if (!host) return;
    const native = document.querySelector('[aria-label="Right sidebar"],[aria-label="右侧边栏"]');
    const bounds = native?.getBoundingClientRect();
    const right = bounds && bounds.width > 0 ? Math.max(12, innerWidth - bounds.left + 8) : 252;
    host.style.right = `${Math.min(right, Math.max(12, innerWidth - 80))}px`;
    host.style.setProperty("--available-width", `${Math.max(0, innerWidth - parseFloat(host.style.right) - 12)}px`);
  }
  function mount() {
    host = document.createElement("div"); host.id = "figboost-plugin-sidebar"; host.setAttribute("data-figma-zh-skip", "1");
    host.style.cssText = "position:fixed;top:88px;z-index:90;pointer-events:none";
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host{all:initial;font:12px/1.5 Inter,"Microsoft YaHei",sans-serif;color:var(--fg,#343044);--bg:#fbfaff;--muted:#77738a;--line:#e6e2f2;--hover:#eeeafa;--accent:#7058d5}
      :host([data-theme=dark]){--bg:#28262e;--fg:#eeeaf6;--muted:#aaa4b8;--line:#423d4c;--hover:#3c354d;--accent:#b7a4ff}
      *{box-sizing:border-box} [hidden]{display:none!important}button,input{font:inherit;color:inherit}button{cursor:pointer;border:0;background:transparent;border-radius:6px;min-height:30px;text-align:left}button:hover{background:var(--hover)}button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}button:disabled{opacity:.5;cursor:default}
      .toggle{pointer-events:auto;display:block;margin-left:auto;background:var(--bg);border:1px solid var(--line);padding:6px 12px;color:var(--accent);box-shadow:0 2px 8px #0001}
      .panel{pointer-events:auto;background:var(--bg);width:min(460px,var(--available-width));max-height:calc(100dvh - 142px);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 30px #0002;overflow:hidden;margin-top:6px;display:flex;flex-direction:column}
      .header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}.header strong{flex:1}.header button{padding:2px 8px}
      .body{display:grid;grid-template-columns:minmax(96px,30%) minmax(0,1fr);min-height:160px;max-height:calc(100dvh - 245px);overflow:hidden}.groups{overflow:auto;border-right:1px solid var(--line);padding:8px}.group-row{display:flex;align-items:center;min-width:0}.group{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px}.group[aria-pressed=true]{background:var(--hover);color:var(--accent)}.count{float:right;margin-left:6px;color:var(--muted);font-size:11px}.manage{width:24px;padding:0;text-align:center}.new-group{color:var(--muted);width:100%;padding:8px 4px}
      .content{display:flex;flex-direction:column;min-width:0;overflow:hidden}.search{margin:8px;border:1px solid var(--line);border-radius:6px;background:var(--hover);padding:8px;min-width:0;width:calc(100% - 16px)}.list{overflow:auto;min-height:0;padding:0 6px 8px}.plugin{display:flex;align-items:center;gap:2px;border-radius:6px}.plugin:hover{background:var(--hover)}.run{display:flex;align-items:center;gap:8px;min-width:0;flex:1;padding:6px 2px}.icon{width:28px;height:28px;flex:none;border-radius:7px;background:var(--hover);color:var(--accent);position:relative;display:grid;place-items:center;overflow:hidden}.icon img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.info{display:block;min-width:0}.name,.description{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.description{font-size:11px;color:var(--muted)}.star,.add,.remove{padding:0 3px;min-width:24px;text-align:center;color:var(--muted)}.star[aria-pressed=true]{color:var(--accent)}.empty{color:var(--muted);padding:8px;overflow-wrap:anywhere}.status{color:var(--muted);padding:8px 12px;border-top:1px solid var(--line);font-size:11px;overflow-wrap:anywhere}.status[data-error=true]{color:#cf4949}.editor{display:flex;flex-wrap:wrap;gap:6px;padding:8px;border-top:1px solid var(--line);max-height:180px;overflow:auto}.editor input{min-width:0;flex:1;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:4px}.editor button{padding:4px 8px}
      @media(max-width:700px){.panel{width:min(420px,calc(100vw - 24px))}:host{right:12px!important;--available-width:calc(100vw - 24px)!important}}`;
    toggle = button("插件", "FigBoost 插件侧边栏", () => setOpen(!opened), "toggle"); toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", "panel");
    panel = element("section", "panel"); panel.id = "panel"; panel.hidden = true; panel.setAttribute("aria-label", "FigBoost 插件侧边栏");
    const header = element("div", "header"); header.append(element("strong", "", "插件"), button("↻", "刷新插件", refresh), button("×", "收起侧边栏", () => setOpen(false)));
    const body = element("div", "body"); groups = element("nav", "groups"); groups.setAttribute("aria-label", "插件分组");
    const content = element("div", "content"); search = document.createElement("input"); search.type = "search"; search.className = "search"; search.placeholder = "搜索插件"; search.setAttribute("aria-label", "搜索插件");
    search.addEventListener("input", () => { query = search.value; render(); }); list = element("div", "list"); content.append(search, list); body.append(groups, content);
    editor = element("div", "editor"); editor.hidden = true; status = element("div", "status", "点击刷新，同步 Figma 已保存插件"); status.setAttribute("role", "status");
    panel.append(header, body, editor, status); root.append(style, toggle, panel);
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
