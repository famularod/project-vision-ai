/**
 * R4 item 5: A GUARD, NOT A FIX. The owner decided this on 3 Oct 2026
 * ("Don't mention them") and confirmed it for the count line: detail tasks
 * that leave the list because a newer lookahead replaced theirs are not
 * mentioned in a report, and no count moves for them. They still count as
 * they stood, so the completed count never goes down because of them.
 *
 * It follows that the count line can read larger than the change in the
 * list he sees: below, the list goes from four open tasks to three, and the
 * report says "+1 open". That is the decided behaviour. Do not make the
 * count follow the list: that would count the tasks as they leave with no
 * line saying why (R1 item 5; the reviewer's driver records it as "+N open").
 * Synthetic data, the reports' own recipe.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, reportPeriodMovementLines } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleProgressIsComplete } from '../../services/ScheduleProgressInvariant';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
function approveImport(state: State, source: ReferenceDocument, lines: string[]): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay: lookahead,
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** The report as Reports writes it, against the saved one; then approved and sent. */
function report(saved: DAVEReportSnapshot | null, state: State, at: string) {
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown(state),
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, projectAreas: [], referenceDocuments: state.documents, now: at,
  });
  const fingerprint = buildDAVEReportSourceFingerprint(truths);
  const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(saved, fingerprint), scheduleItems: shown(state) });
  const approved = reportSnapshotToSave(buildDAVEReportSnapshot({
    truths, scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: at, reportFormat: 'project_manager',
  }), saved)!;
  return { since: reportPeriodMovementLines(briefing) ?? [], sent: markReportSnapshotDelivered(approved, at) };
}
const openAndDone = (state: State) => {
  const list = shown(state);
  return { open: list.filter(item => !scheduleProgressIsComplete(item)).length, done: list.filter(item => scheduleProgressIsComplete(item)).length };
};

const master = approveImport({ items: [], documents: [] }, schedule('MASTER F', '2026-09-07T12:00:00.000Z'), [
  'Framing,Alpha,Lot,09/15/2026,09/25/2026,20', 'Roofing,Alpha,Lot,11/01/2026,11/10/2026,',
]);
// The first lookahead adds three detail tasks: one done, two open.
const week1 = approveImport(master, schedule('LOOKAHEAD L1', '2026-09-08T12:00:00.000Z', 'lookahead'), [
  'Rebar delivery,Alpha,Lot,09/09/2026,09/10/2026,100', 'Formwork strip,Alpha,Lot,09/11/2026,09/12/2026,50', 'Crane day,Alpha,Lot,09/12/2026,09/12/2026,',
]);
// The next lookahead replaces it: those three leave the list, and one new detail task comes.
const week2 = approveImport(week1, schedule('LOOKAHEAD L2', '2026-09-15T12:00:00.000Z', 'lookahead'), [
  'Inspections,Alpha,Lot,09/20/2026,09/21/2026,',
]);

describe('R4 item 5 (guard): the count line after a lookahead is replaced is the owner\'s decision of 3 Oct', () => {
  it('the scenario: the list he sees goes from four open and one done to three open and none done', () => {
    expect(openAndDone(week1)).toEqual({ open: 4, done: 1 });
    expect(openAndDone(week2)).toEqual({ open: 3, done: 0 });
    expect(shown(week2).map(item => item.taskName).sort()).toEqual(['Framing', 'Inspections', 'Roofing']);
  });

  it('the report says nothing of the three that left, and no count moves for them: "+0 completed; +1 open"', () => {
    const first = report(null, week1, '2026-09-08T15:00:00.000Z');
    const second = report(first.sent, week2, '2026-09-15T15:00:00.000Z');
    // By the list alone it would be "-1 completed; -1 open". Decided: the tasks that left still count as they stood.
    expect(second.since[0]).toBe('+0 completed; +1 open; +0 overdue.');
    expect(second.since.slice(1)).toEqual(['Alpha: Inspections was added to the project plan.']);
    expect(second.since.join('\n')).not.toMatch(/Rebar delivery|Formwork strip|Crane day|was removed/);
  });

  it('and the report after that counts from there, with nothing made up for them later', () => {
    const first = report(null, week1, '2026-09-08T15:00:00.000Z');
    const second = report(first.sent, week2, '2026-09-15T15:00:00.000Z');
    // Framing moves on; nothing else changes.
    const later: State = {
      ...week2,
      items: week2.items.map(item => (item.taskName === 'Framing' ? { ...item, percentComplete: 40, updatedAt: '2026-09-16T12:00:00.000Z' } as ScheduleItem : item)),
    };
    const third = report(second.sent, later, '2026-09-16T15:00:00.000Z');
    expect(third.since).toEqual(['+0 completed; +0 open; +0 overdue.', 'Alpha: Framing moved from 20% to 40% complete.']);
  });
});
