import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  reportBaselineSnapshot,
  reportSnapshotToSave,
} from '../../services/DAVEReportSnapshot';
import {
  forgetAllReportSessionState,
  recallReportSessionState,
  rememberReportSessionState,
  restoredReportApproval,
} from '../../services/ReportSessionState';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const screen = fs.readFileSync(path.resolve(__dirname, '../../screens/ReportsScreen.tsx'), 'utf8');

// Whole-app audit, area A6 (29 Sep 2026), batch 2.
describe('the reporting-period baseline is never the report’s own snapshot', () => {
  const truth = (percent: number) => ({
    projectName: 'P',
    schedule: [{ taskId: 't1', taskName: 'Pour', areaName: 'Lot', owner: '', status: percent === 100 ? 'Complete' : 'In Progress', percentComplete: percent, finishDate: null, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null }],
  }) as never;
  const snap = (fingerprint: string, percent: number, capturedAt: string) =>
    buildDAVEReportSnapshot({ truths: [truth(percent)], scopeKey: 'p', sourceFingerprint: fingerprint, capturedAt });

  it('re-approving the same content saves nothing and compares against the report before it', () => {
    const owned = snap('f1', 40, '2026-09-22T10:00:00.000Z');
    const approved = reportSnapshotToSave(snap('f2', 100, '2026-09-29T10:00:00.000Z'), owned);
    expect(approved?.supersedes?.sourceFingerprint).toBe('f1');
    expect(approved?.supersedes).not.toHaveProperty('supersedes');
    // Leave the tab, come back, approve the same content again: nothing new is saved…
    expect(reportSnapshotToSave(snap('f2', 100, '2026-09-29T10:05:00.000Z'), approved)).toBeNull();
    // …and the period still runs from the report the owner actually has.
    const baseline = reportBaselineSnapshot(approved, 'f2');
    expect(baseline?.sourceFingerprint).toBe('f1');
    const period = compareDAVEReportSnapshots({ current: snap('f2', 100, '2026-09-29T10:05:00.000Z'), previous: baseline });
    expect(period.basis).toBe('previous_approved_report');
    expect(period.completeDelta).toBe(1);
    // Different content compares against the latest approved snapshot as before.
    expect(reportBaselineSnapshot(approved, 'f3')?.sourceFingerprint).toBe('f2');
    expect(reportBaselineSnapshot(null, 'f2')).toBeNull();
    // A first approval has nothing to supersede.
    expect(reportSnapshotToSave(snap('f1', 40, '2026-09-22T10:00:00.000Z'), null)).toMatchObject({ sourceFingerprint: 'f1' });
  });

  it('is what the screen uses to build the briefing and to save on approval', () => {
    expect(screen).toContain('? reportBaselineSnapshot(previousReportSnapshot, reportSourceFingerprint)');
    expect(screen).toContain('const snapshotToSave = reportSnapshotToSave(currentReportSnapshot, previousReportSnapshot);');
    expect(screen).toContain('if (mountedRef.current) setPreviousReportSnapshot(snapshotToSave);');
  });
});

describe('edits and approval survive leaving the Reports tab for the session', () => {
  beforeEach(() => forgetAllReportSessionState());

  it('remembers edits per scope and restores approval only for the exact approved text', () => {
    const edits = { title: 'Week 39', body: 'Guardrail missing at stair 2 landing.', sourceFingerprint: 'f2' };
    rememberReportSessionState('daily|pm|p', { edits, approvedTextKey: 'text-a' });
    expect(recallReportSessionState('daily|pm|p')).toEqual({ edits, approvedTextKey: 'text-a' });
    expect(recallReportSessionState('daily|pm|other')).toBeNull();
    expect(restoredReportApproval(recallReportSessionState('daily|pm|p'), 'text-a')).toBe(true);
    expect(restoredReportApproval(recallReportSessionState('daily|pm|p'), 'text-b')).toBe(false);
    expect(restoredReportApproval(null, 'text-a')).toBe(false);
    // Discarding edits and approval forgets the scope.
    rememberReportSessionState('daily|pm|p', { edits: null, approvedTextKey: null });
    expect(recallReportSessionState('daily|pm|p')).toBeNull();
  });

  it('keeps only recent scopes', () => {
    for (let index = 0; index < 20; index += 1) {
      rememberReportSessionState(`scope-${index}`, { edits: null, approvedTextKey: `t${index}` });
    }
    expect(recallReportSessionState('scope-0')).toBeNull();
    expect(recallReportSessionState('scope-19')).not.toBeNull();
  });

  it('is wired into the screen’s approval and identity effects', () => {
    expect(screen).toMatch(/setReportApproved\(restoredReportApproval\(\n\s+recallReportSessionState\(reportStateIdentityKey\),\n\s+approvalTextKey,\n\s+\)\);\n\s+\}, \[approvalTextKey, reportStateIdentityKey\]\);/);
    expect(screen).toContain("setReportEdits(recallReportSessionState(reportStateIdentityKey)?.edits ?? null);");
    expect(screen).toMatch(/rememberReportSessionState\(reportStateIdentityKey, \{\n\s+edits: reportEdits,\n\s+approvedTextKey: reportApproved \? approvalTextKey : null,\n\s+\}\);/);
  });
});

describe('the Word review copy before approval', () => {
  it('is produced without approval, titled as a review copy, and still blocked while approval is not allowed', () => {
    expect(screen).toContain("if ((requireApproval && !reportApproved) || !reportApprovalAllowed) {");
    expect(screen).toContain("reportApproved ? report : { ...report, title: `${report.title} — Review copy (not approved)` },");
    expect(screen).toContain('), { requireApproval: false });');
    // Copy, email, text and Outlook still require approval.
    expect(screen).toMatch(/onCopyReport=\{\(\) => \{\n\s+completeCommunication\(onCopyReport\);/);
    expect(screen).toMatch(/onOutlookReport=\{\(\) => \{\s+completeCommunication\(report =>\s+onOutlookReport\(report, drawingReferences\)\);/);
  });
});
