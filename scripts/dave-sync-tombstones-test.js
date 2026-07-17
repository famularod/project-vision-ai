#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'services/DAVESyncTombstones.ts');
const storage = new Map();
let cloudListResult = {
  ok: true,
  configured: true,
  data: [],
};
const uploaded = [];

const asyncStorage = {
  async getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  async setItem(key, value) {
    storage.set(key, value);
  },
};

const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleUnderTest = { exports: {} };
const mockedRequire = request => {
  if (request === '@react-native-async-storage/async-storage') {
    return { __esModule: true, default: asyncStorage };
  }
  if (request === './SupabaseService') {
    return {
      async listDAVESyncTombstones() {
        return cloudListResult;
      },
      async upsertDAVESyncTombstone(tombstone) {
        uploaded.push(tombstone);
        return { ok: true, configured: true, data: tombstone };
      },
    };
  }
  throw new Error(`Unexpected dependency: ${request}`);
};
new Function('module', 'exports', 'require', compiled)(
  moduleUnderTest,
  moduleUnderTest.exports,
  mockedRequire,
);

const {
  DAVE_SYNC_TOMBSTONES_STORAGE_KEY,
  deletedDAVERecordIds,
  loadDAVESyncTombstones,
  mergeDAVESyncTombstones,
  recordDAVESyncTombstones,
  removeDAVETombstonedRecords,
  synchronizeDAVESyncTombstones,
} = moduleUnderTest.exports;

async function run() {
  const merged = mergeDAVESyncTombstones(
    [{ entityType: 'schedule_item', recordId: 'same-id', deletedAt: '2026-07-16T10:00:00.000Z' }],
    [
      { entityType: 'schedule_item', recordId: 'SAME-ID', deletedAt: '2026-07-16T11:00:00.000Z' },
      { entityType: 'reference_document', recordId: 'same-id', deletedAt: '2026-07-16T09:00:00.000Z' },
    ],
  );
  assert.strictEqual(merged.length, 2, 'the same id in different entity domains must remain independent');
  assert.strictEqual(
    merged.find(item => item.entityType === 'schedule_item').deletedAt,
    '2026-07-16T11:00:00.000Z',
    'the newest deletion timestamp must win for a repeated record',
  );

  await recordDAVESyncTombstones([
    { entityType: 'reference_document', recordId: 'document-1' },
    { entityType: 'schedule_item', recordId: 'task-1' },
    { entityType: 'schedule_item', recordId: 'task-2' },
  ], '2026-07-16T12:00:00.000Z');
  const local = await loadDAVESyncTombstones();
  assert.strictEqual(local.length, 3, 'batch deletion must persist every tombstone in one local mutation');
  assert.strictEqual(
    JSON.parse(storage.get(DAVE_SYNC_TOMBSTONES_STORAGE_KEY)).length,
    3,
    'the durable local record must contain the complete deletion batch',
  );

  cloudListResult = {
    ok: true,
    configured: true,
    data: [{
      entityType: 'project_area',
      recordId: 'area-from-phone-b',
      deletedAt: '2026-07-16T13:00:00.000Z',
    }],
  };
  const synchronized = await synchronizeDAVESyncTombstones();
  assert.strictEqual(synchronized.cloudAuthoritative, true, 'a successful cloud inventory must be authoritative');
  assert.strictEqual(synchronized.tombstones.length, 4, 'cloud and local tombstones must merge without loss');
  assert.deepStrictEqual(
    deletedDAVERecordIds(synchronized.tombstones, 'project_area'),
    ['area-from-phone-b'],
  );
  assert.deepStrictEqual(
    removeDAVETombstonedRecords(
      [{ id: 'area-from-phone-b' }, { id: 'keep-area' }],
      synchronized.tombstones,
      'project_area',
    ),
    [{ id: 'keep-area' }],
    'a deletion from another device must filter stale local state',
  );

  cloudListResult = {
    ok: true,
    configured: true,
    data: [],
    stubbed: true,
    message: 'Required database table is unavailable.',
  };
  const unavailable = await synchronizeDAVESyncTombstones();
  assert.strictEqual(
    unavailable.cloudAuthoritative,
    false,
    'a missing tombstone table must never be treated as an authoritative empty inventory',
  );
  assert.strictEqual(unavailable.tombstones.length, 4, 'cloud failure must preserve local deletion history');
  assert(uploaded.length >= 3, 'locally durable deletions must be retried to the cloud');

  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  const syncService = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');
  const supabase = fs.readFileSync(path.join(root, 'services/SupabaseService.ts'), 'utf8');
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260716030000_dave_sync_tombstones.sql'),
    'utf8',
  );

  for (const entity of ['project_area', 'schedule_item', 'reference_document']) {
    assert(app.includes(`'${entity}'`), `${entity} deletions must be wired into the live app`);
    assert(migration.includes(`'${entity}'`), `${entity} must be allowed by the database constraint`);
  }
  assert(
    syncService.indexOf("progress('Checking cross-device deletion history')") <
      syncService.indexOf("progress('Uploading queued changes')"),
    'full sync must verify deletion history before uploading stale local records',
  );
  assert(
    syncService.includes('if (!tombstoneSync.cloudAuthoritative)') &&
      syncService.includes('No local records were uploaded.'),
    'full sync must fail closed when the cloud deletion inventory is unavailable',
  );
  assert(supabase.includes(".upsert(\n      {\n        owner_id: owner.data"), 'cloud tombstones must be owner scoped');
  assert(migration.includes('force row level security'), 'tombstones must force RLS');
  assert(!/\busing\s*\(\s*true\s*\)/i.test(migration), 'tombstones must not use permissive RLS');
  assert(!/\bwith\s+check\s*\(\s*true\s*\)/i.test(migration), 'tombstone writes must be owner checked');

  console.log('DAVE cross-device deletion tombstone tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
