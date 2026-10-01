/**
 * Audit round 2, A6 pass 14 (1 Oct 2026): three Low findings in the client
 * report's "since the last report" section and in "Delete PDF + Items".
 *
 * L2: a note David made on the iPad while offline, before the phone sent a
 * report, reached the phone the next day. a1d5e2f says an activity line only
 * when the activity's time falls after the earlier report, so the note was
 * never said, and a later hand edit read "Pour slab was updated." instead.
 * Each saved report now keeps each task's latest activity as a short key, and
 * a task whose latest activity is not the one the earlier report saved says
 * it, whatever its time. A report saved before these keys keeps the time rule.
 *
 * The scenarios run through the real import, delete helper, Project Truth and
 * report text, as in audit-r2-a6p13-updated-line-by-content. Synthetic data.
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
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

const OLD_NOTE_AT = '2026-09-27T20:00:00.000Z';
/** The iPad, offline, the afternoon the phone sends the report. */
const IPAD_NOTE_AT = '2026-09-28T17:00:00.000Z';
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
const edited = (state: State, id: string, change: Partial<ScheduleItem>, at = EDITED_AT): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? { ...item, ...change, updatedAt: at } as ScheduleItem : item),
});
const note = (id: string, message: string, createdAt: string) => ({ activity: [{ id, message, author: 'David', createdAt }] }) as Partial<ScheduleItem>;

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
/** A report saved by a build before the activity keys (e931ea7 and a1d5e2f's builds). */
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
const pourLines = (lines: readonly string[]) => lines.filter(line => line.includes('Pour slab'));
const PUMP_TRUCK = '• Alpha: Pour slab — Pump truck booked for Friday.';

/** Master F, current: Pour slab and Framing. */
function onF(): State {
  return approve({ items: [], documents: [] }, F, rows(F, [
    'Pour slab,Alpha,Lot,10/01/2026,10/05/2026,0%',
    'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%',
  ]));
}

