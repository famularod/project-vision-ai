import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { cacheFiles, hold, phone, releaseEveryHold, type Hold, type StandInRecorder } from '../fixtures/voice-sheet-phone';

// Review pass 4 (5 Oct 2026), the reviewer's suspicion, reasoned but not run:
// "one sheet's late stand-down turns off the shared audio mode while ANOTHER
// sheet has just begun recording".
//
// It can happen. The app has several voice sheets in place at once (Talk,
// Ask ECOS, Field Notes, the walk, task fill), each with its own recorder,
// and the phone has ONE audio mode. A sheet that was closed while its
// recorder was still starting or stopping switches the phone's audio back
// from recording when that step finally answers. If he had opened another
// voice sheet and begun dictating by then, the audio mode went back under
// it: on iOS that stops every recorder that is recording, so the dictation
// he had just begun was cut off (shown as "Recording stopped when the phone
// was locked or a call came in").
//
// It takes one of the phone's own steps (making the recorder ready,
// switching the audio, stopping) to still be unanswered when he has closed
// the first sheet, opened the other and begun. Not as the reviewer put it: a
// start still waiting on the microphone PERMISSION never takes the audio
// mode once its sheet is closed, so it has nothing to put back.
//
// Now a recorder run that its sheet has let go of leaves the phone's audio
// alone once another start has taken the microphone since. It still stops
// its own recorder and removes its own file.
// The stand-in phone gives every sheet its own recorder and, as iOS does,
// stops every recorder when the audio mode goes back from recording.

jest.mock('expo-audio', () => require('../fixtures/voice-sheet-phone').standInExpoAudio());
jest.mock('expo-file-system/legacy', () => require('../fixtures/voice-sheet-phone').standInFileSystem());
jest.mock('@react-native-async-storage/async-storage', () => require('../fixtures/voice-sheet-phone').standInAsyncStorage());
jest.mock('../../services/DAVEVoiceTranscriptionService', () => ({
  transcribeDAVECaptureMemoryAudio: jest.fn(),
}));

jest.setTimeout(20_000);

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const CANOPY = 'Canopy Project';
const INTERRUPTED = 'Recording stopped when the phone was locked or a call came in. Replay it, then use it or record again.';
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => { await pause(ms); });

type Which = 'talk' | 'notes';
const called = { cancelled: jest.fn(), words: jest.fn() };
/** The screen shows one of its voice sheets, or none (hidden without his Cancel). */
let show: (which: Which | null) => void;
let view: ReturnType<typeof render> | null = null;
/** Each sheet's own recorder. */
let talk: StandInRecorder;
let notes: StandInRecorder;

beforeEach(() => {
  phone.reset();
  phone.audioModeOffStopsEveryRecorder = true;
  Object.values(called).forEach(mock => mock.mockReset());
  (AppState as { currentState: unknown }).currentState = 'active';
});
afterEach(async () => {
  view?.unmount();
  view = null;
  releaseEveryHold();
  await pause();
});

/** The phone with two of the app's voice sheets in place, as they are: Talk, and Field Notes. */
function Phone() {
  const [open, setOpen] = useState<Which | null>('talk');
  show = setOpen;
  const sheet = (which: Which, title: string, keepSlot: string) => (
    <DAVEVoiceCaptureSheet
      visible={open === which}
      projectId={PROJECT_ID}
      projectName={CANOPY}
      candidateLocations={[]}
      title={title}
      continueLabel="Continue"
      keepSlot={keepSlot}
      onMemoryReady={called.words}
      onTypeInstead={() => setOpen(null)}
      onCancel={() => { called.cancelled(which); setOpen(null); }}
    />
  );
  return (
    <NativeWorkspaceOwnerContext.Provider value="owner-a">
      {sheet('talk', 'Talk', 'talk')}
      {sheet('notes', 'Field Notes', 'field-note')}
    </NativeWorkspaceOwnerContext.Provider>
  );
}

/** Vitruvius is open with Talk on screen. */
async function openTalk() {
  view = render(<Phone />);
  [talk, notes] = phone.recorders;
  // The kept-recording check has answered.
  await settle();
  expect(screen.getByText('Talk')).toBeTruthy();
}

