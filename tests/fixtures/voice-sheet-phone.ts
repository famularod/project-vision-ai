import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * A stand-in phone for the voice sheet's tests (review pass 4, 5 Oct 2026):
 * its audio (expo-audio), its files and its storage.
 *
 * It differs from the stand-ins of the earlier voice tests in two ways, both
 * as expo-audio is:
 *  - every voice sheet has its OWN recorder (useAudioRecorder makes one per
 *    component), and all of them share the phone's one audio mode;
 *  - a recorder GOES WITH ITS SCREEN. expo-audio releases it when its
 *    component is taken away (an effect cleanup), the microphone goes off
 *    with it, and a released recorder throws on anything read from it or
 *    asked of it. `phone.recordersOutliveTheirScreen` makes them the kind the
 *    earlier tests have, so both kinds can be tested.
 *
 * What a real phone does with a stop that was asked BEFORE the recorder went
 * and answers after cannot be run here. The library's code says it answers
 * on iOS (the recorder is found when the stop is asked, and the release
 * stops a recorder that is recording), and that on Android it is refused
 * when the release got there first (the recorder is found only when the stop
 * runs, and its file is then never finished). `phone.goneRecorderRefusesStop`
 * is the second.
 */

export type StandInRecorderStatus = {
  canRecord: boolean;
  isRecording: boolean;
  durationMillis: number;
  mediaServicesDidReset: boolean;
  url: string | null;
};

const RECORDER_GONE = 'Unable to find the native shared object associated with given JavaScript object.';
const NOT_STARTED: StandInRecorderStatus = { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null };

function makeRecorder(number: number) {
  const listeners = new Set<() => void>();
  const mustBeThere = (): void => {
    if (recorder.gone) throw new Error(RECORDER_GONE);
  };
  const recorder = {
    id: `stand-in-recorder-${number}`,
    currentTime: 0,
    /** Its file in the phone's cache, once it has been made ready. */
    file: null as string | null,
    microphoneOn: false,
    /** Released with its screen. */
    gone: false,
    status: { ...NOT_STARTED },
    /** What the sheet is told the next time it asks (it asks every 200 ms). */
    set(next: Partial<StandInRecorderStatus>): void {
      recorder.status = { ...recorder.status, ...next };
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get uri(): string | null {
      mustBeThere();
      return recorder.file;
    },
    prepareToRecordAsync: jest.fn(),
    record: jest.fn(),
    stop: jest.fn(),
    getStatus: jest.fn(),
    /** What each does unless a test says otherwise (a test's slow step ends with one of these). */
    readies: async (): Promise<void> => {
      mustBeThere();
      recorder.file = `file:///cache/Audio/recording-${number}.m4a`;
      phone.files.add(recorder.file);
      // The sheet learns of it when it next asks; here at once, unless the test says later.
      if (!phone.reportsLate) recorder.set({ canRecord: true, url: recorder.file });
    },
    records: (): void => {
      mustBeThere();
      recorder.microphoneOn = true;
      if (!phone.reportsLate) recorder.set({ isRecording: true, durationMillis: 0 });
    },
    stops: async (): Promise<void> => {
      // Asked of a recorder that has already gone: refused.
      mustBeThere();
      await recorder.stopAnswers();
    },
    /** The answer to a stop it was asked earlier (a test's slow stop ends with this). */
    stopAnswers: async (): Promise<void> => {
      recorder.microphoneOn = false;
      recorder.set({ isRecording: false, durationMillis: 0 });
      if (!phone.goneRecorderRefusesStop) return;
      // Refused when its screen, and so the recorder, has gone by the time it answers.
      await Promise.resolve();
      mustBeThere();
    },
    /** Asked directly, the recorder says what its microphone is doing now. */
    says: (): StandInRecorderStatus => {
      mustBeThere();
      return { ...recorder.status, isRecording: recorder.microphoneOn };
    },
    /** The sheet asks the recorder how it is, and is told: its file, and what its microphone is doing. */
    reports(): void {
      recorder.set({ canRecord: recorder.file !== null, url: recorder.file, isRecording: recorder.microphoneOn });
    },
    /** The phone stopped it (a lock, a call, the 3-minute limit, or the audio mode going back). */
    stoppedByThePhone(): void {
      if (!recorder.microphoneOn) return;
      recorder.microphoneOn = false;
      recorder.set({ isRecording: false });
    },
    release(): void {
      recorder.gone = true;
      recorder.microphoneOn = false;
    },
  };
  recorder.prepareToRecordAsync.mockImplementation(recorder.readies);
  recorder.record.mockImplementation(recorder.records);
  recorder.stop.mockImplementation(recorder.stops);
  recorder.getStatus.mockImplementation(recorder.says);
  return recorder;
}

export type StandInRecorder = ReturnType<typeof makeRecorder>;

const microphoneAllowed = async () => ({ granted: true });
const audioModeSet = async (mode: { allowsRecording?: boolean }) => {
  phone.allowsRecording = Boolean(mode.allowsRecording);
  // iOS: switching the audio mode back from recording stops every recorder that is recording.
  if (!phone.allowsRecording && phone.audioModeOffStopsEveryRecorder) phone.recorders.forEach(recorder => recorder.stoppedByThePhone());
};
const deleteFile = async (uri: string) => {
  [...phone.files].filter(file => file === uri || file.startsWith(uri.endsWith('/') ? uri : `${uri}/`)).forEach(file => phone.files.delete(file));
};
const copyFile = async ({ from, to }: { from: string; to: string }) => {
  if (!phone.files.has(from)) throw new Error('missing');
  phone.files.add(to);
};
const listKeys = async () => [...phone.storage.keys()];

export const phone = {
  /** The phone's one audio mode, shared by every voice sheet. */
  allowsRecording: false,
  audioModeOffStopsEveryRecorder: false,
  /** The sheet is told what its recorder is doing only when the test says (`recorder.reports()`). */
  reportsLate: false,
  recordersOutliveTheirScreen: false,
  goneRecorderRefusesStop: false,
  /** Every recorder made, in the order their sheets were put up. */
  recorders: [] as StandInRecorder[],
  /** The phone's files: the recorders' cache and the app's documents folder. */
  files: new Set<string>(),
  storage: new Map<string, string>(),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
  getAllKeys: jest.fn(),
  microphoneAllowed,
  audioModeSet,
  deleteFile,
  /** The recorder of the voice sheet put up last. */
  get recorder(): StandInRecorder {
    const last = phone.recorders[phone.recorders.length - 1];
    if (!last) throw new Error('No voice sheet has been put up yet.');
    return last;
  },
  /** Whether any microphone is on. */
  get microphoneOn(): boolean {
    return phone.recorders.some(recorder => recorder.microphoneOn);
  },
  /** A new phone for the next test. */
  reset() {
    phone.allowsRecording = false;
    phone.audioModeOffStopsEveryRecorder = false;
    phone.reportsLate = false;
    phone.recordersOutliveTheirScreen = false;
    phone.goneRecorderRefusesStop = false;
    phone.recorders = [];
    phone.files.clear();
    phone.storage.clear();
    phone.requestRecordingPermissionsAsync.mockReset();
    phone.requestRecordingPermissionsAsync.mockImplementation(microphoneAllowed);
    phone.setAudioModeAsync.mockReset();
    phone.setAudioModeAsync.mockImplementation(audioModeSet);
    phone.copyAsync.mockReset();
    phone.copyAsync.mockImplementation(copyFile);
    phone.deleteAsync.mockReset();
    phone.deleteAsync.mockImplementation(deleteFile);
    phone.getAllKeys.mockReset();
    phone.getAllKeys.mockImplementation(listKeys);
  },
};

/** For `jest.mock('expo-audio', …)`. */
export function standInExpoAudio() {
  return {
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: phone.requestRecordingPermissionsAsync,
    setAudioModeAsync: phone.setAudioModeAsync,
    useAudioRecorder: () => {
      const made = useRef<StandInRecorder | null>(null);
      if (!made.current) {
        made.current = makeRecorder(phone.recorders.length + 1);
        phone.recorders.push(made.current);
      }
      const recorder = made.current;
      // expo-audio: the recorder is released when its component goes, in an effect cleanup.
      useEffect(() => () => {
        if (!phone.recordersOutliveTheirScreen) recorder.release();
      }, [recorder]);
      return recorder;
    },
    useAudioRecorderState: (recorder: StandInRecorder) => useSyncExternalStore(recorder.subscribe, () => recorder.status),
    useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => undefined) }),
    useAudioPlayerStatus: () => ({ playing: false, didJustFinish: false, currentTime: 0, duration: 0 }),
  };
}

