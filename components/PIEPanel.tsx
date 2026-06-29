import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ScreenCard } from './layout/ScreenCard';
import {
  type ProjectConfidenceLevel,
  type ProjectHealthStatus,
  type ProjectProgressStatus,
  type ProjectReportHistoryMetadata,
  type ProjectSyncFreshnessMetadata,
} from '../services/ProjectIntelligenceEngine';
import {
  buildRuntime,
  type PIERuntimeState,
} from '../services/PIERuntime';
import {
  colors,
  radius,
  spacing,
  typography,
} from '../theme';
import type {
  ContactBook,
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';

type IconName = keyof typeof Ionicons.glyphMap;

export type PIEPanelProps = {
  projectName?: string | null;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
  projectAreas?: ProjectArea[];
  contacts?: ContactBook;
  referenceDocuments?: ReferenceDocument[];
  reportHistory?: ProjectReportHistoryMetadata[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  title?: string;
  subtitle?: string;
  compact?: boolean;
};

type PIEPanelSection = {
  label: string;
  detail: string;
  icon: IconName;
  danger?: boolean;
};

export function PIEPanel({
  projectName,
  updates,
  scheduleItems,
  currentUpdate = null,
  projectAreas = [],
  contacts,
  referenceDocuments = [],
  reportHistory = [],
  syncMetadata = null,
  title = 'PIE Briefing',
  subtitle = 'Project Intelligence Engine',
  compact = false,
}: PIEPanelProps) {
  const resolvedProjectName =
    projectName?.trim() ||
    currentUpdate?.projectName.trim() ||
    'Selected Project';
  const runtime = useMemo(() => buildRuntime({
      projectName: resolvedProjectName,
      updates,
      scheduleItems,
      currentUpdate,
      projectAreas,
      contacts,
      referenceDocuments,
      reportHistory,
      syncMetadata,
    }),
    [
    contacts,
    currentUpdate,
    projectAreas,
    referenceDocuments,
    reportHistory,
    resolvedProjectName,
    scheduleItems,
    syncMetadata,
    updates,
  ]);
  const sections = buildPanelSections(runtime);

  return (
    <ScreenCard
      style={[
        styles.panel,
        compact && styles.compactPanel,
      ]}
      elevated={!compact}
    >
      <View style={styles.header}>
        <View style={styles.pieMark}>
          <Text style={styles.pieMarkText}>
            PIE
          </Text>
        </View>

        <View style={styles.headerText}>
          <Text style={styles.title}>
            {title}
          </Text>

          <Text style={styles.subtitle}>
            {subtitle}
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <InfoPill
          label="Confidence"
          value={`${runtime.intelligence.confidence.score}% ${confidenceLabel(runtime.overallConfidence)}`}
        />

        <InfoPill
          label="Trust"
          value={`${runtime.trustScore.overallScore}% ${confidenceLabel(runtime.trustScore.level)}`}
        />

        <InfoPill
          label="Understanding"
          value={`${runtime.understandingScore.score}% ${confidenceLabel(runtime.understandingScore.level)}`}
        />

        <InfoPill
          label="Last Analysis"
          value={formatGeneratedAt(runtime.generatedAt)}
        />
      </View>

      <View style={styles.sectionStack}>
        {sections.map(section => (
          <View
            key={section.label}
            style={styles.sectionRow}
          >
            <View
              style={[
                styles.sectionIcon,
                section.danger && styles.sectionIconDanger,
              ]}
            >
              <Ionicons
                name={section.icon}
                size={18}
                color={section.danger ? colors.danger : colors.primary}
              />
            </View>

            <View style={styles.sectionText}>
              <Text
                style={styles.sectionLabel}
                numberOfLines={1}
              >
                {section.label}
              </Text>

              <Text
                style={[
                  styles.sectionDetail,
                  section.danger && styles.sectionDetailDanger,
                ]}
                numberOfLines={compact ? 3 : undefined}
              >
                {section.detail}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.sourceRow}>
        <SourceTag text={`${runtime.evidence.length} evidence signals`} />
        <SourceTag text={`${runtime.projectEvents.length} events`} />
        <SourceTag text={`${runtime.unknowns.length} unknowns`} />
      </View>
    </ScreenCard>
  );
}

function buildPanelSections(runtime: PIERuntimeState): PIEPanelSection[] {
  return [
    {
      label: 'What I Know',
      icon: 'bulb-outline',
      detail: runtime.response.whatPIEKnows || [
        `${healthLabel(runtime.intelligence.healthStatus)} health`,
        `${progressLabel(runtime.intelligence.progressStatus)} progress`,
        `${runtime.intelligence.confidence.score}% confidence`,
        locationSummary(runtime.intelligence.locationIntelligence),
      ].join(' | '),
    },
    {
      label: 'What Changed',
      icon: 'git-branch-outline',
      detail: runtime.response.whatChanged,
    },
    {
      label: 'What Concerns Me',
      icon: 'alert-circle-outline',
      detail: runtime.response.whatConcernsPIE,
      danger:
        runtime.intelligence.healthStatus === 'at-risk' ||
        runtime.intelligence.riskSignals.some(risk => risk.severity === 'critical'),
    },
    {
      label: 'What I Recommend',
      icon: 'checkmark-circle-outline',
      detail: runtime.response.whatPIERecommends,
    },
    {
      label: 'What I Need From You',
      icon: 'hand-left-outline',
      detail: runtime.response.whatPIENeedsFromYou,
    },
  ];
}

function InfoPill({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoPill}>
      <Text
        style={styles.infoPillLabel}
        numberOfLines={1}
      >
        {label}
      </Text>

      <Text
        style={styles.infoPillValue}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function SourceTag({ text }: { text: string }) {
  return (
    <View style={styles.sourceTag}>
      <Text
        style={styles.sourceTagText}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

function healthLabel(status: ProjectHealthStatus) {
  if (status === 'healthy') return 'Healthy';
  if (status === 'watch') return 'Watch';
  if (status === 'at-risk') return 'At Risk';

  return 'Unknown';
}

function progressLabel(status: ProjectProgressStatus) {
  if (status === 'near-complete') return 'Near Complete';
  if (status === 'not-calculated') return 'Not Calculated';

  return status
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function confidenceLabel(level: ProjectConfidenceLevel) {
  if (level === 'high') return 'strong';
  if (level === 'medium') return 'usable';

  return 'limited';
}

function locationSummary(location: {
  currentArea: string | null;
  gpsStatus: string;
  confidenceScore: number;
}) {
  const area = location.currentArea || 'area not confirmed';

  return `${area}; ${location.gpsStatus}; ${location.confidenceScore}% location confidence`;
}

function formatGeneratedAt(value: string | null) {
  if (!value) return 'Not available';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Not available';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
  },

  compactPanel: {
    marginBottom: spacing.sm,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  pieMark: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },

  pieMarkText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '900',
  },

  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },

  title: {
    ...typography.h2,
    fontSize: 19,
    lineHeight: 24,
  },

  subtitle: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
  },

  metaRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },

  infoPill: {
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexGrow: 1,
    flexBasis: 132,
  },

  infoPillLabel: {
    ...typography.label,
    color: colors.tertiaryText,
  },

  infoPillValue: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },

  sectionStack: {
    gap: spacing.sm,
  },

  sectionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },

  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionIconDanger: {
    backgroundColor: colors.dangerSoft,
  },

  sectionText: {
    flex: 1,
    gap: spacing.xxs,
  },

  sectionLabel: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },

  sectionDetail: {
    ...typography.body,
    lineHeight: 20,
  },

  sectionDetailDanger: {
    color: colors.danger,
    fontWeight: '700',
  },

  sourceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  sourceTag: {
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },

  sourceTagText: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
});
