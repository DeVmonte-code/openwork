import { expect, type Page } from "@playwright/test";
import { optimizedImportResolver } from "./optimized-imports";

export const isolatedOrigin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:80";

export async function isolatedOrchestratorDocument(): Promise<string> {
  const resolve = await optimizedImportResolver(isolatedOrigin, [
    "/src/react-app/domains/orchestrator/orchestrator-page.tsx", "/src/index.react.tsx",
  ]);
  return `<!doctype html><html data-theme="light">
<head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="root"></div><output id="sample-state" hidden></output><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
const React = (await import('/node_modules/.vite/deps/react.js')).default;
const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const { BrowserRouter } = await import('/node_modules/.vite/deps/react-router.js');
const { OrchestratorPage } = await import('/src/react-app/domains/orchestrator/orchestrator-page.tsx');
const { orchestratorPreview } = await import('/src/react-app/domains/orchestrator/orchestrator-preview.ts');
const { Toaster } = await import('/src/components/ui/sonner.tsx');
await import('/src/app/index.css');
const showState = () => { document.getElementById('sample-state').textContent = JSON.stringify(orchestratorPreview.getSnapshot()); };
showState();
orchestratorPreview.subscribe(showState);
const h = React.createElement;
createRoot(document.getElementById('root')).render(h(BrowserRouter, null, h(React.Fragment, null, h(OrchestratorPage), h(Toaster))));
</script></body></html>`.replace(/\/node_modules\/\.vite\/deps\/[^'"]+\.js/g, resolve);
}

export async function mountIsolatedOrchestrator(page: Page, document: string) {
  const errors: string[] = [];
  const requests: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (request.resourceType() === "fetch" || request.resourceType() === "xhr") requests.push(request.url());
  });
  page.on("console", message => {
    if (message.text().startsWith("builder-storage-write")) writes.push(message.text());
  });
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    const clear = Storage.prototype.clear;
    Storage.prototype.setItem = function(key: string, value: string) {
      console.info("builder-storage-write", key);
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function(key: string) {
      console.info("builder-storage-write", key);
      return remove.call(this, key);
    };
    Storage.prototype.clear = function() {
      console.info("builder-storage-write", "clear");
      return clear.call(this);
    };
  });
  await page.route(url => url.origin === new URL(isolatedOrigin).origin
    && ["/orchestrator", "/orchestrator/hierarchy"].includes(url.pathname), async route => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    await route.fulfill({ status: 200, contentType: "text/html", body: document });
  });
  return () => {
    expect(errors, "No errors in the isolated builder").toEqual([]);
    expect(requests, "No data requests from the sample builder").toEqual([]);
    expect(writes, "No local/session storage writes from the sample builder").toEqual([]);
  };
}