import Ionicons from '@expo/vector-icons/Ionicons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { transcribeDAVECaptureMemoryAudio } from '../services/DAVEVoiceTranscriptionService';
import {
  daveVoiceFailureIsTheUpload,
  daveVoiceFailureIsWaitingForSignal,
  daveVoiceFailureMessage,
} from '../services/DAVEVoiceSignalWait';
import type * as KeptVoiceRecordingModule from '../services/KeptVoiceRecording';

/**
 * Loaded by a sheet that keeps recordings on the device (everyday item 4)
 * only when it needs to: a sheet without a keep slot needs no phone storage.
 */
function keptVoiceRecordings(): typeof KeptVoiceRecordingModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../services/KeptVoiceRecording') as typeof KeptVoiceRecordingModule;
}
import type { DAVEVoiceUnderstandingResponse } from '../services/DAVEVoiceUnderstanding';
import type { DAVEProjectWalkContext } from '../services/DAVEProjectWalk';
import {
  DAVE_MIN_RECORDING_DURATION_MS,
  daveRecordingIsLongEnough,
  preserveDAVERecordingDuration,
} from '../services/DAVEVoiceRecording';
import { colors, spacing } from '../theme';
import {
  DAVE_VOICE_CAPTURE_TABLET_MAX_WIDTH,
  daveVoiceCaptureUsesTabletSheet,
} from './dave-voice-capture-layout';
import {
  buildDAVEVoiceTaskPickerState,
  type DAVEVoiceTaskOption,
} from './dave-voice-task-options';
import { KeyboardAvoidingModalCard } from './KeyboardAvoidingModalCard';
import { NativeWorkspaceOwnerContext, useNativeWorkspaceSignInPendingRef } from './native-workspace-owner';

/**
 * Review N1 L3: when a recording brought back from the device (everyday item
 * 4) was dictated, and the saved project area the Project Walk had matched
 * then. Its words can arrive days later and somewhere else.
 */
export type DAVEVoiceKeptCapture = Readonly<{
  recordedAt: string;
  walkArea: DAVEProjectWalkContext['recommendedArea'];
}>;

/**
 * Review N2 follow-up (5 Oct 2026): one run of the recorder, from the tap on
 * Start Recording until its recording is in the sheet. `letGo` once the sheet
 * has let go of it: 'cancelled' by him (X, the system's back, Type Instead,
 * the task button), or 'closed' (its screen hid the sheet, or took it away).
 * A run that was let go never starts the microphone, and never hands the
 * sheet a recording.
 */
type RecorderRun = { letGo: 'cancelled' | 'closed' | null };

/** What a recording is kept on the device under: its account, the sheet that keeps it, and its project. */
type KeepsUnder = Readonly<{
  /** The signed-in account, also on a sheet that keeps nothing on the device (`owner` is null there). */
  account: string | null;
  owner: string | null;
  slot: string | undefined;
  projectId: string | null;
  projectName: string;
  walkArea: DAVEProjectWalkContext['recommendedArea'];
}>;

/** Whether a sheet is open for the account and the project a recording in it was made for (review P4 L4). */
function sameAccountAndProject(left: KeepsUnder, right: KeepsUnder): boolean {
  return left.account === right.account &&
    left.projectName.trim().toLowerCase() === right.projectName.trim().toLowerCase();
}

const MAX_RECORDING_SECONDS = 180;
// The last polled duration before the 3-minute limit can trail it by a poll or two.
// A recording that ends this close to the limit is treated as having reached it.
const RECORDING_LIMIT_TOLERANCE_MS = 2_000;
const INTERRUPTED_RECORDING_NOTICE =
  'Recording stopped when the phone was locked or a call came in. Replay it, then use it or record again.';
// The limit stopped a dictation with no word (whole-app audit A11 pass 4 L4).
const RECORDING_LIMIT_NOTICE = 'Stopped at the 3-minute limit. Anything after 3:00 was not recorded.';
const RECORDING_LIMIT_WARNING = 'Less than 15 seconds left. Recording stops at 3:00.';
const RECORDING_LIMIT_WARNING_MS = (MAX_RECORDING_SECONDS - 15) * 1_000;
const CLOSE_AND_KEEP = 'Close and Keep on This Device';

