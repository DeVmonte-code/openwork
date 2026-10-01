# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: migration.spec.ts >> fresh browser redirects to the original sign-in surface and smoke-tests its controls
- Location: tests/migration.spec.ts:43:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Welcome to OpenWork' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('heading', { name: 'Welcome to OpenWork' }) with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Welcome to OpenWork' })
    - waiting for navigation to finish...
    - navigated to "http://localhost/signin"

```

```yaml
- status: Starting OpenWork
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | type BrowserDiagnostics = {
  4   |   connectionRefused: Array<{ origin: string; path: string; error: string }>;
  5   |   pageErrors: string[];
  6   | };
  7   | 
  8   | const diagnosticsByPage = new WeakMap<Page, BrowserDiagnostics>();
  9   | 
  10  | function observeBrowserDiagnostics(page: Page) {
  11  |   const diagnostics: BrowserDiagnostics = {
  12  |     connectionRefused: [],
  13  |     pageErrors: [],
  14  |   };
  15  |   diagnosticsByPage.set(page, diagnostics);
  16  | 
  17  |   page.on("requestfailed", (request) => {
  18  |     const error = request.failure()?.errorText ?? "";
  19  |     if (!error.includes("ERR_CONNECTION_REFUSED")) return;
  20  | 
  21  |     const url = new URL(request.url());
  22  |     diagnostics.connectionRefused.push({
  23  |       origin: url.origin,
  24  |       path: url.pathname,
  25  |       error,
  26  |     });
  27  |   });
  28  |   page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  29  | }
  30  | 
  31  | test.afterEach(async ({ page }, testInfo) => {
  32  |   const diagnostics = diagnosticsByPage.get(page);
  33  |   if (!diagnostics) return;
  34  | 
  35  |   const summary = JSON.stringify(diagnostics, null, 2);
  36  |   console.info(`[browser diagnostics] ${summary}`);
  37  |   await testInfo.attach("browser-diagnostics.json", {
  38  |     body: Buffer.from(summary),
  39  |     contentType: "application/json",
  40  |   });
  41  | });
  42  | 
  43  | test("fresh browser redirects to the original sign-in surface and smoke-tests its controls", async ({
  44  |   page,
  45  | }, testInfo) => {
  46  |   observeBrowserDiagnostics(page);
  47  |   await page.context().route("https://app.openworklabs.com/**", (route) =>
  48  |     route.fulfill({
  49  |       status: 200,
  50  |       contentType: "text/html",
  51  |       body: "<!doctype html><title>External sign-in intercepted</title>",
  52  |     }),
  53  |   );
  54  | 
  55  |   await page.goto("/");
  56  |   await expect(page).toHaveURL(/\/signin$/);
  57  |   await expect(
  58  |     page.getByRole("heading", { name: "Welcome to OpenWork" }),
> 59  |   ).toBeVisible();
      |     ^ Error: expect(locator).toBeVisible() failed
  60  |   await expect(
  61  |     page.getByText("Your computer, but it works for you."),
  62  |   ).toBeVisible();
  63  |   const signInButton = page.getByRole("button", {
  64  |     name: "Sign in to OpenWork",
  65  |   });
  66  |   await expect(signInButton).toBeVisible();
  67  | 
  68  |   await page.screenshot({
  69  |     path: testInfo.outputPath("desktop.png"),
  70  |     fullPage: true,
  71  |   });
  72  | 
  73  |   await page.getByRole("button", { name: "Paste sign-in code" }).click();
  74  |   const codeInput = page.getByLabel("Sign-in link or one-time code");
  75  |   await expect(codeInput).toBeVisible();
  76  |   await expect(codeInput).toHaveValue("");
  77  |   const finishSignIn = page.getByRole("button", { name: "Finish sign-in" });
  78  |   await expect(finishSignIn).toBeDisabled();
  79  |   await expect(
  80  |     page.getByText(
  81  |       "If your browser doesn't bounce back into OpenWork automatically, paste the sign-in link or one-time code from OpenWork Cloud here.",
  82  |     ),
  83  |   ).toBeVisible();
  84  | 
  85  |   await page.getByRole("button", { name: "Using OpenWork on-premises?" }).click();
  86  |   const organizationDialog = page.getByRole("dialog", {
  87  |     name: "Connect to your organization's server",
  88  |   });
  89  |   await expect(organizationDialog).toBeVisible();
  90  |   const organizationUrl = page.getByLabel("Organization server URL");
  91  |   const saveOrganization = organizationDialog.getByRole("button", {
  92  |     name: "Save",
  93  |   });
  94  | 
  95  |   await organizationUrl.fill("http://invalid-onprem.example");
  96  |   await expect(saveOrganization).toBeDisabled();
  97  |   await organizationUrl.fill("https://acme.example");
  98  |   await expect(saveOrganization).toBeEnabled();
  99  |   await organizationDialog.getByRole("button", { name: "Cancel" }).click();
  100 |   await expect(organizationDialog).not.toBeVisible();
  101 | 
  102 |   const popupPromise = page.waitForEvent("popup");
  103 |   await signInButton.click();
  104 |   const popup = await popupPromise;
  105 |   await expect
  106 |     .poll(() => popup.url())
  107 |     .toContain("https://app.openworklabs.com");
  108 |   const signInUrl = new URL(popup.url());
  109 |   expect(signInUrl.origin).toBe("https://app.openworklabs.com");
  110 |   expect(signInUrl.searchParams.get("mode")).toBe("sign-up");
  111 |   await popup.close();
  112 | 
  113 |   await page.reload();
  114 |   await expect(page).toHaveURL(/\/signin$/);
  115 |   await expect(
  116 |     page.getByRole("heading", { name: "Welcome to OpenWork" }),
  117 |   ).toBeVisible();
  118 |   await expect(signInButton).toBeVisible();
  119 | });
  120 | 
  121 | for (const path of ["/session", "/settings"]) {
  122 |   test(`deep link ${path} redirects to sign-in`, async ({ page }) => {
  123 |     observeBrowserDiagnostics(page);
  124 |     await page.goto(path);
  125 |     await expect(page).toHaveURL(/\/signin$/);
  126 |     await expect(
  127 |       page.getByRole("heading", { name: "Welcome to OpenWork" }),
  128 |     ).toBeVisible();
  129 |   });
  130 | }
  131 | 
  132 | test("mobile viewport renders the sign-in screen in dark theme", async ({
  133 |   page,
  134 | }, testInfo) => {
  135 |   observeBrowserDiagnostics(page);
  136 |   await page.setViewportSize({ width: 390, height: 844 });
  137 |   await page.emulateMedia({ colorScheme: "dark" });
  138 | 
  139 |   await page.goto("/");
  140 |   await expect(page).toHaveURL(/\/signin$/);
  141 |   await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  142 |   await expect(
  143 |     page.getByRole("heading", { name: "Welcome to OpenWork" }),
  144 |   ).toBeVisible();
  145 |   await expect(
  146 |     page.getByRole("button", { name: "Sign in to OpenWork" }),
  147 |   ).toBeVisible();
  148 |   await page.screenshot({
  149 |     path: testInfo.outputPath("mobile-dark.png"),
  150 |     fullPage: true,
  151 |   });
  152 | });
```