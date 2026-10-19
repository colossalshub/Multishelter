import { Prisma } from "@prisma/client";
import { AppError } from "@/domain/errors";
import { contentDisposition } from "@/domain/files";
import {
  administrationSchema,
  animalWriteSchema,
  applicantSchema,
  applicationAnimalsSchema,
  applicationSchema,
  archiveSchema,
  careTaskSchema,
  clearanceSchema,
  completeFollowUpSchema,
  createOrganizationSchema,
  createUserSchema,
  finalizeSchema,
  followUpSchema,
  loginSchema,
  medicalWriteSchema,
  orgMaxSchema,
  orgSettingsSchema,
  outcomeSchema,
  passwordChangeSchema,
  permissionMatrixSchema,
  platformSettingsSchema,
  reportQuerySchema,
  returnSchema,
  screeningSchema,
  sessionContextSchema,
  shelterSchema,
  statusChangeSchema,
  taskActionSchema,
  transferSchema,
  transitionSchema,
  updateUserSchema,
  parseInput,
} from "@/domain/validation";
import {
  addFollowUp,
  addAdoptionDocument,
  addScreening,
  completeFollowUp,
  createApplicant,
  createApplication,
  finalizeAdoption,
  getAdoptionDocument,
  getApplicant,
  getApplication,
  listApplicants,
  listApplications,
  redactApplicant,
  returnAdoption,
  setApplicationAnimals,
  transitionApplication,
  updateApplicant,
} from "@/server/adoptions";
import { actorFromToken, changePassword, currentUser, login, logout, sessionCsrf, setSessionContext } from "@/server/auth";
import type { Actor } from "@/server/actor";
import { requirePermission, requirePlatformAdmin, requireUser } from "@/server/actor";
import { secretsMatch } from "@/server/crypto";
import { dashboard, listAudit } from "@/server/dashboard";
import { db } from "@/server/db";
import {
  addAnimalPhoto,
  animalTimeline,
  archiveAnimal,
  changeStatus,
  createAnimal,
  getAnimal,
  getAnimalPhoto,
  listAnimals,
  matchAnimals,
  recordOutcome,
  transferAnimal,
  updateAnimal,
} from "@/server/animals";
import {
  addMedicalAttachment,
  completeCareTask,
  correctMedicalRecord,
  createCareTask,
  createMedicalRecord,
  getMedicalAttachment,
  getMedicalRecord,
  listCareTasks,
  listMedicalRecords,
  recordAdministration,
  setClearance,
} from "@/server/medical";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/server/notifications";
import { getPlatformSettings, listOrganizations, updateOrganizationLimits, updatePlatformSettings, createOrganization } from "@/server/platform";
import { availableReports, exportReport, runReport } from "@/server/reports";
import { createShelter, listShelters, updateShelter } from "@/server/shelters";
import { readStored, removeStored, storeUpload } from "@/server/storage";
import {
  createOrgUser,
  getOrganization,
  getPermissionMatrix,
  listUsers,
  resetOrgUserPassword,
  updateOrganization,
  updateOrgUser,
  updatePermissionMatrix,
} from "@/server/users";
import { audit } from "@/server/audit";

type Ctx = { req: Request; url: URL; params: Record<string, string>; actor: Actor | null; ip: string };

type Route = {
  method: string;
  pattern: RegExp;
  auth: "public" | "user" | "org";
  password?: boolean;
  handler: (ctx: Ctx) => Promise<Response>;
};

