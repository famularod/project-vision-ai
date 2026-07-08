#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const moduleCache = new Map();
const memoryStore = new Map();
const AsyncStorage = {
  getItem: async key => memoryStore.has(key) ? memoryStore.get(key) : null,
  setItem: async (key, value) => {
    memoryStore.set(key, value);
  },
  removeItem: async key => {
    memoryStore.delete(key);
  },
};

function loadTs(relativePath, mocks = {}) {
  const normalized = resolveTsPath(relativePath);
  const fullPath = path.join(rootDir, normalized);
  if (moduleCache.has(fullPath)) return moduleCache.get(fullPath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true,
      esModuleInterop: true,
    },
  });
  const sandbox = {
    exports: {},
    require: specifier => {
      if (specifier in mocks) return mocks[specifier];
      if (specifier === '@react-native-async-storage/async-storage') {
        return { __esModule: true, default: AsyncStorage };
      }
      if (specifier.endsWith('SupabaseService')) {
        return {
          loadPIERealityModelCloud: async () => ({ ok: false, configured: false, data: null }),
          savePIERealityModelCloud: async model => ({ ok: true, configured: false, data: model }),
          listPIEExecutiveJudgmentsCloud: async () => ({ ok: false, configured: false, data: null }),
          getActivePIEExecutiveJudgmentCloud: async () => ({ ok: false, configured: false, data: null }),
          savePIEExecutiveJudgmentCloud: async record => ({ ok: true, configured: false, data: record }),
        };
      }
      if (specifier.startsWith('.')) {
        const nextPath = path.join(path.dirname(normalized), specifier);
        return loadTs(nextPath, mocks);
      }
      return require(specifier);
    },
    console,
    Date,
    Object,
    JSON,
    RegExp,
    Set,
    Map,
    String,
    Number,
    Boolean,
    Error,
    Promise,
    Array,
  };
  vm.runInNewContext(compiled.outputText, sandbox, { filename: fullPath });
  moduleCache.set(fullPath, sandbox.exports);
  return sandbox.exports;
}

function resolveTsPath(relativePath) {
  const candidates = relativePath.endsWith('.ts') || relativePath.endsWith('.tsx')
    ? [relativePath]
    : [`${relativePath}.ts`, `${relativePath}.tsx`, path.join(relativePath, 'index.ts'), path.join(relativePath, 'index.tsx')];
  const found = candidates.find(candidate => fs.existsSync(path.join(rootDir, candidate)));
  return found || candidates[0];
}

const orchestrator = loadTs('services/PIERealityModelOrchestrator.ts');
const sync = loadTs('services/PIERealityModelSynchronization.ts');
const storage = loadTs('services/PIERealityModelStorage.ts');
const judgment = loadTs('services/PIEExecutiveJudgment.ts');
const judgmentRepo = loadTs('services/PIEExecutiveJudgmentRepository.ts');
const reporter = loadTs('services/PIEReporter.ts');
const layer4 = loadTs('services/PIELayer4Automation.ts');
const trace = loadTs('services/PIETraceability.ts');
const coreSource = fs.readFileSync(path.join(rootDir, 'services/PIECoreIntelligence.ts'), 'utf8');

function evidence(overrides = {}) {
  return {
    id: 'schedule-canopy-b',
    organizationId: 'org-live',
    projectId: 'project-live',
    type: 'schedule_activity',
    name: 'Electrical rough-in',
    projectName: 'Building 2375',
    areaName: 'Canopy B',
    summary: 'Electrical rough-in is due tomorrow.',
    status: 'at_risk',
    confidence: 'high',
    evidenceType: 'schedule',
    evidenceId: 'schedule-canopy-b',
    evidenceContentHash: 'hash-v1',
    classification: 'fact',
    updatedAt: '2026-07-02T12:00:00.000Z',
    evidenceQualified: true,
    identityConfidence: 'high',
    ...overrides,
  };
}

function actor() {
  return {
    id: 'user-1',
    name: 'David',
    role: 'admin',
    organizationId: 'org-live',
    authorizedPermissions: ['create_decision_candidate'],
    cloudTrusted: true,
  };
}

