#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'services/DAVECloudRecovery.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', compiled)(moduleUnderTest, moduleUnderTest.exports);

const {
  mergeDAVECloudRecoveryRecords,
  mergeDAVECloudRecoveredProjectUpdate,
  countDAVECloudRecoveredRecords,
  bindDAVECloudDatabaseIdentity,
} = moduleUnderTest.exports;

assert.strictEqual(bindDAVECloudDatabaseIdentity({ id: 'payload-id' }, 'db-id').id, 'db-id');
assert.strictEqual(bindDAVECloudDatabaseIdentity({ value: 1 }, 'db-id').id, 'db-id');
assert.deepStrictEqual(bindDAVECloudDatabaseIdentity({ id: 'payload-id' }, ''), { id: 'payload-id' });

const cloud = [
  { id: 'cloud-only', value: 'recover me' },
  { id: 'shared', value: 'older cloud value' },
  { id: 'deleted', value: 'must stay deleted' },
];
const local = [
  { id: 'shared', value: 'new unsynced device value' },
  { id: 'local-only', value: 'keep me' },
];

const merged = mergeDAVECloudRecoveryRecords({
  local,
  cloud,
  deletedIds: ['deleted'],
});

assert.deepStrictEqual(
  merged.map(record => record.id),
  ['cloud-only', 'shared', 'local-only'],
  'cloud-only recovery and local records should be retained in stable order',
);
assert.strictEqual(
  merged.find(record => record.id === 'shared').value,
  'new unsynced device value',
  'unsynced device state must win over an older cloud copy',
);
assert.strictEqual(
  merged.some(record => record.id === 'deleted'),
  false,
  'explicit deletion records must prevent cloud resurrection',
);
assert.strictEqual(
  countDAVECloudRecoveredRecords(local, merged),
  1,
  'recovery accounting should count only cloud-only records',
);

const mergedUpdateRecovery = mergeDAVECloudRecoveredProjectUpdate(
  {
    id: 'update-1',
    projectName: 'Hospital',
    date: '2026-07-16',
    notes: 'Unsynced local note',
    recipients: {},
    photos: [{
      id: 'photo-1',
      uri: 'https://expired.example/photo',
      caption: 'Unsynced local caption',
      category: 'Update',
      actionRequired: '',
      actionOwner: '',
      actionDueDate: '',
      actionStatus: 'Open',
      cloudStoragePath: 'Hospital/update-1/photo-1.jpg',
      cloudRecoveryStatus: 'signed_url',
      cloudSignedUrlExpiresAt: '2026-07-16T11:59:00.000Z',
    }],
  },
  {
    id: 'update-1',
    projectName: 'Hospital',
    date: '2026-07-16',
    notes: 'Older cloud note',
    recipients: {},
    photos: [{
      id: 'photo-1',
      uri: 'file:///fresh-cloud-recovery.jpg',
      caption: 'Older cloud caption',
      category: 'Update',
      actionRequired: '',
      actionOwner: '',
      actionDueDate: '',
      actionStatus: 'Open',
      cloudStoragePath: 'Hospital/update-1/photo-1.jpg',
      cloudRecoveryStatus: 'cached',
      cloudRecoveredAt: '2026-07-16T12:00:00.000Z',
    }],
  },
  new Date('2026-07-16T12:00:00.000Z').getTime(),
);
assert.strictEqual(mergedUpdateRecovery.notes, 'Unsynced local note', 'local update metadata must still win');
assert.strictEqual(mergedUpdateRecovery.photos[0].caption, 'Unsynced local caption', 'local photo meaning must still win');
assert.strictEqual(mergedUpdateRecovery.photos[0].uri, 'file:///fresh-cloud-recovery.jpg', 'fresh cloud pixels must replace an expired local transport');
assert.strictEqual(mergedUpdateRecovery.photos[0].cloudRecoveryStatus, 'cached');

const supabase = fs.readFileSync(path.join(root, 'services/SupabaseService.ts'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const updateService = fs.readFileSync(path.join(root, 'services/updateService.ts'), 'utf8');

for (const marker of ['listProjectAreas', 'listScheduleItems', 'listReferenceDocuments']) {
  assert(supabase.includes(`export async function ${marker}`), `${marker} must be implemented`);
  assert(sync.includes(`${marker}()`), `${marker} must participate in full cloud download`);
  assert(
    app.includes(`${marker}()`) || app.includes(`loadCloud: ${marker}`),
    `${marker} must participate in startup recovery`,
  );
}
assert(
  sync.includes('projectUpdateWithCloudPhotoPaths(update)') &&
  sync.includes('hydrateRecoveredProjectUpdatePhotos'),
  'synced photo metadata must retain its cloud path and recovered updates must hydrate pixels',
);
assert(
  updateService.includes('hydrateRecoveredProjectUpdatePhotos(update)'),
  'startup cloud update loading must replace stale device photo URIs',
);
assert(
  app.includes('onApplyCloudRecovery={recovered => {'),
  'Settings Sync Now must apply downloaded records to the live app state',
);
for (const field of ['projectAreas', 'scheduleItems', 'referenceDocuments']) {
  assert(sync.includes(`${field}:`), `${field} must be included in the cloud recovery result`);
}

console.log('DAVE cloud recovery behavior tests passed.');
