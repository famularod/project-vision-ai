import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

type RecommendationTone = 'neutral' | 'warning' | 'success';

const colors = {
  card: '#FFFFFF',
  text: '#1D1D1F',
  muted: '#6E6E73',
  line: '#E5E5EA',
  primary: '#007AFF',
  primarySoft: '#EAF4FF',
  success: '#34C759',
  successSoft: '#EAF8EE',
  warning: '#FF9500',
  warningSoft: '#FFF4E5',
};

const toneColors: Record<RecommendationTone, {
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
  success: {
    bg: colors.successSoft,
    icon: colors.success,
  },
};

export function AICoachRecommendationCard({
  title,
  text,
  tone = 'neutral',
}: {
  title: string;
  text: string;
  tone?: RecommendationTone;
}) {
  const color = toneColors[tone];

  return (
    <View style={styles.card}>
      <View
        style={[
          styles.iconBubble,
          { backgroundColor: color.bg },
        ]}
      >
        <Ionicons
          name="sparkles-outline"
          size={18}
          color={color.icon}
        />
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.title}>
          {title}
        </Text>

        <Text style={styles.bodyText}>
          {text}
        </Text>
      </View>
    </View>
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

  rowMain: {
    flex: 1,
  },

  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
});
