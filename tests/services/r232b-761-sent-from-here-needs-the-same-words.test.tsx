/**
 * R232 review pass 1, R1 (Medium, caused by 966bfefc; Build 233): "This device sent this report" over a report whose
 * words changed.
 *
 * 7.61 (966bfefc) shows the report this device sent last for its period as sent when it is the same report by its
 * fingerprint and nothing is edited on screen. The fingerprint has an older hole: a project named with no Latin letter
 * or digit ("Башня Север"), or only "the", "building", "project" ("The Building Project"), gets an empty key in
 * services/DAVEProjectTruth.ts, so none of its field notes' words are in it. On the phone that sent the report, after a
 * field note was reworded ("Inspection passed." to "Inspection FAILED."), the screen said "This device sent this
 * report", offered Share Report and no Approve Report, and Copy sent the new words unapproved.
 *
 * Now the approval and the send keep a key of the report the app wrote for those facts (`appTextKey`), and "sent from
 * here" also needs the app to write that same report now: a reworded note asks for Approve Report again. A send
 * recorded before Build 233 kept no key and keeps the fingerprint's rule. Which updates match which project, and the
 * fingerprints, are unchanged. The Reports screen is real, on two devices with one shared record (the rig of
 * r232-761-own-sent-report-shows-as-sent and the reviewer's rvR232-1-p761b / -p761c). Made-up names. No network.
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

const REVIEW_ITEM = 'Some source evidence has low confidence.';
const stub = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: true, reviewFlags: [REVIEW_ITEM], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};
/** The app's own draft for these updates and tasks, as the provider makes it. */
const appDraft = (updates: ProjectUpdate[], items: ScheduleItem[]) => {
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
  return { ...stub, openingLine: real.openingLine, closingLine: real.closingLine, locationGroups: real.locationGroups };
};
const authority = (updates: ProjectUpdate[], items: ScheduleItem[]) => {
  const draft = appDraft(updates, items);
  return {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
};

const onCopyReport = jest.fn(async (_report: { body: string }) => 'completed' as const);
/** Email Report: Mail said "Saved" (nothing is recorded until he says it went: Mark as Sent). */
const onEmailReport = jest.fn(async () => 'unknown' as const);
const reportsScreen = (updates: ProjectUpdate[], items: ScheduleItem[]) => (
  <ReportsScreen
    projectName={NAME}
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={[NAME]}
    selectedProjectNames={[NAME]}
    onToggleProject={() => undefined}
    reportFormat="project_manager"
    onReportFormatChange={() => undefined}
    updates={updates as never}
    scheduleItems={items as never}
    knownScheduleItems={items as never}
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport as never}
    onEmailReport={onEmailReport as never}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);

