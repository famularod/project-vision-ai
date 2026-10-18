/** B63: original grouped 7.81, replayed against frozen B62. Synthetic rows only.
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
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, data });
jest.mock('../../services/SupabaseService', () => ({
  getSupabaseClient: () => null,
  loadReportSnapshotCloud: jest.fn(async (scopeKey: string, format: string) => (
    mockOk({ ownerId: 'owner-1', snapshot: mockCloud.get(`${scopeKey}|${format}`)?.snapshot ?? null })
  )),
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

const NAME = 'Harbor Point';
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
  importedAt: '2026-10-14T22:30:00.000Z', projectId: PROJECT_CLOUD_ID, projectName: NAME, projectNames: [NAME],
}];
const REVIEW_ITEM = 'Some source evidence has low confidence.';
const stub = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Harbor Point update', subject: 'Harbor Point update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: true, reviewFlags: [REVIEW_ITEM], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};
const authority = (updates: ProjectUpdate[], items: ScheduleItem[]) => {
  const core = buildPIECoreIntelligence({
    runtimeContext: {
      projectName: NAME, projectNames: [NAME], reportType: 'daily_project_update',
      updates, scheduleItems: items, knownScheduleItems: items, currentUpdate: null,
      projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'reports',
    } as never,
    reportType: 'daily_project_update' as never, reportProjectNames: [NAME],
    organizationId: 'local-unverified-anonymous', projectId: 'project-x',
  } as never);
  const real = core.reportDraft as unknown as { openingLine: string; closingLine: string; locationGroups: unknown[] };
  const draft = { ...stub, openingLine: real.openingLine, closingLine: real.closingLine, locationGroups: real.locationGroups };
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
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={[NAME]}
    selectedProjectNames={[NAME]}
    onToggleProject={() => undefined}
    reportFormat={phoneFormat}
    onReportFormatChange={() => undefined}
    updates={updates as never}
    scheduleItems={items as never}
    knownScheduleItems={items as never}
    referenceDocuments={DOCUMENTS as never}
    knownScheduleDocuments={DOCUMENTS as never}
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
  current = render(reportsScreen(updates, items));
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
const SENT_AT = '2026-10-15T16:17:00.000Z';
/** 13 Oct, 14 Oct (the iPad, then the phone), and the phone's report of 15 Oct at 9:17 (local), counted from 14 Oct. */
async function thePhoneSendsAtNineSeventeen(final: ScheduleItem[] = OCT15) {
  await deviceSends('ipad', UPDATES_13, onThePhone(BASE_TASKS), '2026-10-13T23:00:00.000Z');
  await deviceSends('phone', UPDATES, OCT14, '2026-10-15T01:35:00.000Z');
  return deviceSends('phone', UPDATES, final, SENT_AT);
}

/** When each record was last written to the cloud: a task when it was saved, a field update the evening of 14 Oct ('' for a row with no time). */
const savedAt = (item: ScheduleItem) => new Date(Date.parse(String(item.updatedAt ?? item.createdAt)) + 20_000).toISOString();
/** The cloud's rows of these records as the phone uploads them, read by the computer's own loader. */
async function computerReads(updates: ProjectUpdate[], items: ScheduleItem[], at: string, written: Record<string, string> = {}, pulledAt = at) {
  mockRows.rows = {
    projects: [{ id: PROJECT_CLOUD_ID, name: NAME, archived: false, created_at: '2026-09-01T12:00:00.000Z', updated_at: '2026-09-01T12:00:00.000Z', owner_id: 'owner-1', project_data: null }],
    scheduleItems: items.map(item => ({ id: item.id, item_data: json(item), created_at: String((item as any).createdAt), updated_at: (written[item.id] ?? savedAt(item)) || null })),
    projectUpdates: updates.map(record => ({ id: record.id, project_name: record.projectName, created_at: `${record.date}T12:00:00.000Z`, updated_at: (written[record.id] ?? '2026-10-14T23:00:00.000Z') || null,
      update_data: json({ ...record, photos: record.photos.map(p => ({ ...p, cloudStoragePath: `project/${record.id}/${p.id}-${p.fileName}` })) }) })),
    syncTombstones: [], referenceDocuments: DOCUMENTS.map(document => ({ id: document.id, updated_at: '2026-10-14T22:30:00.000Z', document_data: json(document) })),
  };
  mockAuth.snapshot = { ...(await loadDAVEWebReadOnlySnapshot()), refreshedAt: at, tasksPulledAt: pulledAt };
}
const fsx = jest.requireActual('fs') as typeof import('fs');
/** (For the notes) what the computer showed, when N761E_OUT names a file. */
const log = (record: Record<string, unknown>) => { if (process.env.N761E_OUT) fsx.appendFileSync(process.env.N761E_OUT, `${JSON.stringify(record)}\n`); };
const desktopSettle = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); });
const ALREADY_SENT = /^Your other device already sent this report .*\. Approve it only if you want to send it a second time\.$/;
/** The computer opens Reports (a page load at `at`): its "Since the last report" card, and the review panel. */
async function computer(updates: ProjectUpdate[], items: ScheduleItem[], at: string, options: { written?: Record<string, string>; pulledAt?: string; executive?: boolean; approveAndShare?: boolean } = {}) {
  current?.unmount();
  current = null;
  setClock(at);
  await computerReads(updates, items, at, options.written, options.pulledAt);
  const view = render(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(screen.getByLabelText('Since the last report')).toBeTruthy(), { timeout: 20000 });
  await desktopSettle();
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  await desktopSettle();
  if (options.executive) {
    fireEvent.press(screen.getByLabelText('Executive Summary report'));
    await desktopSettle();
  }
  const card = textOf(screen.getByLabelText('Since the last report')).filter(line => line !== 'Since the last report');
  const result: Record<string, unknown> = {
    card,
    alreadySent: card.some(line => ALREADY_SENT.test(line)),
    readyForReview: allText().includes('Ready for review'),
    approveOffered: Boolean(screen.queryByText('Approve Report')),
    documentAdded: allText().some(line => line.includes('Schedules document added: D2.')),
  };
  if (options.approveAndShare) {
    fireEvent.press(screen.getByText('Approve Report'));
    await desktopSettle();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await desktopSettle();
    await desktopSettle();
    result.afterShare = allText().filter(line => /recorded|sent|Your other device|could not/i.test(line)).slice(0, 6);
  }
  view.unmount();
  return result;
}
const SINCE_OCT14_ON_THE_PHONE = ['Since the report sent Oct 14, 2026', '+2', 'Harbor Point: No-area check was added to the project plan.', 'Harbor Point: Paint lobby is back in the project plan.'];
const SINCE_OCT14 = ['Since the report sent Oct 14, 2026', '+0 completed; +2 open; +0 overdue.', 'Harbor Point: No-area check was added to the project plan.', 'Harbor Point: Paint lobby is back in the project plan.'];
const TAKEN = expect.objectContaining({ card: [...SINCE_OCT14, 'Your other device already sent this report at 9:17 AM. Approve it only if you want to send it a second time.'], alreadySent: true });
/** As before the fix: the next report, counted from the send. */
const NEXT_REPORT = expect.objectContaining({ alreadySent: false, approveOffered: true });

