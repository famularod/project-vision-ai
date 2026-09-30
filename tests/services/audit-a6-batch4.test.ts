import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  markReportSnapshotDelivered,
  reportBaselineSnapshot,
  reportSnapshotToSave,
} from '../../services/DAVEReportSnapshot';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
const screen = read('screens/ReportsScreen.tsx');
const app = read('App.tsx');

const truth = (percent: number) => ({
  projectName: 'P',
  schedule: [{ taskId: 't1', taskName: 'Pour', areaName: 'Lot', owner: '', status: percent === 100 ? 'Complete' : 'In Progress', percentComplete: percent, finishDate: null, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null }],
}) as never;
const snap = (fingerprint: string, percent: number, capturedAt: string) =>
  buildDAVEReportSnapshot({ truths: [truth(percent)], scopeKey: 'p', sourceFingerprint: fingerprint, capturedAt });

// Whole-app audit, area A6 pass 3 (30 Sep 2026).
describe('a report reads the same before and after it is sent', () => {
  it('a first approval states the baseline, not "+0 since the report approved today", and keeps stating it once sent', () => {
    const first = reportSnapshotToSave(snap('f1', 40, '2026-09-30T09:00:00.000Z'), null);
    expect(first).toMatchObject({ sourceFingerprint: 'f1', deliveredAt: null });
    // Batch 3 returned the snapshot itself here, which changed the text under the approval and cleared it.
    expect(reportBaselineSnapshot(first, 'f1')).toBeNull();
    const period = compareDAVEReportSnapshots({ current: snap('f1', 40, '2026-09-30T09:05:00.000Z'), previous: reportBaselineSnapshot(first, 'f1') });
    expect(period.basis).not.toBe('previous_approved_report');
    const sent = markReportSnapshotDelivered(first as never, '2026-09-30T09:10:00.000Z');
    expect(reportBaselineSnapshot(sent, 'f1')).toBeNull();
    // New content then runs from the sent report.
    expect(reportBaselineSnapshot(sent, 'f2')?.sourceFingerprint).toBe('f1');
  });

  it('a later approval reads against the report it superseded, sent or not; a replacement with no history states the baseline', () => {
    const owned = markReportSnapshotDelivered(snap('f1', 40, '2026-09-22T10:00:00.000Z'), '2026-09-22T10:05:00.000Z');
    const second = reportSnapshotToSave(snap('f2', 100, '2026-09-29T10:00:00.000Z'), owned);
    expect(reportBaselineSnapshot(second, 'f2')?.sourceFingerprint).toBe('f1');
    expect(reportBaselineSnapshot(markReportSnapshotDelivered(second as never, '2026-09-29T10:30:00.000Z'), 'f2')?.sourceFingerprint).toBe('f1');
    // Approve, never send, facts change, approve again: the replacement carries no history.
    const unsentFirst = reportSnapshotToSave(snap('f1', 40, '2026-09-30T09:00:00.000Z'), null);
    const replacement = reportSnapshotToSave(snap('f2', 100, '2026-09-30T12:00:00.000Z'), unsentFirst);
    expect(replacement?.supersedes).toBeNull();
    expect(reportBaselineSnapshot(replacement, 'f2')).toBeNull();
    // A legacy snapshot (no delivery record) still compares against itself with zero change (pass 2).
    const legacy = snap('f1', 40, '2026-09-22T10:00:00.000Z');
    expect(reportBaselineSnapshot(legacy, 'f1')?.sourceFingerprint).toBe('f1');
  });
});

describe('approval, review items and delivery on the Reports screen', () => {
  it('never restores approval while approval is not allowed, shows the review list until an allowed approval, and forgets a revoked approval when its item is marked reviewed', () => {
    expect(screen).toMatch(/setReportApproved\(reportApprovalAllowed && restoredReportApproval\(\n\s+recallReportSessionState\(reportStateIdentityKey\),\n\s+approvalTextKey,\n\s+\)\);\n\s+\}, \[approvalTextKey, reportStateIdentityKey, reportApprovalAllowed\]\);/);
    expect(screen).not.toMatch(/if \(reportApprovalAllowed\) return;\n\s+setReportApproved\(false\);/);
    expect(screen).toContain('{!(reportApproved && reportApprovalAllowed) && advisoryItems.length > 0 ? (');
    expect(screen).toMatch(/rememberReportAcknowledgement\(reportStateIdentityKey, next\);\n(?:\s*\/\/.*\n)*\s+rememberReportApproval\(reportStateIdentityKey, null\);\n\s+\}, \[reportSourceFingerprint, reportStateIdentityKey, reviewAcknowledgement\]\);/);
  });

  it('marks the started report delivered on every completed send, whatever the screen shows by then', () => {
    expect(screen).toMatch(/const outcome = await communicate\(startedReport\);\n(?:\s*\/\/.*\n)*\s+if \(outcome === 'completed'\) markReportDelivered\(startedFingerprint\);\n\s+if \(\n\s+mountedRef\.current &&/);
    expect(screen).toMatch(/\) \{\n\s+setCommunicationError\(''\);\n\s+\}\n\s+\} catch \{/);
  });
});

describe('what counts as a send', () => {
  it('Outlook asks the owner; the Word file alone is not a delivery; the copy fallbacks count as Copy Report does', () => {
    // The share sheet resolves the same way for send, save and dismiss (expo-sharing), so the owner is asked.
    expect(app).toMatch(/const shared = await shareWordReport\(report, drawingReferences, 'Choose Outlook to send from your work account'\);\n\s+if \(!shared\) return 'unknown';\n(?:\s*\/\/.*\n)*\s+const sent = await askToContinue\(\n\s+'Was the report sent\?',\n[\s\S]*?'Yes, it was sent',\n\s+'Not yet',\n\s+\);\n\s+return sent \? 'completed' : 'unknown';/);
    expect(app).toMatch(/async function downloadWordReport\([\s\S]*?\): Promise<ReportCommunicationOutcome> \{\n\s+await shareWordReport\(report, drawingReferences, 'Open or save the Word report'\);\n\s+return 'unknown';\n\s+\}/);
    expect(app).toMatch(/async function shareWordReport\([\s\S]*?\): Promise<boolean> \{/);
    expect(app).not.toMatch(/await Sharing\.shareAsync\(fileUri, \{\n\s+dialogTitle: shareTitle,[\s\S]*?return 'completed';/);
    expect(app).toMatch(/'The report was copied instead\. Open your email app and paste it into a new message\.',\n\s+\);\n(?:\s*\/\/.*\n)*\s+return 'completed';/);
    expect(app).toMatch(/'The report was copied instead\. Open Messages and paste it into a new text\.',\n\s+\);\n\s+return 'completed';/);
    expect(app).toContain("const askToContinue = (title: string, message: string, continueLabel: string, cancelLabel = 'Cancel')");
  });
});
