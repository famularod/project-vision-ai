/**
 * N276 review pass 1, F1 and F4 (15 Oct 2026), the whole app (NativeRoot) on the reviewer's rig. Made-up data only.
 * F1: opened after time away, the first download of every record failed (the deletion list late, or the cloud not
 * answering); a refresh of ONE record kind that succeeded next (the iPad deleting a task or an area live) cancelled
 * the retry, so the new schedule's rows (Test gate, Test sod) or the area added on the iPad (Test yard) stayed missing
 * for up to 30 minutes. Now the download of every record is owed until one lands: it is tried again within seconds.
 * F4: while one record kind kept failing, Settings said "Downloading your other devices' changes" (nothing was);
 * now it says it could not download them yet.
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { AppState, Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import { deviceCloudPullState } from '../services/ScheduleCloudPull';
import * as tombstoneService from '../services/DAVESyncTombstones';
import type { DAVEOperationalRefreshCommitGuard } from '../services/DAVEOperationalRefresh';
let mockRefreshCommitGuard: DAVEOperationalRefreshCommitGuard;
jest.mock('../services/DAVEOperationalRefresh', () => {
  const actual = jest.requireActual('../services/DAVEOperationalRefresh');
  return { ...actual, createDAVEOperationalRefreshCommitGuard: () => {
    mockRefreshCommitGuard = actual.createDAVEOperationalRefreshCommitGuard();
    return mockRefreshCommitGuard;
  } };
});
import { getCurrentSessionUser, listDAVESyncTombstones, listProjectAreas, listReferenceDocuments, listScheduleItems, subscribeToDAVEOperationalChanges } from '../services/SupabaseService';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = { get: (key: string) => mockValues.get(key), set: (key: string, value: string) => mockValues.set(key, value),
    delete: (key: string) => mockValues.delete(key), keys: () => mockValues.keys(), clear: () => mockValues.clear() };
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
    getAllKeys: async () => [...values.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, values.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => { entries.forEach(([key, value]) => values.set(key, value)); },
    multiRemove: async (keys: string[]) => { keys.forEach(key => values.delete(key)); },
    clear: async () => values.clear(),
  };
});
const mockValues = new Map<string, string>();
// SafeAreaProvider measures insets via onLayout, which never fires under jest,
// so it renders no children and the whole shell looks empty. Standard mock.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: unknown }) => children,
    SafeAreaView: ({ children }: { children: unknown }) => children,
    SafeAreaInsetsContext: React.createContext(inset),
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
    initialWindowMetrics: { insets: inset, frame: { x: 0, y: 0, width: 390, height: 844 } },
  };
});

// expo-audio has no working jest-expo mock and throws at import time. Mocked at
// the native-module boundary so the real component tree still renders.
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: false })),
  setAudioModeAsync: jest.fn(async () => undefined),
  useAudioRecorder: () => ({
    record: jest.fn(), stop: jest.fn(async () => undefined),
    prepareToRecordAsync: jest.fn(async () => undefined), uri: null, isRecording: false,
  }),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0, metering: 0 }),
  useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), remove: jest.fn() }),
  useAudioPlayerStatus: () => ({ playing: false, didJustFinish: false }),
  AudioModule: {},
}));

jest.mock('expo-contacts', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getContactsAsync: jest.fn(async () => ({ data: [] })),
  Fields: { Name: 'name', Emails: 'emails', PhoneNumbers: 'phoneNumbers' },
}));
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 0, longitude: 0, accuracy: 5 },
  })),
  Accuracy: { Balanced: 3, High: 4 },
}));
jest.mock('expo-mail-composer', () => ({
  isAvailableAsync: jest.fn(async () => false),
  composeAsync: jest.fn(async () => ({ status: 'cancelled' })),
  MailComposerStatus: {
    SENT: 'sent', CANCELLED: 'cancelled', SAVED: 'saved', UNDETERMINED: 'undetermined',
  },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-sms', () => ({
  isAvailableAsync: jest.fn(async () => false),
  sendSMSAsync: jest.fn(async () => ({ result: 'cancelled' })),
}));
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  readDirectoryAsync: jest.fn(async () => []),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));

const mockOk = <T,>(data: T) => ({ ok: true, configured: true, data });
jest.mock('../services/SupabaseService', () => {
  const actual = jest.requireActual('../services/SupabaseService');
  const nothing = async () => null;
  const okNone = async () => mockOk([]);
  return {
    ...actual,
    isSupabaseConfigured: jest.fn(() => false),
    getSupabaseClient: jest.fn(() => null),
    // Settings reads these: signed in to a configured cloud.
    getSupabaseConfigurationStatus: jest.fn(() => ({ configured: true })),
    getSupabaseConnectionStatus: jest.fn(async () => ({
      configured: true, clientReady: true, authenticated: true, userEmail: 'owner@example.com',
    })),
    getCurrentSessionUser: jest.fn(),
    getCurrentUser: jest.fn(async () => ({ ok: true, data: { id: 'owner-n276' } })),
    getCurrentSessionAccessToken: jest.fn(async () => null),
    subscribeToAuthStateChange: jest.fn(() => () => undefined),
    subscribeToDAVEOperationalChanges: jest.fn(async () => () => undefined),
    verifyDAVEAppOwner: jest.fn(async () => false),
    testSupabaseConnection: jest.fn(async () => ({ ok: false, status: 'offline' })),
    signIn: jest.fn(), signOut: jest.fn(), signUp: jest.fn(),
    listProjects: jest.fn(async () => mockOk([{ id: 'project-n276', name: 'Test project', archived: false }])),
    listArchivedProjects: jest.fn(okNone), listProjectUpdates: jest.fn(okNone),
    listProjectAreas: jest.fn(), listScheduleItems: jest.fn(),
    listReferenceDocuments: jest.fn(),
    listDAVESyncTombstones: jest.fn(), listDAVEStorageCleanupIntents: jest.fn(okNone),
    listPIEDecisionRecords: jest.fn(okNone), listPIEExecutiveJudgmentsCloud: jest.fn(okNone),
    countCloudProjects: jest.fn(async () => 1),
    loadPIERealityModelCloud: jest.fn(nothing),
    loadLatestDAVEProjectTruthSnapshotCloud: jest.fn(nothing),
    getProjectUpdateSyncMetadata: jest.fn(nothing),
    accountDisplayNameForUser: jest.fn(() => null),
  };
});

const session = jest.mocked(getCurrentSessionUser);
const scheduleList = jest.mocked(listScheduleItems);
const tombstoneList = jest.mocked(listDAVESyncTombstones);
jest.setTimeout(240_000);
const COLD = { timeout: 90_000 } as const;
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 } as const;
const OWNER = 'owner-n276';
const originalError = console.error;
beforeAll(() => { console.error = () => undefined; });
afterAll(() => { console.error = originalError; });

const task = (id: string, taskName: string, percentComplete: number, extra: Record<string, unknown> = {}) => ({
  id, projectName: 'Test project', taskName, locationName: 'Site',
  status: percentComplete >= 100 ? 'Complete' : 'In Progress', percentComplete, priority: 'Low',
  startDate: '2026-10-01', finishDate: '2026-10-30', owner: '', contractor: '', notes: '',
  createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-15T09:00:00.000Z', ...extra,
});
/** What the phone saved before it was switched off. */
const PHONE_TASKS = [task('t-paint', 'Test paint', 70), task('t-trim', 'Test trim', 20), task('t-fence', 'Test fence', 100)];
/** The cloud now: a note typed on Test paint elsewhere, and the new full schedule's rows the phone never had. */
const CLOUD_TASKS = [
  task('t-paint', 'Test paint', 70, { notes: 'Offline note 276', updatedAt: '2026-10-15T13:20:00.000Z' }),
  task('t-trim', 'Test trim', 20), task('t-fence', 'Test fence', 100),
  task('d2-gate', 'Test gate', 0, { createdAt: '2026-10-15T13:26:00.000Z' }),
  task('d2-sod', 'Test sod', 0, { createdAt: '2026-10-15T13:26:00.000Z' }),
];
/** The lookahead B1 row added and deleted on the iPad meanwhile. */
const B1_DELETED = {
  id: 'tomb-b1', entityType: 'schedule_item', recordId: 'b1-row', deletedAt: '2026-10-15T12:40:00.000Z',
  deletedBy: 'device-ipad', reason: 'lookahead_deleted',
};

