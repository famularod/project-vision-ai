/**
 * Whole-app audit A4 pass 15b F1 (1 Oct 2026): Settings › Review Conflicts
 * showed, on its "Phone:" line, the copy saved with the conflict. When David
 * had saved a newer edit on the phone during the conflict, that edit waited
 * (A4 pass 15 H1) and Keep Phone sends it after the conflict's copy (A7 pass
 * 11 L-2), but the screen never showed it. Comparing the older phone copy
 * with the cloud's, he could pick Keep Cloud and lose an edit he never saw
 * there. The "Phone:" line now shows the newer edit, what Keep Phone ends
 * with, says it includes a change made after the conflict was found, and
 * Keep Cloud's confirmation says that change is discarded, which it is.
 *
 * Renders the real AdminScreen with the real SyncService queue, upload and
 * conflict store; the cloud is a mocked row (as audit-a7-p12-conflict-review-
 * card.test.tsx does).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

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

const mockCloud = new Map<string, { updatedAt: string; updateData: Record<string, any> }>();
jest.mock('../../services/SupabaseService', () => {
  const ok = <T,>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
  const project = { id: '72e941d8-8114-4082-a976-ae5b2b5daba9', name: 'P' };
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
    // The cloud's copy of the update.
    verifyDAVEAppOwner: jest.fn(async () => ({ ok: true, data: true })),
    listProjects: jest.fn(async () => ok([project])),
    listArchivedProjects: jest.fn(async () => ok([])),
    listDAVESyncTombstones: jest.fn(async () => ok([])),
    getProjectUpdateSyncMetadata: jest.fn(async (id: string) => {
      const current = mockCloud.get(id);
      return ok(current ? { id, projectId: project.id, updatedAt: current.updatedAt, projectName: 'P', areaName: '',
        updateData: JSON.parse(JSON.stringify(current.updateData)) } : null);
    }),
    saveProjectUpdate: jest.fn(async (params: { id: string; updatedAt: string; updateData: Record<string, unknown> }) => {
      mockCloud.set(params.id, { updatedAt: params.updatedAt, updateData: JSON.parse(JSON.stringify(params.updateData)) });
      return ok({ id: params.id, updateData: params.updateData });
    }),
  };
});
jest.mock('../../services/DAVECloudMaintenanceBudget', () => ({
  ...jest.requireActual('../../services/DAVECloudMaintenanceBudget'),
  runDAVECloudMaintenanceIfDue: jest.fn(async () => ({ storageCleanupRemaining: 0, storageCleanupCompleted: 0, storageCleanupErrors: [] })),
}));

import { AdminScreen } from '../../screens/AdminScreen';
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import {
  clearResolvedConflict, getOfflineQueue, getSyncConflicts, queueProjectUpdateRecord, uploadPendingChanges,
} from '../../services/SyncService';
import type { ProjectUpdate } from '../../types';

const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async () => { throw new Error('network disabled in test'); }) as never;
});
afterAll(() => { global.fetch = realFetch; });

const SENT_AT = '2026-09-28T09:00:00.000Z';
const OFFLINE_EDIT = 'Pour, 40 yards (typed on the phone with no signal)';
const IPAD_NOTE = 'Pour moved to Tuesday (typed on the iPad)';
const NEWER = 'Pour, 45 yards (saved on the phone during the conflict)';
const INCLUDES_NEWER = 'Includes a change you made after the conflict was found.';
const sent = { id: 'u1', projectName: 'P', date: '2026-09-28', notes: 'Pour', recipients: { contactIds: [] }, photos: [], documents: [], status: 'sent' };
const offlineEdit = { ...sent, notes: OFFLINE_EDIT, status: 'queued', syncDiagnostics: null };
const photo = { id: 'photo-f1', uri: 'file:///phone/Documents/project-photos/f1.jpg', caption: '', createdAt: SENT_AT };
const inCloud = () => mockCloud.get('u1')!.updateData;
/** The update's date as the review card writes it (in this machine's time zone). */
const DAY = new Date(sent.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Saved on the phone offline; the iPad's edit lands after it; reconnected, the conflict is found. */
async function offlineEditInConflictWithIPad() {
  await queueProjectUpdateRecord(offlineEdit as never, false);
  await new Promise(resolve => setTimeout(resolve, 5));
  mockCloud.set('u1', { updatedAt: new Date().toISOString(), updateData: { ...sent, notes: IPAD_NOTE } });
  await uploadPendingChanges();
  expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
}
/** David edits the update again on the phone during the conflict: it waits for review (A4 pass 15 H1). */
async function newerEditDuringConflict(photos: unknown[] = []) {
  await new Promise(resolve => setTimeout(resolve, 5));
  const newer = { ...offlineEdit, notes: NEWER, photos };
  await queueProjectUpdateRecord(newer as never, false);
  await uploadPendingChanges();
  expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
  return newer;
}

function renderSettings(card: object, onApplyCloudConflictUpdate = jest.fn()) {
  render(
    <AdminScreen
      localProjects={['P']}
      savedUpdates={[card as unknown as ProjectUpdate]}
      projectAreas={[]}
      scheduleItems={[]}
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
      onApplyCloudConflictUpdate={onApplyCloudConflictUpdate}
      onApplyCloudConflictScheduleItem={jest.fn()}
      onApplyCloudRecovery={jest.fn()}
      onSaveCaptureMemory={jest.fn(async () => undefined)}
    />,
  );
  return onApplyCloudConflictUpdate;
}
async function openReviewConflicts() {
  fireEvent.press(await screen.findByText('Review Conflicts'));
  await screen.findByText('Review Cloud Conflicts');
}
/** The confirmation Keep Phone or Keep Cloud asks, and its button that goes ahead. */
function lastConfirmation() {
  const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1) as
    [string, string, Array<{ text: string; onPress?: () => void }>];
  return { title, message, proceed: buttons.find(button => button.text !== 'Cancel')!.onPress! };
}
const phoneLine = () => screen.getByText(/^Phone: /).props.children.join('');

