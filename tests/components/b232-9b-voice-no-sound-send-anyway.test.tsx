import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Alert, AppState, Platform, type PlatformIOSStatic } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import * as recording from '../../services/DAVEVoiceRecording';
import { daveVoiceWaitingForSignalError } from '../../services/DAVEVoiceSignalWait';
import { keepVoiceRecording } from '../../services/KeptVoiceRecording';
import {
  keptEntryKeys,
  keptFiles,
  phone,
  releaseEveryHold,
  whatIsIn,
  type StandInRecorderStatus,
} from '../fixtures/voice-sheet-phone';

// Build 232 round, item 9b (13 Oct 2026): a way out when a recording is judged to have no sound.
//
// Item 9 does not send a recording whose microphone gave no level above -110 dB over at least ten
// answers. That level has never been measured on a phone, nor on a recorder's second recording, nor
// through AirPods or a car. Read wrong on some phone or microphone, every dictation of two seconds or
// more was refused there until a new build: he could replay it and hear himself, record again (refused
// again) or type it, and could neither send it nor keep it.
//
// The coordinator's decision: nothing is sent by itself, as before. His FIRST tap on the sheet's own
// button sends nothing, and the red line then also says how to send it anyway, naming that button. His
// SECOND tap on it, for the same recording, sends it as any recording is sent. When the speech service
// can make nothing of it either, the sheet says both things, with the advice for a microphone that
// gives nothing, and not the service's "Record again in a quieter place". The taps are counted for one
// recording, on one showing of the sheet.

jest.mock('expo-audio', () => {
  const standIn = require('../fixtures/voice-sheet-phone').standInExpoAudio();
  return {
    ...standIn,
    RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000 } },
    useAudioRecorder: jest.fn(standIn.useAudioRecorder),
  };
});
jest.mock('expo-file-system/legacy', () => require('../fixtures/voice-sheet-phone').standInFileSystem());
jest.mock('@react-native-async-storage/async-storage', () => require('../fixtures/voice-sheet-phone').standInAsyncStorage());
jest.mock('../../services/DAVEVoiceTranscriptionService', () => ({
  transcribeDAVECaptureMemoryAudio: jest.fn(),
}));

jest.setTimeout(60_000);

const transcription = jest.requireMock('../../services/DAVEVoiceTranscriptionService') as { transcribeDAVECaptureMemoryAudio: jest.Mock };

/** The speech service's own words for an answer of its server, from the service itself (not copied here). */
function theServiceSays(status: number, body: { error: string } | null): string {
  const service = jest.requireActual('../../services/DAVEVoiceTranscriptionService') as {
    daveVoiceTranscriptionErrorMessage: (status: number, body: { error: string } | null) => string;
  };
  return service.daveVoiceTranscriptionErrorMessage(status, body);
}

const CANOPY = { id: '11111111-2222-4333-8444-555555555555', name: 'Canopy Project' };
const HARBOR = { id: '99999999-2222-4333-8444-555555555555', name: 'Harbor Fitout' };

const ADVICE_IPHONE =
  'If your Mac or another device is using this iPhone\'s microphone, stop that, then record again. Restarting the iPhone also clears it.';
const ADVICE_IPAD =
  'If another device is using this iPad\'s microphone, stop that, then record again. Restarting the iPad also clears it.';
/** The line of item 9, word for word: it is not changed. */
const NO_SOUND = `The microphone gave no sound, so there is nothing to send. ${ADVICE_IPHONE}`;
const NO_SOUND_IPAD = `The microphone gave no sound, so there is nothing to send. ${ADVICE_IPAD}`;
/** After his first tap on the sheet's button: the same line, and how to send it anyway, naming that button. */
const howToSendAnyway = (button: string, line = NO_SOUND) => `${line} If you did speak, tap ${button} again to send it anyway.`;
/** The speech service's own words when it can make nothing of a recording. */
const NOT_UNDERSTOOD = 'The voice service could not understand this recording. Record again in a quieter place or type the answer.';
/** What the sheet says instead, of a recording it had judged to have no sound and he sent anyway. */
const NOTHING_FOUND =
  `The voice service could not make out any words in this recording, and the microphone seemed to give no sound. ${ADVICE_IPHONE}`;
const NOTHING_FOUND_IPAD =
  `The voice service could not make out any words in this recording, and the microphone seemed to give no sound. ${ADVICE_IPAD}`;