function seedPhone() {
  mockValues.clear();
  mockValues.set('@vitruvius/owner-storage-sandbox/metadata/v1', JSON.stringify({
    version: 1, activeOwnerId: OWNER, legacyAssignedOwnerId: null, lastOwnerId: OWNER,
    updatedAt: '2026-10-15T09:30:00.000Z',
  }));
  mockValues.set('projectPhotoUpdate.projects.v2', JSON.stringify(['Test project']));
  mockValues.set('projectPhotoUpdate.scheduleItems.v1', JSON.stringify(PHONE_TASKS));
  // A device in use: every collection was saved here before.
  mockValues.set('projectPhotoUpdates.v2', '[]');
  mockValues.set('projectPhotoUpdate.projectAreas.v1', '[]');
  mockValues.set('projectPhotoUpdate.referenceDocumentMetadata.v2', '[]');
  mockValues.set('projectPhotoUpdate.projectDocuments.v1', '[]');
}

const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });


const areaList = jest.mocked(listProjectAreas);
const documentList = jest.mocked(listReferenceDocuments);
const subscribe = jest.mocked(subscribeToDAVEOperationalChanges);
/** An area added on the iPad meanwhile: a new row only a refresh with the deletion history brings down. */
const NEW_AREA = { id: 'area-yard', name: 'Test yard', projectName: 'Test project', latitude: 40.1, longitude: -75.2 };
const savedTasks = () => (JSON.parse(mockValues.get('projectPhotoUpdate.scheduleItems.v1') || '[]') as Array<{ id: string }>).map(item => item.id).sort();
const savedAreas = () => (JSON.parse(mockValues.get('projectPhotoUpdate.projectAreas.v1') || '[]') as Array<{ id: string }>).map(item => item.id).sort();
const liveChange = async (entity: string, collections: string[], oldRow: Record<string, unknown>) => {
  const options = subscribe.mock.calls.at(-1)?.[0] as unknown as { onChange: (e: string, c: string[], p: unknown) => void };
  await act(async () => {
    options.onChange(entity, collections, { eventType: 'DELETE', newRow: null, oldRow, raw: {} });
  });
};
async function openSettings(tree: ReturnType<typeof render>) {
  const tabs = within(tree.getByTestId('app-bottom-tabs'));
  await act(async () => { fireEvent.press(tabs.getByLabelText('Overview')); });
  await act(async () => { fireEvent.press(await tree.findByLabelText('Open Settings', {}, COLD)); });
  await waitFor(() => expect(tree.getByText('Sync Now')).toBeTruthy(), COLD);
  await wait(300);
}
const cloudText = (tree: ReturnType<typeof render>) =>
  tree.queryByText('All caught up') ? 'All caught up' : tree.queryByText("Downloading your other devices' changes") ? 'Downloading' : 'other';

