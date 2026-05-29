import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { AppAuthSettings, AppMutationPayload, AppStatePayload, PublicAuthConfigPayload } from "./apiTypes";
import {
  type AppUser,
  type Decision,
  type DedupCandidate,
  type ExtractionFieldType,
  type ExtractionResponse,
  type ExtractionResponseValue,
  type ExtractionTemplate,
  type ExtractionTemplateField,
  type ImportBatch,
  type Report,
  type ReviewProject,
  type Study,
  type WorkflowEvent
} from "./prismaData";
import { evaluateStage, type DecisionValue } from "./workflow";

type StoredUser = AppUser & {
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
};

type PersistedState = {
  version: 1;
  authSettings: AppAuthSettings;
  users: StoredUser[];
  projects: ReviewProject[];
  imports: ImportBatch[];
  studies: Study[];
  reports: Report[];
  extractionTemplates: ExtractionTemplate[];
  extractionResponses: ExtractionResponse[];
  decisions: Decision[];
  events: WorkflowEvent[];
  dedupCandidates: DedupCandidate[];
};

type CaptchaPayload = {
  answer: number;
  expiresAt: number;
  nonce: string;
};

type NewProjectInput = {
  title?: string;
  organization?: string;
  protocolId?: string;
  description?: string;
  searchStrategies?: string;
  dueDate?: string;
  blindMode?: boolean;
  abstractRequiredVotes?: number;
  fullTextRequiredVotes?: number;
  maybePolicy?: ReviewProject["maybePolicy"];
  memberIds?: string[];
};

type UpdateProjectInput = Omit<NewProjectInput, "memberIds">;

type ExtractionTemplateInput = {
  title?: string;
  fields?: Array<{
    id?: string;
    title?: string;
    type?: string;
    options?: string[];
  }>;
};

type ExtractionResponseInput = {
  templateId?: string;
  reportId?: string;
  studyId?: string;
  values?: Record<string, unknown>;
};

type ParsedCitation = {
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  year: number;
  doi: string;
  keywords: string[];
  rawCitation: string;
  warnings: string[];
};

const demoUserIds = new Set(["user-rivera", "user-chen", "user-patel", "user-okafor"]);
const adminUserId = "admin-root";
const captchaTtlMs = 10 * 60 * 1000;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function dataFilePath() {
  if (process.env.PRISMATICA_DATA_FILE) {
    return path.resolve(/*turbopackIgnore: true*/ process.env.PRISMATICA_DATA_FILE);
  }
  return path.join(process.cwd(), "data", "prismatica-state.json");
}

function defaultAuthSettings(): AppAuthSettings {
  return {
    registrationEnabled: process.env.PRISMATICA_REGISTRATION_ENABLED?.toLowerCase() === "false" ? false : true
  };
}

function normalizeAuthSettings(settings: Partial<AppAuthSettings> | undefined): AppAuthSettings {
  return {
    ...defaultAuthSettings(),
    registrationEnabled: typeof settings?.registrationEnabled === "boolean" ? settings.registrationEnabled : defaultAuthSettings().registrationEnabled
  };
}

function createSeedState(): PersistedState {
  return {
    version: 1,
    authSettings: defaultAuthSettings(),
    users: [],
    projects: [],
    imports: [],
    studies: [],
    reports: [],
    extractionTemplates: [],
    extractionResponses: [],
    decisions: [],
    events: [],
    dedupCandidates: []
  };
}

function readState(): PersistedState {
  const filePath = dataFilePath();
  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    const seedState = createSeedState();
    writeState(seedState);
    return seedState;
  }

  const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8")) as Partial<PersistedState>;
  const normalized = normalizeState(parsed);
  writeState(normalized);
  return normalized;
}

function writeState(state: PersistedState) {
  const filePath = dataFilePath();
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(/*turbopackIgnore: true*/ tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(/*turbopackIgnore: true*/ tempPath, filePath);
}

function assignImportItemIds(studies: Study[]): Study[] {
  const countByProject = new Map<string, Map<number, number>>();

  for (const study of studies) {
    if (!study.projectId || !Number.isInteger(study.importItemId) || (study.importItemId ?? 0) <= 0) {
      continue;
    }
    const counts = countByProject.get(study.projectId) ?? new Map<number, number>();
    counts.set(study.importItemId as number, (counts.get(study.importItemId as number) ?? 0) + 1);
    countByProject.set(study.projectId, counts);
  }

  const consumedByProject = new Map<string, Set<number>>();
  const nextByProject = new Map<string, number>();

  for (const [projectId, counts] of countByProject.entries()) {
    const maxUsed = counts.size > 0 ? Math.max(...counts.keys()) : 0;
    nextByProject.set(projectId, maxUsed + 1);
  }

  return studies.map((study) => {
    if (!study.projectId) {
      return study;
    }

    const consumed = consumedByProject.get(study.projectId) ?? new Set<number>();
    consumedByProject.set(study.projectId, consumed);

    const currentImportItemId = Number.isInteger(study.importItemId) && (study.importItemId ?? 0) > 0 ? (study.importItemId as number) : 0;
    const counts = countByProject.get(study.projectId) ?? new Map<number, number>();
    let importItemId = currentImportItemId;

    const canKeepCurrent = importItemId > 0 && (counts.get(importItemId) ?? 0) > 0 && !consumed.has(importItemId);

    if (!canKeepCurrent) {
      let next = nextByProject.get(study.projectId) ?? 1;
      while (consumed.has(next) || counts.has(next)) {
        next += 1;
      }
      importItemId = next;
      nextByProject.set(study.projectId, next + 1);
    }

    consumed.add(importItemId);

    if (currentImportItemId === importItemId) {
      return study;
    }

    return {
      ...study,
      importItemId
    };
  });
}

function getNextImportItemId(state: PersistedState, projectId: string) {
  const maxId = state.studies
    .filter((study) => study.projectId === projectId)
    .reduce((maxValue, study) => Math.max(maxValue, Number.isInteger(study.importItemId) ? (study.importItemId as number) : 0), 0);
  return maxId + 1;
}

function normalizeState(state: Partial<PersistedState>): PersistedState {
  const now = new Date().toISOString();
  const authSettings = normalizeAuthSettings(state.authSettings);
  const persistedUsers = Array.isArray(state.users) ? state.users.filter((user) => !demoUserIds.has(user.id)) : [];
  const users = ensureAdminUser(
    persistedUsers.map((user) => ({
      ...user,
      isAdmin: Boolean(user.isAdmin)
    })) as StoredUser[],
    now
  );
  const userIds = new Set(users.map((user) => user.id));
  const projects = Array.isArray(state.projects)
    ? state.projects
        .filter((project) => userIds.has(project.ownerId))
        .map((project) => ({
          ...project,
          searchStrategies: typeof project.searchStrategies === "string" ? project.searchStrategies : "",
          fullTextRequiredVotes: clampFullTextVoteCount(project.fullTextRequiredVotes),
          ownerIds: normalizeOwnerIds(project, userIds),
          memberIds: normalizeMemberIds(project, userIds)
        }))
    : [];
  const projectIds = new Set(projects.map((project) => project.id));
  const imports = Array.isArray(state.imports)
    ? state.imports
        .filter((batch) => projectIds.has(batch.projectId))
        .map((batch) => ({
          ...batch,
          parserWarningMessages:
            Array.isArray(batch.parserWarningMessages) && batch.parserWarningMessages.length > 0
              ? batch.parserWarningMessages
              : batch.parserWarnings > 0
                ? [`${batch.parserWarnings} parser warnings were recorded for this legacy import, but detailed parser messages are unavailable.`]
                : []
        }))
    : [];
  const importedStudies = Array.isArray(state.studies)
    ? state.studies.filter((study) => study.projectId && projectIds.has(study.projectId))
    : [];
  const studies = [
    ...importedStudies,
    ...imports.flatMap((batch) => {
      const hasBatchStudies = importedStudies.some((study) => study.projectId === batch.projectId && study.importBatchId === batch.id);
      if (hasBatchStudies || batch.records <= 0) {
        return [];
      }

      return Array.from({ length: batch.records }, (_, index): Study => ({
        id: createId("study-legacy"),
        projectId: batch.projectId,
        importBatchId: batch.id,
        title: `Imported record ${index + 1} from ${batch.filename}`,
        abstract: "This citation was imported before record-level parsing was stored. Review the original import file if more metadata is needed.",
        authors: [],
        journal: batch.sourceName,
        year: 0,
        doi: "",
        source: batch.sourceName,
        stage: "title_abstract",
        keywords: [],
        parserWarnings: ["Legacy import record reconstructed for screening."]
      }));
    })
  ];
  const studiesWithImportItemIds = assignImportItemIds(studies);
  const studyIds = new Set(studiesWithImportItemIds.map((study) => study.id));
  const reports = Array.isArray(state.reports)
    ? state.reports
        .filter((report) => projectIds.has(report.projectId) && studyIds.has(report.studyId))
        .map((report) => normalizeReport(report))
    : [];
  const reportIds = new Set(reports.map((report) => report.id));
  const extractionTemplates = Array.isArray(state.extractionTemplates)
    ? state.extractionTemplates
        .filter((template) => projectIds.has(template.projectId))
        .map((template) => normalizeExtractionTemplate(template))
    : [];
  const extractionTemplateIds = new Set(extractionTemplates.map((template) => template.id));
  const extractionResponses = Array.isArray(state.extractionResponses)
    ? state.extractionResponses
        .filter(
          (response) =>
            projectIds.has(response.projectId) &&
            studyIds.has(response.studyId) &&
            reportIds.has(response.reportId) &&
            extractionTemplateIds.has(response.templateId) &&
            userIds.has(response.userId)
        )
        .map((response) => normalizeExtractionResponse(response))
    : [];
  const projectsWithImportState = projects.map((project) => {
    const importedRecordCount = imports
      .filter((batch) => batch.projectId === project.id)
      .reduce((total, batch) => total + batch.records, 0);
    const hasScreeningRecords = studiesWithImportItemIds.some((study) => study.projectId === project.id && study.stage === "title_abstract");
    if (!importedRecordCount || !hasScreeningRecords) {
      return project;
    }

    return {
      ...project,
      status: project.status === "draft" ? "active" : project.status,
      stage: project.stage === "setup" || project.stage === "import" ? "screening" : project.stage,
      recordsTotal: Math.max(project.recordsTotal, importedRecordCount)
    };
  });

  const normalizedState: PersistedState = {
    version: 1,
    authSettings,
    users: users.map((user) => {
      if (user.passwordHash && user.passwordSalt) {
        return user as StoredUser;
      }
      return {
        ...user,
        ...hashPassword(crypto.randomBytes(18).toString("base64url")),
        createdAt: now,
        updatedAt: now
      } as StoredUser;
    }),
    projects: projectsWithImportState,
    imports,
    studies: studiesWithImportItemIds,
    reports,
    extractionTemplates,
    extractionResponses,
    decisions: Array.isArray(state.decisions)
      ? state.decisions.filter(
          (decision) =>
            projectIds.has(decision.projectId) &&
            studyIds.has(decision.studyId) &&
            userIds.has(decision.userId) &&
            (!decision.reportId || reportIds.has(decision.reportId))
        )
      : [],
    events: Array.isArray(state.events)
      ? state.events.filter((event) => projectIds.has(event.entity) || studyIds.has(event.entity) || reportIds.has(event.entity))
      : [],
    dedupCandidates: Array.isArray(state.dedupCandidates) ? state.dedupCandidates.filter(() => projectIds.has("demo-review")) : []
  };
  resyncAllProjectWorkflowState(normalizedState);
  return normalizedState;
}

function hashPassword(password: string) {
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.scryptSync(password, passwordSalt, 64).toString("hex");
  return { passwordHash, passwordSalt };
}

function verifyPassword(password: string, user: StoredUser) {
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = crypto.scryptSync(password, user.passwordSalt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function captchaSecret() {
  return process.env.PRISMATICA_CAPTCHA_SECRET ?? process.env.PRISMATICA_SESSION_SECRET ?? process.env.PRISMATICA_ADMIN_PASSWORD ?? "prismatica-local-captcha";
}

function signCaptchaPayload(encodedPayload: string) {
  return crypto.createHmac("sha256", captchaSecret()).update(encodedPayload).digest("base64url");
}

function createRegistrationCaptcha() {
  const left = crypto.randomInt(2, 10);
  const right = crypto.randomInt(2, 10);
  const payload: CaptchaPayload = {
    answer: left + right,
    expiresAt: Date.now() + captchaTtlMs,
    nonce: crypto.randomBytes(12).toString("base64url")
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    question: `${left} + ${right} =`,
    token: `${encodedPayload}.${signCaptchaPayload(encodedPayload)}`
  };
}

function verifyRegistrationCaptcha(token: string | undefined, answer: string | undefined) {
  const [encodedPayload, signature] = (token ?? "").split(".");
  if (!encodedPayload || !signature) {
    throw new ApiError("Complete the captcha challenge to register.");
  }

  const expectedSignature = signCaptchaPayload(encodedPayload);
  const actualSignature = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (actualSignature.length !== expectedSignatureBuffer.length || !crypto.timingSafeEqual(actualSignature, expectedSignatureBuffer)) {
    throw new ApiError("Captcha challenge expired. Try again.");
  }

  let payload: CaptchaPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as CaptchaPayload;
  } catch {
    throw new ApiError("Captcha challenge expired. Try again.");
  }

  if (payload.expiresAt < Date.now()) {
    throw new ApiError("Captcha challenge expired. Try again.");
  }

  if (Number(answer) !== payload.answer) {
    throw new ApiError("Captcha answer is incorrect.");
  }
}

function publicUser(user: StoredUser): AppUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    initials: user.initials,
    organization: user.organization,
    title: user.title,
    timezone: user.timezone,
    avatarColor: user.avatarColor
  };
}

