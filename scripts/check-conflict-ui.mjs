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
  const sections = ["screening-section", "full-text-section", "project-dashboard-section", "conflicts-section"];
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
  const { ConflictsSection } = require(path.join(temp, "components/review-sections/conflicts-section.js"));
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
      const workflowConflicts = [
        { id: "screening-conflict", projectId: project.id, stage: "title_abstract", studyId: study.id, title: "Screening conflict paper", subtitle: "Conflicting independent votes", decisions: [vote, peerVote] },
        { id: "full-text-conflict", projectId: project.id, stage: "full_text", studyId: study.id, reportId: report.id, title: "Full text conflict paper", subtitle: "Conflicting independent votes", decisions: [vote, peerVote].map(decision => ({ ...decision, stage: "full_text" })) },
        { id: "other-project-conflict", projectId: "another-project", stage: "title_abstract", studyId: "other-study", title: "Private other project paper", subtitle: "Another project", decisions: [peerVote] }
      ];
      const conflictsProps = {
        selectedProject, currentUserId: user.id, stage: "title_abstract", workflowConflicts,
        openConflict: noop, formatConflictStage: stage => stage === "full_text" ? "Full text" : "Screening",
        canOpenConflict: () => true, decisionTone: () => "info", formatDecision, onBackToQueue: noop
      };
      const dashboardProps = {
        selectedProject: { ...selectedProject, stage: "screening" }, currentUserId: user.id, workflowConflicts,
        recordsIdentified: 1, activeCounts: data.prismaCounts, exportFailedCount: 0,
        projectEvents: [], latestProjectEvents: [], projectUserStats: [], projectScreeningStudies: [study], projectReportQueue: [report],
        getWorkflowStepState: () => "active", formatProjectPhase: String, projectPhaseStatusTone: () => "info", formatMaybePolicy: String,
        formatAuditEntityLabel: () => "", formatAuditTime: String, formatNumber: String, onOpenSettings: noop, onOpenAudit: noop, onNavigate: noop
      };

      for (const [name, Component, props] of [
        ["screening", ScreeningSection, screeningProps], ["full text", FullTextSection, fullTextProps],
        ["screening conflicts", ConflictsSection, conflictsProps],
        ["full text conflicts", ConflictsSection, { ...conflictsProps, stage: "full_text" }]
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
        if (name.endsWith("conflicts")) {
          assert.doesNotMatch(markup, /Private other project paper/, `${context}: other project conflicts stay hidden`);
          assert.match(markup, new RegExp(name === "screening conflicts" ? "Screening conflict paper" : "Full text conflict paper"));
          assert.doesNotMatch(markup, new RegExp(name === "screening conflicts" ? "Full text conflict paper" : "Screening conflict paper"));
          assert.match(markup, new RegExp(`href="[^"]+/${name === "screening conflicts" ? "screening" : "full-text"}"`), `${context}: conflicts open their review phase`);
        }
        passed++;
        if (blindMode) {
          const peerOnlyProps = name.endsWith("conflicts")
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

      const dashboardMarkup = render(ProjectDashboardSection, dashboardProps);
      assert.doesNotMatch(dashboardMarkup, /conflictList|conflictItem|Own inclusion choice|Peer exclusion choice|Screening conflict paper|Full text conflict paper|Private other project paper/,
        `${role}, blind=${blindMode}: overview links to conflicts without listing them`);
      passed++;

      for (const stage of ["title_abstract", "full_text"]) {
        const emptyMarkup = render(ConflictsSection, { ...conflictsProps, stage, workflowConflicts: [] });
        assert.doesNotMatch(emptyMarkup, /class="conflictItem"/);
        assert.match(emptyMarkup, /No .*conflicts/i, `${role}, ${stage}: empty conflicts have a useful state`);
        assert.match(emptyMarkup, new RegExp(`href="[^"]+/${stage === "title_abstract" ? "screening" : "full-text"}"`), `${role}, ${stage}: empty conflicts return to their queue`);
        passed++;
      }

      const unavailableMarkup = render(ConflictsSection, { ...conflictsProps, canOpenConflict: () => false });
      assert.match(unavailableMarkup, /Screening conflict paper/, "reserved conflicts remain visible in the list");
      assert.match(unavailableMarkup, /Currently unavailable in your review queue\./);
      assert.match(unavailableMarkup, /<span(?=[^>]*aria-disabled="true")(?=[^>]*role="link")[^>]*>/,
        "a conflict unavailable to this reviewer cannot open an unrelated queue item");
      passed++;

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

  for (const stage of ["title_abstract", "full_text"]) {
    for (const blindMode of [true, false]) {
      const currentUserId = "grouping-reviewer";
      const vote = (id, userId, isCurrent = true) => ({
        id, projectId: project.id, studyId: study.id, stage,
        ...(stage === "full_text" ? { reportId: report.id } : {}),
        userId, userName: userId, decisionValue: "include", isCurrent,
        createdAt: "2026-10-24T10:00:00.000Z"
      });
      const conflict = (id, title, decisions) => ({
        id, projectId: project.id, stage, studyId: study.id,
        ...(stage === "full_text" ? { reportId: report.id } : {}),
        title, subtitle: "Batch provenance", decisions
      });
      const ownFirst = conflict("own-first", "First prior vote", [vote("own-current", currentUserId)]);
      const peerOnly = conflict("peer-only", "Fresh independent review", blindMode ? [] : [vote("peer-current", "another-reviewer")]);
      const ownSecond = conflict("own-second", "Second prior vote", [vote("own-current-second", currentUserId)]);
      const ownHistorical = conflict("own-historical", "Reopened independent review", [vote("own-old", currentUserId, false)]);
      const props = {
        selectedProject: { ...project, blindMode }, currentUserId, stage,
        workflowConflicts: [ownFirst, peerOnly, ownSecond, ownHistorical],
        openConflict: noop, canOpenConflict: () => true,
        formatConflictStage: String, decisionTone: () => "info", formatDecision, onBackToQueue: noop
      };
      const context = `${stage}, blind=${blindMode}`;
      const markup = render(ConflictsSection, props);
      const cards = markup.match(/<section\b[^>]*>[\s\S]*?<\/section>/g) ?? [];
      const primaryIndex = cards.findIndex(card => card.includes("<h2>Conflict Resolution</h2>"));
      const ownIndex = cards.findIndex(card => card.includes("<h2>Conflicts you voted on</h2>"));
      assert.ok(primaryIndex >= 0 && ownIndex > primaryIndex, `${context}: own conflicts have a separate lower card`);
      const primaryCard = cards[primaryIndex], ownCard = cards[ownIndex];
      assert.match(primaryCard, /<h3>Fresh independent review<\/h3>/);
      assert.match(primaryCard, /<h3>Reopened independent review<\/h3>/, `${context}: historical votes do not place an item among current own votes`);
      assert.doesNotMatch(primaryCard, /<h3>(?:First|Second) prior vote<\/h3>/);
      assert.match(ownCard, /<h3>First prior vote<\/h3>/);
      assert.match(ownCard, /<h3>Second prior vote<\/h3>/);
      assert.doesNotMatch(ownCard, /<h3>(?:Fresh|Reopened) independent review<\/h3>/);
      assert.match(primaryCard, /2 open<\/span>/);
      assert.match(ownCard, /2 open<\/span>/);
      assert.equal((ownCard.match(/<article class="conflictItem ownConflictItem"/g) ?? []).length, 2,
        `${context}: own rows carry their muted presentation marker`);
      assert.doesNotMatch(primaryCard, /ownConflictItem/, `${context}: fresh reviews retain their regular appearance`);
      assert.ok(primaryCard.indexOf("Fresh independent review") < primaryCard.indexOf("Reopened independent review"));
      assert.ok(ownCard.indexOf("First prior vote") < ownCard.indexOf("Second prior vote"));
      for (const item of props.workflowConflicts) {
        assert.equal(markup.split(`<h3>${item.title}</h3>`).length - 1, 1, `${context}: each conflict appears once`);
      }

      const allOwnMarkup = render(ConflictsSection, { ...props, workflowConflicts: [ownFirst, ownSecond] });
      assert.match(allOwnMarkup, /<h2>Conflicts you voted on<\/h2>/);
      assert.match(allOwnMarkup, /First prior vote/);
      assert.match(allOwnMarkup, /Second prior vote/);
      assert.doesNotMatch(allOwnMarkup, /There are no unresolved conflicts in this|<h3>No (?:full text|screening) conflicts<\/h3>/,
        `${context}: own unresolved conflicts do not produce a globally empty phase message`);
      const othersOnlyMarkup = render(ConflictsSection, { ...props, workflowConflicts: [peerOnly, ownHistorical] });
      assert.doesNotMatch(othersOnlyMarkup, /Conflicts you voted on|ownConflictItem/,
        `${context}: an empty own-vote card is omitted`);
      const emptyMarkup = render(ConflictsSection, { ...props, workflowConflicts: [] });
      assert.doesNotMatch(emptyMarkup, /Conflicts you voted on|<article class="conflictItem/);
      assert.match(emptyMarkup, /There are no unresolved conflicts in this/);
      passed++;
    }
  }

  function elements(node, result = []) {
    if (Array.isArray(node)) node.forEach(child => elements(child, result));
    else if (node?.props) {
      result.push(node);
      elements(node.props.children, result);
    }
    return result;
  }
  for (const stage of ["title_abstract", "full_text"]) {
    const conflict = {
      id: `${stage}-selection`, projectId: project.id, stage, studyId: study.id,
      ...(stage === "full_text" ? { reportId: report.id } : {}),
      title: "Choose this paper", subtitle: "Import metadata", decisions: []
    };
    let openedConflict, returnedToQueue = false;
    const tree = ConflictsSection({
      selectedProject: project, currentUserId: "reviewer", stage, workflowConflicts: [conflict],
      openConflict: selected => openedConflict = selected, canOpenConflict: () => true,
      formatConflictStage: String, decisionTone: () => "info", formatDecision,
      onBackToQueue: () => returnedToQueue = true
    });
    const row = elements(tree).find(element => element.props.className === "conflictItem");
    const rowLink = elements(row).find(element => element.props.view);
    assert.equal(rowLink.props.view, stage === "full_text" ? "fullText" : "screening");
    rowLink.props.onNavigate();
    assert.equal(openedConflict, conflict, `${stage}: Resolve selects the chosen conflict rather than the first queue item`);
    const backLink = elements(tree).find(element => element.props.view);
    backLink.props.onNavigate();
    assert.equal(returnedToQueue, true, `${stage}: back action returns to its queue`);
    passed++;
  }

  console.log(`Conflict UI privacy and reservations: ${passed} rendering checks passed.`);
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
