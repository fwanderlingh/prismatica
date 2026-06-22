import crypto from "crypto";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import type { AppAuthSettings, AppCheckoutWindowSettings, AppMutationPayload, AppStatePayload, PublicAuthConfigPayload } from "./apiTypes";
import { createPdfStorageAdapter } from "./pdfStorage";
import { randomizeReviewQueueItems } from "./workflowSelectors";
import {
  type AppUser,
  type Decision,
  type DedupCandidate,
  type ExtractionConsensus,
  type ExtractionFieldType,
  type ExtractionResponse,
  type ExtractionResponseValue,
  type ExtractionTemplate,
  type ExtractionTemplateField,
  type ImportBatch,
  type ProjectWorkflowConflict,
  type Report,
  type ReviewProject,
  type Study,
  type WorkflowEvent,
  reviewProjects
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
  checkoutWindowSettings: AppCheckoutWindowSettings;
  users: StoredUser[];
  projects: ReviewProject[];
  imports: ImportBatch[];
  studies: Study[];
  reports: Report[];
  extractionTemplates: ExtractionTemplate[];
  extractionResponses: ExtractionResponse[];
  extractionConsensus: ExtractionConsensus[];
  decisions: Decision[];
  screeningCheckouts: ScreeningCheckout[];
  events: WorkflowEvent[];
  dedupCandidates: DedupCandidate[];
};

type ScreeningCheckout = {
  projectId: string;
  stage: "title_abstract" | "full_text" | "extraction";
  checkoutId?: string;
  studyId?: string;
  reportId?: string;
  templateId?: string;
  userId: string;
  checkedOutAt: string;
  expiresAt: string;
};

type CaptchaPayload = {
  answer: number;
  expiresAt: number;
  nonce: string;
};

type WebsiteTheme = "light" | "dark" | "system";

const defaultScreeningCheckoutWindowMinutes = 60;
const defaultExtractionCheckoutWindowMinutes = 120;

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
  extractionRequiredVotes?: number;
  exclusionReasons?: string[];
  maybePolicy?: ReviewProject["maybePolicy"];
  requireSequentialPhases?: boolean;
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

type ExtractionConsensusInput = {
  templateId?: string;
  reportId?: string;
  studyId?: string;
  resolvedValues?: Record<string, unknown>;
};

type ParsedCitation = {
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  year: number;
  doi: string;
  keywords: string[];
  pdfUrl: string;
  rawCitation: string;
  warnings: string[];
};

const demoUserIds = new Set(["user-rivera", "user-chen", "user-patel", "user-okafor"]);
const adminUserId = "admin-root";
const captchaTtlMs = 10 * 60 * 1000;
const defaultPdfUploadMaxSizeMb = 50;
const pdfRetrievalTimeoutMs = 15_000;
const pdfRetrievalConcurrency = 3;

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

function usePostgresStateStore() {
  return (process.env.PRISMATICA_STORAGE_MODE ?? "").toLowerCase() === "postgres";
}

function postgresStateIoScriptPath() {
  return path.join(process.cwd(), "scripts", "postgres-state-io.mjs");
}

function runPostgresStateIo(action: "read" | "write", payload?: PersistedState) {
  const output = execFileSync(process.execPath, [postgresStateIoScriptPath(), action], {
    env: process.env,
    input: action === "write" ? `${JSON.stringify(payload)}\n` : undefined,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  return output.trim();
}

function readStateFromJsonFile(filePath: string): Partial<PersistedState> | null {
  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8")) as Partial<PersistedState>;
}

const pdfStorage = createPdfStorageAdapter({ dataFilePath });

function defaultAuthSettings(): AppAuthSettings {
  return {
    registrationEnabled: process.env.PRISMATICA_REGISTRATION_ENABLED?.toLowerCase() === "false" ? false : true,
  };
}

function defaultCheckoutWindowSettings(): AppCheckoutWindowSettings {
  return {
    screeningCheckoutWindowMinutes: defaultScreeningCheckoutWindowMinutes,
    extractionCheckoutWindowMinutes: defaultExtractionCheckoutWindowMinutes,
    pdfUploadMaxSizeMb: defaultPdfUploadMaxSizeMb
  };
}

function normalizeAuthSettings(settings: Partial<AppAuthSettings> | undefined): AppAuthSettings {
  const defaults = defaultAuthSettings();
  return {
    ...defaults,
    registrationEnabled: typeof settings?.registrationEnabled === "boolean" ? settings.registrationEnabled : defaults.registrationEnabled
  };
}

function normalizeCheckoutWindowSettings(settings: Partial<AppCheckoutWindowSettings> | undefined): AppCheckoutWindowSettings {
  const defaults = defaultCheckoutWindowSettings();
  return {
    ...defaults,
    screeningCheckoutWindowMinutes: clampCheckoutWindowMinutes(
      settings?.screeningCheckoutWindowMinutes,
      defaults.screeningCheckoutWindowMinutes
    ),
    extractionCheckoutWindowMinutes: clampCheckoutWindowMinutes(
      settings?.extractionCheckoutWindowMinutes,
      defaults.extractionCheckoutWindowMinutes
    ),
    pdfUploadMaxSizeMb: clampPdfUploadMaxSizeMb(settings?.pdfUploadMaxSizeMb, defaults.pdfUploadMaxSizeMb)
  };
}

function clampCheckoutWindowMinutes(value: unknown, fallback: number) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(1, Math.min(600, Math.round(numericValue)));
}

function clampPdfUploadMaxSizeMb(value: unknown, fallback: number) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(1, Math.min(500, Math.round(numericValue)));
}

function pdfUploadMaxSizeBytes(settings: AppCheckoutWindowSettings) {
  return settings.pdfUploadMaxSizeMb * 1024 * 1024;
}

function normalizeExclusionReasons(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueReasons = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    uniqueReasons.add(trimmed);
  }
  return Array.from(uniqueReasons);
}

function normalizeWebsiteTheme(theme: unknown): WebsiteTheme {
  return theme === "light" || theme === "dark" ? theme : "system";
}

function createSeedState(): PersistedState {
  return {
    version: 1,
    authSettings: defaultAuthSettings(),
    checkoutWindowSettings: defaultCheckoutWindowSettings(),
    users: [],
    projects: [],
    imports: [],
    studies: [],
    reports: [],
    extractionTemplates: [],
    extractionResponses: [],
    extractionConsensus: [],
    decisions: [],
    screeningCheckouts: [],
    events: [],
    dedupCandidates: []
  };
}

