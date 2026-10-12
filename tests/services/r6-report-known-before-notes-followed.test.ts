/**
 * R6 item 1 (the coordinator's decisions on R5's finding and on review pass
 * 1): a report made before a task's notes followed it is still known after
 * they do.
 *
 * Since schedule batch S5 a task's activity notes follow it from row to row:
 * when a newer master moves a task, the row it gives the task takes the notes
 * of the row it replaces. Rows made by the build before did not have them: the
 * notes stayed on the hidden old row. The first sync on the new build brings
 * them forward, and the task's latest note (its time and its text) is a fact
 * of a report. So after that sync every report approved, sent or saved before
 * the update, for a project with such a task, was a report "of other facts":
 * the approval asked to be given again, the sent report was no longer read as
 * sent, the other device waited for a download, the web called a saved report
 * out of date (689 of 1,868 report points on the reviewer's sequences).
 *
 * Beside today's fingerprint the app now works out the 1.0 fingerprint of the
 * same facts as they were before the notes followed (every report a released
 * build made carries a 1.0 fingerprint) and keeps it as one more name of
 * those facts. A name that leaves something out goes on matching when that
 * something changes, so it is never taken alone: the first time this device
 * recognises a saved report it keeps beside it, on this device only, today's
 * full fingerprint and a key of the notes on the tasks' earlier rows, and from
 * then on the report is held to those notes. No clock decides anything.
 *
 * The real CSV reader, the phone's import review and approval, the sync's own
 * merge, the shown list, the one report recipe (phone and web), the report
 * store over a storage of the test's. Synthetic data.
 */
import { scheduleImportPairingChosen, scheduleImportPairingGuess, withScheduleImportPairingChoices } from '../../components/schedule-import-pairing-check';
import { buildDAVELegacyReportSourceFingerprint, buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { daveProjectTruthAsBuilt } from '../../services/DAVEProjectTruth';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, forgetReportSourcesKnownAs, markReportSnapshotDelivered, otherDeviceSendNotReceived,
  reportBaselineSnapshot, reportSnapshotToSave, reportSourceKnownAs, reportSourcesBeforeNotesFollowedOf, sameReportSource, validReportPeriodSnapshot, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { loadDAVEReportPeriod, saveDAVEReportSnapshot, type DAVEReportSnapshotCloud, type SnapshotStorage } from '../../services/DAVEReportSnapshotStore';
import { reconcileDAVEScheduleRecords, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEWebReportDraft, buildDAVEWebReportSource, buildDAVEWebReportTruths, daveWebReportSourceIsCurrent } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebReportAlreadySentElsewhereAt } from '../../services/DAVEWebReportPeriod';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { approvalReplacesUnsentApproval } from '../../services/ReportManualSend';
import { mergeApprovedScheduleImportItems, scheduleImportReviewPairingQuestions, scheduleItemsVisibleBeforeImport, type ScheduleImportPairingQuestion } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ProjectItemActivity, ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const HEADER = 'Task,Project,Area,Start,Finish,Percent Complete';

/** The approval as the phone makes it: the review's questions confirmed as guessed, then the merge. */
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const imported = (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined),
  }));
  const questions = scheduleImportReviewPairingQuestions({ saved: state.items, documents: state.documents, importBatchId: source.importBatchId || '', imported, overlay: false });
  const answerOf = (question: ScheduleImportPairingQuestion) => {
    let answer = scheduleImportPairingGuess(question);
    question.saved.forEach(item => { answer = scheduleImportPairingChosen(answer, item.id, question.rows[0].id); });
    return { ...answer, confirmed: true };
  };
  const { pairingChoices } = withScheduleImportPairingChoices({ pairingChoices: null }, questions, answerOf);
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay: false, pairingChoices,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]) as ScheduleItem[],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
const one = (state: State, name: string) => shown(state).filter(item => item.taskName === name);
/** A note on a saved row, shown or hidden, as the task card saves it. */
const withNote = (state: State, rowId: string, note: ProjectItemActivity): State => ({
  ...state,
  items: state.items.map(item => (item.id === rowId ? { ...item, activity: [...(item.activity ?? []), note] } as ScheduleItem : item)),
});
const note = (id: string, message: string, createdAt: string): ProjectItemActivity => ({ id, message, author: 'David', createdAt });
/** The next sync on this build: its own merge over the saved rows, the device's and the cloud's alike. */
const sync = (state: State): State => ({ ...state, items: recoverDAVEScheduleRecords({ local: state.items, cloud: state.items, allowCloudOnly: true }) as ScheduleItem[] });
/** He sets a percent on the task shown under that name. */
const setPercent = (state: State, name: string, percentComplete: number, at: string): State => {
  const id = one(state, name)[0].id;
  return { ...state, items: state.items.map(item => (item.id === id ? {
    ...item, percentComplete, status: percentComplete >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
  } as ScheduleItem : item)) };
};
const notesOf = (state: State, rowId: string) => (state.items.find(item => item.id === rowId)?.activity ?? []).map(entry => entry.id);

