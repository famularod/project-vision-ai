/**
 * HIGH item 1b (open item 7.46; the owner's instruction of 13 Oct 2026, the three high items; the coordinator's
 * decision on the follow-up): the iPhone sent a report, and the computer did not take it for the report on its
 * screen, although no word of it read differently.
 *
 * His project (made-up names here, his shape): three tasks from a full schedule brought in five times (the third task
 * leaves and comes back, "the same task"), his own percent on it, a lookahead brought in and deleted with its items.
 * For the same records the iPhone and the computer work out one value, whatever the hour. But some records are saved
 * again with nothing a report prints changed, and version 3.0 of the fingerprint held them:
 *   1. a task saved again later, nothing else changed (its saved time);
 *   2. a task's settings stamped by another device (who saved them last);
 *   3. the same percent confirmed again at another minute (an open task's confirmation time);
 *   4. the hidden earlier row of a task that came back, given back another percent by the lookahead's delete;
 *   5. a schedule file's notes rewritten.
 * Now each is held only where and as a report prints it: 2, 3 and 5 not at all (3: for an open task; a completed
 * task's confirmation is Completed Work's "Last updated"), 1 only as the ORDER of the "since the last report" lines it
 * decides (and, for a completed task, as it was). 4 is left as it was: whether its line prints depends on the last report
 * sent, which the fingerprint is worked out before and without (see the case).
 * The iPhone's records at 18:47 against the cloud's at 20:33, through the desktop's own loader: the computer says
 * "already sent" exactly where the phone's and the desktop's printed text is the same. Synthetic data, no network.
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
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered } from '../../services/DAVEReportSnapshot';
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

/** Every word a report of these truths prints: the phone's written report (both formats, the app's own draft), the Reports preview, the desktop's page and its report. */
function printed(truths: ReturnType<typeof phoneTruths>, world: World, now: string): string {
  fakeNow(now);
  try {
    const briefing = RI.buildDAVEReportBriefing({ truths, selectedProjectNames: [P], previousSnapshot: null, scheduleItems: world.saved } as never);
    const draft = buildPIECoreIntelligence({
      runtimeContext: { projectName: P, projectNames: [P], reportType: 'daily_project_update', updates: [], scheduleItems: world.shown, knownScheduleItems: world.saved, currentUpdate: null, projectAreas: [], contacts: { contacts: [] }, referenceDocuments: world.documents, surface: 'reports' } as never,
      reportType: 'daily_project_update' as never, reportProjectNames: [P], organizationId: 'local-unverified-anonymous', projectId: 'project-larch',
    } as never).reportDraft as never;
    const b = briefing;
    return [
      String(RI.enhanceDAVEReportDraft(draft, briefing, 'project_manager').body), String(RI.enhanceDAVEReportDraft(draft, briefing, 'executive').body),
      JSON.stringify([b.conditionLabel, b.executiveSnapshot, b.completedWork, b.currentWork, b.projectConditions, b.schedulePosition, b.criticalRisks, b.decisionsRequired,
        b.recentChanges.map(change => change.summary), b.whatChanged, b.milestones.map(m => [m.taskName, m.finishDate, m.state]), b.dashboard,
        b.nextActions.map(a => [a.projectName, a.areaName, a.taskName, a.dueDate, a.issue, a.impact, a.action, a.owner, a.timing, a.scheduleImpactDays])]),
      ...(['project_manager', 'executive'] as const).map(format => formatDAVEWebReport(briefing, format).split('\n').filter(text => !/^Generated: /.test(text)).join('\n')),
    ].join('\n=====\n');
  } finally { jest.useRealTimers(); }
}

/** The iPhone sends at 18:47; the computer reloads at 20:33 holding `cloud`. What each reads, and what the computer says. */
async function iPhoneThenComputer(cloud: World) {
  const iPhone = larchHollow();
  const phone = phoneTruths(iPhone, PHONE_AT);
  const sent = markReportSnapshotDelivered({
    ...buildDAVEReportSnapshot({ truths: phone, scopeKey: daveReportSnapshotScopeKey([P]), sourceFingerprint: RI.buildDAVEReportSourceFingerprint(phone), capturedAt: PHONE_AT, reportFormat: 'project_manager' }),
    deliveredAt: null,
  }, PHONE_AT, 'iphone-install');
  const snapshot = await desktopSnapshot(cloud, DESKTOP_AT);
  const desk = buildDAVEWebReportTruths(snapshot, P);
  const deskFingerprint = RI.buildDAVEReportSourceFingerprint(desk);
  return {
    samePrinted: printed(phone, iPhone, PHONE_AT) === printed(desk as never, { saved: snapshot.knownScheduleItems as never, documents: snapshot.referenceDocuments as never, shown: snapshot.scheduleItems as never }, DESKTOP_AT),
    alreadySent: daveWebReportAlreadySentElsewhereAt(sent, deskFingerprint, new Set()) !== null,
  };
}
const onRow = (world: World, id: string, change: (item: ScheduleItem) => ScheduleItem): World => ({
  ...world, saved: world.saved.map(item => (item.id === id ? change(item) : item)), shown: world.shown.map(item => (item.id === id ? change(item) : item)),
});
const paintOf = (world: World) => world.shown.find(item => item.taskName === 'Paint') as ScheduleItem;
const trimOf = (world: World) => world.shown.find(item => item.taskName === 'Trim') as ScheduleItem;
const earlierPaintRow = (world: World) => world.saved.find(item => item.taskName === 'Paint' && item.id !== paintOf(world).id && Number(item.percentComplete) === 60) as ScheduleItem;

