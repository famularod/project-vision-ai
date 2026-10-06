import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, Modal } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';

// Review N2 follow-up (5 Oct 2026; the start and cancel code is as old as
// Build 229). X tapped in the moment between Start Recording and the recorder
// actually starting closed the sheet, and the recorder then started anyway:
// the microphone went on recording behind the closed sheet, to the 3-minute
// limit, and that recording was then kept on the device. The same when the
// sheet's own screen hid it, or took it away, with the recorder starting or
// recording.
//
// The microphone must never stay on behind a closed sheet, in any order of
// taps and answers. Here every way a sheet closes is driven against every
// moment of a slow start. (What a close without his Cancel keeps of a
// recording that was going is in review-n2-voice-closed-sheet-keeps-dictation.) The stand-in recorder has a microphone of its own
// (on from record() until stop(), whatever the app believes), can be slow at
// each step, and can report "recording" late, as the real one does (the
// sheet asks it every 200 ms). Setting the audio mode does not stop it, as on
// Android: only stop() does.

jest.setTimeout(20_000);

type MockStatus = { canRecord: boolean; isRecording: boolean; durationMillis: number; mediaServicesDidReset: boolean; url: string | null };
type MockDevice = { microphoneOn: boolean; allowsRecording: boolean; reportsLate: boolean };

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
  const device: MockDevice = { microphoneOn: false, allowsRecording: false, reportsLate: false };
  const recorder = {
    id: 'mock-recorder', uri: null as string | null, currentTime: 0,
    prepareToRecordAsync: jest.fn(), record: jest.fn(), stop: jest.fn(), getStatus: jest.fn(() => store.status),
  };
  return {
    __mock: { store, recorder, device },
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: jest.fn(),
    setAudioModeAsync: jest.fn(),
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
  __mock: {
    store: { status: MockStatus; set: (next: Partial<MockStatus>) => void };
    recorder: { uri: string | null; prepareToRecordAsync: jest.Mock; record: jest.Mock; stop: jest.Mock; getStatus: jest.Mock };
    device: MockDevice;
  };
  requestRecordingPermissionsAsync: jest.Mock;
  setAudioModeAsync: jest.Mock;
};
const { store, recorder, device } = audio.__mock;
const transcription = jest.requireMock('../../services/DAVEVoiceTranscriptionService') as { transcribeDAVECaptureMemoryAudio: jest.Mock };
const phoneFiles = jest.requireMock('expo-file-system/legacy') as { deleteAsync: jest.Mock };
const phoneStorage = jest.requireMock('@react-native-async-storage/async-storage') as { getAllKeys: jest.Mock };
const deleteFile = phoneFiles.deleteAsync.getMockImplementation() as (...args: never[]) => unknown;
const listKeys = phoneStorage.getAllKeys.getMockImplementation() as (...args: never[]) => unknown;

const RECORDER_FILE = 'file:///cache/Audio/recording-1.m4a';
const KEPT_FOLDER = 'file:///documents/kept-recordings/';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const COULD_NOT_START = 'Recording could not start. Try again or type the memory instead.';
const keptFiles = () => [...mockFiles].filter(file => file.startsWith(KEPT_FOLDER));
const entryKeys = () => [...mockStorage.keys()].filter(key => key.includes('/voice-recording/'));
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => { await pause(ms); });

