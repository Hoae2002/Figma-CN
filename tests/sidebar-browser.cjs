"use strict";
// Local-only browser fixture; never starts or connects to Figma Desktop.
const http = require("node:http"), fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process");
const repo = path.join(__dirname, "..");
const payload = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "build-renderer-fixture.ps1")], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true });
const plugins = [
  { id: "1", name: "Vector to 3D", description: "矢量生成 3D 渲染图", commands: [] },
  { id: "2", name: "Simple3D", description: "随机生成不规则斑点形状", commands: [] },
  { id: "3", name: "Moonvy·月维", description: "专业的设计图交付工具", commands: [{ name: "打开面板", command: "open" }] }
];
const page = `<!doctype html><html><meta charset="utf-8"><title>FigBoost 插件侧边栏回归</title><style>
body{margin:0;background:#eeecf5;font:14px "Microsoft YaHei",sans-serif}header{height:48px;background:white;border-bottom:1px solid #ddd;padding:12px;box-sizing:border-box}aside{position:fixed;right:0;top:48px;width:240px;bottom:0;background:white;border-left:1px solid #ddd;padding:18px;box-sizing:border-box}main{padding:60px 28px;color:#666}button{padding:6px 12px}#menu{position:fixed;left:12px;top:50px;z-index:200;background:white;padding:12px;box-shadow:0 4px 20px #0003}#menu:empty{display:none}[role=menuitem]{padding:8px;cursor:pointer}.board{background:white;margin:40px 260px 20px 80px;width:400px;height:260px;box-shadow:0 4px 20px #0001;display:grid;place-items:center}</style>
<header><button aria-label="Main menu">主菜单</button>　FigBoost 浏览器回归环境</header><aside aria-label="Right sidebar"><b>设计</b><hr>位置<br><br>布局<br><br>导出</aside><main>仅使用合成插件数据；原生启动通过测试菜单验证。<div class="board">原始画布内容</div><div id="result" role="status">等待测试</div></main><div id="menu"></div>
<script>window.__FIGMA_ZH_TEST__=true;
const plugins=${JSON.stringify(plugins)};
const storageKey='figboost:plugin-sidebar:v1:local';
if(!localStorage.getItem(storageKey))localStorage.setItem(storageKey,JSON.stringify({plugins,saved:['1','2','3'],recent:['1'],favorites:[],groups:[]}));
window.fixtureFailure=false;window.fixtureRuns=[];
const originalFetch=window.fetch.bind(window);
window.fetch=async function(url,options){if(!new URL(url,location.origin).pathname.startsWith('/api/'))return originalFetch(url,options);if(window.fixtureFailure)throw Error('模拟网络断开');return {ok:true,json:async()=>({meta:plugins.map(p=>({content:{plugin:p}})),pagination:{}})}};
const menu=document.getElementById('menu');
function item(name,action){const el=document.createElement('div');el.role='menuitem';el.textContent=name;el.onclick=action;menu.append(el)}
function run(name){window.fixtureRuns.push(name);document.getElementById('result').textContent='原生菜单已运行：'+name;console.info('[SidebarFixture] native-run',name);menu.replaceChildren()}
document.querySelector('[aria-label="Main menu"]').onclick=()=>{menu.replaceChildren();item('Plugins',()=>item('Saved plugins',()=>{for(const p of plugins)item(p.name,()=>p.commands.length?item('打开面板',()=>run(p.name+'/打开面板')):run(p.name))}))};
console.info('[SidebarFixture] ready');</script><script src="/payload.js"></script></html>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  const body = url.pathname === "/payload.js" ? payload : url.pathname === "/plugin-sidebar.js" ? fs.readFileSync(path.join(repo, "payload/src/content/plugin-sidebar.js"), "utf8") : url.pathname === "/design/sidebar-test" ? page : null;
  res.writeHead(body === null ? 404 : 200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body || "Not found");
});
server.listen(4189, "127.0.0.1", () => console.log("Sidebar fixture: http://127.0.0.1:4189/design/sidebar-test"));
