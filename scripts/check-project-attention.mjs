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
    "lib/projectAttention.ts", "lib/exportConsistency.ts",
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
  const { getProjectAttention } = require(path.join(temp, "lib/projectAttention.js"));
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
  const locked = getProjectAttention({ ...input, phaseAccess, pendingExtractionCount: 2 });
  assert.deepEqual(locked.map(item => item.phase), ["exports"], "future phases stay quiet until they can be acted on");
  const lockedTree = AppSidebar({ ...sidebarProps, attentionItems: locked, canNavigateToProjectView: key => phaseAccess[key] !== false });
  const lockedConsensus = nodes(lockedTree).find(node => node.type === ViewLink && node.props.view === "consensus");
  assert.equal(lockedConsensus.props.disabled, true);
  assert.equal(lockedConsensus.props["aria-disabled"], true);
  assert.equal(lockedConsensus.props["aria-label"], "Consensus");
  assert.doesNotMatch(lockedConsensus.props.className, /navItemAttention/);
  assert.deepEqual(getProjectAttention({ counts: { ...correctedCounts, studiesIncluded: 0 }, consistency: correctedConsistency, needsExtractionTemplate: true }), [],
    "empty reviews do not warn about a future extraction template");

  const fullTextPending = getProjectAttention({ counts: correctedCounts, consistency: correctedConsistency, pendingFullTextCount: 1 });
  assert.deepEqual(fullTextPending.map(item => [item.phase, item.view]), [["fullText", "fullText"]],
    "a retrieved report awaiting eligibility votes still marks Full text without requiring a conflict");
  assert.match(fullTextPending[0].label, /1 report.*full.text/i);
  assert.deepEqual(getProjectAttention({ counts: correctedCounts, consistency: correctedConsistency, pendingFullTextCount: 0 }), [],
    "the full-text attention clears after the final eligibility decision");
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

  const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
  assert.match(css, /\.appFrame\.sidebar-collapsed\s+\.navItem[^{}]*\.navAttentionIcon\s*\{[^}]*position:\s*absolute/s,
    "collapsed warning is positioned over the phase icon instead of hidden with the normal completion dot");
  assert.match(css, /\.navItem[^{}]*\.navAttentionIcon\s*\{[^}]*color:\s*var\(--amber-text\)/s,
    "warning color follows semantic theme tokens");
  console.log("Project attention checks passed: current issues, sidebar triangles, accessible links, collapsed/mobile navigation, phase gates, and automatic clearing.");
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
