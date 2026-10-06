import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { readKeptVoiceRecording } from '../../services/KeptVoiceRecording';
import { cacheFiles, hold, keptEntryKeys, keptFiles, phone, releaseEveryHold, type Hold } from '../fixtures/voice-sheet-phone';

// Review pass 4, L4 (5 Oct 2026; already in Build 229).
//
// A recording that is ready in a voice sheet belongs to the project and the
// account it was recorded for. A sheet hidden WITHOUT his Cancel and not
// taken away (a panel that failed to draw closes every sheet; Talk and Ask
// ECOS stay in place) still held its recording, and shown next for another
// project it said "Recording ready" there, and Continue sent it with that
// project's name and id.
//
// Now a sheet shown for another project (or account) never shows or sends
// it. It is not lost: a sheet that keeps recordings keeps it on the device
// for its own project, and offers it the next time it opens for that
// project. A sheet that keeps nothing on the device has nowhere to keep it.
// Shown again for its own project, it is still in the sheet, as before.

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
const WORDS = { transcript: 'Rebar passed inspection on level two.' };
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => { await pause(ms); });

const called = { cancel: jest.fn(), typeInstead: jest.fn(), task: jest.fn(), words: jest.fn() };
type Controls = {
  /** The sheet is hidden without his Cancel, as when a panel that failed to draw closes every sheet. */
  hide: () => void;
  /** As Field Notes does: the screen clears the sheet's project in the same step as it hides it. */
  hideClearingProject: () => void;
  showFor: (projectName: string) => void;
  /** Another account, with the sheet left in place (the app itself rebuilds its screens; a sheet must not rely on it). */
  signInAs: (owner: string) => void;
};
let screenControls: Controls;
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
const TALK: Sheet = { name: 'a sheet that keeps recordings on the device (Talk)', keepSlot: 'talk' };
const TASK_FILL: Sheet = { name: 'a sheet that keeps nothing on the device (task fill)' };

/** A screen that owns a voice sheet as the app's screens do: it stays in place and is shown or hidden. */
function Phone({ sheet, firstProject }: { sheet: Sheet; firstProject: string }) {
  const [owner, setOwner] = useState('owner-a');
  const [shown, setShown] = useState({ open: true, projectName: firstProject });
  screenControls = {
    hide: () => setShown(current => ({ ...current, open: false })),
    hideClearingProject: () => setShown({ open: false, projectName: '' }),
    showFor: projectName => setShown({ open: true, projectName }),
    signInAs: setOwner,
  };
  const hide = () => setShown(current => ({ ...current, open: false }));
  return (
    <NativeWorkspaceOwnerContext.Provider value={owner}>
      <DAVEVoiceCaptureSheet
        visible={shown.open}
        projectId={shown.projectName ? idOf(shown.projectName) : null}
        projectName={shown.projectName}
        candidateLocations={[]}
        title="Talk"
        continueLabel="Continue"
        keepSlot={sheet.keepSlot}
        autoSubmitOnStop={sheet.sendsOnStop}
        onMemoryReady={called.words}
        onTypeInstead={() => { called.typeInstead(); hide(); }}
        onCancel={() => { called.cancel(); hide(); }}
      />
    </NativeWorkspaceOwnerContext.Provider>
  );
}

async function openScreen(sheet: Sheet, firstProject = CANOPY) {
  view?.unmount();
  view = render(<Phone sheet={sheet} firstProject={firstProject} />);
  // The kept-recording check has answered.
  await settle();
}

/** He dictated for `seconds` on the sheet open for Canopy Project and tapped Stop: "Recording ready". */
async function recordingReadyForCanopy(sheet: Sheet, seconds = 12) {
  await openScreen(sheet);
  await recordsOnTheOpenSheet(seconds);
}

async function recordsOnTheOpenSheet(seconds = 12) {
  fireEvent.press(screen.getByText('Start Recording'));
  expect(await screen.findByText('Stop Recording')).toBeTruthy();
  await act(async () => { phone.recorder.set({ durationMillis: seconds * 1_000 }); });
  fireEvent.press(screen.getByText('Stop Recording'));
  expect(await screen.findByText('Recording ready')).toBeTruthy();
  // A sheet that keeps recordings has kept it by now.
  await settle();
}

const hideWithoutCancel = () => act(async () => { screenControls.hide(); });
const showFor = async (projectName: string) => {
  await act(async () => { screenControls.showFor(projectName); });
  // The kept-recording check for that project has answered.
  await settle();
};

/** Waits until a slow step has been reached; a step that never is fails its test instead of hanging it. */
const reached = (made: Hold) => act(async () => {
  await Promise.race([
    made.reached,
    new Promise<void>((_resolve, reject) => { setTimeout(() => reject(new Error('The slow step was never reached.')), 1_500); }),
  ]);
});

