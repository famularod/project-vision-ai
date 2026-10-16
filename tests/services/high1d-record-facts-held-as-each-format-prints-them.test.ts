/**
 * HIGH item 1d (open item 7.55; the coordinator's decision on HIGH 1c's point 1; the owner's instruction of 13 Oct
 * 2026, the three high items). After 1c, 19 kinds of record fact still offered a report again with no word changed
 * (a task's start date, contractor, next action, notes, milestone name, baseline finish, import time, who confirmed
 * its percent and where the percent came from; the 8 fields of a task's hidden earlier row; a schedule file's import
 * time and file name): 3.0 held every record a report is made from, whatever the report's format printed of it.
 *
 * Now 3.0 is the report of ONE format (each format has its own period, owner answer Q17), and holds what that report
 * prints, on every device: for each format F,
 *   the phone   = its written report of F (what Copy, Email, Text, Outlook and the Word file carry) and its Reports
 *                 screen in F (the overview, and for the Project Manager report the Work Areas & Photos panel);
 *   the desktop = its report of F (what it saves, sends and downloads).
 *   "already sent" on a device  <=>  the report, taken as the one sent (counted from what that one counted from),
 *                                    reads word for word as the one sent, on the phone and on the desktop.
 * A change the format does not print leaves it alone; a change it prints moves it. Shown on his project's shape (the
 * reviewer's Larch Hollow rig, a real period), on a project where these facts DO print (Wren Point: an overdue task
 * with a contractor and a next action, a baseline, a milestone, a waiting task, notes that read as a problem, a field
 * update with photos), and on the combined report of both. With M2's new lines (photo numbers, "is back in the
 * project plan", the edited text) as printed facts. `fpOn` asks the app with the format; on a build without it the
 * format is not heard (the build before: red where the fault is). Synthetic data, made-up names, no network.
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
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSentText, reportSnapshotToSave, sameReportSource } from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportSource, buildDAVEWebReportTruths, formatDAVEWebReport } from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebReportAlreadySentElsewhereAt } from '../../services/DAVEWebReportPeriod';
import { compactECOSDocumentIndexForCloud, referenceDocumentsCitedAsListed } from '../../services/ECOSDocumentIndexPersistence';
import { buildAutomaticReportDrawingReferences } from '../../services/ReportDrawingReferences';
import { desktopOutputs, phoneOutputs, type ReportOutputDraft } from '../fixtures/report-every-output';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { buildPIEReportDraft } from '../../services/PIEReporter';
import type { DAVEWrittenScheduleLine } from '../../services/ReportScheduleLine';
/** The copy of the writer's rule (a module of HIGH 1d; absent on a build before it, where this one test is red). */
const scheduleLineAsWritten = (item: ScheduleItem): DAVEWrittenScheduleLine =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../../services/ReportScheduleLine').scheduleLineAsWritten(item);
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { buildCombinedReportAuthorityScope, buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleImportAddsToMaster, scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import * as Revisions from '../../services/ScheduleTaskRevisions';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';

type Format = 'project_manager' | 'executive';
const FORMATS: readonly Format[] = ['project_manager', 'executive'];
const fpOn = (truths: unknown, period: unknown, format: Format): string =>
  (RI.buildDAVEReportSourceOnPeriod as unknown as (t: unknown, p: unknown, f: Format) => { fingerprint: string })(truths, period, format).fingerprint;
jest.setTimeout(900_000);
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const fakeNow = (now: string) => jest.useFakeTimers({ now: Date.parse(now), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });

// ---- the projects (made-up names), built with the app's own import, merge and Delete PDF + Items ----
const LARCH = 'Larch Hollow';
const WREN = 'Wren Point';
const HERON = 'Heron Bank';
const PROJECT_IDS: Record<string, string> = { [LARCH]: '3e9b5c1a-7d2f-4a60-8b14-6c0e2f9a1d57', [WREN]: '8a41d2c7-5b3e-4f19-9c60-2d7e1b4a8f03', [HERON]: 'c5d0e7a2-1f4b-4c38-a96e-0b2f7d3e5a19' };
const AREAS = [{ id: 'area-site', name: 'Site', projectName: LARCH }, { id: 'area-lot', name: 'Lot', projectName: WREN }, { id: 'area-bank', name: 'Bank', projectName: HERON }];
const HEADER = 'Task,Project,Location,Start,Finish,Owner,Status,Percent Complete,Notes';
const row = (project: string, area: string) => (task: string, start: string, finish: string, owner = 'Ines', status = 'Not Started', percent = '', notes = '') =>
  `${task},${project},${area},${start},${finish},${owner},${status},${percent},${notes}`;
const larchLine = row(LARCH, 'Site');
const wrenLine = row(WREN, 'Lot');
const heronLine = row(HERON, 'Bank');
type FileOf = Readonly<{ project: string; at: string; role: 'full' | 'lookahead'; lines: string[] }>;
const FILES: Record<string, FileOf> = {
  'S1 first full schedule': { project: LARCH, at: '2026-10-13T23:05:00.000Z', role: 'full', lines: [larchLine('Paint', '10/26/2026', '10/30/2026'), larchLine('Trim', '11/02/2026', '11/06/2026'), larchLine('Fence', '11/09/2026', '11/13/2026')] },
  'S2 newer full schedule': { project: LARCH, at: '2026-10-13T23:09:00.000Z', role: 'full', lines: [larchLine('Paint', '10/15/2026', '10/19/2026'), larchLine('Trim', '11/02/2026', '11/06/2026'), larchLine('Fence', '11/09/2026', '11/13/2026')] },
  'S3 full schedule with Paint': { project: LARCH, at: '2026-10-13T23:20:00.000Z', role: 'full', lines: [larchLine('Paint', '10/27/2026', '10/30/2026'), larchLine('Trim', '11/02/2026', '11/06/2026'), larchLine('Fence', '11/09/2026', '11/13/2026')] },
  'S4 full schedule without Paint': { project: LARCH, at: '2026-10-13T23:24:00.000Z', role: 'full', lines: [larchLine('Trim', '11/02/2026', '11/06/2026'), larchLine('Fence', '11/09/2026', '11/13/2026')] },
  'S5 full schedule, Paint back': { project: LARCH, at: '2026-10-13T23:28:00.000Z', role: 'full', lines: [larchLine('Paint', '11/16/2026', '11/20/2026'), larchLine('Trim', '11/02/2026', '11/06/2026'), larchLine('Fence', '11/09/2026', '11/13/2026')] },
  'L1 lookahead': { project: LARCH, at: '2026-10-14T01:22:00.000Z', role: 'lookahead', lines: [larchLine('Paint', '10/16/2026', '10/20/2026', 'Ines', 'In Progress', '60')] },
  'W1 Wren master': {
    project: WREN, at: '2026-10-01T16:00:00.000Z', role: 'full', lines: [
      wrenLine('Survey', '10/01/2026', '10/09/2026', '', 'In Progress', '30'),
      wrenLine('Footings', '10/12/2026', '10/16/2026', 'Ines', 'In Progress', '20'),
      wrenLine('Permit sign-off', '10/28/2026', '10/30/2026', 'City', 'Not Started', '0'),
      wrenLine('Utilities', '10/20/2026', '11/20/2026', '', 'Waiting', '10'),
      wrenLine('Grading', '09/20/2026', '09/30/2026', 'Ines', 'Complete', '100'),
    ],
  },
  'H1 Heron master': {
    project: HERON, at: '2026-09-15T16:00:00.000Z', role: 'full', lines: [
      ...[1, 2, 3, 4, 5, 6].map(n => heronLine(`Trench ${n}`, '09/20/2026', `10/0${n}/2026`, '', 'In Progress', '10')),
      ...[1, 2, 3, 4, 5, 6].map(n => heronLine(`Gate ${n}`, '11/01/2026', `11/1${n}/2026`, 'Ines', 'Not Started', '0')),
    ],
  },
};
const docId = (name: string) => `doc-${name.split(' ')[0].toLowerCase()}`;
function phoneDocument(name: string): ReferenceDocument {
  let document: ReferenceDocument | null = null;
  const file = FILES[name];
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    document = require('../../services/ReferenceDocumentRepository').normalizeReferenceDocument({
      id: docId(name), name, originalFileName: `${name}.csv`, uri: `file:///var/mobile/Containers/Data/Application/PHONE/Documents/project-documents/${docId(name)}.csv`,
      category: 'Schedules', notes: '', isCurrent: true, importedAt: file.at, projectName: file.project, projectNames: [file.project], importBatchId: `batch-${docId(name)}`,
      scheduleRole: file.role, storagePath: `owner-1/${docId(name)}/${docId(name)}.csv`, sourceProvider: 'supabase_storage',
    });
  });
  return document as unknown as ReferenceDocument;
}
function importOf(name: string): ScheduleItem[] {
  const file = FILES[name];
  fakeNow(file.at);
  try {
    return (normalizeScheduleImport({ contents: [HEADER, ...file.lines].join('\n'), sourceName: `${name}.csv`, mimeType: 'text/csv', projects: [file.project], projectAreas: [], now: new Date(file.at) } as never).items as ScheduleItem[])
      .map((item, index) => ({ ...item, id: `${docId(name)}-${index + 1}`, importBatchId: `batch-${docId(name)}`, sourceDocumentId: docId(name), importedAt: file.at, createdAt: file.at } as ScheduleItem));
  } finally { jest.useRealTimers(); }
}
type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
function approve(state: State, name: string, pairingChoices: Record<string, string | null> | null = null): State {
  const source = phoneDocument(name);
  const sameProject = (document: ReferenceDocument) => document.projectName === FILES[name].project;
  const documents = [...state.documents.map(document => (!sameProject(document) || FILES[name].role === 'lookahead' || document.scheduleRole === 'lookahead' ? document : { ...document, isCurrent: false } as ReferenceDocument)), source];
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: importOf(name), completionMatch: () => null, mergeCompletion: (item: ScheduleItem) => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, documents, source.importBatchId || ''),
    overlay: scheduleImportAddsToMaster({ id: source.importBatchId || '', documents: [source] }, state.documents),
    approvedAt: FILES[name].at, pairingChoices,
  } as never);
  return { items: [...merged.additions, ...merged.next], documents };
}
const shownOf = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
function edit(state: State, taskName: string, change: Record<string, unknown>, project = LARCH): State {
  const target = shownOf(state).find(item => item.taskName === taskName && item.projectName === project);
  return { ...state, items: state.items.map(item => (target && item.id === target.id ? { ...item, ...change } as ScheduleItem : item)) };
}
function deleteWithItems(state: State, name: string): State {
  const document = state.documents.find(saved => saved.id === docId(name)) as ReferenceDocument;
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents);
  const items = state.items.filter(item => !removed.includes(item));
  const documents = state.documents.filter(saved => saved !== document);
  const saved = scheduleItemsAfterScheduleDeleted({ items, removed, document, documents, updatedAt: '2026-10-14T01:30:00.000Z' });
  const changed = new Map(saved.map(item => [item.id, item]));
  return { items: items.map(item => changed.get(item.id) || item), documents };
}
type World = Readonly<{ saved: ScheduleItem[]; documents: ReferenceDocument[]; shown: ScheduleItem[]; updates: ProjectUpdate[] }>;
const finished = (state: State, updates: ProjectUpdate[] = []): World => {
  const items = state.items.map(item => ({ ...item, projectControls: normalizeProjectControls((item as never as { projectControls: unknown }).projectControls) } as ScheduleItem));
  return { saved: items, documents: state.documents, shown: shownOf({ ...state, items }), updates };
};
/** His project at each stage the reviewer built it: after S3 (Paint at 60%), after S4 (Paint out), and at the end. */
function larchStages(): { withPaint: World; paintOut: World; end: World } {
  let state: State = { items: [], documents: [] };
  state = approve(state, 'S1 first full schedule');
  state = edit(state, 'Paint', { priority: 'Low', activity: [{ id: 'act-1', message: 'Primer on site', createdAt: '2026-10-13T23:07:00.000Z', author: 'David' }], updatedAt: '2026-10-13T23:07:00.000Z' });
  state = approve(state, 'S2 newer full schedule');
  state = approve(state, 'S3 full schedule with Paint');
  state = edit(state, 'Paint', { percentComplete: 60, status: 'In Progress', notes: 'paint note', progressSource: 'project_manager', progressConfirmedAt: '2026-10-13T23:22:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-10-13T23:22:00.000Z' });
  const withPaint = finished(state);
  state = approve(state, 'S4 full schedule without Paint');
  const paintOut = finished(state);
  const before = state.items.filter(item => item.taskName === 'Paint');
  state = approve(state, 'S5 full schedule, Paint back', Object.fromEntries(importOf('S5 full schedule, Paint back').filter(item => item.taskName === 'Paint').map(item => [item.id, before.at(-1)?.id ?? null])));
  state = edit(state, 'Paint', { percentComplete: 65, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-10-14T01:20:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-10-14T01:20:00.000Z' });
  state = approve(state, 'L1 lookahead');
  state = deleteWithItems(state, 'L1 lookahead');
  return { withPaint, paintOut, end: finished(state) };
}
const larchHollow = (): World => larchStages().end;
const photo = (id: string, caption: string, extra: Record<string, unknown> = {}) => ({
  id, uri: `file:///p/${id}.jpg`, caption, category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open', createdAt: '2026-10-13T18:00:00.000Z', ...extra,
});
/** A project where the record facts print: imported, then set on the iPad as he sets them; one field update with photos. */
function wrenPoint(): World {
  let state: State = { items: [], documents: [] };
  state = approve(state, 'W1 Wren master');
  state = edit(state, 'Survey', { contractor: 'Pike Surveying', nextAction: 'Re-stake the east line.', notes: 'Benchmark was damaged; the survey must be redone.' }, WREN);
  state = edit(state, 'Footings', { baselineFinishDate: '10/15/2026' }, WREN);
  state = edit(state, 'Permit sign-off', { isMilestone: true, milestone: 'Permit', priority: 'High' }, WREN);
  state = edit(state, 'Utilities', { contractor: 'Volt Co' }, WREN);
  state = edit(state, 'Grading', { progressSource: 'project_manager', progressConfirmedAt: '2026-10-02T16:00:00.000Z', progressConfirmedBy: 'David' }, WREN);
  const updates = [{
    id: 'wu1', projectName: WREN, date: '2026-10-13', notes: 'Forms were set for the north footings.', status: 'sent', selectedAreaName: 'Lot', recipients: { contactIds: [] },
    photos: [photo('wp1', 'North footing forms'), photo('wp2', '')],
  }, {
    id: 'wu2', projectName: WREN, date: '2026-10-12', notes: '', status: 'sent', selectedAreaName: '', recipients: { contactIds: [] },
    photos: [photo('wp3', 'Neighbor fence line')],
  }] as unknown as ProjectUpdate[];
  return finished(state, updates);
}
/** Six overdue tasks, each with a contractor (no owner) and a next action, and six milestones: more than the Executive report prints. */
function heronBank(): World {
  let state: State = { items: [], documents: [] };
  state = approve(state, 'H1 Heron master');
  for (const n of [1, 2, 3, 4, 5, 6]) {
    state = edit(state, `Trench ${n}`, { contractor: `Crew ${n}`, nextAction: `Call crew ${n} back.` }, HERON);
    state = edit(state, `Gate ${n}`, { isMilestone: true }, HERON);
  }
  return finished(state);
}
const both = (left: World, right: World): World => ({
  saved: [...left.saved, ...right.saved], documents: [...left.documents, ...right.documents], shown: [...left.shown, ...right.shown], updates: [...left.updates, ...right.updates],
});

// ---- the devices ----
const slug = (name: string) => name.toLowerCase().replace(/\s+/g, '-');
/** The iPhone's Reports screen, handed its scope as App.tsx hands it (a daily report of one project, or a combined one). */
function phoneTruths(world: World, now: string, names: readonly string[]) {
  fakeNow(now);
  try {
    const input = {
      selectedProjectNames: names, projectRecords: names.map(name => ({ id: `project-${slug(name)}`, name })) as never, updates: world.updates, scheduleItems: world.shown,
      currentUpdate: null, projectAreas: AREAS as never, knownScheduleItems: world.saved, referenceDocuments: world.documents,
      projectDocuments: [], captureMemories: [], contacts: { contacts: [] },
    };
    const scope = names.length > 1
      ? buildCombinedReportAuthorityScope(input as never)
      : buildDailyReportAuthorityScope({ ...input, selectedProjectName: names[0] } as never);
    const known = (Revisions as never as { scheduleSavedTasksOfProjects: (a: unknown, b: unknown, c: unknown) => ScheduleItem[] }).scheduleSavedTasksOfProjects(world.saved, scope.scheduleItems, scope.projectNames);
    return buildDAVEReportProjectTruths({
      projects: names.map(name => ({ name, projectId: `report:${slug(name)}` })), projectRecords: names.map(name => ({ name })) as never, updates: scope.updates, scheduleItems: scope.scheduleItems,
      knownScheduleItems: known, knownScheduleDocuments: world.documents, projectAreas: scope.projectAreas, referenceDocuments: scope.referenceDocuments,
    });
  } finally { jest.useRealTimers(); }
}
/** The computer: the cloud's rows as the iPhone uploads them, through the desktop's own loader. */
async function desktopSnapshot(world: World, now: string, names: readonly string[]) {
  mockCloud.rows = {
    projects: names.map(name => ({ id: PROJECT_IDS[name], name, archived: false, created_at: '2026-10-01T20:00:00.000Z', updated_at: '2026-10-01T20:00:00.000Z', owner_id: 'owner-1', project_data: null })),
    scheduleItems: [...world.saved].reverse().map((item, index) => ({ id: item.id, item_data: json(item), created_at: String(item.createdAt), updated_at: new Date(Date.parse('2026-10-14T01:40:00.000Z') + index * 1000).toISOString() })),
    projectUpdates: world.updates.map(update => ({ id: update.id, project_name: update.projectName, update_data: json(update), created_at: '2026-10-13T18:00:00.000Z', updated_at: '2026-10-13T18:00:00.000Z' })),
    syncTombstones: [],
    referenceDocuments: world.documents.map(document => {
      const { cloudUpdatedAt: _seen, cloudDetailsSeen: _details, ...sent } = compactECOSDocumentIndexForCloud(document) as ReferenceDocument & Record<string, unknown>;
      return { id: document.id, name: document.name, category: document.category, document_data: json(sent), updated_at: '2026-10-14T01:40:00.000Z' };
    }),
  };
  return { ...(await loadDAVEWebReadOnlySnapshot()), refreshedAt: now, tasksPulledAt: now };
}
type Desk = Awaited<ReturnType<typeof desktopSnapshot>>;
const deskTruthsOf = (desk: Desk, names: readonly string[]) => buildDAVEWebReportTruths(desk, names.length > 1 ? null : names[0]);
const deskWorld = (desk: Desk): World => ({ saved: desk.knownScheduleItems as never, documents: desk.referenceDocuments as never, shown: desk.scheduleItems as never, updates: desk.projectUpdates.map(record => record.updateData) as never });

type Draft = Readonly<{ body: string; locationGroups: ReadonlyArray<{ title: string; workAreas: ReadonlyArray<{ title: string; bullets: ReadonlyArray<{ text: string; kind?: string }>; imageReferences: ReadonlyArray<{ imageNumber: number; caption?: string; areaName: string }> }> }> }>;
/**
 * What each device prints of the report in `format`, counted from `previous`: EVERY output (HIGH item 1f,
 * tests/fixtures/report-every-output): the phone's written report, Reports screen, Drawing References and Work Areas &
 * Photos panels, Word file and the photos e-mail and text attach; the desktop's report and Word file.
 */
function printed(truths: unknown, world: World, now: string, previous: unknown, names: readonly string[], format: Format, device: 'phone' | 'computer'): string {
  fakeNow(now);
  try {
    const briefing = RI.buildDAVEReportBriefing({ truths, selectedProjectNames: names, previousSnapshot: previous, scheduleItems: world.saved } as never);
    // The drawings each device cites, as its Reports screen and its Word file work them out.
    const drawingReferences = buildAutomaticReportDrawingReferences({
      documents: referenceDocumentsCitedAsListed([...world.documents]), scheduleItems: [...world.shown], selectedProjectNames: [...names],
    });
    const inScope = world.updates.filter(update => names.includes(update.projectName));
    if (device === 'computer') return desktopOutputs({ briefing, format, drawingReferences, updates: inScope });
    const reportType = names.length > 1 ? 'combined_project_update' : 'daily_project_update';
    // The project open in the app (App.tsx hands it as the runtime's project): the same whichever order he ticked.
    const openProject = [...names].sort()[0];
    const draft = buildPIECoreIntelligence({
      runtimeContext: { projectName: openProject, projectNames: names, reportType, updates: world.updates, scheduleItems: world.shown, knownScheduleItems: world.saved, currentUpdate: null, projectAreas: AREAS, contacts: { contacts: [] }, referenceDocuments: world.documents, surface: 'reports' } as never,
      reportType: reportType as never, reportProjectNames: names, organizationId: 'local-unverified-anonymous', projectId: `project-${slug(openProject)}`,
    } as never).reportDraft as unknown as ReportOutputDraft;
    return phoneOutputs({ briefing, draft, format, drawingReferences, updates: world.updates });
  } finally { jest.useRealTimers(); }
}

// ---- the period: the phone sends R0, then R1 counting from it, in one format ----
const T0 = '2026-10-14T01:40:00.000Z';
const T1 = '2026-10-14T01:47:00.000Z'; // 18:47 Pacific: the iPhone sends
const T2 = '2026-10-14T03:33:00.000Z'; // 20:33 Pacific: the phone and the computer look again
type Sent = ReturnType<typeof markReportSnapshotDelivered>;
function phoneSends(world: World, at: string, previous: Sent | null, names: readonly string[], format: Format, sentText: { title: string; body: string } | null = null): Sent {
  const truths = phoneTruths(world, at, names);
  const current = buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey(names), sourceFingerprint: fpOn(truths, previous, format), capturedAt: at, reportFormat: format } as never);
  const saved = reportSnapshotToSave(current, previous) ?? previous;
  return markReportSnapshotDelivered(saved as Sent, at, 'iphone-install', null, sentText);
}
const supersedesOf = (sent: Sent) => (sent as { supersedes?: unknown }).supersedes ?? null;
/** What each device printed of the period's last report when it was sent (counted from what it counted from). */
async function asSent(world: World, at: string, sent: Sent, names: readonly string[], format: Format) {
  const desk = await desktopSnapshot(world, at, names);
  return {
    phone: printed(phoneTruths(world, at, names), world, at, supersedesOf(sent), names, format, 'phone'),
    computer: printed(deskTruthsOf(desk, names), deskWorld(desk), at, supersedesOf(sent), names, format, 'computer'),
  };
}
/** At T2, holding `later`: what each device says, and whether the report taken as the one sent reads as it did. */
async function look(later: World, sent: Sent, text: { phone: string; computer: string }, names: readonly string[], format: Format) {
  const truths = phoneTruths(later, T2, names);
  const desk = await desktopSnapshot(later, T2, names);
  const deskTruths = deskTruthsOf(desk, names);
  const phoneFp = fpOn(truths, sent, format);
  const computerFp = fpOn(deskTruths, sent, format);
  return {
    phone: sameReportSource(sent.sourceFingerprint, phoneFp),
    computer: daveWebReportAlreadySentElsewhereAt(sent as never, computerFp, new Set()) !== null,
    oneValue: phoneFp === computerFp,
    onPhone: printed(truths, later, T2, supersedesOf(sent), names, format, 'phone') === text.phone,
    onComputer: printed(deskTruths, deskWorld(desk), T2, supersedesOf(sent), names, format, 'computer') === text.computer,
  };
}

