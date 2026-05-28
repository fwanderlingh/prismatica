import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { AppMutationPayload, AppStatePayload } from "./apiTypes";
import {
  type AppUser,
  type Decision,
  type DedupCandidate,
  type ImportBatch,
  type ReviewProject,
  type Study,
  type WorkflowEvent
} from "./prismaData";
import type { DecisionValue } from "./workflow";

type StoredUser = AppUser & {
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
};

type PersistedState = {
  version: 1;
  users: StoredUser[];
  projects: ReviewProject[];
  imports: ImportBatch[];
  studies: Study[];
  decisions: Decision[];
  events: WorkflowEvent[];
  dedupCandidates: DedupCandidate[];
};

type NewProjectInput = {
  title?: string;
  organization?: string;
  protocolId?: string;
  description?: string;
  dueDate?: string;
  blindMode?: boolean;
  abstractRequiredVotes?: number;
  fullTextRequiredVotes?: number;
  maybePolicy?: ReviewProject["maybePolicy"];
  memberIds?: string[];
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

function createSeedState(): PersistedState {
  return {
    version: 1,
    users: [],
    projects: [],
    imports: [],
    studies: [],
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

function normalizeState(state: Partial<PersistedState>): PersistedState {
  const now = new Date().toISOString();
  const users = Array.isArray(state.users) ? state.users.filter((user) => !demoUserIds.has(user.id)) : [];
  const userIds = new Set(users.map((user) => user.id));
  const projects = Array.isArray(state.projects)
    ? state.projects
        .filter((project) => userIds.has(project.ownerId))
        .map((project) => ({
          ...project,
          memberIds: Array.isArray(project.memberIds) ? project.memberIds.filter((memberId) => userIds.has(memberId)) : [project.ownerId]
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
  const studyIds = new Set(studies.map((study) => study.id));
  const projectsWithImportState = projects.map((project) => {
    const importedRecordCount = imports
      .filter((batch) => batch.projectId === project.id)
      .reduce((total, batch) => total + batch.records, 0);
    const hasScreeningRecords = studies.some((study) => study.projectId === project.id && study.stage === "title_abstract");
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

  return {
    version: 1,
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
    studies,
    decisions: Array.isArray(state.decisions)
      ? state.decisions.filter((decision) => projectIds.has(decision.projectId) && studyIds.has(decision.studyId) && userIds.has(decision.userId))
      : [],
    events: Array.isArray(state.events) ? state.events.filter((event) => projectIds.has(event.entity)) : [],
    dedupCandidates: Array.isArray(state.dedupCandidates) ? state.dedupCandidates.filter(() => projectIds.has("demo-review")) : []
  };
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

function publicUser(user: StoredUser): AppUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    initials: user.initials,
    organization: user.organization,
    title: user.title,
    timezone: user.timezone,
    avatarColor: user.avatarColor
  };
}

function getUser(state: PersistedState, userId: string) {
  return state.users.find((user) => user.id === userId);
}

function getProject(state: PersistedState, projectId: string) {
  return state.projects.find((project) => project.id === projectId);
}

function isProjectMember(project: ReviewProject, userId: string) {
  return project.ownerId === userId || project.memberIds.includes(userId);
}

function requireProjectMember(state: PersistedState, projectId: string, userId: string) {
  const project = getProject(state, projectId);
  if (!project || !isProjectMember(project, userId)) {
    throw new ApiError("You do not have access to that project.", 403);
  }
  return project;
}

function requireProjectOwner(state: PersistedState, projectId: string, userId: string) {
  const project = requireProjectMember(state, projectId, userId);
  if (project.ownerId !== userId) {
    throw new ApiError("Only the project owner can change team membership.", 403);
  }
  return project;
}

function accessibleProjects(state: PersistedState, userId: string) {
  return state.projects.filter((project) => isProjectMember(project, userId));
}

function buildPayload(state: PersistedState, userId: string): AppStatePayload {
  const currentUser = getUser(state, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const projects = accessibleProjects(state, userId);
  const projectIds = new Set(projects.map((project) => project.id));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const allProjectIds = new Set(state.projects.map((project) => project.id));
  const demoProjectAccessible = projectIds.has("demo-review");

  return {
    currentUser: publicUser(currentUser),
    users: state.users.map(publicUser),
    projects,
    imports: state.imports.filter((batch) => projectIds.has(batch.projectId)),
    studies: state.studies.filter((study) => study.projectId && projectIds.has(study.projectId)),
    decisions: state.decisions.filter((decision) => {
      const project = projectById.get(decision.projectId);
      if (!project) {
        return false;
      }
      return !project.blindMode || project.ownerId === userId || decision.userId === userId;
    }),
    events: state.events
      .filter((event) => projectIds.has(event.entity) || (demoProjectAccessible && !allProjectIds.has(event.entity)))
      .slice(0, 50),
    dedupCandidates: demoProjectAccessible ? state.dedupCandidates : []
  };
}

export function getAppStateForUser(userId: string): AppStatePayload {
  return buildPayload(readState(), userId);
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
}): AppStatePayload {
  const state = readState();
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const organization = input.organization?.trim() ?? "";
  const password = input.password?.trim() ?? "";

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
    fullTextRequiredVotes: clampVoteCount(input.fullTextRequiredVotes),
    maybePolicy: input.maybePolicy ?? "advance_to_full_text",
    reviewers: memberIds.length,
    lastEvent: "Project created just now",
    description: input.description?.trim() || "New systematic review project.",
    status: "draft",
    stage: "setup",
    ownerId: userId,
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

export function updateProjectMembersForUser(
  userId: string,
  projectId: string,
  memberIds: string[],
  eventLabel: string
): AppMutationPayload {
  const state = readState();
  const currentUser = getUser(state, userId);
  const project = requireProjectOwner(state, projectId, userId);
  if (!currentUser) {
    throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  }

  const knownUserIds = new Set(state.users.map((user) => user.id));
  const nextMemberIds = uniqueIds([project.ownerId, ...memberIds]).filter((id) => knownUserIds.has(id));

  state.projects = state.projects.map((candidate) =>
    candidate.id === projectId
      ? {
          ...candidate,
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

  if (memberId === project.ownerId) {
    throw new ApiError("The project owner cannot be removed.");
  }

  const removedUser = getUser(state, memberId);
  const nextMemberIds = project.memberIds.filter((candidateId) => candidateId !== memberId);
  state.projects = state.projects.map((candidate) =>
    candidate.id === projectId
      ? {
          ...candidate,
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
  const importedStudies: Study[] = parsedCitations.map((citation) => ({
    id: createId("study"),
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
  requireProjectMember(state, projectId, userId);

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
  writeState(state);

  return {
    ...buildPayload(state, userId),
    decisionAction: {
      studyId,
      previousDecisionId: previousDecision?.id
    }
  };
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
    time: "just now"
  };
  state.events = [nextEvent, ...state.events].slice(0, 50);
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