type Hold = { reached: Promise<void>; release: () => void };
/** Every slow step a test made, so none is left waiting when the test ends. */
const holds: Hold[] = [];
/** The next call of `step` is slow: it waits until `release`, then does what it does. */
function hold(step: jest.Mock, then: (...args: never[]) => unknown): Hold {
  let reachedNow: () => void = () => undefined;
  let release: () => void = () => undefined;
  const reached = new Promise<void>(resolve => { reachedNow = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  step.mockImplementationOnce(async (...args: never[]) => {
    reachedNow();
    await gate;
    return then(...args);
  });
  const made = { reached, release };
  holds.push(made);
  return made;
}

const microphoneAllowed = async () => ({ granted: true });
const audioModeSet = async (mode: { allowsRecording?: boolean }) => { device.allowsRecording = Boolean(mode.allowsRecording); };
const recorderReady = async () => {
  recorder.uri = RECORDER_FILE;
  mockFiles.add(RECORDER_FILE);
  // The sheet learns of it when it next asks (every 200 ms); here at once, unless the test says later.
  if (!device.reportsLate) store.set({ canRecord: true, url: RECORDER_FILE });
};
/** The sheet asks the recorder how it is, and is told: its file, and what its microphone is doing. */
const recorderReports = () => act(async () => {
  store.set({ canRecord: recorder.uri !== null, url: recorder.uri, isRecording: device.microphoneOn });
});

beforeEach(() => {
  mockFiles.clear();
  mockStorage.clear();
  store.status = { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null };
  recorder.uri = null;
  device.microphoneOn = false;
  device.allowsRecording = false;
  device.reportsLate = false;
  audio.requestRecordingPermissionsAsync.mockReset();
  audio.requestRecordingPermissionsAsync.mockImplementation(microphoneAllowed);
  audio.setAudioModeAsync.mockReset();
  audio.setAudioModeAsync.mockImplementation(audioModeSet);
  recorder.prepareToRecordAsync.mockReset();
  recorder.prepareToRecordAsync.mockImplementation(recorderReady);
  recorder.record.mockReset();
  recorder.record.mockImplementation(() => {
    device.microphoneOn = true;
    if (!device.reportsLate) store.set({ isRecording: true, durationMillis: 0 });
  });
  recorder.stop.mockReset();
  recorder.stop.mockImplementation(async () => {
    device.microphoneOn = false;
    store.set({ isRecording: false, durationMillis: 0 });
  });
  // Asked directly, the recorder says what its microphone is doing now.
  recorder.getStatus.mockImplementation(() => ({ ...store.status, isRecording: device.microphoneOn }));
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
  phoneFiles.deleteAsync.mockReset();
  phoneFiles.deleteAsync.mockImplementation(deleteFile);
  phoneStorage.getAllKeys.mockReset();
  phoneStorage.getAllKeys.mockImplementation(listKeys);
  (AppState as { currentState: unknown }).currentState = 'active';
});

const called = { cancel: jest.fn(), typeInstead: jest.fn(), task: jest.fn() };
let screenControls: { open: () => void; hide: () => void } = { open: () => undefined, hide: () => undefined };
let view: ReturnType<typeof render> | null = null;
afterEach(async () => {
  view?.unmount();
  view = null;
  // Nothing a test left waiting runs on into the next.
  holds.splice(0).forEach(made => made.release());
  await pause();
});

/** A screen that owns a voice sheet as the app's screens do: it stays in place and is shown or hidden. */
function ScreenWithVoiceSheet({ keepSlot }: { keepSlot?: string }) {
  const [open, setOpen] = useState(true);
  screenControls = { open: () => setOpen(true), hide: () => setOpen(false) };
  return (
    <NativeWorkspaceOwnerContext.Provider value="owner-a">
      <DAVEVoiceCaptureSheet
        visible={open}
        projectId={PROJECT_ID}
        projectName="Canopy Project"
        candidateLocations={[]}
        title="Talk"
        continueLabel="Continue"
        operationLabel="Create a task"
        keepSlot={keepSlot}
        onMemoryReady={jest.fn()}
        onOperation={() => { called.task(); setOpen(false); }}
        onTypeInstead={() => { called.typeInstead(); setOpen(false); }}
        onCancel={() => { called.cancel(); setOpen(false); }}
      />
    </NativeWorkspaceOwnerContext.Provider>
  );
}

async function openScreen(keepSlot: string | undefined = 'talk') {
  view?.unmount();
  view = render(<ScreenWithVoiceSheet keepSlot={keepSlot} />);
  // The kept-recording check has answered (nothing is kept).
  await settle();
}

type Way = Readonly<{ name: string; close: () => Promise<void>; told: jest.Mock | null; taken?: boolean }>;
/** Every way a voice sheet closes. */
const WAYS: readonly Way[] = [
  { name: 'X', told: called.cancel, close: async () => { await act(async () => { fireEvent.press(screen.getByLabelText('Cancel memory capture')); }); } },
  {
    name: 'the system\'s back (Android)',
    told: called.cancel,
    close: async () => { await act(async () => { screen.UNSAFE_getByType(Modal).props.onRequestClose(); }); },
  },
  { name: 'Type Instead', told: called.typeInstead, close: async () => { await act(async () => { fireEvent.press(screen.getByText('Type Instead')); }); } },
  { name: 'Create a task', told: called.task, close: async () => { await act(async () => { fireEvent.press(screen.getByLabelText('Create a task')); }); } },
  { name: 'its screen hides the sheet', told: null, close: async () => { await act(async () => { screenControls.hide(); }); } },
  { name: 'its screen is taken away (an account or screen change)', told: null, taken: true, close: async () => { await act(async () => { view?.unmount(); view = null; }); } },
];

type Moment = Readonly<{ name: string; reach: () => Promise<Hold | null>; recordReached: boolean }>;
/** Every moment of a start, each made slow. */
const MOMENTS: readonly Moment[] = [
  {
    name: 'the phone is asked for the microphone',
    recordReached: false,
    reach: async () => hold(audio.requestRecordingPermissionsAsync, microphoneAllowed),
  },
  {
    name: 'the audio mode is being set',
    recordReached: false,
    reach: async () => hold(audio.setAudioModeAsync, audioModeSet as never),
  },
  {
    name: 'the recorder is getting ready',
    recordReached: false,
    reach: async () => hold(recorder.prepareToRecordAsync, recorderReady),
  },
  {
    name: 'the recorder has started but has not yet said so',
    recordReached: true,
    reach: async () => { device.reportsLate = true; return null; },
  },
];

/** Nothing was recorded, kept or left for later; the microphone is off and released. */
function expectNothingBehindTheClosedSheet() {
  expect(device.microphoneOn).toBe(false);
  expect(device.allowsRecording).toBe(false);
  expect(mockFiles.has(RECORDER_FILE)).toBe(false);
  expect(keptFiles()).toEqual([]);
  expect(entryKeys()).toEqual([]);
  expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
}

describe.each(MOMENTS)('review N2 follow-up: the sheet closes while $name', moment => {
  it.each(WAYS)('by $name: the microphone is not on behind it, nothing is kept, and nothing is offered later', async way => {
    await openScreen();
    const slow = await moment.reach();
    fireEvent.press(screen.getByText('Start Recording'));
    if (slow) await act(async () => { await slow.reached; });
    else await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
    expect(device.microphoneOn).toBe(moment.recordReached);

    await way.close();
    await settle();
    if (way.told) expect(way.told).toHaveBeenCalledTimes(1);
    // A recorder that had started is stopped at once.
    expect(device.microphoneOn).toBe(false);

    // The slow step answers now, with the sheet closed; then the recorder reports.
    await act(async () => { slow?.release(); await pause(); });
    await recorderReports();
    await settle();
    expect(recorder.record).toHaveBeenCalledTimes(moment.recordReached ? 1 : 0);
    expectNothingBehindTheClosedSheet();
    // Had it been left running, it would have ended by itself at the limit and been kept. It is not running.
    await act(async () => { store.set({ durationMillis: 180_000 }); });
    await settle();
    expectNothingBehindTheClosedSheet();

    // The sheet opened again offers nothing, and records as usual.
    device.reportsLate = false;
    if (way.taken) await openScreen();
    else await act(async () => { screenControls.open(); await pause(); });
    expect(screen.queryByText('Recording ready')).toBeNull();
    expect(screen.queryByText(/^Kept from /)).toBeNull();
    expect(screen.queryByText(COULD_NOT_START)).toBeNull();
    recorder.record.mockClear();
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
    expect(device.microphoneOn).toBe(true);
    expect(await screen.findByText('Stop Recording')).toBeTruthy();
  });
});

describe('review N2 follow-up: Vitruvius goes to the background while the recorder is starting', () => {
  it.each(MOMENTS.filter(moment => !moment.recordReached))('while $name: the recorder does not start; he is told, and Start Recording works when he is back', async moment => {
    await openScreen();
    const slow = await moment.reach();
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => { await slow?.reached; });
    (AppState as { currentState: unknown }).currentState = 'background';
    await act(async () => { slow?.release(); await pause(); });
    expect(recorder.record).not.toHaveBeenCalled();
    expectNothingBehindTheClosedSheet();
    // The sheet is still open: it says so, in the words it already had.
    expect(screen.getByText(COULD_NOT_START)).toBeTruthy();

    (AppState as { currentState: unknown }).currentState = 'active';
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
    expect(device.microphoneOn).toBe(true);
  });

  it('the phone\'s own microphone question (Vitruvius is "inactive" behind it, not in the background) does not stop the start', async () => {
    await openScreen();
    const question = hold(audio.requestRecordingPermissionsAsync, microphoneAllowed);
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => { await question.reached; });
    (AppState as { currentState: unknown }).currentState = 'inactive';
    await act(async () => { question.release(); await pause(); });
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(device.microphoneOn).toBe(true);
    expect(screen.getByText('Stop Recording')).toBeTruthy();
  });
});

