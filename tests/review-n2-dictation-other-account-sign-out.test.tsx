/**
 * Review N2 (5 Oct 2026; caused by 16efe4e), in the real app shell (harness
 * from tests/everyday-7-unasked-sign-out-keeps-dictation.test.tsx).
 *
 * David's sign-in ends unasked while he has a field note unsaved; it is set
 * aside for him (everyday item 7). A second account signs in on the phone
 * and sees none of his words. That account then uses Settings' Sign Out,
 * which warned it about its own unsaved work only, and David's note was
 * deleted with it: every account's kept work went. A sign-out now removes
 * only the work of the account that is signing out, so David's note is still
 * there, in Field Notes, when he signs back in.
 *
 * Sign-in events reach the app as auth-js sends them: each listener is told
 * who is signed in as it starts to listen, and a screen that has closed no
 * longer listens. (The older harness kept calling closed screens' listeners,
 * which hid where the note was removed.)
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import {
  getCurrentSessionUser,
  getCurrentUser,
  subscribeToAuthStateChange,
} from '../services/SupabaseService';
import { forgetFieldNoteDraft } from '../hooks/use-field-note-draft';
import { readKeptDraft } from '../services/KeptDraftStore';
import { clearSignOutAskedHere, noteSignOutAskedHere } from '../services/SignOutIntent';
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
const DAVID = 'owner-david';
const OTHER = 'owner-other';
const DAVIDS_NOTE = 'Guardrail missing at the north slab edge, level 3';
const OTHERS_NOTE = 'Deliveries moved to the east gate';
const originalError = console.error;
beforeAll(() => { console.error = () => undefined; });
afterAll(() => { console.error = originalError; });

type AuthListener = Parameters<typeof subscribeToAuthStateChange>[0];
/** The screens listening for sign-in events now, and the ones already told who is signed in. */
const listening = new Set<AuthListener>();
const toldWhoIsSignedIn = new WeakSet<AuthListener>();
const sessionOf = (userId: string | null) => (userId ? { user: { id: userId } } : null) as never;

const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
/** Every screen listening now hears the event, as with auth-js. */
async function authEvent(event: string, userId: string | null) {
  const listeners = [...listening];
  await act(async () => { listeners.forEach(listener => listener(event as never, sessionOf(userId))); });
}
/** auth-js tells each new listener who is signed in as it starts to listen. */
async function newListenersHearWhoIsSignedIn(userId: string) {
  const fresh = [...listening].filter(listener => !toldWhoIsSignedIn.has(listener));
  fresh.forEach(listener => toldWhoIsSignedIn.add(listener));
  await act(async () => { fresh.forEach(listener => listener('INITIAL_SESSION' as never, sessionOf(userId))); });
}

beforeEach(async () => {
  act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
  await AsyncStorage.clear();
  listening.clear();
  jest.mocked(subscribeToAuthStateChange).mockImplementation(listener => {
    listening.add(listener);
    return () => { listening.delete(listener); };
  });
  session.mockResolvedValue({ ok: true, data: { id: DAVID } } as never);
  currentUser.mockResolvedValue({ ok: true, data: { id: DAVID } } as never);
});
afterEach(() => { forgetFieldNoteDraft(); forgetSetAsideAccount(); clearSignOutAskedHere(); });

/** The workspace is open for `userId`, and its screens know who is signed in. */
async function workspaceOpenFor(tree: ReturnType<typeof render>, userId: string) {
  await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
  await newListenersHearWhoIsSignedIn(userId);
}

async function writeFieldNote(tree: ReturnType<typeof render>, userId: string, text: string) {
  await act(async () => { fireEvent.press(tree.getByLabelText('Open Field Notes')); });
  await act(async () => { fireEvent.press(await tree.findByLabelText('Type field note', {}, COLD)); });
  await act(async () => { fireEvent.changeText(tree.getByLabelText('Field note'), text); });
  await waitFor(async () => expect((await readKeptDraft('field-note', userId))?.value).toMatchObject({ text }), COLD);
}

/** The sign-in ends (the workspace closes), then `signInAs` signs in on this phone. */
async function signOutThen(tree: ReturnType<typeof render>, signInAs: string) {
  await authEvent('SIGNED_OUT', null);
  await wait(300);
  session.mockResolvedValue({ ok: true, data: { id: signInAs } } as never);
  currentUser.mockResolvedValue({ ok: true, data: { id: signInAs } } as never);
  await authEvent('SIGNED_IN', signInAs);
  await workspaceOpenFor(tree, signInAs);
}

describe('review N2: work set aside for David survives another account\'s Settings sign-out', () => {
  it('his note is not shown to the other account, is still kept after that account signs out, and is back in Field Notes when he signs in', async () => {
    const tree = render(<NativeRoot />);
    await workspaceOpenFor(tree, DAVID);
    await writeFieldNote(tree, DAVID, DAVIDS_NOTE);

    // David's sign-in ends elsewhere (not asked for on this phone); the other account signs in here.
    await signOutThen(tree, OTHER);
    expect((await readKeptDraft('field-note', DAVID))?.value).toMatchObject({ text: DAVIDS_NOTE });
    expect(await readKeptDraft('field-note', OTHER)).toBeNull();
    // It sees none of David's words, in Field Notes or anywhere on screen.
    await act(async () => { fireEvent.press(tree.getByLabelText('Open Field Notes')); });
    await wait(500);
    expect(tree.queryByLabelText('Field note')).toBeNull();
    expect(JSON.stringify(tree.toJSON())).not.toContain(DAVIDS_NOTE);

    // It writes a note of its own, then signs out through Settings (asked for here, after its warning).
    await act(async () => { fireEvent.press(await tree.findByLabelText('Type field note', {}, COLD)); });
    await act(async () => { fireEvent.changeText(tree.getByLabelText('Field note'), OTHERS_NOTE); });
    await waitFor(async () => expect((await readKeptDraft('field-note', OTHER))?.value).toMatchObject({ text: OTHERS_NOTE }), COLD);
    noteSignOutAskedHere();
    await signOutThen(tree, DAVID);

    // The other account's own note is gone, as its warning said. David's is still kept for him.
    await waitFor(async () => expect(await readKeptDraft('field-note', OTHER)).toBeNull(), COLD);
    expect((await readKeptDraft('field-note', DAVID))?.value).toMatchObject({ text: DAVIDS_NOTE });
    await act(async () => { fireEvent.press(tree.getByLabelText('Open Field Notes')); });
    await waitFor(() => expect(tree.getByLabelText('Field note').props.value).toBe(DAVIDS_NOTE), COLD);
    expect(JSON.stringify(tree.toJSON())).not.toContain(OTHERS_NOTE);
    tree.unmount();
  });
});
