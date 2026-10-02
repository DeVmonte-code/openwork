import assert from "node:assert/strict";
import { test } from "node:test";
import { choosePort, localEnvironments, portRequest } from "./local-config.mjs";

test("default and explicit port requests", () => {
  assert.deepEqual(portRequest(undefined, 5173, "web"), { port: 5173, allowFallback: true, name: "web" });
  assert.equal(portRequest("", 8788, "api").port, 8788);
  assert.deepEqual(portRequest("6001", 5173, "web"), { port: 6001, allowFallback: false, name: "web" });
});

test("rejects invalid port overrides", () => {
  for (const value of ["0", "-1", "65536", "1.5", "abc", "12junk", " "]) {
    assert.throws(() => portRequest(value, 5173, "web"), /integer between/);
  }
});

test("uses a free default without skipping it", async () => {
  assert.equal(await choosePort(portRequest(undefined, 5173, "web"), async () => true), 5173);
});

test("uses next free default, skipping the API's selected port", async () => {
  assert.equal(await choosePort(portRequest(undefined, 5173, "web"), async (port) => port >= 5174, [5174]), 5175);
});

test("fails plainly instead of silently changing an explicit port", async () => {
  await assert.rejects(choosePort(portRequest("6001", 5173, "web"), async () => false), /6001 is unavailable/);
  await assert.rejects(choosePort(portRequest("6001", 5173, "web"), async () => true, [6001]), /unavailable/);
});

test("does not overflow the port range", async () => {
  await assert.rejects(choosePort(portRequest(undefined, 65535, "api"), async () => false), /No free port/);
});

test("builds separate server environments without changing the parent", () => {
  const base = { PORT: "3000", BASE_PATH: "/old", HOST: "0.0.0.0", KEEP: "value" };
  const env = localEnvironments(base, 5174, 8789);
  assert.equal(env.api.PORT, "8789");
  assert.equal(env.web.PORT, "5174");
  assert.equal(env.api.NODE_ENV, "development");
  assert.equal(env.api.HOST, "127.0.0.1");
  assert.equal(env.web.HOST, "127.0.0.1");
  assert.equal(env.web.BASE_PATH, "/");
  assert.equal(env.web.OPENWORK_LOCAL_API_URL, "http://127.0.0.1:8789");
  assert.equal(env.api.OPENWORK_LOCAL_API_URL, undefined);
  assert.equal(env.web.KEEP, "value");
  assert.equal(env.web.VITE_OPENWORK_FORCE_MANUAL_AUTH, undefined);
  assert.deepEqual(base, { PORT: "3000", BASE_PATH: "/old", HOST: "0.0.0.0", KEEP: "value" });
});

test("preserves explicit existing authentication configuration", () => {
  const env = localEnvironments({ VITE_OPENWORK_FORCE_MANUAL_AUTH: "0", VITE_DEN_BASE_URL: "https://example.test" }, 5173, 8788);
  assert.equal(env.web.VITE_OPENWORK_FORCE_MANUAL_AUTH, "0");
  assert.equal(env.web.VITE_DEN_BASE_URL, "https://example.test");
});