import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

type BriefTone = 'neutral' | 'warning' | 'success';
type IconName = keyof typeof Ionicons.glyphMap;

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

const toneColors: Record<BriefTone, {
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

export function ExecutiveBriefSection({
  title,
  subtitle,
  items,
  tone = 'neutral',
  icon = 'sparkles-outline',
}: {
  title: string;
  subtitle: string;
  items: string[];
  tone?: BriefTone;
  icon?: IconName;
}) {
  const color = toneColors[tone];

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>
        {title}
      </Text>

      <Text style={styles.sectionSubtitle}>
        {subtitle}
      </Text>

      {items.map((item, index) => (
        <View
          key={`${title}-${index}-${item}`}
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
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 14,
  },

  sectionLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  sectionSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 10,
  },

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
