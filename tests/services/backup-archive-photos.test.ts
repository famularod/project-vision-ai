import { preflightAppBackup, APP_BACKUP_VERSION } from '../../services/BackupRestoreRuntime';
import { isStartupDraftEnvelope, isStartupSavedUpdateRecord } from '../../services/StartupRecordValidation';
import {
  archiveDraftEnvelopeForValidation,
  archivePhotoForValidation,
  archiveUpdateForValidation,
  markPhotoUnavailableInBackup,
} from '../../services/BackupArchivePhotos';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit A7 (30 Sep 2026): an archive holding any draft photo or
// unsynced update photo could not be restored at all.
const photo = (extra: Record<string, unknown>): Record<string, unknown> => ({
  id: 'p1', caption: 'Rebar', category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: 'p1.jpg', mimeType: 'image/jpeg', ...extra,
});
const update = (photos: unknown[]) => ({
  id: 'u1', projectName: 'P', date: '2026-09-30', notes: 'n', recipients: { contactIds: [] }, photos, status: 'queued',
});
/** Shape-only stand-ins (pass 2: the App's real wrapper is compiled and run in audit-a7-batch2.test.ts). */
const validators = {
  savedUpdate: (value: unknown) => {
    const judged = archiveUpdateForValidation(value) as { photos?: Array<{ uri?: unknown; cloudStoragePath?: unknown }> };
    return isStartupSavedUpdateRecord(judged) &&
      (judged.photos ?? []).every(item => Boolean(item.uri) || Boolean(item.cloudStoragePath));
  },
  projectName: (value: unknown) => typeof value === 'string',
  projectArea: () => true, referenceDocument: () => true, projectDocument: () => true, scheduleItem: () => true,
  captureMemory: () => true, contactBook: () => true,
  draftEnvelope: (value: unknown) => isStartupDraftEnvelope(archiveDraftEnvelopeForValidation(value)),
};
const archive = (savedUpdates: unknown[], draft: unknown = null) => ({
  version: APP_BACKUP_VERSION, exportedAt: '2026-09-30T04:00:00.000Z',
  savedUpdates, projects: ['P'], archivedProjects: [], projectAreas: [], referenceDocuments: [], projectDocuments: [],
  scheduleItems: [], captureMemories: [], contacts: { contacts: [] },
  activeDraft: draft ? { draft, savedAt: '2026-09-30T04:00:00.000Z' } : null,
});

describe('a backup archive restores whatever the export could carry', () => {
  it('accepts a carried photo (draft or unsynced update) by its asset id, a cloud-backed one by its path, and a declared-unavailable one', () => {
    const carried = photo({ uri: '', _backupAssetId: 'photo:update:u1:p1' });
    expect(preflightAppBackup(archive([update([carried])]), validators as never).ok).toBe(true);
    expect(preflightAppBackup(archive([], update([carried])), validators as never).ok).toBe(true);
    const cloudBacked = photo({ uri: '', cloudStoragePath: 'P/u1/p1-p1.jpg' });
    expect(preflightAppBackup(archive([update([cloudBacked])]), validators as never).ok).toBe(true);
    const unavailable = markPhotoUnavailableInBackup(photo({ uri: 'file:///photos/p1.jpg' }));
    expect(unavailable).toMatchObject({ uri: '', _backupUnavailable: true });
    expect(preflightAppBackup(archive([update([unavailable])]), validators as never).ok).toBe(true);
    // Nothing locates this photo (an older export wrote it as { uri: '' }): accepted and dropped on restore (pass 2).
    const unlocated = photo({ uri: '' });
    expect(archivePhotoForValidation(unlocated).uri).toBe('vitruvius-backup-unavailable:');
    expect(preflightAppBackup(archive([update([unlocated])]), validators as never).ok).toBe(true);
  });

  it('never changes a photo that already has a locator, and only for validation', () => {
    const real = photo({ uri: 'file:///photos/p1.jpg' });
    expect(archivePhotoForValidation(real)).toBe(real);
    const carried = photo({ uri: '', _backupAssetId: 'a1' });
    expect(archivePhotoForValidation(carried).uri).toBe('vitruvius-backup-asset:a1');
    expect(carried.uri).toBe('');
  });

  it('is what the export marks and both restore passes check', () => {
    expect(app).toContain("const preflight = normalizeBackupData(opened.state, { archive: true });");
    expect(app).toContain("const normalized = normalizeBackupData(materialized.state, { archive: true });");
    expect(app).toMatch(/const savedUpdate = options\.archive\n\s+\? \(item: unknown\) =>\n\s+isStartupSavedUpdateRecord\(archiveUpdateForValidation\(item\)\) &&\n\s+archiveUpdatePhotosAreLocated\(item, deviceResolves\)/);
    // Pass 2: the export decision is pinned in audit-a7-batch2.test.ts (it now counts unconfirmed cloud copies too).
    expect(app).toContain("photos.push(markPhotoUnavailableInBackup(photo));");
    // The export refuses to write an archive that would not restore, and a records-only export says which photos it leaves out.
    expect(app).toContain("const restorable = normalizeBackupData(backup, { archive: true });");
    expect(app).toContain("Alert.alert('Backup not written', `This backup would not restore: ${restorable.message}`);");
    expect(app).toContain("if (!includeFiles && unavailablePhotos.length > 0) {");
  });
});
