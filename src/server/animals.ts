import type { Prisma } from "@prisma/client";
import {
  adoptableKeys,
  canReturnToCare,
  canTransitionStatus,
  duplicateWarnings,
  findStatus,
  inCareKeys,
  normalizeMicrochip,
  normalizeName,
  type StatusDef,
} from "@/domain/animals";
import { AppError, notFound } from "@/domain/errors";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/actor";
import { assertShelterAccess, hasPermission, requireOrg, requirePermission, scopedShelterIds } from "@/server/actor";
import { db } from "@/server/db";
import { catalogFor, intakeSourcesFor, requireOrganization } from "@/server/org";
import { serializeAnimal } from "@/server/serialize";
import { storeUpload } from "@/server/storage";

const animalInclude = { shelter: true, photos: true } as const;

type AnimalInput = {
  shelterId: string;
  name: string;
  species: "cat" | "dog";
  breed: string | null;
  breedUnknown?: boolean;
  sex: "unknown" | "female" | "male";
  birthDate?: string | null;
  birthDateEstimated?: boolean;
  estimatedAgeYears?: number | null;
  estimatedAgeMonths?: number | null;
  color: string | null;
  distinguishingFeatures: string | null;
  microchip: string | null;
  intakeDate: string;
  intakeSource: string;
  previousOwnerName: string | null;
  previousOwnerPhone: string | null;
  previousOwnerEmail: string | null;
  previousOwnerNotes: string | null;
  housingLocation: string | null;
  temperament: string | null;
  specialHandling: string | null;
  dietaryNeeds: string | null;
  sterilizationStatus: "unknown" | "intact" | "sterilized";
  identificationTags: string | null;
  notes: string | null;
  size: "unknown" | "small" | "medium" | "large" | "xlarge";
  activityLevel: "unknown" | "low" | "moderate" | "high";
  weightKg?: number | null;
  acknowledgeDuplicates?: boolean;
  version?: number;
};

export async function listAnimals(
  actor: Actor,
  query: {
    q?: string;
    species?: string;
    status?: string;
    shelterId?: string;
    intakeFrom?: string;
    intakeTo?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
    includeArchived?: boolean;
  },
) {
  requirePermission(actor, "animals.read");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const org = await requireOrganization(orgId);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const shelterIds = scopedShelterIds(actor, query.shelterId);
  const where: Prisma.AnimalWhereInput = {
    organizationId: orgId,
    ...(shelterIds ? { shelterId: { in: shelterIds } } : {}),
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(query.species ? { species: query.species } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  if (query.intakeFrom || query.intakeTo) {
    where.intakeDate = {};
    if (query.intakeFrom) where.intakeDate.gte = new Date(query.intakeFrom);
    if (query.intakeTo) where.intakeDate.lte = new Date(query.intakeTo);
  }
  if (query.q?.trim()) {
    const q = query.q.trim();
    const chip = normalizeMicrochip(q);
    where.OR = [
      { nameNormalized: { contains: normalizeName(q) } },
      { publicCode: { contains: q.toUpperCase() } },
      ...(chip ? [{ microchip: { contains: chip } }] : []),
    ];
  }
  const sort = query.sort ?? "updatedAt";
  const orderBy: Prisma.AnimalOrderByWithRelationInput =
    sort === "name"
      ? { name: "asc" }
      : sort === "intakeDate"
        ? { intakeDate: "desc" }
        : sort === "publicCode"
          ? { publicCode: "asc" }
          : sort === "species"
            ? { species: "asc" }
            : sort === "status"
              ? { status: "asc" }
              : { updatedAt: "desc" };
  const [total, rows] = await Promise.all([
    prisma.animal.count({ where }),
    prisma.animal.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: animalInclude,
    }),
  ]);
  return {
    items: rows.map((animal) => serializeAnimal(animal, actor, org)),
    page,
    pageSize,
    total,
  };
}

