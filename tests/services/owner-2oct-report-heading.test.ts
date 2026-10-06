/**
 * Owner answer 2 Oct (report heading): the written report's heading
 * "SINCE THE LAST APPROVED REPORT" becomes "SINCE THE LAST REPORT", wherever
 * the report is produced: the phone's body (copied, emailed, texted, shared
 * in Outlook) and the Word file made from it, and the web report (which
 * already headed its section "Since the Last Report"). Nothing else in the
 * report text changes. Real report builders and the real Word builder.
 */
import JSZip from 'jszip';

import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVEReportBriefing,
  enhanceDAVEReportDraft,
  REPORT_PERIOD_HEADING,
} from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { formatDAVEWebReport } from '../../services/DAVEWebOperations';
import { buildReportWordBase64 } from '../../services/ReportWordDocument';
import type { PIEReportDraft } from '../../services/PIEReporter';
import type { ScheduleItem } from '../../types';

const NOW = '2026-10-02T15:00:00.000Z';
const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner', title: 'Tower update', subject: 'Tower update', body: '',
  openingLine: 'Good afternoon,', closingLine: 'Thank you.', executiveSummary: [], sections: [], locationGroups: [], actionItems: [],
  imageReferences: [], risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high', needsReview: false,
  reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {}, generatedAt: NOW,
} as unknown as PIEReportDraft;
const task = (id: string, name: string, percent: number) => ({
  id, projectName: 'Tower', locationName: 'Level 2', taskName: name, startDate: '2026-09-01', finishDate: '2027-06-30',
  milestone: '', owner: 'Dana', contractor: 'Acme', percentComplete: percent, priority: 'Medium',
  status: percent >= 100 ? 'Complete' : 'In Progress', notes: '', createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
const truthOf = (frame: number) => buildDAVEProjectTruth({
  projectId: 'report:tower', projectName: 'Tower', updates: [], projectAreas: [], referenceDocuments: [],
  scheduleItems: [task('frame', 'Frame walls', frame), task('pour', 'Pour slab', 40)], now: NOW,
});
const lastSent = markReportSnapshotDelivered(reportSnapshotToSave(buildDAVEReportSnapshot({
  truths: [truthOf(40)], scopeKey: 'tower', sourceFingerprint: 'sent', capturedAt: '2026-10-01T15:00:00.000Z', reportFormat: 'project_manager',
}), null) as DAVEReportSnapshot, '2026-10-01T16:00:00.000Z', 'phone');

describe('the written report\'s heading is "SINCE THE LAST REPORT" (owner answer 2 Oct)', () => {
  const briefing = buildDAVEReportBriefing({ truths: [truthOf(100)], selectedProjectNames: ['Tower'], previousSnapshot: lastSent });
  const bodies = (['project_manager', 'executive'] as const).map(format => enhanceDAVEReportDraft(draft, briefing, format).body);

  it('in both formats of the phone\'s report (the body every send carries), with the same lines under it', () => {
    expect(REPORT_PERIOD_HEADING).toBe('SINCE THE LAST REPORT');
    for (const body of bodies) {
      expect(body).toContain('SINCE THE LAST REPORT\n• +1 completed; -1 open; +0 overdue.\n• Tower: Frame walls was completed.');
      expect(body).not.toMatch(/APPROVED REPORT/);
    }
  });

  it('nothing else in the text changes: the body is the old one with only the heading line replaced', () => {
    for (const body of bodies) {
      const lines = body.split('\n');
      expect(lines.filter(line => line === REPORT_PERIOD_HEADING)).toHaveLength(1);
      const old = body.replace('SINCE THE LAST REPORT\n', 'SINCE THE LAST APPROVED REPORT\n');
      expect(old.split('\n').filter((line, index) => line !== lines[index])).toEqual(['SINCE THE LAST APPROVED REPORT']);
    }
  });

  it('in the Word file made from the report (its headings in title case)', async () => {
    const base64 = await buildReportWordBase64({ title: 'Tower Project Status Report', body: bodies[0], generatedAt: NOW, media: [], unavailableMedia: [] });
    const zip = await JSZip.loadAsync(Buffer.from(base64, 'base64'));
    const xml = await zip.file('word/document.xml')!.async('string');
    // The Word file sets the body's headings in title case.
    expect(xml).toContain('>Since The Last Report<');
    expect(xml).not.toMatch(/approved report/i);
  });

  it('in the web report, whose section already says "Since the Last Report"', () => {
    const web = formatDAVEWebReport(briefing, 'project_manager', { label: briefing.reportingPeriod.label, lines: ['+1 completed; -1 open; +0 overdue.'] });
    expect(web).toContain('## Since the Last Report\n');
    expect(web).not.toMatch(/approved report/i);
  });
});
