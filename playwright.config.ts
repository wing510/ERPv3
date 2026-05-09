import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [["line"]],
  use: {
    headless: true,
    viewport: { width: 1400, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000
  }
});