function readState(): PersistedState {
  if (usePostgresStateStore()) {
    const serializedState = runPostgresStateIo("read");
    if (!serializedState) {
      const fallbackState = readStateFromJsonFile(dataFilePath());
      const seededState = fallbackState ? normalizeState(fallbackState) : createSeedState();
      writeState(seededState);
      return seededState;
    }

    const parsed = JSON.parse(serializedState) as Partial<PersistedState>;
    const normalized = normalizeState(parsed);
    writeState(normalized);
    return normalized;
  }

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
  if (usePostgresStateStore()) {
    runPostgresStateIo("write", state);
    return;
  }

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
  const checkoutWindowSettings = normalizeCheckoutWindowSettings(state.checkoutWindowSettings);
  const persistedUsers = Array.isArray(state.users) ? state.users.filter((user) => !demoUserIds.has(user.id)) : [];
  const users = ensureAdminUser(
    persistedUsers.map((user) => ({
      ...user,
      isAdmin: Boolean(user.isAdmin),
      websiteTheme: normalizeWebsiteTheme((user as { websiteTheme?: unknown }).websiteTheme)
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
          extractionRequiredVotes: clampVoteCount(project.extractionRequiredVotes),
          exclusionReasons: normalizeExclusionReasons(project.exclusionReasons),
          requireSequentialPhases:
            typeof project.requireSequentialPhases === "boolean" ? project.requireSequentialPhases : true,
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
                : [],
          pdfLinks: typeof batch.pdfLinks === "number" && Number.isFinite(batch.pdfLinks) ? batch.pdfLinks : 0,
          pdfsRetrieved: typeof batch.pdfsRetrieved === "number" && Number.isFinite(batch.pdfsRetrieved) ? batch.pdfsRetrieved : 0,
          pdfRetrievalFailures:
            typeof batch.pdfRetrievalFailures === "number" && Number.isFinite(batch.pdfRetrievalFailures)
              ? batch.pdfRetrievalFailures
              : 0
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
  const importsWithStudyWarnings: ImportBatch[] = imports.map((batch): ImportBatch => {
    if (batch.parserWarnings <= 0) {
      return batch;
    }
    const batchStudies = studiesWithImportItemIds.filter(
      (study) => study.projectId === batch.projectId && study.importBatchId === batch.id
    );
    if (batchStudies.length === 0) {
      return batch;
    }
    const parserWarningMessages = buildImportWarningMessages(batchStudies);
    return {
      ...batch,
      parserWarnings: parserWarningMessages.length,
      parserWarningMessages,
      status: parserWarningMessages.length > 0 ? "needs_review" : "parsed"
    };
  });
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
  const extractionConsensus = Array.isArray(state.extractionConsensus)
    ? state.extractionConsensus
        .filter(
          (consensus) =>
            projectIds.has(consensus.projectId) &&
            studyIds.has(consensus.studyId) &&
            reportIds.has(consensus.reportId) &&
            extractionTemplateIds.has(consensus.templateId) &&
            (!consensus.finalizedByUserId || userIds.has(consensus.finalizedByUserId))
        )
        .map((consensus) => normalizeExtractionConsensus(consensus))
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
    checkoutWindowSettings,
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
    imports: importsWithStudyWarnings,
    studies: studiesWithImportItemIds,
    reports,
    extractionTemplates,
    extractionResponses,
    extractionConsensus,
    decisions: Array.isArray(state.decisions)
      ? state.decisions.filter(
          (decision) =>
            projectIds.has(decision.projectId) &&
            studyIds.has(decision.studyId) &&
            userIds.has(decision.userId) &&
            (!decision.reportId || reportIds.has(decision.reportId))
        )
      : [],
    screeningCheckouts: Array.isArray(state.screeningCheckouts)
      ? getActiveScreeningCheckouts(state.screeningCheckouts)
          .map((checkout) => ({
            ...checkout,
            stage: getScreeningCheckoutStage(checkout)
          }))
          .filter((checkout) => {
            const targetExists = checkoutTargetExists(checkout, studyIds, reportIds, extractionTemplateIds);
            return projectIds.has(checkout.projectId) && userIds.has(checkout.userId) && targetExists;
          })
      : [],
    events: Array.isArray(state.events)
      ? state.events.filter((event) => projectIds.has(event.entity) || studyIds.has(event.entity) || reportIds.has(event.entity))
      : [],
    dedupCandidates: Array.isArray(state.dedupCandidates)
      ? state.dedupCandidates.filter((candidate) => projectIds.has(getDedupCandidateProjectId(candidate)))
      : []
  };
  for (const project of normalizedState.projects) {
    syncDedupCandidatesForProject(normalizedState, project.id);
  }
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
    avatarColor: user.avatarColor,
    websiteTheme: normalizeWebsiteTheme((user as { websiteTheme?: unknown }).websiteTheme)
  };
}

function withReportWorkflowState(
  report: Report,
  project: ReviewProject | undefined,
  decisions: Decision[],
  extractionTemplates: ExtractionTemplate[],
  extractionResponses: ExtractionResponse[],
  screeningCheckouts: ScreeningCheckout[],
  currentUserId: string
): Report {
  if (!project) {
    return report;
  }

  const currentDecisions = getCurrentFullTextDecisions(decisions, project.id, report.id);
  const requiredVotes = report.fullTextRequiredVotes ?? project.fullTextRequiredVotes;
  const evaluation = evaluateStage(
    "full_text",
    currentDecisions.map((decision) => decision.decisionValue),
    requiredVotes,
    project.maybePolicy
  );
  const activeReportCheckouts = getEligibleReportCheckouts(project.id, report.id, decisions, screeningCheckouts);
  const currentUserCheckout = activeReportCheckouts.find((checkout) => checkout.userId === currentUserId);
  const activeExtractionTemplate = extractionTemplates.find((template) => template.projectId === project.id && template.isActive);
  const extractionSubmittedResponses = activeExtractionTemplate
    ? getCurrentExtractionResponses(extractionResponses, project.id, report.id, activeExtractionTemplate.id)
    : [];
  const activeExtractionCheckouts = activeExtractionTemplate
    ? getEligibleExtractionCheckouts(project.id, report.id, activeExtractionTemplate.id, extractionResponses, screeningCheckouts)
    : [];
  const currentUserExtractionCheckout = activeExtractionCheckouts.find((checkout) => checkout.userId === currentUserId);
  return {
    ...report,
    fullTextStatus: evaluation.state,
    fullTextStatusLabel: evaluation.label,
    fullTextVoteCount: currentDecisions.length,
    fullTextRequiredVotes: requiredVotes,
    fullTextActiveViewerCount: activeReportCheckouts.length,
    fullTextCheckedOutByCurrentUser: Boolean(currentUserCheckout),
    fullTextCheckoutExpiresAt: currentUserCheckout?.expiresAt,
    extractionTemplateId: activeExtractionTemplate?.id,
    extractionVoteCount: extractionSubmittedResponses.length,
    extractionRequiredVotes: project.extractionRequiredVotes,
    extractionActiveViewerCount: activeExtractionCheckouts.length,
    extractionCheckedOutByCurrentUser: Boolean(currentUserExtractionCheckout),
    extractionCheckoutExpiresAt: currentUserExtractionCheckout?.expiresAt
  };
}

function withStudyWorkflowState(
  study: Study,
  project: ReviewProject | undefined,
  decisions: Decision[],
  screeningCheckouts: ScreeningCheckout[],
  currentUserId: string
): Study {
  if (!project) {
    return study;
  }

  const currentDecisions = getCurrentTitleAbstractDecisions(decisions, project.id, study.id);
  const evaluation = evaluateStage(
    "title_abstract",
    currentDecisions.map((decision) => decision.decisionValue),
    project.abstractRequiredVotes,
    project.maybePolicy
  );
  const activeStudyCheckouts = getEligibleStudyCheckouts(project.id, study.id, decisions, screeningCheckouts);
  const currentUserCheckout = activeStudyCheckouts.find((checkout) => checkout.userId === currentUserId);
  return {
    ...study,
    titleAbstractStatus: evaluation.state,
    titleAbstractStatusLabel: evaluation.label,
    titleAbstractVoteCount: currentDecisions.length,
    titleAbstractRequiredVotes: project.abstractRequiredVotes,
    titleAbstractActiveViewerCount: activeStudyCheckouts.length,
    titleAbstractCheckedOutByCurrentUser: Boolean(currentUserCheckout),
    titleAbstractCheckoutExpiresAt: currentUserCheckout?.expiresAt
  };
}

function getCurrentTitleAbstractDecisions(decisions: Decision[], projectId: string, studyId: string) {
  return decisions.filter(
    (decision) => decision.projectId === projectId && decision.studyId === studyId && decision.stage === "title_abstract" && decision.isCurrent
  );
}

function getCurrentFullTextDecisions(decisions: Decision[], projectId: string, reportId: string) {
  return decisions.filter(
    (decision) => decision.projectId === projectId && decision.reportId === reportId && decision.stage === "full_text" && decision.isCurrent
  );
}

function getCurrentExtractionResponses(
  extractionResponses: ExtractionResponse[],
  projectId: string,
  reportId: string,
  templateId: string
) {
  return extractionResponses.filter(
    (response) =>
      response.projectId === projectId &&
      response.reportId === reportId &&
      response.templateId === templateId &&
      response.isSubmitted
  );
}

function getScreeningCheckoutStage(checkout: Partial<ScreeningCheckout>): ScreeningCheckout["stage"] {
  if (checkout.stage === "extraction") {
    return "extraction";
  }
  return checkout.stage === "full_text" ? "full_text" : "title_abstract";
}

function checkoutTargetExists(
  checkout: ScreeningCheckout,
  studyIds: Set<string>,
  reportIds: Set<string>,
  extractionTemplateIds: Set<string>
) {
  if (checkout.stage === "extraction") {
    return Boolean(checkout.reportId && reportIds.has(checkout.reportId) && checkout.templateId && extractionTemplateIds.has(checkout.templateId));
  }
  if (checkout.stage === "full_text") {
    return Boolean(checkout.reportId && reportIds.has(checkout.reportId));
  }
  return Boolean(checkout.studyId && studyIds.has(checkout.studyId));
}

function getActiveScreeningCheckouts(checkouts: ScreeningCheckout[], now = Date.now()) {
  return checkouts.filter((checkout) => {
    const expiresAt = Date.parse(checkout.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
}

function getEligibleStudyCheckouts(projectId: string, studyId: string, decisions: Decision[], checkouts: ScreeningCheckout[]) {
  const votedUserIds = new Set(getCurrentTitleAbstractDecisions(decisions, projectId, studyId).map((decision) => decision.userId));
  return getActiveScreeningCheckouts(checkouts).filter(
    (checkout) =>
      getScreeningCheckoutStage(checkout) === "title_abstract" &&
      checkout.projectId === projectId &&
      checkout.studyId === studyId &&
      !votedUserIds.has(checkout.userId)
  );
}

function getEligibleReportCheckouts(projectId: string, reportId: string, decisions: Decision[], checkouts: ScreeningCheckout[]) {
  const votedUserIds = new Set(getCurrentFullTextDecisions(decisions, projectId, reportId).map((decision) => decision.userId));
  return getActiveScreeningCheckouts(checkouts).filter(
    (checkout) =>
      getScreeningCheckoutStage(checkout) === "full_text" &&
      checkout.projectId === projectId &&
      checkout.reportId === reportId &&
      !votedUserIds.has(checkout.userId)
  );
}

function getEligibleExtractionCheckouts(
  projectId: string,
  reportId: string,
  templateId: string,
  extractionResponses: ExtractionResponse[],
  checkouts: ScreeningCheckout[]
) {
  const submittedUserIds = new Set(
    getCurrentExtractionResponses(extractionResponses, projectId, reportId, templateId).map((response) => response.userId)
  );
  return getActiveScreeningCheckouts(checkouts).filter(
    (checkout) =>
      getScreeningCheckoutStage(checkout) === "extraction" &&
      checkout.projectId === projectId &&
      checkout.reportId === reportId &&
      checkout.templateId === templateId &&
      !submittedUserIds.has(checkout.userId)
  );
}

function getTitleAbstractCheckoutCapacity(project: ReviewProject, studyId: string, decisions: Decision[]) {
  const currentDecisions = getCurrentTitleAbstractDecisions(decisions, project.id, studyId);
  const evaluation = evaluateStage(
    "title_abstract",
    currentDecisions.map((decision) => decision.decisionValue),
    project.abstractRequiredVotes,
    project.maybePolicy
  );

  if (evaluation.state === "conflict" || evaluation.state === "needs_third_vote") {
    return 1;
  }
  return Math.max(project.abstractRequiredVotes - currentDecisions.length, 0);
}

function getFullTextCheckoutCapacity(project: ReviewProject, report: Report, decisions: Decision[]) {
  const currentDecisions = getCurrentFullTextDecisions(decisions, project.id, report.id);
  const requiredVotes = report.fullTextRequiredVotes ?? project.fullTextRequiredVotes;
  const evaluation = evaluateStage(
    "full_text",
    currentDecisions.map((decision) => decision.decisionValue),
    requiredVotes,
    project.maybePolicy
  );

  if (evaluation.state === "conflict" || evaluation.state === "needs_third_vote") {
    return 1;
  }
  return Math.max(requiredVotes - currentDecisions.length, 0);
}

function getExtractionCheckoutCapacity(
  project: ReviewProject,
  reportId: string,
  templateId: string,
  extractionResponses: ExtractionResponse[]
) {
  const submittedResponses = getCurrentExtractionResponses(extractionResponses, project.id, reportId, templateId);
  return Math.max(project.extractionRequiredVotes - submittedResponses.length, 0);
}

function getCheckoutTtlMs(stage: ScreeningCheckout["stage"], settings: AppCheckoutWindowSettings) {
  const minutes = stage === "extraction" ? settings.extractionCheckoutWindowMinutes : settings.screeningCheckoutWindowMinutes;
  return clampCheckoutWindowMinutes(minutes, stage === "extraction" ? defaultExtractionCheckoutWindowMinutes : defaultScreeningCheckoutWindowMinutes) * 60 * 1000;
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

function getWorkflowReportsForProject(state: PersistedState, projectId: string) {
  const activeStudyIds = new Set(
    state.studies
      .filter((study) => study.projectId === projectId && (study.stage === "full_text" || study.stage === "extraction"))
      .map((study) => study.id)
  );
  return state.reports.filter((report) => report.projectId === projectId && activeStudyIds.has(report.studyId));
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
  state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts);
  const activeScreeningCheckouts = state.screeningCheckouts;
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const allProjectIds = new Set(state.projects.map((project) => project.id));
  const visibleDedupCandidates = state.dedupCandidates.filter((candidate) => projectIds.has(getDedupCandidateProjectId(candidate)));
  const visibleDedupCandidateIds = new Set(visibleDedupCandidates.map((candidate) => candidate.id));

  return {
    currentUser: publicUser(currentUser),
    authSettings: state.authSettings,
    checkoutWindowSettings: state.checkoutWindowSettings,
    users: state.users.filter((user) => currentUser.isAdmin || !user.isAdmin).map(publicUser),
    projects,
    imports: state.imports.filter((batch) => projectIds.has(batch.projectId)),
    studies: state.studies
      .filter((study) => study.projectId && projectIds.has(study.projectId))
      .map((study) =>
        withStudyWorkflowState(
          study,
          study.projectId ? projectById.get(study.projectId) : undefined,
          state.decisions,
          activeScreeningCheckouts,
          userId
        )
      ),
    reports: state.reports
      .filter((report) => projectIds.has(report.projectId))
      .map((report) =>
        withReportWorkflowState(
          report,
          projectById.get(report.projectId),
          state.decisions,
          state.extractionTemplates,
          state.extractionResponses,
          activeScreeningCheckouts,
          userId
        )
      ),
    extractionTemplates: state.extractionTemplates.filter((template) => projectIds.has(template.projectId)),
    extractionResponses: state.extractionResponses.filter(
      (response) => projectIds.has(response.projectId) && studyIds.has(response.studyId) && reportIds.has(response.reportId)
    ),
    extractionConsensus: state.extractionConsensus.filter(
      (consensus) => projectIds.has(consensus.projectId) && studyIds.has(consensus.studyId) && reportIds.has(consensus.reportId)
    ),
    decisions: state.decisions.filter((decision) => {
      const project = projectById.get(decision.projectId);
      if (!project) {
        return false;
      }
      return !project.blindMode || isProjectOwner(project, userId) || decision.userId === userId;
    }),
    workflowConflicts: projects.flatMap((project) => buildProjectWorkflowConflicts(state, project, userId)),
    events: state.events
      .filter(
        (event) =>
          projectIds.has(event.entity) ||
          studyIds.has(event.entity) ||
          reportIds.has(event.entity) ||
          visibleDedupCandidateIds.has(event.entity) ||
          (projectIds.has("demo-review") && !allProjectIds.has(event.entity))
      )
      .slice(0, 50),
    dedupCandidates: visibleDedupCandidates
  };
}

function buildProjectWorkflowConflicts(state: PersistedState, project: ReviewProject, userId: string): ProjectWorkflowConflict[] {
  const canSeeAllVotes = !project.blindMode || isProjectOwner(project, userId);
  const visibleDecisions = (decisions: Decision[]) => (canSeeAllVotes ? decisions : decisions.filter((decision) => decision.userId === userId));
  const projectStudies = state.studies.filter((study) => study.projectId === project.id);
  const titleAbstractConflicts = projectStudies.flatMap((study): ProjectWorkflowConflict[] => {
    const currentDecisions = state.decisions.filter(
      (decision) => decision.projectId === project.id && decision.studyId === study.id && decision.stage === "title_abstract" && decision.isCurrent
    );
    const evaluation = evaluateStage(
      "title_abstract",
      currentDecisions.map((decision) => decision.decisionValue),
      project.abstractRequiredVotes,
      project.maybePolicy
    );

    if (evaluation.state !== "conflict" && evaluation.state !== "needs_third_vote") {
      return [];
    }

    return [
      {
        id: `title_abstract:${study.id}`,
        projectId: project.id,
        stage: "title_abstract",
        studyId: study.id,
        title: study.title,
        subtitle: `${study.source} · ${study.year > 0 ? study.year : "Year needs review"}`,
        label: evaluation.label,
        decisions: visibleDecisions(currentDecisions)
      }
    ];
  });

  const fullTextConflicts = getWorkflowReportsForProject(state, project.id)
    .flatMap((report): ProjectWorkflowConflict[] => {
      const currentDecisions = state.decisions.filter(
        (decision) => decision.projectId === project.id && decision.reportId === report.id && decision.stage === "full_text" && decision.isCurrent
      );
      const evaluation = evaluateStage(
        "full_text",
        currentDecisions.map((decision) => decision.decisionValue),
        report.fullTextRequiredVotes ?? project.fullTextRequiredVotes,
        project.maybePolicy
      );

      if (evaluation.state !== "conflict" && evaluation.state !== "needs_third_vote") {
        return [];
      }

      return [
        {
          id: `full_text:${report.id}`,
          projectId: project.id,
          stage: "full_text",
          studyId: report.studyId,
          reportId: report.id,
          title: report.title,
          subtitle: report.citation,
          label: evaluation.label,
          decisions: visibleDecisions(currentDecisions)
        }
      ];
    });

  return [...titleAbstractConflicts, ...fullTextConflicts];
}

export function getAppStateForUser(userId: string): AppStatePayload {
  return buildPayload(readState(), userId);
}

export function canAccessProjectRoute(projectId: string, userId: string | null) {
  if (!userId) {
    return false;
  }

  const state = readState();
  const project = getProject(state, projectId);
  if (!project) {
    return reviewProjects.some((seedProject) => seedProject.id === projectId);
  }
  const user = getUser(state, userId);
  return Boolean(user?.isAdmin || isProjectMember(project, userId));
}

export function deleteProjectForUser(userId: string, projectId: string): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const project = getProject(state, projectId);

  if (!project) {
    throw new ApiError("Review not found.", 404);
  }

  if (!currentUser.isAdmin && !isProjectOwner(project, userId)) {
    throw new ApiError("Only project owners can delete this review.", 403);
  }

  const removedStudyIds = new Set(state.studies.filter((study) => study.projectId === projectId).map((study) => study.id));
  const removedReportIds = new Set(state.reports.filter((report) => report.projectId === projectId).map((report) => report.id));

  state.projects = state.projects.filter((candidate) => candidate.id !== projectId);
  state.imports = state.imports.filter((batch) => batch.projectId !== projectId);
  state.studies = state.studies.filter((study) => study.projectId !== projectId);
  state.reports = state.reports.filter((report) => report.projectId !== projectId);
  state.extractionTemplates = state.extractionTemplates.filter((template) => template.projectId !== projectId);
  state.extractionResponses = state.extractionResponses.filter((response) => response.projectId !== projectId);
  state.extractionConsensus = state.extractionConsensus.filter((consensus) => consensus.projectId !== projectId);
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
  const previousSettings = state.authSettings;
  state.authSettings = normalizeAuthSettings({
    ...state.authSettings,
    ...settings
  });
  const registrationChanged = previousSettings.registrationEnabled !== state.authSettings.registrationEnabled;
  const eventMessage = state.authSettings.registrationEnabled
      ? "Enabled public registration"
      : "Disabled public registration";
  appendEvent(state, adminUser.name, eventMessage, adminUser.id);
  writeState(state);
  return {
    ...buildPayload(state, adminUser.id),
    message: registrationChanged
        ? state.authSettings.registrationEnabled
          ? "Public registration enabled."
          : "Public registration disabled."
        : "Admin settings saved."
  };
}

export function updateCheckoutWindowSettingsForUser(
  adminUserIdInput: string,
  settings: Partial<AppCheckoutWindowSettings>
): AppMutationPayload {
  const state = readState();
  const adminUser = requireAdminUser(state, adminUserIdInput);

  const previousSettings = normalizeCheckoutWindowSettings(state.checkoutWindowSettings);

  state.checkoutWindowSettings = normalizeCheckoutWindowSettings({
    ...previousSettings,
    ...settings
  });

  const checkoutWindowChanged =
    previousSettings.screeningCheckoutWindowMinutes !== state.checkoutWindowSettings.screeningCheckoutWindowMinutes ||
    previousSettings.extractionCheckoutWindowMinutes !== state.checkoutWindowSettings.extractionCheckoutWindowMinutes ||
    previousSettings.pdfUploadMaxSizeMb !== state.checkoutWindowSettings.pdfUploadMaxSizeMb;

  const eventMessage = checkoutWindowChanged ? "Updated global review settings" : "";

  if (eventMessage) {
    appendEvent(state, adminUser.name, eventMessage, adminUser.id);
  }
  writeState(state);
  return {
    ...buildPayload(state, adminUser.id),
    message: checkoutWindowChanged ? "Global review settings saved." : ""
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
    websiteTheme: "system",
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
    name?: string;
    organization?: string;
    title?: string;
    currentPassword?: string;
    newPassword?: string;
    websiteTheme?: string;
  }
): AppStatePayload {
  const state = readState();
  const user = getUser(state, userId);
  if (!user) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const name = input.name?.trim() ?? user.name;
  const organization = input.organization?.trim() ?? user.organization;
  const title = input.title?.trim() ?? user.title;
  const newPassword = input.newPassword?.trim() ?? "";
  const websiteTheme = input.websiteTheme === undefined ? normalizeWebsiteTheme(user.websiteTheme) : normalizeWebsiteTheme(input.websiteTheme);

  if (!name || !organization || !title) {
    throw new ApiError("Name, organization, and role title are required.");
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
          name,
          initials: getInitials(name),
          organization,
          title,
          websiteTheme,
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
  state.extractionTemplates = state.extractionTemplates.filter((template) => !solelyOwnedProjectIds.has(template.projectId));
  state.extractionResponses = state.extractionResponses.filter(
    (response) => response.userId !== targetUserId && !solelyOwnedProjectIds.has(response.projectId) && !removedStudyIds.has(response.studyId)
  );
  state.extractionConsensus = state.extractionConsensus.filter(
    (consensus) => !solelyOwnedProjectIds.has(consensus.projectId) && !removedStudyIds.has(consensus.studyId)
  );
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

export function adminCreateUserForUser(
  adminUserIdInput: string,
  input: {
    name?: string;
    email?: string;
    organization?: string;
    title?: string;
    password?: string;
  }
): AppMutationPayload {
  const state = readState();
  const adminUser = requireAdminUser(state, adminUserIdInput);

  const name = input.name?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const organization = input.organization?.trim() ?? "";
  const title = input.title?.trim() || "Reviewer";

  if (!name || !email || !organization) {
    throw new ApiError("Enter name, email, and organization to create a user.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError("Enter a valid email address.");
  }

  if (state.users.some((user) => user.email.toLowerCase() === email)) {
    throw new ApiError("That email already has an account.", 409);
  }

  const temporaryPassword = input.password?.trim() || crypto.randomBytes(12).toString("base64url").slice(0, 16);
  if (temporaryPassword.length < 8) {
    throw new ApiError("Password must be at least 8 characters.");
  }

  const now = new Date().toISOString();
  const newUser: StoredUser = {
    id: createId(`user-${slugify(email)}`),
    name,
    email,
    isAdmin: false,
    initials: getInitials(name),
    organization,
    title,
    timezone: "Europe/Rome",
    avatarColor: pickAvatarColor(state.users.length),
    websiteTheme: "system",
    ...hashPassword(temporaryPassword),
    createdAt: now,
    updatedAt: now
  };

  state.users.push(newUser);
  appendEvent(state, adminUser.name, `Created account ${newUser.name}`, newUser.id);
  writeState(state);

  return {
    ...buildPayload(state, adminUser.id),
    createdUserId: newUser.id,
    temporaryPassword,
    message: `Created account ${newUser.name}. Temporary password: ${temporaryPassword}`
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
  if (!title || (dueDate.length > 0 && !isEuDate(dueDate))) {
    throw new ApiError("A project title is required. Due dates must use dd-mm-yyyy when provided.");
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
    extractionRequiredVotes: clampVoteCount(input.extractionRequiredVotes),
    exclusionReasons: normalizeExclusionReasons(input.exclusionReasons),
    maybePolicy: input.maybePolicy ?? "advance_to_full_text",
    requireSequentialPhases: typeof input.requireSequentialPhases === "boolean" ? input.requireSequentialPhases : true,
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
  if (!title || (dueDate.length > 0 && !isEuDate(dueDate))) {
    throw new ApiError("A project title is required. Due dates must use dd-mm-yyyy when provided.");
  }

  const maybePolicy = input.maybePolicy ?? project.maybePolicy;
  const exclusionReasons = input.exclusionReasons ? normalizeExclusionReasons(input.exclusionReasons) : project.exclusionReasons;
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
          extractionRequiredVotes: clampVoteCount(input.extractionRequiredVotes ?? project.extractionRequiredVotes),
          exclusionReasons,
          maybePolicy,
          requireSequentialPhases:
            typeof input.requireSequentialPhases === "boolean" ? input.requireSequentialPhases : project.requireSequentialPhases,
          updatedAt: toEuToday(),
          lastEvent: "Project settings updated"
        }
      : candidate
  );
  syncProjectWorkflowCounts(state, projectId);
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

export function saveExtractionTemplateForUser(userId: string, projectId: string, input: ExtractionTemplateInput): AppMutationPayload {
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
  const existingTemplate =
    state.extractionTemplates.find((template) => template.projectId === projectId && template.isActive) ??
    state.extractionTemplates.find((template) => template.projectId === projectId);
  const fieldsChanged = existingTemplate ? !areExtractionTemplateFieldsCompatible(existingTemplate.fields, fields) : false;
  const template: ExtractionTemplate = existingTemplate
    ? {
        ...existingTemplate,
        title,
        fields,
        updatedAt: now,
        isActive: true
      }
    : {
        id: createId("template"),
        projectId,
        title,
        version: 1,
        fields,
        createdByUserId: currentUser.id,
        createdByUserName: currentUser.name,
        createdAt: now,
        updatedAt: now,
        isActive: true
      };

  state.extractionTemplates = [
    template,
    ...state.extractionTemplates.filter((candidate) => candidate.projectId !== projectId)
  ];
  if (fieldsChanged) {
    state.extractionResponses = state.extractionResponses.filter((response) => response.projectId !== projectId);
    state.extractionConsensus = state.extractionConsensus.filter((consensus) => consensus.projectId !== projectId);
    state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts).filter(
      (checkout) => !(getScreeningCheckoutStage(checkout) === "extraction" && checkout.projectId === projectId)
    );
  } else {
    state.extractionResponses = state.extractionResponses.filter(
      (response) => response.projectId !== projectId || response.templateId === template.id
    );
    state.extractionConsensus = state.extractionConsensus.filter(
      (consensus) => consensus.projectId !== projectId || consensus.templateId === template.id
    );
    state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts).filter(
      (checkout) =>
        !(
          getScreeningCheckoutStage(checkout) === "extraction" &&
          checkout.projectId === projectId &&
          checkout.templateId !== template.id
        )
    );
  }
  appendEvent(
    state,
    currentUser.name,
    existingTemplate
      ? fieldsChanged
        ? `Updated data extraction schema ${title} and reset extraction responses`
        : `Updated data extraction schema ${title}`
      : `Created data extraction schema ${title}`,
    projectId
  );
  writeState(state);
  return buildPayload(state, userId);
}

export function saveExtractionResponseForUser(userId: string, projectId: string, input: ExtractionResponseInput): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  const project = requireProjectMember(state, projectId, userId);
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
  state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts);
  if (!existingResponse) {
    const submittedResponses = getCurrentExtractionResponses(state.extractionResponses, projectId, report.id, template.id);
    if (submittedResponses.length >= project.extractionRequiredVotes) {
      throw new ApiError("This report already has the required independent extraction submissions.");
    }
    const hasActiveCheckout = state.screeningCheckouts.some(
      (checkout) =>
        getScreeningCheckoutStage(checkout) === "extraction" &&
        checkout.projectId === projectId &&
        checkout.reportId === report.id &&
        checkout.templateId === template.id &&
        checkout.userId === userId
    );
    if (!hasActiveCheckout) {
      const checkoutCapacity = getExtractionCheckoutCapacity(project, report.id, template.id, state.extractionResponses);
      const activeExtractionCheckouts = getEligibleExtractionCheckouts(
        projectId,
        report.id,
        template.id,
        state.extractionResponses,
        state.screeningCheckouts
      );
      if (checkoutCapacity <= 0 || activeExtractionCheckouts.length >= checkoutCapacity) {
        throw new ApiError("This report is no longer checked out to you. Open the next active extraction report to continue.");
      }

      // Re-acquire checkout atomically here so immediate submissions after page open do not fail on timing races.
      const checkoutTime = Date.now();
      state.screeningCheckouts.push({
        projectId,
        stage: "extraction",
        checkoutId: createId("checkout"),
        studyId: report.studyId,
        reportId: report.id,
        templateId: template.id,
        userId,
        checkedOutAt: new Date(checkoutTime).toISOString(),
        expiresAt: new Date(checkoutTime + getCheckoutTtlMs("extraction", state.checkoutWindowSettings)).toISOString()
      });
    }
  }
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
  state.screeningCheckouts = state.screeningCheckouts.filter(
    (checkout) =>
      !(
        getScreeningCheckoutStage(checkout) === "extraction" &&
        checkout.projectId === projectId &&
        checkout.reportId === report.id &&
        checkout.templateId === template.id &&
        checkout.userId === userId
      )
  );
  syncExtractionConsensusForReport(state, projectId, report.id, template.id);
  appendEvent(state, currentUser.name, `Submitted data extraction for ${report.title}`, report.id);
  syncProjectWorkflowCounts(state, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export function saveExtractionConsensusForUser(userId: string, projectId: string, input: ExtractionConsensusInput): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  const project = requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const report = state.reports.find((candidate) => candidate.id === input.reportId && candidate.projectId === projectId);
  if (!report) {
    throw new ApiError("Choose an included report before finalizing consensus.", 404);
  }

  const template = state.extractionTemplates.find(
    (candidate) => candidate.id === (input.templateId ?? "") && candidate.projectId === projectId && candidate.isActive
  );
  if (!template) {
    throw new ApiError("Create an active data template before resolving extraction conflicts.", 404);
  }

  const draft = buildExtractionConsensusDraft(state, project, report.id, template);
  if (!draft) {
    throw new ApiError("Consensus is not ready yet. Collect all required independent extraction submissions first.", 400);
  }

  const mergedValues: Record<string, unknown> = { ...draft.autoResolvedValues };
  const incomingValues = input.resolvedValues ?? {};
  for (const fieldId of draft.flaggedFieldIds) {
    if (!(fieldId in incomingValues)) {
      const field = template.fields.find((candidate) => candidate.id === fieldId);
      throw new ApiError(`${field?.title ?? "A flagged field"} requires an arbitration decision before finalization.`);
    }
    mergedValues[fieldId] = incomingValues[fieldId];
  }

  const resolvedValues = validateExtractionValues(template, mergedValues);
  const now = new Date().toISOString();
  const existingConsensus = state.extractionConsensus.find(
    (consensus) =>
      consensus.projectId === projectId && consensus.reportId === report.id && consensus.templateId === template.id
  );

  const finalizedConsensus: ExtractionConsensus = {
    id: existingConsensus?.id ?? createId("consensus"),
    projectId,
    studyId: report.studyId,
    reportId: report.id,
    templateId: template.id,
    requiredVotes: project.extractionRequiredVotes,
    reviewerResponseIds: draft.reviewerResponseIds,
    sourceFingerprint: draft.sourceFingerprint,
    flaggedFieldIds: draft.flaggedFieldIds,
    resolvedValues,
    status: "finalized",
    createdAt: existingConsensus?.createdAt ?? now,
    updatedAt: now,
    finalizedAt: now,
    finalizedByUserId: currentUser.id,
    finalizedByUserName: currentUser.name
  };

  state.extractionConsensus = [
    ...state.extractionConsensus.filter((consensus) => consensus.id !== existingConsensus?.id),
    finalizedConsensus
  ];
  appendEvent(state, currentUser.name, `Finalized extraction consensus for ${report.title}`, report.id);
  syncProjectWorkflowCounts(state, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export async function createImportBatchForUser(
  userId: string,
  projectId: string,
  input: {
    format?: ImportBatch["format"];
    filename?: string;
    byteSize?: number;
    content?: string;
  }
): Promise<AppMutationPayload> {
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
  const importFileWarnings: string[] = [];
  if (!content.trim()) {
    importFileWarnings.push("Import file: File is empty or only contains whitespace.");
  }
  const sourceName = input.format === "bib" ? "BibTeX upload" : "RIS upload";
  const now = new Date();
  const pdfLinks = parsedCitations.filter((citation) => citation.pdfUrl).length;
  const batchId = createId("imp");
  const nextImportItemId = getNextImportItemId(state, projectId);
  const importedStudies: Study[] = parsedCitations.map((citation, index) => ({
    id: createId("study"),
    importItemId: nextImportItemId + index,
    projectId,
    importBatchId: batchId,
    title: citation.title,
    abstract: citation.abstract,
    authors: citation.authors,
    journal: citation.journal,
    year: citation.year,
    doi: citation.doi,
    source: sourceName,
    stage: "title_abstract",
    keywords: citation.keywords,
    pdfUrl: citation.pdfUrl || undefined,
    rawCitation: citation.rawCitation,
    parserWarnings: citation.warnings
  }));
  const parserWarningMessages = [...buildImportWarningMessages(importedStudies), ...importFileWarnings];
  const parserWarnings = parserWarningMessages.length;
  const batch: ImportBatch = {
    id: batchId,
    projectId,
    sourceName,
    format: input.format,
    filename,
    status: parserWarnings > 0 ? "needs_review" : "parsed",
    records,
    parserWarnings,
    parserWarningMessages,
    pdfLinks,
    pdfsRetrieved: 0,
    pdfRetrievalFailures: 0,
    uploadedBy: currentUser.name,
    uploadedAt: now.toISOString().slice(0, 16).replace("T", " ")
  };
  const importedReports = importedStudies
    .filter((study) => study.pdfUrl)
    .map((study) => createReportForStudy(projectId, study, study.pdfUrl));

  state.imports.unshift(batch);
  state.studies.unshift(...importedStudies);
  state.reports.unshift(...importedReports);
  syncDedupCandidatesForProject(state, projectId);
  if (importedReports.length > 0) {
    await retrieveImportedPdfReports(state, projectId, batch.id, importedReports, currentUser);
  }
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
  const refreshedBatch = state.imports.find((candidate) => candidate.id === batch.id);
  const pdfSummary =
    refreshedBatch && (refreshedBatch.pdfLinks ?? 0) > 0
      ? `; retrieved ${refreshedBatch.pdfsRetrieved ?? 0} of ${refreshedBatch.pdfLinks ?? 0} linked PDFs`
      : "";
  appendEvent(state, currentUser.name, `Imported ${records} records from ${filename}${pdfSummary}`, project.id);
  writeState(state);

  return {
    ...buildPayload(state, userId),
    message:
      refreshedBatch && (refreshedBatch.pdfLinks ?? 0) > 0
        ? `${filename} imported with ${refreshedBatch.pdfsRetrieved ?? 0} of ${refreshedBatch.pdfLinks ?? 0} linked PDFs retrieved.`
        : `${filename} imported and stored on the server.`
  };
}

export function markImportBatchReviewedForUser(
  userId: string,
  projectId: string,
  importId: string,
  input: { sourceName?: string; filename?: string } = {}
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const sourceName = input.sourceName?.trim();
  const filename = input.filename?.trim();
  if ((input.sourceName !== undefined && !sourceName) || (input.filename !== undefined && !filename)) {
    throw new ApiError("Source and filename are required.");
  }

  let reviewedFilename = importId;
  let found = false;
  state.imports = state.imports.map((batch) => {
    if (batch.id !== importId || batch.projectId !== projectId) {
      return batch;
    }
    found = true;
    reviewedFilename = filename || batch.filename;
    return {
      ...batch,
      sourceName: sourceName || batch.sourceName,
      filename: filename || batch.filename,
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
  syncProjectAfterImportChange(state, projectId, `Reviewed parser warnings for ${reviewedFilename}`);
  appendEvent(state, currentUser.name, `Reviewed parser warnings for ${reviewedFilename}`, projectId);
  writeState(state);
  return {
    ...buildPayload(state, userId),
    message: `Saved details and marked ${reviewedFilename} reviewed.`
  };
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
  state.dedupCandidates = state.dedupCandidates.filter(
    (candidate) => !removedStudyIds.has(candidate.recordA.id) && !removedStudyIds.has(candidate.recordB.id)
  );

  syncProjectAfterImportChange(state, projectId, `Deleted import ${batch.filename}`);
  appendEvent(state, currentUser.name, `Deleted import ${batch.filename}`, projectId);
  writeState(state);
  return {
    ...buildPayload(state, userId),
    message: `Deleted ${batch.filename} and ${removedStudyIds.size} citation ${removedStudyIds.size === 1 ? "entry" : "entries"}.`
  };
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
  let updatedStudy: Study | undefined;
  state.studies = state.studies.map((study) => {
    if (study.id !== studyId || study.projectId !== projectId || study.importBatchId !== importId) {
      return study;
    }
    found = true;
    updatedStudy = {
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
    return updatedStudy;
  });

  if (!found) {
    throw new ApiError("Citation entry not found.", 404);
  }
  const studyForReport = updatedStudy;
  if (studyForReport) {
    state.reports = state.reports.map((report) =>
      report.studyId === studyId && report.projectId === projectId
        ? {
            ...report,
            title: studyForReport.title,
            citation: formatStudyCitation(studyForReport)
          }
        : report
    );
  }

  syncImportBatchAfterStudyChange(state, projectId, importId, true);
  syncDedupCandidatesForProject(state, projectId);
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
  state.extractionResponses = state.extractionResponses.filter((response) => response.studyId !== studyId);
  state.extractionConsensus = state.extractionConsensus.filter((consensus) => consensus.studyId !== studyId);
  state.decisions = state.decisions.filter((decision) => decision.studyId !== studyId);
  state.dedupCandidates = state.dedupCandidates.filter((candidate) => candidate.recordA.id !== studyId && candidate.recordB.id !== studyId);
  syncImportBatchAfterStudyChange(state, projectId, importId, batch.parserWarnings > 0 || batch.status === "needs_review");
  syncDedupCandidatesForProject(state, projectId);
  syncProjectAfterImportChange(state, projectId, `Deleted imported citation from ${batch.filename}`);
  appendEvent(state, currentUser.name, `Deleted imported citation from ${batch.filename}`, studyId);
  writeState(state);
  return buildPayload(state, userId);
}

export function markImportStudyReviewedForUser(userId: string, projectId: string, importId: string, studyId: string): AppMutationPayload {
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

  state.studies = state.studies.map((candidate) =>
    candidate.id === studyId && candidate.projectId === projectId && candidate.importBatchId === importId
      ? { ...candidate, parserWarnings: [] }
      : candidate
  );
  syncImportBatchAfterStudyChange(state, projectId, importId, true);
  syncProjectAfterImportChange(state, projectId, `Reviewed imported citation in ${batch.filename}`);
  appendEvent(state, currentUser.name, `Reviewed imported citation in ${batch.filename}`, studyId);
  writeState(state);
  return {
    ...buildPayload(state, userId),
    message: `Marked "${study.title}" reviewed.`
  };
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
  if (getConfirmedDuplicateStudyIds(state, projectId).has(studyId)) {
    throw new ApiError("This citation has been confirmed as a duplicate and is no longer in the screening queue.");
  }

  state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts);
  const previousDecision = state.decisions.find(
    (decision) =>
      decision.projectId === projectId &&
      decision.studyId === studyId &&
      decision.userId === userId &&
      decision.stage === "title_abstract" &&
      decision.isCurrent
  );
  const currentDecisions = getCurrentTitleAbstractDecisions(state.decisions, projectId, studyId);
  const currentEvaluation = evaluateStage(
    "title_abstract",
    currentDecisions.map((decision) => decision.decisionValue),
    project.abstractRequiredVotes,
    project.maybePolicy
  );
  const canAcceptAdditionalVote = currentEvaluation.state === "conflict" || currentEvaluation.state === "needs_third_vote";
  if (!previousDecision && currentDecisions.length >= project.abstractRequiredVotes && !canAcceptAdditionalVote) {
    throw new ApiError("This citation already has the required independent votes.");
  }
  let hasActiveCheckout = state.screeningCheckouts.some(
    (checkout) =>
      getScreeningCheckoutStage(checkout) === "title_abstract" &&
      checkout.projectId === projectId &&
      checkout.studyId === studyId &&
      checkout.userId === userId
  );
  if (!previousDecision && !hasActiveCheckout) {
    hasActiveCheckout = acquireTitleAbstractCheckoutForUser(state, project, studyId, userId);
  }
  if (!previousDecision && !hasActiveCheckout) {
    throw new ApiError("This citation is no longer checked out to you. Open the next active citation to continue.");
  }

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
  state.screeningCheckouts = state.screeningCheckouts.filter(
    (checkout) =>
      !(
        getScreeningCheckoutStage(checkout) === "title_abstract" &&
        checkout.projectId === projectId &&
        checkout.studyId === studyId &&
        checkout.userId === userId
      )
  );
  appendEvent(state, currentUser.name, `Voted ${formatDecision(nextDecision.decisionValue)}`, studyId);
  syncStudyAfterTitleAbstractDecision(state, project, studyId, currentUser.name);
  acquireNextTitleAbstractCheckoutForUser(state, project, userId);
  writeState(state);

  return {
    ...buildPayload(state, userId),
    decisionAction: {
      studyId,
      previousDecisionId: previousDecision?.id
    }
  };
}

function acquireTitleAbstractCheckoutForUser(state: PersistedState, project: ReviewProject, studyId: string, userId: string) {
  const projectId = project.id;
  const study = state.studies.find((candidate) => candidate.id === studyId && candidate.projectId === projectId);
  if (!study || study.stage !== "title_abstract" || getConfirmedDuplicateStudyIds(state, projectId).has(studyId)) {
    return false;
  }

  const previousDecision = state.decisions.find(
    (decision) =>
      decision.projectId === projectId &&
      decision.studyId === studyId &&
      decision.userId === userId &&
      decision.stage === "title_abstract" &&
      decision.isCurrent
  );
  const currentDecisions = getCurrentTitleAbstractDecisions(state.decisions, projectId, studyId);
  const currentEvaluation = evaluateStage(
    "title_abstract",
    currentDecisions.map((decision) => decision.decisionValue),
    project.abstractRequiredVotes,
    project.maybePolicy
  );
  const isConflictCheckout = currentEvaluation.state === "conflict" || currentEvaluation.state === "needs_third_vote";
  if (previousDecision && !isConflictCheckout) {
    return false;
  }

  state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts).filter(
    (checkout) =>
      !(
        getScreeningCheckoutStage(checkout) === "title_abstract" &&
        checkout.projectId === projectId &&
        checkout.userId === userId
      )
  );

  const capacity = getTitleAbstractCheckoutCapacity(project, studyId, state.decisions);
  const activeStudyCheckouts = getEligibleStudyCheckouts(projectId, studyId, state.decisions, state.screeningCheckouts);
  if (capacity <= 0 || activeStudyCheckouts.length >= capacity) {
    return false;
  }

  const now = Date.now();
  state.screeningCheckouts.push({
    projectId,
    stage: "title_abstract",
    checkoutId: createId("checkout"),
    studyId,
    userId,
    checkedOutAt: new Date(now).toISOString(),
    expiresAt: new Date(now + getCheckoutTtlMs("title_abstract", state.checkoutWindowSettings)).toISOString()
  });
  return true;
}

function acquireNextTitleAbstractCheckoutForUser(state: PersistedState, project: ReviewProject, userId: string) {
  const projectStudies = state.studies
    .filter((study) => study.projectId === project.id && study.stage === "title_abstract")
    .slice()
    .sort(compareStudiesByImportItemId);
  const orderedCandidates = randomizeReviewQueueItems(projectStudies, {
    projectId: project.id,
    currentUserId: userId,
    phase: "title_abstract"
  });

  for (const study of orderedCandidates) {
    if (acquireTitleAbstractCheckoutForUser(state, project, study.id, userId)) {
      return study.id;
    }
  }
  return null;
}

export function updateScreeningCheckoutForUser(
  userId: string,
  input: {
    projectId?: string;
    studyId?: string;
    reportId?: string;
    templateId?: string;
    checkoutId?: string;
    stage?: string;
    action?: string;
  }
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const projectId = input.projectId ?? "";
  const stage = input.stage === "extraction" ? "extraction" : input.stage === "full_text" ? "full_text" : "title_abstract";
  const action = input.action === "release" ? "release" : "acquire";
  const checkoutId = input.checkoutId?.trim() || "";
  const project = requireProjectMember(state, projectId, userId);

  if (stage === "extraction") {
    const reportId = input.reportId ?? "";
    const templateId = input.templateId ?? "";
    const template = state.extractionTemplates.find(
      (candidate) => candidate.id === templateId && candidate.projectId === projectId && candidate.isActive
    );
    if (!template) {
      throw new ApiError("Create an active data template before extracting study data.", 404);
    }

    const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === projectId);
    const study = state.studies.find((candidate) => candidate.id === report?.studyId && candidate.projectId === projectId);
    if (!report || !study) {
      throw new ApiError("Choose an included report before extracting study data.", 404);
    }
    if (study.stage !== "extraction") {
      throw new ApiError("Data extraction is available only after full-text inclusion.");
    }

    state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts).filter(
      (checkout) =>
        !(
          getScreeningCheckoutStage(checkout) === "extraction" &&
          checkout.projectId === projectId &&
          checkout.reportId === reportId &&
          checkout.templateId === template.id &&
          checkout.userId === userId &&
          (action !== "release" || !checkoutId || checkout.checkoutId === checkoutId)
        )
    );

    if (action === "release") {
      writeState(state);
      return buildPayload(state, userId);
    }

    const existingResponse = state.extractionResponses.find(
      (response) =>
        response.projectId === projectId &&
        response.reportId === reportId &&
        response.templateId === template.id &&
        response.userId === userId &&
        response.isSubmitted
    );
    if (existingResponse) {
      writeState(state);
      return {
        ...buildPayload(state, userId),
        message: "You have already submitted extraction data for this report."
      };
    }

    const capacity = getExtractionCheckoutCapacity(project, reportId, template.id, state.extractionResponses);
    const activeExtractionCheckouts = getEligibleExtractionCheckouts(
      projectId,
      reportId,
      template.id,
      state.extractionResponses,
      state.screeningCheckouts
    );
    if (capacity <= 0 || activeExtractionCheckouts.length >= capacity) {
      writeState(state);
      return {
        ...buildPayload(state, userId),
        message: "This report is already checked out by enough extraction reviewers."
      };
    }

    const now = Date.now();
    state.screeningCheckouts.push({
      projectId,
      stage: "extraction",
      checkoutId: checkoutId || createId("checkout"),
      studyId: report.studyId,
      reportId,
      templateId: template.id,
      userId,
      checkedOutAt: new Date(now).toISOString(),
      expiresAt: new Date(now + getCheckoutTtlMs("extraction", state.checkoutWindowSettings)).toISOString()
    });
    writeState(state);
    return buildPayload(state, userId);
  }

  if (stage === "full_text") {
    const reportId = input.reportId ?? "";
    const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === projectId);
    if (!report) {
      throw new ApiError("Report not found.", 404);
    }

    state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts).filter(
      (checkout) =>
        !(
          getScreeningCheckoutStage(checkout) === "full_text" &&
          checkout.projectId === projectId &&
          checkout.reportId === reportId &&
          checkout.userId === userId &&
          (action !== "release" || !checkoutId || checkout.checkoutId === checkoutId)
        )
    );

    if (action === "release") {
      writeState(state);
      return buildPayload(state, userId);
    }

    const previousDecision = state.decisions.find(
      (decision) =>
        decision.projectId === projectId &&
        decision.reportId === reportId &&
        decision.userId === userId &&
        decision.stage === "full_text" &&
        decision.isCurrent
    );
    const currentDecisions = getCurrentFullTextDecisions(state.decisions, projectId, reportId);
    const requiredVotes = report.fullTextRequiredVotes ?? project.fullTextRequiredVotes;
    const currentEvaluation = evaluateStage(
      "full_text",
      currentDecisions.map((decision) => decision.decisionValue),
      requiredVotes,
      project.maybePolicy
    );
    const isConflictCheckout = currentEvaluation.state === "conflict" || currentEvaluation.state === "needs_third_vote";
    if (previousDecision && !isConflictCheckout) {
      writeState(state);
      return {
        ...buildPayload(state, userId),
        message: "You have already voted on this report."
      };
    }

    const capacity = getFullTextCheckoutCapacity(project, report, state.decisions);
    const activeReportCheckouts = getEligibleReportCheckouts(projectId, reportId, state.decisions, state.screeningCheckouts);
    if (capacity <= 0 || activeReportCheckouts.length >= capacity) {
      writeState(state);
      return {
        ...buildPayload(state, userId),
        message: "This report is already checked out by enough reviewers."
      };
    }

    const now = Date.now();
    state.screeningCheckouts.push({
      projectId,
      stage: "full_text",
      checkoutId: checkoutId || createId("checkout"),
      studyId: report.studyId,
      reportId,
      userId,
      checkedOutAt: new Date(now).toISOString(),
      expiresAt: new Date(now + getCheckoutTtlMs("full_text", state.checkoutWindowSettings)).toISOString()
    });
    writeState(state);
    return buildPayload(state, userId);
  }

  const studyId = input.studyId ?? "";
  const study = state.studies.find((candidate) => candidate.id === studyId && candidate.projectId === projectId);
  if (!study) {
    throw new ApiError("Citation entry not found.", 404);
  }
  if (getConfirmedDuplicateStudyIds(state, projectId).has(studyId)) {
    writeState(state);
    return {
      ...buildPayload(state, userId),
      message: "This citation has been confirmed as a duplicate."
    };
  }

  state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts).filter(
    (checkout) =>
      !(
          getScreeningCheckoutStage(checkout) === "title_abstract" &&
          checkout.projectId === projectId &&
          checkout.studyId === studyId &&
          checkout.userId === userId &&
          (action !== "release" || !checkoutId || checkout.checkoutId === checkoutId)
        )
    );

  if (action === "release") {
    writeState(state);
    return buildPayload(state, userId);
  }

  const previousDecision = state.decisions.find(
    (decision) =>
      decision.projectId === projectId &&
      decision.studyId === studyId &&
      decision.userId === userId &&
      decision.stage === "title_abstract" &&
      decision.isCurrent
  );
  const currentDecisions = getCurrentTitleAbstractDecisions(state.decisions, projectId, studyId);
  const currentEvaluation = evaluateStage(
    "title_abstract",
    currentDecisions.map((decision) => decision.decisionValue),
    project.abstractRequiredVotes,
    project.maybePolicy
  );
  const isConflictCheckout = currentEvaluation.state === "conflict" || currentEvaluation.state === "needs_third_vote";
  if (previousDecision && !isConflictCheckout) {
    writeState(state);
    return {
      ...buildPayload(state, userId),
      message: "You have already voted on this citation."
    };
  }

  const capacity = getTitleAbstractCheckoutCapacity(project, studyId, state.decisions);
  const activeStudyCheckouts = getEligibleStudyCheckouts(projectId, studyId, state.decisions, state.screeningCheckouts);
  if (capacity <= 0 || activeStudyCheckouts.length >= capacity) {
    writeState(state);
    return {
      ...buildPayload(state, userId),
      message: "This citation is already checked out by enough reviewers."
    };
  }

  const now = Date.now();
  state.screeningCheckouts.push({
    projectId,
    stage: "title_abstract",
    checkoutId: checkoutId || createId("checkout"),
    studyId,
    userId,
    checkedOutAt: new Date(now).toISOString(),
    expiresAt: new Date(now + getCheckoutTtlMs("title_abstract", state.checkoutWindowSettings)).toISOString()
  });
  writeState(state);
  return buildPayload(state, userId);
}

export function getReportsForProjectForUser(userId: string, projectId: string) {
  const state = readState();
  requireProjectMember(state, projectId, userId);
  return state.reports.filter((report) => report.projectId === projectId);
}

export function getConsensusExtractionCsvForUser(userId: string, projectId: string) {
  const state = readState();
  const currentUser = getUser(state, userId);
  const project = requireProjectMember(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const template = state.extractionTemplates.find((candidate) => candidate.projectId === projectId && candidate.isActive);
  if (!template) {
    throw new ApiError("Create and activate an extraction template before exporting CSV.", 404);
  }

  const includedStudies = state.studies.filter((study) => study.projectId === projectId && study.stage === "extraction");
  if (includedStudies.length === 0) {
    throw new ApiError("No included studies are ready for extraction export.", 400);
  }

  const includedStudyIds = new Set(includedStudies.map((study) => study.id));
  const includedReports = state.reports.filter((report) => report.projectId === projectId && includedStudyIds.has(report.studyId));
  if (includedReports.length === 0) {
    throw new ApiError("No included reports are ready for extraction export.", 400);
  }

  const fieldsWithHeaders = buildConsensusFieldHeaders(template.fields);
  const metadataHeaders = ["study_id", "report_id", "import_item_id", "study_title", "journal", "year", "doi"];
  const headers = [...metadataHeaders, ...fieldsWithHeaders.map((field) => field.header)];
  const rows: string[][] = [];
  let unresolvedReports = 0;

  for (const report of includedReports) {
    const study = includedStudies.find((candidate) => candidate.id === report.studyId);
    if (!study) {
      continue;
    }

    const draft = buildExtractionConsensusDraft(state, project, report.id, template);
    if (!draft) {
      unresolvedReports += 1;
      continue;
    }

    const finalizedConsensus = state.extractionConsensus.find(
      (consensus) =>
        consensus.projectId === projectId &&
        consensus.reportId === report.id &&
        consensus.templateId === template.id &&
        consensus.status === "finalized"
    );
    const finalizedAt = Date.parse(finalizedConsensus?.finalizedAt ?? "");
    const consensusIsCurrent = Boolean(finalizedConsensus && Number.isFinite(finalizedAt) && finalizedAt >= draft.latestSubmittedAt);
    if (!consensusIsCurrent || !finalizedConsensus) {
      unresolvedReports += 1;
      continue;
    }

    const consensusValues = fieldsWithHeaders.map((field) => formatNormalizedExtractionValue(normalizeExtractionResponseValue(finalizedConsensus.resolvedValues[field.id])));

    rows.push([
      study.id,
      report.id,
      Number.isInteger(study.importItemId) ? String(study.importItemId) : "",
      study.title,
      study.journal,
      study.year > 0 ? String(study.year) : "",
      study.doi,
      ...consensusValues
    ]);
  }

  if (rows.length === 0) {
    throw new ApiError(
      "No consensus extraction records are exportable yet. Resolve extraction discrepancies and ensure required votes are submitted.",
      400
    );
  }

  const csv = toCsv([headers, ...rows]);
  const fileName = `${slugify(project.title) || project.id}-consensus-extraction-${new Date().toISOString().slice(0, 10)}.csv`;
  appendEvent(state, currentUser.name, `Exported consensus extraction CSV (${rows.length} studies)`, projectId);
  writeState(state);

  return {
    fileName,
    csv,
    exportedRows: rows.length,
    unresolvedReports
  };
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
  if (decisionValue && !["include", "exclude"].includes(decisionValue)) {
    throw new ApiError("A full-text decision must be include or exclude.");
  }
  if (decisionValue === "exclude" && !input.exclusionReasonId?.trim()) {
    throw new ApiError("Choose an exclusion reason for a full-text exclusion.");
  }
  if (decisionValue === "exclude" && project.exclusionReasons.length === 0) {
    throw new ApiError("No exclusion reasons set for this project.");
  }
  if (decisionValue === "exclude" && input.exclusionReasonId && !project.exclusionReasons.includes(input.exclusionReasonId.trim())) {
    throw new ApiError("Choose a valid project exclusion reason.");
  }

  let previousFullTextDecision: Decision | undefined;
  if (decisionValue) {
    state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts);
    previousFullTextDecision = state.decisions.find(
      (decision) =>
        decision.projectId === projectId &&
        decision.reportId === reportId &&
        decision.userId === userId &&
        decision.stage === "full_text" &&
        decision.isCurrent
    );
    const currentDecisions = getCurrentFullTextDecisions(state.decisions, projectId, reportId);
    const requiredVotes = report.fullTextRequiredVotes ?? project.fullTextRequiredVotes;
    const currentEvaluation = evaluateStage(
      "full_text",
      currentDecisions.map((decision) => decision.decisionValue),
      requiredVotes,
      project.maybePolicy
    );
    const canAcceptAdditionalVote = currentEvaluation.state === "conflict" || currentEvaluation.state === "needs_third_vote";
    if (!previousFullTextDecision && currentDecisions.length >= requiredVotes && !canAcceptAdditionalVote) {
      throw new ApiError("This report already has the required independent full-text votes.");
    }
    const hasActiveCheckout = state.screeningCheckouts.some(
      (checkout) =>
        getScreeningCheckoutStage(checkout) === "full_text" &&
        checkout.projectId === projectId &&
        checkout.reportId === reportId &&
        checkout.userId === userId
    );
    if (!previousFullTextDecision && !hasActiveCheckout) {
      const checkoutCapacity = getFullTextCheckoutCapacity(project, report, state.decisions);
      const activeReportCheckouts = getEligibleReportCheckouts(projectId, reportId, state.decisions, state.screeningCheckouts);
      if (checkoutCapacity <= 0 || activeReportCheckouts.length >= checkoutCapacity) {
        throw new ApiError("This report is no longer checked out to you. Open the next active report to continue.");
      }

      // Re-acquire checkout atomically here so immediate votes after page open do not fail on timing races.
      const now = Date.now();
      state.screeningCheckouts.push({
        projectId,
        stage: "full_text",
        studyId: report.studyId,
        reportId,
        userId,
        checkedOutAt: new Date(now).toISOString(),
        expiresAt: new Date(now + getCheckoutTtlMs("full_text", state.checkoutWindowSettings)).toISOString()
      });
    }
  }

  state.reports = state.reports.map((candidate) =>
    candidate.id === reportId && candidate.projectId === projectId
      ? {
          ...candidate,
          retrievalStatus: nextRetrievalStatus
        }
      : candidate
  );

  if (decisionValue) {
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
      supersedesDecisionId: previousFullTextDecision?.id,
      createdAt: new Date().toLocaleString()
    };
    state.decisions = [
      ...state.decisions.map((decision) =>
        previousFullTextDecision && decision.id === previousFullTextDecision.id ? { ...decision, isCurrent: false } : decision
      ),
      nextDecision
    ];
    state.screeningCheckouts = state.screeningCheckouts.filter(
      (checkout) =>
        !(
          getScreeningCheckoutStage(checkout) === "full_text" &&
          checkout.projectId === projectId &&
          checkout.reportId === reportId &&
          checkout.userId === userId
        )
    );
    appendEvent(state, currentUser.name, `Full-text ${formatDecision(decisionValue)}`, reportId);
    syncStudyAfterFullTextDecision(state, project, reportId);
  } else if (input.retrievalStatus && isRetrievalStatus(input.retrievalStatus)) {
    appendEvent(state, currentUser.name, `Updated retrieval status to ${formatRetrievalStatus(nextRetrievalStatus)}`, reportId);
  }

  syncProjectWorkflowCounts(state, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export async function uploadReportPdfForUser(
  userId: string,
  projectId: string,
  reportId: string,
  input: { fileName?: string; mimeType?: string; size?: number; contentBase64?: string }
): Promise<AppMutationPayload> {
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

  assertPdfInputWithinSizeLimit(input.contentBase64 ?? "", state.checkoutWindowSettings, input.size);
  const buffer = Buffer.from(input.contentBase64 ?? "", "base64");
  await storeReportPdfBuffer(state, projectId, reportId, {
    buffer,
    declaredSize: input.size,
    fileName,
    mimeType,
    uploadedByUserId: currentUser.id,
    uploadedByUserName: currentUser.name,
    successNote: "PDF uploaded."
  });

  appendEvent(state, currentUser.name, `Uploaded PDF ${fileName}`, reportId);
  syncProjectWorkflowCounts(state, projectId);
  writeState(state);
  return buildPayload(state, userId);
}

export async function getReportPdfForUser(userId: string, projectId: string, reportId: string) {
  const state = readState();
  requireProjectMember(state, projectId, userId);
  const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === projectId);
  if (!report) {
    throw new ApiError("Report not found.", 404);
  }
  const storedPdf = await pdfStorage.readPdf({ report, projectId, reportId });
  if (!storedPdf) {
    throw new ApiError("PDF file is not available for this report.", 404);
  }

  const storagePath = storedPdf.storagePath;
  if (storagePath !== report.storagePath) {
    state.reports = state.reports.map((candidate) =>
      candidate.id === reportId && candidate.projectId === projectId ? { ...candidate, storagePath } : candidate
    );
    writeState(state);
  }

  return {
    buffer: storedPdf.buffer,
    fileName: report.fileName || report.pdfName || "report.pdf",
    mimeType: report.mimeType || "application/pdf"
  };
}

export async function validateReportPdfForUser(userId: string, projectId: string, reportId: string): Promise<AppMutationPayload> {
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

  if (!report.fileName) {
    throw new ApiError("Upload a PDF before accepting it.");
  }

  const duplicate = report.checksum ? findDuplicateReportChecksum(state, projectId, reportId, report.checksum) : undefined;

  state.reports = state.reports.map((candidate) =>
    candidate.id === reportId && candidate.projectId === projectId
      ? {
          ...candidate,
          isPdfValidated: true,
          validationNotes: duplicate ? [`Duplicate PDF checksum also appears on ${duplicate.title}.`] : ["PDF uploaded."]
        }
      : candidate
  );

  appendEvent(state, currentUser.name, "Accepted uploaded PDF", reportId);
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

export function reopenTitleAbstractDecisionForUser(userId: string, projectId: string, studyId: string): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const project = requireProjectMember(state, projectId, userId);
  const study = state.studies.find((candidate) => candidate.id === studyId && candidate.projectId === projectId);
  if (!study) {
    throw new ApiError("Citation entry not found.", 404);
  }

  const currentDecision = state.decisions.find(
    (decision) =>
      decision.projectId === projectId &&
      decision.studyId === studyId &&
      decision.userId === userId &&
      decision.stage === "title_abstract" &&
      decision.isCurrent
  );
  if (!currentDecision) {
    throw new ApiError("No current screening decision was found for this citation.");
  }

  state.decisions = state.decisions.map((decision) =>
    decision.id === currentDecision.id ? { ...decision, isCurrent: false } : decision
  );
  state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts).filter(
    (checkout) =>
      !(
        getScreeningCheckoutStage(checkout) === "title_abstract" &&
        checkout.projectId === projectId &&
        checkout.studyId === studyId &&
        checkout.userId === userId
      )
  );

  appendEvent(state, currentUser.name, "Returned citation to title/abstract queue", studyId);
  syncStudyAfterTitleAbstractDecision(state, project, studyId, currentUser.name);
  writeState(state);
  return {
    ...buildPayload(state, userId),
    message: "Citation returned to the title/abstract queue."
  };
}

export function reopenFullTextDecisionForUser(userId: string, projectId: string, reportId: string): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const project = requireProjectMember(state, projectId, userId);
  const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === projectId);
  if (!report) {
    throw new ApiError("Report not found.", 404);
  }

  const currentDecision = state.decisions.find(
    (decision) =>
      decision.projectId === projectId &&
      decision.reportId === reportId &&
      decision.userId === userId &&
      decision.stage === "full_text" &&
      decision.isCurrent
  );
  if (!currentDecision) {
    throw new ApiError("No current full-text decision was found for this report.");
  }

  state.decisions = state.decisions.map((decision) =>
    decision.id === currentDecision.id ? { ...decision, isCurrent: false } : decision
  );
  state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts).filter(
    (checkout) =>
      !(
        getScreeningCheckoutStage(checkout) === "full_text" &&
        checkout.projectId === projectId &&
        checkout.reportId === reportId &&
        checkout.userId === userId
      )
  );

  appendEvent(state, currentUser.name, "Returned report to full-text queue", reportId);
  syncStudyAfterFullTextDecision(state, project, reportId);
  syncProjectWorkflowCounts(state, projectId);
  writeState(state);
  return {
    ...buildPayload(state, userId),
    message: "Report returned to the full-text queue."
  };
}

