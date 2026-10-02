import { expect, test, type Page } from "@playwright/test";
import { optimizedImportResolver } from "./optimized-imports";

type Diagnostics = { errors: string[]; dataRequests: string[] };

const diagnostics = new WeakMap<Page, Diagnostics>();
const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:80";
const pageModule = "/src/react-app/domains/orchestrator/orchestrator-page.tsx";
let componentDocument: string;

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
const { BrowserRouter } = await import('/node_modules/.vite/deps/react-router.js');
const { OrchestratorPage } = await import('/src/react-app/domains/orchestrator/orchestrator-page.tsx');
const { Toaster } = await import('/src/components/ui/sonner.tsx');
await import('/src/app/index.css');
const h = React.createElement;
createRoot(document.getElementById('root')).render(
  h(BrowserRouter, null, h(React.Fragment, null, h(OrchestratorPage), h(Toaster)))
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
  await page.route((url) => {
    return url.origin === new URL(origin).origin
      && (url.pathname === "/orchestrator" || url.pathname === "/orchestrator/hierarchy");
  }, async (route) => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    await route.fulfill({ status: 200, contentType: "text/html", body: componentDocument });
  });

  // Page-scoped browser fixture. It adds no production reset or seed API and
  // changes only this isolated module response in the test page.
  await page.route((url) => (
    url.origin === new URL(origin).origin
      && url.pathname.endsWith("/src/react-app/domains/orchestrator/orchestrator-preview.ts")
  ), async (route) => {
    if (!new URL(page.url()).searchParams.has("fixture")) return route.fallback();
    const response = await route.fetch();
    const moduleSource = await response.text();
    const fixture = `
if (new URL(window.location.href).searchParams.get("fixture") === "draft-orphan") {
  const fixtureHierarchy = {
    ...snapshot.hierarchy,
    agents: [
      ...snapshot.hierarchy.agents,
      { id: "fixture-draft", nameKey: "orchestrator.start_worker", state: "draft" },
      { id: "fixture-orphan", nameKey: "orchestrator.start_monitor", state: "running" },
      { id: "fixture-retired", nameKey: "orchestrator.start_dispatcher", state: "retired" },
    ],
    relationships: [
      ...snapshot.hierarchy.relationships,
      { id: "fixture-draft-link", managerId: "reviewer", agentId: "fixture-draft", control: 2, reliance: 2, escalation: 4, status: "active" },
      { id: "fixture-retired-link", managerId: "coordinator", agentId: "fixture-retired", control: 4, reliance: 3, escalation: 2, status: "active" },
    ],
  };
  snapshot = { ...snapshot, hierarchy: fixtureHierarchy, agents: agentRunStates(fixtureHierarchy) };
}`;
    await route.fulfill({ response, body: `${moduleSource}\n${fixture}\n` });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const seen = diagnostics.get(page);
  if (!seen) return;
  await testInfo.attach("isolated-browser-diagnostics.json", {
    body: Buffer.from(JSON.stringify(seen, null, 2)),
    contentType: "application/json",
  });
  expect(seen.errors, "The isolated Orchestrator view must not throw browser errors").toEqual([]);
  expect(seen.dataRequests, "Hierarchy sample interactions must not make data requests").toEqual([]);
});

async function openHierarchy(page: Page) {
  await page.goto(`${origin}/orchestrator/hierarchy`);
  await expect(page.locator("[data-orchestrator-page]")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Orchestrator" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Orchestrator views" })
    .getByRole("button", { name: "Hierarchy" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("tab", { name: "Tree", exact: true })).toBeVisible();
}

function treeRow(page: Page, name: string) {
  return page.getByRole("button", { name: `Show details: ${name}`, exact: true }).locator("xpath=..");
}

function changeButton(page: Page, name: string) {
  return page.getByRole("button", { name: `Change manager: ${name}`, exact: true });
}

