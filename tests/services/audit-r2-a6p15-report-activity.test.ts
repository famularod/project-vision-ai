/**
 * Audit round 2, A6 pass 15 (1 Oct 2026): two Low findings in the client
 * report's "since the last report" section, both from the activity keys
 * 0686c08 (A6 pass 14 L2) saved per task.
 *
 * L1: master F is current; on Sep 20 David notes Pour slab "Forms set, pour
 * Friday." A report goes out on Sep 21. Master M moves Pour slab onto a new
 * row and a report goes out on Sep 26. David goes back to F (Set Active F, or
 * Delete PDF + Items on M and then Set Active F). The next report paired F's
 * row with M's row through M's earlier ids; M's row had no note, so the keys
 * differed and the old note was said again as new. Activity keys are now
 * compared only for the same row; rows paired across a master change keep
 * the time rule (a hidden row cannot be given a note).
 *
 * The scenarios run through the real import, Set Active, delete helper,
 * Project Truth and both report formats, as in audit-r2-a6p14-report-lows.
 * Synthetic data.
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

const BASELINE_SENT = '2026-09-15T18:00:00.000Z';
const NOTE_AT = '2026-09-20T15:00:00.000Z';
const FIRST_SENT = '2026-09-21T18:00:00.000Z';
const SECOND_SENT = '2026-09-26T18:00:00.000Z';
const DELETED_AT = '2026-09-27T12:00:00.000Z';
const SET_ACTIVE_AT = '2026-09-27T18:00:00.000Z';
const NOW = '2026-09-30T15:00:00.000Z';

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const F = schedule('MASTER F', '2026-08-31T12:00:00.000Z');
const M = schedule('MASTER M', '2026-09-26T08:00:00.000Z');
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
/** Set Active (App.tsx activateReferenceDocument): the documents, and the progress carried to the tasks now shown. */
function setActive(state: State, document: ReferenceDocument, now = SET_ACTIVE_AT): State {
  const target = state.documents.find(saved => saved.id === document.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(target, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
/** "Delete PDF + Items": the shared delete helper the phone and the web run, stamping the tasks it writes ids onto. */
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
/** A change saved on one task, stamped when it was made (on whichever device). */
const edited = (state: State, id: string, change: Partial<ScheduleItem>, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? { ...item, ...change, updatedAt: at } as ScheduleItem : item),
});
type Note = { id: string; message: string; author: string; createdAt: string };
const noteOf = (id: string, message: string, createdAt: string): Note => ({ id, message, author: 'David', createdAt });
/** David adds a note to a task (on whichever device), stamped when he made it. */
const noted = (state: State, id: string, added: Note): State =>
  edited(state, id, { activity: [...(byId(state, id).activity ?? []), added] } as Partial<ScheduleItem>, added.createdAt);

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
/** A report saved by a build before the activity keys (a1d5e2f's build and older). */
const withoutActivityKeys = (snapshot: DAVEReportSnapshot): DAVEReportSnapshot => ({
  ...snapshot,
  tasks: snapshot.tasks.map(task => {
    const { activityKey: _key, ...older } = task as typeof task & { activityKey?: string };
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
function sinceLines(state: State, previous: DAVEReportSnapshot | null, now = NOW) {
  const briefing = buildDAVEReportBriefing({ truths: [truthOf(state, now)], selectedProjectNames: ['Alpha'], previousSnapshot: previous });
  const [pm, executive] = (['project_manager', 'executive'] as const).map(format => {
    const body = enhanceDAVEReportDraft(draft, briefing, format).body;
    const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
    return body.slice(start, body.indexOf('COMPLETED WORK', start)).split('\n').filter(line => line.startsWith('• '));
  });
  expect(executive).toEqual(pm);
  return pm;
}
const NOTHING_CHANGED = '• +0 completed; +0 open; +0 overdue.';
const FORMS_SET = '• Alpha: Pour slab — Forms set, pour Friday.';
const pourLines = (lines: readonly string[]) => lines.filter(line => line.includes('Pour slab'));

describe('A6 p15 L1: going back to an older master does not repeat an old note as new', () => {
  /**
   * F current; David notes Pour slab on Sep 20 and a report says it on Sep 21. Master M moves Pour slab
   * onto a new row (its earlier ids name F's row) and a report goes out on Sep 26.
   */
  function revertCase() {
    const onF = approve({ items: [], documents: [] }, F, rows(F, [
      'Pour slab,Alpha,Lot,10/01/2026,10/05/2026,0%',
      'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%',
    ]));
    const fPour = named(shown(onF), 'Pour slab')[0];
    const baseline = snapshotOf(onF, BASELINE_SENT);
    const withNote = noted(onF, fPour.id, noteOf('n1', 'Forms set, pour Friday.', NOTE_AT));
    // The Sep 21 report says the note.
    expect(sinceLines(withNote, baseline, FIRST_SENT)).toEqual([NOTHING_CHANGED, FORMS_SET]);
    const first = snapshotOf(withNote, FIRST_SENT);
    const onM = approve(withNote, M, rows(M, [
      'Pour slab,Alpha,Lot,10/02/2026,10/06/2026,0%',
      'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%',
    ]));
    const mPour = named(shown(onM), 'Pour slab')[0];
    expect(mPour.id).not.toBe(fPour.id);
    expect(mPour.revisedFromTaskIds).toEqual([fPour.id]);
    expect(mPour.activity ?? []).toEqual([]);
    // The Sep 26 report: the finish change, and not the note again.
    expect(pourLines(sinceLines(onM, first, SECOND_SENT))).toEqual(['• Alpha: Pour slab finish changed from 10/05/2026 to 10/06/2026.']);
    const second = snapshotOf(onM, SECOND_SENT);
    return { onM, fPour, mPour, second };
  }
  const BACK_TO_F = ['• Alpha: Pour slab finish changed from 10/06/2026 to 10/05/2026.'];

  it('the reviewer\'s case, Set Active F: the next report gives the finish change only, as at fe9cbc6', () => {
    const { onM, fPour, second } = revertCase();
    const backOnF = setActive(onM, F);
    expect(named(shown(backOnF), 'Pour slab').map(item => item.id)).toEqual([fPour.id]);
    expect(sinceLines(backOnF, second)).toEqual([NOTHING_CHANGED, ...BACK_TO_F]);
  });

  it('Delete PDF + Items on M, then Set Active F: the finish change only', () => {
    const { onM, fPour, mPour, second } = revertCase();
    const deleted = deleteWithItems(onM, M);
    expect(deleted.removed.map(item => item.id)).toEqual([mPour.id]);
    const backOnF = setActive(deleted, F);
    expect(named(shown(backOnF), 'Pour slab').map(item => item.id)).toEqual([fPour.id]);
    expect(sinceLines(backOnF, second)).toEqual([NOTHING_CHANGED, ...BACK_TO_F]);
  });

  it('a note David adds back on F after the Sep 26 report is said', () => {
    const { onM, fPour, second } = revertCase();
    const backOnF = noted(setActive(onM, F), fPour.id, noteOf('n2', 'Pour moved to Monday.', '2026-09-29T09:00:00.000Z'));
    expect(pourLines(sinceLines(backOnF, second))).toEqual([...BACK_TO_F, '• Alpha: Pour slab — Pour moved to Monday.']);
  });

  it('a report saved before the activity keys gives the same', () => {
    const { onM, second } = revertCase();
    expect(sinceLines(setActive(onM, F), withoutActivityKeys(second))).toEqual([NOTHING_CHANGED, ...BACK_TO_F]);
  });

  it('the comparison lists a row against a different row of the earlier report in neither activity list; the same row still is', () => {
    const { onM, fPour, second } = revertCase();
    const backOnF = setActive(onM, F);
    const period = compareDAVEReportSnapshots({ current: snapshotOf(backOnF, NOW), previous: second });
    expect(period.newActivityTaskIds).not.toContain(fPour.id);
    expect(period.sameActivityTaskIds).not.toContain(fPour.id);
    const framing = named(shown(backOnF), 'Framing')[0];
    expect(second.tasks.map(task => task.taskId)).toContain(framing.id);
    expect(period.sameActivityTaskIds).toContain(framing.id);
  });
});
