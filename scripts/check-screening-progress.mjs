import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-screening-progress-"));
const originalResolve = Module._resolveFilename;

try {
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
    noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
    typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
    paths: { "@/*": [path.join(root, "*")] }
  }, files: ["dashboard-section", "project-dashboard-section", "screening-section"].map(
    name => path.join(root, `components/review-sections/${name}.tsx`)
  ) }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  const { getScreeningCompletion, getProjectPhaseProgress } = require(path.join(temp, "lib/workflowSelectors.js"));
  const data = require(path.join(temp, "lib/prismaData.js"));
  const project = {
    ...data.reviewProjects[0], id: "screening-completion-review", stage: "screening", blindMode: true,
    abstractRequiredVotes: 2, recordsTotal: 4, recordsScreened: 3
  };
  const counts = {
    ...data.prismaCounts, duplicateRecordsRemoved: 0, automationRemoved: 0, removedOtherReasons: 0,
    recordsScreened: 3, reportsSought: 0, studiesIncluded: 0, studiesExtracted: 0
  };
  const study = (id, overrides = {}) => ({
    ...data.screeningStudies[0], id, projectId: project.id, stage: "title_abstract",
    titleAbstractVoteCount: undefined, titleAbstractRequiredVotes: undefined,
    titleAbstractStatus: undefined, ...overrides
  });
  const decision = (studyId, userId, overrides = {}) => ({
    id: `${studyId}-${userId}`, projectId: project.id, studyId, userId, userName: userId,
    stage: "title_abstract", decisionValue: "include", isCurrent: true,
    createdAt: "2026-11-04T10:00:00Z", ...overrides
  });
  const studies = [1, 2, 1, 0].map((voteCount, index) => study(`study-${index}`, { titleAbstractVoteCount: voteCount }));
  assert.deepEqual(getScreeningCompletion(project, counts, studies), { completed: 1, total: 4, percent: 25 },
    "one vote does not complete a paper requiring two votes, even when the stored screened count says 75%");
  assert.deepEqual(getProjectPhaseProgress(project, counts, [], String, studies), {
    percent: 25, label: "25% screened · 1 of 4 records reached minimum votes"
  });
  assert.deepEqual(getScreeningCompletion(project, { ...counts, recordsScreened: 999 }, []), { completed: 0, total: 4, percent: 0 },
    "a historical any-vote count cannot replace missing current completion data");
  assert.equal(getProjectPhaseProgress(project, counts, [], String).percent, 0,
    "the legacy four-argument call cannot report stored any-vote counts as completion");

  const hiddenPeerStudies = studies.map((item, index) => ({ ...item, titleAbstractVoteCount: index < 2 ? 2 : 0 }));
  assert.equal(getScreeningCompletion(project, counts, hiddenPeerStudies, [decision("study-0", "me")]).completed, 2,
    "blind review aggregates include hidden peer votes, even for records with no visible decisions");
  assert.equal(getScreeningCompletion(project, counts, [study("reset", { titleAbstractVoteCount: 0 })], [
    decision("reset", "me"), decision("reset", "peer")
  ]).completed, 0, "an explicit aggregate zero overrides stale visible decisions after reopening");
  assert.equal(getScreeningCompletion(project, counts, [
    study("conflict", { titleAbstractVoteCount: 2, titleAbstractStatus: "conflict" }),
    study("third-vote", { titleAbstractVoteCount: 2, titleAbstractStatus: "needs_third_vote" })
  ]).completed, 2, "conflicts meet the vote minimum while remaining separate workflow blockers");
  assert.equal(getScreeningCompletion(project, counts, [
    study("higher-minimum", { titleAbstractVoteCount: 2, titleAbstractRequiredVotes: 3 }),
    study("lower-minimum", { titleAbstractVoteCount: 1, titleAbstractRequiredVotes: 1 }),
    study("project-minimum", { titleAbstractVoteCount: 2 })
  ]).completed, 2, "each record uses its own required votes when provided");

  const fallbackStudy = study("fallback");
  const ineligibleVotes = [
    decision(fallbackStudy.id, "me"), decision(fallbackStudy.id, "me", { id: "duplicate-current-row" }),
    decision(fallbackStudy.id, "old-peer", { isCurrent: false }),
    decision(fallbackStudy.id, "full-text-peer", { stage: "full_text" }),
    decision(fallbackStudy.id, "foreign-peer", { projectId: "other-project" }),
    decision("other-study", "another-peer")
  ];
  assert.equal(getScreeningCompletion(project, counts, [fallbackStudy], ineligibleVotes).completed, 0,
    "fallback counts distinct current title/abstract reviewers for the same project and record");
  const fallbackVotes = [...ineligibleVotes, decision(fallbackStudy.id, "peer")];
  assert.equal(getScreeningCompletion(project, counts, [fallbackStudy], fallbackVotes).completed, 1,
    "a second independent current reviewer completes records lacking aggregate metadata");
  assert.equal(getScreeningCompletion(project, counts, [
    ...studies, studies[1], study("foreign-study", { projectId: "other-project", titleAbstractVoteCount: 2 })
  ]).completed, 1, "duplicate rows and foreign project records cannot inflate completion");
  assert.equal(getScreeningCompletion(project, counts, [study("legacy-study", { projectId: undefined, titleAbstractVoteCount: 2 })]).completed, 1,
    "legacy project-scoped records without projectId remain supported");

  const removedCounts = { ...counts, duplicateRecordsRemoved: 2, automationRemoved: 1, removedOtherReasons: 1 };
  const eligibleStudies = Array.from({ length: 6 }, (_, index) => study(`eligible-${index}`, { titleAbstractVoteCount: index < 3 ? 2 : 0 }));
  assert.deepEqual(getScreeningCompletion({ ...project, recordsTotal: 10 }, removedCounts, eligibleStudies), {
    completed: 3, total: 6, percent: 50
  }, "confirmed duplicates and other removed records are excluded from the denominator");
  assert.deepEqual(getScreeningCompletion({ ...project, recordsTotal: 1 }, counts, hiddenPeerStudies), {
    completed: 1, total: 1, percent: 100
  }, "completion cannot exceed the eligible record total");
  for (const [emptyProject, emptyCounts] of [
    [{ ...project, recordsTotal: 0 }, counts],
    [project, { ...counts, duplicateRecordsRemoved: 4 }],
    [project, { ...counts, duplicateRecordsRemoved: 5 }]
  ]) {
    assert.deepEqual(getScreeningCompletion(emptyProject, emptyCounts, hiddenPeerStudies), { completed: 0, total: 0, percent: 0 });
  }

  // Synthetic reproduction of the reported underwater manipulation review totals.
  const underwaterStudies = [160, 240, 224, 26].flatMap((length, voteCount) => Array.from({ length }, (_, index) =>
    study(`underwater-${voteCount}-${index}`, { titleAbstractVoteCount: voteCount })
  ));
  assert.deepEqual(getScreeningCompletion(
    { ...project, recordsTotal: 1030, recordsScreened: 490 },
    { ...counts, duplicateRecordsRemoved: 380, recordsScreened: 490 }, underwaterStudies
  ), { completed: 250, total: 650, percent: 38 }, "490 papers with any vote represent only 250 papers reaching the two-vote minimum");

  assert.deepEqual(getProjectPhaseProgress({ ...project, stage: "extraction" }, {
    ...counts, studiesIncluded: 8, studiesExtracted: 2
  }, [], String, studies), { percent: 25, label: "25% extracted · 2 of 8 studies" });
  const reports = [
    { ...data.reportQueue[0], retrievalStatus: "not_retrieved" },
    { ...data.reportQueue[0], id: "pending-report", retrievalStatus: "retrieved", fullTextStatus: "pending", fullTextVoteCount: 0 }
  ];
  assert.equal(getProjectPhaseProgress({ ...project, stage: "full_text" }, counts, reports, String, studies).percent, 50);
  assert.equal(getProjectPhaseProgress({ ...project, stage: "complete" }, counts, [], String, studies).percent, 100);
  assert.deepEqual(getProjectPhaseProgress({ ...project, stage: "import" }, counts, [], String, studies), {
    percent: 100, label: "4 records imported"
  }, "other phase progress remains unchanged");

  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { NavigationProvider } = require(path.join(temp, "components/navigation-link.js"));
  const { ProjectDashboardSection } = require(path.join(temp, "components/review-sections/project-dashboard-section.js"));
  const { DashboardSection } = require(path.join(temp, "components/review-sections/dashboard-section.js"));
  const { ScreeningSection } = require(path.join(temp, "components/review-sections/screening-section.js"));
  const noop = () => {};
  const render = (Component, props) => renderToStaticMarkup(React.createElement(
    NavigationProvider, { projectId: project.id }, React.createElement(Component, props)
  ));
  const overviewProps = {
    selectedProject: project, currentUserId: project.ownerId, workflowConflicts: [], recordsIdentified: 4,
    activeCounts: counts, exportFailedCount: 0, projectEvents: [], latestProjectEvents: [], projectUserStats: [],
    projectScreeningStudies: studies, decisions: [], projectReportQueue: [],
    getWorkflowStepState: () => "active", formatProjectPhase: String, projectPhaseStatusTone: () => "info",
    formatMaybePolicy: String, formatAuditEntityLabel: String, formatAuditTime: String, formatNumber: String,
    onOpenSettings: noop, onOpenAudit: noop, onNavigate: noop
  };
  const overviewHtml = render(ProjectDashboardSection, overviewProps);
  assert.match(overviewHtml, /25% screened · 1 of 4 records reached minimum votes/);
  assert.match(overviewHtml, /Screen<\/span><strong>1\/4 screened<\/strong>/,
    "project overview workflow count uses the same minimum-vote completion as its percentage");
  assert.doesNotMatch(overviewHtml, /75% screened|3\/4 screened/);
  assert.match(render(ProjectDashboardSection, {
    ...overviewProps, projectScreeningStudies: [fallbackStudy], decisions: fallbackVotes
  }), /25% screened · 1 of 4 records reached minimum votes/,
  "overview forwards current decisions for legacy records lacking aggregates");

  const user = {
    id: project.ownerId, name: "Screening Reviewer", email: "screening@example.test", isAdmin: false,
    initials: "SR", organization: "Test", title: "", timezone: "UTC", avatarColor: "#456"
  };
  const portfolioHtml = render(DashboardSection, {
    currentUser: user, userProjects: [project], users: [user], dashboardMessage: "",
    getProjectPhaseProgress: item => getProjectPhaseProgress(item, counts, [], String, studies),
    formatProjectPhase: String, projectPhaseBadgeTone: () => "info", openProject: noop, formatEuDate: String
  });
  assert.match(portfolioHtml, /25% screened · 1 of 4 records reached minimum votes/);
  assert.match(portfolioHtml, /width:25%/, "portfolio progress bar displays quorum completion");

  const evaluation = { state: "pending", label: "Awaiting minimum votes" };
  const screeningHtml = render(ScreeningSection, {
    projectScreeningStudies: studies, totalScreeningStudyCount: studies.length,
    screeningProgress: getScreeningCompletion(project, counts, studies).percent,
    decisions: [], selectedProjectId: project.id, currentUserId: project.ownerId, blindMode: true,
    studyIndex: 0, setStudyIndex: noop, titleAbstractEvaluations: new Map(studies.map(item => [item.id, evaluation])),
    formatDecision: String, decisionTone: () => "info", currentStudy: studies[0], stageEvaluation: evaluation,
    screeningNote: "", setScreeningNote: noop, screeningMessage: "", canRecordScreeningDecision: true,
    checkoutError: "", currentStageDecisions: [], pendingScreeningDecision: null, isUndoingScreeningDecision: false,
    reviewedCount: 0, onOpenReviewed: noop, conflicts: [], onResolveConflict: noop,
    formatConflictResolutionHint: String, selectedProjectAbstractRequiredVotes: 2,
    addScreeningDecision: noop, undoLastDecision: noop
  });
  assert.match(screeningHtml, /25% of papers reached minimum votes/);
  assert.match(screeningHtml, /width:25%/, "reviewer queue displays the same quorum percentage");
  console.log("Screening progress checks passed: minimum votes, blind aggregates, current reviewers, removals, and rendered views.");
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
