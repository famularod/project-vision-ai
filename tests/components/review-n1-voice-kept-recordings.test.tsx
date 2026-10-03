import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import fs from 'fs';
import path from 'path';
import ts from 'typescript';

import { DAVEVoiceCaptureSheet } from '../../components/DAVEVoiceCaptureSheet';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { createCaptureMemory, type DAVECaptureMemory } from '../../services/DAVECaptureMemory';
import type { DAVEProjectWalkContext } from '../../services/DAVEProjectWalk';
import { daveVoiceFailureMessage, daveVoiceWaitingForSignalError } from '../../services/DAVEVoiceSignalWait';
import {
  keepVoiceRecording,
  keptVoiceRecordingExists,
  readKeptVoiceRecording,
  sweepKeptVoiceRecordings,
} from '../../services/KeptVoiceRecording';

// Review N1 of everyday item 4 (2 Oct 2026). A recording kept on the device
// (d314aba) had one entry per SHEET, and the sheet removed that entry when it
// had never loaded the recording. Each finding has its own describe below.

jest.setTimeout(20_000);

type MockStatus = { canRecord: boolean; isRecording: boolean; durationMillis: number; mediaServicesDidReset: boolean; url: string | null };

jest.mock('expo-audio', () => {
  const { useSyncExternalStore } = require('react');
  const listeners = new Set<() => void>();
  const store = {
    status: { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null } as MockStatus,
    set(next: Partial<MockStatus>) {
      store.status = { ...store.status, ...next };
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const recorder = {
    id: 'mock-recorder', uri: null as string | null, currentTime: 0,
    prepareToRecordAsync: jest.fn(async () => undefined), record: jest.fn(), stop: jest.fn(), getStatus: jest.fn(() => store.status),
  };
  return {
    __mock: { store, recorder },
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setAudioModeAsync: jest.fn(async () => undefined),
    useAudioRecorder: () => recorder,
    useAudioRecorderState: () => useSyncExternalStore(store.subscribe, () => store.status),
    useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => undefined) }),
    useAudioPlayerStatus: () => ({ playing: false, didJustFinish: false, currentTime: 0, duration: 0 }),
  };
});

/** The device's files: the recorder's cache and the app's documents folder. */
const mockFiles = new Set<string>();
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri), size: mockFiles.has(uri) ? 4096 : 0 })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!mockFiles.has(from)) throw new Error('missing');
    mockFiles.add(to);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    [...mockFiles].filter(file => file === uri || file.startsWith(uri.endsWith('/') ? uri : `${uri}/`)).forEach(file => mockFiles.delete(file));
  }),
  readDirectoryAsync: jest.fn(async (uri: string) => {
    const names = [...mockFiles].filter(file => file.startsWith(uri)).map(file => file.slice(uri.length));
    if (names.length === 0) throw new Error('Directory does not exist.');
    return names;
  }),
}));

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
}));

jest.mock('../../services/DAVEVoiceTranscriptionService', () => ({
  transcribeDAVECaptureMemoryAudio: jest.fn(),
}));

const audio = jest.requireMock('expo-audio') as {
  __mock: { store: { status: MockStatus; set: (next: Partial<MockStatus>) => void }; recorder: { uri: string | null; prepareToRecordAsync: jest.Mock; record: jest.Mock; stop: jest.Mock; getStatus: jest.Mock } };
};
const { store, recorder } = audio.__mock;
const transcription = jest.requireMock('../../services/DAVEVoiceTranscriptionService') as { transcribeDAVECaptureMemoryAudio: jest.Mock };
const asyncStorage = jest.requireMock('@react-native-async-storage/async-storage') as { getItem: jest.Mock; getAllKeys: jest.Mock };
const fileSystem = jest.requireMock('expo-file-system/legacy') as { copyAsync: jest.Mock };