function withReportWorkflowState(report: Report, project: ReviewProject | undefined, decisions: Decision[]): Report {
  if (!project) {
    return report;
  }

  const currentDecisions = decisions.filter(
    (decision) => decision.projectId === project.id && decision.reportId === report.id && decision.stage === "full_text" && decision.isCurrent
  );
  const evaluation = evaluateStage(
    "full_text",
    currentDecisions.map((decision) => decision.decisionValue),
    project.fullTextRequiredVotes,
    project.maybePolicy
  );
  return {
    ...report,
    fullTextStatus: evaluation.state,
    fullTextStatusLabel: evaluation.label,
    fullTextVoteCount: currentDecisions.length,
    fullTextRequiredVotes: project.fullTextRequiredVotes
  };
}

function getUser(state: PersistedState, userId: string) {
  return state.users.find((user) => user.id === userId);
}

function getProject(state: PersistedState, projectId: string) {
  return state.projects.find((project) => project.id === projectId);
}

function getProjectOwnerIds(project: ReviewProject) {
  return uniqueIds([project.ownerId, ...(Array.isArray(project.ownerIds) ? project.ownerIds : [])]);
}

function isProjectOwner(project: ReviewProject, userId: string) {
  return getProjectOwnerIds(project).includes(userId);
}

function isProjectMember(project: ReviewProject, userId: string) {
  return isProjectOwner(project, userId) || project.memberIds.includes(userId);
}

function requireProjectMember(state: PersistedState, projectId: string, userId: string) {
  const user = getUser(state, userId);
  if (user?.isAdmin) {
    const project = getProject(state, projectId);
    if (!project) {
      throw new ApiError("You do not have access to that project.", 403);
    }
    return project;
  }
  const project = getProject(state, projectId);
  if (!project || !isProjectMember(project, userId)) {
    throw new ApiError("You do not have access to that project.", 403);
  }
  return project;
}

function requireProjectOwner(state: PersistedState, projectId: string, userId: string) {
  const project = requireProjectMember(state, projectId, userId);
  if (!isProjectOwner(project, userId)) {
    throw new ApiError("Only project owners can change this project.", 403);
  }
  return project;
}

function accessibleProjects(state: PersistedState, userId: string) {
  const user = getUser(state, userId);
  if (user?.isAdmin) {
    return state.projects;
  }
  return state.projects.filter((project) => isProjectMember(project, userId));
}

function buildPayload(state: PersistedState, userId: string): AppStatePayload {
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const projects = accessibleProjects(state, userId).map((project) => ({
    ...project,
    conflicts: countProjectWorkflowConflicts(state, project)
  }));
  const projectIds = new Set(projects.map((project) => project.id));
  const studyIds = new Set(state.studies.filter((study) => study.projectId && projectIds.has(study.projectId)).map((study) => study.id));
  const reportIds = new Set(state.reports.filter((report) => projectIds.has(report.projectId)).map((report) => report.id));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const allProjectIds = new Set(state.projects.map((project) => project.id));
  const demoProjectAccessible = projectIds.has("demo-review");

  return {
    currentUser: publicUser(currentUser),
    authSettings: state.authSettings,
    users: state.users.filter((user) => currentUser.isAdmin || !user.isAdmin).map(publicUser),
    projects,
    imports: state.imports.filter((batch) => projectIds.has(batch.projectId)),
    studies: state.studies.filter((study) => study.projectId && projectIds.has(study.projectId)),
    reports: state.reports
      .filter((report) => projectIds.has(report.projectId))
      .map((report) => withReportWorkflowState(report, projectById.get(report.projectId), state.decisions)),
    extractionTemplates: state.extractionTemplates.filter((template) => projectIds.has(template.projectId)),
    extractionResponses: state.extractionResponses.filter(
      (response) => projectIds.has(response.projectId) && studyIds.has(response.studyId) && reportIds.has(response.reportId)
    ),
    decisions: state.decisions.filter((decision) => {
      const project = projectById.get(decision.projectId);
      if (!project) {
        return false;
      }
      return !project.blindMode || isProjectOwner(project, userId) || decision.userId === userId;
    }),
    events: state.events
      .filter(
        (event) =>
          projectIds.has(event.entity) ||
          studyIds.has(event.entity) ||
          reportIds.has(event.entity) ||
          (demoProjectAccessible && !allProjectIds.has(event.entity))
      )
      .slice(0, 50),
    dedupCandidates: demoProjectAccessible ? state.dedupCandidates : []
  };
}

export function getAppStateForUser(userId: string): AppStatePayload {
  return buildPayload(readState(), userId);
}

export function deleteProjectForUser(userId: string, projectId: string): AppMutationPayload {
  const state = readState();
  const currentUser = requireAdminUser(state, userId);
  const project = getProject(state, projectId);

  if (!project) {
    throw new ApiError("Review not found.", 404);
  }

  const removedStudyIds = new Set(state.studies.filter((study) => study.projectId === projectId).map((study) => study.id));
  const removedReportIds = new Set(state.reports.filter((report) => report.projectId === projectId).map((report) => report.id));

  state.projects = state.projects.filter((candidate) => candidate.id !== projectId);
  state.imports = state.imports.filter((batch) => batch.projectId !== projectId);
  state.studies = state.studies.filter((study) => study.projectId !== projectId);
  state.reports = state.reports.filter((report) => report.projectId !== projectId);
  state.extractionTemplates = state.extractionTemplates.filter((template) => template.projectId !== projectId);
  state.extractionResponses = state.extractionResponses.filter((response) => response.projectId !== projectId);
  state.decisions = state.decisions.filter((decision) => decision.projectId !== projectId && !removedStudyIds.has(decision.studyId) && !removedReportIds.has(decision.reportId ?? ""));
  state.events = state.events.filter((event) => event.entity !== projectId && !removedStudyIds.has(event.entity) && !removedReportIds.has(event.entity));
  state.dedupCandidates = state.dedupCandidates.filter(
    (candidate) => candidate.recordA.projectId !== projectId && candidate.recordB.projectId !== projectId
  );

  appendEvent(state, currentUser.name, `Deleted review ${project.title}`, projectId);
  writeState(state);

  return {
    ...buildPayload(state, currentUser.id),
    message: `Deleted review ${project.title}.`
  };
}

export function getPublicAuthConfig(): PublicAuthConfigPayload {
  const state = readState();
  return {
    authSettings: state.authSettings,
    captcha: createRegistrationCaptcha()
  };
}

export function updateAuthSettingsForUser(adminUserIdInput: string, settings: Partial<AppAuthSettings>): AppMutationPayload {
  const state = readState();
  const adminUser = requireAdminUser(state, adminUserIdInput);
  state.authSettings = {
    ...state.authSettings,
    registrationEnabled: Boolean(settings.registrationEnabled)
  };
  appendEvent(state, adminUser.name, state.authSettings.registrationEnabled ? "Enabled public registration" : "Disabled public registration", adminUser.id);
  writeState(state);
  return {
    ...buildPayload(state, adminUser.id),
    message: state.authSettings.registrationEnabled ? "Public registration enabled." : "Public registration disabled."
  };
}

