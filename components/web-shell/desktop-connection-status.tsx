import { StyleSheet, Text, View } from 'react-native';

import type {
  DAVEWebFreshnessState,
  DAVEWebFreshnessStatus,
} from '../../services/DAVEWebFreshness';
import { colors, spacing } from '../../theme';

export function DesktopConnectionStatus({
  freshness,
}: {
  freshness: DAVEWebFreshnessState;
}) {
  const label = freshnessLabel(freshness.status);
  const lastSuccess = freshness.lastSuccessfulRefreshAt
    ? formatLastSuccess(freshness.lastSuccessfulRefreshAt)
    : 'No successful cloud refresh yet';

  return (
    <View style={styles.container}>
      <View
        style={[styles.badge, styles[`badge_${freshness.status}`]]}
        accessibilityRole="text"
        accessibilityLabel={`${label}. ${lastSuccess}.`}
      >
        <View style={[styles.dot, styles[`dot_${freshness.status}`]]} />
        <Text style={[styles.badgeText, styles[`badgeText_${freshness.status}`]]}>
          {label}
        </Text>
      </View>
      <Text style={styles.lastSuccess}>{lastSuccess}</Text>
    </View>
  );
}

function freshnessLabel(status: DAVEWebFreshnessStatus): string {
  if (status === 'reconnecting') return 'Reconnecting';
  if (status === 'stale') return 'Stale';
  return 'Connected';
}

function formatLastSuccess(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No successful cloud refresh yet';
  return `Last cloud update ${date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-end', gap: 4 },
  badge: {
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  badge_connected: { backgroundColor: colors.successSoft },
  badge_reconnecting: { backgroundColor: colors.warningSoft },
  badge_stale: { backgroundColor: colors.dangerSoft },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dot_connected: { backgroundColor: colors.success },
  dot_reconnecting: { backgroundColor: colors.warning },
  dot_stale: { backgroundColor: colors.danger },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '900' },
  badgeText_connected: { color: '#217342' },
  badgeText_reconnecting: { color: '#8A5200' },
  badgeText_stale: { color: '#A32828' },
  lastSuccess: {
    color: colors.mutedText,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'right',
  },
});
