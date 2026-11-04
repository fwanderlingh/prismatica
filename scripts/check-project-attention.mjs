import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-project-attention-"));
const originalResolve = Module._resolveFilename;

try {
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
    noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
    typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
    paths: { "@/*": [path.join(root, "*")] }
  }, files: [
    "lib/projectAttention.ts", "lib/exportConsistency.ts", "lib/workflowSelectors.ts",
    "components/review-sections/app-sidebar.tsx", "components/review-sections/project-dashboard-section.tsx"
  ].map(name => path.join(root, name)) }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { NavigationProvider, ViewLink } = require(path.join(temp, "components/navigation-link.js"));
  const { AppSidebar } = require(path.join(temp, "components/review-sections/app-sidebar.js"));
  const { ProjectDashboardSection } = require(path.join(temp, "components/review-sections/project-dashboard-section.js"));
  const { getProjectAttention, getNavigationAttention } = require(path.join(temp, "lib/projectAttention.js"));
  const { getPendingReviewWorkCounts, getActiveTitleAbstractStudies, getActiveFullTextReports } = require(path.join(temp, "lib/workflowSelectors.js"));
  const { getExportConsistency } = require(path.join(temp, "lib/exportConsistency.js"));
  const data = require(path.join(temp, "lib/prismaData.js"));
  const icons = require("lucide-react");
  const project = {
    ...data.reviewProjects[0], id: "attention-review", stage: "extraction", recordsTotal: 128,
    recordsScreened: 128, studiesIncluded: 102,
    exclusionReasons: ["Full text not available", "Not in English"]
  };
  const studies = [0, 1].map(index => ({
    ...data.screeningStudies[0], id: `study-${index}`, projectId: project.id,
    stage: "full_text", titleAbstractStatus: "advance_full_text"
  }));
  const reports = studies.map((study, index) => ({
    ...data.reportQueue[0], id: `report-${index}`, projectId: project.id, studyId: study.id,
    retrievalStatus: "retrieved", fullTextStatus: "excluded_full_text", fullTextVoteCount: 2,
    fullTextExclusionReasonId: index === 0 ? "full text not available" : "Not in Eglish"
  }));
  const counts = {
    ...data.prismaCounts, recordsIdentifiedDatabase: 128, recordsIdentifiedRegisters: 0, recordsIdentifiedOther: 0,
    duplicateRecordsRemoved: 0, automationRemoved: 0, removedOtherReasons: 0,
    recordsScreened: 128, recordsExcluded: 0, reportsSought: 128, reportsNotRetrieved: 0, reportsAssessed: 128,
    reportsExcludedWithReasons: { "Full text not available": 12, "Not in English": 12 },
    studiesIncluded: 102, studiesExtracted: 102
  };
  const consistency = getExportConsistency({ project, counts, studies, reports, decisions: [] });
  assert.equal(consistency.failedCount, 2);
  assert.equal(consistency.assessedBalanceTotal, 126);
  const input = { counts, consistency, pendingConsensusCount: 1 };
  const attention = getProjectAttention(input);
  assert.deepEqual(attention.map(item => [item.phase, item.view, item.count]), [
    ["fullText", "fullText", 2], ["consensus", "consensus", 1], ["exports", "exports", 2]
  ], "the DMPC failure shape identifies the responsible phases rather than only the export page");
  const exportAttention = attention.find(item => item.phase === "exports");
  assert.match(exportAttention.detail, /eligibility totals, exclusion reasons/);
  assert.match(exportAttention.detail, /128 assessed; 126 accounted for/);

  const noop = () => {};
  const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = node => node == null ? "" : typeof node === "string" || typeof node === "number" ? String(node)
    : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
  const render = (Component, props) => renderToStaticMarkup(React.createElement(
    NavigationProvider, { projectId: project.id }, React.createElement(Component, props)
  ));
  const projectNavItems = [
    ["imports", "Imports", icons.Import], ["dedup", "Dedup", icons.GitMerge],
    ["screening", "Screening", icons.FileSearch], ["fullText", "Full text", icons.BookOpen],
    ["extraction", "Extraction", icons.ClipboardCheck], ["consensus", "Consensus", icons.GitMerge],
    ["exports", "Exports", icons.Download], ["settings", "Settings", icons.Settings]
  ].map(([key, label, Icon]) => ({ key, label, Icon, path: "" }));
  const sidebarProps = {
    brandName: "Prismatica", brandTagline: "Reviews", brandLogoAlt: "Home",
    isSidebarCollapsed: false, isMobileNavOpen: false, isProjectView: true, activeView: "fullTextReviewed",
    currentUser: { id: project.ownerId, initials: "RO", avatarColor: "#456" }, selectedProject: project,
    globalNavItems: [{ key: "dashboard", label: "Home", path: "/dashboard", Icon: icons.Home }],
    projectNavItems, reviewPhaseNavKeys: new Set(["imports", "dedup", "screening", "fullText", "extraction", "consensus"]),
    exportFailedCount: consistency.failedCount, attentionItems: attention,
    getPhaseNavState: key => ["imports", "dedup", "screening", "fullText"].includes(key) ? "done" : key === "exports" ? null : "current",
    canNavigateToProjectView: () => true,
    onGoDashboard: noop, onNavigate: noop, onToggleSidebar: noop, onToggleMobileNav: noop
  };
  const sidebarTree = AppSidebar(sidebarProps);
  const navLinks = nodes(sidebarTree).filter(node => node.type === ViewLink);
  for (const [phase, label] of [["fullText", "Full text"], ["consensus", "Consensus"], ["exports", "Exports"]]) {
    const link = navLinks.find(node => node.props.view === phase);
    assert.ok(link);
    assert.match(link.props.className, /navItemAttention/);
    assert.ok(link.props["aria-label"].startsWith(`${label} — Needs attention:`));
    assert.match(link.props["data-tooltip"], /Needs attention/);
    assert.equal(nodes(link).filter(node => node.props?.className === "navAttentionIcon").length, 1);
    assert.equal(nodes(link).filter(node => node.props?.className === "navPhaseMarker").length, 0,
      "the warning replaces the completion dot so a completed phase does not look settled");
  }
  const screeningLink = navLinks.find(node => node.props.view === "screening");
  assert.equal(screeningLink.props["aria-label"], "Screening", "unaffected phases retain their accessible labels");
  assert.doesNotMatch(screeningLink.props.className, /navItemAttention/);
  const fullTextLink = navLinks.find(node => node.props.view === "fullText");
  assert.equal(fullTextLink.props["aria-current"], "page", "reviewed subpages still select the parent phase");
  const sidebarHtml = render(AppSidebar, sidebarProps);
  assert.equal((sidebarHtml.match(/class="[^"]*navAttentionIcon/g) ?? []).length, 3);
  assert.match(sidebarHtml, /aria-label="Full text — Needs attention:[^"]+"[^>]*href="[^"]+\/full-text"/);
  assert.match(sidebarHtml, /aria-label="Consensus — Needs attention:[^"]+"[^>]*href="[^"]+\/extraction\/consensus"/);
  assert.match(sidebarHtml, /aria-label="Exports — Needs attention:[^"]+"[^>]*href="[^"]+\/exports"/);
  for (const [isSidebarCollapsed, isMobileNavOpen] of [[true, false], [false, true]]) {
    const html = render(AppSidebar, { ...sidebarProps, isSidebarCollapsed, isMobileNavOpen });
    assert.equal((html.match(/class="[^"]*navAttentionIcon/g) ?? []).length, 3,
      "collapsed desktop and mobile navigation retain the warning marker");
    assert.match(html, isSidebarCollapsed ? /class="sidebar collapsed"/ : /class="sidebar open"/);
  }

  let destination;
  const overviewProps = {
    selectedProject: project, currentUserId: project.ownerId, workflowConflicts: [], recordsIdentified: 128,
    activeCounts: counts, exportFailedCount: 2, pendingConsensusCount: 1, finalizedConsensusCount: 101,
    attentionItems: attention, projectEvents: [], latestProjectEvents: [], projectUserStats: [],
    projectScreeningStudies: studies, projectReportQueue: reports,
    getWorkflowStepState: () => "complete", formatProjectPhase: String, projectPhaseStatusTone: () => "info",
    formatMaybePolicy: String, formatAuditEntityLabel: String, formatAuditTime: String, formatNumber: String,
    onOpenSettings: noop, onOpenAudit: noop, onNavigate: view => destination = view
  };
  const overviewTree = ProjectDashboardSection(overviewProps);
  const notice = nodes(overviewTree).find(node => node.props?.className === "projectAttention");
  assert.ok(notice);
  assert.match(text(notice), /Needs attention/);
  assert.match(text(notice), /2 full-text exclusion reasons need correction/);
  assert.match(text(notice), /1 consensus record needs finalization/);
  assert.match(text(notice), /128 assessed; 126 accounted for/);
  const noticeLinks = nodes(notice).filter(node => node.type === ViewLink);
  assert.deepEqual(noticeLinks.map(node => node.props.view), ["fullText", "consensus", "exports"]);
  for (const link of noticeLinks) {
    destination = undefined;
    link.props.onNavigate();
    assert.equal(destination, link.props.view, "each short notice navigates to its own corrective action");
  }
  const overviewHtml = render(ProjectDashboardSection, overviewProps);
  for (const suffix of ["full-text", "extraction/consensus", "exports"]) {
    assert.match(overviewHtml, new RegExp(`class="projectAttentionLink"[^>]*href="[^\"]+/${suffix}"`));
  }

  const correctedCounts = { ...counts, reportsExcludedWithReasons: { "Full text not available": 13, "Not in English": 13 } };
  const correctedReports = reports.map((report, index) => ({ ...report, fullTextExclusionReasonId: project.exclusionReasons[index] }));
  const correctedConsistency = getExportConsistency({ project, counts: correctedCounts, studies, reports: correctedReports, decisions: [] });
  assert.equal(correctedConsistency.failedCount, 0);
  const afterReasons = getProjectAttention({ ...input, counts: correctedCounts, consistency: correctedConsistency });
  assert.deepEqual(afterReasons.map(item => item.phase), ["consensus"], "reason corrections clear both the full-text and export warning automatically");
  const settled = getProjectAttention({ counts: correctedCounts, consistency: correctedConsistency, pendingConsensusCount: 0 });
  assert.deepEqual(settled, []);
  assert.doesNotMatch(render(AppSidebar, { ...sidebarProps, attentionItems: settled, exportFailedCount: 0 }), /navAttentionIcon|navItemAttention/);
  assert.doesNotMatch(render(ProjectDashboardSection, { ...overviewProps, attentionItems: settled, exportFailedCount: 0 }), /projectAttention|Needs attention/);

  const phaseAccess = { fullText: false, extraction: false, consensus: false };
  const locked = getProjectAttention({ ...input, phaseAccess });
  assert.deepEqual(locked.map(item => item.phase), ["exports"], "future phases stay quiet until they can be acted on");
  const lockedTree = AppSidebar({ ...sidebarProps, attentionItems: locked, canNavigateToProjectView: key => phaseAccess[key] !== false });
  const lockedConsensus = nodes(lockedTree).find(node => node.type === ViewLink && node.props.view === "consensus");
  assert.equal(lockedConsensus.props.disabled, true);
  assert.equal(lockedConsensus.props["aria-disabled"], true);
  assert.equal(lockedConsensus.props["aria-label"], "Consensus");
  assert.doesNotMatch(lockedConsensus.props.className, /navItemAttention/);
  assert.deepEqual(getProjectAttention({ counts: { ...correctedCounts, studiesIncluded: 0 }, consistency: correctedConsistency }), [],
    "empty reviews do not warn about future review work");

  const fullTextPending = getProjectAttention({ counts: correctedCounts, consistency: correctedConsistency, pendingFullTextCount: 1 });
  assert.deepEqual(fullTextPending, [], "ordinary full-text review remains progress rather than an attention warning");
  assert.deepEqual(getProjectAttention({ counts: correctedCounts, consistency: correctedConsistency, pendingFullTextCount: 0 }), [],
    "completed full-text decisions do not introduce an attention warning");
  assert.deepEqual(getProjectAttention({ counts: { ...correctedCounts, studiesExtracted: 2 }, consistency: correctedConsistency }), [],
    "ordinary remaining extraction submissions do not create an attention warning");
  for (const [check, phase] of [
    ["identifiedCheckOk", "imports"], ["screenedCheckOk", "screening"],
    ["retrievalCheckOk", "fullText"], ["assessedCheckOk", "fullText"], ["exclusionReasonCheckOk", "fullText"]
  ]) {
    const imbalance = getProjectAttention({
      counts: correctedCounts, consistency: { ...correctedConsistency, [check]: false, failedCount: 1 }
    });
    assert.deepEqual(imbalance.map(item => [item.phase, item.view]), [[phase, "exports"], ["exports", "exports"]],
      `${check}: a balance warning with no repairable queue items still marks its responsible phase and links the consistency checks`);
  }

  const conflicts = getProjectAttention({
    counts: correctedCounts, consistency: { ...correctedConsistency, unresolvedScreeningStudies: [{ id: "screening-conflict" }] },
    screeningConflictCount: 1, fullTextConflictCount: 2
  });
  assert.deepEqual(conflicts.map(item => [item.phase, item.view]), [["screening", "screeningConflicts"], ["fullText", "fullTextConflicts"]]);
  const conflictOverview = ProjectDashboardSection({ ...overviewProps, attentionItems: conflicts });
  const conflictNotices = nodes(conflictOverview).find(node => node.props?.className === "projectAttention");
  assert.deepEqual(nodes(conflictNotices).filter(node => node.type === ViewLink).map(node => node.props.view), ["screeningConflicts", "fullTextConflicts"]);

  const reviewerWithWork = "reviewer-with-work";
  const reviewerFinished = "reviewer-finished";
  const personalProject = { ...project, abstractRequiredVotes: 2, fullTextRequiredVotes: 2, maybePolicy: "third_vote", blindMode: true };
  const personalStudies = [
    { ...studies[0], id: "personal-screening", stage: "title_abstract", titleAbstractStatus: "awaiting_votes", titleAbstractVoteCount: 1,
      titleAbstractActiveViewerCount: 1, titleAbstractCheckedOutByCurrentUser: false },
    { ...studies[0], id: "personal-conflict", stage: "title_abstract", titleAbstractStatus: "conflict", titleAbstractVoteCount: 2 },
    { ...studies[0], id: "personal-third-vote", stage: "title_abstract", titleAbstractStatus: "needs_third_vote", titleAbstractVoteCount: 2 },
    { ...studies[0], id: "personal-completed", titleAbstractStatus: "advance_full_text", titleAbstractVoteCount: 2 },
    { ...studies[0], id: "personal-at-minimum", stage: "title_abstract", titleAbstractStatus: "awaiting_votes", titleAbstractVoteCount: 2 },
    { ...studies[0], id: "foreign-screening", projectId: "another-project", stage: "title_abstract", titleAbstractStatus: "awaiting_votes", titleAbstractVoteCount: 0 }
  ];
  const personalReports = ["not_sought", "sought", "retrieved"].map((retrievalStatus, index) => ({
    ...reports[0], id: `personal-report-${index}`, studyId: `personal-full-text-${index}`, retrievalStatus,
    fullTextStatus: "awaiting_votes", fullTextVoteCount: 1, fullTextExclusionReasonId: undefined,
    fullTextActiveViewerCount: 1, fullTextCheckedOutByCurrentUser: false
  }));
  personalReports.push(
    { ...personalReports[2], id: "personal-full-text-conflict", fullTextStatus: "conflict", fullTextVoteCount: 2 },
    { ...personalReports[2], id: "personal-full-text-manual", fullTextStatus: "manual_review", fullTextVoteCount: 2 },
    { ...personalReports[2], id: "personal-full-text-completed", fullTextStatus: "advance_extraction", fullTextVoteCount: 2 },
    { ...personalReports[2], id: "personal-full-text-at-minimum", fullTextVoteCount: 2 },
    { ...personalReports[2], id: "personal-full-text-unavailable", retrievalStatus: "not_retrieved", fullTextVoteCount: 0 },
    { ...personalReports[2], id: "foreign-full-text", projectId: "another-project", fullTextVoteCount: 0 }
  );
  const decision = (id, studyId, stage, userId, extra = {}) => ({
    id, projectId: project.id, studyId, stage, userId, userName: userId,
    decisionValue: "include", isCurrent: true, createdAt: "2026-01-01T00:00:00Z", ...extra
  });
  const personalDecisions = [
    decision("own-screening", "personal-screening", "title_abstract", reviewerFinished),
    ...personalReports.slice(0, 3).map(report => decision(`own-${report.id}`, report.studyId, "full_text", reviewerFinished, { reportId: report.id })),
    decision("historic-screening", "personal-screening", "title_abstract", reviewerWithWork, { isCurrent: false }),
    decision("foreign-screening-vote", "personal-screening", "title_abstract", reviewerWithWork, { projectId: "another-project" }),
    decision("other-stage-vote", "personal-screening", "full_text", reviewerWithWork),
    decision("historic-full-text", personalReports[2].studyId, "full_text", reviewerWithWork, { reportId: personalReports[2].id, isCurrent: false }),
    decision("foreign-full-text-vote", personalReports[2].studyId, "full_text", reviewerWithWork, { reportId: personalReports[2].id, projectId: "another-project" }),
    decision("screening-only-vote", personalReports[2].studyId, "title_abstract", reviewerWithWork)
  ];
  const workRemaining = getPendingReviewWorkCounts(personalProject, personalStudies, personalReports, personalDecisions, reviewerWithWork);
  const ownVotesFinished = getPendingReviewWorkCounts(personalProject, personalStudies, personalReports, personalDecisions, reviewerFinished);
  assert.deepEqual(workRemaining, { screening: 1, fullText: 3 },
    "only unfinished ordinary work without this reviewer's current vote counts; retrieval remains normal full-text work");
  assert.deepEqual(ownVotesFinished, { screening: 0, fullText: 0 },
    "a reviewer who already voted has no ordinary work while waiting for peers");
  assert.equal(getActiveTitleAbstractStudies(personalProject, [personalStudies[0]], personalDecisions, reviewerWithWork).length, 0);
  assert.equal(getActiveFullTextReports(personalProject, [personalReports[2]], personalDecisions, reviewerWithWork).length, 0);
  assert.deepEqual(getPendingReviewWorkCounts(personalProject,
    personalStudies.map(study => ({ ...study, titleAbstractActiveViewerCount: 0 })),
    personalReports.map(report => ({ ...report, fullTextActiveViewerCount: 0 })), personalDecisions, reviewerWithWork), workRemaining,
  "temporary peer checkouts cannot make an unfinished personal queue appear conflict-only");
  const blindCompleteStudy = { ...personalStudies[0], titleAbstractStatus: "advance_full_text", titleAbstractVoteCount: 2 };
  const blindCompleteReport = { ...personalReports[2], fullTextStatus: "advance_extraction", fullTextVoteCount: 2 };
  assert.deepEqual(getPendingReviewWorkCounts(personalProject, [blindCompleteStudy], [blindCompleteReport], [], reviewerWithWork), { screening: 0, fullText: 0 },
    "blind-review aggregates prevent hidden peer decisions from reopening completed work");
  assert.deepEqual(getPendingReviewWorkCounts(personalProject,
    [{ ...personalStudies[0], titleAbstractStatus: undefined, titleAbstractVoteCount: undefined }],
    [{ ...personalReports[2], fullTextStatus: undefined, fullTextVoteCount: undefined }], personalDecisions, reviewerWithWork), { screening: 1, fullText: 1 },
  "snapshots without aggregate metadata fall back to current stage-specific votes");
  assert.deepEqual(getPendingReviewWorkCounts(personalProject,
    [{ ...personalStudies[0], titleAbstractVoteCount: 2, titleAbstractRequiredVotes: 3 }],
    [{ ...personalReports[2], fullTextVoteCount: 2, fullTextRequiredVotes: 3 }], [], reviewerWithWork), { screening: 1, fullText: 1 },
  "per-record minimum votes determine whether ordinary review remains");

  const quietNavigation = getNavigationAttention(conflicts, workRemaining);
  const conflictOnlyNavigation = getNavigationAttention(conflicts, ownVotesFinished);
  assert.deepEqual(quietNavigation, [], "conflicts do not warn reviewers who still have ordinary work");
  assert.deepEqual(conflictOnlyNavigation, conflicts, "the same project warns reviewers whose ordinary work is finished");
  assert.deepEqual(getNavigationAttention(conflicts, { screening: 1, fullText: 0 }).map(item => item.view), ["fullTextConflicts"],
    "ordinary screening work only suppresses that phase's conflict warning");
  assert.deepEqual(getNavigationAttention(conflicts, { screening: 0, fullText: 1 }).map(item => item.view), ["screeningConflicts"]);
  assert.deepEqual(conflicts.map(item => item.view), ["screeningConflicts", "fullTextConflicts"],
    "personal navbar filtering leaves project-wide conflict attention intact");
  for (const [isSidebarCollapsed, isMobileNavOpen] of [[false, false], [true, false], [false, true]]) {
    for (const [attentionItems, hasWarning] of [[quietNavigation, false], [conflictOnlyNavigation, true]]) {
      const props = { ...sidebarProps, isSidebarCollapsed, isMobileNavOpen, attentionItems, exportFailedCount: 0 };
      const tree = AppSidebar(props);
      for (const [phase, label] of [["screening", "Screening"], ["fullText", "Full text"]]) {
        const link = nodes(tree).find(node => node.type === ViewLink && node.props.view === phase);
        assert.equal(link.props.className.includes("navItemAttention"), hasWarning);
        assert.equal(link.props["aria-label"].includes("Needs attention"), hasWarning);
        assert.equal(link.props["data-tooltip"], link.props["aria-label"]);
        assert.equal(nodes(link).filter(node => node.props?.className === "navAttentionIcon").length, Number(hasWarning));
        if (hasWarning) assert.match(link.props.title, /Needs attention/);
        else {
          assert.equal(link.props["aria-label"], label);
          assert.doesNotMatch(link.props.title, /conflict|Needs attention/i);
          const linkHtml = renderToStaticMarkup(React.createElement(NavigationProvider, { projectId: project.id }, link));
          assert.match(linkHtml, /class="navPhaseMarker"/,
            "clearing the personal warning restores the phase marker on desktop and mobile");
        }
      }
      const html = render(AppSidebar, props);
      assert.equal((html.match(/class="[^\"]*navAttentionIcon/g) ?? []).length, hasWarning ? 2 : 0);
    }
  }
  const projectConflictHtml = render(ProjectDashboardSection, { ...overviewProps, attentionItems: conflicts });
  assert.match(projectConflictHtml, /1 screening conflict needs resolution/);
  assert.match(projectConflictHtml, /2 full-text conflicts need resolution/);
  const consistencyDuringWork = getProjectAttention({
    counts: correctedCounts, consistency: { ...correctedConsistency, screenedCheckOk: false, failedCount: 1 }
  });
  assert.deepEqual(getNavigationAttention(consistencyDuringWork, workRemaining), consistencyDuringWork,
    "real reporting inconsistencies remain visible while ordinary review work is pending");
  const conflictsWithImbalances = getProjectAttention({
    counts: correctedCounts, screeningConflictCount: 1, fullTextConflictCount: 2,
    consistency: { ...correctedConsistency, screenedCheckOk: false, assessedCheckOk: false, failedCount: 2,
      screenBalanceTotal: correctedCounts.recordsScreened + 1, assessedBalanceTotal: correctedCounts.reportsAssessed + 1 }
  });
  const imbalancesDuringWork = getNavigationAttention(conflictsWithImbalances, workRemaining);
  assert.deepEqual(imbalancesDuringWork.map(item => [item.phase, item.view]), [
    ["screening", "exports"], ["fullText", "exports"], ["exports", "exports"]
  ], "a phase's genuine consistency warning survives when its simultaneous conflict warning is suppressed");
  const imbalancedTree = AppSidebar({ ...sidebarProps, attentionItems: imbalancesDuringWork });
  for (const phase of ["screening", "fullText"]) {
    const link = nodes(imbalancedTree).find(node => node.type === ViewLink && node.props.view === phase);
    assert.match(link.props["aria-label"], /Needs attention/);
    assert.doesNotMatch(link.props["aria-label"], /conflict/i);
  }
  assert.deepEqual(getNavigationAttention(attention, workRemaining), attention,
    "reason corrections, consensus finalization, and export checks are unaffected by personal conflict filtering");

  // Underwater Manipulation has a large normal screening queue and a small set
  // of actual conflicts. A temporary balance deficit must not relabel the queue
  // as either an attention notice or an export integrity warning.
  const underwaterStudies = Array.from({ length: 526 }, (_, index) => ({
    ...studies[0], id: `underwater-${index}`, stage: "title_abstract", titleAbstractStatus: "awaiting_votes"
  }));
  const underwaterCounts = {
    ...correctedCounts, recordsIdentifiedDatabase: 800, recordsScreened: 500, recordsExcluded: 200,
    reportsSought: 0, reportsNotRetrieved: 0, reportsAssessed: 0,
    reportsExcludedWithReasons: {}, studiesIncluded: 0, studiesExtracted: 0
  };
  const underwaterConsistency = getExportConsistency({ project, counts: underwaterCounts, studies: underwaterStudies, reports: [], decisions: [] });
  assert.equal(underwaterConsistency.unresolvedScreeningStudies.length, 526);
  assert.equal(underwaterConsistency.failedCount, 1, "the Exports page retains its raw in-progress consistency calculation");
  const underwaterInput = { counts: underwaterCounts, consistency: underwaterConsistency };
  const normalScreening = getProjectAttention(underwaterInput);
  assert.deepEqual(normalScreening, [], "526 ordinary screening records do not need attention");
  assert.equal(underwaterConsistency.failedCount, 1, "attention filtering never rewrites raw PRISMA check results");
  assert.doesNotMatch(render(ProjectDashboardSection, { ...overviewProps, attentionItems: normalScreening }), /projectAttention|Needs attention/);
  const normalScreeningSidebar = AppSidebar({ ...sidebarProps, activeView: "screening", attentionItems: normalScreening, exportFailedCount: 0 });
  const normalScreeningLink = nodes(normalScreeningSidebar).find(node => node.type === ViewLink && node.props.view === "screening");
  assert.doesNotMatch(normalScreeningLink.props.className, /navItemAttention/);
  const normalScreeningLinkHtml = render(AppSidebar, { ...sidebarProps, activeView: "screening", attentionItems: normalScreening, exportFailedCount: 0 })
    .match(/<a(?=[^>]*aria-label="Screening")[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
  assert.match(normalScreeningLinkHtml, /class="navPhaseMarker"/, "normal screening keeps its phase progress marker");

  const underwaterConflicts = getProjectAttention({ ...underwaterInput, screeningConflictCount: 10 });
  assert.deepEqual(underwaterConflicts.map(item => [item.phase, item.view, item.count]), [["screening", "screeningConflicts", 10]]);
  assert.match(underwaterConflicts[0].label, /^10 screening conflicts need resolution\.$/);
  assert.doesNotMatch(underwaterConflicts[0].label, /526|final decision/);
  const underwaterOverview = ProjectDashboardSection({ ...overviewProps, attentionItems: underwaterConflicts });
  const underwaterNotice = nodes(underwaterOverview).find(node => node.props?.className === "projectAttention");
  assert.match(text(underwaterNotice), /10 screening conflicts need resolution/);
  assert.doesNotMatch(text(underwaterNotice), /526|screening records need a final decision|Screening totals/);
  const underwaterConflictLink = nodes(underwaterNotice).find(node => node.type === ViewLink);
  destination = undefined;
  underwaterConflictLink.props.onNavigate();
  assert.equal(destination, "screeningConflicts", "the conflict notice opens the conflict list directly");
  assert.match(render(ProjectDashboardSection, { ...overviewProps, attentionItems: underwaterConflicts }), /class="projectAttentionLink"[^>]*href="[^\"]+\/screening\/conflicts"/);
  const underwaterSidebar = AppSidebar({ ...sidebarProps, activeView: "screening", attentionItems: underwaterConflicts, exportFailedCount: 0 });
  const underwaterSidebarLink = nodes(underwaterSidebar).find(node => node.type === ViewLink && node.props.view === "screening");
  assert.match(underwaterSidebarLink.props["aria-label"], /10 screening conflicts need resolution/);
  assert.doesNotMatch(underwaterSidebarLink.props["aria-label"], /526/);
  assert.equal(nodes(underwaterSidebarLink).filter(node => node.props?.className === "navAttentionIcon").length, 1);

  for (const recordsScreened of [100, 799]) {
    const changedCounts = { ...underwaterCounts, recordsScreened };
    const changedConsistency = getExportConsistency({ project, counts: changedCounts, studies: underwaterStudies, reports: [], decisions: [] });
    const actualImbalance = getProjectAttention({ counts: changedCounts, consistency: changedConsistency });
    assert.deepEqual(actualImbalance.map(item => item.phase), ["screening", "exports"],
      "negative screening gaps or deficits larger than the normal unfinished queue remain integrity warnings");
  }

  const reviewReports = ["not_sought", "sought", "retrieved"].map((retrievalStatus, index) => ({
    ...reports[0], id: `ongoing-report-${index}`, studyId: `ongoing-study-${index}`, retrievalStatus,
    fullTextStatus: "awaiting_votes", fullTextVoteCount: index === 2 ? 1 : 0, fullTextExclusionReasonId: undefined
  }));
  const reviewStudies = reviewReports.map((report, index) => ({
    ...studies[0], id: report.studyId, title: `Ongoing full text ${index}`, titleAbstractStatus: "advance_full_text"
  }));
  const ongoingCounts = {
    ...correctedCounts, recordsIdentifiedDatabase: 3, recordsScreened: 3, recordsExcluded: 0,
    reportsSought: 2, reportsAssessed: 1, reportsNotRetrieved: 0,
    reportsExcludedWithReasons: {}, studiesIncluded: 0, studiesExtracted: 0
  };
  const getOngoingConsistency = currentCounts => getExportConsistency({ project, counts: currentCounts, studies: reviewStudies, reports: reviewReports, decisions: [] });
  const ongoingConsistency = getOngoingConsistency(ongoingCounts);
  assert.equal(ongoingConsistency.failedCount, 2);
  assert.equal(ongoingConsistency.pendingRetrievalReports.length, 1);
  assert.deepEqual(getProjectAttention({ counts: ongoingCounts, consistency: ongoingConsistency, pendingFullTextCount: 2 }), [],
    "routine retrieval and eligibility decisions explain temporary full-text check deficits");
  const withFullTextConflict = getProjectAttention({ counts: ongoingCounts, consistency: ongoingConsistency, pendingFullTextCount: 1, fullTextConflictCount: 1 });
  assert.deepEqual(withFullTextConflict.map(item => [item.phase, item.view, item.count]), [["fullText", "fullTextConflicts", 1]],
    "full-text conflicts are still highlighted without warning about the ordinary pending queue");
  const noPendingVotes = getProjectAttention({ counts: ongoingCounts, consistency: ongoingConsistency, pendingFullTextCount: 0 });
  assert.deepEqual(noPendingVotes.map(item => item.phase), ["fullText", "exports"],
    "a not-sought report alone cannot explain a deficit among reports already sought or assessed");
  for (const changedCounts of [
    { ...ongoingCounts, recordsScreened: 2, reportsSought: 1, reportsAssessed: 2 },
    { ...ongoingCounts, recordsIdentifiedDatabase: 9, recordsScreened: 9, reportsSought: 8, reportsAssessed: 1 },
    { ...ongoingCounts, recordsIdentifiedDatabase: 9, recordsScreened: 9, reportsSought: 8, reportsAssessed: 8 }
  ]) {
    const actualImbalance = getProjectAttention({ counts: changedCounts, consistency: getOngoingConsistency(changedCounts), pendingFullTextCount: 2 });
    assert.deepEqual(actualImbalance.map(item => item.phase), ["fullText", "exports"],
      "opposite-sign or excessive full-text gaps remain visible during ordinary reviewing");
    assert.ok(actualImbalance.find(item => item.phase === "exports").count >= 1);
  }

  const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
  assert.match(css, /\.appFrame\.sidebar-collapsed\s+\.navItem[^{}]*\.navAttentionIcon\s*\{[^}]*position:\s*absolute/s,
    "collapsed warning is positioned over the phase icon instead of hidden with the normal completion dot");
  assert.match(css, /\.navItem[^{}]*\.navAttentionIcon\s*\{[^}]*color:\s*var\(--amber-text\)/s,
    "warning color follows semantic theme tokens");
  console.log("Project attention checks passed: normal review queues stay quiet, conflicts and genuine inconsistencies stay actionable, and sidebar/overview links clear correctly.");
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
