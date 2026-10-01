import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import express from "express";
import { createDenProxy } from "../src/routes/den-proxy.ts";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
}

test("Den proxy preserves authenticated request bytes, status, and cookie scope", async () => {
  const body = '{ "grant" : "test-only-invalid-grant" }';
  const upstream = createServer(async (req, res) => {
    assert.equal(req.url, "/v1/auth/desktop-handoff/exchange?source=test");
    assert.equal(req.method, "POST");
    assert.equal(req.headers.authorization, "Bearer test-only-token");
    assert.equal(req.headers["x-openwork-org-id"], "test-org");
    assert.equal(req.headers.origin, undefined);
    assert.equal(req.headers.referer, undefined);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), body);
    res.writeHead(401, {
      "Content-Type": "application/json",
      "Set-Cookie": "session=test; Domain=example.com; Path=/; HttpOnly; Secure",
    });
    res.end('{"error":"invalid_grant"}');
  });
  const upstreamUrl = await listen(upstream);
  const app = express();
  app.use("/api/den", createDenProxy(upstreamUrl));
  // The proxy must precede any JSON parser.
  app.use(express.json());
  const proxy = createServer(app);
  const proxyUrl = await listen(proxy);
  try {
    const response = await fetch(`${proxyUrl}/api/den/v1/auth/desktop-handoff/exchange?source=test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-only-token",
        "x-openwork-org-id": "test-org",
        Origin: "https://unapproved-preview.example",
        Referer: "https://unapproved-preview.example/signin",
      },
      body,
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_grant" });
    assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /Domain=/i);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("Den proxy forwards streamed responses without buffering", async () => {
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: first\n\n");
    setTimeout(() => res.end("data: second\n\n"), 10);
  });
  const upstreamUrl = await listen(upstream);
  const app = express();
  app.use("/api/den", createDenProxy(upstreamUrl));
  const proxy = createServer(app);
  const proxyUrl = await listen(proxy);
  try {
    const response = await fetch(`${proxyUrl}/api/den/v1/events`);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(await response.text(), "data: first\n\ndata: second\n\n");
  } finally {
    await close(proxy);
    await close(upstream);
  }
});