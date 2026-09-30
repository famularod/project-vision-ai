/**
 * The open workspace across the same account's sign-in events, in the real
 * app shell. Owner answer Q13 (30 Sep 2026): opened offline on a saved
 * sign-in that could not refresh, the app shows "Offline, sign-in pending"
 * until the sign-in refreshes, and that refresh (after the start's null
 * INITIAL_SESSION) is the same account, so the field note being written is
 * kept. Whole-app audit A6 pass 6 #5: the hourly token refresh no longer
 * clears the account identity Reports waits for, so Reports does not fall
 * back to "Loading Project Data" until a network lookup answers.
 * (Harness from tests/app-startup-account-name.test.tsx.)
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import {
  awaitSavedSignInRefresh,
  getCurrentSessionUser,
  getCurrentUser,
  readSavedSignIn,
  subscribeToAuthStateChange,
  subscribeToDAVEOperationalChanges,
} from '../services/SupabaseService';
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
    updateCurrentUserDisplayName: jest.fn(async () => ({ ok: true, data: null })),
    awaitSavedSignInRefresh: jest.fn(async () => ({ status: 'signed_out' })),
    readSavedSignIn: jest.fn(async () => null),
  };
});

const session = jest.mocked(getCurrentSessionUser);
const currentUser = jest.mocked(getCurrentUser);
jest.setTimeout(240_000);
const COLD = { timeout: 90_000 } as const;
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 } as const;
const OWNER = 'owner-q13';
const NOTE = 'Guardrail missing at the north slab edge, level 3';
const originalError = console.error;
beforeAll(() => { console.error = () => undefined; });
afterAll(() => { console.error = originalError; });

const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
/** Every auth subscriber (NativeRoot, the app, Settings) hears the event, as with auth-js. */
async function authEvent(event: string, userId: string | null) {
  const listeners = jest.mocked(subscribeToAuthStateChange).mock.calls.map(call => call[0]);
  await act(async () => {
    listeners.forEach(listener => listener(event as never, (userId ? { user: { id: userId } } : null) as never));
  });
}

beforeEach(async () => {
  act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
  await AsyncStorage.clear();
  session.mockResolvedValue({ ok: true, data: { id: OWNER } } as never);
  currentUser.mockResolvedValue({ ok: true, data: { id: OWNER } } as never);
});
afterEach(() => forgetFieldNoteDraft());

/** No signal, the hourly token expired: the saved sign-in cannot refresh. */
async function offlineStartOnSavedSignIn() {
  await AsyncStorage.setItem('@vitruvius/owner-storage-sandbox/metadata/v1', JSON.stringify({
    version: 1, activeOwnerId: OWNER, legacyAssignedOwnerId: null, updatedAt: '2026-09-30T06:00:00.000Z',
  }));
  session.mockResolvedValue({ ok: false, error: 'Network request failed', status: 401 } as never);
  jest.mocked(awaitSavedSignInRefresh).mockResolvedValue({ status: 'network_unavailable' });
  jest.mocked(readSavedSignIn).mockResolvedValue({
    ownerId: OWNER, lastRefreshedAtMs: Date.now() - 14 * 3_600_000, expiresAtMs: Date.now() - 13 * 3_600_000,
  });
}

describe('the same account\'s sign-in events keep the open workspace', () => {
  it('Q13: shows "Offline, sign-in pending" in the app until the sign-in refreshes', async () => {
    await offlineStartOnSavedSignIn();
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    expect(tree.getByText('Offline, sign-in pending')).toBeTruthy();

    await authEvent('INITIAL_SESSION', null);
    expect(tree.getByText('Offline, sign-in pending')).toBeTruthy();
    await authEvent('TOKEN_REFRESHED', OWNER);
    await waitFor(() => expect(tree.queryByText('Offline, sign-in pending')).toBeNull(), COLD);
    expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy();
    tree.unmount();
  });

  it('Q13: the offline start\'s null INITIAL_SESSION, then the refresh, keep the field note being written', async () => {
    await offlineStartOnSavedSignIn();
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(tree.getByLabelText('Open Field Notes')); });
    await act(async () => { fireEvent.press(await tree.findByLabelText('Type field note', {}, COLD)); });
    await act(async () => { fireEvent.changeText(tree.getByLabelText('Field note'), NOTE); });

    await authEvent('INITIAL_SESSION', null);
    await authEvent('TOKEN_REFRESHED', OWNER);
    await wait(300);
    expect(tree.getByLabelText('Field note').props.value).toBe(NOTE);
    tree.unmount();
  });

  it('A1 pass 2 #4: live updates connect when the offline start\'s sign-in refreshes, without reopening the workspace', async () => {
    await offlineStartOnSavedSignIn();
    const subscribe = jest.mocked(subscribeToDAVEOperationalChanges);
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await waitFor(() => expect(subscribe).toHaveBeenCalled(), COLD);
    await wait(500);
    // While pending, the service has no refreshed sign-in to subscribe with
    // and quietly does nothing (as SupabaseService does). Nothing retried it.
    const whilePending = subscribe.mock.calls.length;
    await wait(500);
    expect(subscribe.mock.calls.length).toBe(whilePending);

    await authEvent('TOKEN_REFRESHED', OWNER);
    await waitFor(() => expect(tree.queryByText('Offline, sign-in pending')).toBeNull(), COLD);
    await waitFor(() => expect(subscribe.mock.calls.length).toBe(whilePending + 1), COLD);
    expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy();
    tree.unmount();
  });

  it('A6 #5: a same-account TOKEN_REFRESHED keeps Reports\' identity (no "Loading Project Data")', async () => {
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await authEvent('INITIAL_SESSION', OWNER);
    await act(async () => { fireEvent.press(tree.getByLabelText('Reports')); });
    await waitFor(() => expect(tree.getByText('Approve Report')).toBeTruthy(), COLD);
    await waitFor(() => expect(tree.queryByText('Loading Project Data')).toBeNull(), COLD);

    // The hourly refresh; the account lookup it triggers has no answer yet.
    const waiting: Array<(value: unknown) => void> = [];
    currentUser.mockImplementation(() => new Promise(resolve => { waiting.push(resolve); }) as never);
    await authEvent('TOKEN_REFRESHED', OWNER);
    await wait(2500);
    expect(tree.queryByText('Loading Project Data')).toBeNull();
    expect(tree.getByText('Approve Report')).toBeTruthy();
    await act(async () => { waiting.splice(0).forEach(resolve => resolve({ ok: true, data: { id: OWNER } })); });
    tree.unmount();
  });
});
