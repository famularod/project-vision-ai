/**
 * Whole-app audit A2 M2 (30 Sep 2026): the workspace waited for a live account
 * lookup (GET /auth/v1/user) before it opened. A hung connection held it on
 * "Restoring your project data" for up to a minute, and a thrown lookup (a
 * Keychain error) blocked it as unreadable phone storage. It now opens on the
 * saved name; the lookup's name applies later, for this owner only, unless
 * the name was typed; and only a typed name is saved to the account.
 * (Mocks from the audit reviewer's proof test, which asserted the old wait.)
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import {
  getCurrentSessionUser,
  getCurrentUser,
  updateCurrentUserDisplayName,
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
    updateCurrentUserDisplayName: jest.fn(async () => ({ ok: true, data: null })),
  };
});

const session = jest.mocked(getCurrentSessionUser);
const currentUser = jest.mocked(getCurrentUser);
const saveAccountName = jest.mocked(updateCurrentUserDisplayName);
jest.setTimeout(120_000);
const COLD = { timeout: 60_000 } as const;
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 } as const;
const DISPLAY_NAME_KEY = 'projectPhotoUpdate.displayName.v1';
const OWNER = 'owner-a2';

const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
/** Holds every account lookup until answered (more than one caller asks). */
function heldLookups() {
  const waiting: Array<(value: unknown) => void> = [];
  currentUser.mockImplementation(() => new Promise(resolve => { waiting.push(resolve); }) as never);
  return (value: unknown) => act(async () => { waiting.splice(0).forEach(resolve => resolve(value)); });
}
const account = (id: string, name: string) =>
  ({ ok: true, data: { id, user_metadata: { project_vision_display_name: name } } }) as never;

beforeEach(async () => {
  act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
  await AsyncStorage.clear();
  session.mockResolvedValue({ ok: true, data: { id: OWNER } } as never);
  saveAccountName.mockClear();
});

describe('startup does not wait on the account lookup (audit A2 M2)', () => {
  it('opens while the account lookup is still waiting', async () => {
    const answer = heldLookups();
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await answer({ ok: false, data: null, error: 'Network request failed' });
    tree.unmount();
  });

  it('opens when the account lookup throws', async () => {
    currentUser.mockImplementation(async () => {
      throw new Error('User interaction is not allowed.');
    });
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    expect(tree.queryByText('Saved data needs recovery')).toBeNull();
    tree.unmount();
  });

  it("takes this owner's account name, and saves no name it did not type", async () => {
    await AsyncStorage.setItem(DISPLAY_NAME_KEY, 'Name On This Phone');
    currentUser.mockResolvedValue(account(OWNER, 'Name Set On iPad'));
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await waitFor(async () => {
      await expect(AsyncStorage.getItem(DISPLAY_NAME_KEY)).resolves.toBe('Name Set On iPad');
    }, COLD);
    await wait(1200);
    expect(saveAccountName).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('ignores a lookup that answers for another account', async () => {
    await AsyncStorage.setItem(DISPLAY_NAME_KEY, 'Name On This Phone');
    currentUser.mockResolvedValue(account('someone-else', 'Not The Owner'));
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await wait(1200);
    await expect(AsyncStorage.getItem(DISPLAY_NAME_KEY)).resolves.toBe('Name On This Phone');
    expect(saveAccountName).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('saves a typed name to the account, and a late lookup does not replace it', async () => {
    const answer = heldLookups();
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    fireEvent.press(await tree.findByLabelText('Open Settings', {}, COLD));
    fireEvent.changeText(await tree.findByPlaceholderText('David', {}, COLD), 'Typed Here');
    await waitFor(() => expect(saveAccountName).toHaveBeenCalledWith('Typed Here'), COLD);
    await answer(account(OWNER, 'Late Account Name'));
    await wait(300);
    expect(tree.getByPlaceholderText('David').props.value).toBe('Typed Here');
    tree.unmount();
  });
});
