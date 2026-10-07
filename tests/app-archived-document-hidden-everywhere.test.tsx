/**
 * Owner answer Q44 (6 Oct 2026): "Archive" for a compliance document means
 * hidden on every device, kept in the cloud. These are the four cases of
 * tests/app-archived-document-shared-copy.test.tsx turned round: the same
 * screens of the real app, in the state AFTER the owner has pasted the
 * database change. (That file stays as it is: it is the state BEFORE the
 * paste, where archiving must behave exactly as it always has.)
 *
 * The cloud here is a stand-in for its shared-document table with the new
 * column. The app shell in these tests has no cloud connection of its own
 * (as in every test that opens the real app), so the moment "the device
 * reaches the cloud" is made by the test, through the same service call the
 * app makes each time it reads the document list; the app's own timing of
 * that call is tested in tests/hooks/owner-answer-q44-shared-document-archive-hook.test.tsx.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import { sharedDocumentArchiveSettled, sharedDocumentArchiveView, syncSharedDocumentArchiveWithCloud } from '../services/SharedDocumentArchive';
import { createSharedDocumentCloud, type SharedDocumentCloud } from './fixtures/shared-document-cloud';
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


// The service keeps one copy per account for as long as the app runs, so each
// case is its own account.
let account = 0;
let ownerId = 'owner-q44-0';
let cloud: SharedDocumentCloud;
beforeEach(() => {
  account += 1;
  ownerId = `owner-q44-${account}`;
  session.mockResolvedValue({ ok: true, data: { id: ownerId } } as never);
  cloud = createSharedDocumentCloud({ installed: true });
  cloud.state.signedInOwnerId = ownerId;
  cloud.add('doc-permit', ownerId, { name: 'Grading permit', category: 'Permit Card' });
  cloud.paste();
});

/** The device reaches the cloud: what waits is sent, and the archived marks are read. */
async function reachTheCloud() {
  await act(async () => {
    await syncSharedDocumentArchiveWithCloud({ client: cloud.client, ownerId });
    await sharedDocumentArchiveSettled();
  });
}

