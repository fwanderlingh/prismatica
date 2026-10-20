import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-export-consistency-"));
const originalResolve = Module._resolveFilename;

try {
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
    noEmitOnError: true, skipLibCheck: true, types: ["node", "react"], typeRoots: [path.join(root, "node_modules/@types")],
    rootDir: root, outDir: temp, paths: { "@/*": [path.join(root, "*")] }
  }, files: ["lib/workflowSelectors.ts", "lib/exportConsistency.ts", "components/review-sections/exports-section.tsx"].map(name => path.join(root, name)) }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };

  const { getCountsForProject } = require(path.join(temp, "lib/workflowSelectors.js"));
  const { getExportConsistency } = require(path.join(temp, "lib/exportConsistency.js"));
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ExportsSection } = require(path.join(temp, "components/review-sections/exports-section.js"));
  const { NavigationProvider, ViewLink } = require(path.join(temp, "components/navigation-link.js"));
  const seeds = require(path.join(temp, "lib/prismaData.js"));
  const project = {
    ...seeds.reviewProjects[0], id: "export-consistency-project", title: "Underwater review fixture",
    recordsTotal: 1, recordsScreened: 1, studiesIncluded: 0, abstractRequiredVotes: 2,
    fullTextRequiredVotes: 2, maybePolicy: "conflict", exclusionReasons: ["Wrong population"]
  };
  const study = (id, status, overrides = {}) => ({
    ...seeds.screeningStudies[0], id, projectId: project.id, title: `Study ${id}`,
    stage: status === "advance_full_text" ? "full_text" : "title_abstract",
    titleAbstractStatus: status, ...overrides
  });
  const report = (item, retrievalStatus = "not_sought", overrides = {}) => ({
    ...seeds.reportQueue[0], id: `report-${item.id}`, projectId: project.id, studyId: item.id,
    title: item.title, retrievalStatus, ...overrides
  });
  let nextDecision = 0;
  const vote = (item, decisionValue, overrides = {}) => ({
    id: `decision-${++nextDecision}`, projectId: project.id, studyId: item.id,
    stage: "title_abstract", userId: `reviewer-${nextDecision}`, userName: "Reviewer",
    decisionValue, isCurrent: true, createdAt: "2026-10-20T09:00:00Z", ...overrides
  });
  const calculate = ({ studies, reports = [], decisions = [], project: currentProject = project, dedupCandidates = [] }) => {
    const counts = getCountsForProject(currentProject, studies, reports, decisions, [], [], dedupCandidates);
    const consistency = getExportConsistency({ project: currentProject, counts, studies, reports, decisions });
    return { counts, consistency };
  };

  // The old 115-versus-114 warning came from omitting an advanced report whose
  // retrieval had not started. Its screening outcome is still settled.
  const underwaterStudies = Array.from({ length: 115 }, (_, index) => study(`underwater-${index}`,
    index === 114 ? "advance_full_text" : "excluded_abstract"));
  const pendingReport = report(underwaterStudies[114], "not_sought", { title: "Underwater report awaiting retrieval" });
  const underwaterInput = {
    project: { ...project, recordsTotal: 115, recordsScreened: 115 },
    studies: underwaterStudies, reports: [pendingReport]
  };
  const underwater = calculate(underwaterInput);
  assert.equal(underwater.counts.recordsExcluded, 114);
  assert.equal(underwater.counts.reportsSought, 0, "retrieval is not claimed before attempts start");
  assert.equal(underwater.consistency.reportsAdvancedToFullText, 1);
  assert.equal(underwater.consistency.screenBalanceTotal, 115);
  assert.equal(underwater.consistency.screenedCheckOk, true);
  assert.deepEqual(underwater.consistency.pendingRetrievalReports.map(item => [item.id, item.title]), [[pendingReport.id, pendingReport.title]]);
  assert.deepEqual(underwater.consistency.unresolvedScreeningStudies, []);

  const mixedStudies = Array.from({ length: 4 }, (_, index) => study(`mixed-${index}`, "advance_full_text"));
  const mixedReports = ["not_sought", "sought", "retrieved", "not_retrieved"].map((status, index) => report(mixedStudies[index], status));
  const mixed = calculate({ project: { ...project, recordsTotal: 4, recordsScreened: 4 }, studies: mixedStudies, reports: mixedReports });
  assert.equal(mixed.counts.reportsSought, 3, "reports sought retains actual retrieval semantics");
  assert.equal(mixed.counts.reportsNotRetrieved, 1);
  assert.equal(mixed.consistency.reportsAdvancedToFullText, 4);
  assert.equal(mixed.consistency.screenedCheckOk, true);
  assert.deepEqual(mixed.consistency.pendingRetrievalReports.map(item => item.id), [mixedReports[0].id]);

  // A third vote resolving an include/exclude conflict contributes one outcome,
  // regardless of how many exclusion votes were needed to reach it.
  const resolvedStudy = study("resolved-conflict", undefined);
  const resolvedVotes = ["include", "exclude", "exclude"].map(value => vote(resolvedStudy, value));
  const resolved = calculate({ studies: [resolvedStudy], decisions: resolvedVotes });
  assert.equal(resolved.counts.recordsExcluded, 1);
  assert.equal(resolved.consistency.screenedCheckOk, true);
  assert.deepEqual(resolved.consistency.unresolvedScreeningStudies, []);

  const settled = study("settled", "excluded_abstract");
  const partial = study("partial", undefined, { title: "Citation awaiting a second reviewer" });
  const conflict = study("conflict", undefined, { title: "Citation with tied screening votes" });
  const unfinishedInput = {
    project: { ...project, recordsTotal: 3, recordsScreened: 3 }, studies: [settled, partial, conflict],
    decisions: [vote(partial, "exclude"), vote(conflict, "include"), vote(conflict, "exclude")]
  };
  const unfinished = calculate(unfinishedInput);
  assert.equal(unfinished.counts.recordsExcluded, 1, "partial and conflicting votes must not become inferred exclusions");
  assert.equal(unfinished.consistency.screenedCheckOk, false);
  assert.equal(unfinished.consistency.screenBalanceTotal, 1);
  assert.deepEqual(unfinished.consistency.unresolvedScreeningStudies.map(item => item.id), [partial.id, conflict.id]);

  // Aggregate outcomes take precedence when blind review hides peers' votes.
  const hiddenExcluded = study("blind-excluded", "excluded_abstract");
  const hiddenAdvanced = study("blind-advanced", "advance_full_text");
  const hiddenPending = study("blind-pending", "awaiting_votes", { titleAbstractVoteCount: 1 });
  const blind = calculate({
    project: { ...project, recordsTotal: 3, recordsScreened: 3, blindMode: true },
    studies: [hiddenExcluded, hiddenAdvanced, hiddenPending], reports: [report(hiddenAdvanced, "sought")],
    decisions: [vote(hiddenExcluded, "include")]
  });
  assert.equal(blind.counts.recordsExcluded, 1, "visible minority vote cannot override the aggregate outcome");
  assert.equal(blind.consistency.reportsAdvancedToFullText, 1);
  assert.deepEqual(blind.consistency.unresolvedScreeningStudies.map(item => item.id), [hiddenPending.id]);

  // Historical decisions and other projects cannot settle a current citation.
  const currentIncluded = study("current-included", undefined);
  const reopened = study("reopened", undefined);
  const historicalVotes = [
    vote(currentIncluded, "exclude", { isCurrent: false }), vote(currentIncluded, "exclude", { isCurrent: false }),
    vote(currentIncluded, "include"), vote(currentIncluded, "include"),
    vote(reopened, "exclude", { isCurrent: false }), vote(reopened, "exclude", { isCurrent: false }),
    vote(reopened, "exclude", { projectId: "another-project" }), vote(reopened, "exclude", { projectId: "another-project" })
  ];
  const history = calculate({
    project: { ...project, recordsTotal: 2, recordsScreened: 2 }, studies: [currentIncluded, reopened],
    reports: [report(currentIncluded, "sought")], decisions: historicalVotes
  });
  assert.equal(history.counts.recordsExcluded, 0);
  assert.equal(history.consistency.reportsAdvancedToFullText, 1);
  assert.equal(history.consistency.screenedCheckOk, false);
  assert.deepEqual(history.consistency.unresolvedScreeningStudies.map(item => item.id), [reopened.id]);

  const duplicate = study("confirmed-duplicate", "excluded_abstract");
  const duplicateCandidates = [{ id: "dedup", projectId: project.id, recordA: settled, recordB: duplicate, status: "confirmed", excludedStudyId: duplicate.id }];
  const duplicateCounts = getCountsForProject({ ...project, recordsTotal: 2 }, [settled, duplicate], [], [], [], [], duplicateCandidates);
  assert.equal(duplicateCounts.duplicateRecordsRemoved, 1);
  assert.equal(duplicateCounts.recordsExcluded, 1, "a pre-screen duplicate must not also count as a screening exclusion");

  const empty = calculate({ project: { ...project, recordsTotal: 0, recordsScreened: 0 }, studies: [] });
  assert.equal(empty.consistency.activeCount, 0);
  assert.equal(empty.consistency.failedCount, 0);

  // The warning must explain what to do and preserve the selected citation or
  // report when the user follows its link. Export readiness remains independent.
  const noop = () => {};
  let openedStudyId = "", openedReportId = "";
  const sectionProps = ({ counts, consistency }, overrides = {}) => ({
    recordsIdentified: counts.recordsIdentifiedDatabase + counts.recordsIdentifiedRegisters + counts.recordsIdentifiedOther,
    activeCounts: counts, reportsExcludedTotal: Object.values(counts.reportsExcludedWithReasons).reduce((sum, count) => sum + count, 0),
    exportConsistency: consistency, exportMessage: "", isExportingConsensusCsv: false, canExportExtractionCsv: true, exportUnavailableReasons: [],
    downloadConsensusExtractionCsv: noop, formatNumber: String,
    onOpenScreeningStudy: id => openedStudyId = id, onOpenReport: id => openedReportId = id,
    canOpenScreeningStudy: () => true, canOpenReport: () => true, ...overrides
  });
  const render = props => renderToStaticMarkup(React.createElement(NavigationProvider, { projectId: project.id }, React.createElement(ExportsSection, props)));
  const nodes = element => {
    if (!element || typeof element !== "object") return [];
    if (Array.isArray(element)) return element.flatMap(nodes);
    return [element, ...nodes(element.props?.children)];
  };
  const label = element => {
    if (typeof element === "string" || typeof element === "number") return String(element);
    if (Array.isArray(element)) return element.map(label).join(" ");
    return element && typeof element === "object" ? label(element.props?.children) : "";
  };
  const itemLink = (tree, view, title) => nodes(tree).find(node => node.type === ViewLink && node.props.view === view &&
    `${label(node)} ${node.props["aria-label"] ?? ""}`.includes(title));
  const csvButton = tree => nodes(tree).find(node => node.type === "button" && label(node).includes("Export Extraction CSV"));

  const unfinishedProps = sectionProps(unfinished);
  const unfinishedHtml = render(unfinishedProps);
  assert.match(unfinishedHtml, /Screening decisions are not fully balanced/);
  assert.ok(unfinishedHtml.includes(partial.title));
  assert.ok(unfinishedHtml.includes(conflict.title));
  assert.match(unfinishedHtml, /href="[^\"]+\/screening"/);
  assert.match(unfinishedHtml, /Consistency warnings do not block CSV export/);
  const unfinishedTree = ExportsSection(unfinishedProps);
  const screeningLink = itemLink(unfinishedTree, "screening", partial.title);
  assert.ok(screeningLink, "the warning links to the specific unresolved citation");
  screeningLink.props.onNavigate();
  assert.equal(openedStudyId, partial.id);
  assert.equal(Boolean(csvButton(unfinishedTree)?.props.disabled), false, "a consistency warning alone must not disable CSV export");

  const pendingProps = sectionProps(underwater);
  const pendingHtml = render(pendingProps);
  assert.ok(pendingHtml.includes(pendingReport.title));
  assert.match(pendingHtml, /href="[^\"]+\/full-text"/);
  assert.doesNotMatch(pendingHtml, /Screening decisions are not fully balanced/);
  const retrievalLink = itemLink(ExportsSection(pendingProps), "fullText", pendingReport.title);
  assert.ok(retrievalLink, "pending retrieval links to the specific report");
  retrievalLink.props.onNavigate();
  assert.equal(openedReportId, pendingReport.id);

  const unavailableProps = sectionProps(unfinished, { canExportExtractionCsv: false, exportUnavailableReasons: ["The review is not complete."] });
  assert.equal(csvButton(ExportsSection(unavailableProps)).props.disabled, true, "review readiness still disables unavailable exports");
  assert.match(render(unavailableProps), /Consistency warnings do not block CSV export/);
  assert.match(render(unavailableProps), /CSV export is unavailable\. The review is not complete\./);
  assert.doesNotMatch(render(unavailableProps), /Consensus CSV export is blocked until/);
  const unavailableTargetsHtml = render(sectionProps(unfinished, { canOpenScreeningStudy: () => false }));
  assert.ok(unavailableTargetsHtml.includes(partial.title));
  assert.doesNotMatch(unavailableTargetsHtml, /<a[^>]*href="[^\"]+\/screening"/,
    "a citation unavailable to this reviewer must not link to a different active item");
  const unavailableReportHtml = render(sectionProps(underwater, { canOpenReport: () => false }));
  assert.ok(unavailableReportHtml.includes(pendingReport.title));
  assert.doesNotMatch(unavailableReportHtml, /<a[^>]*href="[^\"]+\/full-text"/);

  console.log("Export consistency checks passed: counts, retrieval boundaries, conflict resolution, blind summaries, history, duplicates, targeted guidance, and CSV readiness.");
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
