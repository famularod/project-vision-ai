/**
 * P1 part B (6 Oct 2026): three places where the phone or iPad said nothing,
 * or something untrue, about GPS or the work area. Each is opened here in
 * the real app, as the manager reaches it.
 *
 * 1. After he deletes the area his open update was in, the Current Area card
 *    said "Why: This is your current confirmed selection." under "Unassigned
 *    / Unknown Area". Nothing had been selected.
 * 2. "The home screen shows the project picker with no reason when Precise
 *    Location is off." It does not, in this build: nothing on the home
 *    screen opens the picker at all. Pinned here, not changed (see the
 *    notes for the decision this leaves).
 * 3. An unfinished update with no GPS said why on the day (location not
 *    allowed, Precise Location off, no fix), but after the app was closed
 *    and opened again the resumed update said nothing about it.
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
// Location, as each test sets it (mockLocation): allowed or not, precise or
// approximate, and whether a fix can be taken.
const mockLocation: { granted: boolean; precise: boolean; failsWith: string | null } =
  { granted: false, precise: true, failsWith: null };
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: mockLocation.granted ? 'granted' : 'denied',
    granted: mockLocation.granted,
    ios: { accuracy: mockLocation.precise ? 'full' : 'reduced' },
  })),
  getForegroundPermissionsAsync: jest.fn(async () => ({
    status: mockLocation.granted ? 'granted' : 'denied',
    granted: mockLocation.granted,
  })),
  getCurrentPositionAsync: jest.fn(async () => {
    if (mockLocation.failsWith) throw new Error(mockLocation.failsWith);
    // An approximate fix is good to a kilometre or more.
    return { coords: { latitude: 37.5, longitude: -122.2, accuracy: mockLocation.precise ? 5 : 2400 } };
  }),
  Accuracy: { Balanced: 3, High: 4, Highest: 5 },
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

type AlertButton = { text?: string; style?: string; onPress?: () => void };
type ShownAlert = { title: string; message: string; buttons: AlertButton[] };
let alerts: ShownAlert[] = [];

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
  session.mockResolvedValue({ ok: true, data: { id: 'owner-p1-gps' } } as never);
  mockLocation.granted = false;
  mockLocation.precise = true;
  mockLocation.failsWith = null;
  alerts = [];
  const { Alert } = require('react-native');
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const [title, message, buttons] = args as [string, string, AlertButton[] | undefined];
    alerts.push({ title, message: message || '', buttons: buttons || [] });
  });
  await AsyncStorage.clear();
  act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
});
afterEach(() => { jest.restoreAllMocks(); });

const area = (id: string, name: string, projectName: string, withPoint = false) => ({
  id, name, projectName, latitude: withPoint ? 37.5 : 0, longitude: withPoint ? -122.2 : 0, radiusFeet: 150,
  locationCapturedAt: withPoint ? '2026-10-01T15:00:00.000Z' : null,
  locationAccuracyMeters: withPoint ? 5 : null,
  locationAccuracyCapturedAt: withPoint ? '2026-10-01T15:00:00.000Z' : null,
});

/** An unfinished update as the phone stores it: a note typed, no photo, no GPS. */
function storedDraft(fields: Record<string, unknown>) {
  return JSON.stringify({
    savedAt: '2026-10-06T16:00:00.000Z',
    draft: {
      id: 'draft-p1', projectName: 'Lot 9', date: '2026-10-06', photos: [], documents: [], notes: 'Pad graded to line.',
      recipients: { contactIds: [], manualEmails: [], manualPhones: [] },
      selectedAreaId: null, selectedAreaName: 'Unassigned / Unknown Area', areaStatus: 'unknown',
      status: 'draft', ...fields,
    },
  });
}

async function launch() {
  const tree = render(<NativeRoot />);
  await waitFor(() => expect(tree.getByTestId('app-bottom-tabs')).toBeTruthy(), COLD);
  return tree;
}

async function press(tree: ReturnType<typeof render>, target: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => { fireEvent.press(target); });
}

async function answerAlert(title: string, button: string) {
  const shown = alerts.find(item => item.title === title);
  if (!shown) throw new Error(`No "${title}" alert was shown. Shown: ${alerts.map(item => item.title).join(', ') || 'none'}`);
  const choice = shown.buttons.find(item => item.text === button);
  if (!choice?.onPress) throw new Error(`"${title}" has no "${button}" button.`);
  await act(async () => { choice.onPress?.(); });
}

