(function () {
  "use strict";
  const $ = id => document.getElementById(id), P = window.FigBoostTranslationPolicy;
  let state;
  function message(value, error = false) { $("message").textContent = value; $("message").classList.toggle("error", error); }
  function text(tag, value, className) { const e = document.createElement(tag); e.textContent = value; if (className) e.className = className; return e; }
  function render() {
    $("enabled").checked = state.settings.enabled;
    $("community-online").checked = state.settings.communityOnline;
    $("community-online").disabled = false;
    $("connection").textContent = !state.settings.enabled ? "词库汉化已关闭" : !state.pages?.connected ? "等待页面接入" : state.blocked && state.settings.communityOnline ? "社区使用已有缓存" : state.settings.communityOnline ? "词库＋社区补译已开启" : "词库汉化已开启";
    const cached = Object.values(state.learned).filter(e => e.region === "community");
    $("cache-status").textContent = `已缓存社区补译 ${cached.length} 条，下次进入社区自动复用。`;
    $("page-status").textContent = state.pages?.connected ? `已连接 ${state.pages.connected} 个 Figma 页面。` : state.pages?.pending ? "页面汉化尚未接入，正在自动重试。" : "尚未连接 Figma 页面，请打开文件；若文件已打开，请在方便时重新启动 Figma。";
    $("last-error").textContent = state.lastError ? `${state.lastError}，稍后自动重试。` : "";
    $("rules").replaceChildren();
    state.rules.forEach((rule, index) => {
      const li = document.createElement("li"), copy = document.createElement("div");
      copy.append(text("strong", rule.scope === "region" ? P.regions[rule.region] : rule.text || "已选区域"), text("p", rule.scope === "region" ? "整个区域保持原文" : `${P.regions[rule.region]} · 已保存排除`, "muted"));
      const button = text("button", "恢复翻译"); button.type = "button"; button.setAttribute("aria-label", `恢复翻译：${rule.text || P.regions[rule.region]}`);
      button.addEventListener("click", () => run(button, "removeRule", { index }, "已恢复该区域翻译"));
      li.append(copy, button); $("rules").append(li);
    });
    if (!state.rules.length) $("rules").append(text("li", "尚未添加排除区域。", "empty"));
  }
  async function run(button, action, data, success) {
    if (button) button.disabled = true;
    try {
      if (!window.figBoostSettings) throw Error("请从 FigBoost 菜单打开汉化设置");
      const result = await window.figBoostSettings.invoke(action, data);
      if (!result.ok) throw Error(result.error || "操作失败");
      if (result.state) { state = result.state; render(); }
      message(success || "已保存");
    } catch (e) { if (state) render(); message(e.message, true); }
    finally { if (button) button.disabled = false; }
  }
  for (const [region, label] of Object.entries(P.regions)) if (region !== "other") { const option = text("option", label); option.value = region; $("region").append(option); }
  $("enabled").addEventListener("change", () => run($("enabled"), "settings", { enabled: $("enabled").checked }, $("enabled").checked ? "已开启词库汉化" : "已恢复界面原文"));
  $("community-online").addEventListener("change", () => run($("community-online"), "settings", { communityOnline: $("community-online").checked }, $("community-online").checked ? "已开启社区 Google 补译" : "已关闭社区 Google 补译"));
  $("pick").addEventListener("click", () => run($("pick"), "pick", {}, "已进入点选模式，Esc 退出"));
  $("exclude-form").addEventListener("submit", e => { e.preventDefault(); run(e.submitter, "exclude", { scope: "region", region: $("region").value }, "已排除此区域"); });
  window.addEventListener("focus", () => { if (state) run(null, "snapshot", {}, "设置已刷新"); });
  run($("enabled"), "snapshot", {}, "设置已加载");
})();
