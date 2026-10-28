/** B71 whole7.50 actual native review/copy/sent caller. Synthetic rows only.
 * Actual native normalization, authorized desktop row projection, modern recipes,
 * runtime/Word and sent-receipt consumers; historical setup retained as test infrastructure.
 */
const mockDevices = new Map<string, Map<string, string>>();
let mockDevice = 'phone';
const mockLocal = () => {
  if (!mockDevices.has(mockDevice)) mockDevices.set(mockDevice, new Map());
  return mockDevices.get(mockDevice) as Map<string, string>;
};
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async (key: string) => mockLocal().get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockLocal().set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockLocal().delete(key); }),
    getAllKeys: jest.fn(async () => Array.from(mockLocal().keys())),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockLocal().get(key) ?? null])),
  };
  return { __esModule: true, default: api, ...api };
});

type MockCloudRow = { snapshot: unknown; deliveredAt: string | null };
const mockCloud = new Map<string, MockCloudRow>();
let mockPeriodReadGate: Promise<void> | null = null;
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, data });
jest.mock('../../services/SupabaseService', () => ({
  getSupabaseClient: () => null,
  loadReportSnapshotCloud: jest.fn(async (scopeKey: string, format: string) => {
    await mockPeriodReadGate;
    return mockOk({ ownerId: 'owner-1', snapshot: mockCloud.get(`${scopeKey}|${format}`)?.snapshot ?? null });
  }),
  // The shared record keeps the later send (the table's own rule).
  saveReportSnapshotCloud: jest.fn(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    const key = `${row.scopeKey}|${row.format}`;
    const existing = mockCloud.get(key);
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return mockOk(null);
    mockCloud.set(key, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return mockOk(null);
  }),
}));

let mockAuthority: Record<string, unknown>;
jest.mock('../../providers/PIELiveAuthorityProvider', () => ({
  usePIELiveAuthority: () => mockAuthority,
  useOptionalPIELiveAuthority: () => mockAuthority,
}));
jest.mock('react-native-reanimated', () => ({ getUseOfValueInStyleWarning: () => '' }));
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props: Record<string, unknown>) => <View {...props} /> };
});
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
// The desktop's own Reports page (the rig of tests/services/high1c-desktop-page-a-task-saved-again), over the SAME shared
// record the phone writes (mockCloud) and the SAME records, uploaded as the phone uploads them.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linear-gradient', () => { const React = require('react'); const { View } = require('react-native'); return { LinearGradient: ({ children }: any) => React.createElement(View, null, children) }; });
jest.mock('expo-router', () => ({ Link: ({ children }: any) => children, useLocalSearchParams: () => ({}), usePathname: () => '/reports', useRouter: () => ({ setParams: jest.fn() }) }));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({ VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name', formatVitruviusDesktopGreeting: () => 'Good morning, Sam', readVitruviusDesktopDisplayName: () => 'Sam', writeVitruviusDesktopDisplayName: (v: string) => v.trim() }));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({ desktopFieldNoteDataSource: { list: jest.fn(async () => []), save: jest.fn(), update: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));
const mockAuth: any = {
  phase: 'ready', userEmail: 'pm@example.com', sessionExpiresAt: null, snapshot: null,
  freshness: { status: 'connected', lastSuccessfulRefreshAt: null, lastAttemptAt: null, consecutiveFailures: 0 }, message: null,
  refreshSnapshot: jest.fn(async () => true),
  loadReportPeriod: jest.fn(async (scopeKey: string, format: string) => ({ ownerId: 'owner-1', snapshot: (mockCloud as Map<string, { snapshot: unknown }>).get(`${scopeKey}|${format}`)?.snapshot ?? null })),
  saveReportPeriod: jest.fn(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    const key = `${row.scopeKey}|${row.format}`;
    const existing = (mockCloud as Map<string, { snapshot: unknown; deliveredAt: string | null }>).get(key);
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return 'saved';
    (mockCloud as Map<string, unknown>).set(key, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return 'saved';
  }),
  reportOwnerId: jest.fn(async () => 'owner-1'), saveReport: jest.fn(async () => '2026-10-15T03:40:00.000Z'),
  signInWithPassword: jest.fn(), signOutOfDesktop: jest.fn(), restoreMissingTasks: jest.fn(), getArtifactUrl: jest.fn(), loadDocumentCoverageSummary: jest.fn(), loadDocumentProof: jest.fn(),
};
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({ useDesktopAuth: () => mockAuth }));
const mockRows: { rows: unknown } = { rows: null };
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ ...jest.requireActual('../../services/DAVEWebSupabaseClient'), daveWebSupabaseGateway: { ...jest.requireActual('../../services/DAVEWebSupabaseClient').daveWebSupabaseGateway, loadAuthorizedRows: async () => mockRows.rows } }));


