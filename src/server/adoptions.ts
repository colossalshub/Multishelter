import type { Prisma } from "@prisma/client";
import {
  OPEN_APPLICATION_STATUSES,
  applicationTransitions,
  canTransitionApplication,
  decisionRequired,
  isApplicationStatus,
} from "@/domain/adoptions";
import { FINALIZE_STATUSES, findStatus } from "@/domain/animals";
import { AppError, notFound } from "@/domain/errors";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/actor";
import { assertShelterAccess, hasPermission, requireOrg, requirePermission, scopedShelterIds } from "@/server/actor";
import { db } from "@/server/db";
import { catalogFor, requireOrganization } from "@/server/org";
import { storeUpload } from "@/server/storage";

type ApplicantInput = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  preferredContact: "email" | "phone" | "either";
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  householdAdults?: number | null;
  householdChildren?: number | null;
  housingType: string | null;
  hasYard?: "yes" | "no" | "unknown" | null;
  otherPets: string | null;
  experienceNotes: string | null;
};

export async function listApplicants(actor: Actor, q?: string) {
  requirePermission(actor, "people.read");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const query = q?.trim();
  const rows = await prisma.applicant.findMany({
    where: {
      organizationId: orgId,
      ...(query
        ? {
            OR: [
              { lastName: { contains: query } },
              { firstName: { contains: query } },
              { email: { contains: query } },
              { phone: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 100,
  });
  return rows.map((row) => serializeApplicant(row, actor));
}

export async function getApplicant(actor: Actor, id: string) {
  requirePermission(actor, "people.read");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const row = await prisma.applicant.findFirst({ where: { id, organizationId: orgId } });
  if (!row) throw notFound();
  return serializeApplicant(row, actor);
}

export async function createApplicant(actor: Actor, input: ApplicantInput) {
  requirePermission(actor, "people.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const row = await prisma.applicant.create({ data: { ...applicantData(input), organizationId: orgId, createdById: actor.userId } });
  await audit(prisma, {
    organizationId: orgId,
    actorId: actor.userId,
    action: "applicant.created",
    entityType: "applicant",
    entityId: row.id,
    ip: actor.ip,
  });
  return serializeApplicant(row, actor);
}

export async function updateApplicant(actor: Actor, id: string, input: ApplicantInput) {
  requirePermission(actor, "people.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const existing = await prisma.applicant.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) throw notFound();
  if (existing.redactedAt) throw new AppError(409, "redacted", "Redacted applicant details cannot be edited.");
  const row = await prisma.applicant.update({ where: { id }, data: applicantData(input) });
  await audit(prisma, {
    organizationId: orgId,
    actorId: actor.userId,
    action: "applicant.updated",
    entityType: "applicant",
    entityId: id,
    ip: actor.ip,
  });
  return serializeApplicant(row, actor);
}

export async function redactApplicant(actor: Actor, id: string) {
  requirePermission(actor, "people.redact");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const existing = await prisma.applicant.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) throw notFound();
  const row = await prisma.applicant.update({
    where: { id },
    data: {
      firstName: "Redacted",
      lastName: "Applicant",
      email: null,
      phone: null,
      addressLine1: null,
      city: null,
      region: null,
      postalCode: null,
      otherPets: null,
      experienceNotes: null,
      customAnswers: "{}",
      redactedAt: new Date(),
    },
  });
  await audit(prisma, {
    organizationId: orgId,
    actorId: actor.userId,
    action: "applicant.redacted",
    entityType: "applicant",
    entityId: id,
    ip: actor.ip,
  });
  return serializeApplicant(row, actor);
}

export async function listApplications(actor: Actor, query: { status?: string; q?: string }) {
  requirePermission(actor, "adoptions.read");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const shelterIds = scopedShelterIds(actor, null);
  const rows = await prisma.adoptionApplication.findMany({
    where: {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(shelterIds
        ? { animals: { some: { animal: { shelterId: { in: shelterIds } } } } }
        : {}),
    },
    include: applicationInclude,
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.map((row) => serializeApplication(row, actor));
}

export async function getApplication(actor: Actor, id: string) {
  requirePermission(actor, "adoptions.read");
  const row = await loadApplication(actor, id);
  return {
    ...serializeApplication(row, actor),
    transitions: applicationTransitions(row.status),
    screenings: row.screenings.map((event) => ({
      id: event.id,
      kind: event.kind,
      occurredAt: event.occurredAt.toISOString(),
      result: event.result,
      notes: event.notes,
      nextActionAt: event.nextActionAt?.toISOString() ?? null,
      actor: event.actor.name,
    })),
    adoptions: row.adoptions.map((adoption) => serializeAdoption(adoption, actor)),
  };
}

export async function createApplication(actor: Actor, input: { applicantId: string; animalIds: string[] }) {
  requirePermission(actor, "adoptions.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const applicant = await prisma.applicant.findFirst({ where: { id: input.applicantId, organizationId: orgId } });
  if (!applicant || applicant.redactedAt) throw notFound("Applicant not found.");
  const animals = await loadSelectableAnimals(actor, orgId, input.animalIds);
  const created = await prisma.$transaction(async (tx) => {
    const application = await tx.adoptionApplication.create({
      data: {
        organizationId: orgId,
        applicantId: applicant.id,
        status: "draft",
        createdById: actor.userId,
        animals: { create: animals.map((animal) => ({ animalId: animal.id, organizationId: orgId })) },
      },
      include: applicationInclude,
    });
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "application.created",
      entityType: "adoption_application",
      entityId: application.id,
      metadata: { animalIds: animals.map((animal) => animal.id) },
      ip: actor.ip,
    });
    return application;
  });
  return serializeApplication(created, actor);
}

export async function setApplicationAnimals(actor: Actor, id: string, input: { animalIds: string[]; version: number }) {
  requirePermission(actor, "adoptions.write");
  const orgId = requireOrg(actor);
  const current = await loadApplication(actor, id);
  if (!["draft", "submitted", "under_review", "screening", "on_hold"].includes(current.status)) {
    throw new AppError(409, "application_closed", "Animals can be changed only before the application is approved or closed.");
  }
  const animals = await loadSelectableAnimals(actor, orgId, input.animalIds);
  const prisma = await db();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.adoptionApplication.updateMany({
      where: { id, organizationId: orgId, version: input.version },
      data: { version: { increment: 1 } },
    });
    if (result.count !== 1) throw conflict();
    await tx.applicationAnimal.deleteMany({ where: { applicationId: id } });
    await tx.applicationAnimal.createMany({ data: animals.map((animal) => ({ applicationId: id, animalId: animal.id, organizationId: orgId })) });
    return tx.adoptionApplication.findFirstOrThrow({ where: { id }, include: applicationInclude });
  });
  return serializeApplication(updated, actor);
}

export async function transitionApplication(actor: Actor, id: string, input: { status: string; reason: string | null; version: number }) {
  requirePermission(actor, "adoptions.write");
  if (!isApplicationStatus(input.status) || !canTransitionApplication((await loadApplication(actor, id)).status, input.status)) {
    const current = await loadApplication(actor, id);
    throw new AppError(409, "invalid_transition", `This application cannot move from ${current.status} to ${input.status}.`);
  }
  const current = await loadApplication(actor, id);
  if (decisionRequired(input.status) && !input.reason) {
    throw new AppError(400, "validation_error", "Record the reason for this decision.", { fields: { reason: "Enter a reason." } });
  }
  const orgId = requireOrg(actor);
  const prisma = await db();
  const warnings = input.status === "approved" ? await reservationWarnings(orgId, current.animals.map((link) => link.animalId), id) : [];
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.adoptionApplication.updateMany({
      where: { id, organizationId: orgId, version: input.version, status: current.status },
      data: {
        status: input.status,
        decisionReason: input.reason,
        submittedAt: input.status === "submitted" ? new Date() : current.submittedAt,
        decidedAt: ["approved", "rejected", "withdrawn"].includes(input.status) ? new Date() : current.decidedAt,
        decidedById: ["approved", "rejected", "withdrawn"].includes(input.status) ? actor.userId : current.decidedById,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw conflict();
    if (input.status === "approved") {
      for (const link of current.animals) await reserveAnimal(tx, actor, link.animal);
    }
    if (["rejected", "withdrawn"].includes(input.status) && current.status === "approved") {
      for (const link of current.animals) await releaseAnimal(tx, actor, link.animal.id, id);
    }
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "application.transition",
      entityType: "adoption_application",
      entityId: id,
      metadata: { from: current.status, to: input.status },
      ip: actor.ip,
    });
    return tx.adoptionApplication.findFirstOrThrow({ where: { id }, include: applicationInclude });
  });
  return { application: serializeApplication(updated, actor), warnings };
}

export async function addScreening(
  actor: Actor,
  id: string,
  input: { kind: string; occurredAt: string; result: string | null; notes: string | null; nextActionAt?: string | null },
) {
  requirePermission(actor, "adoptions.write");
  const current = await loadApplication(actor, id);
  if (["finalized", "rejected", "withdrawn"].includes(current.status)) {
    throw new AppError(409, "application_closed", "Closed applications cannot receive new screening records.");
  }
  const prisma = await db();
  const event = await prisma.screeningEvent.create({
    data: {
      applicationId: current.id,
      organizationId: current.organizationId,
      kind: input.kind,
      occurredAt: new Date(input.occurredAt),
      result: input.result,
      notes: input.notes,
      nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
      actorId: actor.userId,
    },
  });
  await audit(prisma, {
    organizationId: current.organizationId,
    actorId: actor.userId,
    action: "application.screening",
    entityType: "adoption_application",
    entityId: id,
    metadata: { kind: input.kind },
    ip: actor.ip,
  });
  return { id: event.id };
}

export async function finalizeAdoption(
  actor: Actor,
  id: string,
  input: {
    adoptionDate: string;
    agreementSummary: string | null;
    animals: { animalId: string; feeCents?: number | null }[];
    acknowledgeClearanceUnknown: boolean;
    version: number;
  },
) {
  requirePermission(actor, "adoptions.finalize");
  const orgId = requireOrg(actor);
  const org = await requireOrganization(orgId);
  const current = await loadApplication(actor, id);
  if (current.status !== "approved") throw new AppError(409, "not_approved", "Only an approved application can be finalized.");
  const linkedIds = current.animals.map((link) => link.animalId).sort();
  const payloadIds = input.animals.map((animal) => animal.animalId).sort();
  if (linkedIds.join() !== payloadIds.join()) {
    throw new AppError(400, "validation_error", "Finalize every animal on the application together.", { fields: { animals: "Include each animal on the application." } });
  }
  const prisma = await db();
  const created = await prisma.$transaction(async (tx) => {
    const application = await tx.adoptionApplication.findFirst({ where: { id, organizationId: orgId, status: "approved", version: input.version }, include: applicationInclude });
    if (!application) throw conflict();
    const adoptions = [];
    for (const item of input.animals) {
      const animal = application.animals.find((link) => link.animalId === item.animalId)?.animal;
      if (!animal) throw notFound();
      assertShelterAccess(actor, animal.shelterId);
      if (!FINALIZE_STATUSES.has(animal.status)) {
        throw new AppError(409, "animal_unavailable", `${animal.name} is ${animal.status} and cannot be adopted.`);
      }
      if (animal.medicalClearance === "not_cleared" || animal.medicalClearance === "pending") {
        throw new AppError(409, "clearance_blocked", `${animal.name} is not medically cleared for adoption.`);
      }
      if (animal.medicalClearance === "unknown" && !input.acknowledgeClearanceUnknown) {
        throw new AppError(409, "clearance_unknown", `Medical clearance for ${animal.name} is unknown. Confirm that you are not treating missing information as a clean bill of health.`, {
          details: { animalId: animal.id },
        });
      }
      const status = await tx.animal.updateMany({
        where: { id: animal.id, organizationId: orgId, version: animal.version, status: { in: [...FINALIZE_STATUSES] } },
        data: { status: "adopted", statusBeforeAdoption: null, version: { increment: 1 } },
      });
      if (status.count !== 1) throw new AppError(409, "animal_unavailable", `${animal.name} could not be finalized. Another update may have changed the record.`);
      const adoption = await tx.adoption.create({
        data: {
          organizationId: orgId,
          applicationId: application.id,
          animalId: animal.id,
          applicantId: application.applicantId,
          shelterId: animal.shelterId,
          adoptionDate: input.adoptionDate,
          agreementSummary: input.agreementSummary || org.adoptionAgreement || null,
          feeCents: org.adoptionFeeEnabled ? item.feeCents ?? org.defaultAdoptionFeeCents : null,
          clearanceAcknowledgement: animal.medicalClearance === "unknown" ? "Staff acknowledged that clearance is unknown and was not treated as healthy." : null,
          finalizedById: actor.userId,
        },
        include: { animal: true, applicant: true },
      });
      await tx.animalStatusEvent.create({
        data: {
          animalId: animal.id,
          organizationId: orgId,
          fromStatus: animal.status,
          toStatus: "adopted",
          note: "Adoption finalized",
          actorId: actor.userId,
        },
      });
      adoptions.push(adoption);
    }
    const closed = await tx.adoptionApplication.updateMany({
      where: { id, organizationId: orgId, status: "approved", version: input.version },
      data: { status: "finalized", decidedAt: new Date(), decidedById: actor.userId, version: { increment: 1 } },
    });
    if (closed.count !== 1) throw conflict();
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "adoption.finalized",
      entityType: "adoption_application",
      entityId: id,
      metadata: { adoptionIds: adoptions.map((adoption) => adoption.id), animalIds: payloadIds },
      ip: actor.ip,
    });
    return adoptions;
  });
  return created.map((adoption) => serializeAdoption(adoption, actor));
}

export async function returnAdoption(actor: Actor, adoptionId: string, input: { reason: string; shelterId: string; status?: string }) {
  requirePermission(actor, "adoptions.finalize");
  const orgId = requireOrg(actor);
  const org = await requireOrganization(orgId);
  const prisma = await db();
  const adoption = await prisma.adoption.findFirst({ where: { id: adoptionId, organizationId: orgId }, include: { animal: true } });
  if (!adoption) throw notFound();
  if (adoption.status !== "active") throw new AppError(409, "already_returned", "This adoption was already returned.");
  assertShelterAccess(actor, input.shelterId);
  const shelter = await prisma.shelter.findFirst({ where: { id: input.shelterId, organizationId: orgId, active: true } });
  if (!shelter) throw notFound("Shelter not found.");
  const catalog = catalogFor(org);
  const nextStatus = input.status ?? "intake_pending";
  const status = findStatus(catalog, nextStatus);
  if (!status || status.category !== "in_care" || status.key === "adoption_pending") {
    throw new AppError(400, "validation_error", "Choose an in-care status.", { fields: { status: "Choose an in-care status." } });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.adoption.updateMany({
      where: { id: adoptionId, status: "active" },
      data: { status: "returned", returnedAt: new Date(), returnReason: input.reason },
    });
    if (changed.count !== 1) throw new AppError(409, "already_returned", "This adoption was already returned.");
    const animal = await tx.animal.updateMany({
      where: { id: adoption.animalId, organizationId: orgId, status: "adopted" },
      data: { status: status.key, shelterId: shelter.id, version: { increment: 1 } },
    });
    if (animal.count !== 1) throw new AppError(409, "animal_unavailable", "The animal status could not be updated.");
    await tx.animalStatusEvent.create({
      data: {
        animalId: adoption.animalId,
        organizationId: orgId,
        fromStatus: "adopted",
        toStatus: status.key,
        note: input.reason,
        actorId: actor.userId,
      },
    });
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "adoption.returned",
      entityType: "adoption",
      entityId: adoptionId,
      metadata: { animalId: adoption.animalId, status: status.key },
      ip: actor.ip,
    });
    return tx.adoption.findFirstOrThrow({ where: { id: adoptionId }, include: { animal: true, applicant: true } });
  });
  return serializeAdoption(updated, actor);
}