describe('1. the Current Area card after the update\'s area is deleted', () => {
  it('says no area has been chosen, where it said "your current confirmed selection"', async () => {
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(['Lot 9', 'Main St']));
    await AsyncStorage.setItem('projectPhotoUpdate.projectAreas.v1', JSON.stringify([
      area('area-north', 'North Pad', 'Lot 9'), area('area-roof', 'Roof Deck', 'Main St'),
    ]));
    await AsyncStorage.setItem('projectPhotoUpdate.activeDraft.v2', storedDraft({
      selectedAreaId: 'area-north', selectedAreaName: 'North Pad', areaStatus: 'confirmed',
    }));
    const tree = await launch();

    // His update is in North Pad, which he picked: the line is true.
    await press(tree, await tree.findByText('Resume Draft', {}, COLD));
    await waitFor(() => expect(tree.getByText('Current Area')).toBeTruthy(), COLD);
    expect(tree.getAllByText('North Pad').length).toBeGreaterThan(0);
    expect(tree.getByText('Why: This is your current confirmed selection.')).toBeTruthy();

    // He deletes North Pad from the project's Locations & GPS.
    await press(tree, tree.getAllByLabelText('Overview')[0]);
    const lot9 = await tree.findAllByText('Lot 9', {}, COLD);
    await press(tree, lot9[lot9.length - 1]);
    await press(tree, await tree.findByText(/^Locations & GPS/, {}, COLD));
    await press(tree, await tree.findByText('North Pad', {}, COLD));
    await press(tree, await tree.findByText('Delete', {}, COLD));
    await answerAlert('Delete project area?', 'Delete');
    await waitFor(() => expect(tree.queryByText('North Pad')).toBeNull(), COLD);

    // Back in the update: no area, and no claim that he selected that.
    await press(tree, tree.getAllByLabelText('Overview')[0]);
    await press(tree, await tree.findByText('Resume Draft', {}, COLD));
    await waitFor(() => expect(tree.getByText('Current Area')).toBeTruthy(), COLD);
    expect(tree.getAllByText('Unassigned / Unknown Area').length).toBeGreaterThan(0);
    expect(tree.queryByText('Why: This is your current confirmed selection.')).toBeNull();
    expect(tree.getByText('Why: No area has been chosen for this update yet.')).toBeTruthy();
    tree.unmount();
  });
});