import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { recordScheduleCloudPull, registerScheduleCloudPullRequest } from '../../services/ScheduleCloudPull';
import type { ProjectUpdate, ScheduleItem } from '../../types';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { forgetDAVEWebReportPeriodSession } from '../../services/DAVEWebReportPeriod';
import { forgetDAVEWebOwnReportSends, forgetDAVEWebReportPeriods, forgetDAVEWebReportTabMemory } from '../../services/DAVEWebReportSend';
import { forgetDAVEReportCheckInput, heldDAVEReportCheckInput } from '../../services/DAVEReportCheckDetails';

jest.setTimeout(240_000);
const SLOW = { timeout: 40_000 } as const;
const setClock = (iso: string) => {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'],
  });
};
afterEach(() => jest.useRealTimers());
let stopAppDownloads: () => void = () => undefined;
beforeEach(() => {
  stopAppDownloads = registerScheduleCloudPullRequest(() => { void recordScheduleCloudPull(new Date().toISOString()); });
});
afterEach(() => stopAppDownloads());

let NAME = 'Harbor Point';
let NAMES = [NAME];
const task = (id: string, taskName: string, area: string, percent: number, finish: string, owner = 'Dana') => ({
  id, projectName: NAME, scheduleProjectName: NAME, locationName: area, taskName,
  startDate: '09/01/2026', finishDate: finish, milestone: '', owner, contractor: 'Acme',
  percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z', projectControls: normalizeProjectControls(undefined),
}) as unknown as ScheduleItem;
const photo = (id: string, area: string, caption: string) => ({
  id, uri: `file:///photos/${id}.jpg`, caption, category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: area,
});
const update = (id: string, item: ScheduleItem, at: string, notes: string, photos: unknown[]) => ({
  id, projectName: NAME, scheduleProjectName: NAME, date: at, photos, recipients: { contactIds: [] }, notes, status: 'sent',
  scheduleItemId: item.id, scheduleTaskName: item.taskName, selectedAreaName: item.locationName || '',
}) as unknown as ProjectUpdate;

const BASE_TASKS = [
  task('frame', 'Frame walls', 'Level 2', 100, '09/30/2026'),
  task('pour', 'Pour slab', 'Level 1', 40, '10/09/2026'),
  task('roof', 'Set roof', 'Roof', 0, '03/31/2027', 'Luis'),
  task('paint', 'Paint lobby', 'Level 1', 10, '04/30/2027', 'Mara'),
];
const UPDATES_13 = [
  update('u3', BASE_TASKS[2], '2026-10-03', 'Roof trusses were delivered.', [photo('p3', 'Roof', 'Trusses on site')]),
  update('u2', BASE_TASKS[0], '2026-10-02', 'Site walk on Level 2.', [photo('p2', 'Level 2', 'Level 2')]),
  update('u1', BASE_TASKS[1], '2026-10-01', 'Slab forms are set on the east bay.', [photo('p1', 'Level 1', 'East bay forms')]),
];
/** From 14 Oct: a field update on Set roof. Every device holds it as the cloud does. (Frame walls' update is a site walk: a
 * completion or conflict line in What changed would hide the document line, on the phone and on the computer alike.) */
