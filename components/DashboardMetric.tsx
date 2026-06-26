import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import {
  IconName,
  colors,
  styles,
} from './ProjectDetailsCard';

export function DashboardMetric({
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
