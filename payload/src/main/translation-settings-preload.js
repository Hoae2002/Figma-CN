"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const actions = new Set(["snapshot", "saveKey", "clearKey", "test", "settings", "override", "deleteEntry", "removeRule", "pick", "ruleStatus"]);
contextBridge.exposeInMainWorld("figBoostSettings", {
  invoke: (action, data) => actions.has(action) ? ipcRenderer.invoke("figboost:translation-settings", action, data) : Promise.resolve({ ok: false, error: "不支持的操作" })
});
