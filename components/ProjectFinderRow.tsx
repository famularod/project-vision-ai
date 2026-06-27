import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import type { ProjectStats } from '../types';
import { formatDisplayDate } from '../utils/date';
import type { ScheduleSummary } from '../utils/schedule';
import { colors, styles } from './ProjectDetailsCard';

function scheduleStatusLabel(summary: ScheduleSummary | undefined) {
  if (!summary || summary.totalItems === 0) return null;
  if (summary.overdueCount > 0) return 'Schedule risk';
  if (summary.upcoming7Count > 0) return 'Due this week';
  if (summary.upcoming30Count > 0) return 'Upcoming';
  if (summary.completedCount === summary.totalItems) return 'Complete';

  return 'Tracked';
}

export function ProjectFinderRow({
  project,
  stats,
  scheduleSummary,
  archived,
  favorite,
  onPress,
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
  onFavorite: () => void;
  onRename: () => void;
  onClose?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  const scheduleStatus = scheduleStatusLabel(scheduleSummary);
  const nextScheduleTask = scheduleSummary?.upcomingTasks[0];

  return (
    <View style={styles.projectFinderRow}>
      <TouchableOpacity
        style={styles.favoriteButton}
        onPress={onFavorite}
      >
        <Ionicons
          name={favorite ? 'star' : 'star-outline'}
          size={22}
          color={favorite ? colors.warning : colors.muted}
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.rowMain}
        onPress={onPress}
      >
        <Text style={styles.projectName}>
          {project}
        </Text>

        <Text style={styles.rowSub}>
          {archived ? 'Archived' : 'Active'} | Last update:{' '}
          {stats.lastUpdate ? formatDisplayDate(stats.lastUpdate) : 'None yet'}
        </Text>

        <View style={styles.compactStatsRow}>
          <Text style={styles.compactStatText}>
            Open {stats.openActions}
          </Text>

          <Text
            style={[
              styles.compactStatText,
              stats.overdueActions > 0 && styles.compactStatDanger,
            ]}
          >
            Overdue {stats.overdueActions}
          </Text>

          <Text style={styles.compactStatText}>
            Due {stats.dueThisWeek}
          </Text>

          <Text style={styles.compactStatText}>
            Photos {stats.photos}
          </Text>

          {scheduleSummary && scheduleSummary.totalItems > 0 ? (
            <>
              <Text
                style={[
                  styles.compactStatText,
                  scheduleSummary.overdueCount > 0 && styles.compactStatDanger,
                ]}
              >
                Schedule {scheduleStatus}
              </Text>

              <Text
                style={[
                  styles.compactStatText,
                  scheduleSummary.overdueCount > 0 && styles.compactStatDanger,
                ]}
              >
                Sched Overdue {scheduleSummary.overdueCount}
              </Text>
            </>
          ) : null}
        </View>

        {scheduleSummary && scheduleSummary.totalItems > 0 ? (
          <Text
            style={styles.rowSub}
            numberOfLines={2}
          >
            {nextScheduleTask
              ? `Next task: ${nextScheduleTask.title} (${nextScheduleTask.dueLabel})`
              : `Schedule: ${scheduleStatus} | ${scheduleSummary.totalItems} tracked task${scheduleSummary.totalItems === 1 ? '' : 's'}`}
          </Text>
        ) : null}
      </TouchableOpacity>

      <View style={styles.projectFinderActions}>
        <TouchableOpacity
          style={styles.smallAction}
          onPress={archived ? onRestore || onPress : onPress}
        >
          <Text style={styles.smallActionText}>
            {archived ? 'Restore' : 'Update'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.smallAction}
          onPress={onRename}
        >
          <Text style={styles.smallActionText}>
            Rename
          </Text>
        </TouchableOpacity>

        {onClose ? (
          <TouchableOpacity
            style={styles.smallAction}
            onPress={onClose}
          >
            <Text style={styles.smallActionText}>
              Archive
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.smallAction, styles.smallActionDanger]}
          onPress={onDelete}
        >
          <Text style={styles.smallActionDangerText}>
            Delete
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
