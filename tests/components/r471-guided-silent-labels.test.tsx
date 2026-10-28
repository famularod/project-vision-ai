import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Alert, AppState, Platform, type PlatformIOSStatic } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import * as recording from '../../services/DAVEVoiceRecording';
import {
  keptEntryKeys,
  keptFiles,
  phone,
  releaseEveryHold,
  whatIsIn,
  type StandInRecorderStatus,
} from '../fixtures/voice-sheet-phone';

// Build 232 round, item 9 (13 Oct 2026; open item 4.57).
//
// On the owner's iPhone his Mac was using the iPhone as its microphone
// (Apple's Continuity). While a Mac program held it, every app on the iPhone
// recorded silence. In the voice sheet each try ended "Recording ready 0:06"
// and then "The voice service could not understand this recording. Record
// again in a quieter place or type the answer."; Replay Recording played
// nothing. Each try was a call to the speech service that could only fail,
// and the words sent him to the wrong place.
//
// The recorder says how loud its microphone is each time the sheet asks
// (every 200 ms): Apple's average power, 0 at full scale, -160 at the least.
// A recording during which it never once said more than -110, over at least
// ten answers (two seconds), carried no sound at all: the sheet says so,
// keeps it for Replay, and does not send it. A live microphone never reads
// that low, so a quiet room, a whisper, a short word and a long pause are
// sent as they were.

jest.mock('expo-audio', () => {
  const standIn = require('../fixtures/voice-sheet-phone').standInExpoAudio();
  return {
    ...standIn,
    // As expo-audio's own preset reads (src/RecordingConstants.ts), so the test can see it is still asked for.
    RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000 } },
    useAudioRecorder: jest.fn(standIn.useAudioRecorder),
  };
});
jest.mock('expo-file-system/legacy', () => require('../fixtures/voice-sheet-phone').standInFileSystem());
jest.mock('@react-native-async-storage/async-storage', () => require('../fixtures/voice-sheet-phone').standInAsyncStorage());
jest.mock('../../services/DAVEVoiceTranscriptionService', () => ({
  transcribeDAVECaptureMemoryAudio: jest.fn(),
}));

jest.setTimeout(30_000);

const audio = jest.requireMock('expo-audio') as {
  useAudioRecorder: jest.Mock;
  RecordingPresets: { HIGH_QUALITY: Record<string, unknown> };
};
const transcription = jest.requireMock('../../services/DAVEVoiceTranscriptionService') as { transcribeDAVECaptureMemoryAudio: jest.Mock };

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const CANOPY = 'Canopy Project';
const NO_SOUND_IPHONE =
  'The microphone gave no sound, so there is nothing to send. If your Mac or another device is using this iPhone\'s ' +
  'microphone, stop that, then record again. Restarting the iPhone also clears it.';
const NO_SOUND_IPAD =
  'The microphone gave no sound, so there is nothing to send. If another device is using this iPad\'s ' +
  'microphone, stop that, then record again. Restarting the iPad also clears it.';
// Item 9b (13 Oct 2026): after his first tap on the sheet's button the line also says how to send it anyway
// (tests/components/b232-9b-voice-no-sound-send-anyway.test.tsx has the second tap and what follows it).
const NO_SOUND_AND_HOW_TO_SEND_IT = `${NO_SOUND_IPHONE} If you did speak, tap Continue again to send it anyway.`;
const NOT_UNDERSTOOD = 'The voice service could not understand this recording. Record again in a quieter place or type the answer.';
const CLOSE_AND_KEEP = 'Close and Keep on This Device';

/** What Apple's recorder says of a microphone that gives nothing, and of one that is merely in a quiet room. */
const NOTHING = -160;
const QUIET_ROOM = -72;
const WHISPER = -52;
const SPEECH = -24;

const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => { await pause(ms); });

const called = { cancel: jest.fn(), words: jest.fn() };
const sent: string[] = [];
let screenControls: { hide: () => void; show: () => void };
let view: ReturnType<typeof render> | null = null;
let alert: jest.SpyInstance;
/** What a test changed about the device, put back after it. */
const putBack: (() => void)[] = [];