// ---- one field at a time ----
const ALTERNATE: Record<string, unknown[]> = {
  status: ['In Progress', 'Waiting', 'Not Started', 'Complete'], priority: ['High', 'Low', 'Medium'], category: ['Schedules', 'Drawings'], scheduleRole: ['lookahead', 'full'],
  progressSource: ['schedule_import', 'project_manager'], isMilestone: [true, false],
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
  if (value === null || value === undefined) return key.endsWith('Date') ? '10/24/2026' : 'Crane on site Friday.';
  return value;
}
const onRow = (world: World, id: string, change: (item: ScheduleItem) => ScheduleItem): World => ({
  ...world, saved: world.saved.map(item => (item.id === id ? change(item) : item)), shown: world.shown.map(item => (item.id === id ? change(item) : item)),
});
/** The 19 kinds of record fact HIGH 1c left offering a report again with no word changed. */
const NINETEEN = [
  'a task: startDate', 'a task: contractor', 'a task: nextAction', 'a task: notes', 'a task: milestone', 'a task: baselineFinishDate', 'a task: importedAt',
  'a task: progressConfirmedBy', 'a task: progressSource',
  ...['finishDate', 'importedAt', 'locationName', 'owner', 'percentComplete', 'projectName', 'status', 'taskName'].map(key => `a hidden earlier row: ${key}`),
  'a schedule file: importedAt', 'a schedule file: originalFileName',
];
const NINETEEN_KEYS = new Set(NINETEEN.map(kind => kind.replace(/^.*: /, '')));
type Tally = { tried: number; slips: string[]; offeredWithNoWord: Set<string>; printedAndMoved: Set<string>; twoValues: string[] };
/** Every field of every saved task (shown and hidden) and every schedule file of `world`, one at a time, after a real period in `format`. */
async function everyField(world: World, names: readonly string[], format: Format, onlyTheNineteen = false): Promise<Tally> {
  const r0 = phoneSends(onRow(world, world.shown[0].id, item => ({ ...item, percentComplete: Math.max(0, Number(item.percentComplete) - 5) } as ScheduleItem)), T0, null, names, format);
  const r1 = phoneSends(world, T1, r0, names, format);
  const text = await asSent(world, T1, r1, names, format);
  const tally: Tally = { tried: 0, slips: [], offeredWithNoWord: new Set(), printedAndMoved: new Set(), twoValues: [] };
  const shownIds = new Set(world.shown.map(item => item.id));
  const tryIt = async (what: string, later: World, kind: string) => {
    tally.tried += 1;
    const seen = await look(later, r1, text, names, format);
    for (const [device, said, same] of [['phone', seen.phone, seen.onPhone], ['computer', seen.computer, seen.onComputer]] as const) {
      if (said && !same) tally.slips.push(`${what}: the ${device} says "already sent" over another text`);
    }
    // One value for both devices: it moves where EITHER device's words move.
    if (!seen.phone && !seen.computer && seen.onPhone && seen.onComputer) tally.offeredWithNoWord.add(kind);
    if (!seen.phone && (!seen.onPhone || !seen.onComputer)) tally.printedAndMoved.add(kind);
    // A single field changed as the app never saves it (a percent its status contradicts; two current masters) is read
    // by each device its own way: each device is held to its own words (counted, not a slip).
    if (!seen.oneValue) tally.twoValues.push(what);
  };
  for (const saved of world.saved) {
    const keys = [...new Set([...Object.keys(saved), 'contractor', 'nextAction', 'baselineFinishDate', 'notes', 'priority', 'milestone', 'updatedAt', 'startDate'])]
      .filter(key => key !== 'id' && key !== 'projectControls' && (!onlyTheNineteen || NINETEEN_KEYS.has(key)));
    for (const key of keys) {
      const value = (saved as unknown as Record<string, unknown>)[key];
      if (value !== null && typeof value === 'object') continue;
      await tryIt(`${saved.projectName}: task ${saved.taskName} [${saved.id}], ${key}`, onRow(world, saved.id, item => ({ ...item, [key]: changedValue(key, value) } as ScheduleItem)), `${shownIds.has(saved.id) ? 'a task' : 'a hidden earlier row'}: ${key}`);
    }
  }
  for (const document of world.documents) {
    for (const key of Object.keys(document).filter(key => !['id', 'uri', 'storagePath', 'sourceProvider'].includes(key) && (!onlyTheNineteen || NINETEEN_KEYS.has(key)))) {
      const value = (document as unknown as Record<string, unknown>)[key];
      if (value !== null && typeof value === 'object') continue;
      // The phone works its shown list out again from the saved schedules, as the desktop's loader does.
      const documents = world.documents.map(other => (other.id === document.id ? { ...other, [key]: changedValue(key, value) } as ReferenceDocument : other));
      await tryIt(`schedule file ${document.name}, ${key}`, { ...world, documents, shown: shownOf({ items: world.saved, documents }) }, `a schedule file: ${key}`);
    }
  }
  return tally;
}
const report = (name: string, tally: Tally, names: readonly string[] = ['one project']) => {
  // Two values only for what the app never saves: a percent or a status changed alone (the desktop's loader works the
  // status out again), a retired master made current beside the current one (each device picks its own winner), or,
  // in a combined report, a task filed under a project that does not exist (the build before reads it so too, in both
  // formats; found here, not caused: the Executive report no longer does).
  expect(tally.twoValues.filter(what => !/, (percentComplete|status)$/.test(what) && !/^schedule file .*, isCurrent$/.test(what) && !(names.length > 1 && /, projectName$/.test(what)))).toEqual([]);
  // eslint-disable-next-line no-console
  console.log(`${name}: tried ${tally.tried}; two values (a row the app never saves): ${tally.twoValues.length}; "already sent" over another text: ${tally.slips.length}${tally.slips.length ? `\n  ${tally.slips.join('\n  ')}` : ''}; offered with no word changed: ${[...tally.offeredWithNoWord].sort().join(' | ') || 'none'}; of the 19, printed (and moved): ${NINETEEN.filter(kind => tally.printedAndMoved.has(kind)).join(' | ') || 'none'}`);
};

