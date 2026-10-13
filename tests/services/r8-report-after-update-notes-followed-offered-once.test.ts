/**
 * R8 item 1 (the coordinator's decision on review pass 2: the keep is taken out).
 *
 * Since schedule batch S5 a task's field notes follow it to the row a newer
 * master schedule gives it, and the first sync on the new build brings them
 * forward for rows made before it. R6 made a report sent on the released
 * build still read "already sent" after that sync, by taking the notes that
 * followed as part of it. Review pass 2 showed what that cost:
 *  - P2-1: a note typed shortly before the master that moved its task was in
 *    NO report of the released build. After the sync the report shown as
 *    "already sent" carried that note's line, which the sent report never had;
 *  - P2-4: the companion rule left such a note out of the first report after
 *    the update, and so of every report, with every clock right.
 *
 * The decision: "this is the report you already sent" must be true to the
 * reader. After that first sync the report says something the sent one did
 * not, so it is another report and is offered once. It lists the notes that
 * followed; one a report had already said before the task moved is said a
 * second time, once. After that one report it stops.
 *
 * The real CSV reader, import merge, the sync's own merge, the shown list,
 * the one report recipe, the report's comparison and the report store.
 * Synthetic data.
 */
import { buildDAVELegacyReportSourceFingerprint, buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, enhanceDAVEReportDraft } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { loadDAVEReportPeriod, saveDAVEReportSnapshot, type DAVEReportSnapshotCloud, type SnapshotStorage } from '../../services/DAVEReportSnapshotStore';
import { reconcileDAVEScheduleRecords, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEWebReportSource, buildDAVEWebReportTruths, daveWebReportSourceIsCurrent } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { approvalReplacesUnsentApproval } from '../../services/ReportManualSend';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ProjectItemActivity, ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const STUB = { id: 'draft', title: '', subject: '', body: '', openingLine: 'OPENING', closingLine: 'CLOSING', locationGroups: [] } as never;
const SCOPE = daveReportSnapshotScopeKey(['Alpha']);
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const master = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined), activity: [],
  } as ScheduleItem));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay: false,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]) as ScheduleItem[],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
const withNotes = (state: State, id: string, notes: ProjectItemActivity[]): State =>
  ({ ...state, items: state.items.map(item => (item.id === id ? { ...item, activity: notes } as ScheduleItem : item)) });
