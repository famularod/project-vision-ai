import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './ProjectDetailsCard';

export type UpcomingMilestone = {
  id: string;
  title: string;
  projectName: string;
  dueLabel: string;
  status: string;
  percentComplete: number;
};

export function UpcomingMilestonesCard({
  milestones,
}: {
  milestones: UpcomingMilestone[];
}) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconBubble}>
          <Ionicons
            name="flag-outline"
            size={20}
            color={colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.title}>
            Upcoming Milestones
          </Text>

          <Text style={styles.subtitle}>
            Schedule items due soon across active projects.
          </Text>
        </View>
      </View>

      {milestones.length > 0 ? (
        milestones.map(milestone => (
          <View
            key={milestone.id}
            style={styles.itemRow}
          >
            <View style={styles.rowMain}>
              <Text style={styles.itemTitle}>
                {milestone.title || 'Untitled milestone'}
              </Text>

              <Text style={styles.itemSub}>
                {milestone.projectName || 'No project'} • {milestone.dueLabel}
              </Text>

              <Text style={styles.itemSub}>
                {milestone.status} • {milestone.percentComplete}% complete
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.emptyText}>
          No upcoming milestones detected from dated schedule items.
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
    backgroundColor: colors.primarySoft,
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
