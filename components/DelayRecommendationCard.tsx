import { StyleSheet, Text, View } from 'react-native';
import { ScreenCard } from './layout/ScreenCard';
import {
  colors,
  spacing,
  typography,
} from '../theme';

export function DelayRecommendationCard({
  index,
  text,
}: {
  index: number;
  text: string;
}) {
  return (
    <ScreenCard style={styles.card}>
      <View style={styles.row}>
        <View style={styles.number}>
          <Text style={styles.numberText}>
            {index + 1}
          </Text>
        </View>

        <Text style={styles.text}>
          {text}
        </Text>
      </View>
    </ScreenCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },

  number: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  numberText: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
  },

  text: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    fontWeight: '700',
  },
});
