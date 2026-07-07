import { Ionicons } from '@expo/vector-icons';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type IconName = keyof typeof Ionicons.glyphMap;

type BottomNavigationDestination =
  | 'Home'
  | 'Projects'
  | 'SavedUpdates';

type BottomNavigationProps = {
  current: string;
  onChange: (screen: BottomNavigationDestination) => void;
};

const colors = {
  card: '#FFFFFF',
  muted: '#6E6E73',
  line: '#E5E5EA',
  primary: '#007AFF',
};

export function BottomNavigation({
  current,
  onChange,
}: BottomNavigationProps) {
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
        active={isProjectsActive(current)}
        onPress={() => onChange('Projects')}
      />

      <TabButton
        label="Updates"
        icon="document-text-outline"
        active={isUpdatesActive(current)}
        onPress={() => onChange('SavedUpdates')}
      />
    </View>
  );
}

function isProjectsActive(current: string) {
  return (
    current === 'Projects' ||
    current === 'ProjectWorkspace' ||
    current === 'ProjectDocuments'
  );
}

function isUpdatesActive(current: string) {
  return (
    current === 'SavedUpdates' ||
    current === 'UpdateDetail'
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
      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={21}
        color={
          active
            ? colors.primary
            : colors.muted
        }
      />

      <Text
        style={[
          styles.tabText,
          active && styles.tabTextActive,
        ]}
        numberOfLines={1}
      >
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
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingBottom:
      Platform.OS === 'ios' ? 24 : 10,
  },

  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 3,
  },

  tabText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },

  tabTextActive: {
    color: colors.primary,
  },

});
