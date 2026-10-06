/**
 * Batch W1, item 6 (6 Oct 2026). Settings' Sign Out says what it will
 * discard. Two places where what happened was not what it said:
 *
 * - a sign-out that took more than two minutes to go through (a slow
 *   connection) was heard by the app as "not asked for", and his unsaved
 *   dictation was kept for his account although he had been told it would be
 *   discarded;
 * - Sign Out with no signal right after opening the app, before the app had
 *   heard which account is signed in, left a kept recording on the phone
 *   although the warning had said it would be discarded.
 *
 * What the warning says now happens in both. A sign-out he did NOT ask for
 * (the sign-in ended elsewhere) still keeps his work for his account
 * (everyday item 7), and nobody else's work is ever removed (review N2).
 * Settings and the rule the app applies when it hears a sign-out are real;
 * the cloud and the phone's storage and files are stand-ins. Synthetic data.
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

/** The phone's files: the recorder's cache and the app's documents folder. */
const mockFiles = new Set<string>();
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri), size: mockFiles.has(uri) ? 4096 : 0 })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!mockFiles.has(from)) throw new Error('missing');
    mockFiles.add(to);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    [...mockFiles].filter(file => file === uri || file.startsWith(uri.endsWith('/') ? uri : `${uri}/`)).forEach(file => mockFiles.delete(file));
  }),
  readDirectoryAsync: jest.fn(async (uri: string) => {
    const names = [...mockFiles].filter(file => file.startsWith(uri)).map(file => file.slice(uri.length));
    if (names.length === 0) throw new Error('Directory does not exist.');
    return names;
  }),
}));

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
  SIGN_OUT_OF_ALL_DEVICES_NEEDS_SIGNAL: 'sign-out-of-all-devices-needs-signal',
  SIGNED_OUT_ON_THIS_DEVICE_ONLY: 'signed-out-on-this-device-only',
  SIGN_IN_ALREADY_ENDED_ON_SERVER: 'sign-in-already-ended-on-server',
}));
jest.mock('../../services/SyncService', () => ({
  getSyncConflicts: jest.fn(async () => []),
  getSyncStatus: jest.fn(async () => ({ queuedChanges: 0, conflicts: 0, recoveryAvailable: false, recoveryCopies: 0 })),
  reconcileSyncConflicts: jest.fn(async () => undefined),
  resolveProjectUpdateSyncConflict: jest.fn(),
  resolveScheduleItemSyncConflict: jest.fn(),
  synchronizeLocalData: jest.fn(),
  uploadPendingChanges: jest.fn(),
}));

import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { forgetSetAsideAccount, settleUnsavedDraftsOnAccountChange } from '../../hooks/unsaved-drafts-on-account-change';
import { forgetFieldNoteDraft } from '../../hooks/use-field-note-draft';
import { forgetKeptWalkMemoryDrafts } from '../../hooks/use-kept-walk-memory-draft';
import { createCaptureMemory } from '../../services/DAVECaptureMemory';
import { keepDraft, readKeptDraft } from '../../services/KeptDraftStore';
import { keepVoiceRecording, readKeptVoiceRecording } from '../../services/KeptVoiceRecording';
import { clearSignOutAskedHere } from '../../services/SignOutIntent';
import { AdminScreen } from '../../screens/AdminScreen';

const DAVID = 'owner-david';
const OTHER = 'owner-other';
const CACHE_URI = 'file:///cache/Audio/recording-1.m4a';
const KEPT_FOLDER = 'file:///documents/kept-recordings/';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const MINUTE = 60_000;
const keptFiles = () => [...mockFiles].filter(file => file.startsWith(KEPT_FOLDER));
const flush = () => new Promise(resolve => setTimeout(resolve, 40));

const cloud = jest.requireMock('../../services/SupabaseService') as { signOut: jest.Mock };

