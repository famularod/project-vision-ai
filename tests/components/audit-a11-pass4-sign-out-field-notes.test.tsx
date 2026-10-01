/**
 * Whole-app audit A11 pass 4 L5 (30 Sep 2026): the Sign Out warning counted
 * field updates, queued changes and documents, but not field notes waiting
 * to sync, and it did not say that a field note not yet saved is discarded
 * (intended: a sign-out forgets it, pinned in
 * app-typed-text-survives-navigation). Synthetic data only.
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockPhone = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: async (key: string) => mockPhone.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockPhone.set(key, value); },
    removeItem: async (key: string) => { mockPhone.delete(key); },
    getAllKeys: async () => [...mockPhone.keys()],
    multiRemove: async (keys: string[]) => { keys.forEach(key => mockPhone.delete(key)); },
  };
  return { __esModule: true, default: api, ...api };
});
jest.mock('../../services/SupabaseService', () => ({
  getCurrentSessionAccessToken: jest.fn(async () => null),
  getSupabaseConfigurationStatus: () => ({ configured: true }),
  getSupabaseConnectionStatus: jest.fn(async () => ({
    configured: true, clientReady: true, authenticated: true, userEmail: 'owner@example.com',
  })),
  testSupabaseConnection: jest.fn(async () => ({ connected: true })),
  subscribeToAuthStateChange: () => () => undefined,
  readSavedSignIn: jest.fn(async () => null),
  signIn: jest.fn(),
  signOut: jest.fn(),
  signUp: jest.fn(),
}));
jest.mock('../../services/SyncService', () => ({
  getSyncConflicts: jest.fn(async () => []),
  getSyncStatus: jest.fn(async () => ({ queuedChanges: 1, conflicts: 0, recoveryAvailable: false, recoveryCopies: 0 })),
  reconcileSyncConflicts: jest.fn(async () => undefined),
  resolveProjectUpdateSyncConflict: jest.fn(),
  resolveScheduleItemSyncConflict: jest.fn(),
  synchronizeLocalData: jest.fn(),
  uploadPendingChanges: jest.fn(),
}));

import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { forgetFieldNoteDraft, useFieldNoteDraft } from '../../hooks/use-field-note-draft';
import { forgetKeptWalkMemoryDrafts, useKeptWalkMemoryDraft } from '../../hooks/use-kept-walk-memory-draft';
import { createCaptureMemory } from '../../services/DAVECaptureMemory';
import { createFieldNote, localFieldNoteRepository, markFieldNoteConflict, markFieldNoteSynced } from '../../services/FieldNoteRepository';
import { AdminScreen } from '../../screens/AdminScreen';

const OWNER = 'owner-l5';
const TAIL = 'They stay on this phone and sync after you sign in here again with this account.';
// First, as the one thing lost for good; the rest of the warning reads as before.
const UNSAVED = 'The field note you have not saved will be discarded.';

function renderSettings(
  owner: string | null | undefined = OWNER,
  { failedDocumentCount = 2, extra = null }: { failedDocumentCount?: number; extra?: React.ReactNode } = {},
) {
  const settings = (
    <>
      {extra}
      <AdminScreen
        localProjects={['Alpha']} savedUpdates={[]} projectAreas={[]} scheduleItems={[]} referenceDocuments={[]}
        displayName="David" onDisplayNameChange={jest.fn()} onBack={jest.fn()} onDiagnostics={jest.fn()}
        onBackup={jest.fn()} onRestore={jest.fn()} onAddArea={jest.fn(() => true)} onUpdateArea={jest.fn()}
        onDeleteArea={jest.fn()} onUseCurrentLocationForArea={jest.fn()}
        onRemoveMissingPhotos={jest.fn(async () => undefined)} onRetryUpdateSync={jest.fn(async () => ({ status: 'sent' }))}
        onRetryDocumentUploads={jest.fn(async () => ({ attempted: 0, uploaded: 0, remaining: 0 }))}
        failedDocumentCount={failedDocumentCount}
        onApplyCloudConflictUpdate={jest.fn()} onApplyCloudConflictScheduleItem={jest.fn()}
        onApplyCloudRecovery={jest.fn()} onSaveCaptureMemory={jest.fn(async () => undefined)}
      />
    </>
  );
  return render(owner === undefined
    ? settings
    : <NativeWorkspaceOwnerContext.Provider value={owner}>{settings}</NativeWorkspaceOwnerContext.Provider>);
}

async function signOutWarning(screen: ReturnType<typeof render>): Promise<string> {
  await screen.findByText('3 items pending on this device');
  await act(async () => { fireEvent.press(screen.getByText('Sign Out')); });
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Sign Out', expect.any(String), expect.any(Array)));
  const call = jest.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Sign Out');
  return String(call?.[1]).split('\n\n')[0];
}

async function noteWaitingToSync(id: string) {
  await localFieldNoteRepository.save(OWNER, createFieldNote({ id, text: 'Gate chain cut.', now: '2026-09-30T12:00:00.000Z' }));
}

describe('Sign Out names waiting field notes and an unsaved one (A11 pass 4 L5)', () => {
  beforeEach(() => {
    mockPhone.clear();
    jest.requireMock('../../services/SyncService').getSyncStatus.mockResolvedValue(
      { queuedChanges: 1, conflicts: 0, recoveryAvailable: false, recoveryCopies: 0 },
    );
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    forgetFieldNoteDraft();
    jest.restoreAllMocks();
  });

  it('counts field notes waiting to sync with the rest; synced ones are not counted', async () => {
    await noteWaitingToSync('note-waiting-1');
    await noteWaitingToSync('note-waiting-2');
    await localFieldNoteRepository.save(OWNER, markFieldNoteSynced(
      createFieldNote({ id: 'note-synced', text: 'Fence repaired.', now: '2026-09-30T12:00:00.000Z' }), 1, '2026-09-30T12:01:00.000Z',
    ));
    const message = await signOutWarning(renderSettings());
    expect(message).toBe(`5 items are not in the cloud yet. ${TAIL} Sign out anyway?`);
  });

  it('says an unsaved field note is discarded, kept on the phone or still on screen', async () => {
    // Kept on the phone from before the app was closed (A11 pass 4 L3).
    const { keepDraft } = require('../../services/KeptDraftStore');
    await keepDraft('field-note', OWNER, '', { text: 'Crack in the east wall', projectName: '', locationName: '', actionKind: 'none', actionText: '', source: 'typed' });
    const message = await signOutWarning(renderSettings());
    expect(message).toBe(`${UNSAVED} 3 items are not in the cloud yet. ${TAIL} Sign out anyway?`);
  });

  it('with nothing waiting, a note still on screen and not saved still asks', async () => {
    let write: (text: string) => void = () => undefined;
    function NoteOnScreen() {
      const [, update] = useFieldNoteDraft(`mobile_capture:${OWNER}`, {
        text: '', source: 'typed', projectName: '', locationName: '', actionKind: 'none', actionText: '', captureOpen: true,
      }, OWNER);
      write = text => update('text', text);
      return null;
    }
    jest.requireMock('../../services/SyncService').getSyncStatus.mockResolvedValue(
      { queuedChanges: 0, conflicts: 0, recoveryAvailable: false, recoveryCopies: 0 },
    );
    const screen = renderSettings(OWNER, { failedDocumentCount: 0, extra: <NoteOnScreen /> });
    await act(async () => { write('Crack in the east wall'); });
    await screen.findByText('All caught up');
    await act(async () => { fireEvent.press(screen.getByText('Sign Out')); });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Sign Out', expect.any(String), expect.any(Array)));
    const call = jest.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Sign Out');
    expect(String(call?.[1]).split('\n\n')[0]).toBe(
      `${UNSAVED} You will need to sign in again to resume cloud sync and photo intelligence.`,
    );
  });

  it("another account's waiting notes or unsaved note are not counted or named", async () => {
    await noteWaitingToSync('note-owner-l5');
    const { keepDraft } = require('../../services/KeptDraftStore');
    await keepDraft('field-note', OWNER, '', { text: 'Crack in the east wall' });
    const message = await signOutWarning(renderSettings('owner-other'));
    expect(message).toBe(`3 items are not in the cloud yet. ${TAIL} Sign out anyway?`);
  });
});

/**
 * Whole-app audit A11 pass 5 L3 (30 Sep 2026): the Sign Out warning named an
 * unsaved field note but not an unsaved Project Walk memory, which a
 * sign-out also deletes (forgetKeptWalkMemoryDrafts); and field notes the
 * cloud refused as a conflict ("Review needed") were not counted, though
 * they too are still only on this phone. Synthetic data only.
 */
