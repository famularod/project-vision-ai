import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import {
  IconName,
  colors,
} from './ProjectDetailsCard';

type KPITone = 'neutral' | 'warning' | 'danger' | 'success';

const toneColors: Record<KPITone, string> = {
  neutral: colors.primary,
  warning: colors.warning,
  danger: colors.danger,
  success: colors.success,
};

export function KPIStatusRow({
  label,
  value,
  detail,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: IconName;
  tone?: KPITone;
}) {
  const color = toneColors[tone];

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.iconBubble,
          { backgroundColor: `${color}1A` },
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={color}
        />
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.label}>
          {label}
        </Text>

        <Text style={styles.detail}>
          {detail}
        </Text>
      </View>

      <Text
        style={[
          styles.value,
          { color },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </Text>
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

  label: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 2,
  },

  detail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },

  value: {
    minWidth: 54,
    textAlign: 'right',
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },
});
