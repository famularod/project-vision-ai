/** 7.67: older empty project-key residual. Synthetic two-device ReportsScreen rig
 * adapted from r232b-761. No network. Keep modern exact appTextKey recognition;
 * legacy sends under names the existing truth key cannot represent need approval.
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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { describeReportSendTime } from '../../services/DAVEReportSnapshot';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { recordScheduleCloudPull, registerScheduleCloudPullRequest } from '../../services/ScheduleCloudPull';
import type { ProjectUpdate, ScheduleItem } from '../../types';

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

/** The project's name, set by each test before its records are made. */
let NAME = 'Башня Север';
const task = (id: string, taskName: string, area: string, percent: number, finish: string, owner = 'Dana') => ({
  id, projectName: NAME, scheduleProjectName: NAME, locationName: area, taskName,
  startDate: '09/01/2026', finishDate: finish, milestone: '', owner, contractor: 'Acme',
  percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
}) as unknown as ScheduleItem;
const photo = (id: string, area: string, caption: string) => ({
  id, uri: `file:///photos/${id}.jpg`, caption, category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: area,
});
const update = (id: string, item: ScheduleItem, at: string, notes: string, photos: unknown[]) => ({
  id, projectName: NAME, scheduleProjectName: NAME, date: at, photos, recipients: { contactIds: [] }, notes, status: 'sent',
  scheduleItemId: item.id, scheduleTaskName: item.taskName, selectedAreaName: item.locationName || '',
}) as unknown as ProjectUpdate;
/** The records of r232-761's rig, under the project name `NAME`. */
function world() {
  const TASKS = [
    task('frame', 'Frame walls', 'Level 2', 100, '09/30/2026'),
    task('pour', 'Pour slab', 'Level 1', 40, '10/09/2026'),
    task('roof', 'Set roof', 'Roof', 0, '03/31/2027', 'Luis'),
    task('paint', 'Paint lobby', 'Level 1', 10, '04/30/2027', 'Mara'),
  ];
  const ON_THE_PHONE = [
    update('u5', TASKS[1], '2026-10-05', 'West bay rebar failed inspection. Pour is on hold.', [photo('p5', 'Level 1', 'West bay rebar')]),
    update('u4', TASKS[3], '2026-10-03', 'Primer started in the lobby.', [photo('p4', 'Level 1', 'Lobby primer')]),
    update('u3', TASKS[2], '2026-10-03', 'Roof trusses were delivered.', [photo('p3', 'Roof', 'Trusses on site')]),
    update('u2', TASKS[0], '2026-10-02', 'Framing is complete on Level 2. Inspection passed.', [photo('p2', 'Level 2', 'Framing complete')]),
    update('u1', TASKS[1], '2026-10-01', 'Slab forms are set on the east bay.', [photo('p1', 'Level 1', 'East bay forms')]),
  ];
  const TASKS_DAY2 = TASKS.map(item => (item.id === 'pour'
    ? { ...item, percentComplete: 100, status: 'Complete', updatedAt: '2026-10-14T22:00:00.000Z' }
    : item)) as ScheduleItem[];
  const DAY2 = [update('u6', TASKS[2], '2026-10-14', 'Neighbor asked about weekend hours.', [photo('p6', '', '')]), ...ON_THE_PHONE];
  /** The same records with ONE field note reworded; nothing else. */
  const REWORDED = DAY2.map(item => (item.id === 'u2' ? { ...item, notes: 'Framing is complete on Level 2. Inspection FAILED.' } : item)) as ProjectUpdate[];
  return { TASKS, ON_THE_PHONE, TASKS_DAY2, DAY2, REWORDED };
}
let W = world();