beforeEach(() => {
  phone.reset();
  sent.length = 0;
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
  transcription.transcribeDAVECaptureMemoryAudio.mockImplementation(async ({ uri }: { uri: string }) => {
    sent.push(whatIsIn(uri));
    return { transcript: 'Rebar passed inspection on level two.' };
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

/** A screen that owns a voice sheet as the app's screens do. Ask ECOS and Talk keep recordings on the device; Field Notes sends on Stop. */
function Phone({ sendsOnStop = false, keeps = true }: { sendsOnStop?: boolean; keeps?: boolean }) {
  const [open, setOpen] = useState(true);
  screenControls = { hide: () => setOpen(false), show: () => setOpen(true) };
  return (
    <NativeWorkspaceOwnerContext.Provider value="owner-a">
      <DAVEVoiceCaptureSheet
        visible={open}
        projectId={PROJECT_ID}
        projectName={CANOPY}
        candidateLocations={[]}
        title="Talk"
        captureLabel="What is the task?"
        continueLabel="Continue"
        keepSlot={keeps ? 'talk' : undefined}
        autoSubmitOnStop={sendsOnStop}
        onMemoryReady={called.words}
        onTypeInstead={() => setOpen(false)}
        onCancel={() => { called.cancel(); setOpen(false); }}
      />
    </NativeWorkspaceOwnerContext.Provider>
  );
}

async function putUp(sheet: { sendsOnStop?: boolean; keeps?: boolean } = {}) {
  view = render(<Phone {...sheet} />);
  await settle();
}

type Level = number | undefined;
const says = (next: Partial<StandInRecorderStatus> & { metering?: Level }) => phone.recorder.set(next as Partial<StandInRecorderStatus>);

/**
 * He records for `seconds`. The sheet asks the recorder how it is every
 * 200 ms, and is told how long it has recorded and how loud the microphone
 * is at that moment (`levelAt`; undefined when the recorder gives no level).
 */
async function recordsFor(seconds: number, levelAt: (ms: number) => Level) {
  // A real recorder measures afresh each time it is asked; the stand-in would repeat its last answer.
  await act(async () => { says({ metering: undefined }); });
  fireEvent.press(screen.getByText(screen.queryByText('Record Again') ? 'Record Again' : 'Start Recording'));
  expect(await screen.findByText(/^Stop (Recording|& Continue)$/)).toBeTruthy();
  for (let ms = 200; ms <= Math.round(seconds * 1_000); ms += 200) {
    await act(async () => { says({ durationMillis: ms, metering: levelAt(ms) }); });
  }
}

async function stops() {
  fireEvent.press(screen.getByText(/^Stop (Recording|& Continue)$/));
  await settle(120);
}

async function taps(label: string) {
  fireEvent.press(screen.getByText(label));
  await settle(120);
}

const serviceCalls = () => transcription.transcribeDAVECaptureMemoryAudio.mock.calls.length;

function expectSilentRecordingInTheSheet(words = NO_SOUND_IPHONE) {
  expect(screen.getByText(words)).toBeTruthy();
  // Still there for him to hear for himself, as he did on 13 Oct.
  expect(screen.getByText('Recording ready')).toBeTruthy();
  expect(screen.getByText('Replay Recording')).toBeTruthy();
  expect(screen.queryByText(NOT_UNDERSTOOD)).toBeNull();
  expect(serviceCalls()).toBe(0);
  expect(called.words).not.toHaveBeenCalled();
}

async function expectSentAsToday() {
  expect(screen.queryByText(NO_SOUND_IPHONE)).toBeNull();
  if (screen.queryByText('Continue')) await taps('Continue');
  await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
  expect(serviceCalls()).toBe(1);
  expect(sent).toEqual(['take-1']);
  expect(called.words).toHaveBeenCalledWith({ transcript: 'Rebar passed inspection on level two.' });
  expect(screen.queryByText(NO_SOUND_IPHONE)).toBeNull();
}


it('4.71 silent guided answer keeps actual no-sound error and replay without success wording',async()=>{
 await putUp();await recordsFor(4,()=>NOTHING);await stops();expect(screen.getByText(NO_SOUND_IPHONE)).toBeTruthy();expect(screen.queryByText('Recording ready')).toBeNull();expect(screen.queryByText('Answer recorded for: What is the task?')).toBeNull();expect(screen.getByText('Replay Recording')).toBeTruthy();expect(serviceCalls()).toBe(0);expect(called.words).not.toHaveBeenCalled();
});
