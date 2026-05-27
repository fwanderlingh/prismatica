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
          memberIds: project.memberIds.filter((memberId) => userIds.has(memberId))
        }))
    : [];
  const projectIds = new Set(projects.map((project) => project.id));

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
    projects,
    imports: Array.isArray(state.imports) ? state.imports.filter((batch) => projectIds.has(batch.projectId)) : [],
    decisions: Array.isArray(state.decisions)
      ? state.decisions.filter((decision) => projectIds.has(decision.projectId) && userIds.has(decision.userId))
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
  const records = countImportedRecords(input.format, content);
  const parserWarnings = content.trim() ? 0 : 1;
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
    uploadedBy: currentUser.name,
    uploadedAt: now.toISOString().slice(0, 16).replace("T", " ")
  };

  state.imports.unshift(batch);
  state.projects = state.projects.map((candidate) =>
    candidate.id === projectId
      ? {
          ...candidate,
          status: candidate.status === "draft" ? "active" : candidate.status,
          stage: candidate.stage === "setup" ? "import" : candidate.stage,
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

function countImportedRecords(format: ImportBatch["format"], content: string) {
  const normalized = content.trim();
  if (!normalized) {
    return 0;
  }

  if (format === "ris") {
    const risStarts = normalized.match(/^TY\s+-/gim);
    const risEnds = normalized.match(/^ER\s+-?/gim);
    return Math.max(risStarts?.length ?? 0, risEnds?.length ?? 0, 1);
  }

  if (format === "bib") {
    return normalized.match(/@\w+\s*[{(]/g)?.length ?? 1;
  }

  return 1;
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
