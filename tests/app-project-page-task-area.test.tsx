/**
 * P1 part A, script 5 (6 Oct 2026). scripts/project-area-persistence-test.js
 * says "Expanded task cards must provide the shared Area selector". The
 * Tasks tab's cards do. The same card on a project's own page (its task
 * list) was never handed the app's areas, from the day the selector was
 * added: Change opened a sheet that offered "Unassigned / Unknown Area"
 * only, shown as the task's present choice even when the task had an area,
 * and Show All Areas listed nothing. The card is now handed the areas there
 * too, and offers the project's own, as on the Tasks tab.
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { ProjectActionSheet } from '../components/project-action-sheet';
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
const originalError = console.error;
const originalWarn = console.warn;
// What the app logs as an error or a warning is kept, not thrown away: no
// test here may leave React saying a change happened outside act(), or log
// after it has finished.
const logged: string[] = [];
const keep = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
beforeAll(() => { console.error = keep; console.warn = keep; });
afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
  const phrases = ['not wrapped in act(', 'Cannot log after tests are done', 'torn down', 'unhandled promise rejection'];
  expect(logged.filter(line => phrases.some(phrase => line.toLowerCase().includes(phrase.toLowerCase())))).toEqual([]);
});
beforeEach(async () => {
  session.mockResolvedValue({ ok: true, data: { id: 'owner-p1-area' } } as never);
  await AsyncStorage.clear();
  const task = (id: string, taskName: string, projectName: string, locationName: string) => ({
    id, taskName, projectName, status: 'In Progress', percentComplete: 20, priority: 'Medium',
    startDate: '09/28/2026', finishDate: '10/30/2026', owner: '', contractor: '', locationName, notes: '',
  });
  const area = (id: string, name: string, projectName: string) => ({
    id, name, projectName, latitude: 0, longitude: 0, radiusFeet: 150, locationCapturedAt: null,
  });
  await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(['Lot 9', 'Main St']));
  await AsyncStorage.setItem('projectPhotoUpdate.scheduleItems.v1', JSON.stringify([
    task('task-lot9', 'Grade pad', 'Lot 9', 'North Pad'), task('task-main', 'Seal roof', 'Main St', 'Roof Deck'),
  ]));
  await AsyncStorage.setItem('projectPhotoUpdate.projectAreas.v1', JSON.stringify([
    area('area-north', 'North Pad', 'Lot 9'), area('area-south', 'South Pad', 'Lot 9'),
    area('area-roof', 'Roof Deck', 'Main St'),
  ]));
});

async function openAreaSheetForGradePad(tree: ReturnType<typeof render>) {
  await act(async () => { fireEvent.press(await tree.findByLabelText('Open Grade pad', {}, COLD)); });
  await act(async () => { fireEvent.press(await tree.findByText('Change', {}, COLD)); });
  await waitFor(() => expect(tree.getByText('Change Area')).toBeTruthy(), COLD);
  await act(async () => { fireEvent.press(tree.getByText('Show All Areas')); });
}

/** The open Change Area sheet (the page behind it names areas too). */
function areaSheet(tree: ReturnType<typeof render>) {
  const sheet = tree.UNSAFE_getAllByType(ProjectActionSheet)
    .find(node => node.props.visible && node.props.title === 'Change Area');
  if (!sheet) throw new Error('The Change Area sheet is not open.');
  return within(sheet);
}

/** Which of the seeded names the open sheet offers. */
function offeredAreas(tree: ReturnType<typeof render>) {
  const sheet = areaSheet(tree);
  return ['Unassigned / Unknown Area', 'North Pad', 'South Pad', 'Roof Deck']
    .filter(name => sheet.queryAllByText(name).length > 0);
}

describe('a task card offers its project\'s areas wherever the card is shown', () => {
  it('on the project\'s own page: Change lists Lot 9\'s areas, not Main St\'s, and the pick goes onto the task', async () => {
    act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    // Overview, Lot 9's card: its own page, with its task list.
    const lot9 = tree.getAllByText('Lot 9');
    await act(async () => { fireEvent.press(lot9[lot9.length - 1]); });
    await openAreaSheetForGradePad(tree);

    // The project's two areas are offered; another project's is not.
    expect(offeredAreas(tree)).toEqual(['Unassigned / Unknown Area', 'North Pad', 'South Pad']);

    await act(async () => { fireEvent.press(areaSheet(tree).getByText('South Pad')); });
    await waitFor(() => expect(tree.queryByText('Change Area')).toBeNull(), COLD);
    // The task now sits under South Pad on the page (its card's own line says so).
    await waitFor(() => expect(tree.getByText('Lot 9 • South Pad')).toBeTruthy(), COLD);
    expect(tree.queryByText('Lot 9 • North Pad')).toBeNull();
    tree.unmount();
  });

  it('on the Tasks tab, as before: Change lists Lot 9\'s areas, not Main St\'s', async () => {
    act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(within(tree.getByTestId('app-bottom-tabs')).getByLabelText('Tasks')); });
    await act(async () => { fireEvent.press(await tree.findByLabelText('Tasks: 2. Show all open tasks', {}, COLD)); });
    await openAreaSheetForGradePad(tree);
    expect(offeredAreas(tree)).toEqual(['Unassigned / Unknown Area', 'North Pad', 'South Pad']);
    tree.unmount();
  });
});