describe('HIGH 1d: every field, one at a time, after a real period, in each format: no "already sent" over another text and no offer with no word changed, on either device', () => {
  it.each(FORMATS)('his project\'s shape (Larch Hollow), %s', async format => {
    const tally = await everyField(larchHollow(), [LARCH], format);
    report(`Larch Hollow, ${format}`, tally);
    expect(tally.tried).toBeGreaterThan(300);
    expect(tally.slips).toEqual([]);
    expect([...tally.offeredWithNoWord]).toEqual([]);
  });

  it.each(FORMATS)('a project where the record facts print (Wren Point), %s', async format => {
    const world = wrenPoint();
    // The shape: five tasks shown, the writer prints Survey's notes, Utilities' and Permit sign-off's next steps.
    expect(world.shown.map(item => item.taskName).sort()).toEqual(['Footings', 'Grading', 'Permit sign-off', 'Survey', 'Utilities']);
    const pm = printed(phoneTruths(world, T2, [WREN]), world, T2, null, [WREN], 'project_manager', 'phone');
    expect(pm).toContain('Pike Surveying');
    expect(pm).toContain('Re-stake the east line.');
    const tally = await everyField(world, [WREN], format);
    report(`Wren Point, ${format}`, tally);
    expect(tally.slips).toEqual([]);
    expect([...tally.offeredWithNoWord]).toEqual([]);
    // Where they print, they move it: the contractor (an owner) and the next action in both formats; the notes and the
    // milestone's priority line in the Project Manager report (its Work Areas section).
    expect(NINETEEN.filter(kind => tally.printedAndMoved.has(kind))).toEqual(expect.arrayContaining(['a task: contractor', 'a task: nextAction']));
    // N761g (open item 7.61): a baseline held as "10/15/2026" prints on neither device, as on the phone it never did
    // (the computer's own date reader printed it, and only there); changing it offers nothing (above).
    expect(NINETEEN.filter(kind => tally.printedAndMoved.has(kind))).not.toContain('a task: baselineFinishDate');
    if (format === 'project_manager') expect(NINETEEN.filter(kind => tally.printedAndMoved.has(kind))).toEqual(expect.arrayContaining(['a task: notes']));
  });

  it.each(FORMATS)('the combined report of both projects (the 19 kinds on every row of either), %s', async format => {
    const tally = await everyField(both(larchHollow(), wrenPoint()), [LARCH, WREN], format, true);
    report(`combined, ${format}`, tally, [LARCH, WREN]);
    expect(tally.tried).toBeGreaterThan(100);
    expect(tally.slips).toEqual([]);
    expect([...tally.offeredWithNoWord]).toEqual([]);
  });
});

