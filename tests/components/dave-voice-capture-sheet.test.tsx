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

describe('DAVEVoiceCaptureSheet F1: a phone lock or call mid-dictation', () => {
  it('stops the paused recorder before offering the recording, and says why it stopped', async () => {
    const stop = deferred();
    recorder.stop.mockImplementation(() => stop.promise.then(nativeStopFinalizes));
    const props = renderSheet({ autoSubmitOnStop: true });
    await startListening(45_000);

    // iOS pauses (does not stop) on lock, auto-lock or a call: isRecording false, url and duration kept.
    await act(async () => { store.set({ isRecording: false, durationMillis: 45_000 }); });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    // Nothing is offered until stop() has finalized the file.
    expect(screen.queryByText('Replay Recording')).toBeNull();
    expect(screen.queryByText('Continue')).toBeNull();
    expect(screen.queryByText('Recording ready')).toBeNull();
    expect(audio.setAudioModeAsync).not.toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: false }));
    // A new recording cannot start over the one still finishing.
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => undefined);
    expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);

    await act(async () => { stop.resolve(); });

    expect(await screen.findByText('Replay Recording')).toBeTruthy();
    expect(screen.getByText('Recording ready')).toBeTruthy();
    expect(screen.getByText('0:45')).toBeTruthy();
    expect(screen.getByText(INTERRUPTED_NOTICE)).toBeTruthy();
    const modeOff = audio.setAudioModeAsync.mock.calls.findIndex(([mode]) => mode.allowsRecording === false);
    expect(modeOff).toBeGreaterThanOrEqual(0);
    expect(audio.setAudioModeAsync.mock.invocationCallOrder[modeOff])
      .toBeGreaterThan(recorder.stop.mock.invocationCallOrder[0]);
    // Never resumed, never auto-submitted, stop() not repeated by later status polls.
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
    expect(props.onMemoryReady).not.toHaveBeenCalled();
    await act(async () => { store.set({ durationMillis: 0 }); });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  it('offers no file when stop() fails after the recorder was paused', async () => {
    recorder.stop.mockImplementation(async () => { throw new Error('native stop failed'); });
    renderSheet();
    await startListening(30_000);

    await act(async () => { store.set({ isRecording: false, durationMillis: 30_000 }); });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/could not be saved/)).toBeTruthy();
    expect(screen.queryByText('Replay Recording')).toBeNull();
    expect(screen.queryByText('Continue')).toBeNull();
    expect(screen.queryByText('Recording ready')).toBeNull();
    expect(screen.queryByText(INTERRUPTED_NOTICE)).toBeNull();
    expect(screen.getByText('Start Recording')).toBeTruthy();
  });

  it('closing while a paused recording is still finishing deletes it and never offers it', async () => {
    const stop = deferred();
    recorder.stop.mockImplementation(() => stop.promise.then(nativeStopFinalizes));
    const props = renderSheet();
    await startListening(20_000);
    await act(async () => { store.set({ isRecording: false, durationMillis: 20_000 }); });
    expect(recorder.stop).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    await waitFor(() => expect(props.onCancel).toHaveBeenCalledTimes(1));
    await act(async () => { stop.resolve(); });

    expect(screen.queryByText('Replay Recording')).toBeNull();
    expect(screen.queryByText(INTERRUPTED_NOTICE)).toBeNull();
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(RECORDING_URI, { idempotent: true });
  });

  it("a Stop tap that lands after a lock already claimed the recording does not stop it twice", async () => {
    const stop = deferred();
    recorder.stop.mockImplementation(() => stop.promise.then(nativeStopFinalizes));
    renderSheet({ autoSubmitOnStop: true });
    await startListening(12_000);
    const staleStopTap = pressHandlerFor('Stop & Continue');

    await act(async () => { store.set({ isRecording: false, durationMillis: 12_000 }); });
    expect(screen.queryByText('Stop & Continue')).toBeNull();
    await act(async () => { staleStopTap(); });
    await act(async () => { stop.resolve(); });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(INTERRUPTED_NOTICE)).toBeTruthy();
    expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
  });

  it('reaching the 3-minute limit offers the recording without the lock notice', async () => {
    renderSheet();
    await startListening(179_800);

    // The native recordForDuration has already stopped the recorder.
    await act(async () => { store.set({ isRecording: false, durationMillis: 0 }); });

    expect(await screen.findByText('Replay Recording')).toBeTruthy();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(INTERRUPTED_NOTICE)).toBeNull();
    // Pin changed deliberately (whole-app audit A11 pass 4 L4): the limit used
    // to stop the recording with no word at all; it now says so.
    expect(screen.getByText(LIMIT_NOTICE)).toBeTruthy();
  });

  it('warns near the 3-minute limit, and not before (A11 pass 4 L4)', async () => {
    renderSheet();
    await startListening(150_000);
    expect(screen.queryByText(LIMIT_WARNING)).toBeNull();

    await act(async () => { store.set({ durationMillis: 165_000 }); });
    expect(screen.getByText(LIMIT_WARNING)).toBeTruthy();
    await act(async () => { store.set({ durationMillis: 172_400 }); });
    expect(screen.getByText(LIMIT_WARNING)).toBeTruthy();
  });

  it('a lock or call is never reported as the 3-minute limit (A11 pass 4 L4)', async () => {
    renderSheet();
    await startListening(60_000);
    await act(async () => { store.set({ isRecording: false, durationMillis: 60_000 }); });
    expect(await screen.findByText(INTERRUPTED_NOTICE)).toBeTruthy();
    expect(screen.queryByText(LIMIT_NOTICE)).toBeNull();
  });

  it("keeps the owner's own Stop & Continue: one stop, then the recording is transcribed", async () => {
    const result = { transcript: 'Conduit is done.' };
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce(result);
    const stop = deferred();
    recorder.stop.mockImplementation(() => stop.promise);
    const props = renderSheet({ autoSubmitOnStop: true });
    await startListening(6_000);

    fireEvent.press(screen.getByText('Stop & Continue'));
    // The status poll sees the recorder stopped before stop() resolves: the owner's
    // Stop already claimed it, so the lock path must not stop or offer it again.
    await act(async () => { nativeStopFinalizes(); });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    await act(async () => { stop.resolve(); });

    await waitFor(() => expect(props.onMemoryReady).toHaveBeenCalledWith(result));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledWith(
      expect.objectContaining({ uri: RECORDING_URI, projectId: PROJECT_ID }),
    );
    expect(screen.queryByText(INTERRUPTED_NOTICE)).toBeNull();
    // The used recording is cleaned up as before.
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(RECORDING_URI, { idempotent: true });
  });
});

