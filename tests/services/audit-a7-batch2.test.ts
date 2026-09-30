jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

import { preflightAppBackup, APP_BACKUP_VERSION } from '../../services/BackupRestoreRuntime';
import { isStartupDraftEnvelope, isStartupSavedUpdateRecord } from '../../services/StartupRecordValidation';
import {
  archiveDraftEnvelopeForValidation,
  archivePhotoIsLocated,
  archiveUpdateForValidation,
  archiveUpdatePhotosAreLocated,
  markPhotoUnavailableInBackup,
} from '../../services/BackupArchivePhotos';
import { resolveLegacyOwnedLocalFilePath } from '../../services/OwnedLocalFileRepository';
import { cloudPhotoPreviewIsFresh } from '../../services/SyncService';
import { unavailablePhotosNotice } from '../../services/DeviceBackupWorkflow';
import { createDAVEOperationalRealtimeApplier } from '../../services/DAVEOperationalRealtimeApplication';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A top-level `function name(` block of App.tsx, up to the next top-level declaration. */
function appFunction(name: string): string {
  const start = app.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`App.tsx has no function ${name}`);
  const rest = app.slice(start + 1);
  const end = rest.search(/\n(?:async )?function |\nconst |\nexport |\ntype |\ninterface /);
  return rest.slice(0, end < 0 ? undefined : end);
}

/**
 * The App's own photo resolvers and device wrapper, as compiled from the
 * source, with an iPhone document directory: audit A7 pass 2 showed that a
 * re-implementation of the wrapper in the batch-1 test hid the defect.
 */