const SCOPE = daveReportSnapshotScopeKey(['Alpha']);
/** The phone's Reports screen recipe (screens/ReportsScreen.tsx), with the clock given. */
const phoneTruths = (state: State, now: string) => buildDAVEReportProjectTruths({
  projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown(state),
  knownScheduleItems: state.items, knownScheduleDocuments: state.documents, projectAreas: [], referenceDocuments: state.documents, now,
});
/** What the web has downloaded of the same data (services/DAVEWebOperations.ts). */
const webSnapshot = (state: State, now: string): DAVEWebReadOnlySnapshot => ({
  projects: [{ id: '5f0c2a9e-1b1d-4c55-9a53-0d6f2c7c1a10', name: 'Alpha' }], scheduleItems: shown(state), knownScheduleItems: state.items,
  projectUpdates: [], referenceDocuments: state.documents, refreshedAt: now,
}) as unknown as DAVEWebReadOnlySnapshot;
const fingerprints = (state: State, now: string) => {
  const truths = phoneTruths(state, now);
  return { truths, today: buildDAVEReportSourceFingerprint(truths), earlierVersion: buildDAVELegacyReportSourceFingerprint(truths) };
};
/** A report approved with these facts, as the period then holds it; `fingerprint` as the build that made it wrote it. */
const approved = (state: State, now: string, fingerprint: string, known: DAVEReportSnapshot | null = null) => {
  const snapshot = buildDAVEReportSnapshot({ truths: phoneTruths(state, now), scopeKey: SCOPE, sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' });
  return { ...(reportSnapshotToSave(snapshot, known) ?? snapshot), deliveredAt: null } as DAVEReportSnapshot;
};
/** The saved period as the app holds it after it is opened again: read from its storage, or from the shared record. */
const readFromStorage = (saved: DAVEReportSnapshot) => validReportPeriodSnapshot(JSON.parse(JSON.stringify(saved)), SCOPE, 'project_manager') as DAVEReportSnapshot;
// Nothing recognised in one case is remembered in the next (each is its own device, just updated).
beforeEach(() => forgetReportSourcesKnownAs());
/** The report as the phone writes it against the period saved: its lines of recent changes, and the tasks whose latest note it counts as new. */
const reportOf = (state: State, known: DAVEReportSnapshot | null, now: string) => {
  const truths = phoneTruths(state, now);
  const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, buildDAVEReportSourceFingerprint(truths)), scheduleItems: shown(state) });
  return { lines: briefing.recentChanges.map(change => change.summary), newNotes: [...(briefing.reportingPeriod.newActivityTaskIds ?? [])] };
};

const OTHERS = ['Framing,Alpha,Lot,11/01/2026,11/03/2026,', 'Drywall,Alpha,Lot,11/02/2026,11/04/2026,'];
const INSPECTOR = note('note-1', 'Inspector called.', '2026-09-08T09:00:00.000Z');
const CREW = note('note-2', 'Crew short Tuesday.', '2026-09-08T11:00:00.000Z');
const REPORT_MADE = '2026-09-10T15:00:00.000Z';
const NOW = '2026-09-11T08:00:00.000Z';

/**
 * As the build before left it: master 1 lists Paint and he types two notes on it; master 2 moves Paint to other
 * days, on a new row that answers to the first. That build left the notes on the hidden old row.
 */
