const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
const app = read('App.tsx');
const screen = read('screens/ReportsScreen.tsx');

// Whole-app audit, passes A4-4 and A6-4 (30 Sep 2026): the lows those passes traced to batches 3-4.
describe('A4 pass 4 lows', () => {
  it('the generation guard ignores photo storage paths and the receipt aligns them (behaviour in audit-a4-batch4)', () => {
    const generation = read('services/FieldUpdateSyncGeneration.ts');
    // Batch 6 (A4 pass 5) widened it to every cloud photo field, null read as missing.
    expect(generation).toMatch(/return generationSignature\(withoutPhotoCloudFields\(left\), true\) ===\n\s+generationSignature\(withoutPhotoCloudFields\(right\), true\);/);
    expect(generation).not.toContain('alignPhotoStoragePaths');
    expect(read('services/PhotoStoragePathAlignment.ts')).toContain("Boolean(other) && (pathOf(photo) === '' || pathOf(other as PhotoLike) === '');");
  });

  it('a store the save declared unreadable is not re-written outside the journal; Keep cloud replaces the local failed copy', () => {
    // Batch 9 moved the blocked handling into blockFieldUpdateStores (it also drops the stores' pending writes).
    expect(app).toMatch(/if \(error instanceof FieldUpdatePersistenceBlockedError\) blockFieldUpdateStores\(error\);/);
    expect(app).toMatch(/function blockFieldUpdateStores\(error: FieldUpdatePersistenceBlockedError\) \{\n\s+startupHydration\.fail\(UPDATES_STORAGE_KEY, 'field update save recovery', error\);/);
    expect(app).toMatch(/if \(!\(error instanceof FieldUpdatePersistenceBlockedError\)\) \{\n\s+void persistDraftNow\(draftRef\.current\);\n\s+persistStorageItem\(UPDATES_STORAGE_KEY, JSON\.stringify\(savedUpdatesRef\.current\)\)\.catch\(persistError =>/);
    expect(app).toMatch(/onApplyCloudConflictUpdate=\{update => \{\n\s+const cloudUpdate = normalizeStoredUpdateRecord\(update\);\n(?:\s*\/\/.*\n)*\s+setSavedUpdates\(previous => mergeSavedUpdatesWithTombstones\(\{\n\s+localUpdates: previous\.filter\(item => item\.id !== cloudUpdate\.id\),/);
  });
});

describe('A6 pass 4 lows', () => {
  it('the Word "prepared" notice is read before the Outlook question; the citation check ignores case', () => {
    expect(app).toMatch(/await new Promise<void>\(resolve => Alert\.alert\(\n\s+'Word report prepared',[\s\S]*?\[\{ text: 'OK', onPress: \(\) => resolve\(\) \}\],\n\s+\{ cancelable: true, onDismiss: \(\) => resolve\(\) \},\n\s+\)\);\n\s+\}\n\s+return true;/);
    expect(app).toContain("return reportFormat !== 'executive' && /\\bSee Images?\\s+\\d/i.test(report.body);");
  });

  it('a send that completes before the approval save lands still marks the report delivered', () => {
    expect(screen).toContain('const pendingReportSnapshotSaveRef = useRef<{ snapshot: DAVEReportSnapshot; save: Promise<unknown> } | null>(null);');
    expect(screen).toMatch(/const save = saveDAVEReportSnapshot\(snapshotToSave\);\n\s+pendingReportSnapshotSaveRef\.current = \{ snapshot: snapshotToSave, save \};/);
    expect(screen).toMatch(/\.finally\(\(\) => \{\n\s+if \(pendingReportSnapshotSaveRef\.current\?\.save === save\) pendingReportSnapshotSaveRef\.current = null;\n\s+\}\);/);
    expect(screen).toMatch(/const markReportDelivered = \(sentFingerprint: string\) => \{\n\s+const pending = pendingReportSnapshotSaveRef\.current;\n\s+if \(pending && pending\.snapshot\.sourceFingerprint === sentFingerprint\) \{\n\s+void pending\.save\.then\(\(\) => markSavedReportDelivered\(pending\.snapshot, sentFingerprint\), \(\) => undefined\);\n\s+return;\n\s+\}\n\s+markSavedReportDelivered\(previousReportSnapshotRef\.current, sentFingerprint\);\n\s+\};/);
    expect(screen).toContain("if (!saved || saved.sourceFingerprint !== sentFingerprint || saved.deliveredAt !== null) return;");
  });
});
