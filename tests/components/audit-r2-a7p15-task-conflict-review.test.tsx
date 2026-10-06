/**
 * Whole-app audit A7 pass 15 L-3 (1 Oct 2026): Settings › Review Conflicts
 * never read a task's cloud copy again. After David set the task to 50% on
 * the web, the "Cloud:" line still said 0%, and Keep Phone put the phone's
 * copy over the 50%. Review Conflicts now reads tasks' cloud rows when it
 * opens, as it does field updates', and Keep Phone checks the row against
 * the copy the screen showed before sending anything.
 *
 * Renders the real AdminScreen with the real SyncService queue, upload and
 * conflict store; the cloud is a mocked task row (as
 * audit-a4-p15b-conflict-review-newer-edit.test.tsx does for field updates).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { ScheduleItem } from '../../types';

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStorage.get(key) ?? null])),
    multiSet: jest.fn(async (pairs: Array<[string, string]>) => { pairs.forEach(([key, value]) => mockStorage.set(key, value)); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
  };
  return { __esModule: true, default: api, ...api };
});
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: 'file:///phone/Documents/',
  cacheDirectory: 'file:///phone/Library/Caches/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));

/** The cloud's task rows, by id. */
const mockTasks = new Map<string, ScheduleItem>();
jest.mock('../../services/SupabaseService', () => {
  const ok = <T,>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
  const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  return {
    ...jest.requireActual('../../services/SupabaseService'),
    getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
    // What Settings reads (as in audit-a8-p2-admin-sync).
    getCurrentSessionAccessToken: jest.fn(async () => null),
    getSupabaseConnectionStatus: jest.fn(async () => ({
      configured: true, clientReady: true, authenticated: true, userEmail: 'owner@example.com',
    })),
    testSupabaseConnection: jest.fn(async () => ({ connected: true })),
    subscribeToAuthStateChange: () => () => undefined,
    readSavedSignIn: jest.fn(async () => null),
    verifyDAVEAppOwner: jest.fn(async () => ({ ok: true, data: true })),
    listProjects: jest.fn(async () => ok([{ id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5', name: '2321 Compliance Project' }])),
    listArchivedProjects: jest.fn(async () => ok([])),
    listDAVESyncTombstones: jest.fn(async () => ok([])),
    upsertDAVESyncTombstones: jest.fn(async (tombstones: unknown[]) => ok(tombstones)),
    // The cloud's copy of the task.
    listScheduleItems: jest.fn(async () => ok([...mockTasks.values()].map(copy))),
    getScheduleItem: jest.fn(async (id: string) => ok(mockTasks.has(id) ? copy(mockTasks.get(id)!) : null)),
    upsertScheduleItem: jest.fn(async (item: ScheduleItem) => {
      mockTasks.set(item.id, copy(item));
      return ok(item);
    }),
  };
});
jest.mock('../../services/DAVECloudMaintenanceBudget', () => ({
  ...jest.requireActual('../../services/DAVECloudMaintenanceBudget'),
  runDAVECloudMaintenanceIfDue: jest.fn(async () => ({ storageCleanupRemaining: 0, storageCleanupCompleted: 0, storageCleanupErrors: [] })),
}));

import { AdminScreen } from '../../screens/AdminScreen';
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import { getScheduleItem, upsertScheduleItem } from '../../services/SupabaseService';
import {
  clearResolvedConflict,
  getOfflineQueue,
  getSyncConflicts,
  queueScheduleItemRecord,
  runScheduleItemCloudSync,
  uploadPendingChanges,
} from '../../services/SyncService';

const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async () => { throw new Error('network disabled in test'); }) as never;
});
afterAll(() => { global.fetch = realFetch; });

const phoneTask: ScheduleItem = {
  id: 'task-a7p15-review',
  itemType: 'Task',
  projectName: '2321 Compliance Project',
  locationName: '2321 North Lot',
  taskName: 'Pour slab',
  startDate: '2026-10-03',
  finishDate: '2026-10-07',
  milestone: '',
  owner: '',
  contractor: '',
  percentComplete: 0,
  priority: 'Medium',
  status: 'Not Started',
  notes: 'Pump truck booked (typed on the phone with no signal)',
  nextAction: '',
  activity: [],
  importedFrom: 'master-n.csv',
  importBatchId: 'batch-n',
  createdAt: '2026-09-28T08:00:00.000Z',
  updatedAt: '2026-09-28T09:00:00.000Z',
};
const PHONE_LINE = `Phone: Not Started · 0% · 2321 North Lot · ${phoneTask.notes}`;
const CLOUD_0 = 'Cloud: Not Started · 0% · 2321 North Lot';
const CLOUD_50 = 'Cloud: In Progress · 50% · 2321 North Lot';
const inCloud = () => mockTasks.get(phoneTask.id)!;
const cloudLine = () => screen.getByText(/^Cloud: /).props.children.join('');

/** The phone's offline edit meets the web's newer copy: the conflict is saved with the cloud at 0%. */
async function offlineEditInConflictWithWeb() {
  mockTasks.set(phoneTask.id, { ...phoneTask, notes: '', updatedAt: '2026-09-29T12:00:00.000Z' });
  await runScheduleItemCloudSync(phoneTask);
  expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: phoneTask.id })]);
}
/** David sets the task to 50% on the web. */
function webEnters50() {
  mockTasks.set(phoneTask.id, { ...inCloud(), percentComplete: 50, status: 'In Progress', updatedAt: '2026-09-30T09:00:00.000Z' });
}

