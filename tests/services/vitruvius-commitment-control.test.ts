import { buildVitruviusCommitmentControl } from '../../services/VitruviusCommitmentControl';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const NOW = new Date('2026-07-29T16:00:00.000Z');

function task(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'task-1',
    scheduleProjectName: '2321 Compliance Project',
    projectName: '2321 Compliance Project',
    locationName: 'North Lot',
    taskName: 'Place asphalt',
    startDate: '2026-07-27',
    finishDate: '2026-08-03',
    milestone: '',
    owner: 'David',
    contractor: '',
    percentComplete: 25,
    priority: 'High',
    status: 'In Progress',
    notes: '',
    createdAt: '2026-07-20T16:00:00.000Z',
    ...overrides,
  };
}

function update(overrides: Partial<ProjectUpdate> = {}): ProjectUpdate {
  return {
    id: 'update-1',
    projectName: '2321 Compliance Project',
    date: '2026-07-28T16:00:00.000Z',
    photos: [],
    notes: 'Paving equipment is staged.',
    recipients: { contactIds: [] },
    scheduleItemId: 'task-1',
    ...overrides,
  };
}

describe('Vitruvius commitment control', () => {
  it('uses saved PM ownership, dates, and next actions for the current focus', () => {
    const result = buildVitruviusCommitmentControl({
      scheduleItems: [task({
        nextAction: 'Confirm the paving crew start time.',
        projectControls: {
          version: 1,
          assignee: 'Alex',
          trade: '',
          watchers: [],
          approvers: [],
          approvalStatus: 'Not Required',
          workflowStage: 'Open',
          referenceNumber: '',
          responseDueDate: '2026-07-31',
          checklist: [],
          linkedRecords: [],
          resources: [],
          estimatedCostImpact: null,
          estimatedScheduleImpactDays: null,
          impactConfidence: 'Medium',
          impactNotes: '',
          revision: 1,
          updatedAt: '2026-07-28T16:00:00.000Z',
          updatedBy: 'David',
        },
      })],
      updates: [update()],
      now: NOW,
    });

    expect(result.topItem).toMatchObject({
      taskName: 'Place asphalt',
      areaName: 'North Lot',
      owner: 'Alex',
      dueDate: '2026-07-31',
      state: 'at_risk',
      recoveryAction: 'Confirm the paving crew start time.',
      proofNeeded: 'Confirm that the latest field update still reflects the current condition.',
    });
  });

  it('does not let ordinary photo or note updates override the PM task status', () => {
    const result = buildVitruviusCommitmentControl({
      scheduleItems: [task({ finishDate: '2026-08-20' })],
      updates: [update({ notes: 'The work looks complete in the photo.' })],
      now: NOW,
    });

    expect(result.topItem?.state).toBe('promised');
    expect(result.needsVerification).toBe(0);
  });

  it('elevates only an explicit saved completion claim for PM verification', () => {
    const result = buildVitruviusCommitmentControl({
      scheduleItems: [
        task({
          status: 'Complete',
          percentComplete: 100,
          completionVerification: {
            status: 'conflicting_evidence',
            reportedAt: '2026-07-28T16:00:00.000Z',
            reportedBy: 'Field report',
            priorScheduleStatus: 'In Progress',
            priorPercentComplete: 25,
            verifiedAt: null,
            verifiedBy: null,
            verificationNote: null,
            evidence: [{
              id: 'evidence-1',
              kind: 'photo',
              sourceRecordId: 'update-1',
              sourceName: 'Field photo',
              summary: 'Completion claim requires review.',
              recordedAt: '2026-07-28T16:00:00.000Z',
            }],
          },
        }),
      ],
      updates: [update()],
      now: NOW,
    });

    expect(result.topItem).toMatchObject({
      state: 'needs_verification',
      decisionNeeded: 'Confirm whether the saved task status is correct.',
      proofNeeded: 'Review the linked completion claim and record the PM decision.',
    });
  });

  it('puts overdue commitments ahead of upcoming open work', () => {
    const result = buildVitruviusCommitmentControl({
      scheduleItems: [
        task({ id: 'future', taskName: 'Future task', finishDate: '2026-08-20' }),
        task({ id: 'late', taskName: 'Late task', finishDate: '2026-07-25' }),
      ],
      updates: [],
      now: NOW,
    });

    expect(result.topItem?.taskName).toBe('Late task');
    expect(result.missed).toBe(1);
    expect(result.promised).toBe(1);
  });

  it('reports complete PM task records as verified without creating an alert', () => {
    const result = buildVitruviusCommitmentControl({
      scheduleItems: [task({ status: 'Complete', percentComplete: 100 })],
      updates: [],
      now: NOW,
    });

    expect(result.verified).toBe(1);
    expect(result.actionableItems).toHaveLength(0);
    expect(result.topItem).toBeNull();
  });

  it('filters the shared model to the selected parent project', () => {
    const result = buildVitruviusCommitmentControl({
      scheduleItems: [
        task(),
        task({
          id: 'task-2',
          scheduleProjectName: '2375 Compliance Project',
          projectName: '2375 Compliance Project',
        }),
      ],
      updates: [],
      projectNames: ['2375 Compliance Project'],
      now: NOW,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].projectName).toBe('2375 Compliance Project');
  });
});
