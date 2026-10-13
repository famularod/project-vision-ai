/**
 * R10 (the coordinator's decision on reports review pass 3, P3-2; High by the false-match rule).
 *
 * At the hand-over from Build 230 the app knew a report that build had saved by the fingerprint that build wrote
 * (1.0), and showed today's report as "already sent". But the words are written again by this build, and this
 * round changed how the same facts are worded and ordered: on one project in four the report shown as sent did
 * not read as the one Build 230 sent, and the phone keeps no text of a sent report to tell them apart.
 *
 * The decision: NO EARLIER-VERSION NAME EVER STANDS. A report approved, sent or saved by Build 230 is never taken
 * for the report on screen in this build: after the update each project's current report is offered once, and from
 * the first report approved on this build everything works by today's fingerprint (2.0) as before. "Since the last
 * report" still counts from the last report sent, a Build 230 one included: its saved record and its send time are
 * read exactly as they were.
 *
 * The real CSV reader, import merge, shown list, the one report recipe, and the phone's and the web's own way of
 * choosing what a report counts from and whether it is the one already sent. Synthetic data.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  buildDAVELegacyReportSourceFingerprint, buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, reportPeriodMovementLines,
} from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, legacyReportSourcesOf, markReportSnapshotDelivered, reportBaselineSnapshot, reportPeriodSentAt,
  reportReadAsEarlierVersionReport, reportSnapshotToSave, sameReportSource, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { approvalReplacesUnsentApproval } from '../../services/ReportManualSend';
import { buildDAVEWebReportDraft, buildDAVEWebReportSource, buildDAVEWebReportTruths, daveWebReportSourceIsCurrent } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebReportAlreadySentElsewhereAt, daveWebReportPeriodState } from '../../services/DAVEWebReportPeriod';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleImportReviewPairingQuestions, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const master = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
/** The approval as the phone makes it, the review's questions answered as it guesses them (the tasks carry Unique IDs). */
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete,Unique ID', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined), activity: [],
  } as ScheduleItem));
  let pairingChoices: Record<string, string | null> | undefined;
  scheduleImportReviewPairingQuestions({ saved: state.items, documents: [...state.documents, source], importBatchId: source.importBatchId || '', imported, overlay: false })
    .forEach(question => { pairingChoices = { ...(pairingChoices || {}), ...(question as unknown as { guess: Record<string, string | null> }).guess }; });
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay: false, ...(pairingChoices ? { pairingChoices } : {}),
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]) as ScheduleItem[],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
const records = (state: State, id: string, percent: number, at: string): State => ({ ...state, items: state.items.map(item => (item.id === id
  ? { ...item, percentComplete: percent, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at } as ScheduleItem : item)) });
