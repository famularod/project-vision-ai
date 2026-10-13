import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Alert, AppState } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { keepVoiceRecording, readKeptVoiceRecording } from '../../services/KeptVoiceRecording';
import { cacheFiles, hold, keptEntryKeys, keptFiles, phone, releaseEveryHold, whatIsIn, type Hold } from '../fixtures/voice-sheet-phone';

// Batch W1, item 4 (6 Oct 2026). Two things left open after review pass 5.
//
// (a) While Start Recording waits for the recording before to be kept or
// removed (review P5 N2), the sheet showed nothing: with a slow phone his tap
// seemed lost, and Continue tapped in that wait sent the recording on screen
// before the start recorded over it. The sheet now says it is finishing with
// the last recording, and Continue waits too.
//
// (b) The older paths that close a sheet (a recording still going, being
// stopped, or ended by a lock, when the sheet is hidden without his Cancel)
// still DELETED a recording the phone refused to keep. They now do what the
// sheet shown for another project already does (review P5 N1): a sheet that
// is still in place holds it aside for its own project, and it is back in the
// sheet the next time it is shown for that project. A sheet taken away with
// its screen can hold nothing: there the file still goes (review P4 L1).
// Both kinds of stand-in recorder are run.

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
const WAITING = 'Finishing with the last recording first. This one starts as soon as that is done.';
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

const storageFull = async () => { throw new Error('No space left on device'); };

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

type Sheet = Readonly<{ keepSlot?: string }>;
const TALK: Sheet = { keepSlot: 'talk' };

/** A screen that owns a voice sheet as the app's screens do: it stays in place and is shown or hidden. */
function Phone({ sheet }: { sheet: Sheet }) {
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
        keepSlot={sheet.keepSlot}
        onMemoryReady={called.words}
        onTypeInstead={hide}
        onCancel={() => { called.cancel(); hide(); }}
      />
    </NativeWorkspaceOwnerContext.Provider>
  );
}