const CACHE_URI = 'file:///cache/Audio/recording-1.m4a';
const KEPT_FOLDER = 'file:///documents/kept-recordings/';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const KEPT_NO_SIGNAL = 'No signal. Your recording is kept on this device — tap Continue when you have signal. If Vitruvius closes, it is tried again the next time you open this.';
const keptFiles = () => [...mockFiles].filter(file => file.startsWith(KEPT_FOLDER));
const entryKeys = () => [...mockStorage.keys()].filter(key => key.includes('/voice-recording/'));
/** A recording brought back from the device also says when and where it was dictated (review N1 L3). */
const WHEN_AND_WHERE = { recordedAt: expect.any(String), walkArea: null };
const settle = (ms = 50) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });

function resetRecorder() {
  store.status = { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null };
  recorder.uri = null;
  recorder.record.mockClear();
}

beforeEach(() => {
  mockFiles.clear();
  mockStorage.clear();
  resetRecorder();
  recorder.prepareToRecordAsync.mockImplementation(async () => {
    recorder.uri = CACHE_URI;
    mockFiles.add(CACHE_URI);
    store.set({ canRecord: true, url: CACHE_URI });
  });
  recorder.record.mockImplementation(() => { store.set({ isRecording: true, durationMillis: 0 }); });
  recorder.stop.mockImplementation(async () => { store.set({ isRecording: false, durationMillis: 0 }); });
  recorder.getStatus.mockImplementation(() => store.status);
  transcription.transcribeDAVECaptureMemoryAudio.mockReset();
});

let view: ReturnType<typeof render> | null = null;
/** iOS closes the app: this sheet's app session ends, and its cache is cleared. */
function closeApp() {
  view?.unmount();
  view = null;
  mockFiles.delete(CACHE_URI);
  resetRecorder();
}
afterEach(() => {
  closeApp();
  jest.useRealTimers();
});

/** The phone's clock reads `iso`; timers still run. */
function clockReads(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask'],
  });
}

type SheetOptions = {
  owner?: string;
  projectName?: string;
  keepSlot?: string;
  autoStartRecording?: boolean;
  walkContext?: DAVEProjectWalkContext;
  onMemoryReady?: jest.Mock;
  onCancel?: jest.Mock;
};

/** Opens a voice sheet for `owner` (a fresh app session when the last one was closed). */
function openSheet({
  owner = 'owner-a',
  projectName = 'Canopy Project',
  keepSlot = 'talk',
  autoStartRecording = false,
  walkContext,
  onMemoryReady = jest.fn(),
  onCancel = jest.fn(),
}: SheetOptions = {}) {
  closeApp();
  view = render(
    <NativeWorkspaceOwnerContext.Provider value={owner}>
      <DAVEVoiceCaptureSheet
        visible
        projectId={PROJECT_ID}
        projectName={projectName}
        candidateProjects={['Canopy Project', 'Harbor North']}
        candidateLocations={[]}
        title="Talk"
        continueLabel="Continue"
        keepSlot={keepSlot}
        autoStartRecording={autoStartRecording}
        walkContext={walkContext}
        onMemoryReady={onMemoryReady}
        onTypeInstead={jest.fn()}
        onCancel={onCancel}
      />
    </NativeWorkspaceOwnerContext.Provider>,
  );
  return { onMemoryReady, onCancel };
}

async function record(durationMillis = 9_000) {
  fireEvent.press(await screen.findByText('Start Recording'));
  await waitFor(() => expect(recorder.record).toHaveBeenCalled());
  await act(async () => { store.set({ durationMillis }); });
  fireEvent.press(screen.getByText('Stop Recording'));
  await screen.findByText('Replay Recording');
}

/** Records, taps Continue with no signal: the recording is kept on the device. */
async function recordAndWaitForSignal(kept = 1) {
  await record();
  transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
  fireEvent.press(screen.getByText('Continue'));
  expect(await screen.findByText(KEPT_NO_SIGNAL)).toBeTruthy();
  await waitFor(() => expect(keptFiles()).toHaveLength(kept));
}

