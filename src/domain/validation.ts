import { z } from "zod";
import { ACTIVITY_LEVELS, CLEARANCE, SEXES, SIZES, SPECIES, STERILIZATION, isCustomStatusKey } from "@/domain/animals";
import { APPLICATION_STATUSES } from "@/domain/adoptions";
import { isCalendarDate, isTimeZone, DATE_FORMATS } from "@/domain/dates";
import { validationError } from "@/domain/errors";
import { isMedicalCategoryKey } from "@/domain/medical";
import { ORG_ROLES } from "@/domain/permissions";

const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.null(), z.undefined()]).transform((value) => (value ? value : null));

const optionalEmail = z
  .union([z.string().trim().email().max(200), z.literal(""), z.null(), z.undefined()])
  .transform((value) => value || null);

const calendarDate = z
  .string()
  .trim()
  .refine(isCalendarDate, "Enter a valid date as YYYY-MM-DD.")
  .nullable()
  .optional();

const requiredCalendarDate = z.string().trim().refine(isCalendarDate, "Enter a valid date as YYYY-MM-DD.");

const instant = z.string().datetime({ offset: true }).or(z.string().datetime());

export const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

export const platformSettingsSchema = z.object({
  maxSheltersPerOrganization: z.number().int().min(1).max(50),
  platformName: z.string().trim().min(2).max(80),
  supportEmail: optionalText(200),
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens.")
    .max(60)
    .optional(),
  timezone: z.string().trim().refine(isTimeZone, "Choose a valid time zone.").optional(),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().email().max(200),
  adminPassword: z.string().min(10).max(200).optional(),
});

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: optionalText(160),
  email: optionalEmail,
  phone: optionalText(40),
  website: optionalText(200),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  region: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color such as #1f6b4a."),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color such as #b85a28."),
  timezone: z.string().trim().refine(isTimeZone, "Choose a valid time zone."),
  locale: z.string().trim().min(2).max(20),
  dateFormat: z.enum(DATE_FORMATS),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code."),
  adoptionFeeEnabled: z.boolean(),
  defaultAdoptionFeeCents: z.number().int().min(0).max(10_000_000).nullable(),
  intakeSources: z.array(z.string().trim().min(1).max(40)).min(1).max(30),
  customStatuses: z
    .array(
      z.object({
        key: z.string().refine(isCustomStatusKey, "Use a lowercase key that does not replace a system status."),
        label: z.string().trim().min(2).max(60),
        category: z.enum(["in_care", "outcome"]),
        adoptable: z.boolean().optional(),
        countsAsOccupancy: z.boolean().optional(),
      }),
    )
    .max(20),
  statusLabels: z.record(z.string().trim().min(1).max(60)).optional(),
  medicalCategories: z
    .array(
      z.object({
        key: z.string().refine(isMedicalCategoryKey, "Use a lowercase category key."),
        label: z.string().trim().min(2).max(80),
      }),
    )
    .max(30),
  adoptionStatusLabels: z.record(z.string().trim().min(1).max(60)).optional(),
  adoptionAgreement: z.string().max(8000).optional().default(""),
  reminderLeadDays: z.number().int().min(0).max(30),
});

export const shelterSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: optionalText(20),
  email: optionalEmail,
  phone: optionalText(40),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  region: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
  capacity: z.number().int().min(1).max(100000).nullable(),
  notes: optionalText(2000),
  active: z.boolean().optional(),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  role: z.enum(ORG_ROLES),
  shelterIds: z.array(z.string().min(1)).max(3),
  password: z.string().min(10).max(200).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ORG_ROLES).optional(),
  shelterIds: z.array(z.string().min(1)).max(3).optional(),
  active: z.boolean().optional(),
});

export const permissionMatrixSchema = z.object({
  roles: z.array(
    z.object({
      role: z.enum(ORG_ROLES),
      permissions: z.array(z.string()),
    }),
  ),
});

export const animalWriteSchema = z.object({
  shelterId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  species: z.enum(SPECIES),
  breed: optionalText(80),
  breedUnknown: z.boolean().optional().default(false),
  sex: z.enum(SEXES).default("unknown"),
  birthDate: calendarDate,
  birthDateEstimated: z.boolean().optional().default(true),
  estimatedAgeYears: z.number().int().min(0).max(40).nullable().optional(),
  estimatedAgeMonths: z.number().int().min(0).max(11).nullable().optional(),
  color: optionalText(80),
  distinguishingFeatures: optionalText(500),
  microchip: optionalText(40),
  intakeDate: instant,
  intakeSource: z.string().trim().min(1).max(40),
  previousOwnerName: optionalText(120),
  previousOwnerPhone: optionalText(40),
  previousOwnerEmail: optionalEmail,
  previousOwnerNotes: optionalText(1000),
  housingLocation: optionalText(80),
  temperament: optionalText(1000),
  specialHandling: optionalText(1000),
  dietaryNeeds: optionalText(1000),
  sterilizationStatus: z.enum(STERILIZATION).default("unknown"),
  identificationTags: optionalText(200),
  notes: optionalText(5000),
  size: z.enum(SIZES).default("unknown"),
  activityLevel: z.enum(ACTIVITY_LEVELS).default("unknown"),
  weightKg: z.number().min(0).max(200).nullable().optional(),
  acknowledgeDuplicates: z.boolean().optional().default(false),
  version: z.number().int().positive().optional(),
});

