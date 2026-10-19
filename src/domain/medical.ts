export const SYSTEM_MEDICAL_CATEGORIES = [
  { key: "veterinary_consultation", label: "Veterinary consultation" },
  { key: "vaccination", label: "Vaccination" },
  { key: "deworming", label: "Deworming" },
  { key: "flea_tick", label: "Flea and tick treatment" },
  { key: "medication", label: "Medication" },
  { key: "procedure", label: "Medical procedure" },
  { key: "sterilization", label: "Sterilization" },
  { key: "injury_illness", label: "Injury or illness" },
  { key: "lab_result", label: "Laboratory or diagnostic note" },
  { key: "allergy", label: "Allergy or adverse reaction" },
  { key: "treatment_plan", label: "Treatment plan" },
  { key: "follow_up", label: "Follow-up" },
  { key: "recovery_observation", label: "Recovery observation" },
  { key: "medical_clearance", label: "Medical clearance" },
  { key: "other", label: "Other" },
] as const;

export type MedicalCategory = { key: string; label: string; custom?: boolean };

const SYSTEM_KEYS = new Set<string>(SYSTEM_MEDICAL_CATEGORIES.map((category) => category.key));

export function medicalCatalog(custom: { key: string; label: string }[]): MedicalCategory[] {
  const extra = custom
    .filter((category) => !SYSTEM_KEYS.has(category.key))
    .map((category) => ({ ...category, custom: true }));
  return [...SYSTEM_MEDICAL_CATEGORIES, ...extra];
}

export function isMedicalCategoryKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{1,40}$/.test(key);
}

export const TASK_KINDS = ["appointment", "follow_up", "medication_reminder"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  appointment: "Appointment",
  follow_up: "Follow-up",
  medication_reminder: "Medication reminder",
};

export function isTaskKind(value: string): value is TaskKind {
  return (TASK_KINDS as readonly string[]).includes(value);
}
