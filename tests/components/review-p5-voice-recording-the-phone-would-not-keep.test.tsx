import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Alert, AppState } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { keepVoiceRecording, readKeptVoiceRecording } from '../../services/KeptVoiceRecording';
import { cacheFiles, hold, keptEntryKeys, keptFiles, phone, releaseEveryHold, whatIsIn, type Hold } from '../fixtures/voice-sheet-phone';

// Review pass 5, N1 (6 Oct 2026; caused by the pass-4 L4 fix).
//
// A recording ready in a voice sheet that was hidden without his Cancel is
// let go of when the sheet is next shown for another project (pass-4 L4),
// and kept on the device for its own. With the phone unable to keep it (its
// storage full) it was DELETED instead, and never offered again; before that
// fix it had stayed in the sheet.
//
// Now the sheet holds it aside, in its file, for its own project and
// account. It is not shown and cannot be sent under another project; it is
// back in the sheet the next time the sheet is shown for its own; and only
// his own Use, Discard or Record Again removes it. Until then the sheet asks
// before it records anything else: on an iPhone the recorder would write the
// new recording over it. The stand-in phone says which take a file holds;
// both kinds of recorder are run.

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
const MILL = 'Mill Street';
const idOf = (projectName: string) => `${PROJECT_ID}-${projectName.length}`;
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => { await pause(ms); });

const called = { cancel: jest.fn(), words: jest.fn() };
/** What each recording sent for its words held, and for which project and id. */
const sent: string[] = [];
type Controls = {
  /** The sheet is hidden without his Cancel, as when a panel that failed to draw closes every sheet. */
  hide: () => void;
  showFor: (projectName: string) => void;
  /** Another account, with the sheet left in place. */
  signInAs: (owner: string) => void;
};
let screenControls: Controls;
let view: ReturnType<typeof render> | null = null;
let alert: jest.SpyInstance;

const storageFull = async () => { throw new Error('No space left on device'); };

