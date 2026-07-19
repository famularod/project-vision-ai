import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  scheduleImportBatchCounts,
  scheduleImportItemHasCoreFacts,
  scheduleImportItemIsReady,
  scheduleImportReviewFields,
  type PIEScheduleImportBatch,
} from '../services/PIEScheduleImportBatch';
import { colors, spacing, typography } from '../theme';
import type { ScheduleItem } from '../types';
import {
  scheduleCompletionVerificationLabel,
  scheduleItemNeedsCompletionVerification,
} from '../services/DAVECompletionVerification';
import { KeyboardAvoidingModalCard } from './KeyboardAvoidingModalCard';
import { PrimaryButton, SecondaryButton } from './ProjectDetailsCard';

export function ScheduleImportFlow({
  screenshotImportAvailable,
  onImportFile,
  onImportScreenshots,
  onAddManually,
  onApprove,
  onCancel,
}: {
  screenshotImportAvailable: boolean;
  onImportFile: (onProcessingStart: () => void) => Promise<PIEScheduleImportBatch | null>;
  onImportScreenshots: (onProcessingStart: () => void) => Promise<PIEScheduleImportBatch | null>;
  onAddManually: () => void;
  onApprove: (batch: PIEScheduleImportBatch) => void;
  onCancel: (batch: PIEScheduleImportBatch) => void;
}) {
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [pendingBatch, setPendingBatch] = useState<PIEScheduleImportBatch | null>(null);
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);
  const importOperationRef = useRef(0);
  const pendingChoiceRef = useRef<'file' | 'screenshots' | 'manual' | null>(null);
  const counts = useMemo(
    () => scheduleImportBatchCounts(pendingBatch?.items || []),
    [pendingBatch?.items],
  );

  async function beginImport(
    label: string,
    importer: (onProcessingStart: () => void) => Promise<PIEScheduleImportBatch | null>,
  ) {
    if (busyLabel) return;

    const operationId = ++importOperationRef.current;

    try {
      const batch = await importer(() => {
        if (operationId === importOperationRef.current) setBusyLabel(label);
      });
      if (operationId !== importOperationRef.current) {
        if (batch) onCancel(batch);
        return;
      }
      if (batch) {
        setExpandedItemIds([]);
        setPendingBatch(batch);
      }
    } finally {
      if (operationId === importOperationRef.current) setBusyLabel(null);
    }
  }

  function cancelBusyImport() {
    importOperationRef.current += 1;
    setBusyLabel(null);
  }

  function closeChoice() {
    pendingChoiceRef.current = null;
    setChoiceOpen(false);
  }

  function runPendingChoice() {
    const choice = pendingChoiceRef.current;
    pendingChoiceRef.current = null;

    if (choice === 'file') {
      void beginImport('Reading schedule…', onImportFile);
    } else if (choice === 'screenshots') {
      void beginImport('Reading screenshots…', onImportScreenshots);
    } else if (choice === 'manual') {
      onAddManually();
    }
  }

  function chooseSource(choice: 'file' | 'screenshots' | 'manual') {
    if (choice === 'screenshots' && !screenshotImportAvailable) return;

    pendingChoiceRef.current = choice;
    setChoiceOpen(false);

    if (process.env.EXPO_OS !== 'ios') {
      setTimeout(runPendingChoice, 200);
    }
  }

  function updatePendingItem(itemId: string, next: Partial<ScheduleItem>) {
    setExpandedItemIds(current => current.includes(itemId) ? current : [...current, itemId]);
    setPendingBatch(current => current ? {
      ...current,
      items: current.items.map(item => item.id === itemId ? { ...item, ...next } : item),
    } : null);
  }

  function approveReadyItems() {
    if (!pendingBatch) return;

    const readyItems = pendingBatch.items.filter(scheduleImportItemIsReady);
    const remainingItems = pendingBatch.items.filter(item => !scheduleImportItemIsReady(item));
    if (!readyItems.length) return;

    onApprove({ ...pendingBatch, items: readyItems });

    if (remainingItems.length) {
      setPendingBatch({
        ...pendingBatch,
        items: remainingItems,
        documents: [],
        message: `${readyItems.length} ready ${readyItems.length === 1 ? 'item was' : 'items were'} added. Complete the highlighted fields to add the rest.`,
      });
    } else {
      setPendingBatch(null);
    }
  }

  function saveAllItems() {
    if (!pendingBatch || !pendingBatch.items.every(scheduleImportItemHasCoreFacts)) return;

    onApprove(pendingBatch);
    setPendingBatch(null);
    setExpandedItemIds([]);
  }

  function cancelReview() {
    if (!pendingBatch) return;
    onCancel(pendingBatch);
    setPendingBatch(null);
  }

  return (
    <>
      <View style={styles.inlineChoices}>
        <PrimaryButton
          label="Add Schedule or Task"
          icon="add-circle-outline"
          disabled={Boolean(busyLabel)}
          onPress={() => setChoiceOpen(true)}
        />

        {busyLabel ? (
          <View style={styles.loadingCard} accessibilityRole="progressbar">
            <ActivityIndicator size="small" color={colors.primary} />
            <View style={styles.loadingCopy}>
              <Text style={styles.loadingTitle}>{busyLabel}</Text>
              <Text style={styles.loadingText}>Nothing is added until you approve it.</Text>
            </View>
            <TouchableOpacity
              style={styles.cancelLoadingButton}
              onPress={cancelBusyImport}
              accessibilityRole="button"
              accessibilityLabel="Cancel schedule import"
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <Modal
        visible={choiceOpen}
        animationType="slide"
        transparent
        onDismiss={runPendingChoice}
        onRequestClose={closeChoice}
      >
        <View style={styles.backdrop}>
          <KeyboardAvoidingModalCard
            frameStyle={styles.choiceFrame}
            contentContainerStyle={styles.cardContent}
          >
            <ModalHeader
              title="Add Schedule or Task"
              subtitle="Choose how you want to add planned work."
              onClose={closeChoice}
            />
            <ImportChoice
              icon="document-text-outline"
              title="Schedule File"
              detail="Import a PDF, CSV, or text schedule"
              onPress={() => chooseSource('file')}
            />
            <ImportChoice
              icon="images-outline"
              title="Message or Email Screenshots"
              detail={screenshotImportAvailable
                ? 'Select several JPEG, JPG, PNG, or iPhone images'
                : 'Available on iPhone and iPad'}
              disabled={!screenshotImportAvailable}
              onPress={() => chooseSource('screenshots')}
            />
            <ImportChoice
              icon="create-outline"
              title="Manual Task"
              detail="Enter one task or milestone"
              onPress={() => chooseSource('manual')}
            />
          </KeyboardAvoidingModalCard>
        </View>
      </Modal>

      <Modal
        visible={Boolean(pendingBatch)}
        animationType="slide"
        transparent
        onRequestClose={cancelReview}
      >
        <View style={styles.backdrop}>
          <KeyboardAvoidingModalCard
            frameStyle={styles.reviewFrame}
            contentContainerStyle={styles.cardContent}
          >
            <ModalHeader
              title="Review Imported Schedule"
              subtitle={pendingBatch
                ? `${pendingBatch.sourceCount} ${pendingBatch.sourceCount === 1 ? 'source' : 'sources'} • ${counts.ready} ready • ${counts.needsReview} need review`
                : ''}
              onClose={cancelReview}
            />

            {pendingBatch ? <Text style={styles.reviewMessage}>{pendingBatch.message}</Text> : null}
            {pendingBatch ? (
              <Text style={styles.bulkSaveText}>
                Review Project, Area, Task, Dates, Status, and Owner. Accept only the activities you want DAVE to use.
              </Text>
            ) : null}

            {pendingBatch ? (
              <View style={styles.bulkSaveCard}>
                <Text style={styles.bulkSaveTitle}>Save the complete imported schedule</Text>
                <Text style={styles.bulkSaveText}>
                  Missing project, area, or owner values will remain unassigned. You can edit them later without holding up the import.
                </Text>
                <PrimaryButton
                  label={pendingBatch.items.every(scheduleImportItemHasCoreFacts)
                    ? `Accept All (${counts.total})`
                    : 'Complete Missing Tasks or Dates'}
                  icon="checkmark-circle-outline"
                  onPress={saveAllItems}
                  disabled={!pendingBatch.items.every(scheduleImportItemHasCoreFacts)}
                />
                {counts.ready > 0 && counts.needsReview > 0 ? (
                  <SecondaryButton
                    label={`Accept Selected (${counts.ready})`}
                    icon="checkmark-outline"
                    onPress={approveReadyItems}
                  />
                ) : null}
              </View>
            ) : null}

            {pendingBatch?.items.map((item, index) => {
              const missing = scheduleImportReviewFields(item);
              const needsReview = missing.length > 0;
              const needsCompletionVerification = scheduleItemNeedsCompletionVerification(item);
              const verificationLabel = scheduleCompletionVerificationLabel(item);
              const expanded = expandedItemIds.includes(item.id);

              return (
                <View key={item.id} style={[styles.itemCard, needsReview && styles.itemCardReview]}>
                  <View style={styles.itemHeader}>
                    <View style={styles.itemHeaderText}>
                      <Text style={styles.itemEyebrow}>Activity {index + 1}</Text>
                      <Text style={styles.itemStatus}>
                        {needsCompletionVerification
                          ? verificationLabel
                          : needsReview ? `Needs ${missing.join(', ')}` : 'Ready to add'}
                      </Text>
                    </View>
                    <Ionicons
                      name={needsReview ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                      size={24}
                      color={needsReview ? colors.warning : colors.success}
                    />
                  </View>

                  {expanded ? (
                    <>
                      {needsCompletionVerification ? (
                        <View style={styles.verificationNotice}>
                          <Text style={styles.verificationTitle}>Completion is not verified</Text>
                          <Text style={styles.bulkSaveText}>
                            DAVE will preserve this source as a completion report. The schedule will change to Complete only after PM confirmation or supporting evidence.
                          </Text>
                        </View>
                      ) : null}
                      <ReviewInput label="Task" value={item.taskName} onChangeText={taskName => updatePendingItem(item.id, { taskName })} highlight={missing.includes('task')} />
                      <ReviewInput label="Project" value={item.projectName} onChangeText={projectName => updatePendingItem(item.id, { projectName })} highlight={missing.includes('project')} />
                      <ReviewInput label="Area" value={item.locationName} onChangeText={locationName => updatePendingItem(item.id, { locationName })} highlight={missing.includes('area')} />
                      <ReviewInput label="Finish / due date" value={item.finishDate} onChangeText={finishDate => updatePendingItem(item.id, { finishDate })} placeholder="MM/DD/YYYY" highlight={missing.includes('date')} />
                      <ReviewInput label="Owner" value={item.owner} onChangeText={owner => updatePendingItem(item.id, { owner })} highlight={missing.includes('owner')} />
                    </>
                  ) : (
                    <View style={styles.compactSummary}>
                      <Text style={styles.compactTask}>{item.taskName}</Text>
                      {needsCompletionVerification ? (
                        <Text style={styles.verificationTitle}>{verificationLabel}</Text>
                      ) : null}
                      <Text style={styles.compactDetail}>
                        {item.projectName || 'Project unassigned'} • {item.locationName || 'Area unassigned'}
                      </Text>
                      <Text style={styles.compactDetail}>
                        {item.finishDate || 'Date required'} • {item.owner || 'Owner unassigned'}
                      </Text>
                      <TouchableOpacity
                        style={styles.editLink}
                        onPress={() => setExpandedItemIds(current => [...current, item.id])}
                        accessibilityRole="button"
                      >
                        <Text style={styles.editLinkText}>Review or edit</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}

            <SecondaryButton label="Reject Import" icon="close-outline" onPress={cancelReview} />
          </KeyboardAvoidingModalCard>
        </View>
      </Modal>
    </>
  );
}

function ModalHeader({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) {
  return (
    <View style={styles.modalHeader}>
      <View style={styles.itemHeaderText}>
        <Text style={styles.modalTitle}>{title}</Text>
        <Text style={styles.modalSubtitle}>{subtitle}</Text>
      </View>
      <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel={`Close ${title}`}>
        <Ionicons name="close" size={22} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

function ImportChoice({ icon, title, detail, disabled = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.choice, disabled && styles.choiceDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ disabled }}
    >
      <View style={styles.choiceIcon}><Ionicons name={icon} size={24} color={colors.primary} /></View>
      <View style={styles.itemHeaderText}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.mutedText} />
    </TouchableOpacity>
  );
}

function ReviewInput({ label, value, onChangeText, placeholder, highlight = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; highlight?: boolean }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={[styles.input, highlight && styles.inputReview]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor={colors.mutedText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  choiceFrame: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  reviewFrame: { maxHeight: '94%', backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  cardContent: { padding: spacing.lg, paddingBottom: Platform.OS === 'ios' ? 36 : spacing.lg, gap: spacing.md },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  modalTitle: { ...typography.h2 },
  modalSubtitle: { ...typography.body, color: colors.mutedText, marginTop: spacing.xs },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  choice: { minHeight: 76, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  choiceDisabled: { opacity: 0.55 },
  choiceIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  choiceTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  choiceDetail: { color: colors.mutedText, fontSize: 13, lineHeight: 18, marginTop: 2 },
  loadingCard: { minHeight: 72, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  loadingCopy: { flex: 1 },
  loadingTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  loadingText: { color: colors.mutedText, fontSize: 13, lineHeight: 18, marginTop: 2 },
  cancelLoadingButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  reviewMessage: { ...typography.body, color: colors.mutedText },
  bulkSaveCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft, padding: spacing.md, gap: spacing.sm },
  bulkSaveTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '800' },
  bulkSaveText: { color: colors.mutedText, fontSize: 14, lineHeight: 20 },
  verificationNotice: { borderRadius: 14, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoft, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  verificationTitle: { color: colors.warning, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  itemCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.md },
  itemCardReview: { borderColor: colors.warning },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  itemHeaderText: { flex: 1 },
  itemEyebrow: { color: colors.mutedText, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  itemStatus: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  inputGroup: { marginTop: spacing.sm },
  inputLabel: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 15, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  inputReview: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  inlineChoices: { gap: spacing.sm },
  compactSummary: { gap: spacing.xs },
  compactTask: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  compactDetail: { color: colors.mutedText, fontSize: 13, lineHeight: 18 },
  editLink: { minHeight: 36, alignSelf: 'flex-start', justifyContent: 'center' },
  editLinkText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
});
