#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'services/DAVEProjectTruthRepository.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;
const quarantineModule = { exports: {} };
const quarantineCompiled = ts.transpileModule(
  fs.readFileSync(path.join(root, 'services/LocalStorageCorruptionQuarantine.ts'), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  },
).outputText;
new Function('require', 'module', 'exports', quarantineCompiled)(
  specifier => { throw new Error(`Unexpected quarantine dependency: ${specifier}`); },
  quarantineModule,
  quarantineModule.exports,
);

function memoryStorage() {
  const data = new Map();
  return {
    data,
    async getItem(key) { return data.has(key) ? data.get(key) : null; },
    async setItem(key, value) { data.set(key, value); },
    async removeItem(key) { data.delete(key); },
  };
}

const defaultStorage = memoryStorage();
let loadCloudSnapshot = async () => ({ ok: true, configured: true, data: null });
let saveCloudSnapshot = async snapshot => ({ ok: true, configured: true, data: snapshot });
const moduleUnderTest = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  specifier => {
    if (specifier === '@react-native-async-storage/async-storage') {
      return { __esModule: true, default: defaultStorage };
    }
    if (specifier === './SupabaseService') {
      return {
        async loadLatestDAVEProjectTruthSnapshotCloud(...args) {
          return loadCloudSnapshot(...args);
        },
        async saveDAVEProjectTruthSnapshotCloud(snapshot) {
          return saveCloudSnapshot(snapshot);
        },
      };
    }
    if (specifier === './LocalStorageCorruptionQuarantine') {
      return quarantineModule.exports;
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  },
  moduleUnderTest,
  moduleUnderTest.exports,
);

const {
  DAVE_PROJECT_TRUTH_REPOSITORY_VERSION,
  DAVE_PROJECT_TRUTH_QUARANTINE_KEY_PREFIX,
  DAVE_PROJECT_TRUTH_STORAGE_KEY,
  createDAVEProjectTruthRepository,
  fingerprintDAVEProjectTruth,
} = moduleUnderTest.exports;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function legacyFingerprint(truthValue) {
  return stableHash(stableStringify({
    schemaVersion: truthValue.schemaVersion,
    projectId: truthValue.projectId,
    projectName: truthValue.projectName,
    asOfDay: truthValue.generatedAt.slice(0, 10),
    evidence: truthValue.evidence.records,
    entityLinks: truthValue.entityLinks,
    photoComparisons: truthValue.photoComparisons,
    correlations: truthValue.correlations,
    reasoning: truthValue.reasoning,
    schedule: truthValue.schedule,
    verificationQueue: truthValue.verificationQueue,
    briefing: truthValue.briefing,
  }));
}

function withoutVolatileGeneratedAt(value) {
  if (Array.isArray(value)) return value.map(withoutVolatileGeneratedAt);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'generatedAt')
        .map(([key, child]) => [key, withoutVolatileGeneratedAt(child)]),
    );
  }
  return value;
}

function priorSemanticFingerprint(truthValue) {
  return stableHash(stableStringify(withoutVolatileGeneratedAt({
    schemaVersion: truthValue.schemaVersion,
    projectId: truthValue.projectId,
    projectName: truthValue.projectName,
    evidence: truthValue.evidence.records,
    entityLinks: truthValue.entityLinks,
    photoComparisons: truthValue.photoComparisons,
    correlations: truthValue.correlations,
    reasoning: truthValue.reasoning,
    schedule: truthValue.schedule,
    verificationQueue: truthValue.verificationQueue,
    briefing: truthValue.briefing,
  })));
}

function truth(headline = 'Current project truth') {
  return {
    schemaVersion: 'dave-project-truth/1.0',
    projectId: 'project-alpha',
    projectName: 'Alpha',
    generatedAt: '2026-07-16T12:00:00.000Z',
    intelligence: {},
    evidence: {
      total: 1,
      connected: 1,
      unresolved: 0,
      duplicate: 0,
      rejected: 0,
      records: [{ id: 'evidence-1', summary: 'Observed work.' }],
      unresolvedRecords: [],
      coveragePercent: 100,
    },
    entityLinks: [],
    photoComparisons: [],
    correlations: {
      version: 'dave-evidence-correlation/1.0',
      generatedAt: '2026-07-16T12:00:00.000Z',
      tasks: [{
        taskId: 'task-1',
        evidence: [{ id: 'claim-1', recordedAt: '2026-07-15T09:00:00.000Z' }],
      }],
      evidenceCount: 1,
      multiSourceTaskCount: 0,
      conflictCount: 0,
      verificationCount: 0,
    },
    reasoning: {
      version: 'dave-project-reasoning/1.0',
      projectId: 'project-alpha',
      projectName: 'Alpha',
      generatedAt: '2026-07-16T12:00:00.000Z',
      decisions: [],
      facts: [],
      supportedConclusions: [],
      inferences: [],
      uncertainties: [],
      criticalDecisions: [],
      learnedOutcomeCount: 0,
      summary: 'No unresolved decisions.',
    },
    schedule: [],
    verificationQueue: [],
    briefing: {
      headline,
      currentReality: 'Observed work.',
      whatChanged: [],
      schedule: 'No schedule change.',
      commitments: [],
      risksAndConflicts: [],
      verificationNeeded: [],
      nextActions: [],
      evidenceCoverage: '100%',
      confidence: 'high',
    },
  };
}

