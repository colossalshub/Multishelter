import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

export default function setup(): void {
  rmSync("/tmp/pawhaven-test.db", { force: true });
  rmSync("/tmp/pawhaven-test-storage", { recursive: true, force: true });
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: "file:/tmp/pawhaven-test.db" },
  });
}