let current: ReturnType<typeof render> | null = null;
/** Opens Reports afresh on `device` (a new app session there). */
const visit = (device: string, updates: ProjectUpdate[], items: ScheduleItem[]) => {
  current?.unmount();
  forgetAllReportSessionState();
  mockDevice = device;
  mockAuthority = authority(updates, items);
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
  onEmailReport.mockClear();
});

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const approvable = () => screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
const approve = async () => {
  fireEvent.press(await screen.findByRole('button', { name: `Mark reviewed: ${REVIEW_ITEM}` }, SLOW));
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
};
const share = async (label: 'Copy Report' | 'Email Report') => {
  fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  fireEvent.press(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  await settle();
  await settle();
};
/** Edit Report: he adds a sentence at the end. */
const HIS_SENTENCE = 'NOTE FROM THE OFFICE: crane booked for Monday.';
const edit = async () => {
  fireEvent.press(await screen.findByRole('button', { name: 'Edit Report' }, SLOW));
  const body = await screen.findByPlaceholderText('Report body', {}, SLOW);
  fireEvent.changeText(body, `${String(body.props.value)}\n${HIS_SENTENCE}`);
  for (let i = 0; i < 3; i += 1) await settle();
};
const cloudRow = () => Array.from(mockCloud.entries()).find(([key]) => key.endsWith('|project_manager'))?.[1];
const lastCopied = () => String(onCopyReport.mock.calls.at(-1)?.[0]?.body ?? '');

const shown = () => ({
  approveOffered: Boolean(screen.queryByRole('button', { name: 'Approve Report' })),
  shareOffered: Boolean(screen.queryByRole('button', { name: 'Share Report' })),
  reviewAsked: Boolean(screen.queryByRole('button', { name: `Mark reviewed: ${REVIEW_ITEM}` })),
  sentFromHere: Boolean(screen.queryByText(/^This device sent this report /)),
  otherDevice: Boolean(screen.queryByText(/^Your other device already sent this report/)),
});
const AS_SENT = { approveOffered: false, shareOffered: true, reviewAsked: false, sentFromHere: true, otherDevice: false };
/** Offered for approval: Approve Report there, no Share Report (so no Copy), no "This device sent this report". */
const OFFERED = expect.objectContaining({ approveOffered: true, shareOffered: false, sentFromHere: false });

/** 13 Oct: the period's report, sent by the iPad. */
async function theIpadSentOnTheThirteenth() {
  setClock('2026-10-13T23:00:00.000Z');
  visit('ipad', W.ON_THE_PHONE, W.TASKS);
  await approve();
  await share('Copy Report');
  await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
  current?.unmount();
  current = null;
}
/** 14 Oct, 18:35 local: the phone opens Reports on the day-2 records (and approves). */
async function thePhoneApproves(updates: ProjectUpdate[] = W.DAY2, edited = false) {
  setClock('2026-10-15T01:35:00.000Z');
  visit('phone', updates, W.TASKS_DAY2);
  if (edited) await edit();
  await approve();
}
const SENT_AT = '2026-10-15T01:35:00.000Z';
async function thePhoneCopies() {
  await share('Copy Report');
  await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(SENT_AT), SLOW);
}
/** The app opened again on the phone (a new session; it keeps its storage), with these records. */
async function openedAgain(updates: ProjectUpdate[], at = '2026-10-15T01:41:00.000Z') {
  current?.unmount();
  current = null;
  setClock(at);
  forgetAllReportSessionState();
  mockDevice = 'phone';
  mockAuthority = authority(updates, W.TASKS_DAY2);
  current = render(reportsScreen(updates, W.TASKS_DAY2));
  await screen.findByText(/Since the report sent/, {}, SLOW);
  for (let i = 0; i < 6; i += 1) await settle();
}
/** A record as Build 232 saved it: no key of the report's words. */
const withoutKeys = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  const { appTextKey: _key, supersedes, ...rest } = value as Record<string, unknown>;
  return supersedes ? { ...rest, supersedes: withoutKeys(supersedes) } : rest;
};
const asBuild232SavedThem = () => {
  for (const store of mockDevices.values()) {
    for (const [key, raw] of Array.from(store.entries())) {
      try {
        const parsed = JSON.parse(raw) as { version?: string };
        if (parsed?.version === 'dave-report-snapshot/1.0') store.set(key, JSON.stringify(withoutKeys(parsed)));
      } catch { /* not JSON */ }
    }
  }
  for (const [key, row] of Array.from(mockCloud.entries())) mockCloud.set(key, { ...row, snapshot: withoutKeys(row.snapshot) });
};

