import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLocalServer, localEnvironments, localServerSettings, serverBanner } from "./local-config.mjs";
import { tokenSafeOutput } from "./local-output.mjs";

const token = "synthetic-client-token-for-tests";
const base = { OPENWORK_SERVER_URL: "http://localhost:8787", OPENWORK_SERVER_TOKEN: token };

test("short settings map to web-only explicit names and force stale settings override", () => {
  const env = localEnvironments(base, 5173, 8788);
  assert.equal(env.web.VITE_OPENWORK_URL, "http://localhost:8787/");
  assert.equal(env.web.VITE_OPENWORK_TOKEN, token);
  assert.equal(env.web.VITE_OPENWORK_FORCE_ENV_SETTINGS, "1");
  for (const key of ["OPENWORK_SERVER_URL", "OPENWORK_SERVER_TOKEN", "OPENWORK_ALLOW_REMOTE_SERVER",
    "VITE_OPENWORK_URL", "VITE_OPENWORK_TOKEN", "VITE_OPENWORK_HOST_TOKEN", "VITE_OPENWORK_FORCE_ENV_SETTINGS"]) {
    assert.equal(env.api[key], undefined);
  }
  assert.deepEqual(base, { OPENWORK_SERVER_URL: "http://localhost:8787", OPENWORK_SERVER_TOKEN: token });
});
test("each explicit variable takes precedence and remains web-only", () => {
  const env = localEnvironments({
    ...base, VITE_OPENWORK_URL: "https://127.0.0.1:9000",
    VITE_OPENWORK_TOKEN: "synthetic-explicit-token",
    VITE_OPENWORK_HOST_TOKEN: "synthetic-host-token",
    VITE_OPENWORK_FORCE_ENV_SETTINGS: "0",
  }, 5173, 8788);
  assert.equal(env.web.VITE_OPENWORK_URL, "https://127.0.0.1:9000");
  assert.equal(env.web.VITE_OPENWORK_TOKEN, "synthetic-explicit-token");
  assert.equal(env.web.VITE_OPENWORK_FORCE_ENV_SETTINGS, "0");
  assert.equal(env.web.VITE_OPENWORK_HOST_TOKEN, "synthetic-host-token");
  assert.equal(env.api.VITE_OPENWORK_TOKEN, undefined);
  assert.equal(env.api.VITE_OPENWORK_HOST_TOKEN, undefined);
  assert.equal(localServerSettings({ ...base, OPENWORK_SERVER_URL: "bad", VITE_OPENWORK_URL: "http://localhost:8787" }).url, "http://localhost:8787/");
});
test("explicit names work without shortcuts; no settings leave the existing default unchanged", () => {
  const env = localEnvironments({ VITE_OPENWORK_URL: base.OPENWORK_SERVER_URL, VITE_OPENWORK_TOKEN: token }, 5173, 8788);
  assert.equal(env.web.VITE_OPENWORK_TOKEN, token);
  assert.equal(env.web.VITE_OPENWORK_FORCE_ENV_SETTINGS, "1");
  assert.equal(localServerSettings({}), null);
  assert.equal(serverBanner(null), "");
});
test("token without a URL fails plainly without printing the token", () => {
  for (const settings of [{ OPENWORK_SERVER_TOKEN: token }, { VITE_OPENWORK_TOKEN: token }]) {
    assert.throws(() => localServerSettings(settings), error => {
      assert.match(error.message, /requires.*URL/);
      assert.equal(error.message.includes(token), false);
      return true;
    });
  }
});
test("invalid URLs and non-http protocols fail without including their input or token", () => {
  for (const url of [token, `file:///${token}`, `ftp://localhost/${token}`, `http://user:${token}@localhost:8787`, "http://", "https://localhost:99999"]) {
    assert.throws(() => localServerSettings({ ...base, OPENWORK_SERVER_URL: url }), error => {
      assert.equal(error.message.includes(token), false);
      return true;
    });
  }
});
test("all three loopback hosts accept http and https", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    for (const scheme of ["http", "https"]) {
      assert.ok(localServerSettings({ OPENWORK_SERVER_URL: `${scheme}://${host}:8787` }));
    }
  }
});
test("remote hosts require the exact deliberate opt-in, even without a token", () => {
  for (const host of ["example.test", "localhost.example.test", "127.0.0.2", "[::2]"]) {
    for (const flag of [undefined, "0", "true"]) {
      assert.throws(() => localServerSettings({ OPENWORK_SERVER_URL: `https://${host}`, OPENWORK_ALLOW_REMOTE_SERVER: flag }), /token would be placed in the page code/);
    }
    assert.ok(localServerSettings({ ...base, OPENWORK_SERVER_URL: `https://${host}`, OPENWORK_ALLOW_REMOTE_SERVER: "1" }));
  }
});
test("banner says only the connection address and never the token", () => {
  assert.equal(serverBanner(localServerSettings(base)), "Connected to your local OpenWork server at http://localhost:8787/");
  const server = localServerSettings({ ...base, OPENWORK_SERVER_URL: `http://localhost:8787/${token}?token=${token}` });
  assert.equal(serverBanner(server).includes(token), false);
  const special = 'synthetic"/token';
  const encodedServer = localServerSettings({ ...base, OPENWORK_SERVER_TOKEN: special, OPENWORK_SERVER_URL: `http://localhost:8787/${encodeURIComponent(special)}` });
  assert.equal(serverBanner(encodedServer).includes(encodeURIComponent(special)), false);
});
test("health probe uses /health, a bounded signal, no token and no redirects", async () => {
  let called = false;
  const warning = await checkLocalServer(localServerSettings(base), async (url, options) => {
    called = true;
    assert.equal(url, "http://localhost:8787/health");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers, undefined);
    assert.equal(options.redirect, "error");
    return { ok: true };
  });
  assert.equal(called, true);
  assert.equal(warning, "");
  assert.equal(await checkLocalServer(null, () => { throw new Error("unexpected call"); }), "");
});
test("failed health responses and exceptions warn, continue, and never print secrets", async () => {
  for (const request of [async () => ({ ok: false }), async () => { throw new Error(token); }]) {
    const warning = await checkLocalServer(localServerSettings(base), request);
    assert.match(warning, /Warning:.*Continuing; the server may start later/);
    assert.equal(warning.includes(token), false);
  }
});
test("health probe aborts after its short timeout", async () => {
  const start = Date.now();
  const warning = await checkLocalServer(localServerSettings(base), (_url, options) => new Promise((_resolve, reject) => {
    // Keep this simulated stalled request alive, like a real network socket.
    const timer = setTimeout(() => reject(new Error("too late")), 5_000);
    options.signal.addEventListener("abort", () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
  }));
  assert.match(warning, /Warning/);
  assert.ok(Date.now() - start < 4_000);
});
test("child output is redacted across every possible chunk size, including final partial lines", () => {
  const source = `stdout ${token} stderr ${token} end`;
  for (let size = 1; size <= source.length; size += 1) {
    let text = "";
    const output = tokenSafeOutput(chunk => { text += chunk; }, [token]);
    for (let start = 0; start < source.length; start += size) output.data(Buffer.from(source.slice(start, start + size)));
    output.end();
    assert.equal(text, "stdout [redacted] stderr [redacted] end");
    assert.equal(text.includes(token), false);
  }
});