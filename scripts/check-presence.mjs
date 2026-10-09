import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Isolated PostgreSQL cluster: this never connects to the application's database.
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-presence-'));
const database = path.join(temp, 'database');
const originalUrl = process.env.DATABASE_URL;
let started = false;
let pool;
try {
  execFileSync(path.join(bin, 'initdb'), ['-D', database, '-A', 'trust', '-U', 'presence-test', '--no-locale'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', database, '-l', path.join(temp, 'postgres.log'), '-o', `-k ${temp} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  process.env.DATABASE_URL = `postgresql://presence-test@localhost/postgres?host=${encodeURIComponent(temp)}`;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('CREATE TABLE app_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, is_admin BOOLEAN NOT NULL)');
  await pool.query("INSERT INTO app_users VALUES ('admin', 'Admin', 'admin@example.test', TRUE), ('reviewer', 'Reviewer', 'reviewer@example.test', FALSE), ('other', 'Other', 'other@example.test', FALSE)");
  const out = path.join(temp, 'out');
  const config = path.join(temp, 'tsconfig.json');
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: { target: 'ES2020', module: 'Node16', moduleResolution: 'Node16', esModuleInterop: true, skipLibCheck: true, types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')], ignoreDeprecations: '6.0', rootDir: root, outDir: out },
    files: [path.join(root, 'lib/userPresence.ts')]
  }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  const Module = require('node:module');
  const originalResolve = Module._resolveFilename;
  let presence;
  try {
    Module._resolveFilename = function (request, parent, ...args) {
      return originalResolve.call(this, request, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
    };
    presence = require(path.join(out, 'lib/userPresence.js'));
  } finally { Module._resolveFilename = originalResolve; }

  assert.equal(presence.presenceWindowSeconds, 300);
  assert.equal(await presence.getConnectedUsersForAdmin('reviewer'), null);
  assert.equal(await presence.getConnectedUsersForAdmin('missing'), null);
  assert.deepEqual((await presence.getConnectedUsersForAdmin('admin')).users, []);
  assert.equal(await presence.recordUserPresence('missing', 'unknown-session'), false);
  await presence.recordUserPresence('reviewer', 'browser-one');
  await presence.recordUserPresence('reviewer', 'browser-one');
  await presence.recordUserPresence('reviewer', 'browser-two');
  await presence.recordUserPresence('admin', 'admin-browser');
  let snapshot = await presence.getConnectedUsersForAdmin('admin');
  assert.equal(snapshot.users.length, 2);
  assert.equal(snapshot.users.find(user => user.id === 'reviewer').sessions, 2, 'repeat heartbeats and tabs do not duplicate a browser session');
  assert.equal(snapshot.users.find(user => user.id === 'reviewer').email, 'reviewer@example.test');
  assert.ok(Number.isFinite(Date.parse(snapshot.checkedAt)));

  await pool.query("UPDATE website_user_presence SET last_seen_at = NOW() - INTERVAL '301 seconds' WHERE session_key = 'browser-one'");
  await pool.query("UPDATE website_user_presence SET last_seen_at = NOW() - INTERVAL '299 seconds' WHERE session_key = 'browser-two'");
  snapshot = await presence.getConnectedUsersForAdmin('admin');
  assert.equal(snapshot.users.find(user => user.id === 'reviewer').sessions, 1, 'five-minute expiry applies at query time');
  await presence.recordUserPresence('other', 'other-browser');
  assert.equal((await pool.query("SELECT * FROM website_user_presence WHERE session_key = 'browser-one'")).rows.length, 0, 'old presence records are pruned');
  await presence.clearUserPresence('browser-two');
  snapshot = await presence.getConnectedUsersForAdmin('admin');
  assert.equal(snapshot.users.some(user => user.id === 'reviewer'), false);
  assert.equal(snapshot.users.some(user => user.id === 'other'), true, 'logout does not remove other sessions');
  await pool.query("DELETE FROM app_users WHERE id = 'other'");
  assert.equal((await presence.getConnectedUsersForAdmin('admin')).users.some(user => user.id === 'other'), false);
  console.log('Presence checks passed: admin access, session deduplication, expiry, cleanup, logout, and deleted users.');
} finally {
  await pool?.end();
  await globalThis.__prismaticaPresencePool?.end();
  delete globalThis.__prismaticaPresencePool;
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', database, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
  fs.rmSync(temp, { recursive: true, force: true });
}
