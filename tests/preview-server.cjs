// Local settings-only fixture. No Figma client, no network translation, no real credentials.
"use strict";
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "../payload/src");
const bridge = `window.figBoostSettings = (() => {
  const state = { schema:3, revision:1, settings:{enabled:true,communityOnline:true}, learned:{}, lastError:"" };
  return { invoke: async (action, data = {}) => {
    if (action === 'settings') Object.assign(state.settings, data);
    return {ok:true,state:JSON.parse(JSON.stringify(state))};
  }};
})();`;
const server = http.createServer((req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "translation-settings.html";
  if (name === "preview-bridge.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bridge); return; }
  if (!["translation-settings.html", "translation-settings.css", "translation-settings.js"].includes(name)) { res.writeHead(404); res.end(); return; }
  const file = path.join(root, "main", name);
  let content = fs.readFileSync(file, "utf8");
  if (name.endsWith(".html")) content = content.replace('<script src="translation-settings.js">', '<script src="preview-bridge.js"></script><script src="translation-settings.js">');
  res.setHeader("Content-Type", name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".css") ? "text/css" : "application/javascript"); res.end(content);
});
server.listen(4189, "127.0.0.1", () => console.log("Settings fixture: http://127.0.0.1:4189"));
