/**
 * Open item 7.21, part two (the coordinator's yes, 13 Oct 2026): recipients for Email Report and Text Report can be
 * picked from his contacts.
 *
 * Before: Reports opened Mail and Messages with no one filled in; he typed every address there. Now "Send To" stands
 * in the Share menu with "Add from Contacts". Contacts access is asked for only when he taps it (never when Reports
 * opens, approves or shares). The people he adds are filled in: their email addresses by Email Report, their phone
 * numbers by Text Report. If he says no to access, or adds no one, everything is as before and he is told why in
 * plain words. expo-contacts as the app already has it (version 57's class API: Contact.presentPicker, getEmails,
 * getPhones; read from node_modules/expo-contacts' own types, offline). The Reports screen is real; the contact list
 * is a stand-in. Made-up names and numbers. No network.
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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import {
  pickReportRecipient,
  reportEmailRecipients,
  reportTextRecipients,
  type ReportContactsApi,
} from '../../services/ReportRecipients';
import * as fs from 'fs';
import * as path from 'path';
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

const onOutlookReport=jest.fn(async (_report:unknown)=>'unknown' as const);
const onEmailReport = jest.fn(async (_report: unknown) => 'completed' as const);
const onTextReport = jest.fn(async (_report: unknown) => 'completed' as const);
const reportsScreen = (reportFormat: 'project_manager' | 'executive' = 'project_manager') => (
  <ReportsScreen
    projectName="Tower"
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower']}
    selectedProjectNames={['Tower']}
    onToggleProject={() => undefined}
    reportFormat={reportFormat}
    onReportFormatChange={() => undefined}
    updates={UPDATES as never}
    scheduleItems={TASKS as never}
    knownScheduleItems={TASKS as never}
    onSavedUpdates={() => undefined}
    onCopyReport={async () => 'completed'}
    onEmailReport={onEmailReport as never}
    onTextReport={onTextReport as never}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={onOutlookReport as never}
  />
);

/** A contact as Contact.presentPicker hands it back. */
const contact = (name: string, emails: string[], phones: Array<[string, string]>, unreadable = false) => ({
  id: `contact-${name}`,
  getFullName: async () => name,
  getEmails: async () => { if (unreadable) throw new Error('ContactNotFound'); return emails.map((address, index) => ({ id: `e${index}`, address })); },
  getPhones: async () => { if (unreadable) throw new Error('ContactNotFound'); return phones.map(([label, number], index) => ({ id: `p${index}`, label, number })); },
});
const DANA = contact('Dana Ruiz', ['dana@example.com'], [['work', '+1 555 0100'], ['mobile', '+1 555 0199']]);

let current: ReturnType<typeof render> | null = null;
afterEach(() => { current?.unmount(); current = null; });
beforeEach(() => {
  mockDevices.clear();
  mockCloud.clear();
  mockDevice = 'phone';
  forgetAllReportSessionState();
  onEmailReport.mockClear();
  onTextReport.mockClear();
  mockContacts.getPermissionsAsync.mockReset().mockImplementation(async () => ({ granted: false, canAskAgain: true }));
  mockContacts.requestPermissionsAsync.mockReset().mockImplementation(async () => ({ granted: true, canAskAgain: true }));
  mockContacts.presentPicker.mockReset().mockImplementation(async () => DANA);
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
});

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const NO_ONE = 'No one added. Email Report and Text Report open with no one filled in; you can type the addresses there, or add people from your contacts here.';
const DENIED = 'Contacts access is off for Vitruvius, so your contacts could not open. Type the addresses in Mail or Messages as before, or turn on Contacts for Vitruvius in Settings.';
const approveAndOpenShare = async () => {
  await screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
  fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  await screen.findByText('Send To', {}, SLOW);
};
/** The Share menu open (Share Report opens and closes it). */
const shareMenuOpen = async () => {
  if (!screen.queryByText('Send To')) fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  await screen.findByText('Send To', {}, SLOW);
};
const send = async (label: 'Email Report' | 'Text Report') => {
  fireEvent.press(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  await settle();
};
const handed = (mock: jest.Mock) => mock.mock.calls.at(-1)?.[0] as never;


it('7.56 RED same account report restores picked recipients after full mounted restart',async()=>{
 await mockLocal().set('@vitruvius/owner-storage-sandbox/metadata/v1',JSON.stringify({version:1,activeOwnerId:'owner-1'}));
 setClock('2026-10-05T17:00:00.000Z');current=render(reportsScreen());await approveAndOpenShare();fireEvent.press(screen.getByRole('button',{name:'Add from Contacts'}));await screen.findByText('Dana Ruiz · dana@example.com · +1 555 0199',{},SLOW);
 await settle();current.unmount();current=null;forgetAllReportSessionState();current=render(reportsScreen());
 await approveAndOpenShare();await waitFor(()=>expect(screen.getByText('Dana Ruiz · dana@example.com · +1 555 0199')).toBeTruthy());
});
