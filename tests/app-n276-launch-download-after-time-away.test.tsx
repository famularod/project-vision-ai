/**
 * Open item 2.76 (15 Oct 2026, Build 233, simulated iPhone): opened after ~4 hours switched off, while other devices
 * added and deleted a lookahead and made a new full schedule current, the phone showed an out-of-date task set for
 * minutes (161 tasks against the cloud's 164) while Settings said "Cloud sync: All caught up"; Sync Now put it right.
 *
 * The app's road, with made-up data: the phone opens on its saved tasks; its first download of the deletion history
 * does not come back (no answer yet after the long sleep), so the refresh keeps only the rows it already had (it may
 * not add rows it cannot check against deletions) and counts itself done. Nothing downloaded again for 30 minutes,
 * and Settings said "All caught up". Now the refresh is tried again within seconds, and Settings says it is
 * downloading until every record has come down.
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { AppState, Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import { getCurrentSessionUser, listDAVESyncTombstones, listScheduleItems } from '../services/SupabaseService';

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
    listProjectAreas: jest.fn(okNone), listScheduleItems: jest.fn(),
    listReferenceDocuments: jest.fn(okNone),
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

describe('opened after hours away, the phone downloads every record before saying it is caught up (2.76)', () => {
  it('a first download without the deletion history is tried again within seconds, and Settings says so meanwhile', async () => {
    act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
    seedPhone();
    session.mockResolvedValue({ ok: true, data: { id: OWNER } } as never);
    scheduleList.mockImplementation(async () => mockOk(CLOUD_TASKS) as never);
    // After the long sleep the deletion history does not answer at first.
    let historyAnswers = false;
    tombstoneList.mockImplementation(async () => (historyAnswers
      ? mockOk([B1_DELETED])
      : { ok: false, configured: true, data: null, error: 'Network request failed' }) as never);

    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await waitFor(() => expect(scheduleList).toHaveBeenCalled(), COLD);
    await wait(500);
    const firstReads = scheduleList.mock.calls.length;

    // The phone keeps its old set: Test paint's new note came down, the new schedule's rows did not.
    const saved = () => JSON.parse(mockValues.get('projectPhotoUpdate.scheduleItems.v1') || '[]') as Array<{ id: string; notes?: string }>;
    await waitFor(() => expect(saved().find(item => item.id === 't-paint')?.notes).toBe('Offline note 276'), COLD);
    expect(saved().map(item => item.id).sort()).toEqual(['t-fence', 't-paint', 't-trim']);
    const tabs = () => within(tree.getByTestId('app-bottom-tabs'));
    await act(async () => { fireEvent.press(tabs().getByLabelText('Tasks')); });
    await waitFor(() => expect(tree.getByText('Open Tasks')).toBeTruthy(), COLD);

    // Settings does not call that caught up.
    await act(async () => { fireEvent.press(tabs().getByLabelText('Overview')); });
    await act(async () => { fireEvent.press(await tree.findByLabelText('Open Settings', {}, COLD)); });
    await waitFor(() => expect(tree.getByText('Sync Now')).toBeTruthy(), COLD);
    await wait(300);
    expect(tree.queryByText('All caught up')).toBeNull();
    // N276b F4: the download failed, so not "Downloading" either.
    expect(tree.getByText("Could not download your other devices' changes yet; Sync Now to retry")).toBeTruthy();

    // The connection is good again: within seconds (not the 30-minute poll) every record comes down.
    historyAnswers = true;
    await waitFor(() => expect(scheduleList.mock.calls.length).toBeGreaterThan(firstReads), { timeout: 12_000 });
    await waitFor(() => expect(tree.getByText('All caught up')).toBeTruthy(), { timeout: 12_000 });
    await waitFor(() => expect(saved().map(item => item.id).sort()).toEqual(['d2-gate', 'd2-sod', 't-fence', 't-paint', 't-trim']), { timeout: 12_000 });

    // Put down and picked up again (no live updates here, so it downloads again): until that download lands, it
    // is not "All caught up" either.
    historyAnswers = false;
    const listeners = jest.mocked(AppState.addEventListener).mock.calls
      .filter(([type]) => type === 'change')
      .map(([, listener]) => listener as (state: string) => void);
    for (const state of ['background', 'active']) {
      await act(async () => { listeners.forEach(listener => listener(state)); });
    }
    await waitFor(() => expect(tree.getByText("Could not download your other devices' changes yet; Sync Now to retry")).toBeTruthy(), { timeout: 12_000 });
    historyAnswers = true;
    await waitFor(() => expect(tree.getByText('All caught up')).toBeTruthy(), { timeout: 12_000 });
    tree.unmount();
  });
});
