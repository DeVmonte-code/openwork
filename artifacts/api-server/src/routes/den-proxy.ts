import { createProxyMiddleware } from "http-proxy-middleware";
import type { RequestHandler } from "express";

export const HOSTED_DEN_API = "https://api.app.openworklabs.com";

// A fixed upstream, never a URL supplied by the browser. Den still validates
// every token, organization, and one-time handoff grant itself.
export function createDenProxy(target = HOSTED_DEN_API): RequestHandler {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (path) => path || "/",
    proxyTimeout: 30_000,
    timeout: 35_000,
    cookieDomainRewrite: "",
    on: {
      proxyReq(proxyReq) {
        // This is a server-to-server hop, not a cross-origin browser request.
        proxyReq.removeHeader("origin");
        proxyReq.removeHeader("referer");
      },
      error(_error, req, res) {
        if ("log" in req) {
          (req as import("express").Request).log.warn("OpenWork upstream request failed");
        }
        if ("writeHead" in res && !res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "openwork_upstream_unavailable" }));
        }
      },
    },
  });
}