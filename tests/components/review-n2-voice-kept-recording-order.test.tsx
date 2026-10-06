import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { daveVoiceWaitingForSignalError } from '../../services/DAVEVoiceSignalWait';
import { readKeptVoiceRecording } from '../../services/KeptVoiceRecording';

// Review N2 (5 Oct 2026; caused by d314aba, not closed by cb257a9). A
// recording kept on the device could be deleted by using a DIFFERENT
// recording: Start Recording tapped before the kept check answered (slow
// phone storage), and the check answering while the recorder was still
// starting. The kept recording came back under the new one, the new one was
// taken for already kept, and using it removed the kept one, never used.
//
// Review N1's test of this order passed only because its stand-in recorder
// started at once. Here the stand-in can be slow to start and slow to stop
// (holdStart, holdStop), as a real recorder is.

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
const asyncStorage = jest.requireMock('@react-native-async-storage/async-storage') as { getAllKeys: jest.Mock };

const FIRST_URI = 'file:///cache/Audio/recording-1.m4a';
const NEW_URI = 'file:///cache/Audio/recording-2.m4a';
const KEPT_FOLDER = 'file:///documents/kept-recordings/';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const KEPT_NO_SIGNAL = 'No signal. Your recording is kept on this device — tap Continue when you have signal. If Vitruvius closes, it is tried again the next time you open this.';
const keptFiles = () => [...mockFiles].filter(file => file.startsWith(KEPT_FOLDER));
const entryKeys = () => [...mockStorage.keys()].filter(key => key.includes('/voice-recording/'));
const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const uploads = () => transcription.transcribeDAVECaptureMemoryAudio.mock.calls.map(call => (call[0] as { uri: string }).uri);

/** The recorder gives its next recording this address once it has started. */
function recorderStartsWith(uri: string) {
  recorder.uri = uri;
  mockFiles.add(uri);
  store.set({ canRecord: true, url: uri });
}

/** The recorder is slow to start: its next start waits until `release`. */
function holdStart(uri: string) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  recorder.prepareToRecordAsync.mockImplementationOnce(async () => { await gate; recorderStartsWith(uri); });
  return { release };
}

/** The recorder is slow to stop: its next stop waits until `release`. */
function holdStop() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  recorder.stop.mockImplementationOnce(async () => { await gate; store.set({ isRecording: false, durationMillis: 0 }); });
  return { release };
}

/** Slow phone storage: the next listing of what is kept waits until `release`. */
function holdKeptCheck() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  asyncStorage.getAllKeys.mockImplementationOnce(async () => { await gate; return [...mockStorage.keys()]; });
  return { release };
}

function resetRecorder() {
  store.status = { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null };
  recorder.uri = null;
  recorder.record.mockClear();
}

beforeEach(() => {
  mockFiles.clear();
  mockStorage.clear();
  resetRecorder();
  recorder.prepareToRecordAsync.mockReset();
  recorder.prepareToRecordAsync.mockImplementation(async () => { recorderStartsWith(FIRST_URI); });
  recorder.record.mockImplementation(() => { store.set({ isRecording: true, durationMillis: 0 }); });
  recorder.stop.mockReset();
  recorder.stop.mockImplementation(async () => { store.set({ isRecording: false, durationMillis: 0 }); });
  recorder.getStatus.mockImplementation(() => store.status);
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
  // No signal unless a test says otherwise.
  transcription.transcribeDAVECaptureMemoryAudio.mockImplementation(async () => { throw daveVoiceWaitingForSignalError(); });
  asyncStorage.getAllKeys.mockReset();
  asyncStorage.getAllKeys.mockImplementation(async () => [...mockStorage.keys()]);
});

let view: ReturnType<typeof render> | null = null;
/** iOS closes the app: this sheet's app session ends, and its cache is cleared. */
function closeApp() {
  view?.unmount();
  view = null;
  mockFiles.delete(FIRST_URI);
  mockFiles.delete(NEW_URI);
  resetRecorder();
}
afterEach(() => closeApp());