/**
 * The microphone is off and released, the recorder's own file is gone, and what he had dictated is
 * kept on the device once (decision after pass 3, 5 Oct 2026: a recording still going when the
 * sheet closes without his Cancel is stopped at once and then kept; it was dropped here. What is kept,
 * for whom and how it is offered is in review-n2-voice-closed-sheet-keeps-dictation).
 */
function expectMicrophoneOffAndDictationKept() {
  expect(device.microphoneOn).toBe(false);
  expect(device.allowsRecording).toBe(false);
  expect(mockFiles.has(RECORDER_FILE)).toBe(false);
  expect(keptFiles()).toHaveLength(1);
  expect(entryKeys()).toHaveLength(1);
  expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
}

describe('review N2 follow-up: the sheet closes while a recording is going', () => {
  it.each(WAYS.filter(way => way.told === null))('$name (not his Cancel): the recorder is stopped at once, and what he had dictated is kept for next time', async way => {
    await openScreen();
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Stop Recording')).toBeTruthy();
    await act(async () => { store.set({ durationMillis: 12_000 }); });
    expect(device.microphoneOn).toBe(true);

    await way.close();
    // Stopped in the same step as the sheet goes, before anything is kept.
    expect(device.microphoneOn).toBe(false);
    expect(recorder.stop).toHaveBeenCalled();
    await settle();
    expectMicrophoneOffAndDictationKept();
  });

  it('X while it is going still stops and discards it, as before', async () => {
    await openScreen();
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Stop Recording')).toBeTruthy();
    await act(async () => { store.set({ durationMillis: 12_000 }); });
    await WAYS[0].close();
    await settle();
    expect(called.cancel).toHaveBeenCalledTimes(1);
    expectNothingBehindTheClosedSheet();
  });
});