export async function getAnimal(actor: Actor, id: string) {
  requirePermission(actor, "animals.read");
  const org = await requireOrganization(requireOrg(actor));
  const animal = await loadAnimal(actor, id);
  return serializeAnimal(animal, actor, org);
}

export async function createAnimal(actor: Actor, input: AnimalInput) {
  requirePermission(actor, "animals.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const org = await requireOrganization(orgId);
  const shelter = await accessibleShelter(actor, orgId, input.shelterId, true);
  assertIntake(org, input);
  const chip = normalizeMicrochip(input.microchip);
  await assertMicrochipAvailable(orgId, chip, actor);
  const warnings = await nameWarnings(orgId, input);
  if (warnings.length && !input.acknowledgeDuplicates) {
    throw new AppError(409, "duplicate_warning", "A similar animal is already registered. Confirm if this is a different animal.", {
      details: { matches: warnings },
    });
  }
  const created = await prisma.$transaction(async (tx) => {
    const publicCode = await nextPublicCode(tx, orgId);
    const animal = await tx.animal.create({
      data: {
        ...animalData(input, chip),
        organizationId: orgId,
        shelterId: shelter.id,
        publicCode,
        status: "intake_pending",
        createdById: actor.userId,
      },
      include: animalInclude,
    });
    await tx.animalStatusEvent.create({
      data: {
        animalId: animal.id,
        organizationId: orgId,
        fromStatus: null,
        toStatus: "intake_pending",
        note: "Intake recorded",
        actorId: actor.userId,
      },
    });
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "animal.created",
      entityType: "animal",
      entityId: animal.id,
      metadata: { publicCode, species: animal.species, shelterId: shelter.id },
      ip: actor.ip,
    });
    return animal;
  });
  return { animal: serializeAnimal(created, actor, org), warnings };
}

export async function updateAnimal(actor: Actor, id: string, input: AnimalInput) {
  requirePermission(actor, "animals.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const org = await requireOrganization(orgId);
  const current = await loadAnimal(actor, id);
  if (current.archivedAt) throw new AppError(409, "archived", "Unarchive the animal before editing it.");
  if (!input.version) throw new AppError(400, "validation_error", "Reload the record and try again.", { fields: { version: "Missing version." } });
  if (input.shelterId && input.shelterId !== current.shelterId) {
    throw new AppError(409, "use_transfer", "Use the transfer action to move an animal between shelters.");
  }
  assertIntake(org, input);
  const chip = normalizeMicrochip(input.microchip);
  await assertMicrochipAvailable(orgId, chip, actor, current.id);
  const warnings = await nameWarnings(orgId, input, current.id);
  if (warnings.length && !input.acknowledgeDuplicates) {
    throw new AppError(409, "duplicate_warning", "A similar animal is already registered. Confirm if this is still a different animal.", {
      details: { matches: warnings },
    });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.animal.updateMany({
      where: { id: current.id, organizationId: orgId, version: input.version },
      data: { ...animalData(input, chip), version: { increment: 1 } },
    });
    if (result.count !== 1) throw conflict();
    const animal = await tx.animal.findFirstOrThrow({ where: { id: current.id }, include: animalInclude });
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "animal.updated",
      entityType: "animal",
      entityId: animal.id,
      metadata: { publicCode: animal.publicCode },
      ip: actor.ip,
    });
    return animal;
  });
  return { animal: serializeAnimal(updated, actor, org), warnings };
}

