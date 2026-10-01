import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "artifacts", "openwork");
const { createServer: createVite, resolveConfig } = await import(
  pathToFileURL(path.join(web, "node_modules", "vite", "dist", "node", "index.js")).href
);

test("Vite has no API proxy unless the local address is provided", async () => {
  delete process.env.OPENWORK_LOCAL_API_URL;
  process.env.PORT = "5173";
  process.env.BASE_PATH = "/";
  const config = await resolveConfig({ configFile: path.join(web, "vite.config.ts") }, "serve");
  assert.equal(config.server.proxy, undefined);
  assert.equal(config.define["import.meta.env.VITE_DEN_REQUIRE_SIGNIN"], '"1"');
  assert.equal(config.define["import.meta.env.VITE_OPENWORK_FORCE_MANUAL_AUTH"], JSON.stringify(process.env.VITE_OPENWORK_FORCE_MANUAL_AUTH ?? "1"));
});

test("local Vite hop preserves raw bytes, encoded paths and streaming", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const received = [];
  const upstream = createServer(async (req, res) => {
    if (req.url === "/api/den/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: first\n\n");
      await gate;
      res.end("data: last\n\n");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, bytes: Buffer.concat(chunks) });
    res.end(Buffer.concat(chunks));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const cache = await mkdtemp(path.join(os.tmpdir(), "openwork-local-proxy-"));
  let vite;
  try {
    process.env.PORT = "5173";
    process.env.BASE_PATH = "/";
    process.env.OPENWORK_LOCAL_API_URL = `http://127.0.0.1:${upstream.address().port}`;
    vite = await createVite({
      configFile: path.join(web, "vite.config.ts"),
      cacheDir: cache,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    await vite.listen();
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const raw = Buffer.from([0, 255, 128, 32, 10, 123, 34, 125]);
    const address = "/api/den/echo%2Fbytes?value=x%2Fy&value=second";
    const echoed = await fetch(`${base}${address}`, {
      method: "POST", body: raw,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    assert.deepEqual(Buffer.from(await echoed.arrayBuffer()), raw);
    assert.deepEqual(received, [{ url: address, bytes: raw }]);

    const stream = await fetch(`${base}/api/den/stream`, { signal: AbortSignal.timeout(5_000) });
    const reader = stream.body.getReader();
    const first = await reader.read();
    assert.equal(Buffer.from(first.value).toString(), "data: first\n\n");
    // Release the server only after the first chunk reaches the client. A
    // buffering proxy would time out instead of getting past this assertion.
    release();
    const last = await reader.read();
    assert.equal(Buffer.from(last.value).toString(), "data: last\n\n");
    assert.equal((await reader.read()).done, true);
  } finally {
    release();
    if (vite) await vite.close();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(cache, { recursive: true, force: true });
  }
});