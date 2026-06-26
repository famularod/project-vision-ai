import { StyleSheet, Text, View } from 'react-native';
import type { ContractorPerformance } from '../services/ContractorPerformanceService';
import { ScreenCard } from './layout/ScreenCard';
import { RiskPriorityBadge } from './RiskPriorityBadge';
import { colors, spacing, typography } from '../theme';
import { ContractorMetricRow } from './ContractorMetricRow';
import { ContractorRiskCard } from './ContractorRiskCard';

export function ContractorScoreCard({ contractor }: { contractor: ContractorPerformance }) {
  const scoreColor = contractor.performanceScore >= 80 ? colors.success : contractor.performanceScore >= 65 ? colors.warning : colors.danger;

  return (
    <ScreenCard style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleMain}>
          <Text style={styles.title}>{contractor.contractorName}</Text>
          <Text style={styles.projects}>{contractor.activeProjects.length > 0 ? contractor.activeProjects.join(', ') : 'No active projects'}</Text>
        </View>
        <RiskPriorityBadge severity={contractor.riskLevel} />
      </View>

      <View style={styles.scoreRow}>
        <Text style={[styles.score, { color: scoreColor }]}>{contractor.performanceScore}</Text>
        <Text style={styles.scoreSuffix}>/ 100 performance score</Text>
      </View>

      <ContractorMetricRow label="Active Projects" value={contractor.activeProjects.length} icon="business-outline" tone="success" />
      <ContractorMetricRow label="Open Action Items" value={contractor.openActionItems} icon="checkbox-outline" tone={contractor.openActionItems > 0 ? 'warning' : 'success'} />
      <ContractorMetricRow label="Overdue Action Items" value={contractor.overdueActionItems} icon="timer-outline" tone={contractor.overdueActionItems > 0 ? 'danger' : 'success'} />
      <ContractorMetricRow label="Safety Concerns" value={contractor.safetyConcerns} icon="shield-checkmark-outline" tone={contractor.safetyConcerns > 0 ? 'danger' : 'success'} />
      <ContractorMetricRow label="Delayed Milestones" value={contractor.delayedMilestones} icon="flag-outline" tone={contractor.delayedMilestones > 0 ? 'danger' : 'success'} />
      <ContractorMetricRow label="Recent Updates" value={contractor.recentUpdates} icon="newspaper-outline" tone={contractor.recentUpdates > 0 ? 'success' : 'warning'} />
      <ContractorMetricRow label="Documentation Issues" value={contractor.documentationIssues} icon="documents-outline" tone={contractor.documentationIssues > 0 ? 'warning' : 'success'} />

      <ContractorRiskCard contractor={contractor} />
    </ScreenCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  titleMain: { flex: 1 },
  title: typography.h2,
  projects: { ...typography.caption, marginTop: spacing.xxs },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, marginBottom: spacing.sm },
  score: { fontSize: 36, lineHeight: 42, fontWeight: '900' },
  scoreSuffix: { ...typography.caption, marginBottom: spacing.xs },
});