export function loginUser(email: string, password: string): AppStatePayload {
  const normalizedEmail = email.trim().toLowerCase();
  const state = readState();
  const user = state.users.find((candidate) => candidate.email.toLowerCase() === normalizedEmail);

  if (!user || !password || !verifyPassword(password, user)) {
    throw new ApiError("Email or password is incorrect.", 401);
  }

  return buildPayload(state, user.id);
}

export function registerUser(input: {
  name?: string;
  email?: string;
  organization?: string;
  title?: string;
  password?: string;
  captchaToken?: string;
  captchaAnswer?: string;
}): AppStatePayload {
  const state = readState();
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const organization = input.organization?.trim() ?? "";
  const password = input.password?.trim() ?? "";

  if (!state.authSettings.registrationEnabled) {
    throw new ApiError("Public registration is disabled. Ask an administrator for an account.", 403);
  }

  verifyRegistrationCaptcha(input.captchaToken, input.captchaAnswer);

  if (!name || !email || !organization || !password) {
    throw new ApiError("Complete name, email, organization, and password to register.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError("Enter a valid email address.");
  }

  if (state.users.some((user) => user.email.toLowerCase() === email)) {
    throw new ApiError("That email already has an account. Sign in instead.", 409);
  }

  const now = new Date().toISOString();
  const newUser: StoredUser = {
    id: createId(`user-${slugify(email)}`),
    name,
    email,
    isAdmin: false,
    initials: getInitials(name),
    organization,
    title: input.title?.trim() || "Reviewer",
    timezone: "Europe/Rome",
    avatarColor: pickAvatarColor(state.users.length),
    ...hashPassword(password),
    createdAt: now,
    updatedAt: now
  };

  state.users.push(newUser);
  writeState(state);
  return buildPayload(state, newUser.id);
}

export function updateCurrentUserForUser(
  userId: string,
  input: {
    organization?: string;
    title?: string;
    currentPassword?: string;
    newPassword?: string;
  }
): AppStatePayload {
  const state = readState();
  const user = getUser(state, userId);
  if (!user) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const organization = input.organization?.trim() ?? user.organization;
  const title = input.title?.trim() ?? user.title;
  const newPassword = input.newPassword?.trim() ?? "";

  if (!organization || !title) {
    throw new ApiError("Organization and role title are required.");
  }

  let passwordUpdate: Pick<StoredUser, "passwordHash" | "passwordSalt"> | undefined;
  if (newPassword) {
    const currentPassword = input.currentPassword?.trim() ?? "";
    if (!currentPassword || !verifyPassword(currentPassword, user)) {
      throw new ApiError("Enter your current password to set a new password.", 403);
    }
    if (newPassword.length < 8) {
      throw new ApiError("New password must be at least 8 characters.");
    }
    passwordUpdate = hashPassword(newPassword);
  }

  state.users = state.users.map((candidate) =>
    candidate.id === userId
      ? {
          ...candidate,
          organization,
          title,
          ...(passwordUpdate ?? {}),
          updatedAt: new Date().toISOString()
        }
      : candidate
  );
  writeState(state);
  return buildPayload(state, userId);
}

export function adminResetPasswordForUser(adminUserIdInput: string, targetUserId: string): AppMutationPayload {
  const state = readState();
  const adminUser = requireAdminUser(state, adminUserIdInput);
  const targetUser = getUser(state, targetUserId);

  if (!targetUser) {
    throw new ApiError("Account not found.", 404);
  }
  if (targetUser.id === adminUser.id) {
    throw new ApiError("Use the profile form to change the admin password.", 400);
  }
  if (targetUser.isAdmin) {
    throw new ApiError("Admin accounts cannot be reset here.", 400);
  }

  const temporaryPassword = crypto.randomBytes(12).toString("base64url").slice(0, 16);
  const passwordUpdate = hashPassword(temporaryPassword);
  state.users = state.users.map((candidate) =>
    candidate.id === targetUserId
      ? {
          ...candidate,
          ...passwordUpdate,
          updatedAt: new Date().toISOString()
        }
      : candidate
  );
  appendEvent(state, adminUser.name, `Reset password for ${targetUser.name}`, targetUserId);
  writeState(state);

  return {
    ...buildPayload(state, adminUser.id),
    message: `Temporary password generated for ${targetUser.name}.`,
    temporaryPassword
  };
}

export function adminDeleteUserForUser(adminUserIdInput: string, targetUserId: string): AppMutationPayload {
  const state = readState();
  const adminUser = requireAdminUser(state, adminUserIdInput);
  const targetUser = getUser(state, targetUserId);

  if (!targetUser) {
    throw new ApiError("Account not found.", 404);
  }
  if (targetUser.id === adminUser.id) {
    throw new ApiError("The admin account cannot delete itself.", 400);
  }
  if (targetUser.isAdmin) {
    throw new ApiError("Admin accounts cannot be deleted here.", 400);
  }

  const ownedProjectIds = new Set(state.projects.filter((project) => project.ownerId === targetUserId).map((project) => project.id));
  const solelyOwnedProjectIds = new Set(
    state.projects.filter((project) => isProjectOwner(project, targetUserId) && getProjectOwnerIds(project).length === 1).map((project) => project.id)
  );
  const removedStudyIds = new Set(
    state.studies
      .filter((study) => study.projectId && solelyOwnedProjectIds.has(study.projectId))
      .map((study) => study.id)
  );
  const remainingProjects = state.projects
    .filter((project) => !solelyOwnedProjectIds.has(project.id))
    .map((project) => {
      if (!project.memberIds.includes(targetUserId) && !isProjectOwner(project, targetUserId)) {
        return project;
      }

      const nextMemberIds = project.memberIds.filter((memberId) => memberId !== targetUserId);
      const nextOwnerIds = getProjectOwnerIds(project).filter((ownerId) => ownerId !== targetUserId);
      return {
        ...project,
        ownerId: nextOwnerIds[0] ?? project.ownerId,
        ownerIds: nextOwnerIds,
        memberIds: nextMemberIds,
        reviewers: nextMemberIds.length,
        updatedAt: toEuToday(),
        lastEvent: `Removed account ${targetUser.name}`
      };
    });

  state.users = state.users.filter((user) => user.id !== targetUserId);
  state.projects = remainingProjects;
  state.imports = state.imports.filter((batch) => !solelyOwnedProjectIds.has(batch.projectId));
  state.studies = state.studies.filter((study) => !removedStudyIds.has(study.id));
  state.reports = state.reports.filter((report) => !solelyOwnedProjectIds.has(report.projectId) && !removedStudyIds.has(report.studyId));
  state.decisions = state.decisions.filter(
    (decision) => decision.userId !== targetUserId && !solelyOwnedProjectIds.has(decision.projectId) && !removedStudyIds.has(decision.studyId)
  );
  state.events = state.events.filter((event) => !solelyOwnedProjectIds.has(event.entity));
  state.dedupCandidates = state.dedupCandidates.filter(
    (candidate) => !solelyOwnedProjectIds.has(candidate.recordA.projectId ?? "") && !solelyOwnedProjectIds.has(candidate.recordB.projectId ?? "")
  );
  appendEvent(state, adminUser.name, `Deleted account ${targetUser.name}`, targetUserId);
  writeState(state);

  return {
    ...buildPayload(state, adminUser.id),
    message: `Deleted account ${targetUser.name}.`
  };
}

export function createProjectForUser(userId: string, input: NewProjectInput): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const title = input.title?.trim() ?? "";
  const dueDate = input.dueDate?.trim() ?? "";
  if (!title || !isEuDate(dueDate)) {
    throw new ApiError("A project title and dd-mm-yyyy due date are required.");
  }

  const knownUserIds = new Set(state.users.map((user) => user.id));
  const memberIds = uniqueIds([userId, ...(input.memberIds ?? [])]).filter((id) => knownUserIds.has(id));
  const today = toEuToday();
  const project: ReviewProject = {
    id: createId(slugify(title) || "project"),
    title,
    organization: input.organization?.trim() || currentUser.organization,
    protocolId: input.protocolId?.trim() || "Draft protocol",
    blindMode: Boolean(input.blindMode ?? true),
    abstractRequiredVotes: clampVoteCount(input.abstractRequiredVotes),
    fullTextRequiredVotes: clampFullTextVoteCount(input.fullTextRequiredVotes),
    maybePolicy: input.maybePolicy ?? "advance_to_full_text",
    reviewers: memberIds.length,
    lastEvent: "Project created just now",
    description: input.description?.trim() || "New systematic review project.",
    searchStrategies: input.searchStrategies?.trim() ?? "",
    status: "draft",
    stage: "setup",
    ownerId: userId,
    ownerIds: [userId],
    memberIds,
    createdAt: today,
    updatedAt: today,
    dueDate,
    recordsTotal: 0,
    recordsScreened: 0,
    conflicts: 0,
    studiesIncluded: 0
  };

  state.projects.unshift(project);
  appendEvent(state, currentUser.name, "Created review project", project.id);
  writeState(state);

  return {
    ...buildPayload(state, userId),
    selectedProjectId: project.id
  };
}

export function updateProjectForUser(userId: string, projectId: string, input: UpdateProjectInput): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  const project = requireProjectOwner(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const title = input.title?.trim() ?? "";
  const dueDate = input.dueDate?.trim() ?? "";
  if (!title || !isEuDate(dueDate)) {
    throw new ApiError("A project title and dd-mm-yyyy due date are required.");
  }

  const maybePolicy = input.maybePolicy ?? project.maybePolicy;
  if (!["advance_to_full_text", "conflict", "third_vote"].includes(maybePolicy)) {
    throw new ApiError("Choose a valid maybe policy.");
  }

  state.projects = state.projects.map((candidate) =>
    candidate.id === projectId
      ? {
          ...candidate,
          title,
          organization: input.organization?.trim() || project.organization,
          protocolId: input.protocolId?.trim() || project.protocolId,
          description: input.description?.trim() || project.description,
          searchStrategies: input.searchStrategies?.trim() ?? "",
          dueDate,
          blindMode: Boolean(input.blindMode ?? project.blindMode),
          abstractRequiredVotes: clampVoteCount(input.abstractRequiredVotes ?? project.abstractRequiredVotes),
          fullTextRequiredVotes: clampFullTextVoteCount(input.fullTextRequiredVotes ?? project.fullTextRequiredVotes),
          maybePolicy,
          updatedAt: toEuToday(),
          lastEvent: "Project settings updated"
        }
      : candidate
  );
  appendEvent(state, currentUser.name, "Updated project settings", projectId);
  writeState(state);

  return buildPayload(state, userId);
}

