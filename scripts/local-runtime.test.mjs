import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { test } from "node:test";
import { portAvailable } from "./local-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);
const options = { skip: process.platform !== "linux", timeout: 60_000 };

async function listen(port = 0) {
  const server = createServer((socket) => socket.resume());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  return server;
}

async function unusedPort(excluded = []) {
  for (;;) {
    const server = await listen();
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    if (!excluded.includes(port)) return port;
  }
}

async function poll(check, label, timeout = 40_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}

function run(overrides = {}) {
  const env = { ...process.env, LOG_LEVEL: "info", ...overrides };
  if (overrides.LOCAL_WEB_PORT === undefined) delete env.LOCAL_WEB_PORT;
  if (overrides.LOCAL_API_PORT === undefined) delete env.LOCAL_API_PORT;
  const child = spawn(process.execPath, ["scripts/local.mjs"], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  let result;
  child.once("close", (code, signal) => { result = { code, signal }; });
  return {
    child,
    output: () => output.replace(/\x1b\[[0-9;]*m/g, ""),
    ready: () => poll(() => {
      if (result) throw new Error(`Runner exited before ready: ${output}`);
      return output.includes("[local] Ready");
    }, "runner ready"),
    closed: () => poll(() => result, "runner and inherited output pipes closed", 12_000),
    stop: async () => {
      if (!result) child.kill("SIGINT");
      await poll(() => result, "cleanup", 12_000);
    },
  };
}

async function ports() {
  const api = await unusedPort();
  const web = await unusedPort([api]);
  return { api, web, env: { LOCAL_API_PORT: String(api), LOCAL_WEB_PORT: String(web) } };
}

async function assertReleased(api, web) {
  assert.equal(await portAvailable(api), true, `API ${api} must be released`);
  assert.equal(await portAvailable(web), true, `web ${web} must be released`);
}

test("occupied defaults advance; repeated Ctrl+C cleans both servers", options, async () => {
  const apiBlocker = await listen(8788);
  let webBlocker;
  let runner;
  try {
    webBlocker = await listen(5173);
    runner = run();
    await runner.ready();
    const output = runner.output();
    const api = Number(output.match(/\[local\] API port: (\d+)/)?.[1]);
    const web = Number(output.match(/\[local\] Web port: (\d+)/)?.[1]);
    assert.ok(api > 8788 && web > 5173);
    assert.equal(output.match(/using next free port/g)?.length, 2);
    const health = await fetch(`http://127.0.0.1:${web}/api/healthz`);
    assert.deepEqual(await health.json(), { status: "ok" });
    runner.child.kill("SIGINT");
    await delay(10);
    runner.child.kill("SIGINT");
    assert.equal((await runner.closed()).code, 130);
    await assertReleased(api, web);
  } finally {
    if (runner) await runner.stop();
    if (webBlocker) await new Promise((resolve) => webBlocker.close(resolve));
    await new Promise((resolve) => apiBlocker.close(resolve));
  }
});

for (const victim of ["API", "Web"]) {
  test(`${victim} exit stops its peer and all output-owning descendants`, options, async () => {
    const { api, web, env } = await ports();
    const runner = run(env);
    try {
      await runner.ready();
      const apiPid = Number(runner.output().match(/INFO \((\d+)\): Server listening/)?.[1]);
      assert.ok(apiPid > 0);
      const { stdout } = await exec("ps", ["-eo", "pid=,ppid="]);
      const children = stdout.split("\n").map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([, parent]) => parent === runner.child.pid).map(([pid]) => pid);
      const webPid = children.find((pid) => pid !== apiPid);
      assert.ok(webPid > 0);
      process.kill(victim === "API" ? apiPid : webPid, "SIGTERM");
      assert.equal((await runner.closed()).code, 1);
      assert.match(runner.output(), new RegExp(`${victim} stopped`));
      await assertReleased(api, web);
    } finally { await runner.stop(); }
  });
}

test("API bind failure prints a plain startup error and never starts web", options, async () => {
  const { api, web, env } = await ports();
  const runner = run(env);
  let blocker;
  try {
    await poll(() => runner.output().includes("Building the API"), "build started");
    // Occupy the port after selection but before the built API can bind it.
    blocker = await listen(api);
    assert.equal((await runner.closed()).code, 1);
    assert.match(runner.output(), /API failed to start/);
    assert.equal(runner.output().includes("[local] Ready"), false);
    assert.equal(await portAvailable(web), true);
  } finally {
    await runner.stop();
    if (blocker) await new Promise((resolve) => blocker.close(resolve));
  }
});

test("Ctrl+C during API build stops startup without leftover ports", options, async () => {
  const { api, web, env } = await ports();
  const runner = run(env);
  try {
    await poll(() => runner.output().includes("Building the API"), "build started");
    await delay(50);
    runner.child.kill("SIGINT");
    assert.equal((await runner.closed()).code, 130);
    assert.equal(runner.output().includes("[local] Ready"), false);
    await assertReleased(api, web);
  } finally { await runner.stop(); }
});

async function listenerAddresses(port) {
  const addresses = [];
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let contents;
    try {
      contents = await readFile(table, "utf8");
    } catch (error) {
      // Kernels with IPv6 disabled expose no tcp6 table. IPv4 is mandatory.
      if (table.endsWith("tcp6") && error.code === "ENOENT") continue;
      throw error;
    }
    const rows = contents.trim().split("\n").slice(1);
    for (const row of rows) {
      const fields = row.trim().split(/\s+/);
      const [address, hexPort] = fields[1].split(":");
      if (fields[3] === "0A" && Number.parseInt(hexPort, 16) === port) addresses.push(address);
    }
  }
  return addresses;
}

