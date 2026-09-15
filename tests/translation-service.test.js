"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  createService,
  readState,
  googleTransport,
} = require("../payload/src/main/translation-service");
const P = require("../payload/src/shared/translation-policy");
const c = (text) => ({
  text,
  region: "toolbar",
  context: "button",
  anchor: "toolbar-action",
});
function fixture(t, transport, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figboost-service-"));
  const options = { dir, transport, debounceMs: 1, ...extra },
    service = createService(options);
  t.after(() => {
    service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { service, dir, options };
}
test("no key: simultaneous misses deduplicate and restart uses cache", async (t) => {
  let calls = 0;
  const { service, dir, options } = fixture(t, async () => {
    calls++;
    return ["新控件"];
  });
  const values = await Promise.all([
    service.translate(c("New gizmo")),
    service.translate(c("New gizmo")),
  ]);
  assert.equal(calls, 1);
  assert.equal(values[0].translation, "新控件");
  assert.ok(fs.existsSync(path.join(dir, "cache.json")));
  const reboot = createService({
    ...options,
    transport: () => {
      throw Error("offline");
    },
  });
  assert.equal((await reboot.translate(c("New gizmo"))).translation, "新控件");
  reboot.close();
  assert.equal(service.snapshot().credential, undefined);
});
test("protected tokens and unknown regions never request translation", async (t) => {
  let calls = 0;
  const { service } = fixture(t, async () => {
    calls++;
    return ["测试"];
  });
  for (const text of [
    "user@example.com",
    "C:\\private\\file.fig",
    "https://secret.test",
    "<b>name</b>",
  ])
    assert.equal(await service.translate(c(text)), null);
  assert.equal(
    await service.translate({ ...c("Private label"), region: "other" }),
    null,
  );
  assert.equal(calls, 0);
});
test("disabled switch and region/ancestor exclusions block requests", async (t) => {
  let calls = 0;
  const { service } = fixture(t, async () => {
    calls++;
    return ["测试"];
  });
  await service.command("settings", { enabled: false });
  assert.equal(await service.translate(c("Save")), null);
  await service.command("settings", { enabled: true });
  await service.command("exclude", { scope: "region", region: "toolbar" });
  assert.equal(await service.translate(c("Save")), null);
  await service.command("removeRule", { index: 0 });
  await service.command("exclude", {
    scope: "element",
    region: "toolbar",
    anchor: "toolbar-group",
  });
  assert.equal(
    await service.translate({ ...c("Save"), anchors: ["toolbar-group"] }),
    null,
  );
  assert.equal(calls, 0);
  await service.command("removeRule", { index: 0 });
  assert.equal((await service.translate(c("Save"))).translation, "测试");
});
test("settings revision rejects an in-flight result without caching", async (t) => {
  let done, start;
  const began = new Promise((r) => (start = r));
  const { service } = fixture(t, () => {
    start();
    return new Promise((r) => (done = r));
  });
  const result = service.translate(c("Save"));
  await began;
  await service.command("exclude", { scope: "region", region: "toolbar" });
  done(["保存"]);
  assert.equal(await result, null);
  assert.equal(Object.keys(service.snapshot().learned).length, 0);
});
test("legacy migration retains cache and exclusions but never credentials or manual dictionary", async (t) => {
  const { service, dir, options } = fixture(t, async () => ["测试"]);
  service.close();
  const entry = { ...c("Save"), translation: "保存" },
    old = {
      schema: 1,
      revision: 3,
      settings: {
        enabled: true,
        online: false,
        regions: { toolbar: "original", native: "local" },
      },
      learned: { [P.key("Save", "toolbar", "button")]: entry },
      rules: [],
      credential: "encrypted-old",
      overrides: { old: "manual" },
    };
  const file = path.join(dir, "state.json");
  fs.writeFileSync(file, JSON.stringify(old));
  const reboot = createService(options);
  const snap = reboot.snapshot();
  assert.equal(snap.schema, 2);
  assert.equal(snap.credential, undefined);
  assert.equal(snap.overrides, undefined);
  assert.equal(snap.settings.regions.native, undefined);
  assert.equal(snap.rules[0].scope, "region");
  await reboot.command("removeRule", { index: 0 });
  assert.equal((await reboot.translate(c("Save"))).translation, "保存");
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), old);
  reboot.close();
});
test("corrupt current cache recovers last valid backup", async (t) => {
  const { service, dir } = fixture(t, async () => ["保存"]);
  await service.translate(c("Save"));
  await service.command("settings", { enabled: false });
  const file = path.join(dir, "cache.json");
  fs.writeFileSync(file, "broken");
  const loaded = readState(file);
  assert.equal(loaded.recovered, true);
  assert.equal(Object.keys(loaded.state.learned).length, 1);
});
test("two concurrent requests maximum and independent phrase boundaries", async (t) => {
  let active = 0,
    max = 0;
  const { service } = fixture(t, async (texts) => {
    assert.equal(texts.length, 1);
    max = Math.max(max, ++active);
    await new Promise((r) => setTimeout(r, 15));
    active--;
    return ["测试"];
  });
  await Promise.all(
    ["First", "Second", "Third", "Fourth"].map((s) => service.translate(c(s))),
  );
  assert.equal(max, 2);
});
test("transient failure retries once and invalid response is not cached", async (t) => {
  let calls = 0;
  const { service } = fixture(t, async () => {
    if (++calls === 1)
      throw Object.assign(Error("temporary"), { transient: true });
    return ["<html>bad</html>"];
  });
  assert.equal(await service.translate(c("Save")), null);
  assert.equal(calls, 2);
  assert.equal(Object.keys(service.snapshot().learned).length, 0);
});
test("rate-limit cooldown automatically recovers", async (t) => {
  let calls = 0,
    time = 0;
  const { service } = fixture(
    t,
    async () => {
      if (++calls === 1) throw Error("limited");
      return ["保存"];
    },
    { now: () => new Date(time), cooldownMs: 100 },
  );
  assert.equal(await service.translate(c("Save")), null);
  assert.equal(await service.translate(c("Save")), null);
  assert.equal(calls, 1);
  time = 101;
  assert.equal((await service.translate(c("Save"))).translation, "保存");
});
test("removed key and dictionary commands are rejected", async (t) => {
  const { service } = fixture(t, async () => ["测试"]);
  for (const action of ["saveKey", "test", "override", "deleteEntry"])
    await assert.rejects(service.command(action, {}), /不支持/);
});
test("closing service prevents an active result from writing cache", async (t) => {
  let done, start;
  const began = new Promise((r) => (start = r));
  const { service, dir } = fixture(t, () => {
    start();
    return new Promise((r) => (done = r));
  });
  const result = service.translate(c("Save"));
  await began;
  service.close();
  done(["保存"]);
  assert.equal(await result, null);
  assert.equal(fs.existsSync(path.join(dir, "cache.json")), false);
});
test("Google transport uses anonymous fixed endpoint and joins sentence fragments", async () => {
  const { EventEmitter } = require("node:events");
  let options;
  const net = {
    request(o) {
      options = o;
      const req = new EventEmitter();
      req.abort = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        req.emit("response", res);
        res.emit(
          "data",
          JSON.stringify({ sentences: [{ trans: "自动" }, { trans: "布局" }] }),
        );
        res.emit("end");
      };
      return req;
    },
  };
  assert.deepEqual(await googleTransport(net)(["Auto layout"]), ["自动布局"]);
  const url = new URL(options.url);
  assert.equal(url.origin, "https://translate.googleapis.com");
  assert.equal(url.searchParams.get("q"), "Auto layout");
  assert.equal(url.searchParams.has("key"), false);
  assert.equal(options.useSessionCookies, false);
  await assert.rejects(googleTransport(net)(["One", "Two"]));
});