/** Waits until a slow step has been reached; a step that never is fails its test instead of hanging it. */
const reached = (made: Hold) => act(async () => {
  await Promise.race([
    made.reached,
    new Promise<void>((_resolve, reject) => { setTimeout(() => reject(new Error('The slow step was never reached.')), 1_500); }),
  ]);
});

/** He is dictating on Talk. */
async function dictatingOnTalk() {
  await openTalk();
  fireEvent.press(screen.getByText('Start Recording'));
  expect(await screen.findByText('Stop Recording')).toBeTruthy();
  await act(async () => { talk.set({ durationMillis: 12_000 }); });
  expect(talk.microphoneOn).toBe(true);
}

const hideTalkWithoutCancel = () => act(async () => { show(null); });
async function tapXOnTalk() {
  fireEvent.press(screen.getByLabelText('Cancel memory capture'));
  await act(async () => { await pause(20); });
  expect(called.cancelled).toHaveBeenCalledWith('talk');
}
const refused = async () => { throw new Error('The recorder did not stop.'); };

type Late = Readonly<{ name: string; leavesTalk: () => Promise<Hold> }>;
/** Every way Talk is closed with one of the phone's steps for it still unanswered: that step, held. */
const LATE_STAND_DOWNS: readonly Late[] = [
  {
    name: 'X on Talk while its recorder is still being made ready',
    leavesTalk: async () => {
      await openTalk();
      const slow = hold(talk.prepareToRecordAsync, talk.readies);
      fireEvent.press(screen.getByText('Start Recording'));
      await reached(slow);
      await tapXOnTalk();
      return slow;
    },
  },
  {
    name: 'X on Talk while the phone is still switching to recording for it',
    leavesTalk: async () => {
      await openTalk();
      const slow = hold(phone.setAudioModeAsync, phone.audioModeSet);
      fireEvent.press(screen.getByText('Start Recording'));
      await reached(slow);
      await tapXOnTalk();
      return slow;
    },
  },
  {
    name: 'Talk hidden without his Cancel while its recorder is still being made ready',
    leavesTalk: async () => {
      await openTalk();
      const slow = hold(talk.prepareToRecordAsync, talk.readies);
      fireEvent.press(screen.getByText('Start Recording'));
      await reached(slow);
      await hideTalkWithoutCancel();
      return slow;
    },
  },
  {
    name: 'Talk hidden without his Cancel while he is dictating, its recorder slow to stop',
    leavesTalk: async () => {
      await dictatingOnTalk();
      const slow = hold(talk.stop, talk.stopAnswers);
      await hideTalkWithoutCancel();
      await reached(slow);
      return slow;
    },
  },
  {
    name: 'Talk hidden without his Cancel while he is dictating, its recorder refusing the stop (it is asked again)',
    leavesTalk: async () => {
      await dictatingOnTalk();
      const slow = hold(talk.stop, refused);
      await hideTalkWithoutCancel();
      await reached(slow);
      return slow;
    },
  },
  {
    name: 'Stop tapped on Talk, its recorder slow to stop, and Talk hidden without his Cancel',
    leavesTalk: async () => {
      await dictatingOnTalk();
      const slow = hold(talk.stop, talk.stopAnswers);
      fireEvent.press(screen.getByText('Stop Recording'));
      await reached(slow);
      await hideTalkWithoutCancel();
      return slow;
    },
  },
  {
    name: 'Stop tapped on Talk, Talk hidden without his Cancel, and its recorder then refusing the stop (it is asked again)',
    leavesTalk: async () => {
      await dictatingOnTalk();
      const slow = hold(talk.stop, refused);
      fireEvent.press(screen.getByText('Stop Recording'));
      await reached(slow);
      await hideTalkWithoutCancel();
      return slow;
    },
  },
  {
    name: 'a lock ending Talk’s recording, its recorder slow to finish it, and Talk hidden without his Cancel',
    leavesTalk: async () => {
      await dictatingOnTalk();
      const slow = hold(talk.stop, talk.stopAnswers);
      await act(async () => { talk.stoppedByThePhone(); });
      await reached(slow);
      await hideTalkWithoutCancel();
      return slow;
    },
  },
];