export const statusChangeSchema = z.object({
  status: z.string().trim().min(1).max(40),
  note: optionalText(1000),
  version: z.number().int().positive(),
});

export const outcomeSchema = z.object({
  type: z.enum(["deceased", "reunited", "external_transfer", "return_to_care"]),
  note: optionalText(2000),
  destination: optionalText(160),
  shelterId: z.string().min(1).optional(),
  version: z.number().int().positive(),
});

export const transferSchema = z.object({
  toShelterId: z.string().min(1),
  reason: z.string().trim().min(2).max(1000),
  version: z.number().int().positive(),
});

export const archiveSchema = z.object({
  reason: z.string().trim().min(2).max(1000),
  version: z.number().int().positive(),
});

export const medicalWriteSchema = z.object({
  animalId: z.string().min(1),
  category: z.string().trim().min(1).max(40),
  occurredAt: instant,
  providerName: optionalText(160),
  providerIsVeterinarian: z.boolean().default(false),
  observations: optionalText(8000),
  diagnosis: optionalText(4000),
  treatment: optionalText(4000),
  medicationName: optionalText(160),
  dose: optionalText(500),
  instructions: optionalText(2000),
  startDate: calendarDate,
  endDate: calendarDate,
  nextFollowUpAt: instant.nullable().optional(),
  allergies: optionalText(2000),
  notes: optionalText(5000),
  updateSterilizationStatus: z.enum(STERILIZATION).nullable().optional(),
  clearance: z
    .object({
      status: z.enum(CLEARANCE),
      basis: optionalText(2000),
    })
    .nullable()
    .optional(),
});

export const administrationSchema = z.object({
  administeredAt: instant,
  notes: optionalText(2000),
});

export const clearanceSchema = z.object({
  status: z.enum(CLEARANCE),
  basis: optionalText(2000),
  version: z.number().int().positive(),
});

export const careTaskSchema = z.object({
  animalId: z.string().min(1),
  medicalRecordId: z.string().min(1).nullable().optional(),
  kind: z.enum(["appointment", "follow_up", "medication_reminder"]),
  title: z.string().trim().min(2).max(160),
  dueAt: instant,
  notes: optionalText(2000),
});

export const taskActionSchema = z.object({
  notes: optionalText(2000),
});

export const applicantSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: optionalEmail,
  phone: optionalText(40),
  preferredContact: z.enum(["email", "phone", "either"]).default("email"),
  addressLine1: optionalText(160),
  city: optionalText(80),
  region: optionalText(80),
  postalCode: optionalText(20),
  householdAdults: z.number().int().min(0).max(30).nullable().optional(),
  householdChildren: z.number().int().min(0).max(30).nullable().optional(),
  housingType: optionalText(80),
  hasYard: z.enum(["yes", "no", "unknown"]).nullable().optional(),
  otherPets: optionalText(500),
  experienceNotes: optionalText(4000),
});

export const applicationSchema = z.object({
  applicantId: z.string().min(1),
  animalIds: z.array(z.string().min(1)).min(1).max(10),
});

export const applicationAnimalsSchema = z.object({
  animalIds: z.array(z.string().min(1)).min(1).max(10),
  version: z.number().int().positive(),
});

export const transitionSchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
  reason: optionalText(2000),
  version: z.number().int().positive(),
});

export const screeningSchema = z.object({
  kind: z.enum(["interview", "reference", "communication", "note"]),
  occurredAt: instant,
  result: optionalText(200),
  notes: optionalText(4000),
  nextActionAt: instant.nullable().optional(),
});

export const finalizeSchema = z.object({
  adoptionDate: requiredCalendarDate,
  agreementSummary: optionalText(8000),
  animals: z
    .array(
      z.object({
        animalId: z.string().min(1),
        feeCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
      }),
    )
    .min(1)
    .max(10),
  acknowledgeClearanceUnknown: z.boolean().optional().default(false),
  version: z.number().int().positive(),
});

export const returnSchema = z.object({
  reason: z.string().trim().min(2).max(2000),
  shelterId: z.string().min(1),
  status: z.string().trim().min(1).max(40).optional(),
});

export const followUpSchema = z.object({
  scheduledAt: instant,
  notes: optionalText(2000),
});

export const completeFollowUpSchema = z.object({
  notes: optionalText(2000),
  outcome: optionalText(200),
});

export const sessionContextSchema = z.object({
  organizationId: z.string().min(1).nullable(),
  shelterId: z.string().min(1).nullable().optional(),
});

export const orgMaxSchema = z.object({
  maxSheltersOverride: z.number().int().min(1).max(50).nullable(),
  active: z.boolean().optional(),
});

export const reportQuerySchema = z.object({
  type: z.enum([
    "population",
    "intake_outcomes",
    "adoptions",
    "turnaround",
    "follow_ups",
    "treatments",
    "occupancy",
    "transfers",
    "audit",
  ]),
  shelterId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  species: z.enum(SPECIES).optional(),
  status: z.string().optional(),
});

export function parseInput<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    if (!fields[key]) fields[key] = issue.message;
  }
  throw validationError(fields);
}

export function assertPasswordStrength(password: string, email: string): void {
  if (password.length < 10) {
    throw validationError({ password: "Use at least 10 characters." });
  }
  if (password.toLowerCase() === email.trim().toLowerCase()) {
    throw validationError({ password: "The password cannot match the email address." });
  }
}
