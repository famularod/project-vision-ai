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
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { transcribeDAVECaptureMemoryAudio } from '../services/DAVEVoiceTranscriptionService';
import { colors, spacing } from '../theme';
import { KeyboardAvoidingModalCard } from './KeyboardAvoidingModalCard';

const MAX_RECORDING_SECONDS = 180;

export function DAVEVoiceCaptureSheet({
  visible,
  projectName,
  onTranscript,
  onTypeInstead,
  onCancel,
}: {
  visible: boolean;
  projectName: string;
  onTranscript: (transcript: string) => void;
  onTypeInstead: () => void;
  onCancel: () => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordingActiveRef = useRef(false);
  const transcriptionOperationRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setIsTranscribing(false);
  }, [visible]);

  useEffect(() => {
    if (!recordingActiveRef.current || recorderState.isRecording || !recorderState.url) return;
    recordingActiveRef.current = false;
    setRecordingUri(recorderState.url);
    setRecordingDuration(recorderState.durationMillis);
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
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
      setError('DAVE could not start recording. Try again or type the memory instead.');
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
      setError('DAVE could not finish this recording. Try again.');
    }
  }

  async function transcribe() {
    if (!recordingUri || isTranscribing) return;
    const operation = ++transcriptionOperationRef.current;
    setError(null);
    setIsTranscribing(true);
    try {
      const result = await transcribeDAVECaptureMemoryAudio({ uri: recordingUri });
      if (operation !== transcriptionOperationRef.current) return;
      await removeRecording(recordingUri);
      setRecordingUri(null);
      onTranscript(result.transcript);
    } catch (reason) {
      if (operation !== transcriptionOperationRef.current) return;
      setError(reason instanceof Error ? reason.message : 'DAVE could not transcribe this recording.');
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
        <KeyboardAvoidingModalCard frameStyle={styles.sheet} contentContainerStyle={styles.content}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.main}>
              <Text style={styles.title}>Capture Memory</Text>
              <Text style={styles.subtitle}>{projectName}</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={() => { void cancel(); }} accessibilityLabel="Cancel memory capture">
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.prompt}>{recorderState.isRecording ? 'Listening…' : recordingUri ? 'Recording ready' : 'Tell DAVE what to remember'}</Text>
          <Text style={styles.guidance}>Commitment, decision, issue, request, schedule change, or follow-up.</Text>

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
                <Text style={styles.primaryText}>{isTranscribing ? 'Transcribing…' : 'Review Memory'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} disabled={isTranscribing} onPress={() => { void startRecording(); }} accessibilityRole="button">
                <Ionicons name="refresh" size={19} color={colors.primary} />
                <Text style={styles.secondaryText}>Record Again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.recordButton} onPress={() => { void startRecording(); }} accessibilityRole="button">
              <Ionicons name="mic" size={23} color="#FFF" />
              <Text style={styles.primaryText}>Start Recording</Text>
            </TouchableOpacity>
          )}

          {!recorderState.isRecording ? (
            <TouchableOpacity style={styles.typeButton} disabled={isTranscribing} onPress={() => { void typeInstead(); }} accessibilityRole="button">
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
  sheet: { maxHeight: '88%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 36 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginTop: 9 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.lg },
  main: { flex: 1 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' },
  subtitle: { color: colors.mutedText, fontSize: 14, marginTop: 3 },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  prompt: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  guidance: { color: colors.mutedText, fontSize: 14, lineHeight: 20, marginTop: 5, textAlign: 'center' },
  recorderCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', padding: spacing.lg, marginTop: spacing.lg },
  recorderCardActive: { borderColor: colors.danger, backgroundColor: '#FFF7F7' },
  timer: { color: colors.text, fontSize: 38, fontWeight: '800', fontVariant: ['tabular-nums'] },
  recordingLimit: { color: colors.mutedText, fontSize: 12, marginTop: 4 },
  playbackButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.md, paddingHorizontal: spacing.md },
  recordButton: { minHeight: 56, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: spacing.lg },
  stopButton: { minHeight: 56, borderRadius: 14, backgroundColor: colors.danger, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: spacing.lg },
  continueButton: { minHeight: 56, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: spacing.lg },
  secondaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  secondaryText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  typeButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  typeText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: spacing.md, textAlign: 'center' },
});