test("local API and Vite bind exclusively to IPv4 loopback even with an inherited wildcard HOST", options, async () => {
  const { api, web, env } = await ports();
  const runner = run({ ...env, HOST: "0.0.0.0" });
  try {
    await runner.ready();
    // Inspect kernel LISTEN sockets, not just successful loopback requests:
    // a wildcard server would also accept those requests.
    assert.deepEqual(await listenerAddresses(api), ["0100007F"]);
    assert.deepEqual(await listenerAddresses(web), ["0100007F"]);
    assert.equal((await fetch(`http://127.0.0.1:${web}/api/healthz`)).status, 200);
  } finally { await runner.stop(); }
  await assertReleased(api, web);
});

test("API without HOST keeps the all-interface Replit default", options, async () => {
  const api = await unusedPort();
  const env = { ...process.env, PORT: String(api), NODE_ENV: "development" };
  delete env.HOST;
  const child = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], {
    cwd: root, env, stdio: "ignore",
  });
  let ended = false;
  child.once("exit", () => { ended = true; });
  try {
    await poll(async () => {
      if (ended) throw new Error("API exited before listening");
      return (await listenerAddresses(api)).length > 0;
    }, "API default listener");
    const addresses = await listenerAddresses(api);
    assert.equal(addresses.length, 1);
    assert.ok(["00000000", "00000000000000000000000000000000"].includes(addresses[0]));
    assert.equal((await fetch(`http://127.0.0.1:${api}/api/healthz`)).status, 200);
  } finally {
    child.kill("SIGTERM");
    await poll(() => ended, "default API stopped");
  }
  assert.equal(await portAvailable(api), true);
});

test("short server settings reach only the web child, health is checked, and output never contains the token", options, async () => {
  const { api, web, env } = await ports();
  const token = "synthetic-process-client-token";
  let probes = 0;
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/health");
    assert.equal(request.headers.authorization, undefined);
    probes += 1;
    response.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const runner = run({ ...env, OPENWORK_SERVER_URL: url, OPENWORK_SERVER_TOKEN: token, DEBUG: "vite:config" });
  try {
    await runner.ready();
    const { stdout } = await exec("ps", ["-eo", "pid=,ppid="]);
    const children = stdout.split("\n").map(line => line.trim().split(/\s+/).map(Number))
      .filter(([, parent]) => parent === runner.child.pid).map(([pid]) => pid);
    assert.equal(children.length, 2);
    let webFound = false;
    let apiFound = false;
    for (const pid of children) {
      const entries = (await readFile(`/proc/${pid}/environ`, "utf8")).split("\0");
      if (entries.includes(`PORT=${web}`)) {
        webFound = true;
        assert.ok(entries.includes(`VITE_OPENWORK_URL=${url}/`));
        assert.ok(entries.includes(`VITE_OPENWORK_TOKEN=${token}`));
        assert.ok(entries.includes("VITE_OPENWORK_FORCE_ENV_SETTINGS=1"));
      } else {
        apiFound = true;
        assert.ok(entries.includes(`PORT=${api}`));
        assert.equal(entries.some(entry => /^(OPENWORK_SERVER_|VITE_OPENWORK_(URL|TOKEN|FORCE_ENV_SETTINGS)=)/.test(entry)), false);
        assert.equal(entries.some(entry => entry.includes(token)), false);
      }
    }
    assert.ok(webFound && apiFound);
    assert.equal(probes, 1);
    assert.ok(runner.output().includes(`Connected to your local OpenWork server at ${url}/`));
    assert.equal(runner.output().includes(token), false);
  } finally {
    await runner.stop();
    await new Promise(resolve => server.close(resolve));
  }
  assert.equal(runner.output().includes(token), false);
  await assertReleased(api, web);
});

test("unavailable OpenWork server warns but the local runner still becomes ready", options, async () => {
  const { api, web, env } = await ports();
  const unavailable = await unusedPort([api, web]);
  const token = "synthetic-unavailable-server-token";
  const runner = run({ ...env, OPENWORK_SERVER_URL: `http://127.0.0.1:${unavailable}`, OPENWORK_SERVER_TOKEN: token });
  try {
    await runner.ready();
    assert.match(runner.output(), /Warning: OpenWork server health did not answer.*Continuing/);
    assert.equal(runner.output().includes(token), false);
  } finally { await runner.stop(); }
  await assertReleased(api, web);
});