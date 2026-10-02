import { expect, test, type Page } from "@playwright/test";
import { optimizedImportResolver } from "./optimized-imports";

declare global {
  interface Window {
    __orchestratorDiscussionStorageWrites: string[];
    __orchestratorDiscussionSent: number;
  }
}

type Diagnostics = {
  errors: string[];
  dataRequests: string[];
};

const diagnostics = new WeakMap<Page, Diagnostics>();
const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:80";
const pageModule = "/src/react-app/domains/orchestrator/orchestrator-page.tsx";
let componentDocument = "";

test.beforeAll(async () => {
  const resolveImport = await optimizedImportResolver(origin, [pageModule, "/src/index.react.tsx"]);

  componentDocument = `<!doctype html>
<html data-theme="light">
<head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
const React = (await import('/node_modules/.vite/deps/react.js')).default;
const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const { QueryClient, QueryClientProvider } = await import('/node_modules/.vite/deps/@tanstack_react-query.js');
const { BrowserRouter, useLocation, useNavigate } = await import('/node_modules/.vite/deps/react-router.js');
const { OrchestratorPage } = await import('/src/react-app/domains/orchestrator/orchestrator-page.tsx');
const { SessionEmptyHero } = await import('/src/react-app/domains/session/chat/session-empty-hero.tsx');
const { openOrchestratorDiscussion } = await import('/src/react-app/domains/orchestrator/orchestrator-discussion-bridge.ts');
const { newSessionDraftOwnerKey, newSessionDraftSlot } = await import('/src/react-app/domains/session/chat/new-session-destination.ts');
const { WorkspaceProvider } = await import('/src/react-app/shell/workspace-provider.ts');
const { Toaster } = await import('/src/components/ui/sonner.tsx');
await import('/src/app/index.css');
const h = React.createElement;

function PreviewHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const emptyWorkspaces = query.get('fixture') === 'no-workspaces';
  const workspaces = emptyWorkspaces ? [] : [
    { id: 'origin-workspace', label: 'Origin workspace' },
    { id: 'current-workspace', label: 'Current workspace' },
  ];
  const workspaceMatch = location.pathname.match(/^\\/workspace\\/([^/]+)\\/session$/);
  const currentWorkspaceId = workspaceMatch ? decodeURIComponent(workspaceMatch[1]) : 'current-workspace';
  const destination = { workspaceId: currentWorkspaceId };
  const ownerKey = newSessionDraftOwnerKey('discussion-test', destination);

  if (location.pathname === '/orchestrator') {
    return h(OrchestratorPage, {
      discussion: {
        workspaces,
        currentWorkspaceId: query.get('fixture') === 'no-current' ? null : 'current-workspace',
        openDraft: (workspaceId, draft) => openOrchestratorDiscussion(
          'discussion-test',
          workspaceId,
          draft,
          navigate,
        ),
      },
    });
  }

  return h(SessionEmptyHero, {
    providerCount: 1,
    onRunTask: () => { window.__orchestratorDiscussionSent += 1; },
    composer: {
      client: null,
      workspaceId: currentWorkspaceId,
      destination,
      draftSessionId: newSessionDraftSlot(destination),
      draftOwnerKey: ownerKey,
      draftScope: 'discussion-test',
      workspaceOptions: workspaces,
      onChangeDestination: () => {},
      selectedModel: { providerID: '', modelID: '' },
      modelPickerOpen: false,
      onModelPickerOpenChange: () => {},
      onModelChange: () => {},
      modelVariantLabel: '',
      modelVariant: null,
      onModelVariantChange: () => {},
      agentLabel: 'Agent',
      selectedAgent: null,
      listAgents: async () => [],
      onSelectAgent: () => {},
      listCommands: async () => [],
      searchFiles: async () => [],
      isRemoteWorkspace: false,
      isSandboxWorkspace: false,
    },
  });
}

window.__orchestratorDiscussionSent = 0;
createRoot(document.getElementById('root')).render(
  h(QueryClientProvider, { client: new QueryClient() },
    h(WorkspaceProvider, { client: null, workspaceId: '', selectedWorkspaceRoot: '' },
      h(BrowserRouter, null, h(React.Fragment, null, h(PreviewHarness), h(Toaster)))))
);
</script></body></html>`.replace(
    /\/node_modules\/\.vite\/deps\/[^'"]+\.js/g,
    resolveImport,
  );
});

test.beforeEach(async ({ page }) => {
  const seen: Diagnostics = { errors: [], dataRequests: [] };
  diagnostics.set(page, seen);
  page.on("pageerror", (error) => seen.errors.push(error.message));
  page.on("request", (request) => {
    if (request.resourceType() === "fetch" || request.resourceType() === "xhr") {
      seen.dataRequests.push(request.url());
    }
  });
  await page.addInitScript(() => {
    window.__orchestratorDiscussionStorageWrites = [];
    window.__orchestratorDiscussionSent = 0;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage) window.__orchestratorDiscussionStorageWrites.push(key);
      originalSetItem.call(this, key, value);
    };
  });

  // The route contains only a test harness. It renders the real Orchestrator
  // and session-empty composer components, without weakening app auth.
  await page.route((url) => (
    url.origin === new URL(origin).origin
      && (url.pathname === "/orchestrator" || /^\/workspace\/[^/]+\/session$/.test(url.pathname))
  ), async (route) => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    await route.fulfill({ status: 200, contentType: "text/html", body: componentDocument });
  });

  // Real hero/composer hooks are used; replace only external auth, platform,
  // desktop-policy and Connect inventory boundaries with deterministic values.
  const moduleStubs: Array<{ suffix: string; replacements: Array<[RegExp, string]> }> = [
    {
      suffix: "/src/react-app/domains/cloud/desktop-config-provider.tsx",
      replacements: [
        [/export function useDesktopConfig\(\)\s*\{[\s\S]*?return context;\s*\}/, "export function useDesktopConfig() { return { config: {}, loading: false, freshConfigStatus: 'ready', refresh: async () => {}, refreshFresh: async () => ({}), checkRestriction: () => false, connectPolicySync: { state: 'idle' } }; }"],
        [/export function useOrgRestrictions\(\)\s*\{[\s\S]*?\n\}/, "export function useOrgRestrictions() { return {}; }"],
        [/export function useCheckDesktopRestriction\(\)\s*\{[\s\S]*?\n\}/, "export function useCheckDesktopRestriction() { return () => false; }"],
      ],
    },
    {
      suffix: "/src/react-app/domains/cloud/den-auth-provider.tsx",
      replacements: [
        [/export function useDenAuth\(\)\s*\{[\s\S]*?\n\}/, "export function useDenAuth() { return { isSignedIn: false }; }"],
      ],
    },
    {
      suffix: "/src/react-app/kernel/platform.tsx",
      replacements: [
        [/export function usePlatform\(\)\s*\{[\s\S]*?\n\}/, "export function usePlatform() { return { platform: 'web', capabilities: {}, openLink() {}, restart: async () => {}, notify: async () => {} }; }"],
      ],
    },
    {
      suffix: "/src/react-app/kernel/local-provider.tsx",
      replacements: [
        [/export function useLocal\(\)\s*\{[\s\S]*?\n\}/, "export function useLocal() { return { ui: { view: 'work', tab: 'general' }, setUi() {}, prefs: { showThinking: true, modelVariant: null, defaultModel: null, selectedAgent: null, releaseChannel: 'stable', featureFlags: { microsandboxCreateSandbox: false, workspaceRunMode: false }, hasCompletedOnboarding: true, analyticsEnabled: false, desktopNotifications: 'off', linkOpenDestination: 'openwork', askBeforeOpeningLinks: false }, setPrefs() {}, ready: true }; }"],
      ],
    },
    {
      suffix: "/src/react-app/domains/connections/use-org-mcp-connections.ts",
      replacements: [
        [/export function useOrgMcpConnections\(\)\s*\{[\s\S]*?\n\}/, "export function useOrgMcpConnections() { return { connections: [], loading: false, loaded: true, error: null, connectingId: null, disconnectingId: null, refresh: async () => {}, connect: async () => {}, disconnect: async () => {} }; }"],
      ],
    },
  ];
  for (const stub of moduleStubs) {
    await page.route((url) => url.origin === new URL(origin).origin && url.pathname.endsWith(stub.suffix), async (route) => {
      const response = await route.fetch();
      let source = await response.text();
      for (const [pattern, replacement] of stub.replacements) {
        const nextSource = source.replace(pattern, replacement);
        if (nextSource === source) throw new Error(`Could not apply isolated dependency boundary for ${stub.suffix}`);
        source = nextSource;
      }
      await route.fulfill({ response, body: source });
    });
  }
  await page.route((url) => (
    url.origin === new URL(origin).origin
      && url.pathname.endsWith("/src/react-app/domains/orchestrator/orchestrator-preview.ts")
  ), async (route) => {
    if (new URL(page.url()).searchParams.get("fixture") !== "orchestrator-origin") return route.fallback();
    const response = await route.fetch();
    const source = await response.text();
    const fixture = `
if (new URL(window.location.href).searchParams.get("fixture") === "orchestrator-origin") {
  snapshot = {
    ...snapshot,
    needOrigins: { ...snapshot.needOrigins, outsideQuestion: { kind: "orchestrator" } },
  };
}`;
    await route.fulfill({ response, body: `${source}\n${fixture}\n` });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const seen = diagnostics.get(page);
  if (!seen) return;
  await testInfo.attach("orchestrator-discussion-diagnostics.json", {
    body: Buffer.from(JSON.stringify(seen, null, 2)),
    contentType: "application/json",
  });
  expect(seen.errors, "The isolated Orchestrator/composer must not throw browser errors").toEqual([]);
  expect(seen.dataRequests, "Discussion samples and draft handoff must not make data requests").toEqual([]);
  expect(await page.evaluate(() => window.__orchestratorDiscussionSent), "Discuss must never send").toBe(0);
  expect(await page.evaluate(() => window.__orchestratorDiscussionStorageWrites), "Sample handoff must not write storage").toEqual([]);
});

