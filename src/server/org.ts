import type { Organization } from "@prisma/client";
import type { CustomStatus, StatusDef } from "@/domain/animals";
import { statusCatalog } from "@/domain/animals";
import { notFound } from "@/domain/errors";
import { parseJson } from "@/domain/json";
import { medicalCatalog, type MedicalCategory } from "@/domain/medical";
import { db } from "@/server/db";

export async function requireOrganization(id: string): Promise<Organization> {
  const prisma = await db();
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org || !org.active) throw notFound("Organization not found.");
  return org;
}

export function catalogFor(org: Organization): StatusDef[] {
  return statusCatalog(parseJson<CustomStatus[]>(org.customStatuses, []), parseJson<Record<string, string>>(org.statusLabels, {}));
}

export function categoriesFor(org: Organization): MedicalCategory[] {
  return medicalCatalog(parseJson<{ key: string; label: string }[]>(org.medicalCategories, []));
}

export function intakeSourcesFor(org: Organization): string[] {
  const sources = parseJson<string[]>(org.intakeSources, []);
  return sources.length ? sources : ["other"];
}

export function statusLabel(org: Organization, key: string): string {
  return catalogFor(org).find((status) => status.key === key)?.label ?? key;
}