describe('HIGH 1b: the iPhone\'s 18:47 records against the cloud\'s at 20:33: "already sent" exactly where no word reads differently', () => {
  it('the same records: the same words and "already sent", whatever the hour (the clock and the device move nothing)', async () => {
    expect(await iPhoneThenComputer(larchHollow())).toEqual({ samePrinted: true, alreadySent: true });
  });

  const printsNothing: Array<[string, (world: World) => World]> = [
    ['1. the open task saved again later, nothing else changed (its saved time)', world => onRow(world, paintOf(world).id, item => ({ ...item, updatedAt: '2026-10-14T02:10:00.000Z' }))],
    ['2. the task\'s settings stamped by another device (who saved them last, when, its revision)', world => onRow(world, paintOf(world).id, item => ({ ...item, projectControls: { ...normalizeProjectControls((item as never as { projectControls: unknown }).projectControls), updatedAt: '2026-10-14T02:10:00.000Z', updatedBy: 'ipad', revision: 3 } } as never))],
    ['3. the same 65% confirmed again at another minute', world => onRow(world, paintOf(world).id, item => ({ ...item, progressConfirmedAt: '2026-10-14T01:25:00.000Z' }))],
    ['5. the current schedule file\'s notes rewritten', world => ({ ...world, documents: world.documents.map(document => (document.id === 'doc-s5' ? { ...document, notes: 'Brought in on the iPhone. Pump P-2 and AHU-3 by the gate.' } as ReferenceDocument : document)) })],
  ];
  it.each(printsNothing)('%s: no word reads differently, and the computer says "already sent"', async (_name, change) => {
    expect(await iPhoneThenComputer(change(larchHollow()))).toEqual({ samePrinted: true, alreadySent: true });
  });

  it('4. LEFT AS IT WAS: the hidden earlier row of the task that came back, given back another percent. No word differs today, and the computer does not say "already sent": the line that reads it ("Paint is back in the project plan ... from 60%") prints only against a report sent while Paint was off the schedule, and the fingerprint is worked out before, and without, the report it counts from', async () => {
    expect(await iPhoneThenComputer(onRow(larchHollow(), earlierPaintRow(larchHollow()).id, item => ({ ...item, percentComplete: 50 } as ScheduleItem)))).toEqual({ samePrinted: true, alreadySent: false });
  });

  const printsAWord: Array<[string, (world: World) => World]> = [
    ['the deleted lookahead still in the cloud (its file and Paint at 60% on its dates)', world => ({ ...world, documents: [...world.documents, { ...phoneDocument('L1 lookahead'), isCurrent: true } as ReferenceDocument] })],
    ['another task saved after Paint: the order of the "since the last report" lines changes', world => onRow(world, trimOf(world).id, item => ({ ...item, updatedAt: '2026-10-14T02:10:00.000Z' }))],
    ['Paint\'s percent changed (65 -> 70)', world => onRow(world, paintOf(world).id, item => ({ ...item, percentComplete: 70 } as ScheduleItem))],
  ];
  it.each(printsAWord)('%s: a word differs, and the computer offers the report again', async (_name, change) => {
    expect(await iPhoneThenComputer(change(larchHollow()))).toEqual({ samePrinted: false, alreadySent: false });
  });

  it('a COMPLETED task confirmed again on another day: Completed Work\'s "Last updated" reads differently, and the fingerprint moves', () => {
    const world = larchHollow();
    const done = onRow(world, trimOf(world).id, item => ({ ...item, percentComplete: 100, status: 'Complete', progressSource: 'project_manager', progressConfirmedAt: '2026-10-13T20:00:00.000Z', progressConfirmedBy: 'David' } as ScheduleItem));
    const later = onRow(done, trimOf(done).id, item => ({ ...item, progressConfirmedAt: '2026-10-12T20:00:00.000Z' } as ScheduleItem));
    const one = phoneTruths(done, PHONE_AT);
    const two = phoneTruths(later, PHONE_AT);
    expect(printed(two, later, PHONE_AT)).not.toBe(printed(one, done, PHONE_AT));
    expect(RI.buildDAVEReportSourceFingerprint(two)).not.toBe(RI.buildDAVEReportSourceFingerprint(one));
  });
});
