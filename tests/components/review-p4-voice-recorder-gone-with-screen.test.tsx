import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { readKeptVoiceRecording } from '../../services/KeptVoiceRecording';
import { cacheFiles, hold, keptEntryKeys, keptFiles, phone, releaseEveryHold, type Hold } from '../fixtures/voice-sheet-phone';

// Review pass 4, L1 (5 Oct 2026; caused by the pass-3 decision that a
// recording still going when a voice sheet closes without his Cancel is
// stopped and then KEPT).
//
// When the sheet's SCREEN IS TAKEN AWAY while he is dictating (the app
// rebuilt for another account, a panel that failed to draw), expo-audio
// releases the recorder with it, and a released recorder throws on anything
// read from it. The sheet asked the recorder to stop and only then read its
// file: by then the recorder had gone, there was no file to keep, so what he
// had dictated was not kept, and its file stayed in the phone's cache, never
// offered. The earlier tests could not see it: their stand-in recorder
// outlives its screen. Now the file is read before the stop.
//
// Both kinds of recorder are run here (tests/fixtures/voice-sheet-phone.ts):
// one that goes with its screen, as expo-audio's does, and one that outlives
// it. And both answers a real phone may give a stop that was asked before the
// recorder went: it answers (the recording is kept), or it is refused (the
// recorder's file was never finished: nothing is kept, and the file is not
// left in the cache either).

jest.mock('expo-audio', () => require('../fixtures/voice-sheet-phone').standInExpoAudio());
jest.mock('expo-file-system/legacy', () => require('../fixtures/voice-sheet-phone').standInFileSystem());
jest.mock('@react-native-async-storage/async-storage', () => require('../fixtures/voice-sheet-phone').standInAsyncStorage());
jest.mock('../../services/DAVEVoiceTranscriptionService', () => ({
  transcribeDAVECaptureMemoryAudio: jest.fn(),
}));

jest.setTimeout(20_000);

const transcription = jest.requireMock('../../services/DAVEVoiceTranscriptionService') as { transcribeDAVECaptureMemoryAudio: jest.Mock };

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const CANOPY = 'Canopy Project';
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => { await pause(ms); });

const called = { cancel: jest.fn(), typeInstead: jest.fn(), task: jest.fn(), words: jest.fn() };
/** As the app does when the signed-in account changes: this account's screens are taken away, the next account's put up. */
let signInAs: (owner: string) => void;
let view: ReturnType<typeof render> | null = null;

beforeEach(() => {
  phone.reset();
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
  Object.values(called).forEach(mock => mock.mockReset());
  (AppState as { currentState: unknown }).currentState = 'active';
});
afterEach(async () => {
  view?.unmount();
  view = null;
  releaseEveryHold();
  await pause();
});

type Sheet = Readonly<{ name: string; keepSlot?: string; sendsOnStop?: boolean }>;
/** The kinds of voice sheet the app has. */
const KEEPS: Sheet = { name: 'a sheet that keeps recordings on the device (Talk)', keepSlot: 'talk' };
const KEEPS_AND_SENDS: Sheet = { name: 'a dictation sheet that sends by itself on Stop (Field Notes)', keepSlot: 'field-note', sendsOnStop: true };
const KEEPS_NOTHING: Sheet = { name: 'a sheet that keeps nothing on the device (task fill)' };

