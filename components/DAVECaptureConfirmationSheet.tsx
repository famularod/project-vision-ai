import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  cancelCaptureMemory,
  confirmCaptureLocation,
  confirmCaptureMemory,
  confirmCaptureProject,
  confirmedCaptureMemoryForSave,
  correctCaptureMemory,
  type DAVECaptureMemory,
  type DAVECaptureMemoryFields,
  type DAVEConfirmedCaptureMemory,
} from '../services/DAVECaptureMemory';
import {
  createConversationSnapshot,
  transitionConversation,
  type DAVEConversationSnapshot,
} from '../services/DAVEConversationFramework';
import {
  buildAssignmentUncertainty,
  buildInsufficientEvidence,
  buildMemoryConfirmation,
} from '../services/DAVEConversationLanguage';
import { colors, spacing } from '../theme';

type EditableField = keyof DAVECaptureMemoryFields;

const FIELD_LABELS: ReadonlyArray<readonly [EditableField, string]> = [
  ['peopleOrCompany', 'Person or company'], ['commitment', 'Commitment'],
  ['dueDate', 'Due date'], ['decision', 'Decision'], ['ownerRequest', 'Owner request'],
  ['inspectionChange', 'Inspection change'], ['scheduleChange', 'Schedule change'],
  ['issue', 'Issue'], ['risk', 'Risk'], ['followUp', 'Follow-up'],
  ['generalMemory', 'General memory'],
];

function editableFieldTexts(memory: DAVECaptureMemory): Record<EditableField, string> {
  return Object.fromEntries(
    FIELD_LABELS.map(([field]) => [field, memory.fields[field] || '']),
  ) as Record<EditableField, string>;
}