/** He opens Field Notes and begins to dictate there. */
async function beginsDictatingOnFieldNotes() {
  await act(async () => { show('notes'); });
  await settle();
  expect(screen.getByText('Field Notes')).toBeTruthy();
  fireEvent.press(screen.getByText('Start Recording'));
  expect(await screen.findByText('Stop Recording')).toBeTruthy();
  await act(async () => { notes.set({ durationMillis: 5_000 }); });
  expect(notes.microphoneOn).toBe(true);
  expect(phone.allowsRecording).toBe(true);
}

describe.each(LATE_STAND_DOWNS)('$name', ({ leavesTalk }) => {
  it('he opens Field Notes and begins to dictate; when Talk’s step answers, his dictation goes on', async () => {
    const late = await leavesTalk();
    await beginsDictatingOnFieldNotes();

    await act(async () => { late.release(); });
    await settle();

    // Field Notes is still listening: the phone's audio was not switched back under it.
    expect(notes.microphoneOn).toBe(true);
    expect(phone.allowsRecording).toBe(true);
    expect(screen.getByText('Listening…')).toBeTruthy();
    expect(screen.queryByText(INTERRUPTED)).toBeNull();
    // Talk's own recorder is off, and what it had made ready is not left in the cache.
    expect(talk.microphoneOn).toBe(false);
    expect(cacheFiles()).toEqual([notes.file]);

    // And when he stops, the phone's audio goes back, as always.
    fireEvent.press(screen.getByText('Stop Recording'));
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    expect(screen.queryByText(INTERRUPTED)).toBeNull();
    expect(phone.microphoneOn).toBe(false);
    expect(phone.allowsRecording).toBe(false);
  });

  it('with no other sheet recording, the phone’s audio is switched back when Talk’s step answers, as before', async () => {
    const late = await leavesTalk();

    await act(async () => { late.release(); });
    await settle();

    expect(phone.microphoneOn).toBe(false);
    expect(phone.allowsRecording).toBe(false);
    expect(cacheFiles()).toEqual([]);
  });
});

describe('X on Talk while its recorder is still being made ready', () => {
  const leavesTalk = LATE_STAND_DOWNS[0].leavesTalk;

  it('he dictates on Field Notes and has stopped before Talk’s step answers: the phone’s audio stays back', async () => {
    const late = await leavesTalk();
    await beginsDictatingOnFieldNotes();
    fireEvent.press(screen.getByText('Stop Recording'));
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    expect(phone.allowsRecording).toBe(false);

    await act(async () => { late.release(); });
    await settle();

    expect(phone.microphoneOn).toBe(false);
    expect(phone.allowsRecording).toBe(false);
    expect(screen.getByText('Recording ready')).toBeTruthy();
  });

  it('Field Notes is still waiting for the microphone when Talk’s step answers: Talk switches the audio back, and Field Notes then records', async () => {
    const late = await leavesTalk();
    await act(async () => { show('notes'); });
    await settle();
    const asking = hold(phone.requestRecordingPermissionsAsync, phone.microphoneAllowed);
    fireEvent.press(screen.getByText('Start Recording'));
    await reached(asking);

    await act(async () => { late.release(); });
    await settle();
    expect(phone.allowsRecording).toBe(false);
    await act(async () => { asking.release(); });

    expect(await screen.findByText('Stop Recording')).toBeTruthy();
    expect(notes.microphoneOn).toBe(true);
    expect(phone.allowsRecording).toBe(true);
    expect(screen.queryByText(INTERRUPTED)).toBeNull();
  });

  it('as the reviewer put it, Talk’s start still waiting for the microphone permission when it is closed: it never takes the audio, and switches nothing back', async () => {
    await openTalk();
    const asking = hold(phone.requestRecordingPermissionsAsync, phone.microphoneAllowed);
    fireEvent.press(screen.getByText('Start Recording'));
    await reached(asking);
    await hideTalkWithoutCancel();
    await beginsDictatingOnFieldNotes();
    const audioModeCalls = phone.setAudioModeAsync.mock.calls.length;

    await act(async () => { asking.release(); });
    await settle();

    expect(phone.setAudioModeAsync.mock.calls.length).toBe(audioModeCalls);
    expect(talk.prepareToRecordAsync).not.toHaveBeenCalled();
    expect(notes.microphoneOn).toBe(true);
    expect(screen.getByText('Listening…')).toBeTruthy();
  });
});