/** A screen that owns a voice sheet as the app's screens do. */
function ScreenWithVoiceSheet({ sheet }: { sheet: Sheet }) {
  const [open, setOpen] = useState(true);
  const hide = () => setOpen(false);
  return (
    <DAVEVoiceCaptureSheet
      visible={open}
      projectId={`${PROJECT_ID}-${CANOPY.length}`}
      projectName={CANOPY}
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
function Phone({ firstOwner, sheet }: { firstOwner: string; sheet: Sheet }) {
  const [owner, setOwner] = useState(firstOwner);
  signInAs = setOwner;
  return (
    <NativeWorkspaceOwnerContext.Provider value={owner}>
      <ScreenWithVoiceSheet key={owner} sheet={sheet} />
    </NativeWorkspaceOwnerContext.Provider>
  );
}

/** Vitruvius is opened (afresh when it was open) with the sheet open for owner-a and Canopy Project. */
async function openScreen(sheet: Sheet) {
  view?.unmount();
  view = render(<Phone firstOwner="owner-a" sheet={sheet} />);
  // The kept-recording check has answered.
  await settle();
}

const stopLabel = (sheet: Sheet) => (sheet.sendsOnStop ? 'Stop & Continue' : 'Stop Recording');

/** He has been dictating for `seconds` and is still going. */
async function dictating(sheet: Sheet, seconds = 12) {
  await openScreen(sheet);
  fireEvent.press(screen.getByText('Start Recording'));
  expect(await screen.findByText(stopLabel(sheet))).toBeTruthy();
  await act(async () => { phone.recorder.set({ durationMillis: seconds * 1_000 }); });
  expect(phone.microphoneOn).toBe(true);
}

/** Waits until a slow step has been reached; a step that never is fails its test instead of hanging it. */
const reached = (made: Hold) => act(async () => {
  await Promise.race([
    made.reached,
    new Promise<void>((_resolve, reject) => { setTimeout(() => reject(new Error('The slow step was never reached.')), 1_500); }),
  ]);
});

type WayAway = Readonly<{ name: string; rebuilt: boolean; away: () => Promise<void> }>;
/** The two ways a voice sheet's screen is taken away while he is using it. */
const WAYS_AWAY: readonly WayAway[] = [
  {
    name: 'its panel is dropped (it failed to draw)',
    rebuilt: false,
    away: () => act(async () => { view?.unmount(); view = null; }),
  },
  {
    name: 'the app is rebuilt for another account',
    rebuilt: true,
    away: () => act(async () => { signInAs('owner-b'); }),
  },
];

type Recorders = Readonly<{ name: string; outlive: boolean }>;
const RECORDERS: readonly Recorders[] = [
  { name: 'the recorder goes with its screen, as expo-audio’s does', outlive: false },
  { name: 'the recorder outlives its screen, as the earlier tests’ stand-in does', outlive: true },
];

/** The microphone is off, the phone's audio is back, and no recorder's file is left in the cache. */
function expectMicrophoneOffAndNothingLeftInTheCache() {
  expect(phone.microphoneOn).toBe(false);
  expect(phone.allowsRecording).toBe(false);
  expect(cacheFiles()).toEqual([]);
}

function expectNothingKept() {
  expectMicrophoneOffAndNothingLeftInTheCache();
  expect(keptFiles()).toEqual([]);
  expect(keptEntryKeys()).toEqual([]);
  expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
  expect(called.words).not.toHaveBeenCalled();
}

/** One recording is kept, for the account and project it was dictated for, and nothing of it was sent or handed on. */
async function expectKeptOnceForCanopy(sheet: Sheet, seconds = 12) {
  expectMicrophoneOffAndNothingLeftInTheCache();
  expect(keptFiles()).toHaveLength(1);
  expect(keptEntryKeys()).toHaveLength(1);
  expect(await readKeptVoiceRecording('owner-a', String(sheet.keepSlot), CANOPY)).toEqual(expect.objectContaining({
    uri: keptFiles()[0],
    projectName: CANOPY,
    durationMs: seconds * 1_000,
    state: 'ready',
  }));
  expect(await readKeptVoiceRecording('owner-b', String(sheet.keepSlot))).toBeNull();
  expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
  expect(called.words).not.toHaveBeenCalled();
}

function expectNothingOffered() {
  expect(screen.queryByText('Recording ready')).toBeNull();
  expect(screen.queryByText('Replay Recording')).toBeNull();
  expect(screen.queryByText(/^Kept from /)).toBeNull();
}

/** Back with the account it was dictated under, the sheet offers it and leaves it for him to use. */
async function expectOfferedToItsAccountNextTime(sheet: Sheet, way: WayAway) {
  // The next account's sheet, open for the same project, is offered nothing.
  if (way.rebuilt) {
    expectNothingOffered();
    await act(async () => { signInAs('owner-a'); });
    await settle();
  } else {
    await openScreen(sheet);
  }
  expect(await screen.findByText('Recording ready')).toBeTruthy();
  expect(screen.getByText(/^Kept from .*\. Replay it, then tap Continue to use it, or record again\.$/)).toBeTruthy();
  expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
  expect(keptFiles()).toHaveLength(1);
}

describe.each(RECORDERS)('$name', ({ outlive }) => {
  beforeEach(() => { phone.recordersOutliveTheirScreen = outlive; });

  describe.each(WAYS_AWAY)('the screen is taken away ($name)', way => {
    it.each([KEEPS, KEEPS_AND_SENDS])('while he is dictating on $name: what he had dictated is kept once, and offered the next time', async sheet => {
      await dictating(sheet);

      await way.away();
      await settle();

      await expectKeptOnceForCanopy(sheet);
      await expectOfferedToItsAccountNextTime(sheet, way);
    });

    it.each([KEEPS, KEEPS_AND_SENDS])('just after he tapped Stop on $name, the recorder still stopping: the recording he had stopped is kept once', async sheet => {
      await dictating(sheet);
      const stopping = hold(phone.recorder.stop, phone.recorder.stopAnswers);
      fireEvent.press(screen.getByText(stopLabel(sheet)));
      await reached(stopping);

      await way.away();
      await act(async () => { stopping.release(); });
      await settle();

      await expectKeptOnceForCanopy(sheet);
      await expectOfferedToItsAccountNextTime(sheet, way);
    });

    it('just after a lock or a call ended the recording, the recorder still finishing it: it is kept once', async () => {
      await dictating(KEEPS);
      const recorder = phone.recorder;
      const finishing = hold(recorder.stop, recorder.stopAnswers);
      await act(async () => { recorder.stoppedByThePhone(); });
      await reached(finishing);

      await way.away();
      await act(async () => { finishing.release(); });
      await settle();

      await expectKeptOnceForCanopy(KEEPS);
      await expectOfferedToItsAccountNextTime(KEEPS, way);
    });

    it('a recording too short to use is not kept, and its file is not left in the cache', async () => {
      await dictating(KEEPS, 0.4);

      await way.away();
      await settle();

      expectNothingKept();
    });

    it('a sheet that keeps nothing on the device has nowhere to keep it: its file is not left in the cache', async () => {
      await dictating(KEEPS_NOTHING);

      await way.away();
      await settle();

      expectNothingKept();
    });

    it('his own Cancel still discards: X while dictating, the recorder still stopping when the screen goes', async () => {
      await dictating(KEEPS);
      const stopping = hold(phone.recorder.stop, phone.recorder.stopAnswers);
      fireEvent.press(screen.getByLabelText('Cancel memory capture'));
      await reached(stopping);

      await way.away();
      await act(async () => { stopping.release(); });
      await settle();

      expectNothingKept();
    });

    it('his own Cancel still discards: the recorder has stopped, its answer still on the way when the screen goes', async () => {
      await dictating(KEEPS);
      const recorder = phone.recorder;
      const stopping = hold(recorder.stop, recorder.stopAnswers);
      fireEvent.press(screen.getByLabelText('Cancel memory capture'));
      await reached(stopping);
      await act(async () => { recorder.stoppedByThePhone(); });

      await way.away();
      await act(async () => { stopping.release(); });
      await settle();

      expectNothingKept();
    });
  });
});

describe('a stop that was asked before the recorder went is refused when it answers (its file was never finished)', () => {
  beforeEach(() => { phone.goneRecorderRefusesStop = true; });

  describe.each(WAYS_AWAY)('the screen is taken away ($name)', way => {
    it.each([KEEPS, KEEPS_AND_SENDS, KEEPS_NOTHING])('while he is dictating on $name: nothing is kept, and the file is not left in the cache', async sheet => {
      await dictating(sheet);

      await way.away();
      await settle();

      expectNothingKept();
      if (way.rebuilt) expectNothingOffered();
    });

    it('just after he tapped Stop: nothing is kept, and the file is not left in the cache', async () => {
      await dictating(KEEPS);
      const stopping = hold(phone.recorder.stop, phone.recorder.stopAnswers);
      fireEvent.press(screen.getByText('Stop Recording'));
      await reached(stopping);

      await way.away();
      await act(async () => { stopping.release(); });
      await settle();

      expectNothingKept();
    });

    it('just after a lock or a call ended the recording: nothing is kept, and the file is not left in the cache', async () => {
      await dictating(KEEPS);
      const recorder = phone.recorder;
      const finishing = hold(recorder.stop, recorder.stopAnswers);
      await act(async () => { recorder.stoppedByThePhone(); });
      await reached(finishing);

      await way.away();
      await act(async () => { finishing.release(); });
      await settle();

      expectNothingKept();
    });
  });

  it('with the screen still there, the recorder answers and the recording is ready as before', async () => {
    await dictating(KEEPS);

    fireEvent.press(screen.getByText('Stop Recording'));

    expect(await screen.findByText('Recording ready')).toBeTruthy();
    await settle();
    expect(keptFiles()).toHaveLength(1);
    expect(phone.microphoneOn).toBe(false);
  });
});
