import type { ReactElement, ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import type { ScheduleItem } from '../types';

export function ScheduleWideWorkspace({
  items,
  selectedTaskId,
  onSelectTask,
  masterHeader,
  inspector,
  inspectorFooter,
  emptyState,
}: {
  items: ScheduleItem[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  masterHeader: ReactElement;
  inspector: ReactNode;
  inspectorFooter: ReactNode;
  emptyState: ReactElement;
}) {
  return (
    <View style={styles.workspace} testID="schedule-wide-workspace">
      <View style={styles.masterColumn}>
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <ScheduleTaskMasterRow
              item={item}
              selected={item.id === selectedTaskId}
              onPress={() => onSelectTask(item.id)}
            />
          )}
          ListHeaderComponent={masterHeader}
          ListEmptyComponent={emptyState}
          contentContainerStyle={styles.masterContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </View>

      <ScrollView
        style={styles.inspectorColumn}
        contentContainerStyle={styles.inspectorContent}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.inspectorEyebrow}>TASK INSPECTOR</Text>
        {inspector}
        {inspectorFooter}
      </ScrollView>
    </View>
  );
}

function ScheduleTaskMasterRow({
  item,
  selected,
  onPress,
}: {
  item: ScheduleItem;
  selected: boolean;
  onPress: () => void;
}) {
  const projectName = item.scheduleProjectName?.trim() || item.projectName.trim() || 'No project';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.taskRow,
        selected && styles.taskRowSelected,
        pressed && styles.taskRowPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open task ${item.taskName}`}
      accessibilityState={{ selected }}
    >
      <View style={styles.taskTitleRow}>
        <Text style={styles.taskTitle} numberOfLines={2}>{item.taskName}</Text>
        <Text style={styles.taskPercent}>{item.percentComplete}%</Text>
      </View>
      <Text style={styles.taskContext} numberOfLines={1}>
        {projectName}{item.locationName ? ` • ${item.locationName}` : ''}
      </Text>
      <Text style={styles.taskContext} numberOfLines={1}>
        {item.status} • {item.priority}{item.finishDate ? ` • ${item.finishDate}` : ''}
      </Text>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.max(0, Math.min(100, item.percentComplete))}%` },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  workspace: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    backgroundColor: colors.background,
  },
  masterColumn: {
    width: 390,
    maxWidth: '40%',
    minWidth: 330,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.surface,
  },
  masterContent: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  separator: {
    height: spacing.sm,
  },
  taskRow: {
    minHeight: 116,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: spacing.xs,
    padding: spacing.md,
  },
  taskRowSelected: {
    borderColor: colors.primary,
    borderLeftWidth: 5,
    backgroundColor: colors.primarySoft,
  },
  taskRowPressed: {
    opacity: 0.72,
  },
  taskTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  taskTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  taskPercent: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  taskContext: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  inspectorColumn: {
    flex: 1,
    minWidth: 0,
  },
  inspectorContent: {
    width: '100%',
    maxWidth: 920,
    alignSelf: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  inspectorEyebrow: {
    color: colors.tertiaryText,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
});