const UPDATES = [update('u4', BASE_TASKS[2], '2026-10-14', 'Roof deck sheathing started.', [photo('p4', 'Roof', 'Roof deck')]), ...UPDATES_13];
const onThePhone = (items: ScheduleItem[]) => items;
/** 14 Oct: Pour slab is complete, and Paint lobby has left the plan. */
const OCT14 = onThePhone(BASE_TASKS.filter(item => item.id !== 'paint').map(item => (item.id === 'pour'
  ? { ...item, percentComplete: 100, status: 'Complete', updatedAt: '2026-10-14T20:00:00.000Z' } as ScheduleItem
  : item)));
/** 15 Oct: a hand-made task with no area, and Paint lobby back in the plan. */
const HAND_MADE = { ...task('noarea', 'No-area check', '', 0, '11/14/2026'), createdAt: '2026-10-15T16:10:00.000Z', updatedAt: '2026-10-15T16:10:00.000Z' } as ScheduleItem;
const OCT15 = onThePhone([HAND_MADE, ...BASE_TASKS.map(item => (item.id === 'pour'
  ? { ...item, percentComplete: 100, status: 'Complete', updatedAt: '2026-10-14T20:00:00.000Z' } as ScheduleItem
  : item))]);

/**
 * N761e: the project's current schedule, made current on Oct 14 from a Documents card: the shared record carries the
 * project's cloud id (as every schedule shared from a card, and every file the computer adds). The phone's Reports
 * screen knows the report's projects by name, and leaves it out of its report; the computer printed "Schedules document
 * added: D2." in What changed (for 14 days), so its report of the same records was another report.
 */
const PROJECT_CLOUD_ID = '3e9b5c1a-7d2f-4a60-8b14-6c0e2f9a1d57';
const DOCUMENTS = [{
  id: 'doc-d2', name: 'D2', originalFileName: 'D2.pdf', uri: '', mimeType: 'application/pdf', category: 'Schedules', notes: '', isCurrent: true,
  importedAt: '2026-10-14T22:30:00.000Z', projectId: PROJECT_CLOUD_ID, projectName: NAME, projectNames: NAMES,
}];
const REVIEW_ITEM = 'Some source evidence has low confidence.';
const stub = {
  id: 'draft-1', reportType: 'combined_project_update', audience: 'owner',
  title: 'Harbor Point update', subject: 'Harbor Point update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: true, reviewFlags: [REVIEW_ITEM], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};
const authority = (updates: ProjectUpdate[], items: ScheduleItem[]) => {
  const core = buildPIECoreIntelligence({
    runtimeContext: {
      projectName: NAME, projectNames: NAMES, reportType: 'combined_project_update',
      updates, scheduleItems: items, knownScheduleItems: items, currentUpdate: null,
      projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'reports',
    } as never,
    reportType: 'combined_project_update' as never, reportProjectNames: NAMES,
    organizationId: 'local-unverified-anonymous', projectId: 'project-x',
  } as never);
  const draft = { ...core.reportDraft, needsReview: true, reviewFlags: [REVIEW_ITEM] };
  return {
    state: 'ready', policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft, runtime: { response: { reportDraft: draft } }, executiveJudgmentRecord: null,
  };
};
const onCopyReport = jest.fn(async (_report: { body: string }) => 'completed' as const);
let phoneFormat: 'project_manager' | 'executive' = 'project_manager';
const reportsScreen = (updates: ProjectUpdate[], items: ScheduleItem[]) => (
  <ReportsScreen
    projectName={NAME}
    reportType="combined_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={NAMES}
    selectedProjectNames={NAMES}
    onToggleProject={() => undefined}
    reportFormat={phoneFormat}
    onReportFormatChange={() => undefined}
    updates={updates as never}
    scheduleItems={items as never}
    knownScheduleItems={items as never}
    referenceDocuments={[] as never}
    knownScheduleDocuments={[] as never}
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport as never}
    onEmailReport={async () => 'unknown'}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);

