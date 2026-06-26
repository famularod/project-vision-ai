import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './ProjectDetailsCard';

function scoreTone(score: number) {
  if (score < 60) return colors.danger;
  if (score < 75) return colors.warning;

  return colors.success;
}

export function HealthScoreGauge({
  score,
  title,
  subtitle,
}: {
  score: number;
  title: string;
  subtitle: string;
}) {
  const tone = scoreTone(score);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconBubble}>
          <Ionicons
            name="pulse-outline"
            size={22}
            color={colors.primary}
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
      </View>

      <View style={styles.scoreRow}>
        <Text
          style={[
            styles.scoreValue,
            { color: tone },
          ]}
        >
          {score}
        </Text>

        <Text style={styles.scoreSuffix}>
          / 100
        </Text>
      </View>

      <View style={styles.scoreTrack}>
        <View
          style={[
            styles.scoreFill,
            {
              width: `${score}%`,
              backgroundColor: tone,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },

  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowMain: {
    flex: 1,
  },

  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },

  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 3,
  },

  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
  },

  scoreValue: {
    fontSize: 42,
    fontWeight: '900',
    lineHeight: 48,
  },

  scoreSuffix: {
    color: colors.muted,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
    marginLeft: 4,
  },

  scoreTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.fill,
    overflow: 'hidden',
  },

  scoreFill: {
    height: '100%',
    borderRadius: 999,
  },
});
