import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const childProcess = require('node:child_process');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-blind-votes-'));
const originalResolve = Module._resolveFilename;
const originalEnv = { ...process.env };
let passed = 0;

try {
  const out = path.join(temp, 'out');
  const config = path.join(temp, 'tsconfig.json');
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: 'ES2020', module: 'Node16', moduleResolution: 'Node16',
      esModuleInterop: true, skipLibCheck: true, types: ['node'],
      typeRoots: [path.join(root, 'node_modules/@types')], ignoreDeprecations: '6.0',
      rootDir: root, outDir: out, paths: { '@/*': [path.join(root, '*')] }
    },
    files: [path.join(root, 'lib/serverStore.ts')]
  }));
  childProcess.execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  Module._resolveFilename = function (request, parent, ...args) {
    if (request.startsWith('@/')) request = path.join(out, request.slice(2));
    return originalResolve.call(this, request, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
  };
  // Test actual payload and mutation functions using an isolated in-memory state.
  const storePath = path.join(out, 'lib/serverStore.js');
  fs.appendFileSync(storePath, `
const __originalReadState = readState;
const __originalWriteState = writeState;
exports.__blindVoteTest = {
  buildPayload,
  useState(state) { readState = () => state; writeState = () => {}; },
  restoreIo() { readState = __originalReadState; writeState = __originalWriteState; }
};
`);
  process.env.PRISMATICA_STORAGE_MODE = 'file';
  process.env.PRISMATICA_DATA_FILE = path.join(temp, 'state.json');
  process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER = 'local';
  const store = require(storePath);
  const internal = store.__blindVoteTest;
  const seeds = require(path.join(out, 'lib/prismaData.js'));
  const selectors = require(path.join(out, 'lib/workflowSelectors.js'));
  const projectId = 'blind-project';
  const stamp = '2026-10-20T08:00:00.000Z';
  const users = ['owner', 'peer', 'reviewer', 'admin'].map(id => ({
    id, name: `Reviewer ${id}`, email: `${id}@example.test`, isAdmin: id === 'admin',
    initials: id.slice(0, 2), organization: 'Test', title: 'Reviewer', timezone: 'UTC', avatarColor: '#000',
    passwordHash: 'unused-test-hash', passwordSalt: 'unused-test-salt', createdAt: stamp, updatedAt: stamp
  }));
  const study = (id, stage = 'title_abstract') => ({
    ...structuredClone(seeds.screeningStudies[0]), id, projectId, title: `Paper ${id}`, stage
  });
  const decision = (id, userId, studyId, decisionValue, reportId) => ({
    id, projectId, studyId, reportId, stage: reportId ? 'full_text' : 'title_abstract',
    userId, userName: users.find(user => user.id === userId).name, decisionValue,
    note: userId === 'peer' ? 'Private peer vote explanation' : undefined,
    exclusionReasonId: decisionValue === 'exclude' && reportId ? 'Wrong population' : undefined,
    isCurrent: true, createdAt: stamp
  });
  const event = (id, actorId, action, entity = 'screening-paper') => ({
    id, actor: users.find(user => user.id === actorId)?.name ?? 'Legacy reviewer', actorId,
    action, entity, time: stamp
  });
  function fixture() {
    const records = [study('screening-paper'), study('full-text-paper', 'full_text')];
    return {
      version: 1, authSettings: { registrationEnabled: true, transactionalEmailEnabled: false },
      reviewSettings: { auditHistoryLimit: 100, screeningCheckoutWindowMinutes: 60, extractionCheckoutWindowMinutes: 120 },
      users: structuredClone(users),
      projects: [{
        ...structuredClone(seeds.reviewProjects[0]), id: projectId,
        ownerId: 'owner', ownerIds: ['owner'], memberIds: ['owner', 'peer', 'reviewer'],
        blindMode: true, abstractRequiredVotes: 2, fullTextRequiredVotes: 2,
        exclusionReasons: ['Wrong population'], maybePolicy: 'conflict', requireSequentialPhases: false,
        stage: 'screening', status: 'active', recordsTotal: 2, recordsScreened: 2
      }],
      studies: records, imports: [],
      reports: [{
        id: 'full-text-report', projectId, studyId: 'full-text-paper', title: 'Full-text paper',
        citation: 'Fixture citation', retrievalStatus: 'retrieved', isPdfValidated: false, validationNotes: [], notes: 0
      }],
      decisions: [
        { ...decision('owner-old', 'owner', records[0].id, 'exclude'), isCurrent: false },
        { ...decision('peer-old', 'peer', records[0].id, 'include'), isCurrent: false },
        decision('owner-screening', 'owner', records[0].id, 'include'),
        decision('peer-screening', 'peer', records[0].id, 'exclude'),
        decision('owner-full-text', 'owner', records[1].id, 'include', 'full-text-report'),
        decision('peer-full-text', 'peer', records[1].id, 'exclude', 'full-text-report')
      ],
      extractionTemplates: [], extractionResponses: [], extractionConsensus: [], screeningCheckouts: [],
      dedupCandidates: [{
        ...structuredClone(seeds.dedupCandidates[0]), id: 'pair', projectId,
        recordA: records[0], recordB: records[1], status: 'rejected'
      }],
      events: [
        event('own-vote', 'owner', 'Voted Include'),
        event('peer-vote', 'peer', 'Voted Exclude'),
        event('peer-full-text', 'peer', 'Full-text Exclude', 'full-text-report'),
        event('peer-project-vote', 'peer', 'Voted Include', projectId),
        event('peer-pair-vote', 'peer', 'Voted Exclude', 'pair'),
        event('peer-undo', 'peer', 'Undid latest screening vote'),
        event('peer-reopen', 'peer', 'Returned citation to title/abstract queue'),
        event('peer-full-text-reopen', 'peer', 'Returned report to full-text queue', 'full-text-report'),
        event('peer-advance', 'peer', 'Advanced study to full-text review'),
        event('peer-return', 'peer', 'Returned study to title/abstract screening'),
        event('peer-created-report', 'peer', 'Created full-text report', 'full-text-report'),
        event('peer-resolved', 'peer', 'Resolved full-text conflict', 'full-text-report'),
        event('peer-upload', 'peer', 'Uploaded PDF paper.pdf', 'full-text-report'),
        event('peer-settings', 'peer', 'Updated project settings', projectId)
      ]
    };
  }
  function test(name, run) {
    run();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  }

  test('blind payload protects other reviewers for owner, admin, voting reviewer, and new reviewer', () => {
    for (const user of users) {
      const state = fixture();
      const storedDecisions = structuredClone(state.decisions);
      const storedEvents = structuredClone(state.events);
      const payload = internal.buildPayload(state, user.id);
      assert.deepEqual(payload.decisions, storedDecisions.filter(vote => vote.userId === user.id));
      assert.equal(payload.workflowConflicts.length, 2);
      for (const conflict of payload.workflowConflicts) {
        assert.equal(conflict.label, 'Resolve conflict');
        assert.ok(conflict.decisions.every(vote => vote.userId === user.id));
      }
      assert.equal(payload.studies[0].titleAbstractVoteCount, 2);
      assert.equal(payload.studies[0].titleAbstractStatus, 'conflict');
      assert.equal(payload.reports[0].fullTextVoteCount, 2);
      assert.equal(payload.reports[0].fullTextStatus, 'conflict');
      const visibleEventIds = payload.events.map(entry => entry.id);
      const expectedEventIds = storedEvents.filter(entry =>
        entry.actorId === user.id || ['peer-upload', 'peer-settings'].includes(entry.id)
      ).map(entry => entry.id);
      assert.deepEqual(visibleEventIds, expectedEventIds);
      assert.deepEqual(state.decisions, storedDecisions);
      assert.deepEqual(state.events, storedEvents, 'payload filtering must preserve the complete stored audit');
    }
  });

  test('final full-text outcomes preserve blind PRISMA totals without exposing partial vote reasons', () => {
    const state = fixture();
    for (const user of users) {
      const conflict = internal.buildPayload(state, user.id).reports[0];
      assert.equal(conflict.fullTextExclusionReasonId, undefined, 'conflicting individual reasons stay hidden');
    }
    state.decisions.push(decision('third-full-text', 'reviewer', 'full-text-paper', 'exclude', 'full-text-report'));
    for (const user of users) {
      const payload = internal.buildPayload(state, user.id);
      const report = payload.reports[0];
      assert.equal(report.fullTextStatus, 'excluded_full_text');
      assert.equal(report.fullTextExclusionReasonId, 'Wrong population');
      assert.ok(payload.decisions.every(vote => vote.userId === user.id));
      const counts = selectors.getCountsForProject(payload.projects[0], payload.studies, payload.reports, payload.decisions);
      assert.equal(counts.reportsAssessed, 1);
      assert.equal(counts.reportsExcludedWithReasons['Wrong population'], 1);
    }
    state.decisions = state.decisions.filter(vote => vote.stage !== 'full_text' || vote.userId === 'peer');
    const pending = internal.buildPayload(state, 'admin').reports[0];
    assert.equal(pending.fullTextStatus, 'awaiting_votes');
    assert.equal(pending.fullTextExclusionReasonId, undefined, 'an independent reviewer cannot see a pending vote reason');
  });

  test('nonblind payload retains full decision history, conflict votes, and audit for every role', () => {
    for (const user of users) {
      const state = fixture();
      state.projects[0].blindMode = false;
      const payload = internal.buildPayload(state, user.id);
      assert.deepEqual(payload.decisions, state.decisions);
      assert.deepEqual(payload.events, state.events);
      assert.ok(payload.workflowConflicts.every(conflict => conflict.decisions.length === 2));
    }
  });

  test('legacy audit names cannot reveal historical votes even when names are reused', () => {
    const state = fixture();
    state.events = [
      { ...event('own-legacy', 'owner', 'Voted Include'), actorId: undefined },
      { ...event('peer-legacy', 'peer', 'Voted Exclude'), actorId: undefined },
      { ...event('renamed-own', 'owner', 'Voted Include'), actor: 'Former owner name' },
      { ...event('same-name-other-id', 'peer', 'Voted Exclude'), actor: users[0].name },
      { ...event('actor-name-legacy', 'owner', 'Voted Include'), actor: undefined, actorName: users[0].name, actorId: undefined }
    ];
    assert.deepEqual(internal.buildPayload(state, 'owner').events.map(entry => entry.id), ['renamed-own']);
    state.users.find(user => user.id === 'peer').name = users[0].name;
    assert.deepEqual(internal.buildPayload(state, 'owner').events.map(entry => entry.id), ['renamed-own']);
    state.users.find(user => user.id === 'peer').name = 'A new display name';
    assert.deepEqual(internal.buildPayload(state, 'owner').events.map(entry => entry.id), ['renamed-own']);
    state.projects[0].blindMode = false;
    assert.deepEqual(internal.buildPayload(state, 'owner').events, state.events);
  });

  test('blind filtering is project specific and cannot reveal inaccessible project events', () => {
    const state = fixture();
    const openProject = { ...state.projects[0], id: 'open-project', blindMode: false };
    const privateProject = { ...state.projects[0], id: 'private-project', ownerId: 'peer', ownerIds: ['peer'], memberIds: ['peer'] };
    state.projects.push(openProject, privateProject);
    state.studies.push({ ...study('private-study'), projectId: privateProject.id });
    state.events.push(event('open-project-vote', 'peer', 'Voted Include', openProject.id));
    state.events.push(event('private-study-vote', 'peer', 'Voted Include', 'private-study'));
    const ownerEvents = internal.buildPayload(state, 'owner').events.map(entry => entry.id);
    assert.ok(ownerEvents.includes('open-project-vote'));
    assert.ok(!ownerEvents.includes('private-study-vote'));
    assert.ok(!internal.buildPayload(state, 'admin').events.some(entry => entry.id === 'private-study-vote'));
  });

  function queueFixture() {
    const state = fixture();
    state.studies = [study('conflict-paper'), study('next-paper')];
    state.reports = [];
    state.dedupCandidates = [];
    state.events = [];
    state.decisions = [decision('peer-first', 'peer', 'conflict-paper', 'exclude')];
    internal.useState(state);
    return state;
  }
  const vote = (userId, studyId, decisionValue) => store.addScreeningDecisionForUser(userId, { projectId, studyId, decisionValue });

  test('a vote creating a conflict checks out another available paper and hides the other vote', () => {
    const state = queueFixture();
    const payload = vote('owner', 'conflict-paper', 'include');
    assert.deepEqual(state.screeningCheckouts.filter(checkout => checkout.userId === 'owner').map(checkout => checkout.studyId), ['next-paper']);
    assert.ok(payload.decisions.every(entry => entry.userId === 'owner'));
    assert.equal(payload.workflowConflicts[0].decisions.length, 1);
    assert.equal(state.events.find(entry => entry.action === 'Voted Include').actorId, 'owner');
    assert.equal(payload.studies.find(entry => entry.id === 'conflict-paper').titleAbstractStatus, 'conflict');
    vote('owner', 'next-paper', 'include');
    assert.ok(state.screeningCheckouts.some(checkout => checkout.userId === 'owner' && checkout.studyId === 'conflict-paper'),
      'the conflict remains available after other papers are completed');
  });

  test('another reviewer can settle a deferred conflict before the original voter revisits it', () => {
    const state = queueFixture();
    vote('owner', 'conflict-paper', 'include');
    vote('reviewer', 'conflict-paper', 'exclude');
    const payload = store.getAppStateForUser('owner');
    assert.equal(payload.studies.find(entry => entry.id === 'conflict-paper').titleAbstractStatus, 'excluded_abstract');
    assert.equal(payload.workflowConflicts.length, 0);
    assert.ok(!selectors.getActiveTitleAbstractStudies(state.projects[0], payload.studies, payload.decisions, 'owner').some(entry => entry.id === 'conflict-paper'));
  });

  test('older own conflicts precede a conflict created by the latest vote', () => {
    const state = queueFixture();
    state.studies = [state.studies[0], study('older-conflict')];
    state.decisions.unshift(
      decision('older-own-vote', 'owner', 'older-conflict', 'include'),
      decision('older-peer-vote', 'peer', 'older-conflict', 'exclude')
    );
    vote('owner', 'conflict-paper', 'include');
    assert.ok(state.screeningCheckouts.some(checkout => checkout.userId === 'owner' && checkout.studyId === 'older-conflict'));
  });

  test('a newly conflicted paper remains available when it is the only remaining paper', () => {
    const state = queueFixture();
    state.studies = [state.studies[0]];
    vote('owner', 'conflict-paper', 'include');
    assert.ok(state.screeningCheckouts.some(checkout => checkout.userId === 'owner' && checkout.studyId === 'conflict-paper'));
  });

  test('a prior voter can exclusively reserve a screening conflict and other voters cannot revise it', () => {
    const state = fixture();
    internal.useState(state);
    const acquire = (userId, checkoutId) => store.updateScreeningCheckoutForUser(userId, {
      projectId, studyId: 'screening-paper', stage: 'title_abstract', action: 'acquire', checkoutId
    });
    let payload = acquire('owner', 'original-reservation');
    let record = payload.studies.find(entry => entry.id === 'screening-paper');
    assert.equal(record.titleAbstractCheckedOutByCurrentUser, true);
    assert.equal(record.titleAbstractActiveViewerCount, 1);
    payload = acquire('peer', 'blocked-reservation');
    record = payload.studies.find(entry => entry.id === 'screening-paper');
    assert.equal(record.titleAbstractCheckedOutByCurrentUser, false);
    assert.equal(record.titleAbstractActiveViewerCount, 1);
    assert.ok(!selectors.getActiveTitleAbstractStudies(state.projects[0], payload.studies, payload.decisions, 'peer').some(entry => entry.id === 'screening-paper'));
    const before = structuredClone(state.decisions);
    for (const userId of ['peer', 'reviewer']) {
      assert.throws(() => vote(userId, 'screening-paper', 'exclude'), error => error.status === 409 && /Another reviewer/.test(error.message));
      assert.deepEqual(state.decisions, before, 'rejected conflict revisions must preserve all votes');
    }
    payload = acquire('owner', 'renewed-reservation');
    assert.equal(payload.studies.find(entry => entry.id === 'screening-paper').titleAbstractCheckedOutByCurrentUser, true);
    store.updateScreeningCheckoutForUser('owner', {
      projectId, studyId: 'screening-paper', stage: 'title_abstract', action: 'release', checkoutId: 'original-reservation'
    });
    assert.ok(state.screeningCheckouts.some(checkout => checkout.checkoutId === 'renewed-reservation'), 'late release cannot remove the newer reservation');
    payload = vote('owner', 'screening-paper', 'exclude');
    assert.equal(payload.studies.find(entry => entry.id === 'screening-paper').titleAbstractStatus, 'excluded_abstract');
  });

  test('a prior voter can exclusively reserve a full-text conflict and release it for another reviewer', () => {
    const state = fixture();
    internal.useState(state);
    const checkout = (userId, action, checkoutId) => store.updateScreeningCheckoutForUser(userId, {
      projectId, reportId: 'full-text-report', stage: 'full_text', action, checkoutId
    });
    let payload = checkout('owner', 'acquire', 'full-text-reservation');
    let record = payload.reports.find(entry => entry.id === 'full-text-report');
    assert.equal(record.fullTextCheckedOutByCurrentUser, true);
    assert.equal(record.fullTextActiveViewerCount, 1);
    payload = checkout('peer', 'acquire', 'blocked-full-text-reservation');
    record = payload.reports.find(entry => entry.id === 'full-text-report');
    assert.equal(record.fullTextCheckedOutByCurrentUser, false);
    assert.equal(record.fullTextActiveViewerCount, 1);
    const before = structuredClone(state.decisions);
    for (const userId of ['peer', 'reviewer']) {
      assert.throws(() => store.updateReportForUser(userId, projectId, 'full-text-report', { decisionValue: 'include' }),
        error => error.status === 409 && /Another reviewer/.test(error.message));
      assert.deepEqual(state.decisions, before);
    }
    checkout('owner', 'release', 'full-text-reservation');
    payload = checkout('peer', 'acquire', 'next-full-text-reservation');
    assert.equal(payload.reports.find(entry => entry.id === 'full-text-report').fullTextCheckedOutByCurrentUser, true);
    payload = store.updateReportForUser('peer', projectId, 'full-text-report', { decisionValue: 'include' });
    assert.equal(payload.reports.find(entry => entry.id === 'full-text-report').fullTextStatus, 'advance_extraction');
    assert.equal(state.events.find(entry => entry.action === 'Full-text Include').actorId, 'peer');
  });

  test('expired conflict reservations permit another reviewer to decide', () => {
    const state = fixture();
    state.screeningCheckouts = [{
      projectId, stage: 'title_abstract', studyId: 'screening-paper', userId: 'owner',
      checkoutId: 'expired-reservation', checkedOutAt: stamp, expiresAt: '2020-01-01T00:00:00Z'
    }];
    internal.useState(state);
    const payload = vote('reviewer', 'screening-paper', 'exclude');
    assert.equal(payload.studies.find(entry => entry.id === 'screening-paper').titleAbstractStatus, 'excluded_abstract');
  });

  process.stdout.write(`${passed} blind vote and server queue regression groups passed.\n`);
} finally {
  Module._resolveFilename = originalResolve;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
