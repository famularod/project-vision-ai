/**
 * HIGH item 1c (the coordinator's decision on reports review pass 1, H1R-1 and H1R-2; open item 7.46; the owner's
 * instruction of 13 Oct 2026, the three high items). Built on the reviewer's own rig (notes/p6-b232/hrv1r-item1-
 * period.test.ts and hrv1r-mornings.test.ts: his Test project's shape with made-up names, a REAL period: a report sent,
 * the next sent counting from it, then the phone, the iPad and the computer look again).
 *
 * A task's saved time prints only through "since the last report" (and Completed Work), and which of those lines print
 * depends on the report this one counts from. 3.0 held it as the order of every task (1b): a task saved again that was
 * already on top moved nothing while a line came ("Trim was updated.": H1R-1, "already sent" over another text), and
 * any other task saved again moved it while no line came (H1R-2, offered with no word changed). Now 3.0 holds what the
 * report prints of saved times, counted from the report it counts from (buildDAVEReportSourceOnPeriod, as the phone's
 * and the desktop's Reports screens ask it), and which report that is.
 *   "already sent" on a device  <=>  the report, taken as the one sent (counted from what that one counted from),
 *                                    reads word for word as the one sent.
 * Every device reads the same shared period. (`fpOn` falls back to the old call on a build without the new one, so
 * these tests say what the build before does: red where the fault is.) Synthetic data, no network.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///var/mobile/Containers/Data/Application/PHONE/Documents/' }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));
const mockCloud: { rows: unknown } = { rows: null };
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ daveWebSupabaseGateway: { loadAuthorizedRows: async () => mockCloud.rows } }));

import * as RI from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave, sameReportSource } from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportTruths, formatDAVEWebReport } from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebReportAlreadySentElsewhereAt } from '../../services/DAVEWebReportPeriod';
import { compactECOSDocumentIndexForCloud } from '../../services/ECOSDocumentIndexPersistence';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleImportAddsToMaster, scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import * as Revisions from '../../services/ScheduleTaskRevisions';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';


const fpOn = (truths: any, period: any): string => ((RI as any).buildDAVEReportSourceOnPeriod ? (RI as any).buildDAVEReportSourceOnPeriod(truths, period).fingerprint : RI.buildDAVEReportSourceFingerprint(truths));
jest.setTimeout(300_000);
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const fakeNow = (now: string) => jest.useFakeTimers({ now: Date.parse(now), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });

// ---- the project (made-up names), built with the app's own import, merge and Delete PDF + Items ----
const P = 'Larch Hollow';
const HEADER = 'Task,Project,Location,Start,Finish,Owner,Status,Percent Complete,Notes';
const line = (task: string, start: string, finish: string, status = 'Not Started', percent = '') => `${task},${P},Site,${start},${finish},Ines,${status},${percent},`;
const FILES: Record<string, Readonly<{ at: string; role: 'full' | 'lookahead'; lines: string[] }>> = {
  'S1 first full schedule': { at: '2026-10-13T23:05:00.000Z', role: 'full', lines: [line('Paint', '10/26/2026', '10/30/2026'), line('Trim', '11/02/2026', '11/06/2026'), line('Fence', '11/09/2026', '11/13/2026')] },
  'S2 newer full schedule': { at: '2026-10-13T23:09:00.000Z', role: 'full', lines: [line('Paint', '10/15/2026', '10/19/2026'), line('Trim', '11/02/2026', '11/06/2026'), line('Fence', '11/09/2026', '11/13/2026')] },
  'S3 full schedule with Paint': { at: '2026-10-13T23:20:00.000Z', role: 'full', lines: [line('Paint', '10/27/2026', '10/30/2026'), line('Trim', '11/02/2026', '11/06/2026'), line('Fence', '11/09/2026', '11/13/2026')] },
  'S4 full schedule without Paint': { at: '2026-10-13T23:24:00.000Z', role: 'full', lines: [line('Trim', '11/02/2026', '11/06/2026'), line('Fence', '11/09/2026', '11/13/2026')] },
  'S5 full schedule, Paint back': { at: '2026-10-13T23:28:00.000Z', role: 'full', lines: [line('Paint', '11/16/2026', '11/20/2026'), line('Trim', '11/02/2026', '11/06/2026'), line('Fence', '11/09/2026', '11/13/2026')] },
  'L1 lookahead': { at: '2026-10-14T01:22:00.000Z', role: 'lookahead', lines: [line('Paint', '10/16/2026', '10/20/2026', 'In Progress', '60')] },
};
const docId = (name: string) => `doc-${name.split(' ')[0].toLowerCase()}`;
function phoneDocument(name: string): ReferenceDocument {
  let document: ReferenceDocument | null = null;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    document = require('../../services/ReferenceDocumentRepository').normalizeReferenceDocument({
      id: docId(name), name, originalFileName: `${name}.csv`, uri: `file:///var/mobile/Containers/Data/Application/PHONE/Documents/project-documents/${docId(name)}.csv`,
      category: 'Schedules', notes: '', isCurrent: true, importedAt: FILES[name].at, projectName: P, projectNames: [P], importBatchId: `batch-${docId(name)}`,
      scheduleRole: FILES[name].role, storagePath: `owner-1/${docId(name)}/${docId(name)}.csv`, sourceProvider: 'supabase_storage',
    });
  });
  return document as unknown as ReferenceDocument;
}
function importOf(name: string): ScheduleItem[] {
  fakeNow(FILES[name].at);
  try {
    return (normalizeScheduleImport({ contents: [HEADER, ...FILES[name].lines].join('\n'), sourceName: `${name}.csv`, mimeType: 'text/csv', projects: [P], projectAreas: [], now: new Date(FILES[name].at) } as never).items as ScheduleItem[])
      .map((item, index) => ({ ...item, id: `${docId(name)}-${index + 1}`, importBatchId: `batch-${docId(name)}`, sourceDocumentId: docId(name), importedAt: FILES[name].at, createdAt: FILES[name].at } as ScheduleItem));
  } finally { jest.useRealTimers(); }
}
type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
function approve(state: State, name: string, pairingChoices: Record<string, string | null> | null = null): State {
  const source = phoneDocument(name);
  const documents = [...state.documents.map(document => (FILES[name].role === 'lookahead' || document.scheduleRole === 'lookahead' ? document : { ...document, isCurrent: false } as ReferenceDocument)), source];
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: importOf(name), completionMatch: () => null, mergeCompletion: (item: ScheduleItem) => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, documents, source.importBatchId || ''),
    overlay: scheduleImportAddsToMaster({ id: source.importBatchId || '', documents: [source] }, state.documents),
    approvedAt: FILES[name].at, pairingChoices,
  } as never);
  return { items: [...merged.additions, ...merged.next], documents };
}
const shownOf = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
function edit(state: State, taskName: string, change: Record<string, unknown>): State {
  const target = shownOf(state).find(item => item.taskName === taskName);
  return { ...state, items: state.items.map(item => (target && item.id === target.id ? { ...item, ...change } as ScheduleItem : item)) };
}
/** What the phone's Delete PDF + Items does (App.tsx; audit-a5-p9-lookahead-delete-hidden-rows). */
function deleteWithItems(state: State, name: string): State {
  const document = state.documents.find(saved => saved.id === docId(name)) as ReferenceDocument;
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents);
  const items = state.items.filter(item => !removed.includes(item));
  const documents = state.documents.filter(saved => saved !== document);
  const saved = scheduleItemsAfterScheduleDeleted({ items, removed, document, documents, updatedAt: '2026-10-14T01:30:00.000Z' });
  const changed = new Map(saved.map(item => [item.id, item]));
  return { items: items.map(item => changed.get(item.id) || item), documents };
}
type World = Readonly<{ saved: ScheduleItem[]; documents: ReferenceDocument[]; shown: ScheduleItem[] }>;
/** His project as both devices hold it once in step. (The phone's own normalizer fills each task's settings: App.tsx normalizeScheduleItem.) */
function larchHollow(): World {
  let state: State = { items: [], documents: [] };
  state = approve(state, 'S1 first full schedule');
  state = edit(state, 'Paint', { priority: 'Low', activity: [{ id: 'act-1', message: 'Primer on site', createdAt: '2026-10-13T23:07:00.000Z', author: 'David' }], updatedAt: '2026-10-13T23:07:00.000Z' });
  state = approve(state, 'S2 newer full schedule');
  state = approve(state, 'S3 full schedule with Paint');
  state = edit(state, 'Paint', { percentComplete: 60, status: 'In Progress', notes: 'paint note', progressSource: 'project_manager', progressConfirmedAt: '2026-10-13T23:22:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-10-13T23:22:00.000Z' });
  state = approve(state, 'S4 full schedule without Paint');
  const before = state.items.filter(item => item.taskName === 'Paint');
  state = approve(state, 'S5 full schedule, Paint back', Object.fromEntries(importOf('S5 full schedule, Paint back').filter(item => item.taskName === 'Paint').map(item => [item.id, before.at(-1)?.id ?? null])));
  state = edit(state, 'Paint', { percentComplete: 65, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-10-14T01:20:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-10-14T01:20:00.000Z' });
  state = approve(state, 'L1 lookahead');
  state = deleteWithItems(state, 'L1 lookahead');
  const items = state.items.map(item => ({ ...item, projectControls: normalizeProjectControls((item as never as { projectControls: unknown }).projectControls) } as ScheduleItem));
  return { saved: items, documents: state.documents, shown: shownOf({ ...state, items }) };
}

const PHONE_AT = '2026-10-14T01:47:00.000Z';   // 18:47 Pacific: the iPhone sends
const DESKTOP_AT = '2026-10-14T03:33:00.000Z'; // 20:33 Pacific: the computer reloads
/** The iPhone's Reports screen, handed its scope as App.tsx hands it (a daily report of one project). */
function phoneTruths(world: World, now: string) {
  fakeNow(now);
  try {
    const scope = buildDailyReportAuthorityScope({
      selectedProjectName: P, selectedProjectNames: [P], projectRecords: [{ id: 'project-larch', name: P }] as never, updates: [], scheduleItems: world.shown,
      currentUpdate: null, projectAreas: [{ id: 'area-site', name: 'Site', projectName: P } as never], knownScheduleItems: world.saved, referenceDocuments: world.documents,
      projectDocuments: [], captureMemories: [], contacts: { contacts: [] },
    } as never);
    const known = (Revisions as never as { scheduleSavedTasksOfProjects: (a: unknown, b: unknown, c: unknown) => ScheduleItem[] }).scheduleSavedTasksOfProjects(world.saved, scope.scheduleItems, scope.projectNames);
    return buildDAVEReportProjectTruths({
      projects: [{ name: P, projectId: 'report:larch-hollow' }], projectRecords: [{ name: P }] as never, updates: scope.updates, scheduleItems: scope.scheduleItems,
      knownScheduleItems: known, knownScheduleDocuments: world.documents, projectAreas: scope.projectAreas, referenceDocuments: scope.referenceDocuments,
    });
  } finally { jest.useRealTimers(); }
}
/** The computer: the cloud's rows as the iPhone uploads them, through the desktop's own loader. */
async function desktopSnapshot(world: World, now: string) {
  mockCloud.rows = {
    projects: [{ id: '3e9b5c1a-7d2f-4a60-8b14-6c0e2f9a1d57', name: P, archived: false, created_at: '2026-10-12T20:00:00.000Z', updated_at: '2026-10-12T20:00:00.000Z', owner_id: 'owner-1', project_data: null }],
    scheduleItems: [...world.saved].reverse().map((item, index) => ({ id: item.id, item_data: json(item), created_at: String(item.createdAt), updated_at: new Date(Date.parse('2026-10-14T01:40:00.000Z') + index * 1000).toISOString() })),
    projectUpdates: [], syncTombstones: [],
    referenceDocuments: world.documents.map(document => {
      const { cloudUpdatedAt: _seen, cloudDetailsSeen: _details, ...sent } = compactECOSDocumentIndexForCloud(document) as ReferenceDocument & Record<string, unknown>;
      return { id: document.id, name: document.name, category: document.category, document_data: json(sent), updated_at: '2026-10-14T01:40:00.000Z' };
    }),
  };
  return { ...(await loadDAVEWebReadOnlySnapshot()), refreshedAt: now, tasksPulledAt: now };
}
/** Every word a report of these truths prints, counted from `previous` (as each device chooses its base). */
function printedFrom(truths: ReturnType<typeof phoneTruths>, world: World, now: string, previous: unknown): string {
  fakeNow(now);
  try {
    const briefing = RI.buildDAVEReportBriefing({ truths, selectedProjectNames: [P], previousSnapshot: previous, scheduleItems: world.saved } as never);
    const draft = buildPIECoreIntelligence({
      runtimeContext: { projectName: P, projectNames: [P], reportType: 'daily_project_update', updates: [], scheduleItems: world.shown, knownScheduleItems: world.saved, currentUpdate: null, projectAreas: [], contacts: { contacts: [] }, referenceDocuments: world.documents, surface: 'reports' } as never,
      reportType: 'daily_project_update' as never, reportProjectNames: [P], organizationId: 'local-unverified-anonymous', projectId: 'project-larch',
    } as never).reportDraft as never;
    const b = briefing;
    return [
      String(RI.enhanceDAVEReportDraft(draft, briefing, 'project_manager').body), String(RI.enhanceDAVEReportDraft(draft, briefing, 'executive').body),
      JSON.stringify([b.conditionLabel, b.executiveSnapshot, b.completedWork, b.currentWork, b.projectConditions, b.schedulePosition, b.criticalRisks, b.decisionsRequired,
        b.recentChanges.map(change => change.summary), b.recentChangeCount, b.reportingPeriod.completeDelta, b.reportingPeriod.openDelta, b.reportingPeriod.overdueDelta, b.whatChanged, b.milestones.map(m => [m.taskName, m.finishDate, m.state]), b.dashboard,
        b.nextActions.map(a => [a.projectName, a.areaName, a.taskName, a.dueDate, a.issue, a.impact, a.action, a.owner, a.timing, a.scheduleImpactDays])]),
      ...(['project_manager', 'executive'] as const).map(format => formatDAVEWebReport(briefing, format).split('\n').filter(text => !/^Generated: /.test(text)).join('\n')),
    ].join('\n=====\n');
  } finally { jest.useRealTimers(); }
}
const onRow = (world: World, id: string, change: (item: ScheduleItem) => ScheduleItem): World => ({
  ...world, saved: world.saved.map(item => (item.id === id ? change(item) : item)), shown: world.shown.map(item => (item.id === id ? change(item) : item)),
});
const named = (world: World, name: string) => world.shown.find(item => item.taskName === name) as ScheduleItem;
const snap = (truths: ReturnType<typeof phoneTruths>, at: string, period: any = null) => buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey([P]), sourceFingerprint: fpOn(truths, period), capturedAt: at, reportFormat: 'project_manager' } as never);
/** The phone approves and sends its report of `world` at `at`, counting from `previous` (sent). */
function phoneSends(world: World, at: string, previous: any) {
  const truths = phoneTruths(world, at);
  const current = snap(truths, at, previous);
  const base = reportBaselineSnapshot(previous, current.sourceFingerprint);
  const text = printedFrom(truths, world, at, base);
  const saved = reportSnapshotToSave(current, previous) ?? previous;
  return { sent: markReportSnapshotDelivered(saved, at, 'iphone-install'), text, fp: current.sourceFingerprint };
}
/** The computer at `at` holding `world` in the cloud, with the shared period `period`: does it say "already sent", and what does it print. */
async function computerSees(world: World, at: string, period: any) {
  const snapshot = await desktopSnapshot(world, at);
  const desk = buildDAVEWebReportTruths(snapshot, P);
  const fp = fpOn(desk, period);
  const base = reportBaselineSnapshot(period, fp);
  const text = printedFrom(desk as never, { saved: snapshot.knownScheduleItems as never, documents: snapshot.referenceDocuments as never, shown: snapshot.scheduleItems as never }, at, base);
  return { alreadySent: daveWebReportAlreadySentElsewhereAt(period, fp, new Set()) !== null, text, fp };
}
/** The phone itself, next look, holding `world`. */
function phoneSees(world: World, at: string, period: any) {
  const truths = phoneTruths(world, at);
  const fp = fpOn(truths, period);
  const text = printedFrom(truths, world, at, reportBaselineSnapshot(period, fp));
  return { alreadySent: sameReportSource(period.sourceFingerprint, fp), text, fp };
}
const firstDiff = (a: string, b: string) => {
  const al = a.split('\n'); const bl = b.split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i += 1) if (al[i] !== bl[i]) return { line: i, sent: al[i] ?? null, now: bl[i] ?? null };
  return null;
};

