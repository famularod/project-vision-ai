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

describe('a recording that carried no sound at all (the Mac was using the iPhone’s microphone)', () => {
  it('says so in plain words, keeps it for Replay, and does not send it: not on Stop, and not when he first taps Continue', async () => {
    await putUp();
    await recordsFor(6, () => NOTHING);
    await stops();

    expect(screen.getByText('0:06')).toBeTruthy();
    expectSilentRecordingInTheSheet();

    // His first tap sends nothing; the line then also says how to send it anyway (item 9b).
    await taps('Continue');
    expectSilentRecordingInTheSheet(NO_SOUND_AND_HOW_TO_SEND_IT);

    // Not kept on the device either: brought back after a closed app it would be offered, and sent, as any other.
    await settle(200);
    expect(keptFiles()).toEqual([]);
    expect(keptEntryKeys()).toEqual([]);
  });

  it('does not send it on a sheet that sends on Stop (Field Notes, the guided task)', async () => {
    await putUp({ sendsOnStop: true, keeps: false });
    await recordsFor(6, () => NOTHING);
    await stops();

    expectSilentRecordingInTheSheet();
  });

  it('is the same when the recorder’s least is -120 (silence as a 32-bit number) or minus infinity', async () => {
    await putUp();
    await recordsFor(6, () => -120);
    await stops();
    expectSilentRecordingInTheSheet();

    await recordsFor(3, () => Number.NEGATIVE_INFINITY);
    await stops();
    expectSilentRecordingInTheSheet();
  });

  it('says so when the phone itself ended it (a lock, a call, the 3-minute limit)', async () => {
    await putUp();
    await recordsFor(6, () => NOTHING);
    await act(async () => { phone.recorder.stoppedByThePhone(); await pause(120); });

    expectSilentRecordingInTheSheet();
  });

  it('says it again at once, and still sends nothing, when the sheet was hidden and is shown again with it', async () => {
    await putUp();
    await recordsFor(6, () => NOTHING);
    await stops();
    expectSilentRecordingInTheSheet();

    await act(async () => { screenControls.hide(); await pause(40); });
    await act(async () => { screenControls.show(); await pause(120); });
    // At once, before any tap (review pass 5, V-L1).
    expectSilentRecordingInTheSheet();

    await taps('Continue');
    expectSilentRecordingInTheSheet(NO_SOUND_AND_HOW_TO_SEND_IT);
    expect(keptFiles()).toEqual([]);
  });

  it('is not offered "Close and Keep on This Device": X asks only whether to discard it', async () => {
    await putUp();
    await recordsFor(6, () => NOTHING);
    await stops();
    expectSilentRecordingInTheSheet();

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    await settle();

    expect(alert).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = alert.mock.calls[0] as [string, string, { text: string }[]];
    expect(title).toBe('Discard this recording?');
    expect(body).toBe('It has not been used yet. Discarding deletes it from this device.');
    expect(buttons.map(button => button.text)).toEqual(['Keep', 'Discard']);
    expect(serviceCalls()).toBe(0);
  });

  it('is told for THIS recording only: the next one, with sound, is sent as today', async () => {
    await putUp();
    await recordsFor(6, () => NOTHING);
    await stops();
    expectSilentRecordingInTheSheet();

    await recordsFor(6, () => SPEECH);
    await stops();
    expect(screen.queryByText(NO_SOUND_IPHONE)).toBeNull();
    await taps('Continue');

    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(sent).toEqual(['take-2']);
  });

  it('is found after a recording that had sound: each recording is judged by its own levels', async () => {
    await putUp();
    await recordsFor(6, () => SPEECH);
    await stops();
    await taps('Continue');
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Start Recording')).toBeTruthy();

    await recordsFor(6, () => NOTHING);
    await stops();

    expect(screen.getByText(NO_SOUND_IPHONE)).toBeTruthy();
    expect(screen.getByText('Recording ready')).toBeTruthy();
    await taps('Continue');
    expect(serviceCalls()).toBe(1);
    expect(sent).toEqual(['take-1']);
  });

  it('names the iPad on an iPad', async () => {
    const isPad = jest.spyOn(Platform as PlatformIOSStatic, 'isPad', 'get').mockReturnValue(true);
    putBack.push(() => isPad.mockRestore());
    await putUp();
    await recordsFor(6, () => NOTHING);
    await stops();

    expectSilentRecordingInTheSheet(NO_SOUND_IPAD);
    expect(screen.queryByText(NO_SOUND_IPHONE)).toBeNull();
  });
});