describe('review N1 M1: a kept recording is only removed by Use, Discard or Record Again on THAT recording', () => {
  it('the dictation sheet opened for another project records without touching it; back on its own project it is offered and used', async () => {
    openSheet({ keepSlot: 'field-note', projectName: 'Canopy Project' });
    await recordAndWaitForSignal();
    const canopyAudio = keptFiles()[0];

    // The next launch: Field Notes' voice sheet (it records by itself) for another project.
    openSheet({ keepSlot: 'field-note', projectName: 'Harbor North', autoStartRecording: true });
    await waitFor(() => expect(recorder.record).toHaveBeenCalled(), { timeout: 3000 });
    await settle();
    // Never loaded here, so never removed here: its entry and audio stay, and the Sign Out warning still names it.
    expect(entryKeys()).toHaveLength(1);
    expect(keptFiles()).toEqual([canopyAudio]);
    await expect(keptVoiceRecordingExists('owner-a')).resolves.toBe(true);
    await expect(readKeptVoiceRecording('owner-a', 'field-note', 'Harbor North')).resolves.toBeNull();
    await expect(readKeptVoiceRecording('owner-a', 'field-note', 'Canopy Project')).resolves.toMatchObject({ uri: canopyAudio });
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledTimes(1);

    // Back on Canopy Project: offered and tried again; used, so now it goes.
    const onMemoryReady = jest.fn();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'Rebar passed.' });
    openSheet({ keepSlot: 'field-note', projectName: 'Canopy Project', autoStartRecording: true, onMemoryReady });
    await waitFor(() => expect(onMemoryReady).toHaveBeenCalledWith({ transcript: 'Rebar passed.' }, WHEN_AND_WHERE));
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenLastCalledWith(expect.objectContaining({ uri: canopyAudio, projectName: 'Canopy Project' }));
    await waitFor(() => expect(keptFiles()).toHaveLength(0));
    expect(entryKeys()).toHaveLength(0);
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('Ask ECOS opened for another project, or with no project chosen, and closed with X leaves it kept', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    openSheet({ keepSlot: 'ask', projectName: 'Canopy Project' });
    await recordAndWaitForSignal();
    for (const projectName of ['Harbor North', '']) {
      const { onCancel } = openSheet({ keepSlot: 'ask', projectName });
      await settle();
      expect(screen.queryByText('Recording ready')).toBeNull();
      alert.mockClear();
      fireEvent.press(screen.getByLabelText('Cancel memory capture'));
      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
      await settle();
      expect(alert).not.toHaveBeenCalled();
      expect(entryKeys()).toHaveLength(1);
      expect(keptFiles()).toHaveLength(1);
    }
    openSheet({ keepSlot: 'ask', projectName: 'Canopy Project' });
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    expect(await screen.findByText('Recording ready')).toBeTruthy();
    alert.mockRestore();
  });

  it('a second recording kept by the same sheet for another project is kept beside the first; each is offered for its own project', async () => {
    openSheet({ keepSlot: 'ask', projectName: 'Canopy Project' });
    await recordAndWaitForSignal();
    openSheet({ keepSlot: 'ask', projectName: 'Harbor North' });
    await settle();
    await recordAndWaitForSignal(2);
    expect(entryKeys()).toHaveLength(2);
    const canopy = await readKeptVoiceRecording('owner-a', 'ask', 'Canopy Project');
    const harbor = await readKeptVoiceRecording('owner-a', 'ask', 'Harbor North');
    expect(canopy?.projectName).toBe('Canopy Project');
    expect(harbor?.projectName).toBe('Harbor North');
    expect(new Set([canopy?.uri, harbor?.uri]).size).toBe(2);

    // Harbor North's is used: Canopy Project's stays kept.
    const onMemoryReady = jest.fn();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'Harbor words.' });
    openSheet({ keepSlot: 'ask', projectName: 'Harbor North', onMemoryReady });
    await waitFor(() => expect(onMemoryReady).toHaveBeenCalledWith({ transcript: 'Harbor words.' }, WHEN_AND_WHERE));
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenLastCalledWith(expect.objectContaining({ uri: harbor?.uri, projectName: 'Harbor North' }));
    await waitFor(() => expect(keptFiles()).toEqual([canopy?.uri]));
    expect(entryKeys()).toHaveLength(1);
  });

  it('Start Recording tapped before the kept check answers leaves the kept recording kept; it is offered the next time', async () => {
    openSheet({ keepSlot: 'ask' });
    await recordAndWaitForSignal();
    const keptAudio = keptFiles()[0];
    closeApp();
    // Slow phone storage: the kept check has not answered when he taps Start Recording.
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    asyncStorage.getAllKeys.mockImplementationOnce(async () => { await gate; return [...mockStorage.keys()]; });
    openSheet({ keepSlot: 'ask' });
    fireEvent.press(screen.getByText('Start Recording'));
    await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 50)); });
    await waitFor(() => expect(recorder.record).toHaveBeenCalled());
    expect(entryKeys()).toHaveLength(1);
    expect(keptFiles()).toEqual([keptAudio]);
    // He is recording: the kept one is not put over it.
    expect(screen.getByText('Stop Recording')).toBeTruthy();

    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    openSheet({ keepSlot: 'ask' });
    expect(await screen.findByText(KEPT_NO_SIGNAL)).toBeTruthy();
    expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenLastCalledWith(expect.objectContaining({ uri: keptAudio }));
  });

  it('Record Again and Discard remove the recording the sheet holds, and no other', async () => {
    openSheet({ keepSlot: 'ask', projectName: 'Harbor North' });
    await recordAndWaitForSignal();
    const harborAudio = keptFiles()[0];
    openSheet({ keepSlot: 'ask', projectName: 'Canopy Project' });
    await settle();
    await recordAndWaitForSignal(2);
    // Record Again on Canopy Project's recording: only that one goes.
    fireEvent.press(screen.getByText('Record Again'));
    await waitFor(() => expect(keptFiles()).toEqual([harborAudio]));
    expect(entryKeys()).toHaveLength(1);
    await act(async () => { store.set({ durationMillis: 5_000 }); });
    fireEvent.press(screen.getByText('Stop Recording'));
    await screen.findByText('Replay Recording');
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(keptFiles()).toHaveLength(2));
    // Discard on it: again only that one goes.
    const alert = jest.spyOn(Alert, 'alert');
    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] ?? [];
    await act(async () => { buttons.find(button => button.text === 'Discard')?.onPress?.(); });
    await waitFor(() => expect(keptFiles()).toEqual([harborAudio]));
    expect(entryKeys()).toHaveLength(1);
    await expect(readKeptVoiceRecording('owner-a', 'ask', 'Harbor North')).resolves.toMatchObject({ uri: harborAudio });
    alert.mockRestore();
  });

  it('a recording kept twice while its first keep is under way is kept once', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    openSheet({ keepSlot: 'ask' });
    await record();
    let finishCopy: () => void = () => undefined;
    fileSystem.copyAsync.mockImplementationOnce(async ({ to }: { from: string; to: string }) => {
      await new Promise<void>(resolve => { finishCopy = resolve; });
      mockFiles.add(to);
    });
    transcription.transcribeDAVECaptureMemoryAudio
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    // "Keep Recording for Later" starts the keep; Continue then fails with no signal and keeps again.
    fireEvent.press(screen.getByText('Continue'));
    expect(await screen.findByText('Preparing…')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Cancel memory capture'));
    const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] ?? [];
    act(() => { buttons.find(button => button.text === 'Keep Recording for Later')?.onPress?.(); });
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(transcription.transcribeDAVECaptureMemoryAudio).toHaveBeenCalledTimes(2));
    await act(async () => { finishCopy(); await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(await screen.findByText(KEPT_NO_SIGNAL)).toBeTruthy();
    expect(keptFiles()).toHaveLength(1);
    expect(entryKeys()).toHaveLength(1);
    alert.mockRestore();
  });
});

