"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createService, readState } = require("../payload/src/main/translation-service.js");
const P = require("../payload/src/shared/translation-policy.js");
const crypto = require("node:crypto");
const secret = crypto.randomBytes(32);
const storage = { isEncryptionAvailable: () => true, encryptString: text => { const iv = crypto.randomBytes(16), cipher = crypto.createCipheriv("aes-256-cbc", secret, iv); return Buffer.concat([iv, cipher.update(text), cipher.final()]); }, decryptString: value => { const decipher = crypto.createDecipheriv("aes-256-cbc", secret, value.subarray(0, 16)); return Buffer.concat([decipher.update(value.subarray(16)), decipher.final()]).toString(); } };
const candidate = text => ({ text, region: "toolbar", context: "button", anchor: "toolbar-action" });
const settings = { enabled: true, online: true, dailyLimit: 20000, regions: {} };
async function fixture(t, transport = async texts => texts.map(s => "翻译" + s), override = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figboost-service-"));
  const options = { dir, safeStorage: storage, transport, debounceMs: 1, ...override };
  const service = createService(options);
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await service.command("saveKey", { key: "test-key-abcdefghijklmnopqrstuvwxyz" });
  await service.command("settings", settings);
  return { service, dir, options };
}
test("deduplicates simultaneous misses, encrypts credentials and persists learned entries", async t => {
  let calls = 0;
  const { service, dir, options } = await fixture(t, async texts => { calls++; return texts.map(() => "新控件"); });
  const c = candidate("New gizmo");
  const values = await Promise.all([service.translate(c), service.translate(c), service.translate(c)]);
  assert.equal(calls, 1); assert.equal(values[0].translation, "新控件");
  assert.ok(!fs.readFileSync(path.join(dir, "state.json"), "utf8").includes("test-key-"));
  assert.equal(service.snapshot().credential, undefined);
  const reboot = createService({ ...options, transport: () => { throw Error("must use cache"); } });
  assert.equal((await reboot.translate(c)).translation, "新控件"); reboot.close();
});
test("protected tokens and unknown regions never leave the process", async t => {
  let calls = 0; const { service } = await fixture(t, async () => { calls++; return []; });
  for (const text of ["user@example.com", "C:\\private\\file.fig", "https://secret.test", "<b>name</b>"]) assert.equal(await service.translate(candidate(text)), null);
  assert.equal(await service.translate({ ...candidate("Private label"), region: "other" }), null);
  assert.equal(calls, 0);
});
test("local mode, disabled online, keep-original and anchored exclusions block requests", async t => {
  let calls = 0; const { service } = await fixture(t, async () => { calls++; return ["新控件"]; });
  const c = candidate("New gizmo");
  await service.command("settings", { ...settings, online: false }); assert.equal(await service.translate(c), null);
  await service.command("settings", { ...settings, regions: { toolbar: "local" } }); assert.equal(await service.translate(c), null);
  await service.command("settings", settings);
  await service.command("exclude", c); assert.equal(await service.translate(c), null);
  await service.command("removeRule", { index: 0 });
  await service.command("override", { ...c, keepOriginal: true }); assert.equal(await service.translate(c), null);
  assert.equal(calls, 0);
});
test("manual correction takes precedence and deletion permits fresh translation", async t => {
  let calls = 0; const { service } = await fixture(t, async () => { calls++; return ["机器译文"]; }); const c = candidate("New gizmo");
  await service.translate(c);
  await service.command("override", { ...c, translation: "人工译文" });
  assert.equal((await service.translate(c)).translation, "人工译文");
  await service.command("deleteEntry", { key: P.key(c.text, c.region, c.context) });
  await service.translate(c); assert.equal(calls, 2);
});
test("a settings revision during a request cannot learn excluded content", async t => {
  let complete, started; const began = new Promise(r => { started = r; });
  const { service } = await fixture(t, () => { started(); return new Promise(r => { complete = r; }); });
  const c = candidate("New gizmo"), result = service.translate(c); await began;
  await service.command("exclude", c); complete(["新控件"]);
  assert.equal(await result, null); assert.equal(Object.keys(service.snapshot().learned).length, 0);
});
test("daily cap is reserved before transport and survives restart", async t => {
  let calls = 0; const { service, options } = await fixture(t, async () => { calls++; return ["测试"]; });
  await service.command("settings", { ...settings, dailyLimit: 4 });
  await service.translate(candidate("Test")); await service.translate(candidate("Other"));
  assert.equal(calls, 1); assert.equal(service.snapshot().usage.characters, 4);
  const reboot = createService(options); assert.equal(reboot.snapshot().usage.characters, 4); reboot.close();
});
test("transient errors retry once, count attempted characters, and invalid results are not learned", async t => {
  let calls = 0; const { service } = await fixture(t, async () => { calls++; if (calls === 1) throw Object.assign(new Error("temporary"), { transient: true }); return ["<script>bad</script>"]; });
  assert.equal(await service.translate(candidate("Test")), null); assert.equal(calls, 2); assert.equal(service.snapshot().usage.characters, 8); assert.equal(Object.keys(service.snapshot().learned).length, 0);
});
test("fatal authentication failure stops queued requests until explicit recovery", async t => {
  let calls = 0; const { service } = await fixture(t, async () => { calls++; throw Object.assign(new Error("credential error"), { fatal: true }); });
  await service.translate(candidate("First")); await service.translate(candidate("Second"));
  assert.equal(calls, 1); assert.equal(service.snapshot().blocked, true);
});
test("no plaintext fallback when Windows encryption is unavailable", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figboost-crypto-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = createService({ dir, safeStorage: { isEncryptionAvailable: () => false }, transport: async () => [] });
  await assert.rejects(service.command("saveKey", { key: "test-key-abcdefghijklmnopqrstuvwxyz" }), /加密/);
  assert.equal(service.snapshot().hasKey, false); assert.equal(fs.existsSync(path.join(dir, "state.json")), false); service.close();
});
test("corrupt primary state recovers the last valid backup without overwriting it", async t => {
  const { service, dir, options } = await fixture(t); await service.translate(candidate("New gizmo")); await service.command("settings", settings);
  fs.writeFileSync(path.join(dir, "state.json"), "{broken");
  assert.equal(readState(path.join(dir, "state.json")).recovered, true);
  const reboot = createService(options); assert.equal(Object.keys(reboot.snapshot().learned).length, 1);
  await reboot.command("settings", settings); assert.equal(readState(path.join(dir, "state.json") + ".bak").state.schema, 1); reboot.close();
});
test("batches at most 5000 characters and two concurrent requests", async t => {
  let active = 0, max = 0; const sizes = [];
  const { service } = await fixture(t, async texts => { active++; max = Math.max(max, active); sizes.push(texts.join("").length); await new Promise(r => setTimeout(r, 10)); active--; return texts.map(() => "译文"); });
  await service.command("settings", { ...settings, dailyLimit: 100000 });
  await Promise.all(Array.from({ length: 110 }, (_, i) => service.translate(candidate("Label " + String.fromCharCode(65 + i % 26) + String.fromCharCode(65 + Math.floor(i / 26)) + "x".repeat(220)))));
  assert.equal(max, 2); assert.ok(sizes.every(n => n <= 5000)); assert.equal(Object.keys(service.snapshot().learned).length, 110);
});
