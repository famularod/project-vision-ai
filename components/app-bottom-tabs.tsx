import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';
import type { AppScreen } from '../types/app-navigation';

type IconName = keyof typeof Ionicons.glyphMap;

export function AppBottomTabs({
  current,
  onChange,
}: {
  current: AppScreen;
  onChange: (screen: AppScreen) => void;
}) {
  return (
    <View style={styles.bottomTabs}>
      <TabButton
        label="Overview"
        icon="home-outline"
        active={current === 'Home'}
        onPress={() => onChange('Home')}
      />

      <TabButton
        label="Projects"
        icon="folder-open-outline"
        active={
          current === 'Projects' ||
          current === 'ProjectWorkspace' ||
          current === 'ProjectDocuments'
        }
        onPress={() => onChange('Projects')}
      />

      <TabButton
        label="Updates"
        icon="document-text-outline"
        active={current === 'SavedUpdates' || current === 'UpdateDetail'}
        onPress={() => onChange('SavedUpdates')}
      />

      <TabButton
        label="Reports"
        icon="reader-outline"
        active={current === 'Reports'}
        onPress={() => onChange('Reports')}
      />

      <TabButton
        label="Settings"
        icon="settings-outline"
        active={current === 'Admin'}
        onPress={() => onChange('Admin')}
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
});