const ANY_NO_SOUND_LINE = /no sound/;
const CLOSE_AND_KEEP = 'Close and Keep on This Device';
const WORDS = { transcript: 'Rebar passed inspection on level two.' };

const NOTHING = -160;
const QUIET_ROOM = -72;
const SPEECH = -24;

/**
 * The voice sheets as the app puts them up: what their button says, whether Stop itself sends, and
 * whether they keep recordings on the device. (`button` undefined is the sheet's own "Review Memory".)
 */
type Sheet = { sheet: string; title?: string; button?: string; says: string; sendsOnStop: boolean; keeps: boolean };
const TALK: Sheet = { sheet: 'Talk', title: 'Talk', button: 'Continue', says: 'Continue', sendsOnStop: false, keeps: true };
const SHEETS: Sheet[] = [
  TALK,
  { sheet: 'Ask ECOS', title: 'Ask ECOS', button: 'Ask ECOS', says: 'Ask ECOS', sendsOnStop: false, keeps: true },
  { sheet: 'the Project Walk', says: 'Review Memory', sendsOnStop: false, keeps: true },
  { sheet: 'Field Notes', title: 'Record Field Note', button: 'Use Note', says: 'Use Note', sendsOnStop: true, keeps: true },
  { sheet: 'a task instruction', title: 'Record Task Instruction', button: 'Use Transcript', says: 'Use Transcript', sendsOnStop: false, keeps: false },
  { sheet: 'a guided task answer', title: 'Answer: Trade', button: 'Retry Answer', says: 'Retry Answer', sendsOnStop: true, keeps: false },
];

const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const settle = (ms = 80) => act(async () => { await pause(ms); });

const called = { cancel: jest.fn(), words: jest.fn() };
const sent: { holds: string; project: string }[] = [];
let controls: { hide: () => void; show: (project?: typeof CANOPY) => void };
let view: ReturnType<typeof render> | null = null;
let alert: jest.SpyInstance;
const putBack: (() => void)[] = [];

beforeEach(() => {
  phone.reset();
  sent.length = 0;
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
  transcription.transcribeDAVECaptureMemoryAudio.mockImplementation(async ({ uri, projectName }: { uri: string; projectName: string }) => {
    sent.push({ holds: whatIsIn(uri), project: projectName });
    return WORDS;
  });
  Object.values(called).forEach(mock => mock.mockReset());
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (AppState as { currentState: unknown }).currentState = 'active';
});
afterEach(async () => {
  view?.unmount();
  view = null;
  releaseEveryHold();
  alert.mockRestore();
  putBack.splice(0).forEach(undo => undo());
  await pause();
});

function Phone({ title, button, sendsOnStop, keeps }: Sheet) {
  const [open, setOpen] = useState(true);
  const [project, setProject] = useState(CANOPY);
  controls = { hide: () => setOpen(false), show: (next = project) => { setProject(next); setOpen(true); } };
  return (
    <NativeWorkspaceOwnerContext.Provider value="owner-a">
      <DAVEVoiceCaptureSheet
        visible={open}
        projectId={project.id}
        projectName={project.name}
        candidateLocations={[]}
        title={title}
        continueLabel={button}
        keepSlot={keeps ? 'talk' : undefined}
        autoSubmitOnStop={sendsOnStop}
        onMemoryReady={called.words}
        onTypeInstead={() => setOpen(false)}
        onCancel={() => { called.cancel(); setOpen(false); }}
      />
    </NativeWorkspaceOwnerContext.Provider>
  );
}

async function putUp(sheet: Sheet = TALK) {
  view = render(<Phone {...sheet} />);
  await settle();
}

type Level = number | undefined;
const says = (next: Partial<StandInRecorderStatus> & { metering?: Level }) => phone.recorder.set(next as Partial<StandInRecorderStatus>);

