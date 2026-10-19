import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaReady?: Promise<void> };

export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const client = new PrismaClient();
    globalForPrisma.prisma = client;
    globalForPrisma.prismaReady = (async () => {
      await client.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
      await client.$queryRawUnsafe("PRAGMA foreign_keys=ON;");
      await client.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
    })();
  }
  return globalForPrisma.prisma;
}

export async function db(): Promise<PrismaClient> {
  const client = getDb();
  await globalForPrisma.prismaReady;
  return client;
}

export async function resetDbClient(): Promise<void> {
  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect();
  }
  globalForPrisma.prisma = undefined;
  globalForPrisma.prismaReady = undefined;
}
