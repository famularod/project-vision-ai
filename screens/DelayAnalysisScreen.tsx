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
import { DelayCauseCard } from '../components/DelayCauseCard';
import { DelayImpactCard } from '../components/DelayImpactCard';
import { DelayRecommendationCard } from '../components/DelayRecommendationCard';
import { DelaySummaryCard } from '../components/DelaySummaryCard';
import { Screen } from '../components/layout/Screen';
import { ScreenCard } from '../components/layout/ScreenCard';
import { ScreenEmptyState } from '../components/layout/ScreenEmptyState';
import { ScreenFooter } from '../components/layout/ScreenFooter';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { ScreenSection } from '../components/layout/ScreenSection';
import { SecondaryButton } from '../components/ProjectDetailsCard';
import { analyzeDelays } from '../services/DelayAnalysisService';
import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import {
  spacing,
  typography,
} from '../theme';

export function DelayAnalysisScreen({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
  onBack,
  onCriticalPath,
  onMilestoneTracking,
  onProjectHealthDashboard,
  onExecutiveKPIDashboard,
  onContractorPerformance,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate: ProjectUpdate | null;
  onBack: () => void;
  onCriticalPath?: () => void;
  onMilestoneTracking?: () => void;
  onProjectHealthDashboard?: () => void;
  onExecutiveKPIDashboard?: () => void;
  onContractorPerformance?: () => void;
}) {
  const analysis = useMemo(
    () =>
      analyzeDelays({
        projects,
        scheduleItems,
        updates: savedUpdates,
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

  return (
    <Screen contentStyle={contentStyle}>
      <ScreenHeader
        title="Delay Analysis"
        subtitle="Rule-based delay signals from schedule, milestones, actions, safety, documents, and field update cadence."
        onBack={onBack}
      />

      <ScreenCard style={styles.navigationCard}>
        <Text style={styles.navigationTitle}>
          Delay Navigation
        </Text>

        <View style={styles.navigationRow}>
          {onCriticalPath ? (
            <SecondaryButton
              label="Critical Path"
              icon="git-branch-outline"
              onPress={onCriticalPath}
              compact
            />
          ) : null}

          {onMilestoneTracking ? (
            <SecondaryButton
              label="Milestones"
              icon="flag-outline"
              onPress={onMilestoneTracking}
              compact
            />
          ) : null}
        </View>

        <View style={styles.navigationRow}>
          {onProjectHealthDashboard ? (
            <SecondaryButton
              label="Health"
              icon="pulse-outline"
              onPress={onProjectHealthDashboard}
              compact
            />
          ) : null}

          {onExecutiveKPIDashboard ? (
            <SecondaryButton
              label="KPI Dashboard"
              icon="stats-chart-outline"
              onPress={onExecutiveKPIDashboard}
              compact
            />
          ) : null}
        </View>

        {onContractorPerformance ? (
          <View style={styles.navigationRow}>
            <SecondaryButton label="Contractors" icon="people-outline" onPress={onContractorPerformance} compact />
          </View>
        ) : null}
      </ScreenCard>

      <DelaySummaryCard summary={analysis.summary} />

      <DelayImpactCard summary={analysis.summary} />

      <ScreenSection
        title="Delay Causes"
        subtitle="Every item below is derived from the current local project records."
      >
        {analysis.delays.length > 0 ? (
          analysis.delays.map(delay => (
            <DelayCauseCard
              key={delay.id}
              delay={delay}
            />
          ))
        ) : (
          <ScreenEmptyState
            title="No delay signals"
            text="No overdue work or near-term delay risks are detected from the current local data."
          />
        )}
      </ScreenSection>

      <ScreenSection
        title="Recommended Recovery Actions"
        subtitle="Prioritized actions to reduce the highest current delay exposure."
      >
        {analysis.recommendedRecoveryActions.map((action, index) => (
          <DelayRecommendationCard
            key={`${index}-${action}`}
            index={index}
            text={action}
          />
        ))}
      </ScreenSection>

      <ScreenFooter>
        <Text style={styles.footerText}>
          Delay analysis is calculated locally. No external AI request is made from this screen.
        </Text>
      </ScreenFooter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  navigationCard: {
    marginBottom: spacing.lg,
  },

  navigationTitle: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },

  navigationRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },

  footerText: typography.caption,
});