function beforeTheUpdate(): State {
  let state = approve({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/01/2026,10/05/2026,']);
  state = approve(state, schedule('MASTER 2', '2026-09-09T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/03/2026,10/07/2026,']);
  expect(one(state, 'Paint').map(item => [item.id, item.revisedFromTaskIds])).toEqual([['MASTER 2-3', ['MASTER 1-3']]]);
  state = withNote(withNote(state, 'MASTER 1-3', INSPECTOR), 'MASTER 1-3', CREW);
  expect([notesOf(state, 'MASTER 1-3'), notesOf(state, 'MASTER 2-3')]).toEqual([['note-1', 'note-2'], []]);
  return state;
}

describe('R6 item 1: what the first sync on this build does to a report\'s facts', () => {
  it('the task\'s notes follow it to the row shown, and the report\'s fingerprint moves with its latest note alone', () => {
    const before = beforeTheUpdate();
    const after = sync(before);
    expect(notesOf(after, 'MASTER 2-3')).toEqual(['note-1', 'note-2']);
    const taskOf = (state: State) => phoneTruths(state, NOW)[0].schedule.find(task => task.taskId === 'MASTER 2-3');
    expect([taskOf(before)?.latestActivityAt, taskOf(before)?.latestActivitySummary]).toEqual([null, null]);
    expect([taskOf(after)?.latestActivityAt, taskOf(after)?.latestActivitySummary]).toEqual([CREW.createdAt, CREW.message]);
    expect(fingerprints(after, NOW).today).not.toBe(fingerprints(before, NOW).today);
    expect(fingerprints(after, NOW).earlierVersion).not.toBe(fingerprints(before, NOW).earlierVersion);
  });
});

describe('R6 item 1: a report made before the update is still known after the first sync', () => {
  /** A report as a released build made it: its fingerprint is the 1.0 one of the rows as that build left them. */
  const madeBeforeTheUpdate = (state: State) => approved(state, REPORT_MADE, fingerprints(state, REPORT_MADE).earlierVersion);

  it('an approval made then is still this report\'s approval: approving again saves nothing and replaces nothing', () => {
    const before = beforeTheUpdate();
    const approval = readFromStorage(madeBeforeTheUpdate(before));
    expect(approval.sourceFingerprint).toMatch(/^dave-report-source\/1\.0:/);
    const after = sync(before);
    const now = fingerprints(after, NOW);
    // The 1.0 fingerprint of today's facts is another one: the facts did move.
    expect(now.earlierVersion).not.toBe(approval.sourceFingerprint);
    expect(sameReportSource(approval.sourceFingerprint, now.today)).toBe(true);
    // (It read: a new approval to save, over an approved report "not recorded as sent".)
    expect(reportSnapshotToSave(approved(after, NOW, now.today), approval)).toBeNull();
    expect(approvalReplacesUnsentApproval(approval, now.today)).toBe(false);
    expect(reportBaselineSnapshot(approval, now.today)).toEqual(reportBaselineSnapshot(approval, approval.sourceFingerprint));
  });

  it('a report sent then is still read as sent, and the other device does not wait for it', () => {
    const before = beforeTheUpdate();
    const sent = readFromStorage(markReportSnapshotDelivered(madeBeforeTheUpdate(before), REPORT_MADE, 'ipad'));
    const now = fingerprints(sync(before), NOW);
    expect(reportBaselineSnapshot(sent, now.today)).toEqual(reportBaselineSnapshot(sent, sent.sourceFingerprint));
    expect(otherDeviceSendNotReceived({ period: sent, currentFingerprint: now.today, ownSends: new Set(), pulledAt: null })).toBeNull();
    // The web: "already sent" from the other device, with when.
    expect(daveWebReportAlreadySentElsewhereAt(sent, now.today, new Set())).toBe(REPORT_MADE);
  });

  it('on the web: a report saved then is still current, and the phone\'s approval of then is known by the web\'s own name of before', () => {
    const before = beforeTheUpdate();
    const after = sync(before);
    // As the released build saved it on the web: the facts under 1.0, the rest of the web's source as it is.
    const webThen = buildDAVEWebReportSource(webSnapshot(before, REPORT_MADE), 'Alpha');
    const factsThen = buildDAVELegacyReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(before, REPORT_MADE), 'Alpha'));
    const savedThen = webThen.fingerprint.replace(/^dave-report-source\/2\.0:[0-9a-f]+/, factsThen);
    expect(savedThen).toMatch(/^dave-report-source\/1\.0:[0-9a-f]+:media-/);
    const today = buildDAVEWebReportSource(webSnapshot(after, NOW), 'Alpha');
    expect(daveWebReportSourceIsCurrent(savedThen, today)).toBe(true);
    // A period approval the web made then, read on the web today.
    const approval = readFromStorage(approved(before, REPORT_MADE, factsThen));
    expect(sameReportSource(approval.sourceFingerprint, buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(after, NOW), 'Alpha')))).toBe(true);
  });

  it('given in either order (the web records a send with the saved report\'s fingerprint against an approval it has just made)', () => {
    const before = beforeTheUpdate();
    const made = madeBeforeTheUpdate(before);
    const now = fingerprints(sync(before), NOW).today;
    expect(sameReportSource(now, made.sourceFingerprint)).toBe(true);
    expect(sameReportSource(made.sourceFingerprint, now)).toBe(true);
  });
});

