/**
 * Whole-app audit A3 pass 9 L2/L3 (30 Sep 2026): Add Task kept the project it
 * was last asked to open on. On an iPad, Add Task from Lot 9's workspace, X,
 * the rail switched to Main St, then the header's Add Task opened on Lot 9;
 * and a second Talk "Create a task" for the same project did nothing. The
 * request is now cleared when the form closes.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
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

// Talk is the shell's assistant for audiences without Ask ECOS; the owner
// build shows Ask ECOS there, so the gate is opened to reach Talk.
jest.mock('../services/VitruviusBetaAuthorization', () => ({
  ...jest.requireActual('../services/VitruviusBetaAuthorization'),
  vitruviusAudienceCanAccessAskEcos: () => false,
}));

const session = jest.mocked(getCurrentSessionUser);
jest.setTimeout(240_000);
const COLD = { timeout: 90_000 } as const;
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 } as const;
const WIDE = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const;
const originalError = console.error;
beforeAll(() => { console.error = () => undefined; });
afterAll(() => { console.error = originalError; });
beforeEach(async () => {
  session.mockResolvedValue({ ok: true, data: { id: 'owner-a3' } } as never);
  await AsyncStorage.clear();
  const task = (id: string, taskName: string, projectName: string) => ({
    id, taskName, projectName, status: 'In Progress', percentComplete: 20, priority: 'Medium',
    startDate: '09/28/2026', finishDate: '10/02/2026', owner: '', contractor: '', locationName: '', notes: '',
  });
  await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(['Lot 9', 'Main St']));
  await AsyncStorage.setItem('projectPhotoUpdate.scheduleItems.v1', JSON.stringify([
    task('task-lot9', 'Grade pad', 'Lot 9'), task('task-main', 'Seal roof', 'Main St'),
  ]));
});

const projectField = (tree: ReturnType<typeof render>) => tree.getByPlaceholderText('Project name').props.value;

describe('Add Task opens on the project asked for, every time (audit A3 pass 9 L2/L3)', () => {
  it('iPad: after Add Task from Lot 9\'s workspace and X, the header Add Task opens on the rail\'s Main St', async () => {
    act(() => { Dimensions.set({ window: WIDE, screen: WIDE }); });
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-rail-brand')).toBeTruthy(), COLD);
    // Overview, Lot 9's card, then its workspace's Add Task.
    const lot9 = tree.getAllByText('Lot 9');
    await act(async () => { fireEvent.press(lot9[lot9.length - 1]); });
    await act(async () => { fireEvent.press(await tree.findByText('Add Task', {}, COLD)); });
    await waitFor(() => expect(projectField(tree)).toBe('Lot 9'), COLD);
    await act(async () => { fireEvent.press(tree.getByLabelText('Close Add Task')); });
    expect(tree.queryByPlaceholderText('Project name')).toBeNull();

    await act(async () => { fireEvent.press(tree.getByLabelText('Show tasks for Main St')); });
    await act(async () => { fireEvent.press(tree.getByRole('button', { name: 'Add Task' })); });
    expect(projectField(tree)).toBe('Main St');
    tree.unmount();
  });

  it('a second Talk "Create a task" for the same project opens the form again, guided', async () => {
    act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(tree.getAllByRole('tab', { name: 'Tasks' })[0]); });
    const createFromTalk = async () => {
      await act(async () => { fireEvent.press(tree.getByLabelText('Project actions')); });
      await act(async () => { fireEvent.press(await tree.findByLabelText('Use Lot 9 for Talk', {}, COLD)); });
      await act(async () => { fireEvent.press(tree.getByLabelText('Create a task')); });
    };

    await createFromTalk();
    await waitFor(() => expect(tree.getByText('Question 1 of 14')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(tree.getByLabelText('Close Add Task')); });
    expect(tree.queryByText('Question 1 of 14')).toBeNull();

    await createFromTalk();
    await waitFor(() => expect(tree.getByText('Question 1 of 14')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(tree.getByLabelText('Close Add Task')); });

    // The next manual Add Task is not guided.
    await act(async () => { fireEvent.press(tree.getByRole('button', { name: 'Add Task' })); });
    expect(tree.getByPlaceholderText('Example: East driveway striping')).toBeTruthy();
    expect(tree.queryByText('Question 1 of 14')).toBeNull();
    tree.unmount();
  });
});
