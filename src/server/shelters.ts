import { effectiveShelterMax } from "@/domain/animals";
import { AppError } from "@/domain/errors";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/actor";
import { assertShelterAccess, requireOrg, requirePermission } from "@/server/actor";
import { db } from "@/server/db";
import { getPlatformSettings } from "@/server/platform";
import { serializeShelter } from "@/server/serialize";

type ShelterInput = {
  name: string;
  code: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  capacity: number | null;
  notes: string | null;
  active?: boolean;
};

export async function listShelters(actor: Actor) {
  const orgId = requireOrg(actor);
  const prisma = await db();
  const shelters = await prisma.shelter.findMany({
    where: {
      organizationId: orgId,
      ...(actor.shelterIds ? { id: { in: actor.shelterIds } } : {}),
    },
    orderBy: { name: "asc" },
  });
  return shelters.map(serializeShelter);
}

export async function createShelter(actor: Actor, input: ShelterInput) {
  requirePermission(actor, "shelters.manage");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const settings = await getPlatformSettings();
  const shelter = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org || !org.active) throw new AppError(404, "not_found", "Organization not found.");
    const max = effectiveShelterMax(settings.maxSheltersPerOrganization, org.maxSheltersOverride);
    const updated = await tx.$executeRaw`
      UPDATE "organizations"
      SET "shelterCount" = "shelterCount" + 1
      WHERE "id" = ${orgId} AND "shelterCount" < ${max}
    `;
    if (updated !== 1) {
      throw new AppError(409, "shelter_limit", `This organization can operate at most ${max} shelter${max === 1 ? "" : "s"}.`);
    }
    const created = await tx.shelter.create({
      data: { organizationId: orgId, ...shelterData(input), active: input.active ?? true },
    });
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "shelter.created",
      entityType: "shelter",
      entityId: created.id,
      metadata: { name: created.name },
      ip: actor.ip,
    });
    return created;
  });
  return serializeShelter(shelter);
}

export async function updateShelter(actor: Actor, shelterId: string, input: ShelterInput) {
  requirePermission(actor, "shelters.manage");
  const orgId = requireOrg(actor);
  assertShelterAccess(actor, shelterId);
  const prisma = await db();
  const existing = await prisma.shelter.findFirst({ where: { id: shelterId, organizationId: orgId } });
  if (!existing) throw new AppError(404, "not_found", "Shelter not found.");
  const shelter = await prisma.shelter.update({
    where: { id: shelterId },
    data: { ...shelterData(input), active: input.active ?? existing.active },
  });
  await audit(prisma, {
    organizationId: orgId,
    actorId: actor.userId,
    action: "shelter.updated",
    entityType: "shelter",
    entityId: shelter.id,
    metadata: { name: shelter.name, active: shelter.active },
    ip: actor.ip,
  });
  return serializeShelter(shelter);
}

function shelterData(input: ShelterInput) {
  return {
    name: input.name,
    code: input.code,
    email: input.email,
    phone: input.phone,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    region: input.region,
    postalCode: input.postalCode,
    country: input.country,
    capacity: input.capacity,
    notes: input.notes,
  };
}

export async function shelterCapacitySummary(actor: Actor) {
  const orgId = requireOrg(actor);
  const prisma = await db();
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new AppError(404, "not_found", "Organization not found.");
  const settings = await getPlatformSettings();
  return {
    shelterCount: org.shelterCount,
    effectiveMaxShelters: effectiveShelterMax(settings.maxSheltersPerOrganization, org.maxSheltersOverride),
  };
}