const NOT_YET = "Could not download your other devices' changes yet; Sync Now to retry";
const settingsSays = (tree: ReturnType<typeof render>) =>
  tree.queryByText('All caught up') ? 'All caught up'
    : tree.queryByText("Downloading your other devices' changes") ? 'Downloading'
      : tree.queryByText(NOT_YET) ? 'Could not download yet' : 'other';

describe('a download of every record that failed is tried again until one lands (N276b)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
    seedPhone();
    session.mockResolvedValue({ ok: true, data: { id: OWNER } } as never);
    scheduleList.mockReset(); areaList.mockReset(); documentList.mockReset(); tombstoneList.mockReset();
    scheduleList.mockImplementation(async () => mockOk(CLOUD_TASKS) as never);
    areaList.mockImplementation(async () => mockOk([NEW_AREA]) as never);
    documentList.mockImplementation(async () => mockOk([]) as never);
  });

  it('W1 the iPad deletes a task live while the first download waits for the deletion list: every record still comes down', async () => {
    // The first deletion-list read never answers (8 s limit); every later one answers.
    let reads = 0;
    tombstoneList.mockImplementation((() => { reads += 1; return reads === 1 ? new Promise(() => undefined) : Promise.resolve(mockOk([B1_DELETED])); }) as never);
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await waitFor(() => expect(subscribe).toHaveBeenCalled(), COLD);
    await waitFor(() => expect(reads).toBeGreaterThan(0), COLD);
    await liveChange('schedule_item', ['schedule_items'], { id: 'b1-row', owner_id: OWNER });
    // The area added on the iPad comes down within seconds, not at the 30-minute poll.
    await waitFor(() => expect(savedAreas()).toEqual(['area-yard']), { timeout: 30_000 });
    expect(savedTasks()).toEqual(['d2-gate', 'd2-sod', 't-fence', 't-paint', 't-trim']);
    await openSettings(tree);
    await waitFor(() => expect(settingsSays(tree)).toBe('All caught up'), { timeout: 10_000 });
    tree.unmount();
  });

  it('W2 the first download fails; the cloud is back and an area is deleted live before the 5 s retry: the retry still runs', async () => {
    let historyAnswers = false;
    tombstoneList.mockImplementation((async () => (historyAnswers ? mockOk([B1_DELETED])
      : { ok: false, configured: true, data: null, error: 'Network request failed' })) as never);
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await waitFor(() => expect(scheduleList).toHaveBeenCalled(), COLD);
    await waitFor(() => expect(subscribe).toHaveBeenCalled(), COLD);
    await wait(300);
    expect(savedTasks()).toEqual(['t-fence', 't-paint', 't-trim']);
    historyAnswers = true;
    await liveChange('project_area', ['project_areas'], { id: 'area-gone', owner_id: OWNER });
    await waitFor(() => expect(savedTasks()).toEqual(['d2-gate', 'd2-sod', 't-fence', 't-paint', 't-trim']), { timeout: 15_000 });
    await openSettings(tree);
    await waitFor(() => expect(settingsSays(tree)).toBe('All caught up'), { timeout: 10_000 });
    tree.unmount();
  });

  it('W3 one record kind (documents) keeps failing: tried again and again; Settings says it could not download them yet', async () => {
    tombstoneList.mockImplementation((async () => mockOk([B1_DELETED])) as never);
    documentList.mockImplementation((async () => ({ ok: false, configured: true, data: null, error: 'Server error' })) as never);
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await waitFor(() => expect(documentList).toHaveBeenCalled(), COLD);
    await openSettings(tree);
    await waitFor(() => expect(settingsSays(tree)).toBe('Could not download yet'), { timeout: 10_000 });
    await waitFor(() => expect(documentList.mock.calls.length).toBeGreaterThanOrEqual(3), { timeout: 30_000 });
    expect(settingsSays(tree)).toBe('Could not download yet');
    expect(savedTasks()).toEqual(['d2-gate', 'd2-sod', 't-fence', 't-paint', 't-trim']); // the rest came down
    expect(deviceCloudPullState().missing).toBe('documents'); // what Reports' note names
    tree.unmount();
  });

  it('W4 its retry falls due while the app is in the background: back in it within minutes, every record is downloaded', async () => {
    tombstoneList.mockImplementation((async () => mockOk([B1_DELETED])) as never);
    let documentsFail = false;
    documentList.mockImplementation((async () => (documentsFail
      ? { ok: false, configured: true, data: null, error: 'Server error' } : mockOk([]))) as never);
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await waitFor(() => expect(savedTasks()).toEqual(['d2-gate', 'd2-sod', 't-fence', 't-paint', 't-trim']), COLD);
    await waitFor(() => expect(subscribe).toHaveBeenCalled(), COLD);
    await wait(300);
    // Live updates are working, and every record came down a moment ago: a return to the app downloads nothing more.
    const options = subscribe.mock.calls.at(-1)?.[0] as unknown as { onStatus: (status: string) => void };
    await act(async () => { options.onStatus('subscribed'); });
    // The iPad deletes a document; its refresh fails (the cloud failing): a download of every record is owed.
    documentsFail = true;
    await liveChange('reference_document', ['reference_documents'], { id: 'doc-gone', owner_id: OWNER });
    await wait(300);
    const appState = AppState as unknown as { currentState: unknown };
    const wasState = appState.currentState;
    appState.currentState = 'background';
    try {
      await wait(6_000); // its 5 s retry falls due while away: nothing runs
      const readsWhileAway = scheduleList.mock.calls.length;
      documentsFail = false;
      appState.currentState = 'active';
      const listeners = jest.mocked(AppState.addEventListener).mock.calls
        .filter(([type]) => type === 'change')
        .map(([, listener]) => listener as (state: string) => void);
      await act(async () => { listeners.forEach(listener => listener('active')); });
      await waitFor(() => expect(scheduleList.mock.calls.length).toBeGreaterThan(readsWhileAway), { timeout: 3_000 });
    } finally {
      appState.currentState = wasState;
    }
    tree.unmount();
  });
  it('W5 a restore invalidating an in-flight collection download keeps the full retry owed', async () => {
    tombstoneList.mockImplementation((async () => mockOk([B1_DELETED])) as never);
    let finish!: (result: unknown) => void;
    documentList.mockImplementationOnce((() => new Promise(resolve => { finish = resolve; })) as never);
    const tree = render(<NativeRoot />);
    try {
      await waitFor(() => expect(documentList).toHaveBeenCalled(), COLD);
      await act(async () => { mockRefreshCommitGuard.invalidate(); finish(mockOk([])); });
      await wait(100);
      expect(deviceCloudPullState().pending).toBe(true);
      await waitFor(() => expect(documentList.mock.calls.length).toBeGreaterThan(1), { timeout: 8_000 });
      await waitFor(() => expect(deviceCloudPullState().pending).toBe(false), { timeout: 3_000 });
    } finally { tree.unmount(); }
  });

  it('W6 a restore invalidating the deletion-history read does not count as a successful full download', async () => {
    let finish!: (result: unknown) => void;
    tombstoneList.mockImplementationOnce((() => new Promise(resolve => { finish = resolve; })) as never)
      .mockImplementation((async () => mockOk([B1_DELETED])) as never);
    const tree = render(<NativeRoot />);
    try {
      await waitFor(() => expect(tombstoneList).toHaveBeenCalled(), COLD);
      await act(async () => { mockRefreshCommitGuard.invalidate(); finish(mockOk([B1_DELETED])); });
      await wait(100);
      expect(deviceCloudPullState().pending).toBe(true);
      await waitFor(() => expect(scheduleList).toHaveBeenCalled(), { timeout: 8_000 });
      await waitFor(() => expect(deviceCloudPullState().pending).toBe(false), { timeout: 3_000 });
    } finally { tree.unmount(); }
  });

  it('W7 a deletion read shared with an older request cannot certify a fresh full download', async () => {
    tombstoneList.mockImplementation((async () => mockOk([B1_DELETED])) as never);
    const realLoad = tombstoneService.loadDAVEOperationalTombstones;
    jest.spyOn(tombstoneService, 'loadDAVEOperationalTombstones').mockImplementationOnce(async () => ({
      ...await realLoad(), readStartedAt: new Date(Date.now() - 60_000).toISOString(),
    }));
    const tree = render(<NativeRoot />);
    try {
      await waitFor(() => expect(documentList).toHaveBeenCalled(), COLD);
      await wait(100);
      expect(deviceCloudPullState().pending).toBe(true);
      await waitFor(() => expect(documentList.mock.calls.length).toBeGreaterThan(1), { timeout: 8_000 });
      await waitFor(() => expect(deviceCloudPullState().pending).toBe(false), { timeout: 3_000 });
    } finally { tree.unmount(); }
  });

});