function projectTruth(projectId, projectName, headline) {
  const value = truth(headline);
  value.projectId = projectId;
  value.projectName = projectName;
  return value;
}

(async () => {
  const originalTruth = truth();
  const recomputedTruth = JSON.parse(JSON.stringify(originalTruth));
  recomputedTruth.generatedAt = '2026-07-18T08:30:00.000Z';
  recomputedTruth.correlations.generatedAt = '2026-07-18T08:30:00.000Z';
  recomputedTruth.reasoning.generatedAt = '2026-07-18T08:30:00.000Z';
  assert.strictEqual(
    fingerprintDAVEProjectTruth(originalTruth),
    fingerprintDAVEProjectTruth(recomputedTruth),
    'top-level and nested generation times must not create false semantic revisions',
  );

  const evidenceRevision = JSON.parse(JSON.stringify(recomputedTruth));
  evidenceRevision.correlations.tasks[0].evidence[0].recordedAt = '2026-07-17T09:00:00.000Z';
  assert.notStrictEqual(
    fingerprintDAVEProjectTruth(originalTruth),
    fingerprintDAVEProjectTruth(evidenceRevision),
    'meaningful evidence occurrence times must remain part of the semantic revision',
  );

  const intelligenceRevision = JSON.parse(JSON.stringify(originalTruth));
  intelligenceRevision.intelligence = {
    ...intelligenceRevision.intelligence,
    projectState: 'at_risk',
  };
  assert.notStrictEqual(
    fingerprintDAVEProjectTruth(originalTruth),
    fingerprintDAVEProjectTruth(intelligenceRevision),
    'canonical intelligence changes must create semantic revisions',
  );

  const intelligenceStorage = memoryStorage();
  const intelligenceRepository = createDAVEProjectTruthRepository({
    storage: intelligenceStorage,
  });
  await intelligenceRepository.save('owner-a', originalTruth);
  const savedIntelligenceRevision = await intelligenceRepository.save(
    'owner-a',
    intelligenceRevision,
  );
  assert.strictEqual(savedIntelligenceRevision.created, true);
  assert.strictEqual(savedIntelligenceRevision.snapshot.revision, 2);
  assert.strictEqual(
    savedIntelligenceRevision.snapshot.truth.intelligence.projectState,
    'at_risk',
    'the repository must not return stale intelligence from an equal non-intelligence fingerprint',
  );

  const storage = memoryStorage();
  const repository = createDAVEProjectTruthRepository({ storage });

  const first = await repository.save('owner-a', truth());
  assert.strictEqual(first.created, true);
  assert.strictEqual(first.snapshot.revision, 1);
  assert.strictEqual(first.cloudStatus, 'local_only');

  const malformedStorage = memoryStorage();
  const malformedRaw = '{"repositoryVersion":"dave-project-truth-repository/1.0",\n\u0000unfinished';
  await malformedStorage.setItem(DAVE_PROJECT_TRUTH_STORAGE_KEY, malformedRaw);
  const malformedRepository = createDAVEProjectTruthRepository({
    storage: malformedStorage,
  });
  await assert.rejects(
    malformedRepository.list('owner-a'),
    /quarantined/i,
    'malformed Project Truth storage must fail the current read',
  );
  assert.strictEqual(
    await malformedStorage.getItem(DAVE_PROJECT_TRUTH_STORAGE_KEY),
    null,
    'malformed active storage may be removed only after quarantine verification',
  );
  const malformedQuarantineKey = [...malformedStorage.data.keys()]
    .find(key => key.startsWith(DAVE_PROJECT_TRUTH_QUARANTINE_KEY_PREFIX));
  assert.strictEqual(
    malformedStorage.data.get(malformedQuarantineKey),
    malformedRaw,
    'Project Truth quarantine must preserve the exact raw value',
  );

  const salvageStorage = memoryStorage();
  const salvageRaw = JSON.stringify({
    repositoryVersion: DAVE_PROJECT_TRUTH_REPOSITORY_VERSION,
    snapshots: [first.snapshot, { id: 'invalid-snapshot-without-truth' }],
  });
  await salvageStorage.setItem(DAVE_PROJECT_TRUTH_STORAGE_KEY, salvageRaw);
  const salvageRepository = createDAVEProjectTruthRepository({ storage: salvageStorage });
  await assert.rejects(
    salvageRepository.list('owner-a'),
    /1 valid record was preserved/i,
    'partial recovery must fail once so callers cannot mistake salvage for a clean read',
  );
  const salvageQuarantineKey = [...salvageStorage.data.keys()]
    .find(key => key.startsWith(DAVE_PROJECT_TRUTH_QUARANTINE_KEY_PREFIX));
  assert.strictEqual(
    salvageStorage.data.get(salvageQuarantineKey),
    salvageRaw,
    'partial recovery must preserve the exact original envelope',
  );
  const salvaged = await salvageRepository.list('owner-a');
  assert.deepStrictEqual(
    salvaged.map(snapshot => snapshot.id),
    [first.snapshot.id],
    'a retry may continue from only the validated snapshots installed after quarantine',
  );

  const quarantineFailureStorage = memoryStorage();
  const quarantineFailureRaw = '{not-json';
  await quarantineFailureStorage.setItem(
    DAVE_PROJECT_TRUTH_STORAGE_KEY,
    quarantineFailureRaw,
  );
  const originalSetItem = quarantineFailureStorage.setItem.bind(quarantineFailureStorage);
  quarantineFailureStorage.setItem = async (key, value) => {
    if (key.startsWith(DAVE_PROJECT_TRUTH_QUARANTINE_KEY_PREFIX)) {
      throw new Error('simulated quarantine failure');
    }
    return originalSetItem(key, value);
  };
  const quarantineFailureRepository = createDAVEProjectTruthRepository({
    storage: quarantineFailureStorage,
  });
  await assert.rejects(
    quarantineFailureRepository.list('owner-a'),
    /left in place/i,
  );
  assert.strictEqual(
    await quarantineFailureStorage.getItem(DAVE_PROJECT_TRUTH_STORAGE_KEY),
    quarantineFailureRaw,
    'a failed quarantine must leave the active Project Truth bytes untouched',
  );

  const legacyStorage = memoryStorage();
  const legacySnapshot = {
    ...first.snapshot,
    id: 'legacy-project-truth-snapshot',
    sourceFingerprint: legacyFingerprint(first.snapshot.truth),
  };
  await legacyStorage.setItem(DAVE_PROJECT_TRUTH_STORAGE_KEY, JSON.stringify({
    repositoryVersion: DAVE_PROJECT_TRUTH_REPOSITORY_VERSION,
    snapshots: [legacySnapshot],
  }));
  const legacyRepository = createDAVEProjectTruthRepository({ storage: legacyStorage });
  const migratedUnchanged = await legacyRepository.save('owner-a', recomputedTruth);
  assert.strictEqual(
    migratedUnchanged.created,
    false,
    'existing snapshots using the prior fingerprint must hydrate without a migration-only revision',
  );
  assert.strictEqual(migratedUnchanged.snapshot.revision, 1);

  const priorSemanticStorage = memoryStorage();
  const priorSemanticSnapshot = {
    ...first.snapshot,
    id: 'prior-semantic-project-truth-snapshot',
    sourceFingerprint: priorSemanticFingerprint(first.snapshot.truth),
  };
  await priorSemanticStorage.setItem(DAVE_PROJECT_TRUTH_STORAGE_KEY, JSON.stringify({
    repositoryVersion: DAVE_PROJECT_TRUTH_REPOSITORY_VERSION,
    snapshots: [priorSemanticSnapshot],
  }));
  const priorSemanticRepository = createDAVEProjectTruthRepository({
    storage: priorSemanticStorage,
  });
  const hydratedPriorSemantic = await priorSemanticRepository.save(
    'owner-a',
    recomputedTruth,
  );
  assert.strictEqual(
    hydratedPriorSemantic.created,
    false,
    'snapshots from the immediately prior semantic fingerprint remain readable without a migration-only revision',
  );
  assert.strictEqual(hydratedPriorSemantic.snapshot.revision, 1);

  const unchanged = await repository.save('owner-a', recomputedTruth);
  assert.strictEqual(
    unchanged.created,
    false,
    'recomputing unchanged authoritative inputs at a later time must not create a revision',
  );
  assert.strictEqual(unchanged.snapshot.revision, 1);

  const changed = await repository.save('owner-a', truth('A new verified condition changed the truth'));
  assert.strictEqual(changed.created, true);
  assert.strictEqual(changed.snapshot.revision, 2);

  const returned = await repository.save('owner-a', truth());
  assert.strictEqual(returned.created, true, 'A-to-B-to-A must append a new meaningful revision');
  assert.strictEqual(returned.snapshot.revision, 3);
  assert.strictEqual(
    returned.snapshot.sourceFingerprint,
    first.snapshot.sourceFingerprint,
    'returning to A should retain A semantic identity',
  );
  assert.notStrictEqual(
    returned.snapshot.id,
    first.snapshot.id,
    'repeated historical semantics must have revision-specific snapshot IDs',
  );
  const repeatedHead = await repository.save('owner-a', truth());
  assert.strictEqual(repeatedHead.created, false, 'only an unchanged current head should deduplicate');
  assert.strictEqual(repeatedHead.snapshot.revision, 3);

  const history = await repository.list('owner-a', 'project-alpha');
  assert.deepStrictEqual(history.map(snapshot => snapshot.revision), [3, 2, 1]);
  assert.deepStrictEqual(
    history.map(snapshot => snapshot.sourceFingerprint),
    [first.snapshot.sourceFingerprint, changed.snapshot.sourceFingerprint, first.snapshot.sourceFingerprint],
    'A-to-B-to-A history must preserve both A revisions instead of globally deduplicating A',
  );

  const latest = await repository.loadLatest('owner-a', 'project-alpha');
  assert.strictEqual(latest.revision, 3);
  assert.strictEqual(latest.truth.briefing.headline, 'Current project truth');
  assert.strictEqual((await repository.list('owner-b')).length, 0, 'another owner must not see snapshots');

  const concurrentStorage = memoryStorage();
  const concurrentA = createDAVEProjectTruthRepository({ storage: concurrentStorage });
  const concurrentB = createDAVEProjectTruthRepository({ storage: concurrentStorage });
  await Promise.all([
    concurrentA.save('owner-a', projectTruth('project-one', 'One', 'Project one truth')),
    concurrentB.save('owner-a', projectTruth('project-two', 'Two', 'Project two truth')),
  ]);
  const concurrentProjects = await concurrentA.list('owner-a');
  assert.deepStrictEqual(
    Array.from(new Set(concurrentProjects.map(snapshot => snapshot.projectId))).sort(),
    ['project-one', 'project-two'],
    'concurrent saves for different projects must not overwrite the shared envelope',
  );

  const revisionStorage = memoryStorage();
  const revisionA = createDAVEProjectTruthRepository({ storage: revisionStorage });
  const revisionB = createDAVEProjectTruthRepository({ storage: revisionStorage });
  await revisionA.save('owner-a', projectTruth('project-shared', 'Shared', 'Initial truth'));
  const concurrentRevisions = await Promise.all([
    revisionA.save('owner-a', projectTruth('project-shared', 'Shared', 'Second truth')),
    revisionB.save('owner-a', projectTruth('project-shared', 'Shared', 'Third truth')),
  ]);
  assert.deepStrictEqual(
    concurrentRevisions.map(result => result.snapshot.revision).sort((a, b) => a - b),
    [2, 3],
    'concurrent changes for one project must receive unique monotonic revisions',
  );

  const cloudSeedStorage = memoryStorage();
  const cloudSeed = createDAVEProjectTruthRepository({ storage: cloudSeedStorage });
  for (let revision = 1; revision <= 6; revision += 1) {
    await cloudSeed.save(
      'owner-a',
      projectTruth('project-cloud', 'Cloud', `Cloud truth revision ${revision}`),
    );
  }
  const cloudHeads = await cloudSeed.list('owner-a', 'project-cloud');
  const cloudRevision4 = cloudHeads.find(snapshot => snapshot.revision === 4);
  const cloudRevision6 = cloudHeads.find(snapshot => snapshot.revision === 6);
  let cloudLoadCount = 0;
  let cloudSaveCount = 0;
  loadCloudSnapshot = async () => ({
    ok: true,
    configured: true,
    data: cloudLoadCount++ === 0 ? cloudRevision4 : cloudRevision6,
  });
  saveCloudSnapshot = async snapshot => {
    cloudSaveCount += 1;
    return cloudSaveCount === 1
      ? {
          ok: false,
          configured: true,
          data: null,
          status: 409,
          code: 'truth_revision_conflict',
          error: 'A newer Project Truth revision already exists.',
        }
      : { ok: true, configured: true, data: snapshot };
  };
  const cloudRepository = createDAVEProjectTruthRepository({
    storage: memoryStorage(),
    cloudEnabled: true,
    identityTrusted: true,
  });
  const retriedCloudSave = await cloudRepository.save(
    'owner-a',
    projectTruth('project-cloud', 'Cloud', 'Field device verified a newer condition'),
  );
  assert.strictEqual(retriedCloudSave.cloudStatus, 'saved');
  assert.strictEqual(retriedCloudSave.snapshot.revision, 7, 'a stale device must retry after the latest cloud revision');
  assert.strictEqual(retriedCloudSave.created, true, 'a retry that appends after a changed cloud head creates a revision');
  assert.strictEqual(cloudSaveCount, 2, 'cloud revision conflicts must use a bounded retry');

  const concurrentHead = await cloudSeed.save(
    'owner-a',
    projectTruth('project-cloud', 'Cloud', 'Concurrent semantic head'),
  );
  const recomputedConcurrentHead = JSON.parse(JSON.stringify(concurrentHead.snapshot.truth));
  recomputedConcurrentHead.generatedAt = '2026-07-18T08:30:00.000Z';
  recomputedConcurrentHead.correlations.generatedAt = '2026-07-18T08:30:00.000Z';
  recomputedConcurrentHead.reasoning.generatedAt = '2026-07-18T08:30:00.000Z';
  cloudLoadCount = 0;
  cloudSaveCount = 0;
  loadCloudSnapshot = async () => ({
    ok: true,
    configured: true,
    data: cloudLoadCount++ === 0 ? cloudRevision6 : concurrentHead.snapshot,
  });
  saveCloudSnapshot = async () => {
    cloudSaveCount += 1;
    return {
      ok: false,
      configured: true,
      data: null,
      status: 409,
      code: 'truth_revision_conflict',
      error: 'A newer Project Truth revision already exists.',
    };
  };
  const concurrentHeadRepository = createDAVEProjectTruthRepository({
    storage: memoryStorage(),
    cloudEnabled: true,
    identityTrusted: true,
  });
  const deduplicatedConcurrentHead = await concurrentHeadRepository.save(
    'owner-a',
    recomputedConcurrentHead,
  );
  assert.strictEqual(deduplicatedConcurrentHead.cloudStatus, 'saved');
  assert.strictEqual(deduplicatedConcurrentHead.snapshot.revision, concurrentHead.snapshot.revision);
  assert.strictEqual(
    deduplicatedConcurrentHead.created,
    false,
    'a retry may deduplicate only when the newly loaded current head is semantically equal',
  );
  assert.strictEqual(cloudSaveCount, 1, 'an equivalent concurrent head must stop the retry loop');

  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260716010000_dave_project_truth_snapshots.sql'),
    'utf8',
  );
  assert(migration.includes('DAVE Project Truth history is append-only'));
  assert(migration.includes('owner_id = (select auth.uid())'));
  assert(migration.includes('organization_id = (select auth.uid())::text'));
  assert(!/using\s*\(\s*true\s*\)/i.test(migration));
  assert(!/with\s+check\s*\(\s*true\s*\)/i.test(migration));

  const historyFingerprintMigration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260718044000_dave_project_truth_history_fingerprints.sql'),
    'utf8',
  );
  assert(historyFingerprintMigration.includes("constraint_record.contype = 'u'"));
  assert(historyFingerprintMigration.includes("array['owner_id', 'project_id', 'source_fingerprint']::name[]"));
  assert(historyFingerprintMigration.includes('drop constraint %I'));
  assert(historyFingerprintMigration.includes('dave_project_truth_fingerprint_history_idx'));
  assert(!/create\s+unique\s+index/i.test(historyFingerprintMigration));

  const realityUpdateMigration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260716020000_pie_reality_upsert_policies.sql'),
    'utf8',
  );
  for (const table of [
    'pie_reality_models',
    'pie_reality_objects',
    'pie_reality_assertions',
    'pie_reality_relationships',
    'pie_reality_conflicts',
    'pie_reality_uncertainties',
  ]) {
    assert(
      realityUpdateMigration.includes(`${table}_member_update`),
      `${table} must allow owner-authorized revision upserts`,
    );
  }
  assert(!realityUpdateMigration.includes('pie_reality_model_snapshots_member_update'));
  assert(!realityUpdateMigration.includes('pie_reality_object_history_member_update'));

  console.log('DAVE Project Truth repository behavior tests passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
