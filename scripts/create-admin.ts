import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/crypto";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "";
const name = process.env.ADMIN_NAME?.trim() || "Platform Admin";
const reset = process.env.ADMIN_RESET === "true";

if (!email || !email.includes("@")) {
  console.error("Set ADMIN_EMAIL to the platform administrator email.");
  process.exit(1);
}
if (password.length < 10 || password.toLowerCase() === email) {
  console.error("Set ADMIN_PASSWORD to at least 10 characters, different from the email.");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  await prisma.platformSetting.upsert({ where: { id: "platform" }, update: {}, create: { id: "platform" } });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !reset) {
    console.error("That email already exists. Set ADMIN_RESET=true to replace the password and platform access.");
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { name, passwordHash, isPlatformAdmin: true, active: true, mustChangePassword: false },
    });
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    console.log(`Updated platform administrator ${email}.`);
  } else {
    await prisma.user.create({
      data: { email, name, passwordHash, isPlatformAdmin: true, mustChangePassword: false },
    });
    console.log(`Created platform administrator ${email}.`);
  }
  console.log("Sign in and create a client organization. The password was not printed.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Could not create the administrator.");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
