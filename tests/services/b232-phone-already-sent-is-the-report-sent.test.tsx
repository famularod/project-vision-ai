/**
 * Build 232 item 2 (the coordinator's decision on reports review pass 4, P4-1 High and P4-2 Medium): "Your other
 * device already sent this report" is said above the report the other device sent, word for word.
 *
 * The reviewer's two failing proofs, kept. The Reports screen is real, on two devices (one app storage each, one
 * in-memory shared record with its keep-the-later-send rule, as the audit-a6-p9 / p10 rigs stand them up). What the
 * rigs before it did not have: the app's OWN draft, made by the app's own code (buildPIECoreIntelligence, what
 * PIELiveAuthorityProvider runs) from the very field updates and tasks the screen is given, in the order that
 * device holds them. Its opening line, closing line and the section WORK AREAS / PHOTO NOTES are what was never
 * set against the fingerprint. The draft's review flags are left out, so Approve is offered as in the rigs.
 *
 *  ORDER (part A): a device that records an update holds it at the FRONT of its list; a device that receives it
 *    by sync holds it at the END. The section took "latest", the notes that lead each area and the image numbers
 *    from the list's order, so the iPad's report read differently under "already sent" (P4-1 road a), and a report
 *    sent from the iPad called a three-day-old note the "Latest update" (P4-2). Now: by the updates' own dates.
 *  DAY (part B): the section ended "Schedule focus: Pour slab (Due in 4 days)", 3 days the next morning (P4-1
 *    road b). Now: the task's date.
 *
 * The field updates carry their date as the app saves it (a day, "2026-10-03"), two of them on one day.
 * Synthetic data. No network.
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

const stub = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
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

/** The section as the phone that recorded all five wrote it BEFORE this change, to the letter, but for the last line's date. */
const THE_SECTION = [
  'WORK AREAS / PHOTO NOTES',
  '• Tower — Level 1: West bay rebar failed inspection. Pour is on hold. See Images 1, 2, and 5.',
  '• Tower — Level 1: West bay rebar failed inspection. Pour is on hold.',
  '• Tower — Level 1: West bay rebar.',
  '• Tower — Roof: Roof trusses were delivered. See Image 3.',
  '• Tower — Level 2: Framing is complete on Level 2. Inspection passed.',
  '• Tower — Level 2: Framing complete.',
  '• Tower — Level 2: Dana – Please frame walls, status Complete.',
  '• Tower — Tower: West bay rebar failed inspection. Pour is on hold. Paint lobby: Ready. Continue monitoring Paint lobby. West bay rebar failed inspection. Pour is on hold. can block inspection readiness, downstream work, and closeout.',
  '• Tower — Tower: Resolve blocker for West bay rebar failed inspection. Pour is on hold.',
  '• Tower — Tower: Latest update: West bay rebar failed inspection. Pour is on hold. Latest photo: West bay rebar Schedule focus: Pour slab (SCHEDULE_FOCUS).',
  '',
  'Please let me know if you have any questions.',
].join('\n');
const sectionWith = (scheduleFocus: string) => THE_SECTION.replace('SCHEDULE_FOCUS', scheduleFocus);
/** The section with whatever stands in the schedule focus's brackets set aside (part B's business, not the order's). */
const butForTheDay = (text: string) => text.replace(/(Schedule focus: Pour slab) \([^)]*\)/, '$1 (SCHEDULE_FOCUS)');

/** The phone sends; `later`, the iPad opens Reports with the updates in `order`, reads the sentence, and sends again. */
const phoneSendsThenTheIpad = async (later: string, order: ProjectUpdate[], sentOn = '2026-10-05T17:00:00.000Z') => {
  setClock(sentOn);
  visit('phone', ON_THE_PHONE);
  await approve();
  await copy();
  await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
  const sentAt = cloudRow()?.deliveredAt as string;
  const sentFromThePhone = lastCopied();
  onCopyReport.mockClear();

  // The iPad, later: every task and all five updates downloaded.
  setClock(later);
  current?.unmount();
  current = null;
  mockDevice = 'ipad';
  await act(async () => { await recordScheduleCloudPull(new Date().toISOString()); });
  visit('ipad', order);
  const saidAlreadySent = Boolean(await screen.findByText(ALREADY_SENT(sentAt), {}, SLOW).catch(() => null));
  // He takes the screen at its word ("Approve it only if you want to send it a second time") and sends it again.
  await approve();
  await copy();
  const sentFromTheIpad = lastCopied();
  // Nothing more is recorded for the second send (it is "the same report").
  expect(cloudRow()?.deliveredAt).toBe(sentAt);
  return { saidAlreadySent, sentFromThePhone, sentFromTheIpad };
};

