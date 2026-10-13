/**
 * R3 item 4b (open item, wording; recorded by A6 pass 24 on 1 Oct 2026). Two
 * tasks of one name, one in "Deck" and one with no area, both completed since
 * the last report, read
 *   "Alpha: Pour slab was completed."  beside  "Alpha: Pour slab (Deck) was completed."
 * The first reads as a line about Pour slab as a whole, said twice, not as a
 * second task. Where the same line is said for same-named tasks in different
 * areas, each names its area (A6 pass 19 L4); the one with no area now says
 * so, in the report's own words for it ("unassigned area"). Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot,
  reportSnapshotToSave, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const doc = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
function approve(source: ReferenceDocument, lines: string[]): State {
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((row, index) => ({ ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
  const merged = mergeApprovedScheduleImportItems({
    existing: [], imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport([], [source], source.importBatchId || ''), approvedAt: source.importedAt as string,
  });
  return { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [source], 'project') };
}
const record = (state: State, id: string, pct: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete: pct, status: pct >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager',
    progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
  } as ScheduleItem : item),
});
/** The Reports screen's chain: the "since" lines against the saved report, then approve and send. */
function send(saved: DAVEReportSnapshot | null, state: State, at: string) {
  const truth = buildDAVEProjectTruth({
    projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: [], now: at,
  });
  const fingerprint = buildDAVEReportSourceFingerprint([truth]);
  const briefing = buildDAVEReportBriefing({
    truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(saved, fingerprint), scheduleItems: shown(state),
  });
  const approved = reportSnapshotToSave(buildDAVEReportSnapshot({
    truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: at, reportFormat: 'project_manager',
  }), saved)!;
  return {
    lines: briefing.recentChanges.map(change => change.summary).sort(),
    counts: `${briefing.reportingPeriod.completeDelta} completed; ${briefing.reportingPeriod.openDelta} open`,
    completed: briefing.completedWork.map(line => line.replace(/ Last updated .*$/, '')).sort(),
    current: [...briefing.currentWork].sort(),
    sent: markReportSnapshotDelivered(approved, at),
  };
}
const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
/** Both rows of that name recorded at `pct` after a first report. */
const bothAt = (lines: string[], pct: number) => {
  let state = approve(F, lines);
  const r0 = send(null, state, '2026-09-08T15:00:00.000Z');
  shown(state).filter(item => item.taskName === 'Pour slab').forEach(item => { state = record(state, item.id, pct, '2026-09-10T15:00:00.000Z'); });
  return { state, report: send(r0.sent, state, '2026-09-14T15:00:00.000Z') };
};
const BLANK_AND_DECK = ['Pour slab,Alpha,,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Deck,10/12/2026,10/16/2026,', 'Roofing,Alpha,,11/02/2026,11/06/2026,'];

describe('R3 item 4b: a task with no area beside a same-named task in an area', () => {
  it('the scenario: one Pour slab has no area, the other is in Deck', () => {
    const { state } = bothAt(BLANK_AND_DECK, 100);
    expect(shown(state).filter(item => item.taskName === 'Pour slab').map(item => (item.locationName || '').trim()).sort()).toEqual(['', 'Deck']);
  });

  it('both completed: each line says which task it is', () => {
    const { report } = bothAt(BLANK_AND_DECK, 100);
    expect(report.counts).toBe('2 completed; -2 open');
    expect(report.lines).toEqual(['Alpha: Pour slab (Deck) was completed.', 'Alpha: Pour slab (unassigned area) was completed.']);
  });

  it('both moved the same way: the same', () => {
    const { report } = bothAt(BLANK_AND_DECK, 40);
    expect(report.lines).toEqual(expect.arrayContaining([
      'Alpha: Pour slab (Deck) moved from 0% to 40% complete.', 'Alpha: Pour slab (unassigned area) moved from 0% to 40% complete.',
    ]));
    expect(report.lines.filter(line => /^Alpha: Pour slab moved from/.test(line))).toEqual([]);
  });

  it('guard: one task of a name with no area is not given a bracket', () => {
    let state = approve(F, BLANK_AND_DECK);
    const r0 = send(null, state, '2026-09-08T15:00:00.000Z');
    state = record(state, shown(state).find(item => item.taskName === 'Roofing')!.id, 100, '2026-09-10T15:00:00.000Z');
    expect(send(r0.sent, state, '2026-09-14T15:00:00.000Z').lines).toEqual(['Alpha: Roofing was completed.']);
  });

  it('guard: two with no area say it once with the count; two named areas read as before', () => {
    expect(bothAt(['Pour slab,Alpha,,10/05/2026,10/09/2026,', 'Pour slab,Alpha,,10/19/2026,10/23/2026,'], 100).report.lines)
      .toEqual(['Alpha: Pour slab was completed (2 tasks).']);
    expect(bothAt(['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Deck,10/12/2026,10/16/2026,'], 100).report.lines)
      .toEqual(['Alpha: Pour slab (Deck) was completed.', 'Alpha: Pour slab (Lot) was completed.']);
  });

  it('guard: Completed Work and Current Work list each task as before', () => {
    const done = bothAt(BLANK_AND_DECK, 100).report;
    expect(done.completed).toEqual(['Pour slab (Deck): Complete; 100% complete.', 'Pour slab: Complete; 100% complete.']);
    const open = bothAt(BLANK_AND_DECK, 40).report;
    expect(open.current.filter(line => line.startsWith('Pour slab'))).toEqual([
      'Pour slab (Deck): In Progress; 40% complete; due 10/16/2026.', 'Pour slab: In Progress; 40% complete; due 10/09/2026.',
    ]);
  });
});
