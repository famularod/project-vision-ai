import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { ScheduleImportReviewError } from '../services/ScheduleImportScopeGuard';
import {
  scheduleImportAsksRole,
  suggestScheduleImportRole,
  withScheduleImportRole,
  type ScheduleImportRole,
  type ScheduleImportRoleSuggestion,
} from '../services/ScheduleLookahead';
import { colors, spacing, typography } from '../theme';
import type { ReferenceDocument, ScheduleItem } from '../types';
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
  incomingBatch = null,
  onIncomingBatchConsumed,
  roleContext,
}: {
  screenshotImportAvailable: boolean;
  onImportFile: (onProcessingStart: () => void) => Promise<PIEScheduleImportBatch | null>;
  onImportScreenshots: (onProcessingStart: () => void) => Promise<PIEScheduleImportBatch | null>;
  onAddManually: () => void;
  onApprove: (batch: PIEScheduleImportBatch) => Promise<void>;
  onCancel: (batch: PIEScheduleImportBatch) => void;
  incomingBatch?: PIEScheduleImportBatch | null;
  onIncomingBatchConsumed?: () => void;
  /** The schedules and tasks saved now: the review's "Full schedule" or "Lookahead" default (owner answer Q22). */
  roleContext?: Readonly<{ documents: readonly ReferenceDocument[]; items: readonly ScheduleItem[] }>;
}) {
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingBatch, setPendingBatch] = useState<PIEScheduleImportBatch | null>(null);
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);
  // How the schedule is used: suggested when the review opens, David's choice after (owner answer Q22).
  const [roleReview, setRoleReview] = useState<ScheduleImportRoleSuggestion & { batchId: string; chosen: ScheduleImportRole | null } | null>(null);
  const importOperationRef = useRef(0);
  const pendingChoiceRef = useRef<'file' | 'screenshots' | 'manual' | null>(null);
  const counts = useMemo(
    () => scheduleImportBatchCounts(pendingBatch?.items || []),
    [pendingBatch?.items],
  );
  const batchWarnings = useMemo(
    () => scheduleImportWarnings(pendingBatch),
    [pendingBatch],
  );

  function openReview(batch: PIEScheduleImportBatch) {
    setExpandedItemIds([]);
    setSaveError(null);
    setRoleReview({
      ...suggestScheduleImportRole({ batch, documents: roleContext?.documents || [], scheduleItems: roleContext?.items || [] }),
      batchId: batch.id,
      chosen: null,
    });
    setPendingBatch(batch);
  }

  /** The batch with its schedule file marked as reviewed. */
  function withReviewedRole(batch: PIEScheduleImportBatch): PIEScheduleImportBatch {
    if (!scheduleImportAsksRole(batch) || roleReview?.batchId !== batch.id) return batch;
    return withScheduleImportRole(batch, roleReview.chosen || roleReview.role);
  }

  useEffect(() => {
    if (!incomingBatch || pendingBatch || busyLabel || saveBusy) return;
    openReview(incomingBatch);
    onIncomingBatchConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- openReview reads the saved schedules when the review opens
  }, [busyLabel, incomingBatch, onIncomingBatchConsumed, pendingBatch, saveBusy]);

  async function beginImport(
    label: string,
    importer: (onProcessingStart: () => void) => Promise<PIEScheduleImportBatch | null>,
  ) {
    if (busyLabel || saveBusy) return;

    const operationId = ++importOperationRef.current;

    try {
      const batch = await importer(() => {
        if (operationId === importOperationRef.current) setBusyLabel(label);
      });
      if (operationId !== importOperationRef.current) {
        if (batch) onCancel(batch);
        return;
      }
      if (batch) openReview(batch);
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
    if (saveBusy) return;
    setSaveError(null);
    setExpandedItemIds(current => current.includes(itemId) ? current : [...current, itemId]);
    setPendingBatch(current => current ? {
      ...current,
      items: current.items.map(item => item.id === itemId ? { ...item, ...next } : item),
    } : null);
  }

  async function approveReadyItems() {
    if (!pendingBatch || saveBusy) return;

    const batchToReview = pendingBatch;
    const readyItems = batchToReview.items.filter(scheduleImportItemIsReady);
    const remainingItems = batchToReview.items.filter(item => !scheduleImportItemIsReady(item));
    if (!readyItems.length) return;

    setSaveError(null);
    setSaveBusy(true);
    try {
      await onApprove(withReviewedRole({ ...batchToReview, items: readyItems }));

      if (remainingItems.length) {
        setPendingBatch(current => current?.id === batchToReview.id ? {
          ...batchToReview,
          items: remainingItems,
          documents: [],
          message: `${readyItems.length} ready ${readyItems.length === 1 ? 'item was' : 'items were'} saved. Complete the highlighted fields to save the rest.`,
        } : current);
      } else {
        setPendingBatch(current => current?.id === batchToReview.id ? null : current);
        setExpandedItemIds([]);
      }
    } catch (error) {
      setSaveError(scheduleImportSaveErrorText(error));
    } finally {
      setSaveBusy(false);
    }
  }

  async function saveAllItems() {
    if (
      !pendingBatch ||
      saveBusy ||
      !pendingBatch.items.every(scheduleImportItemHasCoreFacts)
    ) return;

    const batchToSave = pendingBatch;
    setSaveError(null);
    setSaveBusy(true);
    try {
      await onApprove(withReviewedRole(batchToSave));
      setPendingBatch(current => current?.id === batchToSave.id ? null : current);
      setExpandedItemIds([]);
    } catch (error) {
      setSaveError(scheduleImportSaveErrorText(error));
    } finally {
      setSaveBusy(false);
    }
  }

  function cancelReview() {
    if (!pendingBatch || saveBusy) return;
    onCancel(pendingBatch);
    setSaveError(null);
    setPendingBatch(null);
  }

  return (
    <>
      <View style={styles.inlineChoices}>
        <PrimaryButton
          label="Add Schedule or Task"
          icon="add-circle-outline"
          disabled={Boolean(busyLabel) || saveBusy}
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
        onRequestClose={() => {
          if (!saveBusy) cancelReview();
        }}
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
              disabled={saveBusy}
            />

            {pendingBatch ? <Text style={styles.reviewMessage}>{pendingBatch.message}</Text> : null}
            {batchWarnings.length ? (
              <View style={styles.warningCard} accessibilityRole="alert">
                <View style={styles.warningHeader}>
                  <Ionicons name="warning-outline" size={22} color={colors.warning} />
                  <Text style={styles.warningTitle}>Review import warnings</Text>
                </View>
                {batchWarnings.map((warning, index) => (
                  <Text key={`${warning}-${index}`} style={styles.warningText}>
                    • {warning}
                  </Text>
                ))}
              </View>
            ) : null}
            {saveError ? (
              <View style={styles.saveErrorCard} accessibilityRole="alert">
                <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
                <Text style={styles.saveErrorText}>{saveError}</Text>
              </View>
            ) : null}
            {saveBusy ? (
              <View style={styles.savingCard} accessibilityRole="progressbar">
                <ActivityIndicator size="small" color={colors.primary} />
                <View style={styles.loadingCopy}>
                  <Text style={styles.loadingTitle}>Saving reviewed schedule…</Text>
                  <Text style={styles.loadingText}>
                    Keep this review open until Vitruvius confirms the save.
                  </Text>
                </View>
              </View>
            ) : null}
            {pendingBatch && scheduleImportAsksRole(pendingBatch) && roleReview?.batchId === pendingBatch.id ? (
              <ScheduleRoleReview
                review={roleReview}
                disabled={saveBusy}
                onChoose={chosen => setRoleReview(current => current ? { ...current, chosen } : current)}
              />
            ) : null}
            {pendingBatch ? (
              <Text style={styles.bulkSaveText}>
                Review Project, Area, Task, Dates, Status, and Owner. Accept only the activities you want ECOS to use.
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
                  onPress={() => void saveAllItems()}
                  disabled={saveBusy || !pendingBatch.items.every(scheduleImportItemHasCoreFacts)}
                />
                {counts.ready > 0 && counts.needsReview > 0 ? (
                  <SecondaryButton
                    label={`Accept Selected (${counts.ready})`}
                    icon="checkmark-outline"
                    onPress={() => void approveReadyItems()}
                    disabled={saveBusy}
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
                            ECOS will preserve this source as a completion report. The schedule will change to Complete only after PM confirmation or supporting evidence.
                          </Text>
                        </View>
                      ) : null}
                      <ReviewInput label="Task" value={item.taskName} onChangeText={taskName => updatePendingItem(item.id, { taskName })} highlight={missing.includes('task')} disabled={saveBusy} />
                      <ReviewInput label="Project" value={item.projectName} onChangeText={projectName => updatePendingItem(item.id, { projectName })} highlight={missing.includes('project')} disabled={saveBusy} />
                      <ReviewInput label="Area" value={item.locationName} onChangeText={locationName => updatePendingItem(item.id, { locationName })} highlight={missing.includes('area')} disabled={saveBusy} />
                      <ReviewInput label="Finish / due date" value={item.finishDate} onChangeText={finishDate => updatePendingItem(item.id, { finishDate })} placeholder="MM/DD/YYYY" highlight={missing.includes('date')} disabled={saveBusy} />
                      <ReviewInput label="Owner" value={item.owner} onChangeText={owner => updatePendingItem(item.id, { owner })} highlight={missing.includes('owner')} disabled={saveBusy} />
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
                        disabled={saveBusy}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: saveBusy }}
                      >
                        <Text style={styles.editLinkText}>Review or edit</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}

            <SecondaryButton
              label="Reject Import"
              icon="close-outline"
              onPress={cancelReview}
              disabled={saveBusy}
            />
          </KeyboardAvoidingModalCard>
        </View>
      </Modal>
    </>
  );
}

