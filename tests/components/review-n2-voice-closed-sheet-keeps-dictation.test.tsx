import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, Modal } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { keptVoiceRecordingExists, readKeptVoiceRecording } from '../../services/KeptVoiceRecording';

// Decision after review pass 3 (5 Oct 2026). A recording still going
// when a voice sheet closes WITHOUT his Cancel (its screen hid it, or took it
// away) is stopped at once, so the microphone is off, and then KEPT on the
// device and offered the next time, by a sheet that keeps recordings. It was
// stopped and dropped. Every rule of this round goes the same way: what he
// dictated and did not discard is not thrown away by something he did not
// ask for.
//
// Unchanged, and checked here: a recording too short to use is not kept; a
// sheet that keeps nothing on the device deletes it; the closed sheet is
// handed nothing; and his own Cancel (X, the system's back, Type Instead,
// the task button) still discards. A kept recording is never offered under
// another account, for another project, or twice.
// The two neighbours: a recording that a lock, a call or the 3-minute limit
// ended while the sheet is closing without his Cancel is kept the same way
// (it was deleted); the same close during the start has nothing to keep, and
// the microphone still ends up off.
// The stand-in recorder is the one of review-n2-voice-closed-sheet-microphone.

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
type Controls = {
  open: () => void;
  hide: () => void;
  /** As Field Notes does: the screen clears the sheet's project in the same step as it hides it. */
  hideClearingProject: () => void;
  showProject: (projectName: string) => void;
  /** As the app does when the signed-in account changes: this account's screens are taken away, the next account's put up. */
  signInAs: (owner: string) => void;
};
let screenControls: Controls;
let view: ReturnType<typeof render> | null = null;
afterEach(async () => {
  view?.unmount();
  view = null;
  // Nothing a test left waiting runs on into the next.
  holds.splice(0).forEach(made => made.release());
  await pause();
});

type Sheet = Readonly<{ name: string; keepSlot?: string; sendsOnStop?: boolean }>;
/** The kinds of voice sheet the app has. */
const KEEPS: Sheet = { name: 'a sheet that keeps recordings on the device (Talk)', keepSlot: 'talk' };
const KEEPS_AND_SENDS: Sheet = { name: 'a dictation sheet that sends by itself on Stop (Field Notes)', keepSlot: 'field-note', sendsOnStop: true };
const KEEPS_NOTHING: Sheet = { name: 'a sheet that keeps nothing on the device (task fill)' };
const CANOPY = 'Canopy Project';
const HARBOR = 'Harbor North';

/** A screen that owns a voice sheet as the app's screens do: it stays in place and is shown or hidden. */
function ScreenWithVoiceSheet({ sheet, startsOpen, firstProject, signInAs }: { sheet: Sheet; startsOpen: boolean; firstProject: string; signInAs: (owner: string) => void }) {
  const [shown, setShown] = useState({ open: startsOpen, projectName: firstProject });
  screenControls = {
    open: () => setShown(current => ({ ...current, open: true })),
    hide: () => setShown(current => ({ ...current, open: false })),
    hideClearingProject: () => setShown({ open: false, projectName: '' }),
    showProject: projectName => setShown(current => ({ ...current, projectName })),
    signInAs,
  };
  const hide = () => setShown(current => ({ ...current, open: false }));
  return (
    <DAVEVoiceCaptureSheet
      visible={shown.open}
      projectId={shown.projectName ? `${PROJECT_ID}-${shown.projectName.length}` : null}
      projectName={shown.projectName}
      candidateLocations={[]}
      title="Talk"
      continueLabel="Continue"
      operationLabel="Create a task"
      keepSlot={sheet.keepSlot}
      autoSubmitOnStop={sheet.sendsOnStop}
      onMemoryReady={called.words}
      onOperation={() => { called.task(); hide(); }}
      onTypeInstead={() => { called.typeInstead(); hide(); }}
      onCancel={() => { called.cancel(); hide(); }}
    />
  );
}

