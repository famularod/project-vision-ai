/**
 * HIGH item 1c (reports review pass 1, H1R-1 and H1R-2): the desktop's Reports page itself, drawn (the reviewer's rig,
 * notes/p6-b232/hrv1r-desktop-page.test.tsx, asking the app for the phone's fingerprint as its Reports screen does).
 * The phone sent R0, then R1 counting from R0; the shared period is R1; the computer opens Reports at 20:33.
 *   the same records, or a task saved again with nothing changed: "Your other device already sent this report".
 *   a field no line names set on the iPad before R0, R1 sent with it, then that task saved again: R1, taken as sent,
 *   would now read "Trim was updated.": no such notice. A printed change: no notice.
 * Synthetic data, made-up names, no network.
 */
/**
 * hrv1r item 5: the desktop's own Reports page (DesktopReadOnlyShell, the real shell, test renderer) over the cloud's
 * rows of Larch Hollow through the desktop's own loader, with the shared period holding the phone's sent report (R1,
 * counting from R0). Does the page say "Your other device already sent this report" exactly when the phone's sent report
 * reads the same as the page's, and offer Approve exactly otherwise? Made-up project. No network.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linear-gradient', () => { const React = require('react'); const { View } = require('react-native'); return { LinearGradient: ({ children }: any) => React.createElement(View, null, children) }; });
jest.mock('expo-router', () => ({ Link: ({ children }: any) => children, useLocalSearchParams: () => ({}), usePathname: () => '/reports', useRouter: () => ({ setParams: jest.fn() }) }));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({ VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name', formatVitruviusDesktopGreeting: () => 'Good morning, David', readVitruviusDesktopDisplayName: () => 'David', writeVitruviusDesktopDisplayName: (v: string) => v.trim() }));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({ desktopFieldNoteDataSource: { list: jest.fn(async () => []), save: jest.fn(), update: jest.fn() } }));
const mockTable = new Map<string, { snapshot: unknown; deliveredAt: string | null }>();
const mockAuth: any = {
  phase: 'ready', userEmail: 'pm@example.com', sessionExpiresAt: null, snapshot: null,
  freshness: { status: 'connected', lastSuccessfulRefreshAt: null, lastAttemptAt: null, consecutiveFailures: 0 }, message: null,
  refreshSnapshot: jest.fn(async () => true),
  loadReportPeriod: jest.fn(async (scopeKey: string, format: string) => ({ ownerId: 'owner-1', snapshot: mockTable.get(`${scopeKey}|${format}`)?.snapshot ?? null })),
  saveReportPeriod: jest.fn(async () => 'saved'), reportOwnerId: jest.fn(async () => 'owner-1'), saveReport: jest.fn(async () => '2026-10-14T03:40:00.000Z'),
  signInWithPassword: jest.fn(), signOutOfDesktop: jest.fn(), restoreMissingTasks: jest.fn(), getArtifactUrl: jest.fn(), loadDocumentCoverageSummary: jest.fn(), loadDocumentProof: jest.fn(),
};
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({ useDesktopAuth: () => mockAuth }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///var/mobile/Containers/Data/Application/PHONE/Documents/' }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));
const mockCloud: { rows: unknown } = { rows: null };
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ ...jest.requireActual('../../services/DAVEWebSupabaseClient'), daveWebSupabaseGateway: { ...jest.requireActual('../../services/DAVEWebSupabaseClient').daveWebSupabaseGateway, loadAuthorizedRows: async () => mockCloud.rows } }));

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


const fpOn = (truths: any, period: any, format: 'project_manager' | 'executive' = 'project_manager'): string => ((RI as any).buildDAVEReportSourceOnPeriod ? (RI as any).buildDAVEReportSourceOnPeriod(truths, period, format).fingerprint : RI.buildDAVEReportSourceFingerprint(truths));
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
import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { reportBaselineSnapshot, reportSnapshotToSave } from '../../services/DAVEReportSnapshot';
import { forgetDAVEWebReportPeriodSession } from '../../services/DAVEWebReportPeriod';
import { forgetDAVEWebOwnReportSends, forgetDAVEWebReportPeriods, forgetDAVEWebReportTabMemory } from '../../services/DAVEWebReportSend';
const onRow = (world: World, id: string, change: (item: ScheduleItem) => ScheduleItem): World => ({
  ...world, saved: world.saved.map(item => (item.id === id ? change(item) : item)), shown: world.shown.map(item => (item.id === id ? change(item) : item)),
});
const named = (world: World, name: string) => world.shown.find(item => item.taskName === name) as ScheduleItem;
const snap = (truths: ReturnType<typeof phoneTruths>, at: string, period: any = null, format: 'project_manager' | 'executive' = 'project_manager') => buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey([P]), sourceFingerprint: fpOn(truths, period, format), capturedAt: at, reportFormat: format } as never);
function phoneSends(world: World, at: string, previous: any, format: 'project_manager' | 'executive' = 'project_manager') {
  const truths = phoneTruths(world, at);
  const current = snap(truths, at, previous, format);
  const saved = reportSnapshotToSave(current, previous) ?? previous;
  return markReportSnapshotDelivered(saved, at, 'iphone-install');
}
const OUT: Record<string, unknown> = {};
afterAll(() => { require('fs').writeFileSync(process.env.HRV1R_OUT || '/dev/null', JSON.stringify(OUT, null, 1)); });
const ALREADY_SENT = /^Your other device already sent this report .*\. Approve it only if you want to send it a second time\.$/;
const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); });
beforeAll(() => {
  const root = globalThis as any; root.window = root.window ?? {}; root.window.addEventListener = jest.fn(); root.window.removeEventListener = jest.fn(); root.window.open = jest.fn();
});
const T0 = '2026-10-14T01:40:00.000Z'; const T1 = '2026-10-14T01:47:00.000Z'; const T2 = '2026-10-14T03:33:00.000Z';
const textOf = (node: any): string[] => { const out: string[] = []; const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); }; walk(node); return out; };
const cases: Array<[string, (w: World) => World, World | null]> = [
  ['same records', w => w, null],
  ['P2: contractor set before R0 (synced after), Trim then saved again', w => onRow(w, named(w, 'Trim').id, item => ({ ...item, contractor: 'Acme Fencing', updatedAt: '2026-10-14T02:10:00.000Z' } as ScheduleItem)), 'P2' as any],
  ['Trim saved again, nothing changed', w => onRow(w, named(w, 'Trim').id, item => ({ ...item, updatedAt: '2026-10-14T02:10:00.000Z' })), null],
  ['Fence saved again, nothing changed', w => onRow(w, named(w, 'Fence').id, item => ({ ...item, updatedAt: '2026-10-14T02:12:00.000Z' })), null],
  ['Paint 65 -> 70 (a printed change)', w => onRow(w, named(w, 'Paint').id, item => ({ ...item, percentComplete: 70 } as ScheduleItem)), null],
];
const NOTICE: Record<string, boolean> = {
  'same records': true,
  'P2: contractor set before R0 (synced after), Trim then saved again': false,
  'Trim saved again, nothing changed': true,
  'Fence saved again, nothing changed': true,
  'Paint 65 -> 70 (a printed change)': false,
};
describe('HIGH 1c: the desktop Reports page drawn, after a real period', () => {
  beforeEach(() => { mockTable.clear(); forgetDAVEWebReportPeriods('owner-1'); forgetDAVEWebReportTabMemory(); forgetDAVEWebOwnReportSends(); forgetDAVEWebReportPeriodSession();
    const profile = new Map<string, string>(); (globalThis as any).localStorage = { getItem: (k: string) => profile.get(k) ?? null, setItem: (k: string, v: string) => { profile.set(k, v); }, removeItem: (k: string) => { profile.delete(k); }, key: (i: number) => [...profile.keys()][i] ?? null, get length() { return profile.size; } };
    (globalThis as any).navigator = { clipboard: { writeText: jest.fn(async () => undefined) } }; });
  it.each(cases)('%s', async (name, change, marker) => {
    const base = onRow(larchHollow(), named(larchHollow(), 'Paint').id, item => ({ ...item, percentComplete: 50 } as ScheduleItem));
    const r0 = phoneSends(base, T0, null);
    // R1: the phone's records at 01:47 (P2: with the contractor the iPad set at 01:35, before R0, synced after it).
    const atR1 = marker ? onRow(larchHollow(), named(larchHollow(), 'Trim').id, item => ({ ...item, contractor: 'Acme Fencing', updatedAt: '2026-10-14T01:35:00.000Z' } as ScheduleItem)) : larchHollow();
    const r1 = phoneSends(atR1, T1, r0);
    mockTable.set(`${daveReportSnapshotScopeKey([P])}|project_manager`, { snapshot: JSON.parse(JSON.stringify(r1)), deliveredAt: T1 });
    const now = change(larchHollow());
    mockAuth.snapshot = await desktopSnapshot(now, T2);
    const view = render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(screen.getByLabelText('Since the last report')).toBeTruthy(), { timeout: 20000 });
    await settle();
    const since = textOf(screen.getByLabelText('Since the last report'));
    const notice = since.some(line => ALREADY_SENT.test(line));
    let approveOffered: boolean | string = 'not reached';
    const review = screen.queryByText('Review & Prepare Report');
    if (review) { fireEvent.press(review); await settle(); approveOffered = Boolean(screen.queryByText('Approve Report')); }
    OUT[name] = { notice, approveOffered, sinceLines: since };
    view.unmount();
    expect({ name, notice }).toEqual({ name, notice: NOTICE[name] });
  }, 120000);
});

/**
 * HIGH item 1d (open item 7.55): the page works the fingerprint out for the report in the format chosen on it, against
 * that format's own period. Trim made High priority prints only in the Project Manager report (its WORK AREAS section,
 * written on the phone), so the Executive report the phone sent is still the report on the page; the Project Manager
 * report is not.
 */
