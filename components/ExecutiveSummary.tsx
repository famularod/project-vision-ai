import { Ionicons } from '@expo/vector-icons';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type IconName = keyof typeof Ionicons.glyphMap;

type SummaryTotals = {
  updates: number;
  photos: number;
  openActions: number;
  overdueActions: number;
  dueThisWeek: number;
};

type ExecutiveSummaryProps = {
  projects: string[];
  totals: SummaryTotals;
  referenceDocumentCount: number;
  onViewProjects: () => void;
};

const colors = {
  card: '#FFFFFF',
  fill: '#F2F2F7',
  text: '#1D1D1F',
  muted: '#6E6E73',
  line: '#E5E5EA',
  primary: '#007AFF',
  primarySoft: '#EAF4FF',
  dangerSoft: '#FFECEC',
  danger: '#FF3B30',
};

export function ExecutiveSummary({
  projects,
  totals,
  referenceDocumentCount,
  onViewProjects,
}: ExecutiveSummaryProps) {
  return (
    <View style={styles.dashboardSummaryCard}>
      <View style={styles.dashboardSummaryHeader}>
        <View>
          <Text style={styles.panelTitle}>
            Executive Summary
          </Text>

          <Text style={styles.bodyText}>
            {projects.length} active project
            {projects.length === 1 ? '' : 's'} under management
          </Text>
        </View>

        <TouchableOpacity
          style={styles.dashboardManageButton}
          onPress={onViewProjects}
        >
          <Text style={styles.dashboardManageText}>
            Manage
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.dashboardMetricGrid}>
        <DashboardMetric
          label="Open Issues"
          value={totals.openActions}
          icon="alert-circle-outline"
          danger={totals.openActions > 0}
        />

        <DashboardMetric
          label="Overdue"
          value={totals.overdueActions}
          icon="time-outline"
          danger={totals.overdueActions > 0}
        />

        <DashboardMetric
          label="Due 7 Days"
          value={totals.dueThisWeek}
          icon="calendar-outline"
        />

        <DashboardMetric
          label="Photos"
          value={totals.photos}
          icon="images-outline"
        />

        <DashboardMetric
          label="Updates"
          value={totals.updates}
          icon="document-text-outline"
        />

        <DashboardMetric
          label="Documents"
          value={referenceDocumentCount}
          icon="documents-outline"
        />
      </View>
    </View>
  );
}

function DashboardMetric({
  label,
  value,
  icon,
  danger = false,
}: {
  label: string;
  value: number;
  icon: IconName;
  danger?: boolean;
}) {
  return (
    <View
      style={[
        styles.dashboardMetricCard,
        danger && styles.dashboardMetricDanger,
      ]}
    >
      <View style={styles.dashboardMetricIconRow}>
        <Ionicons
          name={icon}
          size={19}
          color={danger ? colors.danger : colors.primary}
        />

        <Text
          style={[
            styles.dashboardMetricValue,
            danger && styles.dashboardMetricValueDanger,
          ]}
        >
          {value.toLocaleString('en-US')}
        </Text>
      </View>

      <Text style={styles.dashboardMetricLabel}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dashboardSummaryCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderColor: colors.line,
    borderWidth: 1,
  },

  dashboardSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },

  panelTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },

  dashboardManageButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  dashboardManageText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  dashboardMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  dashboardMetricCard: {
    width: '48%',
    backgroundColor: colors.fill,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 86,
    borderWidth: 1,
    borderColor: colors.line,
  },

  dashboardMetricDanger: {
    backgroundColor: colors.dangerSoft,
    borderColor: '#FFD1D1',
  },

  dashboardMetricIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  dashboardMetricValue: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '900',
  },

  dashboardMetricValueDanger: {
    color: colors.danger,
  },

  dashboardMetricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
});