export function reopenExtractionResponseForUser(userId: string, projectId: string, reportId: string): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  requireProjectMember(state, projectId, userId);
  const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === projectId);
  if (!report) {
    throw new ApiError("Report not found.", 404);
  }

  const template = state.extractionTemplates.find((candidate) => candidate.projectId === projectId && candidate.isActive);
  if (!template) {
    throw new ApiError("No active data extraction template was found for this project.", 404);
  }

  const currentResponse = state.extractionResponses.find(
    (response) =>
      response.projectId === projectId &&
      response.reportId === reportId &&
      response.templateId === template.id &&
      response.userId === userId &&
      response.isSubmitted
  );
  if (!currentResponse) {
    throw new ApiError("No submitted extraction response was found for this report.");
  }

  const now = new Date().toISOString();
  state.extractionResponses = state.extractionResponses.map((response) =>
    response.id === currentResponse.id
      ? {
          ...response,
          isSubmitted: false,
          updatedAt: now,
          submittedAt: undefined
        }
      : response
  );
  state.screeningCheckouts = getActiveScreeningCheckouts(state.screeningCheckouts).filter(
    (checkout) =>
      !(
        getScreeningCheckoutStage(checkout) === "extraction" &&
        checkout.projectId === projectId &&
        checkout.reportId === reportId &&
        checkout.templateId === template.id &&
        checkout.userId === userId
      )
  );

  syncExtractionConsensusForReport(state, projectId, reportId, template.id);
  appendEvent(state, currentUser.name, "Returned extraction to queue", reportId);
  syncProjectWorkflowCounts(state, projectId);
  writeState(state);
  return {
    ...buildPayload(state, userId),
    message: "Extraction returned to the queue."
  };
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

  if (!["pending", "confirmed", "rejected", "auto_confirmed"].includes(status)) {
    throw new ApiError("Unknown duplicate candidate status.");
  }

  const existingCandidate = state.dedupCandidates.find((candidate) => candidate.id === candidateId);
  if (!existingCandidate) {
    throw new ApiError("Duplicate candidate not found.", 404);
  }
  const projectId = getDedupCandidateProjectId(existingCandidate);
  const project = requireProjectMember(state, projectId, userId);
  state.dedupCandidates = state.dedupCandidates.map((candidate) => {
    if (candidate.id !== candidateId) {
      return candidate;
    }
    return { ...candidate, projectId, status };
  });

  if (status === "confirmed" || status === "auto_confirmed") {
    const duplicateStudyId = existingCandidate.recordB.id;
    state.screeningCheckouts = state.screeningCheckouts.filter((checkout) => checkout.studyId !== duplicateStudyId);
  }
  syncProjectWorkflowCounts(state, project.id);

  appendEvent(
    state,
    currentUser.name,
    getDedupCandidateStatusEventLabel(status),
    candidateId
  );
  writeState(state);
  return buildPayload(state, userId);
}

