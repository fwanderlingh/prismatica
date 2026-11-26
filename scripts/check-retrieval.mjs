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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-retrieval-'));
const originalResolve = Module._resolveFilename;
const originalEnv = { ...process.env };
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
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  Module._resolveFilename = function (request, parent, ...args) {
    if (request.startsWith('@/')) request = path.join(out, request.slice(2));
    return originalResolve.call(this, request, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, 'node_modules')] }, ...args);
  };
  process.env.PRISMATICA_DATA_FILE = path.join(temp, 'state.json');
  process.env.PRISMATICA_STORAGE_MODE = 'file';
  process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER = 'local';
  process.env.PRISMATICA_ADMIN_EMAIL = 'retrieval@example.test';
  process.env.PRISMATICA_ADMIN_PASSWORD = 'isolated-retrieval-test-password';
  const store = require(path.join(out, 'lib/serverStore.js'));
  const seeds = require(path.join(out, 'lib/prismaData.js'));
  const selectors = require(path.join(out, 'lib/workflowSelectors.js'));
  const admin = { id: 'admin-root', name: 'Retrieval Admin', email: 'retrieval@example.test', isAdmin: true, passwordHash: 'test', passwordSalt: 'test', initials: 'RA', organization: 'Test', title: '', timezone: 'UTC', avatarColor: '#000' };
  const project = { ...seeds.reviewProjects[0], id: 'retrieval-project', ownerId: admin.id, ownerIds: [admin.id], memberIds: [], recordsTotal: 1, recordsScreened: 1, abstractRequiredVotes: 1, fullTextRequiredVotes: 1, exclusionReasons: ['Wrong population'], stage: 'full_text' };
  const study = { ...seeds.screeningStudies[0], id: 'retrieval-study', projectId: project.id, stage: 'full_text' };
  const report = { id: 'retrieval-report', projectId: project.id, studyId: study.id, title: study.title, citation: 'Test citation', retrievalStatus: 'not_sought', notes: 0, isPdfValidated: false, validationNotes: [] };
  function reset() {
    const abstractDecision = { id: 'abstract-decision', projectId: project.id, studyId: study.id, userId: admin.id, userName: admin.name, stage: 'title_abstract', decisionValue: 'include', isCurrent: true, createdAt: new Date().toISOString() };
    fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify({ version: 1, users: [admin], projects: [project], studies: [study], reports: [report], imports: [], decisions: [abstractDecision], extractionTemplates: [], extractionResponses: [], extractionConsensus: [], screeningCheckouts: [], dedupCandidates: [], reviewSettings: {}, events: [] }));
  }
  const update = input => store.updateReportForUser(admin.id, project.id, report.id, input);
  const currentReport = payload => payload.reports.find(item => item.id === report.id);

  // Exercise the production selector and save handler together, including persistence failures.
  const parser = require('next/dist/compiled/babel/parser');
  const babel = require('next/dist/compiled/babel/core');
  const appSource = fs.readFileSync(path.join(root, 'components/prisma-review-app.tsx'), 'utf8');
  const sectionSource = fs.readFileSync(path.join(root, 'components/review-sections/full-text-section.tsx'), 'utf8');
  const parse = source => parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  function findNode(node, matches) {
    if (!node || typeof node !== 'object') return;
    if (matches(node)) return node;
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        const found = findNode(child, matches);
        if (found) return found;
      }
    }
  }
  const saveNode = findNode(parse(appSource), node => node.type === 'FunctionDeclaration' && node.id?.name === 'updateFullTextReport');
  const selectNode = findNode(parse(sectionSource), node => node.type === 'JSXOpeningElement' &&
    node.name?.name === 'select' && node.attributes.some(attribute => attribute.name?.name === 'id' && attribute.value?.value === 'retrieval-status'));
  const changeNode = selectNode.attributes.find(attribute => attribute.name?.name === 'onChange').value.expression;
  function handler(source, node, scope) {
    const code = babel.transformSync(`return (${source.slice(node.start, node.end)});`, {
      filename: 'retrieval-handler.ts', babelrc: false, configFile: false,
      parserOpts: { allowReturnOutsideFunction: true },
      presets: [require('next/dist/compiled/babel/preset-typescript')]
    }).code;
    return new Function(...Object.keys(scope), code)(...Object.values(scope));
  }
  for (const fails of [false, true]) {
    reset();
    const activeReport = { ...report }, requests = [], pending = [], messages = [], localSelections = [], moved = [];
    let saving;
    const save = handler(appSource, saveNode, {
      activeReport, selectedProject: project,
      setPendingFullTextAction: value => pending.push(value), setFullTextMessage: value => messages.push(value),
      apiRequest: async (url, init) => {
        requests.push({ url, method: init.method, body: JSON.parse(init.body) });
        if (fails) throw new Error('Retrieval status could not be saved.');
        return update(JSON.parse(init.body));
      },
      applyAppState: payload => Object.assign(activeReport, currentReport(payload)),
      setActiveReportId: value => moved.push(value), setSavedQueueDecision: value => moved.push(value),
      getErrorMessage: error => error.message
    });
    const select = handler(sectionSource, changeNode, {
      activeReport, setFullTextMessage: value => messages.push(value),
      setRetrievalStatus: value => localSelections.push(value),
      updateFullTextReport: input => { saving = save(input); }
    });
    select({ target: { value: 'sought' } });
    assert.deepEqual(requests, [{ url: `/api/projects/${project.id}/reports/${report.id}`, method: 'PATCH', body: { retrievalStatus: 'sought' } }], 'selecting in progress immediately sends a status-only save');
    assert.deepEqual(pending, ['retrieval'], 'saving feedback begins before the request completes');
    assert.deepEqual(localSelections, [], 'the selection waits for server confirmation');
    await saving;
    assert.deepEqual(pending, ['retrieval', null]);
    assert.equal(messages.at(-1), fails ? 'Retrieval status could not be saved.' : 'Retrieval status updated.');
    const refreshed = store.getAppStateForUser(admin.id);
    assert.equal(currentReport(refreshed).retrievalStatus, fails ? 'not_sought' : 'sought', 'the saved status survives reloading');
    assert.equal(refreshed.decisions.filter(item => item.stage === 'full_text').length, 0);
    assert.equal(selectors.getActiveFullTextReports(project, refreshed.reports, refreshed.decisions, admin.id).length, 1);
    assert.equal(selectors.getCountsForProject(project, refreshed.studies, refreshed.reports, refreshed.decisions).reportsSought, fails ? 0 : 1);
    assert.deepEqual(moved, [], 'saving progress leaves the reviewer on this report');
    for (const retrievalStatus of ['retrieved', 'not_retrieved', 'not_sought']) {
      select({ target: { value: retrievalStatus } });
    }
    assert.deepEqual(localSelections, ['retrieved', 'not_retrieved', 'not_sought'], 'other choices retain their existing confirmation flow');
    if (!fails) {
      select({ target: { value: 'sought' } });
      assert.equal(localSelections.at(-1), 'sought', 'returning to an already saved status restores the selection');
    }
    assert.equal(requests.length, 1);
  }

  reset();
  for (const retrievalStatus of ['not_sought', 'sought', 'not_retrieved']) {
    update({ retrievalStatus });
    for (const decisionValue of ['include', 'exclude']) {
      assert.throws(() => update({ decisionValue, exclusionReasonId: 'Wrong population' }), /full text is retrieved/);
    }
  }
  assert.throws(() => update({ retrievalStatus: 'invalid' }), /valid retrieval status/);

  reset();
  store.updateScreeningCheckoutForUser(admin.id, { projectId: project.id, stage: 'full_text', reportId: report.id, action: 'acquire' });
  let payload = update({ retrievalStatus: 'not_retrieved' });
  assert.equal(payload.decisions.filter(item => item.stage === 'full_text').length, 0, 'unavailable reports do not create exclusion votes');
  assert.equal(selectors.getActiveFullTextReports(project, payload.reports, payload.decisions, admin.id).length, 0);
  assert.equal(selectors.isFullTextReportComplete(currentReport(payload), project), true);
  assert.equal(JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE)).screeningCheckouts.length, 0);
  store.updateScreeningCheckoutForUser(admin.id, { projectId: project.id, stage: 'full_text', reportId: report.id });
  assert.equal(JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE)).screeningCheckouts.length, 0, 'closed retrieval cannot be checked out');
  payload = store.reopenFullTextDecisionForUser(admin.id, project.id, report.id);
  assert.equal(currentReport(payload).retrievalStatus, 'sought');
  assert.equal(selectors.getActiveFullTextReports(project, payload.reports, payload.decisions, admin.id).length, 1);
  assert.equal(selectors.isFullTextReportComplete(currentReport(payload), project), false);

  // Reading a full text outside the app is sufficient; no PDF upload is required.
  payload = update({ retrievalStatus: 'retrieved', decisionValue: 'include' });
  assert.equal(payload.decisions.filter(item => item.stage === 'full_text' && item.isCurrent).length, 1);
  for (const retrievalStatus of ['not_sought', 'sought', 'not_retrieved']) {
    assert.throws(() => update({ retrievalStatus }), /must remain retrieved/);
  }
  store.reopenFullTextDecisionForUser(admin.id, project.id, report.id);
  update({ retrievalStatus: 'sought' });
  payload = update({ retrievalStatus: 'retrieved', decisionValue: 'exclude', exclusionReasonId: 'Wrong population' });
  const pendingCounts = selectors.getCountsForProject(payload.projects[0], payload.studies, payload.reports, payload.decisions);
  assert.equal(pendingCounts.reportsAssessed, 1);
  assert.equal(pendingCounts.reportsExcludedWithReasons['Wrong population'], 0, 'one vote cannot finalize a report requiring two independent reviews');
  const secondReviewer = { ...admin, id: 'retrieval-second-reviewer', email: 'retrieval-second@example.test', isAdmin: false };
  const stateWithSecondReviewer = JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, 'utf8'));
  stateWithSecondReviewer.users.push(secondReviewer);
  stateWithSecondReviewer.projects[0].memberIds.push(secondReviewer.id);
  fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(stateWithSecondReviewer));
  payload = store.updateReportForUser(secondReviewer.id, project.id, report.id, { decisionValue: 'exclude', exclusionReasonId: 'Wrong population' });
  const assessedCounts = selectors.getCountsForProject(payload.projects[0], payload.studies, payload.reports, payload.decisions);
  assert.equal(assessedCounts.reportsAssessed, 1);
  assert.equal(assessedCounts.reportsNotRetrieved, 0);
  assert.equal(assessedCounts.reportsExcludedWithReasons['Wrong population'], 1);

  reset();
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
  payload = await store.uploadReportPdfForUser(admin.id, project.id, report.id, { fileName: 'test.pdf', mimeType: 'application/pdf', size: pdf.length, contentBase64: pdf.toString('base64') });
  assert.equal(currentReport(payload).retrievalStatus, 'retrieved');
  assert.ok(currentReport(payload).storagePath.startsWith(temp));
  assert.throws(() => update({ retrievalStatus: 'not_retrieved' }), /must remain retrieved/);
  await store.deleteReportPdfForUser(admin.id, project.id, report.id);
  update({ retrievalStatus: 'not_retrieved' });

  const reports = ['not_sought', 'sought', 'retrieved', 'not_retrieved'].map((retrievalStatus, index) => ({ ...report, id: `report-${index}`, retrievalStatus }));
  const counts = selectors.getCountsForProject(project, [study], reports);
  assert.equal(counts.reportsSought, 3, 'sought includes successful and unsuccessful retrieval attempts');
  assert.equal(counts.reportsNotRetrieved, 1);
  assert.equal(counts.reportsAssessed, 0);
  assert.equal(selectors.getProjectPhaseProgress(project, counts, reports, String).percent, 25);
  // Exercise phase gating with real server summaries and hidden decisions.
  reset();
  const blindState = JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE));
  const reviewer = { ...admin, id: 'blind-reviewer', email: 'blind@example.test', isAdmin: false };
  const voter = { ...reviewer, id: 'second-voter', email: 'voter@example.test' };
  blindState.users.push(reviewer, voter);
  blindState.projects[0].memberIds = [reviewer.id, voter.id];
  blindState.projects[0].blindMode = true;
  fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(blindState));
  const phaseAccess = state => selectors.getSequentialPhaseAccess({
    project: state.projects.find(item => item.id === project.id),
    studies: state.studies.filter(item => item.projectId === project.id),
    reports: state.reports.filter(item => item.projectId === project.id),
    decisions: state.decisions, dedupCandidates: [], recordsIdentified: 1, studiesIncluded: 1
  });
  let blindPayload = store.getAppStateForUser(reviewer.id);
  assert.equal(blindPayload.decisions.length, 0, 'blind reviewer cannot see the owner vote');
  assert.equal(phaseAccess(blindPayload).fullText, true, 'aggregate screening status unlocks full text');
  update({ retrievalStatus: 'retrieved', decisionValue: 'include' });
  assert.equal(phaseAccess(store.getAppStateForUser(reviewer.id)).extraction, false, 'one full-text vote is insufficient');
  store.updateScreeningCheckoutForUser(voter.id, { projectId: project.id, stage: 'full_text', reportId: report.id, action: 'acquire' });
  store.updateReportForUser(voter.id, project.id, report.id, { decisionValue: 'include' });
  blindPayload = store.getAppStateForUser(reviewer.id);
  assert.equal(blindPayload.decisions.length, 0);
  assert.equal(phaseAccess(blindPayload).extraction, true, 'aggregate full-text status unlocks extraction');
  store.reopenFullTextDecisionForUser(admin.id, project.id, report.id);
  assert.equal(phaseAccess(store.getAppStateForUser(reviewer.id)).extraction, false, 'reopening full text relocks extraction');
  store.reopenTitleAbstractDecisionForUser(admin.id, project.id, study.id);
  assert.equal(phaseAccess(store.getAppStateForUser(reviewer.id)).fullText, false, 'reopening screening relocks full text');
  reset();
  const staleState = JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE));
  staleState.projects[0].recordsTotal = 2;
  staleState.projects[0].stage = 'full_text';
  staleState.projects[0].requireSequentialPhases = true;
  staleState.studies.push({ ...study, id: 'unfinished-study', stage: 'title_abstract' });
  fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify(staleState));
  assert.equal(store.getAppStateForUser(admin.id).projects[0].stage, 'screening', 'resync persists the first unfinished sequential phase');
  assert.equal(JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE)).projects[0].stage, 'screening');
  // PostgreSQL reads skip the full resync: old stored stages must still be corrected in API responses.
  const childProcess = require('node:child_process');
  const originalExec = childProcess.execFileSync;
  try {
    process.env.PRISMATICA_STORAGE_MODE = 'postgres';
    childProcess.execFileSync = (_file, args) => {
      assert.equal(args[1], 'read', 'reading a stale stage must not rewrite the database');
      return JSON.stringify(staleState);
    };
    assert.equal(store.getAppStateForUser(admin.id).projects[0].stage, 'screening');
    staleState.projects[0].requireSequentialPhases = false;
    assert.equal(store.getAppStateForUser(admin.id).projects[0].stage, 'full_text', 'parallel phase labels remain unchanged');
  } finally {
    childProcess.execFileSync = originalExec;
    process.env.PRISMATICA_STORAGE_MODE = 'file';
  }
  console.log('Retrieval checks passed: immediate progress saves, save failures, decisions, PDFs, counts, queue completion, and reopening.');
} finally {
  Module._resolveFilename = originalResolve;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