describe('R6 item 1: never taken alone. From the first recognition on, the notes the name leaves out must be as they were then (review pass 1)', () => {
  const recognised = () => {
    const before = beforeTheUpdate();
    const made = approved(before, REPORT_MADE, fingerprints(before, REPORT_MADE).earlierVersion);
    const after = sync(before);
    const then = fingerprints(after, NOW).today;
    expect(reportSourceKnownAs(made.sourceFingerprint)).toBeUndefined();
    expect(sameReportSource(made.sourceFingerprint, then)).toBe(true);
    expect(reportSourceKnownAs(made.sourceFingerprint)).toBe(then);
    return { before, after, made, then };
  };
  const changed = (state: State, made: DAVEReportSnapshot) => {
    const now = fingerprints(state, NOW).today;
    return { stillKnown: sameReportSource(made.sourceFingerprint, now), replaces: approvalReplacesUnsentApproval(made, now) };
  };
  /** A change to the notes of one saved row, as a sync that hears of it leaves the rows. */
  const withNotesOf = (state: State, rowId: string, change: (notes: ProjectItemActivity[]) => ProjectItemActivity[]): State =>
    ({ ...state, items: state.items.map(item => (item.id === rowId ? { ...item, activity: change([...(item.activity ?? [])]) } as ScheduleItem : item)) });

  it('a note added to the task afterwards, on the old row and brought forward, makes it another report: whenever the note says it was typed', () => {
    const { after, made } = recognised();
    // Typed on another device that had not heard of the newer master; its clock says before the task's latest note.
    const typedEarlier = sync(withNote(after, 'MASTER 1-3', note('note-3', 'Second pass started.', '2026-09-08T10:00:00.000Z')));
    expect(notesOf(typedEarlier, 'MASTER 2-3')).toEqual(['note-1', 'note-3', 'note-2']);
    // (It is not the task's latest note, so the report's facts are the same and it is rightly still known.)
    expect(changed(typedEarlier, made)).toEqual({ stillKnown: true, replaces: false });
    // Its clock says after every other note: the task's latest note now.
    const typedLater = sync(withNote(after, 'MASTER 1-3', note('note-3', 'Second pass started.', '2026-09-10T18:00:00.000Z')));
    expect(changed(typedLater, made)).toEqual({ stillKnown: false, replaces: true });
    // And one that says it was typed before the report was made, yet after the other notes: the name of before
    // leaves it out too, and a clock could not tell. The notes kept at the first recognition do.
    const typedBeforeTheReport = sync(withNote(after, 'MASTER 1-3', note('note-3', 'Second pass started.', '2026-09-10T09:00:00.000Z')));
    expect(changed(typedBeforeTheReport, made)).toEqual({ stillKnown: false, replaces: true });
  });

  it('so does the task\'s latest note reworded, on both rows', () => {
    const { after, made } = recognised();
    const reword = (notes: ProjectItemActivity[]) => notes.map(entry => (entry.id === 'note-2' ? { ...entry, message: 'Crew short Tuesday and Wednesday.' } : entry));
    expect(changed(withNotesOf(withNotesOf(after, 'MASTER 1-3', reword), 'MASTER 2-3', reword), made)).toEqual({ stillKnown: false, replaces: true });
  });

  it('and that note deleted from both rows; and every note that followed deleted from both, which leaves the task\'s row as the build before showed it', () => {
    const { after, made } = recognised();
    const without = (notes: ProjectItemActivity[]) => notes.filter(entry => entry.id !== 'note-2');
    expect(changed(withNotesOf(withNotesOf(after, 'MASTER 1-3', without), 'MASTER 2-3', without), made)).toEqual({ stillKnown: false, replaces: true });
    // (Today's facts then have the report's own 1.0 fingerprint again. The notes it was recognised with are gone
    // all the same: once recognised, no 1.0 name is taken alone.)
    const none = () => [] as ProjectItemActivity[];
    expect(changed(withNotesOf(withNotesOf(after, 'MASTER 1-3', none), 'MASTER 2-3', none), made)).toEqual({ stillKnown: false, replaces: true });
  });

  it('or reworded on the task\'s row alone (the two rows no longer hold the same note)', () => {
    const { after, made } = recognised();
    const reword = (notes: ProjectItemActivity[]) => notes.map(entry => (entry.id === 'note-2' ? { ...entry, message: 'Crew short Tuesday and Wednesday.' } : entry));
    expect(changed(withNotesOf(after, 'MASTER 2-3', reword), made)).toEqual({ stillKnown: false, replaces: true });
  });

  it('guard: a note that is on the old row and not (or not yet) on the task\'s row is no change: the notes are the ones the report was recognised with', () => {
    // The task's row without its copy of the latest note, the old row still holding it: the rows as they are before
    // a sync brings that note forward. The next sync brings it forward again; the report does not flap meanwhile.
    const { after, made } = recognised();
    const without = (notes: ProjectItemActivity[]) => notes.filter(entry => entry.id !== 'note-2');
    expect(changed(withNotesOf(after, 'MASTER 2-3', without), made)).toEqual({ stillKnown: true, replaces: false });
    expect(changed(sync(withNotesOf(after, 'MASTER 2-3', without)), made)).toEqual({ stillKnown: true, replaces: false });
  });

  it('guard: unchanged, it is still that report', () => {
    const { after, made } = recognised();
    expect(changed(after, made)).toEqual({ stillKnown: true, replaces: false });
    expect(changed(after, made)).toEqual({ stillKnown: true, replaces: false });
  });

  it('a report first recognised by its facts as they are (nothing had followed) is kept the same way: a note that reaches an old row LATER and follows the task does not make the name of before fit it', () => {
    // Master 2 moved Paint and no note was ever typed on it: the released build's report is of the facts as they are.
    let state = approve({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/01/2026,10/05/2026,']);
    state = approve(state, schedule('MASTER 2', '2026-09-09T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/03/2026,10/07/2026,']);
    const made = approved(state, REPORT_MADE, fingerprints(state, REPORT_MADE).earlierVersion);
    const then = fingerprints(sync(state), NOW).today;
    expect(sameReportSource(made.sourceFingerprint, then)).toBe(true);
    expect(reportSourceKnownAs(made.sourceFingerprint)).toBe(then);
    // Weeks later a note typed on the old row (another device that had not heard of master 2) arrives and follows.
    const later = sync(withNote(state, 'MASTER 1-3', note('note-9', 'Second pass started.', '2026-09-08T09:00:00.000Z')));
    expect(notesOf(later, 'MASTER 2-3')).toEqual(['note-9']);
    expect(changed(later, made)).toEqual({ stillKnown: false, replaces: true });
  });

  it('recognised BEFORE this build\'s first sync (the rows as the build before left them): still known after that sync, and a note that arrives later is new', () => {
    const before = beforeTheUpdate();
    const made = approved(before, REPORT_MADE, fingerprints(before, REPORT_MADE).earlierVersion);
    // Reports is opened right after the update: the report is known by its facts as they are, and what is kept
    // for it is the notes of the old row as they are now.
    const atOnce = fingerprints(before, NOW).today;
    expect(sameReportSource(made.sourceFingerprint, atOnce)).toBe(true);
    expect(reportSourceKnownAs(made.sourceFingerprint)).toBe(atOnce);
    expect(phoneTruths(before, NOW)[0].earlierRowNotesKey).toMatch(/^[0-9a-f]{16}$/);
    // The first sync brings the notes forward: the same notes, now on the task's row too. Still that report.
    const after = sync(before);
    expect(phoneTruths(after, NOW)[0].earlierRowNotesKey).toBe(phoneTruths(before, NOW)[0].earlierRowNotesKey);
    const then = fingerprints(after, NOW).today;
    expect(then).not.toBe(atOnce);
    expect(changed(after, made)).toEqual({ stillKnown: true, replaces: false });
    expect(reportSourceKnownAs(made.sourceFingerprint)).toBe(then);
    // A note typed on the old row after that, and brought forward: another report.
    const later = sync(withNote(after, 'MASTER 1-3', note('note-3', 'Second pass started.', '2026-09-10T09:00:00.000Z')));
    expect(changed(later, made)).toEqual({ stillKnown: false, replaces: true });
    // And had it arrived WITH that first sync, on a device that had already recognised the report: another report too.
    forgetReportSourcesKnownAs();
    expect(sameReportSource(made.sourceFingerprint, fingerprints(before, NOW).today)).toBe(true);
    const withTheFirstSync = sync(withNote(before, 'MASTER 1-3', note('note-3', 'Second pass started.', '2026-09-10T09:00:00.000Z')));
    expect(changed(withTheFirstSync, made)).toEqual({ stillKnown: false, replaces: true });
  });

  it('a note typed on an old row that does not reach the task\'s row changes no fact of the report: it is still that report', () => {
    const { after, made } = recognised();
    // (An older schedule is current again on such a project, or the sync has not brought it forward yet.)
    const onTheOldRowOnly = withNote(after, 'MASTER 1-3', note('note-3', 'Second pass started.', '2026-09-10T18:00:00.000Z'));
    expect(notesOf(onTheOldRowOnly, 'MASTER 2-3')).toEqual(['note-1', 'note-2']);
    expect(changed(onTheOldRowOnly, made)).toEqual({ stillKnown: true, replaces: false });
    // Once it does reach the task's row it is new.
    expect(changed(sync(onTheOldRowOnly), made)).toEqual({ stillKnown: false, replaces: true });
  });

  it('the notes it is held to are those of the FIRST recognition, however often it is recognised again', () => {
    const { before, after, made } = recognised();
    // The rows as they were before the sync (a backup put back, say): the same notes, on the old row only. That report.
    expect(changed(before, made)).toEqual({ stillKnown: true, replaces: false });
    // A note has been typed on the old row meanwhile, and the sync brings all three forward. The third was not
    // there when the report was FIRST recognised: another report, though it was recognised again just above.
    const withANewNote = sync(withNote(before, 'MASTER 1-3', note('note-3', 'Second pass started.', '2026-09-10T18:00:00.000Z')));
    expect(notesOf(withANewNote, 'MASTER 2-3')).toEqual(['note-1', 'note-2', 'note-3']);
    expect(changed(withANewNote, made)).toEqual({ stillKnown: false, replaces: true });
    // And the rows as they were when it was first recognised: that report again.
    expect(changed(after, made)).toEqual({ stillKnown: true, replaces: false });
  });

  it('what was recognised is kept in the device\'s own storage, and decides again after the app is closed; nothing of it is in the shared record', async () => {
    const kept = new Map<string, string>();
    const storage: SnapshotStorage = { getItem: async key => kept.get(key) ?? null, setItem: async (key, value) => { kept.set(key, value); } };
    const shared: { row: unknown } = { row: null };
    const cloud: DAVEReportSnapshotCloud = { read: async () => ({ ownerId: 'owner-1', snapshot: shared.row }), write: async snapshot => { shared.row = JSON.parse(JSON.stringify(snapshot)); return undefined as never; } };
    const before = beforeTheUpdate();
    const made = approved(before, REPORT_MADE, fingerprints(before, REPORT_MADE).earlierVersion);
    await saveDAVEReportSnapshot(made, storage, cloud);
    const after = sync(before);
    const then = fingerprints(after, NOW).today;
    // Reports is opened after the first sync: the period is read, and the report on screen is that approval.
    const period = (await loadDAVEReportPeriod(SCOPE, 'project_manager', storage, cloud)).snapshot as DAVEReportSnapshot;
    expect(sameReportSource(period.sourceFingerprint, then)).toBe(true);
    // The app is closed and opened again (nothing is left in memory); a note has reached the old row meanwhile.
    await new Promise(resolve => setTimeout(resolve, 0));
    forgetReportSourcesKnownAs();
    const later = sync(withNote(after, 'MASTER 1-3', note('note-3', 'Second pass started.', '2026-09-10T09:00:00.000Z')));
    const again = (await loadDAVEReportPeriod(SCOPE, 'project_manager', storage, cloud)).snapshot as DAVEReportSnapshot;
    expect(reportSourceKnownAs(again.sourceFingerprint)).toBe(then);
    expect(sameReportSource(again.sourceFingerprint, fingerprints(later, NOW).today)).toBe(false);
    expect(sameReportSource(again.sourceFingerprint, then)).toBe(true);
    // On this device only: fingerprints in its storage, and the shared record's report as it was made.
    expect([...kept.keys()].filter(key => key.includes('known-as'))).toHaveLength(1);
    expect(JSON.stringify(shared.row)).not.toContain(then);
    expect((shared.row as DAVEReportSnapshot).sourceFingerprint).toBe(made.sourceFingerprint);
  });

  it('what it cannot tell, stated: a note that reached the old row before this device FIRST recognised the report is taken as part of it', () => {
    const before = beforeTheUpdate();
    const made = approved(before, REPORT_MADE, fingerprints(before, REPORT_MADE).earlierVersion);
    // Typed on the other device after the report was made; it arrives with the very first sync on this build.
    const first = sync(withNote(before, 'MASTER 1-3', note('note-3', 'Second pass started.', '2026-09-10T18:00:00.000Z')));
    expect(sameReportSource(made.sourceFingerprint, fingerprints(first, NOW).today)).toBe(true);
  });
});

describe('R6 item 1: a note that is new since the report still makes it read as changed', () => {
  const madeBefore = () => {
    const before = beforeTheUpdate();
    return { before, approval: readFromStorage(approved(before, REPORT_MADE, fingerprints(before, REPORT_MADE).earlierVersion)) };
  };

  it('guard: typed on the task\'s row after the report, before or after this device first recognises it', () => {
    const { before, approval } = madeBefore();
    const after = withNote(sync(before), 'MASTER 2-3', note('note-3', 'Second pass started.', '2026-09-10T18:00:00.000Z'));
    const now = fingerprints(after, NOW);
    expect(sameReportSource(approval.sourceFingerprint, now.today)).toBe(false);
    expect(approvalReplacesUnsentApproval(approval, now.today)).toBe(true);
  });

  it('guard: and anything else that changed, with the notes brought forward or not', () => {
    const { before, approval } = madeBefore();
    const moved = sync(before);
    const after = { ...moved, items: moved.items.map(item => (item.id === 'MASTER 2-3' ? { ...item, percentComplete: 40, status: 'In Progress' } as ScheduleItem : item)) };
    expect(sameReportSource(approval.sourceFingerprint, fingerprints(after, NOW).today)).toBe(false);
  });
});

describe('R6 item 1: one way, as the version hand-over is', () => {
  it('guard: a report made on this build (its fingerprint today\'s version) is never known through the name of before, whatever its facts', () => {
    const before = beforeTheUpdate();
    // Made on this build before its first sync, with the rows as the build before left them.
    const madeHere = readFromStorage(approved(before, REPORT_MADE, fingerprints(before, REPORT_MADE).today));
    expect(madeHere.sourceFingerprint).toMatch(/^dave-report-source\/2\.0:/);
    const after = sync(before);
    expect(sameReportSource(madeHere.sourceFingerprint, fingerprints(after, NOW).today)).toBe(false);
    expect(sameReportSource(fingerprints(after, NOW).today, madeHere.sourceFingerprint)).toBe(false);
    // Made after the notes followed: its own facts only.
    const madeAfter = readFromStorage(approved(after, REPORT_MADE, fingerprints(after, REPORT_MADE).today));
    expect(sameReportSource(madeAfter.sourceFingerprint, fingerprints(after, NOW).today)).toBe(true);
    expect(sameReportSource(madeAfter.sourceFingerprint, fingerprints(before, NOW).today)).toBe(false);
    const more = sync(withNote(after, 'MASTER 1-3', note('note-3', 'Second pass started.', '2026-09-10T18:00:00.000Z')));
    expect(sameReportSource(madeAfter.sourceFingerprint, fingerprints(more, NOW).today)).toBe(false);
  });

  it('guard: a report of other facts made before the update is not this one', () => {
    const before = beforeTheUpdate();
    // Made when Paint stood at 40%; he has since set it back to 0%.
    const atForty = { ...before, items: before.items.map(item => (item.id === 'MASTER 2-3' ? { ...item, percentComplete: 40, status: 'In Progress' } as ScheduleItem : item)) };
    const other = readFromStorage(approved(atForty, REPORT_MADE, fingerprints(atForty, REPORT_MADE).earlierVersion));
    expect(sameReportSource(other.sourceFingerprint, fingerprints(sync(before), NOW).today)).toBe(false);
  });
});

describe('R6 item 1: what the report\'s Project Truth hands over, and the fingerprint', () => {
  it('for each task whose latest note is one that followed it: its latest note without those, and when the newest of them was typed', () => {
    const after = sync(beforeTheUpdate());
    expect(phoneTruths(after, NOW)[0].activityBeforeNotesFollowed).toEqual([
      { taskId: 'MASTER 2-3', latestActivityAt: null, latestActivitySummary: null, followedAt: CREW.createdAt },
    ]);
    // With a note of the row's own, and a later one typed on the old row (Set Active had gone back to master 1): the
    // row's own is its latest without those that followed.
    const own = note('note-4', 'Materials on site.', '2026-09-09T13:00:00.000Z');
    const onOldRow = note('note-5', 'Waiting on the engineer.', '2026-09-09T14:00:00.000Z');
    const both = sync(withNote(withNote(beforeTheUpdate(), 'MASTER 2-3', own), 'MASTER 1-3', onOldRow));
    expect(notesOf(both, 'MASTER 2-3')).toEqual(['note-1', 'note-2', 'note-4', 'note-5']);
    expect(phoneTruths(both, NOW)[0].activityBeforeNotesFollowed).toEqual([
      { taskId: 'MASTER 2-3', latestActivityAt: own.createdAt, latestActivitySummary: own.message, followedAt: onOldRow.createdAt },
    ]);
  });

  it('nothing for a task whose latest note is its row\'s own, or with no notes that followed, or on a truth built without the saved tasks', () => {
    const before = beforeTheUpdate();
    const after = sync(before);
    expect(phoneTruths(before, NOW)[0].activityBeforeNotesFollowed).toBeUndefined();
    const own = note('note-3', 'Second pass started.', '2026-09-10T18:00:00.000Z');
    expect(phoneTruths(withNote(after, 'MASTER 2-3', own), NOW)[0].activityBeforeNotesFollowed).toBeUndefined();
    const withoutSaved = buildDAVEReportProjectTruths({
      projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown(after),
      projectAreas: [], referenceDocuments: after.documents, now: NOW,
    });
    expect(withoutSaved[0].activityBeforeNotesFollowed).toBeUndefined();
  });

  it('that record is in neither version of the fingerprint, and the name of before is the 1.0 fingerprint a released build gave the same rows, to the byte', () => {
    const before = beforeTheUpdate();
    const after = sync(before);
    const truths = phoneTruths(after, NOW);
    expect(truths[0].activityBeforeNotesFollowed).toHaveLength(1);
    const without = truths.map(truth => { const { activityBeforeNotesFollowed: _rows, ...rest } = truth; return rest as typeof truth; });
    expect(buildDAVEReportSourceFingerprint(truths)).toBe(buildDAVEReportSourceFingerprint(without));
    const asBuilt = daveProjectTruthAsBuilt(truths[0]);
    const { activityBeforeNotesFollowed: _built, ...asBuiltWithout } = asBuilt;
    expect(buildDAVELegacyReportSourceFingerprint(truths)).toBe(buildDAVELegacyReportSourceFingerprint([asBuiltWithout as typeof asBuilt]));
    const today = buildDAVEReportSourceFingerprint(truths);
    expect(reportSourcesBeforeNotesFollowedOf(today)).toEqual([fingerprints(before, NOW).earlierVersion]);
    // And none for facts with no note that followed.
    expect(reportSourcesBeforeNotesFollowedOf(fingerprints(before, NOW).today)).toEqual([]);
  });
});

describe('R6 item 1: the written report', () => {
  /**
   * As the build before left it, with its reports: he types a note on Paint; a report goes out and says it; he types
   * a second note; master 2 moves Paint (the notes stay on the old row); a second report goes out, with Paint on its
   * new row and no note.
   */
  function twoReportsBeforeTheUpdate() {
    let state = approve({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/01/2026,10/05/2026,']);
    state = withNote(state, 'MASTER 1-3', INSPECTOR);
    const first = readFromStorage(markReportSnapshotDelivered(approved(state, '2026-09-08T10:00:00.000Z', fingerprints(state, '2026-09-08T10:00:00.000Z').today), '2026-09-08T10:00:00.000Z', 'phone'));
    return { state, first };
  }
  const moved = (state: State) => approve(state, schedule('MASTER 2', '2026-09-09T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/03/2026,10/07/2026,']);
  /** The rows as the build before left them after master 2: the old row's notes are not on the new row. */
  const asTheBuildBeforeLeftThem = (state: State): State => {
    const old = new Set(notesOf(state, 'MASTER 1-3'));
    return { ...state, items: state.items.map(item => (item.id === 'MASTER 2-3' ? { ...item, activity: (item.activity ?? []).filter(entry => !old.has(entry.id)) } as ScheduleItem : item)) };
  };
  const secondReport = (state: State, first: DAVEReportSnapshot) =>
    readFromStorage(markReportSnapshotDelivered(approved(state, REPORT_MADE, fingerprints(state, REPORT_MADE).today, first), REPORT_MADE, 'phone'));

  it('the report after the sync does not say again a note that followed the task and that a report had already said', () => {
    const { state, first } = twoReportsBeforeTheUpdate();
    const before = asTheBuildBeforeLeftThem(moved(state));
    expect([notesOf(before, 'MASTER 1-3'), notesOf(before, 'MASTER 2-3')]).toEqual([['note-1'], []]);
    const second = secondReport(before, first);
    // The update, its first sync, and something else changes so that a new report is due.
    const after = setPercent(sync(before), 'Drywall', 20, NOW);
    expect(notesOf(after, 'MASTER 2-3')).toEqual(['note-1']);
    const report = reportOf(after, second, '2026-09-12T15:00:00.000Z');
    // (It read, among its recent changes: "Alpha: Paint — Inspector called.", which the first report had said on 8 Sep.)
    expect(report.lines.filter(line => line.includes('Paint'))).toEqual([]);
    expect(report.newNotes).toEqual([]);
    expect(report.lines.some(line => line.includes('Drywall moved from 0% to 20% complete.'))).toBe(true);
  });

  it('guard: a note typed after that first report, which the second (on the new row) never had, is said: no report has said it', () => {
    const { state, first } = twoReportsBeforeTheUpdate();
    const before = asTheBuildBeforeLeftThem(moved(withNote(state, 'MASTER 1-3', CREW)));
    const second = secondReport(before, first);
    const report = reportOf(setPercent(sync(before), 'Drywall', 20, NOW), second, '2026-09-12T15:00:00.000Z');
    expect(report.lines.filter(line => line.includes('Paint'))).toEqual(['Alpha: Paint — Crew short Tuesday.']);
    expect(report.newNotes).toEqual(['MASTER 2-3']);
  });

  it('guard: with no report before the one it counts from, nothing can have said the notes: they are said', () => {
    const before = beforeTheUpdate();
    const only = readFromStorage(markReportSnapshotDelivered(approved(before, REPORT_MADE, fingerprints(before, REPORT_MADE).today), REPORT_MADE, 'phone'));
    expect(reportOf(setPercent(sync(before), 'Drywall', 20, NOW), only, '2026-09-12T15:00:00.000Z').newNotes).toEqual(['MASTER 2-3']);
  });

  it('guard: a note typed on the task\'s own row since the last report is said, with older notes brought forward or not', () => {
    const { state, first } = twoReportsBeforeTheUpdate();
    const before = asTheBuildBeforeLeftThem(moved(state));
    const second = secondReport(before, first);
    const after = withNote(sync(before), 'MASTER 2-3', note('note-3', 'Second pass started.', '2026-09-11T07:00:00.000Z'));
    const report = reportOf(after, second, '2026-09-12T15:00:00.000Z');
    expect(report.lines.filter(line => line.includes('Paint'))).toEqual(['Alpha: Paint — Second pass started.']);
  });

  it('the same on the web', () => {
    const { state, first } = twoReportsBeforeTheUpdate();
    const before = asTheBuildBeforeLeftThem(moved(state));
    const second = secondReport(before, first);
    const newNotes = (current: State) => {
      const snapshot = webSnapshot(current, '2026-09-12T15:00:00.000Z');
      const fingerprint = buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(snapshot, 'Alpha'));
      return [...(buildDAVEWebReportDraft(snapshot, 'Alpha', { previousSnapshot: reportBaselineSnapshot(second, fingerprint), waitingForOtherDevice: false }).reportingPeriod.newActivityTaskIds ?? [])];
    };
    expect(newNotes(setPercent(sync(before), 'Drywall', 20, NOW))).toEqual([]);
    expect(newNotes(withNote(sync(before), 'MASTER 2-3', note('note-3', 'Second pass started.', '2026-09-11T07:00:00.000Z')))).toEqual(['MASTER 2-3']);
  });
});