export function DAVECaptureConfirmationSheet({
  visible,
  transcript,
  draft,
  projects,
  locations,
  sourceLabel = 'Source transcript',
  onSave,
  onCancel,
}: {
  visible: boolean;
  transcript: string;
  draft: DAVECaptureMemory;
  projects: readonly string[];
  locations: readonly string[];
  sourceLabel?: string;
  onSave: (memory: DAVEConfirmedCaptureMemory) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [working, setWorking] = useState(draft);
  const [fieldTexts, setFieldTexts] = useState<Record<EditableField, string>>(() => editableFieldTexts(draft));
  const [, setConversation] = useState(confirmationSnapshot);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setWorking(draft);
    setFieldTexts(editableFieldTexts(draft));
    setConversation(confirmationSnapshot());
    setSaveError(null);
    setIsSaving(false);
  }, [draft, visible]);

  function editField(field: EditableField, value: string) {
    setFieldTexts(current => ({ ...current, [field]: value }));
    setSaveError(null);
  }

  function commitField(field: EditableField) {
    setWorking(current => commitFieldText(current, field, fieldTexts[field]));
  }

  function chooseProject(project: string) {
    setWorking(current => correctCaptureMemory(current, 'project', project, new Date().toISOString()));
    setSaveError(null);
  }

  function chooseLocation(location: string) {
    setWorking(current => correctCaptureMemory(current, 'location', location, new Date().toISOString()));
    setSaveError(null);
  }

  function confirmRecommendedProject() {
    setWorking(current => confirmCaptureProject(current));
    setSaveError(null);
  }

  function confirmRecommendedLocation() {
    setWorking(current => confirmCaptureLocation(current));
    setSaveError(null);
  }

  async function save() {
    if (isSaving) return;

    try {
      const prepared = FIELD_LABELS.reduce(
        (current, [field]) => commitFieldText(current, field, fieldTexts[field]),
        working,
      );
      const confirmed = confirmCaptureMemory(prepared, new Date().toISOString());
      const eligible = confirmedCaptureMemoryForSave(confirmed);
      if (!eligible) return;
      setIsSaving(true);
      setConversation(current => transitionConversation(current, 'saving'));
      await onSave(eligible);
      setConversation(current => transitionConversation(current, 'follow_up'));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Confirm the project and location before saving.');
      setConversation(current => current.state === 'saving'
        ? transitionConversation(current, 'failed', 'Memory could not be saved.')
        : current);
    } finally {
      setIsSaving(false);
    }
  }

  function cancel() {
    cancelCaptureMemory(working, new Date().toISOString());
    setConversation(current => transitionConversation(current, 'cancelled'));
    onCancel();
  }

  const limitations = memoryLimitations(working);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.main}>
              <Text style={styles.title}>Confirm Memory</Text>
              <Text style={styles.subtitle}>Review this project memory. Nothing is saved yet.</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={cancel} accessibilityRole="button" accessibilityLabel="Cancel memory confirmation">
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Card title="What I remember">
              <Text style={styles.summary}>{buildMemoryConfirmation(working)}</Text>
              <Text style={styles.sourceLabel}>{sourceLabel}</Text>
              <Text style={styles.transcript}>{transcript}</Text>
            </Card>

            <Card title="Project and location">
              <Recommendation
                label="Recommended project"
                value={working.recommendedProject.value}
                confidence={working.recommendedProject.confidence}
                confirmed={working.recommendedProject.confirmed}
                options={projects}
                onConfirm={confirmRecommendedProject}
                onChoose={chooseProject}
              />
              <Recommendation
                label="Recommended location"
                value={working.recommendedLocation.value}
                confidence={working.recommendedLocation.confidence}
                confirmed={working.recommendedLocation.confirmed}
                options={locations}
                onConfirm={confirmRecommendedLocation}
                onChoose={chooseLocation}
                optional
              />
              {(!working.recommendedProject.confirmed || (working.recommendedLocation.value && !working.recommendedLocation.confirmed)) ? (
                <Text style={styles.guidance}>{buildAssignmentUncertainty(working.recommendedProject.value, working.recommendedLocation.value)}</Text>
              ) : null}
            </Card>

            <Card title="Conversation details">
              {FIELD_LABELS.map(([field, label]) => (
                <View key={field} style={styles.field}>
                  <Text style={styles.label}>{label}</Text>
                  <TextInput
                    style={[styles.input, field === 'generalMemory' && styles.multiline]}
                    value={fieldTexts[field]}
                    onChangeText={value => editField(field, value)}
                    onBlur={() => commitField(field)}
                    placeholder={field === 'dueDate' ? 'Not supplied' : 'Nothing remembered'}
                    placeholderTextColor={colors.mutedText}
                    multiline={field === 'generalMemory'}
                  />
                </View>
              ))}
            </Card>

            <Card title="Confidence and limitations">
              <Text style={styles.detail}>Project confidence: {friendlyConfidence(working.recommendedProject.confidence)}</Text>
              <Text style={styles.detail}>Location confidence: {friendlyConfidence(working.recommendedLocation.confidence)}</Text>
              {limitations.length ? limitations.map(item => <Text key={item} style={styles.limitation}>• {item}</Text>) : <Text style={styles.detail}>No major evidence gaps in this draft.</Text>}
            </Card>

            {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
            <TouchableOpacity
              style={styles.saveButton}
              onPress={() => { void save(); }}
              disabled={isSaving}
              accessibilityRole="button"
              accessibilityLabel="Save confirmed memory"
            >
              <Text style={styles.saveText}>{isSaving ? 'Saving…' : 'Save Memory'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={cancel} accessibilityRole="button"><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function commitFieldText(
  memory: DAVECaptureMemory,
  field: EditableField,
  value: string,
) {
  const normalized = value.trim() || null;
  if (memory.fields[field] === normalized) return memory;
  return correctCaptureMemory(memory, field, normalized, new Date().toISOString());
}

function Recommendation({ label, value, confidence, confirmed, options, onConfirm, onChoose, optional = false }: {
  label: string; value: string | null; confidence: string; confirmed: boolean;
  options: readonly string[]; onConfirm: () => void; onChoose: (value: string) => void; optional?: boolean;
}) {
  return <View style={styles.recommendation}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.recommendationValue}>{value || (optional ? 'No location recommended' : 'No project recommended')}</Text>
    <Text style={styles.detail}>Confidence: {friendlyConfidence(confidence)}</Text>
    {value && !confirmed ? <TouchableOpacity style={styles.confirmButton} onPress={onConfirm}><Text style={styles.confirmText}>Confirm {value}</Text></TouchableOpacity> : null}
    {confirmed ? <Text style={styles.confirmedText}>Confirmed</Text> : null}
    <View style={styles.options}>{options.filter(item => item !== value).map(item => <TouchableOpacity key={item} style={styles.option} onPress={() => onChoose(item)}><Text style={styles.optionText}>{item}</Text></TouchableOpacity>)}</View>
  </View>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{children}</View>;
}

function confirmationSnapshot(): DAVEConversationSnapshot {
  let state = createConversationSnapshot();
  state = transitionConversation(state, 'listening');
  state = transitionConversation(state, 'understanding');
  return transitionConversation(state, 'confirming');
}

function memoryLimitations(memory: DAVECaptureMemory): string[] {
  const items: string[] = [];
  if (!memory.recommendedProject.value) items.push(buildInsufficientEvidence('project'));
  if (!memory.recommendedLocation.value) items.push(buildInsufficientEvidence('location'));
  if (memory.fields.commitment && !memory.fields.dueDate) items.push(buildInsufficientEvidence('due date'));
  return items;
}

function friendlyConfidence(value: string): string {
  if (value === 'high') return 'High';
  if (value === 'medium') return 'Medium';
  if (value === 'low') return 'Low';
  return 'Not enough evidence';
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(16,24,40,0.35)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '94%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginTop: 9 },
  header: { flexDirection: 'row', padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }, main: { flex: 1 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' }, subtitle: { color: colors.mutedText, fontSize: 14, lineHeight: 20, marginTop: 3 },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: 36 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md, shadowColor: '#17213A', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: spacing.sm }, summary: { color: colors.text, fontSize: 16, lineHeight: 23, fontWeight: '600' },
  sourceLabel: { color: colors.mutedText, fontSize: 12, fontWeight: '800', marginTop: spacing.md, marginBottom: 4, textTransform: 'uppercase' }, transcript: { color: colors.text, fontSize: 14, lineHeight: 20 },
  recommendation: { paddingBottom: spacing.md, marginBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  recommendationValue: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 3 }, detail: { color: colors.mutedText, fontSize: 13, lineHeight: 18, marginTop: 3 },
  confirmButton: { minHeight: 44, borderRadius: 10, backgroundColor: colors.primarySoft, justifyContent: 'center', alignItems: 'center', marginTop: spacing.sm }, confirmText: { color: colors.primary, fontWeight: '800' }, confirmedText: { color: colors.success, fontSize: 13, fontWeight: '800', marginTop: 5 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: spacing.sm }, option: { minHeight: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', paddingHorizontal: 12 }, optionText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  guidance: { color: colors.text, fontSize: 14, lineHeight: 20 }, field: { marginBottom: spacing.sm }, label: { color: colors.text, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10, marginTop: 5 }, multiline: { minHeight: 88, textAlignVertical: 'top' },
  limitation: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: 4 }, error: { color: colors.danger, fontSize: 14, fontWeight: '700', marginBottom: spacing.sm },
  saveButton: { minHeight: 54, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, saveText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  cancelButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' }, cancelText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
});
