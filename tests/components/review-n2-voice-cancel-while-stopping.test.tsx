import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Alert, AppState, Modal } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { readKeptVoiceRecording } from '../../services/KeptVoiceRecording';

// Review N2 follow-up (5 Oct 2026). X tapped while a recording was being
// stopped: the sheet closed, and when the recorder had stopped, the recording
// was put into the closed sheet with its file already deleted.
//
// A sheet that was closed is handed nothing, and no entry is left that
// points at a missing file. Which side of review N1's rule ("a finished
// recording he did not discard is kept on the device") a close during the
// stop falls on follows what he pressed:
// - X is Cancel (as are the system's back, Type Instead and the task
//   button): the recording he was stopping is discarded, as X while
//   listening discards. "Close and Keep on This Device" is the control that
//   keeps, and it is offered once the recording is ready.
// - The sheet closed under the stop without his Cancel (its screen hid it or
//   took it away): he had stopped a recording and did not discard it, so a
//   sheet that keeps recordings keeps it on the device, for the next time it
//   opens for that project. The closed sheet itself is still handed nothing.
// The stand-in recorder is slow to stop (see
// review-n2-voice-closed-sheet-microphone for the stand-in).

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

const called = { cancel: jest.fn(), typeInstead: jest.fn(), task: jest.fn(), words: jest.fn() };
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
function ScreenWithVoiceSheet({ keepSlot, sendsOnStop = false }: { keepSlot?: string; sendsOnStop?: boolean }) {
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
        autoSubmitOnStop={sendsOnStop}
        onMemoryReady={called.words}
        onOperation={() => { called.task(); setOpen(false); }}
        onTypeInstead={() => { called.typeInstead(); setOpen(false); }}
        onCancel={() => { called.cancel(); setOpen(false); }}
      />
    </NativeWorkspaceOwnerContext.Provider>
  );
}

type Sheet = Readonly<{ name: string; keepSlot?: string; sendsOnStop?: boolean }>;
/** The kinds of voice sheet the app has. */
const KEEPS: Sheet = { name: 'a sheet that keeps recordings on the device (Talk)', keepSlot: 'talk' };
const KEEPS_AND_SENDS: Sheet = { name: 'a dictation sheet that sends by itself on Stop (Field Notes)', keepSlot: 'field-note', sendsOnStop: true };
const KEEPS_NOTHING: Sheet = { name: 'a sheet that keeps nothing on the device (task fill)' };

async function openScreen(sheet: Sheet = KEEPS) {
  view?.unmount();
  view = render(<ScreenWithVoiceSheet keepSlot={sheet.keepSlot} sendsOnStop={sheet.sendsOnStop} />);
  // The kept-recording check has answered.
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

const CANCELS = WAYS.filter(way => way.told !== null);
const CLOSES_BY_ITSELF = WAYS.filter(way => way.told === null);
const stopLabel = (sheet: Sheet) => (sheet.sendsOnStop ? 'Stop & Continue' : 'Stop Recording');

/** He has been recording for `seconds`, taps Stop, and the recorder is slow to stop. */
async function stoppingARecording(sheet: Sheet, seconds = 12) {
  await openScreen(sheet);
  fireEvent.press(screen.getByText('Start Recording'));
  expect(await screen.findByText(stopLabel(sheet))).toBeTruthy();
  await act(async () => { store.set({ durationMillis: seconds * 1_000 }); });
  const stopping = hold(recorder.stop, (async () => { device.microphoneOn = false; }) as never);
  fireEvent.press(screen.getByText(stopLabel(sheet)));
  await act(async () => { await stopping.reached; });
  // The recorder says it is no longer recording (so Type Instead shows), and has not finished stopping.
  await act(async () => { store.set({ isRecording: false }); });
  return stopping;
}

/** The sheet opened again (the same screen, or a new one when it was taken away). */
async function openAgain(way: Way, sheet: Sheet) {
  if (way.taken) await openScreen(sheet);
  else await act(async () => { screenControls.open(); await pause(); });
}

function expectNothingKeptOrHandedOver() {
  expect(device.microphoneOn).toBe(false);
  expect(device.allowsRecording).toBe(false);
  expect(mockFiles.has(RECORDER_FILE)).toBe(false);
  expect(keptFiles()).toEqual([]);
  expect(entryKeys()).toEqual([]);
  expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
  expect(called.words).not.toHaveBeenCalled();
}

describe.each([KEEPS, KEEPS_AND_SENDS, KEEPS_NOTHING])('review N2 follow-up: he cancels while the recorder is stopping, in $name', sheet => {
  it.each(CANCELS)('$name: the closed sheet is handed nothing, the recording is discarded, and nothing is offered later', async way => {
    const stopping = await stoppingARecording(sheet);
    await way.close();
    await act(async () => { stopping.release(); await pause(); });
    await settle();
    expect(way.told).toHaveBeenCalledTimes(1);
    expectNothingKeptOrHandedOver();

    await openAgain(way, sheet);
    expect(screen.queryByText('Recording ready')).toBeNull();
    expect(screen.queryByText('Replay Recording')).toBeNull();
    expect(screen.queryByText(/^Kept from /)).toBeNull();
    expectNothingKeptOrHandedOver();
    // And it records again as usual.
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(stopLabel(sheet))).toBeTruthy();
  });
});

