/**
 * Whole-app audit A11 pass 2 (30 Sep 2026), verified HIGH, at the real root:
 * a phone that already saved "Level 2 corridor -> Roof" from Confirm Memory
 * moved every Level 2 corridor task to Roof at each launch. It now boots with
 * the alias removed once (a spelling alias kept), the tasks where they were,
 * and startup still completing. Mocks are the app-shell smoke test's; data is
 * synthetic.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import { DAVE_IDENTITY_STORAGE_KEY } from '../services/DAVEIdentityRepository';
import { DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY } from '../services/DAVEIdentityAliasCleanup';
import { getCurrentSessionUser } from '../services/SupabaseService';

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
jest.setTimeout(240_000);
const COLD = { timeout: 90_000 } as const;
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 } as const;

const PROJECT = '2321 Compliance Project';
const SCHEDULE_KEY = 'projectPhotoUpdate.scheduleItems.v1';
const task = (id: string, locationName: string) => ({
  id, scheduleProjectName: PROJECT, projectName: PROJECT, locationName, taskName: `Task ${id}`,
  startDate: '09/01/2026', finishDate: '09/30/2026', percentComplete: 40, priority: 'High',
  status: 'In Progress', notes: '', createdAt: '2026-09-01T12:00:00.000Z',
});
const alias = (id: string, rawName: string, canonicalName: string, confirmedAt: string) => ({
  id, kind: 'area', rawName, canonicalName, parentProjectName: PROJECT,
  sourceRecordId: 'memory-1', confirmedAt, confirmedBy: 'Project manager',
});

test('a saved Confirm Memory alias no longer moves a real area at launch', async () => {
  act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
  session.mockResolvedValue({ ok: true, data: { id: 'owner-alias' } } as unknown as Awaited<ReturnType<typeof getCurrentSessionUser>>);
  await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify([PROJECT]));
  await AsyncStorage.setItem('projectPhotoUpdate.projectAreas.v1', JSON.stringify([
    { id: 'area-l2', name: 'Level 2 corridor', projectName: PROJECT, latitude: 1, longitude: 1 },
    { id: 'area-roof', name: 'Roof', projectName: PROJECT, latitude: 1, longitude: 1 },
  ]));
  await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify([
    task('t1', 'Level 2 corridor'), task('t2', 'Level 2 corridor'), task('t3', 'Roof'), task('t4', 'Level 3 stair'),
  ]));
  await AsyncStorage.setItem(DAVE_IDENTITY_STORAGE_KEY, JSON.stringify({
    schemaVersion: 'dave-identity-repository/1.0',
    records: [
      alias('identity:memory-1:location:a', 'Level 2 corridor', 'Roof', '2026-09-30T12:00:00.000Z'),
      // A11 pass 3: a rule for an area David has since renamed or deleted.
      alias('identity:memory-1:location:c', 'Level 3 stair', 'Roof', '2026-09-30T12:02:00.000Z'),
      // Not saved by Confirm Memory (its id does not carry memory-1), so kept.
      alias('identity:memory-2:location:b', 'Pump Hse', 'Pump House', '2026-09-30T12:01:00.000Z'),
    ],
  }));

  const tree = render(<NativeRoot />);
  await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY)).not.toBeNull();
  }, COLD);
  // The schedule is written back after startup; wait for that write.
  await waitFor(async () => {
    const items = JSON.parse(await AsyncStorage.getItem(SCHEDULE_KEY) || '[]');
    expect(items[0]).toHaveProperty('contractor', '');
  }, COLD);
  const items = JSON.parse(await AsyncStorage.getItem(SCHEDULE_KEY) || '[]') as { id: string; locationName: string }[];
  expect(Object.fromEntries(items.map(item => [item.id, item.locationName]))).toEqual({
    t1: 'Level 2 corridor', t2: 'Level 2 corridor', t3: 'Roof', t4: 'Level 3 stair',
  });
  const saved = JSON.parse(await AsyncStorage.getItem(DAVE_IDENTITY_STORAGE_KEY) || '{}');
  expect(saved.records.map((record: { rawName: string }) => record.rawName)).toEqual(['Pump Hse']);
  tree.unmount();
});
