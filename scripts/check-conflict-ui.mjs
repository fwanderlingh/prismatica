import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-conflict-ui-"));
const originalResolve = Module._resolveFilename;
let passed = 0;

try {
  const sections = ["screening-section", "full-text-section", "project-dashboard-section"];
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
      noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
      typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
      paths: { "@/*": [path.join(root, "*")] }
    },
    files: sections.map(name => path.join(root, `components/review-sections/${name}.tsx`))
  }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { NavigationProvider } = require(path.join(temp, "components/navigation-link.js"));
  const { ScreeningSection } = require(path.join(temp, "components/review-sections/screening-section.js"));
  const { FullTextSection } = require(path.join(temp, "components/review-sections/full-text-section.js"));
  const { ProjectDashboardSection } = require(path.join(temp, "components/review-sections/project-dashboard-section.js"));
  const data = require(path.join(temp, "lib/prismaData.js"));
  const project = { ...data.reviewProjects[0], abstractRequiredVotes: 2, fullTextRequiredVotes: 2 };
  const study = { ...data.screeningStudies[0], projectId: project.id, titleAbstractStatus: "conflict" };
  const report = {
    ...data.reportQueue[0], projectId: project.id, studyId: study.id, retrievalStatus: "retrieved",
    fullTextStatus: "conflict", fullTextStatusLabel: "Conflicting independent votes", fullTextVoteCount: 2, fullTextRequiredVotes: 2
  };
  const noop = () => {};
  const formatDecision = value => value === "include" ? "Own inclusion choice" : "Peer exclusion choice";
  const render = (Component, props) => renderToStaticMarkup(React.createElement(
    NavigationProvider, { projectId: project.id }, React.createElement(Component, props)
  ));
  const assertDecisionButtons = (props, disabled, context) => {
    const markup = render(FullTextSection, props);
    const buttons = markup.match(/<button\b[^>]*class="(?:includeButton|excludeButton)[^"]*"[^>]*>/g) ?? [];
    assert.equal(buttons.length, 2, `${context}: include and exclude controls are present`);
    for (const button of buttons) assert.equal(/\bdisabled(?:=|\s|>)/.test(button), disabled, context);
    passed++;
  };

  // Deliberately pass peer decisions even in blind mode. Rendering must remain private
  // if a stale client snapshot or an overbroad API response reaches these components.
  for (const role of ["reviewer", "owner", "admin"]) {
    const user = {
      id: role === "owner" ? project.ownerId : `${role}-id`, name: "Own reviewer identity", isAdmin: role === "admin"
    };
    const vote = {
      id: "own-vote", projectId: project.id, studyId: study.id, reportId: report.id,
      userId: user.id, userName: user.name, decisionValue: "include", isCurrent: true,
      stage: "title_abstract", createdAt: "2026-10-20T12:00:00.000Z"
    };
    const peerVote = { ...vote, id: "peer-vote", userId: "peer-id", userName: "Peer private identity", decisionValue: "exclude" };

    for (const blindMode of [true, false]) {
      const selectedProject = { ...project, blindMode };
      const screeningProps = {
        projectScreeningStudies: [study], totalScreeningStudyCount: 1, screeningProgress: 0,
        decisions: [vote, peerVote], selectedProjectId: project.id, currentUserId: user.id, blindMode,
        studyIndex: 0, setStudyIndex: noop, titleAbstractEvaluations: new Map([[study.id, { state: "conflict", label: "Conflicting independent votes" }]]),
        formatDecision, decisionTone: () => "info", currentStudy: study,
        stageEvaluation: { state: "conflict", label: "Conflicting independent votes" },
        screeningNote: "", setScreeningNote: noop, screeningMessage: "", canRecordScreeningDecision: true, checkoutError: "",
        currentUserDecision: vote, currentStageDecisions: [vote, peerVote], pendingScreeningDecision: null,
        isUndoingScreeningDecision: false, reviewedCount: 0, onOpenReviewed: noop, conflictCount: 1, onResolveConflict: noop,
        formatConflictResolutionHint: () => "Another independent review is needed.", selectedProjectAbstractRequiredVotes: 2,
        addScreeningDecision: noop, undoLastDecision: noop
      };
      const fullTextProps = {
        hasProjectSeedData: false, phaseProgress: { percent: 0, label: "0%" }, projectReportQueue: [report], totalFullTextReportCount: 1,
        activeReport: report, decisions: [vote, peerVote].map(decision => ({ ...decision, stage: "full_text" })),
        selectedProject, currentUser: user, fullTextMessage: "", checkoutError: "", setActiveReportId: noop, setFullTextMessage: noop,
        pdfInputRef: { current: null }, pendingFullTextAction: null, uploadReportPdf: noop, updateFullTextReport: noop,
        formatDecision, formatConflictResolutionHint: () => "Another independent review is needed.", decisionTone: () => "info",
        fullTextReason: "Out of scope", setFullTextReason: noop, exclusionReasons: ["Out of scope"], studies: [study],
        reviewedCount: 0, onOpenReviewed: noop, conflictCount: 1, onResolveConflict: noop, onOpenPdfUpload: noop
      };
      const dashboardProps = {
        selectedProject, currentUserId: user.id,
        workflowConflicts: [{ id: "conflict", stage: "title_abstract", studyId: study.id, title: study.title, subtitle: "Conflicting independent votes", decisions: [vote, peerVote] }],
        recordsIdentified: 1, activeCounts: data.prismaCounts, exportFailedCount: 0,
        projectEvents: [], latestProjectEvents: [], projectUserStats: [], projectScreeningStudies: [study], projectReportQueue: [report],
        openConflict: noop, formatConflictStage: () => "Screening", decisionTone: () => "info", formatDecision,
        getWorkflowStepState: () => "active", formatProjectPhase: String, projectPhaseStatusTone: () => "info", formatMaybePolicy: String,
        formatAuditEntityLabel: () => "", formatAuditTime: String, formatNumber: String, onOpenSettings: noop, onOpenAudit: noop, onNavigate: noop
      };

      for (const [name, Component, props] of [
        ["screening", ScreeningSection, screeningProps], ["full text", FullTextSection, fullTextProps],
        ["dashboard", ProjectDashboardSection, dashboardProps]
      ]) {
        const markup = render(Component, props);
        const context = `${role}, ${name}, blind=${blindMode}`;
        assert.match(markup, /Own reviewer identity/, `${context}: own identity stays visible`);
        assert.match(markup, /Own inclusion choice/, `${context}: own vote stays visible`);
        assert.match(markup, /Conflicting independent votes/, `${context}: aggregate conflict status stays visible`);
        if (blindMode) {
          assert.doesNotMatch(markup, /Peer private identity|Peer exclusion choice/, `${context}: peer identity and vote stay private`);
        } else {
          assert.match(markup, /Peer private identity/, `${context}: peer identity is visible in open review`);
          assert.match(markup, /Peer exclusion choice/, `${context}: peer vote is visible in open review`);
        }
        if (name === "full text") assert.match(markup, /2\/2/, `${context}: aggregate vote count stays visible`);
        if (name === "screening") assert.equal(markup.includes("Other reviewer votes are hidden"), blindMode);
        passed++;
        if (blindMode) {
          const peerOnlyProps = name === "dashboard"
            ? { ...props, workflowConflicts: props.workflowConflicts.map(conflict => ({ ...conflict, decisions: [peerVote] })) }
            : name === "screening"
              ? { ...props, decisions: [peerVote], currentUserDecision: undefined, currentStageDecisions: [peerVote] }
              : { ...props, decisions: [{ ...peerVote, stage: "full_text" }] };
          const peerOnlyMarkup = render(Component, peerOnlyProps);
          assert.doesNotMatch(peerOnlyMarkup, /Peer private identity|Peer exclusion choice/, `${context}: peer votes stay hidden before own review`);
          assert.match(peerOnlyMarkup, /Conflicting independent votes/, `${context}: conflict stays visible before own review`);
          passed++;
        }
      }

      for (const fullTextStatus of ["conflict", "needs_third_vote"]) {
        for (const fullTextCheckedOutByCurrentUser of [false, true]) {
          assertDecisionButtons({
            ...fullTextProps,
            activeReport: { ...report, fullTextStatus, fullTextCheckedOutByCurrentUser }
          }, !fullTextCheckedOutByCurrentUser,
          `${role}, blind=${blindMode}, ${fullTextStatus}: a prior current vote cannot replace an active reservation`);
        }
      }
      assertDecisionButtons({
        ...fullTextProps,
        activeReport: { ...report, fullTextCheckedOutByCurrentUser: false },
        decisions: fullTextProps.decisions.map(decision => decision.userId === user.id ? { ...decision, isCurrent: false } : decision)
      }, true, `${role}, blind=${blindMode}: a historical vote cannot enable conflict review`);
      assertDecisionButtons({
        ...fullTextProps,
        activeReport: { ...report, fullTextStatus: "awaiting_votes", fullTextCheckedOutByCurrentUser: false }
      }, false, `${role}, blind=${blindMode}: an existing nonconflict vote remains editable`);
    }
  }

  console.log(`Conflict UI privacy and reservations: ${passed} rendering checks passed.`);
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