function getDedupCandidateStatusEventLabel(status: DedupCandidate["status"]) {
  if (status === "confirmed" || status === "auto_confirmed") {
    return "Confirmed duplicate candidate";
  }
  if (status === "rejected") {
    return "Rejected duplicate candidate";
  }
  return "Reopened duplicate candidate";
}

export function rejectPendingDedupCandidatesForUser(userId: string, projectId: string): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const project = requireProjectMember(state, projectId, userId);
  const pendingCandidates = state.dedupCandidates.filter(
    (candidate) => isDedupCandidateForProject(candidate, projectId) && candidate.status === "pending"
  );

  if (pendingCandidates.length === 0) {
    return {
      ...buildPayload(state, userId),
      message: "No pending duplicate candidates to reject."
    };
  }

  const pendingCandidateIds = new Set(pendingCandidates.map((candidate) => candidate.id));
  state.dedupCandidates = state.dedupCandidates.map((candidate) =>
    pendingCandidateIds.has(candidate.id) ? { ...candidate, projectId, status: "rejected" } : candidate
  );
  syncProjectWorkflowCounts(state, project.id);
  appendEvent(
    state,
    currentUser.name,
    `Rejected ${pendingCandidates.length} duplicate ${pendingCandidates.length === 1 ? "candidate" : "candidates"}`,
    projectId
  );
  writeState(state);
  return {
    ...buildPayload(state, userId),
    message: `Rejected ${pendingCandidates.length} duplicate ${pendingCandidates.length === 1 ? "candidate" : "candidates"}.`
  };
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
    let transitionedToFullText = false;
    state.studies = state.studies.map((study) => {
      if (study.id !== studyId || study.projectId !== project.id) {
        return study;
      }
      // Only transition from title/abstract to full-text; never downgrade extraction studies during resync.
      transitionedToFullText = study.stage === "title_abstract";
      advancedStudy = transitionedToFullText ? { ...study, stage: "full_text" } : study;
      return advancedStudy;
    });
    if (advancedStudy) {
      upsertReportForStudy(state, project.id, advancedStudy, actor);
      if (transitionedToFullText) {
        appendEvent(state, actor, "Advanced study to full-text review", studyId);
      }
    }
  } else {
    const existingReport = state.reports.find((report) => report.projectId === project.id && report.studyId === studyId);
    const hasFullTextWork = existingReport
      ? state.decisions.some((decision) => decision.reportId === existingReport.id && decision.stage === "full_text")
      : false;
    if (existingReport && !hasFullTextWork) {
      const shouldKeepImportedPdf = Boolean(existingReport.sourcePdfUrl || existingReport.fileName);
      if (!shouldKeepImportedPdf) {
        state.reports = state.reports.filter((report) => report.id !== existingReport.id);
      }
      state.studies = state.studies.map((study) =>
        study.id === studyId && study.projectId === project.id && study.stage === "full_text" ? { ...study, stage: "title_abstract" } : study
      );
      appendEvent(state, actor, "Returned study to title/abstract screening", studyId);
    }
  }

  syncProjectWorkflowCounts(state, project.id);
}