describe('review N2 follow-up: his Cancel and the recorder\'s stop land in other orders', () => {
  it('the recorder finishes stopping while his Cancel is still under way (the audio mode is slow to set back): discarded, nothing kept', async () => {
    const stopping = await stoppingARecording(KEEPS);
    const settingBack = hold(audio.setAudioModeAsync, audioModeSet as never);
    await act(async () => { fireEvent.press(screen.getByLabelText('Cancel memory capture')); await settingBack.reached; });
    // The sheet is still open: his Cancel has not finished, and the recorder's file is still there.
    expect(called.cancel).not.toHaveBeenCalled();
    expect(mockFiles.has(RECORDER_FILE)).toBe(true);
    await act(async () => { stopping.release(); await pause(); });
    expect(screen.queryByText('Recording ready')).toBeNull();
    expect(keptFiles()).toEqual([]);
    expect(entryKeys()).toEqual([]);
    await act(async () => { settingBack.release(); await pause(); });
    await settle();
    expect(called.cancel).toHaveBeenCalledTimes(1);
    expectNothingKeptOrHandedOver();
  });

  it('the phone refuses once to delete the recorder\'s file when he cancels; the stop then lands behind the closed sheet: still discarded, nothing kept', async () => {
    const stopping = await stoppingARecording(KEEPS);
    phoneFiles.deleteAsync.mockImplementationOnce(async () => { throw new Error('The phone could not delete the file.'); });
    await WAYS[0].close();
    await settle();
    expect(called.cancel).toHaveBeenCalledTimes(1);
    expect(mockFiles.has(RECORDER_FILE)).toBe(true);
    await act(async () => { stopping.release(); await pause(); });
    await settle();
    expectNothingKeptOrHandedOver();
  });
});

