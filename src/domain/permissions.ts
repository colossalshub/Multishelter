export const ORG_ROLES = [
  "org_admin",
  "shelter_manager",
  "animal_care",
  "veterinary",
  "adoption_staff",
  "read_only",
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export const PERMISSIONS = [
  "animals.read",
  "animals.write",
  "animals.transfer",
  "medical.read",
  "medical.write",
  "adoptions.read",
  "adoptions.write",
  "adoptions.finalize",
  "people.read",
  "people.write",
  "people.redact",
  "reports.read",
  "reports.export",
  "tasks.read",
  "tasks.write",
  "shelters.manage",
  "users.manage",
  "settings.manage",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_LABELS: Record<OrgRole, string> = {
  org_admin: "Organization administrator",
  shelter_manager: "Shelter manager",
  animal_care: "Animal care staff",
  veterinary: "Veterinary staff",
  adoption_staff: "Adoption staff",
  read_only: "Read-only",
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  "animals.read": "View animals",
  "animals.write": "Edit animals",
  "animals.transfer": "Transfer animals",
  "medical.read": "View medical records",
  "medical.write": "Record medical information",
  "adoptions.read": "View adoptions",
  "adoptions.write": "Manage applications",
  "adoptions.finalize": "Finalize or return adoptions",
  "people.read": "View applicant details",
  "people.write": "Edit applicant details",
  "people.redact": "Redact applicant details",
  "reports.read": "View reports",
  "reports.export": "Export reports",
  "tasks.read": "View care tasks",
  "tasks.write": "Update care tasks",
  "shelters.manage": "Manage shelters",
  "users.manage": "Manage users",
  "settings.manage": "Manage organization settings",
  "audit.read": "View audit history",
};

const ALL: Permission[] = [...PERMISSIONS];

export const DEFAULT_ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  org_admin: ALL,
  shelter_manager: [
    "animals.read",
    "animals.write",
    "animals.transfer",
    "medical.read",
    "medical.write",
    "adoptions.read",
    "adoptions.write",
    "adoptions.finalize",
    "people.read",
    "people.write",
    "reports.read",
    "reports.export",
    "tasks.read",
    "tasks.write",
    "audit.read",
  ],
  animal_care: ["animals.read", "animals.write", "tasks.read", "tasks.write", "reports.read"],
  veterinary: ["animals.read", "medical.read", "medical.write", "tasks.read", "tasks.write", "reports.read"],
  adoption_staff: [
    "animals.read",
    "adoptions.read",
    "adoptions.write",
    "adoptions.finalize",
    "people.read",
    "people.write",
    "reports.read",
    "reports.export",
    "tasks.read",
  ],
  read_only: ["animals.read", "reports.read", "tasks.read"],
};

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function permissionsForRole(role: OrgRole): Permission[] {
  return DEFAULT_ROLE_PERMISSIONS[role];
}
