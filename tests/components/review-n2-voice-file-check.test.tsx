import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { daveVoiceWaitingForSignalError } from '../../services/DAVEVoiceSignalWait';
import {
  forgetKeptVoiceRecording,
  keepVoiceRecording,
  keptVoiceRecordingExists,
  readKeptVoiceRecording,
  sweepKeptVoiceRecordings,
} from '../../services/KeptVoiceRecording';

// Review N2 (5 Oct 2026; caused by d314aba / cb257a9). One failed file check
// deleted a kept recording, with nothing said: when the phone could not
// answer whether the audio was there (getInfoAsync threw), that was read as
// "gone", the recording's entry was removed, and the sweep of audio with no
// entry then deleted the audio. A check that fails is now "unknown": nothing
// is removed and nothing is swept. Only an answer that the audio is gone
// removes its entry, as before.

jest.setTimeout(20_000);

type MockStatus = { canRecord: boolean; isRecording: boolean; durationMillis: number; mediaServicesDidReset: boolean; url: string | null };

jest.mock('expo-audio', () => {
  const { useSyncExternalStore } = require('react');
  const listeners = new Set<() => void>();
  const store = {
    status: { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null } as MockStatus,
    set(next: Partial<MockStatus>) {
      store.status = { ...store.status, ...next };
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const recorder = {
    id: 'mock-recorder', uri: null as string | null, currentTime: 0,
    prepareToRecordAsync: jest.fn(async () => undefined), record: jest.fn(), stop: jest.fn(), getStatus: jest.fn(() => store.status),
  };
  return {
    __mock: { store, recorder },
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setAudioModeAsync: jest.fn(async () => undefined),
    useAudioRecorder: () => recorder,
    useAudioRecorderState: () => useSyncExternalStore(store.subscribe, () => store.status),
    useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => undefined) }),
    useAudioPlayerStatus: () => ({ playing: false, didJustFinish: false, currentTime: 0, duration: 0 }),
  };
});

/** The device's files: the recorder's cache and the app's documents folder. */
const mockFiles = new Set<string>();
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(),
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

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
}));

jest.mock('../../services/DAVEVoiceTranscriptionService', () => ({
  transcribeDAVECaptureMemoryAudio: jest.fn(),
}));

const audio = jest.requireMock('expo-audio') as {
  __mock: { store: { status: MockStatus; set: (next: Partial<MockStatus>) => void }; recorder: { uri: string | null; prepareToRecordAsync: jest.Mock; record: jest.Mock; stop: jest.Mock; getStatus: jest.Mock } };
};
const { store, recorder } = audio.__mock;
const transcription = jest.requireMock('../../services/DAVEVoiceTranscriptionService') as { transcribeDAVECaptureMemoryAudio: jest.Mock };
const fileSystem = jest.requireMock('expo-file-system/legacy') as { getInfoAsync: jest.Mock };

const CACHE_URI = 'file:///cache/Audio/recording-1.m4a';
const KEPT_FOLDER = 'file:///documents/kept-recordings/';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const KEPT_NO_SIGNAL = 'No signal. Your recording is kept on this device — tap Continue when you have signal. If Vitruvius closes, it is tried again the next time you open this.';
const RECORDING = { uri: CACHE_URI, durationMs: 9_000, projectId: PROJECT_ID, projectName: 'Canopy Project' };
const keptFiles = () => [...mockFiles].filter(file => file.startsWith(KEPT_FOLDER));
const entryKeys = () => [...mockStorage.keys()].filter(key => key.includes('/voice-recording/'));
const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));

/** The phone answers a file check. */
const fileCheckAnswers = async (uri: string) => ({ exists: mockFiles.has(uri), size: mockFiles.has(uri) ? 4096 : 0 });
/** The phone cannot answer a file check just now. */
const fileCheckFails = async () => { throw new Error('The phone could not read its files just now.'); };

function resetRecorder() {
  store.status = { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null };
  recorder.uri = null;
  recorder.record.mockClear();
}

beforeEach(() => {
  mockFiles.clear();
  mockStorage.clear();
  resetRecorder();
  recorder.prepareToRecordAsync.mockImplementation(async () => {
    recorder.uri = CACHE_URI;
    mockFiles.add(CACHE_URI);
    store.set({ canRecord: true, url: CACHE_URI });
  });
  recorder.record.mockImplementation(() => { store.set({ isRecording: true, durationMillis: 0 }); });
  recorder.stop.mockImplementation(async () => { store.set({ isRecording: false, durationMillis: 0 }); });
  recorder.getStatus.mockImplementation(() => store.status);
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
  // No signal unless a test says otherwise.
  transcription.transcribeDAVECaptureMemoryAudio.mockImplementation(async () => { throw daveVoiceWaitingForSignalError(); });
  fileSystem.getInfoAsync.mockReset();
  fileSystem.getInfoAsync.mockImplementation(fileCheckAnswers);
});

let view: ReturnType<typeof render> | null = null;
/** iOS closes the app: this sheet's app session ends, and its cache is cleared. */
function closeApp() {
  view?.unmount();
  view = null;
  mockFiles.delete(CACHE_URI);
  resetRecorder();
}
afterEach(() => closeApp());

