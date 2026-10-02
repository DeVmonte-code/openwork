import { expect, test, type Page } from "@playwright/test";
import { isolatedOrchestratorDocument, mountIsolatedOrchestrator } from "./isolated-orchestrator";

let document: string;
const guards = new WeakMap<Page, () => void>();
test.beforeAll(async () => { document = await isolatedOrchestratorDocument(); });
test.beforeEach(async ({ page }) => {
  guards.set(page, await mountIsolatedOrchestrator(page, document));
  await page.goto("/orchestrator");
  await expect(page.getByTestId("button-new-agent")).toBeVisible();
});
test.afterEach(({ page }) => { guards.get(page)?.(); });

async function openBuilder(page: Page) {
  await page.getByTestId("button-new-agent").click();
  await expect(page.locator("[data-agent-builder]")).toBeVisible();
}
async function validBasics(page: Page) {
  await page.locator("#ab-name").fill("Support assistant");
  await page.locator("#ab-instructions").fill("Check the handbook and draft an answer.");
  await page.locator("#ab-cost").fill("2");
}
async function choose(page: Page, id: string, label: string) {
  await page.locator(`#${id}`).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}
async function addRequest(page: Page, name = "Answer a question", example = "Where is the handbook?") {
  await page.locator("#ab-request-name").fill(name);
  await page.locator("#ab-request-description").fill("Draft a handbook answer.");
  await page.getByRole("button", { name: "Add example", exact: true }).click();
  await page.locator("#ab-request-example-0").fill(example);
  await page.getByTestId("button-add-request").click();
}
const preview = (page: Page) => page.getByRole("tab", { name: "Preview", exact: true });
const configure = (page: Page) => page.getByRole("tab", { name: "Configure", exact: true });
// Base UI's id belongs to the hidden native input; act on its visible switch.
const toggle = (page: Page, id: string) => page.locator(`label[for="${id}"]`).locator("..").getByRole("switch");

test("draft edits appear on Preview, survive tabs and stop at a simulated approval", async ({ page }, info) => {
  await openBuilder(page);
  await expect(page.locator("#ab-cost")).toHaveValue("");
  await validBasics(page);
  await page.locator("#ab-description").fill("Answers questions about our handbook.");
  await choose(page, "ab-role", "Reviewer");
  await choose(page, "ab-reports-to", "Operations coordinator");
  await choose(page, "ab-visibility", "Members' chats");
  await choose(page, "ab-skill-pick", "Triage requests (1.2)");
  await page.getByTestId("button-attach-skill").click();
  await expect(page.getByText("Pinned to version 1.2", { exact: true })).toBeVisible();
  await addRequest(page);
  await toggle(page, "ab-capability-inbox").click();
  await toggle(page, "ab-capability-knowledge").click();
  await toggle(page, "ab-capability-draft").click();
  await toggle(page, "ab-capability-reply").click();
  await toggle(page, "ab-memory-handbook").click();
  await toggle(page, "ab-approver-alex").click();
  await configure(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("builder-configure-desktop.png"), fullPage: true });
  await preview(page).click();
  const listing = page.getByTestId("draft-listing");
  for (const text of ["Support assistant", "Answers questions about our handbook.", "Reviewer", "Operations coordinator", "Answer a question", "Where is the handbook?", "Members' chats"]) {
    await expect(listing).toContainText(text);
  }
  await expect(page.getByTestId("error-summary")).toHaveCount(0);
  await expect(page.getByText("No model was called and nothing was saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Where is the handbook?", exact: true }).click();
  const simulation = page.getByTestId("simulation-result");
  await expect(simulation).toContainText("Triage requests");
  await expect(simulation).toContainText("Read the inbox");
  await expect(simulation).toContainText("Send a reply");
  await expect(simulation).toContainText(/approval/i);
  const firstSimulation = await simulation.innerText();
  await configure(page).click();
  await expect(page.locator("#ab-name")).toHaveValue("Support assistant");
  await expect(page.locator("#ab-cost")).toHaveValue("2");
  await expect(toggle(page, "ab-skill-triage")).toBeChecked();
  await preview(page).click();
  await expect.poll(() => simulation.innerText()).toBe(firstSimulation);
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeDisabled();
  await expect(page.locator("#ab-activate-reason")).toHaveText("The Orchestrator service is not connected in this preview.");
  await page.screenshot({ path: info.outputPath("builder-preview-desktop.png"), fullPage: true });
});

