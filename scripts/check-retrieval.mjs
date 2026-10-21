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
  console.log('Retrieval checks passed: decisions, PDFs, counts, queue completion, and reopening.');
} finally {
  Module._resolveFilename = originalResolve;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
