import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { ReportsWideWorkspace } from '../components/reports-workspace-layout';
import { useAppShellLayout } from '../components/app-shell-layout';
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
import {
  type PIEReportDraft,
  type PIEReportType,
} from '../services/domains/reporting';
import type { PIEExecutiveJudgmentRecord } from '../services/PIEExecutiveJudgmentRepository';
import { usePIELiveAuthority } from '../providers/PIELiveAuthorityProvider';
import {
  currentDecisionSnapshot,
  type PIEImplementationQuality,
  type PIEOutcomeClassification,
  type PIEOutcomeValidationStatus,
  type PIEDecisionRecord,
  type PIEEvidenceReference,
} from '../services/PIEDecisionLedger';
import type { PIELayer4ActorContext } from '../services/PIELayer4Identity';
import type {
  PIEDecisionLedgerMigrationStatus,
} from '../services/PIEDecisionLedgerStorage';
import type { PIEDecisionSyncMetadata } from '../services/PIEDecisionLedgerSync';
import { buildDAVEProjectTruth } from '../services/DAVEProjectTruth';
import {
  buildDAVEReportBriefing,
  buildDAVEReportSourceFingerprint,
  buildPMReportReviewWarnings,
  enhanceDAVEReportDraft,
  toPMReportLanguage,
  type DAVEReportBriefing,
} from '../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  daveReportSnapshotScopeKey,
  type DAVEReportSnapshot,
} from '../services/DAVEReportSnapshot';
import {
  loadDAVEReportSnapshot,
  saveDAVEReportSnapshot,
} from '../services/DAVEReportSnapshotRepository';
import {
  buildVitruviusCommitmentControl,
  type VitruviusCommitmentControl,
} from '../services/VitruviusCommitmentControl';

type IconName = keyof typeof Ionicons.glyphMap;
type ReportFormat = 'project_manager' | 'executive';

type ReportCardProps = {
  title: string;
  description: string;
  icon: IconName;
  onPress?: () => void;
};

export type { ReportCommunicationOutcome } from '../services/ReportCommunication';

import {
  shouldApplyCommunicationOutcome,
  type ReportCommunicationOutcome,
} from '../services/ReportCommunication';
import { evaluateReportApprovalPolicy } from '../services/ReportApprovalPolicy';
import { buildDailyReportAuthorityScope } from '../services/ReportAuthorityScope';
import {
  selectStableReportDraft,
  type StableReportDraftCache,
} from '../services/ReportDraftRefresh';

