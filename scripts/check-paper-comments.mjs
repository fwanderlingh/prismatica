import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-paper-comments-"));
const originalResolve = Module._resolveFilename;
const originalExec = childProcess.execFileSync;
const originalEnv = { ...process.env };
let passed = 0;
async function check(name, test) {
  await test();
  passed += 1;
  console.log(`PASS ${name}`);
}

try {
  const out = path.join(temp, "out");
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
    noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
    typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: out,
    paths: { "@/*": [path.join(root, "*")] }
  }, files: [
    "lib/serverStore.ts", "components/paper-comments.tsx",
    "components/review-sections/screening-section.tsx", "components/review-sections/full-text-section.tsx",
    "components/review-sections/extraction-section.tsx"
  ].map(name => path.join(root, name)) }));
  originalExec(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function (name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(out, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  Object.assign(process.env, {
    PRISMATICA_STORAGE_MODE: "file", PRISMATICA_USERS_SYNC_POSTGRES: "false",
    PRISMATICA_OBJECT_STORAGE_PROVIDER: "local", PRISMATICA_DATA_FILE: path.join(temp, "state.json"),
    PRISMATICA_ADMIN_EMAIL: "comments-admin@example.test", PRISMATICA_ADMIN_PASSWORD: "isolated-comments-password"
  });
  const store = require(path.join(out, "lib/serverStore.js"));
  const data = require(path.join(out, "lib/prismaData.js"));
  const stamp = "2026-10-20T09:00:00.000Z";
  const projectId = "comment-project", studyId = "comment-paper", reportId = "comment-report";
  const users = ["owner", "reviewer-a", "reviewer-b", "outsider", "admin-root"].map(id => ({
    id, name: `Reviewer ${id}`, email: id === "admin-root" ? process.env.PRISMATICA_ADMIN_EMAIL : `${id}@example.test`,
    isAdmin: id === "admin-root", initials: "PC", organization: "Test", title: "Reviewer", timezone: "UTC",
    avatarColor: "#000", passwordHash: "unused-test-hash", passwordSalt: "unused-test-salt",
    createdAt: stamp, updatedAt: stamp, emailAuth: { sessionVersion: "original-session" }
  }));
  const user = id => users.find(item => item.id === id);
  const comment = (userId, text, extra = {}) => ({ userId, userName: user(userId)?.name ?? "Former reviewer", text, createdAt: stamp, updatedAt: stamp, ...extra });
  const vote = (id, userId, extra = {}) => ({
    id, projectId, studyId, userId, userName: user(userId)?.name ?? "Former reviewer", stage: "title_abstract",
    decisionValue: "include", isCurrent: true, createdAt: stamp, ...extra
  });
  const fixture = () => ({
    version: 1, users: structuredClone(users),
    authSettings: { registrationEnabled: true, transactionalEmailEnabled: false },
    reviewSettings: { auditHistoryLimit: 100, screeningCheckoutWindowMinutes: 60, extractionCheckoutWindowMinutes: 120, pdfUploadMaxSizeMb: 50 },
    projects: [
      { ...structuredClone(data.reviewProjects[0]), id: projectId, ownerId: "owner", ownerIds: ["owner"],
        memberIds: ["reviewer-a", "reviewer-b"], stage: "screening", status: "active", recordsTotal: 2, recordsScreened: 0,
        abstractRequiredVotes: 2, fullTextRequiredVotes: 2, blindMode: true, maybePolicy: "conflict", requireSequentialPhases: false },
      { ...structuredClone(data.reviewProjects[0]), id: "private-project", ownerId: "outsider", ownerIds: ["outsider"], memberIds: [] }
    ],
    studies: [
      { ...structuredClone(data.screeningStudies[0]), id: studyId, projectId, title: "Shared comment paper", stage: "title_abstract", comments: [] },
      { ...structuredClone(data.screeningStudies[0]), id: "other-paper", projectId, stage: "title_abstract", comments: [] },
      { ...structuredClone(data.screeningStudies[0]), id: "private-paper", projectId: "private-project", comments: [comment("outsider", "Inaccessible paper comment")] }
    ],
    reports: [{ ...structuredClone(data.reportQueue[0]), id: reportId, projectId, studyId, retrievalStatus: "retrieved", notes: 7 }],
    decisions: [], imports: [], extractionTemplates: [], extractionResponses: [], extractionConsensus: [],
    screeningCheckouts: [], dedupCandidates: [], events: []
  });
  const write = state => fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(state));
  const read = () => JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, "utf8"));
  const reset = (state = fixture()) => { write(state); store.getAppStateForUser("owner"); return read(); };
  const study = state => state.studies.find(item => item.id === studyId);
  const comments = state => study(state).comments ?? [];
  const save = (actor, text, targetStudy = studyId, targetProject = projectId, extra = {}) =>
    store.updateStudyCommentForUser(actor, targetProject, targetStudy, { comment: text, ...extra });

  await check("a reviewer creates and edits one persistent comment without changing votes or peer comments", () => {
    const initial = fixture();
    study(initial).comments = [comment("reviewer-b", "Peer's existing comment")];
    initial.decisions = [vote("peer-vote", "reviewer-b", { note: "Private legacy vote note", exclusionReasonId: "Private vote reason" })];
    const before = reset(initial);
    const peerBefore = comments(before)[0];
    let payload = save("reviewer-a", "  Screening comment\nwith a second line  ", studyId, projectId,
      { userId: "reviewer-b", userName: "Forged author", comments: [comment("owner", "Forged peer replacement")] });
    let own = comments(payload).find(item => item.userId === "reviewer-a");
    assert.equal(own.text, "Screening comment\nwith a second line");
    assert.equal(own.userName, user("reviewer-a").name, "authentication determines the author");
    assert.ok(Number.isFinite(Date.parse(own.createdAt)) && Number.isFinite(Date.parse(own.updatedAt)));
    assert.deepEqual(comments(payload).find(item => item.userId === "reviewer-b"), peerBefore);
    assert.deepEqual(comments(read()), comments(payload));
    assert.deepEqual(read().decisions, before.decisions, "comments never create or modify a decision");
    const createdAt = own.createdAt;
    payload = save("reviewer-a", "Edited during full-text review");
    own = comments(payload).find(item => item.userId === "reviewer-a");
    assert.equal(comments(payload).length, 2, "editing replaces the author's comment instead of duplicating it");
    assert.equal(own.createdAt, createdAt);
    assert.equal(own.text, "Edited during full-text review");
    assert.deepEqual(comments(payload).find(item => item.userId === "reviewer-b"), peerBefore);
    assert.deepEqual(read().decisions, before.decisions);
    assert.deepEqual(read().extractionResponses, before.extractionResponses);
    assert.equal(read().events[0].actorId, "reviewer-a");
  });

  await check("comments remain shared across workflow stages and blind mode keeps peer decisions hidden", () => {
    reset();
    save("reviewer-a", "One paper comment across every phase");
    save("reviewer-b", "Independent peer comment");
    for (const stage of ["title_abstract", "full_text", "extraction"]) {
      const state = read();
      study(state).stage = stage;
      state.decisions = stage === "title_abstract" ? [vote("peer-only", "reviewer-b")] : [
        vote("abstract-a", "reviewer-a"), vote("abstract-b", "reviewer-b"),
        ...(stage === "extraction" ? [
          vote("full-a", "reviewer-a", { stage: "full_text", reportId }),
          vote("full-b", "reviewer-b", { stage: "full_text", reportId })
        ] : [])
      ];
      write(state);
      for (const actor of ["reviewer-a", "reviewer-b", "owner"]) {
        const payload = store.getAppStateForUser(actor);
        assert.equal(study(payload).stage, stage);
        assert.deepEqual(comments(payload).map(item => item.text), ["One paper comment across every phase", "Independent peer comment"]);
        assert.ok(payload.decisions.every(item => item.userId === actor));
        assert.ok(!payload.studies.some(item => item.id === "private-paper"), "inaccessible project comments stay private");
      }
    }
  });

  await check("blank text removes only the author's comment and persists the deletion marker", () => {
    const state = fixture();
    study(state).comments = [comment("reviewer-a", "Own comment"), comment("reviewer-b", "Peer comment")];
    state.decisions = [vote("old-note", "reviewer-a", { note: "Original migrated note", isCurrent: false })];
    reset(state);
    save("reviewer-a", " \n\t ");
    assert.deepEqual(comments(read()), [comment("reviewer-b", "Peer comment")]);
    assert.deepEqual(comments(store.getAppStateForUser("reviewer-a")), [comment("reviewer-b", "Peer comment")]);
    save("reviewer-b", "");
    assert.deepEqual(study(read()).comments, []);
    assert.deepEqual(comments(store.getAppStateForUser("reviewer-a")), [], "old vote notes cannot resurrect deleted comments");
    assert.equal(read().decisions[0].note, "Original migrated note", "historical votes are preserved");
    const eventCount = read().events.length;
    save("reviewer-a", "");
    assert.equal(read().events.length, eventCount, "deleting a missing comment adds no audit entry");
  });

  await check("invalid input, inaccessible projects, and mismatched study IDs cannot modify comments", () => {
    for (const [actor, text, targetStudy, targetProject, status] of [
      ["missing-user", "text", studyId, projectId, 401], ["outsider", "text", studyId, projectId, 403],
      ["reviewer-a", "text", "private-paper", "private-project", 403],
      ["reviewer-a", "text", "private-paper", projectId, 404], ["owner", "text", "missing-paper", projectId, 404],
      ["owner", "text", studyId, "missing-project", 403],
      ["reviewer-a", null, studyId, projectId, 400], ["reviewer-a", {}, studyId, projectId, 400],
      ["reviewer-a", undefined, studyId, projectId, 400], ["reviewer-a", "x".repeat(10_001), studyId, projectId, 400]
    ]) {
      const before = reset();
      assert.throws(() => save(actor, text, targetStudy, targetProject), error => error.status === status);
      assert.deepEqual(read(), before, "rejected edits preserve persisted state");
    }
    reset();
    assert.equal(comments(save("reviewer-a", ` ${"x".repeat(10_000)} `))[0].text.length, 10_000);
  });

  await check("legacy vote notes migrate once by author while numeric note badges and vote reasons stay out of comments", () => {
    const state = fixture();
    delete study(state).comments;
    state.decisions = [
      vote("later-note", "reviewer-a", { note: "Later note", createdAt: "2026-10-21T10:00:00.000Z", exclusionReasonId: "Secret exclusion criterion" }),
      vote("old-note", "reviewer-a", { note: " Earlier note ", isCurrent: false, createdAt: "2026-10-20T10:00:00.000Z" }),
      vote("duplicate-note", "reviewer-a", { note: "Earlier note", isCurrent: false, createdAt: "2026-10-20T11:00:00.000Z" }),
      vote("peer-note", "reviewer-b", { note: "Peer legacy note" }),
      vote("blank-note", "owner", { note: " \n " }),
      vote("removed-reviewer-note", "removed-reviewer", { note: "Former reviewer's note", userName: "Former reviewer" })
    ];
    const originalDecisions = structuredClone(state.decisions);
    write(state);
    const payload = store.getAppStateForUser("owner");
    const own = comments(payload).find(item => item.userId === "reviewer-a");
    assert.equal(comments(payload).length, 3);
    assert.ok(own.text.indexOf("Earlier note") < own.text.indexOf("Later note"), "legacy notes retain chronological order");
    assert.equal((own.text.match(/Earlier note/g) ?? []).length, 1, "repeated historical notes are merged once");
    assert.equal(comments(payload).find(item => item.userId === "reviewer-b").text, "Peer legacy note");
    assert.equal(comments(payload).find(item => item.userId === "removed-reviewer").text, "Former reviewer's note");
    assert.doesNotMatch(JSON.stringify(comments(payload)), /Secret exclusion criterion|decisionValue|exclusionReasonId/);
    for (const decision of read().decisions) assert.deepEqual(decision, originalDecisions.find(item => item.id === decision.id));
    assert.ok(payload.decisions.every(item => item.userId === "owner"), "sharing intentional comment text cannot reveal peer vote fields");
    const first = structuredClone(comments(payload));
    assert.deepEqual(comments(store.getAppStateForUser("reviewer-b")), first, "repeat loads do not reappend migrated text");
    save("reviewer-a", "");
    assert.ok(!comments(store.getAppStateForUser("reviewer-a")).some(item => item.userId === "reviewer-a"));
    const empty = fixture();
    empty.decisions = [vote("legacy-but-deleted", "reviewer-a", { note: "Do not restore" })];
    reset(empty);
    assert.deepEqual(comments(store.getAppStateForUser("reviewer-a")), [], "explicit empty comments mark a completed migration");
    assert.deepEqual(comments(store.getAppStateForUser("reviewer-b")), [], "numeric report.notes alone never fabricates text");
  });

  // Extract the actual SQL hydration functions without opening a database connection.
  const parser = require("next/dist/compiled/babel/parser");
  const sqlSource = fs.readFileSync(path.join(root, "scripts/postgres-state-io.mjs"), "utf8");
  const sqlSyntax = parser.parse(sqlSource, { sourceType: "module" });
  const sqlFunctions = ["asArray", "readJsonObject", "readStudies"].map(name => {
    const node = sqlSyntax.program.body.find(item => item.type === "FunctionDeclaration" && item.id?.name === name);
    assert.ok(node, `${name} is available for isolated SQL hydration checks`);
    return sqlSource.slice(node.start, node.end);
  }).join("\n");
  const readStudies = new Function(`${sqlFunctions}\nreturn readStudies;`)();
  await check("PostgreSQL study hydration retains comments and the empty migration marker", async () => {
    const saved = [comment("reviewer-a", "Saved in JSON payload")];
    const rows = [
      { id: "populated", payload: { comments: saved } }, { id: "deleted", payload: { comments: [] } },
      { id: "legacy", payload: {} }
    ];
    const result = await readStudies({ query: async sql => { assert.match(sql, /FROM review_studies/); return { rows }; } });
    assert.deepEqual(result[0].comments, saved);
    assert.deepEqual(result[1].comments, []);
    assert.equal(result[2].comments, undefined, "unmigrated records retain their migration eligibility");
  });

  await check("PostgreSQL retries preserve concurrent peer comments and unrelated project changes", () => {
    let databaseState = reset();
    let revision = 1, attempts = 0;
    const operations = [];
    process.env.PRISMATICA_STORAGE_MODE = "postgres";
    childProcess.execFileSync = (_command, args, options) => {
      const action = args[1];
      operations.push(action);
      if (action === "read-screening-state") return JSON.stringify({ state: databaseState, revision: String(revision) });
      assert.equal(action, "write-screening-patch", "comment saves use a scoped patch rather than overwriting the workspace");
      const mutation = JSON.parse(options.input);
      attempts += 1;
      if (attempts === 1) {
        study(databaseState).comments.push(comment("reviewer-b", "Concurrent peer comment"));
        databaseState.studies.find(item => item.id === "other-paper").abstract = "Concurrent unrelated paper edit";
        databaseState.projects[0].description = "Concurrent project settings";
        revision += 1;
        return JSON.stringify({ updated: false });
      }
      assert.equal(mutation.revision, String(revision));
      assert.equal(mutation.changes.studies.upserts.length, 1);
      assert.equal(mutation.changes.studies.upserts[0].id, studyId);
      for (const key of ["reports", "decisions", "extractionConsensus"]) assert.deepEqual(mutation.changes[key], { upserts: [], deleteIds: [] });
      for (const [key, changes] of Object.entries(mutation.changes)) {
        const replacements = new Map(changes.upserts.map(item => [item.id, item]));
        const deleted = new Set(changes.deleteIds);
        databaseState[key] = databaseState[key].filter(item => !deleted.has(item.id)).map(item => {
          const next = replacements.get(item.id);
          replacements.delete(item.id);
          return next ?? item;
        });
        databaseState[key].push(...replacements.values());
      }
      if (mutation.project) databaseState.projects[0] = mutation.project;
      databaseState.events.unshift(...mutation.events);
      return JSON.stringify({ updated: true });
    };
    try {
      const payload = save("reviewer-a", "Own concurrent comment");
      assert.equal(attempts, 2);
      assert.deepEqual(comments(payload).map(item => item.text), ["Concurrent peer comment", "Own concurrent comment"]);
      assert.deepEqual(comments(databaseState), comments(payload));
      assert.equal(databaseState.projects[0].description, "Concurrent project settings");
      assert.equal(databaseState.studies.find(item => item.id === "other-paper").abstract, "Concurrent unrelated paper edit");
      assert.equal(databaseState.events.length, 1, "a retry persists one comment event");
      assert.ok(!operations.includes("write"));
    } finally {
      childProcess.execFileSync = originalExec;
      process.env.PRISMATICA_STORAGE_MODE = "file";
    }
  });

  await check("PostgreSQL retries recheck membership before applying a comment", () => {
    let databaseState = reset();
    let attempts = 0;
    process.env.PRISMATICA_STORAGE_MODE = "postgres";
    childProcess.execFileSync = (_command, args) => {
      if (args[1] === "read-screening-state") return JSON.stringify({ state: databaseState, revision: String(attempts + 1) });
      assert.equal(args[1], "write-screening-patch");
      attempts += 1;
      databaseState.projects[0].memberIds = ["reviewer-b"];
      return JSON.stringify({ updated: false });
    };
    try {
      assert.throws(() => save("reviewer-a", "Revoked reviewer comment"), error => error.status === 403);
      assert.equal(attempts, 1);
      assert.deepEqual(comments(databaseState), []);
      assert.deepEqual(databaseState.events, []);
    } finally {
      childProcess.execFileSync = originalExec;
      process.env.PRISMATICA_STORAGE_MODE = "file";
    }
  });

  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { PaperComments } = require(path.join(out, "components/paper-comments.js"));
  const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = node => node == null ? "" : typeof node === "string" || typeof node === "number" ? String(node)
    : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
  const noop = () => {};

  await check("the comment panel exposes one author-owned editor and renders peer comments as escaped read-only text", () => {
    const paper = { ...study(fixture()), comments: [
      comment("reviewer-a", "Own saved comment"), comment("reviewer-b", "Peer's <script>alert('text')</script> comment")
    ] };
    for (const actor of ["reviewer-a", "reviewer-b", "owner"]) {
      const html = renderToStaticMarkup(React.createElement(PaperComments, {
        projectId, study: paper, currentUser: user(actor), onSaveComment: async () => {}
      }));
      assert.equal((html.match(/<textarea\b/g) ?? []).length, 1, "only the current reviewer's comment has an editor");
      assert.equal((html.match(/<article class="paperComment"/g) ?? []).length, actor === "owner" ? 2 : 1);
      assert.match(html, /Comments are shared with project reviewers across review stages/);
      assert.match(html, /maxLength="10000"/);
      assert.doesNotMatch(html, /<script>/, "comment text is escaped through ordinary React text rendering");
      const editor = html.match(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? "";
      assert.equal(editor, actor === "owner" ? "" : actor === "reviewer-a" ? "Own saved comment" : "Peer&#x27;s &lt;script&gt;alert(&#x27;text&#x27;)&lt;/script&gt; comment");
      assert.match(html, /disabled=""[^>]*>[\s\S]*?Save comment/, "unchanged comments cannot be resubmitted");
    }
  });

  // Run actual component event handlers against their external store. The hook
  // shim supplies client snapshots and effects; JSX and state mutations remain
  // the production implementation, and no browser or network is involved.
  async function withCommentClient(test) {
    const hooks = Object.fromEntries(["useId", "useEffect", "useSyncExternalStore"].map(key => [key, React[key]]));
    React.useId = () => "comment-test";
    React.useEffect = effect => { effect(); };
    React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();
    const render = props => { PaperComments(props); return PaperComments(props); };
    const editor = props => nodes(render(props)).find(node => node.type === "textarea");
    const button = props => nodes(render(props)).find(node => node.type === "button");
    try {
      await test({ render, editor, button,
        edit: (props, value) => editor(props).props.onChange({ target: { value } }),
        click: props => button(props).props.onClick(),
        settle: () => new Promise(resolve => setImmediate(resolve))
      });
    } finally {
      Object.assign(React, hooks);
    }
  }

  await check("draft comments persist across stages while remaining scoped to each paper, project, and reviewer", async () => {
    await withCommentClient(async ({ editor, edit }) => {
      const props = { projectId: "draft-project", study: { ...study(fixture()), id: "draft-paper", comments: [] },
        currentUser: user("reviewer-a"), onSaveComment: async () => {} };
      const otherPaper = { ...props, study: { ...props.study, id: "another-draft-paper" } };
      const otherProject = { ...props, projectId: "another-draft-project" };
      const otherUser = { ...props, currentUser: user("reviewer-b") };
      edit(props, "Screening draft");
      edit(otherPaper, "Other paper draft");
      edit(otherProject, "Other project draft");
      edit(otherUser, "Other reviewer draft");
      for (const stage of ["title_abstract", "full_text", "extraction"]) {
        assert.equal(editor({ ...props, study: { ...props.study, stage } }).props.value, "Screening draft");
      }
      assert.equal(editor(otherPaper).props.value, "Other paper draft");
      assert.equal(editor(otherProject).props.value, "Other project draft");
      assert.equal(editor(otherUser).props.value, "Other reviewer draft");
      const colonA = { ...props, projectId: "review:paper", study: { ...props.study, id: "id" } };
      const colonB = { ...props, projectId: "review", study: { ...props.study, id: "paper:id" } };
      edit(colonA, "Collision-safe draft");
      assert.equal(editor(colonB).props.value, "");
    });
  });

  await check("failed saves retain drafts and show retryable errors without changing peer text", async () => {
    await withCommentClient(async ({ render, editor, button, edit, click, settle }) => {
      const requests = [];
      const props = { projectId: "failed-project", study: { ...study(fixture()), id: "failed-paper", comments: [comment("reviewer-b", "Peer text stays unchanged")] },
        currentUser: user("reviewer-a"), onSaveComment: async (...args) => { requests.push(args); throw new Error("Temporary save failure"); } };
      edit(props, "  Preserve this draft  ");
      click(props);
      assert.equal(button(props).props.disabled, true);
      assert.equal(editor(props).props.disabled, true);
      await settle();
      assert.deepEqual(requests, [[props.projectId, props.study.id, "Preserve this draft"]]);
      assert.equal(editor(props).props.value, "  Preserve this draft  ");
      assert.equal(button(props).props.disabled, false, "the failed comment can be retried");
      assert.ok(nodes(render(props)).some(node => node.props?.role === "alert" && text(node) === "Temporary save failure"));
      assert.ok(nodes(render(props)).some(node => node.props?.className === "paperCommentText" && text(node) === "Peer text stays unchanged"));
    });
  });

  await check("a delayed save cannot clear drafts belonging to another paper or reviewer", async () => {
    await withCommentClient(async ({ render, editor, button, edit, click, settle }) => {
      let resolveSave;
      const requests = [];
      const props = { projectId: "pending-project", study: { ...study(fixture()), id: "pending-paper", comments: [] },
        currentUser: user("reviewer-a"), onSaveComment: (...args) => { requests.push(args); return new Promise(resolve => { resolveSave = resolve; }); } };
      const otherPaper = { ...props, study: { ...props.study, id: "next-paper" } };
      const otherUser = { ...props, currentUser: user("reviewer-b") };
      edit(props, "First paper comment");
      click(props);
      click(props);
      assert.equal(requests.length, 1, "pending saves cannot be duplicated");
      edit(otherPaper, "Next paper draft");
      edit(otherUser, "Peer's unsaved draft");
      // The parent applies the returned comment before resolving onSaveComment.
      props.study = { ...props.study, comments: [comment("reviewer-a", "First paper comment")] };
      resolveSave();
      await settle();
      assert.equal(editor(otherPaper).props.value, "Next paper draft");
      assert.equal(editor(otherUser).props.value, "Peer's unsaved draft");
      assert.equal(editor(props).props.value, "First paper comment");
      assert.equal(button(props).props.disabled, true, "a successful save becomes the baseline");
      assert.match(text(render(props)), /Comment saved\./, "updated server props keep the success confirmation visible");
      const refreshed = { ...props, study: structuredClone(props.study) };
      assert.match(text(render(refreshed)), /Comment saved\./, "refreshing saved study objects does not clear the confirmation");
    });
  });

  await check("the parent comment save updates only matching comments and preserves unrelated review state", async () => {
    const source = fs.readFileSync(path.join(root, "components/prisma-review-app.tsx"), "utf8");
    const syntax = parser.parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
    let handler;
    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "FunctionDeclaration" && node.id?.name === "savePaperComment") handler = node;
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    }
    visit(syntax);
    assert.ok(handler);
    const babel = require("next/dist/compiled/babel/core");
    const code = babel.transformSync(source.slice(handler.start, handler.end), {
      filename: "save-paper-comment.ts", babelrc: false, configFile: false,
      presets: [require("next/dist/compiled/babel/preset-typescript")]
    }).code;
    const targetProject = "review / special", targetStudy = "paper ? special";
    const beforeTarget = Object.freeze({ ...study(fixture()), id: targetStudy, projectId: targetProject, abstract: "Newest local citation metadata", comments: [] });
    const otherPaper = Object.freeze({ ...beforeTarget, id: "other-parent-paper" });
    const foreignPaper = Object.freeze({ ...beforeTarget, projectId: "foreign-project" });
    let studies = Object.freeze([beforeTarget, otherPaper, foreignPaper]);
    const savedComments = [comment("reviewer-a", "Updated comment")];
    const returnedEvents = [{ id: "saved-event" }];
    const requests = [], unintended = [];
    let events;
    const scope = {
      apiRequest: async (...args) => { requests.push(args); return { studies: [
        { ...foreignPaper, comments: [comment("reviewer-a", "Wrong project text")] },
        { ...beforeTarget, abstract: "Older server metadata", comments: savedComments },
        { ...otherPaper, abstract: "Older unrelated metadata" }
      ], events: returnedEvents, decisions: [vote("stale-returned-vote", "reviewer-b")] }; },
      setStudies: update => { studies = update(studies); }, setEvents: value => { events = value; },
      applyAppState: () => unintended.push("replace full app state"),
      setDecisions: () => unintended.push("replace decisions"), setReports: () => unintended.push("replace reports"),
      setFullTextReason: () => unintended.push("clear exclusion reason"),
      setExtractionFormValues: () => unintended.push("replace extraction draft")
    };
    const saveHandler = new Function(...Object.keys(scope), `${code}\nreturn savePaperComment;`)(...Object.values(scope));
    await saveHandler(targetProject, targetStudy, "Updated comment");
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], `/api/projects/${encodeURIComponent(targetProject)}/studies/${encodeURIComponent(targetStudy)}/comment`);
    assert.equal(requests[0][1].method, "PATCH");
    assert.deepEqual(JSON.parse(requests[0][1].body), { comment: "Updated comment" });
    assert.deepEqual(studies[0].comments, savedComments);
    assert.equal(studies[0].abstract, "Newest local citation metadata", "saving a comment cannot rewind citation metadata");
    assert.equal(studies[1], otherPaper);
    assert.equal(studies[2], foreignPaper, "matching study IDs cannot change another project's comments");
    assert.deepEqual(beforeTarget.comments, [], "the previous React state stays unchanged");
    assert.equal(events, returnedEvents);
    assert.deepEqual(unintended, [], "comment saves preserve other review forms and decisions");
  });

  await check("screening, full text, and extraction display the same shared comment panel", () => {
    const { NavigationProvider } = require(path.join(out, "components/navigation-link.js"));
    const { ScreeningSection } = require(path.join(out, "components/review-sections/screening-section.js"));
    const { FullTextSection } = require(path.join(out, "components/review-sections/full-text-section.js"));
    const { ExtractionSection } = require(path.join(out, "components/review-sections/extraction-section.js"));
    const state = fixture(), project = state.projects[0], paper = study(state), report = state.reports[0];
    paper.comments = [comment("reviewer-a", "Own shared text"), comment("reviewer-b", "Peer shared text")];
    const paperComments = React.createElement(PaperComments, { projectId, study: paper, currentUser: user("reviewer-a"), onSaveComment: async () => {} });
    const cases = [
      [ScreeningSection, { projectScreeningStudies: [paper], totalScreeningStudyCount: 1, screeningProgress: 0, decisions: [],
        selectedProjectId: projectId, currentUserId: "reviewer-a", blindMode: true, studyIndex: 0, setStudyIndex: noop,
        titleAbstractEvaluations: new Map(), formatDecision: String, decisionTone: () => "info", currentStudy: paper,
        stageEvaluation: { state: "awaiting_votes", label: "Awaiting votes" }, screeningMessage: "", canRecordScreeningDecision: true,
        checkoutError: "", currentUserDecision: undefined, currentStageDecisions: [], pendingScreeningDecision: null,
        isUndoingScreeningDecision: false, reviewedCount: 0, onOpenReviewed: noop, conflicts: [], onResolveConflict: noop,
        formatConflictResolutionHint: String, selectedProjectAbstractRequiredVotes: 2, addScreeningDecision: noop,
        undoLastDecision: noop, onPostpone: noop, canPostpone: false }],
      [FullTextSection, { hasProjectSeedData: false, phaseProgress: { percent: 0, label: "Awaiting votes" }, projectReportQueue: [report],
        totalFullTextReportCount: 1, activeReport: report, decisions: [], selectedProject: project, currentUser: user("reviewer-a"),
        fullTextMessage: "", checkoutError: "", setActiveReportId: noop, setFullTextMessage: noop, pdfInputRef: { current: null },
        pendingFullTextAction: null, uploadReportPdf: noop, updateFullTextReport: noop, formatDecision: String,
        formatConflictResolutionHint: String, decisionTone: () => "info", fullTextReason: "", setFullTextReason: noop,
        exclusionReasons: ["Wrong population"], studies: [paper], reviewedCount: 0, onOpenReviewed: noop, conflicts: [],
        onResolveConflict: noop, onOpenPdfUpload: noop }],
      [ExtractionSection, { activeCounts: { ...data.prismaCounts, studiesIncluded: 1 }, projectReportQueue: [report],
        projectExtractionStudyIds: new Set([studyId]), selectedProject: project, currentUser: user("reviewer-a"), extractionMessage: "",
        activeExtractionTemplate: { id: "template", title: "Extraction", fields: [], version: 1 }, saveExtractionTemplate: noop,
        isCreatingExtractionTemplate: false, isEditingExtractionTemplate: false, extractionTemplateForm: { title: "Extraction", fields: [] },
        setExtractionTemplateTitle: noop, removeExtractionTemplateField: noop, moveExtractionTemplateField: noop,
        updateExtractionTemplateField: noop, addExtractionTemplateField: noop, startEditingExtractionTemplate: noop,
        cancelEditingExtractionTemplate: noop, activeExtractionReport: report, projectExtractionReports: [report], totalExtractionReportCount: 1,
        setActiveView: noop, setActiveExtractionReportId: noop, setActiveReportId: noop, projectScreeningStudies: [paper],
        extractionResponses: [], activeExtractionResponse: undefined, submitExtractionResponse: noop,
        isSubmittingExtractionResponse: false, extractionFormValues: {}, updateExtractionValue: noop, toggleExtractionChoice: noop,
        reviewedCount: 0, onOpenReviewed: noop }]
    ];
    for (const [Component, props] of cases) {
      const html = renderToStaticMarkup(React.createElement(NavigationProvider, { projectId },
        React.createElement(Component, { ...props, paperComments })));
      assert.equal((html.match(/class="paperComments"/g) ?? []).length, 1, `${Component.name} includes one shared panel`);
      assert.match(html, /Own shared text/);
      assert.match(html, /Peer shared text/);
      if (Component === FullTextSection) {
        assert.match(html, /2 comments/, "full-text metadata counts saved comments on the study");
        assert.doesNotMatch(html, /7 notes/, "the legacy numeric report.notes badge is not used");
      }
    }
  });

  console.log(`Paper comment checks passed (${passed}).`);
} finally {
  Module._resolveFilename = originalResolve;
  childProcess.execFileSync = originalExec;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
