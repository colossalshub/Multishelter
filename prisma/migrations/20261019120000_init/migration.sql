-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'platform',
    "maxSheltersPerOrganization" INTEGER NOT NULL DEFAULT 3,
    "platformName" TEXT NOT NULL DEFAULT 'PawHaven',
    "supportEmail" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfSecret" TEXT NOT NULL,
    "activeOrganizationId" TEXT,
    "activeShelterId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rate_buckets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bucket" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "logoStorageKey" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1f6b4a',
    "accentColor" TEXT NOT NULL DEFAULT '#b85a28',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "dateFormat" TEXT NOT NULL DEFAULT 'yyyy-MM-dd',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "adoptionFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultAdoptionFeeCents" INTEGER,
    "maxSheltersOverride" INTEGER,
    "shelterCount" INTEGER NOT NULL DEFAULT 0,
    "intakeSources" TEXT NOT NULL DEFAULT '["stray","owner_surrender","transfer_in","born_in_care","other"]',
    "customStatuses" TEXT NOT NULL DEFAULT '[]',
    "statusLabels" TEXT NOT NULL DEFAULT '{}',
    "medicalCategories" TEXT NOT NULL DEFAULT '[]',
    "adoptionStatusLabels" TEXT NOT NULL DEFAULT '{}',
    "adoptionAgreement" TEXT NOT NULL DEFAULT '',
    "reminderLeadDays" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "org_sequences" (
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("organizationId", "name"),
    CONSTRAINT "org_sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shelters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "capacity" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "shelters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shelter_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "membershipId" TEXT NOT NULL,
    "shelterId" TEXT NOT NULL,
    CONSTRAINT "shelter_assignments_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shelter_assignments_shelterId_fkey" FOREIGN KEY ("shelterId") REFERENCES "shelters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    CONSTRAINT "role_permissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "animals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "shelterId" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "breed" TEXT,
    "breedUnknown" BOOLEAN NOT NULL DEFAULT false,
    "sex" TEXT NOT NULL DEFAULT 'unknown',
    "birthDate" TEXT,
    "birthDateEstimated" BOOLEAN NOT NULL DEFAULT true,
    "estimatedAgeYears" INTEGER,
    "estimatedAgeMonths" INTEGER,
    "color" TEXT,
    "distinguishingFeatures" TEXT,
    "microchip" TEXT,
    "intakeDate" DATETIME NOT NULL,
    "intakeSource" TEXT NOT NULL,
    "previousOwnerName" TEXT,
    "previousOwnerPhone" TEXT,
    "previousOwnerEmail" TEXT,
    "previousOwnerNotes" TEXT,
    "housingLocation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'intake_pending',
    "statusBeforeAdoption" TEXT,
    "temperament" TEXT,
    "specialHandling" TEXT,
    "dietaryNeeds" TEXT,
    "sterilizationStatus" TEXT NOT NULL DEFAULT 'unknown',
    "identificationTags" TEXT,
    "notes" TEXT,
    "size" TEXT NOT NULL DEFAULT 'unknown',
    "activityLevel" TEXT NOT NULL DEFAULT 'unknown',
    "weightGrams" INTEGER,
    "medicalClearance" TEXT NOT NULL DEFAULT 'unknown',
    "medicalClearanceBasis" TEXT,
    "medicalClearanceAt" DATETIME,
    "medicalClearanceById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "animals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "animals_shelterId_organizationId_fkey" FOREIGN KEY ("shelterId", "organizationId") REFERENCES "shelters" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "animals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "animals_medicalClearanceById_fkey" FOREIGN KEY ("medicalClearanceById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "animal_photos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "animalId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "animal_photos_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "animal_photos_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "animal_status_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "animalId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "animal_status_events_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "animal_status_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "animal_transfers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "animalId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromShelterId" TEXT NOT NULL,
    "toShelterId" TEXT,
    "externalDestination" TEXT,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "animal_transfers_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "animal_transfers_fromShelterId_organizationId_fkey" FOREIGN KEY ("fromShelterId", "organizationId") REFERENCES "shelters" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "animal_transfers_toShelterId_organizationId_fkey" FOREIGN KEY ("toShelterId", "organizationId") REFERENCES "shelters" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "animal_transfers_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "medical_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "shelterId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "providerName" TEXT,
    "providerIsVeterinarian" BOOLEAN NOT NULL DEFAULT false,
    "observations" TEXT,
    "diagnosis" TEXT,
    "treatment" TEXT,
    "medicationName" TEXT,
    "dose" TEXT,
    "instructions" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "nextFollowUpAt" DATETIME,
    "allergies" TEXT,
    "notes" TEXT,
    "correctionOfId" TEXT,
    "supersededAt" DATETIME,
    "enteredById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "medical_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "medical_records_shelterId_organizationId_fkey" FOREIGN KEY ("shelterId", "organizationId") REFERENCES "shelters" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "medical_records_animalId_organizationId_fkey" FOREIGN KEY ("animalId", "organizationId") REFERENCES "animals" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "medical_records_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "medical_records_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "medical_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "medical_attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medicalRecordId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "medical_attachments_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "medical_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "medication_administrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "medicalRecordId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "administeredAt" DATETIME NOT NULL,
    "administeredById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "medication_administrations_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "medical_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "medication_administrations_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "medication_administrations_administeredById_fkey" FOREIGN KEY ("administeredById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "care_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "shelterId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "medicalRecordId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "completedAt" DATETIME,
    "completedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "care_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "care_tasks_shelterId_organizationId_fkey" FOREIGN KEY ("shelterId", "organizationId") REFERENCES "shelters" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "care_tasks_animalId_organizationId_fkey" FOREIGN KEY ("animalId", "organizationId") REFERENCES "animals" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "care_tasks_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "medical_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "care_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "care_tasks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "applicants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "preferredContact" TEXT NOT NULL DEFAULT 'email',
    "addressLine1" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "householdAdults" INTEGER,
    "householdChildren" INTEGER,
    "housingType" TEXT,
    "hasYard" TEXT,
    "otherPets" TEXT,
    "experienceNotes" TEXT,
    "customAnswers" TEXT NOT NULL DEFAULT '{}',
    "redactedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "applicants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "applicants_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "adoption_applications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "decisionReason" TEXT,
    "submittedAt" DATETIME,
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "adoption_applications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "adoption_applications_applicantId_organizationId_fkey" FOREIGN KEY ("applicantId", "organizationId") REFERENCES "applicants" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "adoption_applications_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "adoption_applications_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "application_animals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    CONSTRAINT "application_animals_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "adoption_applications" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "application_animals_animalId_organizationId_fkey" FOREIGN KEY ("animalId", "organizationId") REFERENCES "animals" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "screening_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "result" TEXT,
    "notes" TEXT,
    "nextActionAt" DATETIME,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "screening_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "adoption_applications" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "screening_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "adoptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "shelterId" TEXT NOT NULL,
    "adoptionDate" TEXT NOT NULL,
    "agreementSummary" TEXT,
    "feeCents" INTEGER,
    "clearanceAcknowledgement" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "returnedAt" DATETIME,
    "returnReason" TEXT,
    "finalizedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "adoptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "adoptions_applicationId_organizationId_fkey" FOREIGN KEY ("applicationId", "organizationId") REFERENCES "adoption_applications" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "adoptions_animalId_organizationId_fkey" FOREIGN KEY ("animalId", "organizationId") REFERENCES "animals" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "adoptions_applicantId_organizationId_fkey" FOREIGN KEY ("applicantId", "organizationId") REFERENCES "applicants" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "adoptions_shelterId_organizationId_fkey" FOREIGN KEY ("shelterId", "organizationId") REFERENCES "shelters" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "adoptions_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "adoption_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adoptionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "adoption_documents_adoptionId_fkey" FOREIGN KEY ("adoptionId") REFERENCES "adoptions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "adoption_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_adoption_follow_ups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adoptionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "notes" TEXT,
    "outcome" TEXT,
    "createdById" TEXT NOT NULL,
    "completedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_adoption_follow_ups_adoptionId_fkey" FOREIGN KEY ("adoptionId") REFERENCES "adoptions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "post_adoption_follow_ups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "post_adoption_follow_ups_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "dedupeKey" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "rate_buckets_bucket_createdAt_idx" ON "rate_buckets"("bucket", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "shelters_organizationId_idx" ON "shelters"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "shelters_id_organizationId_key" ON "shelters"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "shelters_organizationId_name_key" ON "shelters"("organizationId", "name");

-- CreateIndex
CREATE INDEX "memberships_organizationId_idx" ON "memberships"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_organizationId_key" ON "memberships"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "shelter_assignments_membershipId_shelterId_key" ON "shelter_assignments"("membershipId", "shelterId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_organizationId_role_permission_key" ON "role_permissions"("organizationId", "role", "permission");

-- CreateIndex
CREATE INDEX "animals_organizationId_status_idx" ON "animals"("organizationId", "status");

-- CreateIndex
CREATE INDEX "animals_organizationId_shelterId_idx" ON "animals"("organizationId", "shelterId");

-- CreateIndex
CREATE INDEX "animals_organizationId_nameNormalized_idx" ON "animals"("organizationId", "nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "animals_organizationId_publicCode_key" ON "animals"("organizationId", "publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "animals_organizationId_microchip_key" ON "animals"("organizationId", "microchip");

-- CreateIndex
CREATE UNIQUE INDEX "animals_id_organizationId_key" ON "animals"("id", "organizationId");

-- CreateIndex
CREATE INDEX "animal_photos_animalId_idx" ON "animal_photos"("animalId");

-- CreateIndex
CREATE INDEX "animal_status_events_animalId_createdAt_idx" ON "animal_status_events"("animalId", "createdAt");

-- CreateIndex
CREATE INDEX "animal_transfers_animalId_idx" ON "animal_transfers"("animalId");

-- CreateIndex
CREATE INDEX "animal_transfers_organizationId_createdAt_idx" ON "animal_transfers"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "medical_records_organizationId_animalId_occurredAt_idx" ON "medical_records"("organizationId", "animalId", "occurredAt");

-- CreateIndex
CREATE INDEX "medical_records_organizationId_category_idx" ON "medical_records"("organizationId", "category");

-- CreateIndex
CREATE INDEX "medical_attachments_medicalRecordId_idx" ON "medical_attachments"("medicalRecordId");

-- CreateIndex
CREATE INDEX "medication_administrations_medicalRecordId_idx" ON "medication_administrations"("medicalRecordId");

-- CreateIndex
CREATE INDEX "medication_administrations_animalId_idx" ON "medication_administrations"("animalId");

-- CreateIndex
CREATE INDEX "care_tasks_organizationId_status_dueAt_idx" ON "care_tasks"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "care_tasks_animalId_idx" ON "care_tasks"("animalId");

-- CreateIndex
CREATE INDEX "applicants_organizationId_lastName_idx" ON "applicants"("organizationId", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "applicants_id_organizationId_key" ON "applicants"("id", "organizationId");

-- CreateIndex
CREATE INDEX "adoption_applications_organizationId_status_idx" ON "adoption_applications"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "adoption_applications_id_organizationId_key" ON "adoption_applications"("id", "organizationId");

-- CreateIndex
CREATE INDEX "application_animals_animalId_idx" ON "application_animals"("animalId");

-- CreateIndex
CREATE UNIQUE INDEX "application_animals_applicationId_animalId_key" ON "application_animals"("applicationId", "animalId");

-- CreateIndex
CREATE INDEX "screening_events_applicationId_occurredAt_idx" ON "screening_events"("applicationId", "occurredAt");

-- CreateIndex
CREATE INDEX "adoptions_animalId_status_idx" ON "adoptions"("animalId", "status");

-- CreateIndex
CREATE INDEX "adoptions_organizationId_adoptionDate_idx" ON "adoptions"("organizationId", "adoptionDate");

-- CreateIndex
CREATE INDEX "adoption_documents_adoptionId_idx" ON "adoption_documents"("adoptionId");

-- CreateIndex
CREATE INDEX "post_adoption_follow_ups_adoptionId_idx" ON "post_adoption_follow_ups"("adoptionId");

-- CreateIndex
CREATE INDEX "audit_events_organizationId_createdAt_idx" ON "audit_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");


-- One active (non-returned) adoption per animal.
CREATE UNIQUE INDEX "adoptions_one_active_animal" ON "adoptions"("animalId") WHERE "status" = 'active';
