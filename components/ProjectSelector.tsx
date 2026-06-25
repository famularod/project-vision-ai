import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type IconName = keyof typeof Ionicons.glyphMap;

type ProjectSelectorStats = {
  updates: number;
  photos: number;
  openActions: number;
  overdueActions: number;
  dueThisWeek: number;
  lastUpdate?: string;
};

type ProjectSelectorProps = {
  contentStyle: StyleProp<ViewStyle>;
  projects: string[];
  projectStatsByName: Record<string, ProjectSelectorStats>;
  onSelect: (projectName: string) => void;
  onAddProject: (projectName: string) => boolean;
};

const EMPTY_PROJECT_STATS: ProjectSelectorStats = {
  updates: 0,
  photos: 0,
  openActions: 0,
  overdueActions: 0,
  dueThisWeek: 0,
};

const colors = {
  card: '#FFFFFF',
  fill: '#F2F2F7',
  text: '#1D1D1F',
  muted: '#6E6E73',
  line: '#E5E5EA',
  primary: '#007AFF',
  primarySoft: '#EAF4FF',
  dangerSoft: '#FFECEC',
  danger: '#FF3B30',
};

function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ProjectSelector({
  contentStyle,
  projects,
  projectStatsByName,
  onSelect,
  onAddProject,
}: ProjectSelectorProps) {
  const renderProject = ({ item: project }: { item: string }) => (
    <ProjectDashboardCard
      project={project}
      stats={
        projectStatsByName[project] || EMPTY_PROJECT_STATS
      }
      actionLabel="Select"
      onPress={() => onSelect(project)}
    />
  );

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={projects}
      keyExtractor={project => project}
      renderItem={renderProject}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Select Project"
            subtitle="Choose the job this update belongs to."
          />

          <AddProjectCard
            buttonLabel="Add and Start"
            placeholder="Example: Building 2400 Roof"
            onAdd={onAddProject}
          />
        </>
      }
      ListEmptyComponent={
        <EmptyState
          title="No active projects"
          text="Add a project manually to start an update."
        />
      }
    />
  );
}

function ProjectDashboardCard({
  project,
  stats,
  actionLabel = 'Update',
  onPress,
  onClose,
}: {
  project: string;
  stats: ProjectSelectorStats;
  actionLabel?: string;
  onPress: () => void;
  onClose?: () => void;
}) {
  return (
    <View style={styles.dashboardCard}>
      <TouchableOpacity onPress={onPress}>
        <View style={styles.dashboardHeader}>
          <View style={styles.rowIconBubble}>
            <Ionicons
              name="business-outline"
              size={20}
              color={colors.primary}
            />
          </View>

          <View style={styles.rowMain}>
            <Text style={styles.projectName}>
              {project}
            </Text>

            <Text style={styles.rowSub}>
              Last update:{' '}
              {stats.lastUpdate
                ? formatDisplayDate(
                    stats.lastUpdate,
                  )
                : 'None yet'}
            </Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <MiniStat
            label="Open Entries"
            value={stats.openActions}
          />

          <MiniStat
            label="Overdue"
            value={stats.overdueActions}
            danger={stats.overdueActions > 0}
          />

          <MiniStat
            label="Due 7 Days"
            value={stats.dueThisWeek}
          />

          <MiniStat
            label="Photos"
            value={stats.photos}
          />
        </View>
      </TouchableOpacity>

      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.smallAction}
          onPress={onPress}
        >
          <Text style={styles.smallActionText}>
            {actionLabel}
          </Text>
        </TouchableOpacity>

        {onClose ? (
          <TouchableOpacity
            style={[
              styles.smallAction,
              styles.smallActionDanger,
            ]}
            onPress={onClose}
          >
            <Text
              style={
                styles.smallActionDangerText
              }
            >
              Close
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function AddProjectCard({
  buttonLabel,
  placeholder,
  onAdd,
}: {
  buttonLabel: string;
  placeholder: string;
  onAdd: (projectName: string) => boolean;
}) {
  const [projectName, setProjectName] =
    useState('');

  function submit() {
    const added = onAdd(projectName);

    if (added) setProjectName('');
  }

  return (
    <View style={styles.addProjectCard}>
      <Text style={styles.panelTitle}>
        Add project manually
      </Text>

      <TextInput
        style={styles.input}
        value={projectName}
        onChangeText={setProjectName}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
      />

      <PrimaryButton
        label={buttonLabel}
        icon="checkmark-circle-outline"
        onPress={submit}
        disabled={!projectName.trim()}
      />
    </View>
  );
}

function ScreenTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.screenTitle}>
      <Text style={styles.title}>
        {title}
      </Text>

      <Text style={styles.subtitle}>
        {subtitle}
      </Text>
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
  compact,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.primaryButton,
        compact && styles.compactButton,
        disabled && styles.disabledButton,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.buttonContent}>
        {icon ? (
          <Ionicons
            name={icon}
            size={20}
            color="#FFFFFF"
          />
        ) : null}

        <Text
          style={styles.primaryButtonText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function MiniStat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <View
      style={[
        styles.miniStat,
        danger && styles.miniStatDanger,
      ]}
    >
      <Text
        style={[
          styles.miniStatValue,
          danger && styles.miniStatValueDanger,
        ]}
      >
        {value}
      </Text>

      <Text style={styles.miniStatLabel}>
        {label}
      </Text>
    </View>
  );
}

function EmptyState({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>
        {title}
      </Text>

      <Text style={styles.bodyText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  appFrame: {
    flex: 1,
  },

  screenTitle: {
    marginBottom: 12,
  },

  title: {
    color: colors.text,
    fontSize: 31,
    fontWeight: '800',
    lineHeight: 37,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 7,
    fontWeight: '500',
  },

  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 54,
    justifyContent: 'center',
  },

  compactButton: {
    flex: 1,
    minHeight: 64,
    marginBottom: 0,
  },

  disabledButton: {
    opacity: 0.45,
  },

  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    maxWidth: '100%',
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },

  panelTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },

  dashboardCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderColor: colors.line,
    borderWidth: 1,
  },

  dashboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },

  statsGrid: {
    flexDirection: 'row',
    gap: 8,
  },

  miniStat: {
    flex: 1,
    backgroundColor: colors.fill,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },

  miniStatDanger: {
    backgroundColor: colors.dangerSoft,
  },

  miniStatValue: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '800',
  },

  miniStatValueDanger: {
    color: colors.danger,
  },

  miniStatLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },

  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },

  smallAction: {
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },

  smallActionText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  smallActionDanger: {
    backgroundColor: colors.dangerSoft,
  },

  smallActionDangerText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
  },

  addProjectCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },

  rowMain: {
    flex: 1,
  },

  rowIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  projectName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },

  rowSub: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },

  emptyState: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },

  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },

  input: {
    minHeight: 46,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
});
