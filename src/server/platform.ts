import type { Prisma } from "@prisma/client";
import { effectiveShelterMax } from "@/domain/animals";
import { AppError } from "@/domain/errors";
import { assertPasswordStrength } from "@/domain/validation";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/actor";
import { requirePlatformAdmin } from "@/server/actor";
import { generatePassword, hashPassword } from "@/server/crypto";
import { db } from "@/server/db";

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "organization";
}

export async function getPlatformSettings() {
  const prisma = await db();
  return prisma.platformSetting.upsert({
    where: { id: "platform" },
    update: {},
    create: { id: "platform" },
  });
}

export async function updatePlatformSettings(
  actor: Actor,
  input: { maxSheltersPerOrganization: number; platformName: string; supportEmail: string | null },
) {
  requirePlatformAdmin(actor);
  const prisma = await db();
  const settings = await prisma.platformSetting.upsert({
    where: { id: "platform" },
    update: {
      maxSheltersPerOrganization: input.maxSheltersPerOrganization,
      platformName: input.platformName,
      supportEmail: input.supportEmail,
    },
    create: {
      id: "platform",
      maxSheltersPerOrganization: input.maxSheltersPerOrganization,
      platformName: input.platformName,
      supportEmail: input.supportEmail,
    },
  });
  await audit(prisma, {
    actorId: actor.userId,
    action: "platform.settings_updated",
    entityType: "platform",
    entityId: "platform",
    metadata: { maxSheltersPerOrganization: settings.maxSheltersPerOrganization, platformName: settings.platformName },
    ip: actor.ip,
  });
  return settings;
}

export async function listOrganizations(actor: Actor) {
  requirePlatformAdmin(actor);
  const prisma = await db();
  const orgs = await prisma.organization.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { shelters: true, memberships: true, animals: true } } },
  });
  const settings = await getPlatformSettings();
  return {
    maxSheltersPerOrganization: settings.maxSheltersPerOrganization,
    organizations: orgs.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      active: org.active,
      shelterCount: org.shelterCount,
      shelterRecords: org._count.shelters,
      memberCount: org._count.memberships,
      animalCount: org._count.animals,
      maxSheltersOverride: org.maxSheltersOverride,
      effectiveMaxShelters: effectiveShelterMax(settings.maxSheltersPerOrganization, org.maxSheltersOverride),
      createdAt: org.createdAt.toISOString(),
    })),
  };
}

export async function createOrganization(
  actor: Actor,
  input: {
    name: string;
    slug?: string;
    timezone?: string;
    adminName: string;
    adminEmail: string;
    adminPassword?: string;
  },
) {
  requirePlatformAdmin(actor);
  const prisma = await db();
  const email = input.adminEmail.toLowerCase();
  const password = input.adminPassword ?? generatePassword();
  assertPasswordStrength(password, email);
  let slug = input.slug ?? slugify(input.name);
  const existingSlug = await prisma.organization.findUnique({ where: { slug } });
  if (existingSlug) slug = `${slug}-${generatePassword().slice(0, 4).toLowerCase()}`;

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.name,
        slug,
        timezone: input.timezone ?? "UTC",
      },
    });
    const existing = await tx.user.findUnique({ where: { email } });
    let user = existing;
    let createdUser = false;
    if (!user) {
      user = await tx.user.create({
        data: {
          email,
          name: input.adminName,
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
        },
      });
      createdUser = true;
    } else if (!user.active) {
      throw new AppError(409, "user_inactive", "That email belongs to a deactivated user.");
    }
    const membership = await tx.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } } });
    if (membership) throw new AppError(409, "already_member", "That person is already a member of this organization.");
    await tx.membership.create({
      data: { userId: user.id, organizationId: org.id, role: "org_admin" },
    });
    await audit(tx, {
      organizationId: org.id,
      actorId: actor.userId,
      action: "organization.created",
      entityType: "organization",
      entityId: org.id,
      metadata: { name: org.name, slug: org.slug, adminEmail: email, existingUser: !createdUser },
      ip: actor.ip,
    });
    return { org, createdUser, userId: user.id };
  });

  return {
    organization: { id: result.org.id, name: result.org.name, slug: result.org.slug },
    admin: {
      id: result.userId,
      email,
      existingUser: !result.createdUser,
      temporaryPassword: result.createdUser ? password : null,
    },
  };
}

export async function updateOrganizationLimits(
  actor: Actor,
  organizationId: string,
  input: { maxSheltersOverride: number | null; active?: boolean },
) {
  requirePlatformAdmin(actor);
  const prisma = await db();
  const settings = await getPlatformSettings();
  if (input.maxSheltersOverride != null && input.maxSheltersOverride > settings.maxSheltersPerOrganization) {
    throw new AppError(400, "validation_error", "An organization cannot be allowed more shelters than the platform maximum.", {
      fields: { maxSheltersOverride: `Platform maximum is ${settings.maxSheltersPerOrganization}.` },
    });
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new AppError(404, "not_found", "Organization not found.");
  const data: Prisma.OrganizationUpdateInput = { maxSheltersOverride: input.maxSheltersOverride };
  if (input.active != null) data.active = input.active;
  const updated = await prisma.organization.update({ where: { id: organizationId }, data });
  await audit(prisma, {
    organizationId: org.id,
    actorId: actor.userId,
    action: "organization.limits_updated",
    entityType: "organization",
    entityId: org.id,
    metadata: { maxSheltersOverride: updated.maxSheltersOverride, active: updated.active },
    ip: actor.ip,
  });
  return {
    id: updated.id,
    maxSheltersOverride: updated.maxSheltersOverride,
    effectiveMaxShelters: effectiveShelterMax(settings.maxSheltersPerOrganization, updated.maxSheltersOverride),
    active: updated.active,
    shelterCount: updated.shelterCount,
  };
}
