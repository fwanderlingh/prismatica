import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const dns = require('node:dns/promises');
const http = require('node:http');
const https = require('node:https');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-pdf-security-'));
const originalResolve = Module._resolveFilename;
const originalEnv = { ...process.env };
const originalLookup = dns.lookup;
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;
const originalFetch = globalThis.fetch;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const publicAddress = '93.184.216.34';
let lookups = [];
let requests = [];
let connections = [];
let dnsAnswers = new Map();
let responses = new Map();

function resetNetwork() {
  lookups = [];
  requests = [];
  connections = [];
  dnsAnswers = new Map();
  responses = new Map();
}

function resolveAs(hostname, ...addresses) {
  dnsAnswers.set(hostname, addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 })));
}

function serve(url, options = {}) {
  responses.set(url, { statusCode: 200, headers: { 'content-type': 'application/pdf' }, chunks: [pdf], ...options });
}

// All DNS and transport are intercepted. A missing fixture fails immediately;
// this check never contacts a real hostname or a local/private service.
dns.lookup = async (hostname, options) => {
  lookups.push({ hostname, options });
  assert.ok(dnsAnswers.has(hostname), `unexpected DNS lookup: ${hostname}`);
  const answer = await dnsAnswers.get(hostname);
  if (answer instanceof Error) throw answer;
  return options?.all ? answer : answer[0];
};

