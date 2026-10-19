import { occupancyKeys } from "@/domain/animals";
import { toCsv } from "@/domain/csv";
import { AppError } from "@/domain/errors";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/actor";
import { hasPermission, requireOrg, requirePermission, scopedShelterIds } from "@/server/actor";
import { db } from "@/server/db";
import { catalogFor, requireOrganization, statusLabel } from "@/server/org";

export type ReportType =
  | "population"
  | "intake_outcomes"
  | "adoptions"
  | "turnaround"
  | "follow_ups"
  | "treatments"
  | "occupancy"
  | "transfers"
  | "audit";

export type ReportFilters = {
  type: ReportType;
  shelterId?: string;
  from?: string;
  to?: string;
  species?: string;
  status?: string;
};

type Report = { title: string; columns: string[]; rows: unknown[][] };

const REPORTS: { type: ReportType; title: string; permission: "reports.read" | "audit.read"; extra?: "adoptions.read" | "medical.read" | "tasks.read" }[] = [
  { type: "population", title: "Animal population by shelter", permission: "reports.read" },
  { type: "intake_outcomes", title: "Intake and outcomes", permission: "reports.read" },
  { type: "adoptions", title: "Adoption applications and outcomes", permission: "reports.read", extra: "adoptions.read" },
  { type: "turnaround", title: "Adoption turnaround", permission: "reports.read", extra: "adoptions.read" },
  { type: "follow_ups", title: "Appointments and follow-ups", permission: "reports.read", extra: "tasks.read" },
  { type: "treatments", title: "Vaccination and treatment records", permission: "reports.read", extra: "medical.read" },
  { type: "occupancy", title: "Shelter occupancy and capacity", permission: "reports.read" },
  { type: "transfers", title: "Transfers between shelters", permission: "reports.read" },
  { type: "audit", title: "Activity and audit history", permission: "audit.read" },
];

export function availableReports(actor: Actor) {
  return REPORTS.filter((report) => actor.permissions.has(report.permission) && (!report.extra || actor.permissions.has(report.extra))).map((report) => ({
    type: report.type,
    title: report.title,
  }));
}

export async function runReport(actor: Actor, filters: ReportFilters): Promise<Report> {
  const definition = REPORTS.find((report) => report.type === filters.type);
  if (!definition) throw new AppError(404, "not_found", "Unknown report.");
  if (!actor.permissions.has(definition.permission) || (definition.extra && !actor.permissions.has(definition.extra))) {
    throw new AppError(403, "forbidden", "You do not have permission to view this report.");
  }
  const orgId = requireOrg(actor);
  const org = await requireOrganization(orgId);
  const shelterIds = scopedShelterIds(actor, filters.shelterId);
  const range = dateRange(filters.from, filters.to);
  switch (filters.type) {
    case "population":
      return population(orgId, shelterIds, filters, org);
    case "intake_outcomes":
      return intakeOutcomes(orgId, shelterIds, range, filters, org);
    case "adoptions":
      return adoptions(actor, orgId, shelterIds, range, filters);
    case "turnaround":
      return turnaround(orgId, shelterIds, range);
    case "follow_ups":
      return followUps(orgId, shelterIds, range);
    case "treatments":
      return treatments(orgId, shelterIds, range, filters);
    case "occupancy":
      return occupancy(orgId, shelterIds, org);
    case "transfers":
      return transfers(orgId, shelterIds, range);
    case "audit":
      return auditReport(orgId, range);
    default:
      throw new AppError(404, "not_found", "Unknown report.");
  }
}

export async function exportReport(actor: Actor, filters: ReportFilters): Promise<{ filename: string; csv: string }> {
  requirePermission(actor, "reports.export");
  const report = await runReport(actor, filters);
  const prisma = await db();
  await audit(prisma, {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "report.exported",
    entityType: "report",
    entityId: filters.type,
    metadata: { type: filters.type },
    ip: actor.ip,
  });
  return { filename: `${filters.type}.csv`, csv: toCsv(report.columns, report.rows) };
}

function dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
  };
}

