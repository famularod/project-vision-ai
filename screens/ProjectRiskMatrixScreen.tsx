import { useMemo } from 'react';
import type { ReactNode } from 'react';
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
import { RiskDetailCard } from '../components/RiskDetailCard';
import { RiskMatrixGrid } from '../components/RiskMatrixGrid';
import { RiskPriorityBadge } from '../components/RiskPriorityBadge';
import {
  EmptyState,
  ScreenTitle,
  SecondaryButton,
  colors,
} from '../components/ProjectDetailsCard';
import { buildProjectRiskMatrix } from '../services/ProjectRiskService';
import type {
  ProjectRiskSummary,
} from '../services/ProjectRiskService';
import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';

export function ProjectRiskMatrixScreen({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
  onBack,
  onProjectHealthDashboard,
  onExecutiveKPIDashboard,
  onAIProjectCoach,
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
  onAIProjectCoach?: () => void;
}) {
  const matrix = useMemo(
    () =>
      buildProjectRiskMatrix({
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
  const elevatedRiskCount =
    matrix.criticalRisks.length + matrix.highPriorityRisks.length;

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title="Project Risk Matrix"
        subtitle="Rule-based risk assessment generated locally from schedule, safety, action item, documentation, update cadence, and photo visibility data."
      />

      <View style={styles.commandPanel}>
        <Text style={styles.commandTitle}>
          Risk Navigation
        </Text>

        <Text style={styles.commandSubtitle}>
          Move between risk, health, KPI, and coach views without changing project data.
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

        <View style={styles.commandRow}>
          {onExecutiveKPIDashboard ? (
            <SecondaryButton
              label="KPI Dashboard"
              icon="stats-chart-outline"
              onPress={onExecutiveKPIDashboard}
              compact
            />
          ) : null}

          {onAIProjectCoach ? (
            <SecondaryButton
              label="AI Coach"
              icon="bulb-outline"
              onPress={onAIProjectCoach}
              compact
            />
          ) : null}
        </View>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>
          Risk Summary
        </Text>

        <Text style={styles.summaryText}>
          {matrix.risks.length.toLocaleString('en-US')} category risks calculated across {matrix.projectSummaries.length.toLocaleString('en-US')} project{matrix.projectSummaries.length === 1 ? '' : 's'}. {elevatedRiskCount.toLocaleString('en-US')} elevated risk{elevatedRiskCount === 1 ? '' : 's'} require management attention.
        </Text>
      </View>

      <RiskMatrixGrid risks={matrix.risks} />

      <RiskSection
        title="Critical Risks"
        subtitle="Items with critical severity based on deterministic schedule, safety, action, documentation, cadence, and visibility rules."
      >
        {matrix.criticalRisks.length > 0 ? (
          matrix.criticalRisks.map(risk => (
            <RiskDetailCard
              key={risk.id}
              risk={risk}
            />
          ))
        ) : (
          <EmptyState
            title="No critical risks"
            text="No critical risks were detected from the current local project data."
          />
        )}
      </RiskSection>

      <RiskSection
        title="High-Priority Risks"
        subtitle="High-severity risks that should stay visible in management reviews."
      >
        {matrix.highPriorityRisks.length > 0 ? (
          matrix.highPriorityRisks.map(risk => (
            <RiskDetailCard
              key={risk.id}
              risk={risk}
            />
          ))
        ) : (
          <EmptyState
            title="No high-priority risks"
            text="No high-severity risks were detected from the current local project data."
          />
        )}
      </RiskSection>

      <RiskSection
        title="Recommended Actions"
        subtitle="Next actions generated from elevated risks."
      >
        <View style={styles.actionList}>
          {matrix.recommendedActions.map((action, index) => (
            <View
              key={`${index}-${action}`}
              style={styles.actionRow}
            >
              <Text style={styles.actionNumber}>
                {index + 1}
              </Text>

              <Text style={styles.actionText}>
                {action}
              </Text>
            </View>
          ))}
        </View>
      </RiskSection>

      <RiskSection
        title="Risk Summary By Project"
        subtitle="Elevated and controlled risk counts grouped by project."
      >
        {matrix.projectSummaries.map(summary => (
          <ProjectRiskSummaryCard
            key={summary.projectName}
            summary={summary}
          />
        ))}
      </RiskSection>
    </ScrollView>
  );
}

function RiskSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>
        {title}
      </Text>

      <Text style={styles.sectionSubtitle}>
        {subtitle}
      </Text>

      {children}
    </View>
  );
}

function ProjectRiskSummaryCard({
  summary,
}: {
  summary: ProjectRiskSummary;
}) {
  return (
    <View style={styles.projectSummaryCard}>
      <View style={styles.projectSummaryHeader}>
        <View style={styles.projectSummaryMain}>
          <Text style={styles.projectSummaryTitle}>
            {summary.projectName}
          </Text>

          <Text style={styles.projectSummarySubtitle}>
            Top category: {summary.topCategory}
          </Text>
        </View>

        <RiskPriorityBadge
          severity={
            summary.criticalRisks > 0
              ? 'Critical'
              : summary.highRisks > 0
                ? 'High'
                : summary.mediumRisks > 0
                  ? 'Medium'
                  : 'Low'
          }
        />
      </View>

      <View style={styles.projectMetricRow}>
        <ProjectRiskMetric
          label="Elevated"
          value={summary.totalRisks}
        />

        <ProjectRiskMetric
          label="Critical"
          value={summary.criticalRisks}
          danger={summary.criticalRisks > 0}
        />

        <ProjectRiskMetric
          label="High"
          value={summary.highRisks}
        />

        <ProjectRiskMetric
          label="Medium"
          value={summary.mediumRisks}
        />
      </View>
    </View>
  );
}

function ProjectRiskMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <View style={styles.projectMetric}>
      <Text
        style={[
          styles.projectMetricValue,
          danger && styles.projectMetricValueDanger,
        ]}
      >
        {value.toLocaleString('en-US')}
      </Text>

      <Text style={styles.projectMetricLabel}>
        {label}
      </Text>
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

  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  summaryLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  summaryText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },

  section: {
    marginBottom: 14,
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

  actionList: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 5,
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },

  actionNumber: {
    minWidth: 24,
    color: colors.primary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    textAlign: 'center',
  },

  actionText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },

  projectSummaryCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },

  projectSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },

  projectSummaryMain: {
    flex: 1,
  },

  projectSummaryTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    marginBottom: 3,
  },

  projectSummarySubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },

  projectMetricRow: {
    flexDirection: 'row',
    gap: 8,
  },

  projectMetric: {
    flex: 1,
    backgroundColor: colors.fill,
    borderRadius: 8,
    padding: 9,
  },

  projectMetricValue: {
    color: colors.primary,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
  },

  projectMetricValueDanger: {
    color: colors.danger,
  },

  projectMetricLabel: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    marginTop: 2,
    textTransform: 'uppercase',
  },
});
