import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import {
  IconName,
  colors,
} from './ProjectDetailsCard';

type TrendDirection = 'up' | 'down' | 'flat';

const trendMeta: Record<TrendDirection, {
  icon: IconName;
  color: string;
}> = {
  up: {
    icon: 'trending-up-outline',
    color: colors.success,
  },
  down: {
    icon: 'trending-down-outline',
    color: colors.danger,
  },
  flat: {
    icon: 'remove-outline',
    color: colors.warning,
  },
};

export function KPITrendSummary({
  title,
  value,
  detail,
  direction = 'flat',
}: {
  title: string;
  value: string;
  detail: string;
  direction?: TrendDirection;
}) {
  const meta = trendMeta[direction];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View
          style={[
            styles.iconBubble,
            { backgroundColor: `${meta.color}1A` },
          ]}
        >
          <Ionicons
            name={meta.icon}
            size={20}
            color={meta.color}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.title}>
            {title}
          </Text>

          <Text
            style={[
              styles.value,
              { color: meta.color },
            ]}
          >
            {value}
          </Text>
        </View>
      </View>

      <Text style={styles.detail}>
        {detail}
      </Text>
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

  value: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },

  detail: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
});
