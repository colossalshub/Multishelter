import { AppError, notFound } from "@/domain/errors";
import {
  DEFAULT_ROLE_PERMISSIONS,
  isOrgRole,
  isPermission,
  type OrgRole,
  type Permission,
} from "@/domain/permissions";

export type Actor = {
  userId: string;
  name: string;
  email: string;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
  sessionId: string;
  organizationId: string | null;
  role: OrgRole | null;
  shelterIds: string[] | null;
  permissions: Set<Permission>;
  activeShelterId: string | null;
  ip: string | null;
};

export function requireUser(actor: Actor | null): Actor {
  if (!actor) throw new AppError(401, "unauthenticated", "Sign in to continue.");
  return actor;
}

export function requireOrg(actor: Actor): string {
  if (!actor.organizationId || !actor.role) {
    throw new AppError(403, "organization_required", "Choose an organization you belong to.");
  }
  return actor.organizationId;
}

export function requirePermission(actor: Actor, permission: Permission): void {
  requireOrg(actor);
  if (!actor.permissions.has(permission)) {
    throw new AppError(403, "forbidden", "You do not have permission to do that.");
  }
}

export function requirePlatformAdmin(actor: Actor): void {
  if (!actor.isPlatformAdmin) {
    throw new AppError(403, "forbidden", "Platform administrator access is required.");
  }
}

export function assertShelterAccess(actor: Actor, shelterId: string): void {
  if (actor.shelterIds == null) return;
  if (!actor.shelterIds.includes(shelterId)) throw notFound();
}

export function scopedShelterIds(actor: Actor, requested?: string | null): string[] | undefined {
  if (requested) {
    assertShelterAccess(actor, requested);
    return [requested];
  }
  if (actor.activeShelterId) {
    assertShelterAccess(actor, actor.activeShelterId);
    return [actor.activeShelterId];
  }
  if (actor.shelterIds == null) return undefined;
  return actor.shelterIds;
}

export function hasPermission(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function permissionsFromRows(role: OrgRole, rows: { permission: string; allowed: boolean }[]): Set<Permission> {
  if (role === "org_admin") return new Set(DEFAULT_ROLE_PERMISSIONS.org_admin);
  if (rows.length === 0) return new Set(DEFAULT_ROLE_PERMISSIONS[role]);
  const allowed = rows.filter((row) => row.allowed && isPermission(row.permission)).map((row) => row.permission as Permission);
  return new Set(allowed);
}

export function assertRole(value: string): OrgRole {
  if (!isOrgRole(value)) throw new AppError(400, "invalid_role", "Unknown role.");
  return value;
}
