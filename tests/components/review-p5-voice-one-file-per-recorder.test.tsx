import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Alert, AppState } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { keepVoiceRecording, readKeptVoiceRecording } from '../../services/KeptVoiceRecording';
import { cacheFiles, hold, keptEntryKeys, keptFiles, phone, releaseEveryHold, whatIsIn, type Hold } from '../fixtures/voice-sheet-phone';

// Review pass 5, N2 (6 Oct 2026; half from the pass-4 L4 fix, half older).
//
// On an iPhone a voice sheet's recorder writes EVERY recording to the same
// file: expo-audio picks the file once, when the recorder is made. A
// recording that the sheet had let go of was kept "for next time" by copying
// that file and deleting it afterwards, and two callers did not hold Start
// Recording back while that went on: a recording a lock ended on a sheet
// being hidden, and a recording let go of when the sheet is shown for
// another project. With the copy slow and a new dictation begun on the
// sheet, the copy kept for the first held the SECOND, the first was gone,
// and the recorder's file was deleted under the dictation in progress.
//
// Now Start Recording and Record Again wait until every keep and delete of
// the sheet's last recording has finished, whoever asked for it; and his
// Cancel of nothing no longer deletes the recorder's file while an earlier
// recording there is still being kept. The stand-in phone says which take a
// file holds (tests/fixtures/voice-sheet-phone.ts); both kinds of recorder
// are run.

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
const HARBOR = 'Harbor North';
const idOf = (projectName: string) => `${PROJECT_ID}-${projectName.length}`;
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => { await pause(ms); });

const called = { cancel: jest.fn(), words: jest.fn() };
/** What each recording sent for its words held, and for which project. */
const sent: string[] = [];
type Controls = {
  /** The sheet is hidden without his Cancel, as when a panel that failed to draw closes every sheet. */
  hide: () => void;
  showFor: (projectName: string) => void;
};
let screenControls: Controls;
let view: ReturnType<typeof render> | null = null;
let alert: jest.SpyInstance;