describe('an archived compliance document once the cloud keeps the mark (owner answer Q44)', () => {
  it('the phone that archives it: the question says every device, the cloud is told, nothing is deleted, and Restore brings it back', async () => {
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(PROJECTS));
    await AsyncStorage.setItem(CARDS, JSON.stringify([permitCard]));
    await AsyncStorage.setItem(SHARED, JSON.stringify([sharedCopy]));
    const cloudRowBefore = { ...cloud.row('doc-permit') };
    const tree = await launch();
    await openLot9Documents(tree);
    await reachTheCloud();
    expect(tree.getByText('Grading permit.pdf')).toBeTruthy();
    expect(tree.queryByText(/^Archived \(/)).toBeNull();

    await press(tree, tree.getByText('Edit'));
    await press(tree, await tree.findByText('Delete', {}, COLD));
    const asked = alerts.find(item => item.title === 'Archive compliance-sensitive document?');
    expect(asked?.message).toBe('Grading permit.pdf is categorized as Permit Card. It will be hidden on all your devices and kept in the cloud. You can bring it back under Archived in this project\'s Documents.');
    expect(asked?.buttons.map(button => button.text)).toEqual(['Cancel', 'Archive Permit Card']);
    await answerAlert('Archive compliance-sensitive document?', 'Archive Permit Card');

    // Gone from the list here at once, and counted under Archived.
    await waitFor(() => expect(tree.queryByText('Grading permit.pdf')).toBeNull(), COLD);
    expect(tree.queryByText('Grading permit')).toBeNull();
    await waitFor(() => expect(tree.queryAllByText('Archived (1)').length).toBe(1), COLD);
    await waitFor(async () => {
      expect(await stored<{ id: string; isArchived?: boolean }>(CARDS)).toEqual([
        expect.objectContaining({ id: 'doc-permit', isArchived: true }),
      ]);
    }, COLD);

    // It waits to be told to the cloud; nothing else is sent, removed or recorded as deleted.
    await waitFor(() => expect([...sharedDocumentArchiveView().waitingIds]).toEqual(['doc-permit']), COLD);
    expect(await stored<ReferenceDocument>(SHARED)).toEqual([expect.objectContaining({ id: 'doc-permit', name: 'Grading permit', updatedAt: sharedCopy.updatedAt })]);
    expect(await AsyncStorage.getItem('@dave/sync-tombstones/v1')).not.toContain('doc-permit');
    expect((await getOfflineQueue()).filter(item => JSON.stringify(item).includes('doc-permit'))).toEqual([]);

    // The cloud is reached: the mark is set, and the row is otherwise word for word what it was.
    await reachTheCloud();
    expect(cloud.row('doc-permit')).toEqual({ ...cloudRowBefore, archived_at: expect.any(String) });
    expect(sharedDocumentArchiveView().waitingIds.size).toBe(0);
    expect(cloud.requests.filter(request => request.kind === 'write_record')).toEqual([]);

    // Archived (1): there it is, with where it is hidden, and Restore.
    await press(tree, tree.getByText('Archived (1)'));
    expect(tree.getByText('Grading permit.pdf')).toBeTruthy();
    expect(tree.getByText('Permit Card · Archived')).toBeTruthy();
    expect(tree.getByText('Hidden on all your devices. Kept in the cloud.')).toBeTruthy();
    await press(tree, tree.getByLabelText('Restore Grading permit.pdf'));

    // Back in the list here at once; the cloud's mark is emptied when it is reached.
    await waitFor(() => expect(tree.queryByText(/^Archived \(/)).toBeNull(), COLD);
    expect(tree.getByText('Grading permit.pdf')).toBeTruthy();
    await waitFor(async () => {
      expect(await stored<{ id: string; isArchived?: boolean }>(CARDS)).toEqual([
        expect.objectContaining({ id: 'doc-permit', isArchived: false }),
      ]);
    }, COLD);
    await reachTheCloud();
    expect(cloud.row('doc-permit')).toEqual({ ...cloudRowBefore, archived_at: null });
    tree.unmount();
  });

  it.each([
    ['an iPad', WIDE, 'app-rail-brand'],
    ['another phone, or this phone after a reinstall', PHONE, 'app-bottom-tabs'],
  ] as const)('%s, holding only what the cloud shares: the archived document is not listed, and Restore there brings it back everywhere', async (_device, window, shell) => {
    act(() => { Dimensions.set({ window, screen: window }); });
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(PROJECTS));
    await AsyncStorage.setItem(SHARED, JSON.stringify([sharedCopy]));
    cloud.row('doc-permit')!.archived_at = '2026-10-06T18:00:00.000Z'; // archived on the phone
    const tree = await launch(shell);
    await openLot9Documents(tree);
    await reachTheCloud();

    // Not listed; nothing offers to download it.
    await waitFor(() => expect(tree.queryAllByText('Grading permit').length).toBe(0), COLD);
    expect(tree.queryAllByText(/^Permit Card · /).length).toBe(0);
    expect(tree.queryAllByText('Download & Open').length).toBe(0);

    // Archived (1) opens it, and Restore puts it back here at once.
    await press(tree, tree.getByText('Archived (1)'));
    expect(tree.getByText('Grading permit')).toBeTruthy();
    expect(tree.getByText('Hidden on all your devices. Kept in the cloud.')).toBeTruthy();
    await press(tree, tree.getByLabelText('Restore Grading permit'));
    await waitFor(() => expect(tree.queryByText(/^Archived \(/)).toBeNull(), COLD);
    expect(tree.getAllByText('Grading permit').length).toBeGreaterThan(0);
    expect(tree.getAllByText('Download & Open').length).toBeGreaterThan(0);

    // The cloud is told: the mark is emptied, so every other device lists it again.
    await reachTheCloud();
    expect(cloud.row('doc-permit')?.archived_at).toBeNull();
    expect(cloud.requests.filter(request => request.kind === 'write_record')).toEqual([]);
    tree.unmount();
  });

  it('archived with no signal: hidden here, said to be waiting, and it arrives when the phone is back online', async () => {
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(PROJECTS));
    await AsyncStorage.setItem(CARDS, JSON.stringify([permitCard]));
    await AsyncStorage.setItem(SHARED, JSON.stringify([sharedCopy]));
    const tree = await launch();
    await openLot9Documents(tree);
    await reachTheCloud();
    cloud.state.offline = true;

    await press(tree, tree.getByText('Edit'));
    await press(tree, await tree.findByText('Delete', {}, COLD));
    await answerAlert('Archive compliance-sensitive document?', 'Archive Permit Card');
    await waitFor(() => expect(tree.queryAllByText('Archived (1)').length).toBe(1), COLD);
    await reachTheCloud(); // tried, with no signal
    expect(cloud.row('doc-permit')?.archived_at).toBeNull();
    await press(tree, tree.getByText('Archived (1)'));
    expect(tree.getByText('Hidden on this device. Your other devices follow when this one is back online.')).toBeTruthy();

    cloud.state.offline = false;
    await reachTheCloud();
    expect(cloud.row('doc-permit')?.archived_at).toEqual(expect.any(String));
    await waitFor(() => expect(tree.queryAllByText('Hidden on all your devices. Kept in the cloud.').length).toBe(1), COLD);
    tree.unmount();
  });
});