function mockRequest(urlOrOptions, optionsOrCallback, responseCallback) {
  const url = urlOrOptions instanceof URL || typeof urlOrOptions === 'string' ? new URL(urlOrOptions) : null;
  const options = url ? (typeof optionsOrCallback === 'object' ? optionsOrCallback : {}) : urlOrOptions;
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : responseCallback;
  const requestUrl = url?.href ?? `${options.protocol ?? 'https:'}//${options.hostname ?? options.host}${options.port ? `:${options.port}` : ''}${options.path ?? '/'}`;
  const entry = { url: requestUrl, options, destroyed: false, response: undefined };
  requests.push(entry);
  const request = new EventEmitter();
  request.setTimeout = (_timeout, onTimeout) => { if (onTimeout) request.once('timeout', onTimeout); return request; };
  request.destroy = error => {
    if (entry.destroyed) return request;
    entry.destroyed = true;
    entry.response?.destroy();
    if (error) queueMicrotask(() => request.emit('error', error));
    return request;
  };
  if (options.signal) {
    const abort = () => request.destroy(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
  }
  request.end = () => {
    queueMicrotask(async () => {
      try {
        if (entry.destroyed) return;
        const hostname = url?.hostname.replace(/^\[|\]$/g, '') ?? options.hostname ?? options.host;
        if (typeof options.lookup === 'function') {
          const result = await new Promise((resolve, reject) => options.lookup(hostname, {}, (error, address, family) => {
            if (error) reject(error); else resolve({ address, family });
          }));
          connections.push({ hostname, ...result });
        } else {
          connections.push({ hostname, address: hostname, family: hostname.includes(':') ? 6 : 4 });
        }
        const scenario = responses.get(requestUrl);
        assert.ok(scenario, `unexpected outbound request: ${requestUrl}`);
        if (scenario.hang) return;
        if (scenario.error) { request.emit('error', scenario.error); return; }
        const response = new PassThrough();
        response.statusCode = scenario.statusCode;
        response.headers = scenario.headers;
        entry.response = response;
        if (callback) callback(response);
        request.emit('response', response);
        if (scenario.onResponse) scenario.onResponse();
        for (const chunk of scenario.chunks ?? []) {
          if (!response.destroyed) response.write(chunk);
        }
        if (!response.destroyed && !scenario.hangBody) response.end();
      } catch (error) {
        request.emit('error', error);
      }
    });
    return request;
  };
  return request;
}
http.request = mockRequest;
https.request = mockRequest;
globalThis.fetch = async () => { throw new Error('Unexpected unmocked fetch transport in PDF security check.'); };

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
    files: [path.join(root, 'lib/serverStore.ts'), path.join(root, 'lib/remotePdf.ts')]
  }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  Module._resolveFilename = function (request, parent, ...args) {
    if (request.startsWith('@/')) request = path.join(out, request.slice(2));
    return originalResolve.call(this, request, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
  };

  const { fetchPublicPdf, isPublicIpAddress } = require(path.join(out, 'lib/remotePdf.js'));
  const retrieve = (url, options = {}) => fetchPublicPdf(url, { maxBytes: 1024, timeoutMs: 1000, ...options });
  const withinDeadline = async promise => {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Test guard: retrieval did not honor its timeout')), 1500);
      })]);
    } finally {
      clearTimeout(timer);
    }
  };

  // Check the actual resolver and transport path for literals, alternate IPv4
  // encodings, and DNS records. No blocked address may reach request().
  const blockedAddresses = [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '100.64.0.1', '100.127.255.254',
    '127.0.0.1', '168.63.129.16', '169.254.169.254', '172.16.0.1', '172.31.255.254', '192.168.1.1',
    '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.19.255.254', '198.51.100.1',
    '203.0.113.1', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:93.184.216.34',
    '64:ff9b::7f00:1', '64:ff9b:1::a00:1', '100::1', '2001::1', '2001:2::1',
    '2001:db8::1', '2002:7f00:1::', '3fff::1'
  ];
  for (const address of blockedAddresses) {
    assert.equal(isPublicIpAddress(address), false, `${address} is not a public internet address`);
    resetNetwork();
    const hostname = address.includes(':') ? `[${address}]` : address;
    await assert.rejects(retrieve(`http://${hostname}/paper.pdf`), /public internet/i, `block literal ${address}`);
    assert.equal(requests.length, 0, `blocked literal ${address} must not open a request`);
    assert.equal(lookups.length, 0, 'literal addresses do not require DNS');
    resetNetwork();
    resolveAs('blocked.example.test', address);
    await assert.rejects(retrieve('https://blocked.example.test/paper.pdf'), /public internet/i, `block DNS answer ${address}`);
    assert.equal(requests.length, 0, `blocked DNS answer ${address} must not open a request`);
  }
  for (const encoded of ['2130706433', '0177.0.0.1', '0x7f000001', '127.1']) {
    resetNetwork();
    await assert.rejects(retrieve(`http://${encoded}/paper.pdf`), /public internet/i, `block encoded loopback ${encoded}`);
    assert.equal(requests.length, 0);
  }
  for (const url of ['file:///etc/passwd', 'ftp://public.example.test/paper.pdf', 'not a URL', 'https://user:password@public.example.test/paper.pdf']) {
    resetNetwork();
    await assert.rejects(retrieve(url), /HTTP|credentials/i);
    assert.equal(requests.length, 0);
    assert.equal(lookups.length, 0);
  }
  resetNetwork();
  resolveAs('mixed.example.test', publicAddress, '127.0.0.1');
  await assert.rejects(retrieve('https://mixed.example.test/paper.pdf'), /public internet/i, 'all DNS answers must be safe');
  assert.equal(requests.length, 0);
  resetNetwork();
  resolveAs('mixed.example.test', publicAddress, 'fd00::1');
  await assert.rejects(retrieve('https://mixed.example.test/paper.pdf'), /public internet/i, 'mixed IPv4/IPv6 answers must all be safe');
  assert.equal(requests.length, 0);
  resetNetwork();
  dnsAnswers.set('empty.example.test', []);
  await assert.rejects(retrieve('https://empty.example.test/paper.pdf'));
  assert.equal(requests.length, 0, 'empty DNS results cannot trigger a request');
  resetNetwork();
  dnsAnswers.set('missing.example.test', Object.assign(new Error('DNS resolution failed'), { code: 'ENOTFOUND' }));
  await assert.rejects(retrieve('https://missing.example.test/paper.pdf'), /DNS resolution failed/);
  assert.equal(requests.length, 0);

  // DNS rebinding is prevented by connecting to the validated address, while
  // keeping the original hostname for Host and TLS certificate verification.
  resetNetwork();
  resolveAs('public.example.test', publicAddress);
  serve('https://public.example.test/paper.pdf', {
    headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="published.pdf"' },
    onResponse: () => resolveAs('public.example.test', '127.0.0.1')
  });
  const retrieved = await retrieve('https://public.example.test/paper.pdf');
  assert.deepEqual(retrieved.buffer, pdf);
  assert.equal(retrieved.contentDisposition, 'attachment; filename="published.pdf"');
  assert.equal(lookups.length, 1, 'the transport must not resolve the hostname again');
  assert.equal(lookups[0].options.all, true, 'validate every returned DNS address');
  assert.equal(requests[0].options.agent, false, 'do not reuse a connection outside the validated destination');
  assert.equal(requests[0].url, 'https://public.example.test/paper.pdf', 'preserve the hostname for TLS and Host');
  assert.deepEqual(connections, [{ hostname: 'public.example.test', address: publicAddress, family: 4 }]);
  assert.equal(typeof requests[0].options.lookup, 'function', 'the connection is pinned through a custom lookup');
  for (const address of [publicAddress, '2606:4700:4700::1111']) {
    resetNetwork();
    assert.equal(isPublicIpAddress(address), true);
    const url = `https://${address.includes(':') ? `[${address}]` : address}/paper.pdf`;
    serve(url);
    assert.deepEqual((await retrieve(url)).buffer, pdf);
    assert.equal(lookups.length, 0, 'public IP literals do not need DNS');
  }
  for (const address of ['100.128.0.1', '172.32.0.1', '192.0.1.1', '198.20.0.1', '223.255.255.254', '2001:4860:4860::8888']) {
    assert.equal(isPublicIpAddress(address), true, `do not overblock neighboring public ranges: ${address}`);
  }

  // Every redirect destination is independently resolved and checked, including
  // relative links and redirects back to a hostname whose DNS answer changed.
  for (const location of ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', '//private.example.test/paper.pdf', 'https://user:secret@public.example.test/paper.pdf', 'file:///etc/passwd']) {
    resetNetwork();
    resolveAs('redirect.example.test', publicAddress);
    resolveAs('private.example.test', '192.168.1.1');
    serve('https://redirect.example.test/start.pdf', { statusCode: 302, headers: { location }, chunks: [] });
    await assert.rejects(retrieve('https://redirect.example.test/start.pdf'), /public internet|credentials|HTTP/i);
    assert.equal(requests.length, 1, `unsafe redirect must not be requested: ${location}`);
    assert.ok(requests[0].response.destroyed, 'close the redirect response');
  }
  resetNetwork();
  resolveAs('relative.example.test', publicAddress);
  resolveAs('cdn.example.test', '1.1.1.1');
  serve('https://relative.example.test/papers/start.pdf', { statusCode: 302, headers: { location: '../download.pdf' }, chunks: [] });
  serve('https://relative.example.test/download.pdf', { statusCode: 307, headers: { location: 'http://cdn.example.test/final.pdf' }, chunks: [] });
  serve('http://cdn.example.test/final.pdf');
  assert.deepEqual((await retrieve('https://relative.example.test/papers/start.pdf')).buffer, pdf);
  assert.deepEqual(lookups.map(item => item.hostname), ['relative.example.test', 'relative.example.test', 'cdn.example.test']);
  assert.equal(requests.length, 3, 'relative, absolute, and HTTP links can retrieve public PDFs');
  for (const statusCode of [301, 303, 308]) {
    resetNetwork();
    resolveAs('redirect-code.example.test', publicAddress);
    serve('https://redirect-code.example.test/start.pdf', { statusCode, headers: { location: '/final.pdf' }, chunks: [] });
    serve('https://redirect-code.example.test/final.pdf');
    assert.deepEqual((await retrieve('https://redirect-code.example.test/start.pdf')).buffer, pdf, `support HTTP ${statusCode} redirects`);
    assert.equal(requests.length, 2);
  }
  resetNetwork();
  resolveAs('missing-location.example.test', publicAddress);
  serve('https://missing-location.example.test/start.pdf', { statusCode: 302, headers: {}, chunks: [] });
  await assert.rejects(retrieve('https://missing-location.example.test/start.pdf'), /destination/i);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].response.destroyed);
  resetNetwork();
  resolveAs('rebind.example.test', publicAddress);
  serve('https://rebind.example.test/start.pdf', {
    statusCode: 302, headers: { location: '/redirected.pdf' }, chunks: [],
    onResponse: () => resolveAs('rebind.example.test', '127.0.0.1')
  });
  await assert.rejects(retrieve('https://rebind.example.test/start.pdf'), /public internet/i);
  assert.equal(requests.length, 1, 'a redirect revalidates even the same hostname');
  resetNetwork();
  resolveAs('loop.example.test', publicAddress);
  serve('https://loop.example.test/loop.pdf', { statusCode: 302, headers: { location: '/loop.pdf' }, chunks: [] });
  await assert.rejects(retrieve('https://loop.example.test/loop.pdf'), /redirect/i);
  assert.ok(requests.length <= 6, 'redirect chains have a finite request limit');
  assert.ok(requests.every(request => request.response.destroyed));

  // The security transport retains streaming limits, status checks, and an
  // end-to-end deadline instead of trusting response metadata.
  for (const scenario of [
    { statusCode: 404, headers: {}, chunks: [], expected: /HTTP 404/i },
    { headers: { 'content-length': '2048' }, chunks: [], expected: /size limit/i },
    { headers: {}, chunks: [Buffer.alloc(600), Buffer.alloc(600)], expected: /size limit/i }
  ]) {
    resetNetwork();
    resolveAs('bounded.example.test', publicAddress);
    serve('https://bounded.example.test/paper.pdf', scenario);
    await assert.rejects(retrieve('https://bounded.example.test/paper.pdf'), scenario.expected);
    assert.ok(requests[0].response.destroyed, 'rejected responses must be closed');
  }
  resetNetwork();
  resolveAs('truncated.example.test', publicAddress);
  serve('https://truncated.example.test/paper.pdf', {
    onResponse: () => requests[0].response.destroy(new Error('Truncated PDF response'))
  });
  await assert.rejects(retrieve('https://truncated.example.test/paper.pdf'), /Truncated PDF response/);
  assert.ok(requests[0].response.destroyed);
  resetNetwork();
  resolveAs('timeout.example.test', publicAddress);
  serve('https://timeout.example.test/paper.pdf', { hang: true });
  await assert.rejects(withinDeadline(retrieve('https://timeout.example.test/paper.pdf', { timeoutMs: 25 })), /timed out/i);
  assert.ok(requests[0].destroyed, 'timeout aborts the active request');
  resetNetwork();
  dnsAnswers.set('dns-timeout.example.test', new Promise(() => {}));
  await assert.rejects(withinDeadline(retrieve('https://dns-timeout.example.test/paper.pdf', { timeoutMs: 25 })), /timed out/i);
  assert.equal(requests.length, 0, 'a DNS timeout cannot open a request');
  resetNetwork();
  resolveAs('body-timeout.example.test', publicAddress);
  serve('https://body-timeout.example.test/paper.pdf', { chunks: [pdf.subarray(0, 5)], hangBody: true });
  await assert.rejects(withinDeadline(retrieve('https://body-timeout.example.test/paper.pdf', { timeoutMs: 25 })), /timed out/i);
  assert.ok(requests[0].destroyed, 'timeout aborts a partially received body');
  assert.ok(requests[0].response.destroyed);

  // Exercise the real citation import rather than only the network helper:
  // blocked retrieval remains a failed link without losing the study metadata.
  process.env.PRISMATICA_DATA_FILE = path.join(temp, 'state.json');
  process.env.PRISMATICA_STORAGE_MODE = 'file';
  process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER = 'local';
  process.env.PRISMATICA_ADMIN_EMAIL = 'pdf-security@example.test';
  process.env.PRISMATICA_ADMIN_PASSWORD = 'isolated-pdf-security-password';
  const store = require(path.join(out, 'lib/serverStore.js'));
  const seeds = require(path.join(out, 'lib/prismaData.js'));
  const admin = { id: 'admin-root', name: 'PDF Security Admin', email: 'pdf-security@example.test', isAdmin: true, passwordHash: 'test', passwordSalt: 'test', initials: 'PA', organization: 'Test', title: '', timezone: 'UTC', avatarColor: '#000' };
  const project = { ...seeds.reviewProjects[0], id: 'pdf-security-project', ownerId: admin.id, ownerIds: [admin.id], memberIds: [], recordsTotal: 0, stage: 'setup', blindMode: false };
  fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify({
    version: 1, users: [admin], projects: [project], authSettings: { registrationEnabled: true, transactionalEmailEnabled: false }, reviewSettings: {},
    studies: [], reports: [], imports: [], decisions: [], extractionTemplates: [], extractionResponses: [], extractionConsensus: [], screeningCheckouts: [], dedupCandidates: [], events: []
  }));
  resetNetwork();
  resolveAs('publisher.example.test', publicAddress);
  resolveAs('private.example.test', '10.0.0.1');
  serve('https://publisher.example.test/valid.pdf');
  serve('https://publisher.example.test/bounce.pdf', { statusCode: 302, headers: { location: 'http://127.0.0.1/private.pdf' }, chunks: [] });
  serve('https://publisher.example.test/not-pdf.pdf', { chunks: [Buffer.from('<html>This is not a PDF.</html>')] });
  const citations = [
    ['loopback', 'Loopback citation', 'http://127.0.0.1/paper.pdf'],
    ['private', 'Private DNS citation', 'https://private.example.test/paper.pdf'],
    ['redirect', 'Private redirect citation', 'https://publisher.example.test/bounce.pdf'],
    ['valid', 'Public PDF citation', 'https://publisher.example.test/valid.pdf'],
    ['invalid', 'Invalid PDF citation', 'https://publisher.example.test/not-pdf.pdf']
  ];
  const payload = await store.createImportBatchForUser(admin.id, project.id, {
    format: 'bib', filename: 'pdf-security.bib',
    content: citations.map(([key, title, url]) => `@article{${key}, title={${title}}, author={Researcher, Example}, year={2024}, pdf={${url}}}`).join('\n')
  });
  const persisted = JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, 'utf8'));
  const batch = persisted.imports.find(item => item.filename === 'pdf-security.bib');
  assert.equal(batch.records, 5);
  assert.equal(batch.pdfLinks, 5);
  assert.equal(batch.pdfsRetrieved, 1);
  assert.equal(batch.pdfRetrievalFailures, 4);
  assert.equal(persisted.studies.length, 5, 'failed PDF retrieval does not discard citations');
  for (const [key, title, url] of citations) {
    const study = persisted.studies.find(item => item.title === title);
    assert.ok(study, `${key} citation metadata survives`);
    assert.equal(study.pdfUrl, url);
    assert.match(study.rawCitation, new RegExp(`@article\\{${key},`));
    const report = persisted.reports.find(item => item.studyId === study.id);
    assert.equal(report.sourcePdfUrl, url);
    if (key === 'valid') {
      assert.equal(report.retrievalStatus, 'retrieved');
      assert.equal(report.isPdfValidated, true);
      assert.deepEqual(fs.readFileSync(report.storagePath), pdf);
    } else {
      assert.equal(report.retrievalStatus, 'sought');
      assert.equal(report.isPdfValidated, false);
      assert.ok(!report.storagePath);
      assert.match(report.validationNotes[0], key === 'invalid' ? /PDF header is not readable/i : /public internet/i);
    }
  }
  assert.equal(requests.length, 3, 'only public destinations are requested during the import');
  assert.ok(connections.every(connection => connection.address === publicAddress));
  assert.match(payload.message, /1 of 5 linked PDFs retrieved/);
  console.log('PDF retrieval security checks passed: public address validation, private and encoded destinations, mixed DNS, connection pinning, redirects, limits, timeouts, PDF validation, and citation retention.');
} finally {
  Module._resolveFilename = originalResolve;
  dns.lookup = originalLookup;
  http.request = originalHttpRequest;
  https.request = originalHttpsRequest;
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
