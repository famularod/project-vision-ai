/**
 * Whole-app audit A6 pass 10 L1 (30 Sep 2026), "since the last report".
 *
 * Two same-named "Inspection" tasks (owners Dana and Eli), both moved by a
 * revised schedule with their finish order unchanged, and Dana's completed:
 * the report said "+1 completed; -1 open", "Inspection was added to the
 * project plan." twice and "…was removed from the current project plan."
 * twice, and never named the completion. Pass 9 paired same-named tasks only
 * when every pair in finish order had the same status, completion and owner,
 * and otherwise rejected the whole group. They now pair the way with the
 * fewest status, completion and owner differences when that way is the only
 * one (the owners tell them apart); only a tie that would say different
 * things stays added and removed.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { buildDAVEProjectTruth, type DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVEReportBriefing,
  buildDAVEReportSourceFingerprint,
  enhanceDAVEReportDraft,
} from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  daveReportSnapshotScopeKey,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import type { PIEReportDraft } from '../../services/PIEReporter';
import type { ReferenceDocument, ScheduleItem } from '../../types';

const NOW = '2026-09-30T15:00:00.000Z';
const REPORT_SENT = '2026-09-23T15:00:00.000Z';

const task = (id: string, finishDate: string, owner: string | null, complete: boolean) => ({
  taskId: id, taskName: 'Inspection', areaName: 'Level 2', owner,
  status: complete ? 'Complete' : 'In Progress', percentComplete: complete ? 100 : 0,
  finishDate, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null,
});
const at = (tasks: unknown[], capturedAt: string) => buildDAVEReportSnapshot({
  truths: [{ projectName: 'Tower', schedule: tasks } as never], scopeKey: 'tower', sourceFingerprint: capturedAt, capturedAt,
});
const compare = (previous: unknown[], current: unknown[]) => compareDAVEReportSnapshots({
  previous: at(previous, REPORT_SENT),
  current: at(current, NOW),
});
const summaries = (comparison: ReturnType<typeof compare>) => comparison.changes.map(change => change.summary);

describe('L1: same-named tasks pair the one way their status, completion and owner allow', () => {
  it('Dana\'s and Eli\'s inspections both moved, finish order kept, Dana\'s completed: the completion is named', () => {
    const comparison = compare(
      [task('a1', '2026-10-01', 'Dana', false), task('a2', '2026-11-01', 'Eli', false)],
      [task('b1', '2026-10-05', 'Dana', true), task('b2', '2026-11-05', 'Eli', false)],
    );
    expect(comparison).toMatchObject({ completeDelta: 1, openDelta: -1 });
    expect(summaries(comparison)).toEqual([
      'Inspection was completed.',
      'Inspection finish changed from 2026-10-01 to 2026-10-05.',
      'Inspection finish changed from 2026-11-01 to 2026-11-05.',
    ]);
  });

  it('the finish order swapped: the owners still tell them apart, with no completion, reopen or owner change', () => {
    const comparison = compare(
      [task('a1', '2026-10-01', 'Dana', false), task('a2', '2026-11-01', 'Eli', true)],
      [task('b1', '2026-11-05', 'Dana', false), task('b2', '2026-10-05', 'Eli', true)],
    );
    expect(comparison.completeDelta).toBe(0);
    expect(summaries(comparison)).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-11-05.',
      'Inspection finish changed from 2026-11-01 to 2026-10-05.',
    ]);
  });

  it('a tie that would say different things (both reassigned, to whom unknown) stays added and removed', () => {
    const comparison = compare(
      [task('a1', '2026-10-01', 'Dana', false), task('a2', '2026-11-01', 'Eli', false)],
      [task('b1', '2026-10-05', 'Fay', false), task('b2', '2026-11-05', 'Gus', false)],
    );
    expect(comparison.changes.map(change => change.kind).sort()).toEqual(['added', 'added', 'removed', 'removed']);
    expect(summaries(comparison).join('\n')).not.toContain('owner changed');
  });

  it('a tie that says the same either way (one of Dana\'s two inspections completed) names the completion once', () => {
    const comparison = compare(
      [task('a1', '2026-10-01', 'Dana', false), task('a2', '2026-11-01', 'Dana', false)],
      [task('b1', '2026-10-01', 'Dana', true), task('b2', '2026-11-01', 'Dana', false)],
    );
    expect(comparison).toMatchObject({ completeDelta: 1, openDelta: -1 });
    expect(summaries(comparison)).toEqual(['Inspection was completed.']);
  });

  it('two alike in every way, both moved: still finish changes in finish order', () => {
    const comparison = compare(
      [task('a1', '2026-10-01', null, false), task('a2', '2026-11-01', null, false)],
      [task('b1', '2026-10-05', null, false), task('b2', '2026-11-05', null, false)],
    );
    expect(summaries(comparison)).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-05.',
      'Inspection finish changed from 2026-11-01 to 2026-11-05.',
    ]);
  });

  it('three of them, one reassigned and one completed: each is said once', () => {
    const comparison = compare(
      [task('a1', '2026-10-01', 'Dana', false), task('a2', '2026-11-01', 'Eli', false), task('a3', '2026-12-01', 'Fay', false)],
      [task('b1', '2026-10-05', 'Dana', false), task('b2', '2026-11-05', 'Eli', true), task('b3', '2026-12-05', 'Gus', false)],
    );
    expect(comparison.completeDelta).toBe(1);
    const lines = summaries(comparison);
    expect(lines.filter(line => line === 'Inspection was completed.')).toHaveLength(1);
    expect(lines).toContain('Inspection owner changed from Fay to Gus.');
    expect(lines.join('\n')).not.toMatch(/was added|was removed|reopened/);
  });
});

describe('L1 through the real import merge, in both report formats', () => {
  const row = (batch: string, id: string, finishDate: string, owner: string, complete: boolean, sourceRowNumber: number) => {
    const imported = batch === 'tower-v1' ? '2026-09-01T08:00:00.000Z' : '2026-09-29T08:00:00.000Z';
    return {
      id, projectName: 'Tower', scheduleProjectName: 'Tower', locationName: 'Level 2',
      taskName: 'Inspection', startDate: '2026-09-01', finishDate, milestone: '', owner, contractor: 'Acme',
      percentComplete: complete ? 100 : 0, priority: 'Medium', status: complete ? 'Complete' : 'Not Started',
      notes: '', importBatchId: batch, sourceDocumentId: `doc-${batch}`, importedFrom: `${batch}.pdf`,
      importedAt: imported, createdAt: imported, sourceRowNumber,
    } as unknown as ScheduleItem;
  };
  const scheduleDocument = (batch: string, isCurrent: boolean) => ({
    id: `doc-${batch}`, name: `${batch}.pdf`, originalFileName: `${batch}.pdf`, category: 'Schedules',
    projectName: 'Tower', importBatchId: batch, isCurrent, uri: `file:///docs/${batch}.pdf`, notes: '',
    importedAt: batch === 'tower-v1' ? '2026-09-01T08:00:00.000Z' : '2026-09-29T08:00:00.000Z',
  }) as unknown as ReferenceDocument;
  const truthOf = (scheduleItems: ScheduleItem[], now: string): DAVEProjectTruth => buildDAVEProjectTruth({
    projectId: 'report:tower', projectName: 'Tower', updates: [], scheduleItems, projectAreas: [], referenceDocuments: [], now,
  });
  const snapshotOf = (truth: DAVEProjectTruth, capturedAt: string): DAVEReportSnapshot => buildDAVEReportSnapshot({
    truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Tower']),
    sourceFingerprint: buildDAVEReportSourceFingerprint([truth]), capturedAt, reportFormat: 'project_manager',
  });
  const draft = {
    id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
    title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
    executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
    risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
    needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
    generatedAt: NOW,
  } as unknown as PIEReportDraft;

  it('Dana\'s inspection completed in the revision: "+1 completed", the completion named, nothing added or removed', () => {
    const v1 = [
      row('tower-v1', 'tower-v1-inspection-1', '2026-10-01', 'Dana', false, 1),
      row('tower-v1', 'tower-v1-inspection-2', '2026-11-01', 'Eli', false, 2),
    ];
    const merged = mergeApprovedScheduleImportItems({
      existing: v1,
      imported: [
        row('tower-v2', 'tower-v2-inspection-1', '2026-10-05', 'Dana', true, 1),
        row('tower-v2', 'tower-v2-inspection-2', '2026-11-05', 'Eli', false, 2),
      ],
      completionMatch: () => null,
      mergeCompletion: item => item,
      approvedAt: '2026-09-29T08:00:00.000Z',
    });
    const shown = selectAuthoritativeScheduleItems({
      scheduleItems: [...merged.next, ...merged.additions],
      scheduleDocuments: [scheduleDocument('tower-v1', false), scheduleDocument('tower-v2', true)],
    }) as ScheduleItem[];
    const briefing = buildDAVEReportBriefing({
      truths: [truthOf(shown, NOW)],
      selectedProjectNames: ['Tower'],
      previousSnapshot: snapshotOf(truthOf(v1, REPORT_SENT), REPORT_SENT),
    });
    for (const format of ['project_manager', 'executive'] as const) {
      const body = enhanceDAVEReportDraft(draft, briefing, format).body;
      // Owner answer 2 Oct (report heading): the written report's heading is "SINCE THE LAST REPORT" (was "SINCE THE LAST APPROVED REPORT"); pin updated deliberately.
      const start = body.indexOf('SINCE THE LAST REPORT');
      const since = body.slice(start, body.indexOf('COMPLETED WORK', start));
      expect(since).toContain('+1 completed; -1 open;');
      expect(since).toContain('Tower: Inspection was completed.');
      expect(since).not.toMatch(/was added|was removed/);
    }
  });
});