describe('review N1 M1: audio with no entry is swept safely', () => {
  const ORPHAN = `${KEPT_FOLDER}recording-1-orphan.m4a`;

  it('audio no entry points at is deleted at the next kept check; a kept recording, of any account, stays', async () => {
    mockFiles.add(CACHE_URI);
    const mine = await keepVoiceRecording('owner-a', 'talk', { uri: CACHE_URI, durationMs: 5_000, projectId: PROJECT_ID, projectName: 'Canopy Project' });
    const theirs = await keepVoiceRecording('owner-b', 'ask', { uri: CACHE_URI, durationMs: 5_000, projectId: PROJECT_ID, projectName: 'Harbor North' });
    mockFiles.add(ORPHAN);
    mockFiles.add(`${KEPT_FOLDER}notes.txt`);
    await expect(readKeptVoiceRecording('owner-a', 'field-note', 'Harbor North')).resolves.toBeNull();
    expect(keptFiles().sort()).toEqual([mine, theirs, `${KEPT_FOLDER}notes.txt`].sort());
    await expect(keptVoiceRecordingExists('owner-a')).resolves.toBe(true);
    await expect(keptVoiceRecordingExists('owner-b')).resolves.toBe(true);
  });

  it('an entry whose audio is gone is removed; audio whose entry is gone is deleted', async () => {
    mockFiles.add(CACHE_URI);
    const first = await keepVoiceRecording('owner-a', 'talk', { uri: CACHE_URI, durationMs: 5_000, projectId: PROJECT_ID, projectName: 'Canopy Project' });
    mockFiles.delete(first);
    await expect(readKeptVoiceRecording('owner-a', 'talk')).resolves.toBeNull();
    expect(entryKeys()).toHaveLength(0);
    const second = await keepVoiceRecording('owner-a', 'talk', { uri: CACHE_URI, durationMs: 5_000, projectId: PROJECT_ID, projectName: 'Canopy Project' });
    expect(keptFiles()).toEqual([second]);
    mockStorage.clear();
    await expect(readKeptVoiceRecording('owner-a', 'talk')).resolves.toBeNull();
    expect(keptFiles()).toEqual([]);
  });

  it('nothing is deleted when the phone\'s storage cannot be listed, or an entry cannot be read', async () => {
    mockFiles.add(CACHE_URI);
    const kept = await keepVoiceRecording('owner-a', 'talk', { uri: CACHE_URI, durationMs: 5_000, projectId: PROJECT_ID, projectName: 'Canopy Project' });
    mockFiles.add(ORPHAN);
    asyncStorage.getAllKeys.mockRejectedValueOnce(new Error('storage is locked'));
    await sweepKeptVoiceRecordings();
    expect(keptFiles().sort()).toEqual([kept, ORPHAN].sort());
    // Listed, but this entry's read fails: it may point at any of them.
    asyncStorage.getItem.mockRejectedValueOnce(new Error('storage is locked'));
    await sweepKeptVoiceRecordings();
    expect(keptFiles().sort()).toEqual([kept, ORPHAN].sort());
    mockStorage.set('@vitruvius/kept-drafts/v1/voice-recording/owner-c/ask', 'not json');
    await sweepKeptVoiceRecordings();
    expect(keptFiles().sort()).toEqual([kept, ORPHAN].sort());
    mockStorage.delete('@vitruvius/kept-drafts/v1/voice-recording/owner-c/ask');
    await sweepKeptVoiceRecordings();
    expect(keptFiles()).toEqual([kept]);
  });

  it('a keep under way is never swept: its copy is in the folder before its entry is written', async () => {
    mockFiles.add(CACHE_URI);
    let finishCopy: () => void = () => undefined;
    fileSystem.copyAsync.mockImplementationOnce(async ({ to }: { from: string; to: string }) => {
      mockFiles.add(to);
      await new Promise<void>(resolve => { finishCopy = resolve; });
    });
    const keeping = keepVoiceRecording('owner-a', 'talk', { uri: CACHE_URI, durationMs: 5_000, projectId: PROJECT_ID, projectName: 'Canopy Project' });
    await waitFor(() => expect(keptFiles()).toHaveLength(1));
    const sweeping = sweepKeptVoiceRecordings();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(keptFiles()).toHaveLength(1);
    finishCopy();
    const kept = await keeping;
    await sweeping;
    expect(keptFiles()).toEqual([kept]);
    await expect(readKeptVoiceRecording('owner-a', 'talk')).resolves.toMatchObject({ uri: kept });
  });

  it('an entry kept before this change (one per sheet) is still read, offered for its project and removed with its recording', async () => {
    mockFiles.add(`${KEPT_FOLDER}recording-7-old.m4a`);
    mockStorage.set('@vitruvius/kept-drafts/v1/voice-recording/owner-a/talk', JSON.stringify({
      version: 1,
      keptAt: '2026-10-01T21:14:00.000Z',
      value: { fileName: 'recording-7-old.m4a', durationMs: 9_000, projectId: PROJECT_ID, projectName: 'Canopy Project' },
    }));
    await expect(readKeptVoiceRecording('owner-a', 'talk', 'Harbor North')).resolves.toBeNull();
    await expect(readKeptVoiceRecording('owner-a', 'ask', 'Canopy Project')).resolves.toBeNull();
    expect(keptFiles()).toHaveLength(1);
    const onMemoryReady = jest.fn();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'Old words.' });
    openSheet({ onMemoryReady });
    await waitFor(() => expect(onMemoryReady).toHaveBeenCalledWith({ transcript: 'Old words.' }, WHEN_AND_WHERE));
    await waitFor(() => expect(keptFiles()).toHaveLength(0));
    expect(entryKeys()).toHaveLength(0);
  });
});

