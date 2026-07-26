import { defineConfig } from "@playwright/test";

const browserChannel = process.env.CI ? undefined : "msedge";

export default defineConfig({
  testDir: "./tests/performance",
  outputDir: "./test-results/performance",
  timeout: 300_000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4174",
    channel: browserChannel,
    headless: true,
    launchOptions: {
      args: ["--enable-precise-memory-info"],
    },
  },
});
