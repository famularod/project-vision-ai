/**
 * The test that did not exist: does the native app actually boot?
 *
 * Deep review 2026-09-20 found that nothing in this repository rendered
 * App.tsx. The only test touching the entry point (native-field-notes-startup)
 * `jest.mock`s App away; App.tsx is outside the coverage denominator
 * (jest.config.js collectCoverageFrom lists services and components only);
 * `web:export` builds the expo-router tree, which never imports App.tsx; and
 * Maestro is not part of qa:release. A runtime crash anywhere in the 20,924-line
 * native shell therefore passed all 19 gate layers, which is why the July device
 * kills were only ever discovered on a physical phone.
 *
 * This renders NativeRoot -- the real registered root -- not App directly. That
 * matters: App requires the workspace owner boundary that NativeRoot installs
 * (components/native-workspace-owner.ts:13), so rendering App alone throws
 * "Native local data requires the workspace owner boundary" and proves nothing
 * about booting. Rendering NativeRoot also covers the owner sandbox, the
 * sign-in gate and the pending-changes boundary.
 *
 * Asserted, five cases: a signed-in owner reaches the bottom tab bar; every tab
 * can be selected without unmounting the shell; a signed-out cold start shows
 * the sign-in gate rather than a startup error; a tablet width boots to the
 * navigation rail instead; and booting logs no hook-order or infinite-update
 * error.
 *
 * Window width matters more than it looks. App.tsx:5134 picks the layout from
 * useWindowDimensions, and jest's default window is wide — so the app renders the
 * tablet rail and there is no bottom tab bar at all. Five attempts chased that
 * before the cause was clear, so the width is pinned explicitly per case and the
 * rail path gets its own assertion; both are separate render paths and neither
 * had boot coverage.
 *
 * Deliberately NOT asserted: screen contents or business rules. Keep this about
 * booting, so failures are unambiguous and the whole suite stays near a second.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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

const session = jest.mocked(getCurrentSessionUser);
const consoleErrors: string[] = [];
let originalError: typeof console.error;

beforeAll(() => {
  originalError = console.error;
  console.error = (...args: unknown[]) => { consoleErrors.push(args.map(String).join(' ')); };
});
afterAll(() => { console.error = originalError; });
beforeEach(() => { consoleErrors.length = 0; setWindow(PHONE); });

// A cold first render transpiles and mounts 20,924 lines of shell.
jest.setTimeout(240_000);
const COLD = { timeout: 90_000 } as const;

type SessionResult = Awaited<ReturnType<typeof getCurrentSessionUser>>;

// The shell picks its layout from window width (App.tsx:5134
// appShellLayoutForWidth). jest's default window is wide, so the app renders the
// tablet side rail (testID app-rail-brand) and there is no bottom tab bar at all
// — which is what attempts 1-5 were actually hitting. Same helper the existing
// app-shell-frame suite uses.
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 } as const;
const TABLET = { width: 1024, height: 1366, scale: 2, fontScale: 1 } as const;

function setWindow(window: { width: number; height: number; scale: number; fontScale: number }) {
  act(() => { Dimensions.set({ window, screen: window }); });
}

function signedIn() {
  session.mockResolvedValue({ ok: true, data: { id: 'owner-smoke' } } as unknown as SessionResult);
}
function signedOut() {
  session.mockResolvedValue({ ok: true, data: null } as unknown as SessionResult);
}

function report(tree: ReturnType<typeof render>, what: string) {
  originalError(`\n=== ${what} ===`);
  originalError(`console.error entries: ${consoleErrors.length}`);
  consoleErrors.slice(0, 12).forEach((message, index) => {
    originalError(`  [${index}] ${message.replace(/\s+/g, ' ').slice(0, 300)}`);
  });
  const json = tree.toJSON();
  originalError(json ? JSON.stringify(json).slice(0, 900) : '(null tree)');
}

const FATAL = /Rendered (more|fewer) hooks|Maximum update depth|Cannot read propert|is not a function/i;

describe('native app boots', () => {
  it('a signed-in owner reaches the bottom tab bar', async () => {
    signedIn();
    const tree = render(<NativeRoot />);
    try {
      await waitFor(() => {
        expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy();
      }, COLD);
    } catch (error) {
      report(tree, 'SIGNED-IN BOOT DID NOT REACH THE TAB BAR');
      throw error;
    }
  });

  it('every bottom tab can be selected without unmounting the shell', async () => {
    signedIn();
    const tree = render(<NativeRoot />);
    await waitFor(() => {
      expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy();
    }, COLD);
    // Labels from components/app-bottom-tabs.tsx. The assistant button is
    // excluded: it opens a sheet rather than changing screens.
    for (const label of ['Overview', 'Tasks', 'Reports'] as const) {
      await act(async () => { fireEvent.press(tree.getByLabelText(label)); });
      expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy();
    }
  });

  it('a signed-out cold start shows the sign-in gate, not a startup error', async () => {
    // entry.ts:156 -- work is only created inside a signed-in owner workspace.
    // This guards against a new install showing "ECOS could not finish
    // starting" instead of offering a way to sign in.
    signedOut();
    const tree = render(<NativeRoot />);
    try {
      await waitFor(() => {
        expect(tree.queryByText(/could not finish starting/i)).toBeNull();
        expect(tree.queryByText(/Workspace protection needs attention/i)).toBeNull();
        expect(tree.queryByText(/Opening your Vitruvius workspace/i)).toBeNull();
      }, COLD);
    } catch (error) {
      report(tree, 'SIGNED-OUT BOOT DID NOT REACH THE SIGN-IN GATE');
      throw error;
    }
  });

  it('a tablet width boots to the navigation rail instead of tabs', async () => {
    // The two layouts are separate render paths; the rail one was never covered.
    setWindow(TABLET);
    signedIn();
    const tree = render(<NativeRoot />);
    try {
      await waitFor(() => {
        expect(tree.getByTestId('app-rail-brand')).toBeTruthy();
      }, COLD);
    } catch (error) {
      report(tree, 'TABLET BOOT DID NOT REACH THE NAVIGATION RAIL');
      throw error;
    }
  });

  it('booting produces no hook-order or infinite-update errors', async () => {
    signedIn();
    const tree = render(<NativeRoot />);
    await waitFor(() => {
      expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy();
    }, COLD);
    const fatal = consoleErrors.filter(message => FATAL.test(message));
    if (fatal.length) report(tree, 'FATAL REACT ERRORS DURING BOOT');
    expect(fatal).toEqual([]);
  });
});
