import { Ionicons } from '@expo/vector-icons';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type IconName = keyof typeof Ionicons.glyphMap;

type QuickActionsProps = {
  onNewUpdate: () => void;
  onViewProjects: () => void;
  onReferenceDocuments: () => void;
  onSchedule: () => void;
  onAIProjectCoach: () => void;
  onAIExecutiveBrief: () => void;
  onProjectHealthDashboard: () => void;
  onWeeklyExecutiveReport: () => void;
  onExecutiveKPIDashboard: () => void;
  onConstructionTimeline: () => void;
  onMilestoneTracking: () => void;
  onDelayAnalysis: () => void;
  onContractorPerformance: () => void;
  onProjectRiskMatrix: () => void;
  onPortfolioDashboard: () => void;
  onDiagnostics: () => void;
};

const colors = {
  card: '#FFFFFF',
  text: '#1D1D1F',
  line: '#E5E5EA',
  primary: '#007AFF',
};

export function QuickActions({
  onNewUpdate,
  onViewProjects,
  onReferenceDocuments,
  onSchedule,
  onAIProjectCoach,
  onAIExecutiveBrief,
  onProjectHealthDashboard,
  onWeeklyExecutiveReport,
  onExecutiveKPIDashboard,
  onConstructionTimeline,
  onMilestoneTracking,
  onDelayAnalysis,
  onContractorPerformance,
  onProjectRiskMatrix,
  onPortfolioDashboard,
  onDiagnostics,
}: QuickActionsProps) {
  return (
    <>
      <Text style={styles.sectionLabel}>
        Quick Actions
      </Text>

      <View style={styles.quickActionGrid}>
        <QuickActionButton
          label="New Update"
          icon="camera-outline"
          onPress={onNewUpdate}
          primary
        />

        <QuickActionButton
          label="Projects"
          icon="search-outline"
          onPress={onViewProjects}
        />

        <QuickActionButton
          label="Documents"
          icon="documents-outline"
          onPress={onReferenceDocuments}
        />

        <QuickActionButton
          label="Schedule"
          icon="calendar-outline"
          onPress={onSchedule}
        />

        <QuickActionButton
          label="AI Coach"
          icon="bulb-outline"
          onPress={onAIProjectCoach}
        />

        <QuickActionButton
          label="Exec Brief"
          icon="briefcase-outline"
          onPress={onAIExecutiveBrief}
        />

        <QuickActionButton
          label="Health Dashboard"
          icon="pulse-outline"
          onPress={onProjectHealthDashboard}
        />

        <QuickActionButton
          label="Weekly Report"
          icon="newspaper-outline"
          onPress={onWeeklyExecutiveReport}
        />

        <QuickActionButton
          label="KPI Dashboard"
          icon="stats-chart-outline"
          onPress={onExecutiveKPIDashboard}
        />

        <QuickActionButton
          label="Timeline"
          icon="git-branch-outline"
          onPress={onConstructionTimeline}
        />

        <QuickActionButton
          label="Milestones"
          icon="flag-outline"
          onPress={onMilestoneTracking}
        />

        <QuickActionButton
          label="Delay Analysis"
          icon="timer-outline"
          onPress={onDelayAnalysis}
        />

        <QuickActionButton
          label="Contractors"
          icon="people-outline"
          onPress={onContractorPerformance}
        />

        <QuickActionButton
          label="Risk Matrix"
          icon="warning-outline"
          onPress={onProjectRiskMatrix}
        />

        <QuickActionButton
          label="Portfolio"
          icon="albums-outline"
          onPress={onPortfolioDashboard}
        />

        <QuickActionButton
          label="Diagnostics"
          icon="pulse-outline"
          onPress={onDiagnostics}
        />
      </View>
    </>
  );
}

function QuickActionButton({
  label,
  icon,
  onPress,
  primary = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.quickActionButton,
        primary && styles.quickActionButtonPrimary,
      ]}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={22}
        color={primary ? '#FFFFFF' : colors.primary}
      />

      <Text
        style={[
          styles.quickActionText,
          primary && styles.quickActionTextPrimary,
        ]}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 10,
    textTransform: 'uppercase',
  },

  quickActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  quickActionButton: {
    width: '48%',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.line,
    borderWidth: 1,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
  },

  quickActionButtonPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  quickActionText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '800',
    textAlign: 'center',
  },

  quickActionTextPrimary: {
    color: '#FFFFFF',
  },
});