describe('HIGH 1d: the reviewer\'s cases and his seven mornings, in each format', () => {
  const named = (world: World, name: string) => world.shown.find(item => item.taskName === name) as ScheduleItem;
  const withPaintAt50 = () => onRow(larchHollow(), named(larchHollow(), 'Paint').id, item => ({ ...item, percentComplete: 50 } as ScheduleItem));
  const verdict = async (sent: Sent, later: World, format: Format) => {
    const text = await asSent(larchHollow(), T1, sent, [LARCH], format);
    const seen = await look(later, sent, text, [LARCH], format);
    return { phone: seen.phone, computer: seen.computer, oneValue: seen.oneValue, readsAsSent: seen.onPhone && seen.onComputer };
  };
  const cases: Array<[string, (world: World) => World, boolean]> = [
    ['the same records', world => world, true],
    ['H1R-2: Trim saved again, nothing changed', world => onRow(world, named(world, 'Trim').id, item => ({ ...item, updatedAt: '2026-10-14T02:10:00.000Z' })), true],
    ['Trim\'s contractor set (an owner is set: printed nowhere)', world => onRow(world, named(world, 'Trim').id, item => ({ ...item, contractor: 'Acme Fencing' } as ScheduleItem)), true],
    ['Trim\'s next action set (not due: printed nowhere)', world => onRow(world, named(world, 'Trim').id, item => ({ ...item, nextAction: 'Order trim stock' } as ScheduleItem)), true],
    ['Fence\'s notes rewritten (they read as no problem: printed nowhere)', world => onRow(world, named(world, 'Fence').id, item => ({ ...item, notes: 'Posts on order' } as ScheduleItem)), true],
    ['Paint 65 -> 70 (printed)', world => onRow(world, named(world, 'Paint').id, item => ({ ...item, percentComplete: 70 } as ScheduleItem)), false],
  ];
  it.each(FORMATS.flatMap(format => cases.map(([name, change, already]) => [format, name, change, already] as const)))('%s: %s', async (format, _name, change, already) => {
    const r0 = phoneSends(withPaintAt50(), T0, null, [LARCH], format);
    const r1 = phoneSends(larchHollow(), T1, r0, [LARCH], format);
    expect(await verdict(r1, change(larchHollow()), format)).toEqual({ phone: already, computer: already, oneValue: true, readsAsSent: already });
  });

  it.each(FORMATS)('his seven mornings, %s: never "already sent" over another text, never offered with no word changed, on any device', async format => {
    let world = larchHollow();
    let sent: Sent | null = null;
    let text = { phone: '', computer: '' };
    const at = (day: number, hhmm: string) => `2026-10-${String(14 + day).padStart(2, '0')}T${hhmm}:00.000Z`;
    const edits: Array<[string, (w: World, day: number) => World]> = [
      ['day 0: first report', w => w],
      ['day 1: nothing', w => w],
      ['day 2: the iPad stamps Paint\'s settings', (w, d) => onRow(w, named(w, 'Paint').id, item => ({ ...item, projectControls: { ...normalizeProjectControls((item as never as { projectControls: unknown }).projectControls), updatedAt: at(d, '14:00'), updatedBy: 'ipad', revision: 2 } } as never))],
      ['day 3: the computer saves Fence again with nothing changed', (w, d) => onRow(w, named(w, 'Fence').id, item => ({ ...item, updatedAt: at(d, '14:05') }))],
      ['day 4: the phone sets Fence to 10%, the iPad gives Trim a contractor', (w, d) => onRow(onRow(w, named(w, 'Fence').id, item => ({ ...item, percentComplete: 10, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at(d, '14:10'), progressConfirmedBy: 'David', updatedAt: at(d, '14:10') } as ScheduleItem)), named(w, 'Trim').id, item => ({ ...item, contractor: 'Acme Fencing' } as ScheduleItem))],
      ['day 5: the iPad confirms Fence 10% again; the computer gives Trim a start date', (w, d) => onRow(onRow(w, named(w, 'Fence').id, item => ({ ...item, progressConfirmedAt: at(d, '14:15'), updatedAt: at(d, '14:15') } as ScheduleItem)), named(w, 'Trim').id, item => ({ ...item, startDate: '11/03/2026' } as ScheduleItem))],
      ['day 6: the schedule file renamed on the computer', w => ({ ...w, documents: w.documents.map(document => (document.id === 'doc-s5' ? { ...document, originalFileName: 'Owner copy.csv' } as ReferenceDocument : document)) })],
    ];
    const wrong: string[] = [];
    for (let day = 0; day < edits.length; day += 1) {
      world = edits[day][1](world, day);
      const morning = `2026-10-${String(14 + day).padStart(2, '0')}T15:00:00.000Z`;
      if (sent) {
        const truths = phoneTruths(world, morning, [LARCH]);
        const desk = await desktopSnapshot(world, morning, [LARCH]);
        const deskTruths = deskTruthsOf(desk, [LARCH]);
        const said = {
          phone: { already: sameReportSource(sent.sourceFingerprint, fpOn(truths, sent, format)), same: printed(truths, world, morning, supersedesOf(sent), [LARCH], format, 'phone') === text.phone },
          computer: { already: daveWebReportAlreadySentElsewhereAt(sent as never, fpOn(deskTruths, sent, format), new Set()) !== null, same: printed(deskTruths, deskWorld(desk), morning, supersedesOf(sent), [LARCH], format, 'computer') === text.computer },
        };
        const bothSame = said.phone.same && said.computer.same;
        Object.entries(said).forEach(([device, verdict]) => {
          if (verdict.already && !verdict.same) wrong.push(`${edits[day][0]}: the ${device} says "already sent" over another text`);
          if (!verdict.already && bothSame) wrong.push(`${edits[day][0]}: the ${device} offers it again with no word changed`);
        });
        if (said.phone.already) continue;
      }
      sent = phoneSends(world, morning, sent, [LARCH], format);
      text = await asSent(world, morning, sent, [LARCH], format);
    }
    expect(wrong).toEqual([]);
  });
});

