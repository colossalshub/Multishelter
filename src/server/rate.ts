import { AppError } from "@/domain/errors";
import { db } from "@/server/db";

export async function assertWithinRateLimit(bucket: string, limit: number, windowMs: number): Promise<void> {
  const prisma = await db();
  const since = new Date(Date.now() - windowMs);
  const count = await prisma.rateBucket.count({ where: { bucket, createdAt: { gte: since } } });
  if (count >= limit) {
    throw new AppError(429, "rate_limited", "Too many attempts. Wait a few minutes and try again.");
  }
}

export async function recordRateLimit(bucket: string): Promise<void> {
  const prisma = await db();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.rateBucket.deleteMany({ where: { bucket, createdAt: { lt: cutoff } } });
  await prisma.rateBucket.create({ data: { bucket } });
}

export async function clearRateLimit(bucket: string): Promise<void> {
  const prisma = await db();
  await prisma.rateBucket.deleteMany({ where: { bucket } });
}
