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
    throw new Error(`Unexpected dependency: ${specifier}`);
  },
  moduleUnderTest,
  moduleUnderTest.exports,
);

const { createDAVEProjectTruthRepository } = moduleUnderTest.exports;

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
  const storage = memoryStorage();
  const repository = createDAVEProjectTruthRepository({ storage });

  const first = await repository.save('owner-a', truth());
  assert.strictEqual(first.created, true);
  assert.strictEqual(first.snapshot.revision, 1);
  assert.strictEqual(first.cloudStatus, 'local_only');

  const unchanged = await repository.save('owner-a', truth());
  assert.strictEqual(unchanged.created, false, 'unchanged authoritative inputs must not create a revision');
  assert.strictEqual(unchanged.snapshot.revision, 1);

  const changed = await repository.save('owner-a', truth('A new verified condition changed the truth'));
  assert.strictEqual(changed.created, true);
  assert.strictEqual(changed.snapshot.revision, 2);

  const latest = await repository.loadLatest('owner-a', 'project-alpha');
  assert.strictEqual(latest.revision, 2);
  assert.strictEqual(latest.truth.briefing.headline, 'A new verified condition changed the truth');
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
  assert.strictEqual(cloudSaveCount, 2, 'cloud revision conflicts must use a bounded retry');

  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260716010000_dave_project_truth_snapshots.sql'),
    'utf8',
  );
  assert(migration.includes('DAVE Project Truth history is append-only'));
  assert(migration.includes('owner_id = (select auth.uid())'));
  assert(migration.includes('organization_id = (select auth.uid())::text'));
  assert(!/using\s*\(\s*true\s*\)/i.test(migration));
  assert(!/with\s+check\s*\(\s*true\s*\)/i.test(migration));

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