describe('HIGH 1d: M2\'s new lines are printed facts like any other', () => {
  it.each(FORMATS)('photo numbers (4.87): a change to a photo moves the report that numbers it and no other, %s', async format => {
    const world = wrenPoint();
    const r0 = phoneSends(onRow(world, world.shown[0].id, item => ({ ...item, percentComplete: 25 } as ScheduleItem)), T0, null, [WREN], format);
    const r1 = phoneSends(world, T1, r0, [WREN], format);
    const text = await asSent(world, T1, r1, [WREN], format);
    if (format === 'project_manager') expect(text.phone).toMatch(/See Image 3/);
    const changes: Array<[string, (updates: ProjectUpdate[]) => ProjectUpdate[]]> = [
      ['a caption reworded', updates => updates.map(update => (update.id === 'wu2' ? { ...update, photos: update.photos.map(item => ({ ...item, caption: 'Neighbor fence line at the east corner' })) } : update))],
      ['the photos of an update in another order', updates => updates.map(update => (update.id === 'wu1' ? { ...update, photos: [...update.photos].reverse() } : update))],
      ['a photo removed', updates => updates.map(update => (update.id === 'wu1' ? { ...update, photos: update.photos.slice(0, 1) } : update))],
      ['a photo given an area', updates => updates.map(update => (update.id === 'wu2' ? { ...update, selectedAreaName: 'Lot' } : update))],
      ['nothing', updates => updates],
    ];
    const results: Record<string, unknown> = {};
    for (const [name, change] of changes) {
      const seen = await look({ ...world, updates: change(world.updates) }, r1, text, [WREN], format);
      results[name] = { already: seen.phone && seen.computer, readsAsSent: seen.onPhone && seen.onComputer, oneValue: seen.oneValue };
      // eslint-disable-next-line no-console
      if (seen.phone !== (seen.onPhone && seen.onComputer)) console.log(`${format}: ${name}: phone ${seen.phone}, computer ${seen.computer}, reads as sent on the phone ${seen.onPhone}, on the computer ${seen.onComputer}`);
    }
    for (const verdict of Object.values(results) as Array<{ already: boolean; readsAsSent: boolean; oneValue: boolean }>) {
      expect(verdict.oneValue).toBe(true);
      expect(verdict.already).toBe(verdict.readsAsSent);
    }
    expect(results.nothing).toEqual({ already: true, readsAsSent: true, oneValue: true });
  });

  it.each(FORMATS)('"is back in the project plan" (7.17): sent with it, the report taken as sent reads it again, and every field of every hidden earlier row moves it exactly where a word moves, %s', async format => {
    const stages = larchStages();
    const r0 = phoneSends(stages.withPaint, '2026-10-14T01:30:00.000Z', null, [LARCH], format);
    const r1 = phoneSends(stages.paintOut, T0, r0, [LARCH], format);
    const r2 = phoneSends(stages.end, T1, r1, [LARCH], format);
    const text = await asSent(stages.end, T1, r2, [LARCH], format);
    expect(text.phone).toContain('Larch Hollow: Paint is back in the project plan.');
    const shownIds = new Set(stages.end.shown.map(item => item.id));
    const hidden = stages.end.saved.filter(item => !shownIds.has(item.id));
    expect(hidden.length).toBeGreaterThan(0);
    const wrong: string[] = [];
    let moved = 0;
    for (const item of hidden) {
      for (const key of ['finishDate', 'importedAt', 'locationName', 'owner', 'percentComplete', 'status', 'taskName']) {
        const seen = await look(onRow(stages.end, item.id, saved => ({ ...saved, [key]: changedValue(key, (saved as unknown as Record<string, unknown>)[key]) } as ScheduleItem)), r2, text, [LARCH], format);
        const same = seen.onPhone && seen.onComputer;
        if (!seen.phone && !same) moved += 1;
        if (seen.phone !== same || seen.computer !== same) wrong.push(`${item.id} ${key}: phone ${seen.phone}, computer ${seen.computer}, reads as sent ${same}`);
      }
    }
    expect(wrong).toEqual([]);
    // eslint-disable-next-line no-console
    console.log(`${format}: hidden-row changes that printed (and moved the report): ${moved}`);
  });

  it.each(FORMATS)('the edited text (7.44): sent with his words, a save that prints nothing still shows them as sent on the other device; a printed change does not, %s', async format => {
    const world = larchHollow();
    const words = { title: 'Larch Hollow Status', body: 'Larch Hollow is on plan.\n\nNOTE FROM THE OFFICE: test.' };
    const r0 = phoneSends(onRow(world, world.shown[0].id, item => ({ ...item, percentComplete: 50 } as ScheduleItem)), T0, null, [LARCH], format);
    const r1 = phoneSends(world, T1, r0, [LARCH], format, words);
    const shownAsSent = (later: World) => reportSentText(r1, fpOn(phoneTruths(later, T2, [LARCH]), r1, format));
    const trim = world.shown.find(item => item.taskName === 'Trim') as ScheduleItem;
    expect(shownAsSent(world)).toEqual(words);
    // Trim saved again with nothing changed, and the schedule file's notes rewritten: no word of either report moves.
    const resaved = onRow(world, trim.id, item => ({ ...item, updatedAt: '2026-10-14T02:10:00.000Z' } as ScheduleItem));
    expect(shownAsSent({ ...resaved, documents: resaved.documents.map(document => ({ ...document, notes: 'Owner copy' } as ReferenceDocument)) })).toEqual(words);
    expect(shownAsSent(onRow(world, trim.id, item => ({ ...item, percentComplete: 15, status: 'In Progress' } as ScheduleItem)))).toBeNull();
  });
});

