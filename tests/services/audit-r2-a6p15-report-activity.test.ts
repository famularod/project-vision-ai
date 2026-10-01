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
 * L2: Pour slab had two notes, N1 (Sep 20, said earlier) and N2 (Sep 28),
 * and a report with N2 went out. The row's notes then came from the other
 * device's copy, which never had N2 (the sync merge takes the newest copy's
 * row, or Keep Cloud). N1 was the latest again, its key differed from N2's,
 * and the next report said "Pour slab — Forms set, pour Friday." again
 * (before 0686c08: "Pour slab was updated."). Each saved report now also
 * keeps the latest activity's time (never its text); against a row that
 * saved one, an activity is said only when it is newer than that time. The
 * iPad's late note (made before the send, after the saved activity) is still
 * said. A row saved with no time keeps 0686c08's rule.
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
import { recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
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

describe('A6 p15 L2: a latest note lost to the other device\'s copy does not bring back the older one', () => {
  const N2_AT = '2026-09-28T16:00:00.000Z';
  /** The iPad, offline, the afternoon the phone sends the report. */
  const IPAD_NOTE_AT = '2026-09-28T17:00:00.000Z';
  const SENT = '2026-09-28T18:00:00.000Z';
  const IPAD_EDIT_AT = '2026-09-29T16:00:00.000Z';
  const PUMP_TRUCK = '• Alpha: Pour slab — Pump truck booked for Friday.';
  /** A report saved by 0686c08's build: activity keys, but no activity times. */
  const withoutActivityTimes = (snapshot: DAVEReportSnapshot): DAVEReportSnapshot => ({
    ...snapshot,
    tasks: snapshot.tasks.map(task => {
      const { activityAt: _at, ...older } = task as typeof task & { activityAt?: string };
      return older;
    }),
  });

  /**
   * Both devices have N1 (Sep 20). On the phone David adds N2 (Sep 28 16:00) and sends a report with it at
   * 18:00. The iPad never received N2; on Sep 29 David moves Pour slab's start there.
   */
  function lostNoteCase() {
    const onF = approve({ items: [], documents: [] }, F, rows(F, [
      'Pour slab,Alpha,Lot,10/01/2026,10/05/2026,0%',
      'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%',
    ]));
    const pour = named(shown(onF), 'Pour slab')[0];
    const both = noted(onF, pour.id, noteOf('n1', 'Forms set, pour Friday.', NOTE_AT));
    const phone = noted(both, pour.id, noteOf('n2', 'Pump truck booked for Friday.', N2_AT));
    // The report that includes N2.
    expect(sinceLines(phone, snapshotOf(both, FIRST_SENT), SENT)).toEqual([NOTHING_CHANGED, PUMP_TRUCK]);
    const sent = snapshotOf(phone, SENT);
    const ipad = edited(both, pour.id, { startDate: '10/02/2026' }, IPAD_EDIT_AT);
    return { both, pour, phone, ipad, sent };
  }
  const notesOf = (state: State, id: string) => (byId(state, id).activity ?? []).map(entry => entry.message);

  it('the reviewer\'s case, the sync merge: the next report reads "Pour slab was updated.", not N1 again', () => {
    const { pour, phone, ipad, sent } = lostNoteCase();
    const merged: State = { ...phone, items: recoverDAVEScheduleRecords({ local: phone.items, cloud: ipad.items, allowCloudOnly: true }) };
    expect(notesOf(merged, pour.id)).toEqual(['Forms set, pour Friday.']);
    expect(sinceLines(merged, sent)).toEqual([NOTHING_CHANGED, '• Alpha: Pour slab was updated.']);
  });

  it('Keep Cloud (the cloud\'s copy of the row replaces the phone\'s): the same', () => {
    const { pour, phone, ipad, sent } = lostNoteCase();
    const keptCloud: State = { ...phone, items: phone.items.map(item => item.id === pour.id ? byId(ipad, pour.id) : item) };
    expect(notesOf(keptCloud, pour.id)).toEqual(['Forms set, pour Friday.']);
    expect(sinceLines(keptCloud, sent)).toEqual([NOTHING_CHANGED, '• Alpha: Pour slab was updated.']);
  });

  it('a note newer than the one the earlier report saved is said, after the loss too', () => {
    const { pour, phone, ipad, sent } = lostNoteCase();
    const merged: State = { ...phone, items: recoverDAVEScheduleRecords({ local: phone.items, cloud: ipad.items, allowCloudOnly: true }) };
    const later = noted(merged, pour.id, noteOf('n3', 'Pour moved to Monday.', '2026-09-30T09:00:00.000Z'));
    expect(pourLines(sinceLines(later, sent))).toEqual(['• Alpha: Pour slab — Pour moved to Monday.']);
  });

  it('the iPad\'s late note (before the send, after the activity the report saved) is still said', () => {
    const { both, pour } = lostNoteCase();
    const sent = snapshotOf(both, SENT);
    expect(sent.tasks.find(task => task.taskId === pour.id)?.activityAt).toBe(NOTE_AT);
    const received = noted(both, pour.id, noteOf('ipad-1', 'Pump truck booked for Friday.', IPAD_NOTE_AT));
    expect(sinceLines(received, sent)).toEqual([NOTHING_CHANGED, PUMP_TRUCK]);
    // With a later hand edit, too.
    expect(pourLines(sinceLines(edited(received, pour.id, { startDate: '10/02/2026' }, IPAD_EDIT_AT), sent))).toEqual([PUMP_TRUCK]);
  });

  it('a different latest activity at the same time as the saved one is not new', () => {
    const { both, pour, sent } = lostNoteCase();
    const sameTime = noted(both, pour.id, noteOf('n2b', 'Pump truck on standby.', N2_AT));
    const period = compareDAVEReportSnapshots({ current: snapshotOf(sameTime, NOW), previous: sent });
    expect(period.newActivityTaskIds).toEqual([]);
    expect(period.sameActivityTaskIds).toContain(pour.id);
    expect(sinceLines(sameTime, sent)).toEqual([NOTHING_CHANGED]);
  });

  it('a report saved by 0686c08 (keys, no times) keeps its rule; one saved before the keys goes by time', () => {
    const { both, pour, phone, ipad, sent } = lostNoteCase();
    const keysOnly = withoutActivityTimes(sent);
    // The late note is said.
    const received = noted(both, pour.id, noteOf('ipad-1', 'Pump truck booked for Friday.', IPAD_NOTE_AT));
    expect(sinceLines(received, withoutActivityTimes(snapshotOf(both, SENT)))).toEqual([NOTHING_CHANGED, PUMP_TRUCK]);
    // With no saved time there is nothing to tell an older note by: 0686c08's rule says it.
    const merged: State = { ...phone, items: recoverDAVEScheduleRecords({ local: phone.items, cloud: ipad.items, allowCloudOnly: true }) };
    expect(pourLines(sinceLines(merged, keysOnly))).toEqual([FORMS_SET]);
    expect(pourLines(sinceLines(merged, withoutActivityKeys(keysOnly)))).toEqual(['• Alpha: Pour slab was updated.']);
  });

  it('the snapshot keeps the latest activity\'s time only, never its text; the version and fingerprint stay', () => {
    const { pour, phone, sent } = lostNoteCase();
    const saved = sent.tasks.find(task => task.taskId === pour.id)!;
    expect(saved.activityAt).toBe(N2_AT);
    expect(saved.activityKey).toMatch(/^task-activity\/1:[0-9a-f]{8}$/);
    const framing = sent.tasks.find(task => task.taskName === 'Framing')!;
    expect('activityAt' in framing).toBe(false);
    expect(JSON.stringify(sent)).not.toContain('Pump truck');
    expect(JSON.stringify(sent)).not.toContain('Forms set');
    expect(sent.version).toBe('dave-report-snapshot/1.0');
    // The fingerprint comes from Project Truth, which this does not touch.
    expect(sent.sourceFingerprint).toBe(buildDAVEReportSourceFingerprint([truthOf(phone, SENT)]));
  });
});