/** He records for `seconds`; every 200 ms the sheet is told the length and how loud the microphone is. */
async function recordsFor(seconds: number, levelAt: (ms: number) => Level) {
  await act(async () => { says({ metering: undefined }); });
  fireEvent.press(screen.getByText(screen.queryByText('Record Again') ? 'Record Again' : 'Start Recording'));
  expect(await screen.findByText(/^Stop (Recording|& Continue)$/)).toBeTruthy();
  for (let ms = 200; ms <= Math.round(seconds * 1_000); ms += 200) {
    await act(async () => { says({ durationMillis: ms, metering: levelAt(ms) }); });
  }
}
async function stops() {
  fireEvent.press(screen.getByText(/^Stop (Recording|& Continue)$/));
  await settle(140);
}
/** He taps a button by its words. (On Ask ECOS the sheet's heading says the same; the button comes after it.) */
async function taps(label: string) {
  const found = screen.getAllByText(label);
  fireEvent.press(found[found.length - 1]);
  await settle(140);
}
async function recordsNothingAndStops(seconds = 6) {
  await recordsFor(seconds, () => NOTHING);
  await stops();
}
async function tapsX() {
  fireEvent.press(screen.getByLabelText('Cancel memory capture'));
  await settle();
  return alert.mock.calls[alert.mock.calls.length - 1] as [string, string, { text: string; onPress?: () => void }[]];
}
const serviceCalls = () => transcription.transcribeDAVECaptureMemoryAudio.mock.calls.length;
const theServiceAnswers = (failure: () => Error, always = false) => {
  const fails = async () => { throw failure(); };
  if (always) transcription.transcribeDAVECaptureMemoryAudio.mockImplementation(fails);
  else transcription.transcribeDAVECaptureMemoryAudio.mockImplementationOnce(fails);
};

/** Still in the sheet, to replay or record again, and nothing has gone to the speech service. */
function expectStillHereAndNothingSent() {
  expect(screen.getByText('Recording ready')).toBeTruthy();
  expect(screen.getByText('Replay Recording')).toBeTruthy();
  expect(screen.getByText('Record Again')).toBeTruthy();
  expect(serviceCalls()).toBe(0);
  expect(called.words).not.toHaveBeenCalled();
}

describe('a recording judged to have no sound: the first tap says how to send it anyway, the second sends it', () => {
  it.each(SHEETS)('$sheet: nothing goes on Stop or on the first tap on "$says"; the second tap sends it once, and it goes on as any recording', async sheet => {
    await putUp(sheet);
    await recordsNothingAndStops();

    // On Stop, also where Stop itself sends: the line as it was, and nothing sent.
    expect(screen.getByText(NO_SOUND)).toBeTruthy();
    expectStillHereAndNothingSent();

    await taps(sheet.says);
    expect(screen.getByText(howToSendAnyway(sheet.says))).toBeTruthy();
    expectStillHereAndNothingSent();

    await taps(sheet.says);
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(serviceCalls()).toBe(1);
    expect(sent).toEqual([{ holds: 'take-1', project: CANOPY.name }]);
    expect(called.words).toHaveBeenCalledWith(WORDS);
    // As after any recording that was used: out of the sheet, nothing red, nothing of it left on the device.
    expect(await screen.findByText('Start Recording')).toBeTruthy();
    expect(screen.queryByText(ANY_NO_SOUND_LINE)).toBeNull();
    await settle(200);
    expect(keptFiles()).toEqual([]);
    expect(keptEntryKeys()).toEqual([]);
  });

  it('names the iPad on an iPad, in both lines', async () => {
    const isPad = jest.spyOn(Platform as PlatformIOSStatic, 'isPad', 'get').mockReturnValue(true);
    putBack.push(() => isPad.mockRestore());
    theServiceAnswers(() => new Error(theServiceSays(502, null)));
    await putUp();
    await recordsNothingAndStops();
    expect(screen.getByText(NO_SOUND_IPAD)).toBeTruthy();

    await taps('Continue');
    expect(screen.getByText(howToSendAnyway('Continue', NO_SOUND_IPAD))).toBeTruthy();
    expect(serviceCalls()).toBe(0);

    await taps('Continue');
    expect(await screen.findByText(NOTHING_FOUND_IPAD)).toBeTruthy();
    expect(serviceCalls()).toBe(1);
  });

  it('a recording the phone itself ended (a lock, a call, the limit) is not sent by that, and needs the two taps too', async () => {
    await putUp();
    await recordsFor(6, () => NOTHING);
    await act(async () => { phone.recorder.stoppedByThePhone(); await pause(140); });
    expect(screen.getByText(NO_SOUND)).toBeTruthy();
    expectStillHereAndNothingSent();

    await taps('Continue');
    expect(screen.getByText(howToSendAnyway('Continue'))).toBeTruthy();
    expectStillHereAndNothingSent();

    await taps('Continue');
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([{ holds: 'take-1', project: CANOPY.name }]);
  });
});

