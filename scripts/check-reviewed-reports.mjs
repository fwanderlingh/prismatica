import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-reviewed-reports-"));
const originalResolve = Module._resolveFilename;
const originalWindow = globalThis.window;

try {
  globalThis.window = { requestAnimationFrame: () => 0 };
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
    noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
    typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
    paths: { "@/*": [path.join(root, "*")] }
  }, files: [
    ...["reviewed-items-section", "reviewed-full-text-report-section", "consensus-section"].map(name => path.join(root, `components/review-sections/${name}.tsx`)),
    path.join(root, "components/paper-comments.tsx")
  ] }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { Check, BookOpen } = require("lucide-react");
  const { NavigationProvider, PageLink } = require(path.join(temp, "components/navigation-link.js"));
  const { StudyDoiEditContext } = require(path.join(temp, "components/doi-edit.js"));
  const { ReviewedItemsSection } = require(path.join(temp, "components/review-sections/reviewed-items-section.js"));
  const { ReviewedFullTextReportSection } = require(path.join(temp, "components/review-sections/reviewed-full-text-report-section.js"));
  const { PaperComments } = require(path.join(temp, "components/paper-comments.js"));
  const { ConsensusSection } = require(path.join(temp, "components/review-sections/consensus-section.js"));
  const { screeningStudies, reviewProjects, reportQueue } = require(path.join(temp, "lib/prismaData.js"));
  const { buildReviewedFullTextReportPath } = require(path.join(temp, "lib/navigation.js"));
  const { getReportPdfUrl } = require(path.join(temp, "lib/reviewDisplay.js"));
  const noop = () => {};
  const returned = [];
  const includedStudy = { ...screeningStudies[0], id: "included-study", importBatchId: "import", doi: "https://doi.org/10.1234/included" };
  const excludedStudy = { ...screeningStudies[0], id: "excluded-study", importBatchId: "import", doi: "" };
  const props = {
    icon: Check, eyebrow: "Full text", title: "Reviewed Reports", description: "Completed full-text reviews",
    queueLabel: "Full-text queue", queueView: "fullText", emptyTitle: "No reviewed reports", emptyDescription: "Review a report first.",
    items: [
      { id: "included-report", title: "Included paper", subtitle: "Included citation", statusLabel: "Included", statusTone: "success", filterValue: "include", study: includedStudy },
      { id: "excluded-report", title: "Excluded paper", subtitle: "Excluded citation", statusLabel: "Excluded", statusTone: "danger", filterValue: "exclude", study: excludedStudy },
      { id: "legacy-report", title: "Legacy excluded paper", subtitle: "Citation unavailable", statusLabel: "Excluded", statusTone: "danger", filterValue: "exclude" }
    ],
    statusFilters: [{ value: "include", label: "Included" }, { value: "exclude", label: "Excluded" }],
    filterLabel: "Decision", message: "", pendingItemId: "", actionLabel: "Return to queue",
    onOpenQueue: noop, onReturnToQueue: id => returned.push(id)
  };
  const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const label = node => node == null ? "" : typeof node === "string" || typeof node === "number"
    ? String(node) : Array.isArray(node) ? node.map(label).join("") : label(node.props?.children);
  const rows = tree => nodes(nodes(tree).find(node => node.type === "tbody")).filter(node => node.type === "tr");
  const rowTitles = tree => rows(tree).map(row => label(nodes(row).find(node => node.type === "strong")));
  const render = tree => renderToStaticMarkup(React.createElement(NavigationProvider, { projectId: "review" },
    React.createElement(StudyDoiEditContext.Provider, { value: async () => {} }, tree)));

  // Isolate the section's filter state; nested DOI pills use React's real hooks during SSR.
  function harness(initialProps = props, Component = ReviewedItemsSection) {
    let currentProps = initialProps;
    let state;
    return {
      update(nextProps) { currentProps = { ...currentProps, ...nextProps }; },
      tree() {
        const originalUseState = React.useState;
        React.useState = initialValue => {
          if (state === undefined) state = typeof initialValue === "function" ? initialValue() : initialValue;
          return [state, value => { state = typeof value === "function" ? value(state) : value; }];
        };
        try { return Component(currentProps); }
        finally { React.useState = originalUseState; }
      },
      select(value) {
        const select = nodes(this.tree()).find(node => node.type === "select");
        assert.ok(select, "the status filter is available");
        select.props.onChange({ target: { value } });
      }
    };
  }

  const review = harness();
  let tree = review.tree();
  assert.deepEqual(rowTitles(tree), ["Included paper", "Excluded paper", "Legacy excluded paper"]);
  assert.deepEqual(nodes(tree).filter(node => node.type === "option").map(label), ["All (3)", "Included (1)", "Excluded (2)"]);
  assert.ok(label(tree).includes("Showing 3 of 3"));
  const allMarkup = render(tree);
  assert.match(allMarkup, /href="https:\/\/doi\.org\/10\.1234\/included"/);
  assert.match(allMarkup, /aria-label="Edit DOI"/);
  assert.match(allMarkup, /DOI Missing/);
  assert.match(allMarkup, /aria-label="Add DOI"/, "imported papers without a DOI retain the editable DOI pill");
  assert.doesNotMatch(allMarkup, /href="https:\/\/doi\.org\/"/, "missing DOI pills do not produce empty links");
  assert.match(allMarkup, /href="\/projects\/review\/full-text"/, "the queue link keeps its phase route");

  review.select("include");
  tree = review.tree();
  assert.deepEqual(rowTitles(tree), ["Included paper"]);
  assert.ok(label(tree).includes("Showing 1 of 3"));
  assert.doesNotMatch(render(tree), /Excluded paper|Legacy excluded paper|DOI Missing/);
  assert.equal(nodes(tree).find(node => node.type === "select").props.value, "include");

  review.select("exclude");
  tree = review.tree();
  assert.deepEqual(rowTitles(tree), ["Excluded paper", "Legacy excluded paper"]);
  assert.ok(label(tree).includes("Showing 2 of 3"));
  assert.doesNotMatch(render(tree), /Included paper|10\.1234\/included/);
  nodes(rows(tree)[0]).find(node => node.type === "button").props.onClick();
  assert.deepEqual(returned, ["excluded-report"], "a filtered row returns its own report ID");

  review.update({ pendingItemId: "excluded-report" });
  tree = review.tree();
  const pendingButtons = rows(tree).map(row => nodes(row).find(node => node.type === "button"));
  assert.ok(pendingButtons.every(button => button.props.disabled), "all visible return buttons wait for the pending action");
  assert.deepEqual(pendingButtons.map(label), ["Returning...", "Return to queue"]);
  assert.equal((render(tree).match(/class="inlineSpinner"/g) ?? []).length, 1);
  review.update({ pendingItemId: "included-report" });
  assert.ok(rows(review.tree()).every(row => nodes(row).find(node => node.type === "button").props.disabled), "an offscreen pending report still prevents duplicate actions");

  review.update({ pendingItemId: "" });
  review.select("all");
  assert.equal(rows(review.tree()).length, 3, "All restores every reviewed report");
  const emptyFilter = harness({ ...props, items: [props.items[0]] });
  emptyFilter.select("exclude");
  const noMatchMarkup = render(emptyFilter.tree());
  assert.equal(rows(emptyFilter.tree()).length, 0);
  assert.match(noMatchMarkup, /No matching reviewed items/);
  assert.match(noMatchMarkup, /Showing 0 of 1/);
  assert.match(noMatchMarkup, /Excluded \(0\)/);
  assert.doesNotMatch(noMatchMarkup, /No reviewed reports/);
  const noDataMarkup = render(harness({ ...props, items: [] }).tree());
  assert.match(noDataMarkup, /No reviewed reports/);
  assert.match(noDataMarkup, /Review a report first\./);
  assert.doesNotMatch(noDataMarkup, /No matching reviewed items/);

  const unfilteredTree = harness({ ...props, statusFilters: undefined }).tree();
  assert.equal(nodes(unfilteredTree).filter(node => node.type === "select").length, 0);
  assert.equal(rows(unfilteredTree).length, 3, "reviewed sections without status options retain their full list");

  const viewable = harness({ ...props, getViewHref: id => buildReviewedFullTextReportPath("review / one", id) });
  viewable.select("exclude");
  const viewLinks = nodes(viewable.tree()).filter(node => node.type === PageLink);
  assert.deepEqual(viewLinks.map(node => node.props.href), ["excluded-report", "legacy-report"].map(id =>
    `/projects/review%20%2F%20one/full-text/reviewed?reportId=${id}`), "filtered View links open their own reviewed reports");
  assert.ok(viewLinks.every(node => node.props.onNavigate === undefined), "View uses ordinary navigation and never invokes the Return action");
  assert.match(render(viewable.tree()), /aria-label="View Excluded paper"[^>]*href="[^"]*reportId=excluded-report"/);
  viewable.update({ pendingItemId: "included-report" });
  assert.ok(nodes(viewable.tree()).filter(node => node.type === PageLink).every(node => node.props.disabled), "View waits while a report is being returned");
  assert.equal(buildReviewedFullTextReportPath("review / one", "report /?&one"), "/projects/review%20%2F%20one/full-text/reviewed?reportId=report%20%2F%3F%26one");

  const detailProject = { ...reviewProjects[0], id: "review", blindMode: true };
  const detailStudy = { ...includedStudy, projectId: detailProject.id, abstract: "A reviewed underwater report", comments: [
    { userId: "reviewer", userName: "Francesco", text: "My saved comment", createdAt: "2026-11-20T09:00:00Z", updatedAt: "2026-11-20T09:00:00Z" },
    { userId: "peer", userName: "Other reviewer", text: "Shared peer comment", createdAt: "2026-11-20T10:00:00Z", updatedAt: "2026-11-20T10:00:00Z" }
  ] };
  const detailReport = { ...reportQueue[0], projectId: detailProject.id, id: "included-report", studyId: detailStudy.id,
    title: "Reviewed underwater report", fileName: "full text & notes.pdf", checksum: "sha&123", fullTextStatusLabel: "Included", fullTextVoteCount: 2 };
  const detailItem = { ...props.items[0], title: detailReport.title, study: detailStudy, completedAt: "2026-11-20T09:00:00Z" };
  const detailProps = { project: detailProject, report: detailReport, item: detailItem, study: detailStudy,
    paperComments: React.createElement(PaperComments, { projectId: detailProject.id, study: detailStudy,
      currentUser: { id: "reviewer", name: "Francesco", timezone: "Europe/Rome" }, onSaveComment: async () => {} }) };
  const detailMarkup = render(React.createElement(ReviewedFullTextReportSection, detailProps));
  assert.match(detailMarkup, /Reviewed underwater report/);
  assert.match(detailMarkup, /My saved comment/);
  assert.match(detailMarkup, /Other reviewer/);
  assert.match(detailMarkup, /Shared peer comment/, "reviewed reports keep shared comments visible in blind mode");
  assert.match(detailMarkup, /My review recorded/);
  assert.match(detailMarkup, /<iframe[^>]*src="\/api\/projects\/review\/reports\/included-report\?pdf=1&amp;checksum=sha%26123&amp;file=full%20text%20%26%20notes.pdf/);
  assert.match(detailMarkup, /href="\/projects\/review\/full-text\/reviewed"[^>]*>[\s\S]*?Back to Reviewed Reports/);
  assert.doesNotMatch(detailMarkup, /<textarea\b/, "saved comments open in read-only cards");
  assert.match(detailMarkup, /aria-label="Edit your comment"/, "the author can explicitly open their editor");
  assert.doesNotMatch(detailMarkup, /Return to queue|Confirm not retrieved|Reserving this report|<button[^>]*>[\s\S]*?Record decision/);
  assert.equal((render(harness({ ...props, items: [detailItem] }).tree()).match(/class="paperCommentIndicator"/g) ?? []).length, 1, "reviewed titles indicate saved comments");
  const missingPdfMarkup = render(React.createElement(ReviewedFullTextReportSection, {
    ...detailProps, report: { ...detailReport, fileName: undefined, retrievalStatus: "not_retrieved" }, item: { ...detailItem, statusLabel: "Not retrieved" }
  }));
  assert.match(missingPdfMarkup, /Not retrieved after attempts/);
  assert.match(missingPdfMarkup, /No PDF uploaded/);
  assert.match(missingPdfMarkup, /Shared peer comment/);
  assert.doesNotMatch(missingPdfMarkup, /<iframe/);
  for (const override of [
    { report: undefined }, { item: undefined }, { report: { ...detailReport, projectId: "foreign" } },
    { item: { ...detailItem, id: "different-report" } }, { study: { ...detailStudy, projectId: "foreign" } }
  ]) {
    const unavailable = render(React.createElement(ReviewedFullTextReportSection, { ...detailProps, ...override }));
    assert.match(unavailable, /Reviewed report unavailable/);
    assert.doesNotMatch(unavailable, /<iframe|Shared peer comment|My saved comment/, "unavailable reports never fall back to another entry");
  }
  assert.equal(getReportPdfUrl("review / one", { ...detailReport, id: "report / one" }).split("?")[0], "/api/projects/review%20%2F%20one/reports/report%20%2F%20one");

  // Exercise the app's renderer so a bookmarked report selects its own record,
  // rather than the active queue report, and rejects IDs outside Reviewed.
  const babel = require("next/dist/compiled/babel/bundle");
  const appSource = fs.readFileSync(path.join(root, "components/prisma-review-app.tsx"), "utf8");
  const appProgram = babel.parser().parse(appSource, { sourceType: "module", plugins: ["typescript", "jsx"] }).program;
  const appFunction = appProgram.body.map(node => node.declaration ?? node).find(node => node.type === "FunctionDeclaration" && node.id?.name === "PrismaReviewApp");
  const renderer = appFunction.body.body.find(node => node.type === "FunctionDeclaration" && node.id?.name === "renderFullTextReviewed");
  assert.ok(renderer);
  const rendererCode = babel.core().transformSync(appSource.slice(renderer.start, renderer.end), {
    filename: "reviewed-renderer.tsx", configFile: false, babelrc: false,
    presets: [babel.presetReact(), babel.presetTypescript()]
  }).code;
  const commentsRequested = [], mutations = [];
  const renderScope = {
    React, BookOpen, ReviewedItemsSection, ReviewedFullTextReportSection, buildReviewedFullTextReportPath,
    selectedProject: detailProject, currentUser: { id: "reviewer" }, reviewedFullTextReportId: detailReport.id,
    reviewedFullTextItems: [detailItem], projectReportQueue: [{ ...detailReport, id: "active-queue-report" }, detailReport],
    decisions: [
      { projectId: detailProject.id, reportId: detailReport.id, userId: "peer", stage: "full_text", isCurrent: true, decisionValue: "exclude", exclusionReasonId: "Peer private reason" },
      { projectId: detailProject.id, reportId: detailReport.id, userId: "reviewer", stage: "full_text", isCurrent: false, decisionValue: "exclude", exclusionReasonId: "Superseded reason" },
      { projectId: detailProject.id, reportId: detailReport.id, userId: "reviewer", stage: "full_text", isCurrent: true, decisionValue: "exclude", exclusionReasonId: "My saved exclusion reason" }
    ],
    renderPaperComments: id => { commentsRequested.push(id); return detailProps.paperComments; },
    fullTextMessage: "", pendingReopenItem: null, renderExclusionReasonCorrections: () => null,
    navigateToProjectView: (...args) => mutations.push(args), returnFullTextReportToQueue: (...args) => mutations.push(args)
  };
  const runRenderer = extra => vm.runInNewContext(`${rendererCode}\nrenderFullTextReviewed();`, { ...renderScope, ...extra });
  const selectedDetail = runRenderer();
  assert.equal(selectedDetail.props.report, detailReport);
  assert.equal(selectedDetail.props.exclusionReason, "My saved exclusion reason");
  assert.match(render(selectedDetail), /My saved exclusion reason/);
  assert.doesNotMatch(render(selectedDetail), /Peer private reason|Superseded reason/);
  assert.deepEqual(commentsRequested, [detailStudy.id]);
  for (const id of ["missing-report", "active-queue-report", ""]) {
    assert.match(render(runRenderer({ reviewedFullTextReportId: id })), /Reviewed report unavailable/);
  }
  assert.deepEqual(commentsRequested, [detailStudy.id], "unavailable report IDs cannot load another paper's comments");
  const list = runRenderer({ reviewedFullTextReportId: null });
  assert.equal(list.type, ReviewedItemsSection);
  assert.equal(list.props.getViewHref(detailReport.id), buildReviewedFullTextReportPath(detailProject.id, detailReport.id));
  assert.deepEqual(mutations, [], "browsing reviewed reports never reopens or changes a review");

  const extractionStatuses = [
    { value: "collecting", label: "Collecting extractions" },
    { value: "pending", label: "Pending consensus" },
    { value: "finalized", label: "Finalized" }
  ];
  const extraction = harness({
    ...props, title: "Submitted Extractions", queueView: "extraction", statusFilters: extractionStatuses,
    items: extractionStatuses.map(status => ({
      ...props.items[0], id: `${status.value}-extraction`, title: `${status.label} paper`,
      statusLabel: status.label, filterValue: status.value
    }))
  });
  assert.deepEqual(nodes(extraction.tree()).filter(node => node.type === "option").map(label), [
    "All (3)", "Collecting extractions (1)", "Pending consensus (1)", "Finalized (1)"
  ]);
  for (const status of extractionStatuses) {
    extraction.select(status.value);
    assert.deepEqual(rowTitles(extraction.tree()), [`${status.label} paper`]);
    assert.ok(label(extraction.tree()).includes("Showing 1 of 3"));
    assert.match(render(extraction.tree()), /href="https:\/\/doi\.org\/10\.1234\/included"/);
  }

  const selectedReports = [];
  const project = { ...reviewProjects[0], id: "consensus-review", extractionRequiredVotes: 1 };
  const template = { id: "template", projectId: project.id, isActive: true, fields: [] };
  const consensusStudies = ["pending", "collecting", "finalized"].map(status => ({
    ...includedStudy, id: `${status}-study`, title: `${status} consensus paper`, projectId: project.id,
    doi: `10.1234/${status}`
  }));
  const reports = consensusStudies.map(study => ({
    ...reportQueue[0], id: study.id.replace("study", "report"), studyId: study.id, projectId: project.id, title: study.title
  }));
  const responses = [reports[0], reports[2]].map(report => ({
    id: `${report.id}-response`, projectId: project.id, studyId: report.studyId, reportId: report.id,
    templateId: template.id, userId: "reviewer", isSubmitted: true,
    submittedAt: "2026-10-20T09:00:00Z", updatedAt: "2026-10-20T09:00:00Z", values: {}
  }));
  const record = {
    id: "finalized-record", projectId: project.id, studyId: reports[2].studyId, reportId: reports[2].id,
    templateId: template.id, status: "finalized", finalizedAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z",
    flaggedFieldIds: [], resolvedValues: {}
  };
  const consensusProps = {
    activeCounts: { studiesIncluded: 3 }, selectedProject: project, currentUser: { id: project.ownerId }, consensusMessage: "",
    activeExtractionTemplate: template, projectExtractionReports: reports, extractionResponses: responses,
    extractionConsensus: [record], activeExtractionReport: reports[0], projectScreeningStudies: consensusStudies,
    setActiveView: noop, setActiveExtractionReportId: id => selectedReports.push(id),
    formatExtractionResponseValue: String, formatAuditTime: String, finalizeExtractionConsensus: noop,
    isFinalizingExtractionConsensus: false, consensusFormValues: {}, updateConsensusValue: noop, toggleConsensusChoice: noop
  };
  const overviewNode = sectionProps => nodes(ConsensusSection(sectionProps)).find(node =>
    typeof node.type === "function" && node.props.items && node.props.renderItems
  );
  const overview = overviewNode(consensusProps);
  assert.ok(overview, "the consensus phase exposes its report overview");
  const consensus = harness(overview.props, overview.type);
  const consensusTitles = overviewTree => nodes(overviewTree).filter(node => node.type === "li")
    .map(item => label(nodes(item).find(node => node.type === "strong")));
  tree = consensus.tree();
  assert.equal(nodes(tree).find(node => node.type === "select").props.value, "pending", "consensus opens with unfinished arbitration when available");
  assert.deepEqual(nodes(tree).filter(node => node.type === "option").map(label), [
    "All (3)", "Pending consensus (1)", "Collecting extractions (1)", "Finalized (1)"
  ]);
  assert.equal(consensusTitles(tree).length, 1);
  assert.ok(consensusTitles(tree)[0].includes("pending consensus paper"));
  assert.match(render(tree), /href="https:\/\/doi\.org\/10\.1234\/pending"/);
  for (const status of ["collecting", "finalized"]) {
    consensus.select(status);
    tree = consensus.tree();
    assert.equal(consensusTitles(tree).length, 1);
    assert.ok(consensusTitles(tree)[0].includes(`${status} consensus paper`));
    assert.ok(label(tree).includes("Showing 1 of 3"));
    assert.match(render(tree), new RegExp(`href="https://doi.org/10\\.1234/${status}"`));
  }
  assert.deepEqual(selectedReports, [], "browsing consensus statuses leaves the active report unchanged");
  nodes(tree).find(node => node.type === "button").props.onClick();
  assert.deepEqual(selectedReports, ["finalized-report"], "the filtered consensus action selects the displayed report");
  consensus.select("all");
  assert.equal(consensusTitles(consensus.tree()).length, 3);
  consensus.update({ items: overview.props.items.filter(item => item.status === "finalized") });
  consensus.select("collecting");
  assert.match(render(consensus.tree()), /No matching consensus reports/);
  assert.ok(label(consensus.tree()).includes("Showing 0 of 1"));
  const finalizedOverview = overviewNode({ ...consensusProps, projectExtractionReports: [reports[2]] });
  const finalizedTree = harness(finalizedOverview.props, finalizedOverview.type).tree();
  assert.equal(nodes(finalizedTree).find(node => node.type === "select").props.value, "all", "a completed consensus phase opens its available reports");
  assert.equal(consensusTitles(finalizedTree).length, 1);
  console.log("Reviewed report checks passed: filters, return actions, linked report details with PDFs and shared comments, safe unavailable states, comment indicators, and consensus browsing without changing the active report.");
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
