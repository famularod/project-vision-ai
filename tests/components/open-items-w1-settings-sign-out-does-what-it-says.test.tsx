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
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
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
import {
  clearScheduleProgressDraftsForTests,
  unusedScheduleVerificationNoteExists,
  useScheduleVerificationNoteDraft,
} from '../../hooks/use-schedule-progress-draft';
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

// Review pass 1 of the web area, L7 (6 Oct 2026; caused by open item W1-6). A Settings Sign Out whose call
// THREW (it did not answer "failed": for example the phone refusing to remove the saved sign-in) left "asked
// for here" standing with no time limit. A sign-in that ended on its own hours later was then taken for the
// sign-out he had asked for, and his unsaved note, memory and kept recording were discarded with no warning.
// The last build let the mark lapse two minutes after the tap. A sign-out that threw is not one he asked for
// that then happened: the mark is cleared, and he is told. And the mark has a limit in every case: a
// sign-out still under way counts as asked for fifteen minutes from the tap, far longer than one that is
// going to be answered takes.
describe('review pass 1, L7: a Settings Sign Out that threw, or never answered, is not asked for for ever', () => {
  it('the sign-out call throws: he is told it did not finish, and his sign-in ending elsewhere five hours later is not taken for it: his work is kept', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(async () => { throw new Error('The saved sign-in could not be removed.'); });

    await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);
    expect(Alert.alert).toHaveBeenCalledWith('Sign Out did not finish', 'Try Sign Out again.');

    clock += 5 * 60 * MINUTE;
    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
  });

  it('…nor is one that ends elsewhere five seconds later', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(async () => { throw new Error('The saved sign-in could not be removed.'); });
    await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    clock += 5_000;
    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
  });

  it('the call throws AFTER the sign-out was heard: it did happen, his work went as he was told, and nothing says it did not finish', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(async () => {
      theAppHearsTheSignOut();
      throw new Error('A later step failed.');
    });

    await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    await expect(keptFor(DAVID)).resolves.toEqual(NOTHING);
    expect(mockFiles.has(davidsAudio)).toBe(false);
    expect(Alert.alert).not.toHaveBeenCalledWith('Sign Out did not finish', expect.any(String));
  });

  it('the call never answers: a sign-in that ends on its own twenty minutes after the tap is not taken for it: his work is kept', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(() => new Promise(() => undefined));
    await signsOutThroughSettings(renderSettings(DAVID));

    clock += 20 * MINUTE;
    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
  });

  it('guard: the call has not answered yet and the sign-out is heard fourteen minutes after the tap: it is the one he asked for', async () => {
    await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(() => new Promise(() => undefined));
    await signsOutThroughSettings(renderSettings(DAVID));

    clock += 14 * MINUTE;
    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toEqual(NOTHING);
  });

  it('the phone’s clock is set back while the sign-out is still under way: it cannot be told how long ago he asked, so his work is kept', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    cloud.signOut.mockImplementation(() => new Promise(() => undefined));
    await signsOutThroughSettings(renderSettings(DAVID));

    clock -= 30 * MINUTE;
    await act(async () => { theAppHearsTheSignOut(); await flush(); });

    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
  });
});

// Review pass 1 of the web area, L8 (6 Oct 2026; caused by open item W1-7). The optional verification note
// typed on a task is kept in memory until it is used. Settings' Sign Out neither named it nor dropped it: it
// was back after signing in again. The warning now names it when there is one, and the sign-out discards it
// with the rest. (That it is kept for its own completion report, and what a sign-out not asked for does with
// it, is in tests/hooks/open-items-w1-verification-note-kept.test.tsx.)
describe('review pass 1, L8: the verification note typed on a task is named in the warning and goes with the sign-out', () => {
  const VERIFICATION_NOTE_LINE = 'The verification note you have typed will be discarded. ';
  /** A completion report awaiting his answer (synthetic). */
  const REPORT = {
    reportedAt: '2026-10-05T15:00:00.000Z',
    reportedBy: 'Crew lead',
    evidence: [{ id: 'completion-evidence:email:1', kind: 'email' as const, sourceRecordId: 'record-1', sourceName: 'Crew lead', summary: 'Level 2 framing is complete.', recordedAt: '2026-10-05T15:00:00.000Z' }],
  };
  /** He types the note under the task's "Verify completion" and leaves the Tasks tab. */
  const typesAVerificationNote = (text: string) => {
    const row = renderHook(() => useScheduleVerificationNoteDraft('task-1', REPORT));
    act(() => row.result.current[1](text));
    row.unmount();
  };
  const whatTheFieldShows = () => {
    const row = renderHook(() => useScheduleVerificationNoteDraft('task-1', REPORT));
    const shown = row.result.current[0];
    row.unmount();
    return shown;
  };
  afterEach(() => act(() => clearScheduleProgressDraftsForTests()));

  it('with a note typed and not yet used: the warning says it will be discarded, and after the sign-out it is gone, also once he has signed in again', async () => {
    typesAVerificationNote('Looks done from the lift');

    const warning = await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    expect(warning).toContain(VERIFICATION_NOTE_LINE);
    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, DAVID));
    expect(whatTheFieldShows()).toBe('');
  });

  it('it is named after the three sentences the warning already had, which are unchanged', async () => {
    await unsavedWorkOf(DAVID);
    typesAVerificationNote('Looks done from the lift');

    const warning = await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    expect(warning.startsWith(`${ALL_THREE}${VERIFICATION_NOTE_LINE}`)).toBe(true);
  });

  it('guard: with no note typed the warning does not speak of one', async () => {
    const warning = await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    expect(warning).not.toContain('verification note');
  });

  it('guard: a Settings Sign Out that did not finish discards nothing: the note is still in its field', async () => {
    typesAVerificationNote('Looks done from the lift');
    cloud.signOut.mockImplementation(async () => ({ ok: false, error: 'The sign-in server is not answering.' }));

    await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    expect(whatTheFieldShows()).toBe('Looks done from the lift');
  });
});

