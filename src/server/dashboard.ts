import { inCareKeys, occupancyKeys } from "@/domain/animals";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/actor";
import { requireOrg, scopedShelterIds } from "@/server/actor";
import { db } from "@/server/db";
import { catalogFor, requireOrganization } from "@/server/org";
import { ensureTaskReminders } from "@/server/notifications";

export async function dashboard(actor: Actor) {
  const orgId = requireOrg(actor);
  const org = await requireOrganization(orgId);
  const catalog = catalogFor(org);
  const care = inCareKeys(catalog);
  const occupying = occupancyKeys(catalog);
  const shelterIds = scopedShelterIds(actor, null);
  const shelterFilter = shelterIds ? { shelterId: { in: shelterIds } } : {};
  const prisma = await db();
  await ensureTaskReminders(actor);
  const now = new Date();
  const soon = new Date(now.getTime() + org.reminderLeadDays * 24 * 60 * 60 * 1000);
  const [inCare, speciesGroups, available, medicalHold, pendingApplications, recentAdoptions, upcoming, overdue, recentIntakes, recentOutcomes, shelters] =
    await Promise.all([
      prisma.animal.count({ where: { organizationId: orgId, archivedAt: null, status: { in: care }, ...shelterFilter } }),
      prisma.animal.groupBy({
        by: ["species"],
        where: { organizationId: orgId, archivedAt: null, status: { in: care }, ...shelterFilter },
        _count: { _all: true },
      }),
      prisma.animal.count({ where: { organizationId: orgId, archivedAt: null, status: "available", ...shelterFilter } }),
      prisma.animal.count({ where: { organizationId: orgId, archivedAt: null, status: "medical_hold", ...shelterFilter } }),
      prisma.adoptionApplication.count({
        where: {
          organizationId: orgId,
          status: { in: ["submitted", "under_review", "screening", "on_hold", "approved"] },
          ...(shelterIds ? { animals: { some: { animal: { shelterId: { in: shelterIds } } } } } : {}),
        },
      }),
      prisma.adoption.findMany({
        where: { organizationId: orgId, status: "active", ...(shelterIds ? { shelterId: { in: shelterIds } } : {}) },
        include: { animal: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.careTask.findMany({
        where: { organizationId: orgId, status: "open", dueAt: { gte: now, lte: soon }, ...shelterFilter },
        include: { animal: true },
        orderBy: { dueAt: "asc" },
        take: 8,
      }),
      prisma.careTask.findMany({
        where: { organizationId: orgId, status: "open", dueAt: { lt: now }, ...shelterFilter },
        include: { animal: true },
        orderBy: { dueAt: "asc" },
        take: 8,
      }),
      prisma.animal.findMany({
        where: { organizationId: orgId, archivedAt: null, ...shelterFilter },
        orderBy: { intakeDate: "desc" },
        take: 6,
        include: { shelter: true },
      }),
      prisma.animalStatusEvent.findMany({
        where: { organizationId: orgId, toStatus: { in: ["adopted", "reunited", "transferred", "deceased"] } },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { animal: true },
      }),
      prisma.shelter.findMany({
        where: { organizationId: orgId, ...(shelterIds ? { id: { in: shelterIds } } : {}) },
        orderBy: { name: "asc" },
      }),
    ]);
  const occupancy = await Promise.all(
    shelters.map(async (shelter) => ({
      id: shelter.id,
      name: shelter.name,
      capacity: shelter.capacity,
      occupancy: await prisma.animal.count({
        where: { organizationId: orgId, shelterId: shelter.id, archivedAt: null, status: { in: occupying } },
      }),
    })),
  );
  const bySpecies = { cat: 0, dog: 0 };
  for (const group of speciesGroups) {
    if (group.species === "cat" || group.species === "dog") bySpecies[group.species] = group._count._all;
  }
  return {
    inCare,
    bySpecies,
    available,
    medicalHold,
    pendingApplications,
    byShelter: occupancy,
    recentAdoptions: recentAdoptions.map((adoption) => ({
      id: adoption.id,
      animalId: adoption.animalId,
      animalName: adoption.animal.name,
      publicCode: adoption.animal.publicCode,
      adoptionDate: adoption.adoptionDate,
    })),
    upcomingTasks: upcoming.map(taskDto),
    overdueTasks: overdue.map(taskDto),
    recentIntakes: recentIntakes.map((animal) => ({
      id: animal.id,
      name: animal.name,
      publicCode: animal.publicCode,
      species: animal.species,
      shelterName: animal.shelter.name,
      intakeDate: animal.intakeDate.toISOString(),
      status: animal.status,
    })),
    recentOutcomes: recentOutcomes
      .filter((event) => !shelterIds || shelterIds.includes(event.animal.shelterId))
      .map((event) => ({
        id: event.id,
        animalId: event.animalId,
        animalName: event.animal.name,
        publicCode: event.animal.publicCode,
        status: event.toStatus,
        at: event.createdAt.toISOString(),
      })),
  };
}

function taskDto(task: { id: string; title: string; dueAt: Date; animal: { id: string; name: string; publicCode: string } }) {
  return {
    id: task.id,
    title: task.title,
    dueAt: task.dueAt.toISOString(),
    animalId: task.animal.id,
    animalName: task.animal.name,
    publicCode: task.animal.publicCode,
  };
}

export async function listAudit(actor: Actor, query: { from?: string; to?: string; page?: number }) {
  const { requirePermission } = await import("@/server/actor");
  requirePermission(actor, "audit.read");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const page = Math.max(1, query.page ?? 1);
  const where = {
    organizationId: orgId,
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 50,
      take: 50,
    }),
  ]);
  return {
    page,
    pageSize: 50,
    total,
    items: rows.map((event) => ({
      id: event.id,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      actor: event.actor?.name ?? "System",
      metadata: safeMetadata(event.metadata),
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

function safeMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    delete parsed.password;
    delete parsed.passwordHash;
    delete parsed.temporaryPassword;
    return parsed;
  } catch {
    return {};
  }
}

export { audit };
