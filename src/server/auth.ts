import { AppError } from "@/domain/errors";
import { ROLE_LABELS, type OrgRole } from "@/domain/permissions";
import { assertPasswordStrength } from "@/domain/validation";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/actor";
import { permissionsFromRows, requireUser } from "@/server/actor";
import { generatePassword, hashPassword, hashToken, newSecret, verifyPassword } from "@/server/crypto";
import { db } from "@/server/db";
import { getPlatformSettings } from "@/server/platform";
import { assertWithinRateLimit, clearRateLimit, recordRateLimit } from "@/server/rate";
import { serializeShelter } from "@/server/serialize";

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export async function login(input: { email: string; password: string }, meta: { ip: string | null; userAgent: string | null }) {
  const email = input.email.toLowerCase();
  const ipBucket = `${meta.ip ?? "local"}|login`;
  const emailBucket = `${email}|login`;
  await assertWithinRateLimit(ipBucket, 30, 15 * 60 * 1000);
  await assertWithinRateLimit(emailBucket, 8, 15 * 60 * 1000);
  const prisma = await db();
  const user = await prisma.user.findUnique({ where: { email }, include: { memberships: { where: { active: true }, include: { organization: true } } } });
  const valid = Boolean(user && user.active && (await verifyPassword(input.password, user.passwordHash)));
  if (!user || !valid) {
    await recordRateLimit(ipBucket);
    await recordRateLimit(emailBucket);
    await audit(prisma, {
      actorId: user?.id,
      action: "auth.login_failed",
      entityType: "user",
      entityId: user?.id,
      metadata: { email },
      ip: meta.ip,
    });
    throw new AppError(401, "invalid_login", "Email or password is incorrect.");
  }
  await clearRateLimit(emailBucket);
  const token = newSecret();
  const csrfSecret = newSecret();
  const expiresAt = new Date(Date.now() + SESSION_MS);
  const onlyOrg = user.memberships.length === 1 ? user.memberships[0] : null;
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      csrfSecret,
      expiresAt,
      activeOrganizationId: onlyOrg?.organizationId ?? null,
      userAgent: meta.userAgent,
      ip: meta.ip,
    },
  });
  await audit(prisma, {
    organizationId: onlyOrg?.organizationId,
    actorId: user.id,
    action: "auth.login",
    entityType: "session",
    entityId: session.id,
    ip: meta.ip,
  });
  return { token, csrfSecret, expiresAt };
}

export async function logout(actor: Actor) {
  const prisma = await db();
  await prisma.session.deleteMany({ where: { id: actor.sessionId } });
  await audit(prisma, {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "auth.logout",
    entityType: "session",
    entityId: actor.sessionId,
    ip: actor.ip,
  });
}

export async function changePassword(actor: Actor, input: { currentPassword: string; newPassword: string }) {
  const userActor = requireUser(actor);
  assertPasswordStrength(input.newPassword, userActor.email);
  const prisma = await db();
  const user = await prisma.user.findUnique({ where: { id: userActor.userId } });
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError(401, "invalid_login", "Current password is incorrect.");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
  });
  await prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: actor.sessionId } } });
  await audit(prisma, {
    organizationId: actor.organizationId,
    actorId: user.id,
    action: "auth.password_changed",
    entityType: "user",
    entityId: user.id,
    ip: actor.ip,
  });
}

export async function setSessionContext(actor: Actor, input: { organizationId: string | null; shelterId?: string | null }) {
  const prisma = await db();
  let shelterId: string | null = null;
  if (input.organizationId) {
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: actor.userId, organizationId: input.organizationId } },
      include: { shelters: true, organization: true },
    });
    if (!membership || !membership.active || !membership.organization.active) {
      throw new AppError(403, "forbidden", "You do not belong to that organization.");
    }
    if (input.shelterId) {
      const allowed = membership.role === "org_admin" || membership.shelters.some((item) => item.shelterId === input.shelterId);
      const shelter = await prisma.shelter.findFirst({ where: { id: input.shelterId, organizationId: input.organizationId } });
      if (!allowed || !shelter) throw new AppError(403, "forbidden", "You cannot use that shelter.");
      shelterId = shelter.id;
    }
  }
  await prisma.session.update({
    where: { id: actor.sessionId },
    data: { activeOrganizationId: input.organizationId, activeShelterId: shelterId },
  });
  return currentUser(actor.sessionId, actor.ip);
}