const withRow = (state: State, id: string, change: Partial<ScheduleItem>): State => ({ ...state, items: state.items.map(item => (item.id === id ? { ...item, ...change } as ScheduleItem : item)) });
const truthsOf = (state: State, at: string) => buildDAVEReportProjectTruths({
  projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown(state),
  knownScheduleItems: state.items, knownScheduleDocuments: state.documents, projectAreas: [], referenceDocuments: state.documents, now: at,
});
const SCOPE = daveReportSnapshotScopeKey(['Alpha']);
/** The phone's Reports screen for this saved data and saved period (screens/ReportsScreen.tsx). */
function report(state: State, saved: DAVEReportSnapshot | null, at: string) {
  const truths = truthsOf(state, at);
  const fingerprint = buildDAVEReportSourceFingerprint(truths);
  const briefing = buildDAVEReportBriefing({
    truths, selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(saved, fingerprint),
    readAsEarlierVersionReport: reportReadAsEarlierVersionReport(saved, fingerprint), scheduleItems: shown(state),
  });
  const snapshot = buildDAVEReportSnapshot({ truths, scopeKey: SCOPE, sourceFingerprint: fingerprint, capturedAt: at, reportFormat: 'project_manager' });
  const toSave = reportSnapshotToSave(snapshot, saved);
  return {
    truths, fingerprint,
    /** The saved period once he approves this report and sends it (or the period as it is, when it is the report already sent). */
    sent: (toSave ? markReportSnapshotDelivered(toSave, at, 'phone') : saved) as DAVEReportSnapshot,
    /** Shown as the report already sent: nothing to approve. Otherwise Approve is offered. */
    shownAsAlreadySent: Boolean(saved) && toSave === null,
    /** "Since the last report": the count line, then what changed; and the time the period is counted from. */
    since: reportPeriodMovementLines(briefing),
    countedFrom: briefing.reportingPeriod.startedAt,
    changes: briefing.reportingPeriod.changes.map(change => String(change.summary)),
  };
}
/** "Since the last report" counted from a saved report directly: what any report that is not that report reads. */
function sinceCountedFrom(state: State, countedFrom: DAVEReportSnapshot, at: string) {
  const briefing = buildDAVEReportBriefing({ truths: truthsOf(state, at), selectedProjectNames: ['Alpha'], previousSnapshot: countedFrom, scheduleItems: shown(state) });
  return { since: reportPeriodMovementLines(briefing), countedFrom: briefing.reportingPeriod.startedAt };
}
/** The web's Reports page for the same (components/web-shell/desktop-read-only-shell.tsx): the period on this tab, then the report. */
function webPage(state: State, saved: DAVEReportSnapshot | null, at: string) {
  const snapshot = {
    projects: [{ id: 'project-alpha-id', name: 'Alpha' }], scheduleItems: shown(state), knownScheduleItems: state.items,
    projectUpdates: [], referenceDocuments: state.documents, refreshedAt: at,
  } as unknown as DAVEWebReadOnlySnapshot;
  const fingerprint = buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(snapshot, 'Alpha'));
  const period = daveWebReportPeriodState({ read: { status: 'loaded', snapshot: saved, shared: 'checked', approvalSavedHere: false }, fingerprint, pulledAt: at });
  const briefing = buildDAVEWebReportDraft(snapshot, 'Alpha', {
    previousSnapshot: period.previousSnapshot, waitingForOtherDevice: Boolean(period.behindSend), readAsEarlierVersionReport: period.readAsEarlierVersionReport,
  });
  return {
    fingerprint, source: buildDAVEWebReportSource(snapshot, 'Alpha'),
    /** "Your other device already sent this report", with when; null: not said. */
    saidAlreadySentAt: daveWebReportAlreadySentElsewhereAt(saved, fingerprint, new Set()),
    since: reportPeriodMovementLines(briefing),
    countedFrom: briefing.reportingPeriod.startedAt,
  };
}
type Report = ReturnType<typeof report>;
/** A report as Build 230 saved it: the same saved report, under the fingerprint that build wrote for its facts (1.0). */
const asBuild230SavedIt = (made: Report): Report => ({ ...made, sent: { ...made.sent, sourceFingerprint: buildDAVELegacyReportSourceFingerprint(made.truths) } });

const TASKS = ['Paint,Alpha,Lot,09/21/2026,09/25/2026,,101', 'Drywall,Alpha,Lot,10/01/2026,10/04/2026,,102', 'Framing,Alpha,Lot,09/14/2026,09/18/2026,,103'];
/** On Build 230: a master, Paint at 60%, report 1 sent; Framing at 30%, report 2 sent. Then the update is installed. */
function onBuild230() {
  let state = approve({ items: [], documents: [] }, master('MASTER M1', '2026-09-07T16:00:00.000Z'), TASKS);
  state = records(state, 'MASTER M1-1', 60, '2026-09-07T18:00:00.000Z');
  const one = asBuild230SavedIt(report(state, null, '2026-09-07T22:00:00.000Z'));
  state = records(state, 'MASTER M1-3', 30, '2026-09-08T18:00:00.000Z');
  const two = asBuild230SavedIt(report(state, one.sent, '2026-09-08T22:00:00.000Z'));
  return { state, one, two };
}
const UPDATED = '2026-09-08T22:30:00.000Z'; // the same evening, the update installed: nothing has changed
const LATER = '2026-09-08T23:00:00.000Z';
const EARLIER_VERSION = /^dave-report-source\/1\.0:/;
const NOTHING_CHANGED = ['+0 completed; +0 open; +0 overdue.'];

