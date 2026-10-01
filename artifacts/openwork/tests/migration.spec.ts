import { expect, test, type Page } from "@playwright/test";

type BrowserDiagnostics = {
  connectionRefused: Array<{ origin: string; path: string; error: string }>;
  pageErrors: string[];
};

const diagnosticsByPage = new WeakMap<Page, BrowserDiagnostics>();

function observeBrowserDiagnostics(page: Page) {
  const diagnostics: BrowserDiagnostics = {
    connectionRefused: [],
    pageErrors: [],
  };
  diagnosticsByPage.set(page, diagnostics);

  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "";
    if (!error.includes("ERR_CONNECTION_REFUSED")) return;

    const url = new URL(request.url());
    diagnostics.connectionRefused.push({
      origin: url.origin,
      path: url.pathname,
      error,
    });
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
}

test.afterEach(async ({ page }, testInfo) => {
  const diagnostics = diagnosticsByPage.get(page);
  if (!diagnostics) return;

  const summary = JSON.stringify(diagnostics, null, 2);
  console.info(`[browser diagnostics] ${summary}`);
  await testInfo.attach("browser-diagnostics.json", {
    body: Buffer.from(summary),
    contentType: "application/json",
  });
});

test("fresh browser redirects to the original sign-in surface and smoke-tests its controls", async ({
  page,
}, testInfo) => {
  observeBrowserDiagnostics(page);
  test.setTimeout(120_000);
  await page.context().route("https://app.openworklabs.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>External sign-in intercepted</title>",
    }),
  );

  await page.goto("/");
  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole("heading", { name: "Welcome to OpenWork" }),
  ).toBeVisible();
  const denMe = await page.evaluate(async () => {
    const response = await fetch("/api/den/v1/me", {
      credentials: "same-origin",
    });
    return {
      status: response.status,
      type: response.type,
      url: response.url,
    };
  });
  expect(denMe.status).toBe(401);
  expect(denMe.type).toBe("basic");
  expect(new URL(denMe.url).origin).toBe(new URL(page.url()).origin);
  await expect(
    page.getByText("Your computer, but it works for you."),
  ).toBeVisible();
  const signInButton = page.getByRole("button", {
    name: "Sign in to OpenWork",
  });
  await expect(signInButton).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Paste sign-in code" }).click();
  const codeInput = page.getByLabel("Sign-in link or one-time code");
  await expect(codeInput).toBeVisible();
  await expect(codeInput).toHaveValue("");
  const finishSignIn = page.getByRole("button", { name: "Finish sign-in" });
  await expect(finishSignIn).toBeDisabled();
  await expect(
    page.getByText(
      "If your browser doesn't bounce back into OpenWork automatically, paste the sign-in link or one-time code from OpenWork Cloud here.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Using OpenWork on-premises?" }).click();
  const organizationDialog = page.getByRole("dialog", {
    name: "Connect to your organization's server",
  });
  await expect(organizationDialog).toBeVisible();
  const organizationUrl = page.getByLabel("Organization server URL");
  const saveOrganization = organizationDialog.getByRole("button", {
    name: "Save",
  });

  await organizationUrl.fill("http://invalid-onprem.example");
  await expect(saveOrganization).toBeDisabled();
  await organizationUrl.fill("https://acme.example");
  await expect(saveOrganization).toBeEnabled();
  await organizationUrl.press("Escape");
  await expect(organizationDialog).not.toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await signInButton.click();
  const popup = await popupPromise;
  await expect
    .poll(() => popup.url())
    .toContain("https://app.openworklabs.com");
  const signInUrl = new URL(popup.url());
  expect(signInUrl.origin).toBe("https://app.openworklabs.com");
  expect(signInUrl.searchParams.get("mode")).toBe("sign-up");
  expect(signInUrl.searchParams.get("desktopAuth")).toBe("1");
  expect(signInUrl.searchParams.get("desktopScheme")).toBe("openwork");
  await popup.close();

  const reloadResponse = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reloadResponse?.status()).toBe(200);
  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole("heading", { name: "Welcome to OpenWork" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Starting OpenWork" }),
  ).not.toBeVisible();
});

for (const path of ["/session", "/settings"]) {
  test(`deep link ${path} redirects to sign-in`, async ({ page }) => {
    observeBrowserDiagnostics(page);
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin$/);
    await expect(
      page.getByRole("heading", { name: "Welcome to OpenWork" }),
    ).toBeVisible();
  });
}

for (const path of ["/orchestrator", "/orchestrator/hierarchy"]) {
  test(`opening ${path} while signed out redirects to sign-in`, async ({ page }) => {
    observeBrowserDiagnostics(page);
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin$/);
    await expect(
      page.getByRole("heading", { name: "Welcome to OpenWork" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in to OpenWork" })).toBeVisible();
  });
}

test("mobile viewport renders the sign-in screen in dark theme", async ({
  page,
}, testInfo) => {
  observeBrowserDiagnostics(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });

  await page.goto("/");
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("heading", { name: "Welcome to OpenWork" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in to OpenWork" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("mobile-dark.png"),
    fullPage: true,
  });
});