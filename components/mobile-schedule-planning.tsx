import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { buildVitruviusGanttModel } from '../services/VitruviusGanttModel';
import {
  buildVitruviusLookahead,
  lookaheadStatusLabel,
  type VitruviusLookaheadStatus,
  type VitruviusLookaheadWeeks,
} from '../services/VitruviusLookahead';
import type { ScheduleItem } from '../types';
import { colors, radius, spacing } from '../theme';
import { useAppShellLayout } from './app-shell-layout';

export function MobileSchedulePlanning({
  items,
  view,
  onOpenTask,
}: {
  items: readonly ScheduleItem[];
  view: 'Timeline' | 'Lookahead';
  onOpenTask: (item: ScheduleItem) => void;
}) {
  if (view === 'Timeline') {
    return <MobileScheduleTimeline items={items} onOpenTask={onOpenTask} />;
  }
  return <MobileScheduleLookahead items={items} onOpenTask={onOpenTask} />;
}

function MobileScheduleTimeline({
  items,
  onOpenTask,
}: {
  items: readonly ScheduleItem[];
  onOpenTask: (item: ScheduleItem) => void;
}) {
  const model = useMemo(
    () => buildVitruviusGanttModel({ items, zoom: 'week' }),
    [items],
  );
  const rows = useMemo(
    () => model.rows.filter(row => !row.summary),
    [model.rows],
  );
  const datedCount = rows.filter(row => row.startDate || row.finishDate).length;

  return (
    <View style={styles.workspace} testID="mobile-schedule-timeline">
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>CURRENT SCHEDULE</Text>
          <Text style={styles.heading}>Timeline</Text>
          <Text style={styles.subtitle}>
            {formatRange(model.rangeStart, model.rangeFinish)}
          </Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countValue}>{datedCount}</Text>
          <Text style={styles.countLabel}>Dated</Text>
        </View>
      </View>

      {rows.length === 0 ? (
        <PlanningEmptyState
          title="No schedule tasks yet"
          text="Add a task or import a schedule to build the timeline."
        />
      ) : (
        rows.map(row => {
          const complete = row.item.status === 'Complete' || row.item.percentComplete >= 100;
          const leftPercent = row.left === null
            ? 0
            : Math.max(0, Math.min(96, (row.left / model.timelineWidth) * 100));
          const widthPercent = row.width === null
            ? 0
            : Math.max(3, Math.min(100 - leftPercent, (row.width / model.timelineWidth) * 100));
          return (
            <Pressable
              key={row.item.id}
              style={({ pressed }) => [
                styles.timelineRow,
                pressed && styles.pressed,
              ]}
              onPress={() => onOpenTask(row.item)}
              accessibilityRole="button"
              accessibilityLabel={`Open timeline task ${row.item.taskName}, ${row.item.percentComplete}% complete`}
              accessibilityHint="Opens the task details and editing controls"
            >
              <View style={styles.rowTitleLine}>
                <View style={styles.rowTitleCopy}>
                  <Text style={styles.taskName}>{row.item.taskName}</Text>
                  <Text style={styles.taskContext}>
                    {row.projectName}
                    {row.item.locationName ? ` · ${row.item.locationName}` : ''}
                  </Text>
                </View>
                <View style={styles.rowActionCluster}>
                  <Text style={[
                    styles.statusText,
                    complete && styles.statusTextComplete,
                  ]}>
                    {row.item.percentComplete}%
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.primary} />
                </View>
              </View>
              <Text style={styles.dateText}>
                {dateSpan(row.startDate, row.finishDate)}
              </Text>
              {row.startDate || row.finishDate ? (
                <View style={styles.timelineTrack}>
                  <View
                    style={[
                      styles.timelineBar,
                      complete && styles.timelineBarComplete,
                      {
                        left: `${leftPercent}%`,
                        width: `${widthPercent}%`,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.timelineProgress,
                        {
                          width: `${Math.max(0, Math.min(100, row.item.percentComplete))}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.needsDateRow}>
                  <Ionicons name="calendar-outline" size={16} color={colors.warning} />
                  <Text style={styles.needsDateText}>Dates needed</Text>
                </View>
              )}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

function MobileScheduleLookahead({
  items,
  onOpenTask,
}: {
  items: readonly ScheduleItem[];
  onOpenTask: (item: ScheduleItem) => void;
}) {
  const { sizeClass } = useAppShellLayout();
  const [weeks, setWeeks] = useState<VitruviusLookaheadWeeks>(3);
  const lookahead = useMemo(
    () => buildVitruviusLookahead({ items, weeks }),
    [items, weeks],
  );

  return (
    <View style={styles.workspace} testID="mobile-schedule-lookahead">
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>FIELD PLAN</Text>
          <Text style={styles.heading}>Construction Lookahead</Text>
          <Text style={styles.subtitle}>
            {formatRange(lookahead.rangeStart, lookahead.rangeFinish)}
          </Text>
        </View>
      </View>

      <View style={styles.weekTabs} accessibilityRole="tablist">
        {([3, 6] as const).map(option => (
          <Pressable
            key={option}
            style={({ pressed }) => [
              styles.weekTab,
              weeks === option && styles.weekTabActive,
              pressed && styles.pressed,
            ]}
            onPress={() => setWeeks(option)}
            accessibilityRole="tab"
            accessibilityState={{ selected: weeks === option }}
            accessibilityLabel={`${option} week lookahead`}
          >
            <Text style={[
              styles.weekTabText,
              weeks === option && styles.weekTabTextActive,
            ]}>
              {option} Weeks
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.summaryGrid}>
        <LookaheadMetric label="In view" value={lookahead.rows.length} />
        <LookaheadMetric label="Overdue" value={lookahead.overdueCount} danger />
        <LookaheadMetric label="Blocked" value={lookahead.blockedCount} warning />
        <LookaheadMetric label="Needs dates" value={lookahead.undatedCount} />
      </View>

      {lookahead.rows.length === 0 ? (
        <PlanningEmptyState
          title="No work in this lookahead"
          text={`No open tasks fall within the next ${weeks} weeks.`}
        />
      ) : (
        <View style={sizeClass === 'compact' ? undefined : styles.lookaheadGrid}>
          {lookahead.rows.map(row => {
            const palette = lookaheadPalette(row.status);
            return (
              <Pressable
                key={row.item.id}
                style={({ pressed }) => [
                  styles.lookaheadCard,
                  sizeClass !== 'compact' && styles.lookaheadCardWide,
                  pressed && styles.pressed,
                ]}
                onPress={() => onOpenTask(row.item)}
                accessibilityRole="button"
                accessibilityLabel={`Open lookahead task ${row.item.taskName}, ${lookaheadStatusLabel(row.status)}`}
                accessibilityHint="Opens the task details and editing controls"
              >
                <View style={styles.rowTitleLine}>
                  <View style={styles.rowTitleCopy}>
                    <Text style={styles.taskName}>{row.item.taskName}</Text>
                    <Text style={styles.taskContext}>
                      {row.projectName} · {row.areaName}
                    </Text>
                  </View>
                  <View style={styles.rowActionCluster}>
                    <View style={[styles.statusBadge, { backgroundColor: palette.soft }]}>
                      <Text style={[styles.statusBadgeText, { color: palette.text }]}>
                        {lookaheadStatusLabel(row.status)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.primary} />
                  </View>
                </View>
                <Text style={styles.dateText}>
                  {dateSpan(row.startDate, row.finishDate)}
                </Text>
                <Text style={styles.assignmentText}>
                  {row.contractor !== 'Unassigned'
                    ? row.contractor
                    : row.owner !== 'Unassigned'
                      ? `Owner: ${row.owner}`
                      : 'Responsibility not assigned'}
                </Text>
                {row.blockingPredecessorNames.length > 0 ? (
                  <Text style={styles.blockedText}>
                    Waiting on {row.blockingPredecessorNames.join(', ')}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function LookaheadMetric({
  label,
  value,
  danger = false,
  warning = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
  warning?: boolean;
}) {
  return (
    <View style={[
      styles.summaryMetric,
      danger && value > 0 && styles.summaryMetricDanger,
      warning && value > 0 && styles.summaryMetricWarning,
    ]}>
      <Text style={[
        styles.summaryValue,
        danger && value > 0 && styles.summaryValueDanger,
        warning && value > 0 && styles.summaryValueWarning,
      ]}>
        {value}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function PlanningEmptyState({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="calendar-outline" size={26} color={colors.primary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function formatRange(start: string, finish: string) {
  return `${displayDate(start)} – ${displayDate(finish)}`;
}

function dateSpan(start: string | null, finish: string | null) {
  if (!start && !finish) return 'No dates';
  if (!start) return `Finish ${displayDate(finish!)}`;
  if (!finish || start === finish) return displayDate(start);
  return `${displayDate(start)} – ${displayDate(finish)}`;
}

function displayDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function lookaheadPalette(status: VitruviusLookaheadStatus) {
  if (status === 'overdue') return { soft: colors.dangerSoft, text: colors.danger };
  if (status === 'blocked') return { soft: colors.warningSoft, text: colors.warning };
  if (status === 'in_progress') return { soft: colors.primarySoft, text: colors.primary };
  if (status === 'ready') return { soft: colors.successSoft, text: colors.success };
  return { soft: colors.surfaceMuted, text: colors.mutedText };
}

const styles = StyleSheet.create({
  workspace: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  headingRow: {
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headingCopy: {
    flex: 1,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  heading: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    paddingTop: 4,
  },
  subtitle: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    paddingTop: 4,
  },
  countBadge: {
    minWidth: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  countValue: {
    color: colors.primary,
    fontSize: 21,
    fontWeight: '900',
  },
  countLabel: {
    color: colors.mutedText,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  timelineRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.xs,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowTitleCopy: {
    flex: 1,
  },
  rowActionCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  taskName: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  taskContext: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    paddingTop: 2,
  },
  statusText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  statusTextComplete: {
    color: colors.success,
  },
  dateText: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  timelineTrack: {
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    marginTop: spacing.xxs,
  },
  timelineBar: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: 6,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    overflow: 'hidden',
  },
  timelineBarComplete: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
  timelineProgress: {
    height: '100%',
    backgroundColor: colors.primary,
    opacity: 0.75,
  },
  needsDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  needsDateText: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '800',
  },
  weekTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  weekTab: {
    minHeight: 44,
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekTabActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  weekTabText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  weekTabTextActive: {
    color: colors.surface,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryMetric: {
    width: '47%',
    minHeight: 68,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
  },
  summaryMetricDanger: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  summaryMetricWarning: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  summaryValue: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '900',
  },
  summaryValueDanger: {
    color: colors.danger,
  },
  summaryValueWarning: {
    color: colors.warning,
  },
  summaryLabel: {
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '800',
    paddingTop: 2,
  },
  lookaheadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  lookaheadCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  lookaheadCardWide: {
    width: '48.5%',
    marginBottom: 0,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '900',
  },
  assignmentText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  blockedText: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  emptyState: {
    minHeight: 180,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.xs,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  emptyText: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
