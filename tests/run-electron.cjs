"use strict";
const { spawn } = require("node:child_process"), path = require("node:path");
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [path.join(__dirname, "electron-regression.cjs")], { env, windowsHide: true, stdio: "inherit" });
const timer = setTimeout(() => { child.kill(); process.exitCode = 1; }, 60000);
child.on("error", error => { clearTimeout(timer); console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { clearTimeout(timer); process.exitCode = code === null ? 1 : code; });
