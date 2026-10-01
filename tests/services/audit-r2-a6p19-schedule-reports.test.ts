/**
 * Audit round 2, A6 pass 19 (1 Oct 2026): schedule data that reached client
 * reports, and one report wording finding.
 *
 * Owner answer Q22: a lookahead adds to the master, and file progress never
 * goes below what David entered. A newer master's dates replace older
 * lookahead dates; a lookahead newer than the master restates the task.
 *
 * Real CSV normalizer, the phone's merge, Set Active, Delete PDF + Items and
 * shown-task pick, and the Reports screen's chain (the "since" lines against
 * the saved report, then approve and send). Synthetic data.
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
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { buildDAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const doc = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
/** A CSV's rows through the real normalizer, with the import's provenance. */
const rows = (source: ReferenceDocument, lines: string[]) => (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
  mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
}).items as ScheduleItem[]).map((row, index) => ({ ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (state: State, name: string) => shown(state).filter(item => item.taskName === name)
  .sort((a, b) => a.startDate.localeCompare(b.startDate));
const datesOf = (state: State, name: string) => named(state, name).map(item => [item.startDate, item.finishDate]);

/** Approving a schedule on the phone (App.tsx): a master is made current; a lookahead adds to it (Q22). */
function approve(state: State, source: ReferenceDocument, lines: string[], lookahead = false): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, ...(lookahead ? { overlay: true } : {}),
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** Set Active on the phone, with its progress carry (App.tsx). */
function setActive(state: State, target: ReferenceDocument, now: string): State {
  const saved = state.documents.find(document => document.id === target.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(saved, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
/** Delete PDF + Items on the phone (App.tsx). */
function deleteWithItems(state: State, target: ReferenceDocument, at: string): State {
  const document = state.documents.find(saved => saved.id === target.id)!;
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => saved.get(item.id) || item), documents };
}
/** David records progress by hand on the phone. */
const record = (state: State, id: string, pct: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete: pct, status: pct >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager',
    progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
  } as ScheduleItem : item),
});
/** David adds a note to a task. */
const noted = (state: State, id: string, message: string, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id
    ? { ...item, activity: [...(item.activity ?? []), { id: `n-${at}`, message, author: 'David', createdAt: at }], updatedAt: at } as ScheduleItem
    : item),
});
const truthOf = (state: State, now: string) => buildDAVEProjectTruth({
  projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: [], now,
});
/** The Reports screen's chain: the "since" lines against the saved report, then approve and send. */
function send(saved: DAVEReportSnapshot | null, state: State, at: string) {
  const truth = truthOf(state, at);
  const fingerprint = buildDAVEReportSourceFingerprint([truth]);
  const briefing = buildDAVEReportBriefing({
    truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(saved, fingerprint), scheduleItems: shown(state),
  });
  const period = briefing.reportingPeriod;
  const approved = reportSnapshotToSave(buildDAVEReportSnapshot({
    truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: at, reportFormat: 'project_manager',
  }), saved)!;
  return {
    lines: briefing.recentChanges.map(change => change.summary),
    counts: `${period.completeDelta} completed; ${period.openDelta} open`,
    completed: briefing.completedWork,
    sent: markReportSnapshotDelivered(approved, at),
  };
}

