import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Modal, type AlertButton } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';

// Audit round 2 (A11 pass 1): F1 a dictation survives a phone lock or call (iOS pauses
// the recorder; only stop() finalizes the m4a), F2 an unused recording is not deleted
// without asking. expo-audio is mocked at the module boundary with a controllable
// recorder and polled status, so the real sheet renders and reacts to status flips.

type MockStatus = {
  canRecord: boolean;
  isRecording: boolean;
  durationMillis: number;
  mediaServicesDidReset: boolean;
  url: string | null;
};

jest.mock('expo-audio', () => {
  const { useSyncExternalStore } = require('react');
  const listeners = new Set<() => void>();
  const store = {
    status: {
      canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null,
    } as MockStatus,
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
    id: 'mock-recorder',
    uri: null as string | null,
    currentTime: 0,
    prepareToRecordAsync: jest.fn(async () => undefined),
    record: jest.fn(),
    stop: jest.fn(),
    getStatus: jest.fn(() => store.status),
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

jest.mock('expo-file-system/legacy', () => ({
  deleteAsync: jest.fn(async () => undefined),
}));

// No cloud: the upload is replaced at the service boundary.
jest.mock('../../services/DAVEVoiceTranscriptionService', () => ({
  transcribeDAVECaptureMemoryAudio: jest.fn(),
}));

const audio = jest.requireMock('expo-audio') as {
  __mock: {
    store: { status: MockStatus; set: (next: Partial<MockStatus>) => void };
    recorder: {
      uri: string | null;
      prepareToRecordAsync: jest.Mock;
      record: jest.Mock;
      stop: jest.Mock;
      getStatus: jest.Mock;
    };
  };
  setAudioModeAsync: jest.Mock;
  requestRecordingPermissionsAsync: jest.Mock;
};
const { store, recorder } = audio.__mock;
const fileSystem = jest.requireMock('expo-file-system/legacy') as { deleteAsync: jest.Mock };
const transcription = jest.requireMock('../../services/DAVEVoiceTranscriptionService') as {
  transcribeDAVECaptureMemoryAudio: jest.Mock;
};

const RECORDING_URI = 'file:///cache/Audio/recording-1.m4a';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const INTERRUPTED_NOTICE =
  'Recording stopped when the phone was locked or a call came in. Replay it, then use it or record again.';
const OFFLINE_ERROR = 'This device is offline. Reconnect, then retry this recording or type instead. (VOICE-OFFLINE)';
const LIMIT_NOTICE = 'Stopped at the 3-minute limit. Anything after 3:00 was not recorded.';
const LIMIT_WARNING = 'Less than 15 seconds left. Recording stops at 3:00.';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function nativeStopFinalizes() {
  // Real stop(): the recorder is stopped, keeps its url and reports zero duration.
  store.set({ isRecording: false, durationMillis: 0 });
}

beforeEach(() => {
  store.status = { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null };
  recorder.uri = null;
  recorder.prepareToRecordAsync.mockImplementation(async () => {
    recorder.uri = RECORDING_URI;
    store.set({ canRecord: true, url: RECORDING_URI });
  });
  recorder.record.mockImplementation(() => { store.set({ isRecording: true, durationMillis: 0 }); });
  recorder.stop.mockImplementation(async () => { nativeStopFinalizes(); });
  recorder.getStatus.mockImplementation(() => store.status);
  audio.requestRecordingPermissionsAsync.mockImplementation(async () => ({ granted: true }));
  audio.setAudioModeAsync.mockImplementation(async () => undefined);
  fileSystem.deleteAsync.mockImplementation(async () => undefined);
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
});

function renderSheet(overrides: Partial<Parameters<typeof DAVEVoiceCaptureSheet>[0]> = {}) {
  const props = {
    onMemoryReady: jest.fn(),
    onTypeInstead: jest.fn(),
    onCancel: jest.fn(),
    onOperation: jest.fn(),
    ...overrides,
  };
  render(
    <DAVEVoiceCaptureSheet
      visible
      projectId={PROJECT_ID}
      projectName="Canopy Project"
      candidateLocations={[]}
      title="Talk"
      prompt="What do you need?"
      continueLabel="Continue"
      operationLabel="Create a task"
      {...props}
    />,
  );
  return props;
}

async function startListening(durationMillis: number) {
  fireEvent.press(screen.getByText('Start Recording'));
  await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
  await act(async () => { store.set({ durationMillis }); });
  expect(screen.getByText('Listening…')).toBeTruthy();
}

async function recordThenFailOffline() {
  await startListening(8_000);
  fireEvent.press(screen.getByText('Stop Recording'));
  await screen.findByText('Replay Recording');
  transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(new Error(OFFLINE_ERROR));
  fireEvent.press(screen.getByText('Continue'));
  await screen.findByText(OFFLINE_ERROR);
  // The offline error keeps the recording on offer for a retry.
  expect(screen.getByText('Continue')).toBeTruthy();
  expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
}

// The press handler as rendered now, so a tap that lands after a re-render can be replayed.
function pressHandlerFor(text: string): () => void {
  let node: ReactTestInstance | null = screen.getByText(text);
  while (node && typeof node.props.onPress !== 'function') node = node.parent;
  if (!node) throw new Error(`No press handler renders ${text}`);
  return node.props.onPress;
}

function lastAlertButtons(alert: jest.SpyInstance): AlertButton[] {
  const call = alert.mock.calls[alert.mock.calls.length - 1];
  return call[2] as AlertButton[];
}


it('4.85 same-render double transcription tap starts one service request',async()=>{
 const result=deferred<unknown>();transcription.transcribeDAVECaptureMemoryAudio.mockReturnValue(result.promise);const props=renderSheet();await startListening(8000);fireEvent.press(screen.getByText('Stop Recording'));await screen.findByText('Replay Recording');const press=pressHandlerFor('Continue');await act(async()=>{press();press()});expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledTimes(1);expect(fileSystem.deleteAsync).not.toHaveBeenCalled();result.reject(new Error(OFFLINE_ERROR));await screen.findByText(OFFLINE_ERROR);expect(props.onMemoryReady).not.toHaveBeenCalled();
});
it.each(['','   ',null,undefined,'plain service failure'])('4.85 empty-message failure %p shows meaningful feedback and keeps audio',async message=>{
 transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValue(typeof message === 'string' && message !== 'plain service failure' ? new Error(message) : message);const props=renderSheet();await startListening(8000);fireEvent.press(screen.getByText('Stop Recording'));await screen.findByText('Replay Recording');fireEvent.press(screen.getByText('Continue'));await waitFor(()=>expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledTimes(1));await screen.findByText('The recording could not be transcribed.');expect(screen.getByText('Replay Recording')).toBeTruthy();expect(fileSystem.deleteAsync).not.toHaveBeenCalled();expect(props.onMemoryReady).not.toHaveBeenCalled();
});
it('4.71 guided service failure retains its words without positive success labels',async()=>{
 transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValue(new Error(OFFLINE_ERROR));renderSheet({captureLabel:'What is the task?'});await recordThenFailOffline();expect(screen.queryByText('Recording ready')).toBeNull();expect(screen.queryByText('Answer recorded for: What is the task?')).toBeNull();expect(screen.getByText(OFFLINE_ERROR)).toBeTruthy();expect(screen.getByText('Replay Recording')).toBeTruthy();
});

it('4.85 synchronous guard releases after failure so the same retained recording can retry',async()=>{
 transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(new Error('')).mockResolvedValueOnce({transcript:'Authored words Élodie $&'});const props=renderSheet();await startListening(8000);fireEvent.press(screen.getByText('Stop Recording'));await screen.findByText('Replay Recording');fireEvent.press(screen.getByText('Continue'));await screen.findByText('The recording could not be transcribed.');expect(fileSystem.deleteAsync).not.toHaveBeenCalled();fireEvent.press(screen.getByText('Continue'));await waitFor(()=>expect(props.onMemoryReady).toHaveBeenCalledWith({transcript:'Authored words Élodie $&'}));expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledTimes(2);
});
