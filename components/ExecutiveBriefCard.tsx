import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

const colors = {
  card: '#FFFFFF',
  fill: '#F2F2F7',
  text: '#1D1D1F',
  muted: '#6E6E73',
  line: '#E5E5EA',
  primary: '#007AFF',
  primarySoft: '#EAF4FF',
  warning: '#FF9500',
};

export function ExecutiveBriefCard({
  score,
  projectName,
  summary,
}: {
  score: number;
  projectName: string;
  summary: string;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconBubble}>
          <Ionicons
            name="briefcase-outline"
            size={22}
            color={colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.title}>
            Executive Brief
          </Text>

          <Text style={styles.subtitle}>
            Overall project health for {projectName}.
          </Text>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <Text style={styles.scoreValue}>
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
            { width: `${score}%` },
          ]}
        />
      </View>

      <Text style={styles.summaryLabel}>
        Executive Summary
      </Text>

      <Text style={styles.bodyText}>
        {summary}
      </Text>
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
    color: colors.primary,
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
    marginBottom: 14,
  },

  scoreFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.warning,
  },

  summaryLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
});