// Second review of the web area, F6 (7 Oct 2026; caused by the L8 fix above). The warning is about the account
// Settings shows, and the sign-out discards that account's work. A verification note was taken to be "of
// whoever is signed in now" until the app heard a sign-out with the account known, so another account's
// warning could name a note that account never typed, and its Sign Out discarded it. A note now belongs to the
// account whose workspace it was typed in. (The rule itself, and the whole app, are in
// tests/hooks/review-p5-web-pass2-f6-verification-note-own-account.test.tsx and
// tests/review-p5-web-pass2-f6-verification-note-whole-app.test.tsx.)
describe('second review, web F6: the warning names a verification note only for the account Settings shows, and the sign-out discards only that account’s', () => {
  const VERIFICATION_NOTE_LINE = 'The verification note you have typed will be discarded. ';
  const REPORT = {
    reportedAt: '2026-10-05T15:00:00.000Z',
    reportedBy: 'Crew lead',
    evidence: [{ id: 'completion-evidence:email:1', kind: 'email' as const, sourceRecordId: 'record-1', sourceName: 'Crew lead', summary: 'Level 2 framing is complete.', recordedAt: '2026-10-05T15:00:00.000Z' }],
  };
  /** A task row as the phone draws it: inside the workspace of the account signed in. */
  const rowIn = (owner: string) => renderHook(() => useScheduleVerificationNoteDraft('task-1', REPORT), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NativeWorkspaceOwnerContext.Provider value={owner}>{children}</NativeWorkspaceOwnerContext.Provider>
    ),
  });
  const typesInTheWorkspaceOf = (owner: string, text: string) => {
    const row = rowIn(owner);
    act(() => row.result.current[1](text));
    row.unmount();
  };
  const whatTheFieldShowsIn = (owner: string) => {
    const row = rowIn(owner);
    const shown = row.result.current[0];
    row.unmount();
    return shown;
  };
  afterEach(() => act(() => clearScheduleProgressDraftsForTests()));

  it('the reviewer’s order: David’s note typed before the app had heard the account, his sign-in ends unasked, the other account signs in: its warning names no verification note, and its Sign Out leaves David’s', async () => {
    typesInTheWorkspaceOf(DAVID, 'Looks done from the lift');
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', undefined, null));
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, OTHER));
    theAppHasHeard = OTHER;

    const warning = await signsOutThroughSettings(renderSettings(OTHER));
    await act(flush);

    expect(warning).not.toContain('verification note');
    expect(whatTheFieldShowsIn(DAVID)).toBe('Looks done from the lift');
  });

  it('David’s workspace closed without the app hearing any sign-out, and the other account’s workspace is open: its warning names no verification note, and its Sign Out leaves David’s', async () => {
    typesInTheWorkspaceOf(DAVID, 'Looks done from the lift');
    // The other account's app was opened afresh and has heard nothing yet.
    theAppHasHeard = undefined;

    const warning = await signsOutThroughSettings(renderSettings(OTHER));
    await act(flush);

    expect(warning).not.toContain('verification note');
    expect(whatTheFieldShowsIn(DAVID)).toBe('Looks done from the lift');
    expect(unusedScheduleVerificationNoteExists(DAVID)).toBe(true);
  });

  it('David is back after a sign-in that ended unasked: his own warning names the note again, and his Sign Out discards it', async () => {
    typesInTheWorkspaceOf(DAVID, 'Looks done from the lift');
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', DAVID, null));
    // He signs in again: the app is opened afresh, and has heard nothing yet.
    theAppHasHeard = undefined;

    const warning = await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    expect(warning).toContain(VERIFICATION_NOTE_LINE);
    expect(whatTheFieldShowsIn(DAVID)).toBe('');
    expect(unusedScheduleVerificationNoteExists(DAVID)).toBe(false);
  });

  it('guard: a note typed in the workspace of the account Settings shows is named, and goes with its sign-out', async () => {
    typesInTheWorkspaceOf(DAVID, 'Looks done from the lift');

    const warning = await signsOutThroughSettings(renderSettings(DAVID));
    await act(flush);

    expect(warning).toContain(VERIFICATION_NOTE_LINE);
    expect(whatTheFieldShowsIn(DAVID)).toBe('');
  });
});