import { buildDailyProjectUpdate } from '../../services/PIEReporter';
const FLAGS = Array.from({ length: 9 }, (_, index) => `Review field observation ${index + 1}.`);
const downloadWord = jest.fn(async (_report: unknown, _references: unknown) => 'unknown' as const);
const copyReport = jest.fn(async () => 'completed' as const);
let flags = FLAGS;
const props = () => ({
 projectName: NAME, reportType: 'daily_project_update' as const, onReportTypeChange: () => undefined,
 availableProjectNames: [NAME], selectedProjectNames: [NAME], onToggleProject: () => undefined,
 reportFormat: 'project_manager' as const, onReportFormatChange: () => undefined,
 updates: W.ON_THE_PHONE, scheduleItems: W.TASKS, knownScheduleItems: W.TASKS, onSavedUpdates: () => undefined,
 onCopyReport: copyReport, onEmailReport: async () => 'unknown' as const, onTextReport: async () => 'unknown' as const,
 onDownloadWordReport: downloadWord, onOutlookReport: async () => 'unknown' as const,
});
function makeAuthority(state = 'ready') {
 const generated = buildDailyProjectUpdate({ selectedProjectNames: [NAME], savedUpdates: W.ON_THE_PHONE, scheduleItems: W.TASKS } as never);
 const report = { ...generated, needsReview: flags.length > 0, reviewFlags: flags };
 return { state, policy: { reportGenerationAllowed: state === 'ready', layer4DecisionCreationAllowed: false }, reportDraft: report,
  runtime: { response: { reportDraft: report } }, executiveJudgmentRecord: null };
}
let current: ReturnType<typeof render>;
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const wordButton = () => screen.getByRole('button', { name: 'Download Word Report' });
async function open(state = 'ready') {
 mockAuthority = makeAuthority(state); current = render(<ReportsScreen {...props()} />);
 await screen.findByRole('button', { name: 'Download Word Report' });
 for (let i=0;i<8;i+=1) await settle();
}
async function mark(index: number) {
 fireEvent.press(screen.getByRole('button', { name: `Mark reviewed: ${FLAGS[index]}` })); await settle();
}
const visible = () => JSON.stringify(screen.toJSON());
beforeEach(() => {
 mockDevices.clear(); mockCloud.clear(); forgetAllReportSessionState(); mockDevice='phone'; NAME='Tower'; W=world(); flags=FLAGS;
 downloadWord.mockReset(); downloadWord.mockResolvedValue('unknown'); copyReport.mockClear();
 setClock('2026-10-15T01:35:00.000Z');
});
afterEach(() => { current?.unmount(); stopAppDownloads(); });

it('explains the review requirement beside Word before a tap and does not export unseen', async () => {
 await open();
 expect(wordButton().props.accessibilityHint).toMatch(/Before downloading Word: 9 items need your review/);
 expect(screen.getByText(/Before downloading Word: 9 items need your review/)).toBeTruthy();
 fireEvent.press(wordButton()); await settle(); expect(downloadWord).not.toHaveBeenCalled();
});
it('tracks 9 to 8 to reviewed, removes old policy refusals and downloads one unapproved review copy', async () => {
 await open(); fireEvent.press(wordButton()); await settle();
 expect(visible()).toContain('9 items need your review');
 await mark(0); expect(visible()).not.toContain('9 items need your review'); expect(visible()).toContain('8 items need your review');
 for(let i=1;i<9;i+=1) await mark(i);
 expect(visible()).not.toMatch(/(?:9|8|1) items? needs? your review/);
 expect(downloadWord).not.toHaveBeenCalled(); expect(copyReport).not.toHaveBeenCalled();
 fireEvent.press(wordButton()); await waitFor(() => expect(downloadWord).toHaveBeenCalledTimes(1));
 const sent = downloadWord.mock.calls[0][0] as { title: string };
 expect(sent.title).toContain('Review copy (not approved)');
 expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
 expect(Array.from(mockCloud.values()).some(row => row.deliveredAt !== null)).toBe(false);
});
it.each(['loading', 'ready'])('does not export blocked data/no evidence: %s', async state => {
 flags=state === 'ready' ? ['No supporting evidence is available for this report.'] : [];
 await open(state); fireEvent.press(wordButton()); await settle(); expect(downloadWord).not.toHaveBeenCalled();
 expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
});
it('keeps a genuine export failure when review policy changes', async () => {
 flags=[]; await open(); downloadWord.mockRejectedValueOnce(new Error('Synthetic export failure'));
 fireEvent.press(wordButton()); await screen.findByText('Report communication did not complete. Please try again.');
 flags=[FLAGS[0]]; mockAuthority=makeAuthority(); current.rerender(<ReportsScreen {...props()} />); await settle();
 fireEvent.press(wordButton()); await settle();
 expect(screen.getByText('Report communication did not complete. Please try again.')).toBeTruthy();
 await mark(0); expect(screen.getByText('Report communication did not complete. Please try again.')).toBeTruthy();
 expect(downloadWord).toHaveBeenCalledTimes(1);
 fireEvent.press(wordButton()); await waitFor(() => expect(downloadWord).toHaveBeenCalledTimes(2));
 expect(screen.queryByText('Report communication did not complete. Please try again.')).toBeNull();
});

it('starts only one Word export while its callback is outstanding', async () => {
 flags=[]; await open(); let finish!: (value: 'unknown') => void;
 downloadWord.mockImplementationOnce(() => new Promise(resolve => { finish=resolve; }));
 fireEvent.press(wordButton()); fireEvent.press(wordButton());
 await waitFor(() => expect(downloadWord).toHaveBeenCalledTimes(1));
 await act(async () => { finish('unknown'); });
 expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
});
