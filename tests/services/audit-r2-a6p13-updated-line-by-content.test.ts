/**
 * Audit round 2, A6 pass 13 M1 (1 Oct 2026): after "Delete PDF + Items",
 * the next report told the client tasks "were updated" when nothing changed.
 *
 * Deleting an old master, or an abandoned newer master after a Make Current
 * back, writes each removed row's id onto the task shown that answers to it
 * (scheduleItemsAfterScheduleDeleted), so field updates stay linked, and
 * stamps that task's updatedAt so every device takes the ids. That stamp
 * must stay. The report printed "<task> was updated." for any task stamped
 * after the last report with no compared change, so its "since" section read
 * "+0 completed; +0 open; +0 overdue." then one "Alpha: Pour slab was
 * updated." line per task (a big master: six and "And N more changes.").
 *
 * Now each saved report keeps a content key per task (what David can see or
 * edit on it, never its ids or times), and a task whose key is the one the
 * last report saved gets no "was updated." line. A report saved before
 * these keys counts as before. Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ReferenceDocument, ScheduleItem } from '../../types';
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
  reportPeriodWaitingForOtherDevice,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import type { PIEReportDraft } from '../../services/PIEReporter';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

const SET_ACTIVE_AT = '2026-09-27T18:00:00.000Z';
const REPORT_SENT = '2026-09-28T18:00:00.000Z';
const DELETED_AT = '2026-09-29T12:00:00.000Z';
const EDITED_AT = '2026-09-29T16:00:00.000Z';
const NOW = '2026-09-30T15:00:00.000Z';

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const F = schedule('MASTER F', '2026-08-31T12:00:00.000Z');
const M = schedule('MASTER M', '2026-09-26T08:00:00.000Z');
const N = schedule('MASTER N', '2026-09-28T08:00:00.000Z');
const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
/** Approving a master merges its rows (paired with the rows shown) and makes it current (App.tsx). */
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
/** Make Current (App.tsx activateReferenceDocument). */
function makeCurrent(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(saved => saved.id === document.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(target, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
/** "Delete PDF + Items" as the phone does it, through the shared delete helper the web delete reuses too. */
function deleteWithItems(state: State, document: ReferenceDocument): State & { removed: ScheduleItem[] } {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: DELETED_AT })
    .map(item => [item.id, item]));
  return { items: kept.map(item => saved.get(item.id) || item), documents, removed };
}
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (items: readonly ScheduleItem[], name: string) => items.filter(item => item.taskName === name);
const byId = (state: State, id: string) => state.items.find(item => item.id === id)!;
/** A hand edit David makes on one saved task. */
const edited = (state: State, id: string, change: Partial<ScheduleItem>, at = EDITED_AT): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? { ...item, ...change, updatedAt: at } as ScheduleItem : item),
});

const truthOf = (state: State, now: string): DAVEProjectTruth => buildDAVEProjectTruth({
  projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: [], now,
});
const snapshotOf = (state: State, capturedAt: string): DAVEReportSnapshot => {
  const truth = truthOf(state, capturedAt);
  return buildDAVEReportSnapshot({
    truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: buildDAVEReportSourceFingerprint([truth]),
    capturedAt, reportFormat: 'project_manager',
  });
};
/** A report saved by a build before the content keys. */
const withoutContentKeys = (snapshot: DAVEReportSnapshot): DAVEReportSnapshot => ({
  ...snapshot,
  tasks: snapshot.tasks.map(task => {
    const { contentKey: _key, ...older } = task as typeof task & { contentKey?: string };
    return older;
  }),
});

const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Alpha update', subject: 'Alpha update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: NOW,
} as unknown as PIEReportDraft;

/** The written report's "since" lines, in both formats (they must agree). */
function sinceLines(state: State, previous: DAVEReportSnapshot | null) {
  const briefing = buildDAVEReportBriefing({ truths: [truthOf(state, NOW)], selectedProjectNames: ['Alpha'], previousSnapshot: previous });
  const [pm, executive] = (['project_manager', 'executive'] as const).map(format => {
    const body = enhanceDAVEReportDraft(draft, briefing, format).body;
    const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
    return body.slice(start, body.indexOf('COMPLETED WORK', start)).split('\n').filter(line => line.startsWith('• '));
  });
  expect(executive).toEqual(pm);
  return pm;
}
const NOTHING_CHANGED = ['• +0 completed; +0 open; +0 overdue.'];
const updatedLines = (lines: readonly string[]) => lines.filter(line => line.endsWith(' was updated.'));