/** The phone: one signed-in account at a time; an account change takes the last account's screens away. */
function Phone({ firstOwner, sheet, startsOpen, firstProject }: { firstOwner: string; sheet: Sheet; startsOpen: boolean; firstProject: string }) {
  const [owner, setOwner] = useState(firstOwner);
  return (
    <NativeWorkspaceOwnerContext.Provider value={owner}>
      <ScreenWithVoiceSheet key={owner} sheet={sheet} startsOpen={owner === firstOwner ? startsOpen : true} firstProject={firstProject} signInAs={setOwner} />
    </NativeWorkspaceOwnerContext.Provider>
  );
}

/** Vitruvius is opened (afresh when it was open) with the sheet open for `owner` and `projectName`. */
async function openScreen(sheet: Sheet = KEEPS, { owner = 'owner-a', projectName = CANOPY }: { owner?: string; projectName?: string } = {}) {
  view?.unmount();
  view = render(<Phone firstOwner={owner} sheet={sheet} startsOpen firstProject={projectName} />);
  // The kept-recording check has answered.
  await settle();
}

const stopLabel = (sheet: Sheet) => (sheet.sendsOnStop ? 'Stop & Continue' : 'Stop Recording');

/** He has been dictating for `seconds` and is still going. */
async function dictating(sheet: Sheet = KEEPS, seconds = 12, options: { owner?: string; projectName?: string } = {}) {
  await openScreen(sheet, options);
  fireEvent.press(screen.getByText('Start Recording'));
  expect(await screen.findByText(stopLabel(sheet))).toBeTruthy();
  await act(async () => { store.set({ durationMillis: seconds * 1_000 }); });
  expect(device.microphoneOn).toBe(true);
}

/** Waits until a slow step has been reached; a step that never is fails its test instead of hanging it. */
const reached = (made: Hold) => act(async () => {
  await Promise.race([
    made.reached,
    new Promise<void>((_resolve, reject) => { setTimeout(() => reject(new Error('The slow step was never reached.')), 1_500); }),
  ]);
});

const hideTheSheet = () => act(async () => { screenControls.hide(); });
const showTheSheet = () => act(async () => { screenControls.open(); await pause(); });
const takeTheScreenAway = () => act(async () => { view?.unmount(); view = null; });

function expectMicrophoneOffAndRecorderPutBack() {
  expect(device.microphoneOn).toBe(false);
  expect(device.allowsRecording).toBe(false);
  expect(mockFiles.has(RECORDER_FILE)).toBe(false);
}

function expectNothingKept() {
  expectMicrophoneOffAndRecorderPutBack();
  expect(keptFiles()).toEqual([]);
  expect(entryKeys()).toEqual([]);
  expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
  expect(called.words).not.toHaveBeenCalled();
}

/** One recording is kept, and nothing of it was sent or handed on. */
function expectKeptOnce() {
  expectMicrophoneOffAndRecorderPutBack();
  expect(keptFiles()).toHaveLength(1);
  expect(entryKeys()).toHaveLength(1);
  expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
  expect(called.words).not.toHaveBeenCalled();
}

/** The open sheet offers a kept recording, and leaves it for him to use. */
async function expectOfferedAndLeftForHim() {
  expect(await screen.findByText('Recording ready')).toBeTruthy();
  expect(screen.getByText(/^Kept from .*\. Replay it, then tap Continue to use it, or record again\.$/)).toBeTruthy();
  expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
}

function expectNothingOffered() {
  expect(screen.queryByText('Recording ready')).toBeNull();
  expect(screen.queryByText('Replay Recording')).toBeNull();
  expect(screen.queryByText(/^Kept from /)).toBeNull();
}

