/**
 * Whole-app audit A2 pass 2 M1 (30 Sep 2026): the saved-updates loader ran a
 * second time when the workspace opened. That pass re-read the phone's
 * storage, waited for the deletion-journal replay (one queue rewrite per old
 * archive), then replaced the whole list with its snapshot, so an archive
 * made in the first seconds was undone and the 750 ms save wrote the old list
 * back. The window grew with every archive ever made. (Adapted from the
 * reviewer's proof: NativeRoot, storage slowed to 3 ms per operation.)
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Dimensions } from 'react-native';
import { NativeRoot } from '../entry';
import { getCurrentSessionUser, listProjectUpdates } from '../services/SupabaseService';

jest.mock('@react-native-async-storage/async-storage', () => {
  // One operation at a time, each taking `delayMs`, like the native module.
  const run = <T,>(work: () => T): Promise<T> => {
    const next = mockStorage.tail.then(() => new Promise<T>(resolve => {
      setTimeout(() => resolve(work()), mockStorage.delayMs);
    }));
    mockStorage.tail = next.then(() => undefined, () => undefined);
    return next;
  };
  const write = (key: string, value: string) => {
    const targetArchived = key === 'projectPhotoUpdates.v2'
      ? (JSON.parse(value) as Array<{ id: string; isArchived?: boolean }>)
        .find(update => update.id === 'update-to-archive')?.isArchived === true
      : undefined;
    mockStorage.writes.push({ key, bytes: value.length, at: Date.now(), targetArchived });
    mockStorage.values.set(key, value);
  };
  return {
    getItem: (key: string) => run(() => mockStorage.values.get(key) ?? null),
    setItem: (key: string, value: string) => run(() => write(key, value)),
    removeItem: (key: string) => run(() => { mockStorage.values.delete(key); }),
    getAllKeys: () => run(() => [...mockStorage.values.keys()]),
    multiGet: (keys: string[]) => run(() => keys.map(key => [key, mockStorage.values.get(key) ?? null])),
    multiSet: (entries: [string, string][]) => run(() => entries.forEach(([key, value]) => write(key, value))),
    multiRemove: (keys: string[]) => run(() => keys.forEach(key => mockStorage.values.delete(key))),
    clear: () => run(() => mockStorage.values.clear()),
  };
});
const mockStorage = {
  values: new Map<string, string>(),
  writes: [] as { key: string; bytes: number; at: number; targetArchived?: boolean }[],
  delayMs: 0,
  tail: Promise.resolve() as Promise<void>,
};

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
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 0, longitude: 0, accuracy: 5 } })),
  Accuracy: { Balanced: 3, High: 4 },
}));
jest.mock('expo-mail-composer', () => ({
  isAvailableAsync: jest.fn(async () => false),
  composeAsync: jest.fn(async () => ({ status: 'cancelled' })),
  MailComposerStatus: { SENT: 'sent', CANCELLED: 'cancelled', SAVED: 'saved', UNDETERMINED: 'undetermined' },
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
// No cloud: the cloud read fails, as offline or signed out.
jest.mock('../services/SupabaseService', () => {
  const actual = jest.requireActual('../services/SupabaseService');
  const none = async () => [];
  const nothing = async () => null;
  return {
    ...actual,
    isSupabaseConfigured: jest.fn(() => false),
    getSupabaseClient: jest.fn(() => null),
    getCurrentSessionUser: jest.fn(),
    getCurrentUser: jest.fn(async () => ({ ok: true, data: { id: 'owner-m1' } })),
    getCurrentSessionAccessToken: jest.fn(async () => null),
    subscribeToAuthStateChange: jest.fn(() => () => undefined),
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

jest.setTimeout(240_000);
const COLD = { timeout: 90_000 } as const;
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 } as const;
const OWNER = 'owner-m1';
const UPDATES = 'projectPhotoUpdates.v2';
const DELETED_UPDATES = 'projectPhotoUpdate.deletedUpdates.v1';
const QUEUE = 'projectVisionAI.syncQueue.v1';
const TARGET = 'update-to-archive';
const originalError = console.error;
beforeAll(() => { console.error = () => undefined; });
afterAll(() => { console.error = originalError; });

function sentUpdate(id: string, projectName: string, archivedAt: string | null) {
  return {
    id, projectName, date: archivedAt ? '2026-08-28T15:00:00.000Z' : '2026-09-29T15:00:00.000Z', notes: 'Slab poured', status: 'sent',
    photos: [], isArchived: Boolean(archivedAt), archivedAt,
  };
}

function seedPhone(archivedCount: number) {
  mockStorage.values.clear();
  mockStorage.writes.length = 0;
  const archived = Array.from({ length: archivedCount }, (_, index) =>
    sentUpdate(`old-${index}`, 'Tower A', `2026-09-${String(1 + (index % 20)).padStart(2, '0')}T12:00:00.000Z`));
  mockStorage.values.set('@vitruvius/owner-storage-sandbox/metadata/v1', JSON.stringify({
    version: 1, activeOwnerId: OWNER, legacyAssignedOwnerId: null, lastOwnerId: OWNER,
    updatedAt: '2026-09-29T17:00:00.000Z',
  }));
  mockStorage.values.set('projectPhotoUpdate.projects.v2', JSON.stringify(['Tower A', 'Target Project']));
  mockStorage.values.set(UPDATES, JSON.stringify([...archived, sentUpdate(TARGET, 'Target Project', null)]));
  mockStorage.values.set(DELETED_UPDATES, JSON.stringify(archived.map(update => ({
    updateId: update.id, localId: update.id, cloudIdPresent: true, lifecycleStatus: 'sent',
    pendingSync: false, tombstoned: true, deletedAt: update.archivedAt, sourceAfterReload: 'local',
    mergeDecision: 'tombstoned', orphanedPhotoCountIgnored: 0, action: 'archive_sent_update',
  }))));
}

const storedTarget = () => (JSON.parse(mockStorage.values.get(UPDATES) || '[]') as Array<{ id: string; isArchived?: boolean }>)
  .find(update => update.id === TARGET);
const queueWrites = (from: number, to = Infinity) => mockStorage.writes
  .filter(write => write.key.startsWith(QUEUE) && write.at >= from && write.at < to);

/** Waits (rendering normally, outside act) until nothing is written for `quietMs`. */
async function settle(quietMs = 2_500) {
  await waitFor(() => {
    const last = mockStorage.writes[mockStorage.writes.length - 1]?.at ?? 0;
    if (Date.now() - last < quietMs) throw new Error('the phone is still writing');
  }, { timeout: 120_000, interval: 250 });
}

