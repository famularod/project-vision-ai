import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import type {
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screen } from '../components/layout/Screen';
import { ScreenCard } from '../components/layout/ScreenCard';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import {
  colors,
  spacing,
  typography,
} from '../theme';
import {
  analyzeProjectIntelligence,
  type ProjectCommunicationReadiness,
  type ProjectConfidenceSignal,
  type ProjectHealthSignal,
  type ProjectIntelligenceSummary,
  type ProjectSyncFreshnessMetadata,
  type ProjectNextAction,
  type ProjectRiskSignal,
} from '../services/ProjectIntelligenceEngine';
import type {
  ContactBook,
  ProjectArea,
  ProjectStats,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import { formatDisplayDate } from '../utils/date';
import { buildScheduleSummary } from '../utils/schedule';

type IconName = keyof typeof Ionicons.glyphMap;

type Health = {
  label: string;
  color: string;
  backgroundColor: string;
};

type ConfidenceSignal = {
  label: string;
  met: boolean;
  detail: string;
};

type ProjectConfidence = {
  score: number;
  label: string;
  detail: string;
  signals: ConfidenceSignal[];
};

type FocusItem = {
  title: string;
  detail: string;
  icon: IconName;
  danger?: boolean;
};

export function ProjectOverviewScreen({
  contentStyle,
  projectName,
  savedUpdates,
  scheduleItems,
  projectAreas,
  contacts,
  referenceDocuments,
  syncMetadata,
  onBack,
  onCaptureUpdate,
  onGenerateReport,
  onViewTimeline,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projectName: string;
  stats: ProjectStats;
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  projectAreas?: ProjectArea[];
  contacts?: ContactBook;
  referenceDocuments?: ReferenceDocument[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  onBack: () => void;
  onCaptureUpdate: () => void;
  onGenerateReport: () => void;
  onViewTimeline: () => void;
}) {
  const projectUpdates = savedUpdates
    .filter(update => projectMatches(update.projectName, projectName))
    .sort(compareUpdatesNewestFirst);
  const intelligence = analyzeProjectIntelligence({
    projectName,
    updates: savedUpdates,
    scheduleItems,
    projectAreas,
    contacts,
    referenceDocuments,
    syncMetadata,
  });
  const scheduleSummary = buildScheduleSummary(scheduleItems, {
    projectName,
  });
  const health = projectHealthFromPIE(intelligence.healthSignal);
  const progress = intelligence.metrics.averageScheduleProgress;
  const scheduleStatus = scheduleStatusLabelFromPIE(intelligence);
  const safety = safetyStatusFromPIE(intelligence);
  const criticalIssues = criticalIssueCountFromPIE(intelligence);
  const upcomingMilestones = scheduleSummary.milestoneTasks
    .filter(
      task =>
        !task.isCompleted &&
        task.daysUntilDue !== null &&
        task.daysUntilDue >= 0,
    )
    .slice(0, 3);
  const nextMilestone = upcomingMilestones[0] || null;
  const projectPhotos = projectUpdates
    .flatMap(update =>
      update.photos.map(photo => ({
        ...photo,
        updateDate: update.date,
      })),
    );
  const recentPhotos = projectPhotos.slice(0, 3);
  const recentUpdates = projectUpdates.slice(0, 3);
  const confidence = projectConfidenceFromPIE(intelligence.confidence);
  const todaysFocus = todayFocusItems(intelligence);
  const changedItems = whatsChangedItems(intelligence);
  const recommendation = recommendedNextActionFromPIE(
    intelligence.recommendedNextAction,
  );
  const locationIntelligence = intelligence.locationIntelligence;
  const locationDetail =
    locationIntelligence.lastKnownLocation !== 'Unknown'
      ? `${locationIntelligence.lastKnownLocation} | ${locationIntelligence.presenceLabel} | ${locationIntelligence.confidenceScore}% confidence`
      : `${locationIntelligence.gpsStatus} | ${locationIntelligence.confidenceScore}% confidence`;
  const communicationReadiness = communicationReadinessSummary(
    intelligence.communicationReadiness,
  );

  return (
    <Screen contentStyle={contentStyle}>
      <ScreenHeader
        eyebrow="Project Overview"
        title={projectName}
        onBack={onBack}
      />

      <ScreenCard
        style={styles.healthCard}
        elevated
      >
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            Project Summary
          </Text>

          <View style={styles.pieBadge}>
            <Text style={styles.pieBadgeText}>
              Powered by PIE
            </Text>
          </View>
        </View>

        <View style={styles.healthHeader}>
          <View>
            <Text style={styles.label}>
              Project Health
            </Text>

            <View style={styles.healthValueRow}>
              <View
                style={[
                  styles.healthDot,
                  { backgroundColor: health.color },
                ]}
              />

              <Text style={styles.healthValue}>
                {health.label}
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.progressBadge,
              { backgroundColor: health.backgroundColor },
            ]}
          >
            <Text
              style={[
                progress === null
                  ? styles.progressTextValue
                  : styles.progressValue,
                { color: health.color },
              ]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {progress === null ? 'Schedule Required' : `${progress}%`}
            </Text>
            <Text style={styles.progressLabel}>
              Overall Progress
            </Text>
          </View>
        </View>

        <View style={styles.summaryGrid}>
          <SummaryMetric
            label="Schedule Status"
            value={scheduleStatus}
            icon="calendar-outline"
          />
          <SummaryMetric
            label="Open Issues"
            value={intelligence.metrics.openIssueCount.toString()}
            icon="alert-circle-outline"
            danger={intelligence.metrics.openIssueCount > 0}
          />
          <SummaryMetric
            label="Critical Issues"
            value={criticalIssues.toString()}
            icon="warning-outline"
            danger={criticalIssues > 0}
          />
          <SummaryMetric
            label="Safety Status"
            value={safety.label}
            icon="shield-checkmark-outline"
            danger={safety.danger}
          />
          <SummaryMetric
            label="Next Milestone"
            value={
              nextMilestone
                ? `${nextMilestone.title} | ${nextMilestone.dueLabel}`
                : 'No upcoming milestone'
            }
            icon="flag-outline"
          />
          <SummaryMetric
            label="Last Update"
            value={formatPieLastUpdate(intelligence.lastUpdate)}
            icon="time-outline"
          />
        </View>

        <ProjectConfidencePanel confidence={confidence} />
      </ScreenCard>

      <ScreenCard style={styles.pieInsightCard}>
        <View style={styles.pieInsightHeader}>
          <View style={styles.pieInsightIcon}>
            <Ionicons
              name="sparkles-outline"
              size={22}
              color={colors.primary}
            />
          </View>

          <View style={styles.recommendationTextGroup}>
            <Text style={styles.pieInsightLabel}>
              PIE Insight
            </Text>

            <Text style={styles.pieInsightTitle}>
              PIE recommends: {intelligence.recommendedNextAction.label}
            </Text>

            <Text style={styles.pieInsightDetail}>
              {intelligence.recommendedNextAction.description}
            </Text>

            <Text style={styles.pieInsightDetail}>
              Location Intelligence: {locationDetail}
            </Text>

            {locationIntelligence.confirmationPrompt ? (
              <Text style={styles.pieInsightDetail}>
                {locationIntelligence.confirmationPrompt}
              </Text>
            ) : null}
          </View>
        </View>
      </ScreenCard>

      <OverviewSection title="Today's Focus">
        {todaysFocus.map(item => (
          <OverviewListRow
            key={item.title}
            title={item.title}
            detail={item.detail}
            icon={item.icon}
            danger={item.danger}
          />
        ))}
      </OverviewSection>

      <OverviewSection title="What's Changed">
        <View style={styles.changeGrid}>
          {changedItems.map(item => (
            <ChangeMetric
              key={item.label}
              label={item.label}
              value={item.value}
              placeholder={item.placeholder}
            />
          ))}
        </View>
      </OverviewSection>

      <ScreenCard style={styles.recommendationCard}>
        <View style={styles.recommendationHeader}>
          <View style={styles.recommendationIcon}>
            <Ionicons
              name={recommendation.icon}
              size={22}
              color={colors.primary}
            />
          </View>

          <View style={styles.recommendationTextGroup}>
            <Text style={styles.sectionTitle}>
              Recommended Next Action
            </Text>

            <Text style={styles.recommendationText}>
              {recommendation.title}
            </Text>

            <Text style={styles.recommendationDetail}>
              {recommendation.detail}
            </Text>

            <Text style={styles.recommendationDetail}>
              {communicationReadiness}
            </Text>
          </View>
        </View>
      </ScreenCard>

      <OverviewSection title="Upcoming Milestones">
        {upcomingMilestones.length > 0 ? (
          upcomingMilestones.map(task => (
            <OverviewListRow
              key={task.item.id}
              title={task.title}
              detail={`${task.areaName} | ${task.dueLabel}`}
              icon="flag-outline"
            />
          ))
        ) : (
          <EmptyOverviewText
            text={
              scheduleSummary.totalItems === 0
                ? 'Schedule required to calculate upcoming milestones.'
                : 'No upcoming milestones identified.'
            }
          />
        )}
      </OverviewSection>

      <OverviewSection title="Recent Photos">
        {recentPhotos.length > 0 ? (
          <View style={styles.photoRow}>
            {recentPhotos.map(photo => (
              <View
                key={photo.id}
                style={styles.photoTile}
              >
                <Image
                  source={{ uri: photo.uri }}
                  style={styles.photoImage}
                />
                <Text
                  style={styles.photoCaption}
                  numberOfLines={2}
                >
                  {photo.caption.trim() || photo.category}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <EmptyOverviewText text="No project photos yet." />
        )}
      </OverviewSection>

      <OverviewSection title="Recent Updates">
        {recentUpdates.length > 0 ? (
          recentUpdates.map(update => (
            <OverviewListRow
              key={update.id}
              title={formatDisplayDate(update.date)}
              detail={
                update.notes.trim() ||
                `${update.photos.length} photo${update.photos.length === 1 ? '' : 's'} saved`
              }
              icon="newspaper-outline"
            />
          ))
        ) : (
          <EmptyOverviewText text="No saved updates yet." />
        )}
      </OverviewSection>

      <OverviewSection title="Quick Actions">
        <View style={styles.actionStack}>
          <OverviewActionButton
            label="Capture Update"
            icon="camera-outline"
            onPress={onCaptureUpdate}
            primary
          />
          <OverviewActionButton
            label="Generate Report"
            icon="document-text-outline"
            onPress={onGenerateReport}
          />
          <OverviewActionButton
            label="View Timeline"
            icon="git-branch-outline"
            onPress={onViewTimeline}
          />
        </View>
      </OverviewSection>
    </Screen>
  );
}

function SummaryMetric({
  label,
  value,
  icon,
  danger,
}: {
  label: string;
  value: string;
  icon: IconName;
  danger?: boolean;
}) {
  return (
    <View style={styles.summaryMetric}>
      <View
        style={[
          styles.metricIcon,
          danger && styles.metricIconDanger,
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={danger ? colors.danger : colors.primary}
        />
      </View>

      <View style={styles.metricText}>
        <Text style={styles.label}>
          {label}
        </Text>

        <Text
          style={[
            styles.metricValue,
            danger && styles.metricValueDanger,
          ]}
          numberOfLines={2}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function ProjectConfidencePanel({
  confidence,
}: {
  confidence: ProjectConfidence;
}) {
  return (
    <View style={styles.confidencePanel}>
      <View style={styles.confidenceHeader}>
        <View style={styles.confidenceTextGroup}>
          <Text style={styles.label}>
            Project Confidence
          </Text>

          <Text style={styles.confidenceTitle}>
            {confidence.label}
          </Text>
        </View>

        <View style={styles.confidenceScoreBadge}>
          <Text style={styles.confidenceScore}>
            {confidence.score}%
          </Text>
        </View>
      </View>

      <View style={styles.confidenceTrack}>
        <View
          style={[
            styles.confidenceFill,
            { width: `${confidence.score}%` },
          ]}
        />
      </View>

      <Text style={styles.confidenceDetail}>
        {confidence.detail}
      </Text>

      <View style={styles.confidenceSignalGrid}>
        {confidence.signals.map(signal => (
          <View
            key={signal.label}
            style={[
              styles.confidenceSignal,
              signal.met && styles.confidenceSignalMet,
            ]}
          >
            <Ionicons
              name={signal.met ? 'checkmark-circle' : 'ellipse-outline'}
              size={16}
              color={signal.met ? colors.success : colors.tertiaryText}
            />

            <View style={styles.confidenceSignalText}>
              <Text
                style={[
                  styles.confidenceSignalLabel,
                  signal.met && styles.confidenceSignalLabelMet,
                ]}
                numberOfLines={1}
              >
                {signal.label}
              </Text>

              <Text
                style={styles.confidenceSignalDetail}
                numberOfLines={2}
              >
                {signal.detail}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function ChangeMetric({
  label,
  value,
  placeholder,
}: {
  label: string;
  value: string;
  placeholder?: boolean;
}) {
  return (
    <View style={styles.changeMetric}>
      <Text style={styles.label}>
        {label}
      </Text>

      <Text
        style={[
          styles.changeValue,
          placeholder && styles.placeholderValue,
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function OverviewActionButton({
  label,
  icon,
  onPress,
  primary,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionButton,
        primary && styles.primaryActionButton,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={22}
        color={primary ? '#FFFFFF' : colors.primary}
      />

      <Text
        style={[
          styles.actionButtonText,
          primary && styles.primaryActionButtonText,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function OverviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <ScreenCard style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>
        {title}
      </Text>

      {children}
    </ScreenCard>
  );
}

function OverviewListRow({
  title,
  detail,
  icon,
  danger,
}: {
  title: string;
  detail: string;
  icon: IconName;
  danger?: boolean;
}) {
  return (
    <View style={styles.listRow}>
      <View
        style={[
          styles.metricIcon,
          danger && styles.metricIconDanger,
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={danger ? colors.danger : colors.primary}
        />
      </View>

      <View style={styles.listRowText}>
        <Text
          style={styles.listRowTitle}
          numberOfLines={1}
        >
          {title}
        </Text>

        <Text
          style={styles.listRowDetail}
          numberOfLines={2}
        >
          {detail}
        </Text>
      </View>
    </View>
  );
}

function EmptyOverviewText({ text }: { text: string }) {
  return (
    <Text style={styles.emptyText}>
      {text}
    </Text>
  );
}

function projectMatches(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function compareUpdatesNewestFirst(left: ProjectUpdate, right: ProjectUpdate) {
  return right.date.localeCompare(left.date);
}

function projectHealthFromPIE(healthSignal: ProjectHealthSignal): Health {
  if (healthSignal.status === 'at-risk') {
    return {
      label: 'At Risk',
      color: colors.danger,
      backgroundColor: colors.dangerSoft,
    };
  }

  if (healthSignal.status === 'watch') {
    return {
      label: 'Watch',
      color: colors.warning,
      backgroundColor: colors.warningSoft,
    };
  }

  if (healthSignal.status === 'unknown') {
    return {
      label: 'Unknown',
      color: colors.tertiaryText,
      backgroundColor: colors.surfaceMuted,
    };
  }

  return {
    label: 'Healthy',
    color: colors.success,
    backgroundColor: colors.successSoft,
  };
}

function scheduleStatusLabelFromPIE(intelligence: ProjectIntelligenceSummary) {
  if (intelligence.scheduleStatus === 'not-available') return 'No schedule';
  if (intelligence.scheduleStatus === 'overdue') return 'At Risk';
  if (intelligence.scheduleStatus === 'due-soon') return 'Due Soon';
  if (intelligence.scheduleStatus === 'complete') return 'Complete';

  return 'On Track';
}

function safetyStatusFromPIE(intelligence: ProjectIntelligenceSummary) {
  const openSafety = intelligence.metrics.safetyConcernCount;

  if (openSafety > 0) {
    return {
      label: `${openSafety} Open`,
      danger: true,
    };
  }

  return {
    label: 'Clear',
    danger: false,
  };
}

function criticalIssueCountFromPIE(intelligence: ProjectIntelligenceSummary) {
  return intelligence.riskSignals
    .filter(signal => signal.severity === 'critical')
    .reduce((total, signal) => total + (signal.count ?? 1), 0);
}

function projectConfidenceFromPIE(
  confidence: ProjectConfidenceSignal,
): ProjectConfidence {
  return {
    score: confidence.score,
    label: confidenceLevelLabel(confidence.level),
    detail: confidence.message,
    signals: confidence.factors.map(factor => ({
      label: factor.label,
      met: factor.present,
      detail: factor.message,
    })),
  };
}

function confidenceLevelLabel(level: ProjectConfidenceSignal['level']) {
  if (level === 'high') return 'Strong Context';
  if (level === 'medium') return 'Building Context';

  return 'Limited Context';
}

function todayFocusItems(intelligence: ProjectIntelligenceSummary): FocusItem[] {
  const items: FocusItem[] = [];

  intelligence.riskSignals.slice(0, 2).forEach(risk => {
    addFocusItem(items, {
      title: risk.label,
      detail: `${risk.message} ${risk.suggestedAction}`,
      icon: iconForRisk(risk),
      danger: risk.severity === 'critical',
    });
  });

  addFocusItem(items, {
    title: intelligence.recommendedNextAction.label,
    detail: intelligence.recommendedNextAction.description,
    icon: iconForNextAction(intelligence.recommendedNextAction.action),
    danger: intelligence.recommendedNextAction.priority === 'high',
  });

  if (
    intelligence.communicationReadiness.level !== 'ready' &&
    items.length < 3
  ) {
    addFocusItem(items, {
      title: 'Improve communication context',
      detail: intelligence.communicationReadiness.message,
      icon: 'document-text-outline',
    });
  }

  if (items.length === 0) {
    addFocusItem(items, {
      title: 'Continue monitoring project status',
      detail: 'PIE does not see urgent local project risks right now.',
      icon: 'checkmark-circle-outline',
    });
  }

  return items.slice(0, 3);
}

function addFocusItem(items: FocusItem[], item: FocusItem) {
  if (items.some(existing => existing.title === item.title)) return;

  items.push(item);
}

function whatsChangedItems(intelligence: ProjectIntelligenceSummary) {
  return [
    {
      label: 'Photos Captured',
      value:
        intelligence.photoCount > 0
          ? intelligence.photoCount.toString()
          : 'No photos yet',
      placeholder: intelligence.photoCount === 0,
    },
    {
      label: 'Saved Updates',
      value:
        intelligence.updateCount > 0
          ? intelligence.updateCount.toString()
          : 'No updates yet',
      placeholder: intelligence.updateCount === 0,
    },
    {
      label: 'Progress Status',
      value: progressStatusLabel(intelligence),
      placeholder: intelligence.progressStatus === 'not-calculated',
    },
    {
      label: 'Open Issues',
      value:
        intelligence.metrics.openIssueCount > 0
          ? intelligence.metrics.openIssueCount.toString()
          : 'None open',
      placeholder: intelligence.metrics.openIssueCount === 0,
    },
    {
      label: 'Latest Update',
      value: formatPieLastUpdate(intelligence.lastUpdate),
      placeholder: !intelligence.lastUpdate,
    },
  ];
}

function progressStatusLabel(intelligence: ProjectIntelligenceSummary) {
  const progress = intelligence.metrics.averageScheduleProgress;

  if (progress === null) return 'Schedule Required';
  if (intelligence.progressStatus === 'blocked') return 'Blocked';
  if (intelligence.progressStatus === 'complete') return 'Complete';
  if (intelligence.progressStatus === 'near-complete') {
    return `${progress}% | Near Complete`;
  }
  if (intelligence.progressStatus === 'not-started') {
    return `${progress}% | Not Started`;
  }

  return `${progress}% | In Progress`;
}

function recommendedNextActionFromPIE(action: ProjectNextAction) {
  return {
    title: action.label,
    detail: action.description,
    icon: iconForNextAction(action.action),
  };
}

function iconForRisk(risk: ProjectRiskSignal): IconName {
  if (risk.id === 'open-safety') return 'shield-checkmark-outline';
  if (risk.source === 'schedule') return 'calendar-outline';
  if (
    risk.source === 'photo' ||
    risk.source === 'photo-action' ||
    risk.source === 'photo-caption' ||
    risk.source === 'photo-category'
  ) {
    return 'alert-circle-outline';
  }
  if (risk.source === 'document-metadata') return 'document-text-outline';
  if (risk.source === 'project-area') return 'location-outline';
  if (risk.source === 'sync-cloud') return 'cloud-upload-outline';
  if (risk.source === 'project-event') return 'git-branch-outline';

  return 'camera-outline';
}

function iconForNextAction(action: ProjectNextAction['action']): IconName {
  if (action === 'review-safety') return 'shield-checkmark-outline';
  if (
    action === 'review-overdue-schedule' ||
    action === 'review-upcoming-schedule' ||
    action === 'add-schedule'
  ) {
    return 'calendar-outline';
  }
  if (action === 'review-open-issues') return 'alert-circle-outline';
  if (
    action === 'review-photo-actions' ||
    action === 'assign-action-owner'
  ) {
    return 'alert-circle-outline';
  }
  if (action === 'review-project-areas') return 'location-outline';
  if (action === 'review-documents') return 'document-text-outline';
  if (action === 'sync-project') return 'cloud-upload-outline';
  if (action === 'review-decisions') return 'git-branch-outline';
  if (action === 'capture-update') return 'camera-outline';
  if (action === 'generate-report') return 'document-text-outline';

  return 'checkmark-circle-outline';
}

function communicationReadinessSummary(
  communication: ProjectCommunicationReadiness,
) {
  const label =
    communication.level === 'ready'
      ? 'Ready'
      : communication.level === 'needs-context'
        ? 'Needs Context'
        : 'Not Ready';

  return `Communication: ${label} (${communication.score}%).`;
}

function formatPieLastUpdate(value: string | null) {
  if (!value) return 'No saved update yet';

  return formatDisplayDate(value);
}

const styles = StyleSheet.create({
  healthCard: {
    gap: spacing.md,
  },

  healthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    alignItems: 'center',
  },

  label: {
    ...typography.label,
  },

  healthValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },

  healthDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },

  healthValue: {
    ...typography.display,
    fontSize: 30,
    lineHeight: 36,
  },

  progressBadge: {
    minWidth: 110,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },

  progressValue: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '900',
  },

  progressTextValue: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    textAlign: 'center',
  },

  progressLabel: {
    ...typography.caption,
    color: colors.text,
    textAlign: 'center',
  },

  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  summaryMetric: {
    width: '48%',
    minWidth: 148,
    flexGrow: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
  },

  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  metricIconDanger: {
    backgroundColor: colors.dangerSoft,
  },

  metricText: {
    flex: 1,
    gap: spacing.xxs,
  },

  metricValue: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },

  metricValueDanger: {
    color: colors.danger,
  },

  confidencePanel: {
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    gap: spacing.sm,
  },

  confidenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },

  confidenceTextGroup: {
    flex: 1,
    gap: spacing.xxs,
  },

  confidenceTitle: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },

  confidenceScoreBadge: {
    minWidth: 68,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },

  confidenceScore: {
    color: colors.primary,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
  },

  confidenceTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },

  confidenceFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },

  confidenceDetail: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },

  confidenceSignalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  confidenceSignal: {
    width: '48%',
    minWidth: 138,
    flexGrow: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    flexDirection: 'row',
    gap: spacing.xs,
  },

  confidenceSignalMet: {
    borderColor: '#B8E6C5',
    backgroundColor: colors.successSoft,
  },

  confidenceSignalText: {
    flex: 1,
    gap: 2,
  },

  confidenceSignalLabel: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  confidenceSignalLabelMet: {
    color: colors.text,
  },

  confidenceSignalDetail: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },

  changeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  changeMetric: {
    width: '48%',
    minWidth: 128,
    flexGrow: 1,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    gap: spacing.xxs,
  },

  changeValue: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },

  placeholderValue: {
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },

  recommendationCard: {
    backgroundColor: colors.primarySoft,
  },

  recommendationHeader: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  recommendationIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recommendationTextGroup: {
    flex: 1,
    gap: spacing.xs,
  },

  recommendationText: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },

  recommendationDetail: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },

  actionStack: {
    gap: spacing.sm,
  },

  actionButton: {
    minHeight: 56,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  primaryActionButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  actionButtonText: {
    color: colors.primary,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },

  primaryActionButtonText: {
    color: '#FFFFFF',
  },

  sectionCard: {
    gap: spacing.sm,
  },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },

  sectionTitle: {
    ...typography.h2,
  },

  pieBadge: {
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },

  pieBadgeText: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  pieInsightCard: {
    backgroundColor: colors.primarySoft,
    gap: spacing.sm,
  },

  pieInsightHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },

  pieInsightIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pieInsightLabel: {
    ...typography.label,
    color: colors.primary,
  },

  pieInsightTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },

  pieInsightDetail: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },

  photoRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  photoTile: {
    flex: 1,
    minWidth: 0,
  },

  photoImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },

  photoCaption: {
    ...typography.caption,
    marginTop: spacing.xs,
    color: colors.text,
  },

  listRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },

  listRowText: {
    flex: 1,
  },

  listRowTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },

  listRowDetail: {
    ...typography.body,
    marginTop: spacing.xxs,
  },

  emptyText: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 21,
  },
});