/** Each morning, 8 am Pacific. */
const M = (day: number) => `2026-10-${String(14 + day).padStart(2, '0')}T15:00:00.000Z`;
/** The phone sends R0 at T0 (Paint at 50), then R1 at T1 counting from R0; the shared period is R1. */
const T0 = '2026-10-14T01:40:00.000Z';
const T1 = '2026-10-14T01:47:00.000Z';
const T2 = '2026-10-14T03:33:00.000Z';
const withPaintAt50 = () => onRow(larchHollow(), named(larchHollow(), 'Paint').id, item => ({ ...item, percentComplete: 50 } as ScheduleItem));
/** What each device says at T2 holding `later`, and the text of the report taken as the one sent. */
async function afterR1(r1: ReturnType<typeof phoneSends>, later: World) {
  const phone = phoneSees(later, T2, r1.sent);
  const computer = await computerSees(later, T2, r1.sent);
  const asSent = printedFrom(phoneTruths(later, T2), later, T2, (r1.sent as { supersedes?: unknown }).supersedes ?? null);
  return { phone: phone.alreadySent, computer: computer.alreadySent, oneValue: phone.fp === computer.fp, readsAsSent: asSent === r1.text };
}

describe('HIGH 1c: "already sent" exactly where the report, taken as the one sent, reads as it', () => {
  const printsNothing: Array<[string, (world: World) => World]> = [
    ['the same records', world => world],
    ['Paint (the latest saved) saved again, nothing changed', world => onRow(world, named(world, 'Paint').id, item => ({ ...item, updatedAt: '2026-10-14T02:10:00.000Z' }))],
    ['H1R-2: Trim (NOT the latest saved) saved again, nothing changed', world => onRow(world, named(world, 'Trim').id, item => ({ ...item, updatedAt: '2026-10-14T02:10:00.000Z' }))],
    ['Fence saved again, nothing changed', world => onRow(world, named(world, 'Fence').id, item => ({ ...item, updatedAt: '2026-10-14T02:12:00.000Z' }))],
    ['Paint\'s settings stamped by another device', world => onRow(world, named(world, 'Paint').id, item => ({ ...item, projectControls: { ...normalizeProjectControls((item as never as { projectControls: unknown }).projectControls), updatedAt: '2026-10-14T02:10:00.000Z', updatedBy: 'ipad', revision: 3 } } as never))],
    ['Paint\'s 65% confirmed again at another minute', world => onRow(world, named(world, 'Paint').id, item => ({ ...item, progressConfirmedAt: '2026-10-14T01:25:00.000Z' }))],
    ['the schedule file\'s notes rewritten', world => ({ ...world, documents: world.documents.map(document => (document.id === 'doc-s5' ? { ...document, notes: 'Pump P-2 and AHU-3 by the gate.' } as ReferenceDocument : document)) })],
  ];
  it.each(printsNothing)('%s: no word of the report, taken as R1, differs; the phone and the computer say "already sent"', async (_name, change) => {
    const r0 = phoneSends(withPaintAt50(), T0, null);
    const r1 = phoneSends(larchHollow(), T1, r0.sent);
    expect(await afterR1(r1, change(larchHollow()))).toEqual({ phone: true, computer: true, oneValue: true, readsAsSent: true });
  });

  it.each([
    ['contractor', { contractor: 'Acme Fencing' }],
    ['next action', { nextAction: 'Order trim stock' }],
    ['baseline finish', { baselineFinishDate: '11/05/2026' }],
  ] as Array<[string, Record<string, unknown>]>)('H1R-1: Trim\'s %s set on the iPad before R0 (no line names it), R1 sent with it; Trim then saved again: R1 would now read "Trim was updated.": not "already sent" on either', async (_name, field) => {
    const w0 = larchHollow();
    const trimId = named(w0, 'Trim').id;
    const withEdit = onRow(w0, trimId, item => ({ ...item, ...field, updatedAt: '2026-10-14T01:35:00.000Z' } as ScheduleItem));
    const r0 = phoneSends(w0, T0, null);
    const r1 = phoneSends(withEdit, T1, r0.sent);
    // Nothing saved again since: R1 itself, on both devices.
    expect(await afterR1(r1, withEdit)).toEqual({ phone: true, computer: true, oneValue: true, readsAsSent: true });
    // Trim saved again with nothing changed: taken as R1 it would print a line R1 never had.
    const resaved = onRow(withEdit, trimId, item => ({ ...item, updatedAt: '2026-10-14T02:10:00.000Z' } as ScheduleItem));
    expect(printedFrom(phoneTruths(resaved, T2), resaved, T2, (r1.sent as { supersedes?: unknown }).supersedes ?? null)).toContain('Larch Hollow: Trim was updated.');
    expect(await afterR1(r1, resaved)).toEqual({ phone: false, computer: false, oneValue: true, readsAsSent: false });
  });

  it('a printed change (Paint 65 -> 70): offered again on both', async () => {
    const r0 = phoneSends(withPaintAt50(), T0, null);
    const r1 = phoneSends(larchHollow(), T1, r0.sent);
    expect(await afterR1(r1, onRow(larchHollow(), named(larchHollow(), 'Paint').id, item => ({ ...item, percentComplete: 70 } as ScheduleItem)))).toEqual({ phone: false, computer: false, oneValue: true, readsAsSent: false });
  });

  it('the reviewer\'s seven mornings (ordinary edits by the phone, the iPad and the computer; the phone sends whenever offered): never "already sent" over another text, never offered with no word changed, on any device', async () => {
    let world = larchHollow();
    let sent: ReturnType<typeof phoneSends>['sent'] | null = null; let sentText = '';
    const at = (day: number, hhmm: string) => `2026-10-${String(14 + day).padStart(2, '0')}T${hhmm}:00.000Z`;
    const edits: Array<[string, (w: World, day: number) => World]> = [
      ['day 0: first report', w => w],
      ['day 1: nothing', w => w],
      ['day 2: the iPad stamps Paint\'s settings', (w, d) => onRow(w, named(w, 'Paint').id, item => ({ ...item, projectControls: { ...normalizeProjectControls((item as never as { projectControls: unknown }).projectControls), updatedAt: at(d, '14:00'), updatedBy: 'ipad', revision: 2 } } as never))],
      ['day 3: the computer saves Fence again with nothing changed', (w, d) => onRow(w, named(w, 'Fence').id, item => ({ ...item, updatedAt: at(d, '14:05') }))],
      ['day 4: the phone sets Fence to 10%', (w, d) => onRow(w, named(w, 'Fence').id, item => ({ ...item, percentComplete: 10, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at(d, '14:10'), progressConfirmedBy: 'David', updatedAt: at(d, '14:10') } as ScheduleItem))],
      ['day 5: the iPad confirms Fence 10% again; the computer saves Trim again', (w, d) => onRow(onRow(w, named(w, 'Fence').id, item => ({ ...item, progressConfirmedAt: at(d, '14:15'), updatedAt: at(d, '14:15') } as ScheduleItem)), named(w, 'Trim').id, item => ({ ...item, updatedAt: at(d, '14:20') }))],
      ['day 6: the schedule file\'s notes typed on the computer', w => ({ ...w, documents: w.documents.map(d => (d.id === 'doc-s5' ? { ...d, notes: 'Owner copy' } as ReferenceDocument : d)) })],
    ];
    const wrong: string[] = [];
    for (let day = 0; day < edits.length; day += 1) {
      world = edits[day][1](world, day);
      const morning = M(day);
      const said: Record<string, { already: boolean; readsAsSent: boolean }> = {};
      for (const device of ['phone', 'iPad']) {
        const truths = phoneTruths(world, morning);
        const fp = fpOn(truths, sent);
        said[device] = { already: Boolean(sent) && sameReportSource((sent as { sourceFingerprint: string }).sourceFingerprint, fp), readsAsSent: Boolean(sent) && printedFrom(truths, world, morning, (sent as { supersedes?: unknown }).supersedes ?? null) === sentText };
      }
      const desk = await desktopSnapshot(world, morning);
      const deskTruths = buildDAVEWebReportTruths(desk, P);
      said.computer = {
        already: Boolean(sent) && daveWebReportAlreadySentElsewhereAt(sent as never, fpOn(deskTruths, sent), new Set()) !== null,
        readsAsSent: Boolean(sent) && printedFrom(deskTruths as never, { saved: desk.knownScheduleItems as never, documents: desk.referenceDocuments as never, shown: desk.scheduleItems as never }, morning, (sent as { supersedes?: unknown }).supersedes ?? null) === sentText,
      };
      if (sent) Object.entries(said).forEach(([device, verdict]) => { if (verdict.already !== verdict.readsAsSent) wrong.push(`${edits[day][0]}: the ${device} ${verdict.already ? 'says "already sent" over another text' : 'offers it again with no word changed'}`); });
      if (!sent || !said.phone.already) {
        const report = phoneSends(world, morning, sent);
        sent = report.sent; sentText = report.text;
      }
    }
    expect(wrong).toEqual([]);
  });
});

