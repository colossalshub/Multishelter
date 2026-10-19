import { AppError } from "@/domain/errors";
import { ORG_ROLES, PERMISSIONS, ROLE_LABELS, isPermission, type OrgRole, type Permission } from "@/domain/permissions";
import { assertPasswordStrength } from "@/domain/validation";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/actor";
import { permissionsFromRows, requireOrg, requirePermission } from "@/server/actor";
import { generatePassword, hashPassword } from "@/server/crypto";
import { db } from "@/server/db";
import { parseJson } from "@/domain/json";
import { catalogFor, categoriesFor } from "@/server/org";
import { serializeOrganization } from "@/server/serialize";
import { getPlatformSettings } from "@/server/platform";
import { effectiveShelterMax } from "@/domain/animals";

export async function getOrganization(actor: Actor) {
  const orgId = requireOrg(actor);
  const prisma = await db();
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new AppError(404, "not_found", "Organization not found.");
  const settings = await getPlatformSettings();
  return {
    ...serializeOrganization(org),
    catalog: catalogFor(org),
    medicalCatalog: categoriesFor(org),
    effectiveMaxShelters: effectiveShelterMax(settings.maxSheltersPerOrganization, org.maxSheltersOverride),
    platformName: settings.platformName,
  };
}

export async function updateOrganization(actor: Actor, input: {
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  primaryColor: string;
  accentColor: string;
  timezone: string;
  locale: string;
  dateFormat: string;
  currency: string;
  adoptionFeeEnabled: boolean;
  defaultAdoptionFeeCents: number | null;
  intakeSources: string[];
  customStatuses: unknown;
  statusLabels?: Record<string, string>;
  medicalCategories: { key: string; label: string }[];
  adoptionStatusLabels?: Record<string, string>;
  adoptionAgreement?: string;
  reminderLeadDays: number;
}) {
  requirePermission(actor, "settings.manage");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const current = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!current) throw new AppError(404, "not_found", "Organization not found.");
  const systemMedical = new Set(["veterinary_consultation", "vaccination", "deworming", "flea_tick", "medication", "procedure", "sterilization", "injury_illness", "lab_result", "allergy", "treatment_plan", "follow_up", "recovery_observation", "medical_clearance", "other"]);
  const medicalCategories = input.medicalCategories.filter((category) => !systemMedical.has(category.key));
  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: {
      name: input.name,
      legalName: input.legalName,
      email: input.email,
      phone: input.phone,
      website: input.website,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      region: input.region,
      postalCode: input.postalCode,
      country: input.country,
      primaryColor: input.primaryColor,
      accentColor: input.accentColor,
      timezone: input.timezone,
      locale: input.locale,
      dateFormat: input.dateFormat,
      currency: input.currency,
      adoptionFeeEnabled: input.adoptionFeeEnabled,
      defaultAdoptionFeeCents: input.adoptionFeeEnabled ? input.defaultAdoptionFeeCents : null,
      intakeSources: JSON.stringify(input.intakeSources),
      customStatuses: JSON.stringify(input.customStatuses),
      statusLabels: JSON.stringify(input.statusLabels ?? parseJson(current.statusLabels, {})),
      medicalCategories: JSON.stringify(medicalCategories),
      adoptionStatusLabels: JSON.stringify(input.adoptionStatusLabels ?? parseJson(current.adoptionStatusLabels, {})),
      adoptionAgreement: input.adoptionAgreement ?? current.adoptionAgreement,
      reminderLeadDays: input.reminderLeadDays,
    },
  });
  await audit(prisma, {
    organizationId: orgId,
    actorId: actor.userId,
    action: "organization.updated",
    entityType: "organization",
    entityId: orgId,
    metadata: { name: updated.name },
    ip: actor.ip,
  });
  return serializeOrganization(updated);
}

export async function listUsers(actor: Actor) {
  requirePermission(actor, "users.manage");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const memberships = await prisma.membership.findMany({
    where: { organizationId: orgId },
    include: { user: true, shelters: true },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((membership) => ({
    id: membership.user.id,
    membershipId: membership.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    roleLabel: ROLE_LABELS[membership.role as OrgRole] ?? membership.role,
    active: membership.active && membership.user.active,
    membershipActive: membership.active,
    userActive: membership.user.active,
    shelterIds: membership.shelters.map((assignment) => assignment.shelterId),
    mustChangePassword: membership.user.mustChangePassword,
  }));
}

export async function createOrgUser(
  actor: Actor,
  input: { name: string; email: string; role: OrgRole; shelterIds: string[]; password?: string },
) {
  requirePermission(actor, "users.manage");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const email = input.email.toLowerCase();
  const password = input.password ?? generatePassword();
  assertPasswordStrength(password, email);
  await assertShelters(orgId, input.role, input.shelterIds);
  const result = await prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email } });
    let created = false;
    if (!user) {
      user = await tx.user.create({
        data: { email, name: input.name, passwordHash: await hashPassword(password), mustChangePassword: true },
      });
      created = true;
    } else if (!user.active) {
      throw new AppError(409, "user_inactive", "That email belongs to a deactivated user.");
    }
    const existing = await tx.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: orgId } } });
    if (existing) throw new AppError(409, "already_member", "That person is already a member of this organization.");
    const membership = await tx.membership.create({
      data: {
        userId: user.id,
        organizationId: orgId,
        role: input.role,
        shelters: input.role === "org_admin" ? undefined : { create: input.shelterIds.map((shelterId) => ({ shelterId })) },
      },
    });
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "user.created",
      entityType: "user",
      entityId: user.id,
      metadata: { email, role: input.role, existingUser: !created },
      ip: actor.ip,
    });
    return { userId: user.id, membershipId: membership.id, created };
  });
  return {
    id: result.userId,
    email,
    existingUser: !result.created,
    temporaryPassword: result.created ? password : null,
  };
}