function buildConsensusFieldHeaders(fields: ExtractionTemplateField[]) {
  const seenHeaders = new Set<string>();
  return fields.map((field, index) => {
    const base = slugify(field.title) || `field_${index + 1}`;
    let header = base;
    let suffix = 2;
    while (seenHeaders.has(header)) {
      header = `${base}_${suffix}`;
      suffix += 1;
    }
    seenHeaders.add(header);
    return {
      ...field,
      header
    };
  });
}

function buildExtractionConsensusDraft(state: PersistedState, project: ReviewProject, reportId: string, template: ExtractionTemplate) {
  const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === project.id);
  if (!report) {
    return undefined;
  }

  const study = state.studies.find((candidate) => candidate.id === report.studyId && candidate.projectId === project.id);
  if (!study || study.stage !== "extraction") {
    return undefined;
  }

  const submittedResponses = state.extractionResponses
    .filter(
      (response) =>
        response.projectId === project.id &&
        response.reportId === report.id &&
        response.templateId === template.id &&
        response.isSubmitted
    )
    .sort((left, right) => left.userId.localeCompare(right.userId));

  if (submittedResponses.length < project.extractionRequiredVotes) {
    return undefined;
  }

  const latestSubmittedAt = submittedResponses.reduce((latest, response) => {
    const candidateTime = Date.parse(response.submittedAt ?? response.updatedAt ?? "");
    if (!Number.isFinite(candidateTime)) {
      return latest;
    }
    return Math.max(latest, candidateTime);
  }, 0);

  const autoResolvedValues: Record<string, ExtractionResponseValue> = {};
  const flaggedFieldIds: string[] = [];

  for (const field of template.fields) {
    const normalizedValues = submittedResponses.map((response) => normalizeExtractionResponseValue(response.values[field.id]));
    const firstValue = normalizedValues[0];
    const firstSerialized = serializeNormalizedExtractionValue(firstValue);
    const isConsensus = normalizedValues.every((value) => serializeNormalizedExtractionValue(value) === firstSerialized);
    autoResolvedValues[field.id] = firstValue;
    if (!isConsensus) {
      flaggedFieldIds.push(field.id);
    }
  }

  const sourceFingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        reportId,
        templateId: template.id,
        reviewerPayload: submittedResponses.map((response) => ({
          id: response.id,
          userId: response.userId,
          values: Object.fromEntries(
            template.fields.map((field) => [field.id, normalizeExtractionResponseValue(response.values[field.id])])
          )
        }))
      })
    )
    .digest("hex");

  return {
    report,
    study,
    template,
    reviewerResponseIds: submittedResponses.map((response) => response.id),
    sourceFingerprint,
    flaggedFieldIds,
    autoResolvedValues,
    latestSubmittedAt
  };
}