async function population(orgId: string, shelterIds: string[] | undefined, filters: ReportFilters, org: { timezone: string }): Promise<Report> {
  const prisma = await db();
  const catalog = catalogFor(org as Parameters<typeof catalogFor>[0]);
  const care = catalog.filter((status) => status.category === "in_care").map((status) => status.key);
  const rows = await prisma.animal.groupBy({
    by: ["shelterId", "species", "status"],
    where: {
      organizationId: orgId,
      archivedAt: null,
      status: filters.status ? filters.status : { in: care },
      ...(filters.species ? { species: filters.species } : {}),
      ...(shelterIds ? { shelterId: { in: shelterIds } } : {}),
    },
    _count: { _all: true },
  });
  const shelters = await prisma.shelter.findMany({ where: { organizationId: orgId } });
  const names = new Map(shelters.map((shelter) => [shelter.id, shelter.name]));
  return {
    title: "Animal population by shelter",
    columns: ["Shelter", "Species", "Status", "Count"],
    rows: rows.map((row) => [names.get(row.shelterId) ?? row.shelterId, row.species, statusLabel(org as Parameters<typeof statusLabel>[0], row.status), row._count._all]),
  };
}

async function intakeOutcomes(orgId: string, shelterIds: string[] | undefined, range: { gte?: Date; lte?: Date } | undefined, filters: ReportFilters, org: Parameters<typeof statusLabel>[0]): Promise<Report> {
  const prisma = await db();
  const intakes = await prisma.animal.findMany({
    where: {
      organizationId: orgId,
      ...(range ? { intakeDate: range } : {}),
      ...(filters.species ? { species: filters.species } : {}),
      ...(shelterIds ? { shelterId: { in: shelterIds } } : {}),
    },
    include: { shelter: true },
    orderBy: { intakeDate: "desc" },
    take: 1000,
  });
  const outcomes = await prisma.animalStatusEvent.findMany({
    where: {
      organizationId: orgId,
      toStatus: { in: ["adopted", "reunited", "transferred", "deceased"] },
      ...(range ? { createdAt: range } : {}),
      ...(shelterIds ? { animal: { shelterId: { in: shelterIds } } } : {}),
    },
    include: { animal: { include: { shelter: true } } },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const rows = [
    ...intakes.map((animal) => ["Intake", animal.publicCode, animal.name, animal.species, animal.shelter.name, animal.intakeSource, animal.intakeDate.toISOString().slice(0, 10)]),
    ...outcomes.map((event) => ["Outcome", event.animal.publicCode, event.animal.name, event.animal.species, event.animal.shelter.name, statusLabel(org, event.toStatus), event.createdAt.toISOString().slice(0, 10)]),
  ];
  return { title: "Intake and outcomes", columns: ["Kind", "Animal ID", "Name", "Species", "Shelter", "Detail", "Date"], rows };
}

async function adoptions(actor: Actor, orgId: string, shelterIds: string[] | undefined, range: { gte?: Date; lte?: Date } | undefined, filters: ReportFilters): Promise<Report> {
  const prisma = await db();
  const rows = await prisma.adoptionApplication.findMany({
    where: {
      organizationId: orgId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(range ? { createdAt: range } : {}),
      ...(shelterIds ? { animals: { some: { animal: { shelterId: { in: shelterIds } } } } } : {}),
    },
    include: { applicant: true, animals: { include: { animal: true } } },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const seePeople = hasPermission(actor, "people.read");
  return {
    title: "Adoption applications and outcomes",
    columns: ["Application", "Status", "Applicant", "Animals", "Submitted", "Decided"],
    rows: rows.map((row) => [
      row.id,
      row.status,
      seePeople ? `${row.applicant.firstName} ${row.applicant.lastName}` : "Restricted",
      row.animals.map((link) => link.animal.publicCode).join(" "),
      row.submittedAt?.toISOString().slice(0, 10) ?? "",
      row.decidedAt?.toISOString().slice(0, 10) ?? "",
    ]),
  };
}

async function turnaround(orgId: string, shelterIds: string[] | undefined, range: { gte?: Date; lte?: Date } | undefined): Promise<Report> {
  const prisma = await db();
  const rows = await prisma.adoption.findMany({
    where: { organizationId: orgId, ...(range ? { createdAt: range } : {}), ...(shelterIds ? { shelterId: { in: shelterIds } } : {}) },
    include: { application: true, animal: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const mapped = rows.map((row) => {
    const start = row.application.submittedAt ?? row.application.createdAt;
    const days = Math.max(0, Math.round((row.createdAt.getTime() - start.getTime()) / 86400000));
    return [row.animal.publicCode, row.animal.name, row.adoptionDate, start.toISOString().slice(0, 10), days];
  });
  const average = mapped.length ? Math.round(mapped.reduce((sum, row) => sum + Number(row[4]), 0) / mapped.length) : 0;
  return {
    title: "Adoption turnaround",
    columns: ["Animal ID", "Name", "Adoption date", "Submitted", "Days"],
    rows: [[ "Average", "", "", "", average ], ...mapped],
  };
}

async function followUps(orgId: string, shelterIds: string[] | undefined, range: { gte?: Date; lte?: Date } | undefined): Promise<Report> {
  const prisma = await db();
  const tasks = await prisma.careTask.findMany({
    where: { organizationId: orgId, ...(range ? { dueAt: range } : {}), ...(shelterIds ? { shelterId: { in: shelterIds } } : {}) },
    include: { animal: true, shelter: true },
    orderBy: { dueAt: "asc" },
    take: 1000,
  });
  const now = Date.now();
  return {
    title: "Appointments and follow-ups",
    columns: ["Due", "Animal ID", "Animal", "Shelter", "Kind", "Title", "Status", "Reminder"],
    rows: tasks.map((task) => [
      task.dueAt.toISOString(),
      task.animal.publicCode,
      task.animal.name,
      task.shelter.name,
      task.kind,
      task.title,
      task.status,
      task.status === "open" && task.dueAt.getTime() < now ? "Overdue reminder" : "",
    ]),
  };
}

async function treatments(orgId: string, shelterIds: string[] | undefined, range: { gte?: Date; lte?: Date } | undefined, filters: ReportFilters): Promise<Report> {
  const prisma = await db();
  const records = await prisma.medicalRecord.findMany({
    where: {
      organizationId: orgId,
      category: filters.status ? filters.status : { in: ["vaccination", "medication", "deworming", "flea_tick", "procedure", "sterilization", "treatment_plan"] },
      ...(range ? { occurredAt: range } : {}),
      ...(shelterIds ? { shelterId: { in: shelterIds } } : {}),
      ...(filters.species ? { animal: { species: filters.species } } : {}),
    },
    include: { animal: true },
    orderBy: { occurredAt: "desc" },
    take: 1000,
  });
  return {
    title: "Vaccination and treatment records",
    columns: ["Date", "Animal ID", "Animal", "Category", "Medication", "Provider", "Next follow-up", "Corrected"],
    rows: records.map((record) => [
      record.occurredAt.toISOString().slice(0, 10),
      record.animal.publicCode,
      record.animal.name,
      record.category,
      record.medicationName ?? "",
      record.providerName ?? "",
      record.nextFollowUpAt?.toISOString().slice(0, 10) ?? "",
      record.supersededAt ? "yes" : "",
    ]),
  };
}

async function occupancy(orgId: string, shelterIds: string[] | undefined, org: Parameters<typeof catalogFor>[0]): Promise<Report> {
  const prisma = await db();
  const keys = occupancyKeys(catalogFor(org));
  const shelters = await prisma.shelter.findMany({ where: { organizationId: orgId, ...(shelterIds ? { id: { in: shelterIds } } : {}) }, orderBy: { name: "asc" } });
  const rows = [];
  for (const shelter of shelters) {
    const count = await prisma.animal.count({ where: { shelterId: shelter.id, archivedAt: null, status: { in: keys } } });
    rows.push([shelter.name, shelter.capacity ?? "", count, shelter.capacity != null ? shelter.capacity - count : ""]);
  }
  return { title: "Shelter occupancy and capacity", columns: ["Shelter", "Capacity", "Occupancy", "Open spaces"], rows };
}

async function transfers(orgId: string, shelterIds: string[] | undefined, range: { gte?: Date; lte?: Date } | undefined): Promise<Report> {
  const prisma = await db();
  const rows = await prisma.animalTransfer.findMany({
    where: {
      organizationId: orgId,
      ...(range ? { createdAt: range } : {}),
      ...(shelterIds ? { OR: [{ fromShelterId: { in: shelterIds } }, { toShelterId: { in: shelterIds } }] } : {}),
    },
    include: { animal: true, fromShelter: true, toShelter: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  return {
    title: "Transfers between shelters",
    columns: ["Date", "Animal ID", "Animal", "Kind", "From", "To", "Reason"],
    rows: rows.map((row) => [
      row.createdAt.toISOString().slice(0, 10),
      row.animal.publicCode,
      row.animal.name,
      row.kind,
      row.fromShelter.name,
      row.toShelter?.name ?? row.externalDestination ?? "",
      row.reason,
    ]),
  };
}

async function auditReport(orgId: string, range: { gte?: Date; lte?: Date } | undefined): Promise<Report> {
  const prisma = await db();
  const rows = await prisma.auditEvent.findMany({
    where: { organizationId: orgId, ...(range ? { createdAt: range } : {}) },
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  return {
    title: "Activity and audit history",
    columns: ["When", "Actor", "Action", "Entity", "Entity ID"],
    rows: rows.map((row) => [row.createdAt.toISOString(), row.actor?.name ?? "System", row.action, row.entityType, row.entityId ?? ""]),
  };
}
