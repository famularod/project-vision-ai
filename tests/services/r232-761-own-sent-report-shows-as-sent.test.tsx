/**
 * Open item 7.61 (High, Build 232's device checks, check 8; this round's investigation): a report the iPhone had just
 * sent (Copy Report) was offered again on the iPhone, straight after and after the app was opened again: Approve Report,
 * "Copy, Email, and Text unlock after approval", the same "Since the report sent ..." and lines. The tester's phone
 * itself held the report as sent (its own-sends list); a copy he made of the re-offered report (19:33) was not even
 * recorded, because it WAS the report sent at 19:21.
 *
 * Cause (Build 232, a829bce8; the same code on 314873a4): the Reports screen showed a report as approved only while the
 * approval given in that app session stood (ReportSessionState, memory only); nothing told it that the report on screen
 * was the one THIS device had sent: "Your other device already sent this report" is for the other device's sends only.
 * So a relaunch offered it again every time (as tests/services/audit-a6-p9-two-device-report.test.tsx even required),
 * and so did anything that ended the session approval straight after the send: a review item that came and went (the
 * app's cloud check leaving "ready" a moment, which a freshly installed phone under load does) ended the approval, and
 * the screen read "Ready to Review" with Approve Report blue, exactly as the tester saw.
 *
 * Now the report this device sent last for the period, the same report (its fingerprint) with the same words, shows as
 * sent: no Approve Report, Share Report there, nothing to review again, and a line saying this device sent it. A change
 * since, or his edit, makes it another report, offered as before; the other device's send reads as before. The Reports
 * screen is real, on two devices with one shared record (the rigs of b232-phone-already-sent-is-the-report-sent). The
 * draft carries one review item. Synthetic data. No network.
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

import * as fs from 'fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { describeReportSendTime } from '../../services/DAVEReportSnapshot';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { recordScheduleCloudPull, registerScheduleCloudPullRequest } from '../../services/ScheduleCloudPull';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(240_000);
const SLOW = { timeout: 40_000 } as const;
const OUT = process.env.B232_OUT_DIR || '';
const note = (name: string, text: string) => { if (OUT) fs.writeFileSync(`${OUT}/${name}`, text); };

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

const task = (id: string, taskName: string, area: string, percent: number, finish: string, owner = 'Dana') => ({
  id, projectName: 'Tower', scheduleProjectName: 'Tower', locationName: area, taskName,
  startDate: '09/01/2026', finishDate: finish, milestone: '', owner, contractor: 'Acme',
  percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
}) as unknown as ScheduleItem;
const TASKS = [
  task('frame', 'Frame walls', 'Level 2', 100, '09/30/2026'),
  task('pour', 'Pour slab', 'Level 1', 40, '10/09/2026'),
  task('roof', 'Set roof', 'Roof', 0, '03/31/2027', 'Luis'),
  task('paint', 'Paint lobby', 'Level 1', 10, '04/30/2027', 'Mara'),
];
/**
 * Build 232 item 3 part 1: the same four tasks and two more that print lines of their own in the section (one
 * waiting, one high priority), as a device holds them that got them in the order of their finish dates...
 */
const MORE_TASKS = [
  TASKS[0],
  TASKS[1],
  { ...task('doors', 'Hang doors', 'Level 3', 0, '11/15/2026', 'Luis'), status: 'Waiting' } as ScheduleItem,
  { ...task('glass', 'Install storefront', 'Site', 0, '11/20/2026', 'Mara'), priority: 'High' } as ScheduleItem,
  TASKS[2],
  TASKS[3],
];
/** ...and as another device holds them: the app saves tasks in the order a sync leaves them. */
const MORE_TASKS_IN_ANOTHER_ORDER = [MORE_TASKS[3], MORE_TASKS[5], MORE_TASKS[0], MORE_TASKS[2], MORE_TASKS[4], MORE_TASKS[1]];
const photo = (id: string, area: string, caption: string) => ({
  id, uri: `file:///photos/${id}.jpg`, caption, category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: area,
});
const update = (id: string, item: ScheduleItem, at: string, notes: string, photos: unknown[]) => ({
  id, projectName: 'Tower', scheduleProjectName: 'Tower', date: at, photos, recipients: { contactIds: [] }, notes, status: 'sent',
  scheduleItemId: item.id, scheduleTaskName: item.taskName, selectedAreaName: item.locationName || '',
}) as unknown as ProjectUpdate;
const U1 = update('u1', TASKS[1], '2026-10-01', 'Slab forms are set on the east bay.', [photo('p1', 'Level 1', 'East bay forms')]);
const U2 = update('u2', TASKS[0], '2026-10-02', 'Framing is complete on Level 2. Inspection passed.', [photo('p2', 'Level 2', 'Framing complete')]);
const U3 = update('u3', TASKS[2], '2026-10-03', 'Roof trusses were delivered.', [photo('p3', 'Roof', 'Trusses on site')]);
const U4 = update('u4', TASKS[3], '2026-10-03', 'Primer started in the lobby.', [photo('p4', 'Level 1', 'Lobby primer')]);
const U5 = update('u5', TASKS[1], '2026-10-05', 'West bay rebar failed inspection. Pour is on hold.', [photo('p5', 'Level 1', 'West bay rebar')]);
/**
 * THE PHONE recorded all five field updates itself: each new one goes to the FRONT of its list (App.tsx,
 * upsertSavedUpdateUnlessDeleted: `localUpdates: [update, ...the rest]`).
 */