export async function changeStatus(actor: Actor, id: string, input: { status: string; note: string | null; version: number }) {
  requirePermission(actor, "animals.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const org = await requireOrganization(orgId);
  const catalog = catalogFor(org);
  const current = await loadAnimal(actor, id);
  if (current.archivedAt) throw new AppError(409, "archived", "Unarchive the animal before changing its status.");
  const from = mustStatus(catalog, current.status);
  const to = mustStatus(catalog, input.status);
  if (!canTransitionStatus(from, to)) {
    throw new AppError(409, "invalid_transition", `${from.label} cannot be changed directly to ${to.label}.`);
  }
  const animal = await applyStatus(prisma, actor, current.id, orgId, input.version, from.key, to.key, input.note);
  return serializeAnimal(animal, actor, org);
}

export async function recordOutcome(
  actor: Actor,
  id: string,
  input: { type: "deceased" | "reunited" | "external_transfer" | "return_to_care"; note: string | null; destination: string | null; shelterId?: string; version: number },
) {
  requirePermission(actor, "animals.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const org = await requireOrganization(orgId);
  const catalog = catalogFor(org);
  const current = await loadAnimal(actor, id);
  if (current.archivedAt) throw new AppError(409, "archived", "Unarchive the animal before recording an outcome.");
  const from = mustStatus(catalog, current.status);
  if (input.type === "return_to_care") {
    if (!canReturnToCare(from.key)) throw new AppError(409, "invalid_transition", "Only transferred or reunited animals can return to care this way.");
    if (!input.shelterId) throw new AppError(400, "validation_error", "Choose a shelter.", { fields: { shelterId: "Choose a shelter." } });
    const shelter = await accessibleShelter(actor, orgId, input.shelterId, true);
    const animal = await prisma.$transaction(async (tx) => {
      const result = await tx.animal.updateMany({
        where: { id: current.id, organizationId: orgId, version: input.version, status: from.key },
        data: { status: "intake_pending", shelterId: shelter.id, statusBeforeAdoption: null, version: { increment: 1 } },
      });
      if (result.count !== 1) throw conflict();
      await tx.animalStatusEvent.create({
        data: { animalId: current.id, organizationId: orgId, fromStatus: from.key, toStatus: "intake_pending", note: input.note, actorId: actor.userId },
      });
      await tx.animalTransfer.create({
        data: {
          animalId: current.id,
          organizationId: orgId,
          fromShelterId: current.shelterId,
          toShelterId: shelter.id,
          kind: "return",
          reason: input.note || "Returned to care",
          actorId: actor.userId,
        },
      });
      await audit(tx, {
        organizationId: orgId,
        actorId: actor.userId,
        action: "animal.outcome",
        entityType: "animal",
        entityId: current.id,
        metadata: { type: input.type, toShelterId: shelter.id },
        ip: actor.ip,
      });
      return tx.animal.findFirstOrThrow({ where: { id: current.id }, include: animalInclude });
    });
    return serializeAnimal(animal, actor, org);
  }
  if (from.category !== "in_care") throw new AppError(409, "invalid_transition", "This animal is no longer in care.");
  if (from.key === "adoption_pending") {
    throw new AppError(409, "invalid_transition", "Resolve the adoption application before recording this outcome.");
  }
  const toKey = input.type === "deceased" ? "deceased" : input.type === "reunited" ? "reunited" : "transferred";
  if (toKey === "transferred" && !input.destination) {
    throw new AppError(400, "validation_error", "Record where the animal was transferred.", { fields: { destination: "Enter a destination." } });
  }
  const animal = await prisma.$transaction(async (tx) => {
    const result = await tx.animal.updateMany({
      where: { id: current.id, organizationId: orgId, version: input.version, status: from.key },
      data: { status: toKey, statusBeforeAdoption: null, version: { increment: 1 } },
    });
    if (result.count !== 1) throw conflict();
    await tx.animalStatusEvent.create({
      data: { animalId: current.id, organizationId: orgId, fromStatus: from.key, toStatus: toKey, note: input.note, actorId: actor.userId },
    });
    if (toKey === "transferred") {
      await tx.animalTransfer.create({
        data: {
          animalId: current.id,
          organizationId: orgId,
          fromShelterId: current.shelterId,
          externalDestination: input.destination,
          kind: "external",
          reason: input.note || "Transferred out of the organization",
          actorId: actor.userId,
        },
      });
    }
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "animal.outcome",
      entityType: "animal",
      entityId: current.id,
      metadata: { type: input.type, status: toKey },
      ip: actor.ip,
    });
    return tx.animal.findFirstOrThrow({ where: { id: current.id }, include: animalInclude });
  });
  return serializeAnimal(animal, actor, org);
}