/** Every word each device prints of a report: the phone (its written report in both formats, its Reports preview) and the computer (its page and its report). */
function printedByDevice(truths: ReturnType<typeof phoneTruths>, world: World, now: string, previous: unknown): { phone: string; computer: string } {
  const all = printedFrom(truths, world, now, previous).split('\n=====\n');
  // printedFrom: [phone PM body, phone executive body, the briefing's printed fields (the preview and the page), desktop PM, desktop executive].
  return { phone: [all[0], all[1], all[2]].join('\n=====\n'), computer: [all[2], all[3], all[4]].join('\n=====\n') };
}
const ALTERNATE: Record<string, unknown[]> = {
  status: ['In Progress', 'Waiting', 'Not Started', 'Complete'], priority: ['High', 'Low', 'Medium'], category: ['Schedules', 'Drawings'], scheduleRole: ['lookahead', 'full'],
  progressSource: ['schedule_import', 'project_manager'],
};
function changedValue(key: string, value: unknown): unknown {
  const options = ALTERNATE[key];
  if (options) return options.find(option => option !== value);
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(Date.parse(value) + 3_600_000).toISOString();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value.replace(/^(\d{2})\/(\d{2})/, (_all, month, day) => `${month}/${String(Math.min(28, Number(day) + 1)).padStart(2, '0')}`);
    return value ? `${value} Crane on site Friday.` : 'Crane on site Friday.';
  }
  if (typeof value === 'number') return value + 7;
  if (typeof value === 'boolean') return !value;
  if (value === null || value === undefined) return 'Crane on site Friday.';
  return value;
}

