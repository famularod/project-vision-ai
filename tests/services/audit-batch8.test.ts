const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
const app = read('App.tsx');
const admin = read('screens/AdminScreen.tsx');

// Whole-app audit (30 Sep 2026): A7 pass 3 L1 / A5 pass 2 L2, A1 pass 1 M6, L7, L8.
describe('this phone’s own deletions reach the realtime applier at once', () => {
  it('one helper merges them into the tombstone ref and state', () => {
    expect(app).toMatch(/function rememberOperationalTombstones\(tombstones: readonly DAVESyncTombstone\[\]\) \{[\s\S]*?operationalSyncTombstonesRef\.current = next;\n\s+setOperationalSyncTombstones\(next\);\n\s+\}/);
  });

  it('every delete flow uses it: area, document, schedule PDF, PDF with items, task and project', () => {
    expect(app).toMatch(/recordDAVESyncTombstone\('project_area', areaId\)\n\s+\.then\(tombstone => \{\n\s+rememberOperationalTombstones\(\[tombstone\]\);/);
    // The document and schedule-PDF deletes (and a phone document's Delete
    // from All Devices) share one function since audit A7 pass 4.
    expect(app).toMatch(/async function removeReferenceDocumentEverywhere\(documentId: string\) \{\n\s+const tombstone = await recordDAVESyncTombstone\('reference_document', documentId\);\n\s+rememberOperationalTombstones\(\[tombstone\]\);/);
    expect(app.match(/void removeReferenceDocumentEverywhere\(documentId\)/g)).toHaveLength(2);
    expect(app).toMatch(/\.then\(tombstones => \{[\s\S]{0,400}?rememberOperationalTombstones\(tombstones\);/);
    expect(app).toMatch(/recordDAVESyncTombstone\('schedule_item', itemId\)\n\s+\.then\(tombstone => \{\n\s+rememberOperationalTombstones\(\[tombstone\]\);/);
    expect(app).toContain('rememberOperationalTombstones(cascade.nextDAVESyncTombstones);');
    expect(app).not.toContain('operationalSyncTombstonesRef.current = nextTombstones;');
  });
});

describe('the sign-out warning counts every unsynced item', () => {
  it('takes the larger of the queue and the updates not yet synced, and says the work stays', () => {
    expect(admin).toContain('const unsyncedCount = Math.max(pendingSyncCount, updateSyncAttentionCount);');
    expect(admin).toContain('on this phone and sync after you sign in here again with this account. Sign out anyway?');
    expect(admin).not.toContain("savedUpdates.filter(update => update.status === 'queued').length;\n    const message");
  });
});

describe('auth events', () => {
  it('drop photo analyses and report state only on a sign-out or another account', () => {
    expect(app).toMatch(/const accountChanged = event === 'SIGNED_OUT' \|\| \(!firstEvent && userId !== lastUserId\);\n\s+lastUserId = userId;\n\s+if \(accountChanged\) photoAnalysisCoordinator\.clear\(\);/);
    expect(app).toContain('if (accountChanged) forgetAllReportSessionState();');
  });

  it('take the account’s name only at startup or with another account, never from the echo of a save', () => {
    expect(app).toContain('if (accountName && (firstEvent || accountChanged)) setDisplayName(accountName);');
    expect(app).not.toContain('if (accountName) setDisplayName(accountName);');
  });
});
