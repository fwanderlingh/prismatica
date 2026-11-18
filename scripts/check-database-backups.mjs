import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-backup-check-'));
const originalEnv = { ...process.env };
const originalCwd = process.cwd();
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
let backupRoot;

try {
  const out = path.join(temp, 'out');
  const config = path.join(temp, 'tsconfig.json');
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: 'ES2020', lib: ['dom', 'esnext'], module: 'Node16', moduleResolution: 'Node16', jsx: 'react-jsx', esModuleInterop: true,
    strict: true, skipLibCheck: true, noEmitOnError: true, types: ['node', 'react'],
    typeRoots: [path.join(root, 'node_modules/@types')], rootDir: root, outDir: out,
    paths: { '@/*': [path.join(root, '*')] }
  }, files: [
    'app/api/admin/infrastructure/route.ts', 'app/api/admin/backups/route.ts',
    'app/api/admin/backups/[backupId]/download/route.ts', 'components/review-sections/infrastructure-section.tsx'
  ].map(file => path.join(root, file)) }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith('@/')) name = path.join(out, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
  };
  process.chdir(temp);
  fs.symlinkSync(path.join(root, 'scripts'), path.join(temp, 'scripts'), 'dir');
  Object.assign(process.env, {
    PRISMATICA_STORAGE_MODE: 'file', PRISMATICA_DATA_FILE: path.join(temp, 'state.json'),
    PRISMATICA_ADMIN_EMAIL: 'backup-admin@example.test', PRISMATICA_ADMIN_PASSWORD: 'backup-test-password',
    PRISMATICA_USERS_SYNC_POSTGRES: 'false', PRISMATICA_OBJECT_STORAGE_PROVIDER: 'local'
  });
  const admin = { id: 'admin-root', name: 'Admin', email: process.env.PRISMATICA_ADMIN_EMAIL, isAdmin: true, passwordHash: 'private-hash', passwordSalt: 'private-salt' };
  fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify({
    version: 1, users: [admin, { ...admin, id: 'reviewer', email: 'reviewer@example.test', isAdmin: false }],
    projects: [], studies: [], reports: [], decisions: [], imports: [], events: [], dedupCandidates: []
  }));
  const infrastructure = require(path.join(out, 'lib/infrastructure.js'));
  const backups = require(path.join(out, 'lib/databaseBackup.js'));
  const store = require(path.join(out, 'lib/serverStore.js'));
  backupRoot = infrastructure.databaseBackupDirectory();
  for (const id of ['unknown', 'reviewer']) {
    for (const invoke of [
      () => store.getInfrastructureInfoForAdmin(id), () => store.getDatabaseBackupForAdmin(id),
      () => store.createDatabaseBackupForAdmin(id), () => store.downloadDatabaseBackupForAdmin(id, '../../etc/passwd')
    ]) assert.throws(invoke, error => error.status === (id === 'unknown' ? 401 : 403));
  }
  assert.equal(fs.existsSync(backupRoot), false, 'authorization precedes backup filesystem access');

  let sessionUser = null;
  require(path.join(out, 'lib/serverAuth.js')).getSessionUserId = async () => sessionUser;
  const infoRoute = require(path.join(out, 'app/api/admin/infrastructure/route.js'));
  const jobRoute = require(path.join(out, 'app/api/admin/backups/route.js'));
  const downloadRoute = require(path.join(out, 'app/api/admin/backups/[backupId]/download/route.js'));
  const download = id => downloadRoute.GET(new Request('http://localhost/api/admin/backups/download'), { params: Promise.resolve({ backupId: id }) });
  for (const id of [null, 'reviewer']) {
    sessionUser = id;
    for (const result of [await infoRoute.GET(), await jobRoute.GET(), await jobRoute.POST(), await download('../../etc/passwd')]) {
      assert.equal(result.status, id ? 403 : 401);
    }
  }
  sessionUser = admin.id;
  let response = await infoRoute.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  let info = await response.json();
  assert.equal(info.database.provider, 'json');
  assert.equal(info.database.file, process.env.PRISMATICA_DATA_FILE);
  assert.equal(info.pdfStorage.provider, 'local');
  assert.equal(info.backups.retentionHours, 24);
  assert.equal((await (await jobRoute.GET()).json()).backup, null);

  async function finish(job) {
    const deadline = Date.now() + 10000;
    let current;
    do {
      await new Promise(resolve => setTimeout(resolve, 40));
      current = backups.getLatestDatabaseBackup();
      if (current?.id === job.id && current.status !== 'running') return current;
    } while (Date.now() < deadline);
    throw new Error('Background backup did not complete');
  }
  response = await jobRoute.POST();
  assert.equal(response.status, 202, 'creation returns before the worker finishes');
  const jsonJob = (await response.json()).backup;
  assert.equal(jsonJob.status, 'running');
  assert.equal(backups.startDatabaseBackup(process.env.PRISMATICA_DATA_FILE).id, jsonJob.id, 'repeated creation requests reuse the active job');
  assert.equal((await download(jsonJob.id)).status, 409, 'partial backups cannot be downloaded');
  const ready = await finish(jsonJob);
  assert.equal(ready.status, 'ready', ready.error);
  assert.equal(ready.format, 'json');
  assert.ok(ready.sizeBytes > 0);
  assert.equal(fs.statSync(backupRoot).mode & 0o777, 0o700);
  const jsonDirectory = path.join(backupRoot, ready.id);
  assert.equal(fs.statSync(jsonDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(jsonDirectory, 'database.json')).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(backupRoot, 'running.json')), false, 'completed jobs release the lock');
  assert.equal((await (await jobRoute.GET()).json()).backup.id, ready.id, 'status survives returning to the page');
  response = await download(ready.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-disposition'), /^attachment;/);
  const downloaded = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(downloaded, fs.readFileSync(path.join(jsonDirectory, 'database.json')));
  assert.equal(JSON.parse(downloaded).users[0].passwordHash, 'private-hash', 'the backup includes private persisted records needed for recovery');
  assert.equal(Number(response.headers.get('content-length')), downloaded.length);
  sessionUser = 'reviewer';
  assert.equal((await download(ready.id)).status, 403, 'a known download ID does not bypass admin authorization');
  sessionUser = admin.id;
  assert.equal((await download('../../etc/passwd')).status, 404);
  fs.writeFileSync(path.join(jsonDirectory, 'job.json'), JSON.stringify({ ...ready, expiresAt: new Date(Date.now() - 1).toISOString() }));
  assert.equal(backups.getLatestDatabaseBackup(), null);
  assert.equal(fs.existsSync(jsonDirectory), false, 'expired files are removed');
  assert.equal((await download(ready.id)).status, 404);

  // Fake only external PostgreSQL tools; exercise the real worker and its lifecycle without a database.
  const bin = path.join(temp, 'bin');
  fs.mkdirSync(bin);
  const recordFile = path.join(temp, 'pg-commands.jsonl');
  process.env.PG_TEST_RECORD = recordFile;
  fs.writeFileSync(path.join(bin, 'pg_dump'), `#!${process.execPath}\nconst fs=require('node:fs');\nfs.appendFileSync(process.env.PG_TEST_RECORD,JSON.stringify({command:'pg_dump',args:process.argv.slice(2),database:process.env.PGDATABASE,options:process.env.PGOPTIONS})+'\\n');\nsetTimeout(()=>fs.writeFileSync(process.argv[process.argv.indexOf('--file')+1],'verified-fixture'),150);\n`, { mode: 0o700 });
  fs.writeFileSync(path.join(bin, 'pg_restore'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.PG_TEST_RECORD,JSON.stringify({command:'pg_restore',args:process.argv.slice(2)})+'\\n');\n`, { mode: 0o700 });
  Object.assign(process.env, {
    PATH: bin, PRISMATICA_STORAGE_MODE: 'postgres', DATABASE_URL: 'postgresql://private-user:private-password@db.example.test:5544/reviews',
    PRISMATICA_OBJECT_STORAGE_PROVIDER: 'minio', PRISMATICA_S3_ENDPOINT: 'https://secret-user:secret-password@objects.example.test:9000/?secret=query',
    PRISMATICA_S3_BUCKET: 'review-pdfs', PRISMATICA_S3_REGION: 'test-region', PRISMATICA_S3_ACCESS_KEY: 'private-access-key',
    PRISMATICA_S3_SECRET_KEY: 'private-secret-key', PRISMATICA_PDF_LOCAL_FALLBACK: 'false'
  });
  info = infrastructure.getInfrastructureInfo(process.env.PRISMATICA_DATA_FILE);
  assert.equal(info.database.provider, 'postgres');
  assert.equal(info.database.host, 'db.example.test');
  assert.equal(info.database.port, '5544');
  assert.equal(info.database.name, 'reviews');
  assert.equal(info.database.file, null);
  assert.equal(info.pdfStorage.provider, 'minio');
  assert.equal(info.pdfStorage.endpoint, 'https://objects.example.test:9000');
  assert.equal(info.pdfStorage.bucket, 'review-pdfs');
  assert.equal(info.pdfStorage.localFallback, false);
  assert.doesNotMatch(JSON.stringify(info), /private-|secret-user|secret-password|secret=query/);
  const pgJob = backups.startDatabaseBackup(process.env.PRISMATICA_DATA_FILE);
  assert.equal(backups.startDatabaseBackup(process.env.PRISMATICA_DATA_FILE).id, pgJob.id);
  const pgReady = await finish(pgJob);
  assert.equal(pgReady.status, 'ready', pgReady.error);
  assert.equal(pgReady.format, 'postgres');
  const commands = fs.readFileSync(recordFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(commands.length, 3, 'dump, archive listing, and full decoding all run');
  assert.ok(commands[0].args.includes('--format=custom'));
  assert.equal(commands[0].database, 'reviews');
  assert.match(commands[0].options, /default_transaction_read_only=on/);
  assert.doesNotMatch(JSON.stringify(commands.map(command => command.args)), /private-user|private-password/);
  assert.ok(commands[2].args.includes('--file=/dev/null'), 'verification never restores into a database');

  fs.unlinkSync(path.join(bin, 'pg_dump'));
  const failed = await finish(backups.startDatabaseBackup(process.env.PRISMATICA_DATA_FILE));
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /Install pg_dump and pg_restore/);
  assert.equal(fs.existsSync(path.join(backupRoot, failed.id, 'database.part')), false);
  assert.throws(() => backups.openDatabaseBackup(failed.id), error => error.status === 409);
  assert.equal(fs.existsSync(path.join(backupRoot, 'running.json')), false, 'a failed job allows retry');

  fs.unlinkSync(path.join(temp, 'scripts'));
  const crashed = await finish(backups.startDatabaseBackup(process.env.PRISMATICA_DATA_FILE));
  assert.equal(crashed.status, 'failed', 'an early worker exit is reported without waiting for the stale-job timeout');
  assert.match(crashed.error, /worker could not finish/);
  assert.equal(fs.existsSync(path.join(backupRoot, 'running.json')), false);
  fs.symlinkSync(path.join(root, 'scripts'), path.join(temp, 'scripts'), 'dir');

  // Interrupted jobs cannot leave the button disabled indefinitely.
  const stale = { ...crashed, status: 'running', createdAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() };
  fs.writeFileSync(path.join(backupRoot, stale.id, 'job.json'), JSON.stringify(stale));
  fs.writeFileSync(path.join(backupRoot, 'running.json'), JSON.stringify({ id: stale.id, createdAt: stale.createdAt }));
  assert.equal(backups.getLatestDatabaseBackup().status, 'failed');
  assert.equal(fs.existsSync(path.join(backupRoot, 'running.json')), false);

  // Render both infrastructure modes and backup states with the real components.
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const componentFile = path.join(out, 'components/review-sections/infrastructure-section.js');
  let values = [], cursor = 0;
  Module._load = function(name, parent, ...args) {
    if (name === 'react' && parent?.filename === componentFile) return {
      ...React, useEffect() {}, useState(initial) { return [cursor < values.length ? values[cursor++] : initial, () => {}]; }
    };
    return originalLoad.call(this, name, parent, ...args);
  };
  const ui = require(componentFile);
  function render(component, state) {
    values = state; cursor = 0;
    return renderToStaticMarkup(React.createElement(component));
  }
  let markup = render(ui.DatabaseBackupPanel, [null, false, false, '', 0]);
  assert.match(markup, /Create database backup/);
  assert.doesNotMatch(markup, /Download backup/);
  markup = render(ui.DatabaseBackupPanel, [pgJob, false, false, '', 0]);
  assert.match(markup, /Creating backup/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /leave this page and return/);
  markup = render(ui.DatabaseBackupPanel, [pgReady, false, false, '', 0]);
  assert.match(markup, new RegExp(`/api/admin/backups/${pgReady.id}/download`));
  assert.match(markup, /Available until/);
  markup = render(ui.DatabaseBackupPanel, [failed, false, false, '', 0]);
  assert.match(markup, /Install pg_dump and pg_restore/);
  assert.doesNotMatch(markup, /Download backup|disabled=""/);
  markup = render(ui.InfrastructureSection, [info, '', 0, null, false, false, '', 0]);
  assert.match(markup, /PostgreSQL|db.example.test/);
  assert.match(markup, /MinIO \/ S3-compatible/);
  assert.match(markup, /review-pdfs/);
  assert.doesNotMatch(markup, /private-password|private-access-key|private-secret-key|secret-user|secret-password/);
  process.env.PRISMATICA_STORAGE_MODE = 'file';
  process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER = 'local';
  markup = render(ui.InfrastructureSection, [infrastructure.getInfrastructureInfo(process.env.PRISMATICA_DATA_FILE), '', 0, null, false, false, '', 0]);
  assert.match(markup, /JSON file/);
  assert.match(markup, /Local filesystem/);
  console.log('Backup checks passed: background JSON/PostgreSQL jobs, duplicate requests, private files, verification, streamed downloads, role/session guards, expiry, failures, stale jobs, credential redaction, and rendered admin states.');
} finally {
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  if (backupRoot) fs.rmSync(backupRoot, { recursive: true, force: true });
  fs.rmSync(temp, { recursive: true, force: true });
}
