import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, type OrgRole, type Permission } from "@/domain/permissions";
import { finalizeAdoption, createApplicant, createApplication, getApplication, transitionApplication } from "@/server/adoptions";
import type { Actor } from "@/server/actor";
import { createAnimal, getAnimal, listAnimals, transferAnimal, updateAnimal } from "@/server/animals";
import { login } from "@/server/auth";
import { dashboard } from "@/server/dashboard";
import { db, resetDbClient } from "@/server/db";
import { handleApi } from "@/server/http/router";
import { createMedicalRecord, getMedicalRecord, listMedicalRecords, recordAdministration } from "@/server/medical";
import { createOrganization } from "@/server/platform";
import { exportReport, runReport } from "@/server/reports";
import { createShelter } from "@/server/shelters";
import { hashPassword } from "@/server/crypto";

const tables = [
  "notifications",
  "audit_events",
  "post_adoption_follow_ups",
  "adoption_documents",
  "adoptions",
  "screening_events",
  "application_animals",
  "adoption_applications",
  "applicants",
  "medication_administrations",
  "medical_attachments",
  "care_tasks",
  "medical_records",
  "animal_photos",
  "animal_transfers",
  "animal_status_events",
  "animals",
  "role_permissions",
  "shelter_assignments",
  "memberships",
  "shelters",
  "org_sequences",
  "sessions",
  "rate_buckets",
  "users",
  "organizations",
  "platform_settings",
];

async function resetDatabase() {
  const prisma = await db();
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF;");
  for (const table of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
}

function asActor(input: {
  userId: string;
  organizationId: string | null;
  role: OrgRole | null;
  shelterIds?: string[] | null;
  isPlatformAdmin?: boolean;
  permissions?: Permission[];
  email?: string;
}): Actor {
  const role = input.role;
  return {
    userId: input.userId,
    name: "Tester",
    email: input.email ?? "tester@example.com",
    isPlatformAdmin: input.isPlatformAdmin ?? false,
    mustChangePassword: false,
    sessionId: "test-session",
    organizationId: input.organizationId,
    role,
    shelterIds: input.shelterIds === undefined ? (role === "org_admin" ? null : []) : input.shelterIds,
    permissions: new Set(input.permissions ?? (role ? DEFAULT_ROLE_PERMISSIONS[role] : [])),
    activeShelterId: null,
    ip: "test",
  };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDbClient();
});