beforeEach(() => {
  phone.reset();
  sent.length = 0;
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
  transcription.transcribeDAVECaptureMemoryAudio.mockImplementation(async ({ uri, projectName }: { uri: string; projectName: string }) => {
    sent.push(`${whatIsIn(uri)} for ${projectName}`);
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
  await pause();
});

/** A screen that owns a voice sheet as the app's screens do: it stays in place and is shown or hidden. */
function Phone() {
  const [shown, setShown] = useState({ open: true, projectName: CANOPY });
  screenControls = {
    hide: () => setShown(current => ({ ...current, open: false })),
    showFor: projectName => setShown({ open: true, projectName }),
  };
  const hide = () => setShown(current => ({ ...current, open: false }));
  return (
    <NativeWorkspaceOwnerContext.Provider value="owner-a">
      <DAVEVoiceCaptureSheet
        visible={shown.open}
        projectId={idOf(shown.projectName)}
        projectName={shown.projectName}
        candidateLocations={[]}
        title="Talk"
        continueLabel="Continue"
        keepSlot="talk"
        onMemoryReady={called.words}
        onTypeInstead={hide}
        onCancel={() => { called.cancel(); hide(); }}
      />
    </NativeWorkspaceOwnerContext.Provider>
  );
}

/** Vitruvius is open with Talk on screen for Canopy Project. */
async function openTalk() {
  view = render(<Phone />);
  // The kept-recording check has answered.
  await settle();
}

/** Waits until a slow step has been reached; a step that never is fails its test instead of hanging it. */
const reached = (made: Hold) => act(async () => {
  await Promise.race([
    made.reached,
    new Promise<void>((_resolve, reject) => { setTimeout(() => reject(new Error('The slow step was never reached.')), 1_500); }),
  ]);
});

const hideWithoutCancel = () => act(async () => { screenControls.hide(); });
const showFor = async (projectName: string) => {
  await act(async () => { screenControls.showFor(projectName); await pause(20); });
};

/** He is dictating on the open sheet (take-1 is the first recording made on this phone, and so on). */
async function dictating(seconds = 12) {
  fireEvent.press(screen.getByText(screen.queryByText('Record Again') ? 'Record Again' : 'Start Recording'));
  expect(await screen.findByText('Stop Recording')).toBeTruthy();
  await act(async () => { phone.recorder.set({ durationMillis: seconds * 1_000 }); });
  expect(phone.microphoneOn).toBe(true);
}

/** Nothing of a dictation in progress is ever deleted with, or made over by, an earlier one. */
function expectAnyDictationInProgressHasItsFile() {
  phone.recorders.filter(recorder => recorder.microphoneOn).forEach(recorder => {
    expect(whatIsIn(recorder.file)).toBe(`take-${phone.takes}`);
  });
}

/** The phone answers the slow step; whatever was waiting for it goes on. */
async function answers(slow: Hold) {
  await act(async () => { slow.release(); await pause(); });
  expectAnyDictationInProgressHasItsFile();
  await settle(120);
  expectAnyDictationInProgressHasItsFile();
}

const copies = async ({ from, to }: { from: string; to: string }) => phone.copyFile({ from, to });

type Recorders = Readonly<{ name: string; outlive: boolean }>;
const RECORDERS: readonly Recorders[] = [
  { name: 'the recorder goes with its screen, as expo-audio’s does', outlive: false },
  { name: 'the recorder outlives its screen, as the earlier tests’ stand-in does', outlive: true },
];

describe.each(RECORDERS)('$name', ({ outlive }) => {
  beforeEach(() => { phone.recordersOutliveTheirScreen = outlive; });

  describe('a lock ends his dictation as the sheet is hidden without his Cancel, and the phone is slow to copy it', () => {
    /** Take-1 is being kept for Canopy Project by a copy that has not finished. */
    async function firstTakeStillBeingCopied(): Promise<Hold> {
      await openTalk();
      await dictating();
      const recorder = phone.recorder;
      const slowStop = hold(recorder.stop, recorder.stopAnswers);
      await act(async () => { recorder.stoppedByThePhone(); });
      await reached(slowStop);
      await hideWithoutCancel();
      const slowCopy = hold(phone.copyAsync, copies);
      await act(async () => { slowStop.release(); await pause(); });
      await reached(slowCopy);
      return slowCopy;
    }

    it('he opens the sheet again and taps Start Recording: it waits for the copy, then records; the kept one is the first take, and the new take keeps its file', async () => {
      const slowCopy = await firstTakeStillBeingCopied();
      await showFor(CANOPY);

      fireEvent.press(screen.getByText('Start Recording'));
      await settle(80);
      // Held back: the first take is still in the recorder's file.
      expect(phone.microphoneOn).toBe(false);
      expect(phone.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
      expect(whatIsIn(phone.recorder.file)).toBe('take-1');

      await answers(slowCopy);

      // His tap is not lost: the recording starts once the first is safely kept.
      expect(await screen.findByText('Stop Recording')).toBeTruthy();
      expect(phone.microphoneOn).toBe(true);
      expect(whatIsIn(phone.recorder.file)).toBe('take-2');
      const kept = await readKeptVoiceRecording('owner-a', 'talk', CANOPY);
      expect(whatIsIn(kept?.uri)).toBe('take-1');
      expect(keptFiles()).toHaveLength(1);
      expect(keptEntryKeys()).toHaveLength(1);
    });

    it('two taps on Start Recording while it waits are one start', async () => {
      const slowCopy = await firstTakeStillBeingCopied();
      await showFor(CANOPY);

      fireEvent.press(screen.getByText('Start Recording'));
      fireEvent.press(screen.getByText('Start Recording'));
      await settle(80);
      await answers(slowCopy);

      expect(await screen.findByText('Stop Recording')).toBeTruthy();
      expect(phone.recorder.record).toHaveBeenCalledTimes(2);
      expect(phone.takes).toBe(2);
    });

    it('he taps Start Recording and the sheet is hidden again before the copy lands: nothing is recorded, and the first take is kept', async () => {
      const slowCopy = await firstTakeStillBeingCopied();
      await showFor(CANOPY);
      fireEvent.press(screen.getByText('Start Recording'));
      await settle(80);
      await hideWithoutCancel();

      await answers(slowCopy);

      expect(phone.microphoneOn).toBe(false);
      expect(phone.allowsRecording).toBe(false);
      expect(phone.takes).toBe(1);
      expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.uri)).toBe('take-1');
      expect(cacheFiles()).toEqual([]);
    });
  });

  describe('a recording ready in the sheet, its keep still under way, hidden without his Cancel and shown for another project', () => {
    /** Take-1 (for Canopy Project) is still being copied; the sheet is open for Harbor North and shows no recording. */
    async function shownForHarborWhileFirstTakeIsCopied(): Promise<Hold> {
      await openTalk();
      await dictating();
      const slowCopy = hold(phone.copyAsync, copies);
      fireEvent.press(screen.getByText('Stop Recording'));
      expect(await screen.findByText('Recording ready')).toBeTruthy();
      await reached(slowCopy);
      await hideWithoutCancel();
      await showFor(HARBOR);
      expect(screen.queryByText('Recording ready')).toBeNull();
      return slowCopy;
    }

    it('he dictates there at once: it waits for the copy; the one kept for the first project is the first take, and the take for the second is sent as itself', async () => {
      const slowCopy = await shownForHarborWhileFirstTakeIsCopied();

      fireEvent.press(screen.getByText('Start Recording'));
      await settle(80);
      expect(phone.microphoneOn).toBe(false);
      expect(whatIsIn(phone.recorder.file)).toBe('take-1');

      await answers(slowCopy);

      expect(await screen.findByText('Stop Recording')).toBeTruthy();
      expect(whatIsIn(phone.recorder.file)).toBe('take-2');
      expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.uri)).toBe('take-1');
      await act(async () => { phone.recorder.set({ durationMillis: 5_000 }); });
      fireEvent.press(screen.getByText('Stop Recording'));
      expect(await screen.findByText('Recording ready')).toBeTruthy();
      await settle();
      fireEvent.press(screen.getByText('Continue'));
      await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
      await settle();
      expect(sent).toEqual([`take-2 for ${HARBOR}`]);
      // The first project's recording is still kept, once, and is still the first take.
      expect(keptFiles()).toHaveLength(1);
      expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.uri)).toBe('take-1');
    });

    it('he taps X there instead (nothing to cancel): the first take is not deleted from under its copy, and is kept', async () => {
      const slowCopy = await shownForHarborWhileFirstTakeIsCopied();

      fireEvent.press(screen.getByLabelText('Cancel memory capture'));
      await settle();
      expect(called.cancel).toHaveBeenCalledTimes(1);
      expect(whatIsIn(phone.recorder.file)).toBe('take-1');

      await answers(slowCopy);

      expect(keptFiles()).toHaveLength(1);
      expect(keptEntryKeys()).toHaveLength(1);
      expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.uri)).toBe('take-1');
      expect(cacheFiles()).toEqual([]);
    });

    it('he taps X there, opens it again and dictates: it still waits for the copy, though his X has finished since', async () => {
      const slowCopy = await shownForHarborWhileFirstTakeIsCopied();
      fireEvent.press(screen.getByLabelText('Cancel memory capture'));
      await settle();
      await showFor(HARBOR);

      fireEvent.press(screen.getByText('Start Recording'));
      await settle(80);
      expect(phone.microphoneOn).toBe(false);
      expect(whatIsIn(phone.recorder.file)).toBe('take-1');

      await answers(slowCopy);

      expect(await screen.findByText('Stop Recording')).toBeTruthy();
      expect(whatIsIn(phone.recorder.file)).toBe('take-2');
      expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.uri)).toBe('take-1');
    });
  });

  describe('a recording ready and kept, hidden without his Cancel and shown for another project, the phone slow to delete the recorder’s own file', () => {
    /** Take-1 is kept for Canopy Project; the delete of the recorder's file has not finished; the sheet is open for Harbor North. */
    async function shownForHarborWhileTheFileIsDeleted(): Promise<Hold> {
      await openTalk();
      await dictating();
      fireEvent.press(screen.getByText('Stop Recording'));
      expect(await screen.findByText('Recording ready')).toBeTruthy();
      await settle();
      expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.uri)).toBe('take-1');
      await hideWithoutCancel();
      const slowDelete = hold(phone.deleteAsync, phone.deleteFile);
      await showFor(HARBOR);
      await reached(slowDelete);
      return slowDelete;
    }

    it('he dictates there at once: it waits for the delete, and the new take keeps its file', async () => {
      const slowDelete = await shownForHarborWhileTheFileIsDeleted();

      fireEvent.press(screen.getByText('Start Recording'));
      await settle(80);
      expect(phone.microphoneOn).toBe(false);

      await answers(slowDelete);

      expect(await screen.findByText('Stop Recording')).toBeTruthy();
      expect(whatIsIn(phone.recorder.file)).toBe('take-2');
      expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.uri)).toBe('take-1');
    });

    it('a recording kept for the second project comes back meanwhile, he taps Record Again, and the sheet is hidden before the delete lands: that recording stays kept', async () => {
      // One kept for Harbor North from an earlier day.
      phone.files.add('file:///cache/Audio/earlier.m4a');
      phone.contents.set('file:///cache/Audio/earlier.m4a', 'an earlier take for Harbor North');
      await keepVoiceRecording('owner-a', 'talk', { uri: 'file:///cache/Audio/earlier.m4a', durationMs: 9_000, projectId: idOf(HARBOR), projectName: HARBOR, state: 'ready' });
      phone.files.delete('file:///cache/Audio/earlier.m4a');
      const slowDelete = await shownForHarborWhileTheFileIsDeleted();
      expect(await screen.findByText(/^Kept from /)).toBeTruthy();

      fireEvent.press(screen.getByText('Record Again'));
      await settle(80);
      await hideWithoutCancel();
      await answers(slowDelete);

      expect(phone.takes).toBe(1);
      expect(phone.microphoneOn).toBe(false);
      const stillKept = await readKeptVoiceRecording('owner-a', 'talk', HARBOR);
      expect(whatIsIn(stillKept?.uri)).toBe('an earlier take for Harbor North');
      expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.uri)).toBe('take-1');
      expect(keptFiles()).toHaveLength(2);
    });
  });

  it('his Discard, the phone slow to delete the file, and Record Again tapped meanwhile: no new dictation is begun over the file being deleted', async () => {
    await openTalk();
    await dictating();
    fireEvent.press(screen.getByText('Stop Recording'));
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    await settle();
    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const slowDelete = hold(phone.deleteAsync, phone.deleteFile);
    await act(async () => { buttons.find(button => button.text === 'Discard')?.onPress?.(); });
    await reached(slowDelete);

    fireEvent.press(screen.getByText('Record Again'));
    await settle(80);
    expect(phone.microphoneOn).toBe(false);
    await answers(slowDelete);

    // He had discarded and the sheet has closed: nothing is recording, kept or left behind.
    expect(called.cancel).toHaveBeenCalledTimes(1);
    expect(phone.microphoneOn).toBe(false);
    expect(phone.allowsRecording).toBe(false);
    expect(keptFiles()).toEqual([]);
    expect(cacheFiles()).toEqual([]);
  });

  it('with nothing under way, Start Recording, Stop, Record Again and Use work as before, each take sent as itself', async () => {
    await openTalk();
    await dictating(6);
    fireEvent.press(screen.getByText('Stop Recording'));
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    await settle();
    await dictating(7);
    expect(whatIsIn(phone.recorder.file)).toBe('take-2');
    fireEvent.press(screen.getByText('Stop Recording'));
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    await settle();
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    await settle();

    expect(sent).toEqual([`take-2 for ${CANOPY}`]);
    expect(keptFiles()).toEqual([]);
    expect(keptEntryKeys()).toEqual([]);
    expect(cacheFiles()).toEqual([]);
  });
});