describe('B232 item 2: "Your other device already sent this report" is said of the report that was sent', () => {
  it('ORDER (review P4-1, proof 1): the iPad received the newest update by sync, so its list is in another order: it says "already sent", and its report is the phone\'s, word for word', async () => {
    const { saidAlreadySent, sentFromThePhone, sentFromTheIpad } = await phoneSendsThenTheIpad('2026-10-05T17:30:00.000Z', ON_THE_IPAD);
    note('order-phone-sent.txt', sentFromThePhone);
    note('order-ipad-would-send.txt', sentFromTheIpad);
    expect({ saidAlreadySent, theSameReport: sentFromTheIpad === sentFromThePhone }).toEqual({ saidAlreadySent: true, theSameReport: true });
    // And nothing is dropped, doubled or renumbered for the phone that recorded them all: its section is what it
    // was before this change, to the letter (the schedule focus's day aside).
    expect(butForTheDay(section(sentFromThePhone))).toBe(THE_SECTION);
  });

  it('ORDER (review P4-2): sent from the device that RECEIVED the newest update, "Latest update" is the newest, and the newest note leads its area, on both devices', async () => {
    const reports: Record<string, string> = {};
    for (const [device, order] of [['ipad', ON_THE_IPAD], ['phone', ON_THE_PHONE]] as const) {
      mockDevices.clear();
      mockCloud.clear();
      onCopyReport.mockClear();
      setClock('2026-10-05T17:00:00.000Z');
      visit(device, order);
      await approve();
      await copy();
      reports[device] = lastCopied();
    }
    for (const device of ['ipad', 'phone']) {
      const lines = section(reports[device]).split('\n');
      expect({ device, latest: lines.find(line => line.includes('Latest update:')) }).toEqual({
        device, latest: expect.stringContaining('Latest update: West bay rebar failed inspection. Pour is on hold. Latest photo: West bay rebar '),
      });
      // Level 1 has three notes (1 Oct, 3 Oct, 5 Oct): the one of 5 Oct leads.
      expect({ device, leads: lines.find(line => line.includes('Tower — Level 1:')) }).toEqual({
        device, leads: '• Tower — Level 1: West bay rebar failed inspection. Pour is on hold. See Images 1, 2, and 5.',
      });
    }
    expect(reports.ipad).toBe(reports.phone);
  });

  // ---- part B: the day ----
  it('DAY (review P4-1, proof 2): the next morning, nothing changed: the iPad says "already sent", and its report is the phone\'s, word for word', async () => {
    const { saidAlreadySent, sentFromThePhone, sentFromTheIpad } = await phoneSendsThenTheIpad('2026-10-06T15:00:00.000Z', ON_THE_PHONE);
    note('day-phone-sent-5-oct.txt', sentFromThePhone);
    note('day-ipad-would-send-6-oct.txt', sentFromTheIpad);
    expect({ saidAlreadySent, theSameReport: sentFromTheIpad === sentFromThePhone }).toEqual({ saidAlreadySent: true, theSameReport: true });
    // The task in focus is given its date, as the rest of the written report gives a task's date ("due 10/09/2026"
    // under CURRENT WORK), not a count of days from today; nothing else in the section is another word.
    expect(section(sentFromThePhone)).toBe(sectionWith('due 10/09/2026'));
    expect(sentFromThePhone).toContain('• Pour slab (Level 1): In Progress; 40% complete; due 10/09/2026.');
  });

  it('DAY: an overdue task in focus reads "was due" and its date, the same one day overdue and two', async () => {
    // Pour slab was due 9 Oct. The phone sends on the 10th; the iPad reads it on the 11th.
    const { saidAlreadySent, sentFromThePhone, sentFromTheIpad } = await phoneSendsThenTheIpad('2026-10-11T15:00:00.000Z', ON_THE_PHONE, '2026-10-10T17:00:00.000Z');
    note('day-overdue-phone-sent-10-oct.txt', sentFromThePhone);
    expect(section(sentFromThePhone)).toContain('Schedule focus: Pour slab (was due 10/09/2026).');
    expect(section(sentFromThePhone)).not.toMatch(/\d+ days? overdue|Due (in \d+ days|today|tomorrow)/);
    expect({ saidAlreadySent, theSameReport: sentFromTheIpad === sentFromThePhone }).toEqual({ saidAlreadySent: true, theSameReport: true });
  });
});