const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/health$/, auth: "public", handler: health },
  { method: "GET", pattern: /^\/api\/branding$/, auth: "public", handler: branding },
  { method: "POST", pattern: /^\/api\/auth\/login$/, auth: "public", handler: postLogin },
  { method: "POST", pattern: /^\/api\/auth\/logout$/, auth: "user", password: true, handler: postLogout },
  { method: "GET", pattern: /^\/api\/auth\/me$/, auth: "user", password: true, handler: getMe },
  { method: "POST", pattern: /^\/api\/auth\/password$/, auth: "user", password: true, handler: postPassword },
  { method: "POST", pattern: /^\/api\/session\/context$/, auth: "user", handler: postContext },
  { method: "GET", pattern: /^\/api\/platform\/settings$/, auth: "user", handler: getPlatform },
  { method: "PUT", pattern: /^\/api\/platform\/settings$/, auth: "user", handler: putPlatform },
  { method: "GET", pattern: /^\/api\/platform\/organizations$/, auth: "user", handler: getOrgs },
  { method: "POST", pattern: /^\/api\/platform\/organizations$/, auth: "user", handler: postOrg },
  { method: "PATCH", pattern: /^\/api\/platform\/organizations\/([^/]+)$/, auth: "user", handler: patchOrgLimits },
  { method: "GET", pattern: /^\/api\/organization$/, auth: "org", handler: getOrg },
  { method: "PUT", pattern: /^\/api\/organization$/, auth: "org", handler: putOrg },
  { method: "POST", pattern: /^\/api\/organization\/logo$/, auth: "org", handler: postLogo },
  { method: "GET", pattern: /^\/api\/shelters$/, auth: "org", handler: getShelters },
  { method: "POST", pattern: /^\/api\/shelters$/, auth: "org", handler: postShelter },
  { method: "PATCH", pattern: /^\/api\/shelters\/([^/]+)$/, auth: "org", handler: patchShelter },
  { method: "GET", pattern: /^\/api\/users$/, auth: "org", handler: getUsers },
  { method: "POST", pattern: /^\/api\/users$/, auth: "org", handler: postUser },
  { method: "PATCH", pattern: /^\/api\/users\/([^/]+)$/, auth: "org", handler: patchUser },
  { method: "POST", pattern: /^\/api\/users\/([^/]+)\/reset-password$/, auth: "org", handler: postReset },
  { method: "GET", pattern: /^\/api\/permissions$/, auth: "org", handler: getPerms },
  { method: "PUT", pattern: /^\/api\/permissions$/, auth: "org", handler: putPerms },
  { method: "GET", pattern: /^\/api\/animals$/, auth: "org", handler: getAnimals },
  { method: "POST", pattern: /^\/api\/animals$/, auth: "org", handler: postAnimal },
  { method: "GET", pattern: /^\/api\/animals\/([^/]+)$/, auth: "org", handler: getOneAnimal },
  { method: "PATCH", pattern: /^\/api\/animals\/([^/]+)$/, auth: "org", handler: patchAnimal },
  { method: "POST", pattern: /^\/api\/animals\/([^/]+)\/status$/, auth: "org", handler: postStatus },
  { method: "POST", pattern: /^\/api\/animals\/([^/]+)\/outcomes$/, auth: "org", handler: postOutcome },
  { method: "POST", pattern: /^\/api\/animals\/([^/]+)\/transfers$/, auth: "org", handler: postTransfer },
  { method: "POST", pattern: /^\/api\/animals\/([^/]+)\/archive$/, auth: "org", handler: postArchive },
  { method: "POST", pattern: /^\/api\/animals\/([^/]+)\/unarchive$/, auth: "org", handler: postUnarchive },
  { method: "POST", pattern: /^\/api\/animals\/([^/]+)\/photos$/, auth: "org", handler: postPhoto },
  { method: "GET", pattern: /^\/api\/animals\/([^/]+)\/timeline$/, auth: "org", handler: getTimeline },
  { method: "POST", pattern: /^\/api\/animals\/([^/]+)\/clearance$/, auth: "org", handler: postClearance },
  { method: "GET", pattern: /^\/api\/files\/photos\/([^/]+)$/, auth: "org", handler: getPhoto },
  { method: "GET", pattern: /^\/api\/files\/org-logo$/, auth: "org", handler: getLogo },
  { method: "GET", pattern: /^\/api\/medical-records$/, auth: "org", handler: getMedical },
  { method: "POST", pattern: /^\/api\/medical-records$/, auth: "org", handler: postMedical },
  { method: "GET", pattern: /^\/api\/medical-records\/([^/]+)$/, auth: "org", handler: getOneMedical },
  { method: "POST", pattern: /^\/api\/medical-records\/([^/]+)\/corrections$/, auth: "org", handler: postCorrection },
  { method: "POST", pattern: /^\/api\/medical-records\/([^/]+)\/attachments$/, auth: "org", handler: postMedicalFile },
  { method: "POST", pattern: /^\/api\/medical-records\/([^/]+)\/administrations$/, auth: "org", handler: postAdmin },
  { method: "GET", pattern: /^\/api\/files\/medical\/([^/]+)$/, auth: "org", handler: getMedicalFile },
  { method: "GET", pattern: /^\/api\/care-tasks$/, auth: "org", handler: getTasks },
  { method: "POST", pattern: /^\/api\/care-tasks$/, auth: "org", handler: postTask },
  { method: "POST", pattern: /^\/api\/care-tasks\/([^/]+)\/complete$/, auth: "org", handler: postCompleteTask },
  { method: "POST", pattern: /^\/api\/care-tasks\/([^/]+)\/cancel$/, auth: "org", handler: postCancelTask },
  { method: "GET", pattern: /^\/api\/applicants$/, auth: "org", handler: getApplicants },
  { method: "POST", pattern: /^\/api\/applicants$/, auth: "org", handler: postApplicant },
  { method: "GET", pattern: /^\/api\/applicants\/([^/]+)$/, auth: "org", handler: getOneApplicant },
  { method: "PATCH", pattern: /^\/api\/applicants\/([^/]+)$/, auth: "org", handler: patchApplicant },
  { method: "POST", pattern: /^\/api\/applicants\/([^/]+)\/redact$/, auth: "org", handler: postRedact },
  { method: "GET", pattern: /^\/api\/applications$/, auth: "org", handler: getApplications },
  { method: "POST", pattern: /^\/api\/applications$/, auth: "org", handler: postApplication },
  { method: "GET", pattern: /^\/api\/applications\/([^/]+)$/, auth: "org", handler: getOneApplication },
  { method: "PATCH", pattern: /^\/api\/applications\/([^/]+)$/, auth: "org", handler: patchApplication },
  { method: "POST", pattern: /^\/api\/applications\/([^/]+)\/transition$/, auth: "org", handler: postTransition },
  { method: "POST", pattern: /^\/api\/applications\/([^/]+)\/screening$/, auth: "org", handler: postScreening },
  { method: "POST", pattern: /^\/api\/applications\/([^/]+)\/finalize$/, auth: "org", handler: postFinalize },
  { method: "POST", pattern: /^\/api\/adoptions\/([^/]+)\/return$/, auth: "org", handler: postReturn },
  { method: "POST", pattern: /^\/api\/adoptions\/([^/]+)\/follow-ups$/, auth: "org", handler: postFollowUp },
  { method: "POST", pattern: /^\/api\/adoptions\/([^/]+)\/follow-ups\/([^/]+)\/complete$/, auth: "org", handler: postCompleteFollowUp },
  { method: "POST", pattern: /^\/api\/adoptions\/([^/]+)\/documents$/, auth: "org", handler: postAdoptionDoc },
  { method: "GET", pattern: /^\/api\/files\/adoption-documents\/([^/]+)$/, auth: "org", handler: getAdoptionDoc },
  { method: "GET", pattern: /^\/api\/match$/, auth: "org", handler: getMatch },
  { method: "GET", pattern: /^\/api\/dashboard$/, auth: "org", handler: getDashboard },
  { method: "GET", pattern: /^\/api\/reports$/, auth: "org", handler: getReports },
  { method: "POST", pattern: /^\/api\/reports\/export$/, auth: "org", handler: postExport },
  { method: "GET", pattern: /^\/api\/audit$/, auth: "org", handler: getAudit },
  { method: "GET", pattern: /^\/api\/notifications$/, auth: "org", handler: getNotes },
  { method: "POST", pattern: /^\/api\/notifications\/read-all$/, auth: "org", handler: postReadAll },
  { method: "POST", pattern: /^\/api\/notifications\/([^/]+)\/read$/, auth: "org", handler: postRead },
];

