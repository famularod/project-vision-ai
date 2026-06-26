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
import { TimelineEventCard } from '../components/TimelineEventCard';
import { TimelineFilterBar } from '../components/TimelineFilterBar';
import { TimelineSummaryCard } from '../components/TimelineSummaryCard';
import {
  EmptyState,
  ScreenTitle,
  SecondaryButton,
  colors,
} from '../components/ProjectDetailsCard';
import {
  TIMELINE_FILTERS,
  buildConstructionTimeline,
} from '../services/ConstructionTimelineService';
import type {
  ConstructionTimelineFilter,
} from '../services/ConstructionTimelineService';
import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';

export function ConstructionTimelineScreen({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
  onBack,
  onProjectHealthDashboard,
  onExecutiveKPIDashboard,
  onMilestoneTracking,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate: ProjectUpdate | null;
  onBack: () => void;
  onProjectHealthDashboard?: () => void;
  onExecutiveKPIDashboard?: () => void;
  onMilestoneTracking?: () => void;
}) {
  const [selectedFilter, setSelectedFilter] =
    useState<ConstructionTimelineFilter>('All');
  const timeline = useMemo(
    () =>
      buildConstructionTimeline({
        projects,
        updates: savedUpdates,
        scheduleItems,
        referenceDocuments,
        currentUpdate,
      }),
    [
      currentUpdate,
      projects,
      referenceDocuments,
      savedUpdates,
      scheduleItems,
    ],
  );
  const events = useMemo(
    () =>
      selectedFilter === 'All'
        ? timeline.events
        : timeline.events.filter(event => event.type === selectedFilter),
    [
      selectedFilter,
      timeline.events,
    ],
  );

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title="Construction Timeline"
        subtitle="Chronological project record generated from updates, photos, action items, safety concerns, schedule milestones, and documents."
      />

      <View style={styles.commandPanel}>
        <Text style={styles.commandTitle}>
          Timeline Navigation
        </Text>

        <Text style={styles.commandSubtitle}>
          Review project history and jump back to executive dashboards without changing project data.
        </Text>

        <View style={styles.commandRow}>
          <SecondaryButton
            label="Home"
            icon="home-outline"
            onPress={onBack}
            compact
          />

          {onProjectHealthDashboard ? (
            <SecondaryButton
              label="Health"
              icon="pulse-outline"
              onPress={onProjectHealthDashboard}
              compact
            />
          ) : null}
        </View>

        {onExecutiveKPIDashboard ? (
          <View style={styles.commandRow}>
            <SecondaryButton
              label="KPI Dashboard"
              icon="stats-chart-outline"
              onPress={onExecutiveKPIDashboard}
              compact
            />
          </View>
        ) : null}

        {onMilestoneTracking ? (
          <View style={styles.commandRow}>
            <SecondaryButton
              label="Milestones"
              icon="flag-outline"
              onPress={onMilestoneTracking}
              compact
            />
          </View>
        ) : null}
      </View>

      <TimelineSummaryCard summary={timeline.summary} />

      <View style={styles.filterSection}>
        <Text style={styles.sectionLabel}>
          Timeline Events
        </Text>

        <Text style={styles.sectionSubtitle}>
          Showing {events.length.toLocaleString('en-US')} {selectedFilter === 'All' ? 'events' : selectedFilter.toLowerCase()} in most-recent-first order.
        </Text>

        <TimelineFilterBar
          filters={TIMELINE_FILTERS}
          selectedFilter={selectedFilter}
          onSelectFilter={setSelectedFilter}
        />
      </View>

      {events.length > 0 ? (
        events.map(event => (
          <TimelineEventCard
            key={event.id}
            event={event}
          />
        ))
      ) : (
        <EmptyState
          title="No timeline events"
          text="No project data matches the selected timeline filter yet."
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

  filterSection: {
    marginBottom: 2,
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
    marginBottom: 10,
  },
});
