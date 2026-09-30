/**
 * Whole-app audit A2 M5 (30 Sep 2026): on a new device, one failed first task
 * download left Tasks empty all session ("No schedule items yet — Import…"),
 * because the bootstrap ran once per launch and the refresh skips a
 * collection that never loaded. The download now retries (here: on return to
 * the foreground) and the empty state says it is still coming. (Adapted from
 * the audit reviewer's proof test, which asserted one attempt per launch.)
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { AppState, Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import {
  getCurrentSessionUser,
  listDAVESyncTombstones,
  listScheduleItems,
} from '../services/SupabaseService';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
    getAllKeys: async () => [...values.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, values.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => {
      entries.forEach(([key, value]) => values.set(key, value));
    },
    multiRemove: async (keys: string[]) => { keys.forEach(key => values.delete(key)); },
    clear: async () => values.clear(),
  };
});

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

// No cloud: the shell must boot from local storage alone. Shipped code imports
// 60 names from this module, so the real module is spread and only the auth and
// network entry points are overridden. Pure helpers and normalizers stay real.
jest.mock('../services/SupabaseService', () => {
  const actual = jest.requireActual('../services/SupabaseService');
  const none = async () => [];
  const nothing = async () => null;
  return {
    ...actual,
    isSupabaseConfigured: jest.fn(() => false),
    getSupabaseClient: jest.fn(() => null),
    getCurrentSessionUser: jest.fn(),
    getCurrentUser: jest.fn(async () => ({ ok: true, data: { id: 'owner-smoke' } })),
    getCurrentSessionAccessToken: jest.fn(async () => null),
    subscribeToAuthStateChange: jest.fn(() => () => undefined),
    // Real callers await this and then call the returned unsubscribe, so it
    // must resolve to a function, not be one.
    subscribeToDAVEOperationalChanges: jest.fn(async () => () => undefined),
    verifyDAVEAppOwner: jest.fn(async () => false),
    testSupabaseConnection: jest.fn(async () => ({ ok: false, status: 'offline' })),
    signIn: jest.fn(), signOut: jest.fn(), signUp: jest.fn(),
    listProjects: jest.fn(none), listProjectUpdates: jest.fn(none),
    listProjectAreas: jest.fn(none), listScheduleItems: jest.fn(none),
    listReferenceDocuments: jest.fn(none), listArchivedProjects: jest.fn(none),
    listDAVESyncTombstones: jest.fn(none), listDAVEStorageCleanupIntents: jest.fn(none),
    listPIEDecisionRecords: jest.fn(none), listPIEExecutiveJudgmentsCloud: jest.fn(none),
    countCloudProjects: jest.fn(async () => 0),
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
const originalError = console.error;
beforeAll(() => { console.error = () => undefined; });
afterAll(() => { console.error = originalError; });

const CLOUD_TASK = {
  id: 'cloud-task-1',
  projectName: '2375 Compliance Project',
  taskName: 'Pour level 3 deck',
  status: 'In Progress',
  percentComplete: 40,
  priority: 'High',
  startDate: '2026-09-28',
  finishDate: '2026-10-02',
  owner: '',
  contractor: '',
  locationName: '',
  notes: '',
};

const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });

describe('a failed first task download on a new device (audit A2 M5)', () => {
  it('says the tasks are still coming, and shows them once a retry lands, without a relaunch', async () => {
    act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
    session.mockResolvedValue({ ok: true, data: { id: 'owner-a2' } } as never);
    tombstoneList.mockResolvedValue({ ok: true, configured: true, data: [] } as never);
    let calls = 0;
    scheduleList.mockImplementation(async () => {
      calls += 1;
      return (calls === 1
        ? { ok: false, configured: true, data: null, error: 'Network request failed' }
        : { ok: true, configured: true, data: [CLOUD_TASK] }) as never;
    });

    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await waitFor(() => expect(calls).toBe(1), COLD);
    const tabs = () => within(tree.getByTestId('app-bottom-tabs'));
    await act(async () => { fireEvent.press(tabs().getByLabelText('Tasks')); });
    await act(async () => { fireEvent.press(tree.getAllByText('All')[0]); });
    await waitFor(() => expect(tree.getByText('Tasks not downloaded yet')).toBeTruthy(), COLD);
    expect(tree.queryByText('No schedule items yet')).toBeNull();

    // Network is back; the owner switches apps and returns.
    const listeners = jest.mocked(AppState.addEventListener).mock.calls
      .filter(([type]) => type === 'change')
      .map(([, listener]) => listener as (state: string) => void);
    for (const state of ['background', 'active']) {
      await act(async () => { listeners.forEach(listener => listener(state)); });
    }
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), COLD);
    await waitFor(() => expect(tree.getByText('Pour level 3 deck')).toBeTruthy(), COLD);
    expect(tree.queryByText('Tasks not downloaded yet')).toBeNull();
    tree.unmount();
  });
});
