import { StyleSheet, Text, View } from 'react-native';
import type {
  PortfolioDashboard,
  PortfolioProjectStatus,
} from '../services/PortfolioDashboardService';
import { colors } from './ProjectDetailsCard';

const statusOrder: PortfolioProjectStatus[] = [
  'Healthy',
  'Warning',
  'Critical',
  'Completed',
  'On Hold',
];

const statusColors: Record<PortfolioProjectStatus, string> = {
  Healthy: colors.success,
  Warning: colors.warning,
  Critical: colors.danger,
  Completed: colors.primary,
  'On Hold': colors.muted,
};

export function PortfolioStatusChart({
  statusCounts,
}: {
  statusCounts: PortfolioDashboard['statusCounts'];
}) {
  const total = statusOrder.reduce(
    (sum, status) => sum + statusCounts[status],
    0,
  );

  return (
    <View style={styles.card}>
      <Text style={styles.label}>
        Project Status
      </Text>

      <Text style={styles.subtitle}>
        Portfolio distribution by health and inferred status.
      </Text>

      {statusOrder.map(status => (
        <StatusRow
          key={status}
          status={status}
          count={statusCounts[status]}
          total={total}
        />
      ))}
    </View>
  );
}

function StatusRow({
  status,
  count,
  total,
}: {
  status: PortfolioProjectStatus;
  count: number;
  total: number;
}) {
  const color = statusColors[status];
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <View style={styles.statusRow}>
      <View style={styles.statusHeader}>
        <Text style={styles.statusLabel}>
          {status}
        </Text>

        <Text style={styles.statusCount}>
          {count.toLocaleString('en-US')} ({percent}%)
        </Text>
      </View>

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${percent}%`,
              backgroundColor: color,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 10,
  },

  statusRow: {
    marginTop: 10,
  },

  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },

  statusLabel: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },

  statusCount: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },

  track: {
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.fill,
    overflow: 'hidden',
  },

  fill: {
    height: '100%',
    borderRadius: 999,
  },
});