describe('decision after pass 3: a recording still going when the sheet closes without his Cancel is stopped, then kept', () => {
  it.each([
    ['its screen hides the sheet', hideTheSheet, false],
    ['its screen is taken away', takeTheScreenAway, true],
  ] as const)('%s: the microphone goes off at once; what he had dictated is kept and offered the next time, once', async (_name, close, taken) => {
    await dictating(KEEPS);
    await close();
    // Stopped in the same step as the sheet goes; nothing is kept before the recorder has stopped.
    expect(device.microphoneOn).toBe(false);
    await settle();
    expectKeptOnce();
    const kept = await readKeptVoiceRecording('owner-a', 'talk', CANOPY);
    expect(kept).toMatchObject({ uri: keptFiles()[0], durationMs: 12_000, projectName: CANOPY, state: 'ready' });

    // The next time: offered, left for him, and used. After that it is not offered again.
    if (taken) await openScreen(KEEPS);
    else await showTheSheet();
    await expectOfferedAndLeftForHim();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'Rebar passed.' });
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenLastCalledWith(expect.objectContaining({ uri: kept?.uri, projectName: CANOPY }));
    await waitFor(() => expect(keptFiles()).toEqual([]));
    expect(entryKeys()).toEqual([]);
    await hideTheSheet();
    await showTheSheet();
    expectNothingOffered();
    expect(screen.getByText('Start Recording')).toBeTruthy();
  });

  it('a dictation sheet that sends by itself on Stop: kept, and not sent from behind the closed sheet', async () => {
    await dictating(KEEPS_AND_SENDS);
    await hideTheSheet();
    await settle();
    expectKeptOnce();
    await expect(readKeptVoiceRecording('owner-a', 'field-note', CANOPY)).resolves.toMatchObject({ state: 'ready', durationMs: 12_000 });
  });

  it('a sheet that keeps nothing on the device has nowhere to keep it: stopped and deleted, and the closed sheet is handed nothing', async () => {
    await dictating(KEEPS_NOTHING);
    await hideTheSheet();
    await settle();
    expectNothingKept();
    await showTheSheet();
    expectNothingOffered();
  });

  it('a recording too short to use is not kept', async () => {
    await dictating(KEEPS, 0.4);
    await hideTheSheet();
    await settle();
    expectNothingKept();
  });

  it('the recorder has recorded more than it last told the sheet: its own count decides whether there is enough to keep', async () => {
    // The sheet last heard 0.8 seconds (it asks every 200 ms); the recorder, asked as the sheet closes, says 1.2.
    await dictating(KEEPS, 0.8);
    recorder.getStatus.mockImplementation(() => ({ ...store.status, isRecording: device.microphoneOn, durationMillis: 1_200 }));
    await hideTheSheet();
    await settle();
    expectKeptOnce();
    await expect(readKeptVoiceRecording('owner-a', 'talk', CANOPY)).resolves.toMatchObject({ durationMs: 1_200 });
  });

  it('the recorder is slow to stop: nothing is kept until it has, and the closed sheet is handed nothing meanwhile', async () => {
    await dictating(KEEPS);
    const stopping = hold(recorder.stop, (async () => { device.microphoneOn = false; store.set({ isRecording: false, durationMillis: 0 }); }) as never);
    await hideTheSheet();
    await reached(stopping);
    expect(keptFiles()).toEqual([]);
    expect(entryKeys()).toEqual([]);
    await act(async () => { stopping.release(); await pause(); });
    await settle();
    expectKeptOnce();
  });

  it('the recorder will not stop when asked: it is asked again, the microphone goes off, and nothing is kept of a file it never finished', async () => {
    await dictating(KEEPS);
    recorder.stop.mockImplementationOnce(async () => { throw new Error('The recorder did not stop.'); });
    await hideTheSheet();
    await settle();
    expect(recorder.stop).toHaveBeenCalledTimes(2);
    expectNothingKept();
  });
});

describe('decision after pass 3: his own Cancel still discards', () => {
  const cancels: ReadonlyArray<readonly [string, () => void, jest.Mock]> = [
    ['X', () => fireEvent.press(screen.getByLabelText('Cancel memory capture')), called.cancel],
    ['the system\'s back (Android)', () => { screen.UNSAFE_getByType(Modal).props.onRequestClose(); }, called.cancel],
    ['Create a task', () => fireEvent.press(screen.getByLabelText('Create a task')), called.task],
  ];

  it.each(cancels)('%s while he is dictating: stopped, deleted, nothing kept, nothing offered', async (_name, cancel, told) => {
    await dictating(KEEPS);
    await act(async () => { cancel(); await pause(); });
    await settle();
    expect(told).toHaveBeenCalledTimes(1);
    expectNothingKept();
    await showTheSheet();
    expectNothingOffered();
  });

  it('his Cancel could neither stop the recorder nor delete its file, and the sheet closing then stops it: still discarded, not kept', async () => {
    await dictating(KEEPS);
    // The phone refuses his Cancel's stop and its delete, once each: the recorder is still going when the sheet closes.
    recorder.stop.mockImplementationOnce(async () => { throw new Error('The recorder did not stop.'); });
    phoneFiles.deleteAsync.mockImplementationOnce(async () => { throw new Error('The phone could not delete the file.'); });
    await act(async () => { fireEvent.press(screen.getByLabelText('Cancel memory capture')); await pause(); });
    await settle();
    expect(called.cancel).toHaveBeenCalledTimes(1);
    expect(recorder.stop).toHaveBeenCalledTimes(2);
    expectNothingKept();
  });
});

