export const SPECIES = ["cat", "dog"] as const;
export type Species = (typeof SPECIES)[number];

export const SEXES = ["unknown", "female", "male"] as const;
export const SIZES = ["unknown", "small", "medium", "large", "xlarge"] as const;
export const ACTIVITY_LEVELS = ["unknown", "low", "moderate", "high"] as const;
export const STERILIZATION = ["unknown", "intact", "sterilized"] as const;
export const CLEARANCE = ["unknown", "pending", "cleared", "not_cleared"] as const;

export type StatusCategory = "in_care" | "outcome";

export type StatusDef = {
  key: string;
  label: string;
  category: StatusCategory;
  adoptable: boolean;
  occupancy: boolean;
  custom?: boolean;
};

export type CustomStatus = {
  key: string;
  label: string;
  category: StatusCategory;
  adoptable?: boolean;
  countsAsOccupancy?: boolean;
};

export const SYSTEM_STATUSES: StatusDef[] = [
  { key: "intake_pending", label: "Intake pending", category: "in_care", adoptable: false, occupancy: true },
  { key: "available", label: "Available for adoption", category: "in_care", adoptable: true, occupancy: true },
  { key: "medical_hold", label: "Medical hold", category: "in_care", adoptable: false, occupancy: true },
  { key: "behavioral_assessment", label: "Behavioral assessment", category: "in_care", adoptable: false, occupancy: true },
  { key: "in_foster", label: "In foster care", category: "in_care", adoptable: false, occupancy: false },
  { key: "adoption_pending", label: "Adoption pending", category: "in_care", adoptable: false, occupancy: true },
  { key: "adopted", label: "Adopted", category: "outcome", adoptable: false, occupancy: false },
  { key: "reunited", label: "Reunited with owner", category: "outcome", adoptable: false, occupancy: false },
  { key: "transferred", label: "Transferred", category: "outcome", adoptable: false, occupancy: false },
  { key: "deceased", label: "Deceased", category: "outcome", adoptable: false, occupancy: false },
];

const SYSTEM_KEYS = new Set(SYSTEM_STATUSES.map((status) => status.key));

export const DEFAULT_INTAKE_SOURCES = [
  "stray",
  "owner_surrender",
  "transfer_in",
  "born_in_care",
  "other",
] as const;

export const INTAKE_SOURCE_LABELS: Record<string, string> = {
  stray: "Stray",
  owner_surrender: "Owner surrender",
  transfer_in: "Transfer in",
  born_in_care: "Born in care",
  other: "Other",
};

export function statusCatalog(custom: CustomStatus[], labels: Record<string, string> = {}): StatusDef[] {
  const system = SYSTEM_STATUSES.map((status) => ({
    ...status,
    label: labels[status.key] || status.label,
  }));
  const extra: StatusDef[] = [];
  for (const status of custom) {
    if (SYSTEM_KEYS.has(status.key)) continue;
    extra.push({
      key: status.key,
      label: labels[status.key] || status.label,
      category: status.category,
      adoptable: Boolean(status.adoptable) && status.category === "in_care",
      occupancy: status.countsAsOccupancy !== false && status.category === "in_care",
      custom: true,
    });
  }
  return [...system, ...extra];
}

export function findStatus(catalog: StatusDef[], key: string): StatusDef | null {
  return catalog.find((status) => status.key === key) ?? null;
}

export function canTransitionStatus(from: StatusDef, to: StatusDef): boolean {
  if (from.key === to.key) return false;
  if (from.category === "outcome") return false;
  if (to.category !== "in_care") return false;
  if (to.key === "adopted") return false;
  return true;
}

export function canReturnToCare(fromKey: string): boolean {
  return fromKey === "reunited" || fromKey === "transferred";
}

export const FINALIZE_STATUSES = new Set(["available", "adoption_pending", "in_foster"]);

export function effectiveShelterMax(platformMax: number, override: number | null | undefined): number {
  const cap = Number.isFinite(platformMax) ? Math.max(1, Math.floor(platformMax)) : 1;
  if (override == null) return cap;
  const requested = Math.floor(override);
  if (!Number.isFinite(requested) || requested < 1) return cap;
  return Math.min(requested, cap);
}

export function normalizeMicrochip(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, "");
  return trimmed.length ? trimmed : null;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export type DuplicateCandidate = {
  id: string;
  publicCode: string;
  name: string;
  species: string;
  microchip: string | null;
  color: string | null;
  shelterId: string;
};

export function duplicateWarnings(
  input: { name: string; species: string; color?: string | null },
  existing: DuplicateCandidate[],
  selfId?: string,
): DuplicateCandidate[] {
  const name = normalizeName(input.name);
  const color = (input.color ?? "").trim().toLowerCase();
  return existing.filter((animal) => {
    if (selfId && animal.id === selfId) return false;
    if (normalizeName(animal.name) !== name || animal.species !== input.species) return false;
    if (!color || !animal.color) return true;
    return animal.color.trim().toLowerCase() === color;
  });
}

export function ageFromBirthDate(birthDate: string, today: string): { years: number; months: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  if (months < 0) return null;
  return { years: Math.floor(months / 12), months: months % 12 };
}

export function formatAge(years: number | null | undefined, months: number | null | undefined): string | null {
  if (years == null && months == null) return null;
  const y = years ?? 0;
  const m = months ?? 0;
  if (y <= 0 && m <= 0) return "Under 1 month";
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} yr${y === 1 ? "" : "s"}`);
  if (m > 0) parts.push(`${m} mo`);
  return parts.join(" ");
}

export function isCustomStatusKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{1,32}$/.test(key) && !SYSTEM_KEYS.has(key);
}

export function inCareKeys(catalog: StatusDef[]): string[] {
  return catalog.filter((status) => status.category === "in_care").map((status) => status.key);
}

export function occupancyKeys(catalog: StatusDef[]): string[] {
  return catalog.filter((status) => status.occupancy).map((status) => status.key);
}

export function adoptableKeys(catalog: StatusDef[]): string[] {
  return catalog.filter((status) => status.adoptable).map((status) => status.key);
}
