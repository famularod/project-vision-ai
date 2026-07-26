#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const moduleCache = new Map();
const memoryStore = new Map();
const storageReads = [];
let failedSetKey = null;
const AsyncStorage = {
  getItem: async key => {
    storageReads.push(key);
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  },
  setItem: async (key, value) => {
    if (key === failedSetKey) throw new Error(`Injected write failure for ${key}`);
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

  const currentKey = storage.realityModelStorageKey('org-1', 'project-2375');
  const snapshotKey = storage.realitySnapshotStorageKey('org-1', 'project-2375');
  const persistedEnvelope = JSON.parse(memoryStore.get(currentKey));
  assert.deepStrictEqual(
    persistedEnvelope.currentModel.objectRegistry,
    {},
    'the stored current model must not duplicate every object in a registry copy',
  );
  assert.deepStrictEqual(
    persistedEnvelope.currentModel.intelligence.objectsUncertain,
    [],
    'the stored current model must not duplicate full objects in intelligence indexes',
  );
  assert.strictEqual(
    Object.keys(loaded.objectRegistry).length,
    loaded.objects.length,
    'loading a compact current model must rebuild its object registry',
  );
  assert.strictEqual(
    loaded.intelligence.objectsUncertain.length,
    first.intelligence.objectsUncertain.length,
    'loading a compact current model must rebuild its intelligence indexes',
  );
  assert.deepStrictEqual(
    persistedEnvelope.snapshots,
    [],
    'the current-state envelope must not duplicate the snapshot archive',
  );
  storageReads.length = 0;
  await storage.loadCurrentRealityModel('org-1', 'project-2375');
  assert(!storageReads.includes(snapshotKey), 'current-only reads must not load the snapshot archive');

  const modelVersions = [second];
  for (let index = 0; index < 4; index += 1) {
    modelVersions.push(reality.buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-2375',
      previousModel: modelVersions[modelVersions.length - 1],
      objects: [source({
        summary: `Bounded snapshot revision ${index}`,
        status: index % 2 === 0 ? 'in_progress' : 'ready',
        updatedAt: `2026-07-0${index + 3}T12:00:00.000Z`,
      })],
      generatedAt: `2026-07-0${index + 3}T12:00:00.000Z`,
    }));
  }
  for (const model of modelVersions) {
    await storage.saveSynchronizedRealityModel(model, 'Bounded history test.');
  }
  const boundedSnapshots = await storage.getRealityModelSnapshots('org-1', 'project-2375');
  assert(
    boundedSnapshots.length <= storage.PIE_REALITY_SNAPSHOT_MAX_COUNT + storage.PIE_REALITY_RECENT_SNAPSHOT_MAX_COUNT,
    'a full immutable archive may be paired with only a bounded recent head',
  );
  assert.strictEqual(new Set(boundedSnapshots.map(snapshot => snapshot.id)).size, boundedSnapshots.length);
  assert(
    JSON.parse(memoryStore.get(snapshotKey)).length <= storage.PIE_REALITY_SNAPSHOT_MAX_COUNT,
    'the separate archive must stop growing once its safe limit is reached',
  );
  assert(
    JSON.parse(memoryStore.get(currentKey)).snapshots.length <= storage.PIE_REALITY_RECENT_SNAPSHOT_MAX_COUNT,
    'new history after a full archive must remain bounded in the current envelope',
  );
  assert.strictEqual(JSON.parse(memoryStore.get(currentKey)).snapshotArchiveFrozen, true);

  const legacyOrg = 'org-legacy';
  const legacyProject = 'project-legacy';
  const legacyModel = reality.buildPIERealityModel({
    organizationId: legacyOrg,
    projectId: legacyProject,
    objects: [source({ organizationId: legacyOrg, projectId: legacyProject })],
    generatedAt: '2026-07-01T12:00:00.000Z',
  });
  const oversizedLegacySnapshots = Array.from({ length: 4 }, (_, index) => ({
    id: index === 1 ? 'legacy-snapshot-0' : `legacy-snapshot-${index}`,
    organizationId: legacyOrg,
    projectId: legacyProject,
    modelVersion: index === 1 ? 1 : index + 1,
    createdAt: `2026-07-0${index + 1}T12:00:00.000Z`,
    sourceEvidenceCutoffAt: legacyModel.sourceEvidenceCutoffAt,
    reason: 'Preserved legacy history.',
    model: {
      ...legacyModel,
      version: index === 1 ? 1 : index + 1,
      generatedAt: index === 1 ? '2026-07-02T12:00:00.000Z' : legacyModel.generatedAt,
    },
  }));
  const legacySnapshotKey = storage.realitySnapshotStorageKey(legacyOrg, legacyProject);
  const legacyRaw = JSON.stringify(oversizedLegacySnapshots);
  memoryStore.set(legacySnapshotKey, legacyRaw);
  const legacyRevision = { ...legacyModel, version: 5, generatedAt: '2026-07-18T12:00:00.000Z' };
  await storage.saveSynchronizedRealityModel(legacyRevision, 'Do not prune legacy history.');
  assert.strictEqual(
    memoryStore.get(legacySnapshotKey),
    legacyRaw,
    'an already oversized legacy archive must remain byte-for-byte unchanged',
  );
  assert.strictEqual(
    JSON.parse(memoryStore.get(storage.realityModelStorageKey(legacyOrg, legacyProject))).snapshots.length,
    0,
    'a frozen legacy archive must not force a duplicate full model into the current envelope',
  );
  assert.strictEqual(
    (await storage.loadCurrentRealityModel(legacyOrg, legacyProject)).version,
    5,
    'current authority must remain available when no duplicate recent snapshot is stored',
  );
  storageReads.length = 0;
  await storage.saveSynchronizedRealityModel(
    { ...legacyRevision, version: 6, generatedAt: '2026-07-18T13:00:00.000Z' },
    'Continue without reopening the frozen archive.',
  );
  assert(!storageReads.includes(legacySnapshotKey), 'future saves must not reread a frozen legacy archive');
  assert.strictEqual(memoryStore.get(legacySnapshotKey), legacyRaw);
  storageReads.length = 0;
  const legacyCurrent = await storage.loadCurrentRealityModel(legacyOrg, legacyProject);
  assert.strictEqual(legacyCurrent.version, 6, 'current-state reads must remain available');
  assert(!storageReads.includes(legacySnapshotKey), 'current-state reads must not inspect ambiguous history');
  await assert.rejects(
    () => storage.getRealityModelSnapshots(legacyOrg, legacyProject),
    /ambiguous snapshot identity/,
  );
  await assert.rejects(
    () => storage.loadRealityModelState(legacyOrg, legacyProject),
    /ambiguous snapshot identity/,
  );
  assert.strictEqual(
    memoryStore.get(legacySnapshotKey),
    legacyRaw,
    'ambiguous legacy history must fail closed without rewriting its bytes',
  );

  const embeddedOrg = 'org-embedded';
  const embeddedProject = 'project-embedded';
  const embeddedModel = reality.buildPIERealityModel({
    organizationId: embeddedOrg,
    projectId: embeddedProject,
    objects: [source({ organizationId: embeddedOrg, projectId: embeddedProject })],
    generatedAt: '2026-07-01T12:00:00.000Z',
  });
  const embeddedSnapshot = {
    id: 'embedded-only-snapshot', organizationId: embeddedOrg, projectId: embeddedProject,
    modelVersion: embeddedModel.version, createdAt: '2026-07-01T12:00:00.000Z',
    sourceEvidenceCutoffAt: embeddedModel.sourceEvidenceCutoffAt,
    reason: 'Legacy embedded-only history.', model: embeddedModel,
  };
  const embeddedCurrentKey = storage.realityModelStorageKey(embeddedOrg, embeddedProject);
  const embeddedSnapshotKey = storage.realitySnapshotStorageKey(embeddedOrg, embeddedProject);
  memoryStore.set(embeddedCurrentKey, JSON.stringify({
    version: storage.PIE_REALITY_MODEL_STORAGE_VERSION,
    organizationId: embeddedOrg, projectId: embeddedProject, currentModel: embeddedModel,
    snapshots: [embeddedSnapshot], savedAt: '2026-07-01T12:00:00.000Z',
  }));
  await storage.saveSynchronizedRealityModel(embeddedModel, 'Migrate embedded history.');
  assert.strictEqual(JSON.parse(memoryStore.get(embeddedSnapshotKey)).length, 1);
  assert.deepStrictEqual(JSON.parse(memoryStore.get(embeddedCurrentKey)).snapshots, []);

  const concurrentOrg = 'org-concurrent';
  const concurrentProject = 'project-concurrent';
  const concurrentBase = reality.buildPIERealityModel({
    organizationId: concurrentOrg,
    projectId: concurrentProject,
    objects: [source({ organizationId: concurrentOrg, projectId: concurrentProject })],
    generatedAt: '2026-07-01T12:00:00.000Z',
  });
  await storage.saveSynchronizedRealityModel(concurrentBase, 'Concurrent base.');
  const writerA = reality.buildPIERealityModel({
    organizationId: concurrentOrg, projectId: concurrentProject, previousModel: concurrentBase,
    objects: [source({ organizationId: concurrentOrg, projectId: concurrentProject, summary: 'Writer A', status: 'ready', updatedAt: '2026-07-02T12:00:00.000Z' })],
    generatedAt: '2026-07-02T12:00:00.000Z',
  });
  const writerB = reality.buildPIERealityModel({
    organizationId: concurrentOrg, projectId: concurrentProject, previousModel: concurrentBase,
    objects: [source({ organizationId: concurrentOrg, projectId: concurrentProject, summary: 'Writer B', status: 'blocked', updatedAt: '2026-07-02T13:00:00.000Z' })],
    generatedAt: '2026-07-02T13:00:00.000Z',
  });
  await storage.saveSynchronizedRealityModel(writerA, 'Writer A.');
  await assert.rejects(
    () => storage.saveSynchronizedRealityModel(writerB, 'Writer B.'),
    /same version changed concurrently/,
  );
  const objectId = writerA.objects[0].identity.id;
  await Promise.all([
    storage.appendRealityObjectHistory(concurrentOrg, concurrentProject, objectId, {
      id: 'concurrent-event-a', occurredAt: '2026-07-03T12:00:00.000Z', eventType: 'updated',
      summary: 'Concurrent event A.', previousStatus: writerA.objects[0].currentStatus, nextStatus: writerA.objects[0].currentStatus,
    }),
    storage.appendRealityObjectHistory(concurrentOrg, concurrentProject, objectId, {
      id: 'concurrent-event-b', occurredAt: '2026-07-03T12:01:00.000Z', eventType: 'updated',
      summary: 'Concurrent event B.', previousStatus: writerA.objects[0].currentStatus, nextStatus: writerA.objects[0].currentStatus,
    }),
  ]);
  const concurrentAfter = await storage.loadCurrentRealityModel(concurrentOrg, concurrentProject);
  assert(concurrentAfter.objectRegistry[objectId].history.some(event => event.id === 'concurrent-event-a'));
  assert(concurrentAfter.objectRegistry[objectId].history.some(event => event.id === 'concurrent-event-b'));

  const failureOrg = 'org-failure';
  const failureProject = 'project-failure';
  const failureModel = reality.buildPIERealityModel({
    organizationId: failureOrg,
    projectId: failureProject,
    objects: [source({ organizationId: failureOrg, projectId: failureProject })],
    generatedAt: '2026-07-01T12:00:00.000Z',
  });
  const failureCurrentKey = storage.realityModelStorageKey(failureOrg, failureProject);
  const failureSnapshotKey = storage.realitySnapshotStorageKey(failureOrg, failureProject);
  const priorCurrentRaw = JSON.stringify({
    version: storage.PIE_REALITY_MODEL_STORAGE_VERSION,
    organizationId: failureOrg,
    projectId: failureProject,
    currentModel: null,
    snapshots: [],
    savedAt: '2026-07-01T00:00:00.000Z',
  });
  memoryStore.set(failureCurrentKey, priorCurrentRaw);
  failedSetKey = failureSnapshotKey;
  const degradedSave = await storage.saveSynchronizedRealityModel(failureModel, 'Injected failure.');
  failedSetKey = null;
  const degradedCurrent = JSON.parse(memoryStore.get(failureCurrentKey));
  assert.strictEqual(degradedCurrent.currentModel.version, failureModel.version);
  assert.strictEqual(degradedCurrent.snapshots.length, 1);
  assert.strictEqual(degradedCurrent.snapshotArchiveFrozen, true);
  assert.strictEqual(degradedSave.currentModel.version, failureModel.version);
  assert.strictEqual(memoryStore.has(failureSnapshotKey), false);

  const storageSource = fs.readFileSync(path.join(rootDir, 'services/PIERealityModelStorage.ts'), 'utf8');
  assert(storageSource.includes('runExclusiveLocalStorageMutation([currentKey, snapshotKey]'));
  assert(storageSource.includes(').slice(0, 20)'));
  assert(storageSource.includes(').slice(0, 200)'));

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
