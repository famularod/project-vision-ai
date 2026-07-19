import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

export function AppProjectSwitcher({
  projects,
  selectedProject,
  onChange,
}: {
  projects: string[];
  selectedProject: string | null;
  onChange: (projectName: string | null) => void;
}) {
  return (
    <View style={styles.container} testID="task-project-switcher">
      <Text style={styles.eyebrow}>TASK PROJECT</Text>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.options}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ProjectOption
          label="All Projects"
          selected={selectedProject === null}
          onPress={() => onChange(null)}
        />
        {projects.map(projectName => (
          <ProjectOption
            key={projectName}
            label={projectName}
            selected={selectedProject === projectName}
            onPress={() => onChange(projectName)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function ProjectOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
      ]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label === 'All Projects'
        ? 'Show tasks for all projects'
        : `Show tasks for ${label}`}
      accessibilityState={{ selected }}
    >
      <View style={[styles.indicator, selected && styles.indicatorSelected]} />
      <Text
        style={[styles.optionText, selected && styles.optionTextSelected]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
    paddingTop: spacing.lg,
  },
  eyebrow: {
    color: colors.tertiaryText,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  options: {
    gap: spacing.xxs,
    paddingBottom: spacing.md,
  },
  option: {
    minHeight: 48,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  optionSelected: {
    backgroundColor: colors.primarySoft,
  },
  optionPressed: {
    opacity: 0.7,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  indicatorSelected: {
    backgroundColor: colors.primary,
  },
  optionText: {
    flex: 1,
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: '700',
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: '900',
  },
});