function sheet(projectName: string, onMemoryReady: jest.Mock) {
  return (
    <NativeWorkspaceOwnerContext.Provider value="owner-a">
      <DAVEVoiceCaptureSheet
        visible
        projectId={PROJECT_ID}
        projectName={projectName}
        candidateProjects={['Canopy Project', 'Harbor North']}
        candidateLocations={[]}
        title="Ask ECOS"
        continueLabel="Continue"
        keepSlot="ask"
        onMemoryReady={onMemoryReady}
        onTypeInstead={jest.fn()}
        onCancel={jest.fn()}
      />
    </NativeWorkspaceOwnerContext.Provider>
  );
}

/** Opens the Ask ECOS voice sheet (a fresh app session when the last one was closed). */
function openSheet(projectName = 'Canopy Project') {
  closeApp();
  const onMemoryReady = jest.fn();
  view = render(sheet(projectName, onMemoryReady));
  return { onMemoryReady };
}

/** An earlier app session: a dictation with no signal, kept on the device. Resolves to its kept audio. */
async function aRecordingKeptEarlier(projectName = 'Canopy Project') {
  openSheet(projectName);
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

/** The recording that is going is 6 seconds in. */
const sixSecondsIn = () => act(async () => { store.set({ durationMillis: 6_000 }); });

/** Nothing of the kept recording is on screen, and it was not sent again. */
function expectKeptOneLeftAlone() {
  expect(screen.queryByText('Recording ready')).toBeNull();
  expect(screen.queryByText(/^Kept from /)).toBeNull();
  expect(screen.queryByText(KEPT_NO_SIGNAL)).toBeNull();
  expect(uploads()).toEqual([]);
}

describe('review N2: a kept recording is removed only with itself, whichever of the kept check and the recorder answers first', () => {
  it('Start Recording tapped before the kept check answers, the recorder slow to start: the kept one stays, and using the new one leaves it', async () => {
    const keptAudio = await aRecordingKeptEarlier();
    const keptCheck = holdKeptCheck();
    const start = holdStart(NEW_URI);
    const { onMemoryReady } = openSheet();
    fireEvent.press(screen.getByText('Start Recording'));
    // The kept check answers while the recorder is still starting.
    await act(async () => { keptCheck.release(); await pause(); });
    expectKeptOneLeftAlone();
    expect(recorder.record).not.toHaveBeenCalled();

    await act(async () => { start.release(); await pause(); });
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Stop Recording')).toBeTruthy();
    expectKeptOneLeftAlone();

    // The new recording is kept on the device as well, beside the one from before.
    await sixSecondsIn();
    fireEvent.press(screen.getByText('Stop Recording'));
    await screen.findByText('Replay Recording');
    await waitFor(() => expect(keptFiles()).toHaveLength(2));
    expect(keptFiles()).toContain(keptAudio);
    expect(entryKeys()).toHaveLength(2);

    // He uses the new one, with signal now: only its own kept copy goes.
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'New words.' });
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(onMemoryReady).toHaveBeenCalledTimes(1));
    // Its own words, as a recording made now (no "kept from" time and place).
    expect(onMemoryReady).toHaveBeenCalledWith({ transcript: 'New words.' });
    expect(uploads()).toEqual([NEW_URI]);
    await waitFor(() => expect(keptFiles()).toEqual([keptAudio]));
    expect(entryKeys()).toHaveLength(1);
    await expect(readKeptVoiceRecording('owner-a', 'ask', 'Canopy Project')).resolves.toMatchObject({ uri: keptAudio, state: 'no-signal' });

    // The next time the sheet opens, the one from before is offered and used: now it goes.
    const next = openSheet();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'Words from before.' });
    await waitFor(() => expect(next.onMemoryReady).toHaveBeenCalledWith(
      { transcript: 'Words from before.' },
      { recordedAt: expect.any(String), walkArea: null },
    ));
    expect(uploads()[uploads().length - 1]).toBe(keptAudio);
    await waitFor(() => expect(keptFiles()).toEqual([]));
    expect(entryKeys()).toEqual([]);
  });

  it('the kept check answers while the recorder is still stopping: the kept one stays, and discarding the new one leaves it', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const keptAudio = await aRecordingKeptEarlier();
    const keptCheck = holdKeptCheck();
    recorder.prepareToRecordAsync.mockImplementationOnce(async () => { recorderStartsWith(NEW_URI); });
    openSheet();
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
    const stop = holdStop();
    await sixSecondsIn();
    fireEvent.press(screen.getByText('Stop Recording'));
    await act(async () => { keptCheck.release(); await pause(); });
    expectKeptOneLeftAlone();

    await act(async () => { stop.release(); await pause(); });
    await screen.findByText('Replay Recording');
    expect(screen.queryByText(/^Kept from /)).toBeNull();
    expect(uploads()).toEqual([]);
    await waitFor(() => expect(keptFiles()).toHaveLength(2));

    // X, then Discard, on the new recording: the one from before is still kept.
    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] ?? [];
    await act(async () => { buttons.find(button => button.text === 'Discard')?.onPress?.(); });
    await waitFor(() => expect(keptFiles()).toEqual([keptAudio]));
    expect(entryKeys()).toHaveLength(1);
    expect(mockFiles.has(NEW_URI)).toBe(false);
    alert.mockRestore();
  });

  it('the project changes while the recorder is starting: the recording kept for that project is not put under the new one', async () => {
    const harborAudio = await aRecordingKeptEarlier('Harbor North');
    const { onMemoryReady } = openSheet('Canopy Project');
    await act(async () => { await pause(); });
    const start = holdStart(NEW_URI);
    fireEvent.press(screen.getByText('Start Recording'));
    // A new kept check, begun after his tap, answers while the recorder is still starting.
    await act(async () => { view?.rerender(sheet('Harbor North', onMemoryReady)); await pause(); });
    expectKeptOneLeftAlone();

    await act(async () => { start.release(); await pause(); });
    expect(recorder.record).toHaveBeenCalledTimes(1);
    await sixSecondsIn();
    fireEvent.press(screen.getByText('Stop Recording'));
    await screen.findByText('Replay Recording');
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'New words.' });
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(onMemoryReady).toHaveBeenCalledWith({ transcript: 'New words.' }));
    await waitFor(() => expect(keptFiles()).toEqual([harborAudio]));
    expect(entryKeys()).toHaveLength(1);
  });

  it('a recorder that could not start does not hold the kept recording back: it is offered once the check answers', async () => {
    const keptAudio = await aRecordingKeptEarlier();
    const keptCheck = holdKeptCheck();
    recorder.prepareToRecordAsync.mockImplementationOnce(async () => { throw new Error('The recorder is busy.'); });
    openSheet();
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Recording could not start. Try again or type the memory instead.')).toBeTruthy();
    await act(async () => { keptCheck.release(); await pause(); });
    // Offered and tried again, as a recording waiting for signal is.
    expect(await screen.findByText(KEPT_NO_SIGNAL)).toBeTruthy();
    expect(screen.getByText('Recording ready')).toBeTruthy();
    expect(uploads()).toEqual([keptAudio]);
    expect(recorder.record).not.toHaveBeenCalled();
    expect(keptFiles()).toEqual([keptAudio]);
  });

  it('a recording that could not finish does not hold the next one back', async () => {
    openSheet();
    await act(async () => { await pause(); });
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
    recorder.stop.mockImplementationOnce(async () => {
      store.set({ isRecording: false, durationMillis: 0 });
      throw new Error('The recorder stopped answering.');
    });
    await sixSecondsIn();
    fireEvent.press(screen.getByText('Stop Recording'));
    expect(await screen.findByText('The recording could not finish. Try again.')).toBeTruthy();
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(2));
  });

  it('a second tap on Start Recording while the recorder is still starting does not start it twice', async () => {
    openSheet();
    await act(async () => { await pause(); });
    const start = holdStart(NEW_URI);
    fireEvent.press(screen.getByText('Start Recording'));
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => { await pause(); });
    await act(async () => { start.release(); await pause(); });
    expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
    expect(recorder.record).toHaveBeenCalledTimes(1);
    // One recording, which stops and is ready as usual.
    await sixSecondsIn();
    fireEvent.press(screen.getByText('Stop Recording'));
    await screen.findByText('Replay Recording');
    expect(screen.getByText('Recording ready')).toBeTruthy();
  });
});