describe('DAVEVoiceCaptureSheet F2: an unused recording is not discarded without asking', () => {
  let alert: jest.SpyInstance;
  beforeEach(() => { alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
  afterEach(() => { alert.mockRestore(); });

  it('X after an offline failure asks first; Keep keeps the file, Discard deletes it and closes', async () => {
    const props = renderSheet();
    await recordThenFailOffline();

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Discard this recording?');
    const [keep, discard] = lastAlertButtons(alert);
    expect(keep).toMatchObject({ text: 'Keep', style: 'cancel' });
    expect(discard).toMatchObject({ text: 'Discard', style: 'destructive' });

    await act(async () => { keep.onPress?.(); });
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(screen.getByText('Replay Recording')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    await act(async () => { lastAlertButtons(alert)[1].onPress?.(); });
    await waitFor(() => expect(props.onCancel).toHaveBeenCalledTimes(1));
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(RECORDING_URI, { idempotent: true });
  });

  it('Type Instead after an offline failure asks first; Keep keeps the file, Discard deletes it', async () => {
    const props = renderSheet();
    await recordThenFailOffline();

    fireEvent.press(screen.getByText('Type Instead'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Discard this recording?');
    await act(async () => { lastAlertButtons(alert)[0].onPress?.(); });
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(props.onTypeInstead).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Type Instead'));
    await act(async () => { lastAlertButtons(alert)[1].onPress?.(); });
    await waitFor(() => expect(props.onTypeInstead).toHaveBeenCalledTimes(1));
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(RECORDING_URI, { idempotent: true });
  });

  it('the Create a task operation asks first when a recording is unused', async () => {
    const props = renderSheet();
    await recordThenFailOffline();

    fireEvent.press(screen.getByLabelText('Create a task'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(props.onOperation).not.toHaveBeenCalled();
    await act(async () => { lastAlertButtons(alert)[1].onPress?.(); });
    await waitFor(() => expect(props.onOperation).toHaveBeenCalledTimes(1));
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(RECORDING_URI, { idempotent: true });
  });

  it('the Android back button asks first too', async () => {
    const props = renderSheet();
    await recordThenFailOffline();

    await act(async () => { screen.UNSAFE_getByType(Modal).props.onRequestClose(); });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
    await act(async () => { lastAlertButtons(alert)[1].onPress?.(); });
    await waitFor(() => expect(props.onCancel).toHaveBeenCalledTimes(1));
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(RECORDING_URI, { idempotent: true });
  });

  it('with no recording, X closes at once', async () => {
    const props = renderSheet();

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));

    await waitFor(() => expect(props.onCancel).toHaveBeenCalledTimes(1));
    expect(alert).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  it('while listening, X stops and discards at once as before', async () => {
    const props = renderSheet();
    await startListening(4_000);

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));

    await waitFor(() => expect(props.onCancel).toHaveBeenCalledTimes(1));
    expect(alert).not.toHaveBeenCalled();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(RECORDING_URI, { idempotent: true });
    // The stop's status flip must not resurrect the discarded recording.
    expect(screen.queryByText('Replay Recording')).toBeNull();
  });
});

// Whole-app audit A11 pass 4 M1 (30 Sep 2026): X while "Preparing…" deleted
// the dictation without asking, and a late transcript was thrown away. Type
// Instead is greyed out then, so X was the only way out, and on weak signal
// "Preparing…" can last a minute or more.
describe('DAVEVoiceCaptureSheet A11 pass 4 M1: leaving while a recording is being prepared', () => {
  const STOP_PREPARING = 'Stop preparing this recording?';
  let alert: jest.SpyInstance;
  beforeEach(() => { alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
  afterEach(() => { alert.mockRestore(); });

  async function recordThenPrepare(result: Promise<unknown>) {
    transcription.transcribeDAVECaptureMemoryAudio.mockImplementationOnce(() => result);
    await startListening(8_000);
    fireEvent.press(screen.getByText('Stop & Continue'));
    await screen.findByText('Preparing…');
  }

  function buttonNamed(text: string): AlertButton {
    const button = lastAlertButtons(alert).find(candidate => candidate.text === text);
    if (!button) throw new Error(`No ${text} button`);
    return button;
  }

  it('X asks first: Keep Waiting changes nothing, and the transcript is still used when it arrives', async () => {
    const upload = deferred<{ transcript: string }>();
    const props = renderSheet({ autoSubmitOnStop: true });
    await recordThenPrepare(upload.promise);

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe(STOP_PREPARING);
    expect(alert.mock.calls[0][1]).toBe(
      'It is still being turned into text. You can keep waiting, keep the recording here to try Continue again later, or discard it.',
    );
    expect(lastAlertButtons(alert).map(button => [button.text, button.style])).toEqual([
      ['Keep Waiting', 'cancel'],
      ['Keep Recording for Later', undefined],
      ['Discard', 'destructive'],
    ]);
    await act(async () => { buttonNamed('Keep Waiting').onPress?.(); });
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Preparing…')).toBeTruthy();

    await act(async () => { upload.resolve({ transcript: 'Conduit is done.' }); });
    await waitFor(() => expect(props.onMemoryReady).toHaveBeenCalledWith({ transcript: 'Conduit is done.' }));
  });

  it('the Android back button asks the same', async () => {
    const upload = deferred<{ transcript: string }>();
    const props = renderSheet({ autoSubmitOnStop: true });
    await recordThenPrepare(upload.promise);

    await act(async () => { screen.UNSAFE_getByType(Modal).props.onRequestClose(); });
    expect(alert.mock.calls[0][0]).toBe(STOP_PREPARING);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
    await act(async () => { buttonNamed('Keep Waiting').onPress?.(); });
    await act(async () => { upload.resolve({ transcript: 'Conduit is done.' }); });
  });

  it('Keep Recording for Later stops waiting and keeps the audio; a late transcript waits for the next Continue on that recording', async () => {
    const upload = deferred<{ transcript: string }>();
    const props = renderSheet({ autoSubmitOnStop: true });
    await recordThenPrepare(upload.promise);

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    await act(async () => { buttonNamed('Keep Recording for Later').onPress?.(); });

    expect(screen.queryByText('Preparing…')).toBeNull();
    expect(screen.getByText('Recording ready')).toBeTruthy();
    expect(screen.getByText('Replay Recording')).toBeTruthy();
    expect(screen.getByText('Stopped waiting. The recording is kept here. Tap Continue to try again.')).toBeTruthy();
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();

    // The answer to the request he stopped waiting for arrives: not applied by itself.
    await act(async () => { upload.resolve({ transcript: 'Late words.' }); });
    expect(props.onMemoryReady).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Recording ready')).toBeTruthy();

    // Continue on the same recording uses those words without uploading it again.
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(props.onMemoryReady).toHaveBeenCalledWith({ transcript: 'Late words.' }));
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledTimes(1);
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(RECORDING_URI, { idempotent: true });
  });

  it('a late transcript never lands on a new recording made after Keep Recording for Later', async () => {
    const upload = deferred<{ transcript: string }>();
    const props = renderSheet({ autoSubmitOnStop: true });
    await recordThenPrepare(upload.promise);
    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    await act(async () => { buttonNamed('Keep Recording for Later').onPress?.(); });

    // Record Again replaces the kept recording before the late answer arrives.
    fireEvent.press(screen.getByText('Record Again'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(2));
    await act(async () => { upload.resolve({ transcript: 'Late words.' }); });
    await act(async () => { store.set({ durationMillis: 5_000 }); });
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'New words.' });
    fireEvent.press(screen.getByText('Stop & Continue'));

    await waitFor(() => expect(props.onMemoryReady).toHaveBeenCalledTimes(1));
    expect(props.onMemoryReady).toHaveBeenCalledWith({ transcript: 'New words.' });
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledTimes(2);
  });

  it('Discard deletes the recording and closes; a late transcript is ignored', async () => {
    const upload = deferred<{ transcript: string }>();
    const props = renderSheet({ autoSubmitOnStop: true });
    await recordThenPrepare(upload.promise);

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    await act(async () => { buttonNamed('Discard').onPress?.(); });
    await waitFor(() => expect(props.onCancel).toHaveBeenCalledTimes(1));
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(RECORDING_URI, { idempotent: true });

    await act(async () => { upload.resolve({ transcript: 'Late words.' }); });
    expect(props.onMemoryReady).not.toHaveBeenCalled();
  });
});

// Whole-app audit A11 pass 4 L1 (30 Sep 2026): "offline, sign-in pending"
// voice said "Sign in before transcribing a recorded memory."
describe('DAVEVoiceCaptureSheet A11 pass 4 L1: no signal while the sign-in waits', () => {
  it('says no signal, names its own button, keeps the recording, and tells the service whether the sign-in waits', async () => {
    const { NativeWorkspaceSignInPendingContext } = require('../../components/native-workspace-owner');
    const { daveVoiceWaitingForSignalError } = require('../../services/DAVEVoiceSignalWait');
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    const onMemoryReady = jest.fn();
    render(
      <NativeWorkspaceSignInPendingContext.Provider value>
        <DAVEVoiceCaptureSheet
          visible projectId={PROJECT_ID} projectName="Canopy Project" candidateLocations={[]}
          title="Record Field Note" continueLabel="Use Note"
          onMemoryReady={onMemoryReady} onTypeInstead={jest.fn()} onCancel={jest.fn()}
        />
      </NativeWorkspaceSignInPendingContext.Provider>,
    );
    await startListening(8_000);
    fireEvent.press(screen.getByText('Stop Recording'));
    await screen.findByText('Replay Recording');
    fireEvent.press(screen.getByText('Use Note'));

    expect(await screen.findByText('No signal. Your recording is kept — tap Use Note when you have signal.')).toBeTruthy();
    expect(screen.getByText('Recording ready')).toBeTruthy();
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(onMemoryReady).not.toHaveBeenCalled();
    const { signInPending } = transcription.transcribeDAVECaptureMemoryAudio.mock.calls[0][0];
    expect(signInPending()).toBe(true);
  });
});
