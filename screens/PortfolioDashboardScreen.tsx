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
import { KPICard } from '../components/KPICard';
import { KPIGroupCard } from '../components/KPIGroupCard';
import { KPIStatusRow } from '../components/KPIStatusRow';
import { PortfolioFilterBar } from '../components/PortfolioFilterBar';
import { PortfolioProjectCard } from '../components/PortfolioProjectCard';
import { PortfolioStatusChart } from '../components/PortfolioStatusChart';
import { PortfolioSummaryCard } from '../components/PortfolioSummaryCard';
import {
  EmptyState,
  ScreenTitle,
  SecondaryButton,
  colors,
} from '../components/ProjectDetailsCard';
import {
  PORTFOLIO_FILTER_OPTIONS,
  PORTFOLIO_SORT_OPTIONS,
  buildPortfolioDashboard,
  filterPortfolioProjects,
  sortPortfolioProjects,
} from '../services/PortfolioDashboardService';
import type {
  PortfolioFilterKey,
  PortfolioSortKey,
} from '../services/PortfolioDashboardService';
import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';

export function PortfolioDashboardScreen({
  contentStyle,
  activeProjects,
  archivedProjects,
  savedUpdates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
  onBack,
  onExecutiveKPIDashboard,
  onWeeklyExecutiveReport,
  onAIExecutiveBrief,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  activeProjects: string[];
  archivedProjects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate: ProjectUpdate | null;
  onBack: () => void;
  onExecutiveKPIDashboard?: () => void;
  onWeeklyExecutiveReport?: () => void;
  onAIExecutiveBrief?: () => void;
}) {
  const [selectedFilter, setSelectedFilter] =
    useState<PortfolioFilterKey>('Active');
  const [selectedSort, setSelectedSort] =
    useState<PortfolioSortKey>('Risk');
  const dashboard = useMemo(
    () =>
      buildPortfolioDashboard({
        activeProjects,
        archivedProjects,
        savedUpdates,
        scheduleItems,
        referenceDocuments,
        currentUpdate,
      }),
    [
      activeProjects,
      archivedProjects,
      currentUpdate,
      referenceDocuments,
      savedUpdates,
      scheduleItems,
    ],
  );
  const visibleProjects = useMemo(
    () =>
      sortPortfolioProjects(
        filterPortfolioProjects(dashboard.projects, selectedFilter),
        selectedSort,
      ),
    [
      dashboard.projects,
      selectedFilter,
      selectedSort,
    ],
  );

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title="Portfolio Dashboard"
        subtitle="Executive portfolio view generated locally from all projects, updates, photos, schedule data, action items, safety concerns, and documents."
      />

      <View style={styles.commandPanel}>
        <Text style={styles.commandTitle}>
          Portfolio Navigation
        </Text>

        <Text style={styles.commandSubtitle}>
          Move between executive portfolio views without changing project data.
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

        <View style={styles.commandRow}>
          {onWeeklyExecutiveReport ? (
            <SecondaryButton
              label="Weekly Report"
              icon="newspaper-outline"
              onPress={onWeeklyExecutiveReport}
              compact
            />
          ) : null}

          {onAIExecutiveBrief ? (
            <SecondaryButton
              label="Exec Brief"
              icon="briefcase-outline"
              onPress={onAIExecutiveBrief}
              compact
            />
          ) : null}
        </View>
      </View>

      <PortfolioSummaryCard summary={dashboard.summary} />

      <PortfolioStatusChart statusCounts={dashboard.statusCounts} />

      <View style={styles.metricGrid}>
        <KPICard
          label="Open Action Items"
          value={dashboard.metrics.openActionItems}
          subtitle="Unresolved issue or safety actions"
          icon="checkbox-outline"
          tone={dashboard.metrics.openActionItems > 0 ? 'warning' : 'success'}
        />

        <KPICard
          label="Overdue Actions"
          value={dashboard.metrics.overdueActionItems}
          subtitle="Open actions past due"
          icon="timer-outline"
          tone={dashboard.metrics.overdueActionItems > 0 ? 'danger' : 'success'}
        />

        <KPICard
          label="Safety Concerns"
          value={dashboard.metrics.safetyConcerns}
          subtitle="Open safety items"
          icon="shield-checkmark-outline"
          tone={dashboard.metrics.safetyConcerns > 0 ? 'danger' : 'success'}
        />

        <KPICard
          label="Photos This Week"
          value={dashboard.metrics.photosThisWeek}
          subtitle="Photos from weekly updates"
          icon="images-outline"
          tone={dashboard.metrics.photosThisWeek > 0 ? 'success' : 'neutral'}
        />

        <KPICard
          label="Updates This Week"
          value={dashboard.metrics.updatesThisWeek}
          subtitle="Saved updates and draft content"
          icon="newspaper-outline"
          tone={dashboard.metrics.updatesThisWeek > 0 ? 'success' : 'warning'}
        />

        <KPICard
          label="Upcoming Milestones"
          value={dashboard.metrics.upcomingMilestones}
          subtitle="Due within 14 days"
          icon="flag-outline"
          tone={dashboard.metrics.upcomingMilestones > 0 ? 'warning' : 'neutral'}
        />

        <KPICard
          label="Overdue Milestones"
          value={dashboard.metrics.overdueMilestones}
          subtitle="Incomplete schedule items past due"
          icon="calendar-clear-outline"
          tone={dashboard.metrics.overdueMilestones > 0 ? 'danger' : 'success'}
        />

        <KPICard
          label="Documents Added"
          value={dashboard.metrics.documentsAdded}
          subtitle="Reference documents this week"
          icon="documents-outline"
          tone={dashboard.metrics.documentsAdded > 0 ? 'success' : 'neutral'}
        />
      </View>

      <KPIGroupCard
        title="Executive Priorities"
        subtitle="Top 10 highest priority issues across the full portfolio."
      >
        {dashboard.executivePriorities.map((priority, index) => (
          <KPIStatusRow
            key={`${index}-${priority}`}
            label={`Priority ${index + 1}`}
            value={index + 1}
            detail={priority}
            icon={index === 0 ? 'flag-outline' : 'chevron-forward-circle-outline'}
            tone={index < 3 ? 'warning' : 'neutral'}
          />
        ))}
      </KPIGroupCard>

      <View style={styles.projectHeader}>
        <Text style={styles.sectionLabel}>
          Project List
        </Text>

        <Text style={styles.sectionSubtitle}>
          Showing {visibleProjects.length.toLocaleString('en-US')} {selectedFilter.toLowerCase()} project{visibleProjects.length === 1 ? '' : 's'}, sorted by {selectedSort.toLowerCase()}.
        </Text>
      </View>

      <PortfolioFilterBar
        sortOptions={PORTFOLIO_SORT_OPTIONS}
        selectedSort={selectedSort}
        onSelectSort={setSelectedSort}
        filterOptions={PORTFOLIO_FILTER_OPTIONS}
        selectedFilter={selectedFilter}
        onSelectFilter={setSelectedFilter}
      />

      {visibleProjects.length > 0 ? (
        visibleProjects.map(project => (
          <PortfolioProjectCard
            key={project.projectName}
            project={project}
          />
        ))
      ) : (
        <EmptyState
          title="No matching projects"
          text="Choose another portfolio filter to see more projects."
        />
      )}
    </ScrollView>
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
    fontWeight: '800',
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
    gap: 10,
    marginTop: 10,
    alignItems: 'stretch',
  },

  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  projectHeader: {
    marginTop: 4,
  },

  sectionLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  sectionSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 2,
  },
});