describe('HIGH 1d: the Executive report prints four actions; the Project Manager report every one', () => {
  const briefingAt = (world: World, previous: unknown) => {
    fakeNow(T2);
    try {
      return RI.buildDAVEReportBriefing({ truths: phoneTruths(world, T2, [HERON]), selectedProjectNames: [HERON], previousSnapshot: previous, scheduleItems: world.saved } as never);
    } finally { jest.useRealTimers(); }
  };
  it.each(FORMATS)('a change to the sixth action\'s next action (printed only in the actions), its contractor or the sixth milestone\'s area (printed in "since the last report" too), %s', async format => {
    const world = heronBank();
    const r0 = phoneSends(onRow(world, world.shown[0].id, item => ({ ...item, percentComplete: 5 } as ScheduleItem)), T0, null, [HERON], format);
    const r1 = phoneSends(world, T1, r0, [HERON], format);
    const text = await asSent(world, T1, r1, [HERON], format);
    const briefing = briefingAt(world, supersedesOf(r1));
    expect(briefing.nextActions.length).toBeGreaterThan(5);
    expect(briefing.milestones.length).toBeGreaterThan(5);
    const sixthAction = briefing.nextActions[5].sourceTaskId;
    const sixthMilestone = briefing.milestones[5].id.replace(/^report-milestone:/, '');
    const changes: Array<[string, World]> = [
      ['the sixth action\'s next action', onRow(world, sixthAction, item => ({ ...item, nextAction: 'Call the inspector.' } as ScheduleItem))],
      ['the sixth action\'s contractor', onRow(world, sixthAction, item => ({ ...item, contractor: 'Another crew' } as ScheduleItem))],
      ['the sixth milestone\'s area', onRow(world, sixthMilestone, item => ({ ...item, locationName: 'Upper Bank' } as ScheduleItem))],
    ];
    const seen: Record<string, unknown> = {};
    for (const [name, later] of changes) {
      const verdict = await look(later, r1, text, [HERON], format);
      seen[name] = { phone: verdict.phone, computer: verdict.computer, readsAsSent: verdict.onPhone && verdict.onComputer };
    }
    // The next action of the sixth action: the Executive report does not print it (still the report sent); the Project
    // Manager report does. The owner and the area: each format prints them ("since the last report" names the change).
    const already = format === 'executive';
    expect(seen).toEqual({
      'the sixth action\'s next action': { phone: already, computer: already, readsAsSent: already },
      'the sixth action\'s contractor': { phone: false, computer: false, readsAsSent: false },
      'the sixth milestone\'s area': { phone: false, computer: false, readsAsSent: false },
    });
  });

  it('the desktop\'s own report source (what its approvals and saved reports are checked against) is of the format on the page', async () => {
    const world = heronBank();
    const r0 = phoneSends(onRow(world, world.shown[0].id, item => ({ ...item, percentComplete: 5 } as ScheduleItem)), T0, null, [HERON], 'executive');
    const r1 = phoneSends(world, T1, r0, [HERON], 'executive');
    const sixthAction = briefingAt(world, supersedesOf(r1)).nextActions[5].sourceTaskId;
    const before = await desktopSnapshot(world, T2, [HERON]);
    const after = await desktopSnapshot(onRow(world, sixthAction, item => ({ ...item, nextAction: 'Call the inspector.' } as ScheduleItem)), T2, [HERON]);
    const source = (desk: Desk, format: Format) => (buildDAVEWebReportSource as unknown as (...args: unknown[]) => { fingerprint: string })(desk, HERON, `sent:${T1}`, false, r1, format).fingerprint;
    expect(source(after, 'executive')).toBe(source(before, 'executive'));
    expect(source(after, 'project_manager')).not.toBe(source(before, 'project_manager'));
    expect(source(before, 'executive').startsWith(fpOn(deskTruthsOf(before, [HERON]), r1, 'executive'))).toBe(true);
  });
});

