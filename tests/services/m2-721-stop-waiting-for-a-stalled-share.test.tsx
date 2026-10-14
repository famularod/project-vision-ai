/**
 * Open item 7.21, part one (the owner's authorisation of 13 Oct 2026): a send that has stalled can be stopped.
 *
 * Before: a share that never came back (a share sheet or composer that stalled) held Reports in "Waiting for the
 * selected share action to finish." with Share, Copy, Email and Text all off, until he left the screen; nothing on
 * screen let him stop. Now "Stop Waiting" stands under that line. It records nothing: a share that finishes later
 * is still recorded as sent (it went out), one that never finishes is not, and he can share again at once. The
 * Reports screen is real (one device's storage, one in-memory shared record, as the report rigs stand them up).
 * Part two (choosing recipients from the contact book) is described in notes/impl-high/NOTES-M2.txt, not built.
 * Made-up project. No network.
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
import type { DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
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
afterEach(() => stopAppDownloads());

const task = (id: string, taskName: string, area: string, percent: number, finish: string) => ({
  id, projectName: 'Tower', scheduleProjectName: 'Tower', locationName: area, taskName,
  startDate: '09/01/2026', finishDate: finish, milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
}) as unknown as ScheduleItem;
const TASKS = [
  task('frame', 'Frame walls', 'Level 2', 100, '09/30/2026'),
  task('pour', 'Pour slab', 'Level 1', 40, '12/09/2026'),
  task('roof', 'Set roof', 'Roof', 0, '03/31/2027'),
];
const update = (id: string, at: string, notes: string) => ({
  id, projectName: 'Tower', scheduleProjectName: 'Tower', date: at, photos: [], recipients: { contactIds: [] }, notes,
  status: 'sent', scheduleItemId: 'pour', scheduleTaskName: 'Pour slab', selectedAreaName: 'Level 1',
}) as unknown as ProjectUpdate;
const UPDATES = [update('u1', '2026-10-01', 'Slab forms are set on the east bay.')];

const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};

/** Copy Report: a share that comes back only when the test says so (a stalled share sheet). */
let finishShare: (outcome: 'completed' | 'cancelled') => void = () => undefined;
const onCopyReport = jest.fn(() => new Promise<'completed' | 'cancelled'>(resolve => { finishShare = resolve; }));
const reportsScreen = () => (
  <ReportsScreen
    projectName="Tower"
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower']}
    selectedProjectNames={['Tower']}
    onToggleProject={() => undefined}
    reportFormat="project_manager"
    onReportFormatChange={() => undefined}
    updates={UPDATES as never}
    scheduleItems={TASKS as never}
    knownScheduleItems={TASKS as never}
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
beforeEach(() => {
  mockDevices.clear();
  mockCloud.clear();
  mockDevice = 'phone';
  forgetAllReportSessionState();
  onCopyReport.mockClear();
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
});

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const WAITING = 'Waiting for the selected share action to finish.';
const STOPPED = 'Stopped waiting. If that share finishes later, the report is still recorded as sent. If you sent it another way, use Mark as Sent.';
const approveAndCopy = async () => {
  await screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
  fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
  await screen.findByText(WAITING, {}, SLOW);
};
const cloudRow = () => mockCloud.get('tower|project_manager') as { snapshot: DAVEReportSnapshot; deliveredAt: string | null } | undefined;
const copyIsOn = () => !screen.getByRole('button', { name: 'Copy Report' }).props.accessibilityState?.disabled;

describe('7.21: a stalled send can be stopped', () => {
  it('Stop Waiting gives the screen back, says what happens, and records nothing', async () => {
    setClock('2026-10-05T17:00:00.000Z');
    current = render(reportsScreen());
    await approveAndCopy();
    expect(copyIsOn()).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: 'Stop Waiting' }));
    await settle();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.getByText(STOPPED)).toBeTruthy();
    expect(copyIsOn()).toBe(true);
    expect(cloudRow()?.deliveredAt ?? null).toBeNull();
  });

  it('a share that finishes after he stopped waiting is still recorded as sent, once', async () => {
    setClock('2026-10-05T17:00:00.000Z');
    current = render(reportsScreen());
    await approveAndCopy();
    fireEvent.press(screen.getByRole('button', { name: 'Stop Waiting' }));
    await settle();
    await act(async () => { finishShare('completed'); });
    await settle();
    await settle();
    await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
    expect(onCopyReport).toHaveBeenCalledTimes(1);
  });

  it('after stopping he can share again, and that share is recorded', async () => {
    setClock('2026-10-05T17:00:00.000Z');
    current = render(reportsScreen());
    await approveAndCopy();
    fireEvent.press(screen.getByRole('button', { name: 'Stop Waiting' }));
    await settle();
    fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
    await screen.findByText(WAITING, {}, SLOW);
    expect(screen.queryByText(STOPPED)).toBeNull();
    await act(async () => { finishShare('completed'); });
    await waitFor(() => expect(screen.queryByText(WAITING)).toBeNull(), SLOW);
    await settle();
    await settle();
    await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
    expect(onCopyReport).toHaveBeenCalledTimes(2);
  });
});