export async function transferAnimal(actor: Actor, id: string, input: { toShelterId: string; reason: string; version: number }) {
  requirePermission(actor, "animals.transfer");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const org = await requireOrganization(orgId);
  const current = await loadAnimal(actor, id);
  if (current.archivedAt) throw new AppError(409, "archived", "Unarchive the animal before transferring it.");
  const catalog = catalogFor(org);
  const status = mustStatus(catalog, current.status);
  if (status.category !== "in_care") throw new AppError(409, "invalid_transition", "Only animals in care can be transferred between shelters.");
  if (input.toShelterId === current.shelterId) throw new AppError(400, "validation_error", "Choose a different shelter.", { fields: { toShelterId: "Choose a different shelter." } });
  const destination = await accessibleShelter(actor, orgId, input.toShelterId, true);
  assertShelterAccess(actor, current.shelterId);
  const animal = await prisma.$transaction(async (tx) => {
    const result = await tx.animal.updateMany({
      where: { id: current.id, organizationId: orgId, version: input.version, shelterId: current.shelterId },
      data: { shelterId: destination.id, version: { increment: 1 } },
    });
    if (result.count !== 1) throw conflict();
    await tx.animalTransfer.create({
      data: {
        animalId: current.id,
        organizationId: orgId,
        fromShelterId: current.shelterId,
        toShelterId: destination.id,
        kind: "internal",
        reason: input.reason,
        actorId: actor.userId,
      },
    });
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "animal.transfer",
      entityType: "animal",
      entityId: current.id,
      metadata: { fromShelterId: current.shelterId, toShelterId: destination.id, publicCode: current.publicCode },
      ip: actor.ip,
    });
    return tx.animal.findFirstOrThrow({ where: { id: current.id }, include: animalInclude });
  });
  return serializeAnimal(animal, actor, org);
}

export async function archiveAnimal(actor: Actor, id: string, input: { reason: string; version: number }, archived: boolean) {
  requirePermission(actor, "animals.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const org = await requireOrganization(orgId);
  const current = await loadAnimal(actor, id);
  if (archived && current.status === "adoption_pending") {
    throw new AppError(409, "invalid_transition", "This animal is on an adoption application and cannot be archived.");
  }
  const activeAdoption = await prisma.adoption.count({ where: { animalId: id, status: "active" } });
  if (archived && activeAdoption) throw new AppError(409, "invalid_transition", "An active adoption must be returned before the animal is archived.");
  const animal = await prisma.$transaction(async (tx) => {
    const result = await tx.animal.updateMany({
      where: { id, organizationId: orgId, version: input.version },
      data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
    });
    if (result.count !== 1) throw conflict();
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: archived ? "animal.archived" : "animal.unarchived",
      entityType: "animal",
      entityId: id,
      metadata: { reason: input.reason },
      ip: actor.ip,
    });
    return tx.animal.findFirstOrThrow({ where: { id }, include: animalInclude });
  });
  return serializeAnimal(animal, actor, org);
}

export async function addAnimalPhoto(actor: Actor, id: string, fileName: string, bytes: Buffer) {
  requirePermission(actor, "animals.write");
  const orgId = requireOrg(actor);
  const current = await loadAnimal(actor, id);
  const prisma = await db();
  const count = await prisma.animalPhoto.count({ where: { animalId: id } });
  if (count >= 12) throw new AppError(400, "photo_limit", "An animal can have up to 12 photos.");
  const stored = await storeUpload(orgId, bytes, "image");
  const photo = await prisma.animalPhoto.create({
    data: {
      animalId: current.id,
      organizationId: orgId,
      storageKey: stored.storageKey,
      fileName: fileName.slice(0, 120) || "photo",
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      isPrimary: count === 0,
      createdById: actor.userId,
    },
  });
  await audit(prisma, {
    organizationId: orgId,
    actorId: actor.userId,
    action: "animal.photo_added",
    entityType: "animal",
    entityId: id,
    metadata: { photoId: photo.id },
    ip: actor.ip,
  });
  return { id: photo.id, isPrimary: photo.isPrimary, url: `/api/files/photos/${photo.id}` };
}

