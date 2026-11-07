import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-extraction-discard-"));
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalWindow = globalThis.window;
let passed = 0;

async function check(name, run) {
  try {
    await run();
    passed++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

try {
  const hookFile = path.join(temp, "components/use-extraction-discard-confirmation.js");
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "Node16", moduleResolution: "Node16", esModuleInterop: true,
      noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
      typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
      paths: { "@/*": [path.join(root, "*")] }
    },
    files: [path.join(root, "lib/extractionDraft.ts"), path.join(root, "components/use-extraction-discard-confirmation.ts")]
  }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };

  // Run the production hook with persistent refs and React's effect cleanup order.
  let runner;
  const sameDependencies = (before, after) => before && after && before.length === after.length && after.every((value, index) => Object.is(value, before[index]));
  function useEffect(effect, dependencies) {
    const index = runner.cursor++, previous = runner.slots[index];
    if (!sameDependencies(previous?.dependencies, dependencies)) {
      const slot = { dependencies };
      runner.slots[index] = slot;
      runner.effects.push(() => {
        previous?.cleanup?.();
        slot.cleanup = effect();
      });
    }
  }
  const fakeReact = {
    useRef(initial) {
      const index = runner.cursor++;
      return runner.slots[index] ??= { current: initial };
    },
    useEffect,
    useLayoutEffect: useEffect,
    useMemo(calculate, dependencies) {
      const index = runner.cursor++, previous = runner.slots[index];
      if (!sameDependencies(previous?.dependencies, dependencies)) runner.slots[index] = { dependencies, value: calculate() };
      return runner.slots[index].value;
    },
    useCallback(callback, dependencies) { return fakeReact.useMemo(() => callback, dependencies); }
  };
  Module._load = function(name, parent, ...args) {
    return name === "react" && parent?.filename === hookFile ? fakeReact : originalLoad.call(this, name, parent, ...args);
  };
  const { hasUnsavedExtractionAnswers } = require(path.join(temp, "lib/extractionDraft.js"));
  const { useExtractionDiscardConfirmation } = require(hookFile);
  const fields = [
    { id: "notes", title: "Notes", type: "multiline_text", options: [] },
    { id: "design", title: "Design", type: "single_choice", options: ["RCT", "Cohort"] },
    { id: "outcomes", title: "Outcomes", type: "multiple_choice", options: ["Safety", "Efficacy", "Cost"] }
  ];

  await check("blank and unchanged answers do not count as edits", () => {
    for (const values of [{}, { notes: undefined }, { notes: "" }, { notes: " \n\t " }, { outcomes: [] }]) {
      assert.equal(hasUnsavedExtractionAnswers(fields, values), false);
    }
    const saved = { notes: "Example finding", design: "RCT", outcomes: ["Safety", "Efficacy"] };
    assert.equal(hasUnsavedExtractionAnswers(fields, { ...saved }, saved), false);
    assert.equal(hasUnsavedExtractionAnswers(fields, { ...saved, notes: " \nExample finding\t " }, saved), false);
    assert.equal(hasUnsavedExtractionAnswers(fields, { ...saved, outcomes: ["Efficacy", "Safety"] }, saved), false);
  });

  await check("text edits and reversion are compared against saved answers", () => {
    assert.equal(hasUnsavedExtractionAnswers(fields, { notes: "New finding" }), true);
    assert.equal(hasUnsavedExtractionAnswers(fields, { notes: "Updated finding" }, { notes: "Saved finding" }), true);
    assert.equal(hasUnsavedExtractionAnswers(fields, { notes: "" }, { notes: "Saved finding" }), true);
    assert.equal(hasUnsavedExtractionAnswers(fields, { notes: "Saved finding" }, { notes: "Saved finding" }), false);
  });

  await check("single and multiple choice additions, changes, and removals are edits", () => {
    assert.equal(hasUnsavedExtractionAnswers(fields, { design: "RCT" }), true);
    assert.equal(hasUnsavedExtractionAnswers(fields, { design: "Cohort" }, { design: "RCT" }), true);
    assert.equal(hasUnsavedExtractionAnswers(fields, { design: "" }, { design: "RCT" }), true);
    assert.equal(hasUnsavedExtractionAnswers(fields, { outcomes: ["Safety"] }), true);
    assert.equal(hasUnsavedExtractionAnswers(fields, { outcomes: ["Safety", "Cost"] }, { outcomes: ["Safety", "Efficacy"] }), true);
    assert.equal(hasUnsavedExtractionAnswers(fields, { outcomes: [] }, { outcomes: ["Safety"] }), true);
    assert.equal(hasUnsavedExtractionAnswers(fields, { outcomes: ["Safety"] }, { outcomes: ["Safety"] }), false);
  });

  function harness({ dirty = true, discard = () => {}, navigation = false } = {}) {
    const currentRunner = { slots: [], cursor: 0, effects: [] };
    const listeners = new Map(), navigationListeners = new Map();
    const confirmations = [], choices = [], discarded = [];
    let confirmDiscard, currentDirty = dirty, currentDiscard = discard;
    const addListener = (target, name, callback) => {
      if (!target.has(name)) target.set(name, new Set());
      target.get(name).add(callback);
    };
    const removeListener = (target, name, callback) => {
      target.get(name)?.delete(callback);
      if (!target.get(name)?.size) target.delete(name);
    };
    globalThis.window = {
      confirm(message) {
        confirmations.push(message);
        assert.ok(choices.length, "the test must choose whether to discard");
        return choices.shift();
      },
      addEventListener(name, callback) { addListener(listeners, name, callback); },
      removeEventListener(name, callback) { removeListener(listeners, name, callback); },
      ...(navigation ? { navigation: {
        addEventListener(name, callback) { addListener(navigationListeners, name, callback); },
        removeEventListener(name, callback) { removeListener(navigationListeners, name, callback); }
      } } : {})
    };
    function render(nextDirty = currentDirty, nextDiscard = currentDiscard) {
      currentDirty = nextDirty;
      currentDiscard = nextDiscard;
      runner = currentRunner;
      runner.cursor = 0;
      confirmDiscard = useExtractionDiscardConfirmation(currentDirty, () => {
        discarded.push(true);
        currentDiscard();
      });
      runner.effects.splice(0).forEach(effect => effect());
    }
    function unload() {
      const event = { defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true; } };
      for (const callback of listeners.get("beforeunload") ?? []) callback(event);
      return event;
    }
    function navigate(changes = {}) {
      const event = {
        navigationType: "traverse", canIntercept: true, cancelable: true, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...changes
      };
      for (const callback of navigationListeners.get("navigate") ?? []) callback(event);
      return event;
    }
    function dispose() {
      for (const slot of currentRunner.slots) {
        slot?.cleanup?.();
        if (slot && typeof slot === "object") delete slot.cleanup;
      }
    }
    render();
    return { render, dispose, unload, navigate, listeners, navigationListeners, confirmations, choices, discarded, confirm: () => confirmDiscard() };
  }

  await check("cancelled navigation preserves answers and continues guarding", () => {
    const values = { notes: "Keep this answer" };
    const review = harness({ dirty: hasUnsavedExtractionAnswers(fields, values), discard: () => { delete values.notes; } });
    review.choices.push(false, false);
    assert.equal(review.confirm(), false);
    assert.deepEqual(values, { notes: "Keep this answer" });
    assert.deepEqual(review.discarded, []);
    assert.equal(review.unload().defaultPrevented, true);
    assert.equal(review.confirm(), false);
    assert.equal(review.confirmations.length, 2, "another navigation still requires confirmation after cancellation");
    review.dispose();
  });

  await check("approved discard clears answers once and immediately suppresses duplicate prompts", () => {
    const values = { notes: "Discard this answer" };
    const review = harness({ discard: () => { delete values.notes; } });
    review.choices.push(true);
    assert.equal(review.confirm(), true);
    assert.deepEqual(values, {});
    assert.equal(review.confirm(), true, "a second handler in the same navigation does not prompt twice");
    assert.equal(review.confirmations.length, 1);
    assert.equal(review.discarded.length, 1);
    assert.equal(review.unload().defaultPrevented, false, "approved navigation does not also trigger the browser unload warning");
    review.render(false);
    assert.equal(review.listeners.has("beforeunload"), false);
    review.dispose();
  });

  await check("dirty unload uses the browser warning and removes listeners when clean or unmounted", () => {
    const review = harness();
    assert.equal(review.listeners.get("beforeunload")?.size, 1);
    const event = review.unload();
    assert.equal(event.defaultPrevented, true);
    assert.match(event.returnValue, /unsaved extraction answers/i, "legacy browsers receive a nonempty unload warning");
    assert.equal(review.confirmations.length, 0, "unload relies on the browser's own confirmation");
    review.render(false);
    assert.equal(review.listeners.has("beforeunload"), false);
    assert.equal(review.unload().defaultPrevented, false);
    review.render(true);
    assert.equal(review.listeners.get("beforeunload")?.size, 1, "new edits restore the warning");
    review.dispose();
    assert.equal(review.listeners.size, 0);
    assert.equal(review.navigationListeners.size, 0);
  });

  await check("clean answers allow navigation without prompting or discarding", () => {
    const review = harness({ dirty: false });
    assert.equal(review.confirm(), true);
    assert.equal(review.confirmations.length, 0);
    assert.equal(review.discarded.length, 0);
    assert.equal(review.unload().defaultPrevented, false);
    review.dispose();
  });

  await check("supported browser Back and Forward respect discard confirmation", () => {
    const review = harness({ navigation: true });
    assert.equal(review.navigationListeners.get("navigate")?.size, 1);
    for (const changes of [{ navigationType: "push" }, { hashChange: true }, { canIntercept: false }, { cancelable: false }]) {
      assert.equal(review.navigate(changes).defaultPrevented, false);
    }
    assert.equal(review.confirmations.length, 0, "unrelated or noncancelable navigations are ignored");
    review.choices.push(false, true);
    assert.equal(review.navigate().defaultPrevented, true, "Cancel keeps the current history entry");
    assert.equal(review.discarded.length, 0);
    assert.equal(review.navigate().defaultPrevented, false, "Discard allows traversal");
    assert.equal(review.discarded.length, 1);
    assert.equal(review.confirm(), true, "a router callback after approved traversal does not prompt again");
    assert.equal(review.confirmations.length, 2);
    review.render(false);
    assert.equal(review.navigationListeners.size, 0);
    review.dispose();
  });

  // Execute actual application handlers so the guard cannot become disconnected from navigation or saves.
  const parser = require("next/dist/compiled/babel/parser");
  const babel = require("next/dist/compiled/babel/core");
  const source = fs.readFileSync(path.join(root, "components/prisma-review-app.tsx"), "utf8");
  const syntax = parser.parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const declarations = new Map();
  const variables = new Map(), effectNodes = [];
  let extractionPickerExpression;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "FunctionDeclaration" && node.id?.name) declarations.set(node.id.name, source.slice(node.start, node.end));
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") variables.set(node.id.name, node);
    if (node.type === "CallExpression" && node.callee?.name === "useEffect") effectNodes.push(node);
    if (node.type === "JSXOpeningElement" && node.name?.name === "ExtractionSection") {
      extractionPickerExpression = node.attributes.find(attribute => attribute.name?.name === "projectExtractionReports")?.value?.expression;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(syntax);
  function execute(code, scope) {
    const compiled = babel.transformSync(code, {
      filename: "handlers.ts", babelrc: false, configFile: false,
      parserOpts: { allowReturnOutsideFunction: true },
      presets: [require("next/dist/compiled/babel/preset-typescript")]
    }).code;
    return new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  }
  function handlers(names, scope) {
    const code = names.map(name => {
      assert.ok(declarations.has(name), `${name} exists in the application source`);
      return declarations.get(name);
    }).join("\n");
    return execute(`${code}\nreturn { ${names.join(", ")} };`, scope);
  }

  function extractionSelection(scope) {
    const names = ["hasUnsavedExtractionChanges", "dirtyExtractionReport", "activeExtractionReport", "activeExtractionResponse", "extractionDraftKey"];
    const code = names.map(name => {
      const node = variables.get(name);
      assert.ok(node?.init, `${name} exists in the application source`);
      return `const ${name} = ${source.slice(node.init.start, node.init.end)};`;
    }).join("\n");
    assert.ok(extractionPickerExpression, "the Extraction report picker receives its options");
    return execute(`${code}\nreturn { ${names.join(", ")}, pickerReports: ${source.slice(extractionPickerExpression.start, extractionPickerExpression.end)} };`, scope);
  }
  function runExtractionEffect(requiredDependencies, scope) {
    const matching = effectNodes.filter(node => requiredDependencies.every(name => node.arguments[1]?.elements?.some(item => item?.name === name)));
    assert.equal(matching.length, 1, `one extraction effect depends on ${requiredDependencies.join(", ")}`);
    const callback = matching[0].arguments[0];
    return execute(`return (${source.slice(callback.start, callback.end)})();`, scope);
  }

  await check("checkout refresh retains the dirty report, its picker option, and its answers", () => {
    const firstReport = { id: "report-one", studyId: "study-one" }, secondReport = { id: "report-two", studyId: "study-two" };
    const savedValues = { notes: "Saved finding" }, draftValues = { notes: "Unsaved finding" };
    const scope = {
      activeView: "extraction", selectedProject: { id: "project-one" }, currentUser: { id: "reviewer-one" },
      activeExtractionReportId: firstReport.id, activeExtractionTemplate: { id: "template-one", fields },
      extractionFormBaseline: { key: JSON.stringify(["project-one", firstReport.id, "template-one", "reviewer-one"]), values: savedValues },
      extractionFormValues: draftValues, hasUnsavedExtractionAnswers,
      projectExtractionReports: [firstReport, secondReport], activeExtractionReports: [secondReport],
      pendingConsensusItems: [], activeConsensusReportId: "", extractionResponses: [
        { id: "response-refreshed", projectId: "project-one", reportId: firstReport.id, templateId: "template-one", userId: "reviewer-one", values: { notes: "Refreshed server finding" } },
        { id: "response-two", projectId: "project-one", reportId: secondReport.id, templateId: "template-one", userId: "reviewer-one", values: { notes: "Other report finding" } }
      ]
    };
    const selection = extractionSelection(scope), mutations = [];
    assert.equal(selection.hasUnsavedExtractionChanges, true);
    assert.equal(selection.activeExtractionReport, firstReport, "an ineligible checkout does not switch the dirty report");
    assert.equal(selection.dirtyExtractionReport, firstReport);
    assert.deepEqual(selection.pickerReports, [firstReport, secondReport], "the selected dirty report remains visible in the picker");
    const effectsScope = {
      ...scope, ...selection, setActiveExtractionReportId: value => mutations.push(["report", value]),
      setExtractionFormValues: value => mutations.push(["values", value]),
      setExtractionFormBaseline: value => mutations.push(["baseline", value]),
      setExtractionMessage: value => mutations.push(["message", value])
    };
    runExtractionEffect(["activeExtractionReportId", "hasUnsavedExtractionChanges"], effectsScope);
    runExtractionEffect(["extractionDraftKey", "hasUnsavedExtractionChanges"], effectsScope);
    assert.deepEqual(mutations, [], "queue and response refreshes do not reset dirty answers or selection");
    assert.deepEqual(scope.extractionFormValues, draftValues);

    const cleanScope = { ...scope, extractionFormValues: savedValues };
    const cleanSelection = extractionSelection(cleanScope);
    assert.equal(cleanSelection.hasUnsavedExtractionChanges, false);
    assert.equal(cleanSelection.activeExtractionReport, secondReport, "a clean report follows normal checkout eligibility");
    assert.deepEqual(cleanSelection.pickerReports, [secondReport]);
    runExtractionEffect(["activeExtractionReportId", "hasUnsavedExtractionChanges"], { ...effectsScope, ...cleanScope, ...cleanSelection });
    runExtractionEffect(["extractionDraftKey", "hasUnsavedExtractionChanges"], { ...effectsScope, ...cleanScope, ...cleanSelection });
    assert.ok(mutations.some(([kind, value]) => kind === "report" && value === secondReport.id));
    assert.ok(mutations.some(([kind, value]) => kind === "values" && value.notes === "Other report finding"));
    assert.ok(mutations.some(([kind, value]) => kind === "baseline" && value.key === cleanSelection.extractionDraftKey));
  });

  await check("the report selector retains the selected report on Cancel and ignores reselecting it", () => {
    const review = harness(), selected = [];
    const { selectExtractionReport } = handlers(["selectExtractionReport"], {
      activeExtractionReport: { id: "report-one" }, confirmDiscardExtractionAnswers: review.confirm,
      setActiveExtractionReportId: id => selected.push(id)
    });
    selectExtractionReport("report-one");
    assert.equal(review.confirmations.length, 0);
    review.choices.push(false, true);
    selectExtractionReport("report-two");
    assert.deepEqual(selected, []);
    selectExtractionReport("report-two");
    assert.deepEqual(selected, ["report-two"]);
    assert.equal(review.discarded.length, 1);
    review.dispose();
  });

  await check("Cancel prevents route and project changes before any project state resets", () => {
    const review = harness(), mutations = [];
    const { setActiveView, openProject } = handlers(["setActiveView", "openProject"], {
      homeView: "projects", selectedProjectId: "project-one", selectedProject: { id: "project-one" },
      pathname: "/projects/project-one/extraction", normalizePathname: value => value,
      buildPathForState: (view, projectId) => `/projects/${projectId}/${view}`,
      clearPendingRoute: () => mutations.push("clear pending"), confirmDiscardExtractionAnswers: review.confirm,
      setPendingRoutePath: value => mutations.push(["pending path", value]),
      setPendingRouteLabel: value => mutations.push(["pending label", value]), getPendingRouteLabel: view => view,
      startTransition: callback => callback(), router: { push: value => mutations.push(["push", value]) },
      canNavigateToProjectView: () => true,
      setSelectedProjectId: value => mutations.push(["project", value]),
      setIsMobileNavOpen: value => mutations.push(["mobile navigation", value]),
      setSelectedScreeningStudyId: value => mutations.push(["study", value]),
      setActiveReportId: value => mutations.push(["report", value]),
      setFullTextMessage: value => mutations.push(["full text message", value]),
      setScreeningMessage: value => mutations.push(["screening message", value])
    });
    review.choices.push(false, false);
    assert.equal(setActiveView("consensus"), false);
    assert.deepEqual(mutations, []);
    openProject("project-two");
    assert.deepEqual(mutations, []);
    review.choices.push(true);
    openProject("project-two");
    assert.ok(mutations.some(value => value[0] === "push" && value[1] === "/projects/project-two/projectDashboard"));
    assert.ok(mutations.some(value => value[0] === "project" && value[1] === "project-two"));
    assert.equal(review.discarded.length, 1);
    review.dispose();
  });

  await check("Cancel prevents schema editing and logout", async () => {
    const review = harness(), mutations = [];
    const { startEditingExtractionTemplate, handleLogout } = handlers(["startEditingExtractionTemplate", "handleLogout"], {
      activeExtractionTemplate: { id: "template-one" }, confirmDiscardExtractionAnswers: review.confirm,
      setExtractionTemplateForm: value => mutations.push(["form", value]),
      createExtractionTemplateFormFromTemplate: value => value,
      setExtractionMessage: value => mutations.push(["message", value]),
      setIsEditingExtractionTemplate: value => mutations.push(["editing", value]), pendingAuthAction: null,
      setPendingAuthAction: value => mutations.push(["auth action", value]),
      apiRequest: async () => mutations.push("logout request"),
      setIsAuthenticated: value => mutations.push(["authenticated", value]),
      clearLoginPassword: () => mutations.push("clear password")
    });
    review.choices.push(false, false);
    startEditingExtractionTemplate();
    await handleLogout();
    assert.deepEqual(mutations, []);
    assert.equal(review.discarded.length, 0);
    assert.equal(review.unload().defaultPrevented, true);
    review.dispose();
  });

  function submissionHarness() {
    const values = { notes: "Submitted finding", design: "RCT", outcomes: ["Safety"] };
    const draftKey = "project-one:template-one:report-one:reviewer-one";
    let baseline = { key: draftKey, values: {} }, resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const review = harness({ dirty: hasUnsavedExtractionAnswers(fields, values, baseline.values) });
    const requests = [], messages = [], saving = [], applied = [], decisions = [];
    const { submitExtractionResponse } = handlers(["submitExtractionResponse"], {
      activeExtractionTemplate: { id: "template-one" }, activeExtractionReport: { id: "report-one", studyId: "study-one" },
      selectedProject: { id: "project-one" }, extractionFormValues: values, extractionDraftKey: draftKey,
      reviewQueueKey: "extraction-queue", setExtractionMessage: value => messages.push(value),
      setIsSubmittingExtractionResponse: value => saving.push(value),
      apiRequest(url, init) { requests.push({ url, ...init, body: JSON.parse(init.body) }); return pending; },
      setExtractionFormBaseline(update) {
        baseline = typeof update === "function" ? update(baseline) : update;
        review.render(hasUnsavedExtractionAnswers(fields, values, baseline.values));
      },
      applyAppState: payload => applied.push(payload), setSavedQueueDecision: value => decisions.push(value),
      getErrorMessage: error => error.message
    });
    let prevented = false;
    const result = submitExtractionResponse({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    return { review, result, requests, messages, saving, applied, decisions, values, resolve, reject, baseline: () => baseline };
  }

  await check("successful submission removes the dirty guard after answers are saved", async () => {
    const submission = submissionHarness();
    assert.deepEqual(submission.saving, [true]);
    assert.equal(submission.review.unload().defaultPrevented, true, "answers remain protected while saving");
    assert.deepEqual(submission.requests, [{
      url: "/api/projects/project-one/extractions", method: "POST",
      body: { templateId: "template-one", reportId: "report-one", studyId: "study-one", values: submission.values }
    }]);
    const payload = { message: "Saved", extractionResponses: [] };
    submission.resolve(payload);
    await submission.result;
    assert.deepEqual(submission.baseline().values, submission.values);
    assert.deepEqual(submission.applied, [payload]);
    assert.deepEqual(submission.messages, ["", "Extraction submitted."]);
    assert.deepEqual(submission.saving, [true, false]);
    assert.deepEqual(submission.decisions, [{ queueKey: "extraction-queue", itemId: "report-one" }]);
    assert.equal(submission.review.listeners.has("beforeunload"), false);
    assert.equal(submission.review.confirm(), true);
    assert.equal(submission.review.confirmations.length, 0);
    submission.review.dispose();
  });

  await check("failed submission preserves answers and keeps discard confirmation active", async () => {
    const submission = submissionHarness();
    submission.reject(new Error("Save rejected"));
    await submission.result;
    assert.deepEqual(submission.baseline().values, {});
    assert.deepEqual(submission.values, { notes: "Submitted finding", design: "RCT", outcomes: ["Safety"] });
    assert.deepEqual(submission.applied, []);
    assert.deepEqual(submission.decisions, []);
    assert.deepEqual(submission.messages, ["", "Save rejected"]);
    assert.deepEqual(submission.saving, [true, false]);
    assert.equal(submission.review.unload().defaultPrevented, true);
    submission.review.choices.push(false);
    assert.equal(submission.review.confirm(), false);
    assert.equal(submission.review.discarded.length, 0);
    submission.review.dispose();
  });

  console.log(`Extraction discard checks passed: ${passed} groups covering saved-answer comparison, report/project navigation, cancellation, schema editing, logout, browser unload/history, and submission success/failure.`);
} finally {
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  fs.rmSync(temp, { recursive: true, force: true });
}
