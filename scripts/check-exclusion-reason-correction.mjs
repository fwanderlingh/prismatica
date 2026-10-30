import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import childProcess from "node:child_process";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-exclusion-reasons-"));
const originalResolve = Module._resolveFilename;
const originalExec = childProcess.execFileSync;
const originalEnv = { ...process.env };

try {
  const out = path.join(temp, "out");
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", esModuleInterop: true,
    skipLibCheck: true, noEmitOnError: true, types: ["node"],
    typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: out,
    paths: { "@/*": [path.join(root, "*")] }
  }, files: [path.join(root, "lib/serverStore.ts"), path.join(root, "lib/exportConsistency.ts")] }));
  originalExec(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function (name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(out, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  Object.assign(process.env, {
    PRISMATICA_STORAGE_MODE: "file", PRISMATICA_USERS_SYNC_POSTGRES: "false",
    PRISMATICA_OBJECT_STORAGE_PROVIDER: "local", PRISMATICA_DATA_FILE: path.join(temp, "state.json"),
    PRISMATICA_ADMIN_EMAIL: "reason-admin@example.test", PRISMATICA_ADMIN_PASSWORD: "isolated-reason-password"
  });
  const store = require(path.join(out, "lib/serverStore.js"));
  const seeds = require(path.join(out, "lib/prismaData.js"));
  const { getCountsForProject } = require(path.join(out, "lib/workflowSelectors.js"));
  const { getExportConsistency } = require(path.join(out, "lib/exportConsistency.js"));
  const stamp = "2026-10-20T12:00:00.000Z";
  const projectId = "reason-project";
  const reportId = "excluded-report";
  const user = (id, isAdmin = false) => ({
    id, name: id, email: `${id}@example.test`, isAdmin, initials: "ER", organization: "Test",
    title: "Reviewer", timezone: "UTC", avatarColor: "#000", passwordHash: "unused-hash",
    passwordSalt: "unused-salt", createdAt: stamp, updatedAt: stamp,
    emailAuth: { sessionVersion: "original-session" }
  });
  const users = [user("owner"), user("reviewer-a"), user("reviewer-b"),
    { ...user("admin-root", true), email: process.env.PRISMATICA_ADMIN_EMAIL }];
  const vote = (id, studyId, userId, stage, decisionValue, overrides = {}) => ({
    id, projectId, studyId, userId, userName: userId, stage, decisionValue,
    reportId: stage === "full_text" ? (studyId === "excluded-study" ? reportId : "included-report") : undefined,
    isCurrent: true, createdAt: stamp, ...overrides
  });
  const fixture = (reason = "Not in Eglish") => ({
    version: 1, users: structuredClone(users),
    authSettings: { registrationEnabled: true, transactionalEmailEnabled: false },
    reviewSettings: { auditHistoryLimit: 100, screeningCheckoutWindowMinutes: 60, extractionCheckoutWindowMinutes: 120, pdfUploadMaxSizeMb: 50 },
    projects: [{
      ...structuredClone(seeds.reviewProjects[0]), id: projectId, title: "Exclusion reason fixture",
      ownerId: "owner", ownerIds: ["owner"], memberIds: ["owner", "reviewer-a", "reviewer-b"],
      recordsTotal: 2, recordsScreened: 2, studiesIncluded: 1, conflicts: 0, status: "active", stage: "complete",
      abstractRequiredVotes: 2, fullTextRequiredVotes: 2, extractionRequiredVotes: 1,
      exclusionReasons: ["Not in English", "Wrong population"], maybePolicy: "conflict", blindMode: false, requireSequentialPhases: true
    }],
    studies: ["excluded", "included"].map(kind => ({
      ...structuredClone(seeds.screeningStudies[0]), id: `${kind}-study`, projectId,
      title: kind === "included" ? "Cooperative robot control" : "Unrelated clinical investigation",
      doi: `10.5555/${kind}`, stage: kind === "included" ? "extraction" : "full_text"
    })),
    reports: ["excluded", "included"].map(kind => ({
      ...structuredClone(seeds.reportQueue[0]), id: `${kind}-report`, projectId,
      studyId: `${kind}-study`, title: `${kind} report`, retrievalStatus: "retrieved"
    })),
    decisions: [
      ...["excluded", "included"].flatMap(kind => ["reviewer-a", "reviewer-b"].map(reviewer =>
        vote(`abstract-${kind}-${reviewer}`, `${kind}-study`, reviewer, "title_abstract", "include"))),
      vote("invalid-exclusion", "excluded-study", "reviewer-a", "full_text", "exclude", { exclusionReasonId: reason, note: "Original reviewer note" }),
      vote("valid-exclusion", "excluded-study", "reviewer-b", "full_text", "exclude", { exclusionReasonId: "Not in English" }),
      ...["reviewer-a", "reviewer-b"].map(reviewer => vote(`include-${reviewer}`, "included-study", reviewer, "full_text", "include"))
    ],
    extractionTemplates: [{ id: "template", projectId, title: "Template", version: 1, fields: [{ id: "field", title: "Field", type: "multiline_text", options: [] }], isActive: true, createdAt: stamp, updatedAt: stamp }],
    extractionResponses: [{ id: "response", projectId, studyId: "included-study", reportId: "included-report", templateId: "template", userId: "reviewer-a", userName: "reviewer-a", values: { field: "value" }, isSubmitted: true, createdAt: stamp, updatedAt: stamp, submittedAt: stamp }],
    extractionConsensus: [{ id: "consensus", projectId, studyId: "included-study", reportId: "included-report", templateId: "template", status: "finalized", finalizedAt: stamp, createdAt: stamp, updatedAt: stamp, resolvedValues: { field: "value" }, flaggedFieldIds: [], reviewerResponseIds: ["response"], requiredVotes: 1 }],
    imports: [], dedupCandidates: [], screeningCheckouts: [], events: []
  });
  const write = state => fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(state));
  const read = () => JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, "utf8"));
  const correct = (actor = "owner", reason = "Not in English", target = reportId) =>
    store.correctFullTextExclusionReasonForUser(actor, projectId, target, reason);
  const currentExclusions = state => state.decisions.filter(d => d.isCurrent && d.reportId === reportId && d.stage === "full_text");
  const consistency = payload => {
    const project = payload.projects.find(p => p.id === projectId);
    const counts = getCountsForProject(project, payload.studies, payload.reports, payload.decisions, payload.extractionResponses, payload.extractionTemplates);
    return getExportConsistency({ project, counts, studies: payload.studies, reports: payload.reports, decisions: payload.decisions });
  };

  for (const badReason of [undefined, "Not in Eglish", "not in english"]) {
    write(fixture(badReason));
    const before = store.getAppStateForUser("owner");
    const baseline = read();
    assert.equal(consistency(before).excludedWithoutReasonCount, 1);
    const payload = correct("owner", " Not in English ");
    const state = read();
    const replacement = currentExclusions(state).find(d => d.userId === "reviewer-a");
    assert.equal(currentExclusions(state).length, 2, "repair does not add an independent vote");
    assert.equal(replacement.exclusionReasonId, "Not in English");
    assert.equal(replacement.supersedesDecisionId, "invalid-exclusion");
    assert.equal(replacement.userName, "reviewer-a", "original voter remains attributable");
    assert.equal(replacement.note, "Original reviewer note");
    assert.deepEqual(state.decisions.find(d => d.id === "invalid-exclusion"), {
      ...baseline.decisions.find(d => d.id === "invalid-exclusion"), isCurrent: false
    }, "original reason remains in history");
    assert.deepEqual(state.decisions.find(d => d.id === "valid-exclusion"), baseline.decisions.find(d => d.id === "valid-exclusion"));
    assert.deepEqual(state.studies, baseline.studies);
    assert.deepEqual(state.reports, baseline.reports);
    assert.deepEqual(state.extractionConsensus, baseline.extractionConsensus, "repair does not reopen extraction consensus");
    assert.equal(state.projects[0].stage, "complete");
    assert.equal(state.events[0].actorId, "owner");
    assert.match(state.events[0].action, /invalid-exclusion/);
    assert.equal(consistency(payload).excludedWithoutReasonCount, 0);
    assert.equal(consistency(payload).assessedCheckOk, true);
    const after = read();
    correct();
    assert.deepEqual(read(), after, "repeated corrections are idempotent");
  }

  for (const [actor, reason, target, status] of [
    ["reviewer-a", "Not in English", reportId, 403],
    ["missing-user", "Not in English", reportId, 401],
    ["owner", "Not in Eglish", reportId, 400],
    ["owner", "", reportId, 400],
    ["owner", "Not in English", "included-report", 400],
    ["owner", "Not in English", "missing-report", 404]
  ]) {
    write(fixture());
    store.getAppStateForUser("owner");
    const before = read();
    assert.throws(() => correct(actor, reason, target), error => error.status === status);
    assert.deepEqual(read(), before, "invalid or unauthorized corrections preserve stored decisions");
  }
  write(fixture());
  correct("admin-root");
  assert.equal(read().events[0].actorId, "admin-root", "administrators can repair excluded reports");

  const blindFixture = fixture();
  blindFixture.projects[0].blindMode = true;
  // The first (aggregate) exclusion reason remains valid while a later peer's
  // outdated reason is hidden from this owner's raw decision list.
  blindFixture.decisions.find(d => d.id === "invalid-exclusion").exclusionReasonId = "Not in English";
  blindFixture.decisions.find(d => d.id === "valid-exclusion").exclusionReasonId = "Not in Eglish";
  write(blindFixture);
  const blindBefore = store.getAppStateForUser("owner");
  const blindReportBefore = blindBefore.reports.find(r => r.id === reportId);
  assert.equal(blindBefore.decisions.length, 0, "blind owners do not see peer votes");
  assert.equal(blindReportBefore.fullTextExclusionReasonId, "Not in English");
  assert.equal(blindReportBefore.fullTextExclusionReasonNeedsCorrection, true, "aggregate flag exposes the repair without exposing the hidden reason");
  assert.ok(!JSON.stringify(blindReportBefore).includes("Not in Eglish"));
  const blindAfter = correct();
  const blindReportAfter = blindAfter.reports.find(r => r.id === reportId);
  assert.equal(blindAfter.decisions.length, 0);
  assert.equal(blindReportAfter.fullTextExclusionReasonNeedsCorrection, false);
  assert.equal(blindReportAfter.fullTextExclusionReasonId, "Not in English");
  assert.equal(blindReportAfter.fullTextStatus, "excluded_full_text");
  assert.equal(blindReportAfter.fullTextVoteCount, 2);

  // Exercise the existing optimistic project patch path with a concurrent edit.
  process.env.PRISMATICA_STORAGE_MODE = "postgres";
  let databaseState = fixture();
  let revision = 1;
  let attempts = 0;
  const operations = [];
  childProcess.execFileSync = (_command, args, options) => {
    const action = args[1];
    operations.push(action);
    if (action === "read-screening-state") return JSON.stringify({ state: databaseState, revision: String(revision) });
    assert.equal(action, "write-screening-patch", "corrections never overwrite the whole database");
    const mutation = JSON.parse(options.input);
    attempts += 1;
    if (attempts === 1) {
      databaseState.projects[0].description = "Concurrent project edit";
      databaseState.decisions.push(vote("unrelated-history", "included-study", "reviewer-a", "full_text", "exclude", { isCurrent: false }));
      revision += 1;
      return JSON.stringify({ updated: false });
    }
    assert.equal(mutation.revision, String(revision));
    assert.equal(mutation.changes.decisions.upserts.length, 2, "patch only supersedes and replaces the invalid reason");
    assert.deepEqual(mutation.changes.reports, { upserts: [], deleteIds: [] });
    assert.deepEqual(mutation.changes.extractionConsensus, { upserts: [], deleteIds: [] });
    for (const [key, changes] of Object.entries(mutation.changes)) {
      const replacements = new Map(changes.upserts.map(item => [item.id, item]));
      const deleted = new Set(changes.deleteIds);
      databaseState[key] = databaseState[key].filter(item => !deleted.has(item.id)).map(item => {
        const next = replacements.get(item.id);
        replacements.delete(item.id);
        return next ?? item;
      });
      databaseState[key].push(...replacements.values());
    }
    if (mutation.project) databaseState.projects[0] = mutation.project;
    databaseState.events.unshift(...mutation.events);
    return JSON.stringify({ updated: true });
  };
  correct();
  assert.equal(attempts, 2);
  assert.equal(databaseState.projects[0].description, "Concurrent project edit");
  assert.ok(databaseState.decisions.some(d => d.id === "unrelated-history"));
  assert.equal(currentExclusions(databaseState).length, 2);
  assert.equal(databaseState.events.length, 1, "a retry persists one correction audit event");
  assert.ok(!operations.includes("write"));

  databaseState = fixture();
  attempts = 0;
  childProcess.execFileSync = (_command, args) => {
    if (args[1] === "read-screening-state") return JSON.stringify({ state: databaseState, revision: String(revision) });
    assert.equal(args[1], "write-screening-patch");
    attempts += 1;
    databaseState.projects[0].ownerId = "reviewer-b";
    databaseState.projects[0].ownerIds = ["reviewer-b"];
    revision += 1;
    return JSON.stringify({ updated: false });
  };
  assert.throws(() => correct(), error => error.status === 403, "owner permission is rechecked after a concurrent ownership change");
  assert.equal(attempts, 1);
  assert.equal(databaseState.decisions.find(d => d.id === "invalid-exclusion").isCurrent, true);
  assert.equal(databaseState.events.length, 0);

  console.log("Full-text exclusion reason corrections passed: immutable history, valid peer votes, roles, unchanged workflow, and concurrent persistence.");
} finally {
  Module._resolveFilename = originalResolve;
  childProcess.execFileSync = originalExec;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
