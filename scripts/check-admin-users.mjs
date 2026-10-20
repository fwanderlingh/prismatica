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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-admin-users-'));
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalExec = childProcess.execFileSync;
const originalEnv = { ...process.env };
try {
  const out = path.join(temp, 'out');
  const config = path.join(temp, 'tsconfig.json');
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: 'ES2020', module: 'Node16', moduleResolution: 'Node16', jsx: 'react-jsx', esModuleInterop: true,
    skipLibCheck: true, noEmitOnError: true, types: ['node', 'react'], typeRoots: [path.join(root, 'node_modules/@types')],
    rootDir: root, outDir: out, paths: { '@/*': [path.join(root, '*')] }
  }, files: [path.join(root, 'lib/serverStore.ts'), path.join(root, 'components/review-sections/registered-users-section.tsx')] }));
  originalExec(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  Module._resolveFilename = function (request, parent, ...args) {
    if (request.startsWith('@/')) request = path.join(out, request.slice(2));
    return originalResolve.call(this, request, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
  };
  Object.assign(process.env, {
    PRISMATICA_STORAGE_MODE: 'file', PRISMATICA_USERS_SYNC_POSTGRES: 'false',
    PRISMATICA_OBJECT_STORAGE_PROVIDER: 'local', PRISMATICA_DATA_FILE: path.join(temp, 'state.json'),
    PRISMATICA_ADMIN_EMAIL: 'admin@example.test', PRISMATICA_ADMIN_PASSWORD: 'isolated-test-password'
  });
  const store = require(path.join(out, 'lib/serverStore.js'));
  const seeds = require(path.join(out, 'lib/prismaData.js'));
  const admin = { id: 'admin-root', name: 'Admin', email: 'admin@example.test', isAdmin: true, passwordHash: 'test', passwordSalt: 'test', initials: 'AD', organization: 'Test', title: 'Manager', timezone: 'UTC', avatarColor: '#000' };
  const reviewer = { ...admin, id: 'reviewer-one', name: 'Reviewer One', email: 'reviewer@example.test', isAdmin: false };
  const project = { ...seeds.reviewProjects[0], id: 'owned-review', ownerId: reviewer.id, ownerIds: [reviewer.id], memberIds: [reviewer.id] };
  const fixture = () => ({ version: 1, users: [admin, reviewer], projects: [project], studies: [], reports: [], imports: [], decisions: [], events: [], dedupCandidates: [] });
  const save = state => fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(state));
  save(fixture());
  assert.throws(() => store.adminSetUserRoleForUser('unknown', reviewer.id, true), error => error.status === 401);
  assert.throws(() => store.adminSetUserRoleForUser(reviewer.id, reviewer.id, true), error => error.status === 403);
  assert.throws(() => store.adminSetUserRoleForUser(admin.id, 'missing', true), error => error.status === 404);
  for (const bad of [undefined, null, 'true', 1, {}]) {
    assert.throws(() => store.adminSetUserRoleForUser(admin.id, reviewer.id, bad), /true or false/);
  }
  assert.throws(() => store.adminSetUserRoleForUser(admin.id, admin.id, false), /last administrator/);
  const initialSession = store.getUserSessionState(reviewer.id).version;
  let result = store.adminSetUserRoleForUser(admin.id, reviewer.id, true);
  assert.equal(result.users.find(user => user.id === reviewer.id).isAdmin, true);
  const promotedSession = store.getUserSessionState(reviewer.id).version;
  assert.notEqual(promotedSession, initialSession);
  assert.throws(() => store.adminSetUserRoleForUser(admin.id, admin.id, false), /another administrator/);
  store.adminSetUserRoleForUser(admin.id, reviewer.id, true);
  assert.equal(store.getUserSessionState(reviewer.id).version, promotedSession, 'No-op changes preserve sessions');
  store.adminSetUserRoleForUser(reviewer.id, admin.id, false);
  result = store.getAppStateForUser(reviewer.id);
  assert.equal(result.users.find(user => user.id === admin.id).isAdmin, false, 'Bootstrap administrator stays revoked on reload');
  assert.equal(result.currentUser.id, reviewer.id, 'Promoted administrators keep their identity');
  assert.equal(result.projects.find(item => item.id === project.id).ownerId, reviewer.id, 'Review ownership survives reload');
  assert.throws(() => store.adminSetUserRoleForUser(admin.id, reviewer.id, false), error => error.status === 403);
  assert.throws(() => store.adminSetUserRoleForUser(reviewer.id, reviewer.id, false), /last administrator/);
  store.adminSetUserRoleForUser(reviewer.id, admin.id, true);
  store.adminSetUserRoleForUser(admin.id, reviewer.id, false);
  assert.notEqual(store.getUserSessionState(reviewer.id).version, promotedSession);
  const state = JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, 'utf8'));
  state.users.reverse();
  save(state);
  assert.equal(store.getAppStateForUser(admin.id).users.find(user => user.id === reviewer.id).isAdmin, false);

  // Invitation credentials must be independent across project owners, even when
  // a deployment still has the retired shared-password environment variable.
  const secondProject = { ...project, id: 'second-owned-review', ownerId: admin.id, ownerIds: [admin.id], memberIds: [] };
  save({ ...fixture(), projects: [project, secondProject] });
  process.env.PRISMATICA_INVITE_PASSWORD = 'legacy-shared-invitation-password';
  const firstInvitation = store.inviteUserToProjectForUser(reviewer.id, project.id, {
    name: 'First Invitee', email: 'first-invitee@example.test'
  });
  const secondInvitation = store.inviteUserToProjectForUser(admin.id, secondProject.id, {
    name: 'Second Invitee', email: 'second-invitee@example.test'
  });
  for (const invitation of [firstInvitation, secondInvitation]) {
    assert.match(invitation.temporaryPassword, /^[A-Za-z0-9]{8}$/, 'new invitations generate eight alphanumeric characters');
    assert.notEqual(invitation.temporaryPassword, process.env.PRISMATICA_INVITE_PASSWORD, 'ignore the retired shared password');
  }
  assert.notEqual(firstInvitation.temporaryPassword, secondInvitation.temporaryPassword, 'new invitees receive independent credentials');
  const firstLogin = store.loginUser('first-invitee@example.test', firstInvitation.temporaryPassword);
  const secondLogin = store.loginUser('second-invitee@example.test', secondInvitation.temporaryPassword);
  assert.equal(firstLogin.currentUser.email, 'first-invitee@example.test');
  assert.deepEqual(secondLogin.projects.map(item => item.id), [secondProject.id]);
  assert.throws(() => store.loginUser('second-invitee@example.test', firstInvitation.temporaryPassword), /incorrect/i,
    'knowing one invitation password must not grant access to another project');
  assert.throws(() => store.loginUser('first-invitee@example.test', secondInvitation.temporaryPassword), /incorrect/i);
  assert.throws(() => store.inviteUserToProjectForUser(firstLogin.currentUser.id, project.id, {
    name: 'Unauthorized Invitee', email: 'unauthorized@example.test'
  }), error => error.status === 403, 'only owners can invite');

  const beforeExistingInvitation = JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, 'utf8'))
    .users.find(user => user.id === secondLogin.currentUser.id);
  const existingInvitation = store.inviteUserToProjectForUser(reviewer.id, project.id, {
    name: 'Second Invitee', email: 'second-invitee@example.test'
  });
  assert.equal(existingInvitation.temporaryPassword, undefined, 'existing accounts do not disclose or generate a password');
  assert.doesNotMatch(existingInvitation.message, /Temporary password/);
  const afterExistingInvitation = JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, 'utf8'))
    .users.find(user => user.id === secondLogin.currentUser.id);
  assert.deepEqual(afterExistingInvitation, beforeExistingInvitation, 'adding an existing account preserves its credentials');
  assert.equal(store.loginUser('second-invitee@example.test', secondInvitation.temporaryPassword).currentUser.id, secondLogin.currentUser.id);
  delete process.env.PRISMATICA_INVITE_PASSWORD;
  const thirdInvitation = store.inviteUserToProjectForUser(reviewer.id, project.id, {
    name: 'Third Invitee', email: 'third-invitee@example.test'
  });
  assert.match(thirdInvitation.temporaryPassword, /^[A-Za-z0-9]{8}$/, 'use the same password format without legacy configuration');
  save(fixture());

  // Exercise the dedicated PostgreSQL bridge without touching a real database.
  let dbState = structuredClone(fixture());
  let mutation;
  childProcess.execFileSync = (_command, args, options) => {
    if (args[1] === 'read') return JSON.stringify(dbState);
    assert.equal(args[1], 'write-user-role', 'Role changes must not rewrite all review data');
    mutation = JSON.parse(options.input);
    const user = dbState.users.find(user => user.id === mutation.targetUserId);
    user.isAdmin = mutation.isAdmin;
    user.emailAuth = { sessionVersion: mutation.sessionVersion };
    return JSON.stringify({ changed: true });
  };
  process.env.PRISMATICA_STORAGE_MODE = 'postgres';
  result = store.adminSetUserRoleForUser(admin.id, reviewer.id, true);
  assert.equal(mutation.adminUserId, admin.id);
  assert.equal(result.users.find(user => user.id === reviewer.id).isAdmin, true);
  childProcess.execFileSync = originalExec;
  process.env.PRISMATICA_STORAGE_MODE = 'file';

  // Run the actual transaction function against a client double.
  const pgSource = fs.readFileSync(path.join(root, 'scripts/postgres-state-io.mjs'), 'utf8');
  const context = {};
  vm.runInNewContext(pgSource.slice(pgSource.indexOf('async function writeUserRoleMutation('), pgSource.indexOf('async function run()')) + '\nthis.changeRole = writeUserRoleMutation;', context);
  const sqlUsers = [{ id: admin.id, is_admin: true }, { id: reviewer.id, is_admin: false }];
  const queries = [];
  const client = { query: async (sql, params) => {
    queries.push(sql);
    if (sql.startsWith('SELECT')) return { rows: sqlUsers };
    if (sql.startsWith('UPDATE')) sqlUsers.find(user => user.id === params[2]).is_admin = params[0];
    return { rows: [] };
  } };
  const change = (actor, target, role) => context.changeRole(client, { adminUserId: actor, targetUserId: target, isAdmin: role, sessionVersion: 'new-session' });
  assert.equal((await change(reviewer.id, reviewer.id, true)).status, 403);
  assert.equal((await change(admin.id, admin.id, false)).status, 400);
  assert.equal((await change(admin.id, reviewer.id, true)).changed, true);
  assert.equal((await change(reviewer.id, admin.id, false)).changed, true);
  assert.equal((await change(admin.id, reviewer.id, false)).status, 403, 'A stale administrator is rejected under lock');
  assert.ok(queries.includes('LOCK TABLE app_users IN SHARE ROW EXCLUSIVE MODE'));
  assert.ok(queries.includes('ROLLBACK'));

  if (process.env.PRISMATICA_TEST_DATABASE_URL) {
    const { Client } = require('pg');
    const schema = `admin_role_test_${process.pid}`;
    const clients = [0, 1].map(() => new Client({ connectionString: process.env.PRISMATICA_TEST_DATABASE_URL }));
    try {
      await Promise.all(clients.map(client => client.connect()));
      await clients[0].query(`CREATE SCHEMA ${schema}`);
      for (const client of clients) await client.query(`SET search_path TO ${schema}`);
      await clients[0].query('CREATE TABLE app_users (id text PRIMARY KEY, is_admin boolean NOT NULL, email_auth jsonb, updated_at timestamptz)');
      await clients[0].query("INSERT INTO app_users VALUES ('a', true, '{\"verificationRequired\":true}', NOW()), ('b', true, '{}', NOW())");
      const results = await Promise.all([
        context.changeRole(clients[0], { adminUserId: 'a', targetUserId: 'b', isAdmin: false, sessionVersion: 'session-b' }),
        context.changeRole(clients[1], { adminUserId: 'b', targetUserId: 'a', isAdmin: false, sessionVersion: 'session-a' })
      ]);
      assert.equal(results.filter(result => result.changed).length, 1);
      assert.equal(results.filter(result => result.status === 403).length, 1);
      const { rows } = await clients[0].query('SELECT * FROM app_users ORDER BY id');
      assert.equal(rows.filter(user => user.is_admin).length, 1);
      assert.equal(rows[0].email_auth.verificationRequired, true);
      assert.ok(rows.find(user => !user.is_admin).email_auth.sessionVersion);
      console.log('Real PostgreSQL check passed: concurrent cross-revocations leave one administrator and invalidate the revoked session.');
    } finally {
      await clients[0].query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await Promise.all(clients.map(client => client.end()));
    }
  }

  // Exercise search inputs and pagination with isolated React state hooks.
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  let hooks = [], cursor = 0;
  const fakeReact = { ...React, useMemo: fn => fn(), useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = initial;
    return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
  } };
  Module._load = function (request, parent, ...args) {
    return request === 'react' && parent?.filename.endsWith('registered-users-section.js') ? fakeReact : originalLoad.call(this, request, parent, ...args);
  };
  const { RegisteredUsersSection } = require(path.join(out, 'components/review-sections/registered-users-section.js'));
  const users = [admin, ...Array.from({ length: 24 }, (_, i) => ({ ...reviewer, id: `person-${i}`, name: `Person ${i}`, email: `person${i}@example.test`, organization: 'Example University', title: 'Researcher' }))];
  const noop = () => {};
  const props = { users, currentUser: admin, adminDirectoryMessage: '', createUserMessage: '', adminResetUserPassword: noop, adminDeleteUser: noop, adminChangeUserRole: noop,
    createUserForm: { name: '', email: '', organization: '', title: '' }, onCreateUserFormNameChange: noop, onCreateUserFormEmailChange: noop, onCreateUserFormOrganizationChange: noop,
    onCreateUserFormTitleChange: noop, onCreateUser: noop, isCreatingUser: false, pendingUserAction: null };
  function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(item => nodes(item, result)); else if (node?.props) { result.push(node); nodes(node.props.children, result); } return result; }
  const render = () => { cursor = 0; return RegisteredUsersSection(props); };
  const search = value => nodes(render()).find(node => node.props.type === 'search').props.onChange({ target: { value } });
  let tree = render();
  assert.match(renderToStaticMarkup(tree), /Showing 1–10 of 25 accounts/);
  nodes(tree).find(node => node.type === 'button' && node.props.children === 'Next').props.onClick();
  assert.match(renderToStaticMarkup(render()), /Showing 11–20 of 25 accounts/);
  search(' PERSON23@EXAMPLE.TEST ');
  assert.match(renderToStaticMarkup(render()), /Showing 1–1 of 1 matching accounts/);
  assert.match(renderToStaticMarkup(render()), /Person 23/);
  search('university researcher');
  assert.match(renderToStaticMarkup(render()), /of 24 matching accounts/);
  search('administrator');
  tree = render();
  assert.match(renderToStaticMarkup(tree), /of 1 matching accounts/);
  assert.equal(nodes(tree).find(node => node.props['aria-label'] === 'Revoke administrator access for Admin').props.disabled, true);
  search('no-such-user');
  assert.match(renderToStaticMarkup(render()), /No matching accounts/);
  search('');
  assert.match(renderToStaticMarkup(render()), /Showing 1–10 of 25 accounts/);
  console.log('Admin user checks passed: search, filtered pagination, role authorization, validation, last-admin and self-revocation guards, role persistence, stable identities, session invalidation, PostgreSQL role mutation, and independent invitation passwords.');
} finally {
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  childProcess.execFileSync = originalExec;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