test("tabs support arrows, Home and End with visible focus and linked panels", async ({ page }) => {
  await openBuilder(page);
  await page.locator("#ab-name").fill("Keyboard draft");
  await configure(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(preview(page)).toBeFocused();
  await expect(preview(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Preview" })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(configure(page)).toBeFocused();
  await expect(configure(page)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(preview(page)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(configure(page)).toBeFocused();
  await expect(page.locator("#ab-name")).toHaveValue("Keyboard draft");
  expect(await configure(page).evaluate(element => {
    const style = getComputedStyle(element);
    return style.boxShadow !== "none" || style.outlineStyle !== "none";
  })).toBe(true);
});

test("checks distinguish blocking errors from a nonblocking manager warning and link fields", async ({ page }) => {
  await openBuilder(page);
  await preview(page).click();
  await expect(page.getByTestId("error-summary")).toContainText("Type a name in Basics");
  await expect(page.getByText("Warnings", { exact: true })).toBeVisible();
  await configure(page).click();
  for (const [id, error] of [["ab-name", "name"], ["ab-instructions", "instructions"], ["ab-cost", "dailyCostLimit"]]) {
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-describedby", new RegExp(`ab-err-${error}`));
  }
  await validBasics(page);
  await preview(page).click();
  await expect(page.getByTestId("error-summary")).toHaveCount(0);
  await expect(page.locator("[data-agent-builder-preview]").getByText("This agent reports to no one.", { exact: false })).toBeVisible();
  await expect(page.getByText("Warnings", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeDisabled();
});

test("duplicate skills and requests are refused and limits stay visible", async ({ page }) => {
  await openBuilder(page);
  await choose(page, "ab-skill-pick", "Triage requests (1.2)");
  await page.getByTestId("button-attach-skill").click();
  await page.getByTestId("button-attach-skill").click();
  await expect(page.locator("#ab-skill-refusal")).toHaveText("That skill is already attached. Choose a different skill.");
  await expect(page.locator("#ab-skill-triage")).toHaveCount(1);
  await toggle(page, "ab-skill-triage").click();
  await expect(toggle(page, "ab-skill-triage")).not.toBeChecked();
  await page.getByRole("button", { name: "Remove skill: Triage requests", exact: true }).click();
  await expect(page.locator("#ab-skill-triage")).toHaveCount(0);
  await addRequest(page);
  await page.locator("#ab-request-name").fill(" ANSWER A QUESTION ");
  await page.locator("#ab-request-description").fill("Duplicate.");
  await page.getByTestId("button-add-request").click();
  await expect(page.locator("#ab-request-refusal")).toContainText("Rename or remove one.");
  await expect(page.getByRole("button", { name: "Remove request: Answer a question", exact: true })).toHaveCount(1);
  for (let index = 2; index <= 5; index += 1) await addRequest(page, `Request ${index}`, `Example ${index}`);
  await page.locator("#ab-request-name").fill("Sixth request");
  await page.locator("#ab-request-description").fill("Too many.");
  await page.getByTestId("button-add-request").click();
  await expect(page.locator("#ab-request-refusal")).toContainText("Remove a request first.");
  await page.getByRole("button", { name: "Remove request: Request 5", exact: true }).click();
  for (let index = 0; index < 5; index += 1) await page.getByRole("button", { name: "Add example", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add example", exact: true })).toBeDisabled();
  await page.getByTestId("button-add-request").click();
  await expect(page.locator("#ab-request-refusal")).toContainText("Type the example or remove it.");
});

test("visibility, unique slug, outsider risk and approver checks react to edits", async ({ page }) => {
  await openBuilder(page);
  await validBasics(page);
  await page.locator("#ab-name").fill("Sender");
  await choose(page, "ab-visibility", "Whole organization");
  await toggle(page, "ab-capability-reply").click();
  await toggle(page, "ab-outsiders").click();
  await preview(page).click();
  const summary = page.getByTestId("error-summary");
  await expect(summary).toContainText("Choose a different name");
  await expect(summary).toContainText("Add a one-line description");
  await expect(summary).toContainText("Add a request it handles");
  await expect(summary).toContainText("Turn off outsider content");
  await expect(summary).toContainText("Choose at least one approver");
  await configure(page).click();
  await expect(toggle(page, "ab-capability-reply")).toHaveAttribute("aria-invalid", "true");
  await expect(toggle(page, "ab-approver-alex")).toHaveAttribute("aria-describedby", "ab-err-approverIds");
  await page.locator("#ab-name").fill("Support assistant");
  await page.locator("#ab-description").fill("Answers questions.");
  await addRequest(page);
  await toggle(page, "ab-outsiders").click();
  await toggle(page, "ab-approver-alex").click();
  await preview(page).click();
  await expect(summary).toHaveCount(0);
});

test("leaving discards the draft without changing agents or hierarchy", async ({ page }) => {
  const initial = await page.locator("#sample-state").textContent();
  const rows = page.locator('section[aria-labelledby="orch-agents"] > ul > li');
  await expect(rows).toHaveCount(7);
  await openBuilder(page);
  await validBasics(page);
  await choose(page, "ab-reports-to", "Reviewer");
  await preview(page).click();
  await expect(page.getByTestId("draft-listing")).toContainText("Reviewer");
  expect(await page.locator("#sample-state").textContent()).toBe(initial);
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect(rows).toHaveCount(7);
  expect(await page.locator("#sample-state").textContent()).toBe(initial);
  await openBuilder(page);
  await expect(page.locator("#ab-name")).toHaveValue("");
  await expect(page.locator("#ab-cost")).toHaveValue("");
  await page.locator("#ab-name").fill("Discard on navigation");
  await page.getByRole("navigation", { name: "Orchestrator views" }).getByRole("button", { name: "Hierarchy", exact: true }).click();
  await expect(page.locator("[data-agent-builder]")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Tree", exact: true })).toBeVisible();
  expect(await page.locator("#sample-state").textContent()).toBe(initial);
  await page.getByRole("navigation", { name: "Orchestrator views" }).getByRole("button", { name: "Agents", exact: true }).click();
  await expect(rows).toHaveCount(7);
  await openBuilder(page);
  await expect(page.locator("#ab-name")).toHaveValue("");
});

test("phone layout keeps Configure and Preview as full tabs and respects reduced motion", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openBuilder(page);
  await validBasics(page);
  await addRequest(page);
  await expect(page.locator("[data-agent-builder-configure]")).toBeVisible();
  await expect(page.locator("[data-agent-builder-preview]")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await preview(page).click();
  await expect(page.locator("[data-agent-builder-configure]")).toBeHidden();
  await expect(page.locator("[data-agent-builder-preview]")).toBeVisible();
  expect(await preview(page).evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  await page.getByRole("button", { name: "Where is the handbook?", exact: true }).click();
  await expect(page.getByTestId("simulation-result")).toBeVisible();
  await page.screenshot({ path: info.outputPath("builder-preview-phone.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("locked preview keeps New agent visible with a lock and reason", async ({ page }) => {
  await page.goto("/orchestrator?state=locked");
  await expect(page.getByTestId("button-new-agent")).toBeVisible();
  await expect(page.getByTestId("button-new-agent")).toBeDisabled();
  await expect(page.getByTestId("button-new-agent").locator("svg")).toHaveCount(1);
  await expect(page.getByText("Locked: ask an owner to add agents", { exact: true })).toBeVisible();
});

test("delete records is refused by sample policy in Preview and Configure and clears when removed", async ({ page }) => {
  await openBuilder(page);
  await validBasics(page);
  await toggle(page, "ab-capability-delete").click();
  await preview(page).click();
  const message = "Delete records cannot be undone, and irreversible actions are turned off for this organization. Remove it or ask an owner to allow them.";
  await expect(page.getByTestId("error-summary")).toContainText(message);
  await configure(page).click();
  await expect(page.locator("#ab-err-capabilityIds")).toContainText(message);
  await expect(toggle(page, "ab-capability-delete")).toHaveAttribute("aria-invalid", "true");
  await expect(toggle(page, "ab-capability-delete")).toHaveAttribute("aria-describedby", "ab-err-capabilityIds");
  await toggle(page, "ab-capability-delete").click();
  await expect(page.locator("#ab-err-capabilityIds")).toHaveCount(0);
  await expect(toggle(page, "ab-capability-delete")).not.toHaveAttribute("aria-invalid", "true");
  await preview(page).click();
  await expect(page.getByTestId("error-summary")).toHaveCount(0);
});