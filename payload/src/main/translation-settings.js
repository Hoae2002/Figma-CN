(function () {
  "use strict";
  const $ = id => document.getElementById(id), P = window.FigBoostTranslationPolicy;
  let state, reports = [];
  function message(text, error = false) { $("message").textContent = text; $("message").classList.toggle("error", error); }
  async function invoke(action, data) {
    if (!window.figBoostSettings) throw new Error("设置服务未连接，请从 FigBoost 菜单打开");
    const response = await window.figBoostSettings.invoke(action, data);
    if (!response.ok) throw new Error(response.error || "操作失败");
    if (response.state) { state = response.state; render(); }
    return response;
  }
  async function run(button, action, data, success) {
    if (button) button.disabled = true;
    message(action === "test" ? "正在测试连接…" : "正在处理…");
    try { await invoke(action, data); message(success || "已保存"); }
    catch (e) { message(e.message, true); }
    finally { if (button) button.disabled = false; }
  }
  function option(value, label) { const el = document.createElement("option"); el.value = value; el.textContent = label; return el; }
  for (const [region, label] of Object.entries(P.regions)) {
    const row = document.createElement("div"); row.className = "region";
    const caption = document.createElement("label"); caption.htmlFor = `region-${region}`; caption.textContent = label;
    const select = document.createElement("select"); select.id = caption.htmlFor;
    for (const [mode, text] of [["original", "保持原文"], ["local", "仅本地词库"], ["hybrid", "本地＋谷歌"]]) if (region !== "other" || mode !== "hybrid") select.append(option(mode, text));
    row.append(caption, select); $("regions").append(row); $("entry-region").append(option(region, label));
  }
  function tab(name) { for (const button of document.querySelectorAll("[data-tab]")) { const active = button.dataset.tab === name; button.setAttribute("aria-pressed", String(active)); $(button.dataset.tab).hidden = !active; } }
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => tab(button.dataset.tab)));
  function text(tag, value, className) { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; }
  function actionButton(label, fn) { const button = text("button", label); button.type = "button"; button.addEventListener("click", () => fn(button)); return button; }
  function renderEntries() {
    if (!state) return;
    const query = $("search").value.toLowerCase();
    const entries = Object.entries({ ...state.learned, ...state.overrides }).filter(([, e]) => `${e.text} ${e.translation}`.toLowerCase().includes(query));
    $("entry-count").textContent = `共 ${entries.length} 条${entries.length > 150 ? "，显示前 150 条，请搜索缩小范围" : ""}`;
    $("entries").replaceChildren();
    for (const [key, e] of entries.slice(0, 150)) {
      const li = document.createElement("li"); li.append(text("strong", e.text), text("p", e.keepOriginal ? "保持原文" : e.translation), text("small", `${P.regions[e.region] || e.region} · ${e.context} · ${e.source === "manual" ? "人工修正" : "谷歌学习"}`));
      const row = document.createElement("div"); row.className = "row";
      row.append(actionButton("编辑", () => { $("original").value = e.text; $("translation").value = e.translation; $("entry-region").value = e.region; if (!Array.from($("context").options).some(o => o.value === e.context)) $("context").append(option(e.context, e.context)); $("context").value = e.context; $("keepOriginal").checked = !!e.keepOriginal; $("translation").disabled = !!e.keepOriginal; $("original").focus(); }), actionButton("删除", button => run(button, "deleteEntry", { key }, "已删除，允许再次补译")));
      li.append(row); $("entries").append(li);
    }
    if (!entries.length) $("entries").append(text("li", "还没有匹配词条。开启补译后，新译文会自动保存在这里。", "muted"));
  }
  function render() {
    $("enabled").checked = state.settings.enabled; $("online").checked = state.settings.online; $("dailyLimit").value = state.settings.dailyLimit;
    $("connection").textContent = !state.settings.enabled ? "汉化已关闭" : state.settings.online && state.hasKey ? "谷歌补译已开启" : "本地词库";
    $("key-status").textContent = state.hasKey ? "（已加密保存）" : "（尚未配置）";
    $("usage").textContent = state.usage.characters.toLocaleString(); $("learned-count").textContent = Object.keys(state.learned).length; $("manual-count").textContent = Object.keys(state.overrides).length;
    $("last-error").textContent = state.lastError ? `最近状态：${state.lastError}${state.blocked ? "；自动请求已暂停，请测试连接后恢复。" : ""}` : "未命中词库时才发送请求，测试连接也计入字符统计。";
    for (const region of Object.keys(P.regions)) $(`region-${region}`).value = state.settings.regions[region] || (region === "other" ? "local" : "hybrid");
    $("rules").replaceChildren(); state.rules.forEach((rule, index) => { const li = document.createElement("li"), report = reports.find(r => r.text === rule.text && r.anchor === rule.anchor); li.append(text("strong", rule.text), text("p", `${P.regions[rule.region]} · ${report ? report.matched ? "当前页面已找到定位" : "当前未找到，请打开对应界面后重试" : "尚未检查定位"}`, "muted"), actionButton("恢复翻译", button => run(button, "removeRule", { index }, "已恢复翻译"))); $("rules").append(li); });
    if (!state.rules.length) $("rules").append(text("li", "没有持久排除项。", "muted"));
    renderEntries();
  }
  function settings() { return { enabled: $("enabled").checked, online: $("online").checked, dailyLimit: Number($("dailyLimit").value), regions: Object.fromEntries(Object.keys(P.regions).map(r => [r, $(`region-${r}`).value])) }; }
  for (const id of ["service-form", "scope-form"]) $(id).addEventListener("submit", event => { event.preventDefault(); run(event.submitter, "settings", settings()); });
  $("key-form").addEventListener("submit", event => { event.preventDefault(); const key = $("apiKey").value; $("apiKey").value = ""; run(event.submitter, "saveKey", { key }, "密钥已加密保存，可测试连接"); });
  $("test").addEventListener("click", () => run($("test"), "test", {}, "连接成功，可以开启谷歌补译"));
  $("clearKey").addEventListener("click", () => run($("clearKey"), "clearKey", {}, "密钥已清除，已关闭在线补译"));
  $("pick").addEventListener("click", () => run($("pick"), "pick", {}, "已进入点选模式，按 Esc 退出"));
  $("refresh").addEventListener("click", () => run($("refresh"), "snapshot", {}, "词库已刷新"));
  $("checkRules").addEventListener("click", async () => { try { const result = await invoke("ruleStatus"); reports = result.rules; render(); message("已检查当前打开的界面"); } catch (e) { message(e.message, true); } });
  $("search").addEventListener("input", renderEntries);
  $("keepOriginal").addEventListener("change", () => { $("translation").disabled = $("keepOriginal").checked; });
  $("entry-form").addEventListener("reset", () => { $("translation").disabled = false; });
  $("entry-form").addEventListener("submit", event => { event.preventDefault(); run(event.submitter, "override", { text: $("original").value, translation: $("translation").value, region: $("entry-region").value, context: $("context").value, keepOriginal: $("keepOriginal").checked }); });
  run(null, "snapshot", {}, "设置已加载");
})();