describe('a recording with sound is not touched by any of this', () => {
  it.each(SHEETS)('$sheet: sent as today, by one tap on "$says" (by Stop where Stop sends)', async sheet => {
    await putUp(sheet);
    await recordsFor(6, () => QUIET_ROOM);
    await stops();

    expect(screen.queryByText(ANY_NO_SOUND_LINE)).toBeNull();
    if (!sheet.sendsOnStop) {
      expect(serviceCalls()).toBe(0);
      await taps(sheet.says);
    }
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(serviceCalls()).toBe(1);
    expect(sent).toEqual([{ holds: 'take-1', project: CANOPY.name }]);
    expect(screen.queryByText(ANY_NO_SOUND_LINE)).toBeNull();
  });

  it('one the speech service could not understand keeps the service’s own words, also straight after one that was sent anyway', async () => {
    theServiceAnswers(() => new Error(theServiceSays(502, null)), true);
    await putUp();
    await recordsNothingAndStops();
    await taps('Continue');
    await taps('Continue');
    expect(await screen.findByText(NOTHING_FOUND)).toBeTruthy();

    await recordsFor(6, () => SPEECH);
    await stops();
    expect(screen.queryByText(ANY_NO_SOUND_LINE)).toBeNull();
    await taps('Continue');

    expect(await screen.findByText(NOT_UNDERSTOOD)).toBeTruthy();
    expect(screen.queryByText(ANY_NO_SOUND_LINE)).toBeNull();
    expect(serviceCalls()).toBe(2);
  });
});

describe('sent anyway, and what the speech service answers', () => {
  it.each([
    ['its answer 502', 502, null],
    ['"transcription_empty"', 422, { error: 'transcription_empty' }],
    ['"transcription_provider_failed"', 500, { error: 'transcription_provider_failed' }],
  ] as const)('it could make nothing of it either (%s): the sheet says both, and does not send him to a quieter place', async (_name, status, body) => {
    const itsWords = theServiceSays(status, body);
    expect(itsWords).toBe(NOT_UNDERSTOOD);
    theServiceAnswers(() => new Error(itsWords));
    await putUp();
    await recordsNothingAndStops();
    await taps('Continue');
    await taps('Continue');

    expect(await screen.findByText(NOTHING_FOUND)).toBeTruthy();
    expect(screen.queryByText(/quieter place/)).toBeNull();
    expect(screen.queryByText(/nothing to send/)).toBeNull();
    expect(serviceCalls()).toBe(1);
    // As any recording that was sent and failed: still in the sheet.
    expect(screen.getByText('Recording ready')).toBeTruthy();
    expect(screen.getByText('Replay Recording')).toBeTruthy();
    expect(screen.getByText('Record Again')).toBeTruthy();
    expect(called.words).not.toHaveBeenCalled();
  });

  it('a third tap is a retry as for any recording: sent again at once, and the same truth is said again', async () => {
    theServiceAnswers(() => new Error(theServiceSays(502, null)), true);
    await putUp();
    await recordsNothingAndStops();
    await taps('Continue');
    await taps('Continue');
    expect(await screen.findByText(NOTHING_FOUND)).toBeTruthy();
    expect(serviceCalls()).toBe(1);

    await taps('Continue');
    await waitFor(() => expect(serviceCalls()).toBe(2));
    expect(await screen.findByText(NOTHING_FOUND)).toBeTruthy();
    expect(screen.queryByText(/quieter place/)).toBeNull();
    expect(screen.queryByText(/send it anyway/)).toBeNull();
  });

  it.each([
    ['no signal', () => daveVoiceWaitingForSignalError(),
      'No signal. Your recording is kept while Vitruvius stays open — tap Use Transcript when you have signal.'],
    ['a time-out', () => new Error('The voice upload timed out. Retry this recording or type instead. (VOICE-TIMEOUT)'),
      'The voice upload timed out. Retry this recording or type instead. (VOICE-TIMEOUT)'],
    ['signed out', () => new Error(theServiceSays(401, null)),
      'Your sign-in could not be verified for voice transcription. Sign in again, then retry.'],
    ['the service down', () => new Error(theServiceSays(503, null)),
      'Voice transcription is temporarily unavailable. Try again shortly or type the answer.'],
    ['an empty file', () => new Error(theServiceSays(400, { error: 'audio_file_empty' })),
      'No usable audio was recorded. Record again and speak for at least one second.'],
  ] as const)('any other failure keeps its own words (%s), and a third tap tries again as today', async (_name, failure, itsWords) => {
    theServiceAnswers(failure);
    const sheet = SHEETS[4];
    await putUp(sheet);
    await recordsNothingAndStops();
    await taps(sheet.says);
    await taps(sheet.says);

    expect(await screen.findByText(itsWords)).toBeTruthy();
    expect(screen.queryByText(ANY_NO_SOUND_LINE)).toBeNull();
    expect(serviceCalls()).toBe(1);
    expect(screen.getByText('Recording ready')).toBeTruthy();

    await taps(sheet.says);
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(serviceCalls()).toBe(2);
    expect(sent).toEqual([{ holds: 'take-1', project: CANOPY.name }]);
  });

  it('is kept on the device, and offered "Close and Keep", only from the second tap on: then it is a recording that was sent, as any other', async () => {
    theServiceAnswers(() => daveVoiceWaitingForSignalError());
    await putUp();
    await recordsNothingAndStops();
    await taps('Continue');

    // After the first tap it is still a recording with no sound: not kept, and X asks only whether to discard it.
    await settle(200);
    expect(keptFiles()).toEqual([]);
    expect(keptEntryKeys()).toEqual([]);
    expect((await tapsX())[2].map(button => button.text)).toEqual(['Keep', 'Discard']);
    expect(screen.getByText(howToSendAnyway('Continue'))).toBeTruthy();

    // He stays (Keep), and taps again: sent, with no signal.
    await taps('Continue');
    expect(await screen.findByText(
      'No signal. Your recording is kept on this device — tap Continue when you have signal. ' +
        'If Vitruvius closes, it is tried again the next time you open this.',
    )).toBeTruthy();
    expect(serviceCalls()).toBe(1);
    expect(keptFiles()).toHaveLength(1);
    expect((await tapsX())[2].map(button => button.text)).toEqual(['Keep', CLOSE_AND_KEEP, 'Discard']);
  });
});

