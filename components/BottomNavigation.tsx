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
  | 'Reports'
  | 'Admin';

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
        label="Today"
        icon="home-outline"
        active={current === 'Home'}
        onPress={() => onChange('Home')}
      />

      <TabButton
        label="Projects"
        icon="folder-outline"
        active={current === 'Projects'}
        onPress={() => onChange('Projects')}
      />

      <View style={styles.captureSlot}>
        <TouchableOpacity
          style={[
            styles.captureButton,
            isWalkActive(current) && styles.captureButtonActive,
          ]}
          onPress={onNew}
        >
          <Ionicons
            name="walk-outline"
            size={22}
            color="#FFFFFF"
          />
          <Text
            style={styles.captureButtonText}
            numberOfLines={1}
          >
            Walk
          </Text>
        </TouchableOpacity>
      </View>

      <TabButton
        label="Review"
        icon="bar-chart-outline"
        active={isReviewActive(current)}
        onPress={() => onChange('Reports')}
      />

      <TabButton
        label="More"
        icon="ellipsis-horizontal-circle-outline"
        active={isMoreActive(current)}
        onPress={() => onChange('Admin')}
      />
    </View>
  );
}

function isWalkActive(current: string) {
  return (
    current === 'SelectProject' ||
    current === 'AddPhotos' ||
    current === 'BuildUpdate'
  );
}

function isReviewActive(current: string) {
  return (
    current === 'Reports' ||
    current === 'SavedUpdates' ||
    current === 'AIExecutiveBrief' ||
    current === 'WeeklyExecutiveReport' ||
    current === 'ProjectHealthDashboard' ||
    current === 'ExecutiveKPIDashboard' ||
    current === 'CriticalPath' ||
    current === 'MilestoneTracking'
  );
}

function isMoreActive(current: string) {
  return (
    current === 'Admin' ||
    current === 'Diagnostics' ||
    current === 'ReferenceDocuments' ||
    current === 'Schedule' ||
    current === 'Upcoming' ||
    current === 'ConstructionTimeline' ||
    current === 'DelayAnalysis' ||
    current === 'ContractorPerformance' ||
    current === 'ProjectRiskMatrix' ||
    current === 'PortfolioDashboard' ||
    current === 'AIProjectCoach'
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

  captureButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 1,
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

  captureSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  captureButton: {
    minWidth: 74,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  captureButtonActive: {
    backgroundColor: '#005BBB',
  },
});
