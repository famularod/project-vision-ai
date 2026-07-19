import { Ionicons } from '@expo/vector-icons';
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
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { transcribeDAVECaptureMemoryAudio } from '../services/DAVEVoiceTranscriptionService';
import type { DAVEVoiceUnderstandingResponse } from '../services/DAVEVoiceUnderstanding';
import type { DAVEProjectWalkContext } from '../services/DAVEProjectWalk';
import { colors, spacing } from '../theme';
import { KeyboardAvoidingModalCard } from './KeyboardAvoidingModalCard';

const MAX_RECORDING_SECONDS = 180;

export type DAVEVoiceTaskOption = {
  id: string;
  taskName: string;
  detail: string;
};

export function DAVEVoiceCaptureSheet({
  visible,
  projectName,
  candidateProjects = [],
  candidateTasks = [],
  selectedTaskId = null,
  walkContext,
  candidateLocations,
  title = 'Capture Memory',
  prompt = 'Record a project memory',
  guidance = 'Commitment, decision, issue, request, schedule change, or follow-up.',
  continueLabel = 'Review Memory',
  showWalkContext = true,
  onMemoryReady,
  onProjectChange,
  onTaskChange,
  onTypeInstead,
  onCancel,
}: {
  visible: boolean;
  projectName: string;
  candidateProjects?: readonly string[];
  candidateTasks?: readonly DAVEVoiceTaskOption[];
  selectedTaskId?: string | null;
  walkContext?: DAVEProjectWalkContext;
  candidateLocations: readonly string[];
  title?: string;
  prompt?: string;
  guidance?: string;
  continueLabel?: string;
  showWalkContext?: boolean;
  onMemoryReady: (result: DAVEVoiceUnderstandingResponse) => void;
  onProjectChange?: (projectName: string) => void;
  onTaskChange?: (taskId: string | null) => void;
  onTypeInstead: () => void;
  onCancel: () => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const recordingActiveRef = useRef(false);
  const transcriptionOperationRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setIsTranscribing(false);
    setTaskPickerOpen(false);
    setTaskSearch('');
  }, [visible]);

  const selectedTask = candidateTasks.find(task => task.id === selectedTaskId) || null;
  const normalizedTaskSearch = taskSearch.trim().toLowerCase();
  const visibleTasks = candidateTasks
    .filter(task =>
      !normalizedTaskSearch ||
      `${task.taskName} ${task.detail}`.toLowerCase().includes(normalizedTaskSearch),
    )
    .slice(0, 10);

  useEffect(() => {
    if (!recordingActiveRef.current || recorderState.isRecording || !recorderState.url) return;
    recordingActiveRef.current = false;
    setRecordingUri(recorderState.url);
    setRecordingDuration(recorderState.durationMillis);
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
      .catch(() => setError('Recording ended, but audio settings could not be reset. Close and reopen Talk.'));
  }, [recorderState.durationMillis, recorderState.isRecording, recorderState.url]);

  async function startRecording() {
    if (isTranscribing || recorderState.isRecording) return;
    setError(null);
    await removeRecording(recordingUri);
    setRecordingUri(null);
    setRecordingDuration(0);

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone access is off. Enable it in Settings or type the memory instead.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recordingActiveRef.current = true;
      recorder.record({ forDuration: MAX_RECORDING_SECONDS });
    } catch {
      recordingActiveRef.current = false;
      setError('Recording could not start. Try again or type the memory instead.');
    }
  }

  async function stopRecording() {
    if (!recorderState.isRecording) return;
    try {
      await recorder.stop();
      const status = recorder.getStatus();
      const uri = recorder.uri || status.url;
      if (!uri) throw new Error('Recording file missing.');
      recordingActiveRef.current = false;
      setRecordingUri(uri);
      setRecordingDuration(status.durationMillis);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      recordingActiveRef.current = false;
      setError('The recording could not finish. Try again.');
    }
  }

  async function transcribe() {
    if (!recordingUri || isTranscribing) return;
    const operation = ++transcriptionOperationRef.current;
    setError(null);
    setIsTranscribing(true);
    try {
      const result = await transcribeDAVECaptureMemoryAudio({
        uri: recordingUri,
        projectName,
        candidateLocations,
      });
      if (operation !== transcriptionOperationRef.current) return;
      await removeRecording(recordingUri);
      setRecordingUri(null);
      onMemoryReady(result);
    } catch (reason) {
      if (operation !== transcriptionOperationRef.current) return;
      setError(reason instanceof Error ? reason.message : 'The recording could not be transcribed.');
    } finally {
      if (operation === transcriptionOperationRef.current) setIsTranscribing(false);
    }
  }

  async function cancel() {
    transcriptionOperationRef.current += 1;
    if (recorderState.isRecording) await recorder.stop().catch(() => undefined);
    recordingActiveRef.current = false;
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    await removeRecording(recordingUri || recorder.uri);
    setRecordingUri(null);
    onCancel();
  }

  async function typeInstead() {
    transcriptionOperationRef.current += 1;
    if (recorderState.isRecording) await recorder.stop().catch(() => undefined);
    recordingActiveRef.current = false;
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    await removeRecording(recordingUri || recorder.uri);
    setRecordingUri(null);
    onTypeInstead();
  }

  const elapsed = recorderState.isRecording ? recorderState.durationMillis : recordingDuration;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => { void cancel(); }}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingModalCard
          containerStyle={styles.sheetContainer}
          frameStyle={styles.sheet}
          contentContainerStyle={styles.content}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.main}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{projectName || 'Choose a project'}</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={() => { void cancel(); }} accessibilityLabel="Cancel memory capture">
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
                    <Text style={styles.taskEmpty}>No matching tasks.</Text>
                  ) : null}
                </View>
              ) : null}
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
            {recordingUri && !recorderState.isRecording ? <DAVERecordingPlayback uri={recordingUri} /> : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {recorderState.isRecording ? (
            <TouchableOpacity style={styles.stopButton} onPress={() => { void stopRecording(); }} accessibilityRole="button">
              <Ionicons name="stop" size={21} color="#FFF" />
              <Text style={styles.primaryText}>Stop Recording</Text>
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
            <TouchableOpacity style={styles.typeButton} disabled={isTranscribing || !projectName} onPress={() => { void typeInstead(); }} accessibilityRole="button">
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
  sheetContainer: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 44 },
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
  taskContextCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.lg, overflow: 'hidden' },
  taskContextHeader: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  taskContextLabel: { color: colors.mutedText, fontSize: 12, lineHeight: 16, fontWeight: '800', textTransform: 'uppercase' },
  taskContextValue: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '800', marginTop: 2 },
  taskPicker: { borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs, padding: spacing.sm },
  taskSearch: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 15, paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  taskOption: { minHeight: 54, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  taskOptionSelected: { backgroundColor: colors.primarySoft },
  taskOptionName: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '700', flexShrink: 1 },
  taskOptionDetail: { color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: 2 },
  taskEmpty: { color: colors.mutedText, fontSize: 14, lineHeight: 20, padding: spacing.md, textAlign: 'center' },
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
});
