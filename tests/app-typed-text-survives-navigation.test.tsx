/**
 * Whole-app audit A2 M3 (30 Sep 2026): the tab bar rides above the keyboard,
 * and each screen exists only while shown, so tapping a tab (or the iPad
 * rail) while writing a field note dropped the note silently. The note is now
 * kept until Save (hooks/use-field-note-draft.ts). (Adapted from the audit
 * reviewer's proof test, which asserted the loss.)
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import { getCurrentSessionUser, subscribeToAuthStateChange } from '../services/SupabaseService';
import { forgetFieldNoteDraft } from '../hooks/use-field-note-draft';

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
const TABLET = { width: 1024, height: 1366, scale: 2, fontScale: 1 } as const;
const originalError = console.error;
beforeAll(() => { console.error = () => undefined; });
afterAll(() => { console.error = originalError; });
beforeEach(() => {
  session.mockResolvedValue({ ok: true, data: { id: 'owner-a2' } } as never);
});

const NOTE = 'Guardrail missing at the north slab edge, level 3';

describe('leaving a screen keeps the field note being written (audit A2 M3)', () => {
  afterEach(() => forgetFieldNoteDraft());

  it('phone: the note is still there after a tab switch and back', async () => {
    act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    const tabs = () => within(tree.getByTestId('app-bottom-tabs'));

    await act(async () => { fireEvent.press(tree.getByLabelText('Open Field Notes')); });
    await waitFor(() => expect(tree.getByLabelText('Type field note')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(tree.getByLabelText('Type field note')); });
    await act(async () => { fireEvent.changeText(tree.getByLabelText('Field note'), NOTE); });

    await act(async () => { fireEvent.press(tabs().getByLabelText('Tasks')); });
    await act(async () => { fireEvent.press(tabs().getByLabelText('Overview')); });
    await act(async () => { fireEvent.press(tree.getByLabelText('Open Field Notes')); });
    await waitFor(() => expect(tree.getByLabelText('Field note').props.value).toBe(NOTE), COLD);
    tree.unmount();
  });

  it('iPad rail: the note is still there after a rail tap and back', async () => {
    act(() => { Dimensions.set({ window: TABLET, screen: TABLET }); });
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-rail-brand')).toBeTruthy(), COLD);
    const railTab = (name: string) => tree.getAllByRole('tab', { name })[0];
    await act(async () => { fireEvent.press(railTab('Field Notes')); });
    await waitFor(() => expect(tree.getByLabelText('Type field note')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(tree.getByLabelText('Type field note')); });
    await act(async () => { fireEvent.changeText(tree.getByLabelText('Field note'), NOTE); });
    await act(async () => { fireEvent.press(railTab('Reports')); });
    await act(async () => { fireEvent.press(railTab('Field Notes')); });
    await waitFor(() => expect(tree.getByLabelText('Field note').props.value).toBe(NOTE), COLD);
    tree.unmount();
  });

  it('iPad: an Owner typed on one task never lands on the next task picked', async () => {
    const WIDE = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const;
    act(() => { Dimensions.set({ window: WIDE, screen: WIDE }); });
    const task = (id: string, taskName: string) => ({
      id, taskName, projectName: '2375 Compliance Project', status: 'In Progress', percentComplete: 20,
      priority: 'Medium', startDate: '09/28/2026', finishDate: '10/02/2026', owner: '', contractor: '',
      locationName: '', notes: '',
    });
    await AsyncStorage.setItem('projectPhotoUpdate.scheduleItems.v1', JSON.stringify([
      task('task-alpha', 'Task Alpha'), task('task-bravo', 'Task Bravo'),
    ]));
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-rail-brand')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(tree.getAllByRole('tab', { name: 'Tasks' })[0]); });
    await act(async () => { fireEvent.press(await tree.findByLabelText('Open task Task Alpha', {}, COLD)); });
    const owner = await tree.findByPlaceholderText('PLZ owner / internal owner', {}, COLD);
    fireEvent(owner, 'focus');
    fireEvent.changeText(owner, 'ABC Electric');
    await act(async () => { fireEvent.press(tree.getByLabelText('Open task Task Bravo')); });
    const next = tree.getByPlaceholderText('PLZ owner / internal owner');
    expect(next.props.value).toBe('');
    await act(async () => { fireEvent(next, 'blur'); });
    const stored = JSON.parse(await AsyncStorage.getItem('projectPhotoUpdate.scheduleItems.v1') || '[]') as Array<{ id: string; owner: string }>;
    expect(stored.find(item => item.id === 'task-bravo')?.owner).not.toBe('ABC Electric');
    tree.unmount();
  });

  it('forgets the note on sign-out, even when the same owner signs back in', async () => {
    act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(tree.getByLabelText('Open Field Notes')); });
    await act(async () => { fireEvent.press(await tree.findByLabelText('Type field note', {}, COLD)); });
    await act(async () => { fireEvent.changeText(tree.getByLabelText('Field note'), NOTE); });

    const subscriptions = jest.mocked(subscribeToAuthStateChange).mock.calls;
    const listener = subscriptions[subscriptions.length - 1][0];
    await act(async () => listener('SIGNED_OUT', null));
    await act(async () => listener('SIGNED_IN', { user: { id: 'owner-a2' } } as never));
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await waitFor(() => expect(tree.queryByDisplayValue(NOTE)).toBeNull(), COLD);
    tree.unmount();
  });
});