const SCHEDULE_ROLE_CHOICES: readonly { role: ScheduleImportRole; title: string; detail: string }[] = [
  {
    role: 'master',
    title: 'Full schedule (replaces)',
    detail: 'Use this file as the whole schedule for its projects. It replaces the schedule in use for them.',
  },
  {
    role: 'lookahead',
    title: 'Lookahead / partial (adds to the master)',
    detail: 'Keep the master schedule. A task in both files shows once, with this file’s dates and progress. Tasks only in this file are added. The master’s other tasks stay.',
  },
];

/** "How should Vitruvius use this schedule?" (owner answer Q22). */
function ScheduleRoleReview({
  review,
  disabled,
  onChoose,
}: {
  review: ScheduleImportRoleSuggestion & { chosen: ScheduleImportRole | null };
  disabled: boolean;
  onChoose: (role: ScheduleImportRole) => void;
}) {
  const selected = review.chosen || review.role;
  const suggested = SCHEDULE_ROLE_CHOICES.find(choice => choice.role === review.role);
  return (
    <View style={styles.bulkSaveCard} accessibilityRole="radiogroup">
      <Text style={styles.bulkSaveTitle}>How should Vitruvius use this schedule?</Text>
      {SCHEDULE_ROLE_CHOICES.map(choice => (
        <TouchableOpacity
          key={choice.role}
          style={[styles.roleChoice, selected === choice.role && styles.roleChoiceSelected, disabled && styles.controlDisabled]}
          onPress={() => onChoose(choice.role)}
          disabled={disabled}
          accessibilityRole="radio"
          accessibilityLabel={`${choice.title}. ${choice.detail}`}
          accessibilityState={{ checked: selected === choice.role, disabled }}
        >
          <Ionicons
            name={selected === choice.role ? 'radio-button-on' : 'radio-button-off'}
            size={22}
            color={colors.primary}
          />
          <View style={styles.itemHeaderText}>
            <Text style={styles.choiceTitle}>{choice.title}</Text>
            <Text style={styles.choiceDetail}>{choice.detail}</Text>
          </View>
        </TouchableOpacity>
      ))}
      <Text style={styles.bulkSaveText}>
        {`Suggested: ${suggested?.title || ''}, because ${review.reason}. You can change this before saving.`}
      </Text>
    </View>
  );
}

