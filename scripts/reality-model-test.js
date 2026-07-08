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
  const normalized = relativePath.endsWith('.ts') ? relativePath : `${relativePath}.ts`;
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
        };
      }
      if (specifier.startsWith('./')) {
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

const reality = loadTs('services/PIERealityModel.ts');
const storage = loadTs('services/PIERealityModelStorage.ts');
const sync = loadTs('services/PIERealityModelSynchronization.ts');

function source(overrides = {}) {
  return {
    id: 'evidence-canopy-b',
    organizationId: 'org-1',
    projectId: 'project-2375',
    type: 'area',
    name: 'Canopy B',
    projectName: 'Building 2375',
    areaName: 'Canopy B',
    summary: 'Electrical rough-in is in progress.',
    status: 'in_progress',
    confidence: 'high',
    evidenceType: 'schedule',
    evidenceId: 'schedule-1',
    classification: 'fact',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
}

(async () => {
  const first = reality.buildPIERealityModel({
    organizationId: 'org-1',
    projectId: 'project-2375',
    objects: [source()],
    generatedAt: '2026-07-01T12:00:00.000Z',
  });
  assert.strictEqual(first.organizationId, 'org-1');
  assert.strictEqual(first.projectId, 'project-2375');
  assert.strictEqual(first.version, 1);
  assert.strictEqual(first.objects.length, 1);
  assert(first.objects[0].stableObjectId);
  assert.strictEqual(first.objects[0].assertions[0].classification, 'fact');
  assert(first.objects[0].assertions[0].supportingEvidenceIds.length > 0);

  const second = reality.buildPIERealityModel({
    organizationId: 'org-1',
    projectId: 'project-2375',
    previousModel: first,
    objects: [source({ summary: 'Electrical rough-in is ready for review.', status: 'ready' })],
    generatedAt: '2026-07-02T12:00:00.000Z',
  });
  assert.strictEqual(second.objects.length, 1, 'same object should update, not duplicate');
  assert(second.version > first.version, 'meaningful state change should create a new version');
  assert(second.objects[0].history.length > first.objects[0].history.length);

  assert.throws(
    () => reality.buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-2375',
      objects: [source({ id: '', evidenceId: '', classification: 'fact' })],
    }),
    /facts require supporting evidence/i,
  );

  assert.throws(
    () => reality.buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-2375',
      objects: [source({ classification: 'prediction', expectedTimeframe: null })],
    }),
    /predictions require an expected timeframe/i,
  );

  const conflicted = reality.buildPIERealityModel({
    organizationId: 'org-1',
    projectId: 'project-2375',
    objects: [source({ summary: 'Contradicting status was reported.', status: 'contradicted' })],
  });
  assert(conflicted.evidenceConflicts.length > 0, 'conflicting evidence should preserve a conflict record');

  const uncertain = reality.buildPIERealityModel({
    organizationId: 'org-1',
    projectId: 'project-2375',
    objects: [source({ uncertain: true, classification: 'assumption', evidenceId: 'note-1' })],
  });
  assert(uncertain.activeUncertainties.length > 0, 'missing/weak evidence should create uncertainty records');
  assert.strictEqual(uncertain.objects[0].assertions[0].classification, 'assumption');

  await storage.clearRealityModelForTesting('org-1', 'project-2375');
  await storage.saveSynchronizedRealityModel(first, 'Initial model.');
  const loaded = await storage.loadCurrentRealityModel('org-1', 'project-2375');
  const otherOrg = await storage.loadCurrentRealityModel('org-2', 'project-2375');
  assert.strictEqual(loaded.organizationId, 'org-1');
  assert.strictEqual(otherOrg, null, 'organization isolation should block cross-org local reads');
  const snapshots = await storage.getRealityModelSnapshots('org-1', 'project-2375');
  assert.strictEqual(snapshots.length, 1);
  snapshots[0].model.objects[0].name = 'Mutated snapshot';
  const snapshotsAgain = await storage.getRealityModelSnapshots('org-1', 'project-2375');
  assert.strictEqual(snapshotsAgain[0].model.objects[0].name, 'Canopy B', 'snapshot reload should remain immutable from caller mutation');

  const result = await sync.synchronizeAuthoritativeRealityModel({
    organizationId: 'org-1',
    projectId: 'project-2375',
    qualifiedEvidence: sync.buildQualifiedRealityEvidence([
      source({ id: 'ambiguous', projectId: null, areaName: null, location: null, name: '' }),
    ], 'org-1', 'project-2375'),
    generatedAt: '2026-07-03T12:00:00.000Z',
  });
  assert(result.conflicts.some(conflict => conflict.conflictType === 'identity_mismatch'));

  const core = fs.readFileSync(path.join(rootDir, 'services/PIECoreIntelligence.ts'), 'utf8');
  assert(core.includes('authoritativeRealityModel'));
  assert(core.includes('buildQualifiedRealityEvidence'));
  assert(core.includes('realityModelSynchronization'));

  console.log('PIE Reality Model tests passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
