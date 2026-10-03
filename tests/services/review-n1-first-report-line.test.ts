import fs from 'fs';
import path from 'path';

import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  REPORT_FIRST_PERIOD_LINE,
  buildDAVEReportBriefing,
  buildDAVEReportSourceFingerprint,
  enhanceDAVEReportDraft,
  reportPeriodMovementLines,
} from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  reportBaselineSnapshot,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import type { PIEReportDraft } from '../../services/PIEReporter';
import type { ScheduleItem } from '../../types';

/**
 * Review N1 (3 Oct 2026, older wording). A first report said, on the screen
 * and in the written report, "This approval establishes the baseline for
 * the next reporting period." That is not what happens: the period runs
 * from the last report SENT, and an approval never sent starts none. The
 * line now says the send establishes it. Synthetic data.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

const task = (id: string, taskName: string, percentComplete: number) => ({
  id, projectName: 'Tower', locationName: 'Level 2', taskName, startDate: '2026-09-01', finishDate: '2027-06-30', milestone: '',
  owner: 'Dana', contractor: 'Acme', percentComplete, priority: 'Medium', status: percentComplete >= 100 ? 'Complete' : 'In Progress',
  notes: '', createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner', title: 'Tower update', subject: 'Tower update', body: '',
  openingLine: '', closingLine: '', executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [], risks: [],
  decisionsNeeded: [], confidence: 'high', reportReadiness: 'high', needsReview: false, reviewFlags: [], sourceEvidence: [],
  constructionUnderstanding: {}, generatedAt: '2026-09-30T12:00:00.000Z',
} as unknown as PIEReportDraft;
function report(frame: number, known: DAVEReportSnapshot | null, now: string) {
  const truth = buildDAVEProjectTruth({ projectId: 'report:tower', projectName: 'Tower', updates: [], scheduleItems: [task('frame', 'Frame walls', frame), task('pour', 'Pour slab', 40)], projectAreas: [], referenceDocuments: [], now });
  const fingerprint = buildDAVEReportSourceFingerprint([truth]);
  const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Tower'], previousSnapshot: reportBaselineSnapshot(known, fingerprint) });
  return {
    briefing,
    snapshot: buildDAVEReportSnapshot({ truths: [truth], scopeKey: 'tower', sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' }),
    since: (format: 'project_manager' | 'executive') => {
      const body = enhanceDAVEReportDraft(draft, briefing, format).body;
      return body.slice(body.indexOf('SINCE THE LAST REPORT'), body.indexOf('COMPLETED WORK'));
    },
  };
}

describe('review N1: a first report says the send establishes the baseline, as it does', () => {
  it('the written report, both formats, and the Reports screen say so; nothing says the approval does', () => {
    expect(REPORT_FIRST_PERIOD_LINE).toBe('Sending this report establishes the baseline for the next reporting period.');
    const first = report(40, null, '2026-10-01T12:00:00.000Z');
    expect(reportPeriodMovementLines(first.briefing)).toBeNull();
    for (const format of ['project_manager', 'executive'] as const) {
      expect(first.since(format)).toContain(`• ${REPORT_FIRST_PERIOD_LINE}`);
      expect(first.since(format)).not.toMatch(/This approval establishes/);
    }
    const screen = fs.readFileSync(path.join(__dirname, '../../screens/ReportsScreen.tsx'), 'utf8');
    expect(screen).toContain(REPORT_FIRST_PERIOD_LINE);
    expect(screen).not.toContain('This approval establishes');
  });

  it('what is true: an approval that was never sent starts no period; the report sent does', () => {
    const first = report(40, null, '2026-10-01T12:00:00.000Z');
    const approved = reportSnapshotToSave(first.snapshot, null) as DAVEReportSnapshot;
    expect(approved.deliveredAt).toBeNull();
    // The next day's report, with the first only approved: still a first report.
    const second = report(100, approved, '2026-10-02T12:00:00.000Z');
    expect(second.briefing.reportingPeriod.basis).toBe('current_snapshot');
    expect(second.since('project_manager')).toContain(`• ${REPORT_FIRST_PERIOD_LINE}`);
    // Once the first was sent, the next counts from it.
    const sent = markReportSnapshotDelivered(approved, '2026-10-01T13:00:00.000Z', 'phone');
    const counted = report(100, sent, '2026-10-02T12:00:00.000Z');
    expect(counted.briefing.reportingPeriod.basis).toBe('previous_approved_report');
    expect(counted.since('project_manager')).toContain('Frame walls was completed.');
    expect(counted.since('project_manager')).not.toContain(REPORT_FIRST_PERIOD_LINE);
  });
});
