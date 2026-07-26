import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../theme';
import type { AppScreen } from '../types/app-navigation';
import { PRODUCT_BRAND } from '../product-brand';
import { isOverviewPrimaryNavigationActive } from './app-primary-navigation';
import { AppProjectSwitcher } from './app-project-switcher';
import { VitruviusBrandLockup } from './vitruvius-brand-lockup';

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
  documentProjects = [],
  selectedDocumentProject = null,
  onDocumentProjectChange,
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
  documentProjects?: string[];
  selectedDocumentProject?: string | null;
  onDocumentProjectChange?: (projectName: string | null) => void;
}) {
  return (
    <SafeAreaView
      style={[styles.rail, expanded ? styles.railExpanded : styles.railMedium]}
      edges={['top']}
      testID="app-navigation-rail"
      accessibilityLabel={`${PRODUCT_BRAND.name} navigation rail`}
    >
      <View style={[styles.brand, expanded && styles.brandExpanded]}>
        <VitruviusBrandLockup
          compact={!expanded}
          showText={expanded}
          testID="app-rail-brand"
        />
      </View>

      <View style={styles.navigationItems}>
        <RailButton
          label="Overview"
          icon="home-outline"
          active={current !== 'ProjectDocuments' && isOverviewPrimaryNavigationActive(current)}
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
        <RailButton
          label="Documents"
          icon="folder-open-outline"
          active={current === 'ProjectDocuments'}
          expanded={expanded}
          onPress={() => onChange('ProjectDocuments')}
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
          <View
            testID="app-nav-talk-icon-slot"
            style={[styles.talkIcon, expanded && styles.talkIconExpanded]}
          >
            <Ionicons
              name="mic"
              size={expanded ? 27 : 25}
              color={colors.surface}
            />
          </View>
          <Text style={[styles.talkText, expanded && styles.talkTextExpanded]}>
            Talk
          </Text>
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
      {expanded && current === 'ProjectDocuments' && onDocumentProjectChange ? (
        <AppProjectSwitcher
          projects={documentProjects}
          selectedProject={selectedDocumentProject}
          onChange={onDocumentProjectChange}
          title="DOCUMENT PROJECT"
          itemNoun="documents"
          testID="document-project-switcher"
          includeAll={false}
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
      <View
        testID={`app-nav-${label.toLowerCase()}-icon-slot`}
        style={[
          styles.railIconSlot,
          expanded && styles.railIconSlotExpanded,
        ]}
      >
        <Ionicons
          name={icon}
          size={expanded ? 29 : 27}
          color={active ? colors.primary : colors.mutedText}
        />
      </View>
      <Text
        style={[
          styles.railLabel,
          expanded && styles.railLabelExpanded,
          active && styles.railLabelActive,
        ]}
      >
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
    width: 104,
  },
  railExpanded: {
    width: 248,
  },
  brand: {
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  brandExpanded: {
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.xs,
  },
  navigationItems: {
    gap: spacing.xs,
  },
  railButton: {
    minHeight: 72,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
  },
  railButtonExpanded: {
    minHeight: 76,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  railButtonActive: {
    backgroundColor: colors.primarySoft,
  },
  railIconSlot: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railIconSlotExpanded: {
    width: 44,
    height: 44,
  },
  railLabel: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  railLabelExpanded: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  railLabelActive: {
    color: colors.primary,
  },
  talkButton: {
    backgroundColor: 'transparent',
  },
  talkIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  talkIconExpanded: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  talkText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  talkTextExpanded: {
    fontSize: 16,
    lineHeight: 21,
  },
  buttonPressed: {
    opacity: 0.72,
  },
});
