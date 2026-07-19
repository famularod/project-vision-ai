import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

export type ScheduleTaskFilter = 'Attention' | 'Today' | '7 Days' | 'All';

export function ScheduleTaskListControls({
  scopeLabel,
  taskCount,
  dueSoonCount,
  overdueCount,
  needsActionCount,
  activeFilter,
  onFilterChange,
  onAddTask,
}: {
  scopeLabel?: string;
  taskCount: number;
  dueSoonCount: number;
  overdueCount: number;
  needsActionCount: number;
  activeFilter: ScheduleTaskFilter;
  onFilterChange: (filter: ScheduleTaskFilter) => void;
  onAddTask: () => void;
}) {
  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.title}>Tasks</Text>
        <Text style={styles.subtitle}>
          Manage project work, deadlines, ownership, and field follow-up.
        </Text>
        {scopeLabel ? (
          <Text style={styles.scope} accessibilityLabel={`Current project view: ${scopeLabel}`}>
            Project view: {scopeLabel}
          </Text>
        ) : null}
      </View>

      <Pressable
        style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        onPress={onAddTask}
        accessibilityRole="button"
        accessibilityLabel="Add Task"
      >
        <Ionicons name="add-circle-outline" size={22} color={colors.surface} />
        <Text style={styles.addButtonText}>Add Task</Text>
      </Pressable>

      <View style={styles.metricGrid}>
        <TaskMetric label="Tasks" value={taskCount} icon="calendar-outline" />
        <TaskMetric label="Due 7 Days" value={dueSoonCount} icon="time-outline" />
        <TaskMetric
          label="Overdue"
          value={overdueCount}
          icon="alert-circle-outline"
          danger={overdueCount > 0}
        />
        <TaskMetric label="Needs Action" value={needsActionCount} icon="checkbox-outline" />
      </View>

      <View style={styles.filterPanel}>
        <Text style={styles.filterTitle}>Work requiring attention</Text>
        <Text style={styles.filterSubtitle}>
          Verification, blockers, overdue work, and owner follow-ups appear first.
        </Text>
        <View style={styles.filterRow}>
          {(['Attention', 'Today', '7 Days', 'All'] as const).map(filter => (
            <Pressable
              key={filter}
              style={({ pressed }) => [
                styles.filterButton,
                activeFilter === filter && styles.filterButtonActive,
                pressed && styles.pressed,
              ]}
              onPress={() => onFilterChange(filter)}
              accessibilityRole="button"
              accessibilityState={{ selected: activeFilter === filter }}
              accessibilityLabel={`Show ${filter.toLowerCase()} tasks`}
            >
              <Text style={[
                styles.filterButtonText,
                activeFilter === filter && styles.filterButtonTextActive,
              ]}>
                {filter}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function TaskMetric({
  label,
  value,
  icon,
  danger = false,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
}) {
  const color = danger ? colors.danger : colors.primary;

  return (
    <View
      style={[styles.metric, danger && styles.metricDanger]}
      accessibilityLabel={`${label}: ${value}`}
    >
      <Ionicons name={icon} size={19} color={color} />
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.mutedText,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
    paddingTop: 7,
  },
  scope: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    paddingTop: spacing.sm,
  },
  addButton: {
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: 10,
  },
  addButtonText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '900',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: 14,
  },
  metric: {
    width: '47%',
    minHeight: 86,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  metricDanger: {
    borderColor: '#FFC9C5',
    backgroundColor: colors.dangerSoft,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: '800',
  },
  filterPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    gap: spacing.xs,
    padding: spacing.md,
    marginBottom: 14,
  },
  filterTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  filterSubtitle: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 18,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  filterButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  filterButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  filterButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  filterButtonTextActive: {
    color: colors.surface,
  },
  pressed: {
    opacity: 0.72,
  },
});