async function openTalk(sheet: Sheet = TALK) {
  view = render(<Phone sheet={sheet} />);
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
const answers = (slow: Hold) => act(async () => { slow.release(); await pause(120); });
const hideWithoutCancel = () => act(async () => { screenControls.hide(); await pause(); });
const showFor = async (projectName: string) => {
  await act(async () => { screenControls.showFor(projectName); await pause(); });
};
const takeTheScreenAway = () => act(async () => { view?.unmount(); view = null; await pause(); });

/** He is dictating on the open sheet. */
async function dictating(seconds = 12) {
  fireEvent.press(screen.getByText(screen.queryByText('Record Again') ? 'Record Again' : 'Start Recording'));
  expect(await screen.findByText('Stop Recording')).toBeTruthy();
  await act(async () => { phone.recorder.set({ durationMillis: seconds * 1_000 }); });
  expect(phone.microphoneOn).toBe(true);
}

const copies = async ({ from, to }: { from: string; to: string }) => phone.copyFile({ from, to });

type Recorders = Readonly<{ name: string; outlive: boolean }>;
const RECORDERS: readonly Recorders[] = [
  { name: 'the recorder goes with its screen, as expo-audio’s does', outlive: false },
  { name: 'the recorder outlives its screen, as the earlier tests’ stand-in does', outlive: true },
];

describe.each(RECORDERS)('$name', ({ outlive }) => {
  beforeEach(() => { phone.recordersOutliveTheirScreen = outlive; });

  describe('while Start Recording waits for the recording before', () => {
    /** Take-1 was ended by a lock as the sheet was hidden; the phone is still copying it. */
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
      await showFor(CANOPY);
      return slowCopy;
    }

    it('the sheet says so, and stops saying so when the recording starts', async () => {
      const slowCopy = await firstTakeStillBeingCopied();
      expect(screen.queryByText(WAITING)).toBeNull();

      fireEvent.press(screen.getByText('Start Recording'));
      expect(await screen.findByText(WAITING)).toBeTruthy();
      expect(phone.microphoneOn).toBe(false);

      await answers(slowCopy);

      expect(await screen.findByText('Stop Recording')).toBeTruthy();
      expect(screen.queryByText(WAITING)).toBeNull();
      expect(whatIsIn(phone.recorder.file)).toBe('take-2');
    });

    it('his X while it waits: the sheet closes and nothing starts; shown again it no longer says it is waiting', async () => {
      const slowCopy = await firstTakeStillBeingCopied();
      fireEvent.press(screen.getByText('Start Recording'));
      expect(await screen.findByText(WAITING)).toBeTruthy();

      fireEvent.press(screen.getByLabelText('Cancel memory capture'));
      await settle();
      await answers(slowCopy);
      await showFor(CANOPY);

      expect(screen.queryByText(WAITING)).toBeNull();
      expect(phone.microphoneOn).toBe(false);
      expect(phone.takes).toBe(1);
    });

    it('Continue waits too: Record Again then Continue in that wait sends nothing, and the new recording then starts', async () => {
      // One kept for Harbor North from an earlier day.
      phone.files.add('file:///documents/kept-recordings/earlier.m4a');
      phone.contents.set('file:///documents/kept-recordings/earlier.m4a', 'an earlier take for Harbor North');
      await keepVoiceRecording('owner-a', 'talk', { uri: 'file:///documents/kept-recordings/earlier.m4a', durationMs: 9_000, projectId: idOf(HARBOR), projectName: HARBOR, state: 'ready' });
      await openTalk();
      await dictating();
      fireEvent.press(screen.getByText('Stop Recording'));
      expect(await screen.findByText('Recording ready')).toBeTruthy();
      await settle();
      await hideWithoutCancel();
      // The phone is slow to delete the recorder's own file when the sheet lets go of take-1.
      const slowDelete = hold(phone.deleteAsync, phone.deleteFile);
      await showFor(HARBOR);
      await reached(slowDelete);
      expect(await screen.findByText(/^Kept from /)).toBeTruthy();

      fireEvent.press(screen.getByText('Record Again'));
      expect(await screen.findByText(WAITING)).toBeTruthy();
      fireEvent.press(screen.getByText('Continue'));
      await settle();
      expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();

      await answers(slowDelete);

      expect(await screen.findByText('Stop Recording')).toBeTruthy();
      expect(sent).toEqual([]);
      expect(whatIsIn(phone.recorder.file)).toBe('take-2');
    });

    it('guard: with nothing under way it never says so', async () => {
      await openTalk();
      await dictating(6);
      expect(screen.queryByText(WAITING)).toBeNull();
      fireEvent.press(screen.getByText('Stop Recording'));
      expect(await screen.findByText('Recording ready')).toBeTruthy();
      await settle();
      await dictating(7);
      expect(screen.queryByText(WAITING)).toBeNull();
    });
  });

  describe('the phone refuses to keep the recording (its storage is full), and the sheet is hidden without his Cancel', () => {
    /** Back for Canopy Project, take-1 is in the sheet: ready, its length, and Continue sends it for that project. */
    async function expectBackInTheSheetAndUsable() {
      expect(await screen.findByText('Recording ready')).toBeTruthy();
      expect(screen.getByText('0:12')).toBeTruthy();
      expect(whatIsIn(phone.recorder.file)).toBe('take-1');
      fireEvent.press(screen.getByText('Continue'));
      await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
      await settle();
      expect(sent).toEqual([`take-1 for ${CANOPY}`]);
      expect(cacheFiles()).toEqual([]);
    }
    function expectHeldNotDeleted() {
      expect(phone.microphoneOn).toBe(false);
      expect(phone.allowsRecording).toBe(false);
      expect(keptFiles()).toEqual([]);
      expect(keptEntryKeys()).toEqual([]);
      expect(whatIsIn(phone.recorder.file)).toBe('take-1');
      expect(sent).toEqual([]);
    }

    it('while he is dictating: it is not deleted; the next time the sheet is shown for its project it is there to use', async () => {
      phone.copyAsync.mockImplementation(storageFull);
      await openTalk();
      await dictating();

      await hideWithoutCancel();
      await settle();
      expectHeldNotDeleted();

      await showFor(CANOPY);
      await expectBackInTheSheetAndUsable();
    });

    it('just after he tapped Stop, the recorder still stopping: the same', async () => {
      phone.copyAsync.mockImplementation(storageFull);
      await openTalk();
      await dictating();
      const stopping = hold(phone.recorder.stop, phone.recorder.stopAnswers);
      fireEvent.press(screen.getByText('Stop Recording'));
      await reached(stopping);

      await hideWithoutCancel();
      await answers(stopping);
      expectHeldNotDeleted();

      await showFor(CANOPY);
      await expectBackInTheSheetAndUsable();
    });

    it('just after a lock or a call ended it, the recorder still finishing it: the same', async () => {
      phone.copyAsync.mockImplementation(storageFull);
      await openTalk();
      await dictating();
      const recorder = phone.recorder;
      const finishing = hold(recorder.stop, recorder.stopAnswers);
      await act(async () => { recorder.stoppedByThePhone(); });
      await reached(finishing);

      await hideWithoutCancel();
      await answers(finishing);
      expectHeldNotDeleted();

      await showFor(CANOPY);
      await expectBackInTheSheetAndUsable();
    });

    it('shown for another project first: it is not shown there, and Start Recording asks before recording over it', async () => {
      phone.copyAsync.mockImplementation(storageFull);
      await openTalk();
      await dictating();
      await hideWithoutCancel();
      await settle();

      await showFor(HARBOR);
      expect(screen.queryByText('Recording ready')).toBeNull();
      fireEvent.press(screen.getByText('Start Recording'));
      await settle();

      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[0][0]).toBe(`A recording for ${CANOPY} is still here`);
      expect(phone.takes).toBe(1);
      expectHeldNotDeleted();
      await hideWithoutCancel();
      await showFor(CANOPY);
      await expectBackInTheSheetAndUsable();
    });

    it('guard: when the phone can keep it, it is kept on the device and offered as before', async () => {
      await openTalk();
      await dictating();

      await hideWithoutCancel();
      await settle();

      expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.uri)).toBe('take-1');
      expect(cacheFiles()).toEqual([]);
      await showFor(CANOPY);
      expect(await screen.findByText(/^Kept from /)).toBeTruthy();
    });
  });

  it('the sheet’s SCREEN is taken away while he is dictating and the phone refuses the keep: a sheet that has gone holds nothing, and the file is not left in the cache', async () => {
    phone.copyAsync.mockImplementation(storageFull);
    await openTalk();
    await dictating();

    await takeTheScreenAway();
    await settle();

    expect(phone.microphoneOn).toBe(false);
    expect(keptFiles()).toEqual([]);
    expect(keptEntryKeys()).toEqual([]);
    expect(cacheFiles()).toEqual([]);
  });
});
