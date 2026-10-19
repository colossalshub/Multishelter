import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/crypto";

if (process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to load demo data. Set ALLOW_DEMO_SEED=true for a clearly labeled development organization.");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("demo-password-123");
  const user = await prisma.user.upsert({
    where: { email: "demo.admin@example.com" },
    update: {},
    create: { email: "demo.admin@example.com", name: "Demo Admin", passwordHash, mustChangePassword: true },
  });
  const org = await prisma.organization.upsert({
    where: { slug: "sample-rescue-demo" },
    update: {},
    create: { name: "Sample Rescue (demo data)", slug: "sample-rescue-demo", shelterCount: 2, city: "Sample City" },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: { role: "org_admin" },
    create: { userId: user.id, organizationId: org.id, role: "org_admin" },
  });
  const shelters = await Promise.all(
    ["Sample North", "Sample South"].map((name) =>
      prisma.shelter.upsert({
        where: { organizationId_name: { organizationId: org.id, name } },
        update: {},
        create: { organizationId: org.id, name, city: "Sample City", capacity: 20 },
      }),
    ),
  );
  const existing = await prisma.animal.count({ where: { organizationId: org.id } });
  if (existing === 0 && shelters[0] && shelters[1]) {
    await prisma.animal.createMany({
      data: [
        {
          organizationId: org.id,
          shelterId: shelters[0].id,
          publicCode: "A-000001",
          name: "Demo Cat",
          nameNormalized: "demo cat",
          species: "cat",
          sex: "female",
          intakeDate: new Date(),
          intakeSource: "stray",
          status: "available",
          createdById: user.id,
        },
        {
          organizationId: org.id,
          shelterId: shelters[1].id,
          publicCode: "A-000002",
          name: "Demo Dog",
          nameNormalized: "demo dog",
          species: "dog",
          sex: "male",
          intakeDate: new Date(),
          intakeSource: "owner_surrender",
          status: "medical_hold",
          createdById: user.id,
        },
      ],
    });
    await prisma.orgSequence.upsert({
      where: { organizationId_name: { organizationId: org.id, name: "animal" } },
      update: { value: 2 },
      create: { organizationId: org.id, name: "animal", value: 2 },
    });
  }
  console.log("Demo organization 'Sample Rescue (demo data)' is ready.");
  console.log("Demo admin: demo.admin@example.com");
  console.log("Password: demo-password-123 (change it after sign-in; this account is for local demos only).");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Could not seed demo data.");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