export function updateProjectMembersForUser(
  userId: string,
  projectId: string,
  memberIds: string[],
  ownerIds: string[],
  eventLabel: string
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  const project = requireProjectOwner(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const knownUserIds = new Set(state.users.map((user) => user.id));
  const nextMemberIds = uniqueIds([...memberIds, ...ownerIds]).filter((id) => knownUserIds.has(id));
  const requestedOwnerIds = uniqueIds(ownerIds).filter((id) => nextMemberIds.includes(id));
  if (!requestedOwnerIds.includes(userId)) {
    throw new ApiError("At least one current owner must remain an owner.", 400);
  }
  const nextOwnerIds = requestedOwnerIds.length > 0 ? requestedOwnerIds : [project.ownerId];

  state.projects = state.projects.map((candidate) =>
    candidate.id === projectId
      ? {
          ...candidate,
          ownerId: nextOwnerIds[0],
          ownerIds: nextOwnerIds,
          memberIds: nextMemberIds,
          reviewers: nextMemberIds.length,
          updatedAt: toEuToday(),
          lastEvent: eventLabel
        }
      : candidate
  );
  appendEvent(state, currentUser.name, eventLabel, projectId);
  writeState(state);

  return buildPayload(state, userId);
}

export function inviteUserToProjectForUser(
  userId: string,
  projectId: string,
  input: { name?: string; email?: string; title?: string }
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  const project = requireProjectOwner(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const name = input.name?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  if (!name || !email) {
    throw new ApiError("Enter a name and email address.");
  }

  let invitedUser = state.users.find((user) => user.email.toLowerCase() === email);
  let temporaryPassword: string | undefined;
  if (!invitedUser) {
    const now = new Date().toISOString();
    temporaryPassword = process.env.PRISMATICA_INVITE_PASSWORD ?? crypto.randomBytes(12).toString("base64url");
    invitedUser = {
      id: createId(`user-${slugify(email)}`),
      name,
      email,
      isAdmin: false,
      initials: getInitials(name),
      organization: project.organization,
      title: input.title?.trim() || "Reviewer",
      timezone: "Europe/Rome",
      avatarColor: pickAvatarColor(state.users.length),
      ...hashPassword(temporaryPassword),
      createdAt: now,
      updatedAt: now
    };
    state.users.push(invitedUser);
  }

  if (!project.memberIds.includes(invitedUser.id)) {
    const nextMemberIds = uniqueIds([...project.memberIds, invitedUser.id]);
    state.projects = state.projects.map((candidate) =>
      candidate.id === projectId
        ? {
            ...candidate,
            ownerIds: getProjectOwnerIds(project),
            memberIds: nextMemberIds,
            reviewers: nextMemberIds.length,
            updatedAt: toEuToday(),
            lastEvent: `Invited ${invitedUser.name} to project team`
          }
        : candidate
    );
    appendEvent(state, currentUser.name, `Invited ${invitedUser.name} to project team`, projectId);
  }

  writeState(state);
  return {
    ...buildPayload(state, userId),
    temporaryPassword,
    message: temporaryPassword
      ? `${invitedUser.name} invited. Temporary password: ${temporaryPassword}`
      : `${invitedUser.name} added to ${project.title}.`
  };
}

export function removeProjectMemberForUser(userId: string, projectId: string, memberId: string): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  const project = requireProjectOwner(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const ownerIds = getProjectOwnerIds(project);
  if (ownerIds.includes(memberId) && ownerIds.length === 1) {
    throw new ApiError("The last project owner cannot be removed.");
  }

  const removedUser = getUser(state, memberId);
  const nextMemberIds = project.memberIds.filter((candidateId) => candidateId !== memberId);
  const nextOwnerIds = ownerIds.filter((ownerId) => ownerId !== memberId);
  state.projects = state.projects.map((candidate) =>
    candidate.id === projectId
      ? {
          ...candidate,
          ownerId: nextOwnerIds[0] ?? candidate.ownerId,
          ownerIds: nextOwnerIds,
          memberIds: nextMemberIds,
          reviewers: nextMemberIds.length,
          updatedAt: toEuToday(),
          lastEvent: `Removed ${removedUser?.name ?? "user"} from project team`
        }
      : candidate
  );
  appendEvent(state, currentUser.name, `Removed ${removedUser?.name ?? "user"} from project team`, projectId);
  writeState(state);

  return buildPayload(state, userId);
}

export function createExtractionTemplateForUser(userId: string, projectId: string, input: ExtractionTemplateInput): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  requireProjectOwner(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const title = input.title?.trim() || "Data Template";
  const fields = sanitizeExtractionTemplateFields(input.fields ?? []);
  if (fields.length === 0) {
    throw new ApiError("Add at least one data extraction field.");
  }

  const now = new Date().toISOString();
  const version =
    state.extractionTemplates.filter((template) => template.projectId === projectId).reduce((highest, template) => Math.max(highest, template.version), 0) + 1;
  const template: ExtractionTemplate = {
    id: createId("template"),
    projectId,
    title,
    version,
    fields,
    createdByUserId: currentUser.id,
    createdByUserName: currentUser.name,
    createdAt: now,
    updatedAt: now,
    isActive: true
  };

  state.extractionTemplates = [
    template,
    ...state.extractionTemplates.map((candidate) =>
      candidate.projectId === projectId && candidate.isActive ? { ...candidate, isActive: false, updatedAt: now } : candidate
    )
  ];
  appendEvent(state, currentUser.name, `Created data template ${title}`, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export function saveExtractionResponseForUser(userId: string, projectId: string, input: ExtractionResponseInput): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const template = state.extractionTemplates.find(
    (candidate) => candidate.id === input.templateId && candidate.projectId === projectId && candidate.isActive
  );
  if (!template) {
    throw new ApiError("Create an active data template before extracting study data.", 404);
  }

  const report = state.reports.find((candidate) => candidate.id === input.reportId && candidate.projectId === projectId);
  const study = state.studies.find((candidate) => candidate.id === (input.studyId || report?.studyId) && candidate.projectId === projectId);
  if (!report || !study || report.studyId !== study.id) {
    throw new ApiError("Choose an included report before submitting extraction data.", 404);
  }
  if (study.stage !== "extraction") {
    throw new ApiError("Data extraction is available only after full-text inclusion.");
  }

  const values = validateExtractionValues(template, input.values ?? {});
  const now = new Date().toISOString();
  const existingResponse = state.extractionResponses.find(
    (response) =>
      response.projectId === projectId &&
      response.reportId === report.id &&
      response.templateId === template.id &&
      response.userId === userId
  );
  const nextResponse: ExtractionResponse = {
    id: existingResponse?.id ?? createId("extraction"),
    projectId,
    studyId: study.id,
    reportId: report.id,
    templateId: template.id,
    userId,
    userName: currentUser.name,
    values,
    isSubmitted: true,
    createdAt: existingResponse?.createdAt ?? now,
    updatedAt: now,
    submittedAt: now
  };

  state.extractionResponses = [
    ...state.extractionResponses.filter((response) => response.id !== existingResponse?.id),
    nextResponse
  ];
  appendEvent(state, currentUser.name, `Submitted data extraction for ${report.title}`, report.id);
  syncProjectWorkflowCounts(state, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export function createImportBatchForUser(
  userId: string,
  projectId: string,
  input: {
    format?: ImportBatch["format"];
    filename?: string;
    byteSize?: number;
    content?: string;
  }
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  const project = requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  if (!input.format || !["ris", "bib"].includes(input.format)) {
    throw new ApiError("Choose a RIS or BibTeX file to import.");
  }

  const filename = input.filename?.trim() || `${input.format}-import.${input.format === "bib" ? "bib" : "ris"}`;
  const content = input.content ?? "";
  const parsedCitations = parseCitationFile(input.format, content);
  const records = parsedCitations.length;
  const parserWarningMessages = parsedCitations.flatMap((citation, index) =>
    citation.warnings.map((warning) => `Record ${index + 1}: ${warning}`)
  );
  if (!content.trim()) {
    parserWarningMessages.push("File is empty or only contains whitespace.");
  }
  const parserWarnings = parserWarningMessages.length;
  const sourceName = input.format === "bib" ? "BibTeX upload" : "RIS upload";
  const now = new Date();
  const batch: ImportBatch = {
    id: createId("imp"),
    projectId,
    sourceName,
    format: input.format,
    filename,
    status: parserWarnings > 0 ? "needs_review" : "parsed",
    records,
    parserWarnings,
    parserWarningMessages,
    uploadedBy: currentUser.name,
    uploadedAt: now.toISOString().slice(0, 16).replace("T", " ")
  };
  const nextImportItemId = getNextImportItemId(state, projectId);
    const importedStudies: Study[] = parsedCitations.map((citation, index) => ({
      id: createId("study"),
    importItemId: nextImportItemId + index,
      projectId,
      importBatchId: batch.id,
      title: citation.title,
      abstract: citation.abstract,
      authors: citation.authors,
      journal: citation.journal,
      year: citation.year,
      doi: citation.doi,
      source: sourceName,
      stage: "title_abstract",
      keywords: citation.keywords,
      rawCitation: citation.rawCitation,
      parserWarnings: citation.warnings
    }));

  state.imports.unshift(batch);
  state.studies.unshift(...importedStudies);
  state.projects = state.projects.map((candidate) =>
    candidate.id === projectId
      ? {
          ...candidate,
          status: candidate.status === "draft" ? "active" : candidate.status,
          stage: records > 0 ? "screening" : candidate.stage === "setup" ? "import" : candidate.stage,
          recordsTotal: candidate.recordsTotal + records,
          updatedAt: toEuToday(),
          lastEvent: `Imported ${filename}`
        }
      : candidate
  );
  appendEvent(state, currentUser.name, `Imported ${records} records from ${filename}`, project.id);
  writeState(state);

  return buildPayload(state, userId);
}

export function markImportBatchReviewedForUser(userId: string, projectId: string, importId: string): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  let found = false;
  state.imports = state.imports.map((batch) => {
    if (batch.id !== importId || batch.projectId !== projectId) {
      return batch;
    }
    found = true;
    return {
      ...batch,
      status: "parsed",
      parserWarnings: 0,
      parserWarningMessages: []
    };
  });

  if (!found) {
    throw new ApiError("Import batch not found.", 404);
  }

  state.studies = state.studies.map((study) =>
    study.projectId === projectId && study.importBatchId === importId ? { ...study, parserWarnings: [] } : study
  );
  appendEvent(state, currentUser.name, `Reviewed parser warnings for ${importId}`, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export function updateImportBatchForUser(
  userId: string,
  projectId: string,
  importId: string,
  input: { sourceName?: string; filename?: string }
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const sourceName = input.sourceName?.trim() ?? "";
  const filename = input.filename?.trim() ?? "";
  if (!sourceName || !filename) {
    throw new ApiError("Source and filename are required.");
  }

  let found = false;
  state.imports = state.imports.map((batch) => {
    if (batch.id !== importId || batch.projectId !== projectId) {
      return batch;
    }
    found = true;
    return {
      ...batch,
      sourceName,
      filename
    };
  });

  if (!found) {
    throw new ApiError("Import batch not found.", 404);
  }

  syncProjectAfterImportChange(state, projectId, `Updated import ${filename}`);
  appendEvent(state, currentUser.name, `Updated import ${filename}`, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export function deleteImportBatchForUser(userId: string, projectId: string, importId: string): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const batch = state.imports.find((candidate) => candidate.id === importId && candidate.projectId === projectId);
  if (!batch) {
    throw new ApiError("Import batch not found.", 404);
  }

  const removedStudyIds = new Set(
    state.studies
      .filter((study) => study.projectId === projectId && study.importBatchId === importId)
      .map((study) => study.id)
  );
  state.imports = state.imports.filter((candidate) => candidate.id !== importId || candidate.projectId !== projectId);
  state.studies = state.studies.filter((study) => study.projectId !== projectId || study.importBatchId !== importId);
  state.reports = state.reports.filter((report) => !removedStudyIds.has(report.studyId));
  state.decisions = state.decisions.filter((decision) => !removedStudyIds.has(decision.studyId));

  syncProjectAfterImportChange(state, projectId, `Deleted import ${batch.filename}`);
  appendEvent(state, currentUser.name, `Deleted import ${batch.filename}`, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export function updateImportStudyForUser(
  userId: string,
  projectId: string,
  importId: string,
  studyId: string,
  input: {
    title?: string;
    abstract?: string;
    authors?: string | string[];
    journal?: string;
    year?: string | number;
    doi?: string;
    keywords?: string | string[];
  }
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const batch = state.imports.find((candidate) => candidate.id === importId && candidate.projectId === projectId);
  if (!batch) {
    throw new ApiError("Import batch not found.", 404);
  }

  const title = input.title?.trim() ?? "";
  const abstract = input.abstract?.trim() || "No abstract was provided by the imported record.";
  const journal = input.journal?.trim() || "Unspecified source";
  const year = typeof input.year === "number" ? input.year : parseYear(String(input.year ?? ""));
  if (!title) {
    throw new ApiError("Citation title is required.");
  }

  let found = false;
  state.studies = state.studies.map((study) => {
    if (study.id !== studyId || study.projectId !== projectId || study.importBatchId !== importId) {
      return study;
    }
    found = true;
    return {
      ...study,
      title,
      abstract,
      authors: normalizeListInput(input.authors),
      journal,
      year,
      doi: normalizeDoi(input.doi ?? ""),
      keywords: normalizeListInput(input.keywords, true),
      parserWarnings: collectCitationWarnings(title, year)
    };
  });

  if (!found) {
    throw new ApiError("Citation entry not found.", 404);
  }

  syncImportBatchAfterStudyChange(state, projectId, importId, true);
  syncProjectAfterImportChange(state, projectId, `Updated imported citation in ${batch.filename}`);
  appendEvent(state, currentUser.name, `Updated imported citation in ${batch.filename}`, studyId);
  writeState(state);
  return buildPayload(state, userId);
}

export function deleteImportStudyForUser(userId: string, projectId: string, importId: string, studyId: string): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const batch = state.imports.find((candidate) => candidate.id === importId && candidate.projectId === projectId);
  const study = state.studies.find((candidate) => candidate.id === studyId && candidate.projectId === projectId && candidate.importBatchId === importId);
  if (!batch || !study) {
    throw new ApiError("Citation entry not found.", 404);
  }

  state.studies = state.studies.filter((candidate) => candidate.id !== studyId);
  state.reports = state.reports.filter((report) => report.studyId !== studyId);
  state.decisions = state.decisions.filter((decision) => decision.studyId !== studyId);
  syncImportBatchAfterStudyChange(state, projectId, importId, batch.parserWarnings > 0 || batch.status === "needs_review");
  syncProjectAfterImportChange(state, projectId, `Deleted imported citation from ${batch.filename}`);
  appendEvent(state, currentUser.name, `Deleted imported citation from ${batch.filename}`, studyId);
  writeState(state);
  return buildPayload(state, userId);
}

export function addScreeningDecisionForUser(
  userId: string,
  input: {
    projectId?: string;
    studyId?: string;
    decisionValue?: DecisionValue;
    note?: string;
  }
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const projectId = input.projectId ?? "";
  const studyId = input.studyId ?? "";
  const project = requireProjectMember(state, projectId, userId);

  if (!studyId || !["include", "exclude", "maybe"].includes(input.decisionValue ?? "")) {
    throw new ApiError("A title/abstract decision must be include, exclude, or maybe.");
  }

  const previousDecision = state.decisions.find(
    (decision) =>
      decision.projectId === projectId &&
      decision.studyId === studyId &&
      decision.userId === userId &&
      decision.stage === "title_abstract" &&
      decision.isCurrent
  );
  const nextDecision: Decision = {
    id: createId("dec"),
    projectId,
    studyId,
    stage: "title_abstract",
    userId,
    userName: currentUser.name,
    decisionValue: input.decisionValue as Exclude<DecisionValue, "not_retrieved">,
    note: input.note?.trim() || undefined,
    isCurrent: true,
    supersedesDecisionId: previousDecision?.id,
    createdAt: new Date().toLocaleString()
  };

  state.decisions = [
    ...state.decisions.map((decision) =>
      previousDecision && decision.id === previousDecision.id ? { ...decision, isCurrent: false } : decision
    ),
    nextDecision
  ];
  appendEvent(state, currentUser.name, `Voted ${formatDecision(nextDecision.decisionValue)}`, studyId);
  syncStudyAfterTitleAbstractDecision(state, project, studyId, currentUser.name);
  writeState(state);

  return {
    ...buildPayload(state, userId),
    decisionAction: {
      studyId,
      previousDecisionId: previousDecision?.id
    }
  };
}

export function getReportsForProjectForUser(userId: string, projectId: string) {
  const state = readState();
  requireProjectMember(state, projectId, userId);
  return state.reports.filter((report) => report.projectId === projectId);
}

export function updateReportForUser(
  userId: string,
  projectId: string,
  reportId: string,
  input: {
    retrievalStatus?: Report["retrievalStatus"];
    decisionValue?: DecisionValue;
    exclusionReasonId?: string;
    note?: string;
  }
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  const project = requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === projectId);
  if (!report) {
    throw new ApiError("Report not found.", 404);
  }

  const nextRetrievalStatus = input.retrievalStatus && isRetrievalStatus(input.retrievalStatus) ? input.retrievalStatus : report.retrievalStatus;
  const decisionValue = input.decisionValue;
  if (decisionValue && !["include", "exclude", "not_retrieved"].includes(decisionValue)) {
    throw new ApiError("A full-text decision must be include, exclude, or not retrieved.");
  }
  if (decisionValue === "include" && (nextRetrievalStatus !== "retrieved" || !report.isPdfValidated)) {
    throw new ApiError("A full-text include requires retrieved status and a validated PDF.");
  }
  if (decisionValue === "exclude" && !input.exclusionReasonId?.trim()) {
    throw new ApiError("Choose an exclusion reason for a full-text exclusion.");
  }

  state.reports = state.reports.map((candidate) =>
    candidate.id === reportId && candidate.projectId === projectId
      ? {
          ...candidate,
          retrievalStatus: decisionValue === "not_retrieved" ? "not_retrieved" : nextRetrievalStatus
        }
      : candidate
  );

  if (decisionValue) {
    const previousDecision = state.decisions.find(
      (decision) =>
        decision.projectId === projectId &&
        decision.reportId === reportId &&
        decision.userId === userId &&
        decision.stage === "full_text" &&
        decision.isCurrent
    );
    const nextDecision: Decision = {
      id: createId("dec"),
      projectId,
      studyId: report.studyId,
      reportId,
      stage: "full_text",
      userId,
      userName: currentUser.name,
      decisionValue,
      exclusionReasonId: decisionValue === "exclude" ? input.exclusionReasonId?.trim() : undefined,
      note: input.note?.trim() || undefined,
      isCurrent: true,
      supersedesDecisionId: previousDecision?.id,
      createdAt: new Date().toLocaleString()
    };
    state.decisions = [
      ...state.decisions.map((decision) =>
        previousDecision && decision.id === previousDecision.id ? { ...decision, isCurrent: false } : decision
      ),
      nextDecision
    ];
    appendEvent(state, currentUser.name, `Full-text ${formatDecision(decisionValue)}`, reportId);
    syncStudyAfterFullTextDecision(state, project, reportId);
  } else {
    appendEvent(state, currentUser.name, `Updated retrieval status to ${formatRetrievalStatus(nextRetrievalStatus)}`, reportId);
  }

  syncProjectWorkflowCounts(state, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export function uploadReportPdfForUser(
  userId: string,
  projectId: string,
  reportId: string,
  input: { fileName?: string; mimeType?: string; size?: number; contentBase64?: string }
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === projectId);
  if (!report) {
    throw new ApiError("Report not found.", 404);
  }

  const fileName = input.fileName?.trim() ?? "";
  const mimeType = input.mimeType?.trim() ?? "";
  if (!fileName || mimeType !== "application/pdf") {
    throw new ApiError("Upload a PDF file.");
  }

  const buffer = Buffer.from(input.contentBase64 ?? "", "base64");
  validatePdfBuffer(buffer, input.size);
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const storagePath = reportPdfStoragePath(projectId, reportId, checksum, fileName);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ storagePath, buffer);

  const duplicate = findDuplicateReportChecksum(state, projectId, reportId, checksum);
  state.reports = state.reports.map((candidate) =>
    candidate.id === reportId && candidate.projectId === projectId
      ? {
          ...candidate,
          retrievalStatus: "retrieved",
          pdfName: fileName,
          fileName,
          mimeType,
          size: buffer.length,
          checksum,
          storagePath,
          uploadedByUserId: currentUser.id,
          uploadedByUserName: currentUser.name,
          isPdfValidated: false,
          validationNotes: duplicate
            ? [`Duplicate PDF checksum also appears on ${duplicate.title}.`]
            : ["PDF uploaded; validation pending."]
        }
      : candidate
  );

  appendEvent(state, currentUser.name, `Uploaded PDF ${fileName}`, reportId);
  syncProjectWorkflowCounts(state, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export function getReportPdfForUser(userId: string, projectId: string, reportId: string) {
  const state = readState();
  requireProjectMember(state, projectId, userId);
  const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === projectId);
  if (!report) {
    throw new ApiError("Report not found.", 404);
  }
  const storagePath = resolveReportPdfStoragePath(report, projectId, reportId);
  if (!storagePath) {
    throw new ApiError("PDF file is not available for this report.", 404);
  }

  if (storagePath !== report.storagePath) {
    state.reports = state.reports.map((candidate) =>
      candidate.id === reportId && candidate.projectId === projectId ? { ...candidate, storagePath } : candidate
    );
    writeState(state);
  }

  const buffer = fs.readFileSync(/*turbopackIgnore: true*/ storagePath);
  return {
    buffer,
    fileName: report.fileName || report.pdfName || "report.pdf",
    mimeType: report.mimeType || "application/pdf"
  };
}

export function validateReportPdfForUser(userId: string, projectId: string, reportId: string): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === projectId);
  if (!report) {
    throw new ApiError("Report not found.", 404);
  }

  const validationNotes: string[] = [];
  const storagePath = resolveReportPdfStoragePath(report, projectId, reportId);
  if (!storagePath) {
    validationNotes.push("PDF file is missing from storage.");
  } else {
    const buffer = fs.readFileSync(/*turbopackIgnore: true*/ storagePath);
    try {
      validatePdfBuffer(buffer, report.size);
    } catch (error) {
      validationNotes.push(error instanceof Error ? error.message : "PDF validation failed.");
    }
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    if (report.checksum && checksum !== report.checksum) {
      validationNotes.push("PDF checksum no longer matches the uploaded file.");
    }
    const duplicate = report.checksum ? findDuplicateReportChecksum(state, projectId, reportId, report.checksum) : undefined;
    if (duplicate) {
      validationNotes.push(`Duplicate PDF checksum also appears on ${duplicate.title}.`);
    }
  }
  if (report.mimeType !== "application/pdf") {
    validationNotes.push("Stored MIME type is not application/pdf.");
  }

  state.reports = state.reports.map((candidate) =>
    candidate.id === reportId && candidate.projectId === projectId
      ? {
          ...candidate,
          storagePath: storagePath || candidate.storagePath,
          isPdfValidated: validationNotes.length === 0,
          validationNotes: validationNotes.length > 0 ? validationNotes : ["PDF header, size, MIME type, and checksum validated."]
        }
      : candidate
  );

  appendEvent(state, currentUser.name, validationNotes.length === 0 ? "Validated report PDF" : "PDF validation needs review", reportId);
  writeState(state);
  return buildPayload(state, userId);
}

export function undoScreeningDecisionForUser(
  userId: string,
  input: { projectId?: string; studyId?: string; previousDecisionId?: string }
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const projectId = input.projectId ?? "";
  const studyId = input.studyId ?? "";
  requireProjectMember(state, projectId, userId);

  const current = state.decisions.find(
    (decision) =>
      decision.projectId === projectId &&
      decision.studyId === studyId &&
      decision.userId === userId &&
      decision.stage === "title_abstract" &&
      decision.isCurrent
  );
  const previous = input.previousDecisionId
    ? state.decisions.find((decision) => decision.id === input.previousDecisionId)
    : undefined;

  state.decisions = state.decisions.map((decision) =>
    current && decision.id === current.id ? { ...decision, isCurrent: false } : decision
  );

  if (previous) {
    state.decisions.push({
      ...previous,
      id: createId("dec"),
      isCurrent: true,
      supersedesDecisionId: current?.id,
      createdAt: new Date().toLocaleString()
    });
  }

  appendEvent(state, currentUser.name, "Undid latest screening vote", studyId);
  const project = requireProjectMember(state, projectId, userId);
  syncStudyAfterTitleAbstractDecision(state, project, studyId, currentUser.name);
  writeState(state);
  return buildPayload(state, userId);
}

export function updateDedupCandidateForUser(
  userId: string,
  candidateId: string,
  status: DedupCandidate["status"]
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  requireProjectMember(state, "demo-review", userId);
  if (!["pending", "confirmed", "rejected", "auto_confirmed"].includes(status)) {
    throw new ApiError("Unknown duplicate candidate status.");
  }

  let updated = false;
  state.dedupCandidates = state.dedupCandidates.map((candidate) => {
    if (candidate.id !== candidateId) {
      return candidate;
    }
    updated = true;
    return { ...candidate, status };
  });

  if (!updated) {
    throw new ApiError("Duplicate candidate not found.", 404);
  }

  appendEvent(
    state,
    currentUser.name,
    status === "confirmed" ? "Confirmed duplicate candidate" : "Rejected duplicate candidate",
    candidateId
  );
  writeState(state);
  return buildPayload(state, userId);
}

function syncStudyAfterTitleAbstractDecision(state: PersistedState, project: ReviewProject, studyId: string, actor: string) {
  const currentDecisions = state.decisions.filter(
    (decision) => decision.projectId === project.id && decision.studyId === studyId && decision.stage === "title_abstract" && decision.isCurrent
  );
  const evaluation = evaluateStage(
    "title_abstract",
    currentDecisions.map((decision) => decision.decisionValue),
    project.abstractRequiredVotes,
    project.maybePolicy
  );

  if (evaluation.state === "advance_full_text") {
    let advancedStudy: Study | undefined;
    state.studies = state.studies.map((study) => {
      if (study.id !== studyId || study.projectId !== project.id) {
        return study;
      }
      advancedStudy = { ...study, stage: "full_text" };
      return advancedStudy;
    });
    if (advancedStudy) {
      upsertReportForStudy(state, project.id, advancedStudy, actor);
      appendEvent(state, actor, "Advanced study to full-text review", studyId);
    }
  } else {
    const existingReport = state.reports.find((report) => report.projectId === project.id && report.studyId === studyId);
    const hasFullTextWork = existingReport
      ? state.decisions.some((decision) => decision.reportId === existingReport.id && decision.stage === "full_text")
      : false;
    if (existingReport && !hasFullTextWork) {
      state.reports = state.reports.filter((report) => report.id !== existingReport.id);
      state.studies = state.studies.map((study) =>
        study.id === studyId && study.projectId === project.id && study.stage === "full_text" ? { ...study, stage: "title_abstract" } : study
      );
      appendEvent(state, actor, "Returned study to title/abstract screening", studyId);
    }
  }

  syncProjectWorkflowCounts(state, project.id);
}

function syncStudyAfterFullTextDecision(state: PersistedState, project: ReviewProject, reportId: string) {
  const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === project.id);
  if (!report) {
    return;
  }

  const currentDecisions = state.decisions.filter(
    (decision) => decision.projectId === project.id && decision.reportId === reportId && decision.stage === "full_text" && decision.isCurrent
  );
  const evaluation = evaluateStage(
    "full_text",
    currentDecisions.map((decision) => decision.decisionValue),
    project.fullTextRequiredVotes,
    project.maybePolicy
  );

  if (evaluation.state === "advance_extraction") {
    state.studies = state.studies.map((study) =>
      study.id === report.studyId && study.projectId === project.id ? { ...study, stage: "extraction" } : study
    );
    return;
  }

  state.studies = state.studies.map((study) =>
    study.id === report.studyId && study.projectId === project.id && study.stage === "extraction" ? { ...study, stage: "full_text" } : study
  );
}

function upsertReportForStudy(state: PersistedState, projectId: string, study: Study, actor: string) {
  const existing = state.reports.find((report) => report.projectId === projectId && report.studyId === study.id);
  if (existing) {
    return existing;
  }

  const report: Report = {
    id: createId("report"),
    projectId,
    studyId: study.id,
    title: study.title,
    citation: formatStudyCitation(study),
    retrievalStatus: "not_sought",
    pdfName: "No PDF uploaded",
    fileName: "",
    mimeType: "",
    size: 0,
    checksum: "",
    storagePath: "",
    isPdfValidated: false,
    validationNotes: ["PDF has not been uploaded."],
    notes: 0
  };
  state.reports.unshift(report);
  appendEvent(state, actor, "Created full-text report", report.id);
  return report;
}

function syncProjectWorkflowCounts(state: PersistedState, projectId: string) {
  const reports = state.reports.filter((report) => report.projectId === projectId);
  const screenedStudyIds = new Set(
    state.decisions
      .filter((decision) => decision.projectId === projectId && decision.stage === "title_abstract" && decision.isCurrent)
      .map((decision) => decision.studyId)
  );
  const includedStudies = state.studies.filter((study) => study.projectId === projectId && study.stage === "extraction").length;

  state.projects = state.projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    const conflictCount = countProjectWorkflowConflicts(state, project);
    return {
      ...project,
      status: project.status === "archived" ? "archived" : reports.length > 0 || screenedStudyIds.size > 0 || project.recordsTotal > 0 ? "active" : "draft",
      stage: includedStudies > 0 ? "extraction" : reports.length > 0 ? "full_text" : project.recordsTotal > 0 ? "screening" : "import",
      recordsScreened: Math.min(Math.max(project.recordsScreened, screenedStudyIds.size), project.recordsTotal),
      conflicts: conflictCount,
      studiesIncluded: includedStudies,
      updatedAt: toEuToday()
    };
  });
}

function resyncAllProjectWorkflowState(state: PersistedState) {
  for (const project of state.projects) {
    const projectStudies = state.studies.filter((study) => study.projectId === project.id);
    for (const study of projectStudies) {
      syncStudyAfterTitleAbstractDecision(state, project, study.id, "System");
    }
    const projectReports = state.reports.filter((report) => report.projectId === project.id);
    for (const report of projectReports) {
      syncStudyAfterFullTextDecision(state, project, report.id);
    }
    syncProjectWorkflowCounts(state, project.id);
  }
}

function countProjectWorkflowConflicts(state: PersistedState, project: ReviewProject) {
  const projectStudies = state.studies.filter((study) => study.projectId === project.id);
  const titleAbstractConflicts = projectStudies.filter((study) => {
    const currentDecisions = state.decisions.filter(
      (decision) => decision.projectId === project.id && decision.studyId === study.id && decision.stage === "title_abstract" && decision.isCurrent
    );
    const evaluation = evaluateStage(
      "title_abstract",
      currentDecisions.map((decision) => decision.decisionValue),
      project.abstractRequiredVotes,
      project.maybePolicy
    );
    return evaluation.state === "conflict" || evaluation.state === "needs_third_vote";
  }).length;

  const fullTextConflicts = state.reports.filter((report) => {
    if (report.projectId !== project.id) {
      return false;
    }
    const currentDecisions = state.decisions.filter(
      (decision) => decision.projectId === project.id && decision.reportId === report.id && decision.stage === "full_text" && decision.isCurrent
    );
    const evaluation = evaluateStage(
      "full_text",
      currentDecisions.map((decision) => decision.decisionValue),
      project.fullTextRequiredVotes,
      project.maybePolicy
    );
    return evaluation.state === "conflict" || evaluation.state === "needs_third_vote";
  }).length;

  return titleAbstractConflicts + fullTextConflicts;
}

function syncImportBatchAfterStudyChange(state: PersistedState, projectId: string, importId: string, refreshWarnings: boolean) {
  const batchStudies = state.studies.filter((study) => study.projectId === projectId && study.importBatchId === importId);
  state.imports = state.imports.map((batch) => {
    if (batch.id !== importId || batch.projectId !== projectId) {
      return batch;
    }

    const parserWarningMessages = refreshWarnings
      ? batchStudies.flatMap((study, index) => (study.parserWarnings ?? []).map((warning) => `Record ${index + 1}: ${warning}`))
      : batch.parserWarningMessages ?? [];
    const parserWarnings = parserWarningMessages.length;
    return {
      ...batch,
      records: batchStudies.length,
      parserWarnings,
      parserWarningMessages,
      status: parserWarnings > 0 ? "needs_review" : "parsed"
    };
  });
}

function syncProjectAfterImportChange(state: PersistedState, projectId: string, lastEvent: string) {
  const recordCount = state.imports
    .filter((batch) => batch.projectId === projectId)
    .reduce((total, batch) => total + batch.records, 0);

  state.projects = state.projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    if (recordCount === 0) {
      return {
        ...project,
        status: project.status === "archived" ? "archived" : "draft",
        stage: "import",
        recordsTotal: 0,
        recordsScreened: 0,
        conflicts: 0,
        studiesIncluded: 0,
        updatedAt: toEuToday(),
        lastEvent
      };
    }

    return {
      ...project,
      status: project.status === "draft" ? "active" : project.status,
      stage: project.stage === "setup" || project.stage === "import" ? "screening" : project.stage,
      recordsTotal: recordCount,
      recordsScreened: Math.min(project.recordsScreened, recordCount),
      updatedAt: toEuToday(),
      lastEvent
    };
  });
}

function appendEvent(state: PersistedState, actor: string, action: string, entity: string) {
  const nextEvent: WorkflowEvent = {
    id: createId("evt"),
    actor,
    action,
    entity,
    time: new Date().toISOString()
  };
  state.events = [nextEvent, ...state.events].slice(0, 50);
}

function requireAdminUser(state: PersistedState, userId: string) {
  const user = getUser(state, userId);
  if (!user) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }
  if (!user.isAdmin) {
    throw new ApiError("Administrator access is required.", 403);
  }
  return user;
}

