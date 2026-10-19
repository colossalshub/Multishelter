import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

const env = {
  ...process.env,
  DATABASE_URL: "file:/tmp/pawhaven-e2e.db",
  SESSION_SECRET: "e2e-session-secret-not-for-production",
  STORAGE_PATH: "/tmp/pawhaven-e2e-storage",
  BCRYPT_ROUNDS: "4",
  ADMIN_EMAIL: "platform.e2e@example.com",
  ADMIN_NAME: "E2E Platform Admin",
  ADMIN_PASSWORD: "E2e-platform-pass",
  ADMIN_RESET: "true",
};

export default function setup(): void {
  rmSync("/tmp/pawhaven-e2e.db", { force: true });
  rmSync("/tmp/pawhaven-e2e-storage", { recursive: true, force: true });
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx scripts/create-admin.ts", { stdio: "inherit", env });
}
