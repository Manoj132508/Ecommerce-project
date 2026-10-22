import { defineConfig, devices } from "@playwright/test";

// Real-browser checks (npm run test:browser). browser/stack.mjs starts a
// throwaway PostgreSQL + compiled Express + `next start` stack; Playwright
// launches isolated Chromium, Firefox and WebKit instances against it.
export default defineConfig({
  testDir: "./browser",
  outputDir: "./test-results/browser",
  globalSetup: "./browser/stack.mjs",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 3,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Deliberately not the store's zone (Europe/London): server-rendered dates
    // must hydrate without a mismatch whatever zone the visitor is in.
    locale: "en-GB",
    timezoneId: "America/Los_Angeles",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "chromium-tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
    // One retry, reported as "flaky": Playwright's Firefox intermittently stops
    // issuing requests after an action, or fails closing a context (Juggler
    // protocol error). Not seen in Chromium or WebKit; see MIGRATION_PLAN.md.
    { name: "firefox-desktop", retries: 1, use: { ...devices["Desktop Firefox"], viewport: { width: 1366, height: 900 } } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"], viewport: { width: 1366, height: 900 } } },
    { name: "webkit-mobile", use: { ...devices["iPhone 14"] } },
  ],
});
