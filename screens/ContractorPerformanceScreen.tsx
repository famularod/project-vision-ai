import { useMemo, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { ContractorFilterBar } from '../components/ContractorFilterBar';
import { ContractorScoreCard } from '../components/ContractorScoreCard';
import { Screen } from '../components/layout/Screen';
import { ScreenCard } from '../components/layout/ScreenCard';
import { ScreenEmptyState } from '../components/layout/ScreenEmptyState';
import { ScreenFooter } from '../components/layout/ScreenFooter';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { ScreenSection } from '../components/layout/ScreenSection';
import { SecondaryButton } from '../components/ProjectDetailsCard';
import {
  CONTRACTOR_FILTERS,
  analyzeContractorPerformance,
  filterContractors,
} from '../services/ContractorPerformanceService';
import type { ContractorFilter } from '../services/ContractorPerformanceService';
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../types';
import { spacing, typography } from '../theme';

export function ContractorPerformanceScreen({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
  onBack,
  onDelayAnalysis,
  onCriticalPath,
  onProjectHealthDashboard,
  onExecutiveKPIDashboard,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate: ProjectUpdate | null;
  onBack: () => void;
  onDelayAnalysis?: () => void;
  onCriticalPath?: () => void;
  onProjectHealthDashboard?: () => void;
  onExecutiveKPIDashboard?: () => void;
}) {
  const [selectedFilter, setSelectedFilter] = useState<ContractorFilter>('All');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const dashboard = useMemo(
    () => analyzeContractorPerformance({ projects, scheduleItems, updates: savedUpdates, referenceDocuments, currentUpdate }),
    [currentUpdate, projects, referenceDocuments, savedUpdates, scheduleItems],
  );
  const contractors = useMemo(
    () => filterContractors({ contractors: dashboard.contractors, filter: selectedFilter, projectName: selectedFilter === 'By Project' ? selectedProject : null }),
    [dashboard.contractors, selectedFilter, selectedProject],
  );

  function selectFilter(filter: ContractorFilter) {
    setSelectedFilter(filter);
    if (filter !== 'By Project') setSelectedProject(null);
  }

  return (
    <Screen contentStyle={contentStyle}>
      <ScreenHeader
        title="Contractor Performance"
        subtitle="Rule-based contractor scorecards from schedule, actions, safety, milestone, update, and document data."
        onBack={onBack}
      />

      <ScreenCard style={styles.navigationCard}>
        <Text style={styles.navigationTitle}>Performance Navigation</Text>
        <View style={styles.navigationRow}>
          {onDelayAnalysis ? <SecondaryButton label="Delay Analysis" icon="timer-outline" onPress={onDelayAnalysis} compact /> : null}
          {onCriticalPath ? <SecondaryButton label="Critical Path" icon="git-branch-outline" onPress={onCriticalPath} compact /> : null}
        </View>
        <View style={styles.navigationRow}>
          {onProjectHealthDashboard ? <SecondaryButton label="Health" icon="pulse-outline" onPress={onProjectHealthDashboard} compact /> : null}
          {onExecutiveKPIDashboard ? <SecondaryButton label="KPI Dashboard" icon="stats-chart-outline" onPress={onExecutiveKPIDashboard} compact /> : null}
        </View>
      </ScreenCard>

      <ScreenSection
        title="Contractor Filters"
        subtitle={`Showing ${contractors.length.toLocaleString('en-US')} contractor${contractors.length === 1 ? '' : 's'}.`}
      >
        <ContractorFilterBar
          filters={CONTRACTOR_FILTERS}
          selectedFilter={selectedFilter}
          onSelectFilter={selectFilter}
          projects={dashboard.projectOptions}
          selectedProject={selectedProject}
          onSelectProject={setSelectedProject}
        />
      </ScreenSection>

      <ScreenSection
        title="Performance Scorecards"
        subtitle="Scores are calculated locally from current tracked work and evidence."
      >
        {contractors.length > 0 ? contractors.map(contractor => <ContractorScoreCard key={contractor.contractorName} contractor={contractor} />) : (
          <ScreenEmptyState title="No contractors found" text="Add contractor names to schedule items to create performance scorecards." />
        )}
      </ScreenSection>

      <ScreenFooter>
        <Text style={styles.footerText}>Performance scoring is deterministic and local. No external AI request is made from this screen.</Text>
      </ScreenFooter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  navigationCard: { marginBottom: spacing.lg },
  navigationTitle: { ...typography.h3, marginBottom: spacing.xs },
  navigationRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  footerText: typography.caption,
});
