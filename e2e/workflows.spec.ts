import { expect, test, type Page } from "@playwright/test";

test("staff can run shelter, medical, and adoption workflows", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("platform.e2e@example.com");
  await page.getByLabel("Password").fill("E2e-platform-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Platform", exact: true })).toBeVisible();

  await page.getByLabel("Organization name").fill("Harbor Rescue");
  await page.getByLabel("Administrator name").fill("Harbor Admin");
  await page.getByLabel("Administrator email").fill("harbor.admin@example.com");
  await page.getByRole("button", { name: "Create organization" }).click();
  const created = page.getByText(/Temporary password for harbor.admin@example.com:/);
  await expect(created).toBeVisible();
  const tempPassword = (await created.textContent())?.split(":").pop()?.trim() ?? "";
  expect(tempPassword.length).toBeGreaterThanOrEqual(10);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
  await page.getByLabel("Email").fill("harbor.admin@example.com");
  await page.getByLabel("Password").fill(tempPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  await page.getByLabel("Current password").fill(tempPassword);
  await page.getByLabel("New password").fill("Harbor-admin-pass");
  await page.getByRole("button", { name: "Update password" }).click();

  await expect(page.getByRole("heading", { name: /Set up Harbor Rescue/ })).toBeVisible();
  await page.getByLabel("Shelter name").fill("Harbor One");
  await page.getByLabel("Capacity").fill("12");
  await page.getByRole("button", { name: "Save shelter" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  for (const name of ["Harbor Two", "Harbor Three"]) {
    await page.getByLabel("New shelter name").fill(name);
    await page.getByRole("button", { name: "Add shelter" }).click();
    await expect(page.getByRole("paragraph").filter({ hasText: name })).toBeVisible();
  }
  await page.getByLabel("New shelter name").fill("Harbor Four");
  await page.getByRole("button", { name: "Add shelter" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /at most 3 shelters/i })).toBeVisible();

  await registerAnimal(page, "Miso", "cat");
  await registerAnimal(page, "Bear", "dog");

  await openAnimal(page, "Miso");
  await expect(page.getByText("Intake pending")).toBeVisible();
  await page.getByRole("link", { name: "Add medical record" }).click();
  await page.getByLabel("Provider name").fill("Dr. Adeyemi");
  await page.getByLabel("This information was provided by a veterinary professional").check();
  await page.getByLabel("Observations").fill("Eating well. Notes entered by staff.");
  await page.getByLabel("Diagnosis as recorded").fill("Examination recorded from the veterinarian.");
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(page.getByText("does not generate diagnoses")).toBeVisible();

  await page.goto("/medical/new");
  const animalSelect = page.getByLabel("Animal");
  await expect(animalSelect.locator("option", { hasText: "Miso" })).toHaveCount(1);
  const misoLabel = (await animalSelect.locator("option", { hasText: "Miso" }).textContent())?.trim() ?? "";
  await animalSelect.selectOption({ label: misoLabel });
  await page.getByLabel("Category").selectOption("vaccination");
  await page.getByLabel("Provider name").fill("Dr. Adeyemi");
  await page.getByLabel("This information was provided by a veterinary professional").check();
  await page.getByLabel("Medication").fill("FVRCP");
  await page.getByLabel("Dose as recorded").fill("As recorded: 1 ml");
  const followUp = page.getByLabel("Next follow-up");
  await followUp.fill("2026-11-02T09:00");
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(page.getByText("FVRCP")).toBeVisible();

  await page.getByRole("link", { name: "Applicants" }).click();
  await page.getByRole("link", { name: "Add applicant" }).click();
  await page.getByRole("main").getByLabel(/first name/i).fill("Amina");
  await page.getByRole("main").getByLabel(/last name/i).fill("Khan");
  await page.getByRole("main").getByLabel(/^email$/i).fill("amina@example.com");
  await page.getByRole("button", { name: "Save applicant" }).click();
  await expect(page.getByRole("heading", { name: "Edit applicant" })).toBeVisible();

  await page.goto("/adoptions/new");
  await page.getByLabel("Applicant").selectOption({ label: "Amina Khan" });
  await page.getByRole("checkbox", { name: /Miso/ }).check();
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByLabel("Reason or note").fill("Staff reviewed the household.");
  for (const [name, status] of [
    ["Submit", "submitted"],
    ["Start review", "under review"],
    ["Begin screening", "screening"],
  ] as const) {
    await page.getByRole("button", { name }).click();
    await expect(page.getByText(status, { exact: true })).toBeVisible();
  }
  await page.getByLabel("Reason or note").fill("Approved after staff screening.");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Finalize adoption" })).toBeVisible();
  await page.getByLabel(/I acknowledge that any animal with unknown medical clearance/).check();
  await page.getByRole("button", { name: "Finalize adoption" }).click();
  await expect(page.getByText("Completed adoption")).toBeVisible();

  await openAnimal(page, "Miso");
  await expect(page.getByText("Adopted", { exact: true })).toBeVisible();

  await openAnimal(page, "Bear");
  await page.getByRole("button", { name: "Transfer shelter" }).click();
  await page.getByLabel("Destination shelter").selectOption({ label: "Harbor Two" });
  await page.getByRole("dialog").getByLabel("Reason").fill("More kennel space");
  await page.getByRole("dialog").getByRole("button", { name: "Transfer" }).click();
  await expect(page.locator("h1 + p")).toContainText("Harbor Two");

  await page.goto("/");
  const inCare = page.locator("section").filter({ has: page.getByText("In care", { exact: true }) });
  await expect(inCare.getByText("1", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Reports" }).click();
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("heading", { name: "Animal population by shelter" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/animals");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Animals" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Miso", exact: true })).toBeVisible();
});

async function openAnimal(page: Page, name: string) {
  await page.goto("/animals");
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function registerAnimal(page: Page, name: string, species: "cat" | "dog") {
  await page.goto("/animals/new");
  await page.getByRole("main").getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("main").getByLabel("Species").selectOption(species);
  await page.getByRole("main").getByLabel("Shelter").selectOption({ label: "Harbor One" });
  const intake = page.getByRole("main").getByLabel("Intake date");
  if (!(await intake.inputValue())) await intake.fill("2026-10-19T09:30");
  await page.getByRole("button", { name: "Save animal" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}