const note = (text: string) => ({ text, source: 'voice', projectName: '', locationName: '', actionKind: 'none', actionText: '', captureOpen: true });
const memory = (id: string) => createCaptureMemory({
  id,
  transcript: 'Drywall crew finishes Friday.',
  transcriptSourceRecordId: `voice-transcription:${id}`,
  createdAt: '2026-09-30T12:00:00.000Z',
  recommendedProject: { value: 'Canopy Project', confidence: 'high', confirmed: true },
  fields: { generalMemory: 'Drywall crew finishes Friday.' },
});

/** The account has a note being dictated, a Project Walk memory not yet confirmed, and a recording kept for signal; all kept on the phone, none on screen. Resolves to the recording's kept audio. */
async function unsavedWorkOf(ownerKey: string) {
  await keepDraft('field-note', ownerKey, '', note(`${ownerKey}: guardrail missing at the north slab edge`));
  await keepDraft('walk-memory', ownerKey, 'Canopy Project', memory(`memory-${ownerKey}`));
  mockFiles.add(CACHE_URI);
  return keepVoiceRecording(ownerKey, 'ask', { uri: CACHE_URI, durationMs: 9_000, projectId: PROJECT_ID, projectName: 'Canopy Project' });
}
async function keptFor(ownerKey: string) {
  return {
    note: (await readKeptDraft('field-note', ownerKey))?.value ?? null,
    memory: (await readKeptDraft('walk-memory', ownerKey, 'Canopy Project'))?.value ?? null,
    recording: (await readKeptVoiceRecording(ownerKey, 'ask', 'Canopy Project'))?.uri ?? null,
  };
}
const NOTHING = { note: null, memory: null, recording: null };

/** The clock the app reads; a test moves it instead of waiting. */
let clock = 0;

/**
 * Which account the app has heard is signed in: undefined when it has heard
 * none yet (it was opened with no signal). The app hears a sign-out as
 * App.tsx does: with the account it had heard before.
 */
let theAppHasHeard: string | undefined;
const theAppHearsTheSignOut = () => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', theAppHasHeard, null);

function renderSettings(owner: string) {
  return render(
    <NativeWorkspaceOwnerContext.Provider value={owner}>
      <AdminScreen
        localProjects={['Alpha']} savedUpdates={[]} projectAreas={[]} scheduleItems={[]} referenceDocuments={[]}
        displayName="David" onDisplayNameChange={jest.fn()} onBack={jest.fn()} onDiagnostics={jest.fn()}
        onBackup={jest.fn()} onRestore={jest.fn()} onAddArea={jest.fn(() => true)} onUpdateArea={jest.fn()}
        onDeleteArea={jest.fn()} onUseCurrentLocationForArea={jest.fn()}
        onRemoveMissingPhotos={jest.fn(async () => undefined)} onRetryUpdateSync={jest.fn(async () => ({ status: 'sent' }))}
        onRetryDocumentUploads={jest.fn(async () => ({ attempted: 0, uploaded: 0, remaining: 0 }))}
        failedDocumentCount={0}
        onApplyCloudConflictUpdate={jest.fn()} onApplyCloudConflictScheduleItem={jest.fn()}
        onApplyCloudRecovery={jest.fn()} onSaveCaptureMemory={jest.fn(async () => undefined)}
      />
    </NativeWorkspaceOwnerContext.Provider>,
  );
}

/** He taps Sign Out in Settings, reads the warning, and chooses Sign Out of This Device. Resolves to the warning. */
async function signsOutThroughSettings(screen: ReturnType<typeof render>): Promise<string> {
  jest.mocked(Alert.alert).mockClear();
  const signOut = await screen.findByText('Sign Out');
  await act(async () => { fireEvent.press(signOut); });
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Sign Out', expect.any(String), expect.any(Array)));
  const call = jest.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Sign Out');
  const thisDevice = (call?.[2] ?? []).find(button => button.text === 'Sign Out of This Device');
  await act(async () => { thisDevice?.onPress?.(); await flush(); });
  return String(call?.[1]);
}
const ALL_THREE = 'The field note you have not saved will be discarded. The Project Walk memory you have not saved will be discarded. The recording waiting for signal will be discarded. ';