/** The delete stamped the task shown and wrote only ids onto it (the precondition of every case). */
function expectIdsOnlyWrite(before: State, after: State, id: string, removedId: string) {
  const was = byId(before, id);
  const now = byId(after, id);
  expect(now.updatedAt).toBe(DELETED_AT);
  expect(now.revisedFromTaskIds).toContain(removedId);
  const { updatedAt: _a, revisedFromTaskIds: _b, ...rest } = now;
  const { updatedAt: _c, revisedFromTaskIds: _d, ...restBefore } = was;
  expect(rest).toEqual(restBefore);
}

// D: master F, then master M moves three tasks; M's rows were saved before the import kept earlier ids.
const D_NAMES = ['Pour slab', 'Framing', 'Roof deck'];
function oldMasterCase(names: readonly string[] = D_NAMES) {
  const fLines = names.map((name, index) => `${name},Alpha,Lot,10/${String(index + 1).padStart(2, '0')}/2026,10/${String(index + 10).padStart(2, '0')}/2026,0%`);
  const mLines = names.map((name, index) => `${name},Alpha,Lot,10/${String(index + 2).padStart(2, '0')}/2026,10/${String(index + 11).padStart(2, '0')}/2026,0%`);
  const onF = approve({ items: [], documents: [] }, F, rows(F, [...fLines, 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%']));
  const onM = approve(onF, M, rows(M, [...mLines, 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%']));
  const legacy: State = { ...onM, items: onM.items.map(({ revisedFromTaskIds: _earlier, ...item }) => item as ScheduleItem) };
  const sent = snapshotOf(legacy, REPORT_SENT);
  const deleted = deleteWithItems(legacy, F);
  return { onF, before: legacy, sent, deleted };
}

describe('A6 p13 M1: after "Delete PDF + Items" the next report says no task "was updated." when nothing changed', () => {
  it('D: deleting the old master with three legacy moved tasks prints no "was updated." line', () => {
    const { onF, before, sent, deleted } = oldMasterCase();
    expect(deleted.removed.map(item => item.taskName).sort()).toEqual([...D_NAMES].sort());
    for (const name of D_NAMES) {
      const [moved] = named(shown(deleted), name);
      expectIdsOnlyWrite(before, deleted, moved.id, named(onF.items, name)[0].id);
    }
    expect(sinceLines(deleted, sent)).toEqual(NOTHING_CHANGED);
  });

  it('A: deleting the abandoned newer master after a Make Current back prints no "was updated." line', () => {
    const onF = approve({ items: [], documents: [] }, F, rows(F, ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026,0%', 'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%']));
    const rowA = named(onF.items, 'Pour slab')[0];
    const onM = approve(onF, M, rows(M, ['Pour slab,Alpha,Lot,10/02/2026,10/06/2026,0%', 'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%']));
    const rowX = named(shown(onM), 'Pour slab')[0];
    expect(rowX.revisedFromTaskIds).toEqual([rowA.id]);
    const backOnF = makeCurrent(onM, F, SET_ACTIVE_AT);
    expect(named(shown(backOnF), 'Pour slab').map(item => item.id)).toEqual([rowA.id]);
    const sent = snapshotOf(backOnF, REPORT_SENT);

    const deleted = deleteWithItems(backOnF, M);
    expect(deleted.removed.map(item => item.id)).toEqual([rowX.id]);
    expectIdsOnlyWrite(backOnF, deleted, rowA.id, rowX.id);
    expect(sinceLines(deleted, sent)).toEqual(NOTHING_CHANGED);
  });

  it('B: the same with twin "Pour slab" tasks prints no "was updated." line', () => {
    const onF = approve({ items: [], documents: [] }, F, rows(F, [
      'Pour slab,Alpha,Lot,09/01/2026,09/03/2026,40%',
      'Pour slab,Alpha,Lot,10/20/2026,10/22/2026,0%',
    ]));
    const [phase1, phase2] = named(onF.items, 'Pour slab').sort((left, right) => left.startDate.localeCompare(right.startDate));
    const onM = approve(onF, M, rows(M, [
      'Pour slab,Alpha,Lot,09/02/2026,09/04/2026,40%',
      'Pour slab,Alpha,Lot,10/20/2026,10/22/2026,0%',
    ]));
    const movedRow = named(shown(onM), 'Pour slab').find(item => item.id !== phase2.id)!;
    expect(movedRow.revisedFromTaskIds).toEqual([phase1.id]);
    const backOnF = makeCurrent(onM, F, SET_ACTIVE_AT);
    expect(named(shown(backOnF), 'Pour slab').map(item => item.id).sort()).toEqual([phase1.id, phase2.id].sort());
    const sent = snapshotOf(backOnF, REPORT_SENT);

    const deleted = deleteWithItems(backOnF, M);
    expect(deleted.removed.map(item => item.id)).toEqual([movedRow.id]);
    expectIdsOnlyWrite(backOnF, deleted, phase1.id, movedRow.id);
    expect(sinceLines(deleted, sent)).toEqual(NOTHING_CHANGED);
  });

  it('C: deleting a master after a newer master came in prints no "was updated." line', () => {
    const onF = approve({ items: [], documents: [] }, F, rows(F, ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026,0%', 'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%']));
    const rowA = named(onF.items, 'Pour slab')[0];
    const onM = approve(onF, M, rows(M, ['Pour slab,Alpha,Lot,10/02/2026,10/06/2026,0%', 'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%']));
    const rowX = named(shown(onM), 'Pour slab')[0];
    const backOnF = makeCurrent(onM, F, SET_ACTIVE_AT);
    const onN = approve(backOnF, N, rows(N, ['Pour slab,Alpha,Lot,10/03/2026,10/07/2026,0%', 'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%']));
    const rowY = named(shown(onN), 'Pour slab')[0];
    expect(rowY.revisedFromTaskIds).toEqual([rowA.id]);
    const sent = snapshotOf(onN, REPORT_SENT);

    const deleted = deleteWithItems(onN, M);
    expect(deleted.removed.map(item => item.id)).toEqual([rowX.id]);
    expectIdsOnlyWrite(onN, deleted, rowY.id, rowX.id);
    expect(sinceLines(deleted, sent)).toEqual(NOTHING_CHANGED);
  });

  it('a big master: no "was updated." lines and no "And N more changes." for ids the delete wrote', () => {
    const names = ['Pour slab', 'Framing', 'Roof deck', 'Hang drywall', 'Tape drywall', 'Paint walls', 'Hang doors', 'Set trim'];
    const { sent, deleted } = oldMasterCase(names);
    expect(names.every(name => byId(deleted, named(shown(deleted), name)[0].id).updatedAt === DELETED_AT)).toBe(true);
    expect(sinceLines(deleted, sent)).toEqual(NOTHING_CHANGED);
    // One real edit among them: one line, and the count is the lines not shown (none).
    const framing = named(shown(deleted), 'Framing')[0];
    const lines = sinceLines(edited(deleted, framing.id, { nextAction: 'Confirm crane for trusses' }), sent);
    expect(lines).toEqual([...NOTHING_CHANGED, '• Alpha: Framing was updated.']);
  });
});

describe('what still prints', () => {
  it('a hand edit to the start date or the next step (fields the comparison does not list) still says "was updated."', () => {
    const { sent, deleted } = oldMasterCase();
    const pour = named(shown(deleted), 'Pour slab')[0];
    const framing = named(shown(deleted), 'Framing')[0];
    const startMoved = edited(deleted, pour.id, { startDate: '10/04/2026' });
    expect(updatedLines(sinceLines(startMoved, sent))).toEqual(['• Alpha: Pour slab was updated.']);
    const nextStep = edited(deleted, framing.id, { nextAction: 'Order hold-downs' });
    expect(updatedLines(sinceLines(nextStep, sent))).toEqual(['• Alpha: Framing was updated.']);
    // An edit made without the delete reads the same.
    const { before } = oldMasterCase();
    expect(updatedLines(sinceLines(edited(before, named(shown(before), 'Pour slab')[0].id, { startDate: '10/04/2026' }), sent)))
      .toEqual(['• Alpha: Pour slab was updated.']);
  });

  it('the trade-off: a change only to the task\'s notes (not in Project Truth or the report) no longer reads "was updated."', () => {
    const { sent, before } = oldMasterCase();
    const pour = named(shown(before), 'Pour slab')[0];
    expect(sinceLines(edited(before, pour.id, { notes: 'Forms delivered.' }), sent)).toEqual(NOTHING_CHANGED);
    expect(updatedLines(sinceLines(edited(before, pour.id, { notes: 'Forms delivered.' }), withoutContentKeys(sent))))
      .toEqual(['• Alpha: Pour slab was updated.']);
  });

  it('a report saved before content keys counts as before: each stamped task "was updated."', () => {
    const { sent, deleted } = oldMasterCase();
    expect(sent.tasks.every(task => typeof (task as { contentKey?: unknown }).contentKey === 'string')).toBe(true);
    const [deltas, ...rest] = sinceLines(deleted, withoutContentKeys(sent));
    expect(deltas).toBe(NOTHING_CHANGED[0]);
    expect(rest.sort()).toEqual(['Framing', 'Pour slab', 'Roof deck'].map(name => `• Alpha: ${name} was updated.`));
  });

  it('activity lines are unchanged: a note added after the report is still said, stamped by the delete or not', () => {
    const { sent, deleted } = oldMasterCase();
    const pour = named(shown(deleted), 'Pour slab')[0];
    const noted = edited(deleted, pour.id, {
      activity: [{ id: 'a1', message: 'Rebar inspection passed.', author: 'David', createdAt: EDITED_AT }],
    });
    const lines = sinceLines(noted, sent);
    expect(lines.filter(line => line.startsWith('• Alpha: Pour slab — '))).toHaveLength(1);
    expect(updatedLines(lines)).toEqual([]);
    // The same as a report saved before content keys says it.
    expect(sinceLines(noted, withoutContentKeys(sent)).filter(line => line.startsWith('• Alpha: Pour slab — ')))
      .toEqual(lines.filter(line => line.startsWith('• Alpha: Pour slab — ')));
  });

  it('an activity from before the earlier report is not said again once the delete stamps the task', () => {
    const OLD_NOTE_AT = '2026-09-27T20:00:00.000Z';
    const { before } = oldMasterCase();
    const pour = named(shown(before), 'Pour slab')[0];
    const noted = edited(before, pour.id, {
      activity: [{ id: 'a0', message: 'Forms set.', author: 'David', createdAt: OLD_NOTE_AT }],
    }, OLD_NOTE_AT);
    const sent = snapshotOf(noted, REPORT_SENT);
    const deleted = deleteWithItems(noted, F);
    expect(byId(deleted, pour.id).updatedAt).toBe(DELETED_AT);
    expect(sinceLines(deleted, sent)).toEqual(NOTHING_CHANGED);
    // A hand edit after the report reads "was updated.", not the old note.
    const moved = edited(deleted, pour.id, { startDate: '10/04/2026' });
    expect(sinceLines(moved, sent).filter(line => line.includes('Pour slab'))).toEqual(['• Alpha: Pour slab was updated.']);
  });

  it('a real change the comparison names is said once, as before', () => {
    const { sent, deleted } = oldMasterCase();
    const pour = named(shown(deleted), 'Pour slab')[0];
    const lines = sinceLines(edited(deleted, pour.id, { finishDate: '10/20/2026' }), sent);
    expect(lines.filter(line => line.includes('Pour slab'))).toEqual(['• Alpha: Pour slab finish changed from 10/11/2026 to 10/20/2026.']);
  });

  it('the first report (no earlier one) is unchanged', () => {
    const { deleted } = oldMasterCase();
    expect(sinceLines(deleted, null)).toEqual(['• This approval establishes the baseline for the next reporting period.']);
  });
});

describe('the content key', () => {
  it('leaves out ids, times and what is worked out from today or evidence', () => {
    const { before, deleted } = oldMasterCase();
    const keys = (state: State, at: string) => Object.fromEntries(snapshotOf(state, at).tasks.map(task => [task.taskName, task.contentKey]));
    // Ids written and the row stamped by the delete; a later day (urgency moves): the same keys.
    expect(keys(deleted, NOW)).toEqual(keys(before, REPORT_SENT));
    expect(keys(deleted, '2026-11-30T15:00:00.000Z')).toEqual(keys(before, REPORT_SENT));
    // A hand edit to any field David sees changes it.
    const pour = named(shown(deleted), 'Pour slab')[0];
    for (const change of [
      { startDate: '10/04/2026' }, { nextAction: 'Order hold-downs' }, { owner: 'Dana' }, { percentComplete: 10 },
      { baselineFinishDate: '10/30/2026' }, { isMilestone: true },
      { projectControls: { estimatedScheduleImpactDays: 2 } }, { projectControls: { referenceNumber: 'RFI-7' } },
    ] as Partial<ScheduleItem>[]) {
      expect(keys(edited(deleted, pour.id, change), NOW)['Pour slab']).not.toBe(keys(deleted, NOW)['Pour slab']);
    }
  });

  it('the comparison lists the tasks whose key is the earlier report\'s; none against a report without keys, and none while waiting', () => {
    const { sent, deleted } = oldMasterCase();
    const current = snapshotOf(deleted, NOW);
    const ids = shown(deleted).map(item => item.id).sort();
    expect([...(compareDAVEReportSnapshots({ current, previous: sent }).unchangedTaskIds ?? [])].sort()).toEqual(ids);
    expect(compareDAVEReportSnapshots({ current, previous: withoutContentKeys(sent) }).unchangedTaskIds).toEqual([]);
    expect(reportPeriodWaitingForOtherDevice(compareDAVEReportSnapshots({ current, previous: sent })).unchangedTaskIds).toEqual([]);
    expect(compareDAVEReportSnapshots({ current, previous: null }).unchangedTaskIds).toBeUndefined();
  });
});
