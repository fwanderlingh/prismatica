import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const Module = require('node:module');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-audit-test-'));
const originalResolve = Module._resolveFilename;
const originalExec = childProcess.execFileSync;
const originalEnv = { ...process.env };
try {
  const out = path.join(temp, 'out');
  const config = path.join(temp, 'tsconfig.json');
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: 'ES2020', module: 'Node16', moduleResolution: 'Node16',
      esModuleInterop: true, skipLibCheck: true, types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')], ignoreDeprecations: '6.0',
      rootDir: root, outDir: out, paths: { '@/*': [path.join(root, '*')] }
    },
    files: [path.join(root, 'lib/serverStore.ts'), path.join(root, 'lib/auditHistory.ts')]
  }));
  originalExec(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  Module._resolveFilename = function (request, parent, ...args) {
    if (request.startsWith('@/')) request = path.join(out, request.slice(2));
    return originalResolve.call(this, request, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
  };
  // No application server, real database, or real state file is used by these checks.
  process.env.PRISMATICA_DATA_FILE = path.join(temp, 'state.json');
  process.env.PRISMATICA_STORAGE_MODE = 'file';
  process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER = 'local';
  process.env.PRISMATICA_ADMIN_EMAIL = 'audit-admin@example.test';
  process.env.PRISMATICA_ADMIN_PASSWORD = 'isolated-audit-test-password';
  const store = require(path.join(out, 'lib/serverStore.js'));
  const seeds = require(path.join(out, 'lib/prismaData.js'));
  const { normalizeAuditHistoryLimit, getProjectAuditEvents } = require(path.join(out, 'lib/auditHistory.js'));
  for (const value of [undefined, null, '', NaN, -1, 0]) assert.equal(normalizeAuditHistoryLimit(value), 100);
  assert.equal(normalizeAuditHistoryLimit(250), 250);
  assert.equal(normalizeAuditHistoryLimit(999999), 10000);
  const admin = { id: 'admin-root', name: 'Audit Admin', email: 'audit-admin@example.test', isAdmin: true, passwordHash: 'test', passwordSalt: 'test', initials: 'AA', organization: 'Test', title: '', timezone: 'UTC', avatarColor: '#000' };
  const reviewer = { ...admin, id: 'audit-reviewer', email: 'reviewer@example.test', isAdmin: false };
  const project = { ...seeds.reviewProjects[0], id: 'audit-project', ownerId: admin.id, ownerIds: [admin.id], memberIds: [reviewer.id] };
  const pair = structuredClone(seeds.dedupCandidates[0]);
  pair.projectId = project.id;
  pair.status = 'pending';
  for (const record of [pair.recordA, pair.recordB]) record.projectId = project.id;
  const event = (index, entity = project.id) => ({ id: `old-${index}`, entity, actor: admin.name, action: 'Existing event', time: new Date(Date.UTC(2020, 0, 1) + index * 1000).toISOString() });
  function fixture(limit, count = 5) {
    return { version: 1, users: [admin, reviewer], projects: [project], studies: [pair.recordA, pair.recordB], imports: [], reports: [], decisions: [], extractionTemplates: [], extractionResponses: [], extractionConsensus: [], screeningCheckouts: [], dedupCandidates: [structuredClone(pair)], checkoutWindowSettings: limit === undefined ? {} : { auditHistoryLimit: limit }, events: Array.from({ length: count }, (_, i) => event(i)).reverse() };
  }
  const writeFixture = state => fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(state));
  writeFixture(fixture(undefined, 130));
  let payload = store.getAppStateForUser(admin.id);
  assert.equal(payload.checkoutWindowSettings.auditHistoryLimit, 100);
  assert.equal(payload.events.length, 100);
  assert.equal(payload.events[0].id, 'old-129');
  assert.throws(() => store.updateCheckoutWindowSettingsForUser(reviewer.id, { auditHistoryLimit: 200 }), /admin/i);
  store.updateCheckoutWindowSettingsForUser(admin.id, { auditHistoryLimit: 7 });
  assert.equal(store.getAppStateForUser(admin.id).checkoutWindowSettings.auditHistoryLimit, 7);
  assert.ok(JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE)).events.length <= 7);

  writeFixture(fixture(150, 130));
  payload = store.updateDedupCandidateForUser(admin.id, pair.id, 'confirmed', pair.recordB.id);
  assert.equal(payload.events[0].action, 'Excluded duplicate citation');
  assert.equal(payload.events.length, 131);
  payload = store.getAppStateForUser(admin.id);
  assert.equal(payload.events[0].entity, pair.id, 'dedup event survives storage normalization');
  const projectEvents = getProjectAuditEvents([...payload.events, event(999, 'other-project')], project.id, payload.studies, payload.reports, payload.dedupCandidates);
  assert.equal(projectEvents[0].entity, pair.id);
  assert.ok(!projectEvents.some(e => e.entity === 'other-project'));
  payload = store.updateDedupCandidateForUser(admin.id, pair.id, 'pending');
  assert.equal(payload.events[0].action, 'Reopened duplicate candidate');
  payload = store.rejectPendingDedupCandidatesForUser(admin.id, project.id);
  assert.match(payload.events[0].action, /Included both citations for 1 duplicate pair/);

  // Capture actual incremental PostgreSQL mutations without invoking a database.
  let dbState = fixture(100);
  let savedMutation;
  childProcess.execFileSync = (_command, args, options) => {
    const action = args[1];
    if (action === 'read') return JSON.stringify(dbState);
    if (action === 'write-dedup-decisions') {
      savedMutation = JSON.parse(options.input);
      return JSON.stringify({ updated: true });
    }
    throw new Error(`Unexpected database operation: ${action}`);
  };
  process.env.PRISMATICA_STORAGE_MODE = 'postgres';
  for (const status of ['confirmed', 'rejected', 'pending']) {
    store.updateDedupCandidateForUser(admin.id, pair.id, status);
    assert.equal(savedMutation.event.entity, pair.id);
    assert.ok(!savedMutation.event.id.startsWith('old-'), 'persist the new event, not the oldest');
  }
  store.rejectPendingDedupCandidatesForUser(admin.id, project.id);
  assert.equal(savedMutation.event.entity, project.id);
  assert.match(savedMutation.event.action, /Included both citations/);

  // Exercise the SQL append/prune path with an isolated client double.
  const pgSource = fs.readFileSync(path.join(root, 'scripts/postgres-state-io.mjs'), 'utf8');
  const helpers = pgSource.slice(pgSource.indexOf('function normalizeAuditHistoryLimit('), pgSource.indexOf('async function writeImportStudyMutation('));
  const context = {};
  vm.runInNewContext(helpers + '\nthis.append = appendWorkflowEvent;', context);
  for (const limit of [undefined, 3, 200]) {
    const queries = [];
    await context.append({ query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: sql.startsWith('SELECT audit_history_limit') ? [{ audit_history_limit: limit }] : [] };
    } }, event(999));
    assert.match(queries[0].sql, /LOCK TABLE/);
    assert.match(queries[1].sql, /MIN\(position\)/);
    assert.match(queries[3].sql, /ORDER BY payload->>'time' DESC/);
    assert.equal(queries[3].params[0], limit ?? 100);
  }
  console.log('Audit checks passed: default/custom retention, admin-only settings, dedup decisions and reload, project isolation, new PostgreSQL events, append ordering and pruning.');
} finally {
  Module._resolveFilename = originalResolve;
  childProcess.execFileSync = originalExec;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
