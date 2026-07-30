import {
  buildVitruviusPortfolioImpact,
  createProjectControlChecklistItem,
  emptyProjectControls,
  mergeProjectControlsRevisions,
  normalizeProjectControls,
  projectControlReadiness,
  reviseProjectControls,
  setProjectControlChecklistCompletion,
} from '../../services/VitruviusProjectControls';
import {
  closeProjectItemWorkflow,
  reopenProjectItemWorkflow,
} from '../../services/ProjectItemWorkflow';
import type { ProjectControls, ScheduleItem } from '../../types';

const NOW = '2026-07-26T18:00:00.000Z';

function controls(overrides: Partial<ProjectControls> = {}): ProjectControls {
  return {
    ...emptyProjectControls(),
    assignee: 'David',
    trade: 'General contractor',
    referenceNumber: 'ISSUE-101',
    responseDueDate: '2026-07-30',
    revision: 2,
    updatedAt: '2026-07-25T18:00:00.000Z',
    updatedBy: 'David',
    ...overrides,
  };
}

function scheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'item-1',
    itemType: 'Issue',
    projectName: '2375 Compliance Project',
    scheduleProjectName: '2375 Compliance Project',
    locationName: 'Canopy C',
    taskName: 'Resolve field condition',
    startDate: '2026-07-26',
    finishDate: '2026-07-30',
    milestone: '',
    owner: 'David',
    contractor: 'General contractor',
    percentComplete: 50,
    priority: 'High',
    status: 'In Progress',
    notes: 'The field outcome is recorded.',
    nextAction: 'Confirm the correction.',
    activity: [],
    projectControls: controls(),
    createdAt: '2026-07-25T17:00:00.000Z',
    updatedAt: '2026-07-25T18:00:00.000Z',
    ...overrides,
  };
}