describe('R10: a report an earlier build saved is never taken for the report on screen; it is offered once', () => {
  it('(the rig) the report Build 230 sent is saved under the fingerprint that build wrote, which is still worked out to the byte', () => {
    const { state, two } = onBuild230();
    expect(two.sent.sourceFingerprint).toMatch(EARLIER_VERSION);
    expect(typeof two.sent.deliveredAt).toBe('string');
    expect(buildDAVELegacyReportSourceFingerprint(truthsOf(state, UPDATED))).toBe(two.sent.sourceFingerprint);
  });

  it('the phone, nothing changed since Build 230 sent it: not shown as already sent, Approve is offered, and "since the last report" counts from the Build 230 report', () => {
    const { state, two } = onBuild230();
    const today = report(state, two.sent, UPDATED);
    expect(today.shownAsAlreadySent).toBe(false);
    expect(sameReportSource(two.sent.sourceFingerprint, today.fingerprint)).toBe(false);
    // Counted from the Build 230 report, as any report that is not that report always was: its saved record, its time.
    expect(reportBaselineSnapshot(two.sent, today.fingerprint)).toBe(two.sent);
    expect([today.since, today.countedFrom]).toEqual([sinceCountedFrom(state, two.sent, UPDATED).since, sinceCountedFrom(state, two.sent, UPDATED).countedFrom]);
    expect(today.since).toEqual(NOTHING_CHANGED);
    expect(today.countedFrom).toBe(two.sent.capturedAt);
    expect(reportPeriodSentAt(today.sent.supersedes)).toBe(two.sent.deliveredAt);
  });

  it('the web, the same: it does not say the report was already sent, a web report saved on Build 230 is out of date, and it counts from the Build 230 report', () => {
    const { state, two } = onBuild230();
    const page = webPage(state, two.sent, UPDATED);
    expect(page.saidAlreadySentAt).toBeNull();
    // The web's own saved report: the facts under Build 230's fingerprint, the rest of the source the same.
    const savedOn230 = `${two.sent.sourceFingerprint}${page.source.fingerprint.slice(page.fingerprint.length)}`;
    expect(page.source.fingerprint.startsWith(page.fingerprint)).toBe(true);
    expect(daveWebReportSourceIsCurrent(savedOn230, page.source)).toBe(false);
    expect(daveWebReportSourceIsCurrent(page.source.fingerprint, page.source)).toBe(true);
    expect([page.since, page.countedFrom]).toEqual([NOTHING_CHANGED, two.sent.capturedAt]);
  });

  it('after he approves and sends it once it IS the report already sent (by today\'s fingerprint), on the phone and the web, and is not offered again', () => {
    const { state, two } = onBuild230();
    const today = report(state, two.sent, UPDATED);
    expect(today.sent.sourceFingerprint).toBe(today.fingerprint);
    expect(today.sent.sourceFingerprint).not.toMatch(EARLIER_VERSION);
    expect(today.sent.supersedes).toEqual(two.sent);
    const again = report(state, today.sent, LATER);
    expect(again.shownAsAlreadySent).toBe(true);
    // The same report, counted as it was when he approved it: from the Build 230 report.
    expect([again.since, again.countedFrom]).toEqual([today.since, today.countedFrom]);
    const page = webPage(state, today.sent, LATER);
    expect(page.saidAlreadySentAt).toBe(today.sent.deliveredAt);
    expect([page.since, page.countedFrom]).toEqual([today.since, today.countedFrom]);
  });

  it('something changed after the update: the next report counts from the last report sent, the Build 230 one, and says the change', () => {
    const { state, two } = onBuild230();
    const changed = records(state, 'MASTER M1-3', 50, '2026-09-09T18:00:00.000Z');
    const next = report(changed, two.sent, '2026-09-09T22:00:00.000Z');
    expect([next.shownAsAlreadySent, next.countedFrom]).toEqual([false, two.sent.capturedAt]);
    expect(next.changes).toEqual(['Framing moved from 30% to 50% complete.']);
    expect(webPage(changed, two.sent, '2026-09-09T22:00:00.000Z').countedFrom).toBe(two.sent.capturedAt);
  });

  it('an approval Build 230 saved and never sent: Approve warns that an approved report is not recorded as sent, and the report counts from the last one sent', () => {
    const { state, one, two } = onBuild230();
    const waiting = { ...two.sent, deliveredAt: null } as DAVEReportSnapshot;
    const today = report(state, waiting, UPDATED);
    expect(today.shownAsAlreadySent).toBe(false);
    expect(approvalReplacesUnsentApproval(waiting, today.fingerprint)).toBe(true);
    expect(today.countedFrom).toBe(one.sent.capturedAt);
    // Approved and sent here, it stops.
    expect(report(state, today.sent, LATER).shownAsAlreadySent).toBe(true);
  });

  it('on this build nothing has changed: a report sent here is known by today\'s fingerprint on the other device and on the web', () => {
    const { state, two } = onBuild230();
    const sentHere = report(state, two.sent, UPDATED).sent;
    expect(report(state, sentHere, LATER).shownAsAlreadySent).toBe(true);
    expect(webPage(state, sentHere, LATER).saidAlreadySentAt).toBe(sentHere.deliveredAt);
  });

  it('no earlier-version name is offered for today\'s facts, whatever they are; the code that works one out is left in place', () => {
    const { state, two } = onBuild230();
    const today = report(state, two.sent, UPDATED);
    expect(legacyReportSourcesOf(today.fingerprint)).toEqual([]);
    expect(reportReadAsEarlierVersionReport(two.sent, today.fingerprint)).toBe(false);
    expect(buildDAVELegacyReportSourceFingerprint(today.truths)).toBe(two.sent.sourceFingerprint);
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'DAVEReportIntelligence.ts'), 'utf8');
    expect(source).toContain('const EARLIER_VERSION_NAMES_STAND: boolean = false;');
    expect(source.match(/rememberLegacyReportSource\(/g)).toHaveLength(1);
  });
});
