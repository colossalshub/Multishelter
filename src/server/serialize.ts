import type { Animal, AnimalPhoto, Organization, Shelter } from "@prisma/client";
import { ageFromBirthDate, formatAge } from "@/domain/animals";
import { todayInTimeZone } from "@/domain/dates";
import type { Actor } from "@/server/actor";
import { catalogFor } from "@/server/org";

type AnimalRow = Animal & { shelter: Shelter; photos?: AnimalPhoto[] };

export function serializeAnimal(animal: AnimalRow, actor: Actor, org: Organization) {
  const catalog = catalogFor(org);
  const today = todayInTimeZone(org.timezone);
  const computed = animal.birthDate ? ageFromBirthDate(animal.birthDate, today) : null;
  const ageLabel = computed
    ? formatAge(computed.years, computed.months)
    : formatAge(animal.estimatedAgeYears, animal.estimatedAgeMonths);
  const seeOwner = actor.permissions.has("animals.write");
  const seeClinical = actor.permissions.has("medical.read");
  return {
    id: animal.id,
    publicCode: animal.publicCode,
    name: animal.name,
    species: animal.species,
    breed: animal.breed,
    breedUnknown: animal.breedUnknown,
    sex: animal.sex,
    birthDate: animal.birthDate,
    birthDateEstimated: animal.birthDateEstimated,
    estimatedAgeYears: animal.estimatedAgeYears,
    estimatedAgeMonths: animal.estimatedAgeMonths,
    ageLabel,
    color: animal.color,
    distinguishingFeatures: animal.distinguishingFeatures,
    microchip: animal.microchip,
    intakeDate: animal.intakeDate.toISOString(),
    intakeSource: animal.intakeSource,
    previousOwner: seeOwner
      ? {
          name: animal.previousOwnerName,
          phone: animal.previousOwnerPhone,
          email: animal.previousOwnerEmail,
          notes: animal.previousOwnerNotes,
        }
      : null,
    housingLocation: animal.housingLocation,
    status: animal.status,
    statusLabel: catalog.find((status) => status.key === animal.status)?.label ?? animal.status,
    temperament: animal.temperament,
    specialHandling: animal.specialHandling,
    dietaryNeeds: animal.dietaryNeeds,
    sterilizationStatus: animal.sterilizationStatus,
    identificationTags: animal.identificationTags,
    notes: animal.notes,
    size: animal.size,
    activityLevel: animal.activityLevel,
    weightGrams: animal.weightGrams,
    medicalClearance: animal.medicalClearance,
    medicalClearanceBasis: seeClinical ? animal.medicalClearanceBasis : null,
    medicalClearanceAt: seeClinical ? animal.medicalClearanceAt?.toISOString() ?? null : null,
    version: animal.version,
    archivedAt: animal.archivedAt?.toISOString() ?? null,
    shelter: { id: animal.shelter.id, name: animal.shelter.name },
    photos: (animal.photos ?? [])
      .slice()
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map((photo) => ({
        id: photo.id,
        isPrimary: photo.isPrimary,
        fileName: photo.fileName,
        url: `/api/files/photos/${photo.id}`,
      })),
    createdAt: animal.createdAt.toISOString(),
    updatedAt: animal.updatedAt.toISOString(),
  };
}

export function serializeShelter(shelter: Shelter) {
  return {
    id: shelter.id,
    name: shelter.name,
    code: shelter.code,
    email: shelter.email,
    phone: shelter.phone,
    addressLine1: shelter.addressLine1,
    addressLine2: shelter.addressLine2,
    city: shelter.city,
    region: shelter.region,
    postalCode: shelter.postalCode,
    country: shelter.country,
    capacity: shelter.capacity,
    notes: shelter.notes,
    active: shelter.active,
    createdAt: shelter.createdAt.toISOString(),
    updatedAt: shelter.updatedAt.toISOString(),
  };
}

export function serializeOrganization(org: Organization) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    legalName: org.legalName,
    email: org.email,
    phone: org.phone,
    website: org.website,
    addressLine1: org.addressLine1,
    addressLine2: org.addressLine2,
    city: org.city,
    region: org.region,
    postalCode: org.postalCode,
    country: org.country,
    logoUrl: org.logoStorageKey ? "/api/files/org-logo" : null,
    primaryColor: org.primaryColor,
    accentColor: org.accentColor,
    timezone: org.timezone,
    locale: org.locale,
    dateFormat: org.dateFormat,
    currency: org.currency,
    adoptionFeeEnabled: org.adoptionFeeEnabled,
    defaultAdoptionFeeCents: org.defaultAdoptionFeeCents,
    maxSheltersOverride: org.maxSheltersOverride,
    shelterCount: org.shelterCount,
    intakeSources: JSON.parse(org.intakeSources) as string[],
    customStatuses: JSON.parse(org.customStatuses),
    statusLabels: JSON.parse(org.statusLabels),
    medicalCategories: JSON.parse(org.medicalCategories),
    adoptionStatusLabels: JSON.parse(org.adoptionStatusLabels),
    adoptionAgreement: org.adoptionAgreement,
    reminderLeadDays: org.reminderLeadDays,
    active: org.active,
  };
}