/**
 * The desktop does not load the writer (it loads the phone's own storage), so the line held is worked out by a copy of
 * the writer's rule for a schedule line (services/ReportScheduleLine.ts). Here it is held to the writer: for each task
 * alone in a report, the writer prints a problem line exactly when the copy holds one, with its words, and a next-step
 * line exactly when the copy holds one, with its action and owner.
 */
describe('HIGH 1d: the schedule line held is the line the writer prints', () => {
  const NOTES = ['', 'Posts on order', 'Benchmark was damaged; the survey must be redone.', 'Inspection failed at the north footing.', 'Crew needs to confirm the pour date.',
    'Unsafe ladder left at the trench.', 'Waiting on the utility company.', 'Activity ID: A100. Duration: 5d. Predecessors: A090.', 'Please review the revised drawings', 'Dana - Please send the submittal'];
  const base = (): ScheduleItem => ({
    id: 'line-1', projectName: WREN, locationName: 'Lot', taskName: 'Survey', startDate: '10/01/2026', finishDate: '10/30/2026', milestone: '', owner: 'Ines', contractor: '',
    percentComplete: 30, priority: 'Medium', status: 'In Progress', notes: '', createdAt: '2026-10-01T16:00:00.000Z',
  }) as unknown as ScheduleItem;
  const variants: ScheduleItem[] = [];
  for (const notes of NOTES) {
    for (const [status, percentComplete] of [['In Progress', 30], ['Waiting', 10], ['Not Started', 0], ['Complete', 100]] as const) {
      for (const priority of ['Medium', 'High']) {
        for (const [owner, contractor] of [['Ines', ''], ['', 'Pike Surveying'], ['', '']]) {
          variants.push({ ...base(), notes, status, percentComplete, priority, owner, contractor } as unknown as ScheduleItem);
        }
      }
    }
  }
  it(`${variants.length} single-task reports: the same lines`, () => {
    const wrong: string[] = [];
    for (const item of variants) {
      const draft = buildPIEReportDraft({
        reportType: 'daily_project_update', audience: 'internal_team', selectedProjectNames: [WREN], savedUpdates: [], scheduleItems: [item], generatedAt: new Date(T2),
      } as never) as unknown as Draft;
      const printed = draft.locationGroups.flatMap(group => group.workAreas.flatMap(area => area.bullets.map(bullet => ({ kind: String(bullet.kind), text: RI.reportBulletText(bullet) }))));
      const line = scheduleLineAsWritten(item);
      const problems = printed.filter(bullet => bullet.kind === 'issue' || bullet.kind === 'safety');
      const steps = printed.filter(bullet => bullet.kind === 'next_step');
      const others = printed.filter(bullet => !problems.includes(bullet) && !steps.includes(bullet));
      const lower = (text: string) => text.toLowerCase().replace(/[\s.,;:]+$/, '');
      // The writer prints a line once: a next step with no owner in the problem line's own words is that line.
      const stepIsTheProblem = Boolean(line.problem && line.nextStep && !line.nextStep.owner && lower(line.problem) === lower(line.nextStep.action));
      const same = (problems.length > 0) === (line.problem !== null) && (steps.length > 0) === (line.nextStep !== null && !stepIsTheProblem) && others.length === 0 &&
        (!line.problem || problems.some(bullet => bullet.text.startsWith(line.problem as string))) &&
        (!line.nextStep || stepIsTheProblem || steps.some(bullet => lower(bullet.text).includes(lower(line.nextStep!.action)) && (!line.nextStep!.owner || bullet.text.startsWith(line.nextStep!.owner))));
      if (!same) wrong.push(`${JSON.stringify({ notes: item.notes, status: item.status, priority: item.priority, owner: item.owner, contractor: item.contractor })}: held ${JSON.stringify(line)}; printed ${JSON.stringify(printed)}`);
    }
    expect(wrong).toEqual([]);
    // The rig reaches both: lines that print as a problem, as a next step, and lines that do not print.
    const held = variants.map(scheduleLineAsWritten);
    expect(held.some(line => line.problem)).toBe(true);
    expect(held.some(line => line.nextStep)).toBe(true);
    expect(held.some(line => !line.problem && !line.nextStep)).toBe(true);
  });
});