describe('the taps are counted for one recording, on one showing of the sheet', () => {
  it('Record Again after a first tap: the next recording with no sound needs two taps again', async () => {
    await putUp();
    await recordsNothingAndStops();
    await taps('Continue');
    expect(screen.getByText(howToSendAnyway('Continue'))).toBeTruthy();

    await recordsNothingAndStops();
    // The new recording's own first line: nothing about "again".
    expect(screen.getByText(NO_SOUND)).toBeTruthy();
    await taps('Continue');
    expect(screen.getByText(howToSendAnyway('Continue'))).toBeTruthy();
    expectStillHereAndNothingSent();

    await taps('Continue');
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(serviceCalls()).toBe(1);
    expect(sent).toEqual([{ holds: 'take-2', project: CANOPY.name }]);
  });

  it('Record Again after a first tap, this time with sound: one tap sends it', async () => {
    await putUp();
    await recordsNothingAndStops();
    await taps('Continue');

    await recordsFor(6, () => SPEECH);
    await stops();
    expect(screen.queryByText(ANY_NO_SOUND_LINE)).toBeNull();
    await taps('Continue');
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([{ holds: 'take-2', project: CANOPY.name }]);
  });

  it('review pass 5, V-L1: hidden without his Cancel and shown again for the same project, the red line is there at once', async () => {
    await putUp();
    await recordsNothingAndStops();
    expect(screen.getByText(NO_SOUND)).toBeTruthy();

    await act(async () => { controls.hide(); await pause(60); });
    await act(async () => { controls.show(); await pause(200); });

    expect(screen.getByText(NO_SOUND)).toBeTruthy();
    expectStillHereAndNothingSent();
    expect(keptFiles()).toEqual([]);
  });

  it('a tap made before the sheet was hidden is not counted when it is shown again: two taps from there', async () => {
    await putUp();
    await recordsNothingAndStops();
    await taps('Continue');
    expect(screen.getByText(howToSendAnyway('Continue'))).toBeTruthy();

    await act(async () => { controls.hide(); await pause(60); });
    await act(async () => { controls.show(); await pause(200); });
    // What is on screen again is the first line, which does not say "again".
    expect(screen.getByText(NO_SOUND)).toBeTruthy();

    await taps('Continue');
    expect(screen.getByText(howToSendAnyway('Continue'))).toBeTruthy();
    expectStillHereAndNothingSent();

    await taps('Continue');
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(serviceCalls()).toBe(1);
    expect(sent).toEqual([{ holds: 'take-1', project: CANOPY.name }]);
  });

  it('shown for another project after a first tap: that project’s own kept recording is sent with one tap', async () => {
    await putUp();
    phone.files.add('file:///cache/Audio/harbor-old.m4a');
    phone.contents.set('file:///cache/Audio/harbor-old.m4a', 'harbor-kept');
    await act(async () => {
      await keepVoiceRecording('owner-a', 'talk', {
        uri: 'file:///cache/Audio/harbor-old.m4a', durationMs: 5_000, projectId: HARBOR.id, projectName: HARBOR.name, state: 'ready',
      });
    });
    await recordsNothingAndStops();
    await taps('Continue');
    expect(screen.getByText(howToSendAnyway('Continue'))).toBeTruthy();

    await act(async () => { controls.hide(); await pause(60); });
    await act(async () => { controls.show(HARBOR); await pause(260); });
    expect(screen.getByText('Recording ready')).toBeTruthy();
    expect(screen.queryByText(ANY_NO_SOUND_LINE)).toBeNull();

    await taps('Continue');
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([{ holds: 'harbor-kept', project: HARBOR.name }]);
  });

  it('a recording restored from the device after a first tap and Discard: one tap sends it', async () => {
    await putUp();
    await recordsNothingAndStops();
    await taps('Continue');
    const [, , buttons] = await tapsX();
    await act(async () => { buttons[buttons.length - 1].onPress?.(); await pause(140); });
    expect(called.cancel).toHaveBeenCalledTimes(1);

    phone.files.add('file:///cache/Audio/from-before.m4a');
    phone.contents.set('file:///cache/Audio/from-before.m4a', 'kept-from-before');
    await act(async () => {
      await keepVoiceRecording('owner-a', 'talk', {
        uri: 'file:///cache/Audio/from-before.m4a', durationMs: 7_000, projectId: CANOPY.id, projectName: CANOPY.name, state: 'ready',
      });
    });
    await act(async () => { controls.show(); await pause(200); });
    expect(screen.getByText(/^Kept from /)).toBeTruthy();
    expect(screen.queryByText(ANY_NO_SOUND_LINE)).toBeNull();

    await taps('Continue');
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([{ holds: 'kept-from-before', project: CANOPY.name }]);
  });
});