let current: ReturnType<typeof render> | null = null;
afterEach(() => { current?.unmount(); current = null; });
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const textOf = (node: any): string[] => { const out: string[] = []; const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); }; walk(node); return out; };
const allText = () => textOf(screen.toJSON());
beforeAll(() => {
  const root = globalThis as any; root.window = root.window ?? {}; root.window.addEventListener = jest.fn(); root.window.removeEventListener = jest.fn(); root.window.open = jest.fn();
});
beforeEach(() => {
  mockDevices.clear();
  mockCloud.clear();
  mockPeriodReadGate = null;
  mockDevice = 'phone';
  phoneFormat = 'project_manager';
  forgetAllReportSessionState();
  onCopyReport.mockClear();
  forgetDAVEWebReportPeriods('owner-1'); forgetDAVEWebReportTabMemory(); forgetDAVEWebOwnReportSends(); forgetDAVEWebReportPeriodSession();
  const profile = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => profile.get(k) ?? null, setItem: (k: string, v: string) => { profile.set(k, v); }, removeItem: (k: string) => { profile.delete(k); }, key: (i: number) => [...profile.keys()][i] ?? null, get length() { return profile.size; } };
  (globalThis as any).navigator = { clipboard: { writeText: jest.fn(async () => undefined) } };
});

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const cloudRow = (format = phoneFormat) => Array.from(mockCloud.entries()).find(([key]) => key.endsWith(`|${format}`))?.[1];
/** A device opens Reports afresh, approves the report and copies it; the send reaches the shared record. */
async function deviceSends(device: string, updates: ProjectUpdate[], items: ScheduleItem[], at: string) {
  current?.unmount();
  setClock(at);
  forgetAllReportSessionState();
  mockDevice = device;
  mockAuthority = authority(updates, items);
  // A review applies to the loaded period's fingerprint. Clear the previous
  // mount's diagnostic, then observe this screen's actual loading effect.
  forgetDAVEReportCheckInput();
  current = render(reportsScreen(updates, items));
  await waitFor(() => expect(heldDAVEReportCheckInput()).toMatchObject({
    periodState: 'read', shared: 'checked', format: phoneFormat,
  }), SLOW);
  fireEvent.press(await screen.findByRole('button', { name: `Mark reviewed: ${REVIEW_ITEM}` }, SLOW));
  await screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
  fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
  await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(at), SLOW);
  const said = allText().filter(line => /^Since the report sent|^\+\d|project plan\.$|^This device sent this report/.test(line));
  current.unmount();
  current = null;
  return said;
}

const B71_AT = '2026-10-18T16:17:00.000Z';
const realNote = 'Radio batteries were swapped.';
const b71Note = (id: string, text: string, day: number) => ({ id, projectName: NAME, scheduleProjectName: NAME, date: `2026-10-${String(day).padStart(2, '0')}`, notes: text, photos: [], recipients: { contactIds: [] }, status: 'sent', selectedAreaName: 'Roof' }) as unknown as ProjectUpdate;
const b71Updates = () => [b71Note('real', realNote, 1), ...Array.from({ length: 4 }, (_, i) => b71Note(`machine-${i}`, `Visitor log mentions project area group ${i}.`, i + 2))];
async function reopen71(updates: ProjectUpdate[]) {
  current?.unmount(); current = null;
  forgetAllReportSessionState(); mockDevice = 'phone'; mockAuthority = authority(updates, []);
  forgetDAVEReportCheckInput(); current = render(reportsScreen(updates, []));
  await waitFor(() => expect(heldDAVEReportCheckInput()).toMatchObject({ periodState: 'read', shared: 'checked' }), SLOW);
}
const removeTextKeys = (value: any): any => {
  if (!value || typeof value !== 'object') return value;
  const { appTextKey: _key, supersedes, ...rest } = value;
  return supersedes ? { ...rest, supersedes: removeTextKeys(supersedes) } : rest;
};
function legacy71() {
  for (const store of mockDevices.values()) for (const [key, raw] of store) {
    try { const parsed = JSON.parse(raw); if (parsed?.version === 'dave-report-snapshot/1.0') store.set(key, JSON.stringify(removeTextKeys(parsed))); } catch { /* unrelated local row */ }
  }
  for (const [key, row] of mockCloud) mockCloud.set(key, { ...row, snapshot: removeTextKeys(row.snapshot) });
}

