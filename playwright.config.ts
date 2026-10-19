import { defineConfig, devices } from "@playwright/test";

process.env.DATABASE_URL = "file:/tmp/pawhaven-e2e.db";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  reporter: [["list"]],
  use: {
    baseURL,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ...process.env,
      DATABASE_URL: "file:/tmp/pawhaven-e2e.db",
      SESSION_SECRET: "e2e-session-secret-not-for-production",
      STORAGE_PATH: "/tmp/pawhaven-e2e-storage",
      BCRYPT_ROUNDS: "4",
      TRUST_PROXY: "false",
      ALLOW_DEMO_SEED: "false",
    },
  },
});
