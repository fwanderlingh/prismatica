import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const { Pool } = require('pg');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-email-'));
const originalEnv = { ...process.env };
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalFetch = globalThis.fetch;
const originalError = console.error;
const cookieJar = new Map();
const sent = [];
let mode = 'success';
let requestNumber = 0;
let databaseStarted = false;
let bin;
let pool;
try {
  const out = path.join(temp, 'out');
  const config = path.join(temp, 'tsconfig.json');
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: 'ES2020', lib: ['esnext', 'dom'], module: 'Node16', moduleResolution: 'Node16', esModuleInterop: true,
      skipLibCheck: true, types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')],
      ignoreDeprecations: '6.0', rootDir: root, outDir: out, paths: { '@/*': [path.join(root, '*')] }
    },
    files: ['lib/serverStore.ts', 'lib/serverAuth.ts', 'lib/transactionalEmail.ts', 'lib/postgresUsersSync.ts',
      'app/api/auth/register/route.ts', 'app/api/auth/login/route.ts', 'app/api/auth/email/request/route.ts',
      'app/api/auth/email/complete/route.ts', 'app/api/admin/auth-settings/route.ts', 'app/api/me/route.ts']
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
    PRISMATICA_DATA_FILE: path.join(temp, 'state.json'), PRISMATICA_STORAGE_MODE: 'file',
    PRISMATICA_OBJECT_STORAGE_PROVIDER: 'local', PRISMATICA_USERS_SYNC_POSTGRES: 'false',
    PRISMATICA_ADMIN_EMAIL: 'admin@example.test', PRISMATICA_ADMIN_PASSWORD: 'isolated-admin-password',
    PRISMATICA_SESSION_SECRET: 'isolated-session-secret', PRISMATICA_REGISTRATION_ENABLED: 'true'
  });
  for (const key of ['PRISMATICA_TEM_PROJECT_ID', 'PRISMATICA_TEM_API_KEY', 'PRISMATICA_EMAIL_FROM', 'PRISMATICA_PUBLIC_URL', 'PRISMATICA_TEM_REGION']) delete process.env[key];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails');
    assert.equal(options.headers['X-Auth-Token'], 'test-key-never-log');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const body = JSON.parse(options.body);
    assert.equal(body.project_id, process.env.PRISMATICA_TEM_PROJECT_ID);
    assert.equal(body.from.email, 'accounts@example.test');
    sent.push(body);
    if (mode === 'failure') return new Response('private provider diagnostic', { status: 503 });
    if (mode === 'timeout') throw new DOMException('private timeout diagnostic', 'TimeoutError');
    if (mode === 'malformed') return Response.json({});
    return Response.json({ emails: [{ id: crypto.randomUUID() }] });
  };
  const store = require(path.join(out, 'lib/serverStore.js'));
  const auth = require(path.join(out, 'lib/serverAuth.js'));
  const mail = require(path.join(out, 'lib/transactionalEmail.js'));
  const register = require(path.join(out, 'app/api/auth/register/route.js')).POST;
  const requestEmail = require(path.join(out, 'app/api/auth/email/request/route.js')).POST;
  const completeEmail = require(path.join(out, 'app/api/auth/email/complete/route.js')).POST;
  const adminSettings = require(path.join(out, 'app/api/admin/auth-settings/route.js'));
  const sync = require(path.join(out, 'lib/postgresUsersSync.js'));
  const updateProfile = require(path.join(out, 'app/api/me/route.js')).PATCH;
  function request(body, ip = `email-test-${++requestNumber}`) {
    return new Request('https://prismatica.example.test/api/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body)
    });
  }
  function registration(email) {
    const { captcha } = store.getPublicAuthConfig();
    const answer = JSON.parse(Buffer.from(captcha.token.split('.')[0], 'base64url')).answer;
    return { name: 'Email Tester', email, organization: 'Test', title: 'Reviewer', password: 'original-password', captchaToken: captcha.token, captchaAnswer: String(answer) };
  }
  function lastToken() {
    const url = new URL(sent.at(-1).text.match(/https:\/\/[^\s]+/)[0]);
    assert.equal(url.origin, 'https://prismatica.example.test');
    assert.equal(url.search, '');
    assert.ok(sent.at(-1).html.includes('&') || sent.at(-1).html.includes('<a href='));
    return new URLSearchParams(url.hash.slice(1)).get('token');
  }
  function rawState() {
    return process.env.PRISMATICA_STORAGE_MODE === 'postgres'
      ? JSON.parse(execFileSync(process.execPath, ['scripts/postgres-state-io.mjs', 'read'], { cwd: root, env: process.env, encoding: 'utf8' }))
      : JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, 'utf8'));
  }
  function writeState(state) {
    if (process.env.PRISMATICA_STORAGE_MODE === 'postgres') execFileSync(process.execPath, ['scripts/postgres-state-io.mjs', 'write'], { cwd: root, env: process.env, input: JSON.stringify(state) });
    else fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(state));
  }
  function editUser(userId, edit) {
    const state = rawState();
    edit(state.users.find(user => user.id === userId));
    writeState(state);
  }
  function configure() {
    Object.assign(process.env, {
      PRISMATICA_TEM_PROJECT_ID: '11111111-1111-4111-8111-111111111111', PRISMATICA_TEM_API_KEY: 'test-key-never-log',
      PRISMATICA_EMAIL_FROM: 'accounts@example.test', PRISMATICA_PUBLIC_URL: 'https://prismatica.example.test'
    });
  }
  async function rejectRegistrationPassword(email, password) {
    const usersBefore = rawState().users;
    const cookiesBefore = [...cookieJar];
    const sessionBefore = await auth.getSessionUserId();
    const emailCount = sent.length;
    const result = await register(request({ ...registration(email), password }));
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, password.trim() ? /8 and 128/ : /password to register/);
    const state = rawState();
    assert.deepEqual(state.users, usersBefore, 'invalid registration does not create or alter accounts');
    assert.ok(!state.users.some(user => user.email === email));
    assert.equal(await auth.getSessionUserId(), sessionBefore, 'invalid registration does not replace the session');
    assert.deepEqual([...cookieJar], cookiesBefore);
    assert.equal(sent.length, emailCount, 'invalid registration does not send email');
  }
  async function exerciseRegistrationPasswords(suffix) {
    store.updateAuthSettingsForUser('admin-root', { transactionalEmailEnabled: false });
    for (const [index, password] of ['', 'a', '1234567', ' 1234567 ', 'a'.repeat(129), ` ${'a'.repeat(127)} `].entries()) {
      await rejectRegistrationPassword(`invalid-password-${suffix}-${index}@example.test`, password);
    }
    for (const length of [8, 128]) {
      cookieJar.clear();
      const email = `valid-password-${suffix}-${length}@example.test`;
      const password = 'a'.repeat(length);
      const emailCount = sent.length;
      const result = await register(request({ ...registration(email), password }));
      assert.equal(result.status, 200, `${length}-character registration succeeds`);
      const user = (await result.json()).currentUser;
      assert.equal(await auth.getSessionUserId(), user.id);
      assert.equal(store.loginUser(email, password).currentUser.id, user.id);
      assert.equal(sent.length, emailCount);
    }
  }

  assert.equal(mail.getEmailConfigurationStatus().configured, false);
  assert.deepEqual(await mail.sendAccountEmail({ enabled: false }), { status: 'disabled' });
  assert.equal(sent.length, 0);
  store.getPublicAuthConfig();
  assert.equal(store.getPublicAuthConfig().authSettings.transactionalEmailEnabled, false);
  assert.throws(() => store.updateAuthSettingsForUser('admin-root', { transactionalEmailEnabled: true }), /PRISMATICA_TEM/);
  let response = await register(request(registration('legacy@example.test')));
  assert.equal(response.status, 200);
  const legacy = (await response.json()).currentUser;
  assert.equal(await auth.getSessionUserId(), legacy.id);
  assert.equal(sent.length, 0);
  assert.equal((await requestEmail(request({ email: legacy.email, purpose: 'password-reset' }))).status, 403);
  assert.equal((await adminSettings.GET()).status, 403);
  configure();
  assert.equal(mail.getEmailConfigurationStatus().configured, true);
  for (const bad of ['http://example.test', 'https://example.test/path', 'https://user:secret@example.test', 'https://example.test/?x=1', 'https://example.test/#x']) {
    process.env.PRISMATICA_PUBLIC_URL = bad;
    assert.equal(mail.getEmailConfigurationStatus().configured, false);
  }
  configure();

  async function exerciseFlows(suffix) {
    await exerciseRegistrationPasswords(suffix);
    store.updateAuthSettingsForUser('admin-root', { transactionalEmailEnabled: true });
    await rejectRegistrationPassword(`invalid-password-email-${suffix}@example.test`, 'short');
    assert.equal(store.loginUser(legacy.email, 'original-password').currentUser.id, legacy.id);
    await auth.setSessionCookie('admin-root');
    const status = await (await adminSettings.GET()).json();
    assert.equal(status.configured, true);
    assert.ok(!JSON.stringify(status).includes('test-key-never-log'));
    response = await adminSettings.PATCH(request({ registrationEnabled: false }));
    assert.equal((await response.json()).authSettings.transactionalEmailEnabled, true);
    store.updateAuthSettingsForUser('admin-root', { registrationEnabled: true });
    cookieJar.clear();
    const email = `pending-${suffix}@example.test`;
    response = await register(request(registration(email)));
    const pending = await response.json();
    assert.equal(pending.verificationRequired, true);
    assert.equal(pending.currentUser, undefined);
    assert.equal(await auth.getSessionUserId(), null);
    const user = rawState().users.find(candidate => candidate.email === email);
    const token = lastToken();
    assert.ok(!JSON.stringify(rawState()).includes(token));
    assert.throws(() => store.loginUser(email, 'original-password'), /Confirm your email/);
    await assert.rejects(() => auth.setSessionCookie(user.id));
    assert.equal(store.getUserSessionState(user.id), null);
    assert.throws(() => store.completeAccountEmail('password-reset', token, 'new-password'), /invalid or expired/);
    const count = sent.length;
    await store.requestAccountEmail(email, 'verification');
    assert.equal(sent.length, count, 'cooldown prevents duplicate sending');
    editUser(user.id, candidate => { candidate.emailAuth.verification.expiresAt = 0; candidate.emailAuth.verification.issuedAt = 0; });
    assert.throws(() => store.completeAccountEmail('verification', token), /invalid or expired/);
    await store.requestAccountEmail(email, 'verification');
    const fresh = lastToken();
    assert.notEqual(fresh, token);
    assert.throws(() => store.completeAccountEmail('verification', token), /invalid or expired/);
    response = await completeEmail(request({ purpose: 'verification', token: fresh }));
    assert.equal(response.status, 200);
    assert.throws(() => store.completeAccountEmail('verification', fresh), /invalid or expired/);
    assert.equal(store.loginUser(email, 'original-password').currentUser.id, user.id);
    await auth.setSessionCookie(user.id);
    const oldCookie = cookieJar.get('prismatica_session');
    const unknownResponse = await (await requestEmail(request({ email: `unknown-${suffix}@example.test`, purpose: 'password-reset' }))).json();
    const knownResponse = await (await requestEmail(request({ email, purpose: 'password-reset' }))).json();
    assert.deepEqual(knownResponse, unknownResponse);
    const resetToken = lastToken();
    assert.throws(() => store.completeAccountEmail('password-reset', resetToken, 'short'), /8 and 1024/);
    store.completeAccountEmail('password-reset', resetToken, 'replacement-password');
    assert.throws(() => store.completeAccountEmail('password-reset', resetToken, 'replacement-password'), /invalid or expired/);
    assert.equal(await auth.getSessionUserId(), null, 'old cookie is revoked');
    assert.throws(() => store.loginUser(email, 'original-password'), /incorrect/);
    assert.equal(store.loginUser(email, 'replacement-password').currentUser.id, user.id);
    await auth.setSessionCookie(user.id);
    assert.notEqual(cookieJar.get('prismatica_session'), oldCookie);
    assert.equal(await auth.getSessionUserId(), user.id);
    await store.requestAccountEmail(email, 'password-reset');
    const superseded = lastToken();
    const beforeProfile = cookieJar.get('prismatica_session');
    response = await updateProfile(request({ currentPassword: 'replacement-password', newPassword: 'profile-password' }));
    assert.equal(response.status, 200);
    assert.equal(await auth.getSessionUserId(), user.id, 'profile change refreshes current session');
    assert.notEqual(cookieJar.get('prismatica_session'), beforeProfile);
    assert.throws(() => store.completeAccountEmail('password-reset', superseded, 'other-password'), /invalid or expired/);
    const adminReset = store.adminResetPasswordForUser('admin-root', user.id);
    assert.equal(await auth.getSessionUserId(), null, 'administrator reset revokes sessions');
    assert.equal(store.loginUser(email, adminReset.temporaryPassword).currentUser.id, user.id);
    const created = store.adminCreateUserForUser('admin-root', { name: 'Invited', email: `invited-${suffix}@example.test`, organization: 'Test' });
    assert.equal(store.loginUser(`invited-${suffix}@example.test`, created.temporaryPassword).currentUser.id, created.createdUserId);
    // Failed delivery must permit a retry without logging/exposing provider content.
    mode = 'failure';
    const failureEmail = `failed-${suffix}@example.test`;
    cookieJar.clear();
    response = await register(request(registration(failureEmail)));
    const failed = await response.json();
    assert.equal(failed.verificationRequired, true);
    assert.match(failed.message, /could not be sent/);
    assert.throws(() => store.loginUser(failureEmail, 'original-password'), /Confirm your email/);
    console.error = (...args) => assert.equal(args.join(' '), 'Account email delivery unavailable.');
    const failedResponse = await (await requestEmail(request({ email: failureEmail, purpose: 'verification' }))).json();
    assert.deepEqual(failedResponse, unknownResponse);
    console.error = originalError;
    mode = 'success';
    await store.requestAccountEmail(failureEmail, 'verification');
    const recovered = lastToken();
    store.updateAuthSettingsForUser('admin-root', { transactionalEmailEnabled: false });
    assert.throws(() => store.completeAccountEmail('verification', recovered), /disabled/);
    assert.equal(store.loginUser(failureEmail, 'original-password').currentUser.email, failureEmail);
    const disabledCount = sent.length;
    await assert.rejects(() => store.requestAccountEmail(email, 'password-reset'), /disabled/);
    assert.equal(sent.length, disabledCount);
    delete process.env.PRISMATICA_TEM_API_KEY;
    store.updateAuthSettingsForUser('admin-root', { transactionalEmailEnabled: false });
    configure();
    console.log(`${suffix}: optional email, registration, expiry, resend, reset, session revocation, and failure checks passed.`);
    return user.id;
  }
  const fileUserId = await exerciseFlows('file');
  for (const failure of ['timeout', 'malformed']) {
    mode = failure;
    await assert.rejects(() => mail.sendAccountEmail({ enabled: true, to: 'test@example.test', purpose: 'verification', token: 'test' }), mail.EmailDeliveryError);
  }
  mode = 'success';
  // IP limits apply across recipients, including unknown accounts.
  store.updateAuthSettingsForUser('admin-root', { transactionalEmailEnabled: true });
  for (let i = 0; i < 10; i++) assert.equal((await requestEmail(request({ email: `rate-${i}@example.test`, purpose: 'password-reset' }, 'one-ip'))).status, 200);
  assert.equal((await requestEmail(request({ email: 'rate-11@example.test', purpose: 'password-reset' }, 'one-ip'))).status, 429);

  // Migrate and exercise the same flows on a disposable PostgreSQL cluster.
  bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  execFileSync(path.join(bin, 'initdb'), ['-D', path.join(temp, 'db'), '-A', 'trust', '-U', 'email-test', '--no-locale'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', path.join(temp, 'db'), '-l', path.join(temp, 'postgres.log'), '-o', `-k ${temp} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  databaseStarted = true;
  process.env.DATABASE_URL = `postgresql://email-test@localhost/postgres?host=${encodeURIComponent(temp)}`;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  process.env.PRISMATICA_SOURCE_STATE_FILE = process.env.PRISMATICA_DATA_FILE;
  execFileSync(process.execPath, ['scripts/migrate-users-to-postgres.mjs'], { cwd: root, env: process.env, stdio: 'pipe' });
  let stored = (await pool.query('SELECT email_auth FROM app_users WHERE id=$1', [fileUserId])).rows[0].email_auth;
  assert.equal(stored.sessionVersion, rawState().users.find(user => user.id === fileUserId).emailAuth.sessionVersion);
  assert.equal((await pool.query('SELECT transactional_email_enabled FROM auth_settings')).rows[0].transactional_email_enabled, true);
  process.env.PRISMATICA_USERS_SYNC_POSTGRES = 'true';
  await sync.syncAuthSettingsToPostgres();
  await sync.syncUserByIdToPostgres(fileUserId);
  process.env.PRISMATICA_STORAGE_MODE = 'postgres';
  assert.equal(store.getPublicAuthConfig().authSettings.transactionalEmailEnabled, true);
  await exerciseFlows('postgres');
  assert.equal((await pool.query('SELECT transactional_email_enabled FROM auth_settings')).rows[0].transactional_email_enabled, false);
  console.log('All transactional email checks passed; no real emails sent.');
} finally {
  console.error = originalError;
  globalThis.fetch = originalFetch;
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  if (pool) await pool.end();
  if (databaseStarted) execFileSync(path.join(bin, 'pg_ctl'), ['-D', path.join(temp, 'db'), '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  process.env = originalEnv;
  fs.rmSync(temp, { recursive: true, force: true });
}