export async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  try {
    const route = routes.find((item) => item.method === req.method && item.pattern.test(url.pathname));
    if (!route) return json({ error: { code: "not_found", message: "Not found." } }, 404);
    const ip = clientIp(req);
    const actor = await actorFromToken(readCookie(req, "pawhaven_session"), ip);
    if (route.auth !== "public") {
      if (!actor) throw new AppError(401, "unauthenticated", "Sign in to continue.");
      if (req.method !== "GET" && req.method !== "HEAD" && url.pathname !== "/api/auth/login") {
        const secret = await sessionCsrf(actor.sessionId);
        const header = req.headers.get("x-pawhaven-csrf") ?? "";
        if (!secret || !secretsMatch(header, secret)) throw new AppError(403, "csrf", "The form session expired. Reload the page and try again.");
      }
      if (actor.mustChangePassword && !route.password) {
        throw new AppError(403, "password_change_required", "Change the temporary password before continuing.");
      }
      if (route.auth === "org" && !actor.organizationId) {
        throw new AppError(403, "organization_required", "Choose an organization you belong to.");
      }
    }
    const match = url.pathname.match(route.pattern);
    const params: Record<string, string> = {};
    match?.slice(1).forEach((value, index) => {
      params[String(index)] = value;
    });
    return await route.handler({ req, url, params, actor, ip });
  } catch (error) {
    return errorResponse(error);
  }
}

