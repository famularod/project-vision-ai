/**
 * Everyday item 7 (2 Oct 2026): a sign-out this phone did not ask for (the
 * sign-in ended elsewhere, e.g. the iPad's "Sign Out of All Devices", while
 * the app was closed or open) discarded the field note being dictated, with
 * no warning. It is now set aside for that account, kept on the phone, and
 * offered again in Field Notes once the same account signs in. Settings'
 * Sign Out, which warns first, still discards it, and so does another
 * account signing in. The real app shell (harness from
 * tests/app-same-account-auth-events.test.tsx).
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
import { readKeptDraft } from '../services/KeptDraftStore';
import { noteSignOutAskedHere } from '../services/SignOutIntent';
import { forgetSetAsideAccount } from '../hooks/unsaved-drafts-on-account-change';

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
afterEach(() => { forgetFieldNoteDraft(); forgetSetAsideAccount(); });

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


async function writeFieldNote(tree: ReturnType<typeof render>) {
  await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
  await act(async () => { fireEvent.press(tree.getByLabelText('Open Field Notes')); });
  await act(async () => { fireEvent.press(await tree.findByLabelText('Type field note', {}, COLD)); });
  await act(async () => { fireEvent.changeText(tree.getByLabelText('Field note'), NOTE); });
  await waitFor(async () => expect((await readKeptDraft('field-note', OWNER))?.value).toMatchObject({ text: NOTE }), COLD);
}

/** The workspace closes on a sign-out and opens again on this account's sign-in, as NativeRoot does. */
async function signOutThenBackIn(tree: ReturnType<typeof render>, signInAs: string) {
  await authEvent('SIGNED_OUT', null);
  await wait(300);
  session.mockResolvedValue({ ok: true, data: { id: signInAs } } as never);
  currentUser.mockResolvedValue({ ok: true, data: { id: signInAs } } as never);
  await authEvent('SIGNED_IN', signInAs);
  await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
}

describe('a sign-out this phone did not ask for keeps the dictation for the account (everyday item 7)', () => {
  it('the note being written is set aside, and offered again in Field Notes after the same account signs in', async () => {
    const tree = render(<NativeRoot />);
    await writeFieldNote(tree);
    await signOutThenBackIn(tree, OWNER);
    // Kept on the phone for this account all along.
    expect((await readKeptDraft('field-note', OWNER))?.value).toMatchObject({ text: NOTE });
    await act(async () => { fireEvent.press(tree.getByLabelText('Open Field Notes')); });
    await waitFor(() => expect(tree.getByLabelText('Field note').props.value).toBe(NOTE), COLD);
    tree.unmount();
  });

  it('Settings\' Sign Out (asked here, after its warning) still discards it', async () => {
    const tree = render(<NativeRoot />);
    await writeFieldNote(tree);
    noteSignOutAskedHere();
    await signOutThenBackIn(tree, OWNER);
    await waitFor(async () => expect(await readKeptDraft('field-note', OWNER)).toBeNull(), COLD);
    tree.unmount();
  });

  it('another account never reads it, and the same account still gets it (the rule, as the app calls it)', async () => {
    const { settleUnsavedDraftsOnAccountChange } = require('../hooks/unsaved-drafts-on-account-change');
    const { keepDraft } = require('../services/KeptDraftStore');
    await keepDraft('field-note', OWNER, '', { text: NOTE, source: 'voice', projectName: '', locationName: '', actionKind: 'none', actionText: '', captureOpen: true });
    // Signed out elsewhere while the app was closed: the launch's first event is the sign-out.
    settleUnsavedDraftsOnAccountChange('SIGNED_OUT', undefined, null);
    expect(await readKeptDraft('field-note', 'owner-other')).toBeNull();
    // The app stays open and the same account signs in: kept.
    settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, OWNER);
    expect((await readKeptDraft('field-note', OWNER))?.value).toMatchObject({ text: NOTE });
    // Set aside for OWNER, then another account signs in in the same app: removed, as before.
    settleUnsavedDraftsOnAccountChange('SIGNED_OUT', OWNER, null);
    settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, 'owner-other');
    await waitFor(async () => expect(await readKeptDraft('field-note', OWNER)).toBeNull());
  });
});
