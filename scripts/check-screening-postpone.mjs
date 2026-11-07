import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-screening-postpone-"));
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
let passed = 0;
function check(name, test) {
  test();
  passed += 1;
  console.log(`✓ ${name}`);
}

try {
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
    noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
    typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
    paths: { "@/*": [path.join(root, "*")] }
  }, files: [path.join(root, "lib/workflowSelectors.ts"), path.join(root, "components/review-sections/screening-section.tsx")] }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  const selectors = require(path.join(temp, "lib/workflowSelectors.js"));
  const data = require(path.join(temp, "lib/prismaData.js"));
  const project = { ...data.reviewProjects[0], id: "postpone-project", abstractRequiredVotes: 2 };
  const reviewer = "postpone-reviewer";
  const ids = items => items.map(item => item.id);
  const study = (id, extra = {}) => ({
    ...data.screeningStudies[0], id, projectId: project.id, stage: "title_abstract",
    titleAbstractStatus: "awaiting_votes", titleAbstractVoteCount: 0, titleAbstractRequiredVotes: 2,
    titleAbstractActiveViewerCount: 0, titleAbstractCheckedOutByCurrentUser: false, ...extra
  });
  const vote = (id, extra = {}) => ({
    id: `vote-${id}`, projectId: project.id, studyId: id, stage: "title_abstract", userId: reviewer,
    userName: "Current reviewer", decisionValue: "include", isCurrent: true, createdAt: "2026-11-06T10:00:00.000Z", ...extra
  });
  const select = (items, tail = [], decisions = [], userId = reviewer) =>
    selectors.getActiveTitleAbstractStudies(project, items, decisions, userId, tail);
  const ordinary = Array.from({ length: 5 }, (_, index) => study(`ordinary-${index}`));
  const conflicts = [study("untouched-conflict", { titleAbstractStatus: "conflict", titleAbstractVoteCount: 2 }),
    study("older-conflict", { titleAbstractStatus: "needs_third_vote", titleAbstractVoteCount: 2 }),
    study("newer-conflict", { titleAbstractStatus: "conflict", titleAbstractVoteCount: 2 })];
  const decisions = [vote("older-conflict"), vote("newer-conflict")];
  const items = [...conflicts, ...ordinary];
  const baseline = ids(select(items, [], decisions));

  check("postponed citations follow untouched papers in postponement order and precede every conflict", () => {
    const tail = [ordinary[2].id, ordinary[0].id];
    assert.deepEqual(ids(select(items, tail, decisions)), [
      ...baseline.filter(id => !tail.includes(id) && !id.includes("conflict")),
      ...tail, ...baseline.filter(id => id.includes("conflict"))
    ]);
    assert.deepEqual(ids(select(items.slice().reverse(), tail, decisions)), ids(select(items, tail, decisions)),
      "refreshing the source array preserves the reviewer queue order");
  });

  check("postponing the same citation again moves it behind earlier postponed citations", () => {
    const first = ordinary[2].id, second = ordinary[0].id;
    const tail = [first, second].filter(id => id !== first).concat(first);
    const ordered = select(items, tail, decisions);
    assert.deepEqual(ids(ordered).slice(-5), [second, first, ...baseline.filter(id => id.includes("conflict"))]);
    const lastUntouched = ordinary.find(item => !tail.includes(item.id));
    assert.notEqual(selectors.getNextReviewQueueItemId(ordered, lastUntouched.id), lastUntouched.id);
  });

  check("newly eligible papers precede postponed papers and checkout pinning cannot lift a postponed paper", () => {
    const tail = [ordinary[0].id, ordinary[1].id];
    const refreshed = [...ordinary.map(item => item.id === tail[0] ? { ...item, titleAbstractCheckedOutByCurrentUser: true } : item),
      study("newly-imported"), ...conflicts];
    const ordered = ids(select(refreshed, tail, decisions));
    assert.ok(ordered.indexOf("newly-imported") < ordered.indexOf(tail[0]));
    assert.deepEqual(ordered.slice(-5), [...tail, ...baseline.filter(id => id.includes("conflict"))]);
    const pinned = study("current-untouched", { titleAbstractCheckedOutByCurrentUser: true });
    assert.equal(select([pinned, ...refreshed], tail, decisions)[0].id, pinned.id,
      "ordinary checkouts retain their existing queue priority");
  });

  check("queue reordering never revives completed, already voted, missing, or occupied papers", () => {
    const completed = study("completed", { titleAbstractStatus: "advance_full_text", titleAbstractVoteCount: 2 });
    const voted = study("already-voted", { titleAbstractVoteCount: 1 });
    const occupied = study("occupied", { titleAbstractVoteCount: 1, titleAbstractActiveViewerCount: 1 });
    const tail = ["missing", completed.id, voted.id, occupied.id, ordinary[0].id];
    const ordered = select([completed, voted, occupied, ordinary[0], ordinary[1]], tail, [vote(voted.id)]);
    assert.deepEqual(ids(ordered), [ordinary[1].id, ordinary[0].id]);
    assert.deepEqual(select([completed], [completed.id]), []);
  });

  check("postpone lists do not reorder conflicts or mutate studies and decisions", () => {
    const inputStudies = structuredClone(items), inputDecisions = structuredClone(decisions);
    const before = JSON.stringify({ inputStudies, inputDecisions });
    inputStudies.forEach(Object.freeze);
    inputDecisions.forEach(Object.freeze);
    Object.freeze(inputStudies);
    Object.freeze(inputDecisions);
    const ordered = selectors.getActiveTitleAbstractStudies(project, inputStudies, inputDecisions, reviewer,
      ["newer-conflict", ordinary[0].id, "older-conflict", "untouched-conflict"]);
    assert.deepEqual(ids(ordered).filter(id => id.includes("conflict")), baseline.filter(id => id.includes("conflict")));
    assert.equal(JSON.stringify({ inputStudies, inputDecisions }), before);
    assert.ok(ordered.every(item => inputStudies.includes(item)), "the result reuses unmodified study records");
  });

  // Execute the application's handler, including its actual user/project key, so
  // local ordering cannot silently become a saved decision or shared article flag.
  const parser = require("next/dist/compiled/babel/parser");
  const babel = require("next/dist/compiled/babel/core");
  const source = fs.readFileSync(path.join(root, "components/prisma-review-app.tsx"), "utf8");
  const syntax = parser.parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  function findNode(predicate) {
    let result;
    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (predicate(node)) result = node;
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    }
    visit(syntax);
    assert.ok(result);
    return result;
  }
  const handlerNode = findNode(node => node.type === "FunctionDeclaration" && node.id?.name === "postponeScreeningStudy");
  const scopeNode = findNode(node => node.type === "VariableDeclarator" && node.id?.name === "screeningQueueScope").init;
  const handlerCode = babel.transformSync(source.slice(handlerNode.start, handlerNode.end), {
    filename: "screening-postpone.ts", babelrc: false, configFile: false,
    presets: [require("next/dist/compiled/babel/preset-typescript")]
  }).code;
  const queueScope = (userId, projectId) => new Function("currentUser", "selectedProject",
    `return ${source.slice(scopeNode.start, scopeNode.end)};`)({ id: userId }, { id: projectId });
  function handlerHarness(initialTail = {}) {
    let tailByReviewer = structuredClone(initialTail);
    const selected = [], requests = [];
    return {
      get tail() { return tailByReviewer; }, selected, requests,
      postpone({ userId = reviewer, projectId = project.id, current = ordinary[0], queue = ordinary,
        pending = null, undoing = false, active = true, status = "awaiting_votes" } = {}) {
        const scope = {
          currentStudy: current, activeScreeningStudies: queue, pendingScreeningDecision: pending,
          isUndoingScreeningDecision: undoing, isCurrentStudyInActiveScreeningQueue: active,
          titleAbstractConflictEvaluations: new Map([[current.id, { state: status }]]),
          screeningQueueScope: queueScope(userId, projectId),
          setScreeningQueueTailByReviewer(update) { tailByReviewer = update(tailByReviewer); },
          setSelectedScreeningStudyId: id => selected.push(id),
          getNextReviewQueueItemId: selectors.getNextReviewQueueItemId,
          apiRequest: (...args) => requests.push(args), fetch: (...args) => requests.push(args)
        };
        new Function(...Object.keys(scope), `${handlerCode}\nreturn postponeScreeningStudy;`)(...Object.values(scope))();
      }
    };
  }

  check("the actual handler appends once, advances to another citation, and never submits a decision", () => {
    const key = queueScope(reviewer, project.id);
    const handler = handlerHarness({ [key]: [ordinary[0].id, ordinary[1].id] });
    const before = handler.tail;
    Object.freeze(before[key]);
    Object.freeze(before);
    Object.freeze(ordinary[0]);
    const articleBefore = JSON.stringify(ordinary[0]);
    handler.postpone();
    assert.deepEqual(handler.tail[key], [ordinary[1].id, ordinary[0].id]);
    assert.deepEqual(before[key], [ordinary[0].id, ordinary[1].id], "reordering preserves previous React state");
    assert.deepEqual(handler.selected, [ordinary[1].id]);
    assert.deepEqual(handler.requests, []);
    assert.equal(JSON.stringify(ordinary[0]), articleBefore, "postponement adds no article fields or flags");
    const lastOrdinary = handlerHarness();
    lastOrdinary.postpone({ queue: [ordinary[0], conflicts[0]] });
    assert.deepEqual(lastOrdinary.selected, [conflicts[0].id], "a final ordinary paper can be left for later before conflict work");
  });

  check("the actual handler keeps queue order separate for each reviewer and project", () => {
    const handler = handlerHarness();
    handler.postpone();
    handler.postpone({ userId: "another-reviewer", current: ordinary[1] });
    handler.postpone({ projectId: "another-project", current: ordinary[2] });
    handler.postpone({ current: ordinary[3] });
    assert.deepEqual(handler.tail, {
      [queueScope(reviewer, project.id)]: [ordinary[0].id, ordinary[3].id],
      [queueScope("another-reviewer", project.id)]: [ordinary[1].id],
      [queueScope(reviewer, "another-project")]: [ordinary[2].id]
    });
    assert.notEqual(queueScope("user:review", "project"), queueScope("user", "review:project"));
    assert.deepEqual(handler.requests, []);
  });

  check("the actual handler rejects busy, inactive, single-item, and conflict actions", () => {
    for (const changes of [{ pending: "include" }, { undoing: true }, { active: false },
      { queue: [ordinary[0]] }, { status: "conflict" }, { status: "needs_third_vote" }]) {
      const handler = handlerHarness();
      handler.postpone(changes);
      assert.deepEqual(handler.tail, {});
      assert.deepEqual(handler.selected, []);
      assert.deepEqual(handler.requests, []);
    }
  });

  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { NavigationProvider } = require(path.join(temp, "components/navigation-link.js"));
  const sectionFile = path.join(temp, "components/review-sections/screening-section.js");
  const { ScreeningSection } = require(sectionFile);
  const noop = () => {};
  const props = {
    projectScreeningStudies: ordinary, totalScreeningStudyCount: ordinary.length, screeningProgress: 0,
    decisions: [], selectedProjectId: project.id, currentUserId: reviewer, blindMode: true,
    studyIndex: 0, setStudyIndex: noop, titleAbstractEvaluations: new Map(), formatDecision: String,
    decisionTone: () => "info", currentStudy: ordinary[0], stageEvaluation: { state: "awaiting_votes", label: "Awaiting votes" },
    paperComments: React.createElement("div", { "data-testid": "paper-comments" }, "Shared paper comment"),
    screeningMessage: "", canRecordScreeningDecision: true,
    checkoutError: "", currentUserDecision: undefined, currentStageDecisions: [], pendingScreeningDecision: null,
    isUndoingScreeningDecision: false, reviewedCount: 0, onOpenReviewed: noop, conflicts: [], onResolveConflict: noop,
    formatConflictResolutionHint: String, selectedProjectAbstractRequiredVotes: 2, addScreeningDecision: noop,
    undoLastDecision: noop, onPostpone: noop, canPostpone: true
  };
  const render = changes => renderToStaticMarkup(React.createElement(NavigationProvider, { projectId: project.id },
    React.createElement(ScreeningSection, { ...props, ...changes })));
  const postponeTag = markup => {
    const tag = markup.match(/<button\b[^>]*class="[^"]*\bscreeningPostponeButton\b[^"]*"[^>]*>/)?.[0];
    assert.ok(tag, "the postpone control is rendered");
    return tag;
  };

  check("Postpone sits below three balanced navigation controls and displays a clock icon", () => {
    const markup = render({});
    assert.match(markup, /data-testid="paper-comments"/);
    const navigation = markup.match(/<div class="buttonRow screeningNavigationButtons[^]*?<\/div>/)?.[0];
    assert.ok(navigation);
    assert.equal((navigation.match(/<button\b/g) ?? []).length, 3);
    assert.match(navigation, /aria-label="Previous citation"/);
    assert.match(navigation, />Undo<\/button>/);
    assert.match(navigation, /aria-label="Next citation"/);
    assert.ok(markup.indexOf("screeningPostponeButton") > markup.indexOf(navigation) + navigation.length);
    assert.match(markup, /class="[^"]*lucide-clock[^"]*"[^]*?Postpone<\/button>/);
    assert.doesNotMatch(postponeTag(markup), /\bdisabled=/);
    const css = require("postcss").parse(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"));
    const declarations = selector => {
      const values = {};
      css.walkRules(rule => {
        if (rule.selector.split(",").map(value => value.trim()).includes(selector)) {
          rule.walkDecls(declaration => values[declaration.prop] = declaration.value);
        }
      });
      return values;
    };
    const navigationStyle = declarations(".screeningNavigationButtons");
    assert.equal(navigationStyle.display, "grid");
    assert.equal(navigationStyle["grid-template-columns"], "repeat(3, minmax(0, 1fr))");
    assert.equal(navigationStyle.width, "100%");
    assert.equal(declarations(".screeningNavigationButtons > .ghostButton").width, "100%");
    assert.equal(declarations(".screeningPostponeButton").width, "100%");
  });

  check("Postpone is disabled while saving, undoing, or no later queue position is available", () => {
    for (const changes of [{ pendingScreeningDecision: "include" }, { isUndoingScreeningDecision: true }, { canPostpone: false }]) {
      assert.match(postponeTag(render(changes)), /\bdisabled=""/);
    }
  });

  check("the Postpone control calls its dedicated callback without voting or changing paper comments", () => {
    const calls = [];
    const fakeReact = { ...React, useMemo: callback => callback(), useEffect: noop,
      useState: initial => [typeof initial === "function" ? initial() : initial, noop] };
    Module._load = function(name, parent, ...args) {
      return name === "react" && parent?.filename === sectionFile ? fakeReact : originalLoad.call(this, name, parent, ...args);
    };
    delete require.cache[sectionFile];
    const { ScreeningSection: InteractiveSection } = require(sectionFile);
    const tree = InteractiveSection({ ...props, onPostpone: () => calls.push("postpone"),
      addScreeningDecision: () => calls.push("vote") });
    function nodes(node, result = []) {
      if (Array.isArray(node)) node.forEach(child => nodes(child, result));
      else if (node?.props) { result.push(node); nodes(node.props.children, result); }
      return result;
    }
    const button = nodes(tree).find(node => node.type === "button" && node.props.className?.includes("screeningPostponeButton"));
    assert.ok(button);
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    assert.deepEqual(calls, ["postpone"]);
    Module._load = originalLoad;
  });

  console.log(`Screening postpone checks passed: ${passed} groups covering queue order, repeated postponement, new work, checkout pinning, eligibility, conflicts, record immutability, handler isolation and guards, shared comment display, no decision requests, layout, callback, and busy controls.`);
} finally {
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  fs.rmSync(temp, { recursive: true, force: true });
}
