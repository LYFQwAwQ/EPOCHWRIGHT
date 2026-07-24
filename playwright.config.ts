import { defineConfig } from "@playwright/test";

const browserChannel = process.env.CI ? undefined : "msedge";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/playwright",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: browserChannel,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
