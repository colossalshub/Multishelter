import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: "file:/tmp/pawhaven-test.db",
      SESSION_SECRET: "test-session-secret-value",
      STORAGE_PATH: "/tmp/pawhaven-test-storage",
      BCRYPT_ROUNDS: "4",
      TRUST_PROXY: "false",
      ALLOW_DEMO_SEED: "false",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
