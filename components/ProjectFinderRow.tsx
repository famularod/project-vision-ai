import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { PIERuntimeState } from '../services/PIERuntime';
import type { ProjectStats } from '../types';
import { formatDisplayDate } from '../utils/date';
import type { ScheduleSummary } from '../utils/schedule';
import { colors, styles } from './ProjectDetailsCard';

function nextMilestoneLabel(summary: ScheduleSummary | undefined) {
  if (!summary || summary.totalItems === 0) return null;

  const milestone = summary.milestoneTasks.find(
    task =>
      !task.isCompleted &&
      task.daysUntilDue !== null &&
      task.daysUntilDue >= 0,
  );

  if (!milestone) return null;

  return `${milestone.title} (${milestone.dueLabel})`;
}

function confidenceLabel(level: 'low' | 'medium' | 'high') {
  if (level === 'high') return 'Strong';
  if (level === 'medium') return 'Usable';

  return 'Limited';
}

function healthLabel(status: PIERuntimeState['intelligence']['healthStatus']) {
  if (status === 'healthy') return 'Healthy';
  if (status === 'watch') return 'Watch';
  if (status === 'at-risk') return 'At Risk';

  return 'Unknown';
}

function runtimeHealthTone(
  status: PIERuntimeState['intelligence']['healthStatus'],
  archived: boolean,
) {
  if (archived) {
    return {
      label: 'Archived',
      detail: 'Stored',
      tone: 'neutral' as const,
    };
  }

  if (status === 'at-risk') {
    return {
      label: 'At Risk',
      detail: 'Needs attention',
      tone: 'danger' as const,
    };
  }

  if (status === 'watch') {
    return {
      label: 'Watch',
      detail: 'Watch closely',
      tone: 'warning' as const,
    };
  }

  if (status === 'healthy') {
    return {
      label: 'Healthy',
      detail: 'On track',
      tone: 'success' as const,
    };
  }

  return {
    label: 'Unknown',
    detail: 'Needs context',
    tone: 'neutral' as const,
  };
}

