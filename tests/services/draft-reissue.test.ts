import { prepareQueuedFieldUpdateSave } from '../../services/FieldUpdateLocalPersistence';
import { queuedUpdateSurvivedSave, reissueDraftAsNewUpdate } from '../../services/DraftReissue';
import { mergeLocalUpdateWithCloudCopy } from '../../services/DAVECloudRecovery';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit, area A4 (29 Sep 2026): the visible-update merge compared a
// local update with itself when no cloud copy existed, which counted as its
// own receipt and stamped it 'sent' before any upload.
describe('a local update without a cloud copy keeps its own status', () => {
  const local = {
    id: 'u1', projectName: 'P', date: '2026-09-29', notes: 'n', photos: [], recipients: { contactIds: [] },
  };

  it('stays queued or failed until a cloud copy says otherwise', () => {
    expect(mergeLocalUpdateWithCloudCopy({ ...local, status: 'queued' } as never, undefined)).toMatchObject({ status: 'queued' });
    expect(mergeLocalUpdateWithCloudCopy({ ...local, status: 'failed' } as never, undefined)).toMatchObject({ status: 'failed' });
    // A cloud copy with the same meaning is the receipt.
    expect(mergeLocalUpdateWithCloudCopy({ ...local, status: 'queued' } as never, { ...local, status: 'sent' } as never))
      .toMatchObject({ status: 'sent' });
  });

  it('is what the app’s merge uses', () => {
    expect(app).toContain('? mergeLocalUpdateWithCloudCopy(update, cloudUpdateById.get(update.id))');
    expect(app).not.toContain('cloudUpdateById.get(update.id) || update');
  });
});

// Whole-app audit, area A4 (29 Sep 2026): a save of a draft whose update was
// deleted while open was dropped by the deletion barrier behind "saved".
describe('saving a draft whose update was deleted while it was open', () => {
  const keys = { journal: 'journal', updates: 'updates', tombstones: 'tombstones', draft: 'draft' };
  const mergeVisibleUpdates = ({ localUpdates, tombstones }: {
    localUpdates: Array<{ id: string }>;
    cloudUpdates: Array<{ id: string }>;
    tombstones: Array<{ updateId: string }>;
  }) => {
    const barred = new Set(tombstones.map(item => item.updateId));
    return localUpdates.filter(update => !barred.has(update.id));
  };

  it('writes nothing and reports the save as not applied, so the draft stays persisted', () => {
    const queued = { id: 'u1', notes: 'North Lot pour', photos: [] };
    const { operations, result } = prepareQueuedFieldUpdateSave({
      snapshot: { persistedUpdates: [], persistedTombstones: [], persistedDraft: '{"draft":1}' } as never,
      queuedUpdate: queued as never,
      currentUpdates: [],
      currentTombstones: [{ updateId: 'u1', action: 'delete_update_everywhere' }] as never,
      keys,
      mergeVisibleUpdates: mergeVisibleUpdates as never,
    });
    expect(result.applied).toBe(false);
    expect(operations).toEqual([]);
    expect(queuedUpdateSurvivedSave(result.nextUpdates, 'u1')).toBe(false);

    const clean = prepareQueuedFieldUpdateSave({
      snapshot: { persistedUpdates: [], persistedTombstones: [], persistedDraft: null } as never,
      queuedUpdate: queued as never,
      currentUpdates: [],
      currentTombstones: [],
      keys,
      mergeVisibleUpdates: mergeVisibleUpdates as never,
    });
    expect(clean.result.applied).toBe(true);
    expect(clean.operations.map(operation => operation.kind)).toEqual(['set', 'set', 'remove_if_unchanged']);
    expect(queuedUpdateSurvivedSave(clean.result.nextUpdates, 'u1')).toBe(true);
  });

  it('can be saved again as a new update: same content and files, a fresh identity, no cloud paths', () => {
    const draft = {
      id: 'u1',
      projectName: '2321 Compliance Project',
      notes: 'North Lot pour',
      status: 'failed',
      stableSendId: 'send-u1',
      idempotencyKey: 'send-u1',
      sendAttempts: 2,
      lastSendAttemptAt: '2026-09-29T15:00:00.000Z',
      syncDiagnostics: { category: 'auth' },
      deleteDiagnostics: { tombstoned: true },
      isArchived: false,
      archivedAt: null,
      workflowTimestamps: { startedAt: '2026-09-29T14:00:00.000Z', sendTappedAt: '2026-09-29T15:00:00.000Z', sendResolvedAt: '2026-09-29T15:00:05.000Z' },
      photos: [{
        id: 'p1', uri: 'file:///photos/p1.jpg', caption: 'Rebar', cloudStoragePath: 'owner/u1/p1.jpg',
        cloudRecoveryStatus: 'cached' as const, cloudSignedUrlExpiresAt: '2026-09-30T00:00:00.000Z',
      }],
    };
    const reissued = reissueDraftAsNewUpdate(draft, 'u2');
    expect(reissued).toMatchObject({
      id: 'u2', projectName: '2321 Compliance Project', notes: 'North Lot pour', status: 'draft',
      stableSendId: null, idempotencyKey: null, sendAttempts: 0, lastSendAttemptAt: null,
      syncDiagnostics: null, deleteDiagnostics: null, isArchived: false, archivedAt: null,
      workflowTimestamps: { startedAt: '2026-09-29T14:00:00.000Z' },
    });
    expect(reissued.workflowTimestamps).not.toHaveProperty('sendTappedAt');
    expect(reissued.photos).toEqual([expect.objectContaining({
      id: 'p1', uri: 'file:///photos/p1.jpg', caption: 'Rebar',
      cloudStoragePath: null, cloudRecoveryStatus: null, cloudSignedUrlExpiresAt: null,
    })]);
    // The original is untouched.
    expect(draft.id).toBe('u1');
    expect(draft.photos[0].cloudStoragePath).toBe('owner/u1/p1.jpg');
  });

  it('is wired into the save and the delete', () => {
    // The save keeps the draft and offers a new record when the commit did not apply.
    // Batch 3: the cancelled draft write is put back, and the barrier's kind decides the wording.
    expect(app).toMatch(/if \(!persisted\.applied\) \{\n(?:\s*\/\/.*\n)*\s+fieldUpdateSaveInFlightRef\.current = false;\n\s+setFieldUpdateSaving\(false\);\n(?:\s*\/\/.*\n)*\s+void persistDraftNow\(draftRef\.current\);\n\s+recaptureDroppedDraftLocation\(draftSnapshot\.id, droppedPendingFix\);\n\s+offerToSaveDeletedDraftAsNewUpdate\(draftSnapshot\.projectName, persisted\.barrierAction\);\n\s+return;/);
    expect(app).toContain('const reissued = reissueDraftAsNewUpdate(draftRef.current, uid());');
    // Deleting the open draft's update clears the draft (by the ref, not a stale closure).
    expect(app).toContain('const openDraftDeleted = draftRef.current.id === updateId;');
    expect(app).toContain('if (openDraftDeleted) clearOpenDraft(deletedUpdate.projectName);');
    expect(app).not.toContain('...(draft.id === updateId ? [] : [draft]),');
  });
});