export async function updateOrgUser(
  actor: Actor,
  userId: string,
  input: { name?: string; role?: OrgRole; shelterIds?: string[]; active?: boolean },
) {
  requirePermission(actor, "users.manage");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    include: { user: true, shelters: true },
  });
  if (!membership) throw new AppError(404, "not_found", "User not found in this organization.");
  const nextRole = input.role ?? (membership.role as OrgRole);
  const nextShelters = input.shelterIds ?? membership.shelters.map((item) => item.shelterId);
  await assertShelters(orgId, nextRole, nextShelters);
  if (input.active === false || (input.role && input.role !== "org_admin")) {
    await assertRemainingAdmin(orgId, userId, input.role ?? (membership.role as OrgRole), input.active !== false && membership.active);
  }
  await prisma.$transaction(async (tx) => {
    if (input.name) await tx.user.update({ where: { id: userId }, data: { name: input.name } });
    await tx.membership.update({
      where: { id: membership.id },
      data: { role: nextRole, active: input.active ?? membership.active },
    });
    if (input.shelterIds || input.role === "org_admin") {
      await tx.shelterAssignment.deleteMany({ where: { membershipId: membership.id } });
      if (nextRole !== "org_admin") {
        await tx.shelterAssignment.createMany({
          data: nextShelters.map((shelterId) => ({ membershipId: membership.id, shelterId })),
        });
      }
    }
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "user.updated",
      entityType: "user",
      entityId: userId,
      metadata: { role: nextRole, active: input.active ?? membership.active },
      ip: actor.ip,
    });
  });
  return { ok: true };
}

export async function resetOrgUserPassword(actor: Actor, userId: string) {
  requirePermission(actor, "users.manage");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    include: { user: true },
  });
  if (!membership) throw new AppError(404, "not_found", "User not found in this organization.");
  const password = generatePassword();
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true },
  });
  await prisma.session.deleteMany({ where: { userId } });
  await audit(prisma, {
    organizationId: orgId,
    actorId: actor.userId,
    action: "user.password_reset",
    entityType: "user",
    entityId: userId,
    ip: actor.ip,
  });
  return { temporaryPassword: password };
}

async function assertShelters(orgId: string, role: OrgRole, shelterIds: string[]) {
  const prisma = await db();
  if (role === "org_admin") return;
  if (shelterIds.length === 0) {
    const shelterCount = await prisma.shelter.count({ where: { organizationId: orgId } });
    if (shelterCount > 0) {
      throw new AppError(400, "validation_error", "Assign at least one shelter.", { fields: { shelterIds: "Choose a shelter." } });
    }
    return;
  }
  const shelters = await prisma.shelter.findMany({ where: { organizationId: orgId, id: { in: shelterIds } } });
  if (shelters.length !== shelterIds.length) {
    throw new AppError(400, "validation_error", "One or more shelters are not part of this organization.", {
      fields: { shelterIds: "Choose shelters from this organization." },
    });
  }
}

async function assertRemainingAdmin(orgId: string, userId: string, nextRole: OrgRole, active: boolean) {
  if (nextRole === "org_admin" && active) return;
  const prisma = await db();
  const admins = await prisma.membership.count({
    where: { organizationId: orgId, role: "org_admin", active: true, userId: { not: userId }, user: { active: true } },
  });
  if (admins < 1) {
    throw new AppError(409, "last_admin", "The organization must keep at least one active organization administrator.");
  }
}

export async function getPermissionMatrix(actor: Actor) {
  requirePermission(actor, "settings.manage");
  const orgId = requireOrg(actor);
  const prisma = await db();
  const rows = await prisma.rolePermission.findMany({ where: { organizationId: orgId } });
  return {
    permissions: PERMISSIONS,
    roles: ORG_ROLES.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      locked: role === "org_admin",
      permissions: [...permissionsFromRows(role, rows.filter((row) => row.role === role))],
    })),
  };
}

export async function updatePermissionMatrix(actor: Actor, roles: { role: OrgRole; permissions: string[] }[]) {
  requirePermission(actor, "settings.manage");
  const orgId = requireOrg(actor);
  const prisma = await db();
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { organizationId: orgId } });
    const data: { organizationId: string; role: string; permission: string; allowed: boolean }[] = [];
    for (const role of roles) {
      if (role.role === "org_admin") continue;
      const allowed = new Set(role.permissions.filter(isPermission));
      for (const permission of PERMISSIONS) {
        data.push({ organizationId: orgId, role: role.role, permission, allowed: allowed.has(permission as Permission) });
      }
    }
    if (data.length) await tx.rolePermission.createMany({ data });
    await audit(tx, {
      organizationId: orgId,
      actorId: actor.userId,
      action: "permissions.updated",
      entityType: "organization",
      entityId: orgId,
      ip: actor.ip,
    });
  });
  return getPermissionMatrix(actor);
}