beforeEach(async () => {
  mockStorage.clear();
  mockCloud.clear();
  await clearResolvedConflict('none'); // the screens' copy of the saved conflicts starts empty too
  noteSignedInOwner('owner-a');
  mockCloud.set('u1', { updatedAt: SENT_AT, updateData: JSON.parse(JSON.stringify(sent)) });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe('Review Conflicts shows the newer phone edit Keep Phone will send (audit A4 pass 15b F1)', () => {
  it('a newer edit saved during the conflict: the Phone line shows it, and says it includes a change made after the conflict was found', async () => {
    await offlineEditInConflictWithIPad();
    const newer = await newerEditDuringConflict([photo]);
    renderSettings(newer);
    await openReviewConflicts();
    // It showed the conflict's copy: `Phone: ${DAY} · 0 photos · ${OFFLINE_EDIT}`.
    await waitFor(() => expect(phoneLine()).toBe(`Phone: ${DAY} · 1 photo · ${NEWER}`));
    expect(screen.getByText(INCLUDES_NEWER)).toBeTruthy();
    expect(screen.queryByText(new RegExp(OFFLINE_EDIT.replace(/[()]/g, '\\$&')))).toBeNull();
    expect(screen.getByText(/^Cloud: /).props.children.join('')).toBe(`Cloud: ${DAY} · 0 photos · ${IPAD_NOTE}`);
  });

  it('Keep Cloud says the newer change is discarded; it is: the cloud keeps the iPad\'s copy, nothing of the phone\'s waits, and the card takes the cloud\'s copy', async () => {
    await offlineEditInConflictWithIPad();
    const newer = await newerEditDuringConflict();
    const onApplyCloudConflictUpdate = renderSettings(newer);
    await openReviewConflicts();
    await screen.findByText(INCLUDES_NEWER);
    fireEvent.press(screen.getByText('Keep Cloud'));
    const { title, message, proceed } = lastConfirmation();
    expect(title).toBe('Keep Cloud Copy?');
    expect(message).toBe('The cloud version for P will replace the copy saved on this phone. The change you made after the conflict was found will also be discarded.');
    await act(async () => { proceed(); });
    await waitFor(() => expect(onApplyCloudConflictUpdate).toHaveBeenCalledTimes(1));
    expect(onApplyCloudConflictUpdate.mock.calls[0][0]).toMatchObject({ notes: IPAD_NOTE });
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
    await waitFor(() => expect(screen.queryByText('Review Cloud Conflicts')).toBeNull());
  });

  it('Keep Phone ends with what the Phone line showed: the newer edit reaches the cloud', async () => {
    await offlineEditInConflictWithIPad();
    const newer = await newerEditDuringConflict();
    renderSettings(newer);
    await openReviewConflicts();
    await screen.findByText(INCLUDES_NEWER);
    const shown = phoneLine();
    fireEvent.press(screen.getByText('Keep Phone'));
    const { title, message, proceed } = lastConfirmation();
    expect(title).toBe('Keep Phone Copy?');
    expect(message).toBe('The version saved on this phone for P will replace the cloud copy.');
    await act(async () => { proceed(); });
    await waitFor(() => expect(screen.queryByText('Review Cloud Conflicts')).toBeNull());
    await act(async () => { await uploadPendingChanges(); });
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(shown).toBe(`Phone: ${DAY} · 0 photos · ${NEWER}`);
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('no newer edit: the Phone line is the conflict\'s copy, with no such line, and Keep Cloud asks as before', async () => {
    await offlineEditInConflictWithIPad();
    renderSettings(offlineEdit);
    await openReviewConflicts();
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    expect(phoneLine()).toBe(`Phone: ${DAY} · 0 photos · ${OFFLINE_EDIT}`);
    expect(screen.queryByText(INCLUDES_NEWER)).toBeNull();
    fireEvent.press(screen.getByText('Keep Cloud'));
    expect(lastConfirmation().message).toBe('The cloud version for P will replace the copy saved on this phone.');
  });
});

/**
 * Whole-app audit A4 pass 16 L3, raised to Medium as A7 pass 14 M-1: the
 * "Cloud:" line showed the cloud's copy saved when the conflict was found,
 * and nothing read it again. After another iPad edit, Keep Phone put the
 * phone's copy over an iPad note the screen never showed. Review Conflicts
 * now reads the cloud's copies when it opens, and a choice made on a copy
 * the cloud no longer holds sends nothing and asks David to review again.
 */
describe('Review Conflicts shows the cloud\'s copy as it is now (audit A4 pass 16 L3, A7 pass 14 M-1)', () => {
  const IPAD_SECOND_NOTE = 'Pour moved to Wednesday (typed on the iPad again)';
  const cloudLine = () => screen.getByText(/^Cloud: /).props.children.join('');
  const iPadEditsAgain = (note: string) => {
    mockCloud.set('u1', { updatedAt: new Date().toISOString(), updateData: { ...sent, notes: note } });
  };

  it('opened after the iPad edited again: the Cloud line shows the iPad\'s newest copy', async () => {
    await offlineEditInConflictWithIPad();
    await new Promise(resolve => setTimeout(resolve, 5));
    iPadEditsAgain(IPAD_SECOND_NOTE);
    renderSettings(offlineEdit);
    await openReviewConflicts();
    // It showed the copy saved with the conflict: `Cloud: ${DAY} · 0 photos · ${IPAD_NOTE}`.
    await waitFor(() => expect(cloudLine()).toBe(`Cloud: ${DAY} · 0 photos · ${IPAD_SECOND_NOTE}`));
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
  });

  it('the iPad edits while the screen is open: Keep Phone sends nothing, says the cloud copy changed, and shows it; chosen again, it goes ahead', async () => {
    await offlineEditInConflictWithIPad();
    renderSettings(offlineEdit);
    await openReviewConflicts();
    await waitFor(() => expect(cloudLine()).toBe(`Cloud: ${DAY} · 0 photos · ${IPAD_NOTE}`));
    await new Promise(resolve => setTimeout(resolve, 5));
    iPadEditsAgain(IPAD_SECOND_NOTE);

    fireEvent.press(screen.getByText('Keep Phone'));
    await act(async () => { lastConfirmation().proceed(); });
    await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith('Cloud copy changed', 'The cloud copy changed — review again. Nothing was sent.'));
    await waitFor(() => expect(cloudLine()).toBe(`Cloud: ${DAY} · 0 photos · ${IPAD_SECOND_NOTE}`));
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(screen.getByText('Review Cloud Conflicts')).toBeTruthy();

    await new Promise(resolve => setTimeout(resolve, 5));
    fireEvent.press(screen.getByText('Keep Phone'));
    await act(async () => { lastConfirmation().proceed(); });
    await waitFor(() => expect(screen.queryByText('Review Cloud Conflicts')).toBeNull());
    expect(inCloud()).toMatchObject({ notes: OFFLINE_EDIT });
    expect(await getSyncConflicts()).toEqual([]);
  });
});

/**
 * Whole-app audit A4 pass 17 L1 (caused by 0d82d03): on weak signal the read
 * Review Conflicts makes when it opens is slow, so the Cloud line still shows
 * the copy saved with the conflict when David taps Keep Phone. The read lands
 * while "Keep Phone Copy?" is up and saves the iPad's newest copy into the
 * conflict; the check before writing compared the cloud with that saved copy,
 * found no change, and sent the phone's copy over an iPad note the screen
 * never showed. A choice now carries the cloud copy its row showed, and the
 * check compares the cloud with that.
 */
describe('a choice made before the open-time read lands is checked against the copy the screen showed (audit A4 pass 17 L1)', () => {
  const IPAD_SECOND_NOTE = 'Pour moved to Wednesday (typed on the iPad again)';
  const cloudLine = () => screen.getByText(/^Cloud: /).props.children.join('');
  /** Weak signal: the next read of the cloud's copy (the one Review Conflicts makes when it opens) waits until released. */
  function holdNextCloudRead() {
    const reads = (jest.requireMock('../../services/SupabaseService') as { getProjectUpdateSyncMetadata: jest.Mock })
      .getProjectUpdateSyncMetadata;
    const read = reads.getMockImplementation()!;
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    reads.mockImplementationOnce(async (id: string) => { await released; return read(id); });
    return release;
  }
  /** Review Conflicts opened with its read held; David taps a choice; the read lands while its confirmation is up. */
  async function chooseWhileTheReadIsSlow(choice: 'Keep Phone' | 'Keep Cloud', cloudLineAfterRead: string) {
    const release = holdNextCloudRead();
    await openReviewConflicts();
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    expect(cloudLine()).toBe(`Cloud: ${DAY} · 0 photos · ${IPAD_NOTE}`); // what David sees when he taps
    fireEvent.press(screen.getByText(choice));
    const confirmation = lastConfirmation();
    await act(async () => { release(); });
    await waitFor(() => expect(cloudLine()).toBe(cloudLineAfterRead));
    return confirmation;
  }

  it.each(['Keep Phone', 'Keep Cloud'] as const)('the iPad edited again: %s, confirmed after the read lands, sends nothing and says the cloud copy changed', async choice => {
    await offlineEditInConflictWithIPad();
    await new Promise(resolve => setTimeout(resolve, 5));
    mockCloud.set('u1', { updatedAt: new Date().toISOString(), updateData: { ...sent, notes: IPAD_SECOND_NOTE } });
    const onApplyCloudConflictUpdate = renderSettings(offlineEdit);
    const { proceed } = await chooseWhileTheReadIsSlow(choice, `Cloud: ${DAY} · 0 photos · ${IPAD_SECOND_NOTE}`);
    const cloudBefore = JSON.stringify(mockCloud.get('u1'));
    const [conflictBefore] = await getSyncConflicts();
    const { saveProjectUpdate } = jest.requireMock('../../services/SupabaseService') as { saveProjectUpdate: jest.Mock };
    const writes = saveProjectUpdate.mock.calls.length;

    await act(async () => { proceed(); });
    await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith('Cloud copy changed', 'The cloud copy changed — review again. Nothing was sent.'));
    // It sent the phone's copy over the iPad's second note (Keep Phone), or
    // kept a cloud copy the screen never showed (Keep Cloud), and closed the conflict.
    expect(saveProjectUpdate.mock.calls.length).toBe(writes);
    expect(JSON.stringify(mockCloud.get('u1'))).toBe(cloudBefore);
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({
      id: conflictBefore.id,
      remotePayload: expect.objectContaining({ notes: IPAD_SECOND_NOTE }),
      localPayload: expect.objectContaining({ updateData: expect.objectContaining({ notes: OFFLINE_EDIT }) }),
    })]);
    expect(await getOfflineQueue()).toEqual([]);
    expect(onApplyCloudConflictUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Review Cloud Conflicts')).toBeTruthy();
    expect(cloudLine()).toBe(`Cloud: ${DAY} · 0 photos · ${IPAD_SECOND_NOTE}`);
  });

  it('control: nothing changed in the cloud; Keep Phone confirmed after the read lands sends the phone\'s copy', async () => {
    await offlineEditInConflictWithIPad();
    renderSettings(offlineEdit);
    const { proceed } = await chooseWhileTheReadIsSlow('Keep Phone', `Cloud: ${DAY} · 0 photos · ${IPAD_NOTE}`);
    await act(async () => { proceed(); });
    await waitFor(() => expect(screen.queryByText('Review Cloud Conflicts')).toBeNull());
    expect(inCloud()).toMatchObject({ notes: OFFLINE_EDIT });
    expect(await getSyncConflicts()).toEqual([]);
    expect(Alert.alert).not.toHaveBeenCalledWith('Cloud copy changed', expect.anything());
  });
});