describe('R1: "This device sent this report" only while the app writes the report that went out', () => {
  it.each(['Башня Север', 'The Building Project'])('P7 "%s": a field note reworded after the phone sent the report: Approve Report asked for, not "sent"', async name => {
    NAME = name;
    W = world();
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneApproves();
    await thePhoneCopies();
    expect(shown()).toEqual(AS_SENT);
    const sent = lastCopied();
    expect(sent).toContain('Inspection passed.');
    await openedAgain(W.REWORDED);
    // The new words are offered for approval: no Share Report, so nothing goes out unapproved.
    expect(shown()).toEqual(OFFERED);
    expect(screen.queryByRole('button', { name: 'Copy Report' })).toBeNull();
  });

  it('guard ("Башня Север"): the same words, opened again and the next morning: still shown as sent', async () => {
    NAME = 'Башня Север';
    W = world();
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneApproves();
    await thePhoneCopies();
    await openedAgain(W.DAY2);
    expect(shown()).toEqual(AS_SENT);
    await openedAgain(W.DAY2, '2026-10-15T15:10:00.000Z');
    expect(shown()).toEqual(AS_SENT);
  });

  it('guard: a send recorded before Build 233 (no key kept) keeps 966bfefc\'s rule: the same report shows as sent', async () => {
    NAME = 'Tower';
    W = world();
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneApproves();
    await thePhoneCopies();
    asBuild232SavedThem();
    await openedAgain(W.DAY2);
    expect(shown()).toEqual(AS_SENT);
  });

  it('Mark as Sent: the approval\'s key is what went out; a note reworded afterwards asks for Approve Report', async () => {
    NAME = 'Башня Север';
    W = world();
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneApproves();
    await share('Email Report');
    fireEvent.press(await screen.findByRole('button', { name: 'Mark as Sent' }, SLOW));
    fireEvent.press(screen.getByRole('button', { name: 'Record as Sent' }));
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(SENT_AT), SLOW);
    await openedAgain(W.DAY2);
    expect(shown()).toEqual(AS_SENT);
    await openedAgain(W.REWORDED);
    expect(shown()).toEqual(OFFERED);
  });

  it('approved, e-mailed (Mail said Saved), a note reworded, approved again, then Mark as Sent: the second approval is what went out', async () => {
    NAME = 'Башня Север';
    W = world();
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneApproves();
    await share('Email Report');
    // The note changes: another text, so the approval ends; he reviews the new words and approves them.
    mockAuthority = authority(W.REWORDED, W.TASKS_DAY2);
    current?.rerender(reportsScreen(W.REWORDED, W.TASKS_DAY2));
    for (let i = 0; i < 4; i += 1) await settle();
    await approvable();
    fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
    await screen.findByRole('button', { name: 'Share Report' }, SLOW);
    for (let i = 0; i < 3; i += 1) await settle();
    fireEvent.press(await screen.findByRole('button', { name: 'Mark as Sent' }, SLOW));
    fireEvent.press(screen.getByRole('button', { name: 'Record as Sent' }));
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(SENT_AT), SLOW);
    await openedAgain(W.REWORDED);
    expect(shown()).toEqual(AS_SENT);
  });

  it('his edit sent, then a field note reworded: Approve Report asked for (the app no longer writes the report it sent)', async () => {
    NAME = 'Башня Север';
    W = world();
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneApproves(W.DAY2, true);
    await thePhoneCopies();
    expect(lastCopied()).toContain(HIS_SENTENCE);
    await openedAgain(W.DAY2);
    expect(shown()).toEqual(AS_SENT);
    await openedAgain(W.REWORDED);
    expect(shown()).toEqual(expect.objectContaining({ approveOffered: true, sentFromHere: false }));
  });

  it('his edit approved, a note reworded before he sent it: the send keeps the report the app wrote then, and shows as sent after a relaunch', async () => {
    NAME = 'Башня Север';
    W = world();
    await theIpadSentOnTheThirteenth();
    mockDevices.delete('phone');
    await thePhoneApproves(W.DAY2, true);
    // The note changes while his approved edit is on screen (his edit and approval stand: same fingerprint, his words).
    mockAuthority = authority(W.REWORDED, W.TASKS_DAY2);
    current?.rerender(reportsScreen(W.REWORDED, W.TASKS_DAY2));
    for (let i = 0; i < 4; i += 1) await settle();
    await thePhoneCopies();
    expect(lastCopied()).toContain(HIS_SENTENCE);
    await openedAgain(W.REWORDED);
    expect(shown()).toEqual(AS_SENT);
  });
});
