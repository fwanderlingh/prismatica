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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-navigation-"));
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
try {
  const sections = ["app-shell", "app-sidebar", "review-queue", "screening-section", "dedup-section", "full-text-section", "extraction-section", "project-dashboard-section"];
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
    noEmitOnError: true, skipLibCheck: true, types: ["node", "react"], typeRoots: [path.join(root, "node_modules/@types")],
    rootDir: root, outDir: temp, paths: { "@/*": [path.join(root, "*")] }
  }, files: sections.map(name => path.join(root, `components/review-sections/${name}.tsx`)) }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const loadSection = name => require(path.join(temp, `components/review-sections/${name}.js`));
  const { NavigationProvider, PageLink } = require(path.join(temp, "components/navigation-link.js"));
  const { getMenuItemIndex } = require(path.join(temp, "lib/keyboardNavigation.js"));
  const { buildPathForState } = require(path.join(temp, "lib/navigation.js"));
  const data = require(path.join(temp, "lib/prismaData.js"));
  const project = data.reviewProjects[0], study = data.screeningStudies[0], report = data.reportQueue[0];
  const { getSequentialPhaseAccess, getSequentialProjectStage } = require(path.join(temp, "lib/workflowSelectors.js"));
  const accessInput = {
    project: { ...project, recordsTotal: 2 },
    studies: [
      { ...study, id: "included", titleAbstractStatus: "advance_full_text" },
      { ...study, id: "pending", titleAbstractStatus: "awaiting_votes" }
    ],
    reports: [{ ...report, fullTextStatus: "advance_extraction", retrievalStatus: "retrieved" }],
    decisions: [], dedupCandidates: [], recordsIdentified: 2, studiesIncluded: 1
  };
  // A single advanced record must not unlock later phases, even if the stored stage advances.
  for (const stage of ["screening", "full_text", "extraction", "complete"]) {
    const access = getSequentialPhaseAccess({ ...accessInput, project: { ...accessInput.project, stage } });
    assert.equal(access.screening, true);
    assert.equal(access.fullText, false, `${stage}: incomplete screening locks full text`);
    assert.equal(access.extraction, false, `${stage}: incomplete screening locks extraction`);
    assert.equal(access.consensus, false);
  }
  // Aggregate completion works with hidden votes and mixed included/excluded studies.
  const finishedScreening = { ...accessInput, studies: accessInput.studies.map(item => ({ ...item, titleAbstractStatus: "excluded_abstract" })) };
  assert.equal(getSequentialPhaseAccess(finishedScreening).fullText, true);
  assert.equal(getSequentialPhaseAccess(finishedScreening).extraction, true);
  for (const status of ["awaiting_votes", "conflict", "needs_third_vote", "manual_review"]) {
    assert.equal(getSequentialPhaseAccess({ ...finishedScreening, studies: [{ ...study, titleAbstractStatus: status }] }).fullText, false);
    const access = getSequentialPhaseAccess({ ...finishedScreening, reports: [{ ...report, fullTextStatus: status, retrievalStatus: "retrieved" }] });
    assert.equal(access.fullText, true, "full-text conflicts remain accessible for resolution");
    assert.equal(access.extraction, false, `${status}: full-text work must finish before extraction`);
    assert.equal(access.consensus, false);
  }
  for (const fullTextStatus of ["advance_extraction", "excluded_full_text"]) {
    assert.equal(getSequentialPhaseAccess({ ...finishedScreening, reports: [{ ...report, fullTextStatus }] }).extraction, true);
  }
  assert.equal(getSequentialPhaseAccess({ ...finishedScreening, reports: [{ ...report, fullTextStatus: "awaiting_votes", retrievalStatus: "not_retrieved" }] }).extraction, true, "unretrievable reports do not block extraction of other included studies");
  assert.equal(getSequentialPhaseAccess({ ...finishedScreening, reports: [] }).fullText, false);
  assert.equal(getSequentialPhaseAccess({ ...finishedScreening, studies: [] }).fullText, false);
  assert.equal(getSequentialPhaseAccess({ ...finishedScreening, studiesIncluded: 0 }).extraction, false);
  assert.equal(getSequentialPhaseAccess({ ...finishedScreening, dedupCandidates: [{ status: "pending" }] }).fullText, false);
  // Legacy data without aggregate statuses still evaluates current votes and required vote counts.
  const legacyInput = { ...finishedScreening, project: { ...project, abstractRequiredVotes: 2, fullTextRequiredVotes: 1 },
    studies: [{ ...study, id: "legacy", titleAbstractStatus: undefined, titleAbstractRequiredVotes: undefined }],
    reports: [{ ...report, id: "legacy-report", fullTextStatus: undefined, fullTextRequiredVotes: undefined, retrievalStatus: "retrieved" }],
    decisions: [
      { projectId: project.id, studyId: "legacy", stage: "title_abstract", decisionValue: "include", isCurrent: true },
      { projectId: project.id, studyId: "legacy", stage: "title_abstract", decisionValue: "include", isCurrent: false },
      { projectId: project.id, reportId: "legacy-report", stage: "full_text", decisionValue: "include", isCurrent: true }
    ] };
  assert.equal(getSequentialPhaseAccess(legacyInput).fullText, false);
  legacyInput.decisions[1].isCurrent = true;
  assert.equal(getSequentialPhaseAccess(legacyInput).extraction, true);
  for (const stage of ["full_text", "extraction", "complete"]) {
    const staleInput = { ...accessInput, project: { ...accessInput.project, stage, requireSequentialPhases: true } };
    assert.equal(getSequentialProjectStage(staleInput), "screening", "stale stages direct users to unfinished screening");
    assert.equal(getSequentialProjectStage({ ...staleInput, project: { ...staleInput.project, requireSequentialPhases: false } }), stage, "parallel reviews retain their furthest phase");
  }
  const stageInput = { ...finishedScreening, project: { ...project, stage: "extraction", requireSequentialPhases: true } };
  assert.equal(getSequentialProjectStage(stageInput), "extraction");
  assert.equal(getSequentialProjectStage({ ...stageInput, reports: [{ ...report, fullTextStatus: "conflict", retrievalStatus: "retrieved" }] }), "full_text");
  assert.equal(getSequentialProjectStage({ ...stageInput, useAggregateStatuses: false }), "screening", "stored summaries cannot override actual missing votes on the server");
  const user = { id: project.ownerId, name: "Alex Reviewer", initials: "AR", avatarColor: "#456" };
  const noop = () => {};
  const html = (Component, props) => renderToStaticMarkup(React.createElement(NavigationProvider, { projectId: project.id, homeView: props.currentUser?.isAdmin ? "adminReviews" : "dashboard" }, React.createElement(Component, props)));

  assert.equal(buildPathForState("pdfUpload", "review / one"), "/projects/review%20%2F%20one/full-text/pdf-upload");
  const sidebarProps = { brandName: "Prismatica", brandTagline: "Reviews", brandLogoAlt: "Home", isSidebarCollapsed: true,
    isMobileNavOpen: false, isProjectView: true, activeView: "screening", currentUser: user, selectedProject: project,
    globalNavItems: [{ key: "dashboard", label: "Home", path: "/dashboard" }],
    projectNavItems: [{ key: "screening", label: "Screening", path: "" }, { key: "extraction", label: "Extraction", path: "" }, { key: "settings", label: "Settings", path: "" }],
    reviewPhaseNavKeys: new Set(["screening", "extraction"]), exportFailedCount: 0, getPhaseNavState: () => "current",
    canNavigateToProjectView: key => key !== "extraction", onGoDashboard: noop, onNavigate: noop, onToggleSidebar: noop, onToggleMobileNav: noop };
  const sidebarHtml = html(loadSection("app-sidebar").AppSidebar, sidebarProps);
  assert.match(sidebarHtml, /<a[^>]*aria-current="page"[^>]*aria-label="Screening"[^>]*href="[^"]+\/screening"/);
  assert.match(sidebarHtml, /<span(?=[^>]*aria-label="Extraction")(?=[^>]*role="link")(?=[^>]*aria-disabled="true")(?=[^>]*tabindex="-1")[^>]*>/);
  assert.match(sidebarHtml, /href="\/dashboard"/);
  assert.equal(buildPathForState("systemSettings", project.id), "/admin/settings");
  assert.equal(buildPathForState("storageInfo", project.id), "/admin/storage");
  const adminNavItems = [
    { key: "dashboard", label: "All Reviews", path: "/dashboard" },
    { key: "adminReviews", label: "Review Admin", path: "/admin/reviews" },
    { key: "registeredUsers", label: "Registered Users", path: "/admin/users" },
    { key: "systemSettings", label: "System Settings", path: "/admin/settings" },
    { key: "storageInfo", label: "Storage Info", path: "/admin/storage" }
  ];
  const adminSidebar = html(loadSection("app-sidebar").AppSidebar, {
    ...sidebarProps, currentUser: { ...user, isAdmin: true }, isProjectView: false,
    activeView: "systemSettings", globalNavItems: adminNavItems
  });
  assert.doesNotMatch(adminSidebar, /href="\/dashboard"|All Reviews/);
  assert.match(adminSidebar, /href="\/admin\/reviews"/);
  assert.match(adminSidebar, /href="\/admin\/storage"/);
  assert.match(adminSidebar, /<a(?=[^>]*aria-current="page")(?=[^>]*href="\/admin\/settings")[^>]*>/);
  const reviewerSidebar = html(loadSection("app-sidebar").AppSidebar, {
    ...sidebarProps, isProjectView: false, activeView: "dashboard", globalNavItems: adminNavItems
  });
  assert.match(reviewerSidebar, /href="\/dashboard"/);
  assert.doesNotMatch(reviewerSidebar, /href="\/admin\//);
  const adminProjectSidebar = html(loadSection("app-sidebar").AppSidebar, {
    ...sidebarProps, currentUser: { ...user, isAdmin: true }, globalNavItems: adminNavItems
  });
  assert.match(adminProjectSidebar, /aria-label="Home"[^>]*href="\/admin\/reviews"/);
  assert.doesNotMatch(adminProjectSidebar, /href="\/dashboard"/);
  let navigations = 0, prevented = false;
  const link = PageLink({ href: "/about", onNavigate: () => navigations++, children: "About" });
  assert.equal(link.props.href, "/about");
  assert.equal(link.props.onClick, undefined); // Next Link handles ordinary and modified clicks.
  link.props.onNavigate({ preventDefault: () => prevented = true });
  assert.equal(navigations, 1); assert.equal(prevented, true);
  assert.equal(PageLink({ href: "/about", disabled: true, onNavigate: noop }).type, "span");

  const shellProps = { pageKey: "/dashboard", isSidebarCollapsed: false, isMobileNavOpen: false, brandLogoAlt: "Home", currentUser: user,
    breadcrumbItems: [{ label: "All reviews", href: "/dashboard", onClick: noop }, { label: "Screening", current: true }],
    sidebar: null, children: React.createElement("button", null, "Review"), onGoDashboard: noop, onNavigateProfile: noop, onNavigateAbout: noop, onToggleMobileNav: noop };
  const shellHtml = html(loadSection("app-shell").AppShell, shellProps);
  assert.match(shellHtml, /href="#main-content"[^>]*>Skip to main content/);
  assert.match(shellHtml, /<main id="main-content" tabindex="-1"/);
  assert.match(shellHtml, /<a class="breadcrumbLink" href="\/dashboard"/);
  assert.match(shellHtml, /aria-current="page">Screening/);
  const pendingHtml = html(loadSection("app-shell").AppShell, { ...shellProps, isMainPending: true, mainPendingLabel: "Opening review" });
  assert.match(pendingHtml, /aria-busy="true"/);
  assert.match(pendingHtml, /class="mainLoadingOverlay" role="status"/);
  assert.match(pendingHtml, /Opening review/);

  const screeningProps = { projectScreeningStudies: data.screeningStudies, totalScreeningStudyCount: 10, screeningProgress: 20,
    decisions: [], selectedProjectId: project.id, blindMode: project.blindMode, currentUserId: user.id, studyIndex: 0, setStudyIndex: noop, titleAbstractEvaluations: new Map(),
    formatDecision: String, decisionTone: () => "info", currentStudy: study, stageEvaluation: { state: "open", label: "Open" }, highlightText: String,
    screeningNote: "", setScreeningNote: noop, screeningMessage: "", canRecordScreeningDecision: true, checkoutError: "", currentStageDecisions: [],
    pendingScreeningDecision: null, isUndoingScreeningDecision: false, reviewedCount: 2, onOpenReviewed: noop, formatConflictResolutionHint: String,
    selectedProjectAbstractRequiredVotes: 2, addScreeningDecision: noop, undoLastDecision: noop, conflictCount: 0, onResolveConflict: noop };
  const dedupProps = { projectImportBatches: [], projectScreeningStudies: data.screeningStudies, recordsIdentified: 10,
    projectDedupCandidates: data.dedupCandidates, pendingDedupAction: null, dedupMessage: "", isRejectingAllDedupCandidates: false,
    updateDedupCandidate: noop, updateDedupStudy: noop, rejectAllPendingDedupCandidates: noop };
  const fullTextProps = { hasProjectSeedData: true, phaseProgress: { percent: 20, label: "20%" }, projectReportQueue: [report], totalFullTextReportCount: 1,
    activeReport: report, decisions: [], selectedProject: project, currentUser: user, fullTextMessage: "", checkoutError: "",
    setActiveReportId: noop, setFullTextMessage: noop, pdfInputRef: { current: null }, pendingFullTextAction: null, uploadReportPdf: noop,
    updateFullTextReport: noop, formatDecision: String, formatConflictResolutionHint: String, decisionTone: () => "info", fullTextReason: "",
    setFullTextReason: noop, exclusionReasons: [], studies: data.screeningStudies, reviewedCount: 0, onOpenReviewed: noop, onOpenPdfUpload: noop,
    conflictCount: 0, onResolveConflict: noop };
  const extractionProps = { activeCounts: data.prismaCounts, projectReportQueue: [report], projectExtractionStudyIds: new Set([study.id]), selectedProject: project,
    currentUser: user, extractionMessage: "", activeExtractionTemplate: { id: "template", title: "Review template", fields: [] }, isEditingExtractionTemplate: false,
    projectExtractionReports: [report], totalExtractionReportCount: 1, setActiveView: noop, setActiveExtractionReportId: noop, setActiveReportId: noop,
    projectScreeningStudies: data.screeningStudies, extractionResponses: [], extractionFormValues: {}, submitExtractionResponse: noop, reviewedCount: 0, onOpenReviewed: noop };
  const screeningHtml = html(loadSection("screening-section").ScreeningSection, screeningProps);
  assert.ok(screeningHtml.indexOf("citationPanel") < screeningHtml.indexOf("actionPanel"));
  assert.ok(screeningHtml.indexOf("actionPanel") < screeningHtml.indexOf("reviewQueueDisclosure"));
  assert.match(screeningHtml, /<details class="reviewQueueDisclosure"><summary>Screening queue/);
  const dedupHtml = html(loadSection("dedup-section").DedupSection, dedupProps);
  assert.ok(dedupHtml.indexOf("dedupRecordActions") < dedupHtml.indexOf("reviewQueueDisclosure"));
  const fullTextHtml = html(loadSection("full-text-section").FullTextSection, fullTextProps);
  assert.ok(fullTextHtml.indexOf("fullTextPanel") < fullTextHtml.indexOf("pdfPane"));
  assert.match(fullTextHtml, /href="[^"]+\/full-text\/pdf-upload"/);
  const extractionHtml = html(loadSection("extraction-section").ExtractionSection, extractionProps);
  assert.ok(extractionHtml.indexOf("extractionFormPanel") < extractionHtml.indexOf("pdfPane"));
  const overviewProps = { selectedProject: { ...project, stage: "full_text" }, currentUserId: user.id, workflowConflicts: [], recordsIdentified: 10, activeCounts: data.prismaCounts,
    exportFailedCount: 0, projectEvents: [], latestProjectEvents: [], projectUserStats: [], projectScreeningStudies: [], projectReportQueue: [],
    openConflict: noop, formatConflictStage: String, decisionTone: () => "info", formatDecision: String, getWorkflowStepState: () => "pending",
    formatProjectPhase: String, projectPhaseStatusTone: () => "info", formatMaybePolicy: String, formatAuditEntityLabel: String,
    formatAuditTime: String, formatNumber: String, onOpenSettings: noop, onOpenAudit: noop, onNavigate: noop };
  const overviewHtml = html(loadSection("project-dashboard-section").ProjectDashboardSection, overviewProps);
  assert.doesNotMatch(overviewHtml, /conflictButton/);
  const conflict = { id: "conflict", stage: "title_abstract", studyId: study.id, title: study.title, subtitle: "Resolve conflict", decisions: [] };
  const overviewWithConflict = html(loadSection("project-dashboard-section").ProjectDashboardSection, {
    ...overviewProps, selectedProject: { ...project, stage: "screening" }, workflowConflicts: [conflict]
  });
  assert.match(overviewWithConflict, /class="ghostButton conflictButton"[^>]*href="[^"]+\/screening"/);
  assert.match(overviewWithConflict, /Continue screening/);
  assert.ok(overviewWithConflict.indexOf("conflictButton") < overviewWithConflict.indexOf("Continue screening"), "resolve action appears before the continue action");
  assert.doesNotMatch(screeningHtml, /conflictButton/);
  assert.doesNotMatch(fullTextHtml, /conflictButton/);
  for (const empty of [false, true]) {
    const screeningConflictHtml = html(loadSection("screening-section").ScreeningSection, {
      ...screeningProps, conflictCount: 2, projectScreeningStudies: empty ? [] : screeningProps.projectScreeningStudies
    });
    assert.match(screeningConflictHtml, /class="ghostButton conflictButton"[^>]*href="[^"]+\/screening"/);
    assert.match(screeningConflictHtml, /Resolve 2 conflicts/);
    const fullTextConflictHtml = html(loadSection("full-text-section").FullTextSection, {
      ...fullTextProps, conflictCount: 1, projectReportQueue: empty ? [] : [report]
    });
    assert.match(fullTextConflictHtml, /class="ghostButton conflictButton"[^>]*href="[^"]+\/full-text"/);
    assert.match(fullTextConflictHtml, /Resolve 1 conflict/);
  }
  const { ResolveConflictButton } = loadSection("resolve-conflict-button");
  let resolved = false;
  const conflictButton = ResolveConflictButton({ count: 1, view: "screening", onResolve: () => resolved = true });
  conflictButton.props.onNavigate();
  assert.equal(resolved, true, "resolve action calls the existing conflict navigation handler");
  assert.equal(ResolveConflictButton({ count: 0, view: "screening", onResolve: noop }), null);
  assert.match(overviewHtml, /<ol class="workflowMap" aria-label="Review workflow">/);
  assert.equal((overviewHtml.match(/<li class="workflowNode /g) ?? []).length, 6);
  assert.match(overviewHtml, /<a class="primaryButton" href="[^"]+\/full-text">/);

  // Exercise component event handlers and effects with DOM focus stubs, without a browser dependency.
  let hooks = [], cursor = 0, pendingEffects = [], wide = false;
  const fakeReact = { ...React,
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], value => hooks[i] = typeof value === "function" ? value(hooks[i]) : value]; },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useMemo(fn) { return fn(); },
    useSyncExternalStore() { return wide; },
    useEffect(fn, deps) { const i = cursor++, previous = hooks[i]; if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) { previous?.cleanup?.(); hooks[i] = { deps }; pendingEffects.push(() => hooks[i].cleanup = fn()); } }
  };
  const mockedFiles = new Set(sections.map(name => path.join(temp, `components/review-sections/${name}.js`)));
  mockedFiles.add(path.join(temp, "components/use-review-queue-scroll.js"));
  Module._load = function(name, parent, ...args) { return name === "react" && mockedFiles.has(parent?.filename) ? fakeReact : originalLoad.call(this, name, parent, ...args); };
  for (const file of mockedFiles) delete require.cache[file];
  function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(n => nodes(n, result)); else if (node?.props) { result.push(node); nodes(node.props.children, result); } return result; }
  function focusNode(label) { return { textContent: label, focus() { globalThis.document.activeElement = this; }, click() { this.clicked = true; }, closest() { return null; }, getClientRects() { return [1]; } }; }
  const items = [focusNode("Profile"), focusNode("About")], trigger = focusNode("Account"), navTrigger = focusNode("Navigation"), main = focusNode("Main"), before = focusNode("Before"), after = focusNode("After");
  const listeners = new Map();
  globalThis.document = { activeElement: trigger, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    querySelectorAll: () => [before, trigger, after], querySelector: () => after };
  const scrollCalls = [];
  globalThis.window = { matchMedia: () => ({ matches: true }), location: { hash: "" }, scrollY: 900,
    scrollTo(options) { scrollCalls.push(options); this.scrollY = options.top; } };
  const { AppShell } = loadSection("app-shell");
  function renderShell(props = shellProps) {
    cursor = 0; const tree = AppShell(props);
    for (const node of nodes(tree)) {
      if (!node.props.ref) continue;
      node.props.ref.current = node.props.className?.startsWith("userMenu ") || node.props.className === "userMenu" ? { querySelectorAll: () => items, contains: () => true }
        : node.props.className?.includes("userMenuTrigger") ? trigger : node.props.className?.includes("topbarNavToggle") ? navTrigger : node.type === "main" ? main : null;
    }
    pendingEffects.splice(0).forEach(fn => fn()); return tree;
  }
  const keyEvent = (key, extra = {}) => ({ key, preventDefault() { this.defaultPrevented = true; }, ...extra });
  function menuKey(tree, key, extra) { const event = keyEvent(key, extra); nodes(tree).find(n => n.props.role === "menu").props.onKeyDown(event); return event; }
  let tree = renderShell();
  assert.equal(window.scrollY, 900); // Mounting preserves a restored position.
  nodes(tree).find(n => n.props.className === "skipLink").props.onClick(); assert.equal(document.activeElement, main);
  const account = nodes(tree).find(n => n.props.className?.includes("userMenuTrigger"));
  account.props.onClick(); tree = renderShell(); assert.equal(document.activeElement, items[0]);
  menuKey(tree, "ArrowUp"); assert.equal(document.activeElement, items[1]);
  menuKey(tree, "ArrowDown"); assert.equal(document.activeElement, items[0]);
  menuKey(tree, "End"); assert.equal(document.activeElement, items[1]);
  menuKey(tree, "Home"); assert.equal(document.activeElement, items[0]);
  menuKey(tree, "a"); assert.equal(document.activeElement, items[1]);
  menuKey(tree, " "); assert.equal(items[1].clicked, true);
  menuKey(tree, "Escape"); tree = renderShell(); assert.equal(document.activeElement, trigger); assert.ok(!nodes(tree).some(n => n.props.role === "menu"));
  account.props.onKeyDown(keyEvent("ArrowUp")); tree = renderShell(); assert.equal(document.activeElement, items[1]);
  menuKey(tree, "Tab"); renderShell(); assert.equal(document.activeElement, after);
  account.props.onKeyDown(keyEvent("ArrowDown")); tree = renderShell(); assert.equal(document.activeElement, items[0]);
  menuKey(tree, "Tab", { shiftKey: true }); renderShell(); assert.equal(document.activeElement, before);
  const pendingTree = renderShell({ ...shellProps, navigationTarget: "/projects/review", isMainPending: true });
  assert.ok(nodes(pendingTree).some(node => node.props.className === "mainLoadingOverlay"));
  assert.equal(window.scrollY, 900); // Wait until the destination is rendered.
  renderShell({ ...shellProps, pageKey: "/projects/review", navigationTarget: "/projects/review" });
  assert.equal(window.scrollY, 0);
  assert.deepEqual(scrollCalls, [{ top: 0, left: 0, behavior: "instant" }]);
  assert.equal(document.activeElement, main);
  window.scrollY = 400;
  renderShell({ ...shellProps, pageKey: "/projects/review" });
  renderShell({ ...shellProps, pageKey: "/projects/review" });
  assert.equal(window.scrollY, 400); // Updates within a page do not move the reader.
  window.scrollY = 900;
  renderShell(shellProps);
  assert.equal(window.scrollY, 900); // Back/Forward has no navigation target.
  assert.equal(scrollCalls.length, 1);
  window.location.hash = "#exclusion-reasons";
  renderShell({ ...shellProps, pageKey: "/projects/review/settings", navigationTarget: "/projects/review/settings" });
  assert.equal(scrollCalls.length, 1); // Keep links to a specific section intact.
  window.location.hash = "";
  renderShell({ ...shellProps, pageKey: "/about" }); assert.equal(document.activeElement, main);
  renderShell({ ...shellProps, pageKey: "/about", isMobileNavOpen: true }); assert.equal(document.activeElement, after);
  let mobileClosed = false;
  renderShell({ ...shellProps, pageKey: "/about", isMobileNavOpen: true, onToggleMobileNav: () => mobileClosed = true });
  listeners.get("keydown")(keyEvent("Escape")); assert.equal(mobileClosed, true); assert.equal(document.activeElement, navTrigger);
  assert.equal(getMenuItemIndex("ArrowUp", -1, ["Profile", "About"]), 1);
  assert.equal(getMenuItemIndex("z", 0, ["Profile", "About"]), undefined);
  assert.equal(getMenuItemIndex("ArrowDown", 0, []), undefined);

  const { useReviewQueueScroll } = require(path.join(temp, "components/use-review-queue-scroll.js"));
  let mobileViewport = true, reducedMotion = false;
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = query => ({ matches: query.includes("prefers-reduced-motion") ? reducedMotion : mobileViewport });
  function renderQueueScroll(queueKey, itemId, savedDecision = null) {
    cursor = 0;
    useReviewQueueScroll(queueKey, itemId, savedDecision);
    pendingEffects.splice(0).forEach(fn => fn());
  }
  for (const phase of ["screening", "fullText", "extraction", "consensus", "dedup"]) {
    hooks = []; pendingEffects = []; scrollCalls.length = 0; window.scrollY = 900;
    const queueKey = `review:${phase}`;
    renderQueueScroll(queueKey, "first");
    assert.equal(window.scrollY, 900); // Opening a queue preserves its position.
    renderQueueScroll(queueKey, "second");
    assert.equal(scrollCalls.length, 0); // Manual selection or a failed save has no signal.
    const saved = { queueKey, itemId: "second" };
    renderQueueScroll(queueKey, "third", saved);
    assert.deepEqual(scrollCalls, [{ top: 0, left: 0, behavior: "smooth" }]);
    renderQueueScroll(queueKey, "third", saved);
    renderQueueScroll(queueKey, "fourth", saved);
    assert.equal(scrollCalls.length, 1); // A save is handled once; later selections do not scroll.
    renderQueueScroll(queueKey, "fourth", { queueKey, itemId: "fourth" });
    renderQueueScroll(queueKey, "fifth");
    assert.equal(scrollCalls.length, 1); // A saved vote that retains the item does not scroll.
    renderQueueScroll(queueKey, "", { queueKey, itemId: "fifth" });
    assert.equal(scrollCalls.length, 2); // Reveal the queue completion message too.
    renderQueueScroll("other-review:screening", "other", { queueKey, itemId: "fifth" });
    assert.equal(scrollCalls.length, 2); // An in-flight save cannot scroll another page/project.
    mobileViewport = false;
    renderQueueScroll(queueKey, "next", { queueKey, itemId: "previous" });
    assert.equal(scrollCalls.length, 2); // Desktop keeps its current scroll position.
    mobileViewport = true; reducedMotion = true;
    renderQueueScroll(queueKey, "last", { queueKey, itemId: "next" });
    assert.deepEqual(scrollCalls.at(-1), { top: 0, left: 0, behavior: "instant" });
    reducedMotion = false;
    hooks = []; pendingEffects = [];
    renderQueueScroll(queueKey, "last", saved);
    assert.equal(scrollCalls.length, 3); // Remounting does not replay an earlier save.
  }
  window.matchMedia = originalMatchMedia;

  hooks = []; cursor = 0;
  const { ReviewQueueDisclosure } = loadSection("review-queue");
  let disclosure = ReviewQueueDisclosure({ label: "Queue", children: null }); assert.equal(disclosure.props.open, false);
  disclosure.props.onToggle({ currentTarget: { open: true } }); cursor = 0;
  assert.equal(ReviewQueueDisclosure({ label: "Queue" }).props.open, true);
  hooks = []; cursor = 0; wide = true;
  assert.equal(ReviewQueueDisclosure({ label: "Queue" }).props.open, true);
  // Verify queues remain siblings of review controls, including when no candidate is selected.
  for (const [name, component, props, layout, expected] of [
    ["dedup-section", "DedupSection", dedupProps, "dedupGrid", ["dedupDetailColumn", ReviewQueueDisclosure]],
    ["screening-section", "ScreeningSection", screeningProps, "screeningLayout", ["panel citationPanel", "panel actionPanel", ReviewQueueDisclosure]]
  ]) {
    hooks = []; cursor = 0; pendingEffects = [];
    const result = loadSection(name)[component](props);
    const children = nodes(result).find(node => node.props.className === layout).props.children.filter(Boolean);
    assert.deepEqual(children.map(child => typeof child.type === "string" ? child.props.className : child.type), expected);
  }

  const css = require("postcss").parse(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"));
  function declaration(selector, property, width) {
    let value;
    css.walkRules(rule => {
      if (!rule.selector.split(",").map(s => s.trim()).includes(selector)) return;
      for (let parent = rule.parent; parent; parent = parent.parent) {
        if (parent.type !== "atrule" || parent.name !== "media") continue;
        for (const match of parent.params.matchAll(/(min|max)-width:\s*(\d+)px/g)) {
          if (match[1] === "min" ? width < +match[2] : width > +match[2]) return;
        }
      }
      rule.walkDecls(property, decl => value = decl.value);
    });
    return value;
  }
  assert.equal(declaration(".screeningLayout", "grid-template-areas", 320), '"citation" "decision" "queue"');
  assert.equal(declaration(".screeningLayout", "grid-template-areas", 1440), '"queue citation decision"');
  assert.equal(declaration(".fullTextLayout", "grid-template-areas", 768), '"decision" "pdf"');
  assert.equal(declaration(".extractionWorkspace", "grid-template-areas", 768), '"extraction" "pdf"');
  for (const [width, columns] of [[320, "minmax(0, 1fr)"], [768, "repeat(2, minmax(0, 1fr))"], [1024, "repeat(3, minmax(0, 1fr))"]]) {
    assert.equal(declaration(".workflowMap", "grid-template-columns", width), columns);
  }
  assert.equal(declaration(".appFrame.sidebar-collapsed .navLabel", "display", 768), undefined);
  assert.equal(declaration(".appFrame.sidebar-collapsed .navLabel", "display", 1440), "none");
  for (const width of [320, 768, 860]) {
    assert.equal(declaration(".contentHeader", "position", width), "sticky");
    assert.equal(declaration(".contentHeader", "top", width), "0");
    assert.equal(declaration(".contentHeader", "background", width), "var(--surface)");
    assert.equal(declaration(".contentHeader", "backdrop-filter", width), "none");
    assert.equal(declaration(".contentHeader", "-webkit-backdrop-filter", width), "none");
    assert.equal(declaration(".contentHeader", "z-index", width), "40");
    assert.equal(declaration(".contentHeader .topbarNavToggle", "display", width), "inline-flex");
    assert.equal(declaration(".contentHeader .topbarBrand", "display", width), "inline-flex");
  }
  assert.equal(declaration(".contentHeader", "backdrop-filter", 1440), "blur(calc(10px * var(--ui-scale)))");
  for (const width of [320, 768, 1440]) {
    assert.equal(declaration(".mainLoadingOverlay", "position", width), "fixed");
    assert.equal(declaration(".mainLoadingOverlay", "inset", width), "0");
    assert.equal(declaration(".mainLoadingOverlay", "place-items", width), "center");
    assert.equal(declaration(".mainLoadingPanel", "max-width", width), "100%");
    assert.equal(declaration(".mainLoadingPanel", "max-height", width), "100%");
    assert.equal(declaration(".mainLoadingPanel", "overflow-y", width), "auto");
  }

  // Execute the production deletion/navigation functions and route effects while
  // Next's router deliberately leaves the old project pathname in place.
  const babel = require("next/dist/compiled/babel/bundle");
  const appSource = fs.readFileSync(path.join(root, "components/prisma-review-app.tsx"), "utf8");
  const appProgram = babel.parser().parse(appSource, { sourceType: "module", plugins: ["typescript", "jsx"] }).program;
  const findFunction = (statements, name) => statements.map(node => node.declaration ?? node).find(node => node.type === "FunctionDeclaration" && node.id?.name === name);
  const appFunction = findFunction(appProgram.body, "PrismaReviewApp");
  const routeEffects = appFunction.body.body.filter(node => node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && node.expression.callee.name === "useEffect");
  const effectDependencies = node => node.expression.arguments[1]?.elements?.filter(item => item?.type === "Identifier").map(item => item.name) ?? [];
  const accessEffect = routeEffects.find(node => effectDependencies(node).includes("requestedProjectId"));
  const completedRouteEffect = routeEffects.find(node => {
    const dependencies = effectDependencies(node);
    return dependencies.length === 2 && dependencies.includes("pathname") && dependencies.includes("pendingRoutePath");
  });
  const sourceText = node => appSource.slice(node.start, node.end);
  const routeCode = babel.core().transformSync([
    findFunction(appProgram.body, "normalizePathname"),
    ...["clearPendingRoute", "setActiveView", "deleteCurrentProjectFromSettings"].map(name => findFunction(appFunction.body.body, name))
  ].map(sourceText).join("\n") + `\nfunction renderRouteEffects() {\n${sourceText(completedRouteEffect)}\n${sourceText(accessEffect)}\n}`, {
    filename: "project-navigation.ts", configFile: false, babelrc: false, presets: [babel.presetTypescript()]
  }).code;

  function projectRouteHarness({ isAdmin = false, lastProject = false, missing = false, deletionError = false } = {}) {
    const review = { id: "delete-review", title: "Deleted test review" };
    const remaining = { id: "remaining-review", title: "Remaining review" };
    const requestedId = missing ? "missing / review" : review.id;
    const hardRedirects = [], routeRequests = [], apiRequests = [], effects = [], dependencies = [];
    let effectIndex = 0;
    const scope = {
      isAuthenticated: true, isAuthResolved: true,
      pathname: `/projects/${encodeURIComponent(requestedId)}/settings`, requestedProjectId: requestedId,
      selectedProject: review, selectedProjectId: review.id,
      userProjects: lastProject ? [review] : [review, remaining],
      homeView: isAdmin ? "adminReviews" : "dashboard", pendingRoutePath: null,
      dashboardMessage: "", deleteProjectMessage: "", isDeletingProject: false,
      buildPathForState, startTransition: callback => callback(),
      getPendingRouteLabel: () => "Opening reviews", getErrorMessage: error => error.message,
      setPendingRoutePath: value => scope.pendingRoutePath = value,
      setPendingRouteLabel: noop,
      setSelectedProjectId: value => scope.selectedProjectId = value,
      setDashboardMessage: value => scope.dashboardMessage = value,
      setDeleteProjectMessage: value => scope.deleteProjectMessage = value,
      setIsDeletingProject: value => scope.isDeletingProject = value,
      applyAppState(payload) {
        scope.userProjects = payload.projects;
        scope.selectedProjectId = payload.projects[0]?.id ?? "demo-review";
      },
      async apiRequest(url, options) {
        apiRequests.push({ url, method: options.method });
        if (deletionError) throw new Error("Deletion failed.");
        return { projects: scope.userProjects.filter(item => item.id !== review.id), message: "Review deleted successfully." };
      },
      router: {
        replace: target => routeRequests.push({ method: "replace", target }),
        push: target => routeRequests.push({ method: "push", target })
      },
      window: { confirm: () => true, location: { pathname: "", replace: target => hardRedirects.push(target) } },
      useEffect(effect, nextDependencies) {
        const index = effectIndex++, previous = dependencies[index];
        if (!previous || nextDependencies.some((value, position) => !Object.is(value, previous[position]))) {
          dependencies[index] = nextDependencies;
          effects.push(effect);
        }
      }
    };
    scope.window.location.pathname = scope.pathname;
    vm.runInContext(routeCode, vm.createContext(scope));
    function render() {
      effectIndex = 0;
      scope.renderRouteEffects();
      effects.splice(0).forEach(effect => effect());
    }
    function commitRoute(target) {
      scope.pathname = target;
      scope.window.location.pathname = target;
      scope.requestedProjectId = null;
      render();
    }
    return { scope, render, commitRoute, hardRedirects, routeRequests, apiRequests };
  }

  for (const isAdmin of [false, true]) {
    for (const lastProject of [false, true]) {
      const navigation = projectRouteHarness({ isAdmin, lastProject });
      navigation.render();
      await navigation.scope.deleteCurrentProjectFromSettings();
      const destination = isAdmin ? "/admin/reviews" : "/dashboard";
      assert.deepEqual(navigation.apiRequests, [{ url: "/api/projects/delete-review", method: "DELETE" }]);
      assert.deepEqual(navigation.routeRequests, [{ method: "replace", target: destination }]);
      assert.equal(navigation.scope.pathname, "/projects/delete-review/settings", "Next has not committed the destination yet");
      navigation.render();
      assert.deepEqual(navigation.hardRedirects, [], `deletion waits for ${destination}, including lastProject=${lastProject}`);
      navigation.commitRoute(destination);
      assert.equal(navigation.scope.pendingRoutePath, null, "navigation completes after the dashboard pathname commits");
      assert.equal(navigation.scope.dashboardMessage, "Review deleted successfully.");
      assert.equal(navigation.scope.userProjects.length, lastProject ? 0 : 1);
      assert.deepEqual(navigation.hardRedirects, []);
    }
  }
  const missingProject = projectRouteHarness({ missing: true });
  missingProject.render();
  assert.deepEqual(missingProject.hardRedirects, ["/__not-found?missingProjectId=missing%20%2F%20review"], "direct visits to inaccessible reviews still open the missing-project page");
  const missingDestination = projectRouteHarness({ missing: true });
  missingDestination.scope.pendingRoutePath = missingDestination.scope.pathname;
  missingDestination.render();
  assert.equal(missingDestination.hardRedirects.length, 1, "a committed navigation to a missing review still checks access");
  const cancelledNavigation = projectRouteHarness({ missing: true });
  cancelledNavigation.scope.pendingRoutePath = "/dashboard";
  cancelledNavigation.render();
  assert.deepEqual(cancelledNavigation.hardRedirects, []);
  cancelledNavigation.scope.pendingRoutePath = null;
  cancelledNavigation.render();
  assert.equal(cancelledNavigation.hardRedirects.length, 1, "clearing a pending navigation reruns the access check");
  const failedDeletion = projectRouteHarness({ deletionError: true });
  failedDeletion.render();
  await failedDeletion.scope.deleteCurrentProjectFromSettings();
  failedDeletion.render();
  assert.equal(failedDeletion.scope.deleteProjectMessage, "Deletion failed.");
  assert.equal(failedDeletion.scope.isDeletingProject, false);
  assert.equal(failedDeletion.scope.userProjects.length, 2);
  assert.deepEqual(failedDeletion.routeRequests, []);
  assert.deepEqual(failedDeletion.hardRedirects, []);

  console.log("Navigation checks passed: deletion redirects with delayed router commits, missing-project access checks, link URLs, locked phases, skip link, keyboard menus, navigation scroll reset and history/anchor preservation, mobile queue advancement scroll and reduced motion, viewport loading overlay, mobile navigation focus, queue disclosure and content order, and responsive CSS at 320–1440px.");
} finally {
  Module._resolveFilename = originalResolve; Module._load = originalLoad;
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  fs.rmSync(temp, { recursive: true, force: true });
}
