import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-consensus-navigation-"));
const originalResolve = Module._resolveFilename;

try {
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
    noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
    typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
    paths: { "@/*": [path.join(root, "*")] }
  }, files: ["consensus-section", "project-dashboard-section"].map(name => path.join(root, `components/review-sections/${name}.tsx`)) }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { NavigationProvider, ViewLink } = require(path.join(temp, "components/navigation-link.js"));
  const { ConsensusSection } = require(path.join(temp, "components/review-sections/consensus-section.js"));
  const { ProjectDashboardSection } = require(path.join(temp, "components/review-sections/project-dashboard-section.js"));
  const { getExtractionConflictFieldIds, getExtractionConsensusQueue } = require(path.join(temp, "lib/consensusQueue.js"));
  const data = require(path.join(temp, "lib/prismaData.js"));
  const project = { ...data.reviewProjects[0], id: "consensus-review", extractionRequiredVotes: 1 };
  const template = {
    id: "active-template", projectId: project.id, isActive: true,
    fields: [
      { id: "application", title: "Application", type: "single_choice", options: ["Search", "Tracking"] },
      { id: "level", title: "MPC level", type: "single_choice", options: ["Planning", "Control"] },
      { id: "notes", title: "Notes", type: "multiline_text", options: [] }
    ]
  };
  const pendingTitle = "Resilient Multi-target Monitoring and Tracking of Spacecraft Swarm against Byzantine Attacks";
  const studies = Array.from({ length: 102 }, (_, index) => ({
    ...data.screeningStudies[0], id: `study-${index}`, projectId: project.id,
    importItemId: index === 101 ? 282 : index + 1,
    title: index === 101 ? pendingTitle : `Finalized paper ${index + 1}`, stage: "extraction"
  }));
  const reports = studies.map((study, index) => ({
    ...data.reportQueue[0], id: `report-${index}`, projectId: project.id, studyId: study.id, title: study.title
  }));
  const responses = reports.map((report, index) => ({
    id: `response-${index}`, projectId: project.id, studyId: report.studyId, reportId: report.id,
    templateId: template.id, userId: "reviewer", userName: "Reviewer", isSubmitted: true,
    submittedAt: "2026-10-20T09:00:00Z", updatedAt: "2026-10-20T09:00:00Z", values: { application: "Search", level: "Planning", notes: "ok" }
  }));
  const records = reports.map((report, index) => ({
    id: `consensus-${index}`, projectId: project.id, reportId: report.id, studyId: report.studyId,
    templateId: template.id, status: index === 101 ? "pending" : "finalized",
    finalizedAt: index === 101 ? undefined : "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z",
    flaggedFieldIds: index === 101 ? ["application", "level", "notes"] : [], resolvedValues: {}
  }));
  const noop = () => {};
  let selected = "";
  const props = {
    activeCounts: { studiesIncluded: 102 }, selectedProject: project,
    currentUser: { id: project.ownerId }, consensusMessage: "", activeExtractionTemplate: template,
    projectExtractionReports: reports, extractionResponses: responses, extractionConsensus: records,
    activeExtractionReport: reports[0], projectScreeningStudies: studies, activeExtractionConsensus: records[0],
    setActiveView: noop, setActiveExtractionReportId: id => selected = id,
    formatExtractionResponseValue: value => String(value ?? ""), formatAuditTime: value => value,
    finalizeExtractionConsensus: noop, isFinalizingExtractionConsensus: false,
    consensusFormValues: {}, updateConsensusValue: noop, toggleConsensusChoice: noop
  };
  const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const label = node => node == null ? "" : typeof node === "string" || typeof node === "number"
    ? String(node) : Array.isArray(node) ? node.map(label).join(" ") : label(node.props?.children);
  const tree = ConsensusSection(props);
  const pendingList = nodes(tree).find(node => node.type === "section" && node.props["aria-labelledby"] === "pending-consensus-title");
  assert.ok(pendingList, "pending records have a visible section outside the dropdown");
  assert.match(label(pendingList), /# 282/);
  assert.ok(label(pendingList).includes(pendingTitle), "pending list displays the complete report title");
  assert.match(label(pendingList), /3 field conflicts to resolve/);
  assert.doesNotMatch(label(pendingList), /Finalized paper/);
  const direct = nodes(pendingList).find(node => node.type === "button" && node.props["aria-label"]?.includes(pendingTitle));
  direct.props.onClick();
  assert.equal(selected, reports[101].id, "direct action selects report 282 without scrubbing through finalized records");
  const nextPending = nodes(tree).find(node => node.type === "button" && label(node).includes("Review pending consensus"));
  assert.ok(nextPending && !nextPending.props.disabled);
  selected = "";
  nextPending.props.onClick();
  assert.equal(selected, reports[101].id);
  const picker = nodes(tree).find(node => node.props?.id === "consensus-report-picker");
  assert.equal(picker.props.value, reports[0].id, "an explicitly selected finalized record stays selected");
  assert.deepEqual(nodes(picker).filter(node => node.type === "optgroup").map(node => node.props.label), ["Pending consensus (1)", "Finalized consensus (101)"]);
  const queue = getExtractionConsensusQueue(project, reports, responses, records, template.id);
  assert.deepEqual(queue.filter(item => item.status === "pending").map(item => item.report.id), [reports[101].id]);
  const staleRecords = records.map((record, index) => index === 0 ? { ...record, finalizedAt: "2026-10-19T10:00:00Z" } : record);
  assert.equal(getExtractionConsensusQueue(project, reports, responses, staleRecords, template.id)[0].status, "pending", "stale finalization must remain discoverable as pending");
  const collecting = getExtractionConsensusQueue(project, reports, responses.slice(1), records, template.id);
  assert.equal(collecting[0].status, "collecting", "a record without submitted votes cannot appear finalized");
  const foreignResponse = { ...responses[101], id: "foreign", projectId: "other-project" };
  assert.equal(getExtractionConsensusQueue(project, reports, [...responses, foreignResponse], records, template.id)[101].submittedResponses.length, 1);
  const allFinalized = records.map(record => ({ ...record, status: "finalized", finalizedAt: "2026-10-20T10:00:00Z" }));
  const finishedTree = ConsensusSection({ ...props, extractionConsensus: allFinalized });
  assert.ok(!nodes(finishedTree).some(node => node.props?.["aria-labelledby"] === "pending-consensus-title"));
  assert.ok(!nodes(finishedTree).some(node => node.type === "button" && /pending consensus/.test(label(node))));

  const noConflicts = { ...records[101], flaggedFieldIds: [] };
  const finalizeTree = ConsensusSection({ ...props, activeExtractionReport: reports[101], activeExtractionConsensus: noConflicts,
    extractionConsensus: [...records.slice(0, 101), noConflicts] });
  assert.ok(nodes(finalizeTree).some(node => node.type === "button" && label(node) === "Finalize Consensus"), "pending records without conflicts can still be finalized");
  const missingRecordProps = { ...props, activeExtractionReport: reports[101], activeExtractionConsensus: undefined, extractionConsensus: records.slice(0, 101) };
  const missingAgreeTree = ConsensusSection(missingRecordProps);
  const missingAgreeAction = nodes(missingAgreeTree).find(node => node.type === "button" && label(node) === "Finalize Consensus");
  assert.ok(missingAgreeAction && !missingAgreeAction.props.disabled, "agreeing submissions remain finalizable when the consensus record is absent");
  const disagreeResponse = {
    ...responses[101], id: "second-reviewer-response", userId: "second-reviewer",
    values: { application: "Tracking", level: "Control", notes: " ok " }
  };
  const missingConflictTree = ConsensusSection({ ...missingRecordProps, extractionResponses: [...responses, disagreeResponse] });
  const conflictList = nodes(missingConflictTree).find(node => node.type === "section" && node.props["aria-labelledby"] === "pending-consensus-title");
  assert.match(label(conflictList), /2 field conflicts to resolve/, "pending summary derives the real conflict count when no record exists");
  const conflictFields = nodes(missingConflictTree).filter(node => node.type === "fieldset");
  assert.deepEqual(conflictFields.map(node => label(nodes(node).find(child => child.type === "legend"))), ["Application", "MPC level"]);
  const conflictChoices = nodes(conflictFields).filter(node => node.type === "input" && node.props.type === "radio");
  assert.ok(conflictChoices.length > 0 && conflictChoices.every(node => node.props.checked === false), "new arbitration starts without a preselected resolution");
  assert.ok(nodes(missingConflictTree).some(node => node.type === "button" && label(node).includes("Finalize Consensus") && !node.props.disabled));
  const busyTree = ConsensusSection({ ...missingRecordProps, isFinalizingExtractionConsensus: true });
  assert.equal(nodes(busyTree).find(node => node.props?.id === "consensus-report-picker").props.disabled, true, "the report cannot change during finalization");
  assert.deepEqual(getExtractionConflictFieldIds([
    { id: "tags" }, { id: "text" }, { id: "different" }
  ], [
    { values: { tags: ["b", " a ", "b", ""], text: " value ", different: "one" } },
    { values: { tags: ["a", "b"], text: "value", different: "two" } }
  ]), ["different"], "derived conflicts use the server's trimming, deduplication, and choice ordering");
  assert.match(renderToStaticMarkup(React.createElement(NavigationProvider, { projectId: project.id }, React.createElement(ConsensusSection, { ...props, projectExtractionReports: [] }))), /No reports in extraction/);

  const dashboardProps = {
    selectedProject: { ...project, stage: "extraction" }, currentUserId: project.ownerId,
    workflowConflicts: [], recordsIdentified: 258,
    activeCounts: { ...data.prismaCounts, studiesIncluded: 102, studiesExtracted: 102 },
    exportFailedCount: 0, pendingConsensusCount: 1, finalizedConsensusCount: 101,
    projectEvents: [], latestProjectEvents: [], projectUserStats: [], projectScreeningStudies: studies,
    projectReportQueue: reports, getWorkflowStepState: () => "complete", formatProjectPhase: value => value,
    projectPhaseStatusTone: () => "info", formatMaybePolicy: value => value,
    formatAuditEntityLabel: () => "", formatAuditTime: value => value, formatNumber: String,
    onOpenSettings: noop, onOpenAudit: noop, onNavigate: noop
  };
  const dashboardTree = ProjectDashboardSection(dashboardProps);
  const consensusLink = nodes(dashboardTree).find(node => node.type === ViewLink && node.props.view === "consensus");
  assert.ok(consensusLink && label(consensusLink).includes("Resolve consensus"), "completed extraction with pending arbitration routes directly to consensus");
  const exportNode = nodes(dashboardTree).find(node => node.type === "li" && label(node).includes("Export"));
  assert.ok(exportNode && label(exportNode).includes("1 consensus pending"));
  assert.ok(!exportNode.props.className.includes("complete"), "export must not appear ready before consensus finalization");
  const dashboardHtml = renderToStaticMarkup(React.createElement(NavigationProvider, { projectId: project.id }, React.createElement(ProjectDashboardSection, dashboardProps)));
  assert.match(dashboardHtml, /101\/102 finalized/);
  assert.doesNotMatch(dashboardHtml, /Ready to export/);
  const completeDashboard = ProjectDashboardSection({ ...dashboardProps, selectedProject: { ...project, stage: "complete" }, pendingConsensusCount: 0, finalizedConsensusCount: 102 });
  const readyNode = nodes(completeDashboard).find(node => node.type === "li" && label(node).includes("Export"));
  assert.ok(readyNode.props.className.includes("complete") && label(readyNode).includes("Ready to export"));
  console.log("Consensus navigation checks passed.");
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