/** The open sheet shows no recording: nothing to replay, nothing to send. */
function expectNoRecordingInTheSheet() {
  expect(screen.queryByText('Recording ready')).toBeNull();
  expect(screen.queryByText('Replay Recording')).toBeNull();
  expect(screen.queryByText('Continue')).toBeNull();
  expect(screen.queryByText(/^Kept from /)).toBeNull();
  expect(screen.getByText('Start Recording')).toBeTruthy();
  // Nor its length.
  expect(screen.getByText('0:00')).toBeTruthy();
}

/** One recording is kept on the device, for owner-a and Canopy Project, and for no other project or account. */
async function expectKeptOnceForCanopy(sheet: Sheet, state: 'ready' | 'sent' | 'no-signal' = 'ready') {
  expect(keptFiles()).toHaveLength(1);
  expect(keptEntryKeys()).toHaveLength(1);
  expect(await readKeptVoiceRecording('owner-a', String(sheet.keepSlot), CANOPY)).toEqual(expect.objectContaining({
    uri: keptFiles()[0],
    projectName: CANOPY,
    projectId: idOf(CANOPY),
    state,
  }));
  expect(await readKeptVoiceRecording('owner-a', String(sheet.keepSlot), HARBOR)).toBeNull();
  expect(await readKeptVoiceRecording('owner-b', String(sheet.keepSlot))).toBeNull();
}

const sentFor = () => transcription.transcribeDAVECaptureMemoryAudio.mock.calls.map(
  ([sent]) => (sent as { projectName: string; projectId: string | null }).projectName,
);

