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
import type {
  ProjectStats,
  ProjectUpdate,
  ScheduleItem,
} from '../types';
import { formatDisplayDate } from '../utils/date';
import {
  buildScheduleSummary,
  type ScheduleSummary,
} from '../utils/schedule';

type IconName = keyof typeof Ionicons.glyphMap;

type Health = {
  label: 'Green' | 'Yellow' | 'Red';
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
  stats,
  savedUpdates,
  scheduleItems,
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
  onBack: () => void;
  onCaptureUpdate: () => void;
  onGenerateReport: () => void;
  onViewTimeline: () => void;
}) {
  const projectUpdates = savedUpdates
    .filter(update => projectMatches(update.projectName, projectName))
    .sort(compareUpdatesNewestFirst);
  const scheduleSummary = buildScheduleSummary(scheduleItems, {
    projectName,
  });
  const projectScheduleItems = scheduleItems.filter(item =>
    projectMatches(item.projectName, projectName),
  );
  const health = projectHealth(stats, scheduleSummary);
  const progress = projectProgress(projectScheduleItems);
  const scheduleStatus = scheduleStatusLabel(scheduleSummary);
  const safety = safetyStatus(projectUpdates);
  const criticalIssues = criticalIssueCount(stats, scheduleSummary);
  const latestUpdate = projectUpdates[0] || null;
  const upcomingMilestones = scheduleSummary.milestoneTasks
    .filter(
      task =>
        !task.isCompleted &&
        task.daysUntilDue !== null &&
        task.daysUntilDue >= 0,
    )
    .slice(0, 3);
  const nextMilestone = upcomingMilestones[0] || null;
  const latestActivityAt = latestProjectActivity(
    projectUpdates,
    projectScheduleItems,
  );
  const projectPhotos = projectUpdates
    .flatMap(update =>
      update.photos.map(photo => ({
        ...photo,
        updateDate: update.date,
      })),
    );
  const issuePhotos = projectPhotos.filter(
    photo =>
      photo.category === 'Open Issue' ||
      photo.category === 'Safety Concern' ||
      Boolean(photo.actionRequired.trim()),
  );
  const recentPhotos = projectPhotos.slice(0, 3);
  const recentUpdates = projectUpdates.slice(0, 3);
  const confidence = projectConfidence({
    scheduleSummary,
    projectUpdates,
    projectPhotos,
    issuePhotos,
    latestActivityAt,
  });
  const todaysFocus = todayFocusItems({
    stats,
    scheduleSummary,
    latestUpdate,
    safetyLabel: safety.label,
    nextMilestone: nextMilestone
      ? `${nextMilestone.title} | ${nextMilestone.dueLabel}`
      : '',
  });
  const changedItems = whatsChangedItems({
    latestUpdate,
    scheduleSummary,
  });
  const recommendation = recommendedNextAction({
    stats,
    scheduleSummary,
    safetyLabel: safety.label,
    nextMilestone: nextMilestone?.title || '',
    latestUpdate,
  });

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
        <Text style={styles.sectionTitle}>
          Project Summary
        </Text>

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
            value={stats.openActions.toString()}
            icon="alert-circle-outline"
            danger={stats.openActions > 0}
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
            value={formatOverviewActivity(latestActivityAt)}
            icon="time-outline"
          />
        </View>

        <ProjectConfidencePanel confidence={confidence} />
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

function projectHealth(
  stats: ProjectStats,
  scheduleSummary: ScheduleSummary,
): Health {
  if (
    stats.overdueActions > 0 ||
    scheduleSummary.overdueCount > 0 ||
    scheduleSummary.criticalPathItems.length > 2
  ) {
    return {
      label: 'Red',
      color: colors.danger,
      backgroundColor: colors.dangerSoft,
    };
  }

  if (
    stats.openActions > 0 ||
    stats.dueThisWeek > 0 ||
    scheduleSummary.upcoming7Count > 0 ||
    scheduleSummary.criticalPathItems.length > 0
  ) {
    return {
      label: 'Yellow',
      color: colors.warning,
      backgroundColor: colors.warningSoft,
    };
  }

  return {
    label: 'Green',
    color: colors.success,
    backgroundColor: colors.successSoft,
  };
}

function projectProgress(scheduleItems: ScheduleItem[]) {
  if (scheduleItems.length === 0) return null;

  const totalPercent = scheduleItems.reduce(
    (sum, item) => sum + item.percentComplete,
    0,
  );

  return Math.round(totalPercent / scheduleItems.length);
}

function scheduleStatusLabel(summary: ScheduleSummary) {
  if (summary.totalItems === 0) return 'No schedule';
  if (summary.overdueCount > 0) return 'At Risk';
  if (summary.criticalPathItems.length > 0) return 'Watch';
  if (summary.upcoming7Count > 0) return 'Due This Week';
  if (summary.completedCount === summary.totalItems) return 'Complete';

  return 'On Track';
}

function criticalIssueCount(
  stats: ProjectStats,
  scheduleSummary: ScheduleSummary,
) {
  return (
    stats.overdueActions +
    scheduleSummary.overdueCount +
    scheduleSummary.criticalPathItems.length
  );
}

function safetyStatus(projectUpdates: ProjectUpdate[]) {
  const safetyPhotos = projectUpdates.flatMap(update =>
    update.photos.filter(photo => photo.category === 'Safety Concern'),
  );
  const openSafety = safetyPhotos.filter(
    photo => photo.actionStatus !== 'Closed',
  );
  const overdueSafety = openSafety.filter(photo => {
    if (!photo.actionDueDate.trim()) return false;

    const dueDate = new Date(photo.actionDueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return !Number.isNaN(dueDate.getTime()) && dueDate < today;
  });

  if (overdueSafety.length > 0) {
    return {
      label: `${overdueSafety.length} Critical`,
      danger: true,
    };
  }

  if (openSafety.length > 0) {
    return {
      label: `${openSafety.length} Open`,
      danger: false,
    };
  }

  return {
    label: 'Clear',
    danger: false,
  };
}

function projectConfidence({
  scheduleSummary,
  projectUpdates,
  projectPhotos,
  issuePhotos,
  latestActivityAt,
}: {
  scheduleSummary: ScheduleSummary;
  projectUpdates: ProjectUpdate[];
  projectPhotos: ProjectUpdate['photos'];
  issuePhotos: ProjectUpdate['photos'];
  latestActivityAt: Date | null;
}): ProjectConfidence {
  const hasSchedule = scheduleSummary.totalItems > 0;
  const hasPhotos = projectPhotos.length > 0;
  const hasUpdates = projectUpdates.length > 0;
  const hasRecentActivity = isRecentActivity(latestActivityAt);
  const hasIssues = issuePhotos.length > 0;
  const hasTimelineSignals =
    scheduleSummary.milestoneCount > 0 ||
    scheduleSummary.criticalPathItems.length > 0;
  const signals: ConfidenceSignal[] = [
    {
      label: 'Schedule',
      met: hasSchedule,
      detail: hasSchedule
        ? `${scheduleSummary.totalItems} schedule item${scheduleSummary.totalItems === 1 ? '' : 's'}`
        : 'Schedule Required',
    },
    {
      label: 'Photos',
      met: hasPhotos,
      detail: hasPhotos
        ? `${projectPhotos.length} photo${projectPhotos.length === 1 ? '' : 's'}`
        : 'No project photos yet',
    },
    {
      label: 'Updates',
      met: hasUpdates,
      detail: hasUpdates
        ? `${projectUpdates.length} saved update${projectUpdates.length === 1 ? '' : 's'}`
        : 'No saved updates yet',
    },
    {
      label: 'Recent Activity',
      met: hasRecentActivity,
      detail: latestActivityAt
        ? formatOverviewActivity(latestActivityAt)
        : 'No project activity yet',
    },
    {
      label: 'Issues',
      met: hasIssues,
      detail: hasIssues
        ? `${issuePhotos.length} issue signal${issuePhotos.length === 1 ? '' : 's'}`
        : 'No issue history yet',
    },
    {
      label: 'Timeline',
      met: hasTimelineSignals,
      detail: hasTimelineSignals
        ? `${scheduleSummary.milestoneCount} milestone${scheduleSummary.milestoneCount === 1 ? '' : 's'}`
        : 'No milestone signals yet',
    },
  ];
  const metCount = signals.filter(signal => signal.met).length;
  const score = Math.round((metCount / signals.length) * 100);

  if (score >= 80) {
    return {
      score,
      label: 'Strong Context',
      detail: 'Project data is complete enough for confident status decisions.',
      signals,
    };
  }

  if (score >= 50) {
    return {
      score,
      label: 'Building Context',
      detail: 'Project status is usable, but more schedule, photo, or update data would improve confidence.',
      signals,
    };
  }

  return {
    score,
    label: 'Limited Context',
    detail: 'Add a schedule, photos, or field updates to improve project confidence.',
    signals,
  };
}

function todayFocusItems({
  stats,
  scheduleSummary,
  latestUpdate,
  safetyLabel,
  nextMilestone,
}: {
  stats: ProjectStats;
  scheduleSummary: ScheduleSummary;
  latestUpdate: ProjectUpdate | null;
  safetyLabel: string;
  nextMilestone: string;
}): FocusItem[] {
  const items: FocusItem[] = [];
  const overdueTask = scheduleSummary.overdueTasks[0];
  const latestUpdateDate = latestUpdate
    ? normalizeActivityDate(latestUpdate.date)
    : null;

  if (safetyLabel !== 'Clear') {
    items.push({
      title: 'Review open safety concerns',
      detail: `Safety status: ${safetyLabel}. Assign owners before field work continues.`,
      icon: 'shield-checkmark-outline',
      danger: safetyLabel.includes('Critical'),
    });
  }

  if (overdueTask) {
    items.push({
      title: 'Resolve overdue schedule item',
      detail: `${overdueTask.title} | ${overdueTask.dueLabel}`,
      icon: 'calendar-outline',
      danger: true,
    });
  }

  if (!isRecentActivity(latestUpdateDate)) {
    items.push({
      title: "Capture today's progress",
      detail: latestUpdateDate
        ? `Last saved update was ${formatOverviewActivity(latestUpdateDate)}.`
        : 'No saved update exists for this project yet.',
      icon: 'camera-outline',
    });
  }

  if (stats.openActions > 0) {
    items.push({
      title: 'Review open project issues',
      detail: `${stats.openActions} open issue${stats.openActions === 1 ? '' : 's'} need owner or status review.`,
      icon: 'alert-circle-outline',
      danger: stats.overdueActions > 0,
    });
  }

  if (nextMilestone) {
    items.push({
      title: 'Prepare next milestone',
      detail: nextMilestone,
      icon: 'flag-outline',
    });
  }

  if (scheduleSummary.totalItems === 0) {
    items.push({
      title: 'Add or review the schedule',
      detail: 'Schedule data is required for progress, milestones, and critical path confidence.',
      icon: 'calendar-outline',
    });
  }

  if (items.length === 0) {
    items.push({
      title: 'Generate executive report',
      detail: 'Project data is current enough to prepare a concise status report.',
      icon: 'document-text-outline',
    });
  }

  return items.slice(0, 3);
}

function whatsChangedItems({
  latestUpdate,
  scheduleSummary,
}: {
  latestUpdate: ProjectUpdate | null;
  scheduleSummary: ScheduleSummary;
}) {
  const latestPhotos = latestUpdate?.photos || [];
  const newIssues = latestPhotos.filter(photo => photo.category === 'Open Issue');
  const closedIssues = latestPhotos.filter(
    photo => photo.actionStatus === 'Closed',
  );
  const safetyUpdates = latestPhotos.filter(
    photo => photo.category === 'Safety Concern',
  );
  const hasLatestUpdate = Boolean(latestUpdate);
  const hasSchedule = scheduleSummary.totalItems > 0;

  return [
    {
      label: 'New Photos',
      value: hasLatestUpdate
        ? latestPhotos.length.toString()
        : 'No recent update',
      placeholder: !hasLatestUpdate,
    },
    {
      label: 'Completed Tasks',
      value: hasSchedule
        ? scheduleSummary.completedCount.toString()
        : 'Schedule Required',
      placeholder: !hasSchedule,
    },
    {
      label: 'New Issues',
      value: hasLatestUpdate
        ? newIssues.length.toString()
        : 'No update history',
      placeholder: !hasLatestUpdate,
    },
    {
      label: 'Closed Issues',
      value: hasLatestUpdate
        ? closedIssues.length.toString()
        : 'No update history',
      placeholder: !hasLatestUpdate,
    },
    {
      label: 'Safety Updates',
      value: hasLatestUpdate
        ? safetyUpdates.length.toString()
        : 'No safety updates',
      placeholder: !hasLatestUpdate,
    },
    {
      label: 'Latest Update Time',
      value: latestUpdate
        ? formatDisplayDate(latestUpdate.date)
        : 'No saved update yet',
      placeholder: !latestUpdate,
    },
  ];
}

function recommendedNextAction({
  stats,
  scheduleSummary,
  safetyLabel,
  nextMilestone,
  latestUpdate,
}: {
  stats: ProjectStats;
  scheduleSummary: ScheduleSummary;
  safetyLabel: string;
  nextMilestone: string;
  latestUpdate: ProjectUpdate | null;
}) {
  if (safetyLabel !== 'Clear') {
    return {
      title: 'Review open safety issues',
      detail: 'Clear or assign safety concerns before additional field work.',
      icon: 'shield-checkmark-outline' as IconName,
    };
  }

  if (scheduleSummary.overdueCount > 0) {
    return {
      title: 'Review overdue schedule items',
      detail: 'Confirm owners, recovery dates, and blockers for overdue work.',
      icon: 'calendar-outline' as IconName,
    };
  }

  if (stats.openActions > 0) {
    return {
      title: 'Review open project issues',
      detail: 'Confirm owners, due dates, and closeout status for open items.',
      icon: 'alert-circle-outline' as IconName,
    };
  }

  if (
    !isRecentActivity(
      latestUpdate ? normalizeActivityDate(latestUpdate.date) : null,
    )
  ) {
    return {
      title: 'Capture today\'s progress',
      detail: 'Refresh the project record with current field status and photos.',
      icon: 'camera-outline' as IconName,
    };
  }

  if (nextMilestone) {
    return {
      title: 'Prepare next milestone',
      detail: `Review readiness before ${nextMilestone} becomes the next checkpoint.`,
      icon: 'flag-outline' as IconName,
    };
  }

  return {
    title: 'Generate executive report',
    detail: 'Create a current status summary for leadership or customer communication.',
    icon: 'document-text-outline' as IconName,
  };
}

function latestProjectActivity(
  projectUpdates: ProjectUpdate[],
  scheduleItems: ScheduleItem[],
) {
  const updateDates = projectUpdates
    .map(update => normalizeActivityDate(update.date))
    .filter((date): date is Date => Boolean(date));
  const scheduleDates = scheduleItems
    .flatMap(item => [item.importedAt || '', item.createdAt || ''])
    .map(normalizeActivityDate)
    .filter((date): date is Date => Boolean(date));
  const dates = [...updateDates, ...scheduleDates];

  if (dates.length === 0) return null;

  return dates.sort((left, right) => right.getTime() - left.getTime())[0];
}

function normalizeActivityDate(value: string) {
  const trimmed = value.trim();

  if (!trimmed) return null;

  const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoDateOnly) {
    const date = new Date(
      Number(isoDateOnly[1]),
      Number(isoDateOnly[2]) - 1,
      Number(isoDateOnly[3]),
    );

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(trimmed);

  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecentActivity(value: Date | null) {
  if (!value) return false;

  const now = new Date();
  const diffMs = now.getTime() - value.getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  return diffMs >= 0 && diffMs <= sevenDaysMs;
}

function formatOverviewActivity(value: Date | null) {
  if (!value) return 'No project activity yet';

  return value.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

  sectionTitle: {
    ...typography.h2,
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