function ensureAdminUser(users: StoredUser[], now: string) {
  const adminEmail = (process.env.PRISMATICA_ADMIN_EMAIL ?? "admin@prismatica.local").trim().toLowerCase();
  const adminPassword = process.env.PRISMATICA_ADMIN_PASSWORD ?? "change-me-admin";
  const existingAdmin = users.find((user) => user.id === adminUserId || user.isAdmin);
  if (existingAdmin) {
    return users.map((user) =>
      user.id === existingAdmin.id
        ? {
            ...user,
            id: adminUserId,
            isAdmin: true,
            email: user.email || adminEmail,
            name: user.name || "Prismatica Admin",
            initials: user.initials || "PA",
            organization: user.organization || "Prismatica",
            title: user.title || "Administrator",
            timezone: user.timezone || "Europe/Rome",
            avatarColor: user.avatarColor || "#42656d"
          }
        : user
    );
  }

  return [
    {
      id: adminUserId,
      name: "Prismatica Admin",
      email: adminEmail,
      isAdmin: true,
      initials: "PA",
      organization: "Prismatica",
      title: "Administrator",
      timezone: "Europe/Rome",
      avatarColor: "#42656d",
      ...hashPassword(adminPassword),
      createdAt: now,
      updatedAt: now
    },
    ...users
  ];
}

