import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-checkout-"));
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
let passed = 0;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flushPromises() {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

async function check(name, run) {
  try {
    await run();
    passed++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

try {
  const hookFile = path.join(temp, "components/use-review-checkout.js");
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "Node16", moduleResolution: "Node16", esModuleInterop: true,
      noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
      typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
      paths: { "@/*": [path.join(root, "*")] }
    },
    files: [path.join(root, "components/use-review-checkout.ts")]
  }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };

  // Execute the production hook with controlled React effects and asynchronous requests.
  let runner;
  const sameDependencies = (before, after) => before && after && before.length === after.length && after.every((value, index) => Object.is(value, before[index]));
  const fakeReact = {
    useRef(initial) {
      const index = runner.cursor++;
      return runner.slots[index] ??= { current: initial };
    },
    useState(initial) {
      const index = runner.cursor++;
      if (!(index in runner.slots)) runner.slots[index] = typeof initial === "function" ? initial() : initial;
      const currentRunner = runner;
      return [runner.slots[index], value => currentRunner.slots[index] = typeof value === "function" ? value(currentRunner.slots[index]) : value];
    },
    useEffect(effect, dependencies) {
      const index = runner.cursor++, previous = runner.slots[index];
      if (!sameDependencies(previous?.dependencies, dependencies)) {
        const slot = { dependencies };
        runner.slots[index] = slot;
        runner.effects.push(() => {
          previous?.cleanup?.();
          slot.cleanup = effect();
        });
      }
    },
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
  const { useReviewCheckout } = require(hookFile);
  const baseTarget = { projectId: "project-one", studyId: "study-one", stage: "title_abstract" };

  function harness(options = {}) {
    const currentRunner = { slots: [], cursor: 0, effects: [] };
    const requests = [], releases = [], acquired = [], errors = [], starts = [], intervals = new Map();
    let timerId = 0;
    const acquire = request => {
      const pending = deferred();
      requests.push({ body: JSON.parse(JSON.stringify(request)), ...pending });
      return pending.promise;
    };
    let currentOptions = {
      userId: "reviewer-one", target: baseTarget, checkoutWindowMinutes: 4, acquire,
      onAcquired: payload => acquired.push(payload), onError: error => errors.push(error), onStart: () => starts.push(true),
      ...options
    };
    globalThis.window = {
      setInterval(callback, delay) {
        const id = ++timerId;
        intervals.set(id, { callback, delay });
        return id;
      },
      clearInterval(id) { intervals.delete(id); }
    };
    globalThis.fetch = (url, init) => {
      releases.push({ url, ...init, body: JSON.parse(init.body) });
      return Promise.resolve({ ok: true });
    };
    function render(changes = {}) {
      currentOptions = { ...currentOptions, ...changes };
      runner = currentRunner;
      runner.cursor = 0;
      useReviewCheckout(currentOptions);
      runner.effects.splice(0).forEach(effect => effect());
    }
    function dispose() {
      for (const slot of currentRunner.slots) {
        slot?.cleanup?.();
        if (slot && typeof slot === "object") delete slot.cleanup;
      }
    }
    function refresh() {
      assert.equal(intervals.size, 1, "one refresh timer is active");
      intervals.values().next().value.callback();
    }
    render();
    return { requests, releases, acquired, errors, starts, intervals, render, dispose, refresh };
  }

  await check("inactive reviews do not acquire checkouts", async () => {
    for (const options of [
      { userId: null }, { target: null },
      { target: { ...baseTarget, stage: "full_text" } },
      { target: { ...baseTarget, stage: "extraction", reportId: "report-one" } }
    ]) {
      const review = harness(options);
      assert.equal(review.requests.length, 0);
      assert.equal(review.intervals.size, 0);
      assert.equal(review.starts.length, 0);
      review.dispose();
      assert.equal(review.releases.length, 0);
    }
  });

  for (const target of [
    baseTarget,
    { ...baseTarget, stage: "full_text", reportId: "report-one" },
    { ...baseTarget, stage: "extraction", reportId: "report-one", templateId: "template-one" }
  ]) {
    await check(`${target.stage}: acquire, refresh, and release one checkout token`, async () => {
      const extraction = target.stage === "extraction";
      const review = harness({ target, checkoutWindowMinutes: extraction ? 9 : 4 });
      assert.equal(review.starts.length, 1);
      assert.equal(review.requests.length, 1, "checkout acquisition begins immediately");
      const first = review.requests[0];
      assert.equal(typeof first.body.checkoutId, "string");
      assert.ok(first.body.checkoutId.length > 0);
      assert.deepEqual(first.body, { ...target, checkoutId: first.body.checkoutId, action: "acquire" });
      assert.equal(review.intervals.values().next().value.delay, extraction ? 270_000 : 120_000);
      review.refresh();
      assert.equal(review.requests.length, 1, "an in-flight acquire is not duplicated by the refresh timer");
      const payload = { message: "Acquired", projects: [{ id: target.projectId }] };
      first.resolve(payload);
      await flushPromises();
      assert.deepEqual(review.acquired, [payload]);
      review.refresh();
      assert.equal(review.requests.length, 2);
      assert.deepEqual(review.requests[1].body, first.body, "refresh retains the acquired token and target");
      review.dispose();
      assert.equal(review.intervals.size, 0);
      assert.deepEqual(review.releases, [{
        url: "/api/screening-checkouts", method: "POST", headers: { "Content-Type": "application/json" },
        body: { ...first.body, action: "release" }, keepalive: true
      }]);
      review.requests[1].resolve({ message: "Late refresh" });
      await flushPromises();
      assert.deepEqual(review.acquired, [payload], "cleanup ignores a late refresh response");
    });
  }

  await check("callback and target-object changes retain the checkout", async () => {
    const review = harness();
    const latestPayloads = [], latestErrors = [], latestStarts = [], latestRequests = [];
    review.render({
      target: { ...baseTarget },
      acquire: async body => { latestRequests.push(body); return { message: "New callback" }; },
      onAcquired: payload => latestPayloads.push(payload), onError: error => latestErrors.push(error), onStart: () => latestStarts.push(true)
    });
    assert.equal(review.requests.length, 1);
    assert.equal(review.releases.length, 0);
    assert.equal(review.intervals.size, 1);
    assert.equal(latestStarts.length, 0, "new callbacks do not restart acquisition");
    const payload = { message: "Initial request completed" };
    review.requests[0].resolve(payload);
    await flushPromises();
    assert.deepEqual(latestPayloads, [payload], "pending responses use the latest callback");
    assert.deepEqual(review.acquired, []);
    review.refresh();
    await flushPromises();
    assert.equal(latestRequests.length, 1, "refresh uses the latest acquisition callback");
    assert.deepEqual(latestRequests[0], review.requests[0].body);
    assert.deepEqual(latestPayloads, [payload, { message: "New callback" }]);
    assert.deepEqual(latestErrors, []);
    review.dispose();
  });

  await check("checkout errors are reported and extraction can omit error handling", async () => {
    for (const stage of ["title_abstract", "full_text", "extraction"]) {
      const review = harness({ target: { ...baseTarget, stage, reportId: "report-one", templateId: "template-one" } });
      const failure = new Error("Checkout unavailable");
      review.requests[0].reject(failure);
      await flushPromises();
      assert.deepEqual(review.errors, [failure]);
      assert.deepEqual(review.acquired, []);
      review.dispose();
    }
    const review = harness({ target: { ...baseTarget, stage: "extraction", reportId: "report-one", templateId: "template-one" }, onError: undefined });
    review.requests[0].reject(new Error("Refresh unavailable"));
    await flushPromises();
    review.refresh();
    review.requests[1].resolve({ message: "Refresh recovered" });
    await flushPromises();
    assert.deepEqual(review.acquired, [{ message: "Refresh recovered" }]);
    review.dispose();
  });

  await check("each target, account, and window change releases and reacquires", async () => {
    const target = { ...baseTarget, stage: "extraction", reportId: "report-one", templateId: "template-one" };
    for (const changes of [
      { target: { ...target, projectId: "project-two" } },
      { target: { ...target, studyId: "study-two" } },
      { target: { ...target, stage: "full_text" } },
      { target: { ...target, reportId: "report-two" } },
      { target: { ...target, templateId: "template-two" } },
      { userId: "reviewer-two" },
      { checkoutWindowMinutes: 8 }
    ]) {
      const review = harness({ target });
      const oldRequest = review.requests[0];
      review.render(changes);
      assert.equal(review.requests.length, 2);
      assert.equal(review.releases.length, 1);
      assert.equal(review.releases[0].body.checkoutId, oldRequest.body.checkoutId);
      assert.notEqual(review.requests[1].body.checkoutId, oldRequest.body.checkoutId, "a new lease uses a distinct token");
      assert.deepEqual(review.requests[1].body, {
        ...(changes.target ?? target), action: "acquire", checkoutId: review.requests[1].body.checkoutId
      });
      assert.equal(review.intervals.size, 1);
      assert.equal(review.intervals.values().next().value.delay, changes.checkoutWindowMinutes ? 240_000 : 120_000);
      oldRequest.resolve({ message: "Old target response" });
      await flushPromises();
      assert.deepEqual(review.acquired, [], "a previous target cannot replace the current application state");
      review.requests[1].resolve({ message: "Current target response" });
      await flushPromises();
      assert.deepEqual(review.acquired, [{ message: "Current target response" }]);
      review.dispose();
    }
  });

  await check("leaving the review ignores pending success and failure responses", async () => {
    for (const changes of [{ userId: null }, { target: null }]) {
      for (const fail of [false, true]) {
        const review = harness();
        review.render(changes);
        assert.equal(review.requests.length, 1);
        assert.equal(review.releases.length, 1);
        assert.equal(review.intervals.size, 0);
        if (fail) review.requests[0].reject(new Error("Late failure"));
        else review.requests[0].resolve({ message: "Late response" });
        await flushPromises();
        assert.deepEqual(review.acquired, []);
        assert.deepEqual(review.errors, []);
        review.dispose();
        assert.equal(review.releases.length, 1);
      }
    }
  });

  // Compile the actual nested save handler without mounting the entire application.
  const parser = require("next/dist/compiled/babel/parser");
  const babel = require("next/dist/compiled/babel/core");
  const source = fs.readFileSync(path.join(root, "components/prisma-review-app.tsx"), "utf8");
  const syntax = parser.parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  function findFunction(name) {
    let result;
    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "FunctionDeclaration" && node.id?.name === name) result = node;
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    }
    visit(syntax);
    assert.ok(result, `${name} exists in the application source`);
    return source.slice(result.start, result.end);
  }
  const saveHandler = babel.transformSync([
    "updateProjectSettings", "parseExclusionReasonsText", "isEuDate", "getErrorMessage"
  ].map(findFunction).join("\n"), {
    filename: "settings.ts", babelrc: false, configFile: false,
    presets: [require("next/dist/compiled/babel/preset-typescript")]
  }).code;
  const settings = {
    title: "Underwater Manipulation", organization: "Review group", protocolId: "PROTOCOL-7", dueDate: "31-12-2026",
    description: "Review description", searchStrategies: "Database search", blindMode: true, abstractRequiredVotes: 2,
    fullTextRequiredVotes: 2, extractionRequiredVotes: 2, exclusionReasonsText: " Off topic \n\n Wrong study type ",
    maybePolicy: "include", requireSequentialPhases: true
  };
  function settingsHarness(form = settings, failure) {
    const requests = [], applied = [], messages = [], saving = [];
    const pending = deferred();
    const scope = {
      projectSettingsForm: form, selectedProject: { id: "project-one" },
      apiRequest(url, init) {
        requests.push({ url, ...init, body: init?.body ? JSON.parse(init.body) : undefined });
        return failure ? Promise.reject(failure) : pending.promise;
      },
      applyAppState: payload => applied.push(payload), setProjectSettingsMessage: message => messages.push(message),
      setIsSavingProjectSettings: value => saving.push(value)
    };
    const save = new Function(...Object.keys(scope), `${saveHandler}\nreturn updateProjectSettings;`)(...Object.values(scope));
    let prevented = false;
    const result = save({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    return { requests, applied, messages, saving, result, pending };
  }

  await check("project settings use the complete PATCH payload without another state request", async () => {
    const review = settingsHarness();
    assert.deepEqual(review.saving, [true]);
    assert.deepEqual(review.applied, []);
    const { exclusionReasonsText, ...expected } = settings;
    assert.deepEqual(review.requests, [{
      url: "/api/projects/project-one", method: "PATCH",
      body: { ...expected, exclusionReasons: ["Off topic", "Wrong study type"] }
    }]);
    const payload = { projects: [{ id: "project-one", title: "Updated server title" }], studies: [{ id: "study-one", titleAbstractStatus: "awaiting_votes" }] };
    review.pending.resolve(payload);
    await review.result;
    assert.equal(review.requests.length, 1, "saving settings sends one PATCH and no GET");
    assert.deepEqual(review.applied, [payload], "the complete mutation response is applied once");
    assert.equal(review.applied[0], payload);
    assert.deepEqual(review.messages, ["Project settings saved."]);
    assert.deepEqual(review.saving, [true, false]);
  });

  await check("project settings failures preserve error messages and clear the saving flag", async () => {
    const review = settingsHarness(settings, new Error("Save rejected"));
    await review.result;
    assert.equal(review.requests.length, 1);
    assert.deepEqual(review.applied, []);
    assert.deepEqual(review.messages, ["Save rejected"]);
    assert.deepEqual(review.saving, [true, false]);
  });

  await check("invalid project settings do not issue requests", async () => {
    for (const form of [{ ...settings, title: " " }, { ...settings, dueDate: "2026-12-31" }]) {
      const review = settingsHarness(form);
      await review.result;
      assert.deepEqual(review.requests, []);
      assert.deepEqual(review.applied, []);
      assert.deepEqual(review.saving, []);
      assert.deepEqual(review.messages, ["Enter a review title. If due date is provided, use dd-mm-yyyy format."]);
    }
  });

  console.log(`Review checkout checks passed: ${passed} groups covering stage request fields, refresh windows, stable callbacks, target/account changes, cancellation, errors, and single-request project settings saves.`);
} finally {
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
  fs.rmSync(temp, { recursive: true, force: true });
}
