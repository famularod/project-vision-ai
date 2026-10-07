/**
 * P1 part C item 1 (6 Oct 2026), a closer look, tests only: "Archived
 * documents' shared copies stay visible on other devices."
 *
 * It is true today. A compliance-sensitive document (Permit Card,
 * Compliance, Contract, Inspection, Safety) cannot be deleted on the phone,
 * only archived. Archiving marks the phone's own card and nothing else: the
 * copy the phone shared when it uploaded the file (a shared document record
 * in the cloud) is not told. So the document goes from the phone that
 * archived it and stays listed everywhere the shared record is read: the
 * Documents screen of the iPad, of any other phone, and of the web; and of
 * this same phone once its own card is gone (a reinstall, a new phone).
 *
 * These cases pin what happens today, on the real screens. They change
 * nothing. The notes say what would close it.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import { groupDAVEWebDocuments } from '../services/DAVEWebDocumentManagement';
import { buildMobileDocumentWorkspace } from '../services/MobileDocumentWorkspace';
import { getOfflineQueue } from '../services/SyncService';
import type { ReferenceDocument } from '../types';
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

async function launch(shell: 'app-bottom-tabs' | 'app-rail-brand' = 'app-bottom-tabs') {
  const tree = render(<NativeRoot />);
  await waitFor(() => expect(tree.getByTestId(shell)).toBeTruthy(), COLD);
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


const WIDE = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const;

// The two projects as a synchronized device holds them, with their cloud ids.
const LOT_9 = '11111111-1111-4111-8111-111111111111';
const PROJECTS = [{ id: LOT_9, name: 'Lot 9' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Main St' }];

/** The phone's own card for an uploaded permit, and the copy it shared when the upload finished. */
const permitCard = {
  id: 'doc-permit', projectId: 'project-lot-9', name: 'Grading permit.pdf', category: 'Permit Card', mimeType: 'application/pdf',
  sizeBytes: 2048, localUri: null, referenceDocumentId: 'doc-permit', storagePath: 'owner-p1-gps/project-documents/doc-permit.pdf',
  uploadedAt: '2026-10-05T16:00:00.000Z', createdAt: '2026-10-05T15:59:00.000Z', updatedAt: '2026-10-05T16:00:00.000Z',
  note: '', status: 'uploaded', importedAt: '2026-10-05T15:59:00.000Z',
};
const sharedCopy: ReferenceDocument = {
  id: 'doc-permit', name: 'Grading permit', originalFileName: 'Grading permit.pdf', uri: '', mimeType: 'application/pdf',
  category: 'Permit Card', notes: '', isCurrent: false, importedAt: '2026-10-05T15:59:00.000Z', projectId: LOT_9,
  projectName: 'Lot 9', projectNames: ['Lot 9'], importBatchId: null, storagePath: 'owner-p1-gps/project-documents/doc-permit.pdf',
  sizeBytes: 2048, contentSha256: null, updatedAt: '2026-10-05T16:00:00.000Z',
};
const CARDS = 'projectPhotoUpdate.projectDocuments.v1';
const SHARED = 'projectPhotoUpdate.referenceDocumentMetadata.v2';
const stored = async <T,>(key: string): Promise<T[]> => JSON.parse((await AsyncStorage.getItem(key)) || '[]') as T[];

async function openLot9Documents(tree: ReturnType<typeof render>) {
  const lot9 = await tree.findAllByText('Lot 9', {}, COLD);
  await press(tree, lot9[lot9.length - 1]);
  await press(tree, await tree.findByLabelText('Open project options', {}, COLD));
  // The project's own "Documents" row (an iPad's side rail has a Documents entry too).
  const rows = await tree.findAllByText('Documents', {}, COLD);
  await press(tree, rows[rows.length - 1]);
  await waitFor(() => expect(tree.getAllByText('Project Documents').length).toBeGreaterThan(0), COLD);
}

