import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../theme';
import type { AppScreen } from '../types/app-navigation';
import { PRODUCT_BRAND } from '../product-brand';
import { isOverviewPrimaryNavigationActive } from './app-primary-navigation';
import { AppProjectSwitcher } from './app-project-switcher';
import { VitruviusBrandLockup } from './vitruvius-brand-lockup';
import {
  vitruviusAudienceCanAccessAskEcos,
  type VitruviusAskEcosPilotControl,
  type VitruviusBetaAudience,
} from '../services/VitruviusBetaAuthorization';

type IconName = keyof typeof Ionicons.glyphMap;

export function AppNavigationRail({
  current,
  expanded,
  onChange,
  onTalk,
  onAskECOS = () => undefined,
  askEcosActive = false,
  audience = 'owner_internal',
  askEcosPilotControl = null,
  taskProjects = [],
  selectedTaskProject = null,
  onTaskProjectChange,
  updateProjects = [],
  selectedUpdateProject = null,
  onUpdateProjectChange,
  documentProjects = [],
  documentCount,
  selectedDocumentProject = null,
  onDocumentProjectChange,
}: {
  current: AppScreen;
  expanded: boolean;
  onChange: (screen: AppScreen) => void;
  onTalk: () => void;
  onAskECOS?: () => void;
  askEcosActive?: boolean;
  audience?: VitruviusBetaAudience;
  askEcosPilotControl?: VitruviusAskEcosPilotControl | null;
  taskProjects?: string[];
  selectedTaskProject?: string | null;
  onTaskProjectChange?: (projectName: string | null) => void;
  updateProjects?: string[];
  selectedUpdateProject?: string | null;
  onUpdateProjectChange?: (projectName: string | null) => void;
  documentProjects?: string[];
  documentCount?: number;
  selectedDocumentProject?: string | null;
  onDocumentProjectChange?: (projectName: string | null) => void;
}) {
  const showAskECOS = vitruviusAudienceCanAccessAskEcos(audience, askEcosPilotControl);
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
          active={!askEcosActive && current !== 'ProjectDocuments' && isOverviewPrimaryNavigationActive(current)}
          expanded={expanded}
          onPress={() => onChange('Home')}
        />
        <RailButton
          label="Tasks"
          icon="checkbox-outline"
          active={!askEcosActive && current === 'Schedule'}
          expanded={expanded}
          onPress={() => onChange('Schedule')}
        />
        <RailButton
          label="Documents"
          icon="folder-open-outline"
          badgeCount={documentCount}
          active={!askEcosActive && current === 'ProjectDocuments'}
          expanded={expanded}
          onPress={() => onChange('ProjectDocuments')}
        />
        <RailButton
          label="Field Notes"
          icon="document-text-outline"
          active={!askEcosActive && current === 'FieldNotes'}
          expanded={expanded}
          onPress={() => onChange('FieldNotes')}
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
              size={expanded ? 30 : 27}
              color={colors.surface}
            />
          </View>
          <Text style={[styles.talkText, expanded && styles.talkTextExpanded]}>
            Talk
          </Text>
        </Pressable>
        {showAskECOS ? (
          <RailButton
            label="Ask ECOS"
            icon="chatbubble-ellipses-outline"
            active={askEcosActive}
            expanded={expanded}
            onPress={onAskECOS}
            role="tab"
          />
        ) : null}
        <RailButton
          label="Reports"
          icon="reader-outline"
          active={!askEcosActive && current === 'Reports'}
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
  badgeCount,
  onPress,
  role = 'tab',
}: {
  active: boolean;
  expanded: boolean;
  icon: IconName;
  label: string;
  badgeCount?: number;
  onPress: () => void;
  role?: 'tab' | 'button';
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
      accessibilityRole={role}
      accessibilityState={role === 'tab' ? { selected: active } : undefined}
      accessibilityLabel={badgeCount === undefined
        ? label
        : `${label}, ${badgeCount} document${badgeCount === 1 ? '' : 's'}`}
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
          size={expanded ? 32 : 29}
          color={active ? colors.primary : colors.mutedText}
        />
        {badgeCount !== undefined ? (
          <View style={styles.railIconCountBadge}>
            <Text style={styles.railIconCountText}>
              {badgeCount > 99 ? '99+' : String(badgeCount)}
            </Text>
          </View>
        ) : null}
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
    minHeight: 82,
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
    position: 'relative',
    overflow: 'visible',
  },
  railIconSlotExpanded: {
    width: 48,
    height: 48,
  },
  railLabel: {
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  railLabelExpanded: {
    fontSize: 18,
    lineHeight: 24,
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
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  talkText: {
    color: colors.primary,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },
  talkTextExpanded: {
    fontSize: 18,
    lineHeight: 24,
  },
  railIconCountBadge: {
    position: 'absolute',
    top: -2,
    right: -6,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railIconCountText: {
    color: colors.surface,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '900',
  },
  buttonPressed: {
    opacity: 0.72,
  },
});