describe('Vitruvius project controls', () => {
  describe('defaults and normalization', () => {
    it('creates a complete independent default control record', () => {
      const first = emptyProjectControls();
      const second = emptyProjectControls();

      expect(first).toEqual({
        version: 1,
        assignee: '',
        trade: '',
        watchers: [],
        approvers: [],
        approvalStatus: 'Not Required',
        workflowStage: 'Open',
        referenceNumber: '',
        responseDueDate: '',
        checklist: [],
        linkedRecords: [],
        resources: [],
        estimatedCostImpact: null,
        estimatedScheduleImpactDays: null,
        impactConfidence: 'Medium',
        impactNotes: '',
        revision: 0,
        updatedAt: null,
        updatedBy: null,
      });
      expect(first).not.toBe(second);
      expect(first.watchers).not.toBe(second.watchers);
      expect(first.checklist).not.toBe(second.checklist);
    });

    it('normalizes malformed persisted controls without mutating their source', () => {
      const source = {
        version: 99,
        assignee: '  David  ',
        trade: '  Electrical  ',
        watchers: [' PM ', '', 'PM', 22, 'Owner'],
        approvers: [' Inspector ', 'Inspector'],
        approvalStatus: 'Maybe',
        workflowStage: 'Archived',
        referenceNumber: ' RFI-24 ',
        responseDueDate: ' 2026-08-01 ',
        checklist: [
          {
            id: ' check-1 ',
            label: ' Verify installation ',
            completed: true,
            completedAt: ' 2026-07-26T16:00:00.000Z ',
            completedBy: ' David ',
          },
          { id: 'check-1', label: 'Duplicate', completed: false },
          { id: '', label: 'Missing ID', completed: false },
          null,
        ],
        linkedRecords: [
          {
            id: ' drawing-1 ',
            label: ' Plan detail ',
            kind: 'Blueprint',
            revision: ' A ',
          },
          { id: 'drawing-1', label: 'Duplicate', kind: 'Photo' },
          { id: 'photo-1', label: ' Field photo ', kind: 'Photo' },
        ],
        resources: [
          {
            id: ' crew-1 ',
            name: ' Electrical crew ',
            kind: 'Team',
            allocationPercent: 120,
          },
          {
            id: 'lift-1',
            name: ' Lift ',
            kind: 'Equipment',
            allocationPercent: -5,
          },
          { id: 'crew-1', name: 'Duplicate', kind: 'Crew' },
        ],
        estimatedCostImpact: -100,
        estimatedScheduleImpactDays: 'not-a-number',
        impactConfidence: 'Certain',
        impactNotes: '  Awaiting pricing. ',
        revision: 2.6,
        updatedAt: ' 2026-07-26T17:00:00.000Z ',
        updatedBy: ' PM ',
      };
      const snapshot = JSON.parse(JSON.stringify(source));

      expect(normalizeProjectControls(source)).toEqual({
        version: 1,
        assignee: 'David',
        trade: 'Electrical',
        watchers: ['PM', 'Owner'],
        approvers: ['Inspector'],
        approvalStatus: 'Not Required',
        workflowStage: 'Open',
        referenceNumber: 'RFI-24',
        responseDueDate: '2026-08-01',
        checklist: [{
          id: 'check-1',
          label: 'Verify installation',
          completed: true,
          completedAt: '2026-07-26T16:00:00.000Z',
          completedBy: 'David',
        }],
        linkedRecords: [
          {
            id: 'drawing-1',
            label: 'Plan detail',
            kind: 'Document',
            revision: 'A',
          },
          {
            id: 'photo-1',
            label: 'Field photo',
            kind: 'Photo',
            revision: null,
          },
        ],
        resources: [
          {
            id: 'crew-1',
            name: 'Electrical crew',
            kind: 'Person',
            allocationPercent: 100,
          },
          {
            id: 'lift-1',
            name: 'Lift',
            kind: 'Equipment',
            allocationPercent: 0,
          },
        ],
        estimatedCostImpact: 0,
        estimatedScheduleImpactDays: null,
        impactConfidence: 'Medium',
        impactNotes: 'Awaiting pricing.',
        revision: 3,
        updatedAt: '2026-07-26T17:00:00.000Z',
        updatedBy: 'PM',
      });
      expect(source).toEqual(snapshot);
    });

    it('preserves every supported status, link kind, resource kind, and impact value', () => {
      expect(normalizeProjectControls({
        approvalStatus: 'Changes Requested',
        workflowStage: 'Waiting on Response',
        impactConfidence: 'High',
        estimatedCostImpact: '1250.50',
        estimatedScheduleImpactDays: 4,
        linkedRecords: [
          { id: '1', label: 'Detail', kind: 'Drawing' },
          { id: '2', label: 'Permit', kind: 'Document' },
          { id: '3', label: 'Photo', kind: 'Photo' },
          { id: '4', label: 'Lookahead', kind: 'Schedule' },
        ],
        resources: [
          { id: '1', name: 'David', kind: 'Person', allocationPercent: 25 },
          { id: '2', name: 'Crew 1', kind: 'Crew', allocationPercent: 50 },
          { id: '3', name: 'Trade partner', kind: 'Company', allocationPercent: 75 },
          { id: '4', name: 'Lift', kind: 'Equipment', allocationPercent: 100 },
        ],
      })).toMatchObject({
        approvalStatus: 'Changes Requested',
        workflowStage: 'Waiting on Response',
        impactConfidence: 'High',
        estimatedCostImpact: 1250.5,
        estimatedScheduleImpactDays: 4,
        linkedRecords: [
          expect.objectContaining({ kind: 'Drawing' }),
          expect.objectContaining({ kind: 'Document' }),
          expect.objectContaining({ kind: 'Photo' }),
          expect.objectContaining({ kind: 'Schedule' }),
        ],
        resources: [
          expect.objectContaining({ kind: 'Person', allocationPercent: 25 }),
          expect.objectContaining({ kind: 'Crew', allocationPercent: 50 }),
          expect.objectContaining({ kind: 'Company', allocationPercent: 75 }),
          expect.objectContaining({ kind: 'Equipment', allocationPercent: 100 }),
        ],
      });
    });
  });

  describe('revision and checklist audit history', () => {
    it('increments a normalized revision, applies the patch, and stamps its author', () => {
      const current = controls({
        watchers: ['Owner'],
        revision: 2,
      });
      const snapshot = JSON.parse(JSON.stringify(current));
      const revised = reviseProjectControls({
        current,
        patch: {
          assignee: ' David ',
          trade: ' General contractor ',
          watchers: ['Owner', 'Inspector', 'Inspector'],
          approvalStatus: 'Pending',
        },
        actor: ' PM ',
        now: NOW,
      });

      expect(revised).toMatchObject({
        assignee: ' David ',
        trade: ' General contractor ',
        watchers: ['Owner', 'Inspector'],
        approvalStatus: 'Pending',
        revision: 3,
        updatedAt: NOW,
        updatedBy: 'PM',
      });
      expect(revised.fieldRevisions).toEqual(expect.objectContaining({
        assignee: {
          revision: 1,
          updatedAt: NOW,
          updatedBy: 'PM',
        },
        trade: {
          revision: 1,
          updatedAt: NOW,
          updatedBy: 'PM',
        },
        watchers: {
          revision: 1,
          updatedAt: NOW,
          updatedBy: 'PM',
        },
        approvalStatus: {
          revision: 1,
          updatedAt: NOW,
          updatedBy: 'PM',
        },
      }));
      expect(current).toEqual(snapshot);
      expect(revised).not.toBe(current);
    });

    it('uses a PM fallback actor while preserving text exactly during editing', () => {
      const revised = reviseProjectControls({
        current: null,
        patch: {
          referenceNumber: ' RFI  24 ',
          impactNotes: ' Awaiting  a response ',
        },
        actor: ' ',
        now: NOW,
      });

      expect(revised.referenceNumber).toBe(' RFI  24 ');
      expect(revised.impactNotes).toBe(' Awaiting  a response ');
      expect(revised.updatedBy).toBe('Project manager');
      expect(revised.revision).toBe(1);
    });

    it('uses revision and actor as deterministic tie-breaks for identical field times', () => {
      const higherRevision = controls({
        assignee: 'Phone owner',
        revision: 8,
        updatedAt: NOW,
        updatedBy: 'David on iPhone',
        fieldRevisions: {
          assignee: {
            revision: 8,
            updatedAt: NOW,
            updatedBy: 'David on iPhone',
          },
        },
      });
      const lowerRevision = controls({
        assignee: 'Tablet owner',
        revision: 2,
        updatedAt: NOW,
        updatedBy: 'David on iPad',
        fieldRevisions: {
          assignee: {
            revision: 2,
            updatedAt: NOW,
            updatedBy: 'David on iPad',
          },
        },
      });

      const localFirst = mergeProjectControlsRevisions(
        higherRevision,
        lowerRevision,
      );
      const cloudFirst = mergeProjectControlsRevisions(
        lowerRevision,
        higherRevision,
      );

      expect(localFirst.assignee).toBe('Phone owner');
      expect(cloudFirst.assignee).toBe('Phone owner');
      expect(localFirst.fieldRevisions?.assignee).toEqual({
        revision: 8,
        updatedAt: NOW,
        updatedBy: 'David on iPhone',
      });
      expect(cloudFirst).toEqual(localFirst);
    });

    it('creates only meaningful checklist records', () => {
      expect(createProjectControlChecklistItem({
        id: ' check-1 ',
        label: ' Verify installation ',
      })).toEqual({
        id: 'check-1',
        label: 'Verify installation',
        completed: false,
        completedAt: null,
        completedBy: null,
      });
      expect(createProjectControlChecklistItem({
        id: '',
        label: 'Verify installation',
      })).toBeNull();
      expect(createProjectControlChecklistItem({
        id: 'check-1',
        label: ' ',
      })).toBeNull();
    });

    it('completes and reopens one checklist record without mutating the source', () => {
      const source = [
        {
          id: 'check-1',
          label: 'Verify installation',
          completed: false,
          completedAt: null,
          completedBy: null,
        },
        {
          id: 'check-2',
          label: 'Capture closeout photo',
          completed: false,
          completedAt: null,
          completedBy: null,
        },
      ];
      const snapshot = JSON.parse(JSON.stringify(source));
      const completed = setProjectControlChecklistCompletion({
        items: source,
        itemId: 'check-1',
        completed: true,
        actor: ' PM ',
        now: NOW,
      });

      expect(completed).toEqual([
        {
          ...source[0],
          completed: true,
          completedAt: NOW,
          completedBy: 'PM',
        },
        source[1],
      ]);
      expect(source).toEqual(snapshot);
      expect(completed[0]).not.toBe(source[0]);
      expect(completed[1]).not.toBe(source[1]);

      expect(setProjectControlChecklistCompletion({
        items: completed,
        itemId: 'check-1',
        completed: false,
        actor: 'PM',
        now: '2026-07-26T19:00:00.000Z',
      })[0]).toEqual({
        ...source[0],
        completed: false,
        completedAt: null,
        completedBy: null,
      });
    });
  });

  describe('readiness', () => {
    it('reports missing accountability and due-date fields for open work', () => {
      expect(projectControlReadiness(scheduleItem({
        owner: '',
        contractor: '',
        finishDate: '',
        projectControls: controls({
          assignee: '',
          trade: '',
          responseDueDate: '',
        }),
      }))).toEqual({
        ready: false,
        completedChecks: 0,
        totalChecks: 0,
        missing: ['assignee', 'responsible trade', 'due date'],
        pendingApproval: false,
      });
    });

    it('accepts task-field and response-date fallbacks', () => {
      expect(projectControlReadiness(scheduleItem({
        finishDate: '',
        projectControls: controls({
          assignee: '',
          trade: '',
          responseDueDate: '2026-08-01',
        }),
      }))).toMatchObject({
        ready: true,
        missing: [],
      });
    });

    it.each(['Pending', 'Changes Requested'] as const)(
      'blocks readiness while approval is %s',
      approvalStatus => {
        expect(projectControlReadiness(scheduleItem({
          projectControls: controls({ approvalStatus }),
        }))).toMatchObject({
          ready: false,
          pendingApproval: true,
        });
      },
    );

    it('blocks readiness until every checklist item is completed', () => {
      const incomplete = projectControlReadiness(scheduleItem({
        projectControls: controls({
          checklist: [
            {
              id: 'check-1',
              label: 'Verify installation',
              completed: true,
              completedAt: NOW,
              completedBy: 'David',
            },
            {
              id: 'check-2',
              label: 'Capture closeout photo',
              completed: false,
              completedAt: null,
              completedBy: null,
            },
          ],
        }),
      }));

      expect(incomplete).toEqual({
        ready: false,
        completedChecks: 1,
        totalChecks: 2,
        missing: [],
        pendingApproval: false,
      });
    });

    it('does not require an open-work due date after closure', () => {
      expect(projectControlReadiness(scheduleItem({
        status: 'Complete',
        percentComplete: 100,
        finishDate: '',
        projectControls: controls({
          workflowStage: 'Closed',
          responseDueDate: '',
        }),
      }))).toMatchObject({
        ready: true,
        missing: [],
      });
    });
  });

  describe('portfolio impact', () => {
    it('summarizes only canonically completed cost, schedule, assignment, and confidence exposure', () => {
      const items = [
        scheduleItem({
          id: 'active-high',
          owner: '',
          projectControls: controls({
            assignee: '',
            approvalStatus: 'Pending',
            estimatedCostImpact: 1000,
            estimatedScheduleImpactDays: 5,
            impactConfidence: 'High',
          }),
        }),
        scheduleItem({
          id: 'active-medium',
          projectControls: controls({
            estimatedCostImpact: 250,
            estimatedScheduleImpactDays: 2,
            impactConfidence: 'Medium',
          }),
        }),
        scheduleItem({
          id: 'completed-by-status',
          status: 'Complete',
          percentComplete: 100,
          projectControls: controls({
            approvalStatus: 'Changes Requested',
            estimatedCostImpact: 5000,
            estimatedScheduleImpactDays: 20,
            impactConfidence: 'High',
          }),
        }),
        scheduleItem({
          id: 'completed-by-percent',
          status: 'In Progress',
          percentComplete: 100,
          projectControls: controls({
            estimatedCostImpact: 3000,
            estimatedScheduleImpactDays: 10,
            impactConfidence: 'High',
          }),
        }),
      ];
      const snapshot = JSON.parse(JSON.stringify(items));

      expect(buildVitruviusPortfolioImpact(items)).toEqual({
        itemCount: 4,
        costExposure: 4250,
        taskDelayEstimateDaysTotal: 17,
        highConfidenceItemCount: 2,
        pendingApprovalCount: 2,
        unassignedItemCount: 1,
      });
      expect(items).toEqual(snapshot);
    });

    it('excludes schedule summary rows from every portfolio impact metric', () => {
      const items = [
        scheduleItem({
          id: 'phase-summary',
          isSummary: true,
          owner: '',
          projectControls: controls({
            assignee: '',
            approvalStatus: 'Changes Requested',
            estimatedCostImpact: 50000,
            estimatedScheduleImpactDays: 30,
            impactConfidence: 'High',
          }),
        }),
        scheduleItem({
          id: 'actionable-task',
          owner: '',
          projectControls: controls({
            assignee: '',
            approvalStatus: 'Pending',
            estimatedCostImpact: 750,
            estimatedScheduleImpactDays: 3,
            impactConfidence: 'High',
          }),
        }),
      ];

      expect(buildVitruviusPortfolioImpact(items)).toEqual({
        itemCount: 1,
        costExposure: 750,
        taskDelayEstimateDaysTotal: 3,
        highConfidenceItemCount: 1,
        pendingApprovalCount: 1,
        unassignedItemCount: 1,
      });
    });
  });

  describe('structured workflow integration', () => {
    it('closes and reopens a ready item while preserving its control record', () => {
      const source = scheduleItem({
        projectControls: controls({
          revision: 4,
          watchers: ['Owner'],
          linkedRecords: [{
            id: 'photo-1',
            kind: 'Photo',
            label: 'Verified field photo',
            revision: null,
          }],
          resources: [{
            id: 'crew-1',
            name: 'Crew 1',
            kind: 'Crew',
            allocationPercent: 50,
          }],
        }),
      });
      const snapshot = JSON.parse(JSON.stringify(source));
      const closed = closeProjectItemWorkflow({
        item: source,
        actor: 'David',
        now: NOW,
        note: 'Condition resolved.',
        activityId: 'close-1',
      });

      expect(closed.ok).toBe(true);
      if (!closed.ok) return;
      expect(closed.item).toMatchObject({
        status: 'Complete',
        percentComplete: 100,
        projectControls: {
          workflowStage: 'Closed',
          revision: 5,
          watchers: ['Owner'],
          linkedRecords: [expect.objectContaining({ id: 'photo-1' })],
          resources: [expect.objectContaining({ id: 'crew-1' })],
        },
      });
      expect(source).toEqual(snapshot);

      const reopened = reopenProjectItemWorkflow({
        item: closed.item,
        actor: 'David',
        now: '2026-07-26T19:00:00.000Z',
        note: 'Additional work discovered.',
        activityId: 'reopen-1',
      });
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      expect(reopened.item).toMatchObject({
        status: 'In Progress',
        percentComplete: 99,
        projectControls: {
          workflowStage: 'Open',
          revision: 6,
          watchers: ['Owner'],
          linkedRecords: [expect.objectContaining({ id: 'photo-1' })],
          resources: [expect.objectContaining({ id: 'crew-1' })],
        },
      });
      expect(reopened.item.activity?.map(entry => entry.id)).toEqual([
        'close-1',
        'reopen-1',
      ]);
    });

    it('refuses to close while a checklist record remains incomplete', () => {
      const result = closeProjectItemWorkflow({
        item: scheduleItem({
          projectControls: controls({
            checklist: [{
              id: 'check-1',
              label: 'Verify installation',
              completed: false,
              completedAt: null,
              completedBy: null,
            }],
          }),
        }),
        actor: 'David',
        now: NOW,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toBe('Issue needs 1 item before it can be closed.');
      expect(result.readiness?.missing).toContain(
        'Complete the 1 remaining checklist item.',
      );
    });
  });
});
