import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import type {
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CriticalPathCard } from '../components/CriticalPathCard';
import { CriticalPathSummary } from '../components/CriticalPathSummary';
import { CriticalTaskRow } from '../components/CriticalTaskRow';
import { Screen } from '../components/layout/Screen';
import { ScreenCard } from '../components/layout/ScreenCard';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import {
  EmptyState,
  SecondaryButton,
  colors,
} from '../components/ProjectDetailsCard';
import { analyzeCriticalPath } from '../services/CriticalPathService';
import type {
  ProjectUpdate,
  ScheduleItem,
} from '../types';

function countLabel(count: number, singular: string) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : `${singular}s`}`;
}

export function CriticalPathScreen({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  currentUpdate,
  onBack,
  onExecutiveKPIDashboard,
  onMilestoneTracking,
  onProjectHealthDashboard,
  onAIProjectCoach,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
  onBack: () => void;
  onExecutiveKPIDashboard?: () => void;
  onMilestoneTracking?: () => void;
  onProjectHealthDashboard?: () => void;
  onAIProjectCoach?: () => void;
}) {
  const analysis = useMemo(
    () =>
      analyzeCriticalPath({
        projects,
        scheduleItems,
        updates: savedUpdates,
        currentUpdate,
      }),
    [currentUpdate, projects, savedUpdates, scheduleItems],
  );

  return (
    <Screen contentStyle={contentStyle}>
        <ScreenHeader
          title="Critical Path Analysis"
          subtitle="A local, rule-based view of tasks most likely to delay project completion."
          onBack={onBack}
        />

        <ScreenCard style={styles.commandPanel}>
          <Text style={styles.commandTitle}>
            Critical Path Navigation
          </Text>

          <Text style={styles.commandSubtitle}>
            Dependencies are inferred from shared project or area and schedule date order. No task data is changed.
          </Text>

          <View style={styles.commandRow}>
            <SecondaryButton
              label="Home"
              icon="home-outline"
              onPress={onBack}
              compact
            />

            {onExecutiveKPIDashboard ? (
              <SecondaryButton
                label="KPI Dashboard"
                icon="stats-chart-outline"
                onPress={onExecutiveKPIDashboard}
                compact
              />
            ) : null}
          </View>

          {onMilestoneTracking || onProjectHealthDashboard ? (
            <View style={styles.commandRow}>
              {onMilestoneTracking ? (
                <SecondaryButton
                  label="Milestones"
                  icon="flag-outline"
                  onPress={onMilestoneTracking}
                  compact
                />
              ) : null}

              {onProjectHealthDashboard ? (
                <SecondaryButton
                  label="Health"
                  icon="pulse-outline"
                  onPress={onProjectHealthDashboard}
                  compact
                />
              ) : null}
            </View>
          ) : null}

          {onAIProjectCoach ? (
            <View style={styles.commandRow}>
              <SecondaryButton
                label="AI Coach"
                icon="bulb-outline"
                onPress={onAIProjectCoach}
                compact
              />
            </View>
          ) : null}
        </ScreenCard>

        <CriticalPathSummary summary={analysis.summary} />

        <CriticalPathCard
          title="Critical Tasks"
          subtitle="Tasks with high or critical delay exposure, including inferred sequence risk."
        >
          {analysis.criticalTasks.length > 0 ? (
            analysis.criticalTasks.map(task => (
              <CriticalTaskRow
                key={task.id}
                task={task}
              />
            ))
          ) : (
            <EmptySection text="No critical tasks are currently detected from the schedule and field data." />
          )}
        </CriticalPathCard>

        <CriticalPathCard
          title="Blocking Issues"
          subtitle="Tasks with overdue work, waiting status, or open action items that can hold up downstream work."
        >
          {analysis.blockingTasks.length > 0 ? (
            analysis.blockingTasks.map(task => (
              <CriticalTaskRow
                key={task.id}
                task={task}
              />
            ))
          ) : (
            <EmptySection text="No schedule blockers are currently detected." />
          )}
        </CriticalPathCard>

        <CriticalPathCard
          title="Delayed Milestones"
          subtitle="Milestone or task dates that are late or currently waiting on a dependency or decision."
        >
          {analysis.delayedMilestones.length > 0 ? (
            analysis.delayedMilestones.map(task => (
              <CriticalTaskRow
                key={task.id}
                task={task}
              />
            ))
          ) : (
            <EmptySection text="No delayed milestones are currently detected." />
          )}
        </CriticalPathCard>

        <CriticalPathCard
          title="Recommended Immediate Actions"
          subtitle="Deterministic next steps prioritized from the current critical-path signals."
        >
          {analysis.recommendedImmediateActions.map((action, index) => (
            <View
              key={`${index}-${action}`}
              style={styles.actionRow}
            >
              <View style={styles.actionNumber}>
                <Text style={styles.actionNumberText}>
                  {index + 1}
                </Text>
              </View>

              <Text style={styles.actionText}>
                {action}
              </Text>
            </View>
          ))}
        </CriticalPathCard>

        <View style={styles.noteRow}>
          <Ionicons
            name="information-circle-outline"
            size={17}
            color={colors.muted}
          />

          <Text style={styles.noteText}>
            {countLabel(analysis.summary.totalTasks, 'schedule task')} analyzed locally. AI is not called for this screen.
          </Text>
        </View>
    </Screen>
  );
}

function EmptySection({
  text,
}: {
  text: string;
}) {
  return (
    <Text style={styles.emptyText}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  commandPanel: {
    marginBottom: 14,
  },

  commandTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    marginBottom: 4,
  },

  commandSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 10,
  },

  commandRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    marginTop: 10,
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 11,
    marginTop: 11,
  },

  actionNumber: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionNumberText: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
  },

  actionText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },

  emptyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    paddingTop: 10,
  },

  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingHorizontal: 2,
    paddingBottom: 10,
  },

  noteText: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
});
