import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';
import type { AppScreen } from '../types/app-navigation';
import { isOverviewPrimaryNavigationActive } from './app-primary-navigation';

type IconName = keyof typeof Ionicons.glyphMap;

export function AppBottomTabs({
  current,
  onChange,
  onTalk,
}: {
  current: AppScreen;
  onChange: (screen: AppScreen) => void;
  onTalk: () => void;
}) {
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
        onPress={onTalk}
        accessibilityRole="button"
        accessibilityLabel="Talk to project assistant"
      >
        <View style={styles.talkIcon}>
          <Ionicons name="mic" size={21} color="#FFFFFF" />
        </View>
        <Text style={styles.talkText}>Talk</Text>
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
}: {
  label: string;
  icon: IconName;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.tabButton}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
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
    paddingTop: 8,
    paddingBottom: process.env.EXPO_OS === 'ios' ? 24 : 10,
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 3,
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
