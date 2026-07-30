import {
  buildDAVEReportBriefing,
  buildDAVEReportSourceFingerprint,
} from '../../services/DAVEReportIntelligence';
import type { DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVEReportSnapshot,
  daveReportSnapshotScopeKey,
} from '../../services/DAVEReportSnapshot';

function projectTruth(): DAVEProjectTruth {
  return {
    projectName: '2321 Compliance Project',
    generatedAt: '2026-07-16T18:00:00.000Z',
    evidence: { total: 4, connected: 3, unresolved: 1, coveragePercent: 75 },
    briefing: {
      headline: 'Concrete placement is progressing.',
      currentReality: 'Reported installation progress is supported, but completion is not verified.',
      whatChanged: ['North Lot paving reached 60 percent complete.'],
      schedule: 'The inspection is due tomorrow.',
      risksAndConflicts: [],
      verificationNeeded: ['Verify final completion.'],
      nextActions: [],
      evidenceCoverage: 'Three records are connected.',
      confidence: 'medium',
    },
    verificationQueue: [{
      priority: 'high',
      title: 'Verify completion',
      requestedAction: 'Inspect the work.',
    }],
    schedule: [{
      taskId: 'north-lot',
      taskName: 'Place concrete paving',
      areaName: 'North Lot',
      status: 'In Progress',
      percentComplete: 60,
      urgency: 'due_soon',
    }],
    reasoning: {
      summary: 'Internal reasoning stays private.',
      uncertainties: ['Final completion is not verified.'],
      decisions: [],
      criticalDecisions: [],
    },
  } as unknown as DAVEProjectTruth;
}

describe('DAVE report intelligence', () => {
  it('publishes supported current state without verification-gap language', () => {
    const briefing = buildDAVEReportBriefing({ truths: [projectTruth()] });

    expect(briefing.projectConditions[0].currentReality).toBe(
      '0 of 1 tasks complete; 1 in progress.',
    );
    expect(briefing.currentWork).toEqual([
      'Place concrete paving (North Lot): In Progress; 60% complete.',
    ]);
    expect(briefing.nextActions).toHaveLength(1);
    expect(briefing.nextActions[0]).toMatchObject({
      taskName: 'Place concrete paving',
      action: 'Prepare the crew, materials, and access for Place concrete paving.',
      owner: 'Project manager',
      timing: 'Within 7 days',
      confidence: 'high',
    });
    expect(briefing.schedulePosition).toEqual(['1 due within 7 days.']);
    expect(briefing.dashboard.taskStatus).toMatchObject({
      total: 1,
      complete: 0,
      open: 1,
      inProgress: 1,
    });
    expect(JSON.stringify(briefing)).not.toMatch(/not verified|verification needed|missing evidence/i);
  });

  it('changes the report source only when semantic project facts change', () => {
    const first = projectTruth();
    const refreshOnly = {
      ...first,
      generatedAt: '2026-07-16T18:05:00.000Z',
      schedule: [...first.schedule].reverse(),
    } as DAVEProjectTruth;
    const changed = {
      ...first,
      generatedAt: '2026-07-16T18:05:00.000Z',
      schedule: first.schedule.map(task => ({
        ...task,
        status: 'Complete',
        percentComplete: 100,
      })),
    } as DAVEProjectTruth;

    expect(buildDAVEReportSourceFingerprint([refreshOnly])).toBe(
      buildDAVEReportSourceFingerprint([first]),
    );
    expect(buildDAVEReportSourceFingerprint([changed])).not.toBe(
      buildDAVEReportSourceFingerprint([first]),
    );
  });

  it('uses the PM-authored next action instead of generating generic coordination work', () => {
    const truth = projectTruth();
    const briefing = buildDAVEReportBriefing({
      truths: [{
        ...truth,
        schedule: truth.schedule.map(task => ({
          ...task,
          nextAction: 'Confirm the paving crew start time with the superintendent.',
        })),
      } as DAVEProjectTruth],
    });

    expect(briefing.nextActions[0]).toMatchObject({
      action: 'Confirm the paving crew start time with the superintendent.',
      smallestNextAction: 'Confirm the paving crew start time with the superintendent.',
    });
  });

  it('surfaces accountable controls, milestones, and schedule impact as management facts', () => {
    const truth = projectTruth();
    const briefing = buildDAVEReportBriefing({
      truths: [{
        ...truth,
        schedule: truth.schedule.map(task => ({
          ...task,
          owner: 'David',
          assignee: 'North Lot crew',
          isMilestone: true,
          approvalStatus: 'Pending',
          responseDueDate: '2026-07-17',
          checklistTotal: 4,
          checklistComplete: 2,
          estimatedScheduleImpactDays: 3,
          impactConfidence: 'high',
          impactNotes: 'Inspection access may move the paving finish.',
        })),
      } as DAVEProjectTruth],
    });

    expect(briefing.dashboard.controls).toMatchObject({
      pendingApprovals: 1,
      responsesDue: 1,
      incompleteChecklistItems: 2,
      scheduleImpactItems: 1,
      totalEstimatedScheduleImpactDays: 3,
    });
    expect(briefing.milestones).toEqual([
      expect.objectContaining({
        taskName: 'Place concrete paving',
        state: 'due_soon',
      }),
    ]);
    expect(briefing.nextActions[0]).toMatchObject({
      owner: 'North Lot crew',
      impact: 'Inspection access may move the paving finish.',
      scheduleImpactDays: 3,
    });
  });

  it('reports movement since the previous approved report instead of repeating current state', () => {
    const previousTruth = projectTruth();
    const previousSnapshot = buildDAVEReportSnapshot({
      truths: [previousTruth],
      scopeKey: daveReportSnapshotScopeKey([previousTruth.projectName]),
      sourceFingerprint: 'previous',
      capturedAt: '2026-07-09T15:00:00.000Z',
    });
    const currentTruth = {
      ...previousTruth,
      schedule: previousTruth.schedule.map(task => ({
        ...task,
        percentComplete: 80,
      })),
    } as DAVEProjectTruth;

    const briefing = buildDAVEReportBriefing({
      truths: [currentTruth],
      previousSnapshot,
    });

    expect(briefing.reportingPeriod).toMatchObject({
      basis: 'previous_approved_report',
      startedAt: '2026-07-09T15:00:00.000Z',
      completeDelta: 0,
      openDelta: 0,
    });
    expect(briefing.recentChanges).toEqual([
      expect.objectContaining({
        source: 'approved_report_comparison',
        summary: '2321 Compliance Project: Place concrete paving moved from 60% to 80% complete.',
      }),
    ]);
  });
});