describe('an archived compliance document and the copy it shared (as it is today)', () => {
  it('the phone that archives it: the card goes, and the shared copy is neither removed nor marked', async () => {
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(PROJECTS));
    await AsyncStorage.setItem(CARDS, JSON.stringify([permitCard]));
    await AsyncStorage.setItem(SHARED, JSON.stringify([sharedCopy]));
    const tree = await launch();
    await openLot9Documents(tree);
    expect(tree.getByText('Grading permit.pdf')).toBeTruthy();

    // A compliance document is not offered "Delete from All Devices": only Archive.
    await press(tree, tree.getByText('Edit'));
    await press(tree, await tree.findByText('Delete', {}, COLD));
    const asked = alerts.find(item => item.title === 'Archive compliance-sensitive document?');
    expect(asked?.message).toBe('Grading permit.pdf is categorized as Permit Card. It will be hidden from active project documents.');
    expect(asked?.buttons.map(button => button.text)).toEqual(['Cancel', 'Archive Permit Card']);
    await answerAlert('Archive compliance-sensitive document?', 'Archive Permit Card');

    // On this phone it is gone from the list, and its shared copy does not come back as a second card.
    await waitFor(() => expect(tree.queryByText('Grading permit.pdf')).toBeNull(), COLD);
    expect(tree.queryByText('Grading permit')).toBeNull();

    // The phone keeps its card, marked archived.
    await waitFor(async () => {
      expect(await stored<{ id: string; isArchived?: boolean }>(CARDS)).toEqual([
        expect.objectContaining({ id: 'doc-permit', isArchived: true }),
      ]);
    }, COLD);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });

    // The shared copy: still held, word for word as it was; no deletion recorded for it; nothing queued to tell the cloud.
    expect(await stored<ReferenceDocument>(SHARED)).toEqual([expect.objectContaining({
      id: 'doc-permit', name: 'Grading permit', updatedAt: sharedCopy.updatedAt,
    })]);
    expect(Object.keys((await stored<ReferenceDocument>(SHARED))[0]).filter(key => /archiv/i.test(key))).toEqual([]);
    expect(await AsyncStorage.getItem('@dave/sync-tombstones/v1')).not.toContain('doc-permit');
    expect((await getOfflineQueue()).filter(item => JSON.stringify(item).includes('doc-permit'))).toEqual([]);
    tree.unmount();
  });

  it.each([
    ['an iPad', WIDE, 'app-rail-brand'],
    ['another phone, or this phone after a reinstall', PHONE, 'app-bottom-tabs'],
  ] as const)('%s, holding only what the cloud shares: the archived document is listed, with Download & Open offered', async (_device, window, shell) => {
    // What a device that never had the card holds: the projects and the shared record.
    act(() => { Dimensions.set({ window, screen: window }); });
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(PROJECTS));
    await AsyncStorage.setItem(SHARED, JSON.stringify([sharedCopy]));
    const tree = await launch(shell);
    await openLot9Documents(tree);
    // (An iPad shows the list and the chosen document side by side, so each may appear twice.)
    expect(tree.getAllByText('Grading permit').length).toBeGreaterThan(0);
    expect(tree.getAllByText(/^Permit Card · /).length).toBeGreaterThan(0);
    expect(tree.getAllByText('Download & Open').length).toBeGreaterThan(0);
    tree.unmount();
  });

  it('the rule behind those two screens, and the web\'s Documents list', () => {
    const projects = { projectNames: ['Lot 9'], projectIdentities: PROJECTS };
    // The phone that archived it: nothing listed (its archived card answers for the shared copy).
    expect(buildMobileDocumentWorkspace({
      documents: [{ ...permitCard, isArchived: true }], referenceDocuments: [sharedCopy], ...projects,
    })).toEqual([]);
    // Any device without the card: listed as a shared document.
    expect(buildMobileDocumentWorkspace({ documents: [], referenceDocuments: [sharedCopy], ...projects }))
      .toEqual([expect.objectContaining({ id: 'reference:doc-permit', kind: 'reference', category: 'Permit Card', status: 'shared reference' })]);
    // The web lists every shared document it is given; it has nothing to tell an archived one by.
    const web = groupDAVEWebDocuments([sharedCopy as unknown as Parameters<typeof groupDAVEWebDocuments>[0][number]]);
    expect(web.otherDocuments.map(document => document.id)).toEqual(['doc-permit']);
  });
});