function syncExtractionConsensusForReport(state: PersistedState, projectId: string, reportId: string, templateId: string) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  const template = state.extractionTemplates.find(
    (candidate) => candidate.projectId === projectId && candidate.id === templateId && candidate.isActive
  );
  if (!project || !template) {
    state.extractionConsensus = state.extractionConsensus.filter(
      (consensus) => !(consensus.projectId === projectId && consensus.reportId === reportId && consensus.templateId === templateId)
    );
    return;
  }

  const draft = buildExtractionConsensusDraft(state, project, reportId, template);
  const existing = state.extractionConsensus.find(
    (consensus) => consensus.projectId === projectId && consensus.reportId === reportId && consensus.templateId === template.id
  );

  if (!draft) {
    state.extractionConsensus = state.extractionConsensus.filter((consensus) => consensus.id !== existing?.id);
    return;
  }

  const now = new Date().toISOString();
  const hasConflicts = draft.flaggedFieldIds.length > 0;
  const existingFinalizedAt = Date.parse(existing?.finalizedAt ?? "");
  const canKeepExistingFinalization = Boolean(
    existing &&
      existing.status === "finalized" &&
      Number.isFinite(existingFinalizedAt) &&
      existingFinalizedAt >= draft.latestSubmittedAt
  );
  const status: ExtractionConsensus["status"] = hasConflicts
    ? canKeepExistingFinalization
      ? "finalized"
      : "pending"
    : "finalized";

  const mergedValues = {
    ...draft.autoResolvedValues,
    ...(existing?.resolvedValues ?? {})
  };
  let resolvedValues: Record<string, ExtractionResponseValue>;
  try {
    resolvedValues = validateExtractionValues(template, mergedValues);
  } catch {
    resolvedValues = validateExtractionValues(template, draft.autoResolvedValues);
  }

  const finalizedBySystem = !hasConflicts;
  const nextConsensus: ExtractionConsensus = {
    id: existing?.id ?? createId("consensus"),
    projectId,
    studyId: draft.study.id,
    reportId,
    templateId: template.id,
    requiredVotes: project.extractionRequiredVotes,
    reviewerResponseIds: draft.reviewerResponseIds,
    sourceFingerprint: draft.sourceFingerprint,
    flaggedFieldIds: draft.flaggedFieldIds,
    resolvedValues,
    status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    finalizedAt: status === "finalized" ? (canKeepExistingFinalization ? existing?.finalizedAt ?? now : now) : undefined,
    finalizedByUserId:
      status === "finalized"
        ? canKeepExistingFinalization
          ? existing?.finalizedByUserId
          : finalizedBySystem
            ? "system"
            : existing?.finalizedByUserId
        : undefined,
    finalizedByUserName:
      status === "finalized"
        ? canKeepExistingFinalization
          ? existing?.finalizedByUserName
          : finalizedBySystem
            ? "System"
            : existing?.finalizedByUserName
        : undefined
  };

  state.extractionConsensus = [
    ...state.extractionConsensus.filter((consensus) => consensus.id !== existing?.id),
    nextConsensus
  ];
}

