import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { daveVoiceWaitingForSignalError } from '../../services/DAVEVoiceSignalWait';
import {
  forgetKeptVoiceRecordings,
  keptVoiceRecordingExists,
  readKeptVoiceRecording,
} from '../../services/KeptVoiceRecording';

// Everyday item 4 (2 Oct 2026): a recording waiting for signal was kept in
// the voice sheet only, so iOS closing the app lost the dictation. With a
// keep slot, its audio is copied out of the cache into the app's documents
// folder and its entry kept per account and sheet; the next time the sheet
// opens for that account and project it is offered again and tried again.
// The lock / call and "X while Preparing…" protections still apply.

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

const CACHE_URI = 'file:///cache/Audio/recording-1.m4a';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const KEPT_NO_SIGNAL = 'No signal. Your recording is kept on this device — tap Continue when you have signal. If Vitruvius closes, it is tried again the next time you open this.';
const keptFiles = () => [...mockFiles].filter(file => file.startsWith('file:///documents/kept-recordings/'));

beforeEach(() => {
  mockFiles.clear();
  mockStorage.clear();
  store.status = { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null };
  recorder.uri = null;
  recorder.prepareToRecordAsync.mockImplementation(async () => {
    recorder.uri = CACHE_URI;
    mockFiles.add(CACHE_URI);
    store.set({ canRecord: true, url: CACHE_URI });
  });
  recorder.record.mockImplementation(() => { store.set({ isRecording: true, durationMillis: 0 }); });
  recorder.stop.mockImplementation(async () => { store.set({ isRecording: false, durationMillis: 0 }); });
  recorder.getStatus.mockImplementation(() => store.status);
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
});

let view: ReturnType<typeof render> | null = null;
/** iOS closes the app: this sheet's app session ends. */
function closeApp() {
  view?.unmount();
  view = null;
}
afterEach(closeApp);

/** Opens the Talk sheet for `owner` (a fresh app session when the last one was unmounted). */
function openSheet({
  owner = 'owner-a',
  projectName = 'Canopy Project',
  keepSlot = 'talk',
  autoStartRecording = false,
  onMemoryReady = jest.fn(),
}: { owner?: string; projectName?: string; keepSlot?: string; autoStartRecording?: boolean; onMemoryReady?: jest.Mock } = {}) {
  closeApp();
  view = render(
    <NativeWorkspaceOwnerContext.Provider value={owner}>
      <DAVEVoiceCaptureSheet
        visible
        projectId={PROJECT_ID}
        projectName={projectName}
        candidateLocations={[]}
        title="Talk"
        continueLabel="Continue"
        keepSlot={keepSlot}
        autoStartRecording={autoStartRecording}
        onMemoryReady={onMemoryReady}
        onTypeInstead={jest.fn()}
        onCancel={jest.fn()}
      />
    </NativeWorkspaceOwnerContext.Provider>,
  );
  return { onMemoryReady };
}

async function recordAndWaitForSignal() {
  fireEvent.press(screen.getByText('Start Recording'));
  await waitFor(() => expect(recorder.record).toHaveBeenCalled());
  await act(async () => { store.set({ durationMillis: 9_000 }); });
  fireEvent.press(screen.getByText('Stop Recording'));
  await screen.findByText('Replay Recording');
  transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
  fireEvent.press(screen.getByText('Continue'));
  expect(await screen.findByText(KEPT_NO_SIGNAL)).toBeTruthy();
  await waitFor(() => expect(keptFiles()).toHaveLength(1));
}

