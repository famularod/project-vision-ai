import { StyleSheet, Text, View } from 'react-native';
import type { DelayAnalysis } from '../services/DelayAnalysisService';
import { ScreenCard } from './layout/ScreenCard';
import {
  colors,
  spacing,
  typography,
} from '../theme';

export function DelayImpactCard({
  summary,
}: {
  summary: DelayAnalysis['summary'];
}) {
  return (
    <ScreenCard style={styles.card}>
      <Text style={styles.title}>
        Delay Impact
      </Text>

      <ImpactList
        label="Impacted Projects"
        items={summary.impactedProjects}
        emptyText="No project-level delays are currently detected."
      />

      <ImpactList
        label="Impacted Milestones"
        items={summary.impactedMilestones}
        emptyText="No milestone-specific delays are currently detected."
      />
    </ScreenCard>
  );
}

function ImpactList({
  label,
  items,
  emptyText,
}: {
  label: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <View style={styles.list}>
      <Text style={styles.label}>
        {label}
      </Text>

      <Text style={styles.text}>
        {items.length > 0 ? items.join(', ') : emptyText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },

  title: typography.h2,

  list: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },

  label: typography.label,

  text: {
    ...typography.body,
    marginTop: spacing.xxs,
  },
});
