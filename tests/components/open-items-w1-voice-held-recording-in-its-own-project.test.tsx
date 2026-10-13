import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Alert, AppState } from 'react-native';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { hold, keptFiles, phone, releaseEveryHold, whatIsIn, type Hold } from '../fixtures/voice-sheet-phone';

// Batch W1, item 5 (6 Oct 2026; review pass 6, N1', wording; caused by b8eed92).
//
// A recording the phone refuses to keep is held aside by its sheet, and came
// back into the sheet only as the sheet was SHOWN for its own project. When
// the sheet was hidden and shown twice inside one slow answer from a phone
// whose storage is full, the refusal arrived with the sheet already open for
// the recording's own project: the recording was held aside all the same.
// It was not on screen, and Start Recording asked "A recording for Canopy
// Project is still here ... open it again for Canopy Project" while he was
// in Canopy Project.
//
// Now a recording held aside comes into the sheet the moment the sheet is
// open for its project: at once when the refusal arrives, or, when a Start
// Recording was waiting for that answer, in place of that start. Nothing is
// recorded over it and no question is asked there. Under another project it
// is still not shown, and Start still asks. Both kinds of recorder are run.

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
const sent: string[] = [];
type Controls = { hide: () => void; showFor: (projectName: string) => void };
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

const reached = (made: Hold) => act(async () => {
  await Promise.race([
    made.reached,
    new Promise<void>((_resolve, reject) => { setTimeout(() => reject(new Error('The slow step was never reached.')), 1_500); }),
  ]);
});
const hideWithoutCancel = () => act(async () => { screenControls.hide(); await pause(20); });
const showFor = (projectName: string) => act(async () => { screenControls.showFor(projectName); await pause(20); });
const thePhoneRefuses = (slow: Hold) => act(async () => { slow.release(); await pause(120); });

async function dictating(seconds = 12) {
  fireEvent.press(screen.getByText(screen.queryByText('Record Again') ? 'Record Again' : 'Start Recording'));
  expect(await screen.findByText('Stop Recording')).toBeTruthy();
  await act(async () => { phone.recorder.set({ durationMillis: seconds * 1_000 }); });
}

/**
 * Take-1 (12 seconds, for Canopy Project) is ready in the sheet; the phone
 * refused to keep it when he stopped it. The sheet is hidden without his
 * Cancel and shown for Harbor North: the phone is asked again, and is slow
 * to refuse.
 */
async function shownForHarborWhileThePhoneIsSlowToRefuse(): Promise<Hold> {
  view = render(<Phone />);
  await settle();
  phone.copyAsync.mockImplementationOnce(storageFull);
  await dictating();
  fireEvent.press(screen.getByText('Stop Recording'));
  expect(await screen.findByText('Recording ready')).toBeTruthy();
  await settle();
  await hideWithoutCancel();
  phone.copyAsync.mockImplementation(storageFull);
  const slowRefusal = hold(phone.copyAsync, storageFull);
  await showFor(HARBOR);
  await reached(slowRefusal);
  return slowRefusal;
}

/** Take-1 is in the sheet for Canopy Project: ready, its length, Continue there, in its file. */
function expectOnScreenForCanopy() {
  expect(screen.getByText('Recording ready')).toBeTruthy();
  expect(screen.getByText('0:12')).toBeTruthy();
  expect(screen.getByText('Continue')).toBeTruthy();
  expect(whatIsIn(phone.recorder.file)).toBe('take-1');
}

type Recorders = Readonly<{ name: string; outlive: boolean }>;
const RECORDERS: readonly Recorders[] = [
  { name: 'the recorder goes with its screen, as expo-audio’s does', outlive: false },
  { name: 'the recorder outlives its screen, as the earlier tests’ stand-in does', outlive: true },
];