describe('2. the home screen and the project picker, with Precise Location off', () => {
  const WIDE = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const;
  const task = (id: string, taskName: string, projectName: string, locationName: string) => ({
    id, taskName, projectName, status: 'In Progress', percentComplete: 20, priority: 'Medium',
    startDate: '09/28/2026', finishDate: '10/30/2026', owner: '', contractor: '', locationName, notes: '',
  });

  beforeEach(async () => {
    // Two projects, each with a mapped area, so GPS has a choice to make; an
    // approximate fix (Precise Location off) cannot make it.
    mockLocation.granted = true;
    mockLocation.precise = false;
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(['Lot 9', 'Main St']));
    await AsyncStorage.setItem('projectPhotoUpdate.projectAreas.v1', JSON.stringify([
      area('area-north', 'North Pad', 'Lot 9', true), area('area-roof', 'Roof Deck', 'Main St', true),
    ]));
    await AsyncStorage.setItem('projectPhotoUpdate.scheduleItems.v1', JSON.stringify([
      task('task-lot9', 'Grade pad', 'Lot 9', 'North Pad'), task('task-main', 'Seal roof', 'Main St', 'Roof Deck'),
    ]));
  });

  /** One thing to tap for each different action on the screen. */
  function tapTargets(tree: ReturnType<typeof render>) {
    const actions = new Set<unknown>();
    const targets: Parameters<typeof fireEvent.press>[0][] = [];
    for (const node of tree.UNSAFE_root.findAll(candidate => typeof candidate.props?.onPress === 'function')) {
      if (actions.has(node.props.onPress)) continue;
      actions.add(node.props.onPress);
      const host = typeof node.type === 'string' ? node : node.findAll(child => typeof child.type === 'string')[0];
      if (host) targets.push(host);
    }
    return targets;
  }

  const pickerIsOpen = (tree: ReturnType<typeof render>) =>
    tree.queryByText('Select Project') !== null || tree.queryByText('Choose the job this update belongs to.') !== null;

  async function launchAt(window: typeof PHONE | typeof WIDE, shell: 'app-bottom-tabs' | 'app-rail-brand') {
    act(() => { Dimensions.set({ window, screen: window }); });
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByTestId(shell)).toBeTruthy(), COLD);
    // The home screen's GPS check has run, and could not choose.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    return tree;
  }

  it.each([
    ['a phone', PHONE, 'app-bottom-tabs'],
    ['an iPad', WIDE, 'app-rail-brand'],
  ] as const)('on %s, no single tap on the home screen opens the project picker', async (_device, window, shell) => {
    const first = await launchAt(window, shell);
    const count = tapTargets(first).length;
    expect(pickerIsOpen(first)).toBe(false);
    first.unmount();
    // Enough actions that this is the real home screen, not an empty shell.
    expect(count).toBeGreaterThan(12);

    const opened: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const tree = await launchAt(window, shell);
      const target = tapTargets(tree)[index];
      if (target) {
        await act(async () => { fireEvent.press(target); });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        if (pickerIsOpen(tree)) opened.push(index);
      }
      tree.unmount();
    }
    expect(opened).toEqual([]);
  });

  it('every place that starts a new update names its project, so the picker has nothing to open it', () => {
    // Read from App.tsx's structure. If a way to the picker is ever added
    // (a New Update with no project), this and the two cases above fail,
    // and the picker then needs its one sentence (notes, P1 part B item 2).
    const ts = jest.requireActual('typescript') as typeof import('typescript');
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const app = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
    const tree = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    type Node = import('typescript').Node;
    const find = <T extends Node>(start: Node, test: (node: Node) => node is T): T[] => {
      const found: T[] = [];
      const visit = (node: Node) => { if (test(node)) found.push(node); ts.forEachChild(node, visit); };
      visit(start);
      return found;
    };
    const callsOf = (start: Node, name: string) => find(start, (node): node is import('typescript').CallExpression =>
      ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name);
    const component = (name: string) => {
      const matches = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
      expect(matches).toHaveLength(1);
      return matches[0];
    };
    const namesAProject = (call: import('typescript').CallExpression) =>
      call.arguments.length === 1 && call.arguments[0].getText(tree) !== 'undefined';

    // The picker is opened in one place only: New Update with no project it is sure of.
    expect(app.split("setScreen('SelectProject')").length - 1).toBe(1);
    expect(app).toContain("openProjectPicker: () => setScreen('SelectProject'),");
    // The picker, as it is: a title and one line, no reason.
    expect(app).toContain('subtitle="Choose the job this update belongs to."');

    // New Update is called, or handed on, in exactly these places.
    const direct = callsOf(tree, 'createNewUpdate');
    expect(direct.map(call => call.getText(tree))).toEqual(['createNewUpdate(projectName)']);
    const handedOn = find(tree, (node): node is import('typescript').JsxAttribute =>
      ts.isJsxAttribute(node) &&
      Boolean(node.initializer) &&
      ts.isJsxExpression(node.initializer!) &&
      node.initializer!.expression?.getText(tree) === 'createNewUpdate')
      .map(attribute => `${attribute.parent.parent.tagName.getText(tree)}.${attribute.name.getText(tree)}`);
    expect(handedOn.sort()).toEqual(['HomeScreen.onNewUpdate', 'ProjectWorkspaceScreen.onNewFieldUpdate']);

    // The home screen and a project's page each call it with their project's name.
    const fromHome = callsOf(component('HomeScreen'), 'onNewUpdate');
    expect(fromHome.map(call => call.getText(tree))).toEqual(['onNewUpdate(liveAuthority.projectTruth.projectName)']);
    const fromProjectPage = callsOf(component('ProjectWorkspaceScreen'), 'onNewFieldUpdate');
    expect(fromProjectPage.map(call => call.getText(tree))).toEqual(['onNewFieldUpdate(projectName)']);
    expect([...direct, ...fromHome, ...fromProjectPage].every(namesAProject)).toBe(true);
  });
});