describe('review N2 follow-up: the sheet closes while the recorder is stopping, and the stop fails', () => {
  /** The recorder is slow to stop, and then does not: its microphone stays on. */
  const stopThatFails = () => hold(recorder.stop, (async () => { throw new Error('The recorder did not stop.'); }) as never);

  async function recordingForTwelveSeconds() {
    await openScreen();
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Stop Recording')).toBeTruthy();
    await act(async () => { store.set({ durationMillis: 12_000 }); });
  }

  it.each(WAYS)('closed by $name: the recorder is asked to stop again, and the microphone goes off', async way => {
    await recordingForTwelveSeconds();
    const stopping = stopThatFails();
    fireEvent.press(screen.getByText('Stop Recording'));
    await act(async () => { await stopping.reached; });
    // The recorder has said it is no longer recording (so Type Instead shows), but has not finished stopping.
    await act(async () => { store.set({ isRecording: false }); });
    await way.close();
    await act(async () => { stopping.release(); await pause(); });
    await settle();
    expect(device.microphoneOn).toBe(false);
    expectNothingBehindTheClosedSheet();
  });

  it('the stop fails with the sheet open, and its screen then hides the sheet: the recorder, still going, is stopped, and what he had dictated is kept', async () => {
    await recordingForTwelveSeconds();
    const stopping = stopThatFails();
    fireEvent.press(screen.getByText('Stop Recording'));
    await act(async () => { await stopping.reached; });
    await act(async () => { stopping.release(); await pause(); });
    expect(screen.getByText('The recording could not finish. Try again.')).toBeTruthy();
    expect(device.microphoneOn).toBe(true);

    await act(async () => { screenControls.hide(); });
    expect(device.microphoneOn).toBe(false);
    await settle();
    expectMicrophoneOffAndDictationKept();
  });
});