describe('decision after pass 3: a kept recording is offered to no other account, for no other project, and not twice', () => {
  it('another account that opens the same sheet for the same project is not offered it; the account that dictated it is', async () => {
    await dictating(KEEPS);
    await hideTheSheet();
    await settle();
    expectKeptOnce();

    // The other account signs in on this phone and opens Talk for the same project.
    await act(async () => { screenControls.signInAs('owner-b'); await pause(); });
    await settle();
    expectNothingOffered();
    expect(screen.getByText('Start Recording')).toBeTruthy();
    await expect(keptVoiceRecordingExists('owner-b')).resolves.toBe(false);
    await expect(readKeptVoiceRecording('owner-b', 'talk', CANOPY)).resolves.toBeNull();
    expectKeptOnce();

    await act(async () => { screenControls.signInAs('owner-a'); await pause(); });
    await expectOfferedAndLeftForHim();
  });

  it('the account changes while he is dictating (his screens are taken away): kept under the account that was dictating', async () => {
    await dictating(KEEPS);
    await act(async () => { screenControls.signInAs('owner-b'); await pause(); });
    await settle();
    // The other account's sheet is open now, and is offered nothing.
    expectNothingOffered();
    expectKeptOnce();
    await expect(keptVoiceRecordingExists('owner-b')).resolves.toBe(false);
    await expect(readKeptVoiceRecording('owner-a', 'talk', CANOPY)).resolves.toMatchObject({ durationMs: 12_000, state: 'ready' });
  });

  it('the sheet opened for another project is not offered it, and it stays kept for its own project', async () => {
    await dictating(KEEPS);
    await hideTheSheet();
    await settle();
    await act(async () => { screenControls.showProject(HARBOR); });
    await showTheSheet();
    expectNothingOffered();
    await expect(readKeptVoiceRecording('owner-a', 'talk', HARBOR)).resolves.toBeNull();
    expectKeptOnce();

    await hideTheSheet();
    await act(async () => { screenControls.showProject(CANOPY); });
    await showTheSheet();
    await expectOfferedAndLeftForHim();
  });

  it('its screen clears the project in the same step as it hides the sheet: kept for the project the sheet was open for', async () => {
    await dictating(KEEPS);
    await act(async () => { screenControls.hideClearingProject(); });
    await settle();
    expectKeptOnce();
    await expect(readKeptVoiceRecording('owner-a', 'talk', CANOPY)).resolves.toMatchObject({ projectName: CANOPY, projectId: `${PROJECT_ID}-${CANOPY.length}` });
    await expect(readKeptVoiceRecording('owner-a', 'talk', '')).resolves.toBeNull();
  });

  it('the project changes under the open sheet while he is dictating: kept for the project the sheet showed when it closed', async () => {
    // The sheet was opened for Harbor North, and its project became Canopy Project before it was hidden.
    await dictating(KEEPS, 12, { projectName: HARBOR });
    await act(async () => { screenControls.showProject(CANOPY); await pause(); });
    await hideTheSheet();
    await settle();
    expectKeptOnce();
    await expect(readKeptVoiceRecording('owner-a', 'talk', CANOPY)).resolves.toMatchObject({ projectName: CANOPY });
    await expect(readKeptVoiceRecording('owner-a', 'talk', HARBOR)).resolves.toBeNull();
  });

  it('its screen hides the sheet and shows it again for another project while the recorder is still stopping: kept for the project he dictated it in', async () => {
    await dictating(KEEPS);
    const stopping = hold(recorder.stop, (async () => { device.microphoneOn = false; store.set({ isRecording: false, durationMillis: 0 }); }) as never);
    await hideTheSheet();
    await reached(stopping);
    await act(async () => { screenControls.showProject(HARBOR); });
    await showTheSheet();
    await act(async () => { stopping.release(); await pause(); });
    await settle();
    expectKeptOnce();
    await expect(readKeptVoiceRecording('owner-a', 'talk', CANOPY)).resolves.toMatchObject({ projectName: CANOPY, durationMs: 12_000 });
    await expect(readKeptVoiceRecording('owner-a', 'talk', HARBOR)).resolves.toBeNull();
    // The sheet, open for the other project, is offered nothing.
    expectNothingOffered();
  });

  it('the same when he had tapped Stop before the sheet was hidden and shown for another project', async () => {
    await dictating(KEEPS);
    const stopping = hold(recorder.stop, (async () => { device.microphoneOn = false; }) as never);
    fireEvent.press(screen.getByText('Stop Recording'));
    await reached(stopping);
    await act(async () => { store.set({ isRecording: false }); });
    await hideTheSheet();
    await act(async () => { screenControls.showProject(HARBOR); });
    await showTheSheet();
    await act(async () => { stopping.release(); await pause(); });
    await settle();
    expectKeptOnce();
    await expect(readKeptVoiceRecording('owner-a', 'talk', CANOPY)).resolves.toMatchObject({ projectName: CANOPY, durationMs: 12_000 });
    await expect(readKeptVoiceRecording('owner-a', 'talk', HARBOR)).resolves.toBeNull();
    expectNothingOffered();
  });

  it('the same when a lock had ended it before the sheet was hidden and shown for another project', async () => {
    await dictating(KEEPS, 40);
    const finishing = hold(recorder.stop, (async () => { device.microphoneOn = false; }) as never);
    await act(async () => { device.microphoneOn = false; store.set({ isRecording: false }); });
    await reached(finishing);
    await hideTheSheet();
    await act(async () => { screenControls.showProject(HARBOR); });
    await showTheSheet();
    await act(async () => { finishing.release(); await pause(); });
    await settle();
    expectKeptOnce();
    await expect(readKeptVoiceRecording('owner-a', 'talk', CANOPY)).resolves.toMatchObject({ projectName: CANOPY, durationMs: 40_000 });
    await expect(readKeptVoiceRecording('owner-a', 'talk', HARBOR)).resolves.toBeNull();
    expectNothingOffered();
  });

  it('the sheet is shown again while the recording is still being kept (the phone is slow to copy it): kept once, offered once', async () => {
    const files = jest.requireMock('expo-file-system/legacy') as { copyAsync: jest.Mock };
    const copy = files.copyAsync.getMockImplementation() as (...args: never[]) => unknown;
    await dictating(KEEPS);
    const copying = hold(files.copyAsync, copy);
    await hideTheSheet();
    await reached(copying);
    await showTheSheet();
    // Shown while the keep is still under way: not offered yet, and Start Recording waits for it.
    expectNothingOffered();
    fireEvent.press(screen.getByText('Start Recording'));
    await settle();
    expect(recorder.record).toHaveBeenCalledTimes(1);
    await act(async () => { copying.release(); await pause(); });
    await settle();
    expectKeptOnce();

    await hideTheSheet();
    await showTheSheet();
    await expectOfferedAndLeftForHim();
    expect(keptFiles()).toHaveLength(1);
    expect(entryKeys()).toHaveLength(1);
  });

  it('its screen hides the sheet, shows it and hides it again while the recorder is still stopping: kept once', async () => {
    await dictating(KEEPS);
    const stopping = hold(recorder.stop, (async () => { device.microphoneOn = false; store.set({ isRecording: false, durationMillis: 0 }); }) as never);
    await hideTheSheet();
    await reached(stopping);
    await showTheSheet();
    await hideTheSheet();
    await act(async () => { stopping.release(); await pause(); });
    await settle();
    expectKeptOnce();
  });
});