describe('review N1 L3: a Project Walk memory brought back from the device keeps the time and area it was dictated in', () => {
  const LEVEL_2 = { id: 'area-level-2', name: 'Level 2 East', confidence: 'high', distanceFeet: 12 } as const;
  const ROOF = { id: 'area-roof', name: 'Roof', confidence: 'high', distanceFeet: 20 } as const;
  const walkAt = (area: DAVEProjectWalkContext['recommendedArea']): DAVEProjectWalkContext => ({
    schemaVersion: 1,
    projectName: 'Canopy Project',
    locationStatus: area ? 'matched' : 'unavailable',
    locationMessage: area ? `You appear to be near ${area.name}.` : 'Location is not available.',
    recommendedArea: area,
    prompt: { guidance: 'What changed here?', whyItMatters: 'It keeps the record current.' },
  } as unknown as DAVEProjectWalkContext);

  it('the sheet hands on when and where it was dictated; a recording used in the same session hands on only its words', async () => {
    clockReads('2026-10-01T21:14:00.000Z');
    openSheet({ keepSlot: 'walk:Canopy Project', walkContext: walkAt(LEVEL_2) });
    await recordAndWaitForSignal();
    await expect(readKeptVoiceRecording('owner-a', 'walk:Canopy Project', 'Canopy Project')).resolves.toMatchObject({
      recordedAt: '2026-10-01T21:14:00.000Z',
      walkArea: LEVEL_2,
    });

    // The next day, on the roof, with signal: the walk sheet opens and its words arrive.
    closeApp();
    clockReads('2026-10-02T15:30:00.000Z');
    const onMemoryReady = jest.fn();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'Rebar inspection passed.' });
    openSheet({ keepSlot: 'walk:Canopy Project', walkContext: walkAt(ROOF), onMemoryReady });
    await waitFor(() => expect(onMemoryReady).toHaveBeenCalledTimes(1));
    expect(onMemoryReady).toHaveBeenCalledWith(
      { transcript: 'Rebar inspection passed.' },
      { recordedAt: '2026-10-01T21:14:00.000Z', walkArea: LEVEL_2 },
    );

    // A recording made and used now says nothing more than its words: the walk stamps it as before.
    const sameSession = jest.fn();
    openSheet({ keepSlot: 'walk:Canopy Project', walkContext: walkAt(ROOF), onMemoryReady: sameSession });
    await settle();
    await record();
    transcription.transcribeDAVECaptureMemoryAudio.mockResolvedValueOnce({ transcript: 'Roof drains clear.' });
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(sameSession).toHaveBeenCalledTimes(1));
    expect(sameSession.mock.calls[0]).toEqual([{ transcript: 'Roof drains clear.' }]);
  });

  it('where the walk had not placed him yet when he finished speaking, the area it had when the recording was kept is kept', async () => {
    clockReads('2026-10-01T21:14:00.000Z');
    openSheet({ keepSlot: 'walk:Canopy Project', walkContext: walkAt(null) });
    await record();
    view?.rerender(
      <NativeWorkspaceOwnerContext.Provider value="owner-a">
        <DAVEVoiceCaptureSheet
          visible
          projectId={PROJECT_ID}
          projectName="Canopy Project"
          candidateProjects={['Canopy Project', 'Harbor North']}
          candidateLocations={[]}
          title="Talk"
          continueLabel="Continue"
          keepSlot="walk:Canopy Project"
          walkContext={walkAt(LEVEL_2)}
          onMemoryReady={jest.fn()}
          onTypeInstead={jest.fn()}
          onCancel={jest.fn()}
        />
      </NativeWorkspaceOwnerContext.Provider>,
    );
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(keptFiles()).toHaveLength(1));
    await expect(readKeptVoiceRecording('owner-a', 'walk:Canopy Project')).resolves.toMatchObject({ walkArea: LEVEL_2 });
  });

  it('an entry kept before this change has its kept time and no area', async () => {
    mockFiles.add(`${KEPT_FOLDER}recording-7-old.m4a`);
    mockStorage.set('@vitruvius/kept-drafts/v1/voice-recording/owner-a/walk%3ACanopy%20Project', JSON.stringify({
      version: 1,
      keptAt: '2026-10-01T21:14:00.000Z',
      value: { fileName: 'recording-7-old.m4a', durationMs: 9_000, projectId: PROJECT_ID, projectName: 'Canopy Project', walkArea: { id: 7 } },
    }));
    await expect(readKeptVoiceRecording('owner-a', 'walk:Canopy Project')).resolves.toMatchObject({
      recordedAt: '2026-10-01T21:14:00.000Z',
      walkArea: null,
    });
  });

  /** The Project Walk's own handler, as App.tsx has it, run with the walk standing on the roof today. */
  function walkMemoryFrom(result: unknown, kept?: unknown): DAVECaptureMemory {
    const app = fs.readFileSync(path.join(__dirname, '../../App.tsx'), 'utf8');
    const sheet = app.indexOf('keepSlot={`walk:${projectName}`}');
    const from = app.indexOf('onMemoryReady={', sheet) + 'onMemoryReady={'.length;
    const to = app.indexOf('onTypeInstead={', from);
    expect(sheet).toBeGreaterThan(0);
    const source = app.slice(from, app.lastIndexOf('}', to));
    const compiled = ts.transpileModule(`const handler = ${source};`, { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
    const setCaptureDraft = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const handler = new Function(
      'projectWalkLocationRequest', 'uid', 'projectWalkContext', 'setCaptureDraft', 'createCaptureMemory', 'projectName', 'closeProjectWalkCapture',
      `${compiled}; return handler;`,
    )({ current: 0 }, () => 'm1', walkAt(ROOF), setCaptureDraft, createCaptureMemory, 'Canopy Project', jest.fn()) as (result: unknown, kept?: unknown) => void;
    handler(result, kept);
    expect(setCaptureDraft).toHaveBeenCalledTimes(1);
    return setCaptureDraft.mock.calls[0][0] as DAVECaptureMemory;
  }
  const words = {
    transcript: 'Rebar inspection passed.',
    understanding: { status: 'failed', fields: {}, recommendedLocation: { value: null, confidence: 'unknown' } },
  };

  it('the Project Walk stamps a memory brought back from the device with its own time and area, not now and here', () => {
    clockReads('2026-10-02T15:30:00.000Z');
    const restored = walkMemoryFrom(words, { recordedAt: '2026-10-01T21:14:00.000Z', walkArea: LEVEL_2 });
    expect(restored.createdAt).toBe('2026-10-01T21:14:00.000Z');
    expect(restored.recommendedLocation.value).toBe('Level 2 East');
    expect(restored.evidence.filter(evidence => evidence.kind === 'location_record')).toEqual([
      expect.objectContaining({ sourceRecordId: 'area-level-2', summary: 'Current device location matched this saved project area during capture.' }),
    ]);

    // Dictated where the walk had matched no area: none is claimed, though he stands on the roof now.
    const nowhere = walkMemoryFrom(words, { recordedAt: '2026-10-01T21:14:00.000Z', walkArea: null });
    expect(nowhere.recommendedLocation.value).toBeNull();
    expect(nowhere.evidence.filter(evidence => evidence.kind === 'location_record')).toEqual([]);

    // A recording used as it is made: now, and the area he is in, as before.
    const live = walkMemoryFrom(words);
    expect(live.createdAt).toBe('2026-10-02T15:30:00.000Z');
    expect(live.recommendedLocation.value).toBe('Roof');
    expect(live.evidence.filter(evidence => evidence.kind === 'location_record')).toEqual([
      expect.objectContaining({ sourceRecordId: 'area-roof' }),
    ]);
  });
});