describe('M1: deleting a newer lookahead never brings back dates a newer master replaced', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
  const L2 = doc('LOOKAHEAD L2', '2026-09-16T12:00:00.000Z', 'lookahead');
  const H = doc('MASTER H', '2026-09-21T12:00:00.000Z');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  const run = (withL1: boolean) => {
    let state = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
    const r0 = send(null, state, '2026-09-08T15:00:00.000Z');
    if (withL1) state = approve(state, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true); // week 1's lookahead
    state = approve(state, G, ['Framing,Alpha,Lot,10/23/2026,11/02/2026,', SURVEY]); // Monday's master moves Framing
    state = approve(state, L2, ['Framing,Alpha,Lot,10/24/2026,11/03/2026,'], true); // week 2's lookahead
    const r1 = send(r0.sent, state, '2026-09-17T15:00:00.000Z');
    state = deleteWithItems(state, L2, '2026-09-19T10:00:00.000Z'); // Delete PDF + Items of week 2's lookahead
    const afterDelete = datesOf(state, 'Framing');
    const r2 = send(r1.sent, state, '2026-09-21T09:00:00.000Z');
    state = approve(state, H, ['Framing,Alpha,Lot,10/23/2026,11/02/2026,', SURVEY]); // the next master repeats G's dates
    return { r1, r2, afterDelete, afterH: datesOf(state, 'Framing'), state };
  };

  it('control: with no earlier lookahead, Framing goes back to master G\'s dates', () => {
    const { afterDelete, r2, afterH } = run(false);
    expect(afterDelete).toEqual([['10/23/2026', '11/02/2026']]);
    expect(r2.lines).toEqual(['Alpha: Framing finish changed from 11/03/2026 to 11/02/2026.']);
    expect(afterH).toEqual([['10/23/2026', '11/02/2026']]);
  });

  it('with week 1\'s lookahead still saved, Framing goes back to G\'s 11/02 (not L1\'s 10/28), and H keeps it', () => {
    const { r1, afterDelete, r2, afterH } = run(true);
    expect(r1.lines).toEqual(['Alpha: Framing finish changed from 10/25/2026 to 11/03/2026.']);
    expect(afterDelete).toEqual([['10/23/2026', '11/02/2026']]);
    expect(r2.lines).toEqual(['Alpha: Framing finish changed from 11/03/2026 to 11/02/2026.']);
    expect(afterH).toEqual([['10/23/2026', '11/02/2026']]);
  });

  it('a lookahead newer than the master still gives its dates back when a later lookahead is deleted', () => {
    // L1, then G moves Framing, then L2 and L3. Deleting L3 gives L2's dates back: L2 is newer than G.
    const L3 = doc('LOOKAHEAD L3', '2026-09-17T12:00:00.000Z', 'lookahead');
    let state = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,']);
    state = approve(state, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    state = approve(state, G, ['Framing,Alpha,Lot,10/23/2026,11/02/2026,']);
    state = approve(state, L2, ['Framing,Alpha,Lot,10/24/2026,11/03/2026,'], true);
    state = approve(state, L3, ['Framing,Alpha,Lot,10/26/2026,11/05/2026,'], true);
    expect(datesOf(state, 'Framing')).toEqual([['10/26/2026', '11/05/2026']]);
    state = deleteWithItems(state, L3, '2026-09-19T10:00:00.000Z');
    expect(datesOf(state, 'Framing')).toEqual([['10/24/2026', '11/03/2026']]);
    // Then L2: back to G's dates, never L1's.
    state = deleteWithItems(state, L2, '2026-09-19T11:00:00.000Z');
    expect(datesOf(state, 'Framing')).toEqual([['10/23/2026', '11/02/2026']]);
  });

  it('a master repeating what it said before the lookahead replaces nothing: deleting L2 still gives L1\'s dates', () => {
    let state = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,']);
    state = approve(state, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    state = approve(state, G, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,']); // G repeats F's dates: L1 stands
    expect(datesOf(state, 'Framing')).toEqual([['10/18/2026', '10/28/2026']]);
    state = approve(state, L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,'], true);
    state = deleteWithItems(state, L2, '2026-09-19T10:00:00.000Z');
    expect(datesOf(state, 'Framing')).toEqual([['10/18/2026', '10/28/2026']]);
  });
});

describe('M2: after the lookahead that added a third twin is deleted (a later lookahead still holds it), the next master pairs the twins', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const L2 = doc('LOOKAHEAD L2', '2026-09-16T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', '2026-09-21T12:00:00.000Z');
  const FRAMING = 'Framing,Alpha,Lot,10/26/2026,10/30/2026,';
  const run = (deleteL1: boolean, webEdit = false) => {
    let state = approve(EMPTY, F, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,', FRAMING]);
    state = record(state, named(state, 'Pour slab')[0].id, 60, '2026-09-08T15:00:00.000Z');
    // Week 1's rolling lookahead: the second pour, and a third.
    state = approve(state, L1, ['Pour slab,Alpha,Lot,10/19/2026,10/23/2026,', 'Pour slab,Alpha,Lot,11/02/2026,11/06/2026,'], true);
    if (webEdit) {
      // A web edit of the third pour (its owner) keeps what the lookahead noted on it.
      const third = named(state, 'Pour slab')[2];
      const edited = buildDAVEWebScheduleItem({
        draft: {
          projectId: 'alpha', itemType: 'Task', taskName: third.taskName, projectName: third.projectName, locationName: third.locationName,
          startDate: third.startDate, finishDate: third.finishDate, milestone: '', owner: 'Concrete crew', contractor: '',
          percentComplete: third.percentComplete, priority: 'Medium', status: third.status, notes: '', nextAction: '', activityMessage: '',
        } as any,
        current: { ...third, cloudUpdatedAt: null } as any, id: third.id, now: '2026-09-10T09:00:00.000Z', actor: 'David',
      }) as unknown as ScheduleItem;
      expect(edited.importedAsLookahead).toBe(true);
      const { cloudUpdatedAt: _drop, ...plain } = edited as any;
      state = { ...state, items: state.items.map(item => item.id === third.id ? plain as ScheduleItem : item) };
    }
    // Week 2's lookahead restates both.
    state = approve(state, L2, ['Pour slab,Alpha,Lot,10/20/2026,10/24/2026,', 'Pour slab,Alpha,Lot,11/03/2026,11/07/2026,'], true);
    const r1 = send(null, state, '2026-09-17T15:00:00.000Z');
    if (deleteL1) state = deleteWithItems(state, L1, '2026-09-19T10:00:00.000Z');
    // Monday's master slips its two pours two days; the third is not in it yet.
    state = approve(state, G, ['Pour slab,Alpha,Lot,10/07/2026,10/11/2026,', 'Pour slab,Alpha,Lot,10/22/2026,10/26/2026,', FRAMING]);
    const r2 = send(r1.sent, state, '2026-09-21T15:00:00.000Z');
    return { pours: named(state, 'Pour slab').map(item => [item.startDate, item.percentComplete]), r2 };
  };

  it('control: week 1\'s lookahead kept: three pours, David\'s 60% on the first', () => {
    const { pours, r2 } = run(false);
    expect(pours).toEqual([['10/07/2026', 60], ['10/22/2026', 0], ['11/03/2026', 0]]);
    expect(r2.counts).toBe('0 completed; 0 open');
  });

  it('week 1\'s lookahead deleted first: still three pours, David\'s 60% on the first, no pour added or removed', () => {
    const control = run(false);
    const { pours, r2 } = run(true);
    expect(pours).toEqual([['10/07/2026', 60], ['10/22/2026', 0], ['11/03/2026', 0]]);
    expect(r2.counts).toBe('0 completed; 0 open');
    expect(r2.lines).toEqual(control.r2.lines);
    expect(r2.lines.some(line => /added to the project plan|removed from the current project plan/.test(line))).toBe(false);
  });

  it('a web edit of the pour the lookahead added keeps the mark, and the next master still pairs', () => {
    const { pours } = run(true, true);
    expect(pours).toEqual([['10/07/2026', 60], ['10/22/2026', 0], ['11/03/2026', 0]]);
  });

  it('a pour a lookahead added that a master then lists is the master\'s: it no longer counts as the lookahead\'s', () => {
    let state = approve(EMPTY, F, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,']);
    state = approve(state, L1, ['Pour slab,Alpha,Lot,10/19/2026,10/23/2026,', 'Pour slab,Alpha,Lot,11/02/2026,11/06/2026,'], true);
    expect(state.items.filter(item => item.importedAsLookahead).map(item => item.id)).toEqual(['LOOKAHEAD L1-2']);
    // G lists all three, unchanged: the third is re-homed into G, a master's twin from now on.
    state = approve(state, G, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,', 'Pour slab,Alpha,Lot,11/02/2026,11/06/2026,']);
    expect(named(state, 'Pour slab').map(item => item.id)).toEqual(['MASTER F-1', 'MASTER F-2', 'LOOKAHEAD L1-2']);
    expect(state.items.find(item => item.id === 'LOOKAHEAD L1-2')!.alsoImportedInBatchIds).toEqual(['batch-MASTER G']);
    // Deleting L1 keeps it (G holds it), and the next master's three rows pair with all three: David's 30% stays.
    state = record(state, 'LOOKAHEAD L1-2', 30, '2026-09-22T09:00:00.000Z');
    state = deleteWithItems(state, L1, '2026-09-22T10:00:00.000Z');
    const H = doc('MASTER H', '2026-09-28T12:00:00.000Z');
    state = approve(state, H, ['Pour slab,Alpha,Lot,10/06/2026,10/10/2026,', 'Pour slab,Alpha,Lot,10/20/2026,10/24/2026,', 'Pour slab,Alpha,Lot,11/03/2026,11/07/2026,']);
    expect(named(state, 'Pour slab').map(item => [item.startDate, item.percentComplete])).toEqual([['10/06/2026', 0], ['10/20/2026', 0], ['11/03/2026', 30]]);
  });
});