(async () => {
  await storage.clearRealityModelForTesting('org-live', 'project-live');
  const first = await orchestrator.runPIERealityModelOrchestration({
    organizationId: 'org-live',
    projectId: 'project-live',
    qualifiedEvidence: [evidence()],
    generatedAt: '2026-07-02T12:00:00.000Z',
    identityTrusted: true,
  });
  assert.strictEqual(first.model.version, 1);
  assert.strictEqual(first.persistenceStatus, 'degraded_local_only');
  assert(first.snapshotId.includes('v1'));

  const second = await orchestrator.runPIERealityModelOrchestration({
    organizationId: 'org-live',
    projectId: 'project-live',
    qualifiedEvidence: [evidence()],
    generatedAt: '2026-07-02T12:05:00.000Z',
    identityTrusted: true,
  });
  assert.strictEqual(second.model.version, 1, 'unchanged evidence should not create endless versions');
  assert(second.evidenceDeltas.every(delta => delta.status === 'unchanged'));

  const changed = await orchestrator.runPIERealityModelOrchestration({
    organizationId: 'org-live',
    projectId: 'project-live',
    qualifiedEvidence: [evidence({
      summary: 'Electrical rough-in is blocked by missing inspection.',
      status: 'blocked',
      evidenceContentHash: 'hash-v2',
    })],
    generatedAt: '2026-07-02T12:10:00.000Z',
    identityTrusted: true,
  });
  assert(changed.model.version > second.model.version, 'changed evidence should update existing persisted model');

  const removed = await orchestrator.runPIERealityModelOrchestration({
    organizationId: 'org-live',
    projectId: 'project-live',
    qualifiedEvidence: [],
    generatedAt: '2026-07-02T12:12:00.000Z',
    identityTrusted: true,
  });
  assert(
    removed.evidenceDeltas.some(delta => delta.status === 'removed'),
    'removed evidence should create an explicit removed delta',
  );
  assert(
    removed.model.changeHistory.length >= changed.model.changeHistory.length,
    'removed evidence should preserve Reality history instead of erasing it',
  );

  await storage.clearRealityModelForTesting('org-invalid', 'project-invalid');
  await orchestrator.runPIERealityModelOrchestration({
    organizationId: 'org-invalid',
    projectId: 'project-invalid',
    qualifiedEvidence: [evidence({
      organizationId: 'org-invalid',
      projectId: 'project-invalid',
      evidenceId: 'issue-invalidated',
      id: 'issue-invalidated',
      name: 'Safety observation',
      type: 'issue',
      evidenceContentHash: 'invalid-v1',
    })],
    generatedAt: '2026-07-02T12:13:00.000Z',
    identityTrusted: true,
  });
  const invalidated = await orchestrator.runPIERealityModelOrchestration({
    organizationId: 'org-invalid',
    projectId: 'project-invalid',
    qualifiedEvidence: [evidence({
      organizationId: 'org-invalid',
      projectId: 'project-invalid',
      evidenceId: 'issue-invalidated',
      id: 'issue-invalidated',
      name: 'Safety observation',
      type: 'issue',
      status: 'contradicted',
      evidenceContentHash: 'invalid-v2',
    })],
    generatedAt: '2026-07-02T12:14:00.000Z',
    identityTrusted: true,
  });
  assert(
    invalidated.evidenceDeltas.some(delta => delta.status === 'invalidated'),
    'invalidated evidence should create an explicit invalidated delta',
  );

  const stale = await orchestrator.runPIERealityModelOrchestration({
    organizationId: 'org-live',
    projectId: 'project-live',
    qualifiedEvidence: [],
    generatedAt: '2026-07-02T12:15:00.000Z',
    identityTrusted: true,
    expectedMinimumModelVersion: removed.model.version + 10,
  });
  assert.strictEqual(stale.persistenceStatus, 'stale_model', 'stale Reality use should be explicit');

  const failingRepository = {
    ...storage,
    loadCurrent: async () => removed.model,
    saveSynchronized: async () => {
      throw new Error('simulated persistence failure');
    },
    appendObjectHistory: async () => removed.model,
    getObjectHistory: async () => [],
    getSnapshots: async () => [],
    getConflicts: async () => [],
    getUncertainties: async () => [],
    queryObjects: async () => [],
  };
  const failedPersistence = await orchestrator.runPIERealityModelOrchestration({
    organizationId: 'org-live',
    projectId: 'project-live',
    repository: failingRepository,
    qualifiedEvidence: [evidence({
      evidenceContentHash: 'hash-v3',
      summary: 'Electrical rough-in still lacks validation evidence.',
    })],
    generatedAt: '2026-07-02T12:16:00.000Z',
    identityTrusted: true,
  });
  assert.strictEqual(failedPersistence.persistenceStatus, 'persistence_failed');

  assert.throws(
    () => judgment.buildPIEExecutiveJudgment({ realityModel: changed.model }),
    /authoritative Reality Model metadata/i,
  );

  const authority = judgment.buildExecutiveJudgmentAuthority({
    realityModel: changed.model,
    snapshotId: changed.snapshotId,
  });
  const judgmentResult = judgment.buildPIEExecutiveJudgment({
    realityModel: changed.model,
    authority,
    generatedAt: '2026-07-02T12:11:00.000Z',
  });
  const record = await judgmentRepo.persistStructuredExecutiveJudgment({
    result: judgmentResult,
    realityModel: changed.model,
    situationSummary: 'Electrical rough-in is blocked.',
  });
  assert.strictEqual(record.realityModelVersion, changed.model.version);
  assert.strictEqual(record.realitySnapshotId, changed.snapshotId);
  assert(record.immutable);

  assert.throws(
    () => reporter.buildPIEReportDraft({
      enforceCommunicationOnly: true,
      runtime: {},
    }),
    /Persisted Executive Judgment is required/i,
  );
  const report = reporter.buildPIEReportDraftFromExecutiveJudgment({
    executiveJudgmentRecord: record,
    runtime: {},
    selectedProjectNames: ['Building 2375'],
  });
  assert(report.body.includes(record.primaryRecommendation) || report.executiveSummary.join(' ').includes(record.primaryRecommendation));

  const sourceEvidence = [{
    id: 'schedule-canopy-b',
    sourceType: 'schedule_item',
    organizationId: 'org-live',
    projectId: 'project-live',
    summary: 'Electrical rough-in is blocked by missing inspection.',
    versionId: 'hash-v2',
  }];
  assert.throws(
    () => layer4.buildLayer4DecisionCandidate({
      report: { ...report, sourceEvidence: [] },
      existingDecisions: [],
      organizationId: 'org-live',
      projectId: 'project-live',
      actor: actor(),
      evidence: sourceEvidence,
    }),
    /report-only input/i,
  );
  const decisionCandidate = layer4.buildLayer4DecisionCandidateFromExecutiveJudgment({
    judgment: record,
    existingDecisions: [],
    actor: actor(),
    evidence: sourceEvidence,
  });
  assert(decisionCandidate.created);
  assert.strictEqual(decisionCandidate.decision.immutableSnapshot.recommendationId, record.id);

  assert.throws(
    () => layer4.buildLayer4DecisionCandidateFromExecutiveJudgment({
      judgment: {
        ...record,
        id: `${record.id}-stale`,
        persistenceStatus: 'stale_model',
      },
      existingDecisions: [],
      actor: actor(),
      evidence: sourceEvidence,
    }),
    /high-impact automation is blocked/i,
  );

  const fakeCore = {
    bestNextStep: record.primaryRecommendation,
    executiveJudgmentRecord: record,
    realityModel: changed.model,
  };
  const recommendationTrace = trace.buildPIERecommendationTrace({
    core: fakeCore,
    report,
    executiveJudgmentRecord: record,
  });
  assert.strictEqual(recommendationTrace.executiveJudgmentId, record.id);
  assert.strictEqual(recommendationTrace.realityModelVersion, changed.model.version);

  assert(coreSource.includes('export async function buildLivePIECoreIntelligence'));
  assert(coreSource.includes('runPIERealityModelOrchestration'));
  assert(coreSource.includes('persistStructuredExecutiveJudgment'));
  assert(coreSource.includes('buildPIEReportDraftFromExecutiveJudgment'));
  assert(coreSource.includes('enforceLiveReality'));
  assert(coreSource.includes('identityTrusted: input.identityTrusted'));
  assert(coreSource.includes('expectedMinimumRealityModelVersion'));

  console.log('Live Reality authority tests passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
