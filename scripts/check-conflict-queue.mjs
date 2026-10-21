import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-conflict-queue-"));
const originalResolve = Module._resolveFilename;
let passed = 0;
function check(name, test) {
  test();
  passed += 1;
  console.log(`✓ ${name}`);
}
async function checkAsync(name, test) {
  await test();
  passed += 1;
  console.log(`✓ ${name}`);
}

try {
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", esModuleInterop: true,
    noEmitOnError: true, skipLibCheck: true, types: ["node"],
    typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
    paths: { "@/*": [path.join(root, "*")] }
  }, files: [path.join(root, "lib/workflowSelectors.ts")] }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  const selectors = require(path.join(temp, "lib/workflowSelectors.js"));
  const seeds = require(path.join(temp, "lib/prismaData.js"));
  const project = { ...seeds.reviewProjects[0], id: "conflict-queue-project", abstractRequiredVotes: 2, fullTextRequiredVotes: 2, extractionRequiredVotes: 2 };
  const reviewer = "reviewer-one";
  const ids = items => items.map(item => item.id);

  for (const stage of ["title_abstract", "full_text"]) {
    const prefix = stage === "title_abstract" ? "titleAbstract" : "fullText";
    const select = stage === "title_abstract" ? selectors.getActiveTitleAbstractStudies : selectors.getActiveFullTextReports;
    const item = (id, status = "awaiting_votes", extra = {}) => ({
      ...(stage === "title_abstract" ? seeds.screeningStudies[0] : seeds.reportQueue[0]),
      id, projectId: project.id, studyId: id, stage: stage === "title_abstract" ? "title_abstract" : "full_text",
      retrievalStatus: "retrieved", [`${prefix}Status`]: status,
      [`${prefix}VoteCount`]: status === "awaiting_votes" ? 0 : 2,
      [`${prefix}RequiredVotes`]: 2, [`${prefix}ActiveViewerCount`]: 0,
      [`${prefix}CheckedOutByCurrentUser`]: false, ...extra
    });
    const vote = (id, extra = {}) => ({
      id: `vote-${id}`, projectId: project.id, studyId: id,
      ...(stage === "full_text" ? { reportId: id } : {}), stage,
      userId: reviewer, userName: "Reviewer one", decisionValue: "include", isCurrent: true,
      createdAt: "20/10/2026, 12:00:00", ...extra
    });

    check(`${stage}: a newly created conflict follows untouched papers and older conflicts`, () => {
      const items = [item("new", "conflict", { [`${prefix}CheckedOutByCurrentUser`]: true }), item("old", "needs_third_vote"),
        item("normal-one"), item("unvoted-conflict", "conflict"), item("normal-two")];
      const ordered = select(project, items, [vote("old"), vote("new")], reviewer);
      assert.deepEqual(new Set(ids(ordered).slice(0, 2)), new Set(["normal-one", "normal-two"]));
      assert.deepEqual(ids(ordered).slice(2), ["unvoted-conflict", "old", "new"]);
    });

    check(`${stage}: reviewers who have not voted can resolve an aggregate conflict`, () => {
      // Blind payloads omit the other reviewers' decisions; aggregate status is authoritative.
      const conflict = item("conflict", "conflict");
      assert.deepEqual(ids(select(project, [conflict], [], "third-reviewer")), ["conflict"]);
      assert.equal(selectors.getNextReviewQueueItemId(select(project, [conflict], [], "third-reviewer"), "previous"), "conflict");
    });

    check(`${stage}: another reviewer's resolution removes the conflicted paper`, () => {
      const resolved = stage === "title_abstract" ? "excluded_abstract" : "excluded_full_text";
      const items = [item("conflict", resolved, { [`${prefix}VoteCount`]: 3 }), item("next")];
      assert.deepEqual(ids(select(project, items, [vote("conflict")], reviewer)), ["next"]);
      assert.deepEqual(ids(select(project, items, [], "third-reviewer")), ["next"]);
    });

    check(`${stage}: an unresolved conflict remains available when it is the only work`, () => {
      const conflict = item("only-conflict", "needs_third_vote");
      const remaining = select(project, [conflict], [vote(conflict.id)], reviewer);
      assert.deepEqual(ids(remaining), [conflict.id]);
      assert.equal(selectors.getNextReviewQueueItemId(remaining, conflict.id), conflict.id);
    });

    check(`${stage}: historical votes and other projects/stages do not defer untouched conflicts`, () => {
      const items = [item("history", "conflict"), item("own", "conflict")];
      const decisions = [vote("history", { isCurrent: false }), vote("history", { projectId: "another-project" }),
        vote("history", { stage: stage === "full_text" ? "title_abstract" : "full_text" }), vote("own")];
      assert.deepEqual(ids(select(project, items, decisions, reviewer)), ["history", "own"]);
      assert.deepEqual(ids(select(project, [item("history")], [vote("history", { isCurrent: false })], reviewer)), ["history"]);
    });

    check(`${stage}: revoting moves a conflict behind older current votes despite equal or localized times`, () => {
      const items = [item("revoted", "conflict", { [`${prefix}CheckedOutByCurrentUser`]: true }), item("older", "conflict")];
      const decisions = [vote("revoted", { isCurrent: false }), vote("older"), vote("revoted", { id: "replacement-vote" })];
      assert.deepEqual(ids(select(project, items, decisions, reviewer)), ["older", "revoted"]);
    });

    check(`${stage}: checkout capacity still excludes occupied conflicts and respects the current checkout`, () => {
      const occupied = item("occupied", "conflict", { [`${prefix}ActiveViewerCount`]: 1 });
      assert.deepEqual(select(project, [occupied], [vote(occupied.id)], reviewer), []);
      assert.deepEqual(ids(select(project, [{ ...occupied, [`${prefix}CheckedOutByCurrentUser`]: true }], [vote(occupied.id)], reviewer)), [occupied.id]);
      const items = [item("normal"), item("pinned-normal", "awaiting_votes", { [`${prefix}CheckedOutByCurrentUser`]: true }),
        item("pinned-conflict", "conflict", { [`${prefix}CheckedOutByCurrentUser`]: true })];
      assert.deepEqual(ids(select(project, items, [], reviewer)), ["pinned-normal", "normal", "pinned-conflict"]);
    });

    check(`${stage}: legacy conflicts without aggregate status use current visible decisions`, () => {
      const conflict = item("legacy", "conflict", { [`${prefix}Status`]: undefined, [`${prefix}VoteCount`]: undefined });
      const decisions = [vote(conflict.id, { userId: "other-reviewer", decisionValue: "exclude" }), vote(conflict.id)];
      assert.deepEqual(ids(select(project, [conflict], decisions, reviewer)), [conflict.id]);
    });

    check(`${stage}: normal queues retain stable per-reviewer randomization`, () => {
      const items = Array.from({ length: 20 }, (_, index) => item(`normal-${index}`));
      const actual = ids(select(project, items, [], reviewer));
      const expected = ids(selectors.randomizeReviewQueueItems(items, { projectId: project.id, currentUserId: reviewer, phase: stage }));
      assert.deepEqual(actual, expected);
      assert.deepEqual(ids(select(project, items.slice().reverse(), [], reviewer)), expected);
      assert.notDeepEqual(ids(select(project, items, [], "other-reviewer")), expected);
    });
  }

  check("next-item selection skips the voted paper whenever another eligible paper exists", () => {
    assert.equal(selectors.getNextReviewQueueItemId([{ id: "voted" }, { id: "next" }], "voted"), "next");
    assert.equal(selectors.getNextReviewQueueItemId([{ id: "next" }, { id: "voted" }], "voted"), "next");
    assert.equal(selectors.getNextReviewQueueItemId([{ id: "next" }], "absent"), "next");
    assert.equal(selectors.getNextReviewQueueItemId([], "voted"), null);
  });

  check("extraction queues keep their template-specific randomization and checkout ordering", () => {
    const templateId = "active-template";
    const reports = Array.from({ length: 10 }, (_, index) => ({ ...seeds.reportQueue[0], id: `extract-${index}`, projectId: project.id,
      extractionTemplateId: templateId, extractionVoteCount: 0, extractionRequiredVotes: 2,
      extractionCheckedOutByCurrentUser: index === 3 }));
    const expected = selectors.randomizeReviewQueueItems(reports, {
      projectId: project.id, currentUserId: reviewer, phase: "extraction", salt: templateId,
      isPinned: report => report.extractionCheckedOutByCurrentUser
    });
    assert.deepEqual(ids(selectors.getActiveExtractionReports(project, reports, [], templateId, reviewer)), ids(expected));
    assert.equal(expected[0].id, "extract-3");
  });

  // Execute the real save handlers so queue selection after a mutation cannot
  // regress while selector ordering continues to pass in isolation.
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
  const handlers = babel.transformSync(["addScreeningDecision", "updateFullTextReport", "getErrorMessage"].map(findFunction).join("\n"), {
    filename: "review-save.ts", babelrc: false, configFile: false,
    presets: [require("next/dist/compiled/babel/preset-typescript")]
  }).code;
  for (const stage of ["title_abstract", "full_text"]) {
    for (const outcome of ["other-work", "only-conflict", "complete"]) {
      await checkAsync(`${stage}: save handler selects ${outcome === "other-work" ? "another paper after creating a conflict" : outcome === "only-conflict" ? "the sole unresolved conflict" : "an empty queue after the last resolution"}`, async () => {
        const isFullText = stage === "full_text";
        const prefix = isFullText ? "fullText" : "titleAbstract";
        const study = { ...seeds.screeningStudies[0], id: "just-voted", projectId: project.id, stage: isFullText ? "full_text" : "title_abstract",
          [`${prefix}Status`]: outcome === "complete" ? isFullText ? "excluded_full_text" : "excluded_abstract" : "conflict",
          [`${prefix}VoteCount`]: 2, [`${prefix}CheckedOutByCurrentUser`]: true };
        const report = { ...seeds.reportQueue[0], id: study.id, studyId: study.id, projectId: project.id, retrievalStatus: "retrieved",
          fullTextStatus: study.fullTextStatus, fullTextVoteCount: 2, fullTextCheckedOutByCurrentUser: true };
        const nextStudy = { ...study, id: "next-paper", [`${prefix}Status`]: "awaiting_votes", [`${prefix}VoteCount`]: 0,
          [`${prefix}CheckedOutByCurrentUser`]: false };
        const nextReport = { ...report, id: nextStudy.id, studyId: nextStudy.id, fullTextStatus: "awaiting_votes", fullTextVoteCount: 0,
          fullTextCheckedOutByCurrentUser: false };
        const ownVote = { id: "just-saved-vote", projectId: project.id, studyId: study.id, ...(isFullText ? { reportId: report.id } : {}),
          stage, userId: reviewer, userName: "Reviewer one", decisionValue: "include", isCurrent: true, createdAt: "same localized timestamp" };
        const payload = { projects: [project], studies: outcome === "other-work" ? [study, nextStudy] : [study],
          reports: outcome === "other-work" ? [report, nextReport] : [report], decisions: [ownVote], dedupCandidates: [] };
        const selected = [], applied = [], messages = [], saved = [], requests = [], pending = [];
        const noop = () => {};
        const scope = {
          ...selectors, activeScreeningStudies: [study], selectedProject: project, currentStudy: study, activeReport: report,
          screeningNote: "", currentUser: { id: reviewer }, hasProjectSeedData: false,
          screeningStudies: [], reportQueue: [], reviewQueueKey: `project:${stage}`,
          apiRequest: async (url, init) => { requests.push({ url, method: init.method, body: JSON.parse(init.body) }); return payload; },
          applyAppState: value => applied.push(value), formatDecision: String,
          setPendingScreeningDecision: value => pending.push(value), setPendingFullTextAction: value => pending.push(value),
          setScreeningMessage: value => messages.push(value), setFullTextMessage: value => messages.push(value),
          setScreeningNote: noop, setDecisionActions: noop, setSelectedScreeningStudyId: value => selected.push(value),
          setActiveReportId: value => selected.push(value), setSavedQueueDecision: value => saved.push(value)
        };
        const save = new Function(...Object.keys(scope), `${handlers}\nreturn ${isFullText ? "updateFullTextReport" : "addScreeningDecision"};`)(...Object.values(scope));
        await save(isFullText ? { decisionValue: "include" } : "include");
        const expectedId = outcome === "other-work" ? nextStudy.id : outcome === "only-conflict" ? study.id : "";
        assert.deepEqual(selected, [expectedId]);
        assert.deepEqual(applied, [payload]);
        assert.deepEqual(saved, [{ queueKey: `project:${stage}`, itemId: study.id }]);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, isFullText ? "PATCH" : "POST");
        assert.equal(pending.at(-1), null);
        assert.equal(messages.at(-1), isFullText ? "Full-text decision saved." : "Saved include decision.");
      });
    }
  }

  console.log(`Conflict queue checks passed: ${passed} groups covering conflict deferral, blind aggregates, resolution, checkout capacity, current votes, next-item selection, and randomized queues.`);
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