/** For `jest.mock('expo-file-system/legacy', …)`. */
export function standInFileSystem() {
  return {
    documentDirectory: 'file:///documents/',
    cacheDirectory: 'file:///cache/',
    getInfoAsync: jest.fn(async (uri: string) => ({ exists: phone.files.has(uri), size: phone.files.has(uri) ? 4096 : 0 })),
    makeDirectoryAsync: jest.fn(async () => undefined),
    copyAsync: phone.copyAsync,
    deleteAsync: phone.deleteAsync,
    readDirectoryAsync: jest.fn(async (uri: string) => {
      const names = [...phone.files].filter(file => file.startsWith(uri)).map(file => file.slice(uri.length));
      if (names.length === 0) throw new Error('Directory does not exist.');
      return names;
    }),
  };
}

/** For `jest.mock('@react-native-async-storage/async-storage', …)`. */
export function standInAsyncStorage() {
  return {
    getItem: jest.fn(async (key: string) => phone.storage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { phone.storage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { phone.storage.delete(key); }),
    getAllKeys: phone.getAllKeys,
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => phone.storage.delete(key)); }),
  };
}

export const KEPT_RECORDINGS_FOLDER = 'file:///documents/kept-recordings/';
/** The recordings kept on the phone, and their entries. */
export const keptFiles = () => [...phone.files].filter(file => file.startsWith(KEPT_RECORDINGS_FOLDER));
export const keptEntryKeys = () => [...phone.storage.keys()].filter(key => key.includes('/voice-recording/'));
/** The recorders' own files still in the phone's cache. */
export const cacheFiles = () => [...phone.files].filter(file => file.startsWith('file:///cache/'));

export type Hold = { reached: Promise<void>; release: () => void };
/** Every slow step a test made, so none is left waiting when the test ends. */
const holds: Hold[] = [];
/** The next call of `step` is slow: it waits until `release`, then does what it does. */
export function hold(step: jest.Mock, then: (...args: never[]) => unknown): Hold {
  let reachedNow: () => void = () => undefined;
  let release: () => void = () => undefined;
  const reached = new Promise<void>(resolve => { reachedNow = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  step.mockImplementationOnce(async (...args: never[]) => {
    reachedNow();
    await gate;
    return then(...args);
  });
  const made = { reached, release };
  holds.push(made);
  return made;
}
/** Nothing a test left waiting runs on into the next. */
export function releaseEveryHold() {
  holds.splice(0).forEach(made => made.release());
}
