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
    // Pin changed deliberately (A10 pass 7 L5, 30 Sep 2026): a task delete records its own deletion and the
    // hidden rows it answers to in one call, and hands them all to rememberOperationalTombstones.
    expect(app).toMatch(/recordDAVESyncTombstones\(itemIds\.map\(recordId => \(\{ entityType: 'schedule_item' as const, recordId \}\)\)\)\n\s+\.then\(tombstones => \{\n\s+rememberOperationalTombstones\(tombstones\);/);
    expect(app).toContain('rememberOperationalTombstones(cascade.nextDAVESyncTombstones);');
    expect(app).not.toContain('operationalSyncTombstonesRef.current = nextTombstones;');
  });
});

describe('the sign-out warning counts every unsynced item', () => {
  it('takes the larger of the queue and the updates not yet synced, and says the work stays', () => {
    // Round 2 (A8 pass 1 F5): documents whose file has not uploaded count too;
    // pendingSyncCount already includes them.
    expect(admin).toContain('const unsyncedCount = Math.max(pendingSyncCount, updateSyncAttentionCount + failedDocumentCount);');
    // A11 pass 6 L1: notes marked Review needed get their own sentence before "Sign out anyway?".
    // A11 pass 7 L1: the sentences moved to services/SignOutNotInCloudWarning.ts,
    // where "syncs after you sign in" covers only the items not marked Review
    // needed ("1 stays ... and syncs"); every combination is pinned in
    // audit-a11-pass7-wording.test.ts.
    const warning = read('services/SignOutNotInCloudWarning.ts');
    expect(admin).toContain('${signOutNotInCloudSentences(notInCloudCount, fieldNotesForReview)} Sign out anyway?');
    expect(warning).toContain("on this phone and ${one ? 'syncs' : 'sync'} after you sign in here again with this account.");
    expect(warning).toContain('Field notes marked Review needed wait for your choice in Field Notes.');
    expect(admin).not.toContain("savedUpdates.filter(update => update.status === 'queued').length;\n    const message");
  });
});

describe('auth events', () => {
  it('drop photo analyses and report state only on a sign-out or another account', () => {
    // Owner answer Q13 (30 Sep 2026): the rule moved, unchanged, into
    // workspaceAccountChange (services/OwnerWorkspaceAuthDecision.ts; its
    // behaviour is tested in owner-workspace-auth-decision.test.ts), which also
    // ignores the transient null INITIAL_SESSION of an offline start.
    expect(app).toMatch(/const change = workspaceAccountChange\(lastUserId, event, session\?\.user\?\.id\);\n\s+if \(!change\) return;\n\s+const \{ firstEvent, accountChanged \} = change;\n\s+lastUserId = change\.userId;\n\s+if \(accountChanged\) photoAnalysisCoordinator\.clear\(\);/);
    expect(app).toContain('if (accountChanged) forgetAllReportSessionState();');
  });

  it('take the account’s name only at startup or with another account, never from the echo of a save', () => {
    expect(app).toContain('if (accountName && (firstEvent || accountChanged)) setDisplayName(accountName);');
    expect(app).not.toContain('if (accountName) setDisplayName(accountName);');
  });
});