function ModalHeader({
  title,
  subtitle,
  onClose,
  disabled = false,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.modalHeader}>
      <View style={styles.itemHeaderText}>
        <Text style={styles.modalTitle}>{title}</Text>
        <Text style={styles.modalSubtitle}>{subtitle}</Text>
      </View>
      <TouchableOpacity
        style={[styles.closeButton, disabled && styles.controlDisabled]}
        onPress={onClose}
        disabled={disabled}
        accessibilityLabel={`Close ${title}`}
        accessibilityState={{ disabled }}
      >
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

function ReviewInput({
  label,
  value,
  onChangeText,
  placeholder,
  highlight = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  highlight?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={[styles.input, highlight && styles.inputReview]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor={colors.mutedText}
        editable={!disabled}
      />
    </View>
  );
}

const scheduleImportSaveErrorMessage =
  'Vitruvius could not finish saving this schedule. Your review is still open and unchanged. Try again.';

/** A reason the manager can fix in the review is shown as is (whole-app audit A5, 30 Sep 2026). */
function scheduleImportSaveErrorText(error: unknown) {
  return error instanceof ScheduleImportReviewError
    ? `${error.message} Your review is still open.`
    : scheduleImportSaveErrorMessage;
}

function scheduleImportWarnings(batch: PIEScheduleImportBatch | null) {
  if (!batch) return [];
  const warnings = (
    batch as PIEScheduleImportBatch & { warnings?: unknown }
  ).warnings;
  if (!Array.isArray(warnings)) return [];

  return warnings
    .filter((warning): warning is string => typeof warning === 'string')
    .map(warning => warning.trim())
    .filter(Boolean);
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
  warningCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoft, padding: spacing.md, gap: spacing.xs },
  warningHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  warningTitle: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  warningText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  saveErrorCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoft, padding: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  saveErrorText: { flex: 1, color: colors.danger, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  savingCard: { minHeight: 72, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  controlDisabled: { opacity: 0.45 },
  roleChoice: { minHeight: 64, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.sm, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  roleChoiceSelected: { borderColor: colors.primary, borderWidth: 2 },
});
