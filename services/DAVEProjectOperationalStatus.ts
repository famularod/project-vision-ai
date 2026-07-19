import type {
  DAVEProjectScheduleHealth,
} from './dave-project-schedule-rollup';
import type { ScheduleItem } from '../types';
import { scheduleProjectScopeNames } from './PIEScheduleImportBatch';
import type {
  PIEScheduleReconciliationWarning,
  PIEScheduleReconciliationWarningType,
} from './PIEScheduleReconciliation';

export type DAVEProjectOperationalStatusName =
  | 'Healthy'
  | 'Needs Setup'
  | 'At Risk'
  | 'Blocked';

export type DAVEProjectOperationalStatus = Readonly<{
  status: DAVEProjectOperationalStatusName;
  priorityRank: number;
  needsVerification: boolean;
  scheduleStatus: DAVEProjectScheduleHealth;
  reason: string;
  primaryWarning: PIEScheduleReconciliationWarning | null;
}>;

export type DeriveDAVEProjectOperationalStatusInput = Readonly<{
  scheduleHealth: DAVEProjectScheduleHealth;
  scheduleReason?: string | null;
  reconciliationWarnings?: readonly PIEScheduleReconciliationWarning[];
  hasConfirmedBlocker?: boolean;
  confirmedBlockerReason?: string | null;
  hasAttention?: boolean;
  attentionReason?: string | null;
  hasScheduleData?: boolean;
  hasFieldData?: boolean;
}>;

const ACTIONABLE_WARNING_TYPES = new Set<PIEScheduleReconciliationWarningType>([
  'schedule_status_conflict',
  'field_progress_not_reflected',
  'field_issue_threatens_schedule',
]);

const WARNING_SEVERITY_RANK: Record<PIEScheduleReconciliationWarning['severity'], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const OPERATIONAL_PRIORITY_RANK = {
  healthy: 0,
  needsSetup: 50,
  attention: 100,
  scheduleRisk: 200,
  verificationLow: 250,
  verificationMedium: 300,
  verificationHigh: 400,
  verificationCritical: 500,
  blocked: 600,
} as const;

export function operationalScheduleItemsForProject(
  projectName: string,
  scheduleItems: ScheduleItem[],
) {
  const normalizedProject = projectName.trim().toLowerCase();
  const normalizedScopes = new Set(
    scheduleProjectScopeNames(projectName, scheduleItems)
      .map(scope => scope.trim().toLowerCase()),
  );

  return scheduleItems.filter(item =>
    item.scheduleProjectName?.trim().toLowerCase() === normalizedProject ||
    normalizedScopes.has(item.projectName.trim().toLowerCase()) ||
    normalizedScopes.has(item.locationName.trim().toLowerCase()),
  );
}

/**
 * Derives one canonical project-level operational status without treating an
 * evidence conflict as proof that work is blocked.
 */
export function deriveDAVEProjectOperationalStatus(
  input: DeriveDAVEProjectOperationalStatusInput,
): DAVEProjectOperationalStatus {
  const actionableWarnings = (input.reconciliationWarnings ?? []).filter(
    warning => ACTIONABLE_WARNING_TYPES.has(warning.type),
  );
  const primaryWarning = highestSeverityWarning(actionableWarnings);
  const needsVerification = primaryWarning !== null;

  if (input.hasConfirmedBlocker) {
    return result({
      status: 'Blocked',
      priorityRank: OPERATIONAL_PRIORITY_RANK.blocked,
      input,
      needsVerification,
      primaryWarning,
      reason: cleanReason(input.confirmedBlockerReason) ||
        'A confirmed blocker prevents this project from advancing.',
    });
  }

  if (input.scheduleHealth === 'Blocked') {
    return result({
      status: 'Blocked',
      priorityRank: OPERATIONAL_PRIORITY_RANK.blocked,
      input,
      needsVerification,
      primaryWarning,
      reason: cleanReason(input.scheduleReason) ||
        'One or more schedule activities are blocked or waiting.',
    });
  }

  if (primaryWarning) {
    return result({
      status: 'At Risk',
      priorityRank: verificationPriorityRank(primaryWarning.severity),
      input,
      needsVerification: true,
      primaryWarning,
      reason: cleanReason(primaryWarning.suggestedAction) ||
        cleanReason(primaryWarning.summary) ||
        'Schedule and field evidence need verification.',
    });
  }

  if (input.scheduleHealth === 'At Risk') {
    return result({
      status: 'At Risk',
      priorityRank: OPERATIONAL_PRIORITY_RANK.scheduleRisk,
      input,
      needsVerification: false,
      primaryWarning: null,
      reason: cleanReason(input.scheduleReason) ||
        'Schedule timing needs attention.',
    });
  }

  if (input.hasAttention) {
    return result({
      status: 'At Risk',
      priorityRank: OPERATIONAL_PRIORITY_RANK.attention,
      input,
      needsVerification: false,
      primaryWarning: null,
      reason: cleanReason(input.attentionReason) ||
        'A nonblocking project item needs attention.',
    });
  }

  if (input.hasScheduleData === false && input.hasFieldData === false) {
    return result({
      status: 'Needs Setup',
      priorityRank: OPERATIONAL_PRIORITY_RANK.needsSetup,
      input,
      needsVerification: false,
      primaryWarning: null,
      reason: 'Add a schedule or field update before relying on project health.',
    });
  }

  return result({
    status: 'Healthy',
    priorityRank: OPERATIONAL_PRIORITY_RANK.healthy,
    input,
    needsVerification: false,
    primaryWarning: null,
    reason: cleanReason(input.scheduleReason) ||
      'No current blocker, schedule risk, or attention item is recorded.',
  });
}

function highestSeverityWarning(
  warnings: readonly PIEScheduleReconciliationWarning[],
) {
  return warnings.reduce<PIEScheduleReconciliationWarning | null>(
    (highest, warning) => {
      if (!highest) return warning;
      return WARNING_SEVERITY_RANK[warning.severity] >
        WARNING_SEVERITY_RANK[highest.severity]
        ? warning
        : highest;
    },
    null,
  );
}

function verificationPriorityRank(
  severity: PIEScheduleReconciliationWarning['severity'],
) {
  if (severity === 'critical') return OPERATIONAL_PRIORITY_RANK.verificationCritical;
  if (severity === 'high') return OPERATIONAL_PRIORITY_RANK.verificationHigh;
  if (severity === 'medium') return OPERATIONAL_PRIORITY_RANK.verificationMedium;
  return OPERATIONAL_PRIORITY_RANK.verificationLow;
}

function result({
  status,
  priorityRank,
  input,
  needsVerification,
  reason,
  primaryWarning,
}: {
  status: DAVEProjectOperationalStatusName;
  priorityRank: number;
  input: DeriveDAVEProjectOperationalStatusInput;
  needsVerification: boolean;
  reason: string;
  primaryWarning: PIEScheduleReconciliationWarning | null;
}): DAVEProjectOperationalStatus {
  return Object.freeze({
    status,
    priorityRank,
    needsVerification,
    scheduleStatus: input.scheduleHealth,
    reason,
    primaryWarning,
  });
}

function cleanReason(value: string | null | undefined) {
  return value?.trim() || null;
}
