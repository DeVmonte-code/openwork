import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["migration.spec.ts", "orchestrator-hierarchy.spec.ts", "orchestrator-discussion.spec.ts"],
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:80",
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/repl/tools/bin/chromium",
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
});