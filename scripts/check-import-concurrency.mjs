import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-import-concurrency-'));
const originalResolve = Module._resolveFilename;
const originalExec = childProcess.execFileSync;
const originalEnv = { ...process.env };
let remotePdf;
let originalFetchPublicPdf;
let databaseBin;
let databaseStarted = false;
let databaseClient;

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
  originalExec(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  Module._resolveFilename = function (request, parent, ...args) {
    if (request.startsWith('@/')) request = path.join(out, request.slice(2));
    return originalResolve.call(this, request, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
  };
  // All state, account credentials, PDFs, and database responses are isolated.
  process.env.PRISMATICA_DATA_FILE = path.join(temp, 'state.json');
  process.env.PRISMATICA_STORAGE_MODE = 'file';
  process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER = 'local';
  process.env.PRISMATICA_ADMIN_EMAIL = 'import-admin@example.test';
  process.env.PRISMATICA_ADMIN_PASSWORD = 'isolated-import-admin-password';
  const store = require(path.join(out, 'lib/serverStore.js'));
  remotePdf = require(path.join(out, 'lib/remotePdf.js'));
  originalFetchPublicPdf = remotePdf.fetchPublicPdf;
  const seeds = require(path.join(out, 'lib/prismaData.js'));
  const password = 'isolated-old-reviewer-password';
  const passwordSalt = 'isolated-reviewer-salt';
  const admin = {
    id: 'admin-root', name: 'Import Admin', email: 'import-admin@example.test', isAdmin: true,
    passwordHash: crypto.scryptSync(password, passwordSalt, 64).toString('hex'), passwordSalt,
    initials: 'IA', organization: 'Test', title: 'Reviewer', timezone: 'UTC', avatarColor: '#000'
  };
  const reviewer = { ...admin, id: 'import-reviewer', name: 'Import Reviewer', email: 'import-reviewer@example.test', isAdmin: false, emailAuth: { sessionVersion: 'old-session' } };
  const project = {
    ...seeds.reviewProjects[0], id: 'import-project', title: 'Original review', ownerId: admin.id,
    ownerIds: [admin.id], memberIds: [reviewer.id], recordsTotal: 0, stage: 'setup', blindMode: false
  };
  const citation = (key, title = 'Distinct concurrency citation', extra = '') => `@article{${key}, title={${title}}, author={Researcher, Example}, year={2024}, ${extra}}`;
  const input = (filename, content = citation(filename)) => ({ format: 'bib', filename, content });
  const fixture = () => ({
    version: 1, users: structuredClone([admin, reviewer]), projects: structuredClone([project]),
    authSettings: { registrationEnabled: true, transactionalEmailEnabled: false }, reviewSettings: {},
    studies: [], reports: [], imports: [], decisions: [], extractionTemplates: [], extractionResponses: [],
    extractionConsensus: [], screeningCheckouts: [], dedupCandidates: [], events: []
  });
  const read = () => JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, 'utf8'));
  const write = state => fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(state));
  const reset = () => write(fixture());

  // Pause at the last awaited callback: the final save must read after it.
  reset();
  let latestUser;
  let resetPassword;
  const stages = [];
  const saved = await store.createImportBatchForUser(reviewer.id, project.id, input('password-race.bib'), async step => {
    stages.push(step.label);
    await Promise.resolve();
    if (step.label === 'Saving import') {
      resetPassword = store.adminResetPasswordForUser(admin.id, reviewer.id).temporaryPassword;
      const concurrent = read();
      latestUser = structuredClone(concurrent.users.find(user => user.id === reviewer.id));
      concurrent.authSettings.registrationEnabled = false;
      concurrent.reviewSettings.auditHistoryLimit = 37;
      concurrent.projects[0].title = 'Concurrent review edit';
      concurrent.projects[0].description = 'Preserve this project edit';
      concurrent.projects.push({ ...structuredClone(project), id: 'concurrent-project', title: 'New concurrent review' });
      concurrent.studies.push({ ...seeds.screeningStudies[0], id: 'other-study', projectId: 'concurrent-project', stage: 'title_abstract' });
      concurrent.decisions.push({ id: 'concurrent-decision', projectId: 'concurrent-project', studyId: 'other-study', userId: admin.id, userName: admin.name, stage: 'title_abstract', decisionValue: 'include', isCurrent: true, createdAt: new Date().toISOString() });
      concurrent.events.unshift({ id: 'concurrent-event', entity: 'concurrent-project', actor: admin.name, action: 'Concurrent project edit', time: new Date().toISOString() });
      write(concurrent);
    }
    if (step.label === 'Preparing updated review') {
      assert.ok(read().imports.some(batch => batch.filename === 'password-race.bib'), 'saved progress follows persistence');
    }
  });
  let persisted = read();
  assert.deepEqual(persisted.users.find(user => user.id === reviewer.id), latestUser, 'an import must preserve the concurrent password reset and session revocation');
  assert.notEqual(latestUser.emailAuth.sessionVersion, 'old-session');
  assert.throws(() => store.loginUser(reviewer.email, password), /incorrect/i, 'the old password remains invalid');
  assert.equal(store.loginUser(reviewer.email, resetPassword).currentUser.id, reviewer.id);
  assert.equal(persisted.authSettings.registrationEnabled, false);
  assert.equal(persisted.reviewSettings.auditHistoryLimit, 37);
  assert.equal(persisted.projects.find(item => item.id === project.id).title, 'Concurrent review edit');
  assert.equal(persisted.projects.find(item => item.id === project.id).description, 'Preserve this project edit');
  assert.ok(persisted.projects.some(item => item.id === 'concurrent-project'));
  assert.ok(persisted.studies.some(item => item.id === 'other-study'));
  assert.ok(persisted.decisions.some(item => item.id === 'concurrent-decision'));
  assert.ok(persisted.events.some(item => item.id === 'concurrent-event'));
  assert.ok(saved.imports.some(batch => batch.filename === 'password-race.bib'));
  assert.deepEqual(stages, ['Loading review data', 'Parsing citations', 'Preparing citations', 'Checking duplicate candidates', 'Saving import', 'Preparing updated review']);

  // A second import completes while the first is suspended. Both its records and
  // any duplicate resolution made in the meantime must survive the first save.
  reset();
  await store.createImportBatchForUser(reviewer.id, project.id, input('existing.bib', citation('existing', 'Duplicate record', 'doi={10.1000/shared}')));
  let releaseFirst;
  let reachedSave;
  const paused = new Promise(resolve => { reachedSave = resolve; });
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  const first = store.createImportBatchForUser(reviewer.id, project.id, input('first.bib', citation('first', 'Duplicate record', 'doi={10.1000/shared}')), async step => {
    if (step.label === 'Saving import') { reachedSave(); await gate; }
  });
  await paused;
  try {
    await store.createImportBatchForUser(reviewer.id, project.id, input('second.bib', citation('second', 'Duplicate record', 'doi={10.1000/shared}')));
    const candidate = read().dedupCandidates[0];
    assert.ok(candidate, 'the completed concurrent import creates a duplicate candidate');
    store.updateDedupCandidateForUser(admin.id, candidate.id, 'rejected');
    releaseFirst();
    await first;
    persisted = read();
    assert.deepEqual(persisted.imports.map(batch => batch.filename).sort(), ['existing.bib', 'first.bib', 'second.bib']);
    assert.equal(persisted.studies.length, 3);
    assert.equal(new Set(persisted.studies.map(study => study.importItemId)).size, 3, 'overlapping imports allocate unique project item IDs');
    assert.deepEqual(persisted.studies.map(study => study.importItemId).sort((a, b) => a - b), [1, 2, 3]);
    assert.equal(persisted.dedupCandidates.length, 3, 'deduplication includes pairs across the two imports');
    assert.equal(persisted.dedupCandidates.find(item => item.id === candidate.id).status, 'rejected', 'the concurrent duplicate resolution is preserved');
  } finally {
    releaseFirst();
    await first.catch(() => undefined);
  }

  for (const mutation of ['project deleted', 'membership removed', 'user deleted']) {
    reset();
    await assert.rejects(store.createImportBatchForUser(reviewer.id, project.id, input('revoked.bib'), step => {
      if (step.label !== 'Saving import') return;
      const concurrent = read();
      if (mutation === 'project deleted') concurrent.projects = [];
      if (mutation === 'membership removed') concurrent.projects[0].memberIds = [];
      if (mutation === 'user deleted') concurrent.users = concurrent.users.filter(user => user.id !== reviewer.id);
      write(concurrent);
    }), error => [401, 403, 404].includes(error.status), `${mutation} before saving must reject the import`);
    persisted = read();
    assert.equal(persisted.imports.length, 0, `${mutation} must not persist the import`);
    assert.equal(persisted.studies.length, 0);
    if (mutation === 'project deleted') assert.equal(persisted.projects.length, 0, 'do not resurrect a deleted project');
    if (mutation === 'user deleted') assert.ok(!persisted.users.some(user => user.id === reviewer.id), 'do not resurrect a deleted account');
  }

  // Linked PDFs are prepared on an isolated draft and included in the final merge.
  reset();
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
  remotePdf.fetchPublicPdf = async () => ({ buffer: pdf, contentDisposition: '' });
  const pdfPayload = await store.createImportBatchForUser(reviewer.id, project.id,
    input('linked.bib', citation('linked', 'Linked PDF citation', 'pdf={https://example.test/linked.pdf}')), step => {
      if (step.label === 'Saving import') store.adminResetPasswordForUser(admin.id, reviewer.id);
    });
  persisted = read();
  const batch = persisted.imports.find(item => item.filename === 'linked.bib');
  const report = persisted.reports.find(item => item.studyId === persisted.studies[0].id);
  assert.equal(batch.pdfsRetrieved, 1);
  assert.equal(batch.pdfRetrievalFailures, 0);
  assert.equal(report.retrievalStatus, 'retrieved');
  assert.equal(report.isPdfValidated, true);
  assert.deepEqual(fs.readFileSync(report.storagePath), pdf);
  assert.match(pdfPayload.message, /1 of 1 linked PDFs retrieved/);
  remotePdf.fetchPublicPdf = originalFetchPublicPdf;

  // PostgreSQL uses the incremental mutation, retries a conflicting project
  // snapshot, and never passes account credentials to a full-state replacement.
  let dbState = fixture();
  let revision = 1;
  let mutationAttempts = 0;
  let savedMutation;
  const operations = [];
  childProcess.execFileSync = (_file, args, options) => {
    const action = args[1];
    operations.push(action);
    if (action === 'read') return JSON.stringify(dbState);
    if (action === 'read-import-state') return JSON.stringify({ state: dbState, revision: String(revision) });
    if (action === 'write-import-batch') {
      const mutation = JSON.parse(options.input);
      assert.ok(!('users' in mutation));
      assert.ok(!('authSettings' in mutation));
      assert.ok(!('reviewSettings' in mutation));
      mutationAttempts += 1;
      if (mutationAttempts === 1) {
        dbState.projects[0].title = 'Concurrent PostgreSQL edit';
        dbState.studies.unshift({
          ...seeds.screeningStudies[0], id: 'concurrent-pg-study', projectId: project.id,
          importItemId: 1, stage: 'title_abstract', title: 'Distinct concurrent PostgreSQL study'
        });
        dbState.projects[0].recordsTotal = 1;
        revision += 1;
        return JSON.stringify({ updated: false });
      }
      assert.equal(mutation.revision, String(revision), 'retry must use the fresh project snapshot');
      savedMutation = mutation;
      // A password reset between reading and committing must also survive:
      // this intentionally does not alter the project revision.
      dbState.users[1].passwordHash = 'new-postgres-password-hash';
      dbState.users[1].emailAuth.sessionVersion = 'new-postgres-session';
      dbState.projects = dbState.projects.map(item => item.id === project.id ? mutation.project : item);
      dbState.imports.unshift(mutation.batch);
      dbState.studies.unshift(...mutation.studies);
      dbState.reports.unshift(...mutation.reports);
      dbState.dedupCandidates = mutation.dedupCandidates;
      dbState.events.unshift(mutation.event);
      return JSON.stringify({ updated: true });
    }
    throw new Error(`Unexpected database operation: ${action}`);
  };
  process.env.PRISMATICA_STORAGE_MODE = 'postgres';
  const pgPayload = await store.createImportBatchForUser(reviewer.id, project.id, input('pg-race.bib'));
  assert.equal(mutationAttempts, 2, 'a concurrent project change retries the incremental import');
  assert.ok(savedMutation);
  assert.equal(savedMutation.project.title, 'Concurrent PostgreSQL edit');
  assert.equal(savedMutation.studies.length, 1, 'the mutation includes only this import’s studies');
  assert.equal(savedMutation.studies[0].importItemId, 2);
  assert.ok(!operations.includes('write'), 'an import must never issue a full PostgreSQL state write');
  assert.equal(dbState.users[1].passwordHash, 'new-postgres-password-hash');
  assert.equal(dbState.users[1].emailAuth.sessionVersion, 'new-postgres-session');
  assert.equal(dbState.studies.length, 2);
  assert.ok(pgPayload.imports.some(item => item.filename === 'pg-race.bib'));
  childProcess.execFileSync = originalExec;

  // Execute the actual bridge helper with a client double, including its SQL
  // transaction and access checks, rather than testing a copied implementation.
  const pgSource = fs.readFileSync(path.join(root, 'scripts/postgres-state-io.mjs'), 'utf8');
  const context = {};
  vm.runInNewContext(pgSource.slice(0, pgSource.indexOf('run().catch')).replace('import { Client } from "pg";', '') +
    '\nthis.writeImport = writeImportBatchMutation;', context);
  async function exerciseBridge({ actor = reviewer, currentProject = project, currentRevision = savedMutation.revision, locked = false } = {}) {
    const queries = [];
    const result = await context.writeImport({ query: async (sql, params) => {
      queries.push({ sql, params });
      if (locked && sql.startsWith('LOCK TABLE app_users')) throw Object.assign(new Error('Lock conflict'), { code: '55P03' });
      if (sql.startsWith('SELECT id, is_admin FROM app_users')) return { rows: actor ? [{ id: actor.id, is_admin: actor.isAdmin }] : [] };
      if (sql.includes('FROM review_projects') && sql.includes('ORDER BY position ASC')) return {
        rows: currentProject ? [{ id: currentProject.id, payload: currentProject }] : []
      };
      if (sql.startsWith('SELECT md5(')) return { rows: [{ revision: currentRevision }] };
      if (/AS position FROM/.test(sql)) return { rows: [{ position: 0 }] };
      if (sql.startsWith('SELECT audit_history_limit')) return { rows: [{ audit_history_limit: 100 }] };
      return { rows: [], rowCount: 1 };
    } }, savedMutation);
    return { result, queries };
  }
  let bridge = await exerciseBridge();
  assert.equal(bridge.result.updated, true);
  assert.equal(bridge.queries[0].sql, 'BEGIN');
  assert.equal(bridge.queries.at(-1).sql, 'COMMIT');
  const mutatingQueries = bridge.queries.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql));
  assert.ok(mutatingQueries.some(({ sql }) => /INSERT INTO import_batches/.test(sql)));
  assert.ok(mutatingQueries.some(({ sql }) => /INSERT INTO review_studies/.test(sql)));
  assert.ok(mutatingQueries.every(({ sql }) => !/\b(app_users|auth_settings|review_settings)\b/i.test(sql)), 'incremental import SQL must not write account or application settings tables');
  assert.ok(bridge.queries.every(({ sql }) => !/\bTRUNCATE\b/.test(sql)));
  for (const scenario of [
    { currentRevision: 'changed-project-revision' },
    { actor: null, status: 401 },
    { currentProject: null, status: 403 },
    { currentProject: { ...project, memberIds: [] }, status: 403 },
    { locked: true }
  ]) {
    bridge = await exerciseBridge(scenario);
    assert.equal(bridge.result.updated, false);
    assert.equal(bridge.result.status, scenario.status);
    assert.equal(bridge.queries.at(-1).sql, 'ROLLBACK');
    assert.ok(bridge.queries.every(({ sql }) => !/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql)), 'a rejected import cannot mutate review data');
  }

  // --postgres also exercises a disposable PostgreSQL cluster. It listens only
  // on its temporary Unix socket, never a TCP port or an existing database.
  if (process.argv.includes('--postgres')) {
    databaseBin = originalExec('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
    originalExec(path.join(databaseBin, 'initdb'), ['-D', path.join(temp, 'db'), '-A', 'trust', '-U', 'import-test', '--no-locale'], { stdio: 'pipe' });
    originalExec(path.join(databaseBin, 'pg_ctl'), ['-D', path.join(temp, 'db'), '-l', path.join(temp, 'postgres.log'), '-o', `-k ${temp} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
    databaseStarted = true;
    process.env.DATABASE_URL = `postgresql://import-test@localhost/postgres?host=${encodeURIComponent(temp)}`;
    const { Client } = require('pg');
    databaseClient = new Client({ connectionString: process.env.DATABASE_URL });
    await databaseClient.connect();
    await databaseClient.query(fs.readFileSync(path.join(root, 'db/users_preferences.sql'), 'utf8'));
    const invokeBridge = (action, state) => JSON.parse(originalExec(process.execPath, [path.join(root, 'scripts/postgres-state-io.mjs'), action], {
      cwd: root, env: process.env, input: state === undefined ? undefined : JSON.stringify(state), encoding: 'utf8'
    }).trim() || 'null');
    invokeBridge('write', fixture());
    let realAttempts = 0;
    let resetInPostgres;
    childProcess.execFileSync = (file, args, options) => {
      if (args[1] === 'write-import-batch' && realAttempts++ === 0) {
        const concurrent = invokeBridge('read');
        concurrent.projects[0].title = 'Real PostgreSQL concurrent edit';
        concurrent.projects[0].recordsTotal = 1;
        concurrent.studies.push({ ...seeds.screeningStudies[0], id: 'real-concurrent-study', projectId: project.id, importItemId: 1, stage: 'title_abstract' });
        invokeBridge('write', concurrent);
      }
      return originalExec(file, args, options);
    };
    await store.createImportBatchForUser(reviewer.id, project.id, input('real-postgres.bib'), step => {
      if (step.label === 'Saving import') resetInPostgres = store.adminResetPasswordForUser(admin.id, reviewer.id).temporaryPassword;
    });
    childProcess.execFileSync = originalExec;
    assert.equal(realAttempts, 2, 'real PostgreSQL rejects the stale revision and accepts a fresh retry');
    const realState = invokeBridge('read');
    assert.equal(realState.projects[0].title, 'Real PostgreSQL concurrent edit');
    assert.equal(realState.studies.length, 2);
    assert.equal(new Set(realState.studies.map(study => study.importItemId)).size, 2);
    assert.ok(realState.imports.some(item => item.filename === 'real-postgres.bib'));
    assert.notEqual(realState.users.find(user => user.id === reviewer.id).emailAuth.sessionVersion, 'old-session');
    assert.throws(() => store.loginUser(reviewer.email, password), /incorrect/i);
    assert.equal(store.loginUser(reviewer.email, resetInPostgres).currentUser.id, reviewer.id);
    await store.createImportBatchForUser(reviewer.id, project.id, input('newest-postgres.bib', `${citation('newest-a', 'Newest first citation')}\n${citation('newest-b', 'Newest second citation')}`));
    const beforeEdit = invokeBridge('read');
    const newestStudy = beforeEdit.studies[0];
    const batchOrder = beforeEdit.imports.map(item => item.id);
    const studyOrder = beforeEdit.studies.map(item => item.id);
    store.updateImportStudyForUser(reviewer.id, project.id, newestStudy.importBatchId, newestStudy.id, { title: 'Edited newest citation', year: 2024 });
    const afterEdit = invokeBridge('read');
    assert.deepEqual(afterEdit.imports.map(item => item.id), batchOrder, 'editing a prepended batch must preserve persisted batch order');
    assert.deepEqual(afterEdit.studies.map(item => item.id), studyOrder, 'editing a prepended study must preserve persisted citation order');
    assert.equal(afterEdit.studies[0].title, 'Edited newest citation');
    console.log('Disposable PostgreSQL checks passed: real revision conflict, retry, concurrent project changes, password reset, session revocation, and stable import/edit ordering.');
  }
  console.log('Import concurrency checks passed: password/session preservation, unrelated changes, overlapping imports, item IDs, dedup resolution, revoked access, PDFs, and incremental PostgreSQL persistence.');
} finally {
  Module._resolveFilename = originalResolve;
  childProcess.execFileSync = originalExec;
  if (remotePdf) remotePdf.fetchPublicPdf = originalFetchPublicPdf;
  if (databaseClient) await databaseClient.end();
  if (databaseStarted) originalExec(path.join(databaseBin, 'pg_ctl'), ['-D', path.join(temp, 'db'), '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