describe('HIGH 1d: the desktop Reports page, in the format chosen on it', () => {
  beforeEach(() => { mockTable.clear(); forgetDAVEWebReportPeriods('owner-1'); forgetDAVEWebReportTabMemory(); forgetDAVEWebOwnReportSends(); forgetDAVEWebReportPeriodSession();
    const profile = new Map<string, string>(); (globalThis as any).localStorage = { getItem: (k: string) => profile.get(k) ?? null, setItem: (k: string, v: string) => { profile.set(k, v); }, removeItem: (k: string) => { profile.delete(k); }, key: (i: number) => [...profile.keys()][i] ?? null, get length() { return profile.size; } };
    (globalThis as any).navigator = { clipboard: { writeText: jest.fn(async () => undefined) } }; });
  const highPriority = (w: World) => onRow(w, named(w, 'Trim').id, item => ({ ...item, priority: 'High' } as ScheduleItem));
  it.each([
    ['executive', 'the same records', (w: World) => w, true],
    ['executive', 'Trim made High priority (the Executive report prints nothing of it)', highPriority, true],
    ['executive', 'Paint 65 -> 70 (printed)', (w: World) => onRow(w, named(w, 'Paint').id, item => ({ ...item, percentComplete: 70 } as ScheduleItem)), false],
    ['project_manager', 'Trim made High priority (the Project Manager report prints a line for it)', highPriority, false],
  ] as const)('%s: %s', async (format, _name, change, expected) => {
    const base = onRow(larchHollow(), named(larchHollow(), 'Paint').id, item => ({ ...item, percentComplete: 50 } as ScheduleItem));
    const r0 = phoneSends(base, T0, null, format);
    const r1 = phoneSends(larchHollow(), T1, r0, format);
    mockTable.set(`${daveReportSnapshotScopeKey([P])}|${format}`, { snapshot: JSON.parse(JSON.stringify(r1)), deliveredAt: T1 });
    mockAuth.snapshot = await desktopSnapshot(change(larchHollow()), T2);
    const view = render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(screen.getByLabelText('Since the last report')).toBeTruthy(), { timeout: 20000 });
    await settle();
    if (format === 'executive') {
      fireEvent.press(screen.getByText('Review & Prepare Report'));
      await settle();
      fireEvent.press(screen.getByLabelText('Executive Summary report'));
      await settle();
    }
    await waitFor(() => expect(textOf(screen.getByLabelText('Since the last report')).some(line => /Since the report sent/.test(line))).toBe(true), { timeout: 20000 });
    await settle();
    const notice = textOf(screen.getByLabelText('Since the last report')).some(line => ALREADY_SENT.test(line));
    view.unmount();
    expect(notice).toBe(expected);
  }, 120000);
});
