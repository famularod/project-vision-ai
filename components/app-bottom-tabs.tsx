import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';
import type { AppScreen } from '../types/app-navigation';
import {
  vitruviusAudienceCanAccessAskEcos,
  type VitruviusAskEcosPilotControl,
  type VitruviusBetaAudience,
} from '../services/VitruviusBetaAuthorization';
import { isOverviewPrimaryNavigationActive } from './app-primary-navigation';

type IconName = keyof typeof Ionicons.glyphMap;

/** Above the 44-point minimum (services/NativeInteractionPolicy.ts). */
export const TAB_TOUCH_TARGET = 48;

export function AppBottomTabs({
  current,
  onChange,
  onTalk,
  onAskECOS,
  audience = 'owner_internal',
  askEcosPilotControl = null,
}: {
  current: AppScreen;
  onChange: (screen: AppScreen) => void;
  onTalk: () => void;
  onAskECOS?: () => void;
  audience?: VitruviusBetaAudience;
  askEcosPilotControl?: VitruviusAskEcosPilotControl | null;
}) {
  const showAskECOS = vitruviusAudienceCanAccessAskEcos(audience, askEcosPilotControl);
  const primaryAssistantLabel = showAskECOS ? 'Ask ECOS' : 'Project actions';
  const openPrimaryAssistant = showAskECOS ? (onAskECOS || onTalk) : onTalk;
  return (
    <View style={styles.bottomTabs} testID="app-bottom-tabs">
      <TabButton
        label="Overview"
        icon="home-outline"
        active={isOverviewPrimaryNavigationActive(current)}
        onPress={() => onChange('Home')}
      />

      <TabButton
        label="Tasks"
        icon="checkbox-outline"
        active={current === 'Schedule'}
        onPress={() => onChange('Schedule')}
      />

      <TouchableOpacity
        style={styles.talkButton}
        onPress={openPrimaryAssistant}
        accessibilityRole="button"
        accessibilityLabel={primaryAssistantLabel}
      >
        <View style={styles.talkIcon}>
          <Ionicons
            name={showAskECOS ? 'chatbubble-ellipses-outline' : 'mic'}
            size={21}
            color="#FFFFFF"
          />
        </View>
        <Text style={styles.talkText}>{primaryAssistantLabel}</Text>
      </TouchableOpacity>

      <TabButton
        label="Reports"
        icon="reader-outline"
        active={current === 'Reports'}
        onPress={() => onChange('Reports')}
      />
    </View>
  );
}

function TabButton({
  label,
  icon,
  active,
  onPress,
  role = 'tab',
}: {
  label: string;
  icon: IconName;
  active: boolean;
  onPress: () => void;
  role?: 'tab' | 'button';
}) {
  return (
    <TouchableOpacity
      style={styles.tabButton}
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={role === 'tab' ? { selected: active } : undefined}
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={21}
        color={active ? colors.primary : colors.mutedText}
      />

      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bottomTabs: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: process.env.EXPO_OS === 'ios' ? 24 : 10,
  },
  // Each button is a 48-point target with the bar's top padding inside it:
  // the buttons were about 36 points tall (whole-app audit A2 pass 2 L4).
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 3,
    minHeight: TAB_TOUCH_TARGET,
    paddingTop: 6,
    paddingBottom: 4,
  },
  tabText: {
    color: colors.mutedText,
    fontSize: 10,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.primary,
  },
  talkButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 2,
    minHeight: TAB_TOUCH_TARGET,
    paddingTop: 6,
    paddingBottom: 4,
  },
  talkIcon: {
    width: 36,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  talkText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
  },
});
