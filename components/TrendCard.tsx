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

export function TrendCard({
  title,
  value,
  detail,
  direction = 'flat',
  icon,
  items = [],
}: {
  title: string;
  value: string;
  detail: string;
  direction?: TrendDirection;
  icon?: IconName;
  items?: string[];
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
            name={icon || meta.icon}
            size={20}
            color={meta.color}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.title}>
            {title}
          </Text>

          <Text style={styles.value}>
            {value}
          </Text>
        </View>
      </View>

      <Text style={styles.detail}>
        {detail}
      </Text>

      {items.length > 0 ? (
        <View style={styles.itemList}>
          {items.map((item, index) => (
            <Text
              key={`${title}-${index}-${item}`}
              style={styles.itemText}
            >
              {item}
            </Text>
          ))}
        </View>
      ) : null}
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
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  detail: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },

  itemList: {
    marginTop: 10,
    gap: 7,
  },

  itemText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