describe('a recording waiting for signal survives iOS closing the app (everyday item 4)', () => {
  it('is kept on the device for this account, then offered and tried again after the next launch', async () => {
    openSheet();
    await recordAndWaitForSignal();
    // A copy out of the cache, and its entry under this account and sheet.
    await expect(readKeptVoiceRecording('owner-a', 'talk')).resolves.toMatchObject({
      uri: keptFiles()[0], durationMs: 9_000, projectName: 'Canopy Project', projectId: PROJECT_ID,
    });

    // iOS closes the app; its cache is cleared too. The next launch opens Talk with signal.
    closeApp();
    mockFiles.delete(CACHE_URI);
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'Pour moved to Friday.' });
    const { onMemoryReady } = openSheet();
    // Review N1 L3: a recording brought back from the device also says when it was dictated,
    // and the Project Walk area matched then (none here). Before, only its words were handed on.
    await waitFor(() => expect(onMemoryReady).toHaveBeenCalledWith(
      { transcript: 'Pour moved to Friday.' },
      { recordedAt: expect.any(String), walkArea: null },
    ));
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenLastCalledWith(expect.objectContaining({
      uri: expect.stringMatching(/^file:\/\/\/documents\/kept-recordings\//),
      projectId: PROJECT_ID,
      projectName: 'Canopy Project',
    }));
    // Used: nothing stays kept.
    await waitFor(() => expect(keptFiles()).toHaveLength(0));
    await expect(readKeptVoiceRecording('owner-a', 'talk')).resolves.toBeNull();
  });

  it('still without signal after the launch: offered again with the same words, and still kept', async () => {
    openSheet();
    await recordAndWaitForSignal();
    closeApp();
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    openSheet();
    expect(await screen.findByText(KEPT_NO_SIGNAL)).toBeTruthy();
    expect(screen.getByText('Recording ready')).toBeTruthy();
    expect(screen.getByText('0:09')).toBeTruthy();
    await expect(keptVoiceRecordingExists('owner-a')).resolves.toBe(true);
    expect(keptFiles()).toHaveLength(1);
  });

  it('another account, another sheet or another project is not offered it', async () => {
    openSheet();
    await recordAndWaitForSignal();
    openSheet({ owner: 'owner-b' });
    openSheet({ keepSlot: 'ask' });
    openSheet({ projectName: 'Harbor North' });
    await act(async () => undefined);
    expect(screen.queryByText('Recording ready')).toBeNull();
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledTimes(1);
    await expect(keptVoiceRecordingExists('owner-b')).resolves.toBe(false);
    await expect(keptVoiceRecordingExists('owner-a')).resolves.toBe(true);
  });

  it('X while "Preparing…" after the launch still asks: Keep Recording for Later keeps it; Discard deletes it', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    openSheet();
    await recordAndWaitForSignal();
    closeApp();
    let finish: (value: unknown) => void = () => undefined;
    transcription.transcribeDAVECaptureMemoryAudio.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    openSheet();
    expect(await screen.findByText('Preparing…')).toBeTruthy();
    expect(screen.getByText(/^Kept from .*, when there was no signal\. Trying it again now\.$/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    const [, message, buttons] = alert.mock.calls[alert.mock.calls.length - 1] as [string, string, AlertButton[]];
    expect(message).toBe('It is still being turned into text. You can keep waiting, keep the recording on this device and try Continue again later, or discard it.');
    act(() => { buttons.find(button => button.text === 'Keep Recording for Later')?.onPress?.(); });
    expect(screen.getByText('Stopped waiting. The recording is kept on this device. Tap Continue to try again.')).toBeTruthy();
    await expect(keptVoiceRecordingExists('owner-a')).resolves.toBe(true);

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    const discard = (alert.mock.calls[alert.mock.calls.length - 1][2] as AlertButton[]).find(button => button.text === 'Discard');
    await act(async () => { discard?.onPress?.(); });
    await waitFor(() => expect(keptFiles()).toHaveLength(0));
    await expect(keptVoiceRecordingExists('owner-a')).resolves.toBe(false);
    await act(async () => { finish({ transcript: 'Late words.' }); });
    alert.mockRestore();
  });

  it('a dictation sheet that starts recording by itself offers the kept recording instead of recording over it', async () => {
    openSheet({ keepSlot: 'field-note' });
    await recordAndWaitForSignal();
    closeApp();
    recorder.record.mockClear();
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    openSheet({ keepSlot: 'field-note', autoStartRecording: true });
    expect(await screen.findByText(KEPT_NO_SIGNAL)).toBeTruthy();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
    expect(recorder.record).not.toHaveBeenCalled();
    expect(keptFiles()).toHaveLength(1);
  });

  it('Record Again, or an account change or sign-out, removes it; without a keep slot nothing is kept', async () => {
    openSheet();
    await recordAndWaitForSignal();
    fireEvent.press(screen.getByText('Record Again'));
    await waitFor(() => expect(keptFiles()).toHaveLength(0));
    await expect(keptVoiceRecordingExists('owner-a')).resolves.toBe(false);
    closeApp();
    // Record Again started a new recording; that app session is gone.
    store.status = { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null };
    recorder.record.mockClear();

    openSheet();
    fireEvent.press(await screen.findByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalled());
    await act(async () => { store.set({ durationMillis: 9_000 }); });
    fireEvent.press(screen.getByText('Stop Recording'));
    await screen.findByText('Replay Recording');
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(keptFiles()).toHaveLength(1));
    forgetKeptVoiceRecordings();
    await waitFor(() => expect(keptFiles()).toHaveLength(0));
    await expect(keptVoiceRecordingExists('owner-a')).resolves.toBe(false);
    closeApp();
    recorder.record.mockClear();

    // No keep slot: as before, kept in the sheet only.
    view = render(
      <NativeWorkspaceOwnerContext.Provider value="owner-a">
        <DAVEVoiceCaptureSheet visible projectId={PROJECT_ID} projectName="Canopy Project" candidateLocations={[]}
          title="Talk" continueLabel="Continue" onMemoryReady={jest.fn()} onTypeInstead={jest.fn()} onCancel={jest.fn()} />
      </NativeWorkspaceOwnerContext.Provider>,
    );
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalled());
    await act(async () => { store.set({ durationMillis: 9_000 }); });
    fireEvent.press(screen.getByText('Stop Recording'));
    await screen.findByText('Replay Recording');
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    fireEvent.press(screen.getByText('Continue'));
    expect(await screen.findByText('No signal. Your recording is kept while Vitruvius stays open — tap Continue when you have signal.')).toBeTruthy();
    expect(keptFiles()).toHaveLength(0);
  });
});
