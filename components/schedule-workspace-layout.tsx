import type { ReactElement, ReactNode } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import type { ScheduleItem } from '../types';
import {
  groupScheduleWorkspaceItemsByProjectAndArea,
  type ScheduleWorkspaceProjectAreaGroup,
} from '../services/DAVEScheduleWorkspace';

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
  const sections = groupScheduleWorkspaceItemsByProjectAndArea(items);

  return (
    <View style={styles.workspace} testID="schedule-wide-workspace">
      <View style={styles.masterColumn}>
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <ScheduleTaskMasterRow
              item={item}
              selected={item.id === selectedTaskId}
              onPress={() => onSelectTask(item.id)}
            />
          )}
          renderSectionHeader={({ section }) => (
            <ScheduleTaskGroupHeader section={section} backgroundColor={colors.surface} />
          )}
          ListHeaderComponent={masterHeader}
          ListEmptyComponent={emptyState}
          contentContainerStyle={styles.masterContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      </View>

      <ScrollView
        style={styles.inspectorColumn}
        contentContainerStyle={styles.inspectorContent}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={styles.inspectorEyebrow}>TASK INSPECTOR</Text>
        {inspector}
        {inspectorFooter}
      </ScrollView>
    </View>
  );
}

export function ScheduleTaskGroupHeader({
  section,
  backgroundColor = colors.background,
}: {
  section: ScheduleWorkspaceProjectAreaGroup;
  backgroundColor?: string;
}) {
  return (
    <View style={[styles.groupHeader, { backgroundColor }]}>
      {section.isFirstAreaInProject ? (
        <View style={styles.projectGroupHeader}>
          <Text accessibilityRole="header" style={styles.projectGroupTitle}>
            {section.projectName}
          </Text>
          <Text style={styles.projectGroupCount}>
            {section.projectTaskCount} {section.projectTaskCount === 1 ? 'task' : 'tasks'}
          </Text>
        </View>
      ) : null}
      <View style={styles.areaGroupHeader}>
        <Text accessibilityRole="header" style={styles.areaGroupTitle}>{section.areaName}</Text>
        <Text style={styles.areaGroupCount}>
          {section.data.length} {section.data.length === 1 ? 'task' : 'tasks'}
        </Text>
      </View>
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
    minHeight: 132,
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
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '900',
  },
  taskPercent: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  taskContext: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 18,
  },
  projectGroupHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  projectGroupTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  projectGroupCount: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  groupHeader: {
    paddingTop: spacing.sm,
  },
  areaGroupHeader: {
    minHeight: 46,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  areaGroupTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  areaGroupCount: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
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