describe('review N2 follow-up: orders in which the old recorder and a new tap meet', () => {
  it('the slow step answers while his Cancel is still finishing: the recorder never starts', async () => {
    await openScreen();
    const ready = hold(recorder.prepareToRecordAsync, recorderReady);
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => { await ready.reached; });
    // His Cancel first sets the audio mode back, and the phone is slow to: the sheet is still open meanwhile.
    const settingBack = hold(audio.setAudioModeAsync, audioModeSet as never);
    await act(async () => { fireEvent.press(screen.getByLabelText('Cancel memory capture')); await settingBack.reached; });
    expect(called.cancel).not.toHaveBeenCalled();
    await act(async () => { ready.release(); await pause(); });
    expect(recorder.record).not.toHaveBeenCalled();
    expect(device.microphoneOn).toBe(false);
    await act(async () => { settingBack.release(); await pause(); });
    expect(called.cancel).toHaveBeenCalledTimes(1);
    expectNothingBehindTheClosedSheet();
  });

  it('he cancels just after the recorder started (it has not yet said so), and his Cancel is slow to finish: the recorder is stopped first', async () => {
    await openScreen();
    device.reportsLate = true;
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
    expect(device.microphoneOn).toBe(true);
    const settingBack = hold(audio.setAudioModeAsync, audioModeSet as never);
    await act(async () => { fireEvent.press(screen.getByLabelText('Cancel memory capture')); await settingBack.reached; });
    // The sheet is still open (his Cancel has not finished), and the microphone is already off.
    expect(called.cancel).not.toHaveBeenCalled();
    expect(device.microphoneOn).toBe(false);
    await act(async () => { settingBack.release(); await pause(); });
    expect(called.cancel).toHaveBeenCalledTimes(1);
    expectNothingBehindTheClosedSheet();
  });

  it('its screen hides the sheet and shows it again before the slow step answers: that start does not go on', async () => {
    await openScreen();
    const ready = hold(recorder.prepareToRecordAsync, recorderReady);
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => { await ready.reached; });
    await act(async () => { screenControls.hide(); });
    await act(async () => { screenControls.open(); await pause(); });
    await act(async () => { ready.release(); await pause(); });
    expect(recorder.record).not.toHaveBeenCalled();
    expectNothingBehindTheClosedSheet();
    // The sheet he sees is idle, and a start he asks for now records.
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
    expect(device.microphoneOn).toBe(true);
  });

  it('the sheet is shown again while the recorder it left is still stopping: Start Recording waits for it', async () => {
    await openScreen();
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Stop Recording')).toBeTruthy();
    await act(async () => { store.set({ durationMillis: 12_000 }); });
    // The recorder says at once that it is no longer recording, and is slow to finish stopping.
    const stopping = hold(recorder.stop, (async () => { device.microphoneOn = false; }) as never);
    await act(async () => { screenControls.hide(); });
    await act(async () => { await stopping.reached; store.set({ isRecording: false, durationMillis: 0 }); });
    await act(async () => { screenControls.open(); await pause(); });
    fireEvent.press(screen.getByText('Start Recording'));
    await settle();
    // Not a second start on top of the stop: the phone was asked for the microphone once, by the first.
    expect(audio.requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(recorder.record).toHaveBeenCalledTimes(1);

    await act(async () => { stopping.release(); await pause(); });
    expectMicrophoneOffAndDictationKept();
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(2));
    expect(device.microphoneOn).toBe(true);
    expect(device.allowsRecording).toBe(true);
    expect(mockFiles.has(RECORDER_FILE)).toBe(true);
    // The one kept from before is untouched by the new recording.
    expect(keptFiles()).toHaveLength(1);
  });

  it('the sheet is shown again while a start it let go is still being put back: Start Recording waits for it', async () => {
    await openScreen();
    const ready = hold(recorder.prepareToRecordAsync, recorderReady);
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => { await ready.reached; });
    await act(async () => { screenControls.hide(); });
    // Putting the recorder back begins with stopping it, and the phone is slow to.
    const puttingBack = hold(recorder.stop, (async () => undefined) as never);
    await act(async () => { ready.release(); await puttingBack.reached; });
    await act(async () => { screenControls.open(); await pause(); });
    fireEvent.press(screen.getByText('Start Recording'));
    await settle();
    expect(audio.requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(recorder.record).not.toHaveBeenCalled();

    await act(async () => { puttingBack.release(); await pause(); });
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
    expect(device.microphoneOn).toBe(true);
    expect(device.allowsRecording).toBe(true);
    expect(mockFiles.has(RECORDER_FILE)).toBe(true);
  });
});