/** Master F, then master M moves three tasks; M's rows were saved before the import kept earlier ids (as in p13). */
function oldMasterCase() {
  const names = ['Pour slab', 'Framing', 'Roof deck'];
  const fLines = names.map((name, index) => `${name},Alpha,Lot,10/${String(index + 1).padStart(2, '0')}/2026,10/${String(index + 10).padStart(2, '0')}/2026,0%`);
  const mLines = names.map((name, index) => `${name},Alpha,Lot,10/${String(index + 2).padStart(2, '0')}/2026,10/${String(index + 11).padStart(2, '0')}/2026,0%`);
  const withF = approve({ items: [], documents: [] }, F, rows(F, [...fLines, 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%']));
  const withM = approve(withF, M, rows(M, [...mLines, 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%']));
  return { ...withM, items: withM.items.map(({ revisedFromTaskIds: _earlier, ...item }) => item as ScheduleItem) } as State;
}

describe('A6 p14 L2: a note made on the other device before the report, received after it, is said', () => {
  /** The phone sends at 18:00 without the iPad's 17:00 note; the next day the note arrives (stamped 17:00 by the iPad). */
  function lateNoteCase() {
    const before = onF();
    const pour = named(shown(before), 'Pour slab')[0];
    const sent = snapshotOf(before, REPORT_SENT);
    const received = edited(before, pour.id, note('ipad-1', 'Pump truck booked for Friday.', IPAD_NOTE_AT), IPAD_NOTE_AT);
    return { before, pour, sent, received };
  }

  it('with no later edit: the note is said (it never was, before or after a1d5e2f)', () => {
    const { sent, received } = lateNoteCase();
    expect(sinceLines(received, sent)).toEqual([...NOTHING_CHANGED, PUMP_TRUCK]);
  });

  it('with a later hand edit to the start date: the note is said, not "Pour slab was updated." (as before a1d5e2f)', () => {
    const { pour, sent, received } = lateNoteCase();
    const moved = edited(received, pour.id, { startDate: '10/02/2026' });
    expect(pourLines(sinceLines(moved, sent))).toEqual([PUMP_TRUCK]);
  });

  it('a note the earlier report already had is not said again, even when its device\'s clock put it after the report', () => {
    const before = onF();
    const pour = named(shown(before), 'Pour slab')[0];
    const AHEAD = '2026-09-28T18:30:00.000Z';
    const noted = edited(before, pour.id, note('ipad-2', 'Pump truck booked for Friday.', AHEAD), AHEAD);
    const sent = snapshotOf(noted, REPORT_SENT);
    expect(sinceLines(noted, sent)).toEqual(NOTHING_CHANGED);
    // A report saved before the activity keys goes by the time, as before.
    expect(pourLines(sinceLines(noted, withoutActivityKeys(sent)))).toEqual([PUMP_TRUCK]);
  });

  it('a newer note than the one the earlier report had is said; the older one is not repeated', () => {
    const before = onF();
    const pour = named(shown(before), 'Pour slab')[0];
    const phoneNote = edited(before, pour.id, note('phone-1', 'Forms set.', '2026-09-28T16:00:00.000Z'), '2026-09-28T16:00:00.000Z');
    const sent = snapshotOf(phoneNote, REPORT_SENT);
    expect(sinceLines(phoneNote, sent)).toEqual(NOTHING_CHANGED);
    const both = edited(phoneNote, pour.id, {
      activity: [...(byId(phoneNote, pour.id).activity ?? []), { id: 'ipad-1', message: 'Pump truck booked for Friday.', author: 'David', createdAt: IPAD_NOTE_AT }],
    } as Partial<ScheduleItem>, IPAD_NOTE_AT);
    expect(sinceLines(both, sent)).toEqual([...NOTHING_CHANGED, PUMP_TRUCK]);
  });

  it('a delete\'s stamp still does not repeat an old note (a1d5e2f), and a late note survives the stamp', () => {
    const before = oldMasterCase();
    const pour = named(shown(before), 'Pour slab')[0];
    const noted = edited(before, pour.id, note('a0', 'Forms set.', OLD_NOTE_AT), OLD_NOTE_AT);
    const sent = snapshotOf(noted, REPORT_SENT);
    const deleted = deleteWithItems(noted, F);
    expect(byId(deleted, pour.id).updatedAt).toBe(DELETED_AT);
    expect(sinceLines(deleted, sent)).toEqual(NOTHING_CHANGED);
    expect(pourLines(sinceLines(edited(deleted, pour.id, { startDate: '10/04/2026' }), sent))).toEqual(['• Alpha: Pour slab was updated.']);
    // The iPad's late note, received after the delete: said once.
    const late = edited(deleted, pour.id, {
      activity: [...(byId(deleted, pour.id).activity ?? []), { id: 'ipad-1', message: 'Pump truck booked for Friday.', author: 'David', createdAt: IPAD_NOTE_AT }],
    } as Partial<ScheduleItem>, IPAD_NOTE_AT);
    expect(sinceLines(late, sent)).toEqual([...NOTHING_CHANGED, PUMP_TRUCK]);
  });

  it('a report saved before the activity keys behaves as before: by the time of the activity', () => {
    const { pour, sent, received } = lateNoteCase();
    const older = withoutActivityKeys(sent);
    expect(sinceLines(received, older)).toEqual(NOTHING_CHANGED);
    expect(pourLines(sinceLines(edited(received, pour.id, { startDate: '10/02/2026' }), older))).toEqual(['• Alpha: Pour slab was updated.']);
    // A note after the report is said, as before.
    const after = edited(received, pour.id, note('ipad-3', 'Rebar inspection passed.', EDITED_AT));
    expect(pourLines(sinceLines(after, older))).toEqual(['• Alpha: Pour slab — Rebar inspection passed.']);
  });

  it('the first report (no earlier one) is unchanged', () => {
    const { received } = lateNoteCase();
    expect(sinceLines(received, null)).toEqual(['• This approval establishes the baseline for the next reporting period.']);
  });

  it('the comparison names the tasks with a new latest activity; none against an older report, none while waiting', () => {
    const { pour, sent, received } = lateNoteCase();
    const current = snapshotOf(received, NOW);
    const period = compareDAVEReportSnapshots({ current, previous: sent });
    expect(period.newActivityTaskIds).toEqual([pour.id]);
    expect(compareDAVEReportSnapshots({ current: snapshotOf(lateNoteCase().before, NOW), previous: sent }).newActivityTaskIds).toEqual([]);
    expect(compareDAVEReportSnapshots({ current, previous: withoutActivityKeys(sent) }).newActivityTaskIds).toEqual([]);
    expect(reportPeriodWaitingForOtherDevice(period).newActivityTaskIds).toEqual([]);
    expect(compareDAVEReportSnapshots({ current, previous: null }).newActivityTaskIds).toBeUndefined();
    // The key is short and never the note's text.
    const key = current.tasks.find(task => task.taskId === pour.id)?.activityKey;
    expect(key).toMatch(/^task-activity\/1:[0-9a-f]{8}$/);
    expect(JSON.stringify(current)).not.toContain('Pump truck');
  });

  it('leaves the snapshot version, the content keys and the report fingerprint as they were (values from 3a1faaa)', () => {
    const { received } = lateNoteCase();
    const snapshot = snapshotOf(received, NOW);
    expect(snapshot.version).toBe('dave-report-snapshot/1.0');
    expect(snapshot.tasks.map(task => [task.taskName, task.contentKey]))
      .toEqual([['Framing', 'task-content/1:03e0aa72'], ['Pour slab', 'task-content/1:3cf9048f']]);
    expect(buildDAVEReportSourceFingerprint([truthOf(received, NOW)])).toBe('dave-report-source/1.0:4678986f');
  });
});