test("isolated component preview: tree rows, both-direction details, and query-preserving sub-navigation", async ({
  page,
}, testInfo) => {
  await openHierarchy(page);
  const tree = page.getByRole("tab", { name: "Tree", exact: true });
  await tree.click();

  for (const name of ["Operations coordinator", "Daily digest", "Intake", "Research", "Reviewer", "Drafter", "Sender"]) {
    await expect(page.getByRole("button", { name: `Show details: ${name}`, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Manages 5 of 7", { exact: true })).toBeVisible();
  expect(await treeRow(page, "Operations coordinator").boundingBox())
    .toMatchObject({ height: 44 });
  await page.screenshot({ path: testInfo.outputPath("hierarchy-tree.png"), fullPage: true });

  await page.getByRole("navigation", { name: "Orchestrator views" }).getByRole("button", { name: "Agents", exact: true }).click();
  const agentRows = page.locator('section[aria-labelledby="orch-agents"] > ul > li');
  await expect(agentRows.first()).toContainText("Operations coordinator");
  await expect(agentRows.nth(1)).toContainText("Intake");
  await page.getByRole("navigation", { name: "Orchestrator views" }).getByRole("button", { name: "Hierarchy", exact: true }).click();
  await page.getByRole("tab", { name: "Tree", exact: true }).click();

  await page.getByRole("button", { name: "Show details: Reviewer", exact: true }).click();
  const panel = page.locator("aside");
  await expect(panel.getByText("Reports to", { exact: true })).toBeVisible();
  await expect(panel).toContainText("Operations coordinator");
  await expect(panel).toContainText("Chain to the top");
  await expect(panel).toContainText("a person");
  await expect(panel.getByRole("heading", { name: "Manages", exact: true })).toBeVisible();
  await expect(panel).toContainText("Drafter");
  await expect(panel).toContainText("Control High, reliance High");
  await expect(panel).toContainText("Manages 1 of 7");

  await page.screenshot({ path: testInfo.outputPath("hierarchy-details.png"), fullPage: true });
  await page.goto(`${origin}/orchestrator/hierarchy?state=empty`);
  await expect(page.getByRole("heading", { name: "Choose a top-level agent" })).toBeVisible();
  await page.getByRole("navigation", { name: "Orchestrator views" }).getByRole("button", { name: "Agents" }).click();
  await expect(page).toHaveURL(/\/orchestrator\?state=empty$/);
  await page.getByRole("navigation", { name: "Orchestrator views" }).getByRole("button", { name: "Hierarchy" }).click();
  await expect(page).toHaveURL(/\/orchestrator\/hierarchy\?state=empty$/);
  await expect(page.getByRole("heading", { name: "Choose a top-level agent" })).toBeVisible();
});

test("isolated component preview: linked drafts keep their manager, do not count toward spans, and orphans remain visible", async ({
  page,
}, testInfo) => {
  await page.goto(`${origin}/orchestrator/hierarchy?fixture=draft-orphan`);
  await expect(page.locator("[data-orchestrator-page]")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Orchestrator" })).toBeVisible();
  await page.getByRole("tab", { name: "Tree", exact: true }).click();

  const draft = page.getByRole("button", { name: "Show details: Worker", exact: true }).locator("xpath=..");
  await expect(draft).toBeVisible();
  await expect(draft).toContainText("Draft");
  const reviewer = page.getByRole("button", { name: "Show details: Reviewer", exact: true }).locator("xpath=..");
  await expect(reviewer).toContainText("Manages 1 of 7");
  const draftButton = page.getByRole("button", { name: "Show details: Worker", exact: true });
  const reviewerButton = page.getByRole("button", { name: "Show details: Reviewer", exact: true });
  await expect(page.getByRole("button", { name: "Show details: Dispatcher", exact: true }).locator("xpath=.."))
    .toContainText("Retired");
  const draftPosition = await draftButton.boundingBox();
  const reviewerPosition = await reviewerButton.boundingBox();
  expect(draftPosition).not.toBeNull();
  expect(reviewerPosition).not.toBeNull();
  if (!draftPosition || !reviewerPosition) {
    throw new Error("Expected the draft agent and Reviewer to be visible in the tree.");
  }
  expect(draftPosition.x).toBeGreaterThan(reviewerPosition.x + 10);
  await expect(page.getByRole("heading", { name: "Without a manager" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show details: Monitor", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("hierarchy-draft-and-orphans.png"), fullPage: true });

  await page.getByRole("tab", { name: "Span of control", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Operations coordinator" }))
    .toContainText("Daily digest, Intake, Research, Reviewer, Sender");
  await expect(page.getByRole("row").filter({ hasText: "Operations coordinator" }))
    .not.toContainText("Dispatcher");
  const reviewerSpan = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Reviewer", exact: true }),
  });
  await expect(reviewerSpan.getByRole("cell").nth(2)).toHaveText("1");

  await page.getByRole("tab", { name: /^Exceptions/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "Monitor" })).toContainText("Monitor has no manager.");
  await expect(page.getByRole("row").filter({ hasText: "Worker" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Dependency", exact: true }).click();
  const orphanDependency = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Monitor", exact: true }),
  });
  await expect(orphanDependency.getByRole("cell").last()).toHaveText("Without a manager › a person");

  await page.getByRole("tab", { name: "Tree", exact: true }).click();
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  await expect(page.getByRole("button", {
    name: "Worker reports to Reviewer. Control Low, reliance Low.",
    exact: true,
  })).toBeVisible();
});

test("isolated component preview: all four live reports show direct spans, paths, and accessible matrix levels", async ({
  page,
}, testInfo) => {
  await openHierarchy(page);

  const spanTab = page.getByRole("tab", { name: "Span of control", exact: true });
  await expect(spanTab).toBeVisible();
  await spanTab.click();
  const rootSpan = page.getByRole("row").filter({ hasText: "Operations coordinator" });
  await expect(rootSpan.getByRole("cell").nth(2)).toHaveText("5");
  await expect(rootSpan.getByRole("cell").nth(3)).toHaveText("7");
  await expect(rootSpan).toContainText("Daily digest, Intake, Research, Reviewer, Sender");
  const reviewerSpan = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Reviewer", exact: true }),
  });
  await expect(reviewerSpan.getByRole("cell").nth(2)).toHaveText("1");
  await page.screenshot({ path: testInfo.outputPath("hierarchy-report-span.png"), fullPage: true });

  await page.getByRole("tab", { name: "Dependency", exact: true }).click();
  const drafter = page.getByRole("row").filter({ hasText: "Drafter" });
  await expect(drafter).toContainText("Reviewer");
  await expect(drafter).toContainText("Operations coordinator");
  await expect(drafter).toContainText("a person");
  await expect(drafter).toContainText("High");
  await page.screenshot({ path: testInfo.outputPath("hierarchy-report-dependencies.png"), fullPage: true });

  await page.getByRole("tab", { name: "Exceptions", exact: true }).click();
  await expect(page.getByText("No exceptions", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("hierarchy-report-exceptions.png"), fullPage: true });

  await page.getByRole("tab", { name: "Matrix", exact: true }).click();
  await expect(page.getByRole("cell", {
    name: "Manager Operations coordinator, agent Reviewer: control High, reliance Moderate",
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("cell", {
    name: "Manager Reviewer, agent Drafter: control High, reliance High",
    exact: true,
  })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("hierarchy-report-matrix.png"), fullPage: true });
});

test("isolated component preview: top-down diagram labels both relationship levels", async ({ page }, testInfo) => {
  await openHierarchy(page);
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  await expect(page.getByRole("group", { name: "Hierarchy diagram, top down" })).toBeVisible();
  await expect(page.getByRole("button", {
    name: /Reviewer reports to Operations coordinator\. Control High, reliance Moderate\./,
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: /Drafter reports to Reviewer\. Control High, reliance High\./,
  })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("hierarchy-diagram.png"), fullPage: true });
});

test("isolated component preview: refuses self-management and reporting loops before saving", async ({ page }, testInfo) => {
  await openHierarchy(page);

  await changeButton(page, "Operations coordinator").click();
  await expect(page.getByRole("dialog", { name: "Change manager: Operations coordinator" })).toBeVisible();
  const refusalAlert = page.getByRole("alert");
  await expect(refusalAlert).toContainText("Operations coordinator cannot report to itself.");
  await expect(refusalAlert).toHaveClass(/text-muted-foreground/);
  await expect(refusalAlert).not.toHaveClass(/text-destructive/);
  await expect(page.getByRole("button", { name: "Change manager", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("hierarchy-refusal-self.png"), fullPage: true });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await changeButton(page, "Reviewer").click();
  await page.getByRole("combobox", { name: "New manager", exact: true }).click();
  await page.getByRole("option", { name: "Drafter", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This would create a reporting loop: Reviewer → Drafter → Reviewer.",
  );
  await expect(page.getByRole("alert")).toHaveClass(/text-muted-foreground/);
  await expect(page.getByRole("alert")).not.toHaveClass(/text-destructive/);
  await expect(page.getByRole("button", { name: "Change manager", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("hierarchy-refusal-loop.png"), fullPage: true });
});

test("isolated component preview: warns on a paused-manager dependency, applies a change once, and undoes it", async ({
  page,
}, testInfo) => {
  await openHierarchy(page);

  await page.getByRole("navigation", { name: "Orchestrator views" }).getByRole("button", { name: "Agents" }).click();
  await page.getByRole("button", { name: "Pause agent: Reviewer", exact: true }).click();
  await expect(page.getByRole("list").getByText("Paused", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Orchestrator views" }).getByRole("button", { name: "Hierarchy" }).click();
  await page.getByRole("tab", { name: "Tree", exact: true }).click();

  await expect(treeRow(page, "Reviewer")).toContainText("Paused");
  await changeButton(page, "Research").click();
  const reliance = page.getByRole("combobox", { name: "How much the agent relies on its manager", exact: true });
  await expect(reliance).toContainText("Moderate");
  await page.getByRole("combobox", { name: "New manager", exact: true }).click();
  await page.getByRole("option", { name: "Reviewer", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/paused/i);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Change manager", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("hierarchy-warning.png"), fullPage: true });

  await page.getByRole("dialog").getByRole("button", { name: "Change manager", exact: true }).click();
  await expect(page.getByText("Research now reports to Reviewer", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Span of control", exact: true }).click();
  const after = page.getByRole("row").filter({ hasText: "Operations coordinator" });
  await expect(after.getByRole("cell").nth(2)).toHaveText("4");
  const reviewer = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Reviewer", exact: true }),
  });
  await expect(reviewer.getByRole("cell").nth(2)).toHaveText("2");
  await page.screenshot({ path: testInfo.outputPath("hierarchy-warning-applied.png"), fullPage: true });

  await page.locator("[data-undo-toast]").filter({ hasText: "Research now reports to Reviewer" })
    .getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Research now reports to Reviewer", { exact: true })).toHaveCount(0);
  await expect(after.getByRole("cell").nth(2)).toHaveText("5");
  await expect(reviewer.getByRole("cell").nth(2)).toHaveText("1");
  await page.screenshot({ path: testInfo.outputPath("hierarchy-undo.png"), fullPage: true });
});

test("isolated component preview: loading, empty and locked states retain labeled controls", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const nativeTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      return nativeTimeout(callback, delay === 450 ? 2500 : delay, ...args);
    };
  });
  await page.goto(`${origin}/orchestrator/hierarchy`);
  const skeleton = page.getByRole("list", { name: "Hierarchy is loading" });
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  const pulse = page.locator(".animate-pulse").first();
  if (await pulse.count()) await expect(pulse).toHaveCSS("animation-duration", "0s");
  await page.screenshot({ path: testInfo.outputPath("hierarchy-loading.png"), fullPage: true });
  await expect(page.getByRole("button", { name: "Show details: Operations coordinator", exact: true })).toBeVisible();

  await page.goto(`${origin}/orchestrator/hierarchy?state=empty`);
  await expect(page.getByRole("heading", { name: "Choose a top-level agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Change manager/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("hierarchy-empty.png"), fullPage: true });

  await page.goto(`${origin}/orchestrator/hierarchy?state=locked`);
  await expect(page.getByRole("status").getByText("Only an owner can change who manages an agent")).toBeVisible();
  const changes = page.getByRole("button", { name: /Change manager:/ });
  await expect(changes).toHaveCount(7);
  for (const change of await changes.all()) await expect(change).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("hierarchy-locked.png"), fullPage: true });
});