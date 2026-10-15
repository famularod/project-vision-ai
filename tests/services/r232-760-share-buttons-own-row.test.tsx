/**
 * Open item 7.60 (High, Build 232's device checks, check 8): on the iPhone, after Share Report, the four buttons
 * Copy Report, Email Report, Text Report and Email from Outlook shrank to four thin empty grey bars and the "Send To"
 * box ran past the card's right edge: the report could not be shared from the iPhone.
 *
 * Cause: the "Send To" panel (7eaf854d) was put INSIDE the buttons' row (a row, flexDirection 'row'); the panel took
 * the row's width and each button, made to share what was left equally, had none. Now the buttons have a row of their
 * own and the panel its own below it; and the buttons' row wraps, no button narrower than its icon and words need,
 * so whatever the screen's width (iPhone, iPad) each keeps its label. The Reports screen is real; layout is read from
 * the styles the screen gives (no device in a test draws). Made-up names. No network.
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
const mockContacts = {
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  presentPicker: jest.fn(async (): Promise<unknown> => null),
};
jest.mock('expo-contacts', () => ({
  getPermissionsAsync: () => mockContacts.getPermissionsAsync(),
  requestPermissionsAsync: () => mockContacts.requestPermissionsAsync(),
  Contact: { presentPicker: () => mockContacts.presentPicker() },
}));

import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { REPORT_SHARE_BUTTON_MIN_WIDTH, ReportsScreen } from '../../screens/ReportsScreen';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { recordScheduleCloudPull, registerScheduleCloudPullRequest } from '../../services/ScheduleCloudPull';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(240_000);
const SLOW = { timeout: 40_000 } as const;

let stopAppDownloads: () => void = () => undefined;
beforeEach(() => {
  stopAppDownloads = registerScheduleCloudPullRequest(() => { void recordScheduleCloudPull(new Date().toISOString()); });
});
afterEach(() => stopAppDownloads());

const TASKS = [{
  id: 'pour', projectName: 'Tower', scheduleProjectName: 'Tower', locationName: 'Level 1', taskName: 'Pour slab',
  startDate: '09/01/2026', finishDate: '12/09/2026', milestone: '', owner: 'Dana', contractor: 'Acme', percentComplete: 40,
  priority: 'Medium', status: 'In Progress', notes: '', createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
}] as unknown as ScheduleItem[];
const UPDATES = [{
  id: 'u1', projectName: 'Tower', scheduleProjectName: 'Tower', date: '2026-10-01', photos: [], recipients: { contactIds: [] },
  notes: 'Slab forms are set on the east bay.', status: 'sent', scheduleItemId: 'pour', scheduleTaskName: 'Pour slab', selectedAreaName: 'Level 1',
}] as unknown as ProjectUpdate[];
const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};

let current: ReturnType<typeof render> | null = null;
afterEach(() => { current?.unmount(); current = null; jest.useRealTimers(); });
beforeEach(() => {
  mockDevices.clear();
  mockCloud.clear();
  mockDevice = 'phone';
  forgetAllReportSessionState();
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
  jest.useFakeTimers({
    now: Date.parse('2026-10-05T17:00:00.000Z'),
    doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'],
  });
});

const SHARE_BUTTONS = ['Copy Report', 'Email Report', 'Text Report', 'Email from Outlook (work)'] as const;
const openShareMenu = async () => {
  current = render(
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
      onCopyReport={async () => 'completed'}
      onEmailReport={async () => 'completed'}
      onTextReport={async () => 'completed'}
      onDownloadWordReport={async () => 'unknown'}
      onOutlookReport={async () => 'unknown'}
    />,
  );
  await screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Share Report' }, SLOW));
  await screen.findByText('Send To', {}, SLOW);
};
const styleOf = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};
const hostAncestors = (node: ReactTestInstance) => {
  const list: ReactTestInstance[] = [];
  for (let at = node.parent; at; at = at.parent) if (typeof at.type === 'string') list.push(at);
  return list;
};
/** The view the four buttons stand in: the nearest view holding all four. */
const buttonsRow = () => {
  const copy = screen.getByRole('button', { name: 'Copy Report' });
  const row = hostAncestors(copy).find(node => SHARE_BUTTONS.every(label => within(node).queryByRole('button', { name: label })));
  if (!row) throw new Error('no view holds the four share buttons');
  return row;
};

describe('7.60: the share buttons keep their words; "Send To" has a row of its own', () => {
  it('"Send To" stands in no row with the share buttons: they are not squeezed beside it', async () => {
    await openShareMenu();
    const sendTo = screen.getByText('Send To');
    // Every row (a view laying its children side by side) "Send To" stands in holds none of the four buttons.
    const rows = hostAncestors(sendTo).filter(node => styleOf(node).flexDirection === 'row' || styleOf(node).flexDirection === 'row-reverse');
    for (const row of rows) {
      for (const label of SHARE_BUTTONS) expect(within(row).queryByRole('button', { name: label })).toBeNull();
    }
    // The buttons' own row holds the four buttons and nothing of "Send To"; the panel follows it.
    const own = buttonsRow();
    expect(within(own).queryByText('Send To')).toBeNull();
    expect(within(own).queryByRole('button', { name: 'Add from Contacts' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add from Contacts' })).toBeTruthy();
  });

  it('at any width (iPhone or iPad) no share button is drawn narrower than its icon and words need', async () => {
    await openShareMenu();
    const row = buttonsRow();
    // The row wraps (two by two on the iPhone, four across on the iPad), so no button is made to fit beside the others.
    expect(styleOf(row)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    // The icon (18) and the gap, and the longest word of any label in 13-point heavy type (about 9 points a letter,
    // "Outlook" and "(work)" side by side read as one line on a phone two buttons across).
    const needed = 18 + 4 + 9 * Math.max(...SHARE_BUTTONS.map(label => Math.max(...label.split(' ').map(word => word.length))));
    expect(REPORT_SHARE_BUTTON_MIN_WIDTH).toBeGreaterThanOrEqual(needed);
    // Two fit across an iPhone's report card (about 300 points inside), four across the iPad's (about 600).
    expect(2 * REPORT_SHARE_BUTTON_MIN_WIDTH + 8).toBeLessThanOrEqual(300);
    expect(4 * REPORT_SHARE_BUTTON_MIN_WIDTH + 3 * 8).toBeLessThanOrEqual(600);
    for (const label of SHARE_BUTTONS) {
      const button = screen.getByRole('button', { name: label });
      const style = styleOf(button);
      expect(style.minWidth).toBe(REPORT_SHARE_BUTTON_MIN_WIDTH);
      // It may grow into the row's room, never shrink below that width.
      expect(style.flexShrink ?? 0).toBe(0);
      expect(within(button).getByText(label)).toBeTruthy();
    }
  });
});