describe('a recording ready in a sheet that keeps recordings, hidden without his Cancel', () => {
  it('shown for another project: it is not shown and cannot be sent there, and stays kept for its own project', async () => {
    await recordingReadyForCanopy(TALK);
    await hideWithoutCancel();

    await showFor(HARBOR);

    expectNoRecordingInTheSheet();
    expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
    expect(called.words).not.toHaveBeenCalled();
    await expectKeptOnceForCanopy(TALK);
    // Only its kept copy is left: the recorder's own file in the cache has gone.
    expect(cacheFiles()).toEqual([]);
  });

  it('…and the next time the sheet opens for its own project it is offered once, and Continue sends it for that project', async () => {
    await recordingReadyForCanopy(TALK);
    await hideWithoutCancel();
    await showFor(HARBOR);
    await hideWithoutCancel();

    await showFor(CANOPY);

    expect(await screen.findByText('Recording ready')).toBeTruthy();
    expect(screen.getByText(/^Kept from .*\. Replay it, then tap Continue to use it, or record again\.$/)).toBeTruthy();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce(WORDS);
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledTimes(1);
    expect(transcription.transcribeDAVECaptureMemoryAudio.mock.calls[0][0]).toEqual(expect.objectContaining({
      uri: expect.stringContaining('/kept-recordings/'),
      projectName: CANOPY,
      projectId: idOf(CANOPY),
    }));
    await settle();
    // Used: nothing of it is left.
    expect(keptFiles()).toEqual([]);
    expect(keptEntryKeys()).toEqual([]);
  });

  it('a recording he then makes for the other project is its own: both are kept, each for its project, and using one leaves the other', async () => {
    await recordingReadyForCanopy(TALK);
    await hideWithoutCancel();
    await showFor(HARBOR);

    await recordsOnTheOpenSheet(7);

    expect(keptFiles()).toHaveLength(2);
    expect(await readKeptVoiceRecording('owner-a', 'talk', CANOPY)).toEqual(expect.objectContaining({ projectName: CANOPY, durationMs: 12_000 }));
    expect(await readKeptVoiceRecording('owner-a', 'talk', HARBOR)).toEqual(expect.objectContaining({ projectName: HARBOR, durationMs: 7_000 }));
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce(WORDS);
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    await settle();
    expect(sentFor()).toEqual([HARBOR]);
    await expectKeptOnceForCanopy(TALK);
  });

  it('shown again for its own project: it is still in the sheet, as before, and Continue sends it for that project', async () => {
    await recordingReadyForCanopy(TALK);
    await hideWithoutCancel();

    await showFor(CANOPY);

    expect(screen.getByText('Recording ready')).toBeTruthy();
    // It never left the sheet, so it is not announced as brought back.
    expect(screen.queryByText(/^Kept from /)).toBeNull();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce(WORDS);
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(sentFor()).toEqual([CANOPY]);
  });

  it('its project is the one the sheet had when it was hidden: opened with none chosen yet, then Canopy chosen and dictated for, it is still in the sheet for Canopy', async () => {
    await openScreen(TALK, '');
    // He chooses the project on the open sheet ("Which project is this about?").
    await showFor(CANOPY);
    await recordsOnTheOpenSheet();
    await hideWithoutCancel();

    await showFor(CANOPY);

    expect(screen.getByText('Recording ready')).toBeTruthy();
    expect(screen.queryByText(/^Kept from /)).toBeNull();
    expect(cacheFiles()).toHaveLength(1);
  });

  it('as Field Notes hides it (its project cleared in the same step): shown for another project, it is kept for its own', async () => {
    await recordingReadyForCanopy(TALK);
    await act(async () => { screenControls.hideClearingProject(); });

    await showFor(HARBOR);

    expectNoRecordingInTheSheet();
    await expectKeptOnceForCanopy(TALK);
    expect(cacheFiles()).toEqual([]);
  });

  it('one that had waited for signal: it is not tried again under the other project, and is tried again under its own', async () => {
    await recordingReadyForCanopy(TALK);
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(Object.assign(new Error('No signal.'), { code: 'offline' }));
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledTimes(1));
    await settle();
    const keptAs = (await readKeptVoiceRecording('owner-a', 'talk', CANOPY))?.state;
    expect(keptAs === 'sent' || keptAs === 'no-signal').toBe(true);
    await hideWithoutCancel();

    await showFor(HARBOR);

    expectNoRecordingInTheSheet();
    expect(sentFor()).toEqual([CANOPY]);
    await expectKeptOnceForCanopy(TALK, keptAs);

    await hideWithoutCancel();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce(WORDS);
    await showFor(CANOPY);
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(sentFor()).toEqual([CANOPY, CANOPY]);
  });

  it('one that could not be kept when he stopped it: it is kept now, for its own project', async () => {
    await openScreen(TALK);
    phone.copyAsync.mockRejectedValueOnce(new Error('The phone could not copy the file.'));
    await recordsOnTheOpenSheet();
    expect(keptFiles()).toEqual([]);
    await hideWithoutCancel();

    await showFor(HARBOR);

    expectNoRecordingInTheSheet();
    await expectKeptOnceForCanopy(TALK);
    expect(cacheFiles()).toEqual([]);
  });

  it('one whose keep is still under way when the sheet is shown for another project: it ends up kept once, for its own project', async () => {
    await openScreen(TALK);
    const keeping = hold(phone.copyAsync, async ({ to }: { from: string; to: string }) => { phone.files.add(to); });
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText('Stop Recording')).toBeTruthy();
    await act(async () => { phone.recorder.set({ durationMillis: 12_000 }); });
    fireEvent.press(screen.getByText('Stop Recording'));
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    await reached(keeping);
    await hideWithoutCancel();

    await showFor(HARBOR);
    expectNoRecordingInTheSheet();
    await act(async () => { keeping.release(); });
    await settle();

    await expectKeptOnceForCanopy(TALK);
    expect(cacheFiles()).toEqual([]);
  });

  it('one too short to use is not kept, and its file is not left in the cache', async () => {
    await recordingReadyForCanopy(TALK, 0.4);
    await hideWithoutCancel();

    await showFor(HARBOR);

    expectNoRecordingInTheSheet();
    expect(keptFiles()).toEqual([]);
    expect(keptEntryKeys()).toEqual([]);
    expect(cacheFiles()).toEqual([]);
  });

  it('one brought back from the device ("Kept from …"): shown for another project, its kept copy stays, and it is offered again for its own', async () => {
    await recordingReadyForCanopy(TALK);
    // Vitruvius is closed and opened again: the sheet brings the kept recording back.
    await openScreen(TALK);
    expect(await screen.findByText(/^Kept from /)).toBeTruthy();
    await hideWithoutCancel();

    await showFor(HARBOR);

    expectNoRecordingInTheSheet();
    await expectKeptOnceForCanopy(TALK);

    await hideWithoutCancel();
    await showFor(CANOPY);
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    expect(screen.getByText(/^Kept from /)).toBeTruthy();
    expect(keptFiles()).toHaveLength(1);
  });

  it('shown under another account (the sheet left in place): it is not shown or sent there, and is offered again under its own account', async () => {
    await recordingReadyForCanopy(TALK);
    await hideWithoutCancel();
    await act(async () => { screenControls.signInAs('owner-b'); });

    await showFor(CANOPY);

    expectNoRecordingInTheSheet();
    expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
    await expectKeptOnceForCanopy(TALK);

    await hideWithoutCancel();
    await act(async () => { screenControls.signInAs('owner-a'); });
    await showFor(CANOPY);
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    expect(screen.getByText(/^Kept from /)).toBeTruthy();
  });
});

describe('a recording ready in a sheet that keeps nothing on the device, hidden without his Cancel', () => {
  it('shown for another project: it is not shown and cannot be sent there; with nowhere to keep it, its file goes', async () => {
    await recordingReadyForCanopy(TASK_FILL);
    await hideWithoutCancel();

    await showFor(HARBOR);

    expectNoRecordingInTheSheet();
    expect(transcription.transcribeDAVECaptureMemoryAudio).not.toHaveBeenCalled();
    expect(called.words).not.toHaveBeenCalled();
    expect(keptFiles()).toEqual([]);
    expect(keptEntryKeys()).toEqual([]);
    expect(cacheFiles()).toEqual([]);
  });

  it('shown again for its own project: it is still in the sheet, as before, and Continue sends it for that project', async () => {
    await recordingReadyForCanopy(TASK_FILL);
    await hideWithoutCancel();

    await showFor(CANOPY);

    expect(screen.getByText('Recording ready')).toBeTruthy();
    expect(cacheFiles()).toHaveLength(1);
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce(WORDS);
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(sentFor()).toEqual([CANOPY]);
  });
});
