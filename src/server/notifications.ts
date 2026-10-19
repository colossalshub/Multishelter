import type { Actor } from "@/server/actor";
import { requireOrg, scopedShelterIds } from "@/server/actor";
import { db } from "@/server/db";
import { requireOrganization } from "@/server/org";

export async function ensureTaskReminders(actor: Actor): Promise<void> {
  const orgId = requireOrg(actor);
  const org = await requireOrganization(orgId);
  const prisma = await db();
  const shelterIds = scopedShelterIds(actor, null);
  const until = new Date(Date.now() + org.reminderLeadDays * 24 * 60 * 60 * 1000);
  const tasks = await prisma.careTask.findMany({
    where: {
      organizationId: orgId,
      status: "open",
      dueAt: { lte: until },
      ...(shelterIds ? { shelterId: { in: shelterIds } } : {}),
    },
    include: { animal: true },
    take: 50,
  });
  for (const task of tasks) {
    const overdue = task.dueAt.getTime() < Date.now();
    const dedupeKey = `task:${task.id}:${task.dueAt.toISOString()}`;
    await prisma.notification.create({
      data: {
        organizationId: orgId,
        userId: actor.userId,
        kind: overdue ? "task_overdue" : "task_upcoming",
        title: overdue ? "Care task is overdue" : "Upcoming care task",
        body: `${task.title} for ${task.animal.name} (${task.animal.publicCode}). This is a reminder, not a clinical assessment.`,
        href: `/tasks?animalId=${task.animalId}`,
        dedupeKey,
      },
    }).catch(() => undefined);
  }
}

export async function listNotifications(actor: Actor) {
  const orgId = requireOrg(actor);
  await ensureTaskReminders(actor);
  const prisma = await db();
  const rows = await prisma.notification.findMany({
    where: { organizationId: orgId, userId: actor.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unread = rows.filter((row) => !row.readAt).length;
  return {
    unread,
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      href: row.href,
      kind: row.kind,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function markNotificationRead(actor: Actor, id: string) {
  const orgId = requireOrg(actor);
  const prisma = await db();
  await prisma.notification.updateMany({
    where: { id, organizationId: orgId, userId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

export async function markAllNotificationsRead(actor: Actor) {
  const orgId = requireOrg(actor);
  const prisma = await db();
  await prisma.notification.updateMany({
    where: { organizationId: orgId, userId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}
