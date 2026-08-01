import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing } from '../theme';
import type { ScheduleItem } from '../types';
import {
  groupScheduleWorkspaceItemsByProjectAndArea,
  type ScheduleWorkspaceProjectAreaGroup,
} from '../services/DAVEScheduleWorkspace';
import type { DAVETaskAreaSummary } from '../services/DAVETaskAreaSummary';
import { formatAppDate } from '../utils/date';

export function ScheduleWideWorkspace({
  items,
  selectedTaskId,
  selectedAreaKey,
  onSelectTask,
  onSelectArea,
  masterHeader,
  inspector,
  inspectorFooter,
  emptyState,
}: {
  items: ScheduleItem[];
  selectedTaskId: string | null;
  selectedAreaKey?: string | null;
  onSelectTask: (taskId: string) => void;
  onSelectArea?: (section: ScheduleWorkspaceProjectAreaGroup) => void;
  masterHeader: ReactElement;
  inspector: ReactNode;
  inspectorFooter: ReactNode;
  emptyState: ReactElement;
}) {
  const sections = useMemo(
    () => groupScheduleWorkspaceItemsByProjectAndArea(items),
    [items],
  );
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleSections = useMemo(
    () => sections.map(section => {
      const areaKey = scheduleWorkspaceAreaKey(section);
      const collapsed = collapsedAreas.has(areaKey);
      return {
        ...section,
        areaKey,
        areaTaskCount: section.data.length,
        collapsed,
        data: collapsed ? [] : section.data,
      };
    }),
    [collapsedAreas, sections],
  );

  return (
    <View style={styles.workspace} testID="schedule-wide-workspace">
      <View style={styles.masterColumn}>
        <SectionList
          sections={visibleSections}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <ScheduleTaskMasterRow
              item={item}
              selected={item.id === selectedTaskId}
              onPress={() => onSelectTask(item.id)}
            />
          )}
          renderSectionHeader={({ section }) => (
            <ScheduleTaskGroupHeader
              section={section}
              backgroundColor={colors.surface}
              collapsed={section.collapsed}
              selected={section.areaKey === selectedAreaKey}
              taskCount={section.areaTaskCount}
              onPress={() => {
                setCollapsedAreas(current => {
                  const next = new Set(current);
                  if (next.has(section.areaKey)) next.delete(section.areaKey);
                  else next.add(section.areaKey);
                  return next;
                });
                onSelectArea?.(section);
              }}
            />
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

export function scheduleWorkspaceAreaKey(
  section: Pick<ScheduleWorkspaceProjectAreaGroup, 'projectName' | 'areaName'>,
): string {
  return `${section.projectName.trim().toLowerCase()}::${section.areaName.trim().toLowerCase()}`;
}

export function ScheduleTaskGroupHeader({
  section,
  backgroundColor = colors.background,
  collapsed = false,
  selected = false,
  taskCount,
  onPress,
  summary,
  onOpenTask,
}: {
  section: ScheduleWorkspaceProjectAreaGroup;
  backgroundColor?: string;
  collapsed?: boolean;
  selected?: boolean;
  taskCount?: number;
  onPress?: () => void;
  summary?: DAVETaskAreaSummary | null;
  onOpenTask?: (taskId: string) => void;
}) {
  const areaTaskCount = taskCount ?? section.data.length;
  const areaHeader = (
    <View style={[styles.areaGroupHeader, selected && styles.areaGroupHeaderSelected]}>
      <View style={styles.areaGroupTitleRow}>
        {onPress ? (
          <Ionicons
            name={collapsed ? 'chevron-forward' : 'chevron-down'}
            size={20}
            color={colors.primary}
          />
        ) : null}
        <Text accessibilityRole="header" style={styles.areaGroupTitle}>
          {section.areaName}
        </Text>
      </View>
      <Text style={styles.areaGroupCount}>
        {areaTaskCount} {areaTaskCount === 1 ? 'task' : 'tasks'}
      </Text>
    </View>
  );

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
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${section.areaName}`}
          accessibilityHint={`Also opens the ${section.areaName} area summary.`}
          accessibilityState={{ expanded: !collapsed, selected }}
        >
          {areaHeader}
        </Pressable>
      ) : areaHeader}
      {summary ? (
        <ScheduleTaskAreaSummaryPanel summary={summary} onOpenTask={onOpenTask} />
      ) : null}
    </View>
  );
}

export function ScheduleTaskAreaSummaryPanel({
  summary,
  onOpenTask,
}: {
  summary: DAVETaskAreaSummary;
  onOpenTask?: (taskId: string) => void;
}) {
  const missingDateParts = [
    summary.missingStartCount > 0
      ? `${summary.missingStartCount} ${summary.missingStartCount === 1 ? 'task is' : 'tasks are'} missing a start date`
      : null,
    summary.missingFinishCount > 0
      ? `${summary.missingFinishCount} ${summary.missingFinishCount === 1 ? 'task is' : 'tasks are'} missing a finish / due date`
      : null,
  ].filter(Boolean);

  return (
    <View style={styles.areaSummaryCard} testID="schedule-area-summary">
      <View style={styles.areaSummaryHeadingRow}>
        <View style={styles.areaSummaryHeadingCopy}>
          <Text accessibilityRole="header" style={styles.areaSummaryTitle}>
            {summary.areaName} area summary
          </Text>
          <Text style={styles.areaSummaryProject}>{summary.projectName}</Text>
        </View>
        <View style={[
          styles.areaSummaryRiskBadge,
          summary.overdueCount > 0 ? styles.areaSummaryRiskBadgeDanger : styles.areaSummaryRiskBadgeClear,
        ]}>
          <Text style={[
            styles.areaSummaryRiskText,
            summary.overdueCount > 0 ? styles.areaSummaryRiskTextDanger : styles.areaSummaryRiskTextClear,
          ]}>
            {summary.overdueCount > 0
              ? `${summary.overdueCount} past due`
              : 'Dates on track'}
          </Text>
        </View>
      </View>

      <View style={styles.areaSummaryMetrics}>
        <AreaSummaryMetric label="Tasks" value={summary.taskCount} />
        <AreaSummaryMetric label="Open" value={summary.openCount} />
        <AreaSummaryMetric label="In progress" value={summary.inProgressCount} />
        <AreaSummaryMetric label="Complete" value={summary.completeCount} />
      </View>

      <View style={styles.areaSummaryScheduleCard}>
        <Text style={styles.areaSummarySectionLabel}>AREA SCHEDULE</Text>
        <Text style={styles.areaSummaryScheduleValue}>
          {summary.earliestStartLabel} to {summary.latestFinishLabel}
        </Text>
        {missingDateParts.length > 0 ? (
          <Text style={styles.areaSummaryMissingDates}>{missingDateParts.join('. ')}.</Text>
        ) : null}
      </View>

      {summary.warnings.length > 0 ? (
        <View style={styles.areaSummaryWarnings}>
          <Text style={styles.areaSummarySectionLabel}>DATES NEED ATTENTION</Text>
          {summary.warnings.map(warning => (
            <Pressable
              key={`${warning.taskId}-${warning.message}`}
              style={({ pressed }) => [styles.areaSummaryWarningRow, pressed && styles.taskRowPressed]}
              onPress={onOpenTask ? () => onOpenTask(warning.taskId) : undefined}
              accessibilityRole={onOpenTask ? 'button' : undefined}
              accessibilityLabel={onOpenTask ? `Open ${warning.taskName}: ${warning.message}` : undefined}
            >
              <Ionicons name="warning-outline" size={18} color={colors.danger} />
              <View style={styles.areaSummaryWarningCopy}>
                <Text style={styles.areaSummaryWarningTask}>{warning.taskName}</Text>
                <Text style={styles.areaSummaryWarningMessage}>{warning.message}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.areaSummaryWorkList}>
        <Text style={styles.areaSummarySectionLabel}>WORK IN THIS AREA</Text>
        {summary.workItems.map(workItem => {
          const row = (
            <>
              <View style={styles.areaSummaryWorkHeading}>
                <Text style={styles.areaSummaryWorkTitle}>{workItem.taskName}</Text>
                <Text style={styles.areaSummaryWorkPercent}>{workItem.percentComplete}%</Text>
              </View>
              <Text style={styles.areaSummaryWorkStatus}>{workItem.statusLabel}</Text>
              <Text style={styles.areaSummaryWorkDates}>
                Start {workItem.startDateLabel}  •  Finish / Due {workItem.finishDateLabel}
              </Text>
            </>
          );
          return onOpenTask ? (
            <Pressable
              key={workItem.taskId}
              style={({ pressed }) => [styles.areaSummaryWorkRow, pressed && styles.taskRowPressed]}
              onPress={() => onOpenTask(workItem.taskId)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${workItem.taskName}`}
            >
              {row}
            </Pressable>
          ) : (
            <View key={workItem.taskId} style={styles.areaSummaryWorkRow}>{row}</View>
          );
        })}
      </View>
    </View>
  );
}

function AreaSummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.areaSummaryMetric}>
      <Text style={styles.areaSummaryMetricValue}>{value}</Text>
      <Text style={styles.areaSummaryMetricLabel}>{label}</Text>
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
  const startDateLabel = item.startDate?.trim() ? formatAppDate(item.startDate) : 'Not set';
  const finishDateLabel = item.finishDate?.trim() ? formatAppDate(item.finishDate) : 'Not set';

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
        {item.status} • {item.priority}
      </Text>
      <Text style={styles.taskDates}>
        Start {startDateLabel}  •  Finish / Due {finishDateLabel}
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
    minHeight: 146,
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
  taskDates: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
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
  areaGroupHeaderSelected: {
    borderColor: colors.primary,
    borderWidth: 1,
    borderLeftWidth: 5,
    backgroundColor: colors.primarySoft,
  },
  areaGroupTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  areaSummaryCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  areaSummaryHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  areaSummaryHeadingCopy: { flex: 1, minWidth: 0 },
  areaSummaryTitle: { color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '900' },
  areaSummaryProject: { color: colors.mutedText, fontSize: 13, lineHeight: 18 },
  areaSummaryRiskBadge: { borderRadius: radius.xl, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  areaSummaryRiskBadgeDanger: { backgroundColor: colors.dangerSoft },
  areaSummaryRiskBadgeClear: { backgroundColor: colors.successSoft },
  areaSummaryRiskText: { fontSize: 12, lineHeight: 16, fontWeight: '900' },
  areaSummaryRiskTextDanger: { color: colors.danger },
  areaSummaryRiskTextClear: { color: colors.success },
  areaSummaryMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  areaSummaryMetric: { minWidth: 94, flexGrow: 1, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, padding: spacing.sm },
  areaSummaryMetricValue: { color: colors.text, fontSize: 20, lineHeight: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  areaSummaryMetricLabel: { color: colors.mutedText, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  areaSummaryScheduleCard: { borderLeftWidth: 4, borderLeftColor: colors.primary, backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: spacing.sm },
  areaSummarySectionLabel: { color: colors.tertiaryText, fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 0.9 },
  areaSummaryScheduleValue: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '900' },
  areaSummaryMissingDates: { color: colors.warning, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: spacing.xs },
  areaSummaryWarnings: { gap: spacing.xs },
  areaSummaryWarningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.dangerSoft, padding: spacing.sm },
  areaSummaryWarningCopy: { flex: 1, minWidth: 0 },
  areaSummaryWarningTask: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '900' },
  areaSummaryWarningMessage: { color: colors.danger, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  areaSummaryWorkList: { gap: spacing.xs },
  areaSummaryWorkRow: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, gap: 2, padding: spacing.sm },
  areaSummaryWorkHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  areaSummaryWorkTitle: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '900' },
  areaSummaryWorkPercent: { color: colors.primary, fontSize: 14, lineHeight: 19, fontWeight: '900', fontVariant: ['tabular-nums'] },
  areaSummaryWorkStatus: { color: colors.mutedText, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  areaSummaryWorkDates: { color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: '700' },
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
