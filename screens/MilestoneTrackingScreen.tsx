import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import type {
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MilestoneCard } from '../components/MilestoneCard';
import { MilestoneFilterBar } from '../components/MilestoneFilterBar';
import { MilestoneSummaryCard } from '../components/MilestoneSummaryCard';
import {
  EmptyState,
  ScreenTitle,
  SecondaryButton,
  colors,
} from '../components/ProjectDetailsCard';
import {
  MILESTONE_FILTERS,
  buildMilestoneTracking,
  filterMilestones,
} from '../services/MilestoneTrackingService';
import type {
  MilestoneBreakdown,
  MilestoneFilter,
  MilestoneRelatedUpdate,
} from '../services/MilestoneTrackingService';
import type {
  ProjectUpdate,
  ScheduleItem,
} from '../types';

function countLabel(count: number, singular: string) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : `${singular}s`}`;
}

export function MilestoneTrackingScreen({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  currentUpdate,
  onBack,
  onSchedule,
  onUpcoming,
  onProjectHealthDashboard,
  onExecutiveKPIDashboard,
  onConstructionTimeline,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
  onBack: () => void;
  onSchedule?: () => void;
  onUpcoming?: () => void;
  onProjectHealthDashboard?: () => void;
  onExecutiveKPIDashboard?: () => void;
  onConstructionTimeline?: () => void;
}) {
  const [selectedFilter, setSelectedFilter] = useState<MilestoneFilter>('All');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const tracking = useMemo(
    () =>
      buildMilestoneTracking({
        projects,
        updates: savedUpdates,
        scheduleItems,
        currentUpdate,
      }),
    [currentUpdate, projects, savedUpdates, scheduleItems],
  );
  const milestones = useMemo(
    () =>
      filterMilestones({
        milestones: tracking.milestones,
        filter: selectedFilter,
        projectName: selectedFilter === 'By Project' ? selectedProject : null,
      }),
    [selectedFilter, selectedProject, tracking.milestones],
  );

  function selectFilter(filter: MilestoneFilter) {
    setSelectedFilter(filter);

    if (filter !== 'By Project') {
      setSelectedProject(null);
    }
  }

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title="Milestone Tracking"
        subtitle="Track scheduled milestones with local progress, action, photo, and update signals."
      />

      <View style={styles.commandPanel}>
        <Text style={styles.commandTitle}>
          Milestone Navigation
        </Text>

        <Text style={styles.commandSubtitle}>
          Review milestone health and move between the related schedule and executive views.
        </Text>

        <View style={styles.commandRow}>
          <SecondaryButton
            label="Home"
            icon="home-outline"
            onPress={onBack}
            compact
          />

          {onSchedule ? (
            <SecondaryButton
              label="Schedule"
              icon="calendar-outline"
              onPress={onSchedule}
              compact
            />
          ) : null}
        </View>

        {onUpcoming || onProjectHealthDashboard ? (
          <View style={styles.commandRow}>
            {onUpcoming ? (
              <SecondaryButton
                label="Upcoming"
                icon="time-outline"
                onPress={onUpcoming}
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

        {onExecutiveKPIDashboard || onConstructionTimeline ? (
          <View style={styles.commandRow}>
            {onExecutiveKPIDashboard ? (
              <SecondaryButton
                label="KPI Dashboard"
                icon="stats-chart-outline"
                onPress={onExecutiveKPIDashboard}
                compact
              />
            ) : null}

            {onConstructionTimeline ? (
              <SecondaryButton
                label="Timeline"
                icon="git-branch-outline"
                onPress={onConstructionTimeline}
                compact
              />
            ) : null}
          </View>
        ) : null}
      </View>

      <MilestoneSummaryCard summary={tracking.summary} />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Milestone Filters
        </Text>

        <Text style={styles.sectionSubtitle}>
          Showing {countLabel(milestones.length, 'milestone')}
          {selectedFilter === 'All' ? '' : ` in ${selectedFilter.toLowerCase()}`}.
        </Text>

        <MilestoneFilterBar
          filters={MILESTONE_FILTERS}
          selectedFilter={selectedFilter}
          onSelectFilter={selectFilter}
          projects={tracking.projects}
          selectedProject={selectedProject}
          onSelectProject={setSelectedProject}
        />
      </View>

      <View style={styles.breakdownCard}>
        <Text style={styles.breakdownTitle}>
          Milestones by Project
        </Text>

        {tracking.summary.byProject.length > 0 ? (
          tracking.summary.byProject.map(item => (
            <BreakdownRow
              key={item.name}
              item={item}
            />
          ))
        ) : (
          <Text style={styles.emptyText}>
            No project milestones are available yet.
          </Text>
        )}
      </View>

      <View style={styles.breakdownCard}>
        <Text style={styles.breakdownTitle}>
          Milestones by Area / Location
        </Text>

        {tracking.summary.byArea.length > 0 ? (
          tracking.summary.byArea.map(item => (
            <BreakdownRow
              key={item.name}
              item={item}
            />
          ))
        ) : (
          <Text style={styles.emptyText}>
            No milestone locations are available yet.
          </Text>
        )}
      </View>

      <View style={styles.recentCard}>
        <Text style={styles.breakdownTitle}>
          Recent Milestone-Related Updates
        </Text>

        {tracking.recentUpdates.length > 0 ? (
          tracking.recentUpdates.map(update => (
            <RecentUpdateRow
              key={update.id}
              update={update}
            />
          ))
        ) : (
          <Text style={styles.emptyText}>
            No saved updates are related to the current milestones yet.
          </Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Milestone Detail
        </Text>

        <Text style={styles.sectionSubtitle}>
          Due dates, related field evidence, open actions, and a rule-based next step for every scheduled milestone.
        </Text>
      </View>

      {milestones.length > 0 ? (
        milestones.map(milestone => (
          <MilestoneCard
            key={milestone.id}
            milestone={milestone}
          />
        ))
      ) : (
        <EmptyState
          title="No milestones found"
          text="Add schedule items with milestones or due dates to begin tracking progress here."
        />
      )}
    </ScrollView>
  );
}

function BreakdownRow({
  item,
}: {
  item: MilestoneBreakdown;
}) {
  return (
    <View style={styles.breakdownRow}>
      <View style={styles.breakdownMain}>
        <Text style={styles.breakdownName}>
          {item.name}
        </Text>

        <Text style={styles.breakdownDetail}>
          {item.completed} completed • {item.atRisk} at risk • {item.overdue} overdue
        </Text>
      </View>

      <Text style={styles.breakdownTotal}>
        {item.total}
      </Text>
    </View>
  );
}

function RecentUpdateRow({
  update,
}: {
  update: MilestoneRelatedUpdate;
}) {
  return (
    <View style={styles.updateRow}>
      <View style={styles.updateIcon}>
        <Ionicons
          name="newspaper-outline"
          size={18}
          color={colors.primary}
        />
      </View>

      <View style={styles.updateMain}>
        <Text style={styles.updateTitle}>
          {update.projectName}
          {update.areaName ? ` • ${update.areaName}` : ''}
        </Text>

        <Text style={styles.updateDate}>
          {update.dateLabel} • {countLabel(update.photoCount, 'photo')} • {countLabel(update.relatedMilestonesCount, 'related milestone')}
        </Text>

        <Text
          style={styles.updateDescription}
          numberOfLines={2}
        >
          {update.description}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  appFrame: {
    flex: 1,
  },

  commandPanel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 15,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
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

  section: {
    marginBottom: 2,
  },

  sectionTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 4,
  },

  sectionSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 8,
  },

  breakdownCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 15,
    marginBottom: 14,
  },

  recentCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 15,
    marginBottom: 14,
  },

  breakdownTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    paddingTop: 15,
    paddingBottom: 5,
  },

  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 11,
  },

  breakdownMain: {
    flex: 1,
  },

  breakdownName: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 2,
  },

  breakdownDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },

  breakdownTotal: {
    color: colors.primary,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
  },

  emptyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    paddingTop: 5,
    paddingBottom: 15,
  },

  updateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 11,
  },

  updateIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  updateMain: {
    flex: 1,
  },

  updateTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 2,
  },

  updateDate: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginBottom: 3,
  },

  updateDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
