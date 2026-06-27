import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { ProjectStats } from '../types';
import { formatDisplayDate } from '../utils/date';
import type { ScheduleSummary } from '../utils/schedule';
import { colors, styles } from './ProjectDetailsCard';

function scheduleStatusLabel(summary: ScheduleSummary | undefined) {
  if (!summary || summary.totalItems === 0) return 'Schedule Required';
  if (summary.overdueCount > 0) return 'Schedule risk';
  if (summary.upcoming7Count > 0) return 'Due this week';
  if (summary.upcoming30Count > 0) return 'Upcoming';
  if (summary.completedCount === summary.totalItems) return 'Complete';

  return 'Tracked';
}

function projectHealthLabel(
  stats: ProjectStats,
  summary: ScheduleSummary | undefined,
  archived: boolean,
) {
  if (archived) {
    return {
      label: 'Archived',
      detail: 'Stored',
      tone: 'neutral' as const,
    };
  }

  if (stats.overdueActions > 0 || (summary?.overdueCount ?? 0) > 0) {
    return {
      label: 'Red',
      detail: 'Needs attention',
      tone: 'danger' as const,
    };
  }

  if (
    stats.openActions > 0 ||
    stats.dueThisWeek > 0 ||
    (summary?.upcoming7Count ?? 0) > 0
  ) {
    return {
      label: 'Yellow',
      detail: 'Watch closely',
      tone: 'warning' as const,
    };
  }

  return {
    label: 'Green',
    detail: 'On track',
    tone: 'success' as const,
  };
}

function nextMilestoneLabel(summary: ScheduleSummary | undefined) {
  if (!summary || summary.totalItems === 0) return null;

  const milestone = summary.milestoneTasks.find(
    task =>
      !task.isCompleted &&
      task.daysUntilDue !== null &&
      task.daysUntilDue >= 0,
  );

  if (!milestone) return null;

  return `${milestone.title} (${milestone.dueLabel})`;
}

export function ProjectFinderRow({
  project,
  stats,
  scheduleSummary,
  archived,
  favorite,
  onPress,
  onUpdate,
  onFavorite,
  onRename,
  onClose,
  onRestore,
  onDelete,
}: {
  project: string;
  stats: ProjectStats;
  scheduleSummary?: ScheduleSummary;
  archived: boolean;
  favorite: boolean;
  onPress: () => void;
  onUpdate?: () => void;
  onFavorite: () => void;
  onRename: () => void;
  onClose?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const scheduleStatus = scheduleStatusLabel(scheduleSummary);
  const nextMilestone = nextMilestoneLabel(scheduleSummary);
  const health = projectHealthLabel(stats, scheduleSummary, archived);
  const primaryAction = archived ? onPress : onUpdate || onPress;
  const primaryLabel = archived ? 'Open' : 'Update';

  function runMoreAction(action: () => void) {
    setMoreOpen(false);
    action();
  }

  return (
    <View style={styles.projectFinderRow}>
      <TouchableOpacity
        style={styles.projectFinderMain}
        onPress={onPress}
      >
        <View style={styles.projectFinderHeader}>
          <View style={styles.rowMain}>
            <View style={styles.projectTitleRow}>
              <Text
                style={styles.projectFinderName}
                numberOfLines={2}
              >
                {project}
              </Text>

              {favorite ? (
                <Ionicons
                  name="star"
                  size={17}
                  color={colors.warning}
                />
              ) : null}
            </View>

            <Text style={styles.rowSub}>
              Last update:{' '}
              {stats.lastUpdate
                ? formatDisplayDate(stats.lastUpdate)
                : 'No updates yet'}
            </Text>
          </View>

          <View
            style={[
              styles.projectHealthBadge,
              health.tone === 'danger' && styles.projectHealthBadgeDanger,
              health.tone === 'warning' && styles.projectHealthBadgeWarning,
              health.tone === 'success' && styles.projectHealthBadgeSuccess,
            ]}
          >
            <Text
              style={[
                styles.projectHealthText,
                health.tone === 'danger' && styles.projectHealthTextDanger,
                health.tone === 'warning' && styles.projectHealthTextWarning,
                health.tone === 'success' && styles.projectHealthTextSuccess,
              ]}
            >
              {health.label}
            </Text>
          </View>
        </View>

        <View style={styles.projectSignalGrid}>
          <View style={styles.projectSignalItem}>
            <Text style={styles.projectSignalLabel}>
              Health
            </Text>

            <Text
              style={styles.projectSignalValue}
              numberOfLines={1}
            >
              {health.detail}
            </Text>
          </View>

          <View style={styles.projectSignalItem}>
            <Text style={styles.projectSignalLabel}>
              Open Issues
            </Text>

            <Text
              style={[
                styles.projectSignalValue,
                stats.openActions > 0 && styles.projectSignalDanger,
              ]}
              numberOfLines={1}
            >
              {stats.openActions}
            </Text>
          </View>

          <View style={styles.projectSignalItem}>
            <Text style={styles.projectSignalLabel}>
              Schedule
            </Text>

            <Text
              style={[
                styles.projectSignalValue,
                scheduleSummary?.overdueCount ? styles.projectSignalDanger : null,
              ]}
              numberOfLines={1}
            >
              {scheduleStatus}
            </Text>
          </View>
        </View>

        {nextMilestone ? (
          <Text
            style={styles.projectMilestoneText}
            numberOfLines={2}
          >
            Next milestone: {nextMilestone}
          </Text>
        ) : null}
      </TouchableOpacity>

      <View style={styles.projectFinderActions}>
        <TouchableOpacity
          style={styles.projectPrimaryAction}
          onPress={primaryAction}
        >
          <Text style={styles.projectPrimaryActionText}>
            {primaryLabel}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.projectOverflowButton}
          onPress={() => setMoreOpen(open => !open)}
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${project}`}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={20}
            color={colors.primary}
          />
        </TouchableOpacity>

        {moreOpen ? (
          <View style={styles.projectFinderOverflow}>
            <TouchableOpacity
              style={styles.smallAction}
              onPress={() => runMoreAction(onFavorite)}
            >
              <Text style={styles.smallActionText}>
                {favorite ? 'Unfavorite' : 'Favorite'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.smallAction}
              onPress={() => runMoreAction(onRename)}
            >
              <Text style={styles.smallActionText}>
                Rename
              </Text>
            </TouchableOpacity>

            {onClose ? (
              <TouchableOpacity
                style={styles.smallAction}
                onPress={() => runMoreAction(onClose)}
              >
                <Text style={styles.smallActionText}>
                  Archive
                </Text>
              </TouchableOpacity>
            ) : null}

            {onRestore ? (
              <TouchableOpacity
                style={styles.smallAction}
                onPress={() => runMoreAction(onRestore)}
              >
                <Text style={styles.smallActionText}>
                  Restore
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.smallAction, styles.smallActionDanger]}
              onPress={() => runMoreAction(onDelete)}
            >
              <Text style={styles.smallActionDangerText}>
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}