describe('HIGH 1c: every field, one at a time, after a real period: no "already sent" over another text and no offer with no word changed, by device', () => {
  it('every field of every saved task (shown and hidden) and every schedule file', async () => {
    const r0 = phoneSends(withPaintAt50(), T0, null);
    const r1 = phoneSends(larchHollow(), T1, r0.sent);
    const sentText = printedByDevice(phoneTruths(larchHollow(), T1), larchHollow(), T1, (r1.sent as { supersedes?: unknown }).supersedes ?? null);
    const tally = { tried: 0, readDifferently: 0 };
    const slips: string[] = [];
    const offeredWithNoWord = new Set<string>();
    const tryIt = async (what: string, later: World, kind: string) => {
      tally.tried += 1;
      const phoneSaid = phoneSees(later, T2, r1.sent).alreadySent;
      const snapshot = await desktopSnapshot(later, T2);
      const desk = buildDAVEWebReportTruths(snapshot, P);
      const computerSaid = daveWebReportAlreadySentElsewhereAt(r1.sent as never, fpOn(desk, r1.sent), new Set()) !== null;
      const supersedes = (r1.sent as { supersedes?: unknown }).supersedes ?? null;
      const onPhone = printedByDevice(phoneTruths(later, T2), later, T2, supersedes).phone === sentText.phone;
      const onComputer = printedByDevice(desk as never, { saved: snapshot.knownScheduleItems as never, documents: snapshot.referenceDocuments as never, shown: snapshot.scheduleItems as never }, T2, supersedes).computer === sentText.computer;
      if (!onPhone || !onComputer) tally.readDifferently += 1;
      for (const [device, said, same] of [['phone', phoneSaid, onPhone], ['computer', computerSaid, onComputer]] as const) {
        if (said && !same) slips.push(`${what}: the ${device} says "already sent" over another text`);
        // A value both devices share: it moves where EITHER device's words move.
        if (!said && onPhone && onComputer) offeredWithNoWord.add(kind);
      }
    };
    const world = larchHollow();
    const shownIds = new Set(world.shown.map(item => item.id));
    for (const row of world.saved) {
      for (const key of [...new Set([...Object.keys(row), 'contractor', 'nextAction', 'baselineFinishDate', 'notes', 'priority', 'milestone', 'updatedAt'])].filter(key => key !== 'id' && key !== 'projectControls')) {
        const value = (row as unknown as Record<string, unknown>)[key];
        if (value !== null && typeof value === 'object') continue;
        await tryIt(`task ${row.taskName} [${row.id}], ${key}`, onRow(world, row.id, item => ({ ...item, [key]: changedValue(key, value) } as ScheduleItem)), `${shownIds.has(row.id) ? 'a task' : 'a hidden earlier row'}: ${key}`);
      }
    }
    for (const document of world.documents) {
      for (const key of Object.keys(document).filter(key => !['id', 'uri', 'storagePath', 'sourceProvider'].includes(key))) {
        const value = (document as unknown as Record<string, unknown>)[key];
        if (value !== null && typeof value === 'object') continue;
        await tryIt(`schedule file ${document.name}, ${key}`, { ...world, documents: world.documents.map(other => (other.id === document.id ? { ...other, [key]: changedValue(key, value) } as ReferenceDocument : other)) }, `a schedule file: ${key}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`every field after a real period: ${JSON.stringify(tally)}; "already sent" over another text: ${slips.length}\n${slips.join('\n')}\noffered with no word changed, by kind: ${[...offeredWithNoWord].sort().join(' | ')}`);
    expect(tally.tried).toBeGreaterThan(60);
    expect(tally.readDifferently).toBeGreaterThan(10);
    // Never "already sent" over another text, on either device.
    expect(slips).toEqual([]);
    // No saved time and no confirmation time ever offers it with no word changed (HIGH 1b, 1c) ...
    expect([...offeredWithNoWord].filter(kind => /: (updatedAt|progressConfirmedAt|createdAt)$/.test(kind))).toEqual([]);
    // ... and what does is pinned by name: record facts 3.0 holds on purpose since High 1 (every record a report is
    // made from) that THIS report happens to print nowhere. Nothing joins the list unseen.
    expect([...offeredWithNoWord].sort()).toEqual(KNOWN_RECORD_FACTS_PRINTED_NOWHERE_HERE);
  });
});

/**
 * Record facts that move 3.0 and that this report (his project, no field updates) prints nowhere on either device: a
 * task's start date, contractor (an owner is set), next action, notes, milestone name, baseline finish, import time,
 * who confirmed its percent and where the percent came from; the hidden earlier row of the task that came back (R8 item
 * 3, left as it was in 1b); the current schedule file's import time and file name. Each prints in other reports (a schedule line of WORK AREAS, ACTION PLAN, MILESTONES, a project's position,
 * "is back ... from 60%", "Schedules document added: <file>"): 3.0 holds every record a report is made from (High 1,
 * D2). Not saved times; not this item.
 */
const KNOWN_RECORD_FACTS_PRINTED_NOWHERE_HERE: readonly string[] = [
  'a hidden earlier row: finishDate',
  'a hidden earlier row: importedAt',
  'a hidden earlier row: locationName',
  'a hidden earlier row: owner',
  'a hidden earlier row: percentComplete',
  'a hidden earlier row: projectName',
  'a hidden earlier row: status',
  'a hidden earlier row: taskName',
  'a schedule file: importedAt',
  'a schedule file: originalFileName',
  'a task: baselineFinishDate',
  'a task: contractor',
  'a task: importedAt',
  'a task: milestone',
  'a task: nextAction',
  'a task: notes',
  'a task: progressConfirmedBy',
  'a task: progressSource',
  'a task: startDate',
];
