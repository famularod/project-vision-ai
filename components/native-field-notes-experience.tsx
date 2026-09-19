import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { DAVEVoiceCaptureSheet } from './DAVEVoiceCaptureSheet';
import { AppScreenScroll } from './app-screen-scroll';
import { colors, styles } from './app-shell-theme';
import {
  FieldNotesWorkspace,
  type FieldNoteVoiceDraft,
} from './field-notes-workspace';
import {
  resolveFieldNoteVoiceContext,
  type FieldNoteVoiceContext,
  type FieldNoteVoiceProjectRecord,
} from '../services/FieldNoteVoiceContext';
import { mobileFieldNoteDataSource } from '../services/FieldNoteMobileSync';

type VoiceProjectArea = Readonly<{ name: string; projectName?: string | null }>;

export function NativeFieldNotesExperience({
  contentStyle,
  ownerKey,
  projects,
  projectRecords,
  projectAreas,
}: {
  contentStyle: StyleProp<ViewStyle>;
  ownerKey: string;
  projects: readonly string[];
  projectRecords: readonly FieldNoteVoiceProjectRecord[];
  projectAreas: readonly VoiceProjectArea[];
}) {
  const [voiceContext, setVoiceContext] = useState<FieldNoteVoiceContext | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<FieldNoteVoiceDraft | null>(null);

  function beginVoiceCapture(projectName: string | null) {
    const context = resolveFieldNoteVoiceContext(projectName, projectRecords);
    if (!context) {
      Alert.alert(
        'Voice is still loading',
        'Wait for your project access to finish loading, then record the field note again. The note can still remain general.',
      );
      return;
    }
    setVoiceContext(context);
  }

  return (
    <>
      <AppScreenScroll contentStyle={contentStyle}>
        <View style={styles.screenTitleRow}>
          <View style={styles.screenTitle}>
            <Text style={styles.title}>Field Notes</Text>
            <Text style={styles.subtitle}>Capture observations and reminders before they are forgotten.</Text>
          </View>
        </View>
        <FieldNotesWorkspace
          ownerKey={ownerKey}
          projects={projects}
          projectRecords={projectRecords.map(project => ({
            id: project.id?.trim() || null,
            name: project.name,
          }))}
          voiceDraft={voiceDraft}
          onVoiceDraftConsumed={id => setVoiceDraft(current => current?.id === id ? null : current)}
          onRecordVoice={beginVoiceCapture}
          dataSource={mobileFieldNoteDataSource}
          presentation="mobile_capture"
        />
      </AppScreenScroll>

      <DAVEVoiceCaptureSheet
        visible={Boolean(voiceContext)}
        projectId={voiceContext?.projectId || null}
        projectName={voiceContext?.transcriptionProjectName || ''}
        contextLabel={voiceContext?.noteProjectName || 'General field note'}
        candidateLocations={projectAreas
          .filter(area => voiceContext?.noteProjectName && area.projectName === voiceContext.noteProjectName)
          .map(area => area.name)}
        title="Record Field Note"
        prompt="What did you notice or remember?"
        guidance="State the observation or reminder clearly. You will review it before saving."
        continueLabel="Use Note"
        captureLabel="Field note"
        autoStartRecording
        autoSubmitOnStop
        showWalkContext={false}
        onMemoryReady={result => {
          const context = voiceContext;
          setVoiceContext(null);
          setVoiceDraft({
            id: `field-note-voice-${Date.now()}`,
            text: result.transcript,
            projectName: context?.noteProjectName || null,
            locationName: result.understanding.recommendedLocation.value,
          });
        }}
        onTypeInstead={() => setVoiceContext(null)}
        onCancel={() => setVoiceContext(null)}
      />
    </>
  );
}

export function OverviewFieldNotesCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      style={styles.overviewFieldNotesCard}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open Field Notes"
    >
      <View style={styles.overviewFieldNotesIcon}>
        <Ionicons name="document-text-outline" size={23} color={colors.primary} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.overviewFieldNotesTitle}>Field Notes</Text>
        <Text style={styles.overviewFieldNotesText}>
          Quickly save an observation or reminder without creating a task.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.primary} />
    </Pressable>
  );
}
