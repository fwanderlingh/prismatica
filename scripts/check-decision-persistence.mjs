import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const childProcess = require('node:child_process');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-decisions-'));
const originalResolve = Module._resolveFilename;
const originalExec = childProcess.execFileSync;
const originalEnv = { ...process.env };
let passed = 0;

async function check(name, run) {
  try { await run(); passed += 1; }
  catch (error) { throw new Error(name, { cause: error }); }
}

try {
  const out = path.join(temp, 'out');
  const config = path.join(temp, 'tsconfig.json');
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: 'ES2020', module: 'Node16', moduleResolution: 'Node16',
      esModuleInterop: true, skipLibCheck: true, noEmitOnError: true, types: ['node'],
      typeRoots: [path.join(root, 'node_modules/@types')], ignoreDeprecations: '6.0',
      rootDir: root, outDir: out, paths: { '@/*': [path.join(root, '*')] }
    },
    files: [path.join(root, 'lib/serverStore.ts')]
  }));
  originalExec(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  Module._resolveFilename = function (request, parent, ...args) {
    if (request.startsWith('@/')) request = path.join(out, request.slice(2));
    return originalResolve.call(this, request, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
  };
  Object.assign(process.env, {
    PRISMATICA_STORAGE_MODE: 'file', PRISMATICA_USERS_SYNC_POSTGRES: 'false',
    PRISMATICA_DATA_FILE: path.join(temp, 'state.json'), PRISMATICA_OBJECT_STORAGE_PROVIDER: 'local',
    PRISMATICA_ADMIN_EMAIL: 'decision-admin@example.test', PRISMATICA_ADMIN_PASSWORD: 'isolated-decision-password'
  });
  const store = require(path.join(out, 'lib/serverStore.js'));
  const seeds = require(path.join(out, 'lib/prismaData.js'));
  const stamp = '2026-10-20T12:00:00.000Z';
  const user = (id, isAdmin = false) => ({
    id, name: id, email: `${id}@example.test`, isAdmin, initials: 'DR', organization: 'Test',
    title: 'Reviewer', timezone: 'UTC', avatarColor: '#000', passwordHash: 'isolated-unused-hash',
    passwordSalt: 'isolated-unused-salt', createdAt: stamp, updatedAt: stamp,
    emailAuth: { sessionVersion: 'original-session' }
  });
  const users = [
    { ...user('admin-root', true), email: process.env.PRISMATICA_ADMIN_EMAIL },
    user('reviewer-a'), user('reviewer-b')
  ];
  const actor = users[1];
  const peer = users[2];
  const projectId = 'decision-project';
  const studyId = 'decision-study-1';
  const fixture = (count = 2) => ({
    version: 1, users: structuredClone(users),
    authSettings: { registrationEnabled: true, transactionalEmailEnabled: false },
    reviewSettings: { auditHistoryLimit: 100, screeningCheckoutWindowMinutes: 60, extractionCheckoutWindowMinutes: 120, pdfUploadMaxSizeMb: 50 },
    projects: [{
      ...structuredClone(seeds.reviewProjects[0]), id: projectId, title: 'Decision fixture',
      ownerId: actor.id, ownerIds: [actor.id], memberIds: [actor.id, peer.id],
      recordsTotal: count, recordsScreened: 0, studiesIncluded: 0, conflicts: 0,
      abstractRequiredVotes: 2, fullTextRequiredVotes: 2, extractionRequiredVotes: 2,
      exclusionReasons: ['Wrong population'], maybePolicy: 'conflict', requireSequentialPhases: false,
      blindMode: false, status: 'active', stage: 'screening'
    }],
    studies: Array.from({ length: count }, (_, index) => ({
      ...structuredClone(seeds.screeningStudies[0]), id: `decision-study-${index + 1}`, projectId,
      importItemId: index + 1, title: `Distinct citation ${index + 1}`, stage: 'title_abstract'
    })),
    reports: [], imports: [], decisions: [], screeningCheckouts: [], extractionTemplates: [],
    extractionResponses: [], extractionConsensus: [], dedupCandidates: [], events: []
  });
  const write = state => fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(state));
  const read = () => JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, 'utf8'));
  const vote = (reviewerId = actor.id, decisionValue = 'include') => store.addScreeningDecisionForUser(reviewerId, { projectId, studyId, decisionValue });
  const current = (state, stage, reviewerId) => state.decisions.filter(item => item.isCurrent && item.stage === stage && item.userId === reviewerId);

  await check('file persistence preserves vote history, undo, checkout handoff, and full-text workflow', () => {
    write(fixture());
    vote();
    let state = read();
    const originalVote = current(state, 'title_abstract', actor.id)[0];
    assert.equal(originalVote.decisionValue, 'include');
    assert.ok(state.screeningCheckouts.some(item => item.studyId === 'decision-study-2' && item.userId === actor.id), 'saving a vote reserves the next active citation');
    assert.ok(!state.screeningCheckouts.some(item => item.studyId === studyId && item.userId === actor.id));
    assert.equal(state.reports.length, 0, 'one vote does not prematurely advance the citation');
    const changed = vote(actor.id, 'exclude');
    state = read();
    assert.equal(changed.decisionAction.previousDecisionId, originalVote.id);
    assert.equal(state.decisions.find(item => item.id === originalVote.id).isCurrent, false);
    assert.equal(current(state, 'title_abstract', actor.id).length, 1);
    store.undoScreeningDecisionForUser(actor.id, { projectId, studyId, previousDecisionId: originalVote.id });
    state = read();
    assert.equal(state.decisions.length, 3, 'undo retains the original and superseding audit records');
    assert.equal(current(state, 'title_abstract', actor.id)[0].decisionValue, 'include');
    vote(peer.id);
    state = read();
    assert.equal(state.studies.find(item => item.id === studyId).stage, 'full_text');
    assert.equal(state.reports.length, 1);
    assert.equal(state.projects[0].recordsScreened, 1);
    const reportId = state.reports[0].id;
    for (const reviewerId of [actor.id, peer.id]) {
      store.updateReportForUser(reviewerId, projectId, reportId, { retrievalStatus: 'retrieved', decisionValue: 'include' });
    }
    state = read();
    assert.equal(state.studies.find(item => item.id === studyId).stage, 'extraction');
    assert.equal(current(state, 'full_text', actor.id).length, 1);
    assert.equal(current(state, 'full_text', peer.id).length, 1);
    assert.ok(state.events.length >= 6, 'decision and undo audit events persist');
  });

  await check('undo rejects unrelated, current, missing, and superseded prior decisions without changing history', () => {
    write(fixture());
    vote();
    const firstVote = current(read(), 'title_abstract', actor.id)[0];
    vote(actor.id, 'exclude');
    const baseline = read();
    for (const change of [
      { userId: peer.id }, { studyId: 'decision-study-2' }, { projectId: 'unrelated-project' },
      { stage: 'full_text' }, { isCurrent: true }
    ]) {
      const state = structuredClone(baseline);
      state.projects.push({ ...structuredClone(state.projects[0]), id: 'unrelated-project' });
      const previous = { ...structuredClone(firstVote), ...change, id: 'invalid-prior-decision', isCurrent: change.isCurrent ?? false };
      state.decisions.push(previous);
      write(state);
      assert.throws(() => store.undoScreeningDecisionForUser(actor.id, { projectId, studyId, previousDecisionId: previous.id }), error => error.status === 400);
      assert.deepEqual(read().decisions, state.decisions, 'invalid undo never updates any reviewer history');
      assert.deepEqual(read().events, state.events, 'invalid undo never appends an audit event');
    }
    write(baseline);
    assert.throws(() => store.undoScreeningDecisionForUser(actor.id, { projectId, studyId, previousDecisionId: 'missing-decision' }), error => error.status === 400);
    vote(actor.id, 'maybe');
    const latest = read();
    assert.throws(() => store.undoScreeningDecisionForUser(actor.id, { projectId, studyId, previousDecisionId: firstVote.id }), error => error.status === 409);
    assert.deepEqual(read().decisions, latest.decisions, 'a stale undo cannot replace a newer vote');
  });

  await check('settled file-state reads do not rewrite the state file', () => {
    write(fixture());
    const originalWriteFile = fs.writeFileSync;
    let stateWrites = 0;
    fs.writeFileSync = function (filename, ...args) {
      if (String(filename).startsWith(process.env.PRISMATICA_DATA_FILE)) stateWrites += 1;
      return originalWriteFile.call(this, filename, ...args);
    };
    try {
      store.getAppStateForUser(actor.id);
      assert.equal(stateWrites, 1, 'the initial read persists normalized legacy/default fields once');
      stateWrites = 0;
      store.getAppStateForUser(actor.id);
      store.getAppStateForUser(actor.id);
      assert.equal(stateWrites, 0, 'unchanged application reads incur no disk write');
    } finally {
      fs.writeFileSync = originalWriteFile;
    }
  });

  process.env.PRISMATICA_STORAGE_MODE = 'postgres';
  let databaseState;
  let revision;
  let operations;
  let attempts;
  let savedMutation;
  let bridgeMutation;
  let beforeCommit;
  function resetDatabase(state = fixture(), intercept = undefined) {
    databaseState = structuredClone(state);
    revision = 1;
    operations = [];
    attempts = 0;
    savedMutation = undefined;
    beforeCommit = intercept;
  }
  function applyMutation(mutation) {
    if (mutation.project) databaseState.projects = databaseState.projects.map(project => project.id === mutation.projectId ? mutation.project : project);
    for (const [key, changes] of Object.entries(mutation.changes)) {
      const deleted = new Set(changes.deleteIds);
      const replacements = new Map(changes.upserts.map(item => [item.id, item]));
      databaseState[key] = databaseState[key].filter(item => !deleted.has(item.id)).map(item => {
        const replacement = replacements.get(item.id);
        replacements.delete(item.id);
        return replacement ?? item;
      });
      const added = [...replacements.values()];
      if (key === 'reports') databaseState[key].unshift(...added);
      else databaseState[key].push(...added);
    }
    databaseState.screeningCheckouts = [
      ...databaseState.screeningCheckouts.filter(checkout => checkout.projectId !== mutation.projectId),
      ...mutation.screeningCheckouts
    ];
    for (const event of mutation.events) databaseState.events.unshift(event);
    revision += 1;
  }
  childProcess.execFileSync = (_command, args, options) => {
    const action = args[1];
    operations.push(action);
    if (action === 'read') return JSON.stringify({ ...databaseState, __storageRevision: String(revision) });
    if (action === 'read-screening-state') return JSON.stringify({
      state: { ...databaseState, __storageRevision: String(revision) }, revision: String(revision)
    });
    if (action === 'write-screening-patch') {
      const mutation = JSON.parse(options.input);
      assert.ok(!('users' in mutation), 'incremental decisions do not send account snapshots for persistence');
      assert.ok(!('authSettings' in mutation));
      assert.ok(!('reviewSettings' in mutation));
      attempts += 1;
      const intercepted = beforeCommit?.(mutation, attempts);
      if (intercepted) return JSON.stringify(intercepted);
      assert.equal(mutation.revision, String(revision));
      savedMutation = mutation;
      applyMutation(mutation);
      return JSON.stringify({ updated: true });
    }
    throw new Error(`Unexpected decision persistence operation: ${action}`);
  };

  await check('a conflicting vote retries fresh inputs and preserves concurrent changes', () => {
    const initial = fixture();
    const unrelated = { ...structuredClone(initial.projects[0]), id: 'unrelated-project', title: 'Preserve unrelated review' };
    initial.projects.push(unrelated);
    initial.studies.push({ ...structuredClone(initial.studies[0]), id: 'unrelated-study', projectId: unrelated.id });
    resetDatabase(initial, (_mutation, attempt) => {
      if (attempt !== 1) return undefined;
      databaseState.projects[0].title = 'Edited concurrently';
      databaseState.projects[0].description = 'Preserve project metadata';
      databaseState.authSettings.registrationEnabled = false;
      databaseState.reviewSettings.auditHistoryLimit = 37;
      databaseState.users[1].name = 'Renamed reviewer';
      databaseState.users[1].passwordHash = 'concurrent-password-hash';
      for (const [reviewer, value] of [[actor, 'exclude'], [peer, 'include']]) {
        databaseState.decisions.push({
          id: `concurrent-${reviewer.id}`, projectId, studyId, stage: 'title_abstract',
          userId: reviewer.id, userName: reviewer.name, decisionValue: value, isCurrent: true, createdAt: stamp
        });
      }
      databaseState.events.unshift({ id: 'concurrent-event', actor: peer.name, actorUserId: peer.id, entity: studyId, action: 'Concurrent vote', time: stamp });
      revision += 1;
      return { updated: false };
    });
    const payload = vote();
    assert.equal(attempts, 2);
    assert.equal(operations.filter(action => action === 'read-screening-state').length, 2, 'retry reads a new consistent snapshot');
    assert.ok(!operations.includes('write'), 'a decision never replaces all PostgreSQL state');
    assert.equal(current(databaseState, 'title_abstract', actor.id).length, 1, 'a concurrent vote by the same actor is superseded');
    assert.equal(current(databaseState, 'title_abstract', actor.id)[0].supersedesDecisionId, 'concurrent-reviewer-a');
    assert.equal(current(databaseState, 'title_abstract', actor.id)[0].userName, 'Renamed reviewer');
    assert.equal(current(databaseState, 'title_abstract', peer.id)[0].id, 'concurrent-reviewer-b');
    assert.equal(databaseState.decisions.find(item => item.id === 'concurrent-reviewer-a').isCurrent, false);
    assert.equal(databaseState.projects[0].title, 'Edited concurrently');
    assert.equal(databaseState.projects[0].description, 'Preserve project metadata');
    assert.deepEqual(databaseState.projects[1], unrelated);
    assert.equal(databaseState.users[1].passwordHash, 'concurrent-password-hash');
    assert.equal(databaseState.authSettings.registrationEnabled, false);
    assert.equal(databaseState.reviewSettings.auditHistoryLimit, 37);
    assert.ok(databaseState.events.some(item => item.id === 'concurrent-event'));
    assert.equal(databaseState.reports.length, 1, 'aggregate workflow includes the other reviewer vote');
    assert.equal(databaseState.studies.find(item => item.id === studyId).stage, 'full_text');
    assert.ok(savedMutation.changes.studies.upserts.every(item => item.id === studyId), 'unchanged citations are omitted from the patch');
    assert.equal(savedMutation.changes.decisions.upserts.length, 2, 'only the superseded and new decisions are persisted');
    assert.ok(savedMutation.screeningCheckouts.some(item => item.studyId === 'decision-study-2' && item.userId === actor.id));
    assert.equal(payload.decisionAction.previousDecisionId, 'concurrent-reviewer-a');
    bridgeMutation = structuredClone(savedMutation);
  });

  await check('access denial at commit is reported without writing or retrying', () => {
    resetDatabase(fixture(), () => ({ updated: false, status: 403, error: 'Membership removed concurrently.' }));
    assert.throws(() => vote(), error => error.status === 403 && /Membership removed/.test(error.message));
    assert.equal(attempts, 1);
    assert.equal(databaseState.decisions.length, 0);
  });

  await check('session revocation during a retry cannot authorize a pending vote', () => {
    resetDatabase(fixture(), (mutation, attempt) => {
      if (attempt === 1) {
        databaseState.users[1].emailAuth.sessionVersion = 'revoked-session';
        revision += 1;
        return { updated: false };
      }
      assert.equal(mutation.sessionVersion, 'original-session', 'retries retain the session that authorized the initial request');
      return { updated: false, status: 401, error: 'Your session is no longer valid. Sign in again.' };
    });
    assert.throws(() => vote(), error => error.status === 401);
    assert.equal(databaseState.decisions.length, 0);
    assert.ok(attempts <= 2);
  });

  await check('deleted citations and removed memberships are revalidated on retry', () => {
    for (const scenario of ['citation', 'membership', 'project']) {
      const initial = fixture();
      initial.projects[0].ownerId = peer.id;
      initial.projects[0].ownerIds = [peer.id];
      resetDatabase(initial, (_mutation, attempt) => {
        assert.equal(attempt, 1, 'an invalidated request does not reach a second persistence attempt');
        if (scenario === 'citation') databaseState.studies = databaseState.studies.filter(item => item.id !== studyId);
        if (scenario === 'membership') databaseState.projects[0].memberIds = [peer.id];
        if (scenario === 'project') databaseState.projects = [];
        revision += 1;
        return { updated: false };
      });
      assert.throws(() => vote(), error => [400, 403, 404, 409].includes(error.status), `${scenario} must reject the stale request`);
      assert.equal(databaseState.decisions.length, 0);
      assert.equal(attempts, 1);
    }
  });

  await check('repeated contention stops with a retryable conflict and no write', () => {
    resetDatabase(fixture(), () => { revision += 1; return { updated: false }; });
    assert.throws(() => vote(), error => error.status === 409);
    assert.equal(attempts, 5);
    assert.equal(databaseState.decisions.length, 0);
  });

  await check('PostgreSQL screening, undo, reopen, report updates, and checkouts use incremental persistence', () => {
    const initial = fixture();
    initial.projects[0].abstractRequiredVotes = 1;
    initial.projects[0].fullTextRequiredVotes = 2;
    resetDatabase(initial);
    vote();
    let reportId = databaseState.reports[0].id;
    assert.equal(databaseState.studies[0].stage, 'full_text');
    store.updateReportForUser(actor.id, projectId, reportId, { retrievalStatus: 'retrieved', decisionValue: 'include' });
    assert.equal(databaseState.studies[0].stage, 'full_text');
    store.updateReportForUser(peer.id, projectId, reportId, { decisionValue: 'include' });
    assert.equal(databaseState.studies[0].stage, 'extraction');
    store.updateReportForUser(actor.id, projectId, reportId, { decisionValue: 'exclude', exclusionReasonId: 'Wrong population' });
    assert.equal(databaseState.studies[0].stage, 'full_text');
    assert.equal(current(databaseState, 'full_text', actor.id).length, 1);
    assert.equal(databaseState.decisions.filter(item => item.stage === 'full_text').length, 3);
    store.reopenFullTextDecisionForUser(actor.id, projectId, reportId);
    assert.equal(current(databaseState, 'full_text', actor.id).length, 0);
    store.updateReportForUser(actor.id, projectId, reportId, { decisionValue: 'include' });
    store.reopenTitleAbstractDecisionForUser(actor.id, projectId, studyId);
    assert.equal(current(databaseState, 'title_abstract', actor.id).length, 0);
    assert.ok(databaseState.reports.some(item => item.id === reportId), 'downstream full-text work is retained when title screening reopens');
    assert.ok(!operations.includes('write'), 'full-text decisions and reopening avoid full-state replacement');
    resetDatabase();
    vote();
    store.undoScreeningDecisionForUser(actor.id, { projectId, studyId });
    assert.equal(current(databaseState, 'title_abstract', actor.id).length, 0);
    store.updateScreeningCheckoutForUser(actor.id, { projectId, studyId, stage: 'title_abstract', action: 'acquire', checkoutId: 'separate-request-checkout' });
    assert.ok(databaseState.screeningCheckouts.some(item => item.checkoutId === 'separate-request-checkout'));
    store.updateScreeningCheckoutForUser(actor.id, { projectId, studyId, stage: 'title_abstract', action: 'release', checkoutId: 'separate-request-checkout' });
    assert.ok(!databaseState.screeningCheckouts.some(item => item.checkoutId === 'separate-request-checkout'));
    assert.ok(!operations.includes('write'), 'the entire screening lifecycle avoids full-state replacement');
  });

  childProcess.execFileSync = originalExec;

  // Execute the production SQL helpers with a client double. No database
  // credentials or external state are used by this regression script.
  const pgSource = fs.readFileSync(path.join(root, 'scripts/postgres-state-io.mjs'), 'utf8');
  const context = {};
  vm.runInNewContext(pgSource.slice(0, pgSource.indexOf('run().catch')).replace('import { Client } from "pg";', '') + `
    this.writePatch = writeScreeningPatch;
    this.writeFull = writeFullStateMutation;
    this.readRevision = readScreeningRevision;
  `, context);
  const mutates = sql => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql);
  function bridgeClient({
    currentActor = { id: actor.id, name: actor.name, is_admin: false, email_auth: { sessionVersion: 'original-session' } },
    currentProject = fixture().projects[0], currentRevision = bridgeMutation.revision,
    lockFailure = false, sqlFailure = false, foreignRecord = false, verificationEnabled = false
  } = {}) {
    const queries = [];
    return {
      queries,
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (lockFailure && sql.startsWith('LOCK TABLE')) throw Object.assign(new Error('Concurrent lock'), { code: '55P03' });
        if (sqlFailure && /INSERT INTO review_decisions/.test(sql)) throw new Error('Simulated decision persistence failure');
        if (sql.startsWith('SELECT id, name, is_admin, email_auth')) return { rows: currentActor ? [currentActor] : [] };
        if (sql.includes('FROM review_projects') && sql.includes('ORDER BY position ASC')) return {
          rows: currentProject ? [{ id: currentProject.id, payload: currentProject }] : []
        };
        if (sql.startsWith('SELECT transactional_email_enabled')) return { rows: [{ transactional_email_enabled: verificationEnabled }] };
        if (sql.startsWith('SELECT md5(')) return { rows: [{ revision: currentRevision }] };
        if (/^SELECT id, project_id FROM/.test(sql)) return { rows: foreignRecord ? [{ id: params[0][0], project_id: 'another-project' }] : [] };
        if (/AS position FROM/.test(sql)) return { rows: [{ position: 10 }] };
        if (sql.startsWith('SELECT audit_history_limit')) return { rows: [{ audit_history_limit: 100 }] };
        return { rows: [], rowCount: 1 };
      }
    };
  }

  await check('the SQL patch commits only changed rows, scoped deletes, checkouts, summaries, and audits', async () => {
    const freshProject = { ...fixture().projects[0], title: 'Fresh project metadata', description: 'Preserve this description' };
    const mutation = structuredClone(bridgeMutation);
    mutation.changes.reports.deleteIds.push('obsolete-report');
    const client = bridgeClient({ currentProject: freshProject });
    assert.equal((await context.writePatch(client, mutation)).updated, true);
    assert.equal(client.queries[0].sql, 'BEGIN');
    assert.equal(client.queries.at(-1).sql, 'COMMIT');
    const writes = client.queries.filter(({ sql }) => mutates(sql));
    assert.ok(writes.every(({ sql }) => !/\b(TRUNCATE|app_users|auth_settings|review_settings)\b/i.test(sql)), 'voting never truncates review state or writes accounts/settings');
    const decisionWrites = writes.filter(({ sql }) => /INSERT INTO review_decisions/.test(sql));
    assert.equal(decisionWrites.length, 2);
    for (const query of decisionWrites) {
      assert.match(query.sql, /ON CONFLICT \(id\) DO UPDATE/);
      assert.ok(!query.sql.includes('position = EXCLUDED.position'), 'superseding a decision preserves its historical row order');
    }
    assert.ok(decisionWrites[1].params[5] > decisionWrites[0].params[5], 'new decision rows append after existing historical decisions');
    assert.equal(writes.filter(({ sql }) => /INSERT INTO review_studies/.test(sql)).length, 1, 'unaffected citations are not reinserted');
    assert.ok(writes.some(({ sql }) => /INSERT INTO review_reports/.test(sql)));
    const scopedDelete = writes.find(({ sql }) => /DELETE FROM review_reports/.test(sql));
    assert.match(scopedDelete.sql, /AND project_id = \$2/);
    assert.equal(scopedDelete.params[1], projectId);
    const projectUpdate = writes.find(({ sql }) => /UPDATE review_projects/.test(sql));
    const persistedProject = JSON.parse(projectUpdate.params[8]);
    assert.equal(persistedProject.title, freshProject.title);
    assert.equal(persistedProject.description, freshProject.description);
    const checkoutWrite = writes.find(({ sql }) => /INSERT INTO review_screening_checkouts/.test(sql));
    assert.deepEqual(JSON.parse(checkoutWrite.params[1]), mutation.screeningCheckouts);
    assert.ok(writes.some(({ sql }) => /INSERT INTO workflow_events/.test(sql)));
  });

  await check('SQL access checks and stale revisions roll back before any state change', async () => {
    const noMembership = { ...fixture().projects[0], ownerId: peer.id, ownerIds: [peer.id], memberIds: [peer.id] };
    for (const scenario of [
      { currentRevision: 'changed-revision' },
      { currentActor: null, status: 401 },
      { currentProject: null, status: 403 },
      { currentProject: noMembership, status: 403 },
      { currentActor: { id: actor.id, is_admin: false, email_auth: { sessionVersion: 'new-session' } }, status: 401 },
      { currentActor: { id: actor.id, is_admin: false, email_auth: { sessionVersion: 'original-session', verificationRequired: true } }, verificationEnabled: true, status: 401 },
      { lockFailure: true }
    ]) {
      const client = bridgeClient(scenario);
      const result = await context.writePatch(client, bridgeMutation);
      assert.equal(result.updated, false);
      if (scenario.status) assert.equal(result.status, scenario.status);
      assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
      assert.ok(!client.queries.some(({ sql }) => mutates(sql)), 'a rejected patch never changes persisted state');
    }
  });

  await check('SQL failures and attempts to move records across projects roll back atomically', async () => {
    for (const scenario of [{ sqlFailure: true }, { foreignRecord: true }]) {
      const client = bridgeClient(scenario);
      await assert.rejects(context.writePatch(client, bridgeMutation), /Simulated decision persistence failure|cannot move records/);
      assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
      assert.ok(!client.queries.some(({ sql }) => sql === 'COMMIT'));
    }
  });

  await check('project revisions cover workflow, checkout, identity, and policy inputs', async () => {
    const client = bridgeClient();
    await context.readRevision(client, projectId);
    const query = client.queries[0];
    for (const table of ['review_projects', 'review_studies', 'review_reports', 'review_decisions',
      'review_extraction_templates', 'review_extraction_responses', 'review_extraction_consensus',
      'review_screening_checkouts', 'review_dedup_candidates', 'app_users', 'auth_settings', 'review_settings']) {
      assert.ok(query.sql.includes(table), `revision detects changes to ${table}`);
    }
    assert.ok(query.sql.includes('xmin::text'), 'updates invalidate the revision even when entity IDs stay the same');
    assert.ok(!query.sql.includes('workflow_events'), 'audit appends alone do not force workflow recomputation');
    assert.equal(query.params[0], projectId);
  });

  await check('a stale full-state writer cannot erase a newly committed vote', async () => {
    const client = bridgeClient({ currentRevision: 'fresh-state-revision' });
    const result = await context.writeFull(client, { ...fixture(), __expectedRevision: 'stale-state-revision' });
    assert.equal(result.updated, false);
    assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
    assert.ok(!client.queries.some(({ sql }) => mutates(sql)), 'stale full-state writes stop before account changes or truncation');
  });

  console.log(`Decision persistence checks passed: ${passed}.`);
} finally {
  Module._resolveFilename = originalResolve;
  childProcess.execFileSync = originalExec;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