export async function actorFromToken(token: string | undefined, ip: string | null): Promise<Actor | null> {
  if (!token) return null;
  const prisma = await db();
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt.getTime() < Date.now() || !session.user.active) return null;
  return buildActor(session.id, session.user, session.activeOrganizationId, session.activeShelterId, session.csrfSecret, ip);
}

export async function currentUser(sessionId: string, ip: string | null) {
  const prisma = await db();
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!session) throw new AppError(401, "unauthenticated", "Sign in to continue.");
  const actor = await buildActor(session.id, session.user, session.activeOrganizationId, session.activeShelterId, session.csrfSecret, ip);
  return presentSession(actor, session.csrfSecret);
}

export async function presentSession(actor: Actor, csrfSecret?: string) {
  const prisma = await db();
  const settings = await getPlatformSettings();
  const memberships = await prisma.membership.findMany({
    where: { userId: actor.userId, active: true, organization: { active: true } },
    include: { organization: true },
  });
  let organization = null;
  let shelters: ReturnType<typeof serializeShelter>[] = [];
  let needsOnboarding = false;
  if (actor.organizationId) {
    const org = await prisma.organization.findUnique({ where: { id: actor.organizationId } });
    if (org) {
      organization = {
        id: org.id,
        name: org.name,
        slug: org.slug,
        primaryColor: org.primaryColor,
        accentColor: org.accentColor,
        timezone: org.timezone,
        locale: org.locale,
        dateFormat: org.dateFormat,
        currency: org.currency,
        logoUrl: org.logoStorageKey ? "/api/files/org-logo" : null,
        shelterCount: org.shelterCount,
        adoptionFeeEnabled: org.adoptionFeeEnabled,
      };
      const shelterRows = await prisma.shelter.findMany({
        where: { organizationId: org.id, ...(actor.shelterIds ? { id: { in: actor.shelterIds } } : {}) },
        orderBy: { name: "asc" },
      });
      shelters = shelterRows.map(serializeShelter);
      needsOnboarding = actor.role === "org_admin" && org.shelterCount === 0;
    }
  }
  return {
    user: {
      id: actor.userId,
      name: actor.name,
      email: actor.email,
      isPlatformAdmin: actor.isPlatformAdmin,
      mustChangePassword: actor.mustChangePassword,
    },
    platformName: settings.platformName,
    csrfToken: csrfSecret ?? null,
    organization,
    role: actor.role,
    roleLabel: actor.role ? ROLE_LABELS[actor.role] : null,
    permissions: [...actor.permissions],
    activeShelterId: actor.activeShelterId,
    shelters,
    needsOnboarding,
    memberships: memberships.map((membership) => ({
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: membership.role,
    })),
  };
}

async function buildActor(
  sessionId: string,
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean; mustChangePassword: boolean; active: boolean },
  organizationId: string | null,
  activeShelterId: string | null,
  _csrf: string,
  ip: string | null,
): Promise<Actor> {
  const prisma = await db();
  let role: OrgRole | null = null;
  let shelterIds: string[] | null = null;
  let permissions = new Set<Actor["permissions"] extends Set<infer T> ? T : never>();
  let shelterContext = activeShelterId;
  if (organizationId) {
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId } },
      include: { shelters: true, organization: true },
    });
    if (!membership || !membership.active || !membership.organization.active) {
      organizationId = null;
      shelterContext = null;
    } else {
      role = membership.role as OrgRole;
      shelterIds = role === "org_admin" ? null : membership.shelters.map((item) => item.shelterId);
      const rows = await prisma.rolePermission.findMany({ where: { organizationId, role } });
      permissions = permissionsFromRows(role, rows);
      if (shelterContext && shelterIds && !shelterIds.includes(shelterContext)) shelterContext = null;
    }
  }
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    isPlatformAdmin: user.isPlatformAdmin,
    mustChangePassword: user.mustChangePassword,
    sessionId,
    organizationId,
    role,
    shelterIds,
    permissions,
    activeShelterId: shelterContext,
    ip,
  };
}

export async function sessionCsrf(sessionId: string): Promise<string | null> {
  const prisma = await db();
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  return session?.csrfSecret ?? null;
}

export { generatePassword };
