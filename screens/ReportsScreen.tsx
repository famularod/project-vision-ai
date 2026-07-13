import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import type {
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screen } from '../components/layout/Screen';
import { ScreenCard } from '../components/layout/ScreenCard';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { PIEPanel } from '../components/PIEPanel';
import {
  colors,
  spacing,
  typography,
} from '../theme';
import type {
  ContactBook,
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import type { ProjectSyncFreshnessMetadata } from '../services/ProjectIntelligenceEngine';
import { buildPIEAttentionState } from '../services/PIEAttentionEngine';
import {
  buildPIEReviewExperience,
  type PIEExperienceAction,
  type PIEExperienceOutput,
} from '../services/PIEExperienceEngine';
import {
  type PIEReportDraft,
  type PIEReportType,
} from '../services/PIEReporter';
import type { PIEExecutiveJudgmentRecord } from '../services/PIEExecutiveJudgmentRepository';
import { usePIELiveAuthority } from '../providers/PIELiveAuthorityProvider';
import type {
  PIEImplementationQuality,
  PIEOutcomeClassification,
  PIEOutcomeValidationStatus,
  PIEDecisionRecord,
  PIEEvidenceReference,
} from '../services/PIEDecisionLedger';
import type { PIELayer4ActorContext } from '../services/PIELayer4Identity';
import type {
  PIEDecisionLedgerMigrationStatus,
} from '../services/PIEDecisionLedgerStorage';
import type { PIEDecisionSyncMetadata } from '../services/PIEDecisionLedgerSync';

type IconName = keyof typeof Ionicons.glyphMap;
type ReportFormat = 'project_manager' | 'executive';

type ReportCardProps = {
  title: string;
  description: string;
  icon: IconName;
  onPress?: () => void;
};

export function ReportsScreen({
  contentStyle,
  projectName,
  reportType,
  onReportTypeChange,
  reportFormat,
  onReportFormatChange,
  updates,
  scheduleItems,
  currentUpdate,
  projectAreas,
  contacts,
  referenceDocuments,
  syncMetadata,
  decisionLedger,
  layer4Identity,
  decisionLedgerMigrationStatus,
  decisionSyncMetadata,
  decisionEvidenceReferences,
  onCreateDecisionSnapshot,
  onApproveDecision,
  onRejectDecision,
  onDeferDecision,
  onCancelDecision,
  onImplementDecision,
  onMoveDecisionToAwaitingOutcome,
  onAppendCorrectedDecisionVersion,
  onRecordImplementationQuality,
  onRecordActualOutcome,
  onValidateOutcome,
  onCloseDecision,
  onRetryDecisionLedgerSync,
  onWeeklyExecutiveReport,
  onProjectHealthReport,
  onCriticalPathReport,
  onMilestoneReport,
  onSavedUpdates,
  onCopyReport,
  onEmailReport,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projectName: string;
  reportType: Extract<PIEReportType, 'daily_project_update' | 'combined_project_update'>;
  onReportTypeChange: (
    reportType: Extract<PIEReportType, 'daily_project_update' | 'combined_project_update'>,
  ) => void;
  reportFormat: ReportFormat;
  onReportFormatChange: (format: ReportFormat) => void;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
  projectAreas?: ProjectArea[];
  contacts?: ContactBook;
  referenceDocuments?: ReferenceDocument[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  decisionLedger?: PIEDecisionRecord[];
  layer4Identity?: PIELayer4ActorContext | null;
  decisionLedgerMigrationStatus?: PIEDecisionLedgerMigrationStatus | null;
  decisionSyncMetadata?: Record<string, PIEDecisionSyncMetadata>;
  decisionEvidenceReferences?: PIEEvidenceReference[];
  onCreateDecisionSnapshot?: (judgment: PIEExecutiveJudgmentRecord | null | undefined, silent?: boolean) => void;
  onApproveDecision?: (decisionId: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onRejectDecision?: (decisionId: string, reason: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onDeferDecision?: (decisionId: string, reason: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onCancelDecision?: (decisionId: string, reason: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onImplementDecision?: (decisionId: string, planText: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onMoveDecisionToAwaitingOutcome?: (decisionId: string, reason: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onAppendCorrectedDecisionVersion?: (decisionId: string, reason: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onRecordImplementationQuality?: (
    decisionId: string,
    quality: PIEImplementationQuality,
    note: string,
    linkedEvidence?: PIEEvidenceReference[],
  ) => void;
  onRecordActualOutcome?: (
    decisionId: string,
    classification: PIEOutcomeClassification,
    summary: string,
    linkedEvidence?: PIEEvidenceReference[],
  ) => void;
  onValidateOutcome?: (
    decisionId: string,
    validationStatus: PIEOutcomeValidationStatus,
    linkedEvidence?: PIEEvidenceReference[],
  ) => void;
  onCloseDecision?: (decisionId: string) => void;
  onRetryDecisionLedgerSync?: () => void;
  onWeeklyExecutiveReport?: () => void;
  onProjectHealthReport?: () => void;
  onCriticalPathReport?: () => void;
  onMilestoneReport?: () => void;
  onSavedUpdates: () => void;
  onCopyReport: (report: PIEReportDraft) => void;
  onEmailReport: (report: PIEReportDraft) => void;
}) {
  const [reporterOpen, setReporterOpen] = useState(false);
  const [reportApproved, setReportApproved] = useState(false);
  const [reportEditing, setReportEditing] = useState(false);
  const [reportEdits, setReportEdits] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const [communicationComplete, setCommunicationComplete] = useState(false);
  const [preparedDetailsOpen, setPreparedDetailsOpen] = useState(false);
  const [advancedReviewOpen, setAdvancedReviewOpen] = useState(false);
  const [autoDecisionKey, setAutoDecisionKey] = useState('');
  const liveAuthority = usePIELiveAuthority();
  const runtime = liveAuthority.runtime;
  const openDecisions = runtime.priorityQueue.approvalRequired.length;
  const openQuestions = runtime.reasoning.questions.length;
  const communicationReady =
    runtime.intelligence.communicationReadiness.level === 'ready';
  const selectedProjectNames = useMemo(
    () =>
      reportType === 'combined_project_update'
        ? Array.from(
            new Set([
              projectName,
              ...updates.map(update => update.projectName),
              ...scheduleItems.map(item => item.projectName),
            ].filter(Boolean)),
          )
        : [projectName],
    [projectName, reportType, scheduleItems, updates],
  );
  const pieReportDraft = liveAuthority.reportDraft || runtime.response.reportDraft;
  const effectiveReportDraft = useMemo<PIEReportDraft>(
    () => reportEdits
      ? {
          ...pieReportDraft,
          title: reportEdits.title,
          subject: reportEdits.title,
          body: reportEdits.body,
        }
      : pieReportDraft,
    [pieReportDraft, reportEdits],
  );
  const reportAuthorityMessage = liveAuthority.executiveJudgmentRecord
    ? null
    : 'Draft recovery mode: DAVE is preparing the persisted Executive Judgment before final report and decision creation.';
  const decisionCandidateKey = [
    reportType,
    projectName,
    pieReportDraft.actionItems[0]?.action ||
      pieReportDraft.decisionsNeeded[0]?.question ||
      pieReportDraft.executiveSummary[0] ||
      pieReportDraft.title,
    pieReportDraft.confidence,
  ].join('|');

  useEffect(() => {
    setReportEdits(null);
    setReportEditing(false);
    setReportApproved(false);
  }, [pieReportDraft.id]);

  useEffect(() => {
    if (
      !onCreateDecisionSnapshot ||
      !liveAuthority.policy.layer4DecisionCreationAllowed ||
      autoDecisionKey === decisionCandidateKey
    ) {
      return;
    }
    setAutoDecisionKey(decisionCandidateKey);
    onCreateDecisionSnapshot(liveAuthority.executiveJudgmentRecord, true);
  }, [
    autoDecisionKey,
    decisionCandidateKey,
    liveAuthority.policy.layer4DecisionCreationAllowed,
    liveAuthority.executiveJudgmentRecord,
    onCreateDecisionSnapshot,
  ]);
  const attentionState = liveAuthority.attention || buildPIEAttentionState({ runtime });
  const reviewExperience = buildPIEReviewExperience({
    runtime,
    attentionState,
    context: {
      surface: 'review',
      reportDraft: reporterOpen ? pieReportDraft : null,
      reportApproved,
      reportEditing,
      communicationReady: reportApproved,
      communicationComplete,
      combinedUpdateSelectedItems: selectedProjectNames.length,
      scheduleImportStatus: scheduleItems.length > 0 ? 'loaded' : 'missing',
      photoProgressStatus: runtime.photoProgressSummary,
    },
  });
  const markReportApproved = () => {
    setReporterOpen(true);
    setReportEditing(false);
    setReportApproved(true);
  };
  const handleReviewExperienceAction = (action: PIEExperienceAction) => {
    if (action === 'approve') {
      markReportApproved();
      return;
    }

    if (action === 'communicate') {
      if (!reportApproved) {
        markReportApproved();
        return;
      }

      onCopyReport(effectiveReportDraft);
      setCommunicationComplete(true);
      return;
    }

    if (action === 'correct') {
      setReporterOpen(true);
      setReportEditing(true);
      return;
    }

    setReporterOpen(true);
  };

  return (
    <Screen contentStyle={contentStyle}>
      <ScreenHeader
        title="Reports"
        subtitle={`${projectName} · Review, approve, and communicate what DAVE has prepared.`}
      />

      <ReviewExperiencePanel
        experience={reviewExperience}
        reportApproved={reportApproved}
        onPrimaryAction={() =>
          handleReviewExperienceAction(reviewExperience.primaryAction)
        }
        onSecondaryAction={
          reviewExperience.secondaryAction
            ? () => handleReviewExperienceAction(reviewExperience.secondaryAction!)
            : undefined
        }
      />

      <ScreenCard style={styles.preparedCard}>
        <TouchableOpacity
          style={styles.preparedHeaderButton}
          onPress={() => setPreparedDetailsOpen(open => !open)}
          accessibilityRole="button"
          accessibilityLabel="Show what DAVE prepared"
        >
          <View style={styles.reporterIcon}>
            <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
          </View>

          <View style={styles.reporterHeaderText}>
            <Text style={styles.preparedTitle}>
              DAVE Prepared Items
            </Text>

            <Text style={styles.reporterHelp}>
              Proposed summary, key changes, critical items, and open questions.
            </Text>
          </View>

          <Ionicons
            name={preparedDetailsOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={20}
            color={colors.tertiaryText}
          />
        </TouchableOpacity>

        {preparedDetailsOpen ? (
          <View style={styles.preparedList}>
            <PreparedReportItem title="Project Update Draft" detail="Open the prepared report below to review, correct, approve, copy, or email." onPress={() => setReporterOpen(true)} />
            <PreparedReportItem title={`${openDecisions} open decision${openDecisions === 1 ? '' : 's'}`} detail="Approve, reject, correct, or defer only when human authority is required." onPress={() => setAdvancedReviewOpen(true)} />
            <PreparedReportItem title={`${openQuestions} question${openQuestions === 1 ? '' : 's'} needing answers`} detail="Add missing information if DAVE cannot verify a conclusion." onPress={() => setReporterOpen(true)} />
            <PreparedReportItem title={communicationReady ? 'Communication readiness: ready for review' : 'Communication readiness: needs more evidence'} detail="DAVE keeps draft sharing blocked until review and approval are complete." onPress={() => setReporterOpen(true)} />
          </View>
        ) : null}
      </ScreenCard>

      <ScreenCard style={styles.reporterCard}>
        <View style={styles.reporterHeader}>
          <View style={styles.reporterIcon}>
            <Ionicons
              name="document-text-outline"
              size={24}
              color={colors.primary}
            />
          </View>

          <View style={styles.reporterHeaderText}>
            <Text style={styles.preparedTitle}>
              DAVE Reporter
            </Text>

            <Text style={styles.reporterHelp}>
              Generate a David-style project update draft for review before copying or emailing.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.generateReportButton}
          onPress={() => setReporterOpen(open => !open)}
          accessibilityRole="button"
          accessibilityLabel="Generate DAVE Project Update"
        >
          <Ionicons
            name="sparkles-outline"
            size={20}
            color="#FFFFFF"
          />

          <Text style={styles.generateReportText}>
            Generate DAVE Project Update
          </Text>
        </TouchableOpacity>

        {reporterOpen ? (
          <PIEReporterPreview
            reportDraft={effectiveReportDraft}
            hasManualEdits={Boolean(reportEdits)}
            authorityMessage={reportAuthorityMessage}
            reportType={reportType}
            reportFormat={reportFormat}
            onReportTypeChange={nextReportType => {
              onReportTypeChange(nextReportType);
              setReportApproved(false);
              setReportEditing(false);
              setReportEdits(null);
              setCommunicationComplete(false);
            }}
            onReportFormatChange={nextFormat => {
              onReportFormatChange(nextFormat);
              setReportApproved(false);
              setReportEditing(false);
              setReportEdits(null);
              setCommunicationComplete(false);
            }}
            reportApproved={reportApproved}
            reportEditing={reportEditing}
            onApproveReport={markReportApproved}
            onEditReport={() => {
              setReportEditing(true);
              setReportApproved(false);
            }}
            onTitleChange={title => {
              setReportEdits(current => ({
                title,
                body: current?.body ?? pieReportDraft.body,
              }));
            }}
            onBodyChange={body => {
              setReportEdits(current => ({
                title: current?.title ?? pieReportDraft.title,
                body,
              }));
            }}
            onCopyReport={() => {
              onCopyReport(effectiveReportDraft);
              setCommunicationComplete(true);
            }}
            onEmailReport={() => {
              onEmailReport(effectiveReportDraft);
              setCommunicationComplete(true);
            }}
          />
        ) : null}
      </ScreenCard>

      <TouchableOpacity
        style={styles.advancedToggleButton}
        onPress={() => setAdvancedReviewOpen(open => !open)}
        accessibilityRole="button"
        accessibilityLabel="Show advanced review details"
      >
        <Ionicons
          name="information-circle-outline"
          size={19}
          color={colors.primary}
        />

        <Text style={styles.advancedToggleText}>
          {advancedReviewOpen ? 'Hide Details' : 'Why DAVE recommends this'}
        </Text>

        <Ionicons
          name={advancedReviewOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
          size={18}
          color={colors.primary}
        />
      </TouchableOpacity>

      {advancedReviewOpen ? (
        <>
          <PIEPanel
            projectName={projectName}
            updates={updates}
            scheduleItems={scheduleItems}
            currentUpdate={currentUpdate}
            projectAreas={projectAreas}
            contacts={contacts}
            referenceDocuments={referenceDocuments}
            syncMetadata={syncMetadata}
            title="Supporting Evidence"
            subtitle="Evidence, uncertainty, and reasoning behind DAVE's recommendation."
          />

          <DecisionLedgerPanel
            decisions={decisionLedger || []}
            reportDraft={effectiveReportDraft}
            layer4Identity={layer4Identity || null}
            migrationStatus={decisionLedgerMigrationStatus || null}
            syncMetadata={decisionSyncMetadata || {}}
            availableEvidence={decisionEvidenceReferences || []}
            onCreateDecisionSnapshot={onCreateDecisionSnapshot}
            onApproveDecision={onApproveDecision}
            onRejectDecision={onRejectDecision}
            onDeferDecision={onDeferDecision}
            onCancelDecision={onCancelDecision}
            onImplementDecision={onImplementDecision}
            onMoveDecisionToAwaitingOutcome={onMoveDecisionToAwaitingOutcome}
            onAppendCorrectedDecisionVersion={onAppendCorrectedDecisionVersion}
            onRecordImplementationQuality={onRecordImplementationQuality}
            onRecordActualOutcome={onRecordActualOutcome}
            onValidateOutcome={onValidateOutcome}
            onCloseDecision={onCloseDecision}
            onRetryDecisionLedgerSync={onRetryDecisionLedgerSync}
          />
        </>
      ) : null}

      {advancedReviewOpen ? (
        <View style={styles.reviewActionStack}>
        {onWeeklyExecutiveReport ? (
          <ReportCard
            title="Weekly Executive Review"
            description="Summarize weekly progress, risks, schedule movement, and action items."
            icon="newspaper-outline"
            onPress={onWeeklyExecutiveReport}
          />
        ) : null}

        {onProjectHealthReport ? (
          <ReportCard
            title="Project Health Report"
            description="Review risk, overdue work, stale updates, safety items, and status signals."
            icon="pulse-outline"
            onPress={onProjectHealthReport}
          />
        ) : null}

        {onCriticalPathReport ? (
          <ReportCard
            title="Critical Path Report"
            description="Analyze schedule drivers, blocked work, dependencies, and float risk."
            icon="git-branch-outline"
            onPress={onCriticalPathReport}
          />
        ) : null}

        {onMilestoneReport ? (
          <ReportCard
            title="Milestone Report"
            description="Track milestone progress, dates, slippage, and upcoming checkpoints."
            icon="flag-outline"
            onPress={onMilestoneReport}
          />
        ) : null}

        <ReportCard
          title="Saved History"
          description="Open saved project updates, previous messages, and update history."
          icon="time-outline"
          onPress={onSavedUpdates}
        />
        </View>
      ) : null}
    </Screen>
  );
}

function reviewExperienceActionLabel(
  action: PIEExperienceAction,
  reportApproved: boolean,
) {
  if (action === 'approve') return 'Approve Report';
  if (action === 'communicate') {
    return reportApproved ? 'Copy Report' : 'Approve Report';
  }
  if (action === 'correct') return 'Edit Report';
  if (action === 'review') return 'Review Draft';

  return 'Generate DAVE Project Update';
}

function ReviewExperiencePanel({
  experience,
  reportApproved,
  onPrimaryAction,
  onSecondaryAction,
}: {
  experience: PIEExperienceOutput;
  reportApproved: boolean;
  onPrimaryAction: () => void;
  onSecondaryAction?: () => void;
}) {
  return (
    <ScreenCard style={styles.experienceCard}>
      <View style={styles.experienceHeader}>
        <View style={styles.experienceIcon}>
          <Ionicons
            name="compass-outline"
            size={22}
            color={colors.primary}
          />
        </View>

        <View style={styles.experienceTextGroup}>
          <Text style={styles.experienceEyebrow}>
            DAVE Review Experience
          </Text>

          <Text style={styles.experienceState}>
            {experience.currentState.replace(/_/g, ' ')}
          </Text>
        </View>
      </View>

      <Text style={styles.experienceMessage}>
        {experience.primaryMessage}
      </Text>

      <Text style={styles.experienceReason}>
        {experience.reason}
      </Text>

      {experience.reportTitle ? (
        <View style={styles.experienceMetaRow}>
          <ReportStatusPill
            label="Report"
            value={experience.reportTitle}
          />

          <ReportStatusPill
            label="Readiness"
            value={experience.reportReadiness || 'pending'}
          />
        </View>
      ) : null}

      {experience.reviewWarnings.length > 0 ? (
        <View style={styles.reviewFlagsPanel}>
          <Text style={styles.reportPreviewLabel}>
            DAVE found items that need review.
          </Text>

          {experience.reviewWarnings.slice(0, 4).map((warning, index) => (
            <Text
              key={`${index}-${warning}`}
              style={styles.reviewFlagText}
            >
              • {warning}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.reportActionRow}>
        <TouchableOpacity
          style={styles.reportActionButtonPrimary}
          onPress={onPrimaryAction}
          accessibilityRole="button"
          accessibilityLabel={reviewExperienceActionLabel(
            experience.primaryAction,
            reportApproved,
          )}
        >
          <Ionicons
            name="arrow-forward-outline"
            size={18}
            color="#FFFFFF"
          />

          <Text style={styles.reportActionTextPrimary}>
            {reviewExperienceActionLabel(
              experience.primaryAction,
              reportApproved,
            )}
          </Text>
        </TouchableOpacity>

        {experience.secondaryAction && onSecondaryAction ? (
          <TouchableOpacity
            style={styles.reportActionButton}
            onPress={onSecondaryAction}
            accessibilityRole="button"
            accessibilityLabel={reviewExperienceActionLabel(
              experience.secondaryAction,
              reportApproved,
            )}
          >
            <Text style={styles.reportActionText}>
              {reviewExperienceActionLabel(
                experience.secondaryAction,
                reportApproved,
              )}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </ScreenCard>
  );
}

function PIEReporterPreview({
  reportDraft,
  hasManualEdits,
  authorityMessage,
  reportType,
  reportFormat,
  onReportTypeChange,
  onReportFormatChange,
  reportApproved,
  reportEditing,
  onApproveReport,
  onEditReport,
  onTitleChange,
  onBodyChange,
  onCopyReport,
  onEmailReport,
}: {
  reportDraft: PIEReportDraft;
  hasManualEdits: boolean;
  authorityMessage?: string | null;
  reportType: Extract<PIEReportType, 'daily_project_update' | 'combined_project_update'>;
  reportFormat: ReportFormat;
  onReportTypeChange: (
    reportType: Extract<PIEReportType, 'daily_project_update' | 'combined_project_update'>,
  ) => void;
  onReportFormatChange: (format: ReportFormat) => void;
  reportApproved: boolean;
  reportEditing: boolean;
  onApproveReport: () => void;
  onEditReport: () => void;
  onTitleChange: (title: string) => void;
  onBodyChange: (body: string) => void;
  onCopyReport: () => void;
  onEmailReport: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionItems =
    reportDraft.actionItems.length > 0
      ? reportDraft.actionItems.slice(0, 5)
      : [];
  const imageReferences =
    reportDraft.imageReferences.length > 0
      ? reportDraft.imageReferences.slice(0, 6)
      : [];

  return (
    <View style={styles.reportPreview}>
      <Text style={styles.reportOptionLabel}>
        Report Scope
      </Text>

      <View style={styles.segmentRow}>
        <ReporterTypeButton
          label="Single Project Update"
          selected={reportType === 'daily_project_update'}
          onPress={() => onReportTypeChange('daily_project_update')}
        />

        <ReporterTypeButton
          label="Combined Project Update"
          selected={reportType === 'combined_project_update'}
          onPress={() => onReportTypeChange('combined_project_update')}
        />
      </View>

      <Text style={styles.reportOptionLabel}>
        Report Format
      </Text>

      <View style={styles.segmentRow}>
        <ReporterTypeButton
          label="Project Manager"
          selected={reportFormat === 'project_manager'}
          onPress={() => onReportFormatChange('project_manager')}
        />

        <ReporterTypeButton
          label="Executive Summary"
          selected={reportFormat === 'executive'}
          onPress={() => onReportFormatChange('executive')}
        />
      </View>

      <View style={styles.reportStatusRow}>
        <ReportStatusPill label="Readiness" value={reportDraft.confidence} />
        <ReportStatusPill label="Needs Review" value={reportDraft.needsReview ? 'Yes' : 'No'} />
      </View>

      {authorityMessage ? (
        <View style={styles.reviewFlagsPanel}>
          <Text style={styles.reportPreviewLabel}>
            Review boundary
          </Text>

          <Text style={styles.reviewFlagText}>
            {authorityMessage}
          </Text>
        </View>
      ) : null}

      {reportDraft.reviewFlags.length > 0 ? (
        <View style={styles.reviewFlagsPanel}>
          <Text style={styles.reportPreviewLabel}>
            DAVE found items that need review.
          </Text>

          {reportDraft.reviewFlags.slice(0, 4).map((flag, index) => (
            <Text
              key={`${index}-${flag}`}
              style={styles.reviewFlagText}
            >
              • {flag}
            </Text>
          ))}

          <Text style={styles.reviewFlagHelper}>
            These warnings are for preview only and are not added to the email body by default.
          </Text>
        </View>
      ) : null}

      {reportEditing ? (
        <View style={styles.reportEditFields}>
          <Text style={styles.reportPreviewLabel}>
            Report Title
          </Text>

          <TextInput
            style={[styles.decisionInput, styles.reportTitleInput]}
            value={reportDraft.title}
            onChangeText={onTitleChange}
            placeholder="Report title"
            placeholderTextColor={colors.mutedText}
          />

          <Text style={styles.reportPreviewLabel}>
            Report Body
          </Text>

          <TextInput
            style={[styles.decisionInput, styles.reportBodyInput]}
            value={reportDraft.body}
            onChangeText={onBodyChange}
            multiline
            textAlignVertical="top"
            placeholder="Report body"
            placeholderTextColor={colors.mutedText}
          />
        </View>
      ) : (
        <ReportDocumentPreview
          reportDraft={reportDraft}
          reportFormat={reportFormat}
          useStructuredLayout={!hasManualEdits}
        />
      )}

      {actionItems.length > 0 ? (
        <>
          <TouchableOpacity
            style={styles.expandActionButton}
            onPress={() => setActionsOpen(open => !open)}
            accessibilityRole="button"
            accessibilityLabel="Toggle report action items"
          >
            <Text style={styles.expandActionText}>
              {actionsOpen ? 'Hide' : 'Show'} Action Items ({reportDraft.actionItems.length})
            </Text>

            <Ionicons
              name={actionsOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
              size={18}
              color={colors.primary}
            />
          </TouchableOpacity>

          {actionsOpen ? (
            <View style={styles.reportList}>
              <Text style={styles.reportPreviewLabel}>
                Action Items
              </Text>

              {actionItems.map((item, index) => (
                <Text
                  key={`${item.id}-${index}`}
                  style={styles.reportListText}
                >
                  {item.needsOwner
                    ? `Action Required - ${item.action}`
                    : `${item.owner} - ${item.action}`}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {imageReferences.length > 0 ? (
        <>
          <Text style={styles.reportPreviewLabel}>
            Image References
          </Text>

          <View style={styles.reportList}>
            {imageReferences.map(ref => (
              <Text
                key={ref.photoId}
                style={styles.reportListText}
              >
                Image {ref.imageNumber}: {ref.areaName}
              </Text>
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.reportActionRow}>
        <TouchableOpacity
          style={styles.reportActionButtonPrimary}
          onPress={onApproveReport}
          accessibilityRole="button"
          accessibilityLabel="Approve Report"
        >
          <Ionicons
            name="checkmark-circle-outline"
            size={18}
            color="#FFFFFF"
          />

          <Text style={styles.reportActionTextPrimary}>
            Approve Report
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.reportActionButton}
          onPress={onEditReport}
          accessibilityRole="button"
          accessibilityLabel="Edit Report"
        >
          <Ionicons
            name="create-outline"
            size={18}
            color={colors.primary}
          />

          <Text style={styles.reportActionText}>
            Edit Report
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.reportActionRow}>
        <TouchableOpacity
          style={[
            styles.reportActionButton,
            !reportApproved && styles.reportActionButtonDisabled,
          ]}
          onPress={onCopyReport}
          disabled={!reportApproved}
          accessibilityRole="button"
          accessibilityLabel="Copy Report"
        >
          <Ionicons
            name="copy-outline"
            size={18}
            color={reportApproved ? colors.primary : colors.mutedText}
          />

          <Text
            style={[
              styles.reportActionText,
              !reportApproved && styles.reportActionTextDisabled,
            ]}
          >
            Copy Report
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.reportActionButton,
            !reportApproved && styles.reportActionButtonDisabled,
          ]}
          onPress={onEmailReport}
          disabled={!reportApproved}
          accessibilityRole="button"
          accessibilityLabel="Email Report"
        >
          <Ionicons
            name="mail-outline"
            size={18}
            color={reportApproved ? colors.primary : colors.mutedText}
          />

          <Text
            style={[
              styles.reportActionText,
              !reportApproved && styles.reportActionTextDisabled,
            ]}
          >
            Email Report
          </Text>
        </TouchableOpacity>
      </View>

      {!reportApproved ? (
        <Text style={styles.approvalBoundaryText}>
          Copy and Email unlock after approval. No report is sent automatically.
        </Text>
      ) : null}
    </View>
  );
}

function ReportDocumentPreview({
  reportDraft,
  reportFormat,
  useStructuredLayout,
}: {
  reportDraft: PIEReportDraft;
  reportFormat: ReportFormat;
  useStructuredLayout: boolean;
}) {
  return (
    <View style={styles.reportDocument}>
      <View style={styles.reportDocumentHeader}>
        <Text style={styles.reportDocumentTitle}>
          {reportDraft.title}
        </Text>

        <Text style={styles.reportDocumentType}>
          {reportFormat === 'executive'
            ? 'Executive Summary'
            : 'Project Manager Report'}
        </Text>
      </View>

      <View style={styles.reportDocumentRule} />

      {!useStructuredLayout ? (
        <Text style={styles.reportBodyText}>
          {reportDraft.body}
        </Text>
      ) : (
        <>
          {reportDraft.openingLine ? (
            <Text style={styles.reportDocumentIntro}>
              {reportDraft.openingLine}
            </Text>
          ) : null}

          <View style={styles.reportDocumentSection}>
            <Text style={styles.reportDocumentSectionTitle}>
              {reportFormat === 'executive'
                ? 'Executive Summary'
                : 'Project Summary'}
            </Text>

            <View style={styles.reportDocumentBulletList}>
              {reportDraft.executiveSummary.map((summary, index) => (
                <View key={`${index}-${summary}`} style={styles.reportDocumentBulletRow}>
                  <Text style={styles.reportDocumentBulletMarker}>•</Text>
                  <Text style={styles.reportDocumentBulletText}>{summary}</Text>
                </View>
              ))}
            </View>
          </View>

          {reportFormat === 'project_manager'
            ? reportDraft.locationGroups.map(group => (
                <View key={group.id} style={styles.reportDocumentSection}>
                  <Text style={styles.reportDocumentLocationTitle}>
                    {group.title}
                  </Text>

                  {group.workAreas.map(area => (
                    <View key={area.id} style={styles.reportDocumentArea}>
                      <Text style={styles.reportDocumentAreaTitle}>
                        {area.projectName !== area.title
                          ? `${area.projectName} — ${area.title}`
                          : area.title}
                      </Text>

                      <View style={styles.reportDocumentBulletList}>
                        {area.bullets.map((bullet, index) => (
                          <View
                            key={`${bullet.id}-${index}`}
                            style={styles.reportDocumentBulletRow}
                          >
                            <Text style={styles.reportDocumentBulletMarker}>•</Text>
                            <Text style={styles.reportDocumentBulletText}>
                              <Text style={styles.reportDocumentBulletLabel}>
                                {reportPreviewBulletLabel(bullet.kind)}:{' '}
                              </Text>
                              {bullet.text}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              ))
            : null}

          {reportDraft.closingLine ? (
            <Text style={styles.reportDocumentClosing}>
              {reportDraft.closingLine}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function reportPreviewBulletLabel(kind: string) {
  if (kind === 'safety') return 'Safety';
  if (kind === 'issue') return 'Issue';
  if (kind === 'next_step') return 'Action';
  if (kind === 'schedule') return 'Schedule';
  if (kind === 'image_reference') return 'Evidence';

  return 'Progress';
}

function DecisionLedgerPanel({
  decisions,
  reportDraft,
  layer4Identity,
  migrationStatus,
  syncMetadata,
  availableEvidence,
  onCreateDecisionSnapshot,
  onApproveDecision,
  onRejectDecision,
  onDeferDecision,
  onCancelDecision,
  onImplementDecision,
  onMoveDecisionToAwaitingOutcome,
  onAppendCorrectedDecisionVersion,
  onRecordImplementationQuality,
  onRecordActualOutcome,
  onValidateOutcome,
  onCloseDecision,
  onRetryDecisionLedgerSync,
}: {
  decisions: PIEDecisionRecord[];
  reportDraft: PIEReportDraft;
  layer4Identity: PIELayer4ActorContext | null;
  migrationStatus: PIEDecisionLedgerMigrationStatus | null;
  syncMetadata: Record<string, PIEDecisionSyncMetadata>;
  availableEvidence: PIEEvidenceReference[];
  onCreateDecisionSnapshot?: (judgment: PIEExecutiveJudgmentRecord | null | undefined) => void;
  onApproveDecision?: (decisionId: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onRejectDecision?: (decisionId: string, reason: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onDeferDecision?: (decisionId: string, reason: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onCancelDecision?: (decisionId: string, reason: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onImplementDecision?: (decisionId: string, planText: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onMoveDecisionToAwaitingOutcome?: (decisionId: string, reason: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onAppendCorrectedDecisionVersion?: (decisionId: string, reason: string, linkedEvidence?: PIEEvidenceReference[]) => void;
  onRecordImplementationQuality?: (
    decisionId: string,
    quality: PIEImplementationQuality,
    note: string,
    linkedEvidence?: PIEEvidenceReference[],
  ) => void;
  onRecordActualOutcome?: (
    decisionId: string,
    classification: PIEOutcomeClassification,
    summary: string,
    linkedEvidence?: PIEEvidenceReference[],
  ) => void;
  onValidateOutcome?: (
    decisionId: string,
    validationStatus: PIEOutcomeValidationStatus,
    linkedEvidence?: PIEEvidenceReference[],
  ) => void;
  onCloseDecision?: (decisionId: string) => void;
  onRetryDecisionLedgerSync?: () => void;
}) {
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(
    decisions[0]?.id || null,
  );
  const [decisionReason, setDecisionReason] =
    useState('Reviewed in DAVE Decision History.');

  const selectedDecision =
    decisions.find(decision => decision.id === selectedDecisionId) ||
    decisions[0] ||
    null;
  const selectedSync = selectedDecision ? syncMetadata[selectedDecision.id] : null;
  const linkedEvidence = availableEvidence;

  return (
    <ScreenCard style={styles.decisionLedgerCard}>
      <View style={styles.reporterHeader}>
        <View style={styles.reporterIcon}>
          <Ionicons
            name="shield-checkmark-outline"
            size={24}
            color={colors.primary}
          />
        </View>

        <View style={styles.reporterHeaderText}>
          <Text style={styles.preparedTitle}>
            Decision History
          </Text>

          <Text style={styles.reporterHelp}>
            Preserve what DAVE and the user knew before learning from the result.
          </Text>
        </View>
      </View>

      <View style={styles.identityStatusPanel}>
        <Text style={styles.reportListText}>
          Identity: {layer4Identity?.cloudTrusted ? 'Verified for cloud history' : 'Local only until organization membership is verified'}
        </Text>
        <Text style={styles.reportListText}>
          Organization: {layer4Identity?.organizationStatus || 'unavailable'}
        </Text>
        {migrationStatus?.message ? (
          <Text style={styles.reviewFlagText}>
            {migrationStatus.message}
          </Text>
        ) : null}
      </View>

      {decisions.length === 0 ? (
        <Text style={styles.decisionHelperText}>
          DAVE is monitoring reports for meaningful decisions. Routine notes and low-confidence drafts are ignored.
        </Text>
      ) : (
        <View style={styles.decisionStack}>
          <View style={styles.decisionSelectorRow}>
            {decisions.slice(0, 3).map(decision => (
              <TouchableOpacity
                key={decision.id}
                style={[
                  styles.decisionChip,
                  decision.id === selectedDecision?.id && styles.decisionChipSelected,
                ]}
                onPress={() => setSelectedDecisionId(decision.id)}
                accessibilityRole="button"
                accessibilityLabel={`View decision ${decision.immutableSnapshot.selectedOption}`}
              >
                <Text
                  style={[
                    styles.decisionChipText,
                    decision.id === selectedDecision?.id && styles.decisionChipTextSelected,
                  ]}
                >
                  {decision.currentStatus.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {selectedDecision ? (
            <>
              <DecisionSnapshotSummary decision={selectedDecision} />

              <View style={styles.identityStatusPanel}>
                <Text style={styles.reportPreviewLabel}>
                  DAVE automation
                </Text>
                <Text style={styles.reportListText}>
                  DAVE detected this decision, preserved the original snapshot, and is watching project evidence for implementation and outcome support.
                </Text>
                <Text style={styles.reportListText}>
                  Evidence linked automatically: {linkedEvidence.length}
                </Text>
                <Text style={styles.reportListText}>
                  What still needs attention: {decisionAttentionSummary(selectedDecision)}
                </Text>
              </View>

              <View style={styles.identityStatusPanel}>
                <Text style={styles.reportListText}>
                  Sync: {selectedSync?.state?.replace(/_/g, ' ') || 'local only'}
                </Text>
                {selectedSync?.error ? (
                  <Text style={styles.reviewFlagText}>{selectedSync.error}</Text>
                ) : null}
                {selectedSync?.conflict ? (
                  <Text style={styles.reviewFlagText}>{selectedSync.conflict.reason}</Text>
                ) : null}
                <TouchableOpacity
                  style={styles.reportActionButton}
                  onPress={onRetryDecisionLedgerSync}
                  accessibilityRole="button"
                  accessibilityLabel="Retry decision ledger sync"
                >
                  <Text style={styles.reportActionText}>Retry Sync</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.reportPreviewLabel}>
                Correction reason
              </Text>

              <TextInput
                style={styles.decisionInput}
                value={decisionReason}
                onChangeText={setDecisionReason}
                multiline
                placeholder="Add a short reason only when correcting or approving an exception."
                placeholderTextColor={colors.mutedText}
              />

              <Text style={styles.reportPreviewLabel}>
                Actions needed
              </Text>

              <Text style={styles.decisionHelperText}>
                Routine lifecycle steps are automated when evidence is strong enough. Use these controls only to approve a real decision, correct DAVE, or resolve an exception.
              </Text>

              <View style={styles.reportActionRow}>
                <TouchableOpacity
                  style={styles.reportActionButtonPrimary}
                  onPress={() => onApproveDecision?.(selectedDecision.id, linkedEvidence)}
                  accessibilityRole="button"
                  accessibilityLabel="Approve decision"
                >
                  <Text style={styles.reportActionTextPrimary}>Approve</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.reportActionButton}
                  onPress={() => onRejectDecision?.(selectedDecision.id, decisionReason, linkedEvidence)}
                  accessibilityRole="button"
                  accessibilityLabel="Reject decision"
                >
                  <Text style={styles.reportActionText}>Reject</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.reportActionRow}>
                <TouchableOpacity
                  style={styles.reportActionButton}
                  onPress={() => onDeferDecision?.(selectedDecision.id, decisionReason, linkedEvidence)}
                  accessibilityRole="button"
                  accessibilityLabel="Defer decision"
                >
                  <Text style={styles.reportActionText}>Defer</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.reportActionButton}
                  onPress={() => onAppendCorrectedDecisionVersion?.(selectedDecision.id, decisionReason, linkedEvidence)}
                  accessibilityRole="button"
                  accessibilityLabel="Correct decision history"
                >
                  <Text style={styles.reportActionText}>Correct</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.reportActionRow}>
                <TouchableOpacity
                  style={styles.reportActionButton}
                  onPress={() => onCancelDecision?.(selectedDecision.id, decisionReason, linkedEvidence)}
                  accessibilityRole="button"
                  accessibilityLabel="This is not a decision"
                >
                  <Text style={styles.reportActionText}>This is not a decision</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.reportActionButton}
                  onPress={() => onValidateOutcome?.(selectedDecision.id, 'disputed', linkedEvidence)}
                  accessibilityRole="button"
                  accessibilityLabel="Outcome not achieved"
                >
                  <Text style={styles.reportActionText}>Outcome not achieved</Text>
                </TouchableOpacity>
              </View>

              {selectedDecision.closeBlockers.length > 0 ? (
                <View style={styles.reviewFlagsPanel}>
                  <Text style={styles.reportPreviewLabel}>
                    Why this cannot close yet
                  </Text>

                  {selectedDecision.closeBlockers.map((blocker, index) => (
                    <Text
                      key={`${index}-${blocker}`}
                      style={styles.reviewFlagText}
                    >
                      • {blocker}
                    </Text>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      )}
    </ScreenCard>
  );
}

function decisionAttentionSummary(decision: PIEDecisionRecord) {
  if (decision.currentStatus === 'proposed') return 'approval or rejection';
  if (decision.currentStatus === 'approved' && !decision.outcomePlan) {
    return 'DAVE is preparing an outcome plan';
  }
  if (decision.closeBlockers.length > 0) return decision.closeBlockers[0];
  if (decision.currentStatus === 'outcome_observed') return 'validate or dispute outcome';
  return 'no routine user action required';
}

function DecisionSnapshotSummary({
  decision,
}: {
  decision: PIEDecisionRecord;
}) {
  const snapshot = decision.immutableSnapshot;
  const latestOutcome = decision.actualOutcomes[decision.actualOutcomes.length - 1];

  return (
    <View style={styles.snapshotPanel}>
      <Text style={styles.reportPreviewLabel}>
        Original Decision Snapshot
      </Text>

      <Text style={styles.reportTitleText}>
        {snapshot.selectedOption}
      </Text>

      <Text style={styles.reportListText}>
        Status: {decision.currentStatus.replace(/_/g, ' ')}
      </Text>

      <Text style={styles.reportListText}>
        Why selected: {snapshot.selectedReason}
      </Text>

      <Text style={styles.reportListText}>
        Recommendation strength: {snapshot.recommendationConfidence}. {snapshot.confidenceExplanation}
      </Text>

      <Text style={styles.reportListText}>
        Evidence preserved: {snapshot.evidenceAvailable.length}
      </Text>

      <Text style={styles.reportListText}>
        Evidence gaps: {snapshot.knownEvidenceGaps.length ? snapshot.knownEvidenceGaps.join('; ') : 'None recorded'}
      </Text>

      <Text style={styles.reportListText}>
        Predicted outcomes: {snapshot.predictedOutcomes.map(outcome => outcome.description).join('; ')}
      </Text>

      <Text style={styles.reportListText}>
        Implementation: {decision.implementationAssessment?.quality.replace(/_/g, ' ') || 'not assessed'}
      </Text>

      <Text style={styles.reportListText}>
        Outcome: {latestOutcome ? `${latestOutcome.classification.replace(/_/g, ' ')} (${latestOutcome.validationStatus.replace(/_/g, ' ')})` : 'not recorded'}
      </Text>
    </View>
  );
}

function ReporterTypeButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.reportTypeButton,
        selected && styles.reportTypeButtonSelected,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text
        style={[
          styles.reportTypeText,
          selected && styles.reportTypeTextSelected,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ReportStatusPill({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.reportStatusPill}>
      <Text style={styles.reportStatusLabel}>
        {label}
      </Text>

      <Text style={styles.reportStatusValue}>
        {value}
      </Text>
    </View>
  );
}

function PreparedReportItem({
  title,
  detail,
  onPress,
}: {
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.preparedItem}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
    >
      <Ionicons
        name="checkmark-circle-outline"
        size={18}
        color={colors.success}
      />

      <View style={styles.preparedItemCopy}>
        <Text
          style={styles.preparedItemText}
          numberOfLines={1}
        >
          {title}
        </Text>

        <Text
          style={styles.preparedItemDetail}
          numberOfLines={2}
        >
          {detail}
        </Text>
      </View>

      <Ionicons
        name="chevron-forward-outline"
        size={18}
        color={colors.tertiaryText}
      />
    </TouchableOpacity>
  );
}

function ReportCard({
  title,
  description,
  icon,
  onPress,
}: ReportCardProps) {
  const isPlaceholder = !onPress;
  const content = (
    <ScreenCard
      style={[
        styles.card,
        isPlaceholder && styles.placeholderCard,
      ]}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.iconBadge,
            isPlaceholder && styles.placeholderIconBadge,
          ]}
        >
          <Ionicons
            name={icon}
            size={24}
            color={isPlaceholder ? colors.mutedText : colors.primary}
          />
        </View>

        <View style={styles.cardTextGroup}>
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle}>
              {title}
            </Text>

            {isPlaceholder ? (
              <View style={styles.comingSoonPill}>
                <Text style={styles.comingSoonText}>
                  Coming Soon
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.cardDescription}>
            {description}
          </Text>
        </View>

        {!isPlaceholder ? (
          <Ionicons
            name="chevron-forward-outline"
            size={22}
            color={colors.tertiaryText}
          />
        ) : null}
      </View>
    </ScreenCard>
  );

  if (isPlaceholder) {
    return (
      <View style={styles.cardShell}>
        {content}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.cardShell}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  experienceCard: {
    gap: spacing.sm,
  },

  experienceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  experienceIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  experienceTextGroup: {
    flex: 1,
    minWidth: 0,
  },

  experienceEyebrow: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  experienceState: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    textTransform: 'capitalize',
    marginTop: spacing.xxs,
  },

  experienceMessage: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },

  experienceReason: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
  },

  experienceMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  preparedCard: {
    gap: spacing.sm,
  },

  preparedTitle: {
    ...typography.h3,
  },

  preparedHeaderButton: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  preparedList: {
    gap: spacing.xs,
  },

  preparedItem: {
    minHeight: 52,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },

  preparedItemCopy: {
    flex: 1,
    minWidth: 0,
  },

  preparedItemText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },

  preparedItemDetail: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 2,
  },

  advancedToggleButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },

  advancedToggleText: {
    color: colors.primary,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },

  reporterCard: {
    gap: spacing.sm,
  },

  decisionLedgerCard: {
    gap: spacing.sm,
  },

  decisionStack: {
    gap: spacing.sm,
  },

  identityStatusPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    gap: spacing.xs,
  },

  decisionSelectorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  decisionChip: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  decisionChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  decisionChipText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'capitalize',
  },

  decisionChipTextSelected: {
    color: '#FFFFFF',
  },

  decisionHelperText: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  decisionInput: {
    minHeight: 78,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    padding: spacing.sm,
    textAlignVertical: 'top',
  },

  reportTitleInput: {
    minHeight: 48,
  },

  reportBodyInput: {
    minHeight: 220,
  },

  snapshotPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    gap: spacing.xs,
  },

  reporterHeader: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },

  reporterIcon: {
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  reporterHeaderText: {
    flex: 1,
    minWidth: 0,
  },

  reporterHelp: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },

  generateReportButton: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },

  generateReportText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
  },

  reportPreview: {
    gap: spacing.sm,
  },

  reportEditFields: {
    gap: spacing.sm,
  },

  reportDocument: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.md,
  },

  reportDocumentHeader: {
    gap: spacing.xxs,
  },

  reportDocumentTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '900',
  },

  reportDocumentType: {
    color: colors.primary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  reportDocumentRule: {
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },

  reportDocumentIntro: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },

  reportDocumentSection: {
    gap: spacing.sm,
  },

  reportDocumentSectionTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },

  reportDocumentLocationTitle: {
    color: colors.primary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },

  reportDocumentArea: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primarySoft,
    paddingLeft: spacing.sm,
    gap: spacing.xs,
  },

  reportDocumentAreaTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },

  reportDocumentBulletList: {
    gap: spacing.xs,
  },

  reportDocumentBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: spacing.xs,
  },

  reportDocumentBulletMarker: {
    width: 14,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },

  reportDocumentBulletText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
  },

  reportDocumentBulletLabel: {
    fontWeight: '900',
  },

  reportDocumentClosing: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    marginTop: spacing.xs,
  },

  segmentRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },

  reportOptionLabel: {
    color: colors.mutedText,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  reportTypeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },

  reportTypeButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  reportTypeText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textAlign: 'center',
  },

  reportTypeTextSelected: {
    color: '#FFFFFF',
  },

  reportStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  reportStatusPill: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.xs,
  },

  reportStatusLabel: {
    color: colors.mutedText,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  reportStatusValue: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    textTransform: 'capitalize',
  },

  reviewFlagsPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
    padding: spacing.sm,
    gap: spacing.xs,
  },

  reviewFlagText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  reviewFlagHelper: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },

  reportPreviewLabel: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  reportTitleText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },

  reportBodyText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
  },

  reportList: {
    gap: spacing.xs,
  },

  reportListText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },

  expandActionButton: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },

  expandActionText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },

  reportActionRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },

  reportActionButtonPrimary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },

  reportActionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },

  reportActionButtonDisabled: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
  },

  reportActionTextPrimary: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },

  reportActionText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },

  reportActionTextDisabled: {
    color: colors.mutedText,
  },

  approvalBoundaryText: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },

  primaryReviewButton: {
    minHeight: 76,
    borderRadius: 12,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  primaryReviewIcon: {
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryReviewTextGroup: {
    flex: 1,
    minWidth: 0,
  },

  primaryReviewTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },

  primaryReviewSubtitle: {
    color: '#EAF4FF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: spacing.xxs,
  },

  reviewActionStack: {
    gap: spacing.sm,
  },

  cardShell: {
    width: '100%',
  },

  card: {
    minHeight: 92,
    marginBottom: 0,
  },

  placeholderCard: {
    backgroundColor: colors.surfaceMuted,
  },

  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },

  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  placeholderIconBadge: {
    backgroundColor: colors.border,
  },

  cardTextGroup: {
    flex: 1,
    gap: spacing.xs,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  cardTitle: {
    ...typography.h3,
    fontSize: 17,
    lineHeight: 23,
    flexShrink: 1,
  },

  cardDescription: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
  },

  comingSoonPill: {
    borderRadius: 999,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },

  comingSoonText: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
  },
});
