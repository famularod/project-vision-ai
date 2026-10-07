/**
 * Second review of the web area, F6 (7 Oct 2026; caused by the fix for review
 * pass 1, L8), in the real app shell. The verification note typed on a task is
 * kept in memory for the account that typed it. A sign-in that ended unasked
 * set it aside, and with the app not yet told which account was signed in it
 * was set aside for "whoever signs in next".
 *
 * This file also holds what the rule alone could not show: the phone opens the
 * app afresh for each sign-in, and a freshly opened app is never told "this
 * account signed in" as a change of account. So a note set aside was never
 * brought back for its own account either. The note now takes the account of
 * the workspace its task row is drawn in, as it is typed, and is shown again
 * whenever that account's workspace shows the task.
 *
 * Every auth subscriber still subscribed hears each event, as with auth-js;
 * one that unsubscribed (the workspace that closed) hears nothing more.
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import { getCurrentSessionUser, getCurrentUser } from '../services/SupabaseService';
import { forgetSetAsideAccount } from '../hooks/unsaved-drafts-on-account-change';
import { clearScheduleProgressDraftsForTests, unusedScheduleVerificationNoteExists } from '../hooks/use-schedule-progress-draft';
import { clearSignOutAskedHere, noteSignOutAskedHere } from '../services/SignOutIntent';
import { createReportedCompletionVerification } from '../services/DAVECompletionVerification';

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
const mockAuthListeners = new Set<(event: string, session: unknown) => void>();
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
    // Every subscriber still subscribed hears an event, as with auth-js; one that unsubscribed hears nothing more.
    subscribeToAuthStateChange: jest.fn((listener: (event: string, session: unknown) => void) => {
      mockAuthListeners.add(listener);
      return () => { mockAuthListeners.delete(listener); };
    }),
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
const currentUser = jest.mocked(getCurrentUser);
jest.setTimeout(240_000);
const COLD = { timeout: 90_000 } as const;
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 } as const;
const originalError = console.error;
beforeAll(() => { console.error = () => undefined; });
afterAll(() => { console.error = originalError; });

const FIRST = 'owner-first';
const SECOND = 'owner-second';
const KEY = 'projectPhotoUpdate.scheduleItems.v1';
const TYPED = 'Walked level 2 with the foreman; every frame is plumb';
const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
async function authEvent(event: string, userId: string | null) {
  await act(async () => {
    [...mockAuthListeners].forEach(listener => listener(event, userId ? { user: { id: userId } } : null));
  });
}
const signedInAs = (userId: string) => {
  session.mockResolvedValue({ ok: true, data: { id: userId } } as never);
  currentUser.mockResolvedValue({ ok: true, data: { id: userId } } as never);
};
const noteField = (tree: ReturnType<typeof render>) => tree.findByPlaceholderText('Optional verification note', {}, COLD);
const openTheTask = async (tree: ReturnType<typeof render>) => {
  await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
  await act(async () => { fireEvent.press(within(tree.getByTestId('app-bottom-tabs')).getByLabelText('Tasks')); });
  await act(async () => { fireEvent.press(await tree.findByLabelText('Open Task Verify', {}, COLD)); });
};
/** The first account's workspace, on the task that awaits his verification, with the note typed. */
async function firstAccountTypesTheNote(heard: boolean) {
  const tree = render(<NativeRoot />);
  await openTheTask(tree);
  // With signal, auth-js tells the app which account is signed in; opened with no signal it has not yet.
  if (heard) await authEvent('TOKEN_REFRESHED', FIRST);
  const field = await noteField(tree);
  fireEvent(field, 'focus');
  await act(async () => { fireEvent.changeText(field, TYPED); });
  return tree;
}
/** The sign-in ends and another account signs in on the same phone: the workspace closes and another opens. */
async function signInEndsThenSignsIn(tree: ReturnType<typeof render>, next: string) {
  await authEvent('SIGNED_OUT', null);
  await wait(300);
  expect(tree.queryByTestId('app-bottom-tabs')).toBeNull();
  signedInAs(next);
  await authEvent('SIGNED_IN', next);
  await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
  await wait(300);
}

beforeEach(async () => {
  act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
  await AsyncStorage.clear();
  mockAuthListeners.clear();
  forgetSetAsideAccount();
  clearSignOutAskedHere();
  signedInAs(FIRST);
  await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(['2375 Compliance Project']));
  await AsyncStorage.setItem(KEY, JSON.stringify([{
    id: 'task-verify', taskName: 'Task Verify', projectName: '2375 Compliance Project', status: 'In Progress',
    percentComplete: 60, priority: 'Medium', startDate: '09/28/2026', finishDate: '10/02/2026', owner: '',
    contractor: '', locationName: '', notes: '',
    // A field update said the work is complete; the manager has not confirmed it yet.
    completionVerification: createReportedCompletionVerification({
      sourceName: 'Field update', sourceRecordId: 'update-verify-1', summary: 'Framing reported complete.',
      reportedAt: '2026-10-01T15:00:00.000Z', priorScheduleStatus: 'In Progress', priorPercentComplete: 60,
    }),
  }]));
});
afterEach(() => { act(() => clearScheduleProgressDraftsForTests()); });

describe('second review, web F6, whole app: the verification note belongs to the account that typed it', () => {
  it.each([
    ['the app had not yet heard which account is signed in (opened with no signal)', false],
    ['the app had heard the account', true],
  ])('%s: the sign-in ends unasked; a second account signs in and signs out through Settings; the first account signs in again and finds its note', async (_what, heard) => {
    const tree = await firstAccountTypesTheNote(heard);

    await signInEndsThenSignsIn(tree, SECOND);
    // The second account's Sign Out warning is about its own work: it typed no verification note.
    expect(unusedScheduleVerificationNoteExists(SECOND)).toBe(false);
    // Settings' Sign Out for the second account, confirmed; then the first account signs in again.
    noteSignOutAskedHere(SECOND);
    await signInEndsThenSignsIn(tree, FIRST);

    await openTheTask(tree);
    expect((await noteField(tree)).props.value).toBe(TYPED);
    expect(unusedScheduleVerificationNoteExists(FIRST)).toBe(true);
    tree.unmount();
  });

  it('the first account’s own Settings Sign Out discards the note, as its warning says: it is not back when it signs in again', async () => {
    const tree = await firstAccountTypesTheNote(false);
    expect(unusedScheduleVerificationNoteExists(FIRST)).toBe(true);

    noteSignOutAskedHere(FIRST);
    await signInEndsThenSignsIn(tree, FIRST);

    await openTheTask(tree);
    expect((await noteField(tree)).props.value).toBe('');
    expect(unusedScheduleVerificationNoteExists(FIRST)).toBe(false);
    tree.unmount();
  });
});
