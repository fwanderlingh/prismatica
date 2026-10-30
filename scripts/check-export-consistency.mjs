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
  }, files: ["lib/workflowSelectors.ts", "lib/exportConsistency.ts", "components/review-sections/exports-section.tsx", "components/review-sections/full-text-section.tsx"].map(name => path.join(root, name)) }));
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
  const { ExclusionReasonCorrections } = require(path.join(temp, "components/review-sections/exclusion-reason-corrections.js"));
  const { FullTextSection } = require(path.join(temp, "components/review-sections/full-text-section.js"));
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

  // Completed full-text aggregates remain accurate when no peer decisions are visible.
  const fullTextExcludedStudy = study('blind-full-text-excluded', 'advance_full_text');
  const fullTextIncludedStudy = study('blind-full-text-included', 'advance_full_text', { stage: 'extraction' });
  const aggregateReports = [
    report(fullTextExcludedStudy, 'retrieved', {
      fullTextVoteCount: 3, fullTextStatus: 'excluded_full_text', fullTextExclusionReasonId: 'Wrong population'
    }),
    report(fullTextIncludedStudy, 'retrieved', { fullTextVoteCount: 2, fullTextStatus: 'advance_extraction' })
  ];
  const aggregateInput = {
    project: { ...project, recordsTotal: 2, recordsScreened: 2, studiesIncluded: 1, blindMode: true },
    studies: [fullTextExcludedStudy, fullTextIncludedStudy], reports: aggregateReports, decisions: []
  };
  const aggregate = calculate(aggregateInput);
  assert.equal(aggregate.counts.reportsAssessed, 2);
  assert.equal(aggregate.counts.reportsExcludedWithReasons['Wrong population'], 1);
  assert.equal(aggregate.consistency.assessedCheckOk, true);
  assert.equal(aggregate.consistency.retrievalCheckOk, true);
  assert.equal(aggregate.consistency.exclusionReasonCheckActive, true);
  assert.equal(aggregate.consistency.exclusionReasonCheckOk, true);
  const missingAggregateReason = calculate({ ...aggregateInput, reports: [
    { ...aggregateReports[0], fullTextExclusionReasonId: null }, aggregateReports[1]
  ] });
  assert.equal(missingAggregateReason.consistency.excludedWithoutReasonCount, 1);
  assert.equal(missingAggregateReason.consistency.exclusionReasonCheckOk, false);
  const excludedReport = report(fullTextExcludedStudy, 'retrieved');
  const majority = calculate({ studies: [fullTextExcludedStudy], reports: [excludedReport], decisions: [
    vote(fullTextExcludedStudy, 'include', { stage: 'full_text', reportId: excludedReport.id }),
    vote(fullTextExcludedStudy, 'exclude', { stage: 'full_text', reportId: excludedReport.id, exclusionReasonId: 'Wrong population' }),
    vote(fullTextExcludedStudy, 'exclude', { stage: 'full_text', reportId: excludedReport.id, exclusionReasonId: 'Wrong population' })
  ] });
  assert.equal(majority.counts.reportsExcludedWithReasons['Wrong population'], 1, 'legacy majority resolution selects an exclusion reason, not the first include vote');

  // Historical labels can differ from today's options, even when a peer used
  // the corrected label. Expose the actual reports instead of an unfixable count.
  const reasonProject = { ...project, recordsTotal: 2, recordsScreened: 2, exclusionReasons: ['Full text not available', 'Not in English'] };
  const reasonStudies = [study('reason-case', 'advance_full_text', { importItemId: 91 }), study('reason-typo', 'advance_full_text', { importItemId: 92 })];
  const reasonReports = reasonStudies.map(item => report(item, 'retrieved'));
  const reasonVotes = reasonStudies.flatMap((item, index) => [
    vote(item, 'exclude', { stage: 'full_text', reportId: reasonReports[index].id, exclusionReasonId: index === 0 ? 'full text not available' : 'Not in Eglish' }),
    vote(item, 'exclude', { stage: 'full_text', reportId: reasonReports[index].id, exclusionReasonId: reasonProject.exclusionReasons[index] })
  ]);
  const reasonInput = { project: reasonProject, studies: reasonStudies, reports: reasonReports, decisions: reasonVotes };
  const reasonProblems = calculate(reasonInput);
  assert.equal(reasonProblems.counts.reportsAssessed, 2);
  assert.equal(reasonProblems.consistency.assessedBalanceTotal, 0);
  assert.equal(reasonProblems.consistency.excludedWithoutReasonCount, 2);
  assert.deepEqual(reasonProblems.consistency.exclusionReasonIssues.map(issue => [issue.reportId, issue.title, issue.importItemId, issue.invalidReasons, issue.suggestedReason]), [
    [reasonReports[0].id, reasonReports[0].title, 91, ['full text not available'], 'Full text not available'],
    [reasonReports[1].id, reasonReports[1].title, 92, ['Not in Eglish'], 'Not in English']
  ]);
  const invalidSecondVote = calculate({ ...reasonInput, studies: [reasonStudies[0]], reports: [reasonReports[0]], decisions: [reasonVotes[1], reasonVotes[0]] });
  assert.equal(invalidSecondVote.counts.reportsExcludedWithReasons['Full text not available'], 1);
  assert.equal(invalidSecondVote.consistency.excludedWithoutReasonCount, 1, 'an invalid second vote remains repairable when the first reason is already valid');
  const unknownTypo = calculate({ ...reasonInput, studies: [reasonStudies[1]], reports: [reasonReports[1]], decisions: [
    reasonVotes[2], { ...reasonVotes[3], exclusionReasonId: 'Not in Eglish' }
  ] });
  assert.equal(unknownTypo.consistency.exclusionReasonIssues[0].suggestedReason, undefined, 'a typo without a configured peer reason must not guess a replacement');
  const blindOutdatedReason = calculate({ ...aggregateInput, reports: [
    { ...aggregateReports[0], fullTextExclusionReasonId: 'wrong population' }, aggregateReports[1]
  ] });
  assert.equal(blindOutdatedReason.consistency.exclusionReasonIssues[0].suggestedReason, 'Wrong population');
  assert.deepEqual(missingAggregateReason.consistency.exclusionReasonIssues[0].invalidReasons, [null]);
  const blindPeerReasonRepairInput = { ...aggregateInput, reports: [
    { ...aggregateReports[0], fullTextExclusionReasonNeedsCorrection: true }, aggregateReports[1]
  ], decisions: [] };
  const blindPeerReasonRepair = calculate(blindPeerReasonRepairInput);
  assert.equal(blindPeerReasonRepair.consistency.assessedCheckOk, true, 'the visible final reason can be valid while a hidden peer reason needs repair');
  assert.equal(blindPeerReasonRepair.consistency.excludedWithoutReasonCount, 1);
  assert.equal(blindPeerReasonRepair.consistency.exclusionReasonCheckOk, false);
  assert.equal(blindPeerReasonRepair.consistency.exclusionReasonIssues.length, 1);
  assert.deepEqual(blindPeerReasonRepair.consistency.exclusionReasonIssues[0], {
    reportId: aggregateReports[0].id,
    title: aggregateReports[0].title,
    importItemId: fullTextExcludedStudy.importItemId,
    invalidReasons: [null],
    suggestedReason: 'Wrong population'
  }, 'blind repair guidance uses only the aggregate flag and configured final reason');
  assert.deepEqual(blindPeerReasonRepair.consistency.exclusionReasonIssues.flatMap(issue => issue.invalidReasons).filter(reason => typeof reason === 'string'), [], 'hidden peer reason labels are not exposed by repair guidance');
  const blindPeerReasonRepaired = calculate({ ...blindPeerReasonRepairInput, reports: [
    { ...blindPeerReasonRepairInput.reports[0], fullTextExclusionReasonNeedsCorrection: false }, aggregateReports[1]
  ] });
  assert.equal(blindPeerReasonRepaired.consistency.excludedWithoutReasonCount, 0);
  assert.equal(blindPeerReasonRepaired.consistency.exclusionReasonCheckOk, true);
  assert.deepEqual(blindPeerReasonRepaired.consistency.exclusionReasonIssues, []);
  const includedWithMinorityExclusion = calculate({ studies: [fullTextIncludedStudy], reports: [aggregateReports[1]], decisions: [
    vote(fullTextIncludedStudy, 'exclude', { stage: 'full_text', reportId: aggregateReports[1].id })
  ] });
  assert.equal(includedWithMinorityExclusion.consistency.excludedWithoutReasonCount, 0, 'a minority exclusion is not a completed report exclusion');
  assert.deepEqual(includedWithMinorityExclusion.consistency.exclusionReasonIssues, []);
  const orphanedExclusion = calculate({ studies: [], reports: [], decisions: [
    vote(fullTextExcludedStudy, 'exclude', { stage: 'full_text', reportId: 'deleted-report' }),
    vote(fullTextExcludedStudy, 'exclude', { stage: 'full_text', reportId: 'deleted-report' })
  ] });
  assert.deepEqual(orphanedExclusion.consistency.exclusionReasonIssues, [], 'repair actions only target reports that still exist');

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

  let correctedReason;
  const correctionProps = {
    issues: reasonProblems.consistency.exclusionReasonIssues,
    exclusionReasons: reasonProject.exclusionReasons, canCorrect: true,
    onCorrect: (reportId, reasonId) => correctedReason = [reportId, reasonId]
  };
  const correctionsTree = ExclusionReasonCorrections(correctionProps);
  const correctionForms = nodes(correctionsTree).filter(node => node.type === 'form');
  assert.equal(correctionForms.length, 2, 'completed exclusions have direct correction forms');
  const correctionHtml = renderToStaticMarkup(React.createElement(ExclusionReasonCorrections, correctionProps));
  assert.match(correctionHtml, /# 91/);
  assert.ok(correctionHtml.includes(reasonReports[1].title));
  assert.match(correctionHtml, /Not in Eglish/);
  assert.match(correctionHtml, /Save reason/);
  let prevented = false;
  const submitReason = value => ({ preventDefault: () => prevented = true, currentTarget: { elements: { namedItem: () => ({ value }) } } });
  correctionForms[1].props.onSubmit(submitReason('Not in English'));
  assert.equal(prevented, true);
  assert.deepEqual(correctedReason, [reasonReports[1].id, 'Not in English']);
  correctedReason = undefined;
  correctionForms[0].props.onSubmit(submitReason('unconfigured value'));
  assert.equal(correctedReason, undefined);
  const pendingCorrections = ExclusionReasonCorrections({ ...correctionProps, pendingReportId: reasonReports[0].id });
  assert.ok(nodes(pendingCorrections).filter(node => node.type === 'button').every(node => node.props.disabled));
  nodes(pendingCorrections).find(node => node.type === 'form').props.onSubmit(submitReason('Full text not available'));
  assert.equal(correctedReason, undefined, 'in-flight correction cannot submit another request');
  const readonlyCorrections = ExclusionReasonCorrections({ ...correctionProps, canCorrect: false });
  assert.equal(nodes(readonlyCorrections).filter(node => node.type === 'form').length, 0);
  assert.match(renderToStaticMarkup(React.createElement(ExclusionReasonCorrections, { ...correctionProps, canCorrect: false })), /project owner or administrator/);
  assert.equal(ExclusionReasonCorrections({ ...correctionProps, issues: [] }), null);
  const correctionStatus = message => nodes(ExclusionReasonCorrections({ ...correctionProps, message })).find(node => node.props?.role === 'status');
  assert.equal(correctionStatus('Exclusion reason corrected. The report remains excluded and its review history is preserved.').props.className, 'validationItem ok');
  assert.equal(correctionStatus('This report already has valid exclusion reasons.').props.className, 'validationItem ok');
  assert.equal(correctionStatus('Exclusion reasons can only be corrected for a report excluded at full text.').props.className, 'validationItem blocked', 'an error containing corrected must not be styled as success');
  assert.equal(correctionStatus('The review changed while saving. Please try again.').props.className, 'validationItem blocked');
  const emptyFullTextHtml = renderToStaticMarkup(React.createElement(NavigationProvider, { projectId: project.id }, React.createElement(FullTextSection, {
    hasProjectSeedData: false, phaseProgress: { percent: 100, label: '100% full-text completed' },
    projectReportQueue: [], totalFullTextReportCount: reasonReports.length, activeReport: reasonReports[0],
    decisions: reasonVotes, selectedProject: reasonProject, currentUser: { id: reasonProject.ownerId },
    fullTextMessage: '', checkoutError: '', setActiveReportId: noop, setFullTextMessage: noop,
    pdfInputRef: { current: null }, pendingFullTextAction: null, uploadReportPdf: noop,
    updateFullTextReport: noop, formatDecision: String, formatConflictResolutionHint: String,
    decisionTone: () => 'neutral', fullTextReason: '', setFullTextReason: noop,
    exclusionReasons: reasonProject.exclusionReasons,
    exclusionReasonCorrections: React.createElement(ExclusionReasonCorrections, correctionProps),
    studies: reasonStudies, reviewedCount: reasonReports.length, onOpenReviewed: noop,
    conflicts: [], onResolveConflict: noop, onOpenPdfUpload: noop
  })));
  assert.match(emptyFullTextHtml, /No active full-text reports/);
  assert.ok(emptyFullTextHtml.includes(reasonReports[0].title));
  assert.ok(emptyFullTextHtml.includes(reasonReports[1].title));
  assert.equal((emptyFullTextHtml.match(/<form\b/g) ?? []).length, 2, 'reason correction forms remain reachable with an empty full-text queue');
  assert.match(emptyFullTextHtml, /Save reason/);
  const correctionExportHtml = render(sectionProps(reasonProblems, {
    exclusionReasons: reasonProject.exclusionReasons, canCorrectExclusionReasons: true, onCorrectExclusionReason: noop
  }));
  assert.match(correctionExportHtml, /missing or outdated reason/);
  assert.match(correctionExportHtml, /Save reason/);

  const pendingConsensusProps = sectionProps(aggregate, {
    canExportExtractionCsv: false, pendingConsensusReports: [{ id: 'pending-consensus', title: 'Consensus that needs arbitration', importItemId: 282 }],
    onOpenConsensusReport: id => openedReportId = id
  });
  const pendingConsensusTree = ExportsSection(pendingConsensusProps);
  const consensusLink = itemLink(pendingConsensusTree, 'consensus', 'Consensus that needs arbitration');
  assert.ok(consensusLink, 'the actual CSV blocker links to its pending consensus record');
  consensusLink.props.onNavigate();
  assert.equal(openedReportId, 'pending-consensus');
  assert.match(render(pendingConsensusProps), /# 282/);

  console.log("Export consistency checks passed: counts, retrieval, blind summaries, historical reason corrections, pending consensus links, targeted guidance, and CSV readiness.");
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