async function openNeedsYou(page: Page, query = "") {
  await page.goto(`${origin}/orchestrator${query}`);
  await expect(page.getByRole("heading", { name: "Orchestrator", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs you", level: 2 })).toBeVisible();
}

async function openComposerFor(page: Page, item = "Sender approval") {
  await page.getByRole("button", { name: `More actions for ${item}` }).click();
  await page.getByRole("menuitem", { name: "Discuss in chat", exact: true }).click();
  await expect(page.locator("[data-chat-empty-hero]")).toBeVisible();
  await expect(page.locator('[contenteditable="true"]')).toBeVisible();
}

async function expectDraftStorageUntouched(page: Page) {
  const keys = await page.evaluate(() => window.__orchestratorDiscussionStorageWrites);
  expect(keys.filter((key) => key === "openwork.session-drafts.v1" || key === "openwork.session-drafts.v2")).toEqual([]);
}

test("shows the three origin cases and links only the local chat using its workspace session address", async ({
  page,
}, testInfo) => {
  await openNeedsYou(page);
  await expect(page.getByText("Started from a chat", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Started by an outside tool", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open chat", exact: true })).toHaveAttribute(
    "href",
    "/workspace/origin-workspace/session/orchestrator-sample-sender-chat",
  );
  const outsideOrigin = page.getByText("Started by an outside tool", { exact: true }).locator("..");
  await expect(outsideOrigin.getByRole("link", { name: "Open chat" })).toHaveCount(0);
  const unavailableOrigin = page.getByText("Started from a chat", { exact: true }).nth(1).locator("..");
  await expect(unavailableOrigin.getByRole("link", { name: "Open chat" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("orchestrator-needs-you-origins.png"), fullPage: true });

  await openNeedsYou(page, "?fixture=orchestrator-origin");
  await expect(page.getByText("Started by an outside tool", { exact: true })).toHaveCount(0);
});

test("Discuss in chat opens the real new-task composer in the originating workspace without sending or persisting", async ({
  page,
}, testInfo) => {
  await openNeedsYou(page);
  expect(await page.evaluate(() => window.__orchestratorDiscussionStorageWrites)).toEqual([]);
  await openComposerFor(page);
  const editor = page.locator('[contenteditable="true"]');
  await expect(page).toHaveURL(/\/workspace\/origin-workspace\/session$/);
  await expect(editor).toContainText("Sender needs your input to approve sending a reply to 1 recipient.");
  await expect(editor).toContainText("Sender approval is waiting for approval.");
  await expect(editor).toContainText("Help me decide what to do.");
  await expect(editor).toContainText("You cannot change anything in the Orchestrator.");
  await expect(editor).not.toContainText("http");
  await expect(page.getByRole("button", { name: "Run task", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Workspace destination" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Origin workspace" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Current workspace" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__orchestratorDiscussionSent)).toBe(0);
  await expectDraftStorageUntouched(page);
  // openNewSessionDraft uses the existing persisted workbench-focus helper;
  // the discussion bridge itself must not write the new-task draft store.
  expect(await page.evaluate(() => window.__orchestratorDiscussionStorageWrites)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("orchestrator-discussion-normal-draft.png"), fullPage: true });
});

test("unavailable chat origin uses the current workspace and outside-tool item uses the first when none is current", async ({
  page,
}) => {
  await openNeedsYou(page);
  await openComposerFor(page, "Drafter question");
  await expect(page).toHaveURL(/\/workspace\/current-workspace\/session$/);
  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toContainText("Drafter needs your input to choose a sender address.");
  await expect(editor).not.toContainText("http");
  await expect(editor).toContainText("You cannot change anything in the Orchestrator.");

  await openNeedsYou(page, "?fixture=no-current");
  await openComposerFor(page, "Research question");
  await expect(page).toHaveURL(/\/workspace\/origin-workspace\/session$/);
});

test("locked Discuss draft contains only the item title and state", async ({
  page,
}, testInfo) => {
  await openNeedsYou(page, "?state=locked");
  expect(await page.evaluate(() => window.__orchestratorDiscussionStorageWrites)).toEqual([]);
  await openComposerFor(page);
  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toContainText("Sender approval is waiting for approval.");
  await expect(editor).toHaveText("Sender approval is waiting for approval.");
  await expect(editor).not.toContainText("http");
  await expect(editor).not.toContainText("Sender needs your input");
  await expect(editor).not.toContainText("recipient");
  await expect(editor).not.toContainText("drafted reply");
  await expect(editor).not.toContainText("cannot be unsent");
  await expectDraftStorageUntouched(page);
  expect(await page.evaluate(() => window.__orchestratorDiscussionStorageWrites)).toEqual([]);
  expect(await page.evaluate(() => window.__orchestratorDiscussionSent)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("orchestrator-discussion-locked-draft.png"), fullPage: true });
});

test("keeps Discuss visible and explains why it is unavailable when no workspace exists", async ({ page }) => {
  await openNeedsYou(page, "?fixture=no-workspaces");
  const moreButtons = page.getByRole("button", { name: /^More actions for / });
  await expect(moreButtons).toHaveCount(3);
  for (const button of await moreButtons.all()) {
    await button.click();
    const label = await button.getAttribute("aria-label");
    if (!label) throw new Error("More menu has no accessible label");
    const menu = page.getByRole("menu", { name: label, exact: true });
    await expect(menu.getByRole("menuitem", { name: /Discuss in chat/ })).toBeDisabled();
    await expect(menu.getByText("No workspace is available.", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }
});