function renderSettings(onApplyCloudConflictScheduleItem = jest.fn()) {
  render(
    <AdminScreen
      localProjects={['2321 Compliance Project']}
      savedUpdates={[]}
      projectAreas={[]}
      scheduleItems={[phoneTask]}
      referenceDocuments={[]}
      displayName="David"
      onDisplayNameChange={jest.fn()}
      onBack={jest.fn()}
      onDiagnostics={jest.fn()}
      onBackup={jest.fn()}
      onRestore={jest.fn()}
      onAddArea={jest.fn(() => true)}
      onUpdateArea={jest.fn()}
      onDeleteArea={jest.fn()}
      onUseCurrentLocationForArea={jest.fn()}
      onRemoveMissingPhotos={jest.fn(async () => undefined)}
      onRetryUpdateSync={jest.fn(async () => ({ status: 'sent' }))}
      onRetryDocumentUploads={jest.fn(async () => ({ attempted: 0, uploaded: 0, remaining: 0 }))}
      failedDocumentCount={0}
      onApplyCloudConflictUpdate={jest.fn()}
      onApplyCloudConflictScheduleItem={onApplyCloudConflictScheduleItem}
      onApplyCloudRecovery={jest.fn()}
      onSaveCaptureMemory={jest.fn(async () => undefined)}
    />,
  );
  return onApplyCloudConflictScheduleItem;
}
async function openReviewConflicts() {
  fireEvent.press(await screen.findByText('Review Conflicts'));
  await screen.findByText('Review Cloud Conflicts');
}
/** The confirmation Keep Phone asks, and its button that goes ahead. */
function proceedWithLastConfirmation() {
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1) as
    [string, string, Array<{ text: string; onPress?: () => void }>];
  buttons.find(button => button.text !== 'Cancel')!.onPress!();
}