const ALREADY_SENT_AT_917 = 'Your other device already sent this report at 9:17 AM. Approve it only if you want to send it a second time.';

jest.mock('expo-audio', () => ({ RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: jest.fn(), setAudioModeAsync: jest.fn(), useAudioRecorder: () => ({}), useAudioRecorderState: () => ({}), useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({}), AudioModule: {} }));
jest.mock('expo-contacts', () => ({ Fields: {} }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ MediaTypeOptions: {} }));
jest.mock('expo-location', () => ({ Accuracy: { Balanced: 3, High: 4 } }));
jest.mock('expo-mail-composer', () => ({ MailComposerStatus: {} }));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-sms', () => ({}));
import { normalizeScheduleItem as nativeSchedule } from '../../App';


import * as ReportTruths from '../../services/DAVEReportProjectTruths';
import {buildDAVELegacyReportSourceFingerprint} from '../../services/DAVEReportIntelligence';
const nativeGoldens:Record<string,string[]>=require('../fixtures/b64-native-low-year-legacy.json');
const historyCases=['0100','0202','0999','2000','2100','26','202','iso-0100','iso-0202','iso-0999'] as const;
it.each(historyCases)('B64 actual native normalization and ReportsScreen raw history for %s',async year=>{
 setClock(SENT_AT);const input=task('year-case','Inspect canopy','Court',40,`5/4/${year}`);input.startDate=`5/1/${year}`;if(year.startsWith('iso-')){input.startDate=year.slice(4)+'-05-01';input.finishDate=year.slice(4)+'-05-04';}const normalized=nativeSchedule(input);mockAuthority=authority([], [normalized]);
 const original=ReportTruths.buildDAVEReportProjectTruths;const calls:Array<{source:string;input:unknown}>=[];
 const spy=jest.spyOn(ReportTruths,'buildDAVEReportProjectTruths').mockImplementation(i=>{const result=original(i);calls.push({source:buildDAVELegacyReportSourceFingerprint(result),input:i});return result;});
 current=render(reportsScreen([], [normalized]));await desktopSettle();expect(calls.length).toBeGreaterThan(0);console.log('B64_NATIVE_RAW_HISTORY '+JSON.stringify({year,normalized:[normalized.startDate,normalized.finishDate],fingerprints:[...new Set(calls.map(c=>c.source))]}));if(nativeGoldens[year])expect([...new Set(calls.map(c=>c.source))]).toEqual(nativeGoldens[year]);spy.mockRestore();
});

for(const format of ['project_manager','executive'] as const){
 it.each(['0100','0202','0999'])('B64 '+format+' actual native send is recognized by desktop for %s',async year=>{
  phoneFormat=format;
  const raw=OCT15.map(t=>t.id==='noarea'?{...t,startDate:`5/1/${year}`,finishDate:`5/4/${year}`}:t);
  await thePhoneSendsAtNineSeventeen(raw.map(t=>nativeSchedule(t)));
  const web=await computer(UPDATES,raw,'2026-10-15T16:19:00.000Z',{executive:format==='executive'});
  console.log('B64_RECEIPT '+JSON.stringify({format,year,web}));expect(web.alreadySent).toBe(true);
  const changed=raw.map(t=>t.id==='noarea'?{...t,finishDate:`5/5/${year}`}:t);
  const newer=await computer(UPDATES,changed,'2026-10-15T16:19:00.000Z',{executive:format==='executive'});
  expect(newer.alreadySent).toBe(false);
 });
}
