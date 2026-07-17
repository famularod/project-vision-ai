import { buildDAVEReportBriefing } from '../../services/DAVEReportIntelligence';
import type { DAVEProjectTruth } from '../../services/DAVEProjectTruth';

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
      'Reported installation progress is supported',
    );
    expect(briefing.uncertainties).toEqual([]);
    expect(briefing.nextActions).toEqual([]);
    expect(briefing.schedulePosition).toEqual(['The inspection is due tomorrow.']);
    expect(JSON.stringify(briefing)).not.toMatch(/not verified|verification needed|missing evidence/i);
  });
});
