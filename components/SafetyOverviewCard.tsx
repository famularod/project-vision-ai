import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './ProjectDetailsCard';

export type SafetyIssueSummary = {
  id: string;
  title: string;
  projectName: string;
  owner: string;
  status: string;
};

export function SafetyOverviewCard({
  issues,
}: {
  issues: SafetyIssueSummary[];
}) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconBubble}>
          <Ionicons
            name="shield-checkmark-outline"
            size={20}
            color={colors.danger}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.title}>
            Safety Overview
          </Text>

          <Text style={styles.subtitle}>
            Open safety concerns surfaced from project photo updates.
          </Text>
        </View>
      </View>

      {issues.length > 0 ? (
        issues.map(issue => (
          <View
            key={issue.id}
            style={styles.itemRow}
          >
            <View style={styles.rowMain}>
              <Text style={styles.itemTitle}>
                {issue.title || 'Safety concern'}
              </Text>

              <Text style={styles.itemSub}>
                {issue.projectName || 'No project'} • {issue.status}
              </Text>

              {issue.owner ? (
                <Text style={styles.itemSub}>
                  Owner: {issue.owner}
                </Text>
              ) : null}
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.emptyText}>
          No open safety issues detected from saved updates.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 15,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },

  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowMain: {
    flex: 1,
  },

  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },

  itemRow: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },

  itemTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 3,
  },

  itemSub: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },

  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    paddingTop: 4,
  },
});