beforeEach(async () => {
  mockStorage.clear();
  mockTasks.clear();
  await clearResolvedConflict('none'); // the screens' copy of the saved conflicts starts empty too
  noteSignedInOwner('owner-a');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe('Review Conflicts shows a task\'s cloud copy as it is now (audit A7 pass 15 L-3)', () => {
  it('opened after the web set the task to 50%: the Cloud line shows the 50%', async () => {
    await offlineEditInConflictWithWeb();
    webEnters50();
    renderSettings();
    await openReviewConflicts();
    // It showed the copy saved with the conflict: `${CLOUD_0}`.
    await waitFor(() => expect(cloudLine()).toBe(CLOUD_50));
    expect(screen.getByText(/^Phone: /).props.children.join('')).toBe(PHONE_LINE);
  });

  it('the web sets 50% while the screen is open: Keep Phone sends nothing, says the cloud copy changed, and shows the 50%; chosen again, it goes ahead', async () => {
    await offlineEditInConflictWithWeb();
    const onApplyCloudConflictScheduleItem = renderSettings();
    await openReviewConflicts();
    await waitFor(() => expect(cloudLine()).toBe(CLOUD_0));
    webEnters50();

    fireEvent.press(screen.getByText('Keep Phone'));
    await act(async () => { proceedWithLastConfirmation(); });
    // It sent the phone's copy over the 50% and closed the review.
    await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith('Cloud copy changed', 'The cloud copy changed — review again. Nothing was sent.'));
    await waitFor(() => expect(cloudLine()).toBe(CLOUD_50));
    expect(inCloud()).toMatchObject({ percentComplete: 50, status: 'In Progress', notes: '' });
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(await getOfflineQueue()).toEqual([]);
    expect(onApplyCloudConflictScheduleItem).not.toHaveBeenCalled();
    expect(screen.getByText('Review Cloud Conflicts')).toBeTruthy();

    fireEvent.press(screen.getByText('Keep Phone'));
    await act(async () => { proceedWithLastConfirmation(); });
    await waitFor(() => expect(screen.queryByText('Review Cloud Conflicts')).toBeNull());
    expect(inCloud()).toMatchObject({ percentComplete: 0, notes: phoneTask.notes });
    expect(onApplyCloudConflictScheduleItem).toHaveBeenCalledWith(expect.objectContaining({ notes: phoneTask.notes }));
    expect(await getSyncConflicts()).toEqual([]);
  });
});

/**
 * Whole-app audit A7 pass 16 (1 Oct 2026), with a phone edit of the task on
 * its way up when David chooses:
 * - L-2: Keep Cloud put the screen's copy back over that edit, which had
 *   landed, and the cloud's answer was lost on weak signal. Settings said
 *   "Neither copy was changed" though the cloud held the restore.
 * - L-6: the edit landed while Keep Phone read the cloud, which closed the
 *   conflict. Settings said "The cloud copy changed — review again" over an
 *   empty list.
 */
describe('a task\'s conflict choice with a phone edit on its way up (audit A7 pass 16)', () => {
  const NEWER = 'Pump truck moved to Friday (a newer phone edit)';
  const ok = <T,>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
  const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

  /** Settings is open on the conflict; a newer phone note is on its way up, and lands as the choice first reads the row. */
  async function reviewWithPhoneEditOnItsWayUp() {
    await offlineEditInConflictWithWeb();
    const shownCloud = { ...inCloud() };
    const onApplyCloudConflictScheduleItem = renderSettings();
    await openReviewConflicts();
    await waitFor(() => expect(getScheduleItem).toHaveBeenCalledTimes(1)); // the open-time read
    await waitFor(() => expect(cloudLine()).toBe(CLOUD_0));
    let land!: () => void;
    const landing = new Promise<void>(resolve => { land = resolve; });
    let inFlight!: Promise<unknown>;
    await act(async () => {
      await queueScheduleItemRecord({ ...phoneTask, notes: NEWER, updatedAt: '2026-09-30T10:00:00.000Z' }, false, ['notes', 'updatedAt']);
      let sending!: () => void;
      const sent = new Promise<void>(resolve => { sending = resolve; });
      jest.mocked(upsertScheduleItem).mockImplementationOnce(async item => {
        sending();
        await landing;
        mockTasks.set(item.id, copy(item));
        return ok(item) as never;
      });
      inFlight = uploadPendingChanges();
      await sent;
    });
    jest.mocked(getScheduleItem).mockImplementationOnce(async id => {
      land();
      await inFlight;
      return ok(copy(mockTasks.get(id)!)) as never;
    });
    return { shownCloud, onApplyCloudConflictScheduleItem };
  }

  it('L-2: Keep Cloud\'s restore lands and its answer is lost: it says the change may or may not have been saved, not "Neither copy was changed"', async () => {
    const { shownCloud } = await reviewWithPhoneEditOnItsWayUp();
    jest.mocked(upsertScheduleItem).mockImplementationOnce(async item => {
      mockTasks.set(item.id, copy(item));
      return { ok: false, configured: true, stubbed: false, data: null, error: 'Network request failed' } as never;
    });

    fireEvent.press(screen.getByText('Keep Cloud'));
    await act(async () => { proceedWithLastConfirmation(); });
    await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith(
      'Conflict not resolved',
      'The cloud did not confirm the change, so it may or may not have been saved. The conflict is still open — check the cloud connection and choose again.',
    ));
    expect(inCloud()).toEqual(shownCloud); // the restore did land
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(await getOfflineQueue()).toEqual([]);
    await waitFor(() => expect(screen.getByText('Keep Cloud')).toBeTruthy());
  });

  it('L-6: the edit lands while Keep Phone reads the cloud: Settings says the conflict closed by itself, and nothing was sent', async () => {
    const { onApplyCloudConflictScheduleItem } = await reviewWithPhoneEditOnItsWayUp();

    fireEvent.press(screen.getByText('Keep Phone'));
    await act(async () => { proceedWithLastConfirmation(); });
    await screen.findByText('This task\'s conflict closed by itself (an edit from this phone reached the cloud), so nothing was sent.');
    await waitFor(() => expect(screen.queryByText('Review Cloud Conflicts')).toBeNull());
    expect(Alert.alert).not.toHaveBeenCalledWith('Cloud copy changed', expect.anything());
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(onApplyCloudConflictScheduleItem).not.toHaveBeenCalled();
    expect(await getSyncConflicts()).toEqual([]);
  });
});

/**
 * Sync batch Y1 (item 5): Review Conflicts' wording for a task.
 * (a) The "Phone:" line showed the copy saved with the conflict, not the newer edit Keep Phone would send, and Keep
 *     Cloud gave that edit up without saying so.
 * (b) A Keep Phone whose write landed with its answer lost said "Neither copy was changed".
 */
