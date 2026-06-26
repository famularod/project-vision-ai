import { StyleSheet, Text, View } from 'react-native';
import type { RiskSeverity } from '../services/ProjectRiskService';
import { colors } from './ProjectDetailsCard';

const severityColors: Record<RiskSeverity, string> = {
  Low: colors.success,
  Medium: colors.primary,
  High: colors.warning,
  Critical: colors.danger,
};

export function riskSeverityColor(severity: RiskSeverity) {
  return severityColors[severity];
}

export function RiskPriorityBadge({
  severity,
}: {
  severity: RiskSeverity;
}) {
  const color = riskSeverityColor(severity);

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: `${color}1A` },
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          { color },
        ]}
      >
        {severity}
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

  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
});
