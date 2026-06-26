import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { DelayItem } from '../services/DelayAnalysisService';
import { ScreenCard } from './layout/ScreenCard';
import { RiskPriorityBadge } from './RiskPriorityBadge';
import {
  colors,
  spacing,
  typography,
} from '../theme';

function daysLateLabel(daysLate: number | null) {
  if (daysLate === null) return 'Timing not recorded';
  if (daysLate === 0) return 'At risk';

  return `${daysLate} day${daysLate === 1 ? '' : 's'} late`;
}

export function DelayCauseCard({
  delay,
}: {
  delay: DelayItem;
}) {
  return (
    <ScreenCard style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleMain}>
          <Text style={styles.project}>
            {delay.projectName}
          </Text>

          <Text style={styles.area}>
            {delay.areaName || 'No area/location recorded'}
          </Text>
        </View>

        <RiskPriorityBadge severity={delay.impact} />
      </View>

      <View style={styles.metaRow}>
        <Meta icon="time-outline" label={daysLateLabel(delay.daysLate)} />
        <Meta icon="git-branch-outline" label={delay.category} />
      </View>

      <Detail label="Related Item" text={delay.relatedItem} />
      {delay.relatedMilestone ? (
        <Detail label="Milestone" text={delay.relatedMilestone} />
      ) : null}
      <Detail label="Likely Cause" text={delay.likelyCause} />
      <Detail label="Recommended Action" text={delay.recommendedAction} accent />
    </ScreenCard>
  );
}

function Meta({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.meta}>
      <Ionicons
        name={icon}
        size={15}
        color={colors.mutedText}
      />

      <Text style={styles.metaText}>
        {label}
      </Text>
    </View>
  );
}

function Detail({
  label,
  text,
  accent = false,
}: {
  label: string;
  text: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.detail}>
      <Text
        style={[
          styles.detailLabel,
          accent && styles.detailLabelAccent,
        ]}
      >
        {label}
      </Text>

      <Text style={styles.detailText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },

  titleMain: {
    flex: 1,
  },

  project: typography.h3,

  area: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },

  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },

  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },

  metaText: typography.caption,

  detail: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
    marginTop: spacing.xs,
  },

  detailLabel: typography.label,

  detailLabelAccent: {
    color: colors.primary,
  },

  detailText: {
    ...typography.body,
    marginTop: spacing.xxs,
  },
});