export function ProjectFinderRow({
  project,
  stats,
  scheduleSummary,
  runtime,
  archived,
  favorite,
  onPress,
  onUpdate,
  onFavorite,
  onRename,
  onClose,
  onRestore,
  onDelete,
}: {
  project: string;
  stats: ProjectStats;
  scheduleSummary?: ScheduleSummary;
  runtime: PIERuntimeState;
  archived: boolean;
  favorite: boolean;
  onPress: () => void;
  onUpdate?: () => void;
  onFavorite: () => void;
  onRename: () => void;
  onClose?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const nextMilestone = nextMilestoneLabel(scheduleSummary);
  const health = runtimeHealthTone(runtime.intelligence.healthStatus, archived);
  const primaryAction = onPress;
  const primaryLabel = 'Open Project';
  const secondaryAction = archived ? undefined : onUpdate;
  const location = runtime.intelligence.locationIntelligence;
  const currentMission =
    runtime.currentMission?.title ||
    runtime.nextMission?.toMission?.replace(/-/g, ' ') ||
    'Monitor project';
  const currentArea =
    location.currentArea ||
    'GPS not set';
  const gpsStatus = location.gpsStatus || 'GPS not available';
  const lastKnownLocation =
    location.lastKnownLocation &&
    location.lastKnownLocation !== 'Unknown'
      ? location.lastKnownLocation
      : 'Not available';
  const pieConfidence =
    `${runtime.intelligence.confidence.score}% ${confidenceLabel(runtime.overallConfidence)}`;
  const understanding =
    `${runtime.understandingScore.score}% ${confidenceLabel(runtime.understandingScore.level)}`;
  const nextBestAction =
    runtime.nextBestAction.title ||
    (archived ? 'Open project record' : 'Capture today\'s progress');
  const currentConcern =
    runtime.response.whatConcernsPIE ||
    (runtime.intelligence.healthStatus === 'healthy'
      ? 'No urgent concern from current evidence'
      : 'Capture more context for PIE');
  const pieHealth = healthLabel(runtime.intelligence.healthStatus);

  function runMoreAction(action: () => void) {
    setMoreOpen(false);
    action();
  }

  return (
    <View style={styles.projectFinderRow}>
      <TouchableOpacity
        style={styles.projectFinderMain}
        onPress={onPress}
      >
        <View style={styles.projectFinderHeader}>
          <View style={styles.rowMain}>
            <View style={styles.projectTitleRow}>
              <Text
                style={styles.projectFinderName}
                numberOfLines={2}
              >
                {project}
              </Text>

              {favorite ? (
                <Ionicons
                  name="star"
                  size={17}
                  color={colors.warning}
                />
              ) : null}
            </View>

            <Text style={styles.rowSub}>
              Mission: {currentMission} · Last update:{' '}
              {stats.lastUpdate
                ? formatDisplayDate(stats.lastUpdate)
                : 'No updates yet'}
            </Text>
          </View>

          <View
            style={[
              styles.projectHealthBadge,
              health.tone === 'danger' && styles.projectHealthBadgeDanger,
              health.tone === 'warning' && styles.projectHealthBadgeWarning,
              health.tone === 'success' && styles.projectHealthBadgeSuccess,
            ]}
          >
            <Text
              style={[
                styles.projectHealthText,
                health.tone === 'danger' && styles.projectHealthTextDanger,
                health.tone === 'warning' && styles.projectHealthTextWarning,
                health.tone === 'success' && styles.projectHealthTextSuccess,
              ]}
            >
              {health.label}
            </Text>
          </View>
        </View>

        <Text
          style={styles.projectMilestoneText}
          numberOfLines={2}
        >
          Next PIE Recommendation: {nextBestAction}
        </Text>

        <Text
          style={styles.projectMilestoneText}
          numberOfLines={2}
        >
          Current concern: {currentConcern}
        </Text>

        <View style={styles.projectSignalGrid}>
          <View style={styles.projectSignalItem}>
            <Text
              style={styles.projectSignalLabel}
              numberOfLines={1}
            >
              Area
            </Text>

            <Text
              style={styles.projectSignalValue}
              numberOfLines={1}
            >
              {currentArea}
            </Text>
          </View>

          <View style={styles.projectSignalItem}>
            <Text
              style={styles.projectSignalLabel}
              numberOfLines={1}
            >
              GPS
            </Text>

            <Text
              style={styles.projectSignalValue}
              numberOfLines={1}
            >
              {gpsStatus}
            </Text>
          </View>

          <View style={styles.projectSignalItem}>
            <Text
              style={styles.projectSignalLabel}
              numberOfLines={1}
            >
              Last Known
            </Text>

            <Text
              style={styles.projectSignalValue}
              numberOfLines={1}
            >
              {lastKnownLocation}
            </Text>
          </View>
        </View>

        <View style={styles.projectSignalGrid}>
          <View style={styles.projectSignalItem}>
            <Text
              style={styles.projectSignalLabel}
              numberOfLines={1}
            >
              Health
            </Text>

            <Text
              style={[
                styles.projectSignalValue,
                runtime.intelligence.healthStatus === 'at-risk' && styles.projectSignalDanger,
              ]}
              numberOfLines={1}
            >
              {pieHealth}
            </Text>
          </View>

          <View style={styles.projectSignalItem}>
            <Text
              style={styles.projectSignalLabel}
              numberOfLines={1}
            >
              PIE
            </Text>

            <Text
              style={styles.projectSignalValue}
              numberOfLines={1}
            >
              {pieConfidence}
            </Text>
          </View>

          <View style={styles.projectSignalItem}>
            <Text
              style={styles.projectSignalLabel}
              numberOfLines={1}
            >
              Understanding
            </Text>

            <Text
              style={styles.projectSignalValue}
              numberOfLines={1}
            >
              {understanding}
            </Text>
          </View>
        </View>

        {nextMilestone ? (
          <Text
            style={styles.projectMilestoneText}
            numberOfLines={2}
          >
            Next milestone: {nextMilestone}
          </Text>
        ) : null}
      </TouchableOpacity>

      <View style={styles.projectFinderActionPanel}>
        <View style={styles.projectFinderActions}>
          <TouchableOpacity
            style={styles.projectPrimaryAction}
            onPress={primaryAction}
          >
            <Text
              style={styles.projectPrimaryActionText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {primaryLabel}
            </Text>
          </TouchableOpacity>

          {secondaryAction ? (
            <TouchableOpacity
              style={styles.projectSecondaryAction}
              onPress={secondaryAction}
            >
              <Ionicons
                name="walk-outline"
                size={18}
                color={colors.primary}
              />

              <Text
                style={styles.projectSecondaryActionText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.84}
              >
                Walk
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.projectOverflowButton}
            onPress={() => setMoreOpen(open => !open)}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${project}`}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={19}
              color={colors.primary}
            />

            <Text style={styles.projectOverflowButtonText}>
              More
            </Text>
          </TouchableOpacity>
        </View>

        {moreOpen ? (
          <View style={styles.projectFinderOverflow}>
            <TouchableOpacity
              style={styles.smallAction}
              onPress={() => runMoreAction(onFavorite)}
            >
              <Text style={styles.smallActionText}>
                {favorite ? 'Unfavorite' : 'Favorite'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.smallAction}
              onPress={() => runMoreAction(onRename)}
            >
              <Text style={styles.smallActionText}>
                Rename
              </Text>
            </TouchableOpacity>

            {onClose ? (
              <TouchableOpacity
                style={styles.smallAction}
                onPress={() => runMoreAction(onClose)}
              >
                <Text style={styles.smallActionText}>
                  Archive
                </Text>
              </TouchableOpacity>
            ) : null}

            {onRestore ? (
              <TouchableOpacity
                style={styles.smallAction}
                onPress={() => runMoreAction(onRestore)}
              >
                <Text style={styles.smallActionText}>
                  Restore
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.smallAction, styles.smallActionDanger]}
              onPress={() => runMoreAction(onDelete)}
            >
              <Text style={styles.smallActionDangerText}>
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}