describe('review N2 follow-up: the sheet closes under the stop without his Cancel', () => {
  it.each(CLOSES_BY_ITSELF)('$name, a sheet that keeps recordings: the recording he stopped is kept on the device, and offered the next time; the closed sheet is handed nothing', async way => {
    const stopping = await stoppingARecording(KEEPS);
    await way.close();
    await settle();
    // Not kept before the recorder has finished: nothing points at a file that is not there yet.
    expect(entryKeys()).toEqual([]);
    await act(async () => { stopping.release(); await pause(); });
    await settle();

    expect(device.microphoneOn).toBe(false);
    expect(device.allowsRecording).toBe(false);
    expect(keptFiles()).toHaveLength(1);
    expect(entryKeys()).toHaveLength(1);
    // Its entry points at audio that is there; the recorder's own file is gone.
    const kept = await readKeptVoiceRecording('owner-a', 'talk', 'Canopy Project');
    expect(kept).toMatchObject({ uri: keptFiles()[0], durationMs: 12_000, projectName: 'Canopy Project', state: 'ready' });
    expect(mockFiles.has(RECORDER_FILE)).toBe(false);
    expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
    expect(called.words).not.toHaveBeenCalled();

    // The next time the sheet opens it is offered, and left for him to use.
    await openAgain(way, KEEPS);
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    expect(screen.getByText(/^Kept from .*\. Replay it, then tap Continue to use it, or record again\.$/)).toBeTruthy();
    expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'Rebar passed.' });
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(keptFiles()).toEqual([]));
    expect(entryKeys()).toEqual([]);
  });

  it.each(CLOSES_BY_ITSELF)('$name, a dictation sheet that sends by itself on Stop: kept, and not sent from behind the closed sheet', async way => {
    const stopping = await stoppingARecording(KEEPS_AND_SENDS);
    await way.close();
    await act(async () => { stopping.release(); await pause(); });
    await settle();
    expect(keptFiles()).toHaveLength(1);
    await expect(readKeptVoiceRecording('owner-a', 'field-note', 'Canopy Project')).resolves.toMatchObject({ state: 'ready', durationMs: 12_000 });
    expect(mockFiles.has(RECORDER_FILE)).toBe(false);
    expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
    expect(called.words).not.toHaveBeenCalled();
  });

  it.each(CLOSES_BY_ITSELF)('$name, a sheet that keeps nothing on the device: it has nowhere to keep it, and the closed sheet is handed nothing', async way => {
    const stopping = await stoppingARecording(KEEPS_NOTHING);
    await way.close();
    await act(async () => { stopping.release(); await pause(); });
    await settle();
    expectNothingKeptOrHandedOver();
    await openAgain(way, KEEPS_NOTHING);
    expect(screen.queryByText('Recording ready')).toBeNull();
    expect(screen.getByText('Start Recording')).toBeTruthy();
  });

  it('a recording too short to use is not kept', async () => {
    const stopping = await stoppingARecording(KEEPS, 0.4);
    await act(async () => { screenControls.hide(); });
    await act(async () => { stopping.release(); await pause(); });
    await settle();
    expectNothingKeptOrHandedOver();
  });
});

describe('review N2 follow-up: around the stop', () => {
  it('he discards a recording in the moment before a sheet that sends by itself would have sent it: it is not sent', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await openScreen(KEEPS_AND_SENDS);
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Stop & Continue')).toBeTruthy();
    await act(async () => { store.set({ durationMillis: 12_000 }); });
    // The stop's last step (setting the audio mode back) is slow: the recording is in the sheet, not yet sent.
    const lastStep = hold(audio.setAudioModeAsync, audioModeSet as never);
    fireEvent.press(screen.getByText('Stop & Continue'));
    await act(async () => { await lastStep.reached; });
    // X now asks, as for any finished recording; he chooses Discard.
    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] ?? [];
    await act(async () => { buttons.find(button => button.text === 'Discard')?.onPress?.(); await pause(); });
    await act(async () => { lastStep.release(); await pause(); });
    await settle();
    expect(called.cancel).toHaveBeenCalledTimes(1);
    expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
    expect(called.words).not.toHaveBeenCalled();
    expect(keptFiles()).toEqual([]);
    expect(entryKeys()).toEqual([]);
    expect(mockFiles.has(RECORDER_FILE)).toBe(false);
    alert.mockRestore();
  });

  it('a recording that has finished is still asked about: Keep, Close and Keep on This Device, or Discard', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await openScreen(KEEPS);
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Stop Recording')).toBeTruthy();
    await act(async () => { store.set({ durationMillis: 12_000 }); });
    fireEvent.press(screen.getByText('Stop Recording'));
    await screen.findByText('Replay Recording');
    await waitFor(() => expect(keptFiles()).toHaveLength(1));
    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    expect(alert).toHaveBeenCalledWith('Discard this recording?', expect.any(String), expect.any(Array));
    const buttons = (alert.mock.calls[alert.mock.calls.length - 1][2] ?? []).map(button => button.text);
    expect(buttons).toEqual(['Keep', 'Close and Keep on This Device', 'Discard']);
    expect(called.cancel).not.toHaveBeenCalled();
    expect(keptFiles()).toHaveLength(1);
    alert.mockRestore();
  });
});
