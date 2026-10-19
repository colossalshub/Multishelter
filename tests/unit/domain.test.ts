import { describe, expect, it } from "vitest";
import { canTransitionApplication } from "@/domain/adoptions";
import {
  canTransitionStatus,
  duplicateWarnings,
  effectiveShelterMax,
  normalizeMicrochip,
  statusCatalog,
} from "@/domain/animals";
import { csvCell, toCsv } from "@/domain/csv";
import { detectUpload, safeStoragePath } from "@/domain/files";
import { DEFAULT_ROLE_PERMISSIONS } from "@/domain/permissions";

describe("shelter capacity", () => {
  it("uses the platform maximum and never lets an override exceed it", () => {
    expect(effectiveShelterMax(3, null)).toBe(3);
    expect(effectiveShelterMax(3, 1)).toBe(1);
    expect(effectiveShelterMax(3, 2)).toBe(2);
    expect(effectiveShelterMax(3, 9)).toBe(3);
  });
});

describe("animal status transitions", () => {
  const catalog = statusCatalog([]);
  const status = (key: string) => catalog.find((item) => item.key === key)!;

  it("allows in-care changes and rejects outcome shortcuts", () => {
    expect(canTransitionStatus(status("intake_pending"), status("available"))).toBe(true);
    expect(canTransitionStatus(status("available"), status("medical_hold"))).toBe(true);
    expect(canTransitionStatus(status("available"), status("adopted"))).toBe(false);
    expect(canTransitionStatus(status("available"), status("deceased"))).toBe(false);
    expect(canTransitionStatus(status("adopted"), status("available"))).toBe(false);
    expect(canTransitionStatus(status("deceased"), status("available"))).toBe(false);
  });

  it("keeps custom statuses out of system keys", () => {
    const custom = statusCatalog([{ key: "available", label: "Nope", category: "in_care" }, { key: "court_hold", label: "Court hold", category: "in_care" }]);
    expect(custom.filter((item) => item.key === "available")).toHaveLength(1);
    expect(custom.find((item) => item.key === "court_hold")?.occupancy).toBe(true);
  });
});

describe("adoption workflow", () => {
  it("requires an approved application before finalization and allows withdrawal", () => {
    expect(canTransitionApplication("draft", "submitted")).toBe(true);
    expect(canTransitionApplication("screening", "approved")).toBe(true);
    expect(canTransitionApplication("approved", "finalized")).toBe(false);
    expect(canTransitionApplication("approved", "withdrawn")).toBe(true);
    expect(canTransitionApplication("finalized", "draft")).toBe(false);
  });
});

describe("duplicates and identifiers", () => {
  it("normalizes microchips and warns on similar animals", () => {
    expect(normalizeMicrochip("  abc 123 ")).toBe("ABC123");
    expect(normalizeMicrochip("   ")).toBeNull();
    const warnings = duplicateWarnings(
      { name: "Miso", species: "cat", color: "orange" },
      [{ id: "1", publicCode: "A-000001", name: " miso ", species: "cat", microchip: null, color: "Orange", shelterId: "s" }],
    );
    expect(warnings).toHaveLength(1);
  });
});

describe("csv safety", () => {
  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell("=cmd()")).toBe("'=cmd()");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@sum")).toBe("'@sum");
    const csv = toCsv(["Name"], [["=HYPERLINK(\"http://evil\")"]]);
    expect(csv.startsWith("Name")).toBe(true);
    expect(csv).toContain("'=HYPERLINK");
  });
});

describe("files", () => {
  it("detects allowed signatures and rejects path traversal", () => {
    expect(detectUpload(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "image")?.mimeType).toBe("image/jpeg");
    expect(detectUpload(Buffer.from("not an image!!!!"), "image")).toBeNull();
    expect(safeStoragePath("/tmp/storage", "../secret.txt")).toBeNull();
    expect(safeStoragePath("/tmp/storage", "org/file.jpg")).toBe("/tmp/storage/org/file.jpg");
  });
});

describe("default permissions", () => {
  it("keeps medical and applicant data off read-only and adoption roles separate", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.read_only).not.toContain("medical.read");
    expect(DEFAULT_ROLE_PERMISSIONS.read_only).not.toContain("people.read");
    expect(DEFAULT_ROLE_PERMISSIONS.adoption_staff).not.toContain("medical.read");
    expect(DEFAULT_ROLE_PERMISSIONS.veterinary).not.toContain("people.read");
    expect(DEFAULT_ROLE_PERMISSIONS.animal_care).not.toContain("medical.write");
    expect(DEFAULT_ROLE_PERMISSIONS.org_admin).toContain("settings.manage");
  });
});