function normalizeOwnerIds(project: ReviewProject, userIds: Set<string>) {
  const nextOwnerIds = uniqueIds([project.ownerId, ...(Array.isArray(project.ownerIds) ? project.ownerIds : [])]).filter((ownerId) => userIds.has(ownerId));
  return nextOwnerIds.length > 0 ? nextOwnerIds : [project.ownerId];
}

function normalizeMemberIds(project: ReviewProject, userIds: Set<string>) {
  const ownerIds = normalizeOwnerIds(project, userIds);
  return uniqueIds([...(Array.isArray(project.memberIds) ? project.memberIds : []), ...ownerIds]).filter((memberId) => userIds.has(memberId));
}

function normalizeReport(report: Partial<Report>): Report {
  return {
    id: report.id || createId("report"),
    projectId: report.projectId || "",
    studyId: report.studyId || "",
    title: report.title || "Untitled report",
    citation: report.citation || "Citation unavailable.",
    retrievalStatus: isRetrievalStatus(report.retrievalStatus) ? report.retrievalStatus : "not_sought",
    pdfName: report.pdfName ?? report.fileName ?? "No PDF uploaded",
    fileName: report.fileName ?? report.pdfName ?? "",
    mimeType: report.mimeType ?? "",
    size: typeof report.size === "number" && Number.isFinite(report.size) ? report.size : 0,
    checksum: report.checksum ?? "",
    storagePath: report.storagePath ?? "",
    uploadedByUserId: report.uploadedByUserId ?? "",
    uploadedByUserName: report.uploadedByUserName ?? "",
    isPdfValidated: Boolean(report.isPdfValidated),
    validationNotes: Array.isArray(report.validationNotes) ? report.validationNotes : [],
    notes: typeof report.notes === "number" && Number.isFinite(report.notes) ? report.notes : 0
  };
}

