import { Ionicons } from '@expo/vector-icons';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { DAVETaskUpdateCommand } from '../services/DAVETaskConversation';
import { colors, spacing } from '../theme';
import { KeyboardAvoidingModalCard } from './KeyboardAvoidingModalCard';

export type DAVETaskActionCandidate = {
  id: string;
  taskName: string;
  locationName: string;
  status: string;
  percentComplete: number;
};

export function DAVETaskActionConfirmationSheet({
  visible,
  projectName,
  command,
  candidates,
  selectedTaskId,
  onSelectTask,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  projectName: string;
  command: DAVETaskUpdateCommand | null;
  candidates: DAVETaskActionCandidate[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const selectedTask = candidates.find(item => item.id === selectedTaskId) || null;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingModalCard frameStyle={styles.sheet} contentContainerStyle={styles.content}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.main}>
              <Text style={styles.title}>Confirm Task Change</Text>
              <Text style={styles.subtitle}>{projectName}</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onCancel} accessibilityLabel="Cancel task change">
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          {candidates.length > 1 ? (
            <>
              <Text style={styles.sectionLabel}>Choose the correct task</Text>
              <Text style={styles.help}>I found more than one possible match. Nothing will change until you choose one and confirm.</Text>
            </>
          ) : null}

          <View style={styles.candidateList}>
            {candidates.map(item => {
              const selected = item.id === selectedTaskId;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.candidate, selected && styles.candidateSelected]}
                  onPress={() => onSelectTask(item.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={23}
                    color={selected ? colors.primary : colors.mutedText}
                  />
                  <View style={styles.main}>
                    <Text style={styles.taskName}>{item.taskName}</Text>
                    <Text style={styles.taskDetail}>
                      {item.locationName || 'No area'} · {item.status} · {item.percentComplete}%
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {command && selectedTask ? (
            <View style={styles.proposedChange}>
              <Text style={styles.sectionLabel}>Proposed change</Text>
              <Text style={styles.changeText}>{command.changeSummary}</Text>
              <Text style={styles.help}>Task: {selectedTask.taskName}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryButton, !selectedTask && styles.primaryButtonDisabled]}
            onPress={onConfirm}
            disabled={!selectedTask}
            accessibilityRole="button"
            accessibilityState={{ disabled: !selectedTask }}
          >
            <Ionicons name="checkmark-circle-outline" size={21} color="#FFF" />
            <Text style={styles.primaryText}>Confirm Change</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={onCancel} accessibilityRole="button">
            <Text style={styles.secondaryText}>Cancel</Text>
          </TouchableOpacity>
        </KeyboardAvoidingModalCard>
      </View>
    </Modal>
  );
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
  sectionLabel: { color: colors.text, fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  help: { color: colors.mutedText, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
  candidateList: { gap: spacing.sm, marginTop: spacing.md },
  candidate: { minHeight: 72, padding: spacing.md, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  candidateSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  taskName: { color: colors.text, fontSize: 16, fontWeight: '800' },
  taskDetail: { color: colors.mutedText, fontSize: 13, marginTop: 4 },
  proposedChange: { backgroundColor: colors.primarySoft, borderRadius: 14, padding: spacing.md, marginTop: spacing.lg },
  changeText: { color: colors.text, fontSize: 17, lineHeight: 24, fontWeight: '800', marginTop: spacing.xs },
  primaryButton: { minHeight: 54, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
});