export function ReportsScreen({
  contentStyle,
  projectName,
  reportType,
  onReportTypeChange,
  availableProjectNames,
  selectedProjectNames,
  onToggleProject,
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
  onTextReport,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projectName: string;
  reportType: Extract<PIEReportType, 'daily_project_update' | 'combined_project_update'>;
  onReportTypeChange: (
    reportType: Extract<PIEReportType, 'daily_project_update' | 'combined_project_update'>,
  ) => void;
  availableProjectNames: string[];
  selectedProjectNames: string[];
  onToggleProject: (projectName: string) => void;
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
  onCopyReport: (report: PIEReportDraft) => Promise<ReportCommunicationOutcome>;
  onEmailReport: (report: PIEReportDraft) => Promise<ReportCommunicationOutcome>;
  onTextReport: (report: PIEReportDraft) => Promise<ReportCommunicationOutcome>;
}) {
  const { sizeClass } = useAppShellLayout();
  const [reportApproved, setReportApproved] = useState(false);
  const [reportEditing, setReportEditing] = useState(false);
  const [reportEdits, setReportEdits] = useState<{
    title: string;
    body: string;
    sourceFingerprint: string;
  } | null>(null);
  const [communicationPending, setCommunicationPending] = useState(false);
  const [communicationError, setCommunicationError] = useState('');
  const [autoDecisionKey, setAutoDecisionKey] = useState('');
  const [previousReportSnapshot, setPreviousReportSnapshot] =
    useState<DAVEReportSnapshot | null>(null);
  const [snapshotScopeLoaded, setSnapshotScopeLoaded] = useState(false);
  const liveAuthority = usePIELiveAuthority();
  const runtime = liveAuthority.runtime;
  const reportGenerationAllowed = liveAuthority.policy.reportGenerationAllowed;
  const reportDraftScopeKey = useMemo(
    () => [
      reportType,
      reportFormat,
      ...selectedProjectNames
        .map(name => reportProjectKey(name))
        .filter(Boolean)
        .sort(),
    ].join('|'),
    [reportFormat, reportType, selectedProjectNames],
  );
  const stableReportDraftRef = useRef<StableReportDraftCache | null>(null);
  const stableReportDraft = selectStableReportDraft({
    scopeKey: reportDraftScopeKey,
    liveDraft: liveAuthority.reportDraft,
    fallbackDraft: runtime.response.reportDraft,
    cachedDraft: stableReportDraftRef.current,
  });
  stableReportDraftRef.current = stableReportDraft.cache;
  const baseReportDraft = stableReportDraft.draft;
  const reportTruths = useMemo(() => selectedProjectNames.map(selectedName => {
    const reportProjectId = `report:${reportProjectKey(selectedName) || 'project'}`;
    const scopedTruthInput = buildDailyReportAuthorityScope({
      selectedProjectName: selectedName,
      selectedProjectNames: [selectedName],
      projectRecords: selectedProjectNames.map(name => ({ name })),
      updates,
      scheduleItems,
      projectAreas,
      referenceDocuments,
    });
    return buildDAVEProjectTruth({
      projectId: reportProjectId,
      projectName: selectedName,
      updates: scopedTruthInput.updates.map(update => ({ ...update, projectName: selectedName })),
      scheduleItems: scopedTruthInput.scheduleItems,
      projectAreas: scopedTruthInput.projectAreas,
      referenceDocuments: scopedTruthInput.referenceDocuments.map(document => ({
        ...document,
        projectId: reportProjectId,
        projectName: selectedName,
      })),
    });
  }), [
    projectAreas,
    referenceDocuments,
    scheduleItems,
    selectedProjectNames,
    updates,
  ]);
  const reportSourceFingerprint = useMemo(
    () => buildDAVEReportSourceFingerprint(reportTruths),
    [reportTruths],
  );
  const reportSnapshotScopeKey = useMemo(
    () => daveReportSnapshotScopeKey(selectedProjectNames),
    [selectedProjectNames],
  );
  const currentReportSnapshot = useMemo(() => buildDAVEReportSnapshot({
    truths: reportTruths,
    scopeKey: reportSnapshotScopeKey,
    sourceFingerprint: reportSourceFingerprint,
    capturedAt: reportTruths.map(truth => truth.generatedAt).sort().at(-1),
  }), [
    reportSnapshotScopeKey,
    reportSourceFingerprint,
    reportTruths,
  ]);
  const reportBriefing = useMemo(() => buildDAVEReportBriefing({
    truths: reportTruths,
    selectedProjectNames,
    previousSnapshot: snapshotScopeLoaded ? previousReportSnapshot : null,
  }), [
    previousReportSnapshot,
    reportTruths,
    selectedProjectNames,
    snapshotScopeLoaded,
  ]);
  const commitmentControl = useMemo(() => buildVitruviusCommitmentControl({
    scheduleItems,
    updates,
    projectNames: selectedProjectNames,
  }), [
    scheduleItems,
    selectedProjectNames,
    updates,
  ]);
  const pieReportDraft = useMemo(
    () => enhanceDAVEReportDraft(baseReportDraft, reportBriefing, reportFormat),
    [baseReportDraft, reportBriefing, reportFormat],
  );
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
  const reportStateIdentityKey = [
    pieReportDraft.id,
    reportType,
    reportFormat,
    ...selectedProjectNames.map(name => reportProjectKey(name)),
  ].join('|');
  const reportCommunicationIdentityKey = [
    reportStateIdentityKey,
    effectiveReportDraft.title,
    effectiveReportDraft.body,
  ].join('|');
  const reportApprovalPolicy = useMemo(
    () => evaluateReportApprovalPolicy({
      report: effectiveReportDraft,
      reportGenerationAllowed,
    }),
    [effectiveReportDraft, reportGenerationAllowed],
  );
  const reportFactsAreCurrent = !reportEdits ||
    reportEdits.sourceFingerprint === reportSourceFingerprint;
  const reportApprovalAllowed = reportApprovalPolicy.allowed && reportFactsAreCurrent;
  const reportApprovalMessage = !reportGenerationAllowed
    ? 'Current project data is still loading. Refresh before approving.'
    : !reportFactsAreCurrent
      ? 'Project facts changed after you edited this report. Refresh the report before approval.'
      : reportApprovalPolicy.message;
  const reportIdentityRef = useRef(reportCommunicationIdentityKey);
  const reportApprovalAllowedRef = useRef(reportApprovalAllowed);
  const reportApprovedRef = useRef(reportApproved);
  const pendingCommunicationTokenRef = useRef<symbol | null>(null);
  const mountedRef = useRef(true);
  reportIdentityRef.current = reportCommunicationIdentityKey;
  reportApprovalAllowedRef.current = reportApprovalAllowed;
  reportApprovedRef.current = reportApproved;
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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPreviousReportSnapshot(null);
    setSnapshotScopeLoaded(false);
    void loadDAVEReportSnapshot(reportSnapshotScopeKey)
      .then(snapshot => {
        if (cancelled) return;
        setPreviousReportSnapshot(snapshot);
        setSnapshotScopeLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviousReportSnapshot(null);
        setSnapshotScopeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reportSnapshotScopeKey]);

  useEffect(() => {
    setReportEdits(null);
    setReportEditing(false);
    setReportApproved(false);
  }, [pieReportDraft.id]);

  useEffect(() => {
    if (reportApprovalAllowed) return;
    setReportApproved(false);
  }, [reportApprovalAllowed]);

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
  useEffect(() => {
    setReportApproved(false);
    setReportEditing(false);
    setReportEdits(null);
    setCommunicationPending(false);
    setCommunicationError('');
    pendingCommunicationTokenRef.current = null;
  }, [reportStateIdentityKey]);

  const completeCommunication = (
    communicate: (report: PIEReportDraft) => Promise<ReportCommunicationOutcome>,
  ) => {
    if (!reportApproved || !reportApprovalAllowed) {
      setCommunicationError(reportApprovalMessage);
      return;
    }

    if (pendingCommunicationTokenRef.current) return;

    const startedReportIdentity = reportCommunicationIdentityKey;
    const startedReport = effectiveReportDraft;
    const communicationToken = Symbol(startedReportIdentity);
    pendingCommunicationTokenRef.current = communicationToken;
    setCommunicationPending(true);
    setCommunicationError('');

    void (async () => {
      try {
        const outcome = await communicate(startedReport);
        if (
          mountedRef.current &&
          pendingCommunicationTokenRef.current === communicationToken &&
          shouldApplyCommunicationOutcome({
            outcome,
            startedReportIdentity,
            currentReportIdentity: reportIdentityRef.current,
            approvalAllowed: reportApprovalAllowedRef.current,
            reportApproved: reportApprovedRef.current,
          })
        ) setCommunicationError('');
      } catch {
        if (
          mountedRef.current &&
          pendingCommunicationTokenRef.current === communicationToken &&
          startedReportIdentity === reportIdentityRef.current
        ) {
          setCommunicationError('Report communication did not complete. Please try again.');
        }
      } finally {
        if (pendingCommunicationTokenRef.current === communicationToken) {
          pendingCommunicationTokenRef.current = null;
          if (mountedRef.current) setCommunicationPending(false);
        }
      }
    })();
  };

  const markReportApproved = () => {
    if (!reportApprovalAllowed) {
      setCommunicationError(reportApprovalMessage);
      return;
    }
    setReportEditing(false);
    setReportApproved(true);
    setCommunicationError('');
    void saveDAVEReportSnapshot(currentReportSnapshot).catch(() => {
      if (!mountedRef.current) return;
      setCommunicationError(
        'The report is approved, but its reporting-period snapshot could not be saved on this device.',
      );
    });
  };
  const reportHeader = (
    <ScreenHeader
      title="Reports"
      subtitle={`${selectedProjectNames.join(', ')} · Current task status, recent field updates, and next steps.`}
    />
  );
  const preparedReport = (
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
              Prepared Report
            </Text>

            <Text style={styles.reporterHelp}>
              Built from the current tasks and recorded field updates for the selected project.
            </Text>
          </View>
        </View>

        <PIEReporterPreview
            reportDraft={effectiveReportDraft}
            hasManualEdits={Boolean(reportEdits)}
            reportType={reportType}
            availableProjectNames={availableProjectNames}
            selectedProjectNames={selectedProjectNames}
            onToggleProject={onToggleProject}
            reportFormat={reportFormat}
            onReportTypeChange={nextReportType => {
              onReportTypeChange(nextReportType);
              setReportApproved(false);
              setReportEditing(false);
              setReportEdits(null);
            }}
            onReportFormatChange={nextFormat => {
              onReportFormatChange(nextFormat);
              setReportApproved(false);
              setReportEditing(false);
              setReportEdits(null);
            }}
            reportApproved={reportApproved}
            reportApprovalAllowed={reportApprovalAllowed}
            approvalMessage={reportApprovalMessage}
            communicationPending={communicationPending}
            communicationError={communicationError}
            reportEditing={reportEditing}
            onApproveReport={markReportApproved}
            onEditReport={() => {
              setReportEditing(true);
              setReportApproved(false);
              setCommunicationPending(false);
              setCommunicationError('');
              pendingCommunicationTokenRef.current = null;
            }}
            onTitleChange={title => {
              setReportEdits(current => ({
                title,
                body: current?.body ?? pieReportDraft.body,
                sourceFingerprint: current?.sourceFingerprint ?? reportSourceFingerprint,
              }));
            }}
            onBodyChange={body => {
              setReportEdits(current => ({
                title: current?.title ?? pieReportDraft.title,
                body,
                sourceFingerprint: current?.sourceFingerprint ?? reportSourceFingerprint,
              }));
            }}
            onCopyReport={() => {
              completeCommunication(onCopyReport);
            }}
            onEmailReport={() => {
              completeCommunication(onEmailReport);
            }}
            onTextReport={() => {
              completeCommunication(onTextReport);
            }}
          />
    </ScreenCard>
  );
  const reviewPanel = (
    <BeforeYouSharePanel
      reportDraft={effectiveReportDraft}
      commitmentControl={commitmentControl}
      reportApproved={reportApproved}
      reportApprovalAllowed={reportApprovalAllowed}
    />
  );

  if (sizeClass === 'wide') {
    return (
      <ReportsWideWorkspace
        header={reportHeader}
        report={preparedReport}
        review={reviewPanel}
      />
    );
  }

  return (
    <Screen contentStyle={contentStyle}>
      {reportHeader}
      {preparedReport}
      {reviewPanel}
    </Screen>
  );
}