describe('a change made just after the workspace opens is kept (audit A2 pass 2 M1)', () => {
  beforeEach(() => {
    jest.mocked(getCurrentSessionUser).mockResolvedValue({ ok: true, data: { id: OWNER } } as never);
    jest.mocked(listProjectUpdates).mockImplementation(async () => [] as never);
    act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
  });
  afterEach(() => { mockStorage.delayMs = 0; jest.restoreAllMocks(); });

  it.each([0, 40, 100])('with %i earlier archives, an archive tapped at once survives the second startup pass', async archivedCount => {
    seedPhone(archivedCount);
    mockStorage.delayMs = 3;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const archive = buttons?.find(button => button.text === 'Archive');
      archive?.onPress?.();
    });
    const started = Date.now();
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByText('View all activity')).toBeTruthy(), COLD);
    const opened = Date.now();

    await act(async () => { fireEvent.press(tree.getByText('View all activity')); });
    const moreOptions = await tree.findByLabelText('More options for Target Project update', {}, COLD);
    await act(async () => { fireEvent.press(moreOptions); });
    await act(async () => { fireEvent.press(tree.getByText('Archive cloud-synced update')); });
    const tapped = Date.now();
    await settle();
    const updateWrites = mockStorage.writes.filter(write => write.key === UPDATES);
    const saved = updateWrites.find(write => write.targetArchived === true)?.at;
    const undone = updateWrites.find(write => saved !== undefined && write.at > saved && write.targetArchived === false)?.at;

    const row = {
      archived: archivedCount,
      openedMs: opened - started,
      queueWritesBeforeOpen: queueWrites(0, opened).length,
      queueWritesAfterOpen: queueWrites(opened).length,
      queueMBAfterOpen: +(queueWrites(opened).reduce((sum, write) => sum + write.bytes, 0) / 1e6).toFixed(2),
      tappedMs: tapped - started,
      savedMs: saved === undefined ? 'never' : saved - started,
      undoneMs: undone === undefined ? null : undone - started,
      keptArchived: storedTarget()?.isArchived === true,
    };
    process.stdout.write(`M1 ${JSON.stringify(row)}\n`);

    expect(storedTarget()?.isArchived).toBe(true);
    // However many archives the phone made before, the journal replay
    // rewrites the queue at most once, before opening, and after opening only
    // this archive does. (Each rewrite is five storage writes with its
    // recovery journal; before, about five rewrites per old archive, twice.)
    expect(queueWrites(0, opened).filter(write => write.key === QUEUE).length).toBeLessThanOrEqual(1);
    expect(queueWrites(opened).filter(write => write.key === QUEUE)).toHaveLength(1);
    const queued = JSON.parse(mockStorage.values.get(QUEUE) || '[]') as Array<{ id: string }>;
    expect(new Set(queued.map(item => item.id)).size).toBe(queued.length);
    tree.unmount();
  });

  it('a project added at once survives the second startup pass (same loader shape)', async () => {
    seedPhone(40);
    mockStorage.delayMs = 3;
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByText('Add project')).toBeTruthy(), COLD);
    await act(async () => { fireEvent.press(tree.getByText('Add project')); });
    await act(async () => { fireEvent.changeText(tree.getByPlaceholderText('New project name'), 'Pier 7'); });
    await act(async () => { fireEvent.press(tree.getByText('Create Project')); });
    await settle();
    const stored = JSON.parse(mockStorage.values.get('projectPhotoUpdate.projects.v2') || '[]') as Array<string | { name: string }>;
    process.stdout.write(`M1-projects ${JSON.stringify(stored.map(item => typeof item === 'string' ? item : item.name))}\n`);
    expect(stored.map(item => typeof item === 'string' ? item : item.name)).toContain('Pier 7');
    tree.unmount();
  });
});