describe('review N2 follow-up: a start that was let go leaves the sheet and the phone as they were', () => {
  it('the microphone mode a slow start sets after his Cancel is put back, and the recorder\'s unused file is removed', async () => {
    await openScreen();
    const mode = hold(audio.setAudioModeAsync, audioModeSet as never);
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => { await mode.reached; });
    await WAYS[0].close();
    await settle();
    // His Cancel has already set the mode back; the slow step now sets it to recording.
    expect(device.allowsRecording).toBe(false);
    await act(async () => { mode.release(); await pause(); });
    expect(device.allowsRecording).toBe(false);
    expect(recorder.prepareToRecordAsync).not.toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();

    const ready = hold(recorder.prepareToRecordAsync, recorderReady);
    await act(async () => { screenControls.open(); await pause(); });
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => { await ready.reached; });
    await WAYS[0].close();
    await act(async () => { ready.release(); await pause(); });
    expect(mockFiles.has(RECORDER_FILE)).toBe(false);
    expectNothingBehindTheClosedSheet();
  });

  it('the phone is not asked for the microphone once the sheet has closed', async () => {
    // A recording is ready in a sheet that keeps nothing on the device.
    await openScreen(undefined);
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Stop Recording')).toBeTruthy();
    await act(async () => { store.set({ durationMillis: 5_000 }); });
    fireEvent.press(screen.getByText('Stop Recording'));
    await screen.findByText('Replay Recording');
    audio.requestRecordingPermissionsAsync.mockClear();
    recorder.record.mockClear();

    // Record Again first clears the last recording's file; the phone is slow to, and the screen hides the sheet meanwhile.
    const clearing = hold(phoneFiles.deleteAsync, deleteFile);
    fireEvent.press(screen.getByText('Record Again'));
    await act(async () => { await clearing.reached; });
    await act(async () => { screenControls.hide(); });
    await act(async () => { clearing.release(); await pause(); });
    expect(audio.requestRecordingPermissionsAsync).not.toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();
    expect(device.microphoneOn).toBe(false);
  });

  it('a start let go with a recording kept for this project leaves that recording kept, and it is offered the next time', async () => {
    // An earlier session: a recording finished and kept on the device.
    await openScreen('ask');
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Stop Recording')).toBeTruthy();
    await act(async () => { store.set({ durationMillis: 9_000 }); });
    fireEvent.press(screen.getByText('Stop Recording'));
    await screen.findByText('Replay Recording');
    await waitFor(() => expect(keptFiles()).toHaveLength(1));
    const [keptAudio] = keptFiles();
    view?.unmount();
    view = null;
    mockFiles.delete(RECORDER_FILE);
    store.status = { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null };
    recorder.record.mockClear();

    // The next session: slow phone storage, Start Recording first, then X while the recorder is getting ready.
    const keptCheck = hold(phoneStorage.getAllKeys, listKeys);
    const ready = hold(recorder.prepareToRecordAsync, recorderReady);
    view = render(<ScreenWithVoiceSheet keepSlot="ask" />);
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => { await ready.reached; });
    await WAYS[0].close();
    await act(async () => { keptCheck.release(); ready.release(); await pause(); });
    expect(recorder.record).not.toHaveBeenCalled();
    expect(device.microphoneOn).toBe(false);
    expect(keptFiles()).toEqual([keptAudio]);
    expect(entryKeys()).toHaveLength(1);

    await act(async () => { screenControls.open(); await pause(); });
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    expect(screen.getByText(/^Kept from /)).toBeTruthy();
  });
});