const DOCUMENTS = 'file:///var/mobile/Containers/Data/Application/5D1B/Documents/';
const PHOTO_STORAGE_FOLDER = 'project-photos';
const PHOTO_STORAGE_DIR = `${DOCUMENTS}${PHOTO_STORAGE_FOLDER}/`;
const RECOVERED_PHOTO_CACHE_FOLDER = 'dave-recovered-project-photos';
const compiled = ts.transpileModule(
  [
    appFunction('resolveProjectPhotoUri'),
    appFunction('resolveProjectPhotoDisplayUri'),
    appFunction('isStartupDeviceSavedUpdateRecord'),
    appFunction('isStartupDeviceDraftEnvelope'),
    'module.exports = { resolveProjectPhotoUri, resolveProjectPhotoDisplayUri, isStartupDeviceSavedUpdateRecord, isStartupDeviceDraftEnvelope };',
  ].join('\n'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const appModule = { exports: {} as Record<string, (value: unknown) => unknown> };
new Function(
  'module', 'exports', 'PHOTO_STORAGE_DIR', 'PHOTO_STORAGE_FOLDER', 'RECOVERED_PHOTO_CACHE_FOLDER', 'FileSystem',
  'resolveLegacyOwnedLocalFilePath', 'cloudPhotoPreviewIsFresh', 'isStartupSavedUpdateRecord', 'isStartupDraftEnvelope', 'isRecord',
  compiled,
)(
  appModule, appModule.exports, PHOTO_STORAGE_DIR, PHOTO_STORAGE_FOLDER, RECOVERED_PHOTO_CACHE_FOLDER,
  { cacheDirectory: 'file:///var/mobile/Containers/Data/Application/5D1B/Library/Caches/' },
  resolveLegacyOwnedLocalFilePath, cloudPhotoPreviewIsFresh, isStartupSavedUpdateRecord, isStartupDraftEnvelope,
  (value: unknown) => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
);
const { resolveProjectPhotoDisplayUri, isStartupDeviceSavedUpdateRecord } = appModule.exports;

/** The archive validators exactly as normalizeBackupData({ archive: true }) composes them. */
const deviceResolves = (photo: unknown) => Boolean(resolveProjectPhotoDisplayUri(photo));
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validators = {
  savedUpdate: (item: unknown) =>
    isStartupSavedUpdateRecord(archiveUpdateForValidation(item)) && archiveUpdatePhotosAreLocated(item, deviceResolves),
  draftEnvelope: (item: unknown) =>
    isStartupDraftEnvelope(archiveDraftEnvelopeForValidation(item)) &&
    (!isRecord(item) || !('draft' in item) || archiveUpdatePhotosAreLocated(item.draft, deviceResolves)),
  projectName: (value: unknown) => typeof value === 'string',
  projectArea: () => true, referenceDocument: () => true, projectDocument: () => true, scheduleItem: () => true,
  captureMemory: () => true, contactBook: () => true,
};

const photo = (extra: Record<string, unknown>): Record<string, unknown> => ({
  id: 'p1', caption: 'Rebar', category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: 'p1.jpg', mimeType: 'image/jpeg', ...extra,
});
const update = (photos: unknown[]) => ({
  id: 'u1', projectName: 'P', date: '2026-09-30', notes: 'n', recipients: { contactIds: [] }, photos, status: 'queued',
});
const archive = (savedUpdates: unknown[], draft: unknown = null) => ({
  version: APP_BACKUP_VERSION, exportedAt: '2026-09-30T04:00:00.000Z',
  savedUpdates, projects: ['P'], archivedProjects: [], projectAreas: [], referenceDocuments: [], projectDocuments: [],
  scheduleItems: [], captureMemories: [], contacts: { contacts: [] },
  activeDraft: draft ? { draft, savedAt: '2026-09-30T04:00:00.000Z' } : null,
});

// Whole-app audit A7 pass 2 (30 Sep 2026).
describe('an archive with carried, cloud-backed, unavailable or older-style photos preflights with the App’s own device rules', () => {
  const carried = photo({ uri: '', _backupAssetId: 'photo:update:u1:p1' });
  const cloudBacked = photo({ uri: '', cloudStoragePath: 'P/u1/p1-p1.jpg' });
  const declared = markPhotoUnavailableInBackup(photo({ uri: 'file:///photos/p1.jpg' }));
  const older = photo({ uri: '' });
  const materialized = photo({ uri: `${PHOTO_STORAGE_DIR}u1-p1.jpg` });

  it('the device wrapper alone refuses a placeholder (why batch 1 failed on the phone)', () => {
    expect(deviceResolves(photo({ uri: 'vitruvius-backup-asset:photo:update:u1:p1' }))).toBe(false);
    expect(isStartupDeviceSavedUpdateRecord(archiveUpdateForValidation(update([carried])))).toBe(false);
    expect(isStartupDeviceSavedUpdateRecord(update([materialized]))).toBe(true);
  });

  it('accepts every archive shape the export writes, plus the older encoding, and still refuses a foreign file path', () => {
    for (const shape of [carried, cloudBacked, declared, older, materialized]) {
      expect(preflightAppBackup(archive([update([shape])]), validators as never).ok).toBe(true);
      expect(preflightAppBackup(archive([], update([shape])), validators as never).ok).toBe(true);
    }
    // A full backup with an open draft holding two camera photos and one unsynced update.
    const twoCarried = [carried, { ...carried, id: 'p2', _backupAssetId: 'photo:draft:d1:p2' }];
    expect(preflightAppBackup(archive([update([carried])], { ...update(twoCarried), id: 'd1', status: 'draft' }), validators as never).ok).toBe(true);
    // A real uri that is neither a file on this phone nor a signed URL is still refused, as on the device.
    // (A path under the app's photo folder in another container is rebound to this one by design; one elsewhere is not.)
    const foreign = photo({ uri: 'file:///var/mobile/Containers/Data/Application/OTHER/Documents/elsewhere/x.jpg' });
    expect(archivePhotoIsLocated(foreign, deviceResolves)).toBe(false);
    const refused = preflightAppBackup(archive([update([foreign])]), validators as never);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.field).toBe('savedUpdates[0]');
  });

  it('is how the App composes the archive validators', () => {
    expect(app).toMatch(/const deviceResolves = \(photo: unknown\) =>\n\s+Boolean\(resolveProjectPhotoDisplayUri\(photo as Partial<UpdatePhoto>\)\);/);
    expect(app).toMatch(/\? \(item: unknown\) =>\n\s+isStartupSavedUpdateRecord\(archiveUpdateForValidation\(item\)\) &&\n\s+archiveUpdatePhotosAreLocated\(item, deviceResolves\)/);
    expect(app).toMatch(/isStartupDraftEnvelope\(archiveDraftEnvelopeForValidation\(item\)\) &&\n\s+\(!isRecord\(item\) \|\| !\('draft' in item\) \|\| archiveUpdatePhotosAreLocated\(item\.draft, deviceResolves\)\)/);
    expect(app).toContain("const restorable = normalizeBackupData(backup, { archive: true });");
  });
});

describe('the export tells the owner which photos it could not confirm, apart from those only on this phone', () => {
  it('counts a cloud location this export could not confirm, and keeps the location', () => {
    expect(app).toMatch(/if \(photo\.cloudStoragePath\?\.trim\(\)\) \{\n(?:\s*\/\/.*\n)*\s+if \(photo\.cloudRecoveryStatus === 'unavailable'\) \{\n\s+unavailablePhotos\.push\(\{ projectName: update\.projectName, updateDate: update\.date, reason: 'cloud_unconfirmed' \}\);\n\s+\}\n\s+photos\.push\(\{ \.\.\.photo, uri: '' \}\);\n\s+continue;\n\s+\}\n\s+unavailablePhotos\.push\(\{ projectName: update\.projectName, updateDate: update\.date, reason: 'only_on_this_phone' \}\);\n\s+photos\.push\(markPhotoUnavailableInBackup\(photo\)\);/);
  });

  it('says the two kinds apart, in both backup modes', () => {
    const mixed = [
      { projectName: 'P', updateDate: '2026-09-30', reason: 'only_on_this_phone' as const },
      { projectName: 'P', updateDate: '2026-09-29', reason: 'cloud_unconfirmed' as const },
      { projectName: 'P', updateDate: '2026-09-29', reason: 'cloud_unconfirmed' as const },
    ];
    const full = unavailablePhotosNotice(mixed);
    expect(full).toContain('1 photo is not on this device and could not be downloaded from the cloud, so this backup will leave it out.');
    expect(full).toContain('2 photos could not be confirmed in the cloud right now');
    expect(full).toContain('keeps their cloud location so a restore can look again');
    expect(full).toContain('P: 3 photos, from updates dated 2026-09-29, 2026-09-30');
    const recordsOnly = unavailablePhotosNotice(mixed, { recordsOnly: true });
    expect(recordsOnly).toContain('1 photo is only on this phone, and a records-only backup cannot carry it; a full backup can.');
    expect(recordsOnly).toContain('2 photos could not be confirmed in the cloud right now');
    // Older callers without a reason read as before.
    expect(unavailablePhotosNotice([{ projectName: 'P', updateDate: '2026-09-30' }])).toContain('1 photo is not on this device');
    expect(app).toContain("unavailablePhotosNotice(unavailablePhotos, { recordsOnly: true }),");
  });
});

describe('a realtime row for a record this device deleted does not bring it back', () => {
  const deletedAt = '2026-09-30T10:00:00.000Z';
  const applierFor = (tombstones: Array<{ entityType: string; recordId: string; deletedAt: string }>) => {
    const commitSchedule = jest.fn();
    const commitAreas = jest.fn();
    const commitDocuments = jest.fn();
    const state = {
      projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [],
      updates: [], deletedUpdates: [], tombstones,
      areas: [{ id: 'area-1', name: 'Pad', projectName: 'P', updatedAt: deletedAt }],
      scheduleItems: [{ id: 'task-1', taskName: 'Pour', projectName: 'P' }],
      documents: [{ id: 'doc-1', name: 'Schedule', projectNames: ['P'] }],
    };
    const apply = createDAVEOperationalRealtimeApplier({
      isActive: () => true,
      snapshot: () => state,
      getPendingQueue: async () => [],
      normalizeUpdate: (value: unknown) => value,
      normalizeAreas: (value: unknown[]) => value,
      normalizeSchedule: (value: unknown[]) => value,
      normalizeDocuments: (value: unknown[]) => value,
      migrateSchedule: (value: unknown) => value,
      localPhotoUri: () => '',
      mergeProjectNames: (baseNames: string[]) => baseNames,
      updateHasPendingLocalWork: () => false,
      mergeUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates,
      buildUpdateTombstone: jest.fn(),
      buildCloudDeletionBarrier: (updateId: string, at: string) => ({ updateId, deletedAt: at, action: 'hide_cloud_update' }),
      upsertDeletedUpdate: (current: unknown[], next: unknown) => [...current, next],
      commitProjects: jest.fn(), commitDeletedProjects: jest.fn(), commitUpdates: jest.fn(), commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(), commitAreas, commitSchedule, commitDocuments,
    } as never);
    return { apply, commitSchedule, commitAreas, commitDocuments };
  };
  /** The cloud row shape: the record in its JSON column, with the row id (see normalizeDAVEOperationalRealtimeRecord). */
  const row = (column: 'item_data' | 'area_data' | 'document_data', record: Record<string, unknown>) =>
    ({ eventType: 'UPDATE' as const, newRow: { id: record.id, project_name: record.projectName ?? null, updated_at: '2026-09-30T11:00:00.000Z', [column]: record } });

  it('a deleted task stays deleted; an edit echo of a live task still applies', async () => {
    const deleted = applierFor([{ entityType: 'schedule_item', recordId: 'task-1', deletedAt }]);
    expect(await deleted.apply('schedule_item', row('item_data', { id: 'task-1', taskName: 'Pour (edited)', projectName: 'P' }) as never)).toBe(true);
    expect(deleted.commitSchedule).not.toHaveBeenCalled();
    const live = applierFor([]);
    await live.apply('schedule_item', row('item_data', { id: 'task-1', taskName: 'Pour (edited)', projectName: 'P' }) as never);
    expect(live.commitSchedule).toHaveBeenCalledTimes(1);
  });

  it('a deleted area or document stays deleted', async () => {
    const applier = applierFor([
      { entityType: 'project_area', recordId: 'area-1', deletedAt },
      { entityType: 'reference_document', recordId: 'doc-1', deletedAt },
    ]);
    await applier.apply('project_area', row('area_data', { id: 'area-1', name: 'Pad East', projectName: 'P', updatedAt: '2026-09-30T11:00:00.000Z' }) as never);
    expect(applier.commitAreas).toHaveBeenCalledTimes(1);
    expect((applier.commitAreas.mock.calls[0][0] as Array<{ id: string }>).map(area => area.id)).not.toContain('area-1');
    await applier.apply('reference_document', row('document_data', { id: 'doc-1', name: 'Schedule v2', projectNames: ['P'] }) as never);
    expect(applier.commitDocuments).toHaveBeenCalledTimes(1);
    expect((applier.commitDocuments.mock.calls[0][0] as Array<{ id: string }>).map(document => document.id)).not.toContain('doc-1');
  });
});
