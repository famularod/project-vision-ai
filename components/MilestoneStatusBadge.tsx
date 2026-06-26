import { StyleSheet, Text, View } from 'react-native';
import type { MilestoneDisplayStatus } from '../services/MilestoneTrackingService';
import { colors } from './ProjectDetailsCard';

const statusColors: Record<MilestoneDisplayStatus, string> = {
  Completed: colors.success,
  Overdue: colors.danger,
  'At Risk': colors.warning,
  Upcoming: colors.primary,
  'No Due Date': colors.muted,
};

export function milestoneStatusColor(status: MilestoneDisplayStatus) {
  return statusColors[status];
}

export function MilestoneStatusBadge({
  status,
}: {
  status: MilestoneDisplayStatus;
}) {
  const color = milestoneStatusColor(status);

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: `${color}1A` },
      ]}
    >
      <Text
        style={[
          styles.text,
          { color },
        ]}
      >
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  text: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
});
