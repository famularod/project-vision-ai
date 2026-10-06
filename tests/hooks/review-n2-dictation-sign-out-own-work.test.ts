import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { forgetSetAsideAccount, settleUnsavedDraftsOnAccountChange } from '../../hooks/unsaved-drafts-on-account-change';
import { forgetFieldNoteDraft, unsavedFieldNoteExists, useFieldNoteDraft } from '../../hooks/use-field-note-draft';
import { forgetKeptWalkMemoryDrafts, unsavedWalkMemoryExists, useKeptWalkMemoryDraft } from '../../hooks/use-kept-walk-memory-draft';
import { createCaptureMemory } from '../../services/DAVECaptureMemory';
import { forgetKeptDrafts, keepDraft, readKeptDraft } from '../../services/KeptDraftStore';
import {
  forgetKeptVoiceRecordings,
  keepVoiceRecording,
  keptVoiceRecordingExists,
  readKeptVoiceRecording,
} from '../../services/KeptVoiceRecording';
import { clearSignOutAskedHere, noteSignOutAskedHere } from '../../services/SignOutIntent';

// Review N2 (5 Oct 2026; caused by 16efe4e). Work set aside for David was
// deleted when ANOTHER account signed out through Settings: his sign-in ends
// unasked with a note unsaved (it is set aside for him, everyday item 7); a
// second account signs in and sees none of it; that account uses Settings'
// Sign Out, which warned it about its own work only, and every account's
// kept note, Project Walk memory and kept recording went. A sign-out now
// removes only the work of the account that is signing out. Another
// account's stays kept for that account, and is still never read by anyone
// else. The stores, the kept-recording service and the rule are real; the
// phone's storage and files are stand-ins.

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
}));

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

const DAVID = 'owner-david';
const OTHER = 'owner-other';
const CACHE_URI = 'file:///cache/Audio/recording-1.m4a';
const KEPT_FOLDER = 'file:///documents/kept-recordings/';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const keptFiles = () => [...mockFiles].filter(file => file.startsWith(KEPT_FOLDER));
const keysOf = (ownerKey: string) => [...mockStorage.keys()].filter(key => key.split('/').includes(encodeURIComponent(ownerKey)));
const flush = () => new Promise(resolve => setTimeout(resolve, 40));

const note = (text: string) => ({ text, source: 'voice', projectName: '', locationName: '', actionKind: 'none', actionText: '', captureOpen: true });
const memory = (id: string) => createCaptureMemory({
  id,
  transcript: 'Drywall crew finishes Friday.',
  transcriptSourceRecordId: `voice-transcription:${id}`,
  createdAt: '2026-09-30T12:00:00.000Z',
  recommendedProject: { value: 'Canopy Project', confidence: 'high', confirmed: true },
  fields: { generalMemory: 'Drywall crew finishes Friday.' },
});

/** The account has a note being dictated, a Project Walk memory not yet confirmed, and a recording kept for signal. Resolves to the recording's kept audio. */
async function unsavedWorkOf(ownerKey: string) {
  await keepDraft('field-note', ownerKey, '', note(`${ownerKey}: guardrail missing at the north slab edge`));
  await keepDraft('walk-memory', ownerKey, 'Canopy Project', memory(`memory-${ownerKey}`));
  mockFiles.add(CACHE_URI);
  return keepVoiceRecording(ownerKey, 'ask', { uri: CACHE_URI, durationMs: 9_000, projectId: PROJECT_ID, projectName: 'Canopy Project' });
}

/** What is kept on the phone for the account, as the app reads it for that account. */
async function keptFor(ownerKey: string) {
  return {
    note: (await readKeptDraft('field-note', ownerKey))?.value ?? null,
    memory: (await readKeptDraft('walk-memory', ownerKey, 'Canopy Project'))?.value ?? null,
    recording: (await readKeptVoiceRecording(ownerKey, 'ask', 'Canopy Project'))?.uri ?? null,
  };
}
const NOTHING = { note: null, memory: null, recording: null };

/** What Settings' Sign Out warning would name for the account. */
async function signOutWarningNames(ownerKey: string) {
  return {
    note: await unsavedFieldNoteExists(ownerKey),
    memory: await unsavedWalkMemoryExists(ownerKey),
    recording: await keptVoiceRecordingExists(ownerKey),
  };
}

/** Field Notes and the project's Confirm Memory open for the account: its kept note and memory come back on screen. */
function workOnScreenOf(ownerKey: string) {
  return renderHook(() => ({
    note: useFieldNoteDraft(`mobile_capture:${ownerKey}`, { ...note(''), source: 'typed', actionKind: 'none', captureOpen: false }, ownerKey),
    memory: useKeptWalkMemoryDraft('Canopy Project'),
  }), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(NativeWorkspaceOwnerContext.Provider, { value: ownerKey }, children),
  });
}

