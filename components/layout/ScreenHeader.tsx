import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  colors,
  spacing,
  typography,
} from '../../theme';

type IconName = keyof typeof Ionicons.glyphMap;

export function ScreenHeader({
  title,
  subtitle,
  eyebrow,
  onBack,
  rightAction,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  onBack?: () => void;
  rightAction?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        {onBack ? (
          <HeaderIconButton
            icon="chevron-back-outline"
            label="Back"
            onPress={onBack}
          />
        ) : null}

        <View style={styles.titleMain}>
          {eyebrow ? (
            <Text style={styles.eyebrow}>
              {eyebrow}
            </Text>
          ) : null}

          <Text style={styles.title}>
            {title}
          </Text>

          {subtitle ? (
            <Text style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {rightAction ? (
          <View style={styles.rightAction}>
            {rightAction}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function HeaderIconButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.iconButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={22}
        color={colors.primary}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.lg,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },

  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  titleMain: {
    flex: 1,
  },

  eyebrow: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },

  title: typography.h1,

  subtitle: {
    ...typography.body,
    marginTop: spacing.xs,
  },

  rightAction: {
    alignItems: 'flex-end',
  },
});
