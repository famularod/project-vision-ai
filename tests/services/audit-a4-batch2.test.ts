import { classifySyncFailureText, isSyncFailureCategory } from '../../services/SyncFailureCategory';
import { isResumableFieldUpdateStatus } from '../../services/FieldUpdateLifecycle';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
const app = read('App.tsx');
const sync = read('services/SyncService.ts');

// Whole-app audit, area A4 (29 Sep 2026), batch 2.
describe('why a sync failed is read from the failure, not from a sentence written for the manager', () => {
  it('recognises the sanitised sentences and transport failures anywhere in a message', () => {
    expect(classifySyncFailureText(['Field update for “2321” could not sync. Cloud sync could not connect. Your changes remain saved and will be retried.'])).toBe('offline');
    expect(classifySyncFailureText(['Cloud sync needs you to sign in again. Your changes remain saved on this phone.'])).toBe('auth');
    expect(classifySyncFailureText(['Cloud sync needs service attention. Your changes remain saved on this phone.'])).toBe('database_insert_failed');
    expect(classifySyncFailureText(['Some photos could not be synced because the original files are no longer available. The remaining items will continue syncing.'])).toBe('storage_upload_failed');
    expect(classifySyncFailureText(['Cloud sync could not finish. Your changes remain saved on this phone and will be retried.'])).toBe('unknown');
    // Raw failures: a network error inside a database-step message is offline.
    expect(classifySyncFailureText(['TypeError: Network request failed'])).toBe('offline');
    expect(classifySyncFailureText(['Project update database upsert failed: TypeError: Network request failed'])).toBe('offline');
    expect(classifySyncFailureText(['Project update database upsert failed: duplicate key value violates unique constraint'])).toBe('malformed_payload');
    expect(classifySyncFailureText(['new row violates row-level security policy'])).toBe('rls_denied');
    // The project name inside the message does not decide the category.
    expect(classifySyncFailureText(['Field update for “Network Upgrade” could not sync. Cloud sync needs service attention.'])).toBe('database_insert_failed');
    expect(classifySyncFailureText([])).toBe('unknown');
    expect(isSyncFailureCategory('offline')).toBe(true);
    expect(isSyncFailureCategory('elsewhere')).toBe(false);
  });

  it('is recorded on the queue item from the raw failure and carried into the sync result', () => {
    expect(sync.match(/lastFailureCategory: classifySyncFailureText\(\[(reason|prepared|resultCode)\]\),/g)?.length).toBe(3);
    // Batch 3: a category this build does not know reads as unknown instead of sidelining the item.
    // A4 pass 5: a conflict or item failure without a recorded category is 'unknown', never read from its sentence.
    expect(sync).toMatch(/failureCategory: isSyncFailureCategory\(remainingItem\?\.lastFailureCategory\)\n\s+\? remainingItem\.lastFailureCategory\n\s+: currentConflict \|\| itemOutcome === 'failed' \? 'unknown' : null,/);
    expect(sync).toContain("typeof value.lastFailureCategory !== 'string'");
    expect(sync).toContain('lastFailureCategory?: SyncFailureCategory | null;');
    expect(app).toContain(': syncResult.failureCategory ?? classifySyncFailureCategory(');
    expect(app).toContain('return classifySyncFailureText(errors);');
  });
});

describe('a replaced draft is on disk before the old draft’s files go, and the draft is flushed on background', () => {
  it('writes the draft through one path from the timer, the flush and every replacement', () => {
    expect(app).toMatch(/draftSaveTimer\.current = setTimeout\(\(\) => \{\n\s+void persistDraftNow\(draft\);\n\s+\}, 750\);/);
    expect(app).toContain('if (draftSaveTimer.current) void persistDraftNow(draftRef.current);');
    expect(app).toMatch(/async function discardDraftAfterReplacement\(discardedDraft: ProjectUpdate\): Promise<void> \{\n\s+await persistDraftNow\(draftRef\.current\);\n\s+await deleteUnreferencedPhotosFromUpdate\(discardedDraft, savedUpdatesRef\.current\);/);
    expect(app).toContain('deleteDiscardedPhotos: discardDraftAfterReplacement,');
    // Task update, open-over-draft, clearOpenDraft (Home Discard and the deleted-draft discard) and the Project Walk (batch 3).
    expect(app.match(/void discardDraftAfterReplacement\(discardedDraft\);/g)?.length).toBe(4);
    expect(app).not.toContain('void deleteUnreferencedPhotosFromUpdate(discardedDraft, savedUpdates);');
    // The blank replacement is in the ref before it is persisted.
    expect(app).toMatch(/replaceDraftWithBlank: \(\) => \{\n\s+const blank = createDraft\(activeProjects\[0\] \|\| ''\);\n\s+draftRef\.current = blank;\n\s+setDraft\(blank\);/);
  });
});

describe('opening an update that is already the draft, and what may be resumed', () => {
  it('goes to the open draft instead of replacing it, and names the draft in the alert', () => {
    expect(app).toMatch(/if \(draftRef\.current\.id === update\.id\) \{\n(?:\s*\/\/.*\n)*\s+setSelectedWorkspaceProject\(update\.projectName\);\n\s+setScreen\(screenForUpdateResume\(draftRef\.current\)\);\n\s+return;/);
    expect(app).toContain("`Opening a saved update will replace the current unfinished draft (${draft.projectName || 'no project'}, ${photoCount} photo${photoCount === 1 ? '' : 's'}).`");
  });

  it('uses one resume rule for the list and the iPad inspector', () => {
    expect(isResumableFieldUpdateStatus('draft')).toBe(true);
    expect(isResumableFieldUpdateStatus('ready_to_send')).toBe(true);
    expect(isResumableFieldUpdateStatus('failed')).toBe(true);
    expect(isResumableFieldUpdateStatus('queued')).toBe(false);
    expect(isResumableFieldUpdateStatus('sent')).toBe(false);
    expect(app).toContain('if (!isResumableFieldUpdateStatus(lifecycle)) {');
    expect(app).toContain('onResume={isResumableFieldUpdateStatus(lifecycleStatusForUpdate(selectedUpdate)) ? () => onOpen(selectedUpdate) : undefined}');
  });

  it('re-syncs sign-in-required updates after a sign-in anywhere, deferred out of the auth callback', () => {
    expect(app).toMatch(/if \(event === 'SIGNED_IN' \|\| event === 'TOKEN_REFRESHED'\) \{\n\s+setTimeout\(\(\) => startAutomaticSyncBackgroundTask\('signed_in', hydrateQueuedUpdates\), 0\);/);
  });
});