export async function addFollowUp(actor: Actor, adoptionId: string, input: { scheduledAt: string; notes: string | null }) {
  requirePermission(actor, "adoptions.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const adoption = await prisma.adoption.findFirst({ where: { id: adoptionId, organizationId: orgId } });
  if (!adoption) throw notFound();
  const followUp = await prisma.postAdoptionFollowUp.create({
    data: {
      adoptionId,
      organizationId: orgId,
      animalId: adoption.animalId,
      scheduledAt: new Date(input.scheduledAt),
      notes: input.notes,
      createdById: actor.userId,
    },
  });
  await audit(prisma, {
    organizationId: orgId,
    actorId: actor.userId,
    action: "followup.added",
    entityType: "adoption",
    entityId: adoptionId,
    metadata: { followUpId: followUp.id },
    ip: actor.ip,
  });
  return { id: followUp.id, scheduledAt: followUp.scheduledAt.toISOString() };
}

export async function completeFollowUp(actor: Actor, adoptionId: string, followUpId: string, input: { notes: string | null; outcome: string | null }) {
  requirePermission(actor, "adoptions.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const followUp = await prisma.postAdoptionFollowUp.findFirst({ where: { id: followUpId, adoptionId, organizationId: orgId } });
  if (!followUp) throw notFound();
  const updated = await prisma.postAdoptionFollowUp.update({
    where: { id: followUpId },
    data: { completedAt: new Date(), completedById: actor.userId, notes: input.notes ?? followUp.notes, outcome: input.outcome },
  });
  return { id: updated.id, completedAt: updated.completedAt?.toISOString() ?? null, outcome: updated.outcome };
}

export async function addAdoptionDocument(actor: Actor, adoptionId: string, fileName: string, bytes: Buffer) {
  requirePermission(actor, "adoptions.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const adoption = await prisma.adoption.findFirst({ where: { id: adoptionId, organizationId: orgId } });
  if (!adoption) throw notFound();
  const stored = await storeUpload(orgId, bytes, "document");
  const doc = await prisma.adoptionDocument.create({
    data: {
      adoptionId,
      organizationId: orgId,
      storageKey: stored.storageKey,
      fileName: fileName.slice(0, 120) || "document",
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      createdById: actor.userId,
    },
  });
  return { id: doc.id, fileName: doc.fileName, url: `/api/files/adoption-documents/${doc.id}` };
}

export async function getAdoptionDocument(actor: Actor, id: string) {
  requirePermission(actor, "adoptions.read");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const doc = await prisma.adoptionDocument.findFirst({ where: { id, organizationId: orgId }, include: { adoption: { include: { animal: true } } } });
  if (!doc) throw notFound();
  assertShelterAccess(actor, doc.adoption.animal.shelterId);
  return doc;
}

const applicationInclude = {
  applicant: true,
  animals: { include: { animal: true } },
  screenings: { include: { actor: true }, orderBy: { occurredAt: "desc" as const } },
  adoptions: { include: { animal: true, applicant: true } },
} satisfies Prisma.AdoptionApplicationInclude;

async function loadApplication(actor: Actor, id: string) {
  const orgId = requireOrg(actor);
  const prisma = await db();
  const row = await prisma.adoptionApplication.findFirst({ where: { id, organizationId: orgId }, include: applicationInclude });
  if (!row) throw notFound();
  for (const link of row.animals) assertShelterAccess(actor, link.animal.shelterId);
  return row;
}

async function loadSelectableAnimals(actor: Actor, orgId: string, animalIds: string[]) {
  const prisma = await db();
  const unique = [...new Set(animalIds)];
  const animals = await prisma.animal.findMany({ where: { organizationId: orgId, id: { in: unique }, archivedAt: null } });
  if (animals.length !== unique.length) throw notFound("One or more animals were not found.");
  for (const animal of animals) {
    assertShelterAccess(actor, animal.shelterId);
    if (animal.status === "adopted" || animal.status === "deceased" || animal.status === "transferred" || animal.status === "reunited") {
      throw new AppError(409, "animal_unavailable", `${animal.name} is not available for a new application.`);
    }
  }
  return animals;
}

async function reservationWarnings(orgId: string, animalIds: string[], applicationId: string) {
  const prisma = await db();
  const others = await prisma.applicationAnimal.findMany({
    where: { organizationId: orgId, animalId: { in: animalIds }, applicationId: { not: applicationId }, application: { status: { in: OPEN_APPLICATION_STATUSES } } },
    include: { animal: true },
  });
  return others.map((link) => ({ animalId: link.animalId, publicCode: link.animal.publicCode, name: link.animal.name }));
}

async function reserveAnimal(tx: Prisma.TransactionClient, actor: Actor, animal: { id: string; status: string; version: number; name: string; organizationId: string }) {
  if (animal.status === "adoption_pending") return;
  if (!["available", "in_foster", "intake_pending", "behavioral_assessment"].includes(animal.status)) {
    throw new AppError(409, "animal_unavailable", `${animal.name} cannot be reserved from its current status.`);
  }
  const updated = await tx.animal.updateMany({
    where: { id: animal.id, version: animal.version, status: animal.status },
    data: { status: "adoption_pending", statusBeforeAdoption: animal.status, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw conflict();
  await tx.animalStatusEvent.create({
    data: { animalId: animal.id, organizationId: animal.organizationId, fromStatus: animal.status, toStatus: "adoption_pending", note: "Reserved by an approved application", actorId: actor.userId },
  });
}

async function releaseAnimal(tx: Prisma.TransactionClient, actor: Actor, animalId: string, applicationId: string) {
  const stillReserved = await tx.applicationAnimal.count({
    where: { animalId, applicationId: { not: applicationId }, application: { status: "approved" } },
  });
  if (stillReserved) return;
  const animal = await tx.animal.findUnique({ where: { id: animalId } });
  if (!animal || animal.status !== "adoption_pending") return;
  const next = animal.statusBeforeAdoption || "available";
  await tx.animal.update({
    where: { id: animalId },
    data: { status: next, statusBeforeAdoption: null, version: { increment: 1 } },
  });
  await tx.animalStatusEvent.create({
    data: { animalId, organizationId: animal.organizationId, fromStatus: "adoption_pending", toStatus: next, note: "Adoption reservation released", actorId: actor.userId },
  });
}

function applicantData(input: ApplicantInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    preferredContact: input.preferredContact,
    addressLine1: input.addressLine1,
    city: input.city,
    region: input.region,
    postalCode: input.postalCode,
    householdAdults: input.householdAdults ?? null,
    householdChildren: input.householdChildren ?? null,
    housingType: input.housingType,
    hasYard: input.hasYard ?? null,
    otherPets: input.otherPets,
    experienceNotes: input.experienceNotes,
  };
}

function serializeApplicant(row: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  preferredContact: string;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  householdAdults: number | null;
  householdChildren: number | null;
  housingType: string | null;
  hasYard: string | null;
  otherPets: string | null;
  experienceNotes: string | null;
  redactedAt: Date | null;
  createdAt: Date;
}, actor: Actor) {
  const full = hasPermission(actor, "people.read");
  return {
    id: row.id,
    firstName: full ? row.firstName : "Restricted",
    lastName: full ? row.lastName : "",
    email: full ? row.email : null,
    phone: full ? row.phone : null,
    preferredContact: row.preferredContact,
    addressLine1: full ? row.addressLine1 : null,
    city: full ? row.city : null,
    region: full ? row.region : null,
    postalCode: full ? row.postalCode : null,
    householdAdults: row.householdAdults,
    householdChildren: row.householdChildren,
    housingType: row.housingType,
    hasYard: row.hasYard,
    otherPets: full ? row.otherPets : null,
    experienceNotes: full ? row.experienceNotes : null,
    redactedAt: row.redactedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeApplication(
  row: {
    id: string;
    status: string;
    decisionReason: string | null;
    version: number;
    submittedAt: Date | null;
    decidedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    applicant: { id: string; firstName: string; lastName: string };
    animals: { animal: { id: string; name: string; publicCode: string; species: string; status: string; shelterId: string } }[];
  },
  actor: Actor,
) {
  const seePeople = hasPermission(actor, "people.read");
  return {
    id: row.id,
    status: row.status,
    decisionReason: row.decisionReason,
    version: row.version,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    applicant: seePeople
      ? { id: row.applicant.id, name: `${row.applicant.firstName} ${row.applicant.lastName}`.trim() }
      : { id: row.applicant.id, name: "Restricted" },
    animals: row.animals.map((link) => link.animal),
  };
}

function serializeAdoption(
  adoption: {
    id: string;
    animalId: string;
    status: string;
    adoptionDate: string;
    feeCents: number | null;
    agreementSummary: string | null;
    returnedAt: Date | null;
    returnReason: string | null;
    clearanceAcknowledgement: string | null;
    createdAt: Date;
    animal?: { name: string; publicCode: string };
    applicant?: { firstName: string; lastName: string };
  },
  actor: Actor,
) {
  return {
    id: adoption.id,
    animalId: adoption.animalId,
    animalName: adoption.animal?.name ?? null,
    animalCode: adoption.animal?.publicCode ?? null,
    status: adoption.status,
    adoptionDate: adoption.adoptionDate,
    feeCents: adoption.feeCents,
    agreementSummary: adoption.agreementSummary,
    returnedAt: adoption.returnedAt?.toISOString() ?? null,
    returnReason: adoption.returnReason,
    clearanceAcknowledgement: adoption.clearanceAcknowledgement,
    applicantName: hasPermission(actor, "people.read") && adoption.applicant ? `${adoption.applicant.firstName} ${adoption.applicant.lastName}` : "Restricted",
    createdAt: adoption.createdAt.toISOString(),
  };
}

function conflict(): AppError {
  return new AppError(409, "version_conflict", "This record was changed by someone else. Reload and try again.");
}