describe("PawHaven workflows", () => {
  it("isolates tenants, enforces the shelter limit, and runs care and adoption workflows", async () => {
    const prisma = await db();
    const platform = await prisma.user.create({
      data: {
        email: "platform@example.com",
        name: "Platform Admin",
        passwordHash: await hashPassword("platform-password"),
        isPlatformAdmin: true,
      },
    });
    const platformActor = asActor({ userId: platform.id, organizationId: null, role: null, isPlatformAdmin: true, shelterIds: null });

    const first = await createOrganization(platformActor, {
      name: "North Rescue",
      adminName: "North Admin",
      adminEmail: "north@example.com",
      adminPassword: "north-admin-pass",
    });
    const second = await createOrganization(platformActor, {
      name: "South Rescue",
      adminName: "South Admin",
      adminEmail: "south@example.com",
      adminPassword: "south-admin-pass",
    });
    const north = asActor({ userId: first.admin.id, organizationId: first.organization.id, role: "org_admin", email: "north@example.com" });
    const south = asActor({ userId: second.admin.id, organizationId: second.organization.id, role: "org_admin", email: "south@example.com" });

    const main = await createShelter(north, { ...shelter("Main Campus"), capacity: 2 });
    const annex = await createShelter(north, shelter("Annex"));
    const clinic = await createShelter(north, shelter("Clinic"));
    await expect(createShelter(north, shelter("Fourth"))).rejects.toMatchObject({ code: "shelter_limit" });

    const only = await createShelter(south, shelter("Only Shelter"));
    const southDog = await createAnimal(south, animalInput(only.id, "Pebble", "dog"));
    await expect(getAnimal(north, southDog.animal.id)).rejects.toMatchObject({ status: 404 });
    await expect(listAnimals(north, { q: "Pebble" })).resolves.toMatchObject({ total: 0 });

    const raced = await Promise.allSettled([
      createShelter(south, shelter("Extra A")),
      createShelter(south, shelter("Extra B")),
      createShelter(south, shelter("Extra C")),
    ]);
    const successes = raced.filter((result) => result.status === "fulfilled");
    expect(successes).toHaveLength(2);
    const southCount = await prisma.shelter.count({ where: { organizationId: second.organization.id } });
    expect(southCount).toBe(3);

    const cat = await createAnimal(north, animalInput(main.id, "Miso", "cat", { color: "orange", microchip: "chip-1" }));
    const dog = await createAnimal(north, animalInput(main.id, "Bear", "dog"));
    expect(cat.animal.publicCode).toBe("A-000001");
    expect(dog.animal.publicCode).toBe("A-000002");
    await expect(createAnimal(north, animalInput(main.id, "Copy", "cat", { microchip: "chip-1" }))).rejects.toMatchObject({ code: "duplicate_microchip" });
    await expect(createAnimal(north, animalInput(annex.id, "Miso", "cat", { color: "orange" }))).rejects.toMatchObject({ code: "duplicate_warning" });
    const confirmed = await createAnimal(north, animalInput(annex.id, "Miso", "cat", { color: "orange", acknowledgeDuplicates: true }));
    expect(confirmed.animal.id).not.toBe(cat.animal.id);

    const found = await listAnimals(north, { q: "bear", species: "dog" });
    expect(found.total).toBe(1);

    await expect(updateAnimal(north, cat.animal.id, { ...animalInput(main.id, "Miso", "cat", { acknowledgeDuplicates: true }), version: 1 })).resolves.toBeTruthy();
    await expect(updateAnimal(north, cat.animal.id, { ...animalInput(main.id, "Miso", "cat", { acknowledgeDuplicates: true }), version: 1 })).rejects.toMatchObject({ code: "version_conflict" });

    await expect(
      createMedicalRecord(north, {
        animalId: cat.animal.id,
        category: "veterinary_consultation",
        occurredAt: new Date().toISOString(),
        providerName: "Staff member",
        providerIsVeterinarian: false,
        observations: "Recorded by staff",
        diagnosis: "Invented diagnosis",
        treatment: null,
        medicationName: null,
        dose: null,
        instructions: null,
        allergies: null,
        notes: null,
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    const visit = await createMedicalRecord(north, {
      animalId: cat.animal.id,
      category: "veterinary_consultation",
      occurredAt: new Date().toISOString(),
      providerName: "Dr. Adeyemi",
      providerIsVeterinarian: true,
      observations: "Bright and eating",
      diagnosis: "Healthy exam as recorded by the veterinarian",
      treatment: null,
      medicationName: null,
      dose: null,
      instructions: null,
      allergies: null,
      notes: "Staff entered the veterinarian's notes",
    });
    const vaccine = await createMedicalRecord(north, {
      animalId: cat.animal.id,
      category: "vaccination",
      occurredAt: new Date().toISOString(),
      providerName: "Dr. Adeyemi",
      providerIsVeterinarian: true,
      observations: "Vaccine administered",
      diagnosis: null,
      treatment: "FVRCP",
      medicationName: "FVRCP",
      dose: "As recorded: 1 ml",
      instructions: "As recorded by the clinic",
      allergies: null,
      notes: null,
      nextFollowUpAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    });
    const history = await listMedicalRecords(north, { animalId: cat.animal.id });
    expect(history.total).toBe(2);
    const detail = await getMedicalRecord(north, visit.id);
    expect(detail.diagnosis).toContain("veterinarian");
    expect(detail.disclaimer).toMatch(/does not generate diagnoses/i);

    const medication = await createMedicalRecord(north, {
      animalId: dog.animal.id,
      category: "medication",
      occurredAt: new Date().toISOString(),
      providerName: "Dr. Adeyemi",
      providerIsVeterinarian: true,
      observations: null,
      diagnosis: null,
      treatment: null,
      medicationName: "Recorded medication",
      dose: "As recorded",
      instructions: "As recorded",
      allergies: "None recorded",
      notes: null,
    });
    const dose = await recordAdministration(north, medication.id, { administeredAt: new Date().toISOString(), notes: "Given with food" });
    expect(dose.id).toBeTruthy();
    const tasks = await prisma.careTask.count({ where: { animalId: cat.animal.id, medicalRecordId: vaccine.id } });
    expect(tasks).toBe(1);

    const care = await prisma.user.create({
      data: { email: "care@example.com", name: "Care", passwordHash: await hashPassword("care-password-1"), mustChangePassword: false },
    });
    const careMembership = await prisma.membership.create({
      data: { userId: care.id, organizationId: first.organization.id, role: "animal_care", shelters: { create: [{ shelterId: main.id }] } },
    });
    const careActor = asActor({
      userId: care.id,
      organizationId: first.organization.id,
      role: "animal_care",
      shelterIds: [main.id],
    });
    await expect(listMedicalRecords(careActor, {})).rejects.toMatchObject({ status: 403 });
    await expect(getAnimal(careActor, confirmed.animal.id)).rejects.toMatchObject({ status: 404 });
    expect(careMembership.id).toBeTruthy();

    const applicant = await createApplicant(north, {
      firstName: "Amina",
      lastName: "Khan",
      email: "amina@example.com",
      phone: "555-0100",
      preferredContact: "email",
      addressLine1: "1 Example Street",
      city: "Example",
      region: "State",
      postalCode: "00000",
      householdAdults: 2,
      householdChildren: 0,
      housingType: "apartment",
      hasYard: "no",
      otherPets: "None",
      experienceNotes: "Has cared for cats before",
    });
    const application = await createApplication(north, { applicantId: applicant.id, animalIds: [cat.animal.id] });
    let version = application.version;
    for (const status of ["submitted", "under_review", "screening", "approved"] as const) {
      const moved = await transitionApplication(north, application.id, { status, reason: "Staff decision", version });
      version = moved.application.version;
    }
    const approved = await getApplication(north, application.id);
    expect(approved.status).toBe("approved");
    const reserved = await getAnimal(north, cat.animal.id);
    expect(reserved.status).toBe("adoption_pending");

    const adoption = await finalizeAdoption(north, application.id, {
      adoptionDate: "2026-10-19",
      agreementSummary: "Standard agreement acknowledged",
      animals: [{ animalId: cat.animal.id, feeCents: null }],
      acknowledgeClearanceUnknown: true,
      version,
    });
    expect(adoption).toHaveLength(1);
    const adopted = await getAnimal(north, cat.animal.id);
    expect(adopted.status).toBe("adopted");
    await expect(
      finalizeAdoption(north, application.id, {
        adoptionDate: "2026-10-19",
        agreementSummary: null,
        animals: [{ animalId: cat.animal.id }],
        acknowledgeClearanceUnknown: true,
        version,
      }),
    ).rejects.toBeTruthy();
    expect(await prisma.adoption.count({ where: { animalId: cat.animal.id, status: "active" } })).toBe(1);

    const other = await createAnimal(north, animalInput(main.id, "Nori", "cat"));
    const otherApp = await createApplication(north, { applicantId: applicant.id, animalIds: [other.animal.id] });
    let otherVersion = otherApp.version;
    for (const status of ["submitted", "under_review", "screening", "approved"] as const) {
      const moved = await transitionApplication(north, otherApp.id, { status, reason: "Ready", version: otherVersion });
      otherVersion = moved.application.version;
    }
    const [firstFinalize, secondFinalize] = await Promise.allSettled([
      finalizeAdoption(north, otherApp.id, {
        adoptionDate: "2026-10-19",
        agreementSummary: null,
        animals: [{ animalId: other.animal.id }],
        acknowledgeClearanceUnknown: true,
        version: otherVersion,
      }),
      finalizeAdoption(north, otherApp.id, {
        adoptionDate: "2026-10-19",
        agreementSummary: null,
        animals: [{ animalId: other.animal.id }],
        acknowledgeClearanceUnknown: true,
        version: otherVersion,
      }),
    ]);
    const finalizeWins = [firstFinalize, secondFinalize].filter((result) => result.status === "fulfilled");
    expect(finalizeWins).toHaveLength(1);
    expect(await prisma.adoption.count({ where: { animalId: other.animal.id, status: "active" } })).toBe(1);

    const movedDog = await transferAnimal(north, dog.animal.id, { toShelterId: annex.id, reason: "More space", version: dog.animal.version });
    expect(movedDog.id).toBe(dog.animal.id);
    expect(movedDog.shelter.id).toBe(annex.id);
    expect(movedDog.publicCode).toBe(dog.animal.publicCode);
    const transfers = await prisma.animalTransfer.count({ where: { animalId: dog.animal.id, kind: "internal" } });
    expect(transfers).toBe(1);

    const stats = await dashboard(north);
    expect(stats.inCare).toBeGreaterThan(0);
    expect(stats.recentAdoptions.some((item) => item.animalId === cat.animal.id)).toBe(true);
    expect(stats.byShelter.find((item) => item.id === main.id)?.capacity).toBe(2);

    const population = await runReport(north, { type: "population" });
    expect(population.rows.length).toBeGreaterThan(0);
    const exported = await exportReport(north, { type: "population" });
    expect(exported.csv).toContain("Shelter");
    const injected = await exportReport(north, { type: "audit" });
    expect(injected.csv.includes("=cmd")).toBe(false);

    await expect(runReport(south, { type: "population" })).resolves.toBeTruthy();
    const southReport = await runReport(south, { type: "population" });
    expect(JSON.stringify(southReport.rows)).not.toContain("Miso");
    expect(JSON.stringify(southReport.rows)).not.toContain("Bear");

    const readOnly = asActor({
      userId: care.id,
      organizationId: first.organization.id,
      role: "read_only",
      shelterIds: [main.id, annex.id, clinic.id],
      permissions: [...DEFAULT_ROLE_PERMISSIONS.read_only],
    });
    await expect(createAnimal(readOnly, animalInput(main.id, "Nope", "dog"))).rejects.toMatchObject({ status: 403 });
    await expect(exportReport(readOnly, { type: "population" })).rejects.toMatchObject({ status: 403 });

    const vet = asActor({
      userId: care.id,
      organizationId: first.organization.id,
      role: "veterinary",
      shelterIds: [main.id, annex.id],
    });
    await expect(createApplicant(vet, {
      firstName: "No",
      lastName: "Access",
      email: null,
      phone: null,
      preferredContact: "email",
      addressLine1: null,
      city: null,
      region: null,
      postalCode: null,
      housingType: null,
      otherPets: null,
      experienceNotes: null,
    })).rejects.toMatchObject({ status: 403 });

    expect((await getAnimal(south, southDog.animal.id)).shelter.id).toBe(only.id);
  });

  it("rejects missing CSRF tokens and invalid logins at the HTTP boundary", async () => {
    const prisma = await db();
    const user = await prisma.user.create({
      data: { email: "http@example.com", name: "HTTP", passwordHash: await hashPassword("http-password-1"), isPlatformAdmin: true },
    });
    const session = await login({ email: user.email, password: "http-password-1" }, { ip: "test", userAgent: "vitest" });
    const denied = await handleApi(new Request("http://localhost/api/platform/organizations", { method: "POST", headers: { cookie: `pawhaven_session=${session.token}`, "content-type": "application/json" }, body: "{}" }));
    expect(denied.status).toBe(403);
    const badLogin = await handleApi(new Request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: "wrong-password" }) }));
    expect(badLogin.status).toBe(401);
    const cross = await handleApi(new Request("http://localhost/api/auth/me", { headers: { cookie: `pawhaven_session=${session.token}` } }));
    expect(cross.status).toBe(200);
    const body = await cross.json();
    expect(body.user.email).toBe(user.email);
  });
});

function shelter(name: string) {
  return {
    name,
    code: null,
    email: null,
    phone: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    capacity: null,
    notes: null,
  };
}

function animalInput(shelterId: string, name: string, species: "cat" | "dog", extra: Record<string, unknown> = {}) {
  return {
    shelterId,
    name,
    species,
    breed: null,
    breedUnknown: true,
    sex: "unknown" as const,
    birthDate: null,
    birthDateEstimated: true,
    estimatedAgeYears: 2,
    estimatedAgeMonths: 0,
    color: null,
    distinguishingFeatures: null,
    microchip: null,
    intakeDate: new Date().toISOString(),
    intakeSource: "stray",
    previousOwnerName: null,
    previousOwnerPhone: null,
    previousOwnerEmail: null,
    previousOwnerNotes: null,
    housingLocation: "Kennel 1",
    temperament: "Calm",
    specialHandling: null,
    dietaryNeeds: null,
    sterilizationStatus: "unknown" as const,
    identificationTags: null,
    notes: null,
    size: "medium" as const,
    activityLevel: "moderate" as const,
    weightKg: 4.5,
    acknowledgeDuplicates: false,
    ...extra,
  };
}
