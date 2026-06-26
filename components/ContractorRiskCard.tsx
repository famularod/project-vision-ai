import { StyleSheet, Text } from 'react-native';
import type { ContractorPerformance } from '../services/ContractorPerformanceService';
import { ScreenCard } from './layout/ScreenCard';
import { RiskPriorityBadge } from './RiskPriorityBadge';
import { colors, spacing, typography } from '../theme';
import { View } from 'react-native';

export function ContractorRiskCard({ contractor }: { contractor: ContractorPerformance }) {
  return (
    <ScreenCard style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Management Action</Text>
        <RiskPriorityBadge severity={contractor.riskLevel} />
      </View>
      <Text style={styles.text}>{contractor.recommendedManagementAction}</Text>
    </ScreenCard>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.sm, marginBottom: 0, backgroundColor: colors.surfaceMuted },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.xs },
  title: typography.h3,
  text: typography.body,
});