describe.each(RECORDERS)('$name', ({ outlive }) => {
  beforeEach(() => { phone.recordersOutliveTheirScreen = outlive; });

  it('hidden and shown twice inside one slow answer: when the phone refuses, the recording is on screen in its own project, and nothing is asked', async () => {
    const slowRefusal = await shownForHarborWhileThePhoneIsSlowToRefuse();
    await hideWithoutCancel();
    await showFor(CANOPY);
    expect(screen.queryByText('Recording ready')).toBeNull();

    await thePhoneRefuses(slowRefusal);

    expectOnScreenForCanopy();
    expect(alert).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(called.words).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([`take-1 for ${CANOPY}`]);
  });

  it('…and his own Record Again there replaces it without a question', async () => {
    const slowRefusal = await shownForHarborWhileThePhoneIsSlowToRefuse();
    await hideWithoutCancel();
    await showFor(CANOPY);
    await thePhoneRefuses(slowRefusal);
    expectOnScreenForCanopy();

    await dictating(5);

    expect(alert).not.toHaveBeenCalled();
    expect(whatIsIn(phone.recorder.file)).toBe('take-2');
  });

  it('he taps Start Recording there before the phone has answered: the recording comes on screen in place of that start; nothing is recorded over it, and he is not asked to "open it again"', async () => {
    const slowRefusal = await shownForHarborWhileThePhoneIsSlowToRefuse();
    await hideWithoutCancel();
    await showFor(CANOPY);
    fireEvent.press(screen.getByText('Start Recording'));
    expect(await screen.findByText(WAITING)).toBeTruthy();

    await thePhoneRefuses(slowRefusal);

    expectOnScreenForCanopy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    expect(phone.takes).toBe(1);
    expect(phone.microphoneOn).toBe(false);
  });

  it('a recording still going when the sheet was hidden, and the sheet shown again for its project before the phone refuses: on screen when it does', async () => {
    view = render(<Phone />);
    await settle();
    await dictating();
    phone.copyAsync.mockImplementation(storageFull);
    const slowRefusal = hold(phone.copyAsync, storageFull);
    await hideWithoutCancel();
    await reached(slowRefusal);
    await showFor(CANOPY);
    expect(screen.queryByText('Recording ready')).toBeNull();

    await thePhoneRefuses(slowRefusal);

    expectOnScreenForCanopy();
    expect(keptFiles()).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a recording still going when the sheet was hidden, and the phone refuses while the sheet is still hidden: nothing is put into the hidden sheet; shown again for its project it is there', async () => {
    view = render(<Phone />);
    await settle();
    await dictating();
    phone.copyAsync.mockImplementation(storageFull);
    const slowRefusal = hold(phone.copyAsync, storageFull);
    await hideWithoutCancel();
    await reached(slowRefusal);

    await thePhoneRefuses(slowRefusal);
    await settle();
    // The phone was asked to keep it once, as the sheet closed. A hidden sheet is handed nothing, so
    // nothing asks again until it is shown.
    expect(phone.copyAsync).toHaveBeenCalledTimes(1);

    await showFor(CANOPY);
    await settle();
    expectOnScreenForCanopy();
    expect(alert).not.toHaveBeenCalled();
  });

  it('guard: the sheet is open for ANOTHER project when the phone refuses: it is not shown there, and Start Recording asks', async () => {
    const slowRefusal = await shownForHarborWhileThePhoneIsSlowToRefuse();

    await thePhoneRefuses(slowRefusal);

    expect(screen.queryByText('Recording ready')).toBeNull();
    expect(screen.queryByText('0:12')).toBeNull();
    fireEvent.press(screen.getByText('Start Recording'));
    await settle();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe(`A recording for ${CANOPY} is still here`);
    expect(whatIsIn(phone.recorder.file)).toBe('take-1');
  });

  it('the sheet is HIDDEN when the phone refuses: nothing comes into the hidden sheet and the phone is asked nothing more; shown for its project it is there', async () => {
    const slowRefusal = await shownForHarborWhileThePhoneIsSlowToRefuse();
    await hideWithoutCancel();

    await thePhoneRefuses(slowRefusal);
    // Asked to keep it twice so far: when he stopped it, and when the sheet let go of it.
    expect(phone.copyAsync).toHaveBeenCalledTimes(2);
    await settle();
    expect(phone.copyAsync).toHaveBeenCalledTimes(2);

    await showFor(CANOPY);
    await settle();
    expectOnScreenForCanopy();
    expect(alert).not.toHaveBeenCalled();
  });
});