function normalizeExtractionTemplate(template: Partial<ExtractionTemplate>): ExtractionTemplate {
  return {
    id: template.id || createId("template"),
    projectId: template.projectId || "",
    title: template.title?.trim() || "Data Template",
    version: typeof template.version === "number" && Number.isFinite(template.version) ? template.version : 1,
    fields: normalizeExtractionFields(template.fields),
    createdByUserId: template.createdByUserId || "",
    createdByUserName: template.createdByUserName || "Unknown user",
    createdAt: template.createdAt || new Date().toISOString(),
    updatedAt: template.updatedAt || new Date().toISOString(),
    isActive: template.isActive !== false
  };
}

function normalizeExtractionResponse(response: Partial<ExtractionResponse>): ExtractionResponse {
  const values =
    response.values && typeof response.values === "object" && !Array.isArray(response.values)
      ? Object.fromEntries(
          Object.entries(response.values).map(([fieldId, value]) => [
            fieldId,
            Array.isArray(value) ? value.map(String) : String(value ?? "")
          ])
        )
      : {};
  return {
    id: response.id || createId("extraction"),
    projectId: response.projectId || "",
    studyId: response.studyId || "",
    reportId: response.reportId || "",
    templateId: response.templateId || "",
    userId: response.userId || "",
    userName: response.userName || "Unknown user",
    values,
    isSubmitted: Boolean(response.isSubmitted),
    createdAt: response.createdAt || new Date().toISOString(),
    updatedAt: response.updatedAt || new Date().toISOString(),
    submittedAt: response.submittedAt || undefined
  };
}

function normalizeExtractionFields(fields: ExtractionTemplate["fields"] | undefined) {
  return Array.isArray(fields)
    ? fields.map((field) => ({
        id: field.id || createId("field"),
        title: field.title?.trim() || "Untitled field",
        type: isExtractionFieldType(field.type) ? field.type : "multiline_text",
        options: Array.isArray(field.options) ? uniqueIds(field.options.map((option) => option.trim())).filter(Boolean) : []
      }))
    : [];
}

function isRetrievalStatus(value: unknown): value is Report["retrievalStatus"] {
  return ["not_sought", "sought", "retrieved", "not_retrieved"].includes(String(value));
}

function isExtractionFieldType(value: unknown): value is ExtractionFieldType {
  return ["multiline_text", "single_choice", "multiple_choice"].includes(String(value));
}

function formatRetrievalStatus(value: Report["retrievalStatus"]) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStudyCitation(study: Study) {
  const authors = study.authors.length > 0 ? study.authors.join(", ") : "No authors parsed";
  const year = study.year > 0 ? study.year : "Year needs review";
  return `${authors}. ${study.journal}. ${year}.`;
}

function validatePdfBuffer(buffer: Buffer, declaredSize?: number) {
  const maxPdfSize = 25 * 1024 * 1024;
  if (buffer.length === 0) {
    throw new ApiError("PDF file is empty.");
  }
  if (buffer.length > maxPdfSize) {
    throw new ApiError("PDF file must be 25 MB or smaller.");
  }
  if (typeof declaredSize === "number" && declaredSize > 0 && declaredSize !== buffer.length) {
    throw new ApiError("PDF upload size does not match the received file.");
  }
  if (buffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
    throw new ApiError("PDF header is not readable.");
  }
}