export async function getAnimalPhoto(actor: Actor, photoId: string) {
  requirePermission(actor, "animals.read");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const photo = await prisma.animalPhoto.findFirst({ where: { id: photoId, organizationId: orgId }, include: { animal: true } });
  if (!photo) throw notFound();
  assertShelterAccess(actor, photo.animal.shelterId);
  return photo;
}

export async function animalTimeline(actor: Actor, id: string) {
  requirePermission(actor, "animals.read");
  const orgId = requireOrg(actor);
  await loadAnimal(actor, id);
  const prisma = await db();
  const [statuses, transfers, medical, adoptions, audits] = await Promise.all([
    prisma.animalStatusEvent.findMany({ where: { animalId: id, organizationId: orgId }, include: { actor: true }, orderBy: { createdAt: "desc" } }),
    prisma.animalTransfer.findMany({
      where: { animalId: id, organizationId: orgId },
      include: { actor: true, fromShelter: true, toShelter: true },
      orderBy: { createdAt: "desc" },
    }),
    hasPermission(actor, "medical.read")
      ? prisma.medicalRecord.findMany({ where: { animalId: id, organizationId: orgId }, orderBy: { occurredAt: "desc" }, take: 50 })
      : Promise.resolve([]),
    hasPermission(actor, "adoptions.read")
      ? prisma.adoption.findMany({ where: { animalId: id, organizationId: orgId }, include: { applicant: true }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
    prisma.auditEvent.findMany({
      where: { entityType: "animal", entityId: id, organizationId: orgId, action: { in: ["animal.archived", "animal.unarchived"] } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const items = [
    ...statuses.map((event) => ({
      id: event.id,
      kind: "status",
      at: event.createdAt.toISOString(),
      title: event.fromStatus ? `Status changed to ${event.toStatus}` : "Intake recorded",
      detail: event.note,
      actor: event.actor.name,
    })),
    ...transfers.map((event) => ({
      id: event.id,
      kind: "transfer",
      at: event.createdAt.toISOString(),
      title:
        event.kind === "external"
          ? `Transferred out to ${event.externalDestination}`
          : `Moved from ${event.fromShelter.name} to ${event.toShelter?.name ?? "another shelter"}`,
      detail: event.reason,
      actor: event.actor.name,
    })),
    ...medical.map((record) => ({
      id: record.id,
      kind: "medical",
      at: record.occurredAt.toISOString(),
      title: `Medical record: ${record.category}`,
      detail: record.supersededAt ? "Corrected — historical entry" : record.medicationName || record.notes,
      actor: null as string | null,
    })),
    ...adoptions.map((adoption) => ({
      id: adoption.id,
      kind: "adoption",
      at: adoption.createdAt.toISOString(),
      title: adoption.status === "returned" ? "Adoption returned" : "Adoption finalized",
      detail: hasPermission(actor, "people.read") ? `${adoption.applicant.firstName} ${adoption.applicant.lastName}` : "Applicant details restricted",
      actor: null as string | null,
    })),
    ...audits.map((event) => ({
      id: event.id,
      kind: "archive",
      at: event.createdAt.toISOString(),
      title: event.action === "animal.archived" ? "Record archived" : "Record restored",
      detail: null,
      actor: null as string | null,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  return items;
}

export async function matchAnimals(
  actor: Actor,
  query: { species?: string; size?: string; activityLevel?: string; temperament?: string; shelterId?: string; specialCare?: boolean; minYears?: number; maxYears?: number },
) {
  requirePermission(actor, "animals.read");
  requirePermission(actor, "adoptions.read");
  const orgId = requireOrg(actor);
  const org = await requireOrganization(orgId);
  const keys = adoptableKeys(catalogFor(org));
  const shelterIds = scopedShelterIds(actor, query.shelterId);
  const prisma = await db();
  const rows = await prisma.animal.findMany({
    where: {
      organizationId: orgId,
      archivedAt: null,
      status: { in: keys },
      ...(shelterIds ? { shelterId: { in: shelterIds } } : {}),
      ...(query.species ? { species: query.species } : {}),
      ...(query.size ? { size: query.size } : {}),
      ...(query.activityLevel ? { activityLevel: query.activityLevel } : {}),
      ...(query.specialCare ? { NOT: [{ specialHandling: null }, { specialHandling: "" }] } : {}),
      ...(query.temperament ? { temperament: { contains: query.temperament.trim().toLowerCase() } } : {}),
    },
    include: animalInclude,
    orderBy: { name: "asc" },
    take: 100,
  });
  const today = new Date();
  const filtered = rows.filter((animal) => ageMatches(animal.birthDate, animal.estimatedAgeYears, query.minYears, query.maxYears, today));
  return {
    notice: "These are filters for staff review, not a compatibility guarantee.",
    items: filtered.map((animal) => serializeAnimal(animal, actor, org)),
  };
}

async function loadAnimal(actor: Actor, id: string) {
  const orgId = requireOrg(actor);
  const prisma = await db();
  const animal = await prisma.animal.findFirst({ where: { id, organizationId: orgId }, include: animalInclude });
  if (!animal) throw notFound();
  assertShelterAccess(actor, animal.shelterId);
  return animal;
}

async function accessibleShelter(actor: Actor, orgId: string, shelterId: string, requireActive: boolean) {
  assertShelterAccess(actor, shelterId);
  const prisma = await db();
  const shelter = await prisma.shelter.findFirst({ where: { id: shelterId, organizationId: orgId } });
  if (!shelter || (requireActive && !shelter.active)) throw notFound("Shelter not found.");
  return shelter;
}

function assertIntake(org: { intakeSources: string; timezone: string }, input: AnimalInput) {
  const sources = intakeSourcesFor(org as Parameters<typeof intakeSourcesFor>[0]);
  if (!sources.includes(input.intakeSource)) {
    throw new AppError(400, "validation_error", "Choose an intake source configured for this organization.", {
      fields: { intakeSource: "Choose a configured intake source." },
    });
  }
  const intake = new Date(input.intakeDate);
  if (Number.isNaN(intake.getTime()) || intake.getTime() > Date.now() + 2 * 24 * 60 * 60 * 1000) {
    throw new AppError(400, "validation_error", "Intake date cannot be in the future.", { fields: { intakeDate: "Choose a valid intake date." } });
  }
  if (input.birthDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (input.birthDate > today) {
      throw new AppError(400, "validation_error", "Birth date cannot be in the future.", { fields: { birthDate: "Choose a past date or leave it unknown." } });
    }
  }
}

function animalData(input: AnimalInput, chip: string | null) {
  return {
    name: input.name.trim(),
    nameNormalized: normalizeName(input.name),
    species: input.species,
    breed: input.breedUnknown ? null : input.breed,
    breedUnknown: Boolean(input.breedUnknown),
    sex: input.sex,
    birthDate: input.birthDate ?? null,
    birthDateEstimated: input.birthDate ? Boolean(input.birthDateEstimated) : true,
    estimatedAgeYears: input.birthDate ? null : input.estimatedAgeYears ?? null,
    estimatedAgeMonths: input.birthDate ? null : input.estimatedAgeMonths ?? null,
    color: input.color,
    distinguishingFeatures: input.distinguishingFeatures,
    microchip: chip,
    intakeDate: new Date(input.intakeDate),
    intakeSource: input.intakeSource,
    previousOwnerName: input.previousOwnerName,
    previousOwnerPhone: input.previousOwnerPhone,
    previousOwnerEmail: input.previousOwnerEmail,
    previousOwnerNotes: input.previousOwnerNotes,
    housingLocation: input.housingLocation,
    temperament: input.temperament,
    specialHandling: input.specialHandling,
    dietaryNeeds: input.dietaryNeeds,
    sterilizationStatus: input.sterilizationStatus,
    identificationTags: input.identificationTags,
    notes: input.notes,
    size: input.size,
    activityLevel: input.activityLevel,
    weightGrams: input.weightKg == null ? null : Math.round(input.weightKg * 1000),
  };
}

async function assertMicrochipAvailable(orgId: string, chip: string | null, actor: Actor, selfId?: string) {
  if (!chip) return;
  const prisma = await db();
  const existing = await prisma.animal.findFirst({ where: { organizationId: orgId, microchip: chip, NOT: selfId ? { id: selfId } : undefined } });
  if (!existing) return;
  let detail = "An animal in this organization already uses this microchip.";
  try {
    assertShelterAccess(actor, existing.shelterId);
    detail = `Microchip already belongs to ${existing.publicCode}.`;
  } catch {
    detail = "An animal in this organization already uses this microchip.";
  }
  throw new AppError(409, "duplicate_microchip", detail);
}

async function nameWarnings(orgId: string, input: AnimalInput, selfId?: string) {
  const prisma = await db();
  const existing = await prisma.animal.findMany({
    where: { organizationId: orgId, nameNormalized: normalizeName(input.name), species: input.species, ...(selfId ? { NOT: { id: selfId } } : {}) },
    select: { id: true, publicCode: true, name: true, species: true, microchip: true, color: true, shelterId: true },
  });
  return duplicateWarnings(input, existing, selfId).map((match) => ({
    id: match.id,
    publicCode: match.publicCode,
    name: match.name,
    species: match.species,
  }));
}

async function nextPublicCode(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number | bigint }[]>`
    INSERT INTO "org_sequences" ("organizationId", "name", "value")
    VALUES (${orgId}, 'animal', 1)
    ON CONFLICT("organizationId", "name") DO UPDATE SET "value" = "value" + 1
    RETURNING "value"
  `;
  const value = Number(rows[0]?.value ?? 0);
  if (!value) throw new AppError(500, "sequence_failed", "Could not assign an animal ID.");
  return `A-${String(value).padStart(6, "0")}`;
}

function mustStatus(catalog: StatusDef[], key: string): StatusDef {
  const status = findStatus(catalog, key);
  if (!status) throw new AppError(400, "validation_error", "Unknown status.", { fields: { status: "Choose a valid status." } });
  return status;
}

function conflict(): AppError {
  return new AppError(409, "version_conflict", "This record was changed by someone else. Reload and try again.");
}

async function applyStatus(
  prisma: Awaited<ReturnType<typeof db>>,
  actor: Actor,
  animalId: string,
  orgId: string,
  version: number,
  from: string,
  to: string,
  note: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.animal.updateMany({
      where: { id: animalId, organizationId: orgId, version, status: from },
      data: { status: to, version: { increment: 1 } },
    });
    if (result.count !== 1) throw conflict();
    await tx.animalStatusEvent.create({
      data: { animalId, organizationId: orgId, fromStatus: from, toStatus: to, note, actorId: actor.userId },
    });
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "animal.status",
      entityType: "animal",
      entityId: animalId,
      metadata: { from, to },
      ip: actor.ip,
    });
    return tx.animal.findFirstOrThrow({ where: { id: animalId }, include: animalInclude });
  });
}

function ageMatches(birthDate: string | null, estimatedYears: number | null, minYears?: number, maxYears?: number, today = new Date()): boolean {
  if (minYears == null && maxYears == null) return true;
  let years: number | null = null;
  if (birthDate) {
    const birth = new Date(`${birthDate}T00:00:00Z`);
    years = (today.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  } else if (estimatedYears != null) {
    years = estimatedYears;
  }
  if (years == null) return false;
  if (minYears != null && years < minYears) return false;
  if (maxYears != null && years > maxYears) return false;
  return true;
}

export { inCareKeys };
