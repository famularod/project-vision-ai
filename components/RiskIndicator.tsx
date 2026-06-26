import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import {
  IconName,
  colors,
} from './ProjectDetailsCard';

type RiskTone = 'neutral' | 'warning' | 'danger' | 'success';

const toneMeta: Record<RiskTone, {
  icon: IconName;
  color: string;
}> = {
  neutral: {
    icon: 'information-circle-outline',
    color: colors.primary,
  },
  warning: {
    icon: 'alert-circle-outline',
    color: colors.warning,
  },
  danger: {
    icon: 'warning-outline',
    color: colors.danger,
  },
  success: {
    icon: 'checkmark-circle-outline',
    color: colors.success,
  },
};

export function RiskIndicator({
  title,
  subtitle,
  score,
  tone = 'warning',
}: {
  title: string;
  subtitle: string;
  score?: number;
  tone?: RiskTone;
}) {
  const meta = toneMeta[tone];

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.iconBubble,
          { backgroundColor: `${meta.color}1A` },
        ]}
      >
        <Ionicons
          name={meta.icon}
          size={18}
          color={meta.color}
        />
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.title}>
          {title}
        </Text>

        <Text style={styles.subtitle}>
          {subtitle}
        </Text>
      </View>

      {typeof score === 'number' ? (
        <View
          style={[
            styles.scorePill,
            { backgroundColor: `${meta.color}1A` },
          ]}
        >
          <Text
            style={[
              styles.scoreText,
              { color: meta.color },
            ]}
          >
            {score}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },

  iconBubble: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowMain: {
    flex: 1,
  },

  title: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 2,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },

  scorePill: {
    minWidth: 42,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
  },

  scoreText: {
    fontSize: 13,
    fontWeight: '900',
  },
});