beforeEach(() => {
  mockPhone.clear();
  mockFiles.clear();
  forgetSetAsideAccount();
  clearSignOutAskedHere();
  theAppHasHeard = DAVID;
  clock = Date.parse('2026-10-06T15:00:00.000Z');
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  cloud.signOut.mockReset();
  // A sign-out that goes through at once, and is heard by the app as it does.
  cloud.signOut.mockImplementation(async () => { theAppHearsTheSignOut(); return { ok: true, data: null }; });
});
afterEach(() => {
  cleanup();
  forgetFieldNoteDraft();
  forgetKeptWalkMemoryDrafts();
  jest.restoreAllMocks();
});

describe('Settings’ Sign Out: what its warning says is what happens', () => {
  it('guard: an ordinary sign-out discards what the warning named, and nothing of another account', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    const othersAudio = await unsavedWorkOf(OTHER);

    const warning = await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    expect(warning.startsWith(ALL_THREE)).toBe(true);
    await expect(keptFor(DAVID)).resolves.toEqual(NOTHING);
    expect(mockFiles.has(davidsAudio)).toBe(false);
    await expect(keptFor(OTHER)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: othersAudio });
  });

  it('a sign-out that takes ten minutes to go through (a slow connection) is still the one he asked for: his unsaved work is discarded, as he was told', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(async () => {
      clock += 10 * MINUTE;
      theAppHearsTheSignOut();
      return { ok: true, data: null };
    });

    const warning = await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    expect(warning.startsWith(ALL_THREE)).toBe(true);
    await expect(keptFor(DAVID)).resolves.toEqual(NOTHING);
    expect(mockFiles.has(davidsAudio)).toBe(false);
    expect(keptFiles()).toEqual([]);
  });

  it('no signal right after opening the app, before it has heard which account is signed in: the kept recording the warning named is discarded, with the note and the memory; another account’s stay', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    const othersAudio = await unsavedWorkOf(OTHER);
    theAppHasHeard = undefined;

    const warning = await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    expect(warning.startsWith(ALL_THREE)).toBe(true);
    await expect(keptFor(DAVID)).resolves.toEqual(NOTHING);
    expect(mockFiles.has(davidsAudio)).toBe(false);
    await expect(keptFor(OTHER)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: othersAudio });
    expect(keptFiles()).toEqual([othersAudio]);
  });

  it('a sign-out that went through and is heard a minute later is still the one he asked for', async () => {
    await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(async () => ({ ok: true, data: null }));
    await signsOutThroughSettings(renderSettings(DAVID));

    clock += MINUTE;
    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toEqual(NOTHING);
  });
});

describe('a sign-out he did not ask for still keeps his work for his account (everyday item 7)', () => {
  it('guard: his sign-in ends elsewhere, with no Settings Sign Out', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);

    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
  });

  it('a Settings Sign Out that went through but was never heard does not make a sign-out an hour later count as asked for', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(async () => ({ ok: true, data: null }));
    await signsOutThroughSettings(renderSettings(DAVID));

    clock += 60 * MINUTE;
    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
  });

  it('a Settings Sign Out that did not finish, then his sign-in ending elsewhere a moment later: kept', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(async () => ({ ok: false, error: 'The sign-in server is not answering.' }));
    await signsOutThroughSettings(renderSettings(DAVID));
    expect(Alert.alert).toHaveBeenCalledWith('Sign Out did not finish', expect.any(String));

    clock += 5_000;
    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
  });

  it('the phone’s clock is set back between the answer and the hearing: it cannot be told how long ago he asked, so his work is kept', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(async () => ({ ok: true, data: null }));
    await signsOutThroughSettings(renderSettings(DAVID));

    clock -= 30 * MINUTE;
    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
  });

  it('each Settings Sign Out is heard once: a second sign-out, not asked for, keeps what was made since', async () => {
    await unsavedWorkOf(DAVID);
    await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);
    await expect(keptFor(DAVID)).resolves.toEqual(NOTHING);
    // He signs in again and dictates; that sign-in then ends elsewhere.
    settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, DAVID);
    const davidsAudio = await unsavedWorkOf(DAVID);

    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
  });
});
