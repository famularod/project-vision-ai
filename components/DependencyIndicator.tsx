import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './ProjectDetailsCard';

type DependencyTone = 'blocking' | 'dependency' | 'clear';

const toneMeta: Record<DependencyTone, {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = {
  blocking: {
    color: colors.danger,
    icon: 'warning-outline',
  },
  dependency: {
    color: colors.warning,
    icon: 'git-branch-outline',
  },
  clear: {
    color: colors.success,
    icon: 'checkmark-circle-outline',
  },
};

export function DependencyIndicator({
  label,
  tone,
}: {
  label: string;
  tone: DependencyTone;
}) {
  const meta = toneMeta[tone];

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: `${meta.color}14` },
      ]}
    >
      <Ionicons
        name={meta.icon}
        size={16}
        color={meta.color}
      />

      <Text
        style={[
          styles.label,
          { color: meta.color },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },

  label: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
});
