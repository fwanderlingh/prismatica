import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-maintenance-'));
const originalEnv = { ...process.env };
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const cookieJar = new Map();
let databaseStarted = false;
let bin;
let database;

try {
  const out = path.join(temp, 'out');
  const config = path.join(temp, 'tsconfig.json');
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: 'ES2020', lib: ['esnext', 'dom'], module: 'Node16', moduleResolution: 'Node16', jsx: 'react-jsx', esModuleInterop: true,
      skipLibCheck: true, types: ['node', 'react'], typeRoots: [path.join(root, 'node_modules/@types')],
      rootDir: root, outDir: out, paths: { '@/*': [path.join(root, '*')] }
    },
    files: ['proxy.ts', 'app/api/admin/maintenance/route.ts', 'app/api/maintenance/route.ts',
      'app/api/auth/login/route.ts', 'app/api/auth/config/route.ts',
      'components/maintenance-page.tsx', 'components/review-sections/maintenance-section.tsx']
      .map(file => path.join(root, file))
  }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  Module._resolveFilename = function (request, parent, ...args) {
    if (request.startsWith('@/')) request = path.join(out, request.slice(2));
    return originalResolve.call(this, request, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
  };
  Module._load = function (request, ...args) {
    if (request === 'next/headers') return { cookies: async () => ({
      get: name => cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined,
      set: (name, value) => cookieJar.set(name, value)
    }) };
    return originalLoad.call(this, request, ...args);
  };
  Object.assign(process.env, {
    PRISMATICA_STORAGE_MODE: 'file', PRISMATICA_DATA_FILE: path.join(temp, 'state.json'),
    PRISMATICA_OBJECT_STORAGE_PROVIDER: 'local', PRISMATICA_USERS_SYNC_POSTGRES: 'false',
    PRISMATICA_SESSION_SECRET: 'isolated-maintenance-session-secret',
    PRISMATICA_ADMIN_EMAIL: 'admin@example.test', PRISMATICA_ADMIN_PASSWORD: 'isolated-admin-password'
  });

  const store = require(path.join(out, 'lib/serverStore.js'));
  const maintenance = require(path.join(out, 'lib/serverMaintenance.js'));
  const { formatMaintenanceEnd } = require(path.join(out, 'lib/maintenance.js'));
  const auth = require(path.join(out, 'lib/serverAuth.js'));
  const { proxy } = require(path.join(out, 'proxy.js'));
  const { NextRequest } = require('next/server');
  const adminRoute = require(path.join(out, 'app/api/admin/maintenance/route.js'));
  const publicRoute = require(path.join(out, 'app/api/maintenance/route.js'));
  const loginRoute = require(path.join(out, 'app/api/auth/login/route.js'));
  const authConfig = require(path.join(out, 'app/api/auth/config/route.js'));

  store.getPublicAuthConfig();
  store.getAppStateForUser('admin-root');
  const state = JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, 'utf8'));
  const password = 'isolated-reviewer-password';
  const reviewer = {
    ...state.users[0], id: 'reviewer', name: 'Reviewer', email: 'reviewer@example.test', isAdmin: false,
    passwordSalt: 'isolated-reviewer-salt',
    passwordHash: crypto.scryptSync(password, 'isolated-reviewer-salt', 64).toString('hex')
  };
  state.users.push(reviewer);
  fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(state));

  function token(userId, overrides = {}) {
    const body = Buffer.from(JSON.stringify({ userId, expiresAt: Date.now() + 60_000, ...overrides })).toString('base64url');
    return `${body}.${crypto.createHmac('sha256', process.env.PRISMATICA_SESSION_SECRET).update(body).digest('base64url')}`;
  }
  const adminToken = token('admin-root');
  const reviewerToken = token(reviewer.id);
  function request(route, { method = 'GET', session, body, origin = 'https://example.test' } = {}) {
    const headers = new Headers({ origin });
    if (session) headers.set('cookie', `prismatica_session=${session}`);
    if (body) headers.set('content-type', 'application/json');
    return new NextRequest(`https://example.test${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  const future = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  assert.match(formatMaintenanceEnd('2026-12-01T23:30:00Z', 'Europe/Rome'), /2 December 2026/, 'return dates respect the visitor timezone across midnight');
  assert.deepEqual(await maintenance.getMaintenanceSettings(), { enabled: false, endsAt: null });
  assert.equal((await proxy(request('/dashboard'))).headers.get('x-middleware-next'), '1');
  assert.equal((await adminRoute.GET()).status, 401);
  cookieJar.set('prismatica_session', reviewerToken);
  assert.equal((await adminRoute.GET()).status, 403);
  assert.equal((await adminRoute.PATCH(request('/api/admin/maintenance', { method: 'PATCH', body: { enabled: true, endsAt: future } }))).status, 403);
  await assert.rejects(maintenance.updateMaintenanceSettingsForAdmin('missing', { enabled: false }), error => error.status === 401);
  for (const enabled of [undefined, null, 'true', 1, {}]) {
    await assert.rejects(maintenance.updateMaintenanceSettingsForAdmin('admin-root', { enabled, endsAt: future }), /true or false/);
  }
  for (const endsAt of [undefined, '', 'invalid', '2020-01-01T00:00:00Z', future.slice(0, -1)]) {
    await assert.rejects(maintenance.updateMaintenanceSettingsForAdmin('admin-root', { enabled: true, endsAt }), /date|timezone/);
  }

  cookieJar.set('prismatica_session', adminToken);
  let response = await adminRoute.PATCH(request('/api/admin/maintenance', { method: 'PATCH', body: { enabled: true, endsAt: future } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, endsAt: future });
  assert.equal(JSON.parse(fs.readFileSync(`${process.env.PRISMATICA_DATA_FILE}.maintenance.json`, 'utf8')).enabled, true);
  assert.equal((await authConfig.GET()).status, 200);
  const configPayload = await (await authConfig.GET()).json();
  assert.equal(configPayload.maintenanceEnabled, true);
  assert.equal(configPayload.authSettings.registrationEnabled, false);
  for (const session of [undefined, reviewerToken, `${adminToken}broken`, token('admin-root', { expiresAt: 1 }), token('admin-root', { version: 'revoked' }), token('deleted-user')]) {
    for (const route of ['/', '/dashboard', '/admin/maintenance', '/projects/new', '/projects/example/full-text', '/account/forgot-password', '/about']) {
      response = await proxy(request(route, { session }));
      assert.equal(response.status, 307, `${route} must redirect without an authenticated administrator`);
      assert.equal(response.headers.get('location'), 'https://example.test/maintenance');
      assert.match(response.headers.get('cache-control'), /no-store/);
    }
    for (const [route, method] of [['/api/app-state', 'GET'], ['/api/projects', 'POST'], ['/api/auth/register', 'POST'], ['/api/admin/maintenance', 'PATCH']]) {
      response = await proxy(request(route, { session, method }));
      assert.equal(response.status, 503, `${method} ${route} must be blocked`);
      assert.equal((await response.json()).maintenance, true);
      assert.ok(Number(response.headers.get('retry-after')) > 0);
    }
  }
  for (const route of ['/dashboard', '/admin/maintenance', '/api/app-state', '/api/admin/maintenance']) {
    assert.equal((await proxy(request(route, { session: adminToken }))).headers.get('x-middleware-next'), '1');
  }
  for (const route of ['/maintenance', '/sign-in', '/api/auth/config', '/api/auth/login', '/api/auth/logout', '/api/maintenance', '/_next/static/test.js', '/icon.svg']) {
    assert.equal((await proxy(request(route))).headers.get('x-middleware-next'), '1', `${route} remains accessible`);
  }
  assert.equal((await proxy(request('/api/admin/maintenance', { method: 'PATCH', session: adminToken, origin: 'https://attacker.test' }))).status, 403, 'maintenance controls retain same-origin protection');

  cookieJar.clear();
  response = await publicRoute.GET(request('/api/maintenance'));
  assert.deepEqual(await response.json(), { enabled: true, endsAt: future, canBypass: false });
  assert.match(response.headers.get('cache-control'), /no-store/);
  response = await publicRoute.GET(request('/api/maintenance', { session: adminToken }));
  assert.equal((await response.json()).canBypass, true);
  response = await loginRoute.POST(request('/api/auth/login', { method: 'POST', body: { email: reviewer.email, password } }));
  assert.equal(response.status, 503);
  assert.equal(cookieJar.size, 0, 'regular users receive no session during maintenance');
  response = await loginRoute.POST(request('/api/auth/login', { method: 'POST', body: { email: 'admin@example.test', password: process.env.PRISMATICA_ADMIN_PASSWORD } }));
  assert.equal(response.status, 200);
  assert.ok(auth.getSessionUserFromToken(cookieJar.get('prismatica_session')).isAdmin, 'administrators can sign in during maintenance');

  const updated = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
  await maintenance.updateMaintenanceSettingsForAdmin('admin-root', { enabled: true, endsAt: updated });
  assert.equal((await maintenance.getMaintenanceSettings()).endsAt, updated);
  // A late maintenance window must remain closed until an administrator stops it.
  fs.writeFileSync(`${process.env.PRISMATICA_DATA_FILE}.maintenance.json`, JSON.stringify({ enabled: true, endsAt: '2020-01-01T00:00:00Z' }));
  assert.equal((await proxy(request('/api/app-state'))).status, 503);
  assert.equal((await proxy(request('/api/app-state'))).headers.get('retry-after'), '60');
  await maintenance.updateMaintenanceSettingsForAdmin('admin-root', { enabled: false });
  assert.equal((await proxy(request('/dashboard'))).headers.get('x-middleware-next'), '1');
  assert.equal((await proxy(request('/projects/example'))).headers.get('location')?.startsWith('https://example.test/sign-in?'), true, 'ordinary project access checks resume');

  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MaintenancePage } = require(path.join(out, 'components/maintenance-page.js'));
  const html = renderToStaticMarkup(React.createElement(MaintenancePage, { endsAt: future }));
  assert.match(html, /We’ll be back soon/);
  assert.equal(html.match(/<time[^>]+datetime="([^"]+)"/i)?.[1], future, 'public notice exposes the exact return time');
  assert.match(html, /Administrator sign in/);

  // A new temporary cluster exercises real SQL persistence, independent of production.
  bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  database = path.join(temp, 'database');
  execFileSync(path.join(bin, 'initdb'), ['-D', database, '-A', 'trust', '-U', 'maintenance-test', '--no-locale'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', database, '-l', path.join(temp, 'postgres.log'), '-o', `-k ${temp} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  databaseStarted = true;
  process.env.DATABASE_URL = `postgresql://maintenance-test@localhost/postgres?host=${encodeURIComponent(temp)}`;
  process.env.PRISMATICA_STORAGE_MODE = 'postgres';
  assert.deepEqual(await maintenance.getMaintenanceSettings(), { enabled: false, endsAt: null });
  await maintenance.updateMaintenanceSettingsForAdmin('admin-root', { enabled: true, endsAt: future });
  assert.deepEqual(await maintenance.getMaintenanceSettings(), { enabled: true, endsAt: future });
  await globalThis.__prismaticaMaintenancePool.end();
  delete globalThis.__prismaticaMaintenancePool;
  delete globalThis.__prismaticaMaintenanceSchema;
  assert.deepEqual(await maintenance.getMaintenanceSettings(), { enabled: true, endsAt: future }, 'a new connection sees persisted maintenance');
  await maintenance.updateMaintenanceSettingsForAdmin('admin-root', { enabled: false });
  assert.deepEqual(await maintenance.getMaintenanceSettings(), { enabled: false, endsAt: future });
  console.log('Maintenance checks passed: admin controls, date validation, signed sessions, public redirects, API blocking, same-origin protection, admin login, live status, date updates, manual stop, visitor rendering, and file/PostgreSQL persistence.');
} finally {
  await globalThis.__prismaticaMaintenancePool?.end();
  delete globalThis.__prismaticaMaintenancePool;
  delete globalThis.__prismaticaMaintenanceSchema;
  if (databaseStarted) execFileSync(path.join(bin, 'pg_ctl'), ['-D', database, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
