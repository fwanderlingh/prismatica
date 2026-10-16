import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-storage-test-'));
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalEnv = { ...process.env };
try {
  const out = path.join(temp, 'out');
  const config = path.join(temp, 'tsconfig.json');
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: 'ES2020', module: 'Node16', moduleResolution: 'Node16', esModuleInterop: true,
    skipLibCheck: true, noEmitOnError: true, types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')],
    rootDir: root, outDir: out, paths: { '@/*': [path.join(root, '*')] }
  }, files: [path.join(root, 'lib/serverStore.ts')] }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  Module._resolveFilename = function (request, parent, ...args) {
    if (request.startsWith('@/')) request = path.join(out, request.slice(2));
    return originalResolve.call(this, request, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
  };
  const sdk = require('@aws-sdk/client-s3');
  const queries = [];
  let failListing = false;
  Module._load = function (request, parent, ...args) {
    if (request === '@aws-sdk/client-s3') return { ...sdk, S3Client: class {
      async send(command) {
        assert.ok(command instanceof sdk.ListObjectsV2Command, 'Inventory must not download PDFs');
        queries.push(command.input);
        if (failListing) throw new Error('Storage unavailable');
        return command.input.ContinuationToken
          ? { IsTruncated: false, Contents: [{ Key: 'reports/review-b/b.pdf', Size: 500 }, { Key: 'reports/deleted/c.pdf', Size: 25 }] }
          : { IsTruncated: true, NextContinuationToken: 'page-two', Contents: [{ Key: 'reports/review-a/a.pdf', Size: 1000 }, { Key: 'reports/review-a/', Size: 0 }] };
      }
    } };
    return originalLoad.call(this, request, parent, ...args);
  };
  Object.assign(process.env, {
    PRISMATICA_STORAGE_MODE: 'file', PRISMATICA_USERS_SYNC_POSTGRES: 'false',
    PRISMATICA_OBJECT_STORAGE_PROVIDER: 'local', PRISMATICA_DATA_FILE: path.join(temp, 'data/state.json'),
    PRISMATICA_ADMIN_EMAIL: 'storage-admin@example.test', PRISMATICA_ADMIN_PASSWORD: 'isolated-storage-password',
    PRISMATICA_S3_ENDPOINT: 'http://example.test', PRISMATICA_S3_BUCKET: 'test',
    PRISMATICA_S3_ACCESS_KEY: 'test', PRISMATICA_S3_SECRET_KEY: 'test'
  });
  const { collectStorageInfo } = require(path.join(out, 'lib/storageInfo.js'));
  const projects = [{ id: 'review-a', title: 'Review A' }, { id: 'review-b', title: 'Review B' }, { id: 'empty', title: 'Empty' }];
  let result = await collectStorageInfo(projects, process.env.PRISMATICA_DATA_FILE);
  assert.equal(result.total.bytes, 0);
  assert.equal(result.reviews.length, 3);
  assert.ok(result.disk.totalBytes > 0, 'Disk capacity is available before the first upload');
  for (const [name, size] of [['review-a/a.pdf', 400], ['review-a/old.pdf', 200], ['review-b/nested/b.pdf', 50], ['deleted/x.pdf', 70], ['orphan.pdf', 99]]) {
    const target = path.join(temp, 'data/pdfs', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.alloc(size));
  }
  fs.writeFileSync(path.join(temp, 'outside.pdf'), Buffer.alloc(1000));
  fs.symlinkSync(path.join(temp, 'outside.pdf'), path.join(temp, 'data/pdfs/review-a/link.pdf'));
  result = await collectStorageInfo(projects, process.env.PRISMATICA_DATA_FILE);
  assert.equal(result.total.bytes, 819);
  assert.equal(result.total.files, 5);
  assert.equal(result.reviews[0].bytes, 600);
  assert.equal(result.reviews[1].bytes, 50);
  assert.equal(result.unassigned.bytes, 169);
  assert.equal(result.reviews[2].bytes, 0);
  const disk = fs.statfsSync(path.join(temp, 'data/pdfs'));
  assert.equal(result.disk.totalBytes, disk.blocks * disk.bsize);

  process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER = 'minio';
  result = await collectStorageInfo(projects, process.env.PRISMATICA_DATA_FILE);
  assert.equal(result.total.bytes, 2344);
  assert.equal(result.total.localBytes, 819);
  assert.equal(result.total.objectBytes, 1525);
  assert.equal(result.total.files, 8);
  assert.equal(result.reviews[0].bytes, 1600);
  assert.equal(result.reviews[1].bytes, 550);
  assert.equal(result.unassigned.bytes, 194);
  assert.equal(queries.length, 2);
  assert.equal(queries[0].Prefix, 'reports/');
  assert.equal(queries[1].ContinuationToken, 'page-two');
  assert.equal(result.reviews.reduce((sum, review) => sum + review.bytes, result.unassigned.bytes), result.total.bytes);
  failListing = true;
  await assert.rejects(collectStorageInfo(projects, process.env.PRISMATICA_DATA_FILE), /Storage unavailable/);

  // Authorization is checked before any storage inventory. All state is temporary.
  process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER = 'local';
  const store = require(path.join(out, 'lib/serverStore.js'));
  const seeds = require(path.join(out, 'lib/prismaData.js'));
  const admin = { id: 'admin-root', name: 'Admin', email: 'storage-admin@example.test', isAdmin: true, passwordHash: 'test', passwordSalt: 'test' };
  fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify({
    version: 1, users: [admin, { ...admin, id: 'reviewer', isAdmin: false, email: 'reviewer@example.test' }],
    projects: projects.map(project => ({ ...seeds.reviewProjects[0], ...project, ownerId: admin.id, ownerIds: [admin.id], memberIds: [] })),
    studies: [], reports: [], imports: [], decisions: [], events: [], dedupCandidates: []
  }));
  await assert.rejects(store.getStorageInfoForAdmin('unknown'), error => error.status === 401);
  await assert.rejects(store.getStorageInfoForAdmin('reviewer'), error => error.status === 403);
  result = await store.getStorageInfoForAdmin(admin.id);
  assert.equal(result.total.bytes, 819);
  console.log('Storage checks passed: local file sizes, disk capacity, empty reviews, orphan files, symlinks, paginated MinIO inventory, retained copies, errors, and administrator authorization.');
} finally {
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