describe('neighbour: a lock, a call or the 3-minute limit ends the recording while the sheet is closing', () => {
  /** The recorder stops reporting "recording" by itself, and is slow to finish. */
  async function endedByItselfAndStillFinishing(seconds: number) {
    await dictating(KEEPS, seconds);
    const finishing = hold(recorder.stop, (async () => { device.microphoneOn = false; }) as never);
    // A lock or call pauses the recorder; the limit stops it. Either way it no longer reports "recording".
    await act(async () => { device.microphoneOn = false; store.set({ isRecording: false }); });
    await reached(finishing);
    return finishing;
  }

  it.each([
    ['a lock or a call, 40 seconds in', 40],
    ['the 3-minute limit', 180],
  ])('%s, and its screen hides the sheet while it is being finished: kept and offered the next time; the closed sheet is handed nothing', async (_name, seconds) => {
    const finishing = await endedByItselfAndStillFinishing(seconds);
    await hideTheSheet();
    await act(async () => { finishing.release(); await pause(); });
    await settle();
    expectKeptOnce();
    await expect(readKeptVoiceRecording('owner-a', 'talk', CANOPY)).resolves.toMatchObject({ durationMs: seconds * 1_000, state: 'ready', projectName: CANOPY });
    await showTheSheet();
    await expectOfferedAndLeftForHim();
  });

  it('and he cancels while it is being finished: discarded, as before', async () => {
    const finishing = await endedByItselfAndStillFinishing(40);
    await act(async () => { fireEvent.press(screen.getByLabelText('Cancel memory capture')); await pause(); });
    await act(async () => { finishing.release(); await pause(); });
    await settle();
    expect(called.cancel).toHaveBeenCalledTimes(1);
    expectNothingKept();
    await showTheSheet();
    expectNothingOffered();
  });

  it('and the recorder finishes while his Cancel is still under way (the audio mode is slow to set back): discarded', async () => {
    const finishing = await endedByItselfAndStillFinishing(40);
    const settingBack = hold(audio.setAudioModeAsync, audioModeSet as never);
    await act(async () => { fireEvent.press(screen.getByLabelText('Cancel memory capture')); });
    await reached(settingBack);
    // The sheet is still open: his Cancel has not finished, and the recorder's file is still there.
    expect(called.cancel).not.toHaveBeenCalled();
    expect(mockFiles.has(RECORDER_FILE)).toBe(true);
    await act(async () => { finishing.release(); await pause(); });
    expect(keptFiles()).toEqual([]);
    expect(entryKeys()).toEqual([]);
    expect(screen.queryByText('Recording ready')).toBeNull();
    await act(async () => { settingBack.release(); await pause(); });
    await settle();
    expect(called.cancel).toHaveBeenCalledTimes(1);
    expectNothingKept();
  });

  it('with the sheet still open it is put in the sheet and kept, as before', async () => {
    const finishing = await endedByItselfAndStillFinishing(40);
    await act(async () => { finishing.release(); await pause(); });
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    expect(screen.getByText('Recording stopped when the phone was locked or a call came in. Replay it, then use it or record again.')).toBeTruthy();
    await waitFor(() => expect(keptFiles()).toHaveLength(1));
    expect(entryKeys()).toHaveLength(1);
  });
});

describe('neighbour: the same close during the start, before anything was recorded', () => {
  it.each([
    ['its screen hides the sheet', hideTheSheet],
    ['its screen is taken away', takeTheScreenAway],
  ] as const)('%s while the recorder is getting ready: the microphone never goes on, and there is nothing to keep', async (_name, close) => {
    await openScreen(KEEPS);
    const ready = hold(recorder.prepareToRecordAsync, recorderReady);
    fireEvent.press(screen.getByText('Start Recording'));
    await reached(ready);
    await close();
    await act(async () => { ready.release(); await pause(); });
    await settle();
    expect(recorder.record).not.toHaveBeenCalled();
    expectNothingKept();
  });

  it('just after the recorder started (it has not yet said so): stopped at once, and too short to keep', async () => {
    await openScreen(KEEPS);
    device.reportsLate = true;
    fireEvent.press(screen.getByText('Start Recording'));
    await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
    expect(device.microphoneOn).toBe(true);
    await hideTheSheet();
    expect(device.microphoneOn).toBe(false);
    await recorderReports();
    await settle();
    expectNothingKept();
  });
});
