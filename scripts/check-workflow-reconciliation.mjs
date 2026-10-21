import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const childProcess = require('node:child_process');
const { execFileSync } = childProcess;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prismatica-workflow-'));
const originalResolve = Module._resolveFilename;
const originalDate = globalThis.Date;
const originalEnv = { ...process.env };
let now = Date.parse('2026-10-20T12:00:00Z');
const failures = [];
let passed = 0;

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

  // Instrument the actual compiled functions; no copied workflow implementation
  // or production-only test exports are needed. Public mutations below use an
  // isolated in-memory state, separating their work from any read-time repair.
  const storePath = path.join(out, 'lib/serverStore.js');
  let source = fs.readFileSync(storePath, 'utf8');
  for (const [name, counter] of [
    ['syncProjectWorkflowCounts', 'summary'],
    ['syncExtractionConsensusForReport', 'consensus'],
    ['buildExtractionConsensusDraft', 'draft']
  ]) {
    const declaration = new RegExp(`function ${name}\\([^\\n]*\\) \\{`);
    assert.ok(declaration.test(source), `the measured production function ${name} exists`);
    source = source.replace(declaration, match => `${match}\n__workflowCounts.${counter} += 1;`);
  }
  source += `
const __workflowCounts = { summary: 0, consensus: 0, draft: 0 };
const __workflowOriginalRead = readState;
const __workflowOriginalWrite = writeState;
const __workflowOriginalCreateId = createId;
exports.__workflowTest = {
  resyncAllProjectWorkflowState, syncProjectWorkflowCounts, normalizeState,
  useState(state) { readState = () => state; writeState = () => {}; },
  restoreIo() { readState = __workflowOriginalRead; writeState = __workflowOriginalWrite; },
  resetIds() { let next = 0; createId = prefix => prefix + '-workflow-parity-' + (++next); },
  restoreIds() { createId = __workflowOriginalCreateId; },
  resetCounts() { for (const key of Object.keys(__workflowCounts)) __workflowCounts[key] = 0; },
  counts() { return { ...__workflowCounts }; }
};
`;
  fs.writeFileSync(storePath, source);
  process.env.PRISMATICA_STORAGE_MODE = 'file';
  process.env.PRISMATICA_DATA_FILE = path.join(temp, 'unused-state.json');
  process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER = 'local';
  globalThis.Date = class extends originalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const store = require(storePath);
  const internals = store.__workflowTest;
  const seeds = require(path.join(out, 'lib/prismaData.js'));
  const stamp = () => new Date(now - 86_400_000).toISOString();
  const reviewer = (id, name) => ({
    id, name, email: `${id}@example.test`, isAdmin: false, initials: id.slice(0, 2),
    organization: 'Test', title: 'Reviewer', timezone: 'UTC', avatarColor: '#000',
    passwordHash: 'isolated-unused-hash', passwordSalt: 'isolated-unused-salt', createdAt: stamp(), updatedAt: stamp()
  });
  const users = [reviewer('reviewer-a', 'Reviewer A'), reviewer('reviewer-b', 'Reviewer B')];
  const owner = users[0].id;
  const peer = users[1].id;
  const projectId = 'workflow-project';
  const templateId = 'workflow-template';
  const studyId = 'study-0';
  const reportId = 'report-0';

  function fixture(count = 1, completed = true) {
    const state = {
      version: 1, users: structuredClone(users),
      authSettings: { registrationEnabled: true, transactionalEmailEnabled: false },
      reviewSettings: { auditHistoryLimit: 100, screeningCheckoutWindowMinutes: 60, extractionCheckoutWindowMinutes: 120 },
      projects: [{
        ...structuredClone(seeds.reviewProjects[0]), id: projectId, title: 'Workflow fixture',
        ownerId: owner, ownerIds: [owner], memberIds: [owner, peer],
        recordsTotal: count, recordsScreened: completed ? count : 0, studiesIncluded: 0,
        abstractRequiredVotes: 2, fullTextRequiredVotes: 2, extractionRequiredVotes: 2,
        exclusionReasons: ['Wrong population'], maybePolicy: 'conflict', requireSequentialPhases: false,
        blindMode: false, updatedAt: '19-10-2026', status: 'active', stage: 'screening'
      }],
      studies: [], reports: [], imports: [], decisions: [], extractionResponses: [], extractionConsensus: [],
      screeningCheckouts: [], dedupCandidates: [], events: [],
      extractionTemplates: [{
        id: templateId, projectId, title: 'Data template', version: 1,
        fields: [{ id: 'outcome', title: 'Outcome', type: 'multiline_text', options: [] }],
        createdByUserId: owner, createdByUserName: users[0].name,
        createdAt: stamp(), updatedAt: stamp(), isActive: true
      }]
    };
    for (let index = 0; index < count; index += 1) {
      const study = {
        ...structuredClone(seeds.screeningStudies[0]), id: `study-${index}`, projectId,
        importItemId: index + 1, title: `Distinct workflow study ${index}`,
        stage: completed ? 'extraction' : 'title_abstract'
      };
      state.studies.push(study);
      if (!completed) continue;
      const report = {
        id: `report-${index}`, projectId, studyId: study.id, title: study.title, citation: 'Fixture citation',
        retrievalStatus: 'retrieved', isPdfValidated: false, validationNotes: [], notes: 0
      };
      state.reports.push(report);
      for (const user of users) {
        for (const stage of ['title_abstract', 'full_text']) {
          state.decisions.push({
            id: `${stage}-${index}-${user.id}`, projectId, studyId: study.id,
            reportId: stage === 'full_text' ? report.id : undefined,
            userId: user.id, userName: user.name, stage,
            decisionValue: 'include', isCurrent: true, createdAt: stamp()
          });
        }
        state.extractionResponses.push({
          id: `response-${index}-${user.id}`, projectId, studyId: study.id, reportId: report.id,
          templateId, userId: user.id, userName: user.name, values: { outcome: 'Improved' },
          isSubmitted: true, createdAt: stamp(), updatedAt: stamp(), submittedAt: stamp()
        });
      }
    }
    return state;
  }

  const use = state => { internals.useState(state); internals.resetCounts(); return state; };
  const reconcile = state => internals.resyncAllProjectWorkflowState(state);
  const counts = (expected, message) => assert.deepEqual(internals.counts(), expected, message);
  const submit = (userId, value) => store.saveExtractionResponseForUser(userId, projectId, {
    reportId, templateId, studyId, values: { outcome: value }
  });
  const vote = (userId, decisionValue = 'include') => store.addScreeningDecisionForUser(userId, { projectId, studyId, decisionValue });
  function test(name, run) {
    try { run(); passed += 1; }
    catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message.slice(0, 1800)}`); }
  }

  test('screening votes create a report only at the threshold; undo and reopen reverse an unused report', () => {
    const state = use(fixture(1, false));
    vote(owner);
    assert.equal(state.studies[0].stage, 'title_abstract');
    assert.equal(state.reports.length, 0);
    vote(peer);
    assert.equal(state.studies[0].stage, 'full_text');
    assert.equal(state.reports.length, 1);
    store.undoScreeningDecisionForUser(peer, { projectId, studyId });
    assert.equal(state.studies[0].stage, 'title_abstract');
    assert.equal(state.reports.length, 0);
    vote(peer);
    const createdReport = state.reports[0].id;
    store.reopenTitleAbstractDecisionForUser(owner, projectId, studyId);
    assert.equal(state.studies[0].stage, 'title_abstract');
    assert.ok(!state.reports.some(report => report.id === createdReport));
  });

  test('screening reopen retains an imported PDF and unchanged reconciliation adds no audit events', () => {
    const state = use(fixture(1, false));
    state.studies[0].pdfUrl = 'https://example.test/imported.pdf';
    vote(owner);
    vote(peer);
    const importedReport = structuredClone(state.reports[0]);
    store.reopenTitleAbstractDecisionForUser(peer, projectId, studyId);
    assert.equal(state.studies[0].stage, 'title_abstract');
    assert.equal(state.reports[0].id, importedReport.id);
    assert.equal(state.reports[0].sourcePdfUrl, importedReport.sourcePdfUrl);
    const before = structuredClone(state);
    now += 86_400_000;
    reconcile(state);
    assert.deepEqual(state, before, 'retained imported PDFs must not append repeated return-to-screening events or change summary timestamps');
  });

  test('full-text reopening clears consensus and returns extraction to full-text without deleting submissions', () => {
    const state = use(fixture());
    reconcile(state);
    assert.equal(state.extractionConsensus[0].status, 'finalized');
    internals.resetCounts();
    store.reopenFullTextDecisionForUser(peer, projectId, reportId);
    assert.equal(state.studies[0].stage, 'full_text');
    assert.equal(state.extractionConsensus.length, 0);
    assert.equal(state.extractionResponses.length, 2);
    assert.equal(state.reports[0].id, reportId);
    assert.equal(internals.counts().summary, 1);
    store.updateReportForUser(peer, projectId, reportId, { decisionValue: 'include' });
    assert.equal(state.studies[0].stage, 'extraction');
    assert.equal(state.extractionConsensus[0].status, 'finalized');
    store.updateReportForUser(peer, projectId, reportId, { decisionValue: 'exclude', exclusionReasonId: 'Wrong population' });
    assert.equal(state.studies[0].stage, 'full_text');
    assert.equal(state.extractionConsensus.length, 0, 'leaving extraction also cleans stale finalized consensus');
  });

  test('extraction submission and reopen each synchronize once and calculate one draft', () => {
    const state = fixture();
    state.extractionResponses.pop();
    use(state);
    submit(peer, 'Improved');
    assert.equal(state.extractionConsensus[0].status, 'finalized');
    assert.equal(state.projects[0].stage, 'complete');
    counts({ summary: 1, consensus: 1, draft: 1 }, 'only the affected report computes a draft; the summary does not');
    internals.resetCounts();
    store.reopenExtractionResponseForUser(peer, projectId, reportId);
    assert.equal(state.extractionConsensus.length, 0);
    assert.equal(state.projects[0].stage, 'extraction');
    counts({ summary: 1, consensus: 1, draft: 1 }, 'only the reopened report computes a draft; the summary does not');
  });

  test('resubmitting one extraction among ten completed reports only recalculates the affected report', () => {
    const state = use(fixture(10));
    reconcile(state);
    const otherConsensus = structuredClone(state.extractionConsensus.filter(consensus => consensus.reportId !== reportId));
    now += 1000;
    internals.resetCounts();
    submit(peer, 'Improved');
    assert.equal(state.projects[0].stage, 'complete');
    assert.deepEqual(state.extractionConsensus.filter(consensus => consensus.reportId !== reportId), otherConsensus);
    counts({ summary: 1, consensus: 1, draft: 1 });
  });

  test('discrepancy arbitration calculates one draft and resubmission invalidates it even with an unchanged fingerprint', () => {
    const state = use(fixture());
    state.extractionResponses[1].values.outcome = 'No improvement';
    reconcile(state);
    assert.equal(state.extractionConsensus[0].status, 'pending');
    assert.throws(() => store.saveExtractionConsensusForUser(owner, projectId, { reportId, templateId }), /arbitration/i);
    internals.resetCounts();
    store.saveExtractionConsensusForUser(owner, projectId, { reportId, templateId, resolvedValues: { outcome: 'Arbitrated' } });
    assert.equal(state.extractionConsensus[0].status, 'finalized');
    assert.equal(state.extractionConsensus[0].resolvedValues.outcome, 'Arbitrated');
    assert.equal(state.projects[0].stage, 'complete');
    counts({ summary: 1, consensus: 0, draft: 1 }, 'arbitration computes one draft; the summary does not');
    const fingerprint = state.extractionConsensus[0].sourceFingerprint;
    const consensusId = state.extractionConsensus[0].id;
    now += 1000;
    internals.resetCounts();
    submit(peer, 'No improvement');
    assert.equal(state.extractionConsensus[0].sourceFingerprint, fingerprint, 'the values and response IDs did not change');
    assert.equal(state.extractionConsensus[0].id, consensusId);
    assert.equal(state.extractionConsensus[0].status, 'pending', 'a newer submission invalidates previous arbitration');
    assert.equal(state.extractionConsensus[0].finalizedAt, undefined);
    assert.equal(state.projects[0].stage, 'extraction');
    counts({ summary: 1, consensus: 1, draft: 1 });
  });

  test('unchanged workflow reconciliation preserves IDs, timestamps, consensus and events', () => {
    const state = use(fixture(3));
    reconcile(state);
    const before = structuredClone(state);
    now += 86_400_000;
    reconcile(state);
    assert.deepEqual(state, before);
  });

  test('normalization retains valid system-finalized consensus', () => {
    const state = use(fixture());
    reconcile(state);
    assert.equal(state.extractionConsensus[0].finalizedByUserId, 'system');
    const normalized = internals.normalizeState(state, false);
    assert.deepEqual(normalized.extractionConsensus, state.extractionConsensus);
  });

  test('screening threshold changes reverse an unused report and recreate it when satisfied', () => {
    const state = use(fixture(1, false));
    vote(owner);
    vote(peer);
    state.projects[0].abstractRequiredVotes = 3;
    reconcile(state);
    assert.equal(state.studies[0].stage, 'title_abstract');
    assert.equal(state.reports.length, 0);
    state.projects[0].abstractRequiredVotes = 2;
    reconcile(state);
    assert.equal(state.studies[0].stage, 'full_text');
    assert.equal(state.reports.length, 1);
  });

  test('full-text and extraction thresholds clean stale consensus and recompute completion', () => {
    const state = use(fixture());
    reconcile(state);
    state.projects[0].fullTextRequiredVotes = 3;
    reconcile(state);
    assert.equal(state.studies[0].stage, 'full_text');
    assert.equal(state.extractionConsensus.length, 0);
    state.projects[0].fullTextRequiredVotes = 2;
    reconcile(state);
    assert.equal(state.studies[0].stage, 'extraction');
    assert.equal(state.projects[0].stage, 'complete');
    state.projects[0].extractionRequiredVotes = 3;
    reconcile(state);
    assert.equal(state.extractionConsensus.length, 0);
    assert.equal(state.projects[0].stage, 'extraction');
    state.projects[0].extractionRequiredVotes = 2;
    reconcile(state);
    assert.equal(state.projects[0].stage, 'complete');
  });

  test('inactive templates remove consensus without removing reviewer responses', () => {
    const state = use(fixture());
    reconcile(state);
    state.extractionTemplates[0].isActive = false;
    internals.resetCounts();
    reconcile(state);
    assert.equal(state.extractionConsensus.length, 0);
    assert.equal(state.extractionResponses.length, 2);
    assert.equal(state.projects[0].stage, 'extraction');
    counts({ summary: 1, consensus: 0, draft: 0 });
  });

  test('compatible template edits retain submissions; schema edits clear submissions, consensus and extraction checkouts', () => {
    const state = use(fixture());
    reconcile(state);
    const originalResponses = structuredClone(state.extractionResponses);
    store.saveExtractionTemplateForUser(owner, projectId, { title: 'Renamed template', fields: state.extractionTemplates[0].fields });
    assert.deepEqual(state.extractionResponses, originalResponses);
    assert.equal(state.extractionConsensus[0].status, 'finalized');
    state.screeningCheckouts.push({
      projectId, studyId, reportId, templateId, userId: owner, stage: 'extraction',
      checkedOutAt: new Date().toISOString(), expiresAt: new Date(now + 60_000).toISOString()
    });
    store.saveExtractionTemplateForUser(owner, projectId, {
      title: 'Changed schema', fields: [{ id: 'population', title: 'Population', type: 'multiline_text', options: [] }]
    });
    assert.equal(state.extractionResponses.length, 0);
    assert.equal(state.extractionConsensus.length, 0);
    assert.equal(state.screeningCheckouts.length, 0);
    assert.equal(state.projects[0].stage, 'extraction', 'schema reset must refresh the project summary before saving');
  });

  test('project summary calculation does not mutate consensus', () => {
    const state = use(fixture());
    reconcile(state);
    const consensus = structuredClone(state.extractionConsensus);
    state.extractionResponses[1].values.outcome = 'Changed';
    internals.resetCounts();
    internals.syncProjectWorkflowCounts(state, projectId);
    assert.deepEqual(state.extractionConsensus, consensus, 'summary calculation cannot secretly synchronize reports');
    assert.equal(internals.counts().consensus, 0);
    assert.equal(internals.counts().draft, 0);
  });

  for (const size of [1, 10, 100]) {
    test(`${size} completed reports rebuild with one summary and one consensus synchronization/draft per report`, () => {
      const state = use(fixture(size));
      reconcile(state);
      assert.equal(state.extractionConsensus.length, size);
      assert.equal(state.projects[0].stage, 'complete');
      counts({ summary: 1, consensus: size, draft: size });
    });
  }

  test('multi-report CSV exports current finalized values including manual arbitration and quoted text', () => {
    const state = use(fixture(3));
    for (const [index, study] of state.studies.entries()) {
      study.title = `Study ${String.fromCharCode(65 + index)}`;
      study.journal = 'Journal';
      study.year = 2024;
      study.doi = `10.test/${index}`;
    }
    for (const response of state.extractionResponses) {
      response.values.outcome = response.reportId === 'report-0'
        ? 'Improved, "robust"\nSecond line'
        : response.reportId === 'report-1'
          ? response.userId === owner ? 'Initial value' : 'Different value'
          : 'Third report';
    }
    reconcile(state);
    assert.equal(state.extractionConsensus.find(consensus => consensus.reportId === 'report-1').status, 'pending');
    store.saveExtractionConsensusForUser(owner, projectId, {
      reportId: 'report-1', templateId, resolvedValues: { outcome: 'Arbitrated, "final"\nNew line' }
    });
    const before = structuredClone(state.extractionConsensus);
    internals.resetCounts();
    const exported = store.getConsensusExtractionCsvForUser(owner, projectId);
    assert.equal(exported.exportedRows, 3);
    assert.equal(exported.unresolvedReports, 0);
    assert.equal(exported.fileName, `workflow-fixture-consensus-extraction-${new Date().toISOString().slice(0, 10)}.csv`);
    assert.equal(exported.csv,
      'study_id,report_id,import_item_id,study_title,journal,year,doi,outcome\n' +
      'study-0,report-0,1,Study A,Journal,2024,10.test/0,"Improved, ""robust""\nSecond line"\n' +
      'study-1,report-1,2,Study B,Journal,2024,10.test/1,"Arbitrated, ""final""\nNew line"\n' +
      'study-2,report-2,3,Study C,Journal,2024,10.test/2,Third report\n');
    assert.deepEqual(state.extractionConsensus, before, 'export reads finalized values without updating consensus');
    assert.equal(state.events[0].action, 'Exported consensus extraction CSV (3 studies)');
    counts({ summary: 0, consensus: 0, draft: 3 }, 'each included report is evaluated once during export');
  });

  test('CSV omits reopened or stale reports and refuses export when no current finalized consensus remains', () => {
    const state = use(fixture(3));
    reconcile(state);
    const oldConsensus = structuredClone(state.extractionConsensus.find(consensus => consensus.reportId === reportId));
    store.reopenExtractionResponseForUser(peer, projectId, reportId);
    let exported = store.getConsensusExtractionCsvForUser(owner, projectId);
    assert.equal(exported.exportedRows, 2);
    assert.equal(exported.unresolvedReports, 1);
    assert.ok(!exported.csv.includes('study-0,report-0,'), 'a reopened report lacks the required submitted responses');
    assert.ok(exported.csv.includes('study-1,report-1,'));
    assert.ok(exported.csv.includes('study-2,report-2,'));

    now += 1000;
    submit(peer, 'Improved');
    assert.equal(state.extractionConsensus.find(consensus => consensus.reportId === reportId).sourceFingerprint, oldConsensus.sourceFingerprint);
    // Model a stale stored finalization after resubmission: the exporter must
    // check submission time even when response IDs and values are unchanged.
    state.extractionConsensus = [
      ...state.extractionConsensus.filter(consensus => consensus.reportId !== reportId),
      oldConsensus
    ];
    exported = store.getConsensusExtractionCsvForUser(owner, projectId);
    assert.equal(exported.exportedRows, 2);
    assert.equal(exported.unresolvedReports, 1);
    assert.ok(!exported.csv.includes('study-0,report-0,'), 'older finalized consensus cannot export a newer resubmission');

    state.extractionConsensus = [oldConsensus];
    const eventsBeforeRejectedExport = structuredClone(state.events);
    assert.throws(() => store.getConsensusExtractionCsvForUser(owner, projectId), error =>
      error.status === 400 && /No consensus extraction records are exportable yet/.test(error.message));
    assert.deepEqual(state.events, eventsBeforeRejectedExport, 'rejected exports do not append a successful-export audit event');
  });

  test('JSON and PostgreSQL reads/writes preserve identical submission, arbitration, policy and template outcomes', () => {
    const plain = value => JSON.parse(JSON.stringify(value));
    const workflow = state => plain(Object.fromEntries([
      'projects', 'studies', 'reports', 'decisions', 'extractionTemplates',
      'extractionResponses', 'extractionConsensus', 'screeningCheckouts', 'events', 'dedupCandidates'
    ].map(key => [key, state[key]])));
    const initial = internals.normalizeState(fixture(), false);
    reconcile(initial);
    const initialState = plain(internals.normalizeState(initial, false));
    assert.equal(initialState.extractionConsensus[0].finalizedByUserId, 'system');
    const startTime = now;
    const previousMode = process.env.PRISMATICA_STORAGE_MODE;
    const previousDataFile = process.env.PRISMATICA_DATA_FILE;
    const dataFile = path.join(temp, 'backend-parity.json');
    const results = [];
    const projectUpdate = changes => store.updateProjectForUser(owner, projectId, { title: 'Workflow fixture', ...changes });
    const arbitrate = () => store.saveExtractionConsensusForUser(owner, projectId, {
      reportId, templateId, resolvedValues: { outcome: 'Arbitrated' }
    });
    const expectState = (stage, consensusStatus) => state => {
      assert.equal(state.projects[0].stage, stage);
      if (consensusStatus) assert.equal(state.extractionConsensus[0]?.status, consensusStatus);
      else assert.equal(state.extractionConsensus.length, 0);
    };
    const actions = [
      {
        name: 'unchanged system-finalized read', run: () => store.getAppStateForUser(owner),
        check: state => {
          assert.deepEqual(workflow(state), workflow(initialState), 'reading a settled workflow preserves system finalization, timestamps and IDs');
          assert.equal(state.extractionConsensus[0].finalizedByUserId, 'system');
        }
      },
      {
        name: 'reopen extraction', run: () => store.reopenExtractionResponseForUser(peer, projectId, reportId),
        check: expectState('extraction')
      },
      {
        name: 'submit matching extraction', run: () => submit(peer, 'Improved'),
        check: state => { expectState('complete', 'finalized')(state); assert.equal(state.extractionConsensus[0].finalizedByUserId, 'system'); }
      },
      {
        name: 'submit discrepant extraction', run: () => submit(peer, 'No improvement'),
        check: expectState('extraction', 'pending')
      },
      { name: 'arbitrate discrepancy', run: arbitrate, check: expectState('complete', 'finalized') },
      {
        name: 'resubmit unchanged values after arbitration', run: () => submit(peer, 'No improvement'),
        check: expectState('extraction', 'pending')
      },
      { name: 'arbitrate resubmission', run: arbitrate, check: expectState('complete', 'finalized') },
      {
        name: 'increase extraction vote threshold', run: () => projectUpdate({ extractionRequiredVotes: 3 }),
        check: expectState('extraction')
      },
      {
        name: 'restore extraction vote threshold', run: () => projectUpdate({ extractionRequiredVotes: 2 }),
        check: expectState('extraction', 'pending')
      },
      {
        name: 'compatible template edit',
        run: () => store.saveExtractionTemplateForUser(owner, projectId, {
          title: 'Renamed template', fields: initialState.extractionTemplates[0].fields
        }),
        check: state => { expectState('extraction', 'pending')(state); assert.equal(state.extractionResponses.length, 2); }
      },
      {
        name: 'incompatible template edit',
        run: () => store.saveExtractionTemplateForUser(owner, projectId, {
          title: 'New schema', fields: [{ id: 'population', title: 'Population', type: 'multiline_text', options: [] }]
        }),
        check: state => { expectState('extraction')(state); assert.equal(state.extractionResponses.length, 0); }
      },
      {
        name: 'reopen full-text decision', run: () => store.reopenFullTextDecisionForUser(peer, projectId, reportId),
        check: state => { expectState('full_text')(state); assert.equal(state.studies[0].stage, 'full_text'); }
      },
      {
        name: 'restore full-text inclusion', run: () => store.updateReportForUser(peer, projectId, reportId, { decisionValue: 'include' }),
        check: state => { expectState('extraction')(state); assert.equal(state.studies[0].stage, 'extraction'); }
      }
    ];

    try {
      for (const backend of ['file', 'postgres']) {
        now = startTime;
        internals.restoreIo();
        internals.resetIds();
        process.env.PRISMATICA_STORAGE_MODE = backend;
        process.env.PRISMATICA_DATA_FILE = dataFile;
        let databaseState = plain(initialState);
        let databaseRevision = 1;
        const bridgeOperations = [];
        childProcess.execFileSync = backend === 'postgres'
          ? (_command, args, options) => {
              const action = args[1];
              bridgeOperations.push(action);
              if (action === 'read') return JSON.stringify({ ...databaseState, __storageRevision: String(databaseRevision) });
              if (action === 'read-screening-state') return JSON.stringify({
                state: { ...databaseState, __storageRevision: String(databaseRevision) }, revision: String(databaseRevision)
              });
              if (action === 'write') {
                databaseState = JSON.parse(options.input);
                databaseRevision += 1;
                return JSON.stringify({ updated: true });
              }
              if (action === 'write-screening-patch') {
                const mutation = JSON.parse(options.input);
                assert.equal(mutation.revision, String(databaseRevision));
                if (mutation.project) databaseState.projects = databaseState.projects.map(project => project.id === mutation.projectId ? mutation.project : project);
                for (const [key, changes] of Object.entries(mutation.changes)) {
                  const deleted = new Set(changes.deleteIds);
                  const replacements = new Map(changes.upserts.map(item => [item.id, item]));
                  databaseState[key] = databaseState[key].filter(item => !deleted.has(item.id)).map(item => {
                    const replacement = replacements.get(item.id);
                    replacements.delete(item.id);
                    return replacement ?? item;
                  });
                  databaseState[key].push(...replacements.values());
                }
                databaseState.screeningCheckouts = [
                  ...databaseState.screeningCheckouts.filter(checkout => checkout.projectId !== mutation.projectId),
                  ...mutation.screeningCheckouts
                ];
                for (const event of mutation.events) databaseState.events.unshift(event);
                databaseRevision += 1;
                return JSON.stringify({ updated: true });
              }
              throw new Error(`Unexpected parity bridge operation: ${action}`);
            }
          : execFileSync;
        fs.writeFileSync(dataFile, JSON.stringify(initialState));
        const saved = () => backend === 'postgres' ? plain(databaseState) : JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        const snapshots = [];
        for (const action of actions) {
          now += 1000;
          const payload = action.run();
          const persisted = saved();
          action.check(persisted);
          snapshots.push({ name: action.name, persisted: workflow(persisted), payload: workflow(payload) });
          // Keep read-time repair enabled during this first batching phase. It
          // must leave each covered write's workflow unchanged on the next read.
          const reloaded = store.getAppStateForUser(owner);
          assert.deepEqual(workflow(saved()), workflow(persisted), `${backend}: ${action.name} does not need subsequent read-time workflow repair`);
          assert.deepEqual(workflow(reloaded), workflow(payload), `${backend}: ${action.name} returns the same workflow after reload`);
        }
        if (backend === 'postgres') {
          assert.ok(bridgeOperations.filter(action => action === 'read').length >= actions.length);
          assert.equal(bridgeOperations.filter(action => action === 'write-screening-patch').length, 2, 'full-text reopen and re-vote use atomic incremental persistence');
          assert.equal(bridgeOperations.filter(action => action === 'write').length, actions.length - 3, 'other mutations retain full-state persistence');
        }
        results.push(snapshots);
      }
      assert.deepEqual(results[1], results[0], 'JSON and PostgreSQL persist and return identical workflow arrays and project summaries');
    } finally {
      childProcess.execFileSync = execFileSync;
      internals.restoreIo();
      internals.restoreIds();
      process.env.PRISMATICA_STORAGE_MODE = previousMode;
      process.env.PRISMATICA_DATA_FILE = previousDataFile;
      now = startTime;
    }
  });

  const importBatch = (records = 1) => ({
    id: 'legacy-import', projectId, sourceName: 'Legacy source', format: 'bib', filename: 'legacy.bib',
    status: 'committed', records, parserWarnings: 0, uploadedBy: users[0].name, uploadedByUserId: owner, uploadedAt: stamp()
  });

  test('legacy imports materialize once and subsequent normalization preserves IDs, timestamps and history', () => {
    const legacy = fixture(0, false);
    legacy.imports.push(importBatch(2));
    const materialized = internals.normalizeState(legacy, true);
    assert.equal(materialized.studies.length, 2);
    assert.ok(materialized.studies.every(study => study.importBatchId === 'legacy-import'));
    const before = structuredClone(materialized);
    now += 86_400_000;
    assert.deepEqual(internals.normalizeState(materialized, true), before);
  });

  test('import deletion followed by normalization cleans removed reports and responses and remains stable', () => {
    const state = use(fixture());
    state.imports.push(importBatch());
    state.studies[0].importBatchId = 'legacy-import';
    reconcile(state);
    store.deleteImportBatchForUser(owner, projectId, 'legacy-import');
    assert.equal(state.studies.length, 0);
    assert.equal(state.reports.length, 0);
    const repaired = internals.normalizeState(state, true);
    assert.equal(repaired.extractionResponses.length, 0);
    assert.equal(repaired.extractionConsensus.length, 0);
    assert.equal(repaired.decisions.length, 0);
    assert.equal(repaired.projects[0].recordsTotal, 0);
    assert.equal(repaired.projects[0].stage, 'import');
    const before = structuredClone(repaired);
    now += 86_400_000;
    assert.deepEqual(internals.normalizeState(repaired, true), before);
  });

  if (failures.length) {
    console.error(`${passed} workflow checks passed; ${failures.length} failed.`);
    process.exitCode = 1;
  } else {
    console.log(`Workflow checks passed (${passed}): transitions and reopening, extraction arbitration, threshold/template changes, stable reconciliation, 1/10/100-report operation counts, CSV export, JSON/PostgreSQL parity, legacy imports and deletion repair.`);
  }
} finally {
  globalThis.Date = originalDate;
  Module._resolveFilename = originalResolve;
  childProcess.execFileSync = execFileSync;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