describe('Sign Out names an unsaved Project Walk memory and counts field notes needing review (A11 pass 5 L3)', () => {
  const WALK_UNSAVED = 'The Project Walk memory you have not saved will be discarded.';
  const walkMemory = (id: string) => createCaptureMemory({
    id,
    transcript: 'Drywall crew finishes Friday.',
    transcriptSourceRecordId: `voice-transcription:${id}`,
    createdAt: '2026-09-30T12:00:00.000Z',
    recommendedProject: { value: 'Alpha', confidence: 'high', confirmed: true },
    fields: { generalMemory: 'Drywall crew finishes Friday.' },
  });

  beforeEach(() => {
    mockPhone.clear();
    jest.requireMock('../../services/SyncService').getSyncStatus.mockResolvedValue(
      { queuedChanges: 1, conflicts: 0, recoveryAvailable: false, recoveryCopies: 0 },
    );
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    forgetFieldNoteDraft();
    forgetKeptWalkMemoryDrafts();
    jest.restoreAllMocks();
  });

  it('a memory kept on the phone from before the app closed is named, after an unsaved field note', async () => {
    const { keepDraft } = require('../../services/KeptDraftStore');
    await keepDraft('walk-memory', OWNER, 'Alpha', walkMemory('memory-kept'));
    await keepDraft('field-note', OWNER, '', { text: 'Crack in the east wall' });
    const message = await signOutWarning(renderSettings());
    expect(message).toBe(`${UNSAVED} ${WALK_UNSAVED} 3 items are not in the cloud yet. ${TAIL} Sign out anyway?`);
  });

  it('a memory waiting on Confirm Memory on screen is named', async () => {
    let keep: (memory: ReturnType<typeof walkMemory>) => void = () => undefined;
    function MemoryOnScreen() {
      const [, setDraft] = useKeptWalkMemoryDraft('Alpha');
      keep = setDraft;
      return null;
    }
    const screen = renderSettings(OWNER, { extra: <MemoryOnScreen /> });
    await act(async () => { keep(walkMemory('memory-on-screen')); });
    const message = await signOutWarning(screen);
    expect(message).toBe(`${WALK_UNSAVED} 3 items are not in the cloud yet. ${TAIL} Sign out anyway?`);
  });

  it("another account's memory, or an unreadable one, is not named", async () => {
    const { keepDraft } = require('../../services/KeptDraftStore');
    await keepDraft('walk-memory', 'owner-other', 'Alpha', walkMemory('memory-other'));
    await keepDraft('walk-memory', OWNER, 'Beta', { id: 'memory-broken' });
    const message = await signOutWarning(renderSettings());
    expect(message).toBe(`3 items are not in the cloud yet. ${TAIL} Sign out anyway?`);
  });

  it('field notes needing review are counted with those waiting to sync', async () => {
    await noteWaitingToSync('note-waiting');
    await localFieldNoteRepository.save(OWNER, markFieldNoteConflict(
      createFieldNote({ id: 'note-review', text: 'Fence repaired.', now: '2026-09-30T12:00:00.000Z' }),
      'Changed on another device.',
    ));
    const message = await signOutWarning(renderSettings());
    expect(message).toBe(`5 items are not in the cloud yet. ${TAIL} Sign out anyway?`);
  });
});
