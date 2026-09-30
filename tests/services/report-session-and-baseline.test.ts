import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  markReportSnapshotDelivered,
  reportBaselineSnapshot,
  reportSnapshotToSave,
} from '../../services/DAVEReportSnapshot';
import {
  forgetAllReportSessionState,
  recallReportSessionState,
  rememberReportAcknowledgement,
  rememberReportApproval,
  rememberReportEdits,
  restoredReportApproval,
} from '../../services/ReportSessionState';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const screen = fs.readFileSync(path.resolve(__dirname, '../../screens/ReportsScreen.tsx'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit, area A6 (29-30 Sep 2026), batches 2 and 3.
describe('the reporting period runs from the report the owner has', () => {
  const truth = (percent: number) => ({
    projectName: 'P',
    schedule: [{ taskId: 't1', taskName: 'Pour', areaName: 'Lot', owner: '', status: percent === 100 ? 'Complete' : 'In Progress', percentComplete: percent, finishDate: null, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null }],
  }) as never;
  const snap = (fingerprint: string, percent: number, capturedAt: string) =>
    buildDAVEReportSnapshot({ truths: [truth(percent)], scopeKey: 'p', sourceFingerprint: fingerprint, capturedAt });

  it('re-approving the same content saves nothing and compares against the report before it', () => {
    const owned = markReportSnapshotDelivered(snap('f1', 40, '2026-09-22T10:00:00.000Z'), '2026-09-22T10:05:00.000Z');
    const approved = reportSnapshotToSave(snap('f2', 100, '2026-09-29T10:00:00.000Z'), owned);
    expect(approved?.deliveredAt).toBeNull();
    expect(approved?.supersedes?.sourceFingerprint).toBe('f1');
    expect(approved?.supersedes).not.toHaveProperty('supersedes');
    expect(reportSnapshotToSave(snap('f2', 100, '2026-09-29T10:05:00.000Z'), approved)).toBeNull();
    const baseline = reportBaselineSnapshot(approved, 'f2');
    expect(baseline?.sourceFingerprint).toBe('f1');
    const period = compareDAVEReportSnapshots({ current: snap('f2', 100, '2026-09-29T10:05:00.000Z'), previous: baseline });
    expect(period.basis).toBe('previous_approved_report');
    expect(period.completeDelta).toBe(1);
    expect(reportBaselineSnapshot(null, 'f2')).toBeNull();
  });

  it('an approval that was never sent is not the baseline; a sent one is (pass 2)', () => {
    const owned = markReportSnapshotDelivered(snap('f1', 40, '2026-09-22T10:00:00.000Z'), '2026-09-22T10:05:00.000Z');
    const unsent = reportSnapshotToSave(snap('f2', 100, '2026-09-29T09:00:00.000Z'), owned);
    // Facts change before anything is sent: the period still runs from f1, the owner's report.
    expect(reportBaselineSnapshot(unsent, 'f3')?.sourceFingerprint).toBe('f1');
    // The next approval replaces the unsent one and keeps f1 as what it supersedes.
    const next = reportSnapshotToSave(snap('f3', 100, '2026-09-29T14:00:00.000Z'), unsent);
    expect(next?.supersedes?.sourceFingerprint).toBe('f1');
    // Once f2 is sent it becomes the baseline for new content.
    const sent = markReportSnapshotDelivered(unsent as never, '2026-09-29T09:30:00.000Z');
    expect(reportBaselineSnapshot(sent, 'f3')?.sourceFingerprint).toBe('f2');
    expect(reportSnapshotToSave(snap('f3', 100, '2026-09-29T14:00:00.000Z'), sent)?.supersedes?.sourceFingerprint).toBe('f2');
    // A first approval has nothing to supersede and is not yet sent.
    expect(reportSnapshotToSave(snap('f1', 40, '2026-09-22T10:00:00.000Z'), null)).toMatchObject({ sourceFingerprint: 'f1', deliveredAt: null });
  });

  it('a snapshot from before this change counts as sent, and the same content compares against it with zero change', () => {
    const old = snap('f1', 40, '2026-09-22T10:00:00.000Z');
    expect(old).not.toHaveProperty('deliveredAt');
    expect(reportBaselineSnapshot(old, 'f1')?.sourceFingerprint).toBe('f1');
    const period = compareDAVEReportSnapshots({ current: snap('f1', 40, '2026-09-29T10:00:00.000Z'), previous: reportBaselineSnapshot(old, 'f1') });
    expect(period.basis).toBe('previous_approved_report');
    expect(period.completeDelta).toBe(0);
    expect(reportBaselineSnapshot(old, 'f2')?.sourceFingerprint).toBe('f1');
  });

  it('is what the screen uses: the briefing, the approval save, and the delivered mark on a completed send', () => {
    expect(screen).toContain('? reportBaselineSnapshot(previousReportSnapshot, reportSourceFingerprint)');
    expect(screen).toContain('const snapshotToSave = reportSnapshotToSave(currentReportSnapshot, previousReportSnapshot);');
    expect(screen).toContain('if (mountedRef.current && reportSnapshotScopeKeyRef.current === snapshotToSave.scopeKey) {');
    // Pass 3: the mark no longer waits on what the screen shows now; the started report's own fingerprint scopes it.
    expect(screen).toContain("if (outcome === 'completed') markReportDelivered(startedFingerprint);");
    expect(screen).toContain("if (!saved || saved.sourceFingerprint !== sentFingerprint || saved.deliveredAt !== null) return;");
    // Approval waits for the baseline to load and never replaces one that could not be read.
    expect(screen).toContain('const reportApprovalAllowed = reportApprovalPolicy.allowed && reportFactsAreCurrent && snapshotScopeLoaded;');
    expect(screen).toMatch(/if \(snapshotLoadFailed\) \{\n(?:\s*\/\/.*\n)*\s+setCommunicationError\(/);
  });
});

describe('edits, acknowledgements and approval survive leaving the Reports tab for the session', () => {
  beforeEach(() => forgetAllReportSessionState());

  it('remembers per scope, restores approval only for the exact approved text, and forgets when discarded', () => {
    const edits = { title: 'Week 39', body: 'Guardrail missing at stair 2 landing.', sourceFingerprint: 'f2' };
    rememberReportEdits('daily|pm|p', edits);
    rememberReportApproval('daily|pm|p', 'text-a');
    rememberReportAcknowledgement('daily|pm|p', { fingerprint: 'f2', ids: ['r1'] });
    expect(recallReportSessionState('daily|pm|p')).toEqual({ edits, approvedTextKey: 'text-a', acknowledgement: { fingerprint: 'f2', ids: ['r1'] } });
    expect(recallReportSessionState('daily|pm|other')).toBeNull();
    expect(restoredReportApproval(recallReportSessionState('daily|pm|p'), 'text-a')).toBe(true);
    expect(restoredReportApproval(recallReportSessionState('daily|pm|p'), 'text-b')).toBe(false);
    expect(restoredReportApproval(null, 'text-a')).toBe(false);
    rememberReportApproval('daily|pm|p', null);
    expect(recallReportSessionState('daily|pm|p')?.approvedTextKey).toBeNull();
    expect(recallReportSessionState('daily|pm|p')?.edits).toEqual(edits);
    rememberReportEdits('daily|pm|p', null);
    rememberReportAcknowledgement('daily|pm|p', null);
    expect(recallReportSessionState('daily|pm|p')).toBeNull();
  });

  it('keeps only recent scopes', () => {
    for (let index = 0; index < 20; index += 1) rememberReportApproval(`scope-${index}`, `t${index}`);
    expect(recallReportSessionState('scope-0')).toBeNull();
    expect(recallReportSessionState('scope-19')).not.toBeNull();
  });

  it('is written only when the manager acts, and read on mount (pass 2: an effect had wiped it on remount)', () => {
    expect(screen).not.toContain('rememberReportSessionState(');
    // Pass 3: approval is decided in one place with the policy, so it is never restored while not allowed.
    expect(screen).toMatch(/setReportApproved\(reportApprovalAllowed && restoredReportApproval\(\n\s+recallReportSessionState\(reportStateIdentityKey\),\n\s+approvalTextKey,\n\s+\)\);\n\s+\}, \[approvalTextKey, reportStateIdentityKey, reportApprovalAllowed\]\);/);
    expect(screen).not.toMatch(/if \(reportApprovalAllowed\) return;\n\s+setReportApproved\(false\);/);
    expect(screen).toMatch(/const remembered = recallReportSessionState\(reportStateIdentityKey\);\n\s+setReportEditing\(false\);\n\s+setReportEdits\(remembered\?\.edits \?\? null\);\n\s+setReviewAcknowledgement\(remembered\?\.acknowledgement \?\? \{ fingerprint: '', ids: \[\] \}\);/);
    expect(screen).toContain('rememberReportApproval(reportStateIdentityKey, approvalTextKey);');
    // Edit, Discard, and (pass 3) Mark reviewed each ask for a fresh approval.
    expect(screen.match(/rememberReportApproval\(reportStateIdentityKey, null\);/g)?.length).toBe(3);
    expect(screen.match(/rememberReportEdits\(reportStateIdentityKey, next\);/g)?.length).toBe(2);
    expect(screen).toContain('rememberReportEdits(reportStateIdentityKey, null);');
    expect(screen).toContain('rememberReportAcknowledgement(reportStateIdentityKey, next);');
    expect(screen).toContain('Narrative edits are kept until you leave the app.');
    expect(app).toContain("if (event === 'SIGNED_OUT') forgetAllReportSessionState();");
  });
});

describe('the Word review copy before approval', () => {
  it('is produced without approval, titled as a review copy, still blocked while approval is not allowed, and carries no photos for a body that cites none', () => {
    expect(screen).toContain("if ((requireApproval && !reportApproved) || !reportApprovalAllowed) {");
    expect(screen).toContain("reportApproved ? report : { ...report, title: `${report.title} — Review copy (not approved)` },");
    expect(screen).toContain('), { requireApproval: false });');
    expect(screen).toMatch(/onCopyReport=\{\(\) => \{\n\s+completeCommunication\(onCopyReport\);/);
    expect(screen).toMatch(/onOutlookReport=\{\(\) => \{\s+completeCommunication\(report =>\s+onOutlookReport\(report, drawingReferences\)\);/);
    expect(app).toMatch(/const reportPhotoNumbers = new Map\(\n\s+reportBodyCitesImages\(report\)\n\s+\? report\.locationGroups/);
  });
});