import fs from 'fs';
import {world,NOW,PAIRS} from '../fixtures/b75-unicode-world';
const b75Records:any[]=[];
const scenarioNames=['unicode-changed-order','unicode-already-ordered','ascii-unchanged']as const;
function scenario(label:string){const names=label==='ascii-unchanged'?['4410 Alder Works','Zinnia Court']:[...PAIRS[0]];return world(names,label==='unicode-already-ordered'?0:1);}
function actualBody(){const preview=screen.UNSAFE_root.findAll((n:any)=>typeof n.type==='function'&&n.type.name==='ReportDocumentPreview')[0];expect(preview).toBeTruthy();return preview.props.reportDraft.body as string;}
function flags(){return{share:!!screen.queryByRole('button',{name:'Share Report'}),approve:!!screen.queryByRole('button',{name:'Approve Report'}),review:!!screen.queryByRole('button',{name:`Mark reviewed: ${REVIEW_ITEM}`})};}
function restore(row:any){mockDevices.clear();for(const [device,entries]of row.stores)mockDevices.set(device,new Map(entries));mockCloud.clear();for(const [key,value]of row.cloud)mockCloud.set(key,value);}
async function open75(w:ReturnType<typeof world>){current?.unmount();current=null;forgetAllReportSessionState();mockDevice='phone';mockAuthority=authority(w.updates as never,w.tasks as never);forgetDAVEReportCheckInput();current=render(reportsScreen(w.updates as never,w.tasks as never));await waitFor(()=>expect(heldDAVEReportCheckInput()).toMatchObject({periodState:'read',shared:'checked',format:phoneFormat}),SLOW);for(let i=0;i<5;i++)await settle();}
afterAll(()=>{if(process.env.B75_RECORD)fs.writeFileSync(process.env.B75_RECORD,JSON.stringify(b75Records,null,2)+'\n');});

it.each(scenarioNames.flatMap(label=>['project_manager','executive'].flatMap(format=>[false,true].map(legacy=>({label,format,legacy})))) )('actual desktop saved native period $label/$format/legacy=$legacy records printed output and sent recognition',async({label,format,legacy})=>{
 const rows=JSON.parse(fs.readFileSync(process.env.B75_BASELINE!,'utf8')),row=rows.find((r:any)=>r.label===label&&r.format===format);restore(row);if(legacy)legacy71();
 const w=scenario(label);setClock(NOW);mockAuth.snapshot={...w.snapshot,tasksPulledAt:NOW};mockAuth.freshness={status:'connected',lastSuccessfulRefreshAt:NOW,lastAttemptAt:NOW,consecutiveFailures:0};
 current=render(<DesktopReadOnlyShell page="reports"/>);
 await screen.findByLabelText('Since the last report',{},SLOW);await settle();
 fireEvent.press(screen.getByText('Review & Prepare Report'));await settle();
 if(format==='executive'){fireEvent.press(screen.getByLabelText('Executive Summary report'));await settle();}
 for(let i=0;i<6;i++)await settle();
 fireEvent.press(screen.getByText('Edit Report'));const body=screen.getByLabelText('Report body').props.value as string;
 const since=textOf(screen.getByLabelText('Since the last report'));expect(body).toContain(w.names[0]);expect(body).toContain(w.names[1]);
 b75Records.push({label,format,legacy,body,since});
});