// Whole-app audit A2 pass 3 L2 (30 Sep 2026): before the workspace opened,
// the replay re-recorded every "Delete Update" ever made in the deletion
// journal, one verified journal rewrite each, even when the cloud had long
// confirmed it (reviewer: 300 confirmed deletes, 4.35 s to open, 300 journal
// writes, 12.9 MB). A confirmed delete is now skipped from one journal read.
describe('old confirmed deletes do not slow the workspace opening (audit A2 pass 3 L2)', () => {
  const JOURNAL = 'projectPhotoUpdate.deletionJournal.v1';
  beforeEach(() => {
    jest.mocked(getCurrentSessionUser).mockResolvedValue({ ok: true, data: { id: OWNER } } as never);
    jest.mocked(listProjectUpdates).mockImplementation(async () => [] as never);
    act(() => { Dimensions.set({ window: PHONE, screen: PHONE }); });
  });
  afterEach(() => { mockStorage.delayMs = 0; });

  it.each([0, 100, 300])('with %i confirmed deletes, opening rewrites neither the journal nor the queue', async deletedCount => {
    seedPhone(0);
    const at = (index: number) => `2026-09-${String(1 + (index % 20)).padStart(2, '0')}T12:00:00.000Z`;
    const deleted = Array.from({ length: deletedCount }, (_, index) => `deleted-${index}`);
    mockStorage.values.set(DELETED_UPDATES, JSON.stringify(deleted.map((updateId, index) => ({
      updateId, localId: updateId, cloudIdPresent: true, lifecycleStatus: 'sent', pendingSync: false,
      tombstoned: true, deletedAt: at(index), sourceAfterReload: 'local', mergeDecision: 'tombstoned',
      orphanedPhotoCountIgnored: 0, action: 'delete_update_everywhere',
    }))));
    mockStorage.values.set(JOURNAL, JSON.stringify(deleted.map((updateId, index) => ({
      updateId, projectName: 'Tower A', requestedAt: at(index), cloudDeleteConfirmedAt: at(index),
    }))));
    mockStorage.delayMs = 3;
    const started = Date.now();
    const tree = render(<NativeRoot />);
    await waitFor(() => expect(tree.getByText('View all activity')).toBeTruthy(), COLD);
    const opened = Date.now();
    const journalWrites = mockStorage.writes.filter(write => write.key === JOURNAL && write.at < opened);
    process.stdout.write(`L2 ${JSON.stringify({
      confirmedDeletes: deletedCount,
      openedMs: opened - started,
      journalWritesBeforeOpen: journalWrites.length,
      journalMBBeforeOpen: +(journalWrites.reduce((sum, write) => sum + write.bytes, 0) / 1e6).toFixed(2),
      queueWritesBeforeOpen: queueWrites(0, opened).length,
    })}\n`);
    expect(journalWrites).toHaveLength(0);
    expect(queueWrites(0, opened)).toHaveLength(0);
    tree.unmount();
  });
});
