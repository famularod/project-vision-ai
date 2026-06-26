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

export function AIProjectHealthCard() {
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
            Project Health Score
          </Text>

          <Text style={styles.subtitle}>
            Placeholder sample only. No AI analysis has run yet.
          </Text>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <Text style={styles.scoreValue}>
          82
        </Text>

        <Text style={styles.scoreSuffix}>
          / 100
        </Text>
      </View>

      <View style={styles.scoreTrack}>
        <View style={styles.scoreFill} />
      </View>

      <Text style={styles.bodyText}>
        Sample status: steady progress with a few watch items. This score is static placeholder content for AI Project Coach v1.
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
    marginBottom: 12,
  },

  scoreFill: {
    width: '82%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.warning,
  },

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
});