/** He records a percent on the task shown under that name. */
const records = (state: State, name: string, percent: number, at: string): State => ({ ...state, items: state.items.map(item => (item.taskName === name && shown(state).some(row => row.id === item.id)
  ? { ...item, percentComplete: percent, status: 'In Progress', updatedAt: at, progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David' } as ScheduleItem : item)) });
/** The next sync on this build: its own merge over the same rows, local and cloud alike. */
const sync = (state: State): State => ({ items: recoverDAVEScheduleRecords({ local: state.items, cloud: state.items, allowCloudOnly: true }) as ScheduleItem[], documents: state.documents });
const notesOnPaint = (state: State) => ((shown(state).find(item => item.taskName === 'Paint')?.activity ?? []) as ProjectItemActivity[]).map(entry => entry.id);

/** The Reports screen for this saved data and saved period. `asBuild230`: the report is saved under the fingerprint Build 230 wrote (version 1.0). */
function screen(state: State, saved: DAVEReportSnapshot | null, at: string, asBuild230 = false) {
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown(state),
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, projectAreas: [], referenceDocuments: state.documents, now: at,
  });
  const today = buildDAVEReportSourceFingerprint(truths);
  const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(saved, today), scheduleItems: shown(state) });
  const snapshot = buildDAVEReportSnapshot({ truths, scopeKey: SCOPE, sourceFingerprint: asBuild230 ? buildDAVELegacyReportSourceFingerprint(truths) : today, capturedAt: at, reportFormat: 'project_manager' });
  return {
    today,
    text: String(enhanceDAVEReportDraft(STUB, briefing, 'project_manager').body).split('\n'),
    /** The "since the last report" sentences. */
    said: briefing.recentChanges.map(change => String(change.summary)),
    /** Whether the app takes the report on screen for the one already saved: Approve would save nothing. */
    takenForTheSavedReport: Boolean(saved) && reportSnapshotToSave({ ...snapshot, sourceFingerprint: today }, saved) === null,
    anApprovalWaitingIsAnotherReports: saved ? approvalReplacesUnsentApproval({ ...saved, deliveredAt: null } as DAVEReportSnapshot, today) : false,
    sent: () => markReportSnapshotDelivered({ ...(reportSnapshotToSave(snapshot, saved) as DAVEReportSnapshot) }, at, 'phone-install'),
  };
}
const NOTE: ProjectItemActivity = { id: 'note-1', message: 'Primer delivery is a week late.', author: 'David', createdAt: '2026-09-08T17:00:00.000Z' };
const NOTE_LINE = 'Alpha: Paint — Primer delivery is a week late.';
const M1 = ['Paint,Alpha,Lot,10/05/2026,10/09/2026,', 'Drywall,Alpha,Lot,10/01/2026,10/04/2026,'];
const M2 = ['Paint,Alpha,Lot,10/12/2026,10/16/2026,', 'Drywall,Alpha,Lot,10/01/2026,10/04/2026,'];

/**
 * Master 1 lists Paint. Report 0 is sent. A note is typed on Paint (`beforeReportZero`: before that report, which
 * then had it). Master 2 moves Paint; the released build leaves the note on the row Paint had. Report 1 is sent on
 * the released build. Then the update and its first sync, and nothing else.
 */
function theUpdate(beforeReportZero: boolean) {
  const note = beforeReportZero ? { ...NOTE, createdAt: '2026-09-07T17:00:00.000Z' } : NOTE;
  let state = approve({ items: [], documents: [] }, master('MASTER M1', '2026-09-07T16:00:00.000Z'), M1);
  if (beforeReportZero) state = withNotes(state, 'MASTER M1-1', [note]);
  const zero = screen(state, null, '2026-09-07T22:00:00.000Z', true);
  state = withNotes(state, 'MASTER M1-1', [note]);
  state = approve(state, master('MASTER M2', '2026-09-09T16:00:00.000Z'), M2);
  const asTheReleasedBuildLeftIt = withNotes(state, 'MASTER M2-1', []);
  const one = screen(asTheReleasedBuildLeftIt, zero.sent(), '2026-09-10T22:00:00.000Z', true);
  const sent = one.sent();
  const synced = sync(asTheReleasedBuildLeftIt);
  return { zero, one, sent, asTheReleasedBuildLeftIt, synced };
}

describe('R8 item 1: after the update\'s first sync a report sent on the released build is never shown as "already sent" with a line it did not have', () => {
  it('(the rig) the released build\'s report carries its own fingerprint version, said nothing of the note, and the first sync brings the note to Paint\'s row', () => {
    const { one, sent, asTheReleasedBuildLeftIt, synced } = theUpdate(false);
    expect(sent.sourceFingerprint).toMatch(/^dave-report-source\/1\.0:/);
    expect(one.text.filter(line => line.includes(NOTE.message))).toEqual([]);
    expect(notesOnPaint(asTheReleasedBuildLeftIt)).toEqual([]);
    expect(notesOnPaint(synced)).toEqual(['note-1']);
  });

  it('before that sync nothing has changed: it is the report he sent, line for line', () => {
    const { one, sent, asTheReleasedBuildLeftIt } = theUpdate(false);
    const opened = screen(asTheReleasedBuildLeftIt, sent, '2026-09-10T22:20:00.000Z');
    expect(opened.takenForTheSavedReport).toBe(true);
    expect(opened.text).toEqual(one.text);
  });

  it('a note no report had said (typed after report 0, before the master that moved the task): after the sync the report lists it, and is offered as another report', () => {
    const { one, sent, synced } = theUpdate(false);
    const opened = screen(synced, sent, '2026-09-10T22:30:00.000Z');
    expect(opened.text.filter(line => !one.text.includes(line))).toEqual([`• ${NOTE_LINE}`]);
    // (It read "already sent" with that line in it: review pass 2, P2-1.)
    expect(opened.takenForTheSavedReport).toBe(false);
    expect(opened.anApprovalWaitingIsAnotherReports).toBe(true);
    expect(opened.said).toContain(NOTE_LINE);
  });

  it('a note a report had already said before the task moved: the accepted cost, it is offered once more and says that note a second time', () => {
    const { zero, one, sent, synced } = theUpdate(true);
    expect(zero.said).toContain(NOTE_LINE);
    expect(one.said).not.toContain(NOTE_LINE);
    const opened = screen(synced, sent, '2026-09-10T22:30:00.000Z');
    expect(opened.takenForTheSavedReport).toBe(false);
    expect(opened.said).toContain(NOTE_LINE);
  });

  it.each([[false], [true]])('it stops after that one report: once it is sent it reads as sent, and the next report says none of those notes again (note already said before: %s)', beforeReportZero => {
    const { sent, synced } = theUpdate(beforeReportZero);
    const offeredOnce = screen(synced, sent, '2026-09-10T22:30:00.000Z');
    const sentAgain = offeredOnce.sent();
    expect(sentAgain.sourceFingerprint).toMatch(/^dave-report-source\/2\.0:/);
    // Opened again with nothing changed: that report, already sent.
    const reopened = screen(synced, sentAgain, '2026-09-10T23:00:00.000Z');
    expect(reopened.takenForTheSavedReport).toBe(true);
    expect(reopened.text).toEqual(offeredOnce.text);
    // He records a percent; the next report says that, and not the note.
    const next = screen(records(synced, 'Drywall', 40, '2026-09-12T18:00:00.000Z'), sentAgain, '2026-09-12T22:00:00.000Z');
    expect(next.takenForTheSavedReport).toBe(false);
    expect(next.said).toContain('Alpha: Drywall moved from 0% to 40% complete.');
    expect(next.said.filter(line => line.includes(NOTE.message))).toEqual([]);
  });

  it('on the web: a report saved on the released build reads as changed once after that sync, and a report saved after it is current', () => {
    const { asTheReleasedBuildLeftIt, synced } = theUpdate(false);
    const web = (state: State): DAVEWebReadOnlySnapshot => ({
      projects: [{ id: 'project-alpha-id', name: 'Alpha' }], scheduleItems: shown(state), knownScheduleItems: state.items,
      projectUpdates: [], referenceDocuments: state.documents, refreshedAt: '2026-09-10T22:30:00.000Z',
    }) as unknown as DAVEWebReadOnlySnapshot;
    const before = buildDAVEWebReportSource(web(asTheReleasedBuildLeftIt), 'Alpha');
    const savedOnTheReleasedBuild = String(before.fingerprint).replace(/^dave-report-source\/2\.0:[0-9a-f]+/, buildDAVELegacyReportSourceFingerprint(buildDAVEWebReportTruths(web(asTheReleasedBuildLeftIt), 'Alpha')));
    expect(daveWebReportSourceIsCurrent(savedOnTheReleasedBuild, before)).toBe(true);
    const after = buildDAVEWebReportSource(web(synced), 'Alpha');
    expect(daveWebReportSourceIsCurrent(savedOnTheReleasedBuild, after)).toBe(false);
    expect(daveWebReportSourceIsCurrent(after.fingerprint, after)).toBe(true);
  });
});

describe('R8 item 1: a field note that no report has said is said by the first report after the update (review pass 2, P2-4)', () => {
  it('typed after one report and before the master that moved its task; two reports on the released build since, neither said it: report 3 says it', () => {
    let state = approve({ items: [], documents: [] }, master('MASTER M1', '2026-09-07T16:00:00.000Z'), M1);
    const zero = screen(state, null, '2026-09-07T22:00:00.000Z', true);                     // Monday's report
    state = withNotes(state, 'MASTER M1-1', [NOTE]);                                         // Tuesday: the note
    state = approve(state, master('MASTER M2', '2026-09-09T16:00:00.000Z'), M2);             // Wednesday: the master moves Paint
    let released = withNotes(state, 'MASTER M2-1', []);                                      // the released build leaves the note behind
    const one = screen(released, zero.sent(), '2026-09-10T22:00:00.000Z', true);
    released = records(released, 'Drywall', 20, '2026-09-11T18:00:00.000Z');
    const two = screen(released, one.sent(), '2026-09-11T22:00:00.000Z', true);
    const after = records(sync(released), 'Drywall', 40, '2026-09-12T18:00:00.000Z');       // the update, its first sync, one more percent
    expect(notesOnPaint(after)).toEqual(['note-1']);
    const three = screen(after, two.sent(), '2026-09-12T22:00:00.000Z');
    const ofTheNote = (said: string[]) => said.filter(line => line.includes(NOTE.message));
    expect([zero, one, two].map(report => ofTheNote(report.said))).toEqual([[], [], []]);
    // (Report 3 said only the percent: no report ever said the note.)
    expect(ofTheNote(three.said)).toEqual([NOTE_LINE]);
    expect(three.said).toContain('Alpha: Drywall moved from 20% to 40% complete.');
  });

  it('typed on the iPad an hour before a report the phone made without it, and received afterwards: no report has said it, so the next one does', () => {
    const typedBefore = { ...NOTE, createdAt: '2026-09-07T21:00:00.000Z' };
    let state = approve({ items: [], documents: [] }, master('MASTER M1', '2026-09-07T16:00:00.000Z'), M1);
    const one = screen(state, null, '2026-09-07T22:00:00.000Z', true);                      // made without the note
    state = withNotes(state, 'MASTER M1-1', [typedBefore]);                                  // it arrives
    state = approve(state, master('MASTER M2', '2026-09-09T16:00:00.000Z'), M2);
    const released = withNotes(state, 'MASTER M2-1', []);
    const two = screen(released, one.sent(), '2026-09-10T22:00:00.000Z', true);
    const three = screen(records(sync(released), 'Drywall', 40, '2026-09-12T18:00:00.000Z'), two.sent(), '2026-09-12T22:00:00.000Z');
    expect(three.said.filter(line => line.includes(NOTE.message))).toEqual([NOTE_LINE]);
  });
});

describe('R8 item 1: nothing of the keep is left on the device', () => {
  it('a list an earlier test build kept in the device\'s storage is neither read nor written, and a saved period loads as it was saved', async () => {
    const { sent } = theUpdate(false);
    const kept = new Map<string, string>([['@vitruvius/report-snapshots/known-as/v1', JSON.stringify([[sent.sourceFingerprint, 'dave-report-source/2.0:0a0a0a0a', 'a-notes-key']])]]);
    const asked: string[] = [];
    const storage: SnapshotStorage = { getItem: async key => { asked.push(key); return kept.get(key) ?? null; }, setItem: async (key, value) => { asked.push(key); kept.set(key, value); } };
    const shared: { row: unknown } = { row: null };
    const cloud: DAVEReportSnapshotCloud = { read: async () => ({ ownerId: 'owner-1', snapshot: shared.row }), write: async snapshot => { shared.row = JSON.parse(JSON.stringify(snapshot)); return undefined as never; } };
    await saveDAVEReportSnapshot(sent, storage, cloud);
    const period = (await loadDAVEReportPeriod(SCOPE, 'project_manager', storage, cloud)).snapshot as DAVEReportSnapshot;
    expect(period.sourceFingerprint).toBe(sent.sourceFingerprint);
    expect(asked.filter(key => key.includes('known-as'))).toEqual([]);
  });
});
