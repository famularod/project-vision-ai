import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type {
  DAVECaptureMemoryFields,
  DAVEConfirmedCaptureMemory,
} from '../services/DAVECaptureMemory';
import { colors, spacing } from '../theme';

const FIELD_LABELS: ReadonlyArray<readonly [keyof DAVECaptureMemoryFields, string]> = [
  ['peopleOrCompany', 'Person or company'],
  ['commitment', 'Commitment'],
  ['dueDate', 'Due date'],
  ['decision', 'Decision'],
  ['ownerRequest', 'Owner request'],
  ['inspectionChange', 'Inspection change'],
  ['scheduleChange', 'Schedule change'],
  ['issue', 'Issue'],
  ['risk', 'Risk'],
  ['followUp', 'Follow-up'],
  ['generalMemory', 'General memory'],
];

export function DAVECaptureMemoryDetailSheet({
  memory,
  onClose,
  onDelete,
}: {
  memory: DAVEConfirmedCaptureMemory | null;
  onClose: () => void;
  onDelete: (memoryId: string) => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setIsDeleting(false);
    setDeleteError(null);
  }, [memory?.id]);

  if (!memory) return null;

  const memoryId = memory.id;
  const populatedFields = FIELD_LABELS.filter(([field]) => Boolean(memory.fields[field]));

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.main}>
              <Text style={styles.title}>Saved Memory</Text>
              <Text style={styles.subtitle}>Confirmed {formatConfirmedAt(memory.confirmedAt)}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close saved memory"
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <DetailCard title="Project">
              <Text style={styles.value}>{memory.recommendedProject.value}</Text>
              <Text style={styles.detail}>
                Area: {memory.recommendedLocation.value || 'Not assigned'}
              </Text>
            </DetailCard>

            <DetailCard title="What DAVE remembers">
              {populatedFields.length ? populatedFields.map(([field, label]) => (
                <View key={field} style={styles.field}>
                  <Text style={styles.label}>{label}</Text>
                  <Text style={styles.value} selectable>{memory.fields[field]}</Text>
                </View>
              )) : (
                <Text style={styles.detail}>No structured details were saved.</Text>
              )}
            </DetailCard>

            <DetailCard title="Source note">
              <Text style={styles.source} selectable>{memory.transcript}</Text>
              <Text style={styles.limitation}>
                This records what was entered and confirmed. It does not independently verify that the work occurred.
              </Text>
            </DetailCard>

            {memory.corrections.length ? (
              <DetailCard title="PM corrections">
                {memory.corrections.map((correction, index) => (
                  <Text key={`${correction.field}-${index}`} style={styles.detail}>
                    {friendlyField(correction.field)}: {correction.previousValue || 'Not supplied'} → {correction.correctedValue || 'Removed'}
                  </Text>
                ))}
              </DetailCard>
            ) : null}

            {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={confirmDelete}
              disabled={isDeleting}
              accessibilityRole="button"
              accessibilityLabel="Delete saved memory"
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={styles.deleteText}>{isDeleting ? 'Deleting…' : 'Delete Memory'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  function confirmDelete() {
    Alert.alert(
      'Delete Saved Memory?',
      'This removes the confirmed memory from this device and updates DAVE’s local project intelligence. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Memory',
          style: 'destructive',
          onPress: () => { void performDelete(); },
        },
      ],
    );
  }

  async function performDelete() {
    if (isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(memoryId);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'The saved memory could not be deleted.');
    } finally {
      setIsDeleting(false);
    }
  }
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function formatConfirmedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'recently';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function friendlyField(value: string) {
  const match = FIELD_LABELS.find(([field]) => field === value);
  if (match) return match[1];
  if (value === 'project') return 'Project';
  if (value === 'location') return 'Area';
  return value;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(16,24,40,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 9,
  },
  header: {
    flexDirection: 'row',
    padding: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  main: { flex: 1 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' },
  subtitle: { color: colors.mutedText, fontSize: 14, marginTop: 3 },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 36 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: spacing.sm },
  field: { marginBottom: spacing.sm },
  label: { color: colors.mutedText, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  value: { color: colors.text, fontSize: 16, lineHeight: 22, marginTop: 3 },
  detail: { color: colors.mutedText, fontSize: 14, lineHeight: 20, marginTop: 4 },
  source: { color: colors.text, fontSize: 15, lineHeight: 22 },
  limitation: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: spacing.md },
  error: { color: colors.danger, fontSize: 14, fontWeight: '700', marginBottom: spacing.sm },
  deleteButton: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  deleteText: { color: colors.danger, fontSize: 15, fontWeight: '800' },
});
