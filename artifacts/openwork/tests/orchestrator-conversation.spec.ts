import { expect, test, type Page } from "@playwright/test";
import { isolatedOrchestratorDocument, mountIsolatedOrchestrator } from "./isolated-orchestrator";

let document: string;
const guards = new WeakMap<Page, () => void>();
test.beforeAll(async () => { document = await isolatedOrchestratorDocument(); });
test.beforeEach(async ({ page }) => {
  guards.set(page, await mountIsolatedOrchestrator(page, document));
  await page.goto("/orchestrator");
  await expect(page.getByRole("heading", { name: "Needs you", exact: true })).toBeVisible();
});
test.afterEach(({ page }) => { guards.get(page)?.(); });

const panel = (page: Page) => page.getByRole("dialog", { name: "Ask Sender", exact: true });
const input = (page: Page) => panel(page).getByRole("textbox", { name: "Message to Sender" });
const sampleState = async (page: Page) => {
  const text = await page.locator("#sample-state").textContent();
  if (!text) throw new Error("Missing sample snapshot");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || !("approvalWaiting" in value)
    || typeof value.approvalWaiting !== "boolean" || !("agents" in value) || !("hierarchy" in value)) {
    throw new Error("Invalid sample snapshot");
  }
  return { approvalWaiting: value.approvalWaiting, agents: value.agents, hierarchy: value.hierarchy };
};
async function openSender(page: Page) {
  await page.getByRole("button", { name: "Ask Sender", exact: true }).first().click();
  await expect(panel(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
}

test("Needs-you starter shows an inline approval and approves only the same sample decision", async ({ page }, info) => {
  const before = await sampleState(page);
  await openSender(page);
  await expect(panel(page)).toContainText("Send reply to 1 recipient: waiting for your approval");
  await expect(panel(page)).toContainText("Sample conversation. No agent was contacted and nothing was saved.");
  await page.clock.install({ time: new Date("2026-10-02T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-02T12:00:01Z"));
  await panel(page).getByRole("button", { name: "What are you waiting for?", exact: true }).click();
  await expect(panel(page).getByTestId("conversation-typing")).toHaveText("Sender is typing a sample reply");
  await expect(panel(page).getByRole("status")).toHaveText("Sender is looking at the draft");
  await page.clock.runFor(300);
  await expect(panel(page).getByTestId("conversation-typing")).toHaveCount(0);
  await page.clock.resume();
  await expect(panel(page).getByRole("log")).toContainText("In this sample, I’m waiting for you to approve sending the drafted reply to 1 recipient.");
  await expect(panel(page).getByRole("log")).toHaveAttribute("aria-live", "polite");
  const card = panel(page).getByTestId("approval-card");
  await expect(card).toContainText("The drafted reply and the requester's address");
  await expect(card).toContainText("They see it right away. It cannot be unsent.");
  await page.screenshot({ path: info.outputPath("conversation-desktop.png") });
  await card.getByRole("button", { name: "Approve and send", exact: true }).click();
  await expect(page.getByTestId("approval-card")).toHaveCount(0);
  const after = await sampleState(page);
  expect(after.approvalWaiting).toBe(false);
  expect(after.agents).toEqual(before.agents);
  expect(after.hierarchy).toEqual(before.hierarchy);
  await expect(panel(page)).toContainText("This approval is no longer waiting.");
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Ask Sender", exact: true })).toBeFocused();
});

test("typed approve and other text use the fallback without resolving anything, and close discards messages", async ({ page }) => {
  const before = await sampleState(page);
  await openSender(page);
  await input(page).fill("approve");
  await input(page).press("Enter");
  await expect(input(page)).toHaveValue("");
  const fallback = "In this preview, I can answer the three starter questions. Real answers need the service connected. Typing “approve” does not approve anything; use the approval card’s buttons.";
  await expect(panel(page).getByRole("log")).toContainText(fallback);
  expect(await sampleState(page)).toEqual(before);
  await input(page).fill("Hello");
  await input(page).press("Shift+Enter");
  await input(page).press("End");
  await input(page).press("x");
  await expect(input(page)).toHaveValue("Hello\nx");
  await panel(page).getByRole("button", { name: "Send message", exact: true }).click();
  await expect(panel(page).getByRole("log").getByText(fallback, { exact: true })).toHaveCount(2);
  await expect(panel(page).getByRole("log")).not.toContainText(/used invalid|tool_call|thought|gpt-/i);
  await panel(page).getByText("Details", { exact: true }).click();
  await expect(panel(page).getByText("Sample: no tools were used.", { exact: true })).toBeVisible();
  await panel(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await openSender(page);
  await expect(panel(page).getByRole("log")).toBeEmpty();
  await expect(input(page)).toHaveValue("");
  expect(await sampleState(page)).toEqual(before);
});

test("keyboard dialog focus returns to its opener, and closing a pending reply cancels it", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Ask Sender", exact: true }).first();
  await opener.focus();
  await opener.press("Enter");
  await expect(input(page)).toBeFocused();
  expect(await input(page).evaluate(element => {
    const style = getComputedStyle(element);
    return style.boxShadow !== "none" || style.outlineStyle !== "none";
  })).toBe(true);
  await input(page).fill("approve");
  await input(page).press("Enter");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
  await openSender(page);
  await expect(panel(page).getByRole("log")).toBeEmpty();
  await expect(panel(page).getByRole("button", { name: "Send message" })).toBeDisabled();
});

test("all Needs-you and agent rows can be asked without changing agents or hierarchy", async ({ page }) => {
  await expect(page.getByRole("button", { name: /^Ask / })).toHaveCount(10);
  const before = await sampleState(page);
  for (const name of ["Drafter", "Research"]) {
    await page.getByRole("button", { name: `Ask ${name}`, exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: `Ask ${name}` });
    await dialog.getByRole("button", { name: "What are you waiting for?" }).click();
    await expect(dialog.getByRole("log")).toContainText(name === "Drafter" ? "choose a sender address" : "choose which files to include");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  const rows = page.locator('section[aria-labelledby="orch-agents"] > ul > li');
  for (const row of await rows.all()) {
    const ask = row.getByRole("button", { name: /^Ask / });
    const label = await ask.innerText();
    await ask.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
    if (label === "Ask Drafter" || label === "Ask Research") {
      await page.getByRole("dialog").getByRole("button", { name: "What are you waiting for?" }).click();
      await expect(page.getByRole("dialog").getByRole("log")).toContainText(
        label === "Ask Drafter" ? "choose a sender address" : "choose which files to include",
      );
    }
    await page.keyboard.press("Escape");
    await expect(ask).toBeFocused();
  }
  expect(await sampleState(page)).toEqual(before);
});

test("other Sender starters explain the reply and risk, and inline Decline resolves the same sample", async ({ page }) => {
  await openSender(page);
  await panel(page).getByRole("button", { name: "What will you send?" }).click();
  await expect(panel(page).getByRole("log")).toContainText("I would send the drafted reply to 1 recipient");
  await panel(page).getByRole("button", { name: "Why does this need my approval?" }).click();
  await expect(panel(page).getByRole("log")).toContainText("That is why I need your approval.");
  await panel(page).getByRole("button", { name: "What are you waiting for?" }).click();
  await panel(page).getByTestId("approval-card").getByRole("button", { name: "Decline", exact: true }).click();
  expect((await sampleState(page)).approvalWaiting).toBe(false);
  await expect(page.getByTestId("approval-card")).toHaveCount(0);
});

test("phone conversation fills the screen and keeps the composer visible", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSender(page);
  const bounds = await panel(page).boundingBox();
  if (!bounds) throw new Error("No phone panel");
  expect(Math.round(bounds.width)).toBe(390);
  expect(Math.round(bounds.height)).toBe(844);
  await expect(input(page)).toBeInViewport();
  await panel(page).getByRole("button", { name: "What are you waiting for?" }).click();
  await expect(panel(page).getByTestId("approval-card")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("conversation-phone.png") });
});

test("reduced motion removes panel and backdrop transitions while sample replies still work", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSender(page);
  for (const element of [panel(page), page.locator('[data-slot="sheet-overlay"]')]) {
    expect(await element.evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0s");
    expect(await element.evaluate(node => getComputedStyle(node).animationName)).toBe("none");
  }
  await panel(page).getByRole("button", { name: "What will you send?" }).click();
  await expect(panel(page).getByRole("log")).toContainText("In this sample");
});

test("limited conversation shows title and state only and offers no approval capability", async ({ page }) => {
  await page.goto("/orchestrator?state=locked");
  await openSender(page);
  await panel(page).getByRole("button", { name: "What are you waiting for?" }).click();
  await expect(panel(page).getByRole("log")).toContainText("Sender approval is waiting for approval.");
  await expect(panel(page).getByRole("log")).not.toContainText("recipient");
  await expect(panel(page).getByTestId("approval-card")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("approval-card").getByRole("button", { name: "Approve and send", exact: true })).toBeDisabled();
  await expect(page.getByTestId("approval-card")).toContainText("Locked");
});