describe('a task in Review Conflicts: the phone\'s side is what Keep Phone sends, and a write that landed is not called unchanged (sync batch Y1, item 5)', () => {
  const NEWER = 'Pump truck moved to Friday (typed after the conflict was found)';
  const NEWER_LINE = `Phone: Not Started · 0% · 2321 North Lot · ${NEWER}`;
  const NOTE_LINE = 'Includes a change you made after the conflict was found.';
  const phoneLine = () => screen.getByText(/^Phone: /).props.children.join('');
  const lastConfirmation = () => (Alert.alert as jest.Mock).mock.calls.at(-1) as [string, string, unknown[]];

  it('a newer edit of his waits: the Phone line shows it and says so, Keep Cloud says it will be discarded too, and Keep Phone sends it', async () => {
    await offlineEditInConflictWithWeb();
    await queueScheduleItemRecord({ ...phoneTask, notes: NEWER, updatedAt: '2026-09-30T10:00:00.000Z' }, false, ['notes', 'updatedAt'], phoneTask);
    const onApplyCloudConflictScheduleItem = renderSettings();
    await openReviewConflicts();

    // It showed the copy saved with the conflict: the note typed with no signal.
    await waitFor(() => expect(phoneLine()).toBe(NEWER_LINE));
    expect(screen.getByText(NOTE_LINE)).toBeTruthy();

    fireEvent.press(screen.getByText('Keep Cloud'));
    expect(lastConfirmation()[0]).toBe('Keep Cloud Copy?');
    expect(lastConfirmation()[1]).toBe('The cloud version for Pour slab will replace the copy saved on this phone. The change you made after the conflict was found will also be discarded.');

    fireEvent.press(screen.getByText('Keep Phone'));
    await act(async () => { proceedWithLastConfirmation(); });
    await waitFor(() => expect(screen.queryByText('Review Cloud Conflicts')).toBeNull());
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(onApplyCloudConflictScheduleItem).toHaveBeenCalledWith(expect.objectContaining({ notes: NEWER }));
    expect(await getSyncConflicts()).toEqual([]);
  });

  it('nothing newer waits: the Phone line is the conflict\'s own copy, with no such note, and Keep Cloud\'s question is as it was', async () => {
    await offlineEditInConflictWithWeb();
    renderSettings();
    await openReviewConflicts();
    await waitFor(() => expect(cloudLine()).toBe(CLOUD_0));

    expect(phoneLine()).toBe(PHONE_LINE);
    expect(screen.queryByText(NOTE_LINE)).toBeNull();
    fireEvent.press(screen.getByText('Keep Cloud'));
    expect(lastConfirmation()[1]).toBe('The cloud version for Pour slab will replace the copy saved on this phone.');
  });

  it('Keep Phone\'s write lands and its answer is lost: the review closes as resolved, with the phone\'s copy in the cloud', async () => {
    await offlineEditInConflictWithWeb();
    const onApplyCloudConflictScheduleItem = renderSettings();
    await openReviewConflicts();
    await waitFor(() => expect(cloudLine()).toBe(CLOUD_0));
    jest.mocked(upsertScheduleItem).mockImplementationOnce(async item => {
      mockTasks.set(item.id, JSON.parse(JSON.stringify(item)));
      return { ok: false, configured: true, stubbed: false, data: null, error: 'Network request failed' } as never;
    });

    fireEvent.press(screen.getByText('Keep Phone'));
    await act(async () => { proceedWithLastConfirmation(); });

    // It said "Conflict not resolved. Neither copy was changed. Check the cloud connection and try again."
    await waitFor(() => expect(screen.queryByText('Review Cloud Conflicts')).toBeNull());
    expect(Alert.alert).not.toHaveBeenCalledWith('Conflict not resolved', expect.anything());
    expect(inCloud()).toMatchObject({ notes: phoneTask.notes });
    expect(onApplyCloudConflictScheduleItem).toHaveBeenCalledWith(expect.objectContaining({ notes: phoneTask.notes }));
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('Keep Phone\'s write never reaches the cloud: neither copy was changed, and it still says so', async () => {
    await offlineEditInConflictWithWeb();
    renderSettings();
    await openReviewConflicts();
    await waitFor(() => expect(cloudLine()).toBe(CLOUD_0));
    jest.mocked(upsertScheduleItem).mockImplementationOnce(async () =>
      ({ ok: false, configured: true, stubbed: false, data: null, error: 'Network request failed' }) as never);

    fireEvent.press(screen.getByText('Keep Phone'));
    await act(async () => { proceedWithLastConfirmation(); });

    await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith('Conflict not resolved', 'Neither copy was changed. Check the cloud connection and try again.'));
    expect(inCloud()).toMatchObject({ notes: '' });
    expect(await getSyncConflicts()).toHaveLength(1);
  });
});