function normalizeExtractionResponseValue(value: ExtractionResponseValue | undefined) {
  if (Array.isArray(value)) {
    return uniqueIds(value.map((entry) => entry.trim()).filter(Boolean)).sort((left, right) => left.localeCompare(right));
  }
  return (value ?? "").trim();
}

function serializeNormalizedExtractionValue(value: string | string[]) {
  return Array.isArray(value) ? JSON.stringify(value) : value;
}

function formatNormalizedExtractionValue(value: string | string[]) {
  return Array.isArray(value) ? value.join(" | ") : value;
}

function toCsv(rows: string[][]) {
  return `${rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\n")}\n`;
}

function escapeCsvCell(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
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

function createReportForStudy(projectId: string, study: Study, sourcePdfUrl?: string): Report {
  const pdfUrl = sourcePdfUrl?.trim() || "";
  const inferredPdfName = pdfUrl ? inferPdfFileName(pdfUrl, "", study.title) : "No PDF uploaded";
  return {
    id: createId("report"),
    projectId,
    studyId: study.id,
    title: study.title,
    citation: formatStudyCitation(study),
    retrievalStatus: pdfUrl ? "sought" : "not_sought",
    pdfName: inferredPdfName,
    fileName: "",
    mimeType: "",
    size: 0,
    checksum: "",
    storagePath: "",
    sourcePdfUrl: pdfUrl || undefined,
    isPdfValidated: false,
    validationNotes: pdfUrl ? ["PDF link found in imported citation; retrieval is pending."] : ["PDF has not been uploaded."],
    notes: 0
  };
}

function upsertReportForStudy(state: PersistedState, projectId: string, study: Study, actor: string) {
  const existing = state.reports.find((report) => report.projectId === projectId && report.studyId === study.id);
  if (existing) {
    if (study.pdfUrl && !existing.sourcePdfUrl) {
      state.reports = state.reports.map((report) =>
        report.id === existing.id && report.projectId === projectId ? { ...report, sourcePdfUrl: study.pdfUrl } : report
      );
      return { ...existing, sourcePdfUrl: study.pdfUrl };
    }
    return existing;
  }

  const report = createReportForStudy(projectId, study, study.pdfUrl);
  state.reports.unshift(report);
  appendEvent(state, actor, "Created full-text report", report.id);
  return report;
}

async function retrieveImportedPdfReports(
  state: PersistedState,
  projectId: string,
  importId: string,
  reports: Report[],
  user: Pick<AppUser, "id" | "name">
) {
  const results = await mapWithConcurrency(
    reports.filter((report) => report.sourcePdfUrl),
    pdfRetrievalConcurrency,
    (report) => retrievePdfForReportFromUrl(state, projectId, report.id, report.sourcePdfUrl ?? "", user)
  );
  const retrieved = results.filter(Boolean).length;
  const failed = results.length - retrieved;

  state.imports = state.imports.map((batch) =>
    batch.id === importId && batch.projectId === projectId
      ? {
          ...batch,
          pdfsRetrieved: retrieved,
          pdfRetrievalFailures: failed
        }
      : batch
  );
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(items[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function retrievePdfForReportFromUrl(
  state: PersistedState,
  projectId: string,
  reportId: string,
  pdfUrl: string,
  user: Pick<AppUser, "id" | "name">
) {
  const report = state.reports.find((candidate) => candidate.id === reportId && candidate.projectId === projectId);
  if (!report) {
    return false;
  }

  try {
    const remotePdf = await fetchRemotePdf(pdfUrl, report.title, state.checkoutWindowSettings);
    await storeReportPdfBuffer(state, projectId, reportId, {
      buffer: remotePdf.buffer,
      fileName: remotePdf.fileName,
      mimeType: remotePdf.mimeType,
      uploadedByUserId: user.id,
      uploadedByUserName: user.name,
      successNote: "PDF retrieved from imported citation link."
    });
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "PDF retrieval failed.";
    state.reports = state.reports.map((candidate) =>
      candidate.id === reportId && candidate.projectId === projectId
        ? {
            ...candidate,
            retrievalStatus: "sought",
            sourcePdfUrl: pdfUrl,
            isPdfValidated: false,
            validationNotes: [`PDF retrieval failed: ${errorMessage}`, `Source: ${pdfUrl}`]
          }
        : candidate
    );
    return false;
  }
}

async function storeReportPdfBuffer(
  state: PersistedState,
  projectId: string,
  reportId: string,
  input: {
    buffer: Buffer;
    declaredSize?: number;
    fileName: string;
    mimeType: string;
    uploadedByUserId: string;
    uploadedByUserName: string;
    successNote: string;
  }
) {
  const fileName = sanitizePdfFileName(input.fileName);
  const mimeType = input.mimeType || "application/pdf";
  validatePdfBuffer(input.buffer, state.checkoutWindowSettings, input.declaredSize);
  const checksum = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const storagePath = pdfStorage.buildStoragePath({ projectId, reportId, checksum, fileName });
  await pdfStorage.writePdf(storagePath, input.buffer, { checksum, fileName, projectId, reportId });

  const duplicate = findDuplicateReportChecksum(state, projectId, reportId, checksum);
  state.reports = state.reports.map((candidate) =>
    candidate.id === reportId && candidate.projectId === projectId
      ? {
          ...candidate,
          retrievalStatus: "retrieved",
          pdfName: fileName,
          fileName,
          mimeType,
          size: input.buffer.length,
          checksum,
          storagePath,
          uploadedByUserId: input.uploadedByUserId,
          uploadedByUserName: input.uploadedByUserName,
          isPdfValidated: true,
          validationNotes: duplicate ? [`Duplicate PDF checksum also appears on ${duplicate.title}.`] : [input.successNote]
        }
      : candidate
  );
}

function syncProjectWorkflowCounts(state: PersistedState, projectId: string) {
  const confirmedDuplicateStudyIds = getConfirmedDuplicateStudyIds(state, projectId);
  const reports = getWorkflowReportsForProject(state, projectId).filter((report) => !confirmedDuplicateStudyIds.has(report.studyId));
  const screenedStudyIds = new Set(
    state.decisions
      .filter(
        (decision) =>
          decision.projectId === projectId &&
          decision.stage === "title_abstract" &&
          decision.isCurrent &&
          !confirmedDuplicateStudyIds.has(decision.studyId)
      )
      .map((decision) => decision.studyId)
  );
  const includedStudyIds = new Set(
    state.studies
      .filter((study) => study.projectId === projectId && study.stage === "extraction" && !confirmedDuplicateStudyIds.has(study.id))
      .map((study) => study.id)
  );
  const includedStudies = includedStudyIds.size;
  const includedReports = reports.filter((report) => includedStudyIds.has(report.studyId));

  state.projects = state.projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    const activeExtractionTemplate = state.extractionTemplates.find(
      (template) => template.projectId === project.id && template.isActive
    );

    if (activeExtractionTemplate) {
      for (const report of reports) {
        syncExtractionConsensusForReport(state, project.id, report.id, activeExtractionTemplate.id);
      }
    }

    const extractionReadyForCompletion =
      includedStudies > 0 &&
      Boolean(activeExtractionTemplate) &&
      includedReports.every((report) => {
        if (!activeExtractionTemplate) {
          return false;
        }

        const draft = buildExtractionConsensusDraft(state, project, report.id, activeExtractionTemplate);
        if (!draft) {
          return false;
        }

        const finalizedConsensus = state.extractionConsensus.find(
          (consensus) =>
            consensus.projectId === project.id &&
            consensus.reportId === report.id &&
            consensus.templateId === activeExtractionTemplate.id &&
            consensus.status === "finalized"
        );
        const finalizedAt = Date.parse(finalizedConsensus?.finalizedAt ?? "");
        return Boolean(finalizedConsensus && Number.isFinite(finalizedAt) && finalizedAt >= draft.latestSubmittedAt);
      });

    const conflictCount = countProjectWorkflowConflicts(state, project);
    return {
      ...project,
      status: project.status === "archived" ? "archived" : reports.length > 0 || screenedStudyIds.size > 0 || project.recordsTotal > 0 ? "active" : "draft",
      stage: extractionReadyForCompletion
        ? "complete"
        : includedStudies > 0
          ? "extraction"
          : reports.length > 0
            ? "full_text"
            : project.recordsTotal > 0
              ? "screening"
              : "import",
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
    const activeExtractionTemplate = state.extractionTemplates.find(
      (template) => template.projectId === project.id && template.isActive
    );
    if (activeExtractionTemplate) {
      for (const report of projectReports) {
        syncExtractionConsensusForReport(state, project.id, report.id, activeExtractionTemplate.id);
      }
    } else {
      state.extractionConsensus = state.extractionConsensus.filter((consensus) => consensus.projectId !== project.id);
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

  const fullTextConflicts = getWorkflowReportsForProject(state, project.id).filter((report) => {
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

const dedupStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with"
]);

function buildImportWarningMessages(studies: Study[]) {
  return studies
    .slice()
    .sort(compareStudiesByImportItemId)
    .flatMap((study, index) => {
      const recordNumber = study.importItemId ?? index + 1;
      return (study.parserWarnings ?? []).map((warning) => `Record ${recordNumber}: ${warning}`);
    });
}

function compareStudiesByImportItemId(left: Study, right: Study) {
  const leftOrder = left.importItemId ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.importItemId ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return left.id.localeCompare(right.id);
}

function getDedupCandidateProjectId(candidate: DedupCandidate) {
  return candidate.projectId ?? candidate.recordA.projectId ?? candidate.recordB.projectId ?? "demo-review";
}

function isDedupCandidateForProject(candidate: DedupCandidate, projectId: string) {
  return getDedupCandidateProjectId(candidate) === projectId;
}

function getConfirmedDuplicateStudyIds(state: PersistedState, projectId: string) {
  return new Set(
    state.dedupCandidates
      .filter(
        (candidate) =>
          isDedupCandidateForProject(candidate, projectId) &&
          (candidate.status === "confirmed" || candidate.status === "auto_confirmed")
      )
      .map((candidate) => candidate.recordB.id)
  );
}

function syncDedupCandidatesForProject(state: PersistedState, projectId: string) {
  const projectStudies = state.studies
    .filter((study) => study.projectId === projectId)
    .slice()
    .sort(compareStudiesByImportItemId);
  const existingByPair = new Map(
    state.dedupCandidates
      .filter((candidate) => isDedupCandidateForProject(candidate, projectId))
      .map((candidate) => [dedupPairKey(candidate.recordA.id, candidate.recordB.id), candidate])
  );
  const pairKeys = collectDedupPairKeys(projectStudies);
  const generatedCandidates = Array.from(pairKeys)
    .map((pairKey) => {
      const [leftId, rightId] = pairKey.split("|");
      const left = projectStudies.find((study) => study.id === leftId);
      const right = projectStudies.find((study) => study.id === rightId);
      if (!left || !right) {
        return null;
      }
      return buildDedupCandidate(projectId, left, right, existingByPair.get(pairKey));
    })
    .filter((candidate): candidate is DedupCandidate => Boolean(candidate));

  state.dedupCandidates = [
    ...state.dedupCandidates.filter((candidate) => !isDedupCandidateForProject(candidate, projectId)),
    ...generatedCandidates
  ];
}

function collectDedupPairKeys(studies: Study[]) {
  const pairKeys = new Set<string>();
  const addGroupPairs = (group: Study[]) => {
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        pairKeys.add(dedupPairKey(group[leftIndex].id, group[rightIndex].id));
      }
    }
  };

  const doiGroups = new Map<string, Study[]>();
  const exactTitleGroups = new Map<string, Study[]>();
  const authorYearGroups = new Map<string, Study[]>();
  for (const study of studies) {
    const doi = normalizeDoi(study.doi);
    if (doi) {
      doiGroups.set(doi, [...(doiGroups.get(doi) ?? []), study]);
    }
    const titleKey = normalizeTitleTokens(study.title).join(" ");
    if (titleKey) {
      exactTitleGroups.set(titleKey, [...(exactTitleGroups.get(titleKey) ?? []), study]);
    }
    const authorYearKey = `${normalizeFirstAuthor(study)}:${study.year > 0 ? study.year : "unknown"}`;
    if (authorYearKey.length > 9) {
      authorYearGroups.set(authorYearKey, [...(authorYearGroups.get(authorYearKey) ?? []), study]);
    }
  }

  for (const group of doiGroups.values()) {
    addGroupPairs(group);
  }
  for (const group of exactTitleGroups.values()) {
    addGroupPairs(group);
  }

  if (studies.length <= 1200) {
    addGroupPairs(studies);
  } else {
    for (const group of authorYearGroups.values()) {
      if (group.length <= 120) {
        addGroupPairs(group);
      }
    }
  }

  return pairKeys;
}

function buildDedupCandidate(projectId: string, left: Study, right: Study, existingCandidate?: DedupCandidate): DedupCandidate | null {
  const [recordA, recordB] = orderDedupRecords(left, right);
  const doiA = normalizeDoi(recordA.doi);
  const doiB = normalizeDoi(recordB.doi);
  const titleScore = similarityFromTokens(normalizeTitleTokens(recordA.title), normalizeTitleTokens(recordB.title));
  const authorScore = similarityFromTokens(normalizeAuthorTokens(recordA), normalizeAuthorTokens(recordB));
  const yearScore = recordA.year > 0 && recordA.year === recordB.year ? 1 : 0;
  const doiMatch = Boolean(doiA && doiB && doiA === doiB);
  const exactMetadataMatch = doiMatch && titleScore === 1 && authorScore === 1 && yearScore === 1;
  const weightedScore = doiMatch
    ? exactMetadataMatch
      ? 1
      : Math.max(0.94, Math.min(0.995, 0.82 + titleScore * 0.1 + authorScore * 0.05 + yearScore * 0.025))
    : titleScore * 0.7 + authorScore * 0.2 + yearScore * 0.1;

  if (!doiMatch && (weightedScore < 0.82 || titleScore < 0.68)) {
    return null;
  }

  const notes = [
    doiMatch ? "Normalized DOI match" : "",
    authorScore >= 0.95 ? "Same first author" : authorScore >= 0.55 ? "Similar first author" : "",
    yearScore === 1 ? "Same year" : "",
    titleScore === 1 ? "Exact title" : titleScore >= 0.95 ? "Near-identical title" : titleScore >= 0.68 ? "Similar title" : ""
  ].filter(Boolean);

  return {
    id: existingCandidate?.id ?? createDedupCandidateId(projectId, recordA.id, recordB.id),
    projectId,
    recordA: cloneStudyForDedup(recordA),
    recordB: cloneStudyForDedup(recordB),
    score: Math.round(weightedScore * 1000) / 1000,
    method: exactMetadataMatch ? "Exact DOI + citation metadata" : doiMatch ? "Normalized DOI + citation metadata" : "Fuzzy title + first author + year",
    status: existingCandidate?.status ?? "pending",
    explanation: {
      title: Math.round(titleScore * 100) / 100,
      author: Math.round(authorScore * 100) / 100,
      year: yearScore,
      doi: doiMatch ? "Normalized DOI match" : doiA || doiB ? "Different DOI values" : "No DOI on candidate records",
      notes: notes.length > 0 ? notes : ["Metadata similarity exceeded duplicate-review threshold"]
    }
  };
}

function orderDedupRecords(left: Study, right: Study): [Study, Study] {
  return compareStudiesByImportItemId(left, right) <= 0 ? [left, right] : [right, left];
}

function dedupPairKey(leftId: string, rightId: string) {
  return [leftId, rightId].sort((left, right) => left.localeCompare(right)).join("|");
}

function createDedupCandidateId(projectId: string, leftId: string, rightId: string) {
  const hash = crypto.createHash("sha1").update(`${projectId}:${dedupPairKey(leftId, rightId)}`).digest("hex").slice(0, 12);
  return `dup-${hash}`;
}

function cloneStudyForDedup(study: Study): Study {
  return {
    ...study,
    authors: [...study.authors],
    keywords: [...study.keywords],
    parserWarnings: study.parserWarnings ? [...study.parserWarnings] : undefined
  };
}

function normalizeTitleTokens(title: string) {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !dedupStopWords.has(token));
}

function normalizeFirstAuthor(study: Study) {
  return (study.authors[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeAuthorTokens(study: Study) {
  return normalizeFirstAuthor(study).split(/\s+/).filter(Boolean);
}

function similarityFromTokens(leftTokens: string[], rightTokens: string[]) {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const rightTokenCounts = new Map<string, number>();
  for (const token of rightTokens) {
    rightTokenCounts.set(token, (rightTokenCounts.get(token) ?? 0) + 1);
  }
  let overlap = 0;
  for (const token of leftTokens) {
    const count = rightTokenCounts.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightTokenCounts.set(token, count - 1);
    }
  }
  return (2 * overlap) / (leftTokens.length + rightTokens.length);
}

function syncImportBatchAfterStudyChange(state: PersistedState, projectId: string, importId: string, refreshWarnings: boolean) {
  const batchStudies = state.studies.filter((study) => study.projectId === projectId && study.importBatchId === importId);
  state.imports = state.imports.map((batch) => {
    if (batch.id !== importId || batch.projectId !== projectId) {
      return batch;
    }

    const parserWarningMessages = refreshWarnings ? buildImportWarningMessages(batchStudies) : batch.parserWarningMessages ?? [];
    const parserWarnings = parserWarningMessages.length;
    const batchStudyIds = new Set(batchStudies.map((study) => study.id));
    const linkedReports = state.reports.filter((report) => report.projectId === projectId && batchStudyIds.has(report.studyId) && report.sourcePdfUrl);
    const pdfLinks = batchStudies.filter((study) => study.pdfUrl).length;
    const pdfsRetrieved = linkedReports.filter((report) => report.fileName && report.checksum).length;
    return {
      ...batch,
      records: batchStudies.length,
      parserWarnings,
      parserWarningMessages,
      pdfLinks,
      pdfsRetrieved,
      pdfRetrievalFailures: Math.max(pdfLinks - pdfsRetrieved, 0),
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
            avatarColor: user.avatarColor || "#42656d",
            websiteTheme: normalizeWebsiteTheme((user as { websiteTheme?: unknown }).websiteTheme)
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
      websiteTheme: "system",
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
    sourcePdfUrl: report.sourcePdfUrl ?? "",
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

function normalizeExtractionConsensus(consensus: Partial<ExtractionConsensus>): ExtractionConsensus {
  return {
    id: consensus.id || createId("consensus"),
    projectId: consensus.projectId || "",
    studyId: consensus.studyId || "",
    reportId: consensus.reportId || "",
    templateId: consensus.templateId || "",
    requiredVotes: typeof consensus.requiredVotes === "number" && Number.isFinite(consensus.requiredVotes) ? Math.max(1, Math.trunc(consensus.requiredVotes)) : 2,
    reviewerResponseIds: Array.isArray(consensus.reviewerResponseIds) ? uniqueIds(consensus.reviewerResponseIds.map(String)) : [],
    sourceFingerprint: typeof consensus.sourceFingerprint === "string" ? consensus.sourceFingerprint : "",
    flaggedFieldIds: Array.isArray(consensus.flaggedFieldIds) ? uniqueIds(consensus.flaggedFieldIds.map(String)) : [],
    resolvedValues: normalizeExtractionResolvedValues(consensus.resolvedValues),
    status: consensus.status === "finalized" ? "finalized" : "pending",
    createdAt: consensus.createdAt || new Date().toISOString(),
    updatedAt: consensus.updatedAt || new Date().toISOString(),
    finalizedAt: consensus.finalizedAt || undefined,
    finalizedByUserId: consensus.finalizedByUserId || undefined,
    finalizedByUserName: consensus.finalizedByUserName || undefined
  };
}

function normalizeExtractionResolvedValues(values: Partial<Record<string, unknown>> | undefined): Record<string, ExtractionResponseValue> {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(values).map(([fieldId, value]) => [
      fieldId,
      Array.isArray(value) ? uniqueIds(value.map((entry) => String(entry).trim()).filter(Boolean)) : String(value ?? "").trim()
    ])
  );
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

function validatePdfBuffer(buffer: Buffer, settings: AppCheckoutWindowSettings, declaredSize?: number) {
  const maxPdfSize = pdfUploadMaxSizeBytes(settings);
  if (buffer.length === 0) {
    throw new ApiError("PDF file is empty.");
  }
  if (buffer.length > maxPdfSize) {
    throw new ApiError(`PDF file must be ${settings.pdfUploadMaxSizeMb} MB or smaller.`);
  }
  if (typeof declaredSize === "number" && declaredSize > 0 && declaredSize !== buffer.length) {
    throw new ApiError("PDF upload size does not match the received file.");
  }
  if (buffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
    throw new ApiError("PDF header is not readable.");
  }
}

function assertPdfInputWithinSizeLimit(contentBase64: string, settings: AppCheckoutWindowSettings, declaredSize?: number) {
  const maxPdfSize = pdfUploadMaxSizeBytes(settings);
  if (typeof declaredSize === "number" && declaredSize > maxPdfSize) {
    throw new ApiError(`PDF file must be ${settings.pdfUploadMaxSizeMb} MB or smaller.`);
  }

  const maxBase64Length = Math.ceil(maxPdfSize / 3) * 4 + 4;
  if (contentBase64.length > maxBase64Length) {
    throw new ApiError(`PDF file must be ${settings.pdfUploadMaxSizeMb} MB or smaller.`);
  }
}

async function readResponseBufferWithinLimit(response: Response, settings: AppCheckoutWindowSettings) {
  const maxPdfSize = pdfUploadMaxSizeBytes(settings);
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxPdfSize) {
      throw new ApiError(`PDF file must be ${settings.pdfUploadMaxSizeMb} MB or smaller.`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxPdfSize) {
        throw new ApiError(`PDF file must be ${settings.pdfUploadMaxSizeMb} MB or smaller.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

async function fetchRemotePdf(pdfUrl: string, fallbackTitle: string, settings: AppCheckoutWindowSettings) {
  const url = normalizeRemoteUrl(pdfUrl);
  if (!url) {
    throw new ApiError("PDF link must be an HTTP or HTTPS URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), pdfRetrievalTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/pdf,*/*" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ApiError(`PDF link returned HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > pdfUploadMaxSizeBytes(settings)) {
      throw new ApiError(`PDF file must be ${settings.pdfUploadMaxSizeMb} MB or smaller.`);
    }

    const buffer = await readResponseBufferWithinLimit(response, settings);
    validatePdfBuffer(buffer, settings);
    return {
      buffer,
      fileName: inferPdfFileName(url, response.headers.get("content-disposition") ?? "", fallbackTitle),
      mimeType: "application/pdf"
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError("PDF retrieval timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function inferPdfFileName(pdfUrl: string, contentDisposition: string, fallbackTitle: string) {
  const dispositionFileName = extractContentDispositionFileName(contentDisposition);
  if (dispositionFileName) {
    return sanitizePdfFileName(dispositionFileName);
  }

  try {
    const url = new URL(pdfUrl);
    const pathSegment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    if (pathSegment) {
      return sanitizePdfFileName(pathSegment);
    }
  } catch {
    // Fall back to the title-derived filename below.
  }

  return sanitizePdfFileName(`${slugify(fallbackTitle) || "imported-report"}.pdf`);
}

function extractContentDispositionFileName(contentDisposition: string) {
  const utf8Match = /filename\*=UTF-8''([^;\r\n]+)/i.exec(contentDisposition);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return utf8Match[1].trim().replace(/^"|"$/g, "");
    }
  }

  const basicMatch = /filename="?([^";\r\n]+)"?/i.exec(contentDisposition);
  return basicMatch?.[1]?.trim() ?? "";
}

function sanitizePdfFileName(fileName: string) {
  const normalized = fileName
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/["'\r\n]+/g, "")
    .replace(/\s+/g, " ");
  const safeName = normalized || "report.pdf";
  return /\.pdf$/i.test(safeName) ? safeName : `${safeName}.pdf`;
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

function areExtractionTemplateFieldsCompatible(leftFields: ExtractionTemplateField[], rightFields: ExtractionTemplateField[]) {
  if (leftFields.length !== rightFields.length) {
    return false;
  }

  return leftFields.every((leftField, index) => {
    const rightField = rightFields[index];
    return (
      Boolean(rightField) &&
      leftField.id === rightField.id &&
      leftField.type === rightField.type &&
      leftField.options.length === rightField.options.length &&
      leftField.options.every((option, optionIndex) => option === rightField.options[optionIndex])
    );
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
    const l1Values = fields.get("L1") ?? [];
    const pdfUrl = firstRemoteUrl(l1Values, false);
    const warnings = collectCitationWarnings(title, year);
    if (l1Values.length > 0 && !pdfUrl) {
      warnings.push("L1 field did not contain a retrievable HTTP(S) PDF URL.");
    }
    return {
      title,
      abstract: firstField(fields, ["AB", "N2"]) || "No abstract was provided by the imported record.",
      authors: fields.get("AU") ?? fields.get("A1") ?? [],
      journal: firstField(fields, ["T2", "JF", "JO", "JA"]) || "Unspecified source",
      year,
      doi: normalizeDoi(firstField(fields, ["DO"]) || ""),
      keywords: fields.get("KW") ?? [],
      pdfUrl,
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
    const bibtexPdf = extractBibtexPdfUrl(chunk);
    const warnings = collectCitationWarnings(title, year);
    if (hasNestedBibtexBraces(chunk)) {
      warnings.push("Nested braces were detected; review parsed fields.");
    }
    if (bibtexPdf.hasPdfField && !bibtexPdf.url) {
      warnings.push("BibTeX PDF field did not contain a retrievable HTTP(S) PDF URL.");
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
      pdfUrl: bibtexPdf.url,
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

function extractBibtexPdfUrl(entry: string) {
  const pdfFieldValues = ["pdf", "file"]
    .map((field) => cleanBibValue(extractBibField(entry, field)))
    .filter(Boolean);
  const directPdfUrl = firstRemoteUrl(pdfFieldValues, false);
  if (directPdfUrl) {
    return { url: directPdfUrl, hasPdfField: true };
  }

  const linkFieldValues = ["url", "link", "eprint"]
    .map((field) => cleanBibValue(extractBibField(entry, field)))
    .filter(Boolean);
  const hintedUrl = firstRemoteUrl(linkFieldValues, true) || firstRemoteUrl([entry], true);
  return { url: hintedUrl, hasPdfField: pdfFieldValues.length > 0 };
}

function firstRemoteUrl(values: string[], requirePdfHint: boolean) {
  for (const value of values) {
    const searchableValue = value.replace(/\\([:/?&=_.#%-])/g, "$1");
    const matches = searchableValue.match(/https?:\/\/[^\s<>"'{}\\]+/gi) ?? [];
    for (const match of matches) {
      const normalized = normalizeRemoteUrl(match);
      if (normalized && (!requirePdfHint || hasPdfUrlHint(normalized))) {
        return normalized;
      }
    }
  }
  return "";
}

function normalizeRemoteUrl(value: string) {
  const trimmed = value.trim().replace(/[)\].,;]+$/g, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function hasPdfUrlHint(value: string) {
  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname).toLowerCase();
    const search = decodeURIComponent(url.search).toLowerCase();
    return (
      /\.pdf$/i.test(pathname) ||
      /\.pdf[?#/]/i.test(`${pathname}${search}`) ||
      /(^|\/)pdf($|[/?#])/i.test(pathname) ||
      /[?&](format|type|download|file)=pdf($|&)/i.test(search)
    );
  } catch {
    return /\.pdf(?:$|[?#/])/i.test(value);
  }
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