describe('the words, and which answers of the speech service count as "could make nothing of it"', () => {
  it('the first line is unchanged; the second names the sheet’s button; the third says both things with the same advice', () => {
    expect(recording.daveNoSoundMessage('iPhone')).toBe(NO_SOUND);
    expect(recording.daveNoSoundMessage('iPad')).toBe(NO_SOUND_IPAD);
    expect(recording.daveNoSoundSendAnywayMessage('iPhone', 'Ask ECOS')).toBe(howToSendAnyway('Ask ECOS'));
    expect(recording.daveNoSoundSendAnywayMessage('iPad', 'Use Note')).toBe(howToSendAnyway('Use Note', NO_SOUND_IPAD));
    expect(recording.daveNoSoundAndNotUnderstoodMessage('iPhone')).toBe(NOTHING_FOUND);
    expect(recording.daveNoSoundAndNotUnderstoodMessage('iPad')).toBe(NOTHING_FOUND_IPAD);
  });

  it('knows the service’s "could not understand" by the service’s own words, and no other failure', () => {
    const understoodNothing = (status: number, body: { error: string } | null) =>
      recording.daveVoiceServiceCouldNotUnderstand(new Error(theServiceSays(status, body)));

    expect(understoodNothing(502, null)).toBe(true);
    expect(understoodNothing(422, { error: 'transcription_empty' })).toBe(true);
    expect(understoodNothing(500, { error: 'transcription_provider_failed' })).toBe(true);

    [401, 403, 409, 429, 503, 0, 500].forEach(status => expect(understoodNothing(status, null)).toBe(false));
    expect(understoodNothing(400, { error: 'audio_file_empty' })).toBe(false);
    expect(recording.daveVoiceServiceCouldNotUnderstand(daveVoiceWaitingForSignalError())).toBe(false);
    expect(recording.daveVoiceServiceCouldNotUnderstand(new Error('The voice upload timed out. Retry this recording or type instead. (VOICE-TIMEOUT)'))).toBe(false);
    expect(recording.daveVoiceServiceCouldNotUnderstand(NOT_UNDERSTOOD)).toBe(false);
    expect(recording.daveVoiceServiceCouldNotUnderstand(undefined)).toBe(false);
  });
});
