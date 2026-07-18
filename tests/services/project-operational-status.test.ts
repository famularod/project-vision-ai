import {
  deriveDAVEProjectOperationalStatus,
} from '../../services/DAVEProjectOperationalStatus';
import type {
  PIEScheduleReconciliationWarning,
} from '../../services/PIEScheduleReconciliation';

function warning(
  overrides: Partial<PIEScheduleReconciliationWarning> = {},
): PIEScheduleReconciliationWarning {
  return {
    id: 'warning-1',
    type: 'schedule_status_conflict',
    scheduleItemId: 'task-1',
    updateId: 'update-1',
    projectName: '2375 Compliance Project',
    areaName: 'Canopy A',
    taskName: 'Install wall packs',
    title: 'Field evidence conflicts with schedule status',
    summary: 'The schedule says Complete while field evidence says work is in progress.',
    severity: 'high',
    confidence: 'high',
    suggestedAction: 'Verify the field condition.',
    evidenceIds: ['schedule:task-1', 'update:update-1'],
    ...overrides,
  };
}

describe('deriveDAVEProjectOperationalStatus', () => {
  it('returns Healthy when no blocker, risk, warning, or attention exists', () => {
    expect(deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      scheduleReason: 'No incomplete tasks are overdue or due within 7 days.',
    })).toEqual({
      status: 'Healthy',
      priorityRank: 0,
      needsVerification: false,
      scheduleStatus: 'On Track',
      reason: 'No incomplete tasks are overdue or due within 7 days.',
      primaryWarning: null,
    });
  });

  it('treats a confirmed blocker as Blocked', () => {
    const result = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      hasConfirmedBlocker: true,
      confirmedBlockerReason: 'Access is closed by a confirmed safety restriction.',
    });

    expect(result.status).toBe('Blocked');
    expect(result.priorityRank).toBe(600);
    expect(result.reason).toBe('Access is closed by a confirmed safety restriction.');
  });

  it('treats a blocked or waiting schedule as Blocked', () => {
    const result = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'Blocked',
      scheduleReason: 'One task is waiting and cannot advance.',
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'Blocked',
      priorityRank: 600,
      scheduleStatus: 'Blocked',
      reason: 'One task is waiting and cannot advance.',
    }));
  });

  it('keeps an actionable evidence conflict at At Risk pending verification', () => {
    const primaryWarning = warning({ severity: 'critical' });
    const result = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      reconciliationWarnings: [primaryWarning],
    });

    expect(result).toEqual({
      status: 'At Risk',
      priorityRank: 500,
      needsVerification: true,
      scheduleStatus: 'On Track',
      reason: 'Verify the field condition.',
      primaryWarning,
    });
  });

  it('does not let a verification conflict downgrade an actual blocker', () => {
    const result = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      hasConfirmedBlocker: true,
      confirmedBlockerReason: 'A confirmed blocker prevents installation.',
      reconciliationWarnings: [warning({ severity: 'critical' })],
    });

    expect(result.status).toBe('Blocked');
    expect(result.priorityRank).toBe(600);
    expect(result.needsVerification).toBe(true);
    expect(result.primaryWarning?.severity).toBe('critical');
  });

  it('treats due or overdue schedule health as At Risk', () => {
    const result = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'At Risk',
      scheduleReason: 'Two incomplete tasks are due within 7 days.',
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'At Risk',
      priorityRank: 200,
      needsVerification: false,
      reason: 'Two incomplete tasks are due within 7 days.',
    }));
  });

  it('treats nonblocking attention as At Risk', () => {
    const result = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      hasAttention: true,
      attentionReason: 'An owner follow-up is open.',
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'At Risk',
      priorityRank: 100,
      needsVerification: false,
      reason: 'An owner follow-up is open.',
    }));
  });

  it('selects the highest-severity actionable warning instead of the first warning', () => {
    const medium = warning({
      id: 'warning-medium',
      severity: 'medium',
      suggestedAction: 'Review medium warning.',
    });
    const critical = warning({
      id: 'warning-critical',
      type: 'field_issue_threatens_schedule',
      severity: 'critical',
      suggestedAction: 'Resolve critical warning.',
    });
    const high = warning({
      id: 'warning-high',
      severity: 'high',
      suggestedAction: 'Review high warning.',
    });

    const result = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      reconciliationWarnings: [medium, critical, high],
    });

    expect(result.primaryWarning).toBe(critical);
    expect(result.reason).toBe('Resolve critical warning.');
    expect(result.priorityRank).toBe(500);
  });

  it('does not turn an internal mapping warning into a verified operational risk', () => {
    const result = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      reconciliationWarnings: [warning({
        type: 'schedule_mapping_incomplete',
        severity: 'critical',
      })],
    });

    expect(result.status).toBe('Healthy');
    expect(result.priorityRank).toBe(0);
    expect(result.needsVerification).toBe(false);
    expect(result.primaryWarning).toBeNull();
  });

  it('ranks operational states in deterministic priority order', () => {
    const blocked = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      hasConfirmedBlocker: true,
    });
    const criticalVerification = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      reconciliationWarnings: [warning({ severity: 'critical' })],
    });
    const highVerification = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      reconciliationWarnings: [warning({ severity: 'high' })],
    });
    const mediumVerification = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      reconciliationWarnings: [warning({ severity: 'medium' })],
    });
    const scheduleRisk = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'At Risk',
    });
    const attention = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      hasAttention: true,
    });
    const healthy = deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
    });

    expect([
      blocked,
      criticalVerification,
      highVerification,
      mediumVerification,
      scheduleRisk,
      attention,
      healthy,
    ].map(result => result.priorityRank)).toEqual([
      600,
      500,
      400,
      300,
      200,
      100,
      0,
    ]);
  });

  it('returns Needs Setup when schedule and field data are explicitly absent', () => {
    expect(deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      hasScheduleData: false,
      hasFieldData: false,
    })).toEqual({
      status: 'Needs Setup',
      priorityRank: 50,
      needsVerification: false,
      scheduleStatus: 'On Track',
      reason: 'Add a schedule or field update before relying on project health.',
      primaryWarning: null,
    });
  });

  it('does not return Needs Setup when either evidence source is present', () => {
    expect(deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      hasScheduleData: true,
      hasFieldData: false,
    }).status).toBe('Healthy');
    expect(deriveDAVEProjectOperationalStatus({
      scheduleHealth: 'On Track',
      hasScheduleData: false,
      hasFieldData: true,
    }).status).toBe('Healthy');
  });
});