describe('3. an unfinished update resumed after the app was closed says why it has no GPS', () => {
  const DENIED = 'Location permission denied. Choose Project Area manually.';
  const FAILED = 'GPS could not be captured. Choose Project Area manually.';
  const PRECISE_OFF = /^Precise Location is off\. Vitruvius only gets an approximate location/;
  const UNCERTAIN = 'Location is uncertain. Choose the project area before relying on this recommendation.';

  beforeEach(async () => {
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(['Lot 9', 'Main St']));
    await AsyncStorage.setItem('projectPhotoUpdate.projectAreas.v1', JSON.stringify([
      area('area-north', 'North Pad', 'Lot 9', true), area('area-roof', 'Roof Deck', 'Main St'),
    ]));
  });

  /** Starts an update for Lot 9 from its page and returns once Add Photos shows. */
  async function startUpdateForLot9(tree: ReturnType<typeof render>) {
    const lot9 = await tree.findAllByText('Lot 9', {}, COLD);
    await press(tree, lot9[lot9.length - 1]);
    await press(tree, await tree.findByText('New Field Update', {}, COLD));
    await waitFor(() => expect(tree.getByText('Current Area')).toBeTruthy(), COLD);
  }

  /** Gives the update content (so the phone keeps it), lets the phone save it, and closes the app. */
  async function keepAndCloseApp(tree: ReturnType<typeof render>) {
    await press(tree, tree.getByText('Continue Without Photos'));
    await waitFor(async () => {
      expect(await AsyncStorage.getItem('projectPhotoUpdate.activeDraft.v2')).toContain('"continueWithoutPhotosAcknowledged":true');
    }, COLD);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    tree.unmount();
  }

  async function reopenAndResume() {
    const tree = await launch();
    await press(tree, await tree.findByText('Resume Draft', {}, COLD));
    await waitFor(() => expect(tree.getByText('Current Area')).toBeTruthy(), COLD);
    return tree;
  }

  it('location not allowed: the resumed update still says so', async () => {
    mockLocation.granted = false;
    const first = await launch();
    await startUpdateForLot9(first);
    await waitFor(() => expect(first.getByText(DENIED)).toBeTruthy(), COLD);
    await keepAndCloseApp(first);

    const again = await reopenAndResume();
    expect(again.getByText(DENIED)).toBeTruthy();
    expect(again.queryByText(UNCERTAIN)).toBeNull();
    again.unmount();
  });

  it('Precise Location off: the resumed update still says so', async () => {
    mockLocation.granted = true;
    mockLocation.precise = false;
    const first = await launch();
    await startUpdateForLot9(first);
    await waitFor(() => expect(first.getByText(PRECISE_OFF)).toBeTruthy(), COLD);
    await keepAndCloseApp(first);

    const again = await reopenAndResume();
    expect(again.getByText(PRECISE_OFF)).toBeTruthy();
    again.unmount();
  });

  it('no fix could be taken: the resumed update still says so', async () => {
    mockLocation.granted = true;
    mockLocation.failsWith = 'Location request timed out';
    const first = await launch();
    await startUpdateForLot9(first);
    await waitFor(() => expect(first.getByText(FAILED)).toBeTruthy(), COLD);
    await keepAndCloseApp(first);

    const again = await reopenAndResume();
    expect(again.getByText(FAILED)).toBeTruthy();
    again.unmount();
  });

  it('a fix that landed leaves no reason behind: the resumed update is offered its area as before', async () => {
    mockLocation.granted = true;
    const first = await launch();
    await startUpdateForLot9(first);
    await waitFor(() => expect(first.getByText('Accept Suggested Area: North Pad')).toBeTruthy(), COLD);
    await keepAndCloseApp(first);

    // Location is switched off afterwards: the resumed update keeps its own fix and says nothing of today's setting.
    mockLocation.granted = false;
    const again = await reopenAndResume();
    expect(again.getByText('Accept Suggested Area: North Pad')).toBeTruthy();
    expect(again.queryByText(DENIED)).toBeNull();
    expect(again.queryByText(FAILED)).toBeNull();
    again.unmount();
  });

  it('the reason belongs to its update: a new update started after it does not inherit it', async () => {
    mockLocation.granted = false;
    const first = await launch();
    await startUpdateForLot9(first);
    await waitFor(() => expect(first.getByText(DENIED)).toBeTruthy(), COLD);
    await keepAndCloseApp(first);

    // Location is allowed now. He opens the app and starts a new update instead of resuming.
    mockLocation.granted = true;
    const again = await launch();
    const lot9 = await again.findAllByText('Lot 9', {}, COLD);
    await press(again, lot9[lot9.length - 1]);
    await press(again, await again.findByText('New Field Update', {}, COLD));
    await answerAlert('Unfinished update found', 'Start New');
    await waitFor(() => expect(again.getByText('Accept Suggested Area: North Pad')).toBeTruthy(), COLD);
    expect(again.queryByText(DENIED)).toBeNull();
    again.unmount();
  });
});
