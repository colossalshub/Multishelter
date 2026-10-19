import type { Prisma } from "@prisma/client";
import { CLEARANCE } from "@/domain/animals";
import { isCalendarDate } from "@/domain/dates";
import { AppError, notFound } from "@/domain/errors";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/actor";
import { assertShelterAccess, requireOrg, requirePermission, scopedShelterIds } from "@/server/actor";
import { db } from "@/server/db";
import { categoriesFor, requireOrganization } from "@/server/org";
import { storeUpload } from "@/server/storage";

type MedicalInput = {
  animalId: string;
  category: string;
  occurredAt: string;
  providerName: string | null;
  providerIsVeterinarian: boolean;
  observations: string | null;
  diagnosis: string | null;
  treatment: string | null;
  medicationName: string | null;
  dose: string | null;
  instructions: string | null;
  startDate?: string | null;
  endDate?: string | null;
  nextFollowUpAt?: string | null;
  allergies: string | null;
  notes: string | null;
  updateSterilizationStatus?: "unknown" | "intact" | "sterilized" | null;
  clearance?: { status: (typeof CLEARANCE)[number]; basis: string | null } | null;
};

export async function listMedicalRecords(
  actor: Actor,
  query: { animalId?: string; category?: string; shelterId?: string; from?: string; to?: string; page?: number; pageSize?: number },
) {
  requirePermission(actor, "medical.read");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const shelterIds = scopedShelterIds(actor, query.shelterId);
  const where: Prisma.MedicalRecordWhereInput = {
    organizationId: orgId,
    ...(query.animalId ? { animalId: query.animalId } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(shelterIds ? { shelterId: { in: shelterIds } } : {}),
  };
  if (query.from || query.to) {
    where.occurredAt = {};
    if (query.from) where.occurredAt.gte = new Date(query.from);
    if (query.to) where.occurredAt.lte = new Date(query.to);
  }
  const [total, rows] = await Promise.all([
    prisma.medicalRecord.count({ where }),
    prisma.medicalRecord.findMany({
      where,
      include: { animal: true, enteredBy: true },
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { items: rows.map(serializeRecord), page, pageSize, total };
}

export async function getMedicalRecord(actor: Actor, id: string) {
  requirePermission(actor, "medical.read");
  const record = await loadRecord(actor, id);
  const prisma = await db();
  const [attachments, administrations, corrections] = await Promise.all([
    prisma.medicalAttachment.findMany({ where: { medicalRecordId: id }, orderBy: { createdAt: "asc" } }),
    prisma.medicationAdministration.findMany({ where: { medicalRecordId: id }, include: { administeredBy: true }, orderBy: { administeredAt: "desc" } }),
    prisma.medicalRecord.findMany({ where: { OR: [{ id: record.correctionOfId ?? id }, { correctionOfId: record.correctionOfId ?? id }, { id: record.id }] }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    ...serializeRecord(record),
    attachments: attachments.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      url: `/api/files/medical/${file.id}`,
    })),
    administrations: administrations.map((item) => ({
      id: item.id,
      administeredAt: item.administeredAt.toISOString(),
      notes: item.notes,
      administeredBy: item.administeredBy.name,
    })),
    history: corrections.map((item) => ({ id: item.id, occurredAt: item.occurredAt.toISOString(), supersededAt: item.supersededAt?.toISOString() ?? null })),
  };
}

export async function createMedicalRecord(actor: Actor, input: MedicalInput) {
  requirePermission(actor, "medical.write");
  const orgId = requireOrg(actor);
  const org = await requireOrganization(orgId);
  validateClinical(input, categoriesFor(org).map((category) => category.key));
  const prisma = await db();
  const animal = await prisma.animal.findFirst({ where: { id: input.animalId, organizationId: orgId } });
  if (!animal || animal.archivedAt) throw notFound("Animal not found.");
  assertShelterAccess(actor, animal.shelterId);
  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.medicalRecord.create({
      data: { ...recordData(input), organizationId: orgId, shelterId: animal.shelterId, animalId: animal.id, enteredById: actor.userId },
      include: { animal: true, enteredBy: true },
    });
    if (input.nextFollowUpAt) {
      await tx.careTask.create({
        data: {
          organizationId: orgId,
          shelterId: animal.shelterId,
          animalId: animal.id,
          medicalRecordId: created.id,
          kind: input.category === "vaccination" ? "follow_up" : input.category === "medication" ? "medication_reminder" : "appointment",
          title: followUpTitle(input.category, input.medicationName),
          dueAt: new Date(input.nextFollowUpAt),
          createdById: actor.userId,
        },
      });
    }
    if (input.updateSterilizationStatus) {
      await tx.animal.update({ where: { id: animal.id }, data: { sterilizationStatus: input.updateSterilizationStatus, version: { increment: 1 } } });
    }
    if (input.clearance) {
      await applyClearance(tx, animal.id, actor.userId, input.clearance.status, input.clearance.basis);
    }
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "medical.created",
      entityType: "medical_record",
      entityId: created.id,
      metadata: { animalId: animal.id, category: input.category },
      ip: actor.ip,
    });
    return created;
  });
  return serializeRecord(record);
}

export async function correctMedicalRecord(actor: Actor, id: string, input: MedicalInput) {
  requirePermission(actor, "medical.write");
  const orgId = requireOrg(actor);
  const org = await requireOrganization(orgId);
  validateClinical(input, categoriesFor(org).map((category) => category.key));
  const current = await loadRecord(actor, id);
  if (current.supersededAt) throw new AppError(409, "already_corrected", "Correct the latest version of this record.");
  const prisma = await db();
  const record = await prisma.$transaction(async (tx) => {
    const marked = await tx.medicalRecord.updateMany({
      where: { id: current.id, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    if (marked.count !== 1) throw new AppError(409, "already_corrected", "Correct the latest version of this record.");
    const created = await tx.medicalRecord.create({
      data: {
        ...recordData(input),
        organizationId: orgId,
        shelterId: current.shelterId,
        animalId: current.animalId,
        correctionOfId: current.id,
        enteredById: actor.userId,
      },
      include: { animal: true, enteredBy: true },
    });
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "medical.corrected",
      entityType: "medical_record",
      entityId: created.id,
      metadata: { corrects: current.id, animalId: current.animalId },
      ip: actor.ip,
    });
    return created;
  });
  return serializeRecord(record);
}

export async function addMedicalAttachment(actor: Actor, id: string, fileName: string, bytes: Buffer) {
  requirePermission(actor, "medical.write");
  const record = await loadRecord(actor, id);
  const stored = await storeUpload(record.organizationId, bytes, "document");
  const prisma = await db();
  const file = await prisma.medicalAttachment.create({
    data: {
      medicalRecordId: record.id,
      organizationId: record.organizationId,
      storageKey: stored.storageKey,
      fileName: fileName.slice(0, 120) || "document",
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      createdById: actor.userId,
    },
  });
  return { id: file.id, fileName: file.fileName, url: `/api/files/medical/${file.id}` };
}

export async function getMedicalAttachment(actor: Actor, id: string) {
  requirePermission(actor, "medical.read");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const file = await prisma.medicalAttachment.findFirst({ where: { id, organizationId: orgId }, include: { medicalRecord: true } });
  if (!file) throw notFound();
  assertShelterAccess(actor, file.medicalRecord.shelterId);
  return file;
}

export async function recordAdministration(actor: Actor, id: string, input: { administeredAt: string; notes: string | null }) {
  requirePermission(actor, "medical.write");
  const record = await loadRecord(actor, id);
  if (record.supersededAt) throw new AppError(409, "already_corrected", "Record administration on the latest version.");
  const when = new Date(input.administeredAt);
  if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new AppError(400, "validation_error", "Administration time cannot be in the future.", { fields: { administeredAt: "Choose a valid time." } });
  }
  const prisma = await db();
  const created = await prisma.medicationAdministration.create({
    data: {
      organizationId: record.organizationId,
      medicalRecordId: record.id,
      animalId: record.animalId,
      administeredAt: when,
      administeredById: actor.userId,
      notes: input.notes,
    },
  });
  await audit(prisma, {
    organizationId: record.organizationId,
    actorId: actor.userId,
    action: "medication.administered",
    entityType: "medical_record",
    entityId: record.id,
    metadata: { administrationId: created.id, animalId: record.animalId },
    ip: actor.ip,
  });
  return { id: created.id, administeredAt: created.administeredAt.toISOString() };
}

export async function setClearance(actor: Actor, animalId: string, input: { status: (typeof CLEARANCE)[number]; basis: string | null; version: number }) {
  requirePermission(actor, "medical.write");
  const orgId = requireOrg(actor);
  if (input.status !== "unknown" && !input.basis) {
    throw new AppError(400, "validation_error", "Record the basis for this clearance decision.", { fields: { basis: "Enter the recorded basis." } });
  }
  const prisma = await db();
  const animal = await prisma.animal.findFirst({ where: { id: animalId, organizationId: orgId } });
  if (!animal) throw notFound();
  assertShelterAccess(actor, animal.shelterId);
  await prisma.$transaction(async (tx) => {
    const result = await tx.animal.updateMany({
      where: { id: animalId, organizationId: orgId, version: input.version },
      data: {
        medicalClearance: input.status,
        medicalClearanceBasis: input.status === "unknown" ? null : input.basis,
        medicalClearanceAt: new Date(),
        medicalClearanceById: actor.userId,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new AppError(409, "version_conflict", "This record was changed by someone else. Reload and try again.");
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "clearance.updated",
      entityType: "animal",
      entityId: animalId,
      metadata: { status: input.status },
      ip: actor.ip,
    });
  });
  return { ok: true };
}

export async function listCareTasks(actor: Actor, query: { status?: string; shelterId?: string; animalId?: string; due?: "overdue" | "upcoming" | "open" }) {
  requirePermission(actor, "tasks.read");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const shelterIds = scopedShelterIds(actor, query.shelterId);
  const now = new Date();
  const where: Prisma.CareTaskWhereInput = {
    organizationId: orgId,
    ...(shelterIds ? { shelterId: { in: shelterIds } } : {}),
    ...(query.animalId ? { animalId: query.animalId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  if (query.due === "overdue") {
    where.status = "open";
    where.dueAt = { lt: now };
  } else if (query.due === "upcoming") {
    where.status = "open";
    where.dueAt = { gte: now };
  } else if (query.due === "open") {
    where.status = "open";
  }
  const tasks = await prisma.careTask.findMany({
    where,
    include: { animal: true },
    orderBy: { dueAt: "asc" },
    take: 200,
  });
  return tasks.map((task) => serializeTask(task, now));
}

export async function createCareTask(
  actor: Actor,
  input: { animalId: string; medicalRecordId?: string | null; kind: "appointment" | "follow_up" | "medication_reminder"; title: string; dueAt: string; notes: string | null },
) {
  requirePermission(actor, "tasks.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const animal = await prisma.animal.findFirst({ where: { id: input.animalId, organizationId: orgId } });
  if (!animal) throw notFound("Animal not found.");
  assertShelterAccess(actor, animal.shelterId);
  if (input.medicalRecordId) {
    const record = await prisma.medicalRecord.findFirst({ where: { id: input.medicalRecordId, organizationId: orgId, animalId: animal.id } });
    if (!record) throw notFound("Medical record not found.");
  }
  const due = new Date(input.dueAt);
  if (Number.isNaN(due.getTime())) throw new AppError(400, "validation_error", "Enter a valid due date.", { fields: { dueAt: "Enter a valid due date." } });
  const task = await prisma.careTask.create({
    data: {
      organizationId: orgId,
      shelterId: animal.shelterId,
      animalId: animal.id,
      medicalRecordId: input.medicalRecordId ?? null,
      kind: input.kind,
      title: input.title,
      dueAt: due,
      notes: input.notes,
      createdById: actor.userId,
    },
    include: { animal: true },
  });
  await audit(prisma, {
    organizationId: orgId,
    actorId: actor.userId,
    action: "task.created",
    entityType: "care_task",
    entityId: task.id,
    metadata: { animalId: animal.id, kind: task.kind },
    ip: actor.ip,
  });
  return serializeTask(task, new Date());
}

export async function completeCareTask(actor: Actor, id: string, input: { notes: string | null }, status: "completed" | "cancelled") {
  requirePermission(actor, "tasks.write");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const task = await prisma.careTask.findFirst({ where: { id, organizationId: orgId }, include: { animal: true } });
  if (!task) throw notFound();
  assertShelterAccess(actor, task.shelterId);
  if (task.status !== "open") throw new AppError(409, "task_closed", "This task is already closed.");
  const updated = await prisma.careTask.update({
    where: { id },
    data: {
      status,
      notes: input.notes ?? task.notes,
      completedAt: status === "completed" ? new Date() : null,
      completedById: status === "completed" ? actor.userId : null,
    },
    include: { animal: true },
  });
  await audit(prisma, {
    organizationId: orgId,
    actorId: actor.userId,
    action: status === "completed" ? "task.completed" : "task.cancelled",
    entityType: "care_task",
    entityId: id,
    metadata: { animalId: task.animalId },
    ip: actor.ip,
  });
  return serializeTask(updated, new Date());
}

function validateClinical(input: MedicalInput, allowed: string[]) {
  if (!allowed.includes(input.category)) {
    throw new AppError(400, "validation_error", "Choose a medical category.", { fields: { category: "Choose a category." } });
  }
  const when = new Date(input.occurredAt);
  if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new AppError(400, "validation_error", "Enter a valid visit date.", { fields: { occurredAt: "Enter a valid date." } });
  }
  if (input.diagnosis && !input.providerIsVeterinarian) {
    throw new AppError(400, "validation_error", "A diagnosis can be recorded only when a veterinary professional provided it.", {
      fields: { diagnosis: "Confirm the veterinary professional or remove the diagnosis." },
    });
  }
  if (input.providerIsVeterinarian && !input.providerName) {
    throw new AppError(400, "validation_error", "Enter the veterinary professional's name.", { fields: { providerName: "Enter the provider's name." } });
  }
  if (input.startDate && !isCalendarDate(input.startDate)) {
    throw new AppError(400, "validation_error", "Enter a valid start date.", { fields: { startDate: "Use YYYY-MM-DD." } });
  }
  if (input.endDate && !isCalendarDate(input.endDate)) {
    throw new AppError(400, "validation_error", "Enter a valid end date.", { fields: { endDate: "Use YYYY-MM-DD." } });
  }
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw new AppError(400, "validation_error", "End date cannot be before the start date.", { fields: { endDate: "Choose an end date on or after the start date." } });
  }
  if (input.clearance && input.clearance.status !== "unknown" && !input.clearance.basis) {
    throw new AppError(400, "validation_error", "Record the basis for medical clearance.", { fields: { "clearance.basis": "Enter the recorded basis." } });
  }
}

function recordData(input: MedicalInput) {
  return {
    category: input.category,
    occurredAt: new Date(input.occurredAt),
    providerName: input.providerName,
    providerIsVeterinarian: input.providerIsVeterinarian,
    observations: input.observations,
    diagnosis: input.providerIsVeterinarian ? input.diagnosis : null,
    treatment: input.treatment,
    medicationName: input.medicationName,
    dose: input.dose,
    instructions: input.instructions,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null,
    allergies: input.allergies,
    notes: input.notes,
  };
}

function applyClearance(tx: Prisma.TransactionClient, animalId: string, userId: string, status: string, basis: string | null) {
  return tx.animal.update({
    where: { id: animalId },
    data: {
      medicalClearance: status,
      medicalClearanceBasis: status === "unknown" ? null : basis,
      medicalClearanceAt: new Date(),
      medicalClearanceById: userId,
      version: { increment: 1 },
    },
  });
}

function followUpTitle(category: string, medicationName: string | null): string {
  if (category === "vaccination") return "Vaccination follow-up";
  if (category === "medication") return medicationName ? `Medication reminder: ${medicationName}` : "Medication reminder";
  return "Follow-up appointment";
}

async function loadRecord(actor: Actor, id: string) {
  const orgId = requireOrg(actor);
  const prisma = await db();
  const record = await prisma.medicalRecord.findFirst({ where: { id, organizationId: orgId }, include: { animal: true, enteredBy: true } });
  if (!record) throw notFound();
  assertShelterAccess(actor, record.shelterId);
  return record;
}

function serializeRecord(record: {
  id: string;
  animalId: string;
  shelterId: string;
  category: string;
  occurredAt: Date;
  providerName: string | null;
  providerIsVeterinarian: boolean;
  observations: string | null;
  diagnosis: string | null;
  treatment: string | null;
  medicationName: string | null;
  dose: string | null;
  instructions: string | null;
  startDate: string | null;
  endDate: string | null;
  nextFollowUpAt: Date | null;
  allergies: string | null;
  notes: string | null;
  correctionOfId: string | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  animal?: { name: string; publicCode: string };
  enteredBy?: { name: string };
}) {
  return {
    id: record.id,
    animalId: record.animalId,
    animalName: record.animal?.name ?? null,
    animalCode: record.animal?.publicCode ?? null,
    shelterId: record.shelterId,
    category: record.category,
    occurredAt: record.occurredAt.toISOString(),
    providerName: record.providerName,
    providerIsVeterinarian: record.providerIsVeterinarian,
    observations: record.observations,
    diagnosis: record.diagnosis,
    treatment: record.treatment,
    medicationName: record.medicationName,
    dose: record.dose,
    instructions: record.instructions,
    startDate: record.startDate,
    endDate: record.endDate,
    nextFollowUpAt: record.nextFollowUpAt?.toISOString() ?? null,
    allergies: record.allergies,
    notes: record.notes,
    correctionOfId: record.correctionOfId,
    supersededAt: record.supersededAt?.toISOString() ?? null,
    enteredBy: record.enteredBy?.name ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    disclaimer: "Shelter staff are recording information. PawHaven does not generate diagnoses or treatment recommendations.",
  };
}

function serializeTask(task: { id: string; animalId: string; shelterId: string; kind: string; title: string; dueAt: Date; status: string; notes: string | null; animal?: { name: string; publicCode: string } }, now: Date) {
  const overdue = task.status === "open" && task.dueAt.getTime() < now.getTime();
  return {
    id: task.id,
    animalId: task.animalId,
    animalName: task.animal?.name ?? null,
    animalCode: task.animal?.publicCode ?? null,
    shelterId: task.shelterId,
    kind: task.kind,
    title: task.title,
    dueAt: task.dueAt.toISOString(),
    status: task.status,
    overdue,
    reminder: overdue ? "Overdue reminder. Qualified staff determine clinical urgency." : null,
    notes: task.notes,
  };
}