describe('a recording that had sound, however little, is sent as today', () => {
  it('a quiet room: nobody speaks, the microphone hears only the room', async () => {
    await putUp();
    await recordsFor(6, () => QUIET_ROOM);
    await stops();

    expect(screen.getByText('Recording ready')).toBeTruthy();
    // Kept on the device from "Recording ready" on, as before (review N1 L2).
    await waitFor(() => expect(keptFiles()).toHaveLength(1));
    await expectSentAsToday();
  });

  it('a whisper', async () => {
    await putUp();
    await recordsFor(4, ms => (ms % 1_000 === 0 ? WHISPER : QUIET_ROOM));
    await stops();

    await expectSentAsToday();
  });

  it('a short word: under two seconds is never judged, even if every level read nothing', async () => {
    await putUp();
    await recordsFor(1.8, () => NOTHING);
    await stops();

    expect(screen.getByText('0:01')).toBeTruthy();
    await expectSentAsToday();
  });

  it('a short word heard in one answer of the recorder among answers of nothing', async () => {
    await putUp();
    await recordsFor(3, ms => (ms === 1_400 ? WHISPER : NOTHING));
    await stops();

    await expectSentAsToday();
  });

  it('a long pause: a minute that read nothing but for one answer just above the line', async () => {
    await putUp();
    await recordsFor(60, ms => (ms === 30_000 ? -109 : NOTHING));
    await stops();

    await expectSentAsToday();
  });

  it('speech, then a dead pause to the end', async () => {
    await putUp();
    await recordsFor(20, ms => (ms <= 2_000 ? SPEECH : NOTHING));
    await stops();
    await expectSentAsToday();
  });

  it('a dead start with speech only at the very end', async () => {
    await putUp();
    await recordsFor(20, ms => (ms >= 19_800 ? SPEECH : NOTHING));
    await stops();
    await expectSentAsToday();
  });

  it('a recorder that gives no level at all is never judged', async () => {
    await putUp();
    await recordsFor(6, () => undefined);
    await stops();

    await expectSentAsToday();
  });

  it('on a sheet that sends on Stop, Stop sends it', async () => {
    await putUp({ sendsOnStop: true, keeps: false });
    await recordsFor(6, () => QUIET_ROOM);
    await stops();

    await expectSentAsToday();
  });

  it('X still offers "Close and Keep on This Device" for it', async () => {
    await putUp();
    await recordsFor(6, () => QUIET_ROOM);
    await stops();

    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    await settle();

    const [, , buttons] = alert.mock.calls[0] as [string, string, { text: string }[]];
    expect(buttons.map(button => button.text)).toEqual(['Keep', CLOSE_AND_KEEP, 'Discard']);
  });
});

describe('the speech service’s own answer', () => {
  it('keeps its own words for a recording that had sound and was not understood', async () => {
    transcription.transcribeDAVECaptureMemoryAudio.mockImplementation(async () => { throw new Error(NOT_UNDERSTOOD); });
    await putUp();
    await recordsFor(6, () => QUIET_ROOM);
    await stops();
    await taps('Continue');

    expect(await screen.findByText(NOT_UNDERSTOOD)).toBeTruthy();
    expect(screen.queryByText(NO_SOUND_IPHONE)).toBeNull();
    expect(serviceCalls()).toBe(1);
    expect(screen.getByText('Recording ready')).toBeTruthy();
    expect(screen.getByText('Replay Recording')).toBeTruthy();
  });
});

describe('what the recorder is asked for', () => {
  it('on an iPhone or iPad: the same recording as before, and its level', async () => {
    await putUp();

    expect(audio.useAudioRecorder).toHaveBeenCalled();
    audio.useAudioRecorder.mock.calls.forEach(([options]) => {
      expect(options).toEqual({ ...audio.RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
    });
  });

  it('anywhere else: exactly as before, with no level asked for, and a recording is never judged', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    putBack.push(() => os.restore());
    await putUp();

    audio.useAudioRecorder.mock.calls.forEach(([options]) => {
      expect(options).toEqual({ ...audio.RecordingPresets.HIGH_QUALITY, isMeteringEnabled: false });
    });

    await recordsFor(6, () => undefined);
    await stops();
    await expectSentAsToday();
  });
});

describe('the rule itself', () => {
  const after = (...levels: Level[]) => levels.reduce(
    (heard, level) => recording.noteDAVERecordingLevel(heard, level),
    recording.DAVE_NO_LEVELS_YET,
  );
  const times = (count: number, level: Level): Level[] => Array.from({ length: count }, () => level);

  it('is: at least ten answers, and not one of them above -110', () => {
    expect(recording.DAVE_NO_SOUND_LEVEL_DB).toBe(-110);
    expect(recording.DAVE_NO_SOUND_MIN_READINGS).toBe(10);
  });

  it('never judges a recording with no answers, or with fewer than ten', () => {
    expect(recording.daveRecordingHadNoSound(recording.DAVE_NO_LEVELS_YET)).toBe(false);
    expect(recording.daveRecordingHadNoSound(after(...times(9, NOTHING)))).toBe(false);
    expect(recording.daveRecordingHadNoSound(after(...times(10, NOTHING)))).toBe(true);
  });

  it('draws the line at -110: at it or under it is nothing, a hair above it is sound', () => {
    expect(recording.daveRecordingHadNoSound(after(...times(30, -110)))).toBe(true);
    expect(recording.daveRecordingHadNoSound(after(...times(30, -120)))).toBe(true);
    expect(recording.daveRecordingHadNoSound(after(...times(30, Number.NEGATIVE_INFINITY)))).toBe(true);
    expect(recording.daveRecordingHadNoSound(after(...times(30, -109.9)))).toBe(false);
    expect(recording.daveRecordingHadNoSound(after(...times(30, QUIET_ROOM)))).toBe(false);
    expect(recording.daveRecordingHadNoSound(after(...times(30, 3)))).toBe(false);
  });

  it('one answer with sound among nine hundred of nothing is sound', () => {
    expect(recording.daveRecordingHadNoSound(after(...times(450, NOTHING), -109.9, ...times(450, NOTHING)))).toBe(false);
  });

  it('does not count an answer that carries no level', () => {
    expect(recording.daveRecordingHadNoSound(after(...times(9, NOTHING), ...times(40, undefined)))).toBe(false);
    expect(recording.daveRecordingHadNoSound(after(...times(9, NOTHING), ...times(40, Number.NaN)))).toBe(false);
    expect(after(...times(4, undefined), -30, Number.NaN)).toEqual({ readings: 1, loudest: -30 });
  });

  it('has words for each device', () => {
    expect(recording.daveNoSoundMessage('iPhone')).toBe(NO_SOUND_IPHONE);
    expect(recording.daveNoSoundMessage('iPad')).toBe(NO_SOUND_IPAD);
  });
});
