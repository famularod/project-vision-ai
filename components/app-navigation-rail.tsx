import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../theme';
import type { AppScreen } from '../types/app-navigation';
import { isOverviewPrimaryNavigationActive } from './app-primary-navigation';
import { AppProjectSwitcher } from './app-project-switcher';

type IconName = keyof typeof Ionicons.glyphMap;

export function AppNavigationRail({
  current,
  expanded,
  onChange,
  onTalk,
  taskProjects = [],
  selectedTaskProject = null,
  onTaskProjectChange,
  updateProjects = [],
  selectedUpdateProject = null,
  onUpdateProjectChange,
}: {
  current: AppScreen;
  expanded: boolean;
  onChange: (screen: AppScreen) => void;
  onTalk: () => void;
  taskProjects?: string[];
  selectedTaskProject?: string | null;
  onTaskProjectChange?: (projectName: string | null) => void;
  updateProjects?: string[];
  selectedUpdateProject?: string | null;
  onUpdateProjectChange?: (projectName: string | null) => void;
}) {
  return (
    <SafeAreaView
      style={[styles.rail, expanded ? styles.railExpanded : styles.railMedium]}
      edges={['top']}
      testID="app-navigation-rail"
      accessibilityLabel="DAVE navigation rail"
    >
      <View style={[styles.brand, expanded && styles.brandExpanded]}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>D</Text>
        </View>
        {expanded ? (
          <View>
            <Text style={styles.brandName}>DAVE</Text>
            <Text style={styles.brandCaption}>Project Vision AI</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.navigationItems}>
        <RailButton
          label="Overview"
          icon="home-outline"
          active={isOverviewPrimaryNavigationActive(current)}
          expanded={expanded}
          onPress={() => onChange('Home')}
        />
        <RailButton
          label="Tasks"
          icon="checkbox-outline"
          active={current === 'Schedule'}
          expanded={expanded}
          onPress={() => onChange('Schedule')}
        />
        <Pressable
          style={({ pressed }) => [
            styles.railButton,
            expanded && styles.railButtonExpanded,
            styles.talkButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={onTalk}
          accessibilityRole="button"
          accessibilityLabel="Talk to project assistant"
        >
          <View style={styles.talkIcon}>
            <Ionicons name="mic" size={21} color={colors.surface} />
          </View>
          <Text style={styles.talkText}>Talk</Text>
        </Pressable>
        <RailButton
          label="Reports"
          icon="reader-outline"
          active={current === 'Reports'}
          expanded={expanded}
          onPress={() => onChange('Reports')}
        />
      </View>

      {expanded && current === 'Schedule' && onTaskProjectChange ? (
        <AppProjectSwitcher
          projects={taskProjects}
          selectedProject={selectedTaskProject}
          onChange={onTaskProjectChange}
        />
      ) : null}
      {expanded && current === 'SavedUpdates' && onUpdateProjectChange ? (
        <AppProjectSwitcher
          projects={updateProjects}
          selectedProject={selectedUpdateProject}
          onChange={onUpdateProjectChange}
          title="UPDATE PROJECT"
          itemNoun="updates"
          testID="update-project-switcher"
        />
      ) : null}
    </SafeAreaView>
  );
}

function RailButton({
  active,
  expanded,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  expanded: boolean;
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.railButton,
        expanded && styles.railButtonExpanded,
        active && styles.railButtonActive,
        pressed && styles.buttonPressed,
      ]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={23}
        color={active ? colors.primary : colors.mutedText}
      />
      <Text style={[styles.railLabel, active && styles.railLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: {
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  railMedium: {
    width: 92,
  },
  railExpanded: {
    width: 220,
  },
  brand: {
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  brandExpanded: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  brandMarkText: {
    color: colors.surface,
    fontSize: 20,
    fontWeight: '900',
  },
  brandName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  brandCaption: {
    color: colors.mutedText,
    fontSize: 10,
    fontWeight: '700',
  },
  navigationItems: {
    gap: spacing.xs,
  },
  railButton: {
    minHeight: 64,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
  },
  railButtonExpanded: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  railButtonActive: {
    backgroundColor: colors.primarySoft,
  },
  railLabel: {
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '800',
  },
  railLabelActive: {
    color: colors.primary,
  },
  talkButton: {
    backgroundColor: 'transparent',
  },
  talkIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  talkText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
  },
  buttonPressed: {
    opacity: 0.72,
  },
});