export function DAVEVoiceCaptureSheet({
  visible,
  projectId,
  projectName,
  contextLabel,
  candidateProjects = [],
  candidateTasks = [],
  selectedTaskId = null,
  walkContext,
  candidateLocations,
  title = 'Capture Memory',
  prompt = 'Record a project memory',
  guidance = 'Commitment, decision, issue, request, schedule change, or follow-up.',
  continueLabel = 'Review Memory',
  operationLabel,
  operationGuidance,
  captureLabel,
  transcriptionPurpose = 'memory',
  autoStartRecording = false,
  autoSubmitOnStop = false,
  showWalkContext = true,
  keepSlot,
  onMemoryReady,
  onProjectChange,
  onTaskChange,
  onOperation,
  onTypeInstead,
  onCancel,
}: {
  visible: boolean;
  projectId: string | null;
  projectName: string;
  contextLabel?: string;
  candidateProjects?: readonly string[];
  candidateTasks?: readonly DAVEVoiceTaskOption[];
  selectedTaskId?: string | null;
  walkContext?: DAVEProjectWalkContext;
  candidateLocations: readonly string[];
  title?: string;
  prompt?: string;
  guidance?: string;
  continueLabel?: string;
  operationLabel?: string;
  operationGuidance?: string;
  captureLabel?: string;
  transcriptionPurpose?: 'memory' | 'question';
  autoStartRecording?: boolean;
  autoSubmitOnStop?: boolean;
  showWalkContext?: boolean;
  /**
   * Everyday item 4 (2 Oct 2026): this sheet's name for a recording kept on
   * the device. With one, a finished recording (review N1 L2: from "Recording
   * ready" on, not only one waiting for signal) survives iOS closing the app,
   * for this account: the sheet offers it, and tries it again when he had
   * sent it, the next time it opens for that project.
   * Without one it is kept in the sheet only, while Vitruvius stays open.
   */
  keepSlot?: string;
  /** `kept` only for a recording brought back from the device after the app was closed (review N1 L3). */
  onMemoryReady: (result: DAVEVoiceUnderstandingResponse, kept?: DAVEVoiceKeptCapture) => void;
  onProjectChange?: (projectName: string) => void;
  onTaskChange?: (taskId: string | null) => void;
  onOperation?: () => void;
  onTypeInstead: () => void;
  onCancel: () => void;
}) {
  const { width } = useWindowDimensions();
  const usesTabletSheet = daveVoiceCaptureUsesTabletSheet(width);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const recordingActiveRef = useRef(false);
  // Review N2: from the tap on Start Recording until the recorder records (or cannot start).
  const recordingStartingRef = useRef(false);
  // Review N2 follow-up: the recorder's run under way.
  const recorderRunRef = useRef<RecorderRun | null>(null);
  const recordingDurationRef = useRef(0);
  const transcriptionOperationRef = useRef(0);
  const autoStartHandledRef = useRef(false);
  const recordingFinishingRef = useRef(false);
  const signInPendingRef = useNativeWorkspaceSignInPendingRef(); // A11 pass 4 L1
  // Whole-app audit A11 pass 4 M1: X while "Preparing…" asks first. "Keep
  // Recording for Later" stops waiting for the upload under way; its answer is
  // held for this recording only, and used by the next tap on continueLabel.
  const recordingGenerationRef = useRef(0);
  const preparingOperationRef = useRef<number | null>(null);
  const stoppedWaitingRef = useRef<{ operation: number; recording: number } | null>(null);
  const heldTranscriptRef = useRef<{ recording: number; result: DAVEVoiceUnderstandingResponse } | null>(null);
  // Everyday item 4: the account and sheet a recording is kept on this device for, and its kept copy.
  const ownerBoundary = useContext(NativeWorkspaceOwnerContext);
  const keptOwner = keepSlot && ownerBoundary !== undefined ? ownerBoundary ?? 'local-device' : null;
  const keepsOnDevice = Boolean(keptOwner && keepSlot);
  // Review N2 follow-up: the account, sheet and project a recording made now is kept under, and as the
  // sheet last showed them while it was open (its screen may clear the project as it hides the sheet).
  const keepsUnder: KeepsUnder = {
    account: ownerBoundary ?? null,
    owner: keptOwner,
    slot: keepSlot,
    projectId,
    projectName,
    walkArea: walkContext?.recommendedArea ?? null,
  };
  const openSheetKeepsUnderRef = useRef(keepsUnder);
  if (visible) openSheetKeepsUnderRef.current = keepsUnder;
  // Review P4 L4: what the sheet was open for when it was last hidden.
  const hiddenWhileOpenForRef = useRef<KeepsUnder | null>(null);
  const keptCopyRef = useRef<string | null>(null);
  // Review N1 M1: which recording a keep under way is for. Use, Discard and
  // Record Again move it on, so that keep is undone when it lands.
  const keepEpochRef = useRef(0);
  const keepQueueRef = useRef<Promise<boolean>>(Promise.resolve(false));
  // Review N1 L1: how far the kept recording had got ('ready', 'sent', 'no-signal'),
  // and whether this recording has been sent for its words at all.
  const keptStateRef = useRef<KeptVoiceRecordingModule.KeptVoiceRecordingState | null>(null);
  const sentForWordsRef = useRef(false);
  const [keptChecked, setKeptChecked] = useState(!keepsOnDevice);
  // Review N1 L3: when this recording was dictated and the walk's area then;
  // `restored` when it was brought back from the device.
  const captureRef = useRef<(DAVEVoiceKeptCapture & { restored: boolean }) | null>(null);
  const recordingUriRef = useRef<string | null>(null);
  recordingUriRef.current = recordingUri;

  useEffect(() => () => {
    // A closed/unmounted sheet or different project must not start an upload retry,
    // nor use a held transcript for another note.
    transcriptionOperationRef.current += 1;
    stoppedWaitingRef.current = null;
    heldTranscriptRef.current = null;
  }, [visible, projectId]);

  // The project changed while "Preparing…" (a walk's project record changed
  // underneath): that upload's words are dropped above, and the sheet stayed
  // on "Preparing…" with only Discard as a way out (whole-app audit A11 pass 5
  // L2). It stops waiting and keeps the recording ready to try again.
  const shownProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (shownProjectIdRef.current === projectId) return;
    shownProjectIdRef.current = projectId;
    if (!visible || preparingOperationRef.current === null) return;
    preparingOperationRef.current = null;
    setIsTranscribing(false);
    // A11 pass 7 L2: like "Stopped waiting", say it is kept only while Vitruvius stays open
    // (on this device past a closed app when this sheet keeps it, everyday item 4).
    if (keepsOnDevice && recordingUri) void keepRecordingOnDevice(recordingUri, recordingDuration, 'sent');
    setNotice(keepsOnDevice
      ? `The project changed while this recording was being prepared. It is kept on this device. Tap ${continueLabel} to try again.`
      : `The project changed while this recording was being prepared. It is kept here while Vitruvius stays open. Tap ${continueLabel} to try again.`);
    // Only a project change while the sheet is open does this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!visible) {
      autoStartHandledRef.current = false;
      return;
    }
    setError(null);
    setNotice(null);
    preparingOperationRef.current = null;
    setIsTranscribing(false);
    setTaskPickerOpen(false);
    setTaskSearch('');
    setShowCompletedTasks(false);
  }, [visible]);

  // Review N2 follow-up: the microphone is never left on behind a closed
  // sheet. Its screen hiding the sheet, or taking it away (an account or
  // screen change), lets go of the recorder as his own Cancel does. In the
  // same step as the sheet goes (a layout effect), so a start that answers
  // in that moment already finds itself let go.
  useLayoutEffect(() => {
    if (!visible) return undefined;
    return () => { void standRecorderDownBehindClosedSheet(); };
    // Only the sheet closing or going does this; it reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Review P4 L4 (5 Oct 2026): a recording ready in the sheet belongs to the
  // project and account it was recorded for. A sheet that was hidden without
  // his Cancel (a panel that failed to draw closes every sheet) still holds
  // its recording, and shown next for ANOTHER project it said "Recording
  // ready" there, and Continue sent it with that project's name and id. The
  // sheet now lets go of it as it is shown, in the same step (a layout
  // effect), so it is never on screen there and cannot be sent from there.
  // Shown again for its own project it is still in the sheet, as before.
  useLayoutEffect(() => {
    if (!visible) return undefined;
    const before = hiddenWhileOpenForRef.current;
    if (before && recordingUriRef.current && !sameAccountAndProject(before, openSheetKeepsUnderRef.current)) {
      letGoOfRecordingMadeFor(before);
    }
    return () => { hiddenWhileOpenForRef.current = openSheetKeepsUnderRef.current; };
    // Only the sheet being shown or hidden does this; it reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const selectedTask = candidateTasks.find(task => task.id === selectedTaskId) || null;
  const { completedCount, openCount, visibleTasks } = buildDAVEVoiceTaskPickerState({
    tasks: candidateTasks,
    search: taskSearch,
    showCompleted: showCompletedTasks,
    selectedTaskId,
  });

  useEffect(() => {
    if (recorderState.isRecording) {
      recordingDurationRef.current = preserveDAVERecordingDuration(
        recordingDurationRef.current,
        recorderState.durationMillis,
        recorder.currentTime * 1_000,
      );
      return;
    }
    if (!recordingActiveRef.current || !recorderState.url) return;
    // Claiming the recording here means the owner's Stop cannot also finish it.
    recordingActiveRef.current = false;
    void finishRecordingThatEndedOnItsOwn(
      recorderState.url,
      preserveDAVERecordingDuration(recordingDurationRef.current, recorderState.durationMillis),
    );
    // finishRecordingThatEndedOnItsOwn only reads refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, recorderState.durationMillis, recorderState.isRecording, recorderState.url]);

  // The recorder stops reporting isRecording without the owner pressing Stop in two
  // cases: the 3-minute limit (already stopped) or, on iOS, a phone lock, auto-lock or
  // call, which only PAUSES it. A paused m4a has no moov atom and cannot be
  // transcribed; only stop() finalizes it. So stop first and never resume.
  async function finishRecordingThatEndedOnItsOwn(statusUrl: string, duration: number) {
    const generation = transcriptionOperationRef.current;
    const run = recorderRunRef.current;
    recordingFinishingRef.current = true;
    // Its file is read before the stop, not after (review P4 L1, below): the recorder may have gone by then.
    const file = recorderFile() || statusUrl;
    let uri: string | null = file;
    try {
      await recorder.stop();
    } catch {
      uri = null;
    }
    const abandoned = generation !== transcriptionOperationRef.current;
    if (uri && !abandoned) {
      recordingDurationRef.current = duration;
      noteRecordingCaptured(uri, duration);
      setRecordingUri(uri);
      setRecordingDuration(duration);
    }
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      if (uri && !abandoned) setError('Recording ended, but audio settings could not be reset. Close and reopen Talk.');
    } finally {
      recordingFinishingRef.current = false;
    }
    if (abandoned) {
      // The sheet was closed or the recording discarded while it was finishing. Closed without his
      // Cancel, what he dictated is kept for next time, as below (review N2 follow-up); it was deleted.
      // One whose stop failed cannot be kept, and is not left in the phone's cache either (review P4 L1).
      if (uri && run?.letGo === 'closed') await keepStoppedRecordingForNextTime(uri, duration);
      else await removeRecording(file);
      return;
    }
    if (!uri) {
      setError('The recording stopped when the phone was locked or a call came in, and it could not be saved. Record again or type instead.');
      return;
    }
    setNotice(duration < MAX_RECORDING_SECONDS * 1_000 - RECORDING_LIMIT_TOLERANCE_MS
      ? INTERRUPTED_RECORDING_NOTICE
      : RECORDING_LIMIT_NOTICE);
  }

  /** The sheet lets go of the recorder's run under way; the first reason stands. */
  function letGoOfRecorderRun(reason: NonNullable<RecorderRun['letGo']>) {
    const run = recorderRunRef.current;
    if (run && !run.letGo) run.letGo = reason;
  }

  /** The file the recorder is writing, or null (also when the recorder has gone with the sheet). */
  function recorderFile(): string | null {
    try {
      return recorder.uri || recorder.getStatus().url || null;
    } catch {
      return null;
    }
  }

  /** Whether the recorder itself says it is recording now: asked directly, not as it last reported to the sheet. */
  function recorderIsRecording(): boolean {
    try {
      return Boolean(recorder.getStatus().isRecording);
    } catch {
      return false;
    }
  }

  /** The recorder is stopped and the microphone released; asking twice, or when it never started, is harmless. */
  async function standRecorderDown() {
    try {
      await recorder.stop();
    } catch {
      // Not recording, or gone with the sheet.
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  }

  /** How long the recorder itself says it has been recording, asked directly; 0 when it cannot say. */
  function recorderDuration(): number {
    try {
      return preserveDAVERecordingDuration(recorder.getStatus().durationMillis, recorder.currentTime * 1_000);
    } catch {
      return 0;
    }
  }

  /**
   * The sheet closed without his Cancel (review N2 follow-up). A start under
   * way ends when it next looks (startRecording), and a stop under way keeps
   * its recording off the closed sheet (stopRecording). A recording still
   * going is stopped here, at once: it went on to the 3-minute limit behind
   * the closed sheet. What he had dictated by then is kept on the device for
   * next time, as a recording he had stopped is: he did not discard it, and
   * nothing he did not ask for throws it away. Never when the run was his
   * Cancel's, and never from a recorder that would not stop when asked: only
   * a stop finishes its file.
   *
   * Review P4 L1 (5 Oct 2026): the recorder's file is read BEFORE it is asked
   * to stop. When the sheet's screen is taken away (the app rebuilt for
   * another account, a panel that failed to draw) expo-audio releases the
   * recorder with it, and a recorder that has gone answers nothing: read
   * after the stop, there was no file to keep, so what he had dictated was
   * not kept and its file stayed in the phone's cache, never offered. A
   * recording that cannot be kept (the stop was refused) is deleted from the
   * cache by the same address. Stop and a lock or the limit read it first too.
   */
  async function standRecorderDownBehindClosedSheet() {
    letGoOfRecorderRun('closed');
    // A stop under way finishes by itself (stopRecording, or a recording that a lock or the limit ended).
    if (recordingFinishingRef.current) return;
    // Going by the sheet's own count, or by the recorder's: a stop that failed leaves it running uncounted.
    if (!recordingActiveRef.current && !recorderIsRecording()) return;
    // Claimed, so a lock or the limit cannot also finish and offer it.
    recordingActiveRef.current = false;
    recordingFinishingRef.current = true;
    // Read now, before the recorder stops: how much he had dictated, its file, and what the sheet was
    // open for (it may be showing another project by the time the recorder has stopped).
    const duration = preserveDAVERecordingDuration(recordingDurationRef.current, recorderDuration());
    const uri = recorderFile();
    const under = openSheetKeepsUnderRef.current;
    const cancelled = recorderRunRef.current?.letGo === 'cancelled';
    let stopped = true;
    try {
      await recorder.stop();
    } catch {
      stopped = false;
    }
    // Asked again when it would not stop; the microphone is released either way.
    if (stopped) await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    else await standRecorderDown();
    if (stopped && !cancelled) await keepStoppedRecordingForNextTime(uri, duration, under);
    else await removeRecording(uri);
    recordingFinishingRef.current = false;
  }

  async function startRecording() {
    // A second tap while the recorder is still starting is not a second start (review N2).
    if (isTranscribing || recorderState.isRecording || recordingFinishingRef.current || recordingStartingRef.current) return;
    recordingStartingRef.current = true;
    const run: RecorderRun = { letGo: null };
    recorderRunRef.current = run;
    recordingGenerationRef.current += 1;
    setError(null);
    setNotice(null);
    await removeRecording(recordingUri);
    forgetRecordingKeptOnDevice();
    captureRef.current = null;
    setRecordingUri(null);
    setRecordingDuration(0);
    recordingDurationRef.current = 0;

    // Review N2 follow-up: X, the system's back or Type Instead in the moment
    // before the recorder had started closed the sheet, and the recorder then
    // started anyway: the microphone went on recording behind the closed
    // sheet. Each step now looks first. A start the sheet has let go of, or
    // that would begin with Vitruvius no longer in front, never reaches
    // record(); what it had already taken (the audio mode, the recorder's
    // file) is put back before another start can begin.
    const closed = () => run.letGo !== null;
    const mustNotStart = () => closed() || AppState.currentState === 'background';
    let microphoneRefused = false;
    let recorderTaken = false;
    let started = false;
    try {
      const permission = closed() ? null : await requestRecordingPermissionsAsync();
      microphoneRefused = permission !== null && !permission.granted;
      if (permission?.granted && !mustNotStart()) {
        recorderTaken = true;
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (!mustNotStart()) await recorder.prepareToRecordAsync();
        if (!mustNotStart()) {
          recordingActiveRef.current = true;
          recorder.record({ forDuration: MAX_RECORDING_SECONDS });
          started = true;
        }
      }
    } catch {
      recordingActiveRef.current = false;
    }
    try {
      if (started) return;
      if (recorderTaken && mustNotStart()) {
        await standRecorderDown();
        await removeRecording(recorderFile());
      }
      // A closed sheet is told nothing.
      if (closed()) return;
      setError(microphoneRefused
        ? 'Microphone access is off. Enable it in Settings or type the memory instead.'
        : 'Recording could not start. Try again or type the memory instead.');
    } finally {
      // Recording now (recordingActiveRef), or it could not start.
      recordingStartingRef.current = false;
    }
  }

  useEffect(() => {
    if (!visible || !projectName || !autoStartRecording || autoStartHandledRef.current || !keptChecked) return;
    const timeout = setTimeout(() => {
      autoStartHandledRef.current = true;
      // A recording kept from before the app closed is offered instead (everyday item 4).
      if (recordingUriRef.current) return;
      void startRecording();
    }, 250);
    return () => clearTimeout(timeout);
    // Guided capture intentionally starts once when a new field sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartRecording, projectName, visible, keptChecked]);

  // Everyday item 4: a recording kept on this device for this account and
  // sheet comes back when the sheet opens for its project, and is tried again.
  // One kept for another project stays kept, for when the sheet opens for
  // that project; a sheet already holding a recording leaves it kept too
  // (review N1 M1).
  // Review N2 (5 Oct 2026): so does a sheet whose recorder is still starting
  // or stopping when the check answers. The check looked only at "recording
  // now", which is set after microphone permission and the recorder's own
  // start: with Start Recording tapped first on slow phone storage, the kept
  // recording came back under the new one, the new one was taken for
  // already kept, and using it removed the kept one, never used. A kept
  // recording is only ever removed with itself, whichever answers first.
  useEffect(() => {
    if (!visible || !keptOwner || !keepSlot) {
      setKeptChecked(!visible || !keepsOnDevice);
      return undefined;
    }
    let current = true;
    setKeptChecked(false);
    void keptVoiceRecordings().readKeptVoiceRecording(keptOwner, keepSlot, projectName).catch(() => null).then(kept => {
      if (!current) return;
      setKeptChecked(true);
      if (!kept || recordingUriRef.current || recordingStartingRef.current || recordingActiveRef.current ||
        recordingFinishingRef.current) return;
      if (kept.projectName.trim().toLowerCase() !== projectName.trim().toLowerCase()) return;
      keptCopyRef.current = kept.uri;
      keptStateRef.current = kept.state;
      sentForWordsRef.current = kept.state !== 'ready';
      captureRef.current = { recordedAt: kept.recordedAt, walkArea: kept.walkArea, restored: true };
      recordingGenerationRef.current += 1;
      recordingDurationRef.current = kept.durationMs;
      setRecordingUri(kept.uri);
      setRecordingDuration(kept.durationMs);
      if (kept.state === 'ready') {
        // Closed and kept before he had sent it for its words: offered, and left for him to use (review N1 L1).
        setNotice(`Kept from ${keptTimeLabel(kept.recordedAt)}. Replay it, then tap ${continueLabel} to use it, or record again.`);
        return;
      }
      void transcribeRecording(kept.uri, kept.durationMs);
      setNotice(kept.state === 'no-signal'
        ? `Kept from ${keptTimeLabel(kept.recordedAt)}, when there was no signal. Trying it again now.`
        : `Kept from ${keptTimeLabel(kept.recordedAt)}. Trying it again now.`);
    });
    return () => {
      current = false;
    };
    // Read once each time the sheet opens, for its account, sheet and project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, keptOwner, keepSlot, projectName]);

  /**
   * A recording just finished: when, and the walk's matched area then (review
   * N1 L3). A sheet that keeps recordings keeps it on the device from here on
   * (review N1 L2): it was kept only once an upload had failed for want of
   * signal, so the app closed at "Recording ready" (or after a lock or call
   * stopped it), during the first "Preparing…", or after "The voice upload
   * was interrupted" lost the dictation.
   */
  function noteRecordingCaptured(uri: string, duration: number) {
    captureRef.current = { recordedAt: new Date().toISOString(), walkArea: walkContext?.recommendedArea ?? null, restored: false };
    if (keepsOnDevice && daveRecordingIsLongEnough(duration)) void keepRecordingOnDevice(uri, duration, 'ready');
  }

  /**
   * Hands the recording's words on. One brought back from the device says
   * when and where it was dictated: the Project Walk stamped such a memory
   * with the time its words arrived and the area he was standing in then,
   * as "during capture" (review N1 L3).
   */
  function handOverWords(result: DAVEVoiceUnderstandingResponse) {
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture?.restored) onMemoryReady(result, { recordedAt: capture.recordedAt, walkArea: capture.walkArea });
    else onMemoryReady(result);
  }

  /**
   * Keeps this recording on the device past a closed app (everyday item 4);
   * the sheet keeps using its own copy. Answers whether it is kept: what the
   * sheet then says is only what happened (review N1 L4).
   */
  function keepRecordingOnDevice(
    uri: string,
    duration: number,
    state: KeptVoiceRecordingModule.KeptVoiceRecordingState,
  ): Promise<boolean> {
    if (!keptOwner || !keepSlot) return Promise.resolve(false);
    const owner = keptOwner;
    const slot = keepSlot;
    const epoch = keepEpochRef.current;
    // One keep at a time for one recording: a second copy would stay kept
    // after the first was used. A later keep finds the copy and only says
    // how far the recording has got since (review N1 L1).
    const keep = keepQueueRef.current.then(async () => {
      if (epoch !== keepEpochRef.current) return false;
      // Kept, and at least as far on as this says: one waiting for signal that is sent again
      // is still that, and one that was sent is never put back to "ready".
      const held = keptStateRef.current;
      if (keptCopyRef.current && (held === state || state === 'ready' || (state === 'sent' && held === 'no-signal'))) return true;
      try {
        const { forgetKeptVoiceRecording, keepVoiceRecording } = keptVoiceRecordings();
        // Where the walk had him when he finished speaking; when that was not known yet, where it has him now.
        const capture = captureRef.current;
        const kept = await keepVoiceRecording(owner, slot, {
          uri: keptCopyRef.current ?? uri,
          durationMs: duration,
          projectId,
          projectName,
          recordedAt: capture?.recordedAt,
          walkArea: capture?.restored ? capture.walkArea : capture?.walkArea ?? walkContext?.recommendedArea ?? null,
          state,
        });
        // Discarded, used or recorded again meanwhile: this copy does not stay kept.
        if (epoch !== keepEpochRef.current) {
          await forgetKeptVoiceRecording(owner, slot, kept);
          return false;
        }
        keptCopyRef.current = kept;
        keptStateRef.current = state;
        return true;
      } catch {
        // Not kept: in this sheet only, as before. One already kept stays kept as it was.
        return epoch === keepEpochRef.current && keptCopyRef.current !== null;
      }
    });
    keepQueueRef.current = keep;
    return keep;
  }

  /**
   * THIS recording was used, discarded or recorded again: its copy on the
   * device and its entry go. Only the recording this sheet holds: with none
   * (the sheet opened for another project, or Start Recording before the
   * kept check answered) it removed the sheet's kept recording unseen, its
   * audio left behind and never offered again (review N1 M1).
   */
  function forgetRecordingKeptOnDevice() {
    keepEpochRef.current += 1;
    const kept = keptCopyRef.current;
    keptCopyRef.current = null;
    keptStateRef.current = null;
    sentForWordsRef.current = false;
    if (!kept || !keptOwner || !keepSlot) return;
    void keptVoiceRecordings().forgetKeptVoiceRecording(keptOwner, keepSlot, kept);
  }

  /**
   * A recording he had stopped, or was still making, when the sheet closed
   * without his Cancel (review N2 follow-up): a recording he did not
   * discard, so a sheet that keeps recordings keeps it on the device (review
   * N1 L2), for the next time it opens for this project. By the service
   * itself: the closed sheet holds nothing of it. Kept once, under the
   * account and project the sheet was open for, so it is offered to no other
   * account and for no other project. A sheet that keeps nothing on the
   * device has nowhere to keep it, and it goes; so does one too short to use.
   */
  async function keepStoppedRecordingForNextTime(
    uri: string | null | undefined,
    duration: number,
    under: KeepsUnder = keepsUnder,
  ) {
    if (uri && under.owner && under.slot && daveRecordingIsLongEnough(duration)) {
      await keptVoiceRecordings().keepVoiceRecording(under.owner, under.slot, {
        uri,
        durationMs: duration,
        projectId: under.projectId,
        projectName: under.projectName,
        walkArea: under.walkArea,
        state: 'ready',
      }).catch(() => undefined);
    }
    await removeRecording(uri ?? null);
  }

  /**
   * The sheet is shown for another project or account than the recording in
   * it was made for (review P4 L4): the sheet lets go of it, at once. It is
   * not lost. A sheet that keeps recordings has it on the device already,
   * under its own account and project (review N1 L2), and that copy and its
   * entry stay, for the next time the sheet opens for that project; only
   * the recorder's own file in the cache goes. One not kept yet (the keep
   * was still under way, or had failed) is kept now, by the service itself
   * and under what it was made for, as a recording stopped behind a closed
   * sheet is. A sheet that keeps nothing on the device has nowhere to keep
   * it, and it goes; so does one too short to use.
   */
  function letGoOfRecordingMadeFor(madeFor: KeepsUnder) {
    const uri = recordingUriRef.current;
    const duration = recordingDuration;
    // A keep still under way undoes itself when it lands: the sheet has let go.
    const copy = letGoOfKeptCopy();
    setRecordingUri(null);
    setRecordingDuration(0);
    if (!copy) void keepStoppedRecordingForNextTime(uri, duration, madeFor);
    else if (uri !== copy) void removeRecording(uri);
  }

  async function stopRecording() {
    // A lock or call may already have claimed and be finishing this recording.
    if (!recorderState.isRecording || !recordingActiveRef.current) return;
    const stoppedDuration = preserveDAVERecordingDuration(
      recordingDurationRef.current,
      recorderState.durationMillis,
      recorder.currentTime * 1_000,
    );
    const run = recorderRunRef.current;
    recordingActiveRef.current = false;
    // Finishing until it is in the sheet, as one that ends on its own is: the kept check
    // and Start Recording leave a recorder that is still stopping alone (review N2).
    recordingFinishingRef.current = true;
    // Read before the stop: the recorder may have gone with its screen by the time it answers (review P4 L1).
    const uri = recorderFile();
    try {
      await recorder.stop();
      if (run?.letGo) {
        // Review N2 follow-up: the sheet let go of this recording while it was stopping, and a
        // closed sheet is handed nothing. It had been put into the closed sheet, its file
        // already deleted by his Cancel. X is Cancel (as are the system's back, Type Instead
        // and the task button): the recording he was stopping is discarded, as X while
        // listening discards. "Close and Keep on This Device" is the control that keeps, once
        // a recording is ready. Closed without his Cancel, a recording he had stopped is kept.
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
        if (run.letGo === 'closed') await keepStoppedRecordingForNextTime(uri, stoppedDuration);
        else await removeRecording(uri ?? null);
        recordingFinishingRef.current = false;
        return;
      }
      if (!uri) throw new Error('Recording file missing.');
      recordingDurationRef.current = stoppedDuration;
      noteRecordingCaptured(uri, stoppedDuration);
      setRecordingUri(uri);
      setRecordingDuration(stoppedDuration);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      recordingFinishingRef.current = false;
      // A sheet that has let go since does not send it for its words either.
      if (autoSubmitOnStop && !run?.letGo) await transcribeRecording(uri, stoppedDuration);
    } catch {
      recordingActiveRef.current = false;
      // A stop that failed after the sheet had let go of the recorder is asked again, and the
      // microphone released: behind a closed sheet nothing else would stop it (review N2 follow-up).
      if (run?.letGo) {
        await standRecorderDown();
        await removeRecording(uri);
      }
      recordingFinishingRef.current = false;
      setError('The recording could not finish. Try again.');
    }
  }

  async function transcribeRecording(uri: string, duration: number) {
    if (isTranscribing) return;
    if (!daveRecordingIsLongEnough(duration)) {
      setError(`The recording is too short. Speak for at least ${DAVE_MIN_RECORDING_DURATION_MS / 1_000} second, then try again.`);
      return;
    }
    const recording = recordingGenerationRef.current;
    const held = heldTranscriptRef.current;
    heldTranscriptRef.current = null;
    if (held?.recording === recording) {
      // The words for this recording arrived after he stopped waiting for them.
      setError(null);
      setNotice(null);
      await removeRecording(uri);
      forgetRecordingKeptOnDevice();
      setRecordingUri(null);
      handOverWords(held.result);
      return;
    }
    const operation = ++transcriptionOperationRef.current;
    preparingOperationRef.current = operation;
    sentForWordsRef.current = true;
    // Sent for its words: brought back after a closed app, it is tried again by itself (review N1 L2).
    if (keepsOnDevice) void keepRecordingOnDevice(uri, duration, 'sent');
    setError(null);
    setNotice(null);
    setIsTranscribing(true);
    try {
      const result = await transcribeDAVECaptureMemoryAudio({
        uri,
        projectId,
        projectName,
        candidateLocations,
        purpose: transcriptionPurpose,
        isRequestCurrent: () => operation === transcriptionOperationRef.current,
        signInPending: () => signInPendingRef.current,
      });
      if (operation !== transcriptionOperationRef.current) {
        const stopped = stoppedWaitingRef.current;
        if (stopped?.operation === operation && stopped.recording === recordingGenerationRef.current) {
          heldTranscriptRef.current = { recording: stopped.recording, result };
        }
        return;
      }
      await removeRecording(uri);
      forgetRecordingKeptOnDevice();
      setRecordingUri(null);
      handOverWords(result);
    } catch (reason) {
      if (operation !== transcriptionOperationRef.current) return;
      // Kept on this device past a closed app when this sheet keeps it (everyday item 4), whatever
      // the failure (review N1 L2). The message says so once it is, for the upload's own failures
      // (review N1 L4); a recording that could not be kept is not called kept.
      const kept = keepsOnDevice &&
        await keepRecordingOnDevice(uri, duration, daveVoiceFailureIsWaitingForSignal(reason) ? 'no-signal' : 'sent');
      if (operation !== transcriptionOperationRef.current) return;
      setError(daveVoiceFailureMessage(reason, continueLabel, kept && daveVoiceFailureIsTheUpload(reason)));
    } finally {
      if (operation === transcriptionOperationRef.current) {
        preparingOperationRef.current = null;
        setIsTranscribing(false);
      }
    }
  }

  // "Keep Recording for Later": stop waiting, keep the audio, back to "Recording ready".
  // An upload already dropped (a project change) holds no words, but still
  // ends the wait: it used to do nothing (whole-app audit A11 pass 5 L2).
  function stopWaitingKeepRecording() {
    const operation = preparingOperationRef.current;
    if (operation !== null && operation === transcriptionOperationRef.current) {
      stoppedWaitingRef.current = { operation, recording: recordingGenerationRef.current };
      transcriptionOperationRef.current += 1;
    }
    preparingOperationRef.current = null;
    setIsTranscribing(false);
    // Kept in this sheet only, while the app stays open (A11 pass 6 L2); on this device when this sheet keeps it (everyday item 4).
    if (keepsOnDevice && recordingUri) void keepRecordingOnDevice(recordingUri, recordingDuration, 'sent');
    setNotice(keepsOnDevice
      ? `Stopped waiting. The recording is kept on this device. Tap ${continueLabel} to try again.`
      : `Stopped waiting. The recording is kept here while Vitruvius stays open. Tap ${continueLabel} to try again.`);
  }

  async function transcribe() {
    if (!recordingUri) return;
    await transcribeRecording(recordingUri, recordingDuration);
  }

  // A finished recording that has not been used (for example after an offline
  // transcription failure) is only deleted once the owner confirms, and so is one
  // still being prepared (A11 pass 4 M1). While listening, or with nothing
  // recorded, leaving discards at once as before.
  // On a sheet that keeps recordings on the device there was still no way to
  // close it and keep one: the question offered Keep (stay) or Discard only.
  // "Close and Keep on This Device" closes it and leaves the recording kept,
  // offered the next time the sheet opens for this project (review N1 L1).
  function confirmDiscardThen(leave: () => Promise<void>, exit: () => void) {
    if (isTranscribing) {
      Alert.alert(
        'Stop preparing this recording?',
        keepsOnDevice
          ? `It is still being turned into text. You can keep waiting, keep the recording on this device and try ${continueLabel} again later, or discard it.`
          : `It is still being turned into text. You can keep waiting, keep the recording here while Vitruvius stays open and try ${continueLabel} again later, or discard it.`,
        [
          { text: 'Keep Waiting', style: 'cancel' },
          { text: 'Keep Recording for Later', onPress: stopWaitingKeepRecording },
          { text: 'Discard', style: 'destructive', onPress: () => { void leave(); } },
        ],
      );
      return;
    }
    if (!recordingUri || recorderState.isRecording) {
      void leave();
      return;
    }
    if (keepsOnDevice) {
      Alert.alert(
        'Discard this recording?',
        'It has not been used yet. Discarding deletes it from this device. ' +
          `Close and Keep on This Device closes this and keeps it for the next time you open this${projectName ? ` for ${projectName}` : ''}.`,
        [
          { text: 'Keep', style: 'cancel' },
          { text: CLOSE_AND_KEEP, onPress: () => { void closeKeepingRecording(exit); } },
          { text: 'Discard', style: 'destructive', onPress: () => { void leave(); } },
        ],
      );
      return;
    }
    Alert.alert(
      'Discard this recording?',
      'It has not been used yet. Discarding deletes it from this device.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { void leave(); } },
      ],
    );
  }

  /** The sheet lets go of its recording's kept copy without forgetting it: no keep still to come for it, and the copy stays. */
  function letGoOfKeptCopy(): string | null {
    keepEpochRef.current += 1;
    const copy = keptCopyRef.current;
    keptCopyRef.current = null;
    keptStateRef.current = null;
    sentForWordsRef.current = false;
    captureRef.current = null;
    return copy;
  }

  /** "Close and Keep on This Device": the sheet closes and lets go of the recording; its kept copy and entry stay. */
  async function closeKeepingRecording(exit: () => void) {
    const uri = recordingUri;
    if (!uri) return;
    const kept = await keepRecordingOnDevice(uri, recordingDuration, sentForWordsRef.current ? 'sent' : 'ready');
    if (!kept) {
      // Still here, so nothing is lost: he can use it, try again, or discard it.
      setError('The recording could not be kept on this device, so this stays open. Use it now, or discard it.');
      return;
    }
    transcriptionOperationRef.current += 1;
    recordingGenerationRef.current += 1;
    preparingOperationRef.current = null;
    stoppedWaitingRef.current = null;
    heldTranscriptRef.current = null;
    setIsTranscribing(false);
    // Let go of, not forgotten.
    const copy = letGoOfKeptCopy();
    // The recorder's own file in the cache goes; the kept copy is the one that stays.
    if (uri !== copy) await removeRecording(uri);
    setRecordingUri(null);
    setNotice(null);
    setError(null);
    recordingDurationRef.current = 0;
    exit();
  }

  async function discardRecording() {
    transcriptionOperationRef.current += 1;
    recordingGenerationRef.current += 1;
    preparingOperationRef.current = null;
    stoppedWaitingRef.current = null;
    heldTranscriptRef.current = null;
    setIsTranscribing(false);
    // He cancelled: a recorder that is still starting does not go on to record (review N2 follow-up).
    letGoOfRecorderRun('cancelled');
    // Claim the recording first so a lock or call cannot also finish and offer it.
    // Stopped whenever record() was reached: the recorder reports "recording" a moment later,
    // and until it did, a Cancel left it running behind the closed sheet.
    const recording = recordingActiveRef.current || recorderState.isRecording;
    recordingActiveRef.current = false;
    // The recorder's file, read before the stop: the recorder may have gone with its screen by the
    // time it answers, and the file he discarded stayed in the phone's cache (review P4 L1).
    const file = recordingUri || recorderFile();
    if (recording) await recorder.stop().catch(() => undefined);
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    await removeRecording(file);
    forgetRecordingKeptOnDevice();
    captureRef.current = null;
    setRecordingUri(null);
    setNotice(null);
    recordingDurationRef.current = 0;
  }

  async function cancel() {
    await discardRecording();
    onCancel();
  }

  async function typeInstead() {
    await discardRecording();
    onTypeInstead();
  }

  async function openOperation() {
    if (!onOperation) return;
    await discardRecording();
    onOperation();
  }

  const elapsed = recorderState.isRecording ? recorderState.durationMillis : recordingDuration;
  const captureState = isTranscribing
    ? 'processing'
    : recorderState.isRecording
      ? 'listening'
      : recordingUri
        ? 'captured'
        : 'ready';
  const captureStatus = captureLabel
    ? captureState === 'processing'
      ? `ECOS is processing: ${captureLabel}`
      : captureState === 'listening'
        ? `ECOS is listening for: ${captureLabel}`
        : captureState === 'captured'
          ? `Answer recorded for: ${captureLabel}`
          : `ECOS is ready for: ${captureLabel}`
    : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => confirmDiscardThen(cancel, onCancel)}>
      <View style={[styles.backdrop, usesTabletSheet && styles.backdropTablet]}>
        <KeyboardAvoidingModalCard
          containerStyle={[
            styles.sheetContainer,
            usesTabletSheet && styles.sheetContainerTablet,
          ]}
          frameStyle={[styles.sheet, usesTabletSheet && styles.sheetTablet]}
          contentContainerStyle={[
            styles.content,
            usesTabletSheet && styles.contentTablet,
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.main}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{contextLabel || projectName || 'Choose a project'}</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={() => confirmDiscardThen(cancel, onCancel)} accessibilityLabel="Cancel memory capture">
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          {!projectName && candidateProjects.length > 0 ? (
            <View style={styles.projectChoiceCard}>
              <Text style={styles.projectChoiceTitle}>Which project is this about?</Text>
              <View style={styles.projectChoices}>
                {candidateProjects.map(candidate => (
                  <TouchableOpacity
                    key={candidate}
                    style={styles.projectChoiceButton}
                    onPress={() => onProjectChange?.(candidate)}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${candidate} for Talk`}
                  >
                    <Ionicons name="folder-outline" size={18} color={colors.primary} />
                    <Text style={styles.projectChoiceText}>{candidate}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}

          {onOperation && operationLabel ? (
            <TouchableOpacity
              style={[styles.operationCard, !projectName && styles.buttonDisabled]}
              onPress={() => confirmDiscardThen(openOperation, () => { onOperation?.(); })}
              accessibilityRole="button"
              accessibilityLabel={operationLabel}
              disabled={!projectName}
            >
              <View style={styles.operationIcon}>
                <Ionicons name="list-outline" size={21} color={colors.primary} />
              </View>
              <View style={styles.main}>
                <Text style={styles.operationLabel}>{operationLabel}</Text>
                {operationGuidance ? <Text style={styles.operationGuidance}>{operationGuidance}</Text> : null}
              </View>
              <Ionicons name="chevron-forward-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          ) : null}

          {projectName && candidateTasks.length > 0 ? (
            <View style={styles.taskContextCard}>
              <TouchableOpacity
                style={styles.taskContextHeader}
                onPress={() => setTaskPickerOpen(open => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: taskPickerOpen }}
              >
                <View style={styles.main}>
                  <Text style={styles.taskContextLabel}>Specific task (optional)</Text>
                  <Text style={styles.taskContextValue} numberOfLines={2}>
                    {selectedTask?.taskName || 'General project conversation'}
                  </Text>
                </View>
                <Ionicons
                  name={taskPickerOpen ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.primary}
                />
              </TouchableOpacity>

              {taskPickerOpen ? (
                <View style={styles.taskPicker}>
                  <TextInput
                    style={styles.taskSearch}
                    value={taskSearch}
                    onChangeText={setTaskSearch}
                    placeholder="Search tasks"
                    placeholderTextColor={colors.mutedText}
                    autoCorrect={false}
                  />
                  <View style={styles.taskFilterRow}>
                    <Text style={styles.taskFilterSummary}>
                      {openCount} open {openCount === 1 ? 'task' : 'tasks'}
                    </Text>
                    {completedCount > 0 ? (
                      <TouchableOpacity
                        style={styles.completedTasksButton}
                        onPress={() => setShowCompletedTasks(value => !value)}
                        accessibilityRole="button"
                        accessibilityLabel={`${showCompletedTasks ? 'Hide' : 'Show'} ${completedCount} completed ${completedCount === 1 ? 'task' : 'tasks'}`}
                        accessibilityState={{ expanded: showCompletedTasks }}
                      >
                        <Text style={styles.completedTasksButtonText}>
                          {showCompletedTasks ? 'Hide' : 'Show'} completed ({completedCount})
                        </Text>
                        <Ionicons
                          name={showCompletedTasks ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color={colors.primary}
                        />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={[styles.taskOption, !selectedTaskId && styles.taskOptionSelected]}
                    onPress={() => {
                      onTaskChange?.(null);
                      setTaskPickerOpen(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: !selectedTaskId }}
                  >
                    <Ionicons name={!selectedTaskId ? 'radio-button-on' : 'radio-button-off'} size={21} color={colors.primary} />
                    <Text style={styles.taskOptionName}>General project conversation</Text>
                  </TouchableOpacity>
                  {visibleTasks.map(task => {
                    const selected = task.id === selectedTaskId;
                    return (
                      <TouchableOpacity
                        key={task.id}
                        style={[styles.taskOption, selected && styles.taskOptionSelected]}
                        onPress={() => {
                          onTaskChange?.(task.id);
                          setTaskPickerOpen(false);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                      >
                        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={21} color={colors.primary} />
                        <View style={styles.main}>
                          <Text style={styles.taskOptionName}>{task.taskName}</Text>
                          <Text style={styles.taskOptionDetail}>{task.detail}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {visibleTasks.length === 0 ? (
                    <Text style={styles.taskEmpty}>
                      {taskSearch.trim()
                        ? 'No matching tasks.'
                        : 'No open tasks. Show completed tasks to choose finished work.'}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {captureStatus ? (
            <View
              style={[
                styles.captureStatus,
                captureState === 'listening' && styles.captureStatusListening,
                captureState === 'processing' && styles.captureStatusProcessing,
                captureState === 'captured' && styles.captureStatusCaptured,
              ]}
              accessibilityLiveRegion="polite"
              accessible
              accessibilityLabel={captureStatus}
            >
              <Ionicons
                name={captureState === 'processing'
                  ? 'hourglass-outline'
                  : captureState === 'captured'
                    ? 'checkmark-circle-outline'
                    : 'mic-outline'}
                size={21}
                color={captureState === 'listening'
                  ? colors.danger
                  : captureState === 'processing'
                    ? colors.warning
                    : captureState === 'captured'
                      ? colors.success
                      : colors.primary}
              />
              <Text style={[
                styles.captureStatusText,
                captureState === 'listening' && styles.captureStatusTextListening,
                captureState === 'processing' && styles.captureStatusTextProcessing,
                captureState === 'captured' && styles.captureStatusTextCaptured,
              ]}>
                {captureStatus}
              </Text>
            </View>
          ) : null}

          <Text style={styles.prompt}>{recorderState.isRecording ? 'Listening…' : recordingUri ? 'Recording ready' : prompt}</Text>
          <Text style={styles.guidance}>{guidance}</Text>

          {showWalkContext && walkContext ? <View style={styles.walkCard}>
            <View style={styles.walkHeader}>
              <Ionicons name="footsteps-outline" size={18} color={colors.primary} />
              <Text style={styles.walkTitle}>Project Walk</Text>
            </View>
            <Text style={styles.walkLocation}>{walkContext.locationMessage}</Text>
            <Text style={styles.walkPrompt}>{walkContext.prompt.guidance}</Text>
            <Text style={styles.walkWhy}>Why: {walkContext.prompt.whyItMatters}</Text>
          </View> : null}

          <View style={[styles.recorderCard, recorderState.isRecording && styles.recorderCardActive]}>
            <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
            <Text style={styles.recordingLimit}>Up to 3 minutes</Text>
            {recorderState.isRecording && recorderState.durationMillis >= RECORDING_LIMIT_WARNING_MS ? (
              <Text style={styles.limitWarning} accessibilityLiveRegion="polite">{RECORDING_LIMIT_WARNING}</Text>
            ) : null}
            {recordingUri && !recorderState.isRecording ? <DAVERecordingPlayback uri={recordingUri} /> : null}
          </View>

          {notice && !error ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {recorderState.isRecording ? (
            <TouchableOpacity style={styles.stopButton} onPress={() => { void stopRecording(); }} accessibilityRole="button">
              <Ionicons name="stop" size={21} color="#FFF" />
              <Text style={styles.primaryText}>{autoSubmitOnStop ? 'Stop & Continue' : 'Stop Recording'}</Text>
            </TouchableOpacity>
          ) : recordingUri ? (
            <>
              <TouchableOpacity style={styles.continueButton} disabled={isTranscribing} onPress={() => { void transcribe(); }} accessibilityRole="button">
                <Ionicons name="sparkles-outline" size={20} color="#FFF" />
                <Text style={styles.primaryText}>{isTranscribing ? 'Preparing…' : continueLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} disabled={isTranscribing} onPress={() => { void startRecording(); }} accessibilityRole="button">
                <Ionicons name="refresh" size={19} color={colors.primary} />
                <Text style={styles.secondaryText}>Record Again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.recordButton, !projectName && styles.buttonDisabled]}
              onPress={() => { void startRecording(); }}
              accessibilityRole="button"
              disabled={!projectName}
            >
              <Ionicons name="mic" size={23} color="#FFF" />
              <Text style={styles.primaryText}>Start Recording</Text>
            </TouchableOpacity>
          )}

          {!recorderState.isRecording ? (
            <TouchableOpacity style={styles.typeButton} disabled={isTranscribing || !projectName} onPress={() => confirmDiscardThen(typeInstead, onTypeInstead)} accessibilityRole="button">
              <Text style={styles.typeText}>Type Instead</Text>
            </TouchableOpacity>
          ) : null}
        </KeyboardAvoidingModalCard>
      </View>
    </Modal>
  );
}

function DAVERecordingPlayback({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  async function togglePlayback() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || status.currentTime >= status.duration) await player.seekTo(0);
    player.play();
  }

  return (
    <TouchableOpacity style={styles.playbackButton} onPress={() => { void togglePlayback(); }} accessibilityRole="button">
      <Ionicons name={status.playing ? 'pause' : 'play'} size={20} color={colors.primary} />
      <Text style={styles.secondaryText}>{status.playing ? 'Pause Replay' : 'Replay Recording'}</Text>
    </TouchableOpacity>
  );
}

/** "2:14 PM" today; "Oct 1 at 2:14 PM" another day. */
function keptTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'earlier';
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`;
}

async function removeRecording(uri: string | null) {
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(16,24,40,0.35)', justifyContent: 'flex-end' },
  backdropTablet: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  sheetContainer: { flex: 1, justifyContent: 'flex-end' },
  sheetContainerTablet: { maxWidth: DAVE_VOICE_CAPTURE_TABLET_MAX_WIDTH, width: '100%', justifyContent: 'center' },
  sheet: { maxHeight: '92%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetTablet: { maxHeight: '88%', borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 44 },
  contentTablet: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginTop: 9 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.lg },
  main: { flex: 1 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' },
  subtitle: { color: colors.mutedText, fontSize: 14, marginTop: 3 },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  projectChoiceCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.lg },
  projectChoiceTitle: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '800', marginBottom: spacing.sm },
  projectChoices: { gap: spacing.sm },
  projectChoiceButton: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  projectChoiceText: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700', flex: 1 },
  operationCard: { alignItems: 'center', backgroundColor: colors.primarySoft, borderColor: colors.primary, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, minHeight: 72, padding: spacing.md },
  operationIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  operationLabel: { color: colors.text, fontSize: 16, fontWeight: '800' },
  operationGuidance: { color: colors.mutedText, fontSize: 13, lineHeight: 18, marginTop: 2 },
  taskContextCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.lg, overflow: 'hidden' },
  taskContextHeader: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  taskContextLabel: { color: colors.mutedText, fontSize: 12, lineHeight: 16, fontWeight: '800', textTransform: 'uppercase' },
  taskContextValue: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '800', marginTop: 2 },
  taskPicker: { borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs, padding: spacing.sm },
  taskSearch: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 15, paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  taskFilterRow: { minHeight: 40, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.sm },
  taskFilterSummary: { color: colors.mutedText, fontSize: 13, lineHeight: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  completedTasksButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: spacing.sm },
  completedTasksButtonText: { color: colors.primary, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  taskOption: { minHeight: 54, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  taskOptionSelected: { backgroundColor: colors.primarySoft },
  taskOptionName: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '700', flexShrink: 1 },
  taskOptionDetail: { color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: 2 },
  taskEmpty: { color: colors.mutedText, fontSize: 14, lineHeight: 20, padding: spacing.md, textAlign: 'center' },
  captureStatus: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.primarySoft, borderColor: colors.primary, borderRadius: 14, borderWidth: 2, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.md, minHeight: 54, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  captureStatusListening: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  captureStatusProcessing: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  captureStatusCaptured: { backgroundColor: colors.successSoft, borderColor: colors.success },
  captureStatusText: { color: colors.primary, flexShrink: 1, fontSize: 16, fontWeight: '800', lineHeight: 21, textAlign: 'center' },
  captureStatusTextListening: { color: colors.danger },
  captureStatusTextProcessing: { color: colors.warning },
  captureStatusTextCaptured: { color: colors.success },
  prompt: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  guidance: { color: colors.mutedText, fontSize: 14, lineHeight: 20, marginTop: 5, textAlign: 'center' },
  walkCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.primarySoft, padding: spacing.md, marginTop: spacing.lg },
  walkHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  walkTitle: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  walkLocation: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: 7 },
  walkPrompt: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '700', marginTop: spacing.sm },
  walkWhy: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: 5 },
  recorderCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', padding: spacing.lg, marginTop: spacing.lg },
  recorderCardActive: { borderColor: colors.danger, backgroundColor: '#FFF7F7' },
  timer: { color: colors.text, fontSize: 38, fontWeight: '800', fontVariant: ['tabular-nums'] },
  recordingLimit: { color: colors.mutedText, fontSize: 12, marginTop: 4 },
  limitWarning: { color: colors.danger, fontSize: 14, fontWeight: '800', lineHeight: 20, marginTop: spacing.sm, textAlign: 'center' },
  playbackButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.md, paddingHorizontal: spacing.md },
  recordButton: { minHeight: 56, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.45 },
  stopButton: { minHeight: 56, borderRadius: 14, backgroundColor: colors.danger, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: spacing.lg },
  continueButton: { minHeight: 56, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: spacing.lg },
  secondaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  secondaryText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  typeButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  typeText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: spacing.md, textAlign: 'center' },
  notice: { backgroundColor: colors.warningSoft, borderColor: colors.warning, borderRadius: 12, borderWidth: 1, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: spacing.md, overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, textAlign: 'center' },
});
