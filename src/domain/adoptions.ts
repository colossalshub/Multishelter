export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "screening",
  "on_hold",
  "approved",
  "rejected",
  "withdrawn",
  "finalized",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  screening: "Screening",
  on_hold: "On hold",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  finalized: "Finalized",
};

const EDGES: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "withdrawn"],
  under_review: ["screening", "on_hold", "rejected", "withdrawn"],
  screening: ["approved", "rejected", "on_hold", "withdrawn"],
  on_hold: ["under_review", "screening", "rejected", "withdrawn"],
  approved: ["withdrawn"],
  rejected: [],
  withdrawn: [],
  finalized: [],
};

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export function canTransitionApplication(from: string, to: string): boolean {
  if (!isApplicationStatus(from) || !isApplicationStatus(to)) return false;
  return EDGES[from].includes(to);
}

export function applicationTransitions(from: string): ApplicationStatus[] {
  if (!isApplicationStatus(from)) return [];
  return EDGES[from];
}

export const OPEN_APPLICATION_STATUSES: ApplicationStatus[] = [
  "draft",
  "submitted",
  "under_review",
  "screening",
  "on_hold",
  "approved",
];

export function decisionRequired(to: string): boolean {
  return to === "rejected" || to === "withdrawn" || to === "approved";
}
