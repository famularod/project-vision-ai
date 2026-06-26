import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import {
  IconName,
  colors,
} from './ProjectDetailsCard';

type ActionTone = 'neutral' | 'warning' | 'danger' | 'success';

const toneColors: Record<ActionTone, {
  bg: string;
  icon: string;
}> = {
  neutral: {
    bg: colors.primarySoft,
    icon: colors.primary,
  },
  warning: {
    bg: colors.warningSoft,
    icon: colors.warning,
  },
  danger: {
    bg: colors.dangerSoft,
    icon: colors.danger,
  },
  success: {
    bg: colors.successSoft,
    icon: colors.success,
  },
};

export function WeeklyReportActionList({
  items,
  tone = 'neutral',
  icon = 'sparkles-outline',
}: {
  items: string[];
  tone?: ActionTone;
  icon?: IconName;
}) {
  const color = toneColors[tone];

  return (
    <>
      {items.map((item, index) => (
        <View
          key={`${index}-${item}`}
          style={styles.card}
        >
          <View
            style={[
              styles.iconBubble,
              { backgroundColor: color.bg },
            ]}
          >
            <Ionicons
              name={icon}
              size={18}
              color={color.icon}
            />
          </View>

          <Text style={styles.bodyText}>
            {item}
          </Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    gap: 12,
  },

  iconBubble: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  bodyText: {
    flex: 1,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
});