const ON_THE_PHONE = [U5, U4, U3, U2, U1];
/**
 * THE IPAD already had the first four from earlier syncs and received the fifth from the cloud just now: an update
 * new to a device goes to the END of its list (App.tsx, mergeSavedUpdatesWithTombstones: every local update first,
 * then the cloud's that are not there yet). The same five updates, word for word.
 */
const ON_THE_IPAD = [U4, U3, U2, U1, U5];

const REVIEW_ITEM = 'Some source evidence has low confidence.';
const stub = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  // One item to review, as his reports have (he marks it reviewed before approving).
  needsReview: true, reviewFlags: [REVIEW_ITEM], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};
/** The app's own draft for these updates and tasks, as the provider makes it: its opening line, closing line and work areas. */
const appDraft = (updates: ProjectUpdate[], items: ScheduleItem[]) => {
  const core = buildPIECoreIntelligence({
    runtimeContext: {
      projectName: 'Tower', projectNames: ['Tower'], reportType: 'daily_project_update',
      updates, scheduleItems: items, knownScheduleItems: items, currentUpdate: null,
      projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'reports',
    } as never,
    reportType: 'daily_project_update' as never, reportProjectNames: ['Tower'],
    organizationId: 'local-unverified-anonymous', projectId: 'project-tower',
  } as never);
  const real = core.reportDraft as unknown as { openingLine: string; closingLine: string; locationGroups: unknown[] };
  return { ...stub, openingLine: real.openingLine, closingLine: real.closingLine, locationGroups: real.locationGroups };
};

const onCopyReport = jest.fn(async (_report: { body: string }) => 'completed' as const);
const reportsScreen = (updates: ProjectUpdate[], items: ScheduleItem[]) => (
  <ReportsScreen
    projectName="Tower"
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower']}
    selectedProjectNames={['Tower']}
    onToggleProject={() => undefined}
    reportFormat="project_manager"
    onReportFormatChange={() => undefined}
    updates={updates as never}
    scheduleItems={items as never}
    knownScheduleItems={items as never}
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport as never}
    onEmailReport={async () => 'unknown'}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);

let current: ReturnType<typeof render> | null = null;
/** Opens Reports afresh on `device` (a new app session there), with the updates in the order that device holds them. */
const visit = (device: string, updates: ProjectUpdate[], items: ScheduleItem[] = TASKS) => {
  current?.unmount();
  forgetAllReportSessionState();
  mockDevice = device;
  const draft = appDraft(updates, items);
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
  current = render(reportsScreen(updates, items));
  return current;
};
afterEach(() => { current?.unmount(); current = null; });
beforeEach(() => {
  mockDevices.clear();
  mockCloud.clear();
  mockDevice = 'phone';
  forgetAllReportSessionState();
  onCopyReport.mockClear();
});

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const approvable = () => screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
const approve = async () => {
  // He marks the review item reviewed, then approves.
  fireEvent.press(await screen.findByRole('button', { name: `Mark reviewed: ${REVIEW_ITEM}` }, SLOW));
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
};
const copy = async () => {
  fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  await settle();
  await settle();
};
const cloudRow = () => mockCloud.get('tower|project_manager');
const lastCopied = () => String(onCopyReport.mock.calls.at(-1)?.[0]?.body ?? '');
const section = (body: string) => { const at = body.indexOf('WORK AREAS / PHOTO NOTES'); return at >= 0 ? body.slice(at) : '(none)'; };
const ALREADY_SENT = (sentAt: string) => `Your other device already sent this report ${describeReportSendTime(sentAt)}. Approve it only if you want to send it a second time.`;


const shown = () => ({
  approveOffered: Boolean(screen.queryByRole('button', { name: 'Approve Report' })),
  shareOffered: Boolean(screen.queryByRole('button', { name: 'Share Report' })),
  reviewAsked: Boolean(screen.queryByRole('button', { name: `Mark reviewed: ${REVIEW_ITEM}` })),
  sentFromHere: Boolean(screen.queryByText(/^This device sent this report /)),
  otherDevice: Boolean(screen.queryByText(/^Your other device already sent this report/)),
});
const AS_SENT = { approveOffered: false, shareOffered: true, reviewAsked: false, sentFromHere: true, otherDevice: false };
const OFFERED = expect.objectContaining({ approveOffered: true, shareOffered: false, sentFromHere: false });

