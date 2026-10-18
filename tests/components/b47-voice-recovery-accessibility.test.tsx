import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, Alert, AppState, Platform, ScrollView, type PlatformIOSStatic } from 'react-native';

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

it('4.80 persists the silent send-anyway judgment across an offline queue and a real remount',async()=>{
 theServiceAnswers(()=>daveVoiceWaitingForSignalError());await putUp();await recordsNothingAndStops();await taps('Continue');await taps('Continue');
 expect(serviceCalls()).toBe(1);expect(keptFiles()).toHaveLength(1);const retained=keptFiles()[0];
 view!.unmount();view=null;await settle(200);theServiceAnswers(()=>new Error(NOT_UNDERSTOOD));await putUp();
 await waitFor(()=>expect(serviceCalls()).toBe(2));expect(await screen.findByText(NOTHING_FOUND)).toBeTruthy();
 expect(keptFiles()).toContain(retained);expect(called.words).not.toHaveBeenCalled();expect(screen.getByText('Replay Recording')).toBeTruthy();
});
it('4.90 announces changed no-sound guidance once, including the first deliberate override tap',async()=>{
 const announce=jest.spyOn(AccessibilityInfo,'announceForAccessibility').mockImplementation(()=>undefined);
 try{await putUp(SHEETS[5]);await recordsNothingAndStops();await waitFor(()=>expect(announce).toHaveBeenCalledWith(NO_SOUND));
 await taps('Retry Answer');await waitFor(()=>expect(announce).toHaveBeenCalledWith(howToSendAnyway('Retry Answer')));expect(serviceCalls()).toBe(0);
 const count=announce.mock.calls.length;await settle(300);expect(announce).toHaveBeenCalledTimes(count);
 }finally{announce.mockRestore();}
});

it('4.90 reveals Retry at its measured content position after long guidance without invoking it',async()=>{
 const scroll=jest.spyOn(ScrollView.prototype,'scrollTo').mockImplementation(()=>undefined);
 try{await putUp(SHEETS[5]);await recordsNothingAndStops();
 const actions=screen.getByTestId('voice-recording-actions');
 expect(typeof actions.props.onLayout).toBe('function');fireEvent(actions,'layout',{nativeEvent:{layout:{x:0,y:1100,width:320,height:112}}});
 await waitFor(()=>expect(scroll).toHaveBeenCalledWith({y:1100,animated:false}));expect(serviceCalls()).toBe(0);
 await taps('Retry Answer');expect(screen.getByText(howToSendAnyway('Retry Answer'))).toBeTruthy();expect(serviceCalls()).toBe(0);
 const count=scroll.mock.calls.length;await settle(250);expect(scroll).toHaveBeenCalledTimes(count);
 }finally{scroll.mockRestore();}
});