function BeforeYouSharePanel({
  reportDraft,
  commitmentControl,
  reportApproved,
  reportApprovalAllowed,
}: {
  reportDraft: PIEReportDraft;
  commitmentControl: VitruviusCommitmentControl;
  reportApproved: boolean;
  reportApprovalAllowed: boolean;
}) {
  const warnings = buildPMReportReviewWarnings(reportDraft.reviewFlags);
  const visibleWarnings = warnings.length > 0
    ? warnings
    : !reportApprovalAllowed
      ? ['Correct the highlighted project details before approval.']
      : [];
  const reviewState = reportApproved && reportApprovalAllowed
    ? 'Approved'
    : visibleWarnings.length > 0
      ? 'Needs Changes'
      : 'Ready to Review';
  const reviewMessage = reportApproved && reportApprovalAllowed
    ? 'This report is approved and ready to share.'
    : visibleWarnings.length > 0
      ? 'Update the items below, then review the report again.'
      : 'Read the report and approve it when it matches the current project status.';

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
            Report Check
          </Text>

          <Text style={styles.experienceState}>
            {reviewState}
          </Text>
        </View>
      </View>

      <Text style={styles.experienceMessage}>
        {reviewMessage}
      </Text>

      {visibleWarnings.length > 0 ? (
        <View style={styles.reviewFlagsPanel}>
          <Text style={styles.reportPreviewLabel}>
            Fix before approval
          </Text>

          {visibleWarnings.slice(0, 3).map((warning, index) => (
            <Text
              key={`${index}-${warning}`}
              style={styles.reviewFlagText}
            >
              • {warning}
            </Text>
          ))}
          {visibleWarnings.length > 3 ? (
            <Text style={styles.reportListText}>
              {visibleWarnings.length - 3} more {visibleWarnings.length - 3 === 1 ? 'item is' : 'items are'} highlighted in the report.
            </Text>
          ) : null}
        </View>
      ) : null}

      {!reportApproved && reportApprovalAllowed && commitmentControl.actionableItems.length > 0 ? (
        <View style={styles.reviewFlagsPanel}>
          <Text style={styles.reportPreviewLabel}>
            Management actions
          </Text>
          {commitmentControl.actionableItems.slice(0, 3).map(item => (
            <View key={item.id} style={styles.managementActionRow}>
              <Text style={styles.managementActionTitle}>
                {item.taskName} · {item.stateLabel}
              </Text>
              <Text style={styles.reportListText}>
                {item.recoveryAction}
              </Text>
              <Text style={styles.managementActionMeta}>
                Owner: {item.owner} · {item.timing}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScreenCard>
  );
}

function PIEReporterPreview({
  reportDraft,
  hasManualEdits,
  reportType,
  availableProjectNames,
  selectedProjectNames,
  onToggleProject,
  reportFormat,
  onReportTypeChange,
  onReportFormatChange,
  reportApproved,
  reportApprovalAllowed,
  approvalMessage,
  communicationPending,
  communicationError,
  reportEditing,
  onApproveReport,
  onEditReport,
  onTitleChange,
  onBodyChange,
  onCopyReport,
  onEmailReport,
  onTextReport,
}: {
  reportDraft: PIEReportDraft;
  hasManualEdits: boolean;
  reportType: Extract<PIEReportType, 'daily_project_update' | 'combined_project_update'>;
  availableProjectNames: string[];
  selectedProjectNames: string[];
  onToggleProject: (projectName: string) => void;
  reportFormat: ReportFormat;
  onReportTypeChange: (
    reportType: Extract<PIEReportType, 'daily_project_update' | 'combined_project_update'>,
  ) => void;
  onReportFormatChange: (format: ReportFormat) => void;
  reportApproved: boolean;
  reportApprovalAllowed: boolean;
  approvalMessage: string;
  communicationPending: boolean;
  communicationError: string;
  reportEditing: boolean;
  onApproveReport: () => void;
  onEditReport: () => void;
  onTitleChange: (title: string) => void;
  onBodyChange: (body: string) => void;
  onCopyReport: () => void;
  onEmailReport: () => void;
  onTextReport: () => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <View style={styles.reportPreview}>
      <TouchableOpacity
        style={styles.reportOptionsToggle}
        onPress={() => setOptionsOpen(open => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: optionsOpen }}
        accessibilityLabel="Report options"
      >
        <View>
          <Text style={styles.reportOptionsTitle}>Report Options</Text>
          <Text style={styles.reportOptionsSummary}>
            {reportFormat === 'executive' ? 'Executive' : 'Project Manager'} · {selectedProjectNames.length} project{selectedProjectNames.length === 1 ? '' : 's'}
          </Text>
        </View>
        <Ionicons name={optionsOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} />
      </TouchableOpacity>

      {optionsOpen ? <View style={styles.reportOptionsPanel}>
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
          {reportType === 'daily_project_update' ? 'Choose Project' : 'Choose Projects'}
        </Text>

        <View style={styles.reportProjectPicker}>
        {availableProjectNames.map(project => {
          const selected = selectedProjectNames.some(
            name => name.trim().toLowerCase() === project.trim().toLowerCase(),
          );

          return (
            <TouchableOpacity
              key={project}
              style={[
                styles.reportProjectOption,
                selected && styles.reportProjectOptionSelected,
              ]}
              onPress={() => onToggleProject(project)}
              accessibilityRole={reportType === 'daily_project_update' ? 'radio' : 'checkbox'}
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={`${selected ? 'Selected' : 'Select'} ${project}`}
            >
              <Ionicons
                name={
                  reportType === 'daily_project_update'
                    ? selected
                      ? 'radio-button-on'
                      : 'radio-button-off'
                    : selected
                      ? 'checkbox'
                      : 'square-outline'
                }
                size={21}
                color={selected ? colors.primary : colors.mutedText}
              />
              <Text
                style={[
                  styles.reportProjectOptionText,
                  selected && styles.reportProjectOptionTextSelected,
                ]}
              >
                {project}
              </Text>
            </TouchableOpacity>
          );
        })}
        </View>

        <Text style={styles.reportProjectSelectionHelper}>
        {reportType === 'daily_project_update'
          ? 'The report will include only this project and its associated tasks.'
          : `${selectedProjectNames.length} project${selectedProjectNames.length === 1 ? '' : 's'} selected for this combined update.`}
        </Text>

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
      </View> : null}

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
          hasManualEdits={hasManualEdits}
        />
      )}

      <View style={styles.reportActionRow}>
        {!reportApproved || !reportApprovalAllowed ? (
          <TouchableOpacity
            style={[
              styles.reportActionButtonPrimary,
              !reportApprovalAllowed && styles.reportActionButtonDisabled,
            ]}
            onPress={onApproveReport}
            disabled={!reportApprovalAllowed}
            accessibilityRole="button"
            accessibilityState={{ disabled: !reportApprovalAllowed }}
            accessibilityLabel="Approve Report"
          >
            <Ionicons name="checkmark-circle-outline" size={18} color="#FFFFFF" />
            <Text style={styles.reportActionTextPrimary}>Approve Report</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.reportActionButtonPrimary}
            onPress={() => setShareOpen(open => !open)}
            disabled={communicationPending}
            accessibilityRole="button"
            accessibilityState={{ expanded: shareOpen, disabled: communicationPending }}
            accessibilityLabel="Share Report"
          >
            <Ionicons name="share-outline" size={18} color="#FFFFFF" />
            <Text style={styles.reportActionTextPrimary}>Share Report</Text>
          </TouchableOpacity>
        )}

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

      {reportApproved && reportApprovalAllowed && shareOpen ? (
        <View style={styles.reportShareMenu}>
          <ReportShareButton icon="copy-outline" label="Copy Report" onPress={onCopyReport} disabled={communicationPending} />
          <ReportShareButton icon="mail-outline" label="Email Report" onPress={onEmailReport} disabled={communicationPending} />
          <ReportShareButton icon="chatbubble-outline" label="Text Report" onPress={onTextReport} disabled={communicationPending} />
        </View>
      ) : null}

      {!reportApproved || !reportApprovalAllowed ? (
        <Text style={styles.approvalBoundaryText}>
          {reportApprovalAllowed
            ? 'Copy, Email, and Text unlock after approval. No report is sent automatically.'
            : `${approvalMessage} Correct the highlighted project details, then refresh the report.`}
        </Text>
      ) : null}

      {communicationPending ? (
        <Text style={styles.approvalBoundaryText}>Waiting for the selected share action to finish.</Text>
      ) : null}

      {communicationError ? (
        <Text style={styles.communicationErrorText}>{communicationError}</Text>
      ) : null}
    </View>
  );
}

function ReportDocumentPreview({
  reportDraft,
  reportFormat,
  hasManualEdits,
}: {
  reportDraft: PIEReportDraft;
  reportFormat: ReportFormat;
  hasManualEdits: boolean;
}) {
  const briefing = reportDraft.daveBriefing;
  const [workAreasOpen, setWorkAreasOpen] = useState(false);
  const [writtenReportOpen, setWrittenReportOpen] = useState(false);
  const workAreaCount = reportDraft.locationGroups.reduce((total, group) => total + group.workAreas.length, 0);
  const photoCount = reportDraft.locationGroups.reduce(
    (total, group) => total + group.workAreas.reduce((areaTotal, area) => areaTotal + area.imageReferences.length, 0),
    0,
  );
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

        {briefing ? (
          <Text style={styles.reportDocumentMeta}>
            Reporting date · {formatReportDate(briefing.generatedAt)}
          </Text>
        ) : null}
      </View>

      <View style={styles.reportDocumentRule} />

      {hasManualEdits ? (
        <View style={styles.reportEditNotice}>
          <Ionicons name="create-outline" size={16} color={colors.primary} />
          <Text style={styles.reportEditNoticeText}>
            Narrative edits are saved below. Current project facts remain visible in this report.
          </Text>
        </View>
      ) : null}

      {briefing ? <DAVEReportOverview briefing={briefing} reportFormat={reportFormat} /> : (
        <ReportInsightSection
          title={reportFormat === 'executive' ? 'Executive Summary' : 'Project Summary'}
          items={reportDraft.executiveSummary}
        />
      )}

      <View style={styles.reportDisclosure}>
        <TouchableOpacity
          style={styles.reportDisclosureHeader}
          onPress={() => setWrittenReportOpen(open => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: writtenReportOpen }}
          accessibilityLabel="Full written report"
        >
          <View style={styles.reportDisclosureHeaderText}>
            <Text style={styles.reportDisclosureTitle}>Full Written Report</Text>
            <Text style={styles.reportDisclosureSummary}>Narrative prepared for sharing</Text>
          </View>
          <Ionicons name={writtenReportOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
        </TouchableOpacity>
        {writtenReportOpen ? (
          <Text selectable style={styles.reportBodyText}>{reportDraft.body}</Text>
        ) : null}
      </View>

      {reportFormat === 'project_manager' && reportDraft.locationGroups.length ? (
        <View style={styles.reportDisclosure}>
          <TouchableOpacity
            style={styles.reportDisclosureHeader}
            onPress={() => setWorkAreasOpen(open => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: workAreasOpen }}
            accessibilityLabel="Work Areas and Photos"
          >
            <View style={styles.reportDisclosureHeaderText}>
              <Text style={styles.reportDisclosureTitle}>Work Areas & Photos</Text>
              <Text style={styles.reportDisclosureSummary}>
                {workAreaCount} area{workAreaCount === 1 ? '' : 's'} · {photoCount} photo{photoCount === 1 ? '' : 's'}
              </Text>
            </View>
            <Ionicons name={workAreasOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
          </TouchableOpacity>

          {workAreasOpen ? reportDraft.locationGroups.map((group, groupIndex) => (
            <View key={`${group.id}-${groupIndex}`} style={styles.reportDocumentSection}>
              <Text style={styles.reportDocumentLocationTitle}>
                {group.title}
              </Text>

              {group.workAreas.map((area, areaIndex) => (
                <ReportWorkArea
                  key={`${area.id}-${areaIndex}`}
                  area={area}
                />
              ))}
            </View>
          )) : null}
        </View>
      ) : null}
    </View>
  );
}

function DAVEReportOverview({
  briefing,
  reportFormat,
}: {
  briefing: DAVEReportBriefing;
  reportFormat: ReportFormat;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [completedAreasOpen, setCompletedAreasOpen] = useState(false);
  const conditionTone = briefing.overallCondition === 'critical'
    ? styles.reportConditionCritical
    : briefing.overallCondition === 'stable'
      ? styles.reportConditionStable
      : styles.reportConditionAttention;
  const activeAreas = briefing.dashboard.workAreas.filter(area => !area.completed);
  const completedAreas = briefing.dashboard.workAreas.filter(area => area.completed);
  const periodChanges = briefing.recentChanges.slice(0, reportFormat === 'executive' ? 5 : 8);
  const managementActions = briefing.nextActions.slice(0, reportFormat === 'executive' ? 4 : 6);
  const visibleMilestones = briefing.milestones.slice(0, reportFormat === 'executive' ? 5 : 8);

  return (
    <>
      <View style={[styles.reportConditionBanner, conditionTone]}>
        <Text style={styles.reportConditionEyebrow}>CURRENT PROJECT STATUS</Text>
        <Text style={styles.reportConditionTitle}>{briefing.conditionLabel}</Text>
        <Text selectable style={styles.reportConditionText}>{briefing.executiveSnapshot}</Text>
      </View>

      <ReportPeriodSummary
        briefing={briefing}
        changes={periodChanges}
      />
      <ReportProjectPosition briefing={briefing} />

      {reportFormat === 'executive' ? (
        <>
          <ReportManagementActions
            title="Management Actions"
            actions={managementActions}
          />
          <ReportMilestones milestones={visibleMilestones} />
          <ReportScheduleHealth briefing={briefing} />
        </>
      ) : (
        <>
          <ReportManagementActions
            title="Action Plan"
            actions={managementActions}
          />

          {briefing.currentWork.length ? (
            <ReportSummaryCard
              title="Current Work"
              items={briefing.currentWork.slice(0, 6)}
              tone="progress"
            />
          ) : null}

          <ReportMilestones milestones={visibleMilestones} />
          <ReportStatusDistribution briefing={briefing} />
          <ReportScheduleHealth briefing={briefing} />
          <ReportControlSummary briefing={briefing} />

          {briefing.dashboard.workAreas.length ? (
            <>
              <View style={styles.reportProgressSection}>
                <View style={styles.reportProgressHeading}>
                  <Text style={styles.reportDocumentSectionTitle}>Progress by Work Area</Text>
                  <Text style={styles.reportProgressHelper}>Weighted by scheduled duration</Text>
                </View>
                <View style={styles.reportAreaProgressList}>
                  {activeAreas.map(area => <ReportAreaProgressRow key={area.id} area={area} />)}
                </View>
              </View>
              {completedAreas.length ? (
                <View style={styles.reportDisclosure}>
                  <TouchableOpacity
                    style={styles.reportDisclosureHeader}
                    onPress={() => setCompletedAreasOpen(open => !open)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: completedAreasOpen }}
                    accessibilityLabel="Completed work areas"
                  >
                    <View style={styles.reportDisclosureHeaderText}>
                      <Text style={styles.reportDisclosureTitle}>Completed Areas</Text>
                      <Text style={styles.reportDisclosureSummary}>
                        {completedAreas.length} complete
                      </Text>
                    </View>
                    <Ionicons name={completedAreasOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
                  </TouchableOpacity>
                  {completedAreasOpen ? (
                    <View style={styles.reportAreaProgressList}>
                      {completedAreas.map(area => <ReportAreaProgressRow key={area.id} area={area} />)}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
        </>
      )}

      <View style={styles.reportDisclosure}>
        <TouchableOpacity
          style={styles.reportDisclosureHeader}
          onPress={() => setDetailsOpen(open => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsOpen }}
          accessibilityLabel="Project status details"
        >
          <View style={styles.reportDisclosureHeaderText}>
            <Text style={styles.reportDisclosureTitle}>Project Status Details</Text>
            <Text style={styles.reportDisclosureSummary}>Source-backed task and schedule facts</Text>
          </View>
          <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
        </TouchableOpacity>
        {detailsOpen ? (
          <View style={styles.reportDisclosureContent}>
            <ReportInsightSection title="Current Task Position" items={briefing.projectConditions.map(condition =>
              `${briefing.projectConditions.length > 1 ? `${condition.projectName}: ` : ''}${condition.currentReality}`
            ).filter(item => item.replace(/^[^:]+:\s*/, '').trim())} />
            <ReportInsightSection title="Schedule" items={briefing.schedulePosition} />
            <ReportInsightSection title="Risks" items={briefing.criticalRisks} emphasis="risk" />
            <ReportInsightSection title="Decisions" items={briefing.decisionsRequired} emphasis="decision" />
          </View>
        ) : null}
      </View>
    </>
  );
}

function ReportPeriodSummary({
  briefing,
  changes,
}: {
  briefing: DAVEReportBriefing;
  changes: DAVEReportBriefing['recentChanges'];
}) {
  const period = briefing.reportingPeriod;
  const deltas = [
    { label: 'Completed', value: signedCount(period.completeDelta), tone: period.completeDelta >= 0 ? 'positive' : 'negative' },
    { label: 'Open', value: signedCount(period.openDelta), tone: period.openDelta <= 0 ? 'positive' : 'neutral' },
    { label: 'Overdue', value: signedCount(period.overdueDelta), tone: period.overdueDelta <= 0 ? 'positive' : 'negative' },
  ] as const;

  return (
    <View style={styles.reportPeriodSection}>
      <View style={styles.reportProgressHeader}>
        <View>
          <Text style={styles.reportDocumentSectionTitle}>Reporting Period</Text>
          <Text style={styles.reportProgressHelper}>{period.label}</Text>
        </View>
      </View>
      {period.basis === 'previous_approved_report' ? (
        <View style={styles.reportDeltaRow}>
          {deltas.map(delta => (
            <View key={delta.label} style={styles.reportDeltaMetric}>
              <Text style={[
                styles.reportDeltaValue,
                delta.tone === 'positive'
                  ? styles.reportDeltaPositive
                  : delta.tone === 'negative'
                    ? styles.reportDeltaNegative
                    : null,
              ]}>
                {delta.value}
              </Text>
              <Text style={styles.reportDeltaLabel}>{delta.label}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.reportChartEmpty}>
          This approval establishes the baseline for the next reporting period.
        </Text>
      )}
      {changes.length > 0 ? (
        <View style={styles.reportChangeList}>
          {changes.map(change => (
            <View key={change.id} style={styles.reportChangeRow}>
              <Ionicons name="arrow-forward-circle-outline" size={17} color={colors.primary} />
              <Text selectable style={styles.reportChangeText}>{change.summary}</Text>
            </View>
          ))}
        </View>
      ) : period.basis === 'previous_approved_report' ? (
        <Text style={styles.reportChartEmpty}>No material task changes were recorded in this period.</Text>
      ) : null}
    </View>
  );
}

function ReportProjectPosition({ briefing }: { briefing: DAVEReportBriefing }) {
  return (
    <View style={styles.reportProjectPositionSection}>
      <Text style={styles.reportDocumentSectionTitle}>Project Position</Text>
      <View style={styles.reportProjectPositionList}>
        {briefing.projectConditions.map(condition => (
          <View key={condition.projectName} style={styles.reportProjectPositionCard}>
            <View style={styles.reportProjectPositionHeader}>
              <Text style={styles.reportProjectPositionTitle}>{condition.projectName}</Text>
              <Text style={styles.reportProjectPositionPercent}>{condition.percentComplete}%</Text>
            </View>
            <View style={styles.reportAreaProgressTrack}>
              <View style={[styles.reportAreaProgressFill, { width: `${condition.percentComplete}%` }]} />
            </View>
            <Text style={styles.reportProjectPositionText}>{condition.currentReality}</Text>
            <Text style={styles.reportProjectPositionText}>{condition.schedule}</Text>
            <View style={styles.reportProjectDateRow}>
              <ReportDateFact label="Forecast" value={formatReportShortDate(condition.forecastFinish)} />
              <ReportDateFact label="Baseline" value={formatReportShortDate(condition.baselineFinish)} />
              <ReportDateFact
                label="Variance"
                value={formatVariance(condition.forecastVarianceDays)}
                alert={Boolean(condition.forecastVarianceDays && condition.forecastVarianceDays > 0)}
              />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReportDateFact({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <View style={styles.reportDateFact}>
      <Text style={styles.reportDateFactLabel}>{label}</Text>
      <Text style={[styles.reportDateFactValue, alert && styles.reportDateFactAlert]}>{value}</Text>
    </View>
  );
}

function ReportManagementActions({
  title,
  actions,
}: {
  title: string;
  actions: DAVEReportBriefing['nextActions'];
}) {
  if (!actions.length) return null;
  return (
    <View style={styles.reportManagementSection}>
      <Text style={styles.reportDocumentSectionTitle}>{title}</Text>
      <View style={styles.reportManagementList}>
        {actions.map(action => (
          <View key={action.id} style={styles.reportManagementCard}>
            <View style={styles.reportManagementHeader}>
              <View style={styles.reportManagementTitleGroup}>
                <Text style={styles.reportManagementTask}>{action.taskName}</Text>
                <Text style={styles.reportManagementContext}>
                  {[action.projectName, action.areaName].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {action.dueDate ? (
                <View style={styles.reportDuePill}>
                  <Text style={styles.reportDuePillText}>{formatReportShortDate(action.dueDate)}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.reportManagementFactRow}>
              <Text style={styles.reportManagementLabel}>Issue</Text>
              <Text style={styles.reportManagementText}>{action.issue}</Text>
            </View>
            <View style={styles.reportManagementFactRow}>
              <Text style={styles.reportManagementLabel}>Impact</Text>
              <Text style={styles.reportManagementText}>{action.impact}</Text>
            </View>
            <View style={styles.reportManagementFactRow}>
              <Text style={styles.reportManagementLabel}>Action</Text>
              <Text style={styles.reportManagementText}>{action.action}</Text>
            </View>
            <Text style={styles.reportManagementOwner}>
              Owner: {action.owner} · {action.timing}
              {action.scheduleImpactDays !== null
                ? ` · ${action.scheduleImpactDays} schedule day${Math.abs(action.scheduleImpactDays) === 1 ? '' : 's'}`
                : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReportMilestones({
  milestones,
}: {
  milestones: DAVEReportBriefing['milestones'];
}) {
  if (!milestones.length) return null;
  return (
    <View style={styles.reportMilestoneSection}>
      <Text style={styles.reportDocumentSectionTitle}>Milestones</Text>
      <View style={styles.reportMilestoneList}>
        {milestones.map(milestone => (
          <View key={milestone.id} style={styles.reportMilestoneRow}>
            <View style={[
              styles.reportMilestoneIcon,
              milestone.state === 'complete'
                ? styles.reportMilestoneComplete
                : milestone.state === 'missed'
                  ? styles.reportMilestoneMissed
                  : milestone.state === 'due_soon'
                    ? styles.reportMilestoneDueSoon
                    : null,
            ]}>
              <Ionicons name="diamond-outline" size={16} color={colors.primary} />
            </View>
            <View style={styles.reportMilestoneTextGroup}>
              <Text style={styles.reportMilestoneTitle}>{milestone.taskName}</Text>
              <Text style={styles.reportMilestoneMeta}>
                {[milestone.projectName, milestone.areaName, formatReportShortDate(milestone.finishDate)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <Text style={styles.reportMilestoneState}>{milestoneStateLabel(milestone.state)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReportControlSummary({ briefing }: { briefing: DAVEReportBriefing }) {
  const controls = briefing.dashboard.controls;
  const values = [
    { label: 'Approvals', value: controls.pendingApprovals },
    { label: 'Responses due', value: controls.responsesDue },
    { label: 'Unassigned', value: controls.unassignedOpenWork },
    { label: 'Checklist items', value: controls.incompleteChecklistItems },
  ].filter(item => item.value > 0);
  if (!values.length) return null;
  return (
    <View style={styles.reportControlSection}>
      <Text style={styles.reportDocumentSectionTitle}>Project Controls</Text>
      <View style={styles.reportControlRow}>
        {values.map(item => (
          <View key={item.label} style={styles.reportControlMetric}>
            <Text style={styles.reportControlValue}>{item.value}</Text>
            <Text style={styles.reportControlLabel}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReportStatusDistribution({ briefing }: { briefing: DAVEReportBriefing }) {
  const status = briefing.dashboard.taskStatus;
  const segments = [
    { label: 'Complete', value: status.complete, color: colors.success },
    { label: 'In Progress', value: status.inProgress, color: colors.primary },
    { label: 'Waiting', value: status.waiting, color: colors.warning },
    { label: 'Not Started', value: status.notStarted, color: colors.border },
  ].filter(segment => segment.value > 0);
  return (
    <View style={styles.reportChartSection}>
      <View style={styles.reportProgressHeader}>
        <Text style={styles.reportDocumentSectionTitle}>Task Status</Text>
        <Text style={styles.reportProgressHelper}>{status.total} tasks</Text>
      </View>
      {status.total ? (
        <View style={styles.reportStatusChart} accessibilityLabel="Task status distribution">
          {segments.map(segment => (
            <View key={segment.label} style={[styles.reportStatusSegment, { flex: segment.value, backgroundColor: segment.color }]} />
          ))}
        </View>
      ) : (
        <Text style={styles.reportChartEmpty}>No schedule tasks available.</Text>
      )}
      <View style={styles.reportChartLegend}>
        {segments.map(segment => (
          <View key={segment.label} style={styles.reportLegendItem}>
            <View style={[styles.reportLegendDot, { backgroundColor: segment.color }]} />
            <Text style={styles.reportLegendText}>{segment.label} · {segment.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReportScheduleHealth({ briefing }: { briefing: DAVEReportBriefing }) {
  const health = briefing.dashboard.scheduleHealth;
  return (
    <View style={styles.reportChartSection}>
      <Text style={styles.reportDocumentSectionTitle}>Schedule Health</Text>
      <View style={styles.reportMetricRow}>
        <ReportMetric label="On Track" value={health.onTrack} tone="stable" />
        <ReportMetric label="Blocked" value={health.blocked} tone="critical" />
        <ReportMetric label="Due Soon" value={health.dueSoon} tone="attention" />
        <ReportMetric label="Overdue" value={health.overdue} tone="critical" />
      </View>
    </View>
  );
}

function ReportMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'stable' | 'attention' | 'critical';
}) {
  return (
    <View style={[
      styles.reportMetric,
      tone === 'stable' ? styles.reportMetricStable : tone === 'attention' ? styles.reportMetricAttention : styles.reportMetricCritical,
    ]}>
      <Text style={styles.reportMetricValue}>{value}</Text>
      <Text
        style={styles.reportMetricLabel}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </Text>
    </View>
  );
}

function ReportSummaryCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly string[];
  tone: 'progress' | 'risk' | 'action';
}) {
  return (
    <View style={[
      styles.reportSummaryCard,
      tone === 'risk' ? styles.reportSummaryRisk : tone === 'action' ? styles.reportSummaryAction : styles.reportSummaryProgress,
    ]}>
      <Text accessibilityRole="header" style={styles.reportSummaryTitle}>{title}</Text>
      {items.map((item, index) => (
        <Text selectable key={`${title}-${index}-${item}`} style={styles.reportSummaryText}>
          {index + 1}. {item}
        </Text>
      ))}
    </View>
  );
}

function ReportAreaProgressRow({
  area,
}: {
  area: DAVEReportBriefing['dashboard']['workAreas'][number];
}) {
  return (
    <View style={styles.reportAreaProgressRow}>
      <View style={styles.reportAreaProgressHeader}>
        <Text style={styles.reportAreaProgressTitle} numberOfLines={1}>{area.areaName}</Text>
        <Text style={styles.reportAreaProgressValue}>{area.averagePercent}%</Text>
      </View>
      <View style={styles.reportAreaProgressTrack}>
        <View style={[styles.reportAreaProgressFill, { width: `${area.averagePercent}%` }]} />
      </View>
      <Text style={styles.reportAreaProgressMeta}>
        {area.completeTaskCount} of {area.taskCount} task{area.taskCount === 1 ? '' : 's'} complete
      </Text>
    </View>
  );
}

function ReportInsightSection({
  title,
  items,
  emptyText,
  emphasis,
}: {
  title: string;
  items: readonly string[];
  emptyText?: string;
  emphasis?: 'risk' | 'decision' | 'action';
}) {
  const values = items.length ? items : emptyText ? [emptyText] : [];
  if (!values.length) return null;
  return (
    <View style={styles.reportDocumentSection}>
      <Text style={styles.reportDocumentSectionTitle}>{title}</Text>
      <View style={styles.reportDocumentBulletList}>
        {values.map((item, index) => (
          <View key={`${title}-${index}-${item}`} style={styles.reportDocumentBulletRow}>
            <View style={[
              styles.reportInsightMarker,
              emphasis === 'risk' && styles.reportInsightMarkerRisk,
              emphasis === 'decision' && styles.reportInsightMarkerDecision,
              emphasis === 'action' && styles.reportInsightMarkerAction,
            ]} />
            <Text style={styles.reportDocumentBulletText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReportWorkArea({
  area,
}: {
  area: PIEReportDraft['locationGroups'][number]['workAreas'][number];
}) {
  const [open, setOpen] = useState(false);
  const title = area.projectName !== area.title
    ? `${area.projectName} — ${area.title}`
    : area.title;
  const bullets = area.bullets
    .map(bullet => ({ ...bullet, text: toPMReportLanguage(bullet.text) }))
    .filter(bullet => Boolean(bullet.text));
  return (
    <View style={styles.reportDocumentArea}>
      <TouchableOpacity
        style={styles.reportAreaHeader}
        onPress={() => setOpen(value => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title} work area`}
      >
        <View style={styles.reportAreaHeaderText}>
          <Text style={styles.reportDocumentAreaTitle}>{title}</Text>
          <Text style={styles.reportAreaMeta}>
            {bullets.length} update{bullets.length === 1 ? '' : 's'} · {area.imageReferences.length} photo{area.imageReferences.length === 1 ? '' : 's'}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
      </TouchableOpacity>
      {open ? <View style={styles.reportDocumentBulletList}>
        {bullets.map((bullet, index) => (
          <View key={`${bullet.id}-${index}`} style={styles.reportDocumentBulletRow}>
            <Text style={styles.reportDocumentBulletMarker}>•</Text>
            <Text style={styles.reportDocumentBulletText}>
              <Text style={styles.reportDocumentBulletLabel}>{reportPreviewBulletLabel(bullet.kind)}:{' '}</Text>
              {bullet.text}
            </Text>
          </View>
        ))}
        {area.imageReferences.map((reference, index) => (
          <View key={`${reference.photoId}-${index}`} style={styles.reportEvidenceReference}>
            <Ionicons name="image-outline" size={16} color={colors.primary} />
            <Text style={styles.reportEvidenceReferenceText}>
              Photo {reference.imageNumber} — {reference.caption || `Project photo from ${reference.areaName}`}
            </Text>
          </View>
        ))}
      </View> : null}
    </View>
  );
}

function formatReportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatReportShortDate(value: string | null) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatVariance(value: number | null) {
  if (value === null) return 'Not set';
  if (value === 0) return 'On baseline';
  return `${value > 0 ? '+' : ''}${value} day${Math.abs(value) === 1 ? '' : 's'}`;
}

function signedCount(value: number) {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : ''}${value}`;
}

function milestoneStateLabel(state: DAVEReportBriefing['milestones'][number]['state']) {
  if (state === 'complete') return 'Complete';
  if (state === 'missed') return 'Missed';
  if (state === 'due_soon') return 'Due soon';
  if (state === 'upcoming') return 'Upcoming';
  return 'No date';
}

function ReportShareButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.reportShareButton, disabled && styles.reportActionButtonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={[styles.reportActionText, disabled && styles.reportActionTextDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

function reportPreviewBulletLabel(kind: string) {
  if (kind === 'safety') return 'Safety';
  if (kind === 'issue') return 'Issue';
  if (kind === 'next_step') return 'Action';
  if (kind === 'schedule') return 'Schedule';
  if (kind === 'image_reference') return 'Photo';

  return 'Progress';
}

function reportProjectKey(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
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
    useState('Reviewed in Decision History.');

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
            Preserve what was known before learning from the result.
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
          Reports are monitored for meaningful decisions. Routine notes and low-confidence drafts are ignored.
        </Text>
      ) : (
        <View style={styles.decisionStack}>
          <View style={styles.decisionSelectorRow}>
            {decisions.slice(0, 3).map((decision, index) => (
              <TouchableOpacity
                key={`${decision.id}-${index}`}
                style={[
                  styles.decisionChip,
                  decision.id === selectedDecision?.id && styles.decisionChipSelected,
                ]}
                onPress={() => setSelectedDecisionId(decision.id)}
                accessibilityRole="button"
                accessibilityLabel={`View decision ${currentDecisionSnapshot(decision).selectedOption}`}
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
                  Automated monitoring
                </Text>
                <Text style={styles.reportListText}>
                  This decision was detected, its original snapshot was preserved, and project evidence is being monitored for implementation and outcome support.
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
                Automatic review handles routine lifecycle steps when evidence is strong enough. Use these controls only to approve a real decision, correct an interpretation, or resolve an exception.
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
    return 'Preparing an outcome plan';
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
  // Audit P1-37: display the operative (current corrected) snapshot.
  const snapshot = currentDecisionSnapshot(decision);
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

  beforeShareDetails: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },

  beforeShareWhyButton: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
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

  reportOptionsToggle: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

  reportOptionsTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },

  reportOptionsSummary: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },

  reportOptionsPanel: {
    gap: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
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

  reportDocumentMeta: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },

  reportDocumentRule: {
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },

  reportEditNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },

  reportEditNoticeText: {
    flex: 1,
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },

  reportConditionBanner: {
    borderRadius: 10,
    borderLeftWidth: 5,
    padding: spacing.md,
    gap: spacing.xs,
  },

  reportConditionCritical: {
    backgroundColor: colors.dangerSoft,
    borderLeftColor: colors.danger,
  },

  reportConditionAttention: {
    backgroundColor: colors.warningSoft,
    borderLeftColor: colors.warning,
  },

  reportConditionStable: {
    backgroundColor: colors.successSoft,
    borderLeftColor: colors.success,
  },

  reportConditionEyebrow: {
    color: colors.mutedText,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  reportConditionTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },

  reportConditionText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },

  reportConditionSchedule: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },

  reportChartSection: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.sm,
  },

  reportPeriodSection: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.sm,
  },

  reportDeltaRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },

  reportDeltaMetric: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.xs,
  },

  reportDeltaValue: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },

  reportDeltaPositive: {
    color: colors.success,
  },

  reportDeltaNegative: {
    color: colors.danger,
  },

  reportDeltaLabel: {
    color: colors.mutedText,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },

  reportChangeList: {
    gap: spacing.xs,
  },

  reportChangeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },

  reportChangeText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },

  reportProjectPositionSection: {
    gap: spacing.sm,
  },

  reportProjectPositionList: {
    gap: spacing.xs,
  },

  reportProjectPositionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.xs,
  },

  reportProjectPositionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

  reportProjectPositionTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },

  reportProjectPositionPercent: {
    color: colors.primary,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },

  reportProjectPositionText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },

  reportProjectDateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  reportDateFact: {
    flex: 1,
    minWidth: 92,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },

  reportDateFactLabel: {
    color: colors.mutedText,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  reportDateFactValue: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
  },

  reportDateFactAlert: {
    color: colors.danger,
  },

  reportManagementSection: {
    gap: spacing.sm,
  },

  reportManagementList: {
    gap: spacing.xs,
  },

  reportManagementCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.xs,
  },

  reportManagementHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

  reportManagementTitleGroup: {
    flex: 1,
    gap: spacing.xxs,
  },

  reportManagementTask: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },

  reportManagementContext: {
    color: colors.mutedText,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },

  reportDuePill: {
    borderRadius: 999,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },

  reportDuePillText: {
    color: colors.text,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
  },

  reportManagementFactRow: {
    gap: spacing.xxs,
  },

  reportManagementLabel: {
    color: colors.primary,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  reportManagementText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },

  reportManagementOwner: {
    color: colors.mutedText,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '900',
  },

  reportMilestoneSection: {
    gap: spacing.sm,
  },

  reportMilestoneList: {
    gap: spacing.xs,
  },

  reportMilestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.xs,
  },

  reportMilestoneIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },

  reportMilestoneComplete: {
    backgroundColor: colors.successSoft,
  },

  reportMilestoneMissed: {
    backgroundColor: colors.dangerSoft,
  },

  reportMilestoneDueSoon: {
    backgroundColor: colors.warningSoft,
  },

  reportMilestoneTextGroup: {
    flex: 1,
    gap: spacing.xxs,
  },

  reportMilestoneTitle: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },

  reportMilestoneMeta: {
    color: colors.mutedText,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
  },

  reportMilestoneState: {
    color: colors.text,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
  },

  reportControlSection: {
    gap: spacing.sm,
  },

  reportControlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  reportControlMetric: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.xs,
  },

  reportControlValue: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },

  reportControlLabel: {
    color: colors.mutedText,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
  },

  reportProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

  reportProgressHeading: {
    alignItems: 'flex-start',
    gap: spacing.xxs,
  },

  reportProgressHelper: {
    color: colors.mutedText,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },

  reportStatusChart: {
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
  },

  reportStatusSegment: {
    minWidth: 3,
  },

  reportChartLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  reportLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },

  reportLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  reportLegendText: {
    color: colors.mutedText,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },

  reportChartEmpty: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },

  reportMetricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  reportMetric: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 0,
    borderRadius: 10,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    gap: spacing.xxs,
    alignItems: 'center',
  },

  reportMetricStable: {
    backgroundColor: colors.successSoft,
  },

  reportMetricAttention: {
    backgroundColor: colors.warningSoft,
  },

  reportMetricCritical: {
    backgroundColor: colors.dangerSoft,
  },

  reportMetricValue: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },

  reportMetricLabel: {
    color: colors.mutedText,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
  },

  reportSummaryStack: {
    gap: spacing.xs,
  },

  reportSummaryCard: {
    borderRadius: 10,
    borderLeftWidth: 4,
    padding: spacing.sm,
    gap: spacing.xs,
  },

  reportSummaryProgress: {
    borderLeftColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },

  reportSummaryRisk: {
    borderLeftColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },

  reportSummaryAction: {
    borderLeftColor: colors.success,
    backgroundColor: colors.successSoft,
  },

  reportSummaryTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },

  reportSummaryText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },

  reportProgressSection: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.sm,
  },

  reportAreaProgressList: {
    gap: spacing.sm,
  },

  reportAreaProgressRow: {
    gap: spacing.xxs,
  },

  reportAreaProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

  reportAreaProgressTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },

  reportAreaProgressValue: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },

  reportAreaProgressTrack: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },

  reportAreaProgressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: colors.primary,
  },

  reportAreaProgressMeta: {
    color: colors.mutedText,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },

  reportCompletedAreas: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
    gap: spacing.sm,
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
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    borderRadius: 10,
    padding: spacing.sm,
    gap: spacing.xs,
  },

  reportAreaHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

  reportAreaHeaderText: {
    flex: 1,
    gap: spacing.xxs,
  },

  reportAreaMeta: {
    color: colors.mutedText,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
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

  reportInsightMarker: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 7,
    marginRight: spacing.xs,
  },

  reportInsightMarkerRisk: {
    backgroundColor: colors.danger,
  },

  reportInsightMarkerDecision: {
    backgroundColor: colors.warning,
  },

  reportInsightMarkerAction: {
    backgroundColor: colors.success,
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

  reportDisclosure: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    gap: spacing.sm,
  },

  reportDisclosureHeader: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

  reportDisclosureHeaderText: {
    flex: 1,
    gap: spacing.xxs,
  },

  reportDisclosureTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },

  reportDisclosureSummary: {
    color: colors.mutedText,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },

  reportDisclosureContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
  },

  reportSupportingLabel: {
    color: colors.mutedText,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  reportEvidenceLine: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },

  reportReasoningToggle: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },

  reportReasoningToggleText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },

  reportReasoningText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    padding: spacing.sm,
  },

  reportEvidenceReference: {
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    padding: spacing.xs,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },

  reportEvidenceReferenceText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
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

  reportProjectPicker: {
    gap: spacing.xs,
  },

  reportProjectOption: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  reportProjectOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },

  reportProjectOptionText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  reportProjectOptionTextSelected: {
    color: colors.primary,
    fontWeight: '900',
  },

  reportProjectSelectionHelper: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
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

  managementActionRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
    paddingTop: spacing.xs,
    gap: 2,
  },

  managementActionTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },

  managementActionMeta: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
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

  reportShareMenu: {
    flexDirection: 'row',
    gap: spacing.xs,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.xs,
  },

  reportShareButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
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

  communicationErrorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
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
