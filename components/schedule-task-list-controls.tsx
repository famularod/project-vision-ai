import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

export type ScheduleTaskFilter =
  | 'Attention'
  | 'My Work'
  | 'Today'
  | '7 Days'
  | 'Overdue'
  | 'All';
export type ScheduleTaskView = 'Open Tasks' | 'Completed Tasks';
export type ScheduleWorkspaceView = 'Tasks' | 'Timeline' | 'Lookahead';

export function ScheduleTaskListControls({
  scopeLabel,
  taskCount,
  dueSoonCount,
  overdueCount,
  needsActionCount,
  myWorkCount,
  openTaskCount,
  completedTaskCount,
  activeView,
  activeFilter,
  onViewChange,
  onFilterChange,
  onNeedsAttentionPress,
  onMyWorkPress,
  onAddTask,
  workspaceView = 'Tasks',
  onWorkspaceViewChange,
}: {
  scopeLabel?: string;
  taskCount: number;
  dueSoonCount: number;
  overdueCount: number;
  needsActionCount: number;
  myWorkCount: number;
  openTaskCount: number;
  completedTaskCount: number;
  activeView: ScheduleTaskView;
  activeFilter: ScheduleTaskFilter;
  onViewChange: (view: ScheduleTaskView) => void;
  onFilterChange: (filter: ScheduleTaskFilter) => void;
  onNeedsAttentionPress: () => void;
  onMyWorkPress: () => void;
  onAddTask: () => void;
  workspaceView?: ScheduleWorkspaceView;
  onWorkspaceViewChange?: (view: ScheduleWorkspaceView) => void;
}) {
  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.title}>Tasks &amp; Schedule</Text>
        <Text style={styles.subtitle}>
          Update project work or review the current timeline and lookahead.
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

      <View style={styles.workspaceTabs} accessibilityRole="tablist">
        {(['Tasks', 'Timeline', 'Lookahead'] as const).map(view => (
          <Pressable
            key={view}
            style={({ pressed }) => [
              styles.workspaceTab,
              workspaceView === view && styles.workspaceTabActive,
              pressed && styles.pressed,
            ]}
            onPress={() => onWorkspaceViewChange?.(view)}
            accessibilityRole="tab"
            accessibilityState={{ selected: workspaceView === view }}
            accessibilityLabel={`${view} schedule view`}
          >
            <Ionicons
              name={view === 'Tasks'
                ? 'list-outline'
                : view === 'Timeline'
                  ? 'calendar-outline'
                  : 'today-outline'}
              size={18}
              color={workspaceView === view ? colors.surface : colors.primary}
            />
            <Text style={[
              styles.workspaceTabText,
              workspaceView === view && styles.workspaceTabTextActive,
            ]}>
              {view}
            </Text>
          </Pressable>
        ))}
      </View>

      {workspaceView === 'Tasks' ? (
        <>
          <View style={styles.metricGrid}>
            <TaskMetric
              label="Tasks"
              value={taskCount}
              icon="calendar-outline"
              selected={activeView === 'Open Tasks' && activeFilter === 'All'}
              actionLabel="Show all open tasks"
              onPress={() => {
                onViewChange('Open Tasks');
                onFilterChange('All');
              }}
            />
            <TaskMetric
              label="Due 7 Days"
              value={dueSoonCount}
              icon="time-outline"
              selected={activeView === 'Open Tasks' && activeFilter === '7 Days'}
              actionLabel="Show tasks due within 7 days"
              onPress={() => {
                onViewChange('Open Tasks');
                onFilterChange('7 Days');
              }}
            />
            <TaskMetric
              label="Overdue"
              value={overdueCount}
              icon="alert-circle-outline"
              danger={overdueCount > 0}
              selected={activeView === 'Open Tasks' && activeFilter === 'Overdue'}
              actionLabel="Show overdue tasks"
              onPress={() => {
                onViewChange('Open Tasks');
                onFilterChange('Overdue');
              }}
            />
            <TaskMetric
              label="Needs Attention"
              value={needsActionCount}
              icon="checkbox-outline"
              selected={activeView === 'Open Tasks' && activeFilter === 'Attention'}
              actionLabel="Show tasks that need attention"
              onPress={onNeedsAttentionPress}
            />
            <TaskMetric
              label="My Work"
              value={myWorkCount}
              icon="person-outline"
              selected={activeView === 'Open Tasks' && activeFilter === 'My Work'}
              actionLabel="Show open tasks assigned to me"
              onPress={onMyWorkPress}
            />
          </View>

          <View style={styles.viewTabs} accessibilityRole="tablist">
            {(['Open Tasks', 'Completed Tasks'] as const).map(view => {
              const count = view === 'Open Tasks' ? openTaskCount : completedTaskCount;
              return (
                <Pressable
                  key={view}
                  style={({ pressed }) => [
                    styles.viewTab,
                    activeView === view && styles.viewTabActive,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => onViewChange(view)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: activeView === view }}
                  accessibilityLabel={`${view}, ${count} ${count === 1 ? 'task' : 'tasks'}`}
                >
                  <Text style={[
                    styles.viewTabText,
                    activeView === view && styles.viewTabTextActive,
                  ]}>
                    {view}
                  </Text>
                  <Text style={[
                    styles.viewTabCount,
                    activeView === view && styles.viewTabTextActive,
                  ]}>{count}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

    </View>
  );
}

function TaskMetric({
  label,
  value,
  icon,
  danger = false,
  selected = false,
  actionLabel,
  onPress,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  selected?: boolean;
  actionLabel?: string;
  onPress?: () => void;
}) {
  const color = danger ? colors.danger : colors.primary;
  const content = (
    <>
      <Ionicons name={icon} size={19} color={color} />
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.metric,
          danger && styles.metricDanger,
          selected && styles.metricSelected,
          pressed && styles.pressed,
        ]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${label}: ${value}. ${actionLabel || `Show ${label.toLowerCase()}`}`}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={[styles.metric, danger && styles.metricDanger]}
      accessibilityLabel={`${label}: ${value}`}
    >
      {content}
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
  workspaceTabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  workspaceTab: {
    minHeight: 46,
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
  },
  workspaceTabActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  workspaceTabText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceTabTextActive: {
    color: colors.surface,
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
  metricSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
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
  viewTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: 14,
  },
  viewTab: {
    flex: 1,
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  viewTabActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  viewTabText: {
    flexShrink: 1,
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  viewTabTextActive: {
    color: colors.primary,
  },
  viewTabCount: {
    color: colors.mutedText,
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.72,
  },
});
