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
  | 'SavedUpdates'
  | 'Upcoming';

type BottomNavigationProps = {
  current: string;
  onChange: (screen: BottomNavigationDestination) => void;
  onNew: () => void;
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
  onNew,
}: BottomNavigationProps) {
  return (
    <View style={styles.bottomTabs}>
      <TabButton
        label="Home"
        icon="home-outline"
        active={current === 'Home'}
        onPress={() => onChange('Home')}
      />

      <TabButton
        label="Locations"
        icon="location-outline"
        active={current === 'Projects'}
        onPress={() => onChange('Projects')}
      />

      <TouchableOpacity
        style={styles.newTabButton}
        onPress={onNew}
      >
        <Ionicons
          name="camera-outline"
          size={24}
          color="#FFFFFF"
        />
        <Text style={styles.newTabButtonText}>Capture</Text>
      </TouchableOpacity>

      <TabButton
        label="History"
        icon="time-outline"
        active={current === 'SavedUpdates'}
        onPress={() => onChange('SavedUpdates')}
      />

      <TabButton
        label="Upcoming"
        icon="calendar-outline"
        active={current === 'Upcoming'}
        onPress={() => onChange('Upcoming')}
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

  newTabButtonText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
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

  newTabButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
  },
});