// ---- Review of D1 (independent review P5, pass 1): the reviewer's real-app cases, brought in as each is fixed ----
const UPDATES = 'projectPhotoUpdates.v2';
const DRAFT = 'projectPhotoUpdate.activeDraft.v2';

/** The project's own row: with a saved update on the phone "Lot 9" is on the update's card too, so each is tried. */
async function openLot9DocumentsPastUpdateCards(tree: ReturnType<typeof render>) {
  const named = await tree.findAllByText('Lot 9', {}, COLD);
  for (const candidate of named) {
    if (tree.queryByLabelText('Open project options')) break;
    await press(tree, candidate);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  }
  await press(tree, await tree.findByLabelText('Open project options', {}, COLD));
  const rows = await tree.findAllByText('Documents', {}, COLD);
  await press(tree, rows[rows.length - 1]);
  await waitFor(() => expect(tree.getAllByText('Project Documents').length).toBeGreaterThan(0), COLD);
}

describe('review of D1, M1: an archive removes nothing from any record', () => {
  it('Archive, then Restore: the field update the document was attached to lists it throughout, and so does the unsent draft', async () => {
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', JSON.stringify(PROJECTS));
    await AsyncStorage.setItem(CARDS, JSON.stringify([permitCard]));
    await AsyncStorage.setItem(SHARED, JSON.stringify([sharedCopy]));
    await AsyncStorage.setItem(UPDATES, JSON.stringify([{
      id: 'update-with-permit', projectName: 'Lot 9', date: '2026-10-05T17:00:00.000Z', notes: 'Permit posted at the gate', status: 'sent',
      photos: [], isArchived: false, archivedAt: null, documents: [permitCard],
    }]));
    await AsyncStorage.setItem(DRAFT, JSON.stringify({
      savedAt: '2026-10-06T09:00:00.000Z',
      draft: {
        id: 'draft-with-permit', projectName: 'Lot 9', date: '2026-10-06T09:00:00.000Z', notes: 'Inspector asked to see the permit',
        status: 'draft', photos: [], isArchived: false, archivedAt: null, documents: [permitCard],
      },
    }));
    const attachedTo = async (updateId: string) => (await stored<{ id: string; documents?: Array<{ id: string }> }>(UPDATES))
      .find(update => update.id === updateId)?.documents?.map(document => document.id) ?? null;
    const onTheDraft = async () => (JSON.parse((await AsyncStorage.getItem(DRAFT)) || '{}') as { draft?: { documents?: Array<{ id: string }> } })
      .draft?.documents?.map(document => document.id) ?? null;
    const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 1500)); }); // the draft is saved 750 ms after a change

    const tree = await launch();
    await openLot9DocumentsPastUpdateCards(tree);
    await reachTheCloud();
    expect(await attachedTo('update-with-permit')).toEqual(['doc-permit']);
    expect(await onTheDraft()).toEqual(['doc-permit']);

    await press(tree, tree.getByText('Edit'));
    await press(tree, await tree.findByText('Delete', {}, COLD));
    const asked = alerts.find(item => item.title === 'Archive compliance-sensitive document?');
    expect(asked?.message).toContain('You can bring it back under Archived in this project\'s Documents.');
    await answerAlert('Archive compliance-sensitive document?', 'Archive Permit Card');
    await waitFor(() => expect(tree.queryAllByText('Archived (1)').length).toBe(1), COLD);
    await reachTheCloud();
    await settle();

    // Archived: hidden from the project's Documents, and still on the update and the draft it was attached to.
    expect(tree.queryByText('Grading permit.pdf')).toBeNull();
    expect(await attachedTo('update-with-permit')).toEqual(['doc-permit']);
    expect(await onTheDraft()).toEqual(['doc-permit']);
    // Nothing about the update is sent because of the archive.
    expect((await getOfflineQueue()).filter(item => JSON.stringify(item).includes('update-with-permit'))).toEqual([]);

    // He brings it back: it is where it was, everywhere it was.
    await press(tree, tree.getByText('Archived (1)'));
    await press(tree, tree.getByLabelText('Restore Grading permit.pdf'));
    await waitFor(() => expect(tree.queryByText(/^Archived \(/)).toBeNull(), COLD);
    await reachTheCloud();
    await settle();
    expect(tree.getByText('Grading permit.pdf')).toBeTruthy();
    expect(await attachedTo('update-with-permit')).toEqual(['doc-permit']);
    expect(await onTheDraft()).toEqual(['doc-permit']);
    expect((await getOfflineQueue()).filter(item => JSON.stringify(item).includes('update-with-permit'))).toEqual([]);
    tree.unmount();
  });
});
