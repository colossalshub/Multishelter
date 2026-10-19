import type { Prisma, PrismaClient } from "@prisma/client";

type Writer = PrismaClient | Prisma.TransactionClient;

export async function audit(
  writer: Writer,
  event: {
    organizationId?: string | null;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ip?: string | null;
  },
): Promise<void> {
  await writer.auditEvent.create({
    data: {
      organizationId: event.organizationId ?? null,
      actorId: event.actorId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      metadata: JSON.stringify(event.metadata ?? {}),
      ip: event.ip ?? null,
    },
  });
}