function sanitizeExtractionTemplateFields(inputFields: ExtractionTemplateInput["fields"]): ExtractionTemplateField[] {
  return (inputFields ?? []).map((field, index) => {
    const type = isExtractionFieldType(field.type) ? field.type : "multiline_text";
    const title = field.title?.trim() || `Field ${index + 1}`;
    const options =
      type === "multiline_text"
        ? []
        : uniqueIds((field.options ?? []).map((option) => option.trim()).filter(Boolean));
    if (type !== "multiline_text" && options.length < 2) {
      throw new ApiError(`${title} needs at least two choices.`);
    }
    return {
      id: field.id || createId("field"),
      title,
      type,
      options
    };
  });
}

function validateExtractionValues(template: ExtractionTemplate, inputValues: Record<string, unknown>) {
  const values: Record<string, ExtractionResponseValue> = {};
  for (const field of template.fields) {
    const value = inputValues[field.id];
    if (field.type === "multiline_text") {
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) {
        throw new ApiError(`${field.title} is required.`);
      }
      values[field.id] = text;
      continue;
    }

    if (field.type === "single_choice") {
      const choice = typeof value === "string" ? value : "";
      if (!field.options.includes(choice)) {
        throw new ApiError(`Choose one option for ${field.title}.`);
      }
      values[field.id] = choice;
      continue;
    }

    const choices = Array.isArray(value) ? value.map(String).filter((choice) => field.options.includes(choice)) : [];
    if (choices.length === 0) {
      throw new ApiError(`Choose at least one option for ${field.title}.`);
    }
    values[field.id] = uniqueIds(choices);
  }
  return values;
}

function reportPdfStorageDirectory(projectId: string) {
  const safeProjectId = slugify(projectId) || "project";
  return path.join(path.dirname(dataFilePath()), "pdfs", safeProjectId);
}

function reportPdfStoragePath(projectId: string, reportId: string, checksum: string, fileName: string) {
  const safeReportId = slugify(reportId) || "report";
  const extension = path.extname(fileName).toLowerCase() || ".pdf";
  return path.join(reportPdfStorageDirectory(projectId), `${safeReportId}-${checksum}${extension}`);
}

function resolveReportPdfStoragePath(report: Report, projectId: string, reportId: string) {
  const candidates = [
    report.storagePath,
    report.checksum ? reportPdfStoragePath(projectId, reportId, report.checksum, report.fileName || report.pdfName || "report.pdf") : ""
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
        return candidate;
      }
    }
  }

  if (!report.checksum) {
    return "";
  }

  const safeReportId = slugify(reportId) || "report";
  const prefix = `${safeReportId}-${report.checksum}.`;
  const directory = reportPdfStorageDirectory(projectId);
  if (!fs.existsSync(/*turbopackIgnore: true*/ directory)) {
    return "";
  }

  const matchedFile = fs.readdirSync(/*turbopackIgnore: true*/ directory).find((fileName) => fileName.startsWith(prefix));
  return matchedFile ? path.join(directory, matchedFile) : "";
}

function findDuplicateReportChecksum(state: PersistedState, projectId: string, reportId: string, checksum: string) {
  return state.reports.find(
    (report) => report.projectId === projectId && report.id !== reportId && Boolean(report.checksum) && report.checksum === checksum
  );
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function clampVoteCount(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 2;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 4);
}

function clampFullTextVoteCount(value: number | undefined) {
  return Math.max(clampVoteCount(value), 2);
}

function parseCitationFile(format: ImportBatch["format"], content: string): ParsedCitation[] {
  const normalized = content.trim();
  if (!normalized) {
    return [];
  }

  if (format === "ris") {
    return parseRisCitations(normalized);
  }

  if (format === "bib") {
    return parseBibtexCitations(normalized);
  }

  return [];
}

function parseRisCitations(content: string): ParsedCitation[] {
  const chunks = content
    .split(/^ER\s+-?.*$/gim)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return (chunks.length > 0 ? chunks : [content]).map((chunk, index) => {
    const fields = new Map<string, string[]>();
    let currentTag = "";
    for (const line of chunk.split(/\r?\n/)) {
      const tagged = /^([A-Z0-9]{2})\s+-\s?(.*)$/.exec(line);
      if (tagged) {
        currentTag = tagged[1];
        const existing = fields.get(currentTag) ?? [];
        fields.set(currentTag, [...existing, tagged[2].trim()]);
        continue;
      }
      if (currentTag && line.trim()) {
        const existing = fields.get(currentTag) ?? [];
        existing[existing.length - 1] = `${existing[existing.length - 1]} ${line.trim()}`.trim();
        fields.set(currentTag, existing);
      }
    }

    const title = firstField(fields, ["TI", "T1", "CT"]) || `Imported RIS record ${index + 1}`;
    const year = parseYear(firstField(fields, ["PY", "Y1", "DA"]));
    const warnings = collectCitationWarnings(title, year);
    return {
      title,
      abstract: firstField(fields, ["AB", "N2"]) || "No abstract was provided by the imported record.",
      authors: fields.get("AU") ?? fields.get("A1") ?? [],
      journal: firstField(fields, ["T2", "JF", "JO", "JA"]) || "Unspecified source",
      year,
      doi: normalizeDoi(firstField(fields, ["DO"]) || ""),
      keywords: fields.get("KW") ?? [],
      rawCitation: chunk,
      warnings
    };
  });
}

function parseBibtexCitations(content: string): ParsedCitation[] {
  const chunks = splitBibtexEntries(content);

  return chunks.map((chunk, index) => {
    const title = cleanBibValue(extractBibField(chunk, "title")) || `Imported BibTeX record ${index + 1}`;
    const authorValue = cleanBibValue(extractBibField(chunk, "author"));
    const year = parseYear(cleanBibValue(extractBibField(chunk, "year")));
    const warnings = collectCitationWarnings(title, year);
    if (hasNestedBibtexBraces(chunk)) {
      warnings.push("Nested braces were detected; review parsed fields.");
    }

    return {
      title,
      abstract: cleanBibValue(extractBibField(chunk, "abstract")) || "No abstract was provided by the imported record.",
      authors: authorValue ? authorValue.split(/\s+and\s+/i).map((author) => author.trim()).filter(Boolean) : [],
      journal: cleanBibValue(extractBibField(chunk, "journal")) || cleanBibValue(extractBibField(chunk, "booktitle")) || "Unspecified source",
      year,
      doi: normalizeDoi(cleanBibValue(extractBibField(chunk, "doi"))),
      keywords: cleanBibValue(extractBibField(chunk, "keywords"))
        .split(/[,;]/)
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      rawCitation: chunk,
      warnings
    };
  });
}

function splitBibtexEntries(content: string) {
  const entries: string[] = [];
  const startExpression = /@\w+\s*[{(]/g;
  let match: RegExpExecArray | null;

  while ((match = startExpression.exec(content)) !== null) {
    const start = match.index;
    const openingIndex = startExpression.lastIndex - 1;
    const opening = content[openingIndex];
    const closing = opening === "{" ? "}" : ")";
    let depth = 0;
    let isQuoted = false;
    let escaped = false;
    let end = content.length;

    for (let index = openingIndex; index < content.length; index += 1) {
      const char = content[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        isQuoted = !isQuoted;
        continue;
      }
      if (isQuoted) {
        continue;
      }
      if (char === opening) {
        depth += 1;
      }
      if (char === closing) {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }

    entries.push(content.slice(start, end).trim());
    startExpression.lastIndex = end;
  }

  return entries.length > 0 ? entries : [content.trim()];
}

function firstField(fields: Map<string, string[]>, keys: string[]) {
  for (const key of keys) {
    const value = fields.get(key)?.find(Boolean);
    if (value) {
      return value;
    }
  }
  return "";
}

function extractBibField(entry: string, field: string) {
  const expression = new RegExp(`(?:^|[,\\r\\n])\\s*${field}\\s*=\\s*`, "i");
  const match = expression.exec(entry);
  if (!match) {
    return "";
  }

  return readBibFieldValue(entry, match.index + match[0].length);
}

function readBibFieldValue(entry: string, start: number) {
  let index = start;
  while (/\s/.test(entry[index] ?? "")) {
    index += 1;
  }

  const opening = entry[index];
  if (opening === "{" || opening === "\"") {
    const closing = opening === "{" ? "}" : "\"";
    let depth = 0;
    let escaped = false;
    for (let cursor = index; cursor < entry.length; cursor += 1) {
      const char = entry[cursor];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (opening === "{" && char === "{") {
        depth += 1;
      }
      if (char === closing) {
        if (opening === "\"") {
          return entry.slice(index, cursor + 1);
        }
        depth -= 1;
        if (depth === 0) {
          return entry.slice(index, cursor + 1);
        }
      }
    }
    return entry.slice(index);
  }

  let end = index;
  while (end < entry.length && ![",", "\r", "\n", "}", ")"].includes(entry[end])) {
    end += 1;
  }
  return entry.slice(index, end);
}

function cleanBibValue(value: string) {
  return value
    .trim()
    .replace(/^["{]|["}]$/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNestedBibtexBraces(entry: string) {
  return Array.from(entry.matchAll(/=\s*(\{(?:[^{}]|\{[^{}]*\})*\})/g)).some((match) => {
    const value = match[1].trim().replace(/^\{|\}$/g, "");
    return /[{}]/.test(value);
  });
}

function normalizeListInput(value: string | string[] | undefined, splitCommas = false) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  const separator = splitCommas ? /[;\n,]/ : /[;\n]/;
  return (value ?? "")
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseYear(value: string | undefined) {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : 0;
}

function collectCitationWarnings(title: string, year: number) {
  const warnings: string[] = [];
  if (!title || /^Imported .* record \d+$/.test(title)) {
    warnings.push("Missing title.");
  }
  if (!Number.isFinite(year) || year <= 0) {
    warnings.push("Missing or invalid publication year.");
  }
  return warnings;
}

function normalizeDoi(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .trim();
}

function isEuDate(value: string) {
  return /^\d{2}-\d{2}-\d{4}$/.test(value);
}

function toEuToday() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${now.getFullYear()}`;
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function pickAvatarColor(index: number) {
  const colors = ["#6d5aa7", "#167d7f", "#3b6ea8", "#2f7d4f", "#b27716", "#c94f45"];
  return colors[index % colors.length];
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDecision(value: DecisionValue) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