/** Opens the Ask ECOS voice sheet (a fresh app session when the last one was closed). */
function openSheet() {
  closeApp();
  const onMemoryReady = jest.fn();
  view = render(
    <NativeWorkspaceOwnerContext.Provider value="owner-a">
      <DAVEVoiceCaptureSheet
        visible
        projectId={PROJECT_ID}
        projectName="Canopy Project"
        candidateLocations={[]}
        title="Ask ECOS"
        continueLabel="Continue"
        keepSlot="ask"
        onMemoryReady={onMemoryReady}
        onTypeInstead={jest.fn()}
        onCancel={jest.fn()}
      />
    </NativeWorkspaceOwnerContext.Provider>,
  );
  return { onMemoryReady };
}

/** An earlier app session: a dictation with no signal, kept on the device. Resolves to its kept audio. */
async function aRecordingKeptEarlier() {
  openSheet();
  fireEvent.press(await screen.findByText('Start Recording'));
  await waitFor(() => expect(recorder.record).toHaveBeenCalled());
  await act(async () => { store.set({ durationMillis: 9_000 }); });
  fireEvent.press(screen.getByText('Stop Recording'));
  await screen.findByText('Replay Recording');
  fireEvent.press(screen.getByText('Continue'));
  expect(await screen.findByText(KEPT_NO_SIGNAL)).toBeTruthy();
  await waitFor(() => expect(keptFiles()).toHaveLength(1));
  const [keptAudio] = keptFiles();
  closeApp();
  transcription.transcribeDAVECaptureMemoryAudio.mockClear();
  return keptAudio;
}

describe('review N2: a file check that fails is "unknown", not "gone"', () => {
  it('one failed check when the sheet opens: the recording is still kept, is offered, and is used', async () => {
    const keptAudio = await aRecordingKeptEarlier();
    fileSystem.getInfoAsync.mockImplementationOnce(fileCheckFails);
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'Rebar passed.' });
    const { onMemoryReady } = openSheet();
    await waitFor(() => expect(onMemoryReady).toHaveBeenCalledWith(
      { transcript: 'Rebar passed.' },
      { recordedAt: expect.any(String), walkArea: null },
    ));
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenLastCalledWith(expect.objectContaining({ uri: keptAudio }));
    // Used, so now it goes.
    await waitFor(() => expect(keptFiles()).toEqual([]));
    expect(entryKeys()).toEqual([]);
  });

  it('still without signal: after the failed check it is offered again, and the next time too', async () => {
    const keptAudio = await aRecordingKeptEarlier();
    fileSystem.getInfoAsync.mockImplementationOnce(fileCheckFails);
    openSheet();
    expect(await screen.findByText(KEPT_NO_SIGNAL)).toBeTruthy();
    expect(screen.getByText('Recording ready')).toBeTruthy();
    await act(async () => { await pause(); });
    expect(entryKeys()).toHaveLength(1);
    expect(keptFiles()).toEqual([keptAudio]);

    openSheet();
    expect(await screen.findByText(KEPT_NO_SIGNAL)).toBeTruthy();
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenLastCalledWith(expect.objectContaining({ uri: keptAudio }));
    expect(keptFiles()).toEqual([keptAudio]);
  });

  it('while the phone cannot answer: nothing is removed, nothing is swept, and the Sign Out warning still names it', async () => {
    mockFiles.add(CACHE_URI);
    const kept = await keepVoiceRecording('owner-a', 'ask', RECORDING);
    const theirs = await keepVoiceRecording('owner-b', 'talk', { ...RECORDING, projectName: 'Harbor North' });
    fileSystem.getInfoAsync.mockImplementation(fileCheckFails);
    await expect(readKeptVoiceRecording('owner-a', 'ask', 'Canopy Project')).resolves.toMatchObject({ uri: kept, durationMs: 9_000 });
    await expect(keptVoiceRecordingExists('owner-a')).resolves.toBe(true);
    await sweepKeptVoiceRecordings();
    expect(entryKeys()).toHaveLength(2);
    expect(keptFiles().sort()).toEqual([kept, theirs].sort());
    // Discard still removes it: its entry and its audio, and no other.
    await forgetKeptVoiceRecording('owner-a', 'ask', kept);
    expect(entryKeys()).toHaveLength(1);
    expect(keptFiles()).toEqual([theirs]);
  });

  it('an answer that the audio is gone, or empty, still removes its entry', async () => {
    mockFiles.add(CACHE_URI);
    const gone = await keepVoiceRecording('owner-a', 'ask', RECORDING);
    mockFiles.delete(gone);
    await expect(readKeptVoiceRecording('owner-a', 'ask')).resolves.toBeNull();
    expect(entryKeys()).toEqual([]);

    const empty = await keepVoiceRecording('owner-a', 'ask', RECORDING);
    fileSystem.getInfoAsync.mockImplementation(async () => ({ exists: true, size: 0 }));
    await expect(readKeptVoiceRecording('owner-a', 'ask')).resolves.toBeNull();
    expect(entryKeys()).toEqual([]);
    // The empty file has no entry now, and is swept as audio nothing points at.
    expect(keptFiles()).not.toContain(empty);
  });

  it('a copy the phone cannot confirm is not called kept: no entry is written', async () => {
    mockFiles.add(CACHE_URI);
    fileSystem.getInfoAsync.mockImplementation(fileCheckFails);
    await expect(keepVoiceRecording('owner-a', 'ask', RECORDING)).rejects.toThrow('The recording could not be kept on this device.');
    expect(entryKeys()).toEqual([]);
    // The recording itself is untouched in the sheet's cache.
    expect(mockFiles.has(CACHE_URI)).toBe(true);
  });
});