/**
 * A report is the period's last one only where, read as that report, it reads as sent AND, that report being sent, a
 * report counted from it would say nothing of what has happened since. A first report prints no "since the last
 * report" lines: an owner moved after it is said only by the next report ("Trim owner changed from Ines to Eli."). It
 * is news to send, not the report sent (while 3.0 held every record, the owner itself moved the value).
 */
describe('HIGH 1d: news since the report sent is never taken for it', () => {
  it.each(FORMATS)('after a first report: an owner moved is offered (the next report says it); nothing changed is "already sent", %s', async format => {
    const world = larchHollow();
    const r0 = phoneSends(world, T1, null, [LARCH], format);
    const text = await asSent(world, T1, r0, [LARCH], format);
    const trim = world.shown.find(item => item.taskName === 'Trim') as ScheduleItem;
    const moved = onRow(world, trim.id, item => ({ ...item, owner: 'Eli' } as ScheduleItem));
    const seen = await look(moved, r0, text, [LARCH], format);
    // Read as the first report, nothing it prints has moved ...
    expect(seen.onPhone && seen.onComputer).toBe(true);
    // ... but the report counted from it says the owner moved: offered on both devices.
    expect(printed(phoneTruths(moved, T2, [LARCH]), moved, T2, r0, [LARCH], format, 'phone')).toContain('Trim owner changed from Ines to Eli.');
    expect({ phone: seen.phone, computer: seen.computer, oneValue: seen.oneValue }).toEqual({ phone: false, computer: false, oneValue: true });
    const same = await look(world, r0, text, [LARCH], format);
    expect({ phone: same.phone, computer: same.computer }).toEqual({ phone: true, computer: true });
  });
});

/**
 * HIGH item 1e (the coordinator's decision on review pass 3's case B and A6 pass 6 #6: both). A combined report is
 * worked out with its projects by name (1c), and now PRINTS them by name too, on every device and in every body: ticked
 * in another order, it is the same text, in the same order, under the same value (case B), and its edits and approval
 * stay with it (A6 #6, owner-q17). A combined report the released build sent (2.0, its projects in the order ticked) is
 * no longer taken for today's (its words may be in another order): it is offered once after the update.
 */
describe('HIGH 1e: a combined report prints its projects in name order, whichever order they were ticked', () => {
  it.each(FORMATS)('ticked Wren Point first or Larch Hollow first: the same words on the phone and the computer, one value, %s', async format => {
    const world = both(larchHollow(), wrenPoint());
    const read = async (names: readonly string[]) => {
      const truths = phoneTruths(world, T2, names);
      const desk = await desktopSnapshot(world, T2, names);
      const deskTruths = deskTruthsOf(desk, names);
      return {
        phone: printed(truths, world, T2, null, names, format, 'phone'),
        computer: printed(deskTruths, deskWorld(desk), T2, null, names, format, 'computer'),
        phoneValue: fpOn(truths, null, format),
        computerValue: fpOn(deskTruths, null, format),
      };
    };
    const larchFirst = await read([LARCH, WREN]);
    const wrenFirst = await read([WREN, LARCH]);
    expect(wrenFirst).toEqual(larchFirst);
    expect(larchFirst.phoneValue).toBe(larchFirst.computerValue);
    // By name: in the section that lists every project's tasks or position, Larch Hollow's before Wren Point's.
    const section = (text: string, heading: string) => {
      const lines = text.split('\n');
      const from = lines.indexOf(heading);
      expect(from).toBeGreaterThanOrEqual(0);
      const to = lines.findIndex((line, index) => index > from && !line.trim());
      return lines.slice(from + 1, to < 0 ? undefined : to).join('\n');
    };
    const sections = format === 'executive'
      ? [section(larchFirst.phone, 'PROJECT POSITION'), section(larchFirst.computer, '## Project Status')]
      : [section(larchFirst.phone, 'CURRENT WORK'), section(larchFirst.computer, '## Current Work')];
    for (const text of sections) {
      expect(text.indexOf('Larch Hollow')).toBeGreaterThanOrEqual(0);
      expect(text.indexOf('Larch Hollow')).toBeLessThan(text.indexOf('Wren Point'));
      expect(text.lastIndexOf('Larch Hollow')).toBeLessThan(text.indexOf('Wren Point'));
    }
  });

  it.each(FORMATS)('after a real period, ticked in the other order: still the report sent, read word for word as sent, %s', async format => {
    const world = both(larchHollow(), wrenPoint());
    const r0 = phoneSends(onRow(world, world.shown[0].id, item => ({ ...item, percentComplete: 5 } as ScheduleItem)), T0, null, [LARCH, WREN], format);
    const r1 = phoneSends(world, T1, r0, [LARCH, WREN], format);
    const text = await asSent(world, T1, r1, [LARCH, WREN], format);
    const seen = await look(world, r1, text, [WREN, LARCH], format);
    expect(seen).toEqual({ phone: true, computer: true, oneValue: true, onPhone: true, onComputer: true });
  });

  it.each(FORMATS)('a combined report sent on Build 231 or 232 (2.0) is offered once after the update; a one-project report is still known, %s', format => {
    const combined = phoneTruths(both(larchHollow(), wrenPoint()), T2, [LARCH, WREN]);
    expect(sameReportSource(RI.buildDAVEVersion2ReportSourceFingerprint(combined), fpOn(combined, null, format))).toBe(false);
    const single = phoneTruths(larchHollow(), T2, [LARCH]);
    expect(sameReportSource(RI.buildDAVEVersion2ReportSourceFingerprint(single), fpOn(single, null, format))).toBe(true);
  });
});
