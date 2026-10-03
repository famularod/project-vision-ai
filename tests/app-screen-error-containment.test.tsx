/**
 * Whole-app audit A2 M4 (30 Sep 2026): the only error boundary was at the
 * root, so one throwing screen replaced the whole app, tab bar included, and a
 * fault on Overview crashed again on every Retry and relaunch, with Settings
 * and backup export out of reach. components/screen-error-boundary.tsx keeps
 * a screen's error inside the content area. (The audit verifier's test, fault
 * injection only: one leaf screen and one Overview card throw.)
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { Alert, Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import { getCurrentSessionUser } from '../services/SupabaseService';
import { getStartupDiagnostics } from '../services/StartupDiagnostics';

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

// Fault injection only: one leaf screen and one Overview card throw during
// render. The boundary, the shell and the navigation under test stay real.
const faults = { reports: true, overviewCard: false, voiceSheet: 'none' as 'none' | 'open' | 'always' };
const voiceSheetRenders: boolean[] = [];
jest.mock('../components/DAVEVoiceCaptureSheet', () => {
  const actual = jest.requireActual('../components/DAVEVoiceCaptureSheet');
  return {
    ...actual,
    DAVEVoiceCaptureSheet: (props: { visible: boolean }) => {
      if (faults.voiceSheet === 'always' || (faults.voiceSheet === 'open' && props.visible)) {
        throw new TypeError("Cannot read properties of undefined (reading 'map')");
      }
      voiceSheetRenders.push(props.visible);
      return actual.DAVEVoiceCaptureSheet(props);
    },
  };
});
jest.mock('../screens/ReportsScreen', () => {
  const actual = jest.requireActual('../screens/ReportsScreen');
  return {
    ...actual,
    ReportsScreen: (props: unknown) => {
      if (faults.reports) throw new TypeError("Cannot read properties of undefined (reading 'trim')");
      return actual.ReportsScreen(props);
    },
  };
});
jest.mock('../components/native-field-notes-experience', () => {
  const actual = jest.requireActual('../components/native-field-notes-experience');
  return {
    ...actual,
    OverviewFieldNotesCard: (props: { onPress: () => void }) => {
      if (faults.overviewCard) throw new TypeError('Invalid time value');
      return actual.OverviewFieldNotesCard(props);
    },
  };
});

const session = jest.mocked(getCurrentSessionUser);
jest.setTimeout(240_000);
const COLD = { timeout: 90_000 } as const;
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 } as const;
const originalError = console.error;
beforeAll(() => { console.error = () => undefined; });
afterAll(() => { console.error = originalError; });
beforeEach(() => {
  act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
  session.mockResolvedValue({ ok: true, data: { id: 'owner-a2' } } as never);
  faults.reports = true;
  faults.overviewCard = false;
  faults.voiceSheet = 'none';
  voiceSheetRenders.length = 0;
});


const caughtCount = () => getStartupDiagnostics().filter(e => e.stage === 'error_boundary_caught').length;
const mountedCount = () => getStartupDiagnostics().filter(e => e.stage === 'app_shell_mounted').length;

describe('a screen that fails to render stays inside the content area (audit A2 M4)', () => {
  it('a Reports crash stays inside the content area; tabs keep working; the shell is not remounted', async () => {
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    const tabs = () => within(tree.getByTestId('app-bottom-tabs'));
    const mountsBefore = mountedCount();
    const caughtBefore = caughtCount();
    await act(async () => { fireEvent.press(tabs().getByLabelText('Reports')); });
    expect(tree.getByTestId('screen-error-fallback')).toBeTruthy();
    expect(tree.queryByText('ECOS could not finish starting.')).toBeNull();
    expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy();
    expect(caughtCount()).toBe(caughtBefore + 1);
    // Tab bar navigation clears the error without a remount.
    await act(async () => { fireEvent.press(tabs().getByLabelText('Tasks')); });
    expect(tree.queryByTestId('screen-error-fallback')).toBeNull();
    expect(tabs().getByRole('tab', { name: 'Tasks' }).props.accessibilityState).toEqual({ selected: true });
    // Fault fixed, Try Again on the same screen renders it.
    await act(async () => { fireEvent.press(tabs().getByLabelText('Reports')); });
    expect(tree.getByTestId('screen-error-fallback')).toBeTruthy();
    faults.reports = false;
    await act(async () => { fireEvent.press(tree.getByRole('button', { name: 'Try Again' })); });
    expect(tree.queryByTestId('screen-error-fallback')).toBeNull();
    expect(mountedCount()).toBe(mountsBefore);
    tree.unmount();
  });

  it('a crashing Overview offers Open Settings, which reaches Settings (backup export) with tabs intact', async () => {
    faults.overviewCard = true;
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('screen-error-fallback')).toBeTruthy(), COLD);
    expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy();
    expect(tree.queryByRole('button', { name: 'Back to Overview' })).toBeNull();
    await act(async () => { fireEvent.press(tree.getByRole('button', { name: 'Open Settings' })); });
    await waitFor(() => expect(tree.getByText('Data Recovery')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(tree.getByText('Data Recovery')); });
    expect(tree.getByText('Export Limited Device Backup')).toBeTruthy();
    expect(tree.getByPlaceholderText('Backup passphrase')).toBeTruthy();
    expect(tree.queryByTestId('screen-error-fallback')).toBeNull();
    // Back to a still-broken Overview: contained again, no loop.
    const caughtBefore = caughtCount();
    await act(async () => { fireEvent.press(within(tree.getByTestId('app-bottom-tabs')).getByLabelText('Overview')); });
    expect(tree.getByTestId('screen-error-fallback')).toBeTruthy();
    expect(caughtCount()).toBe(caughtBefore + 1);
    tree.unmount();
  });
});

// Audit A2 pass 2 (30 Sep 2026): the screen boundary also caught the app's
// sheets, whose open state lives in App, so a sheet that threw while open
// threw again after Try Again, Overview, Settings and every tab until the
// app was force-quit (the root Retry used to remount the shell and recover).
describe('a sheet that fails to render closes and leaves the screen alone (audit A2 pass 2)', () => {
  it('a sheet that throws while open is closed with a notice; the screen and tabs stay; it opens again once fixed', async () => {
    faults.reports = false;
    faults.voiceSheet = 'open';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    const tabs = () => within(tree.getByTestId('app-bottom-tabs'));
    await waitFor(() => expect(tree.getByLabelText('Open Settings')).toBeTruthy(), COLD);
    const mountsBefore = mountedCount();
    const caughtBefore = caughtCount();
    await act(async () => { fireEvent.press(tabs().getByLabelText('Ask ECOS')); });
    expect(alert).toHaveBeenCalledWith('That panel could not open.', 'It was closed. Your saved project data is safe.');
    expect(tree.queryByTestId('screen-error-fallback')).toBeNull();
    expect(tree.getByLabelText('Open Settings')).toBeTruthy();
    expect(caughtCount()).toBe(caughtBefore + 1);
    expect(mountedCount()).toBe(mountsBefore);
    // Tabs work, and nothing keeps throwing.
    await act(async () => { fireEvent.press(tabs().getByLabelText('Tasks')); });
    expect(tabs().getByRole('tab', { name: 'Tasks' }).props.accessibilityState).toEqual({ selected: true });
    expect(tree.queryByTestId('screen-error-fallback')).toBeNull();
    expect(caughtCount()).toBe(caughtBefore + 1);
    // Fixed: Ask ECOS opens its sheet again.
    faults.voiceSheet = 'none';
    voiceSheetRenders.length = 0;
    await act(async () => { fireEvent.press(tabs().getByLabelText('Ask ECOS')); });
    expect(voiceSheetRenders).toContain(true);
    alert.mockRestore();
    tree.unmount();
  });

  it('a sheet that throws even while closed leaves Overview and Settings reachable, with no loop', async () => {
    faults.reports = false;
    faults.voiceSheet = 'always';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByLabelText('Open Settings')).toBeTruthy(), COLD);
    expect(tree.queryByTestId('screen-error-fallback')).toBeNull();
    const caughtAtOverview = caughtCount();
    await act(async () => { fireEvent.press(tree.getByLabelText('Open Settings')); });
    await waitFor(() => expect(tree.getByText('Data Recovery')).toBeTruthy(), COLD);
    expect(tree.queryByTestId('screen-error-fallback')).toBeNull();
    // At most one close-and-retry per screen: two catches on arrival, then quiet.
    expect(caughtCount() - caughtAtOverview).toBeLessThanOrEqual(2);
    const settled = caughtCount();
    await act(async () => { fireEvent.press(tree.getByText('Data Recovery')); });
    expect(tree.getByText('Export Limited Device Backup')).toBeTruthy();
    expect(caughtCount()).toBe(settled);
    alert.mockRestore();
    tree.unmount();
  });
});