beforeEach(() => {
  phone.reset();
  sent.length = 0;
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
  transcription.transcribeDAVECaptureMemoryAudio.mockImplementation(async ({ uri, projectName, projectId }: { uri: string; projectName: string; projectId: string }) => {
    sent.push(`${whatIsIn(uri)} for ${projectName} (${projectId === idOf(projectName) ? 'its id' : 'ANOTHER ID'})`);
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
  const [owner, setOwner] = useState('owner-a');
  const [shown, setShown] = useState({ open: true, projectName: CANOPY });
  screenControls = {
    hide: () => setShown(current => ({ ...current, open: false })),
    showFor: projectName => setShown({ open: true, projectName }),
    signInAs: setOwner,
  };
  const hide = () => setShown(current => ({ ...current, open: false }));
  return (
    <NativeWorkspaceOwnerContext.Provider value={owner}>
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

/** Waits until a slow step has been reached; a step that never is fails its test instead of hanging it. */
const reached = (made: Hold) => act(async () => {
  await Promise.race([
    made.reached,
    new Promise<void>((_resolve, reject) => { setTimeout(() => reject(new Error('The slow step was never reached.')), 1_500); }),
  ]);
});

const hideWithoutCancel = () => act(async () => { screenControls.hide(); });
const showFor = async (projectName: string) => {
  await act(async () => { screenControls.showFor(projectName); });
  // The kept-recording check for that project has answered, and anything being kept or deleted is done.
  await settle();
};

/** He dictates for `seconds` on the open sheet and taps Stop: "Recording ready". */
async function recordsOnTheOpenSheet(seconds = 12) {
  fireEvent.press(screen.getByText(screen.queryByText('Record Again') ? 'Record Again' : 'Start Recording'));
  expect(await screen.findByText('Stop Recording')).toBeTruthy();
  await act(async () => { phone.recorder.set({ durationMillis: seconds * 1_000 }); });
  fireEvent.press(screen.getByText('Stop Recording'));
  expect(await screen.findByText('Recording ready')).toBeTruthy();
  await settle();
}

/**
 * The phone cannot keep recordings. Take-1, 12 seconds for Canopy Project, is
 * ready in the sheet (kept nowhere); the sheet is then hidden without his Cancel.
 */
async function readyForCanopyOnAPhoneThatCannotKeepThenHidden() {
  phone.copyAsync.mockImplementation(storageFull);
  view = render(<Phone />);
  await settle();
  await recordsOnTheOpenSheet();
  expect(keptFiles()).toEqual([]);
  await hideWithoutCancel();
}

/** The open sheet shows no recording: nothing to replay, nothing to send, no length. */
function expectNoRecordingInTheSheet() {
  expect(screen.queryByText('Recording ready')).toBeNull();
  expect(screen.queryByText('Replay Recording')).toBeNull();
  expect(screen.queryByText('Continue')).toBeNull();
  expect(screen.queryByText(/^Kept from /)).toBeNull();
  expect(screen.getByText('Start Recording')).toBeTruthy();
  expect(screen.getByText('0:00')).toBeTruthy();
}

/** The sheet still holds take-1: in its file, kept nowhere, sent nowhere. */
function expectStillHeldUnused() {
  expect(whatIsIn(phone.recorder.file)).toBe('take-1');
  expect(cacheFiles()).toEqual([phone.recorder.file]);
  expect(sent).toEqual([]);
  expect(called.words).not.toHaveBeenCalled();
}

/** Back for Canopy Project, take-1 is in the sheet as he left it: ready, its length, not announced as brought back. */
function expectBackInTheSheetForCanopy() {
  expect(screen.getByText('Recording ready')).toBeTruthy();
  expect(screen.getByText('0:12')).toBeTruthy();
  expect(screen.getByText('Continue')).toBeTruthy();
  expect(screen.queryByText(/^Kept from /)).toBeNull();
  expect(whatIsIn(phone.recorder.file)).toBe('take-1');
}

const alertButton = (text: string, call = alert.mock.calls.length - 1) =>
  (alert.mock.calls[call][2] as Array<{ text: string; onPress?: () => void }>).find(button => button.text === text);

type Recorders = Readonly<{ name: string; outlive: boolean }>;
const RECORDERS: readonly Recorders[] = [
  { name: 'the recorder goes with its screen, as expo-audio’s does', outlive: false },
  { name: 'the recorder outlives its screen, as the earlier tests’ stand-in does', outlive: true },
];

describe.each(RECORDERS)('$name', ({ outlive }) => {
  beforeEach(() => { phone.recordersOutliveTheirScreen = outlive; });

  describe('the phone cannot keep it; ready in the sheet, hidden without his Cancel, then shown for another project', () => {
    it('it is not shown and cannot be sent there, and it is not deleted: the sheet still holds it', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();

      await showFor(HARBOR);

      expectNoRecordingInTheSheet();
      expectStillHeldUnused();
      expect(keptFiles()).toEqual([]);
      expect(keptEntryKeys()).toEqual([]);
    });

    it('shown for its own project again: it is back in the sheet, and Continue sends it for that project', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
      await showFor(HARBOR);
      await hideWithoutCancel();

      await showFor(CANOPY);

      expectBackInTheSheetForCanopy();
      fireEvent.press(screen.getByText('Continue'));
      await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
      await settle();
      expect(sent).toEqual([`take-1 for ${CANOPY} (its id)`]);
      // Used: nothing of it is left, and the sheet is free again.
      expect(cacheFiles()).toEqual([]);
      await hideWithoutCancel();
      await showFor(HARBOR);
      fireEvent.press(screen.getByText('Start Recording'));
      expect(await screen.findByText('Stop Recording')).toBeTruthy();
      expect(alert).not.toHaveBeenCalled();
    });

    it('…or his own Discard removes it', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
      await showFor(HARBOR);
      await hideWithoutCancel();
      await showFor(CANOPY);
      expectBackInTheSheetForCanopy();

      fireEvent.press(screen.getByLabelText('Cancel memory capture'));
      await act(async () => { alertButton('Discard')?.onPress?.(); await pause(); });

      expect(called.cancel).toHaveBeenCalledTimes(1);
      expect(cacheFiles()).toEqual([]);
      expect(sent).toEqual([]);
    });

    it('…or his own Record Again replaces it', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
      await showFor(HARBOR);
      await hideWithoutCancel();
      await showFor(CANOPY);
      expectBackInTheSheetForCanopy();

      await recordsOnTheOpenSheet(7);

      expect(alert).not.toHaveBeenCalled();
      expect(whatIsIn(phone.recorder.file)).toBe('take-2');
      expect(screen.getByText('0:07')).toBeTruthy();
    });

    it('Start Recording under the other project asks first; nothing is recorded over it, and Keep leaves it held', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
      await showFor(HARBOR);

      fireEvent.press(screen.getByText('Start Recording'));
      await settle();

      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[0][0]).toBe(`A recording for ${CANOPY} is still here`);
      expect(alert.mock.calls[0][1]).toBe(
        `It has not been used, and it could not be kept on this device. Close this and open it again for ${CANOPY} to use it. To record here now, discard it first.`,
      );
      expect(phone.takes).toBe(1);
      expect(phone.microphoneOn).toBe(false);
      expect(phone.allowsRecording).toBe(false);
      expectStillHeldUnused();

      await act(async () => { alertButton('Keep')?.onPress?.(); });
      // Asked again each time, and a tap after the question is not lost for good.
      fireEvent.press(screen.getByText('Start Recording'));
      await settle();
      expect(alert).toHaveBeenCalledTimes(2);
      expectStillHeldUnused();
      await hideWithoutCancel();
      await showFor(CANOPY);
      expectBackInTheSheetForCanopy();
    });

    it('his Discard in that question removes it; he can then record for the other project, and nothing is offered for the first', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
      await showFor(HARBOR);
      fireEvent.press(screen.getByText('Start Recording'));
      await settle();

      await act(async () => { alertButton('Discard')?.onPress?.(); await pause(); });

      expect(cacheFiles()).toEqual([]);
      await recordsOnTheOpenSheet(5);
      expect(alert).toHaveBeenCalledTimes(1);
      expect(whatIsIn(phone.recorder.file)).toBe('take-2');
      fireEvent.press(screen.getByText('Continue'));
      await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
      expect(sent).toEqual([`take-2 for ${HARBOR} (its id)`]);
      await hideWithoutCancel();
      await showFor(CANOPY);
      // (The timer still shows the used recording's length until the next start: older, and not this fix's.)
      expect(screen.queryByText('Recording ready')).toBeNull();
      expect(screen.queryByText('Continue')).toBeNull();
      expect(screen.queryByText(/^Kept from /)).toBeNull();
      expect(screen.getByText('Start Recording')).toBeTruthy();
    });

    it('his X under the other project (nothing there to cancel) does not discard it', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
      await showFor(HARBOR);

      fireEvent.press(screen.getByLabelText('Cancel memory capture'));
      await settle();

      expect(called.cancel).toHaveBeenCalledTimes(1);
      expectStillHeldUnused();
      await showFor(CANOPY);
      expectBackInTheSheetForCanopy();
    });

    it('shown for a third project before its own: still held, and back for its own', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
      await showFor(HARBOR);
      await hideWithoutCancel();

      await showFor(MILL);
      expectNoRecordingInTheSheet();
      expectStillHeldUnused();

      await hideWithoutCancel();
      await showFor(CANOPY);
      expectBackInTheSheetForCanopy();
    });

    it('shown under another account for the same project (the sheet left in place): not shown there; back under his own', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
      await act(async () => { screenControls.signInAs('owner-b'); });

      await showFor(CANOPY);
      expectNoRecordingInTheSheet();
      expectStillHeldUnused();

      await hideWithoutCancel();
      await act(async () => { screenControls.signInAs('owner-a'); });
      await showFor(CANOPY);
      expectBackInTheSheetForCanopy();
    });

    it('once the phone can keep again, the one that is back in the sheet is kept on the device, and from then on it is let go of as any kept one is', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
      await showFor(HARBOR);
      await hideWithoutCancel();
      phone.copyAsync.mockImplementation(phone.copyFile);

      await showFor(CANOPY);

      expectBackInTheSheetForCanopy();
      expect(keptFiles()).toHaveLength(1);
      expect(await readKeptVoiceRecording('owner-a', 'talk', CANOPY)).toEqual(expect.objectContaining({ projectName: CANOPY, durationMs: 12_000, state: 'ready' }));
      expect(whatIsIn(keptFiles()[0])).toBe('take-1');

      await hideWithoutCancel();
      await showFor(HARBOR);
      expectNoRecordingInTheSheet();
      expect(keptFiles()).toHaveLength(1);
      expect(keptEntryKeys()).toHaveLength(1);
      expect(cacheFiles()).toEqual([]);
      // Nothing is held aside now: he records for the other project without being asked.
      fireEvent.press(screen.getByText('Start Recording'));
      expect(await screen.findByText('Stop Recording')).toBeTruthy();
      expect(alert).not.toHaveBeenCalled();
    });

    it('the sheet holds a recording kept for the other project when it is shown for its own again: that one stays kept, and its own is back', async () => {
      await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
      // One kept for Harbor North from an earlier day, when the phone could keep.
      phone.files.add('file:///documents/kept-recordings/earlier.m4a');
      phone.contents.set('file:///documents/kept-recordings/earlier.m4a', 'an earlier take for Harbor North');
      await keepVoiceRecording('owner-a', 'talk', { uri: 'file:///documents/kept-recordings/earlier.m4a', durationMs: 9_000, projectId: idOf(HARBOR), projectName: HARBOR, state: 'ready' });
      await showFor(HARBOR);
      expect(await screen.findByText(/^Kept from /)).toBeTruthy();
      expect(screen.getByText('0:09')).toBeTruthy();
      await hideWithoutCancel();

      await showFor(CANOPY);

      expectBackInTheSheetForCanopy();
      expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', HARBOR))?.uri)).toBe('an earlier take for Harbor North');
      expect(keptFiles()).toHaveLength(1);
    });
  });

  it('the phone refuses the keep only after he has tapped Start Recording under the other project: he is asked then, and nothing is recorded over it', async () => {
    view = render(<Phone />);
    await settle();
    phone.copyAsync.mockImplementationOnce(storageFull);
    await recordsOnTheOpenSheet();
    await hideWithoutCancel();
    const slowRefusal = hold(phone.copyAsync, storageFull);
    await act(async () => { screenControls.showFor(HARBOR); await pause(20); });
    await reached(slowRefusal);

    fireEvent.press(screen.getByText('Start Recording'));
    await settle(80);
    expect(alert).not.toHaveBeenCalled();
    await act(async () => { slowRefusal.release(); await pause(); });
    await settle();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(phone.takes).toBe(1);
    expect(phone.microphoneOn).toBe(false);
    expectStillHeldUnused();
  });

  it('his Discard in a question asked earlier, when it is back in the sheet by then: it is not removed', async () => {
    await readyForCanopyOnAPhoneThatCannotKeepThenHidden();
    await showFor(HARBOR);
    fireEvent.press(screen.getByText('Start Recording'));
    await settle();
    expect(alert).toHaveBeenCalledTimes(1);
    await hideWithoutCancel();
    await showFor(CANOPY);
    expectBackInTheSheetForCanopy();

    await act(async () => { alertButton('Discard', 0)?.onPress?.(); await pause(); });

    expectBackInTheSheetForCanopy();
    expect(cacheFiles()).toEqual([phone.recorder.file]);
  });

  it('a second recording for its project comes into the sheet while it is held: it stays held, loses nothing to the other, and is back once the sheet is free', async () => {
    view = render(<Phone />);
    await settle();
    // The phone refuses to keep take-1 when he stops it…
    phone.copyAsync.mockImplementationOnce(storageFull);
    await recordsOnTheOpenSheet();
    // …an earlier recording for Canopy Project is on the device all the same…
    phone.files.add('file:///documents/kept-recordings/earlier.m4a');
    phone.contents.set('file:///documents/kept-recordings/earlier.m4a', 'an earlier take for Canopy Project');
    await keepVoiceRecording('owner-a', 'talk', { uri: 'file:///documents/kept-recordings/earlier.m4a', durationMs: 9_000, projectId: idOf(CANOPY), projectName: CANOPY, state: 'ready' });
    await hideWithoutCancel();
    // …and the phone is slow to refuse take-1 again when the sheet is shown for another project.
    const slowRefusal = hold(phone.copyAsync, storageFull);
    await act(async () => { screenControls.showFor(HARBOR); await pause(20); });
    await reached(slowRefusal);
    await hideWithoutCancel();
    await act(async () => { screenControls.showFor(CANOPY); await pause(20); });
    await act(async () => { slowRefusal.release(); await pause(); });
    await settle();
    // The earlier one came back from the device into the open sheet; take-1 is held aside.
    expect(await screen.findByText(/^Kept from /)).toBeTruthy();
    expect(screen.getByText('0:09')).toBeTruthy();
    expect(whatIsIn(phone.recorder.file)).toBe('take-1');

    await hideWithoutCancel();
    await showFor(CANOPY);

    // The one in the sheet stays; take-1 is not put over it.
    expect(screen.getByText('0:09')).toBeTruthy();
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    await settle();
    expect(sent).toEqual([`an earlier take for Canopy Project for ${CANOPY} (its id)`]);
    expect(whatIsIn(phone.recorder.file)).toBe('take-1');
    await hideWithoutCancel();
    await showFor(CANOPY);
    expectBackInTheSheetForCanopy();
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(2));
    expect(sent[1]).toBe(`take-1 for ${CANOPY} (its id)`);
  });

  it('unchanged: when the phone can keep it, it is kept for its own project and its cache file goes', async () => {
    view = render(<Phone />);
    await settle();
    phone.copyAsync.mockImplementationOnce(storageFull);
    await recordsOnTheOpenSheet();
    await hideWithoutCancel();

    await showFor(HARBOR);

    expectNoRecordingInTheSheet();
    expect(whatIsIn((await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.uri)).toBe('take-1');
    expect(keptFiles()).toHaveLength(1);
    expect(cacheFiles()).toEqual([]);
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Stop Recording')).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
  });
});