describe('review N1 L4: an upload that fails for want of signal says the recording is kept', () => {
  const OFFLINE = 'This device is offline. Reconnect, then retry this recording or type instead. (VOICE-OFFLINE)';

  it.each([
    [OFFLINE, 'This device is offline. Reconnect, then retry this recording or type instead. Your recording is kept on this device. (VOICE-OFFLINE)'],
    ['The voice upload timed out. Retry this recording or type instead. (VOICE-TIMEOUT)', 'The voice upload timed out. Retry this recording or type instead. Your recording is kept on this device. (VOICE-TIMEOUT)'],
    ['The connection was interrupted while uploading. Retry this recording or type instead. (VOICE-CONNECTION)', 'The connection was interrupted while uploading. Retry this recording or type instead. Your recording is kept on this device. (VOICE-CONNECTION)'],
    ['Could not reach voice transcription. Check the connection and try again.', 'Could not reach voice transcription. Check the connection and try again. Your recording is kept on this device.'],
  ])('%s', async (failure, shown) => {
    openSheet({ keepSlot: 'field-note' });
    await record();
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(new Error(failure));
    fireEvent.press(screen.getByText('Continue'));
    expect(await screen.findByText(shown)).toBeTruthy();
    expect(keptFiles()).toHaveLength(1);
    expect(entryKeys()).toHaveLength(1);
  });

  it('a recording that could not be kept on the device is not called kept on it', async () => {
    openSheet({ keepSlot: 'field-note' });
    await record();
    fileSystem.copyAsync.mockRejectedValueOnce(new Error('No space left on device.'));
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(new Error(OFFLINE));
    fireEvent.press(screen.getByText('Continue'));
    expect(await screen.findByText(OFFLINE)).toBeTruthy();
    expect(keptFiles()).toHaveLength(0);

    fileSystem.copyAsync.mockRejectedValueOnce(new Error('No space left on device.'));
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(daveVoiceWaitingForSignalError());
    fireEvent.press(screen.getByText('Continue'));
    expect(await screen.findByText('No signal. Your recording is kept while Vitruvius stays open — tap Continue when you have signal.')).toBeTruthy();
    expect(keptFiles()).toHaveLength(0);
    expect(entryKeys()).toHaveLength(0);
  });

  it('a sheet that keeps nothing on the device says what it said', async () => {
    closeApp();
    view = render(
      <DAVEVoiceCaptureSheet
        visible
        projectId={PROJECT_ID}
        projectName="Canopy Project"
        candidateLocations={[]}
        continueLabel="Continue"
        onMemoryReady={jest.fn()}
        onTypeInstead={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    await record();
    transcription.transcribeDAVECaptureMemoryAudio.mockRejectedValueOnce(new Error(OFFLINE));
    fireEvent.press(screen.getByText('Continue'));
    expect(await screen.findByText(OFFLINE)).toBeTruthy();
    expect(keptFiles()).toHaveLength(0);
  });

  it('the message keeps its code last, and one with no code has the sentence added', () => {
    expect(daveVoiceFailureMessage(new Error(OFFLINE), 'Use Note', true))
      .toBe('This device is offline. Reconnect, then retry this recording or type instead. Your recording is kept on this device. (VOICE-OFFLINE)');
    expect(daveVoiceFailureMessage(new Error(OFFLINE), 'Use Note')).toBe(OFFLINE);
    expect(daveVoiceFailureMessage(new Error('Something else.'), 'Use Note', true)).toBe('Something else. Your recording is kept on this device.');
    expect(daveVoiceFailureMessage(daveVoiceWaitingForSignalError(), 'Use Note', true))
      .toBe('No signal. Your recording is kept on this device — tap Use Note when you have signal. If Vitruvius closes, it is tried again the next time you open this.');
  });
});