/** Settings' Sign Out, confirmed after its warning, then heard by the app. */
function settingsSignOut(ownerKey: string | undefined) {
  noteSignOutAskedHere();
  settleUnsavedDraftsOnAccountChange('SIGNED_OUT', ownerKey, null);
}

beforeEach(() => {
  mockStorage.clear();
  mockFiles.clear();
  forgetSetAsideAccount();
  clearSignOutAskedHere();
});
// Nothing of a test's is left on screen for the next.
afterEach(() => { forgetFieldNoteDraft(); forgetKeptWalkMemoryDrafts(); });

describe('review N2: a sign-out removes only the work of the account that is signing out', () => {
  it.each([
    ['the app was closed and opened again (the other account\'s sign-in is its first event)', false],
    ['the app stayed open', true],
  ])('David\'s sign-in ends unasked; another account signs in and uses Settings\' Sign Out; David signs back in: %s', async (_label, appStayedOpen) => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    // His sign-in ended elsewhere: not asked for here, so his work is set aside for him.
    settleUnsavedDraftsOnAccountChange('SIGNED_OUT', DAVID, null);
    if (appStayedOpen) settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, OTHER);
    else forgetSetAsideAccount();
    await flush();

    // The other account is shown and offered none of it, and its Sign Out warning names none of it.
    await expect(keptFor(OTHER)).resolves.toEqual(NOTHING);
    await expect(signOutWarningNames(OTHER)).resolves.toEqual({ note: false, memory: false, recording: false });

    // It has work of its own, and signs out through Settings.
    const othersAudio = await unsavedWorkOf(OTHER);
    await expect(signOutWarningNames(OTHER)).resolves.toEqual({ note: true, memory: true, recording: true });
    settingsSignOut(OTHER);
    await flush();

    // Its own work is gone, as its warning said: entries and audio.
    await expect(keptFor(OTHER)).resolves.toEqual(NOTHING);
    expect(keysOf(OTHER)).toEqual([]);
    expect(mockFiles.has(othersAudio)).toBe(false);

    // David's is all still kept for him, and offered when he signs back in.
    settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, DAVID);
    await flush();
    await expect(keptFor(DAVID)).resolves.toEqual({
      note: expect.objectContaining({ text: `${DAVID}: guardrail missing at the north slab edge` }),
      memory: expect.objectContaining({ id: `memory-${DAVID}` }),
      recording: davidsAudio,
    });
    expect(keptFiles()).toEqual([davidsAudio]);
    await expect(signOutWarningNames(DAVID)).resolves.toEqual({ note: true, memory: true, recording: true });
  });

  it('David\'s own Settings Sign Out still removes his own work, and nothing of another account\'s', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    const othersAudio = await unsavedWorkOf(OTHER);
    settingsSignOut(DAVID);
    await flush();
    await expect(keptFor(DAVID)).resolves.toEqual(NOTHING);
    expect(keysOf(DAVID)).toEqual([]);
    expect(mockFiles.has(davidsAudio)).toBe(false);
    await expect(keptFor(OTHER)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: othersAudio });
    expect(keptFiles()).toEqual([othersAudio]);
  });

  it('another account signing in over a signed-in account: his work leaves the screen, and nothing is removed from the phone', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    const onScreen = workOnScreenOf(DAVID);
    await act(flush);
    expect(onScreen.result.current.note[0].text).toBe(`${DAVID}: guardrail missing at the north slab edge`);
    expect(onScreen.result.current.memory[0]).toMatchObject({ id: `memory-${DAVID}` });
    await act(async () => { settleUnsavedDraftsOnAccountChange('SIGNED_IN', DAVID, OTHER); await flush(); });
    expect(onScreen.result.current.note[0].text).toBe('');
    expect(onScreen.result.current.memory[0]).toBeNull();
    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
    await expect(keptFor(OTHER)).resolves.toEqual(NOTHING);
    onScreen.unmount();
  });

  it('a Settings Sign Out heard before the phone has learned which account is signed in removes only what is on screen, and no other account\'s', async () => {
    // The app was opened with no signal, and has heard no sign-in event yet.
    const davidsAudio = await unsavedWorkOf(DAVID);
    const othersAudio = await unsavedWorkOf(OTHER);
    settingsSignOut(undefined);
    await flush();
    // Nothing on screen says whose sign-out it is: nothing is removed from the phone.
    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
    await expect(keptFor(OTHER)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: othersAudio });

    // With the other account's note and Project Walk memory on screen: those go, as its warning said.
    const onScreen = workOnScreenOf(OTHER);
    await act(flush);
    expect(onScreen.result.current.note[0].text).toBe(`${OTHER}: guardrail missing at the north slab edge`);
    expect(onScreen.result.current.memory[0]).toMatchObject({ id: `memory-${OTHER}` });
    await act(async () => { settingsSignOut(undefined); await flush(); });
    expect(onScreen.result.current.note[0].text).toBe('');
    expect(onScreen.result.current.memory[0]).toBeNull();
    expect(await readKeptDraft('field-note', OTHER)).toBeNull();
    expect(await readKeptDraft('walk-memory', OTHER, 'Canopy Project')).toBeNull();
    // Its kept recording is not on screen, so it stays kept for it; David's work is all still his.
    await expect(keptVoiceRecordingExists(OTHER)).resolves.toBe(true);
    await expect(keptFor(DAVID)).resolves.toMatchObject({ note: expect.anything(), memory: expect.anything(), recording: davidsAudio });
    onScreen.unmount();
  });
});