async function health(): Promise<Response> {
  const prisma = await db();
  await prisma.$queryRaw`SELECT 1`;
  return json({ ok: true });
}

async function branding(): Promise<Response> {
  const settings = await getPlatformSettings();
  return json({ platformName: settings.platformName });
}

async function postLogin(ctx: Ctx): Promise<Response> {
  const input = parseInput(loginSchema, await readJson(ctx.req));
  const session = await login(input, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") });
  return json({ ok: true }, 200, [sessionCookie(session.token, session.expiresAt), csrfCookie(session.csrfSecret, session.expiresAt)]);
}

async function postLogout(ctx: Ctx): Promise<Response> {
  await logout(requireUser(ctx.actor));
  return json({ ok: true }, 200, clearCookies());
}

async function getMe(ctx: Ctx): Promise<Response> {
  const actor = requireUser(ctx.actor);
  return json(await currentUser(actor.sessionId, ctx.ip));
}

async function postPassword(ctx: Ctx): Promise<Response> {
  const input = parseInput(passwordChangeSchema, await readJson(ctx.req));
  await changePassword(requireUser(ctx.actor), input);
  return json({ ok: true });
}

async function postContext(ctx: Ctx): Promise<Response> {
  const input = parseInput(sessionContextSchema, await readJson(ctx.req));
  return json(await setSessionContext(requireUser(ctx.actor), input));
}

async function getPlatform(ctx: Ctx): Promise<Response> {
  requirePlatformAdmin(requireUser(ctx.actor));
  const settings = await getPlatformSettings();
  return json(settings);
}

async function putPlatform(ctx: Ctx): Promise<Response> {
  const input = parseInput(platformSettingsSchema, await readJson(ctx.req));
  return json(await updatePlatformSettings(requireUser(ctx.actor), input));
}

async function getOrgs(ctx: Ctx): Promise<Response> {
  return json(await listOrganizations(requireUser(ctx.actor)));
}

async function postOrg(ctx: Ctx): Promise<Response> {
  const input = parseInput(createOrganizationSchema, await readJson(ctx.req));
  return json(await createOrganization(requireUser(ctx.actor), input), 201);
}

async function patchOrgLimits(ctx: Ctx): Promise<Response> {
  const input = parseInput(orgMaxSchema, await readJson(ctx.req));
  return json(await updateOrganizationLimits(requireUser(ctx.actor), param(ctx, 0), input));
}

async function getOrg(ctx: Ctx): Promise<Response> {
  return json(await getOrganization(requireUser(ctx.actor)));
}

async function putOrg(ctx: Ctx): Promise<Response> {
  const input = parseInput(orgSettingsSchema, await readJson(ctx.req));
  return json(await updateOrganization(requireUser(ctx.actor), input));
}

async function postLogo(ctx: Ctx): Promise<Response> {
  const actor = requireUser(ctx.actor);
  requirePermission(actor, "settings.manage");
  const file = await readFile(ctx.req);
  const stored = await storeUpload(actor.organizationId!, file.bytes, "image");
  const prisma = await db();
  const org = await prisma.organization.findUnique({ where: { id: actor.organizationId! } });
  await prisma.organization.update({ where: { id: actor.organizationId! }, data: { logoStorageKey: stored.storageKey } });
  if (org?.logoStorageKey) await removeStored(org.logoStorageKey);
  await audit(prisma, { organizationId: actor.organizationId, actorId: actor.userId, action: "organization.logo_updated", entityType: "organization", entityId: actor.organizationId, ip: actor.ip });
  return json({ logoUrl: "/api/files/org-logo" });
}

async function getShelters(ctx: Ctx): Promise<Response> {
  return json(await listShelters(requireUser(ctx.actor)));
}

async function postShelter(ctx: Ctx): Promise<Response> {
  const input = parseInput(shelterSchema, await readJson(ctx.req));
  return json(await createShelter(requireUser(ctx.actor), input), 201);
}

async function patchShelter(ctx: Ctx): Promise<Response> {
  const input = parseInput(shelterSchema, await readJson(ctx.req));
  return json(await updateShelter(requireUser(ctx.actor), param(ctx, 0), input));
}

async function getUsers(ctx: Ctx): Promise<Response> {
  return json(await listUsers(requireUser(ctx.actor)));
}

async function postUser(ctx: Ctx): Promise<Response> {
  const input = parseInput(createUserSchema, await readJson(ctx.req));
  return json(await createOrgUser(requireUser(ctx.actor), input), 201);
}

async function patchUser(ctx: Ctx): Promise<Response> {
  const input = parseInput(updateUserSchema, await readJson(ctx.req));
  return json(await updateOrgUser(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postReset(ctx: Ctx): Promise<Response> {
  return json(await resetOrgUserPassword(requireUser(ctx.actor), param(ctx, 0)));
}

async function getPerms(ctx: Ctx): Promise<Response> {
  return json(await getPermissionMatrix(requireUser(ctx.actor)));
}

async function putPerms(ctx: Ctx): Promise<Response> {
  const input = parseInput(permissionMatrixSchema, await readJson(ctx.req));
  const roles = input.roles.map((role) => ({ role: role.role, permissions: role.permissions.filter((item) => typeof item === "string") }));
  return json(await updatePermissionMatrix(requireUser(ctx.actor), roles));
}

async function getAnimals(ctx: Ctx): Promise<Response> {
  const q = ctx.url.searchParams;
  return json(await listAnimals(requireUser(ctx.actor), {
    q: q.get("q") ?? undefined,
    species: q.get("species") ?? undefined,
    status: q.get("status") ?? undefined,
    shelterId: q.get("shelterId") ?? undefined,
    intakeFrom: q.get("intakeFrom") ?? undefined,
    intakeTo: q.get("intakeTo") ?? undefined,
    page: numberParam(q.get("page")),
    pageSize: numberParam(q.get("pageSize")),
    sort: q.get("sort") ?? undefined,
    includeArchived: q.get("includeArchived") === "true",
  }));
}

async function postAnimal(ctx: Ctx): Promise<Response> {
  const input = parseInput(animalWriteSchema, await readJson(ctx.req));
  return json(await createAnimal(requireUser(ctx.actor), input), 201);
}

async function getOneAnimal(ctx: Ctx): Promise<Response> {
  return json(await getAnimal(requireUser(ctx.actor), param(ctx, 0)));
}

async function patchAnimal(ctx: Ctx): Promise<Response> {
  const input = parseInput(animalWriteSchema, await readJson(ctx.req));
  return json(await updateAnimal(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postStatus(ctx: Ctx): Promise<Response> {
  const input = parseInput(statusChangeSchema, await readJson(ctx.req));
  return json(await changeStatus(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postOutcome(ctx: Ctx): Promise<Response> {
  const input = parseInput(outcomeSchema, await readJson(ctx.req));
  return json(await recordOutcome(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postTransfer(ctx: Ctx): Promise<Response> {
  const input = parseInput(transferSchema, await readJson(ctx.req));
  return json(await transferAnimal(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postArchive(ctx: Ctx): Promise<Response> {
  const input = parseInput(archiveSchema, await readJson(ctx.req));
  return json(await archiveAnimal(requireUser(ctx.actor), param(ctx, 0), input, true));
}

async function postUnarchive(ctx: Ctx): Promise<Response> {
  const input = parseInput(archiveSchema, await readJson(ctx.req));
  return json(await archiveAnimal(requireUser(ctx.actor), param(ctx, 0), input, false));
}

async function postPhoto(ctx: Ctx): Promise<Response> {
  const file = await readFile(ctx.req);
  return json(await addAnimalPhoto(requireUser(ctx.actor), param(ctx, 0), file.name, file.bytes), 201);
}

async function getTimeline(ctx: Ctx): Promise<Response> {
  return json(await animalTimeline(requireUser(ctx.actor), param(ctx, 0)));
}

async function postClearance(ctx: Ctx): Promise<Response> {
  const input = parseInput(clearanceSchema, await readJson(ctx.req));
  return json(await setClearance(requireUser(ctx.actor), param(ctx, 0), input));
}

async function getPhoto(ctx: Ctx): Promise<Response> {
  const photo = await getAnimalPhoto(requireUser(ctx.actor), param(ctx, 0));
  return fileResponse(await readStored(photo.storageKey), photo.mimeType, photo.fileName, false);
}

async function getLogo(ctx: Ctx): Promise<Response> {
  const actor = requireUser(ctx.actor);
  const prisma = await db();
  const org = await prisma.organization.findUnique({ where: { id: actor.organizationId! } });
  if (!org?.logoStorageKey) return json({ error: { code: "not_found", message: "Not found." } }, 404);
  const bytes = await readStored(org.logoStorageKey);
  return fileResponse(bytes, "image/png", "logo", false);
}

async function getMedical(ctx: Ctx): Promise<Response> {
  const q = ctx.url.searchParams;
  return json(await listMedicalRecords(requireUser(ctx.actor), {
    animalId: q.get("animalId") ?? undefined,
    category: q.get("category") ?? undefined,
    shelterId: q.get("shelterId") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
    page: numberParam(q.get("page")),
    pageSize: numberParam(q.get("pageSize")),
  }));
}

async function postMedical(ctx: Ctx): Promise<Response> {
  const input = parseInput(medicalWriteSchema, await readJson(ctx.req));
  return json(await createMedicalRecord(requireUser(ctx.actor), input), 201);
}

async function getOneMedical(ctx: Ctx): Promise<Response> {
  return json(await getMedicalRecord(requireUser(ctx.actor), param(ctx, 0)));
}

async function postCorrection(ctx: Ctx): Promise<Response> {
  const input = parseInput(medicalWriteSchema, await readJson(ctx.req));
  return json(await correctMedicalRecord(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postMedicalFile(ctx: Ctx): Promise<Response> {
  const file = await readFile(ctx.req);
  return json(await addMedicalAttachment(requireUser(ctx.actor), param(ctx, 0), file.name, file.bytes), 201);
}

async function postAdmin(ctx: Ctx): Promise<Response> {
  const input = parseInput(administrationSchema, await readJson(ctx.req));
  return json(await recordAdministration(requireUser(ctx.actor), param(ctx, 0), input), 201);
}

async function getMedicalFile(ctx: Ctx): Promise<Response> {
  const file = await getMedicalAttachment(requireUser(ctx.actor), param(ctx, 0));
  return fileResponse(await readStored(file.storageKey), file.mimeType, file.fileName, true);
}

async function getTasks(ctx: Ctx): Promise<Response> {
  const q = ctx.url.searchParams;
  const due = q.get("due");
  return json(await listCareTasks(requireUser(ctx.actor), {
    status: q.get("status") ?? undefined,
    shelterId: q.get("shelterId") ?? undefined,
    animalId: q.get("animalId") ?? undefined,
    due: due === "overdue" || due === "upcoming" || due === "open" ? due : undefined,
  }));
}

async function postTask(ctx: Ctx): Promise<Response> {
  const input = parseInput(careTaskSchema, await readJson(ctx.req));
  return json(await createCareTask(requireUser(ctx.actor), input), 201);
}

async function postCompleteTask(ctx: Ctx): Promise<Response> {
  const input = parseInput(taskActionSchema, await readJson(ctx.req));
  return json(await completeCareTask(requireUser(ctx.actor), param(ctx, 0), input, "completed"));
}

async function postCancelTask(ctx: Ctx): Promise<Response> {
  const input = parseInput(taskActionSchema, await readJson(ctx.req));
  return json(await completeCareTask(requireUser(ctx.actor), param(ctx, 0), input, "cancelled"));
}

async function getApplicants(ctx: Ctx): Promise<Response> {
  return json(await listApplicants(requireUser(ctx.actor), ctx.url.searchParams.get("q") ?? undefined));
}

async function postApplicant(ctx: Ctx): Promise<Response> {
  const input = parseInput(applicantSchema, await readJson(ctx.req));
  return json(await createApplicant(requireUser(ctx.actor), input), 201);
}

async function getOneApplicant(ctx: Ctx): Promise<Response> {
  return json(await getApplicant(requireUser(ctx.actor), param(ctx, 0)));
}

async function patchApplicant(ctx: Ctx): Promise<Response> {
  const input = parseInput(applicantSchema, await readJson(ctx.req));
  return json(await updateApplicant(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postRedact(ctx: Ctx): Promise<Response> {
  return json(await redactApplicant(requireUser(ctx.actor), param(ctx, 0)));
}

async function getApplications(ctx: Ctx): Promise<Response> {
  return json(await listApplications(requireUser(ctx.actor), {
    status: ctx.url.searchParams.get("status") ?? undefined,
    q: ctx.url.searchParams.get("q") ?? undefined,
  }));
}

async function postApplication(ctx: Ctx): Promise<Response> {
  const input = parseInput(applicationSchema, await readJson(ctx.req));
  return json(await createApplication(requireUser(ctx.actor), input), 201);
}

async function getOneApplication(ctx: Ctx): Promise<Response> {
  return json(await getApplication(requireUser(ctx.actor), param(ctx, 0)));
}

async function patchApplication(ctx: Ctx): Promise<Response> {
  const input = parseInput(applicationAnimalsSchema, await readJson(ctx.req));
  return json(await setApplicationAnimals(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postTransition(ctx: Ctx): Promise<Response> {
  const input = parseInput(transitionSchema, await readJson(ctx.req));
  return json(await transitionApplication(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postScreening(ctx: Ctx): Promise<Response> {
  const input = parseInput(screeningSchema, await readJson(ctx.req));
  return json(await addScreening(requireUser(ctx.actor), param(ctx, 0), input), 201);
}

async function postFinalize(ctx: Ctx): Promise<Response> {
  const input = parseInput(finalizeSchema, await readJson(ctx.req));
  return json(await finalizeAdoption(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postReturn(ctx: Ctx): Promise<Response> {
  const input = parseInput(returnSchema, await readJson(ctx.req));
  return json(await returnAdoption(requireUser(ctx.actor), param(ctx, 0), input));
}

async function postFollowUp(ctx: Ctx): Promise<Response> {
  const input = parseInput(followUpSchema, await readJson(ctx.req));
  return json(await addFollowUp(requireUser(ctx.actor), param(ctx, 0), input), 201);
}

async function postCompleteFollowUp(ctx: Ctx): Promise<Response> {
  const input = parseInput(completeFollowUpSchema, await readJson(ctx.req));
  return json(await completeFollowUp(requireUser(ctx.actor), param(ctx, 0), param(ctx, 1), input));
}

async function postAdoptionDoc(ctx: Ctx): Promise<Response> {
  const file = await readFile(ctx.req);
  return json(await addAdoptionDocument(requireUser(ctx.actor), param(ctx, 0), file.name, file.bytes), 201);
}

async function getAdoptionDoc(ctx: Ctx): Promise<Response> {
  const file = await getAdoptionDocument(requireUser(ctx.actor), param(ctx, 0));
  return fileResponse(await readStored(file.storageKey), file.mimeType, file.fileName, true);
}

async function getMatch(ctx: Ctx): Promise<Response> {
  const q = ctx.url.searchParams;
  return json(await matchAnimals(requireUser(ctx.actor), {
    species: q.get("species") ?? undefined,
    size: q.get("size") ?? undefined,
    activityLevel: q.get("activityLevel") ?? undefined,
    temperament: q.get("temperament") ?? undefined,
    shelterId: q.get("shelterId") ?? undefined,
    specialCare: q.get("specialCare") === "true",
    minYears: numberParam(q.get("minYears")),
    maxYears: numberParam(q.get("maxYears")),
  }));
}

async function getDashboard(ctx: Ctx): Promise<Response> {
  return json(await dashboard(requireUser(ctx.actor)));
}

async function getReports(ctx: Ctx): Promise<Response> {
  const actor = requireUser(ctx.actor);
  const type = ctx.url.searchParams.get("type");
  if (!type) return json({ reports: availableReports(actor) });
  const filters = parseInput(reportQuerySchema, Object.fromEntries(ctx.url.searchParams.entries()));
  return json(await runReport(actor, filters));
}

async function postExport(ctx: Ctx): Promise<Response> {
  const filters = parseInput(reportQuerySchema, await readJson(ctx.req));
  const file = await exportReport(requireUser(ctx.actor), filters);
  return new Response(file.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": contentDisposition(file.filename),
      "cache-control": "no-store",
    },
  });
}

async function getAudit(ctx: Ctx): Promise<Response> {
  return json(await listAudit(requireUser(ctx.actor), {
    from: ctx.url.searchParams.get("from") ?? undefined,
    to: ctx.url.searchParams.get("to") ?? undefined,
    page: numberParam(ctx.url.searchParams.get("page")),
  }));
}

async function getNotes(ctx: Ctx): Promise<Response> {
  return json(await listNotifications(requireUser(ctx.actor)));
}

async function postReadAll(ctx: Ctx): Promise<Response> {
  return json(await markAllNotificationsRead(requireUser(ctx.actor)));
}

async function postRead(ctx: Ctx): Promise<Response> {
  return json(await markNotificationRead(requireUser(ctx.actor), param(ctx, 0)));
}

function param(ctx: Ctx, index: number): string {
  return ctx.params[String(index)] ?? "";
}

function numberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readJson(req: Request): Promise<unknown> {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > 1_000_000) throw new AppError(413, "payload_too_large", "Request is too large.");
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "invalid_json", "Request body must be JSON.");
  }
}

async function readFile(req: Request): Promise<{ name: string; bytes: Buffer }> {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > 12_000_000) throw new AppError(413, "payload_too_large", "File is too large.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "validation_error", "Choose a file.", { fields: { file: "Choose a file." } });
  const bytes = Buffer.from(await file.arrayBuffer());
  return { name: file.name, bytes };
}

function json(data: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

function fileResponse(bytes: Buffer, mime: string, fileName: string, download: boolean): Response {
  const headers = new Headers();
  headers.set("content-type", mime);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", download ? contentDisposition(fileName) : "inline");
  return new Response(new Uint8Array(bytes), { headers });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return json({ error: { code: error.code, message: error.message, fields: error.fields, details: error.details } }, error.status);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return json({ error: { code: "conflict", message: "That value is already in use." } }, 409);
  }
  console.error(error);
  return json({ error: { code: "internal_error", message: "Something went wrong. Try again." } }, 500);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim().slice(0, 64) || "local";
  }
  return "local";
}

function cookie(name: string, value: string, expires: Date, httpOnly: boolean): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const only = httpOnly ? "; HttpOnly" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Expires=${expires.toUTCString()}${only}${secure}`;
}

function sessionCookie(token: string, expires: Date): string {
  return cookie("pawhaven_session", token, expires, true);
}

function csrfCookie(secret: string, expires: Date): string {
  return cookie("pawhaven_csrf", secret, expires, false);
}

function clearCookies(): string[] {
  const past = new Date(0);
  return [cookie("pawhaven_session", "", past, true), cookie("pawhaven_csrf", "", past, false)];
}