const TASKS_DAY2 = TASKS.map(item => (item.id === 'pour'
  ? { ...item, percentComplete: 100, status: 'Complete', updatedAt: '2026-10-14T22:00:00.000Z' }
  : item)) as ScheduleItem[];
const U6 = update('u6', TASKS[2], '2026-10-14', 'Neighbor asked about weekend hours.', [photo('p6', '', '')]);
const DAY2 = [U6, ...ON_THE_PHONE];

/** 13 Oct: the period's report, sent by the iPad (the tester's phone was freshly installed: nothing of its own). */
async function theIpadSentOnTheThirteenth() {
  setClock('2026-10-13T23:00:00.000Z');
  visit('ipad', ON_THE_PHONE, TASKS);
  await approve();
  await copy();
  await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
  current?.unmount();
  current = null;
}
/** 14 Oct, 18:35 local (01:35 UTC on the 15th): something changed; the phone approves the report and copies it. */
async function thePhoneSends(updates: ProjectUpdate[] = DAY2) {
  setClock('2026-10-15T01:35:00.000Z');
  visit('phone', updates, TASKS_DAY2);
  await approve();
  await copy();
  await waitFor(() => expect(cloudRow()?.deliveredAt).toBe('2026-10-15T01:35:00.000Z'), SLOW);
}
/** The app opened again on `device` (a new session; the device keeps its storage), with these records. */
async function openedAgain(device: string, updates: ProjectUpdate[] = DAY2, at = '2026-10-15T01:41:00.000Z') {
  current?.unmount();
  current = null;
  setClock(at);
  forgetAllReportSessionState();
  mockDevice = device;
  const draft = appDraft(updates, TASKS_DAY2);
  mockAuthority = { state: 'ready', policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false }, reportDraft: draft, runtime: { response: { reportDraft: draft } }, executiveJudgmentRecord: null };
  current = render(reportsScreen(updates, TASKS_DAY2));
  await screen.findByText(/Since the report sent/, {}, SLOW);
  for (let i = 0; i < 6; i += 1) await settle();
}

describe('7.61: the report this phone sent shows as sent on this phone', () => {
  it('the app opened again (the tester\'s check 19 step 4, and check 8 day 2 step 8): no Approve Report, Share Report there, nothing to review again', async () => {
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneSends();
    expect(shown()).toEqual(AS_SENT);
    await openedAgain('phone');
    expect(shown()).toEqual(AS_SENT);
    expect(screen.getByText(`This device sent this report ${describeReportSendTime('2026-10-15T01:35:00.000Z')}. Share it again only if you want to send it a second time.`)).toBeTruthy();
    // The next morning, nothing changed: still sent.
    await openedAgain('phone', DAY2, '2026-10-15T15:10:00.000Z');
    expect(shown()).toEqual(AS_SENT);
  });

  it('straight after the send, a review item that comes and goes (the app\'s cloud check) does not offer it again (check 8 day 1)', async () => {
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneSends();
    const ready = mockAuthority;
    mockAuthority = { ...ready, state: 'queued_for_cloud', policy: { ...(ready.policy as object), reportGenerationAllowed: false } };
    current?.rerender(reportsScreen(DAY2, TASKS_DAY2));
    for (let i = 0; i < 4; i += 1) await settle();
    mockAuthority = ready;
    current?.rerender(reportsScreen(DAY2, TASKS_DAY2));
    for (let i = 0; i < 4; i += 1) await settle();
    expect(shown()).toEqual(AS_SENT);
  });

  it('shared again from there, it is not recorded as a second send', async () => {
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneSends();
    await openedAgain('phone');
    const copiesBefore = onCopyReport.mock.calls.length;
    await copy();
    // It went out (he chose to send it a second time), and nothing more is recorded: it is the report sent.
    expect(onCopyReport).toHaveBeenCalledTimes(copiesBefore + 1);
    expect(cloudRow()?.deliveredAt).toBe('2026-10-15T01:35:00.000Z');
    expect(shown()).toEqual(AS_SENT);
  });

  it('a change since the send is another report: offered, as before', async () => {
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneSends();
    const later = [update('u7', TASKS[3], '2026-10-14', 'Lobby primer second coat started.', []), ...DAY2];
    await openedAgain('phone', later);
    expect(shown()).toEqual(OFFERED);
  });

  it('his own edit after the send is another report: offered, as before', async () => {
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneSends();
    fireEvent.press(await screen.findByRole('button', { name: 'Edit Report' }, SLOW));
    const body = await screen.findByPlaceholderText('Report body', {}, SLOW);
    fireEvent.changeText(body, `${String(body.props.value)}\nNOTE FROM THE OFFICE: test.`);
    for (let i = 0; i < 3; i += 1) await settle();
    expect(shown()).toEqual(expect.objectContaining({ shareOffered: false, sentFromHere: false }));
  });

  it('the other device still reads it as its other device\'s send, as before', async () => {
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneSends();
    await openedAgain('ipad');
    expect(shown()).toEqual(expect.objectContaining({ approveOffered: true, sentFromHere: false, otherDevice: true }));
  });
});