describe('review N2: the kept-draft store forgets one account at a time', () => {
  it('accounts whose ids start the same are not mixed', async () => {
    await keepDraft('field-note', 'owner-1', '', note('Mine.'));
    await keepDraft('field-note', 'owner-10', '', note('Theirs.'));
    await keepDraft('walk-memory', 'owner-1', 'Canopy Project', memory('mine'));
    await keepDraft('walk-memory', 'owner-10', 'Canopy Project', memory('theirs'));
    await forgetKeptDrafts('field-note', 'owner-1');
    await forgetKeptDrafts('walk-memory', 'owner-1');
    expect(await readKeptDraft('field-note', 'owner-1')).toBeNull();
    expect(await readKeptDraft('walk-memory', 'owner-1', 'Canopy Project')).toBeNull();
    expect((await readKeptDraft('field-note', 'owner-10'))?.value).toMatchObject({ text: 'Theirs.' });
    expect((await readKeptDraft('walk-memory', 'owner-10', 'Canopy Project'))?.value).toMatchObject({ id: 'theirs' });
  });

  it('a write still on its way for the account signing out does not land after it; another account\'s read under way still answers', async () => {
    await keepDraft('field-note', DAVID, '', note('David\'s note.'));
    const davidsRead = readKeptDraft('field-note', DAVID);
    const othersWrite = keepDraft('field-note', OTHER, '', note('Typed as the sign-out was confirmed.'));
    const forgotten = forgetKeptDrafts('field-note', OTHER);
    await Promise.all([othersWrite, forgotten]);
    expect(keysOf(OTHER)).toEqual([]);
    expect((await davidsRead)?.value).toMatchObject({ text: 'David\'s note.' });
  });
});

describe('review N2: the signing-out account\'s kept recordings go, and no other audio', () => {
  it('when the sweep cannot run (another account\'s entry cannot be read), its audio is still deleted', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    const othersAudio = await unsavedWorkOf(OTHER);
    // An entry of a third account that cannot be read: it may point at any audio, so nothing is swept.
    mockStorage.set('@vitruvius/kept-drafts/v1/voice-recording/owner-third/ask', 'not json');
    forgetKeptVoiceRecordings(OTHER);
    await flush();
    expect(mockFiles.has(othersAudio)).toBe(false);
    expect(keptFiles()).toEqual([davidsAudio]);
    await expect(keptVoiceRecordingExists(DAVID)).resolves.toBe(true);
  });

  it('an entry of its own that cannot be read goes too, and the audio left with no entry is swept', async () => {
    const davidsAudio = await unsavedWorkOf(DAVID);
    const leftOver = `${KEPT_FOLDER}recording-7-unreadable-entry.m4a`;
    mockFiles.add(leftOver);
    mockStorage.set(`@vitruvius/kept-drafts/v1/voice-recording/${OTHER}/ask`, 'not json');
    forgetKeptVoiceRecordings(OTHER);
    await flush();
    expect(keysOf(OTHER)).toEqual([]);
    expect(keptFiles()).toEqual([davidsAudio]);
  });

  it('a keep still under way for the account signing out does not stay kept', async () => {
    const fileSystem = jest.requireMock('expo-file-system/legacy') as { copyAsync: jest.Mock };
    let finishCopy: () => void = () => undefined;
    fileSystem.copyAsync.mockImplementationOnce(async ({ to }: { from: string; to: string }) => {
      await new Promise<void>(resolve => { finishCopy = resolve; });
      mockFiles.add(to);
    });
    mockFiles.add(CACHE_URI);
    const keeping = keepVoiceRecording(OTHER, 'ask', { uri: CACHE_URI, durationMs: 9_000, projectId: PROJECT_ID, projectName: 'Canopy Project' });
    await flush();
    forgetKeptVoiceRecordings(OTHER);
    finishCopy();
    await keeping;
    await flush();
    expect(keysOf(OTHER)).toEqual([]);
    expect(keptFiles()).toEqual([]);
  });
});
