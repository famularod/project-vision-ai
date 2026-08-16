import { recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { emptyProjectControls } from '../../services/VitruviusProjectControls';
import type { ScheduleItem } from '../../types';

function scheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'task-1',
    projectName: '2321 Compliance Project',
    scheduleProjectName: '2321 Compliance Project',
    locationName: '2321 North Lot',
    taskName: 'PLACE ASPHALT AT EMPLOYEE PARKING AREA',
    startDate: '2026-07-27',
    finishDate: '2026-07-31',
    milestone: '',
    owner: 'Project manager',
    contractor: 'Paving contractor',
    percentComplete: 0,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-26T20:00:00.000Z',
    progressConfirmedBy: 'David',
    priority: 'Medium',
    status: 'Not Started',
    notes: 'Older task note.',
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-26T20:00:00.000Z',
    ...overrides,
  };
}

describe('DAVE schedule cloud recovery', () => {
  it('adopts the exact cloud project ID without losing newer local PM progress', () => {
    const projectId = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
    const local = scheduleItem({
      projectId: null,
      status: 'In Progress',
      percentComplete: 90,
      progressConfirmedAt: '2026-08-11T16:30:00.000Z',
      progressConfirmedBy: 'David on iPad',
      notes: 'Field correction retained locally.',
      updatedAt: '2026-08-11T16:30:00.000Z',
    });
    const cloud = scheduleItem({
      projectId,
      status: 'Not Started',
      percentComplete: 0,
      progressConfirmedAt: '2026-08-11T16:00:00.000Z',
      progressConfirmedBy: 'David on desktop',
      notes: 'Older cloud note.',
      updatedAt: '2026-08-11T16:00:00.000Z',
    });

    expect(recoverDAVEScheduleRecords({
      local: [local],
      cloud: [cloud],
      allowCloudOnly: true,
    })).toEqual([
      expect.objectContaining({
        id: 'task-1',
        projectId,
        status: 'In Progress',
        percentComplete: 90,
        notes: 'Field correction retained locally.',
      }),
    ]);
  });

  it('fails closed when the same task row disagrees on project identity', () => {
    const local = scheduleItem({
      projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
      updatedAt: '2026-08-11T16:30:00.000Z',
    });
    const cloud = scheduleItem({
      projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
      updatedAt: '2026-08-11T16:00:00.000Z',
    });

    expect(recoverDAVEScheduleRecords({
      local: [local],
      cloud: [cloud],
      allowCloudOnly: true,
    })).toEqual([]);
  });

  it('preserves matching exact project IDs when only the mutable project name changed', () => {
    const projectId = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
    const local = scheduleItem({
      projectId,
      projectName: '2321 Compliance Project',
      scheduleProjectName: '2321 Compliance Project',
      updatedAt: '2026-08-11T16:30:00.000Z',
    });
    const cloud = scheduleItem({
      projectId,
      projectName: '2321 Field Compliance',
      scheduleProjectName: '2321 Field Compliance',
      updatedAt: '2026-08-11T16:00:00.000Z',
    });

    expect(recoverDAVEScheduleRecords({
      local: [local],
      cloud: [cloud],
      allowCloudOnly: true,
    })[0]).toEqual(expect.objectContaining({
      id: 'task-1',
      projectId,
    }));
  });

  it('does not rebind a renamed recovered task to an exact same-name sibling project', () => {
    const originalProjectId = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
    const siblingProjectId = '72e941d8-8114-4082-a976-ae5b2b5daba9';
    const [recovered] = recoverDAVEScheduleRecords({
      local: [scheduleItem({
        projectId: originalProjectId,
        projectName: 'Former Project Name',
        scheduleProjectName: 'Former Project Name',
        updatedAt: '2026-08-11T16:30:00.000Z',
      })],
      cloud: [scheduleItem({
        projectId: originalProjectId,
        projectName: 'Current Project Name',
        scheduleProjectName: 'Current Project Name',
        updatedAt: '2026-08-11T16:00:00.000Z',
      })],
      allowCloudOnly: true,
    });

    const siblingTruth = buildDAVEProjectTruth({
      projectId: siblingProjectId,
      projectName: 'Former Project Name',
      updates: [],
      scheduleItems: [recovered],
      now: '2026-08-11T17:00:00.000Z',
    });

    expect(recovered.projectId).toBe(originalProjectId);
    expect(siblingTruth.schedule).toEqual([]);
  });

  it('quarantines a malformed supplied project ID instead of adopting the other revision', () => {
    const projectId = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
    const local = scheduleItem({
      projectId: ` ${projectId}`,
      updatedAt: '2026-08-11T16:30:00.000Z',
    });
    const cloud = scheduleItem({
      projectId,
      updatedAt: '2026-08-11T16:00:00.000Z',
    });

    expect(recoverDAVEScheduleRecords({
      local: [local],
      cloud: [cloud],
      allowCloudOnly: true,
    })).toEqual([]);
  });

  it('does not adopt a cloud project ID when the project names disagree', () => {
    const local = scheduleItem({
      projectId: null,
      updatedAt: '2026-08-11T16:30:00.000Z',
    });
    const cloud = scheduleItem({
      projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
      projectName: '2375 Compliance Project',
      scheduleProjectName: '2375 Compliance Project',
      updatedAt: '2026-08-11T16:00:00.000Z',
    });

    expect(recoverDAVEScheduleRecords({
      local: [local],
      cloud: [cloud],
      allowCloudOnly: true,
    })).toEqual([]);
  });

  it('applies a newer cloud note without replacing newer unrelated local progress', () => {
    const local = scheduleItem({
      status: 'In Progress',
      percentComplete: 60,
      progressConfirmedAt: '2026-07-26T22:30:00.000Z',
      progressConfirmedBy: 'David on iPad',
      notes: 'Older task note.',
      updatedAt: '2026-07-26T22:30:00.000Z',
    });
    const cloud = scheduleItem({
      status: 'Not Started',
      percentComplete: 0,
      progressConfirmedAt: '2026-07-26T21:00:00.000Z',
      progressConfirmedBy: 'David on iPhone',
      notes: 'Test 1',
      updatedAt: '2026-07-26T23:00:00.000Z',
    });

    expect(recoverDAVEScheduleRecords({
      local: [local],
      cloud: [cloud],
      allowCloudOnly: true,
    })).toEqual([
      expect.objectContaining({
        id: 'task-1',
        notes: 'Test 1',
        updatedAt: '2026-07-26T23:00:00.000Z',
        status: 'In Progress',
        percentComplete: 60,
        progressSource: 'project_manager',
        progressConfirmedAt: '2026-07-26T22:30:00.000Z',
        progressConfirmedBy: 'David on iPad',
      }),
    ]);
  });

  it('preserves independent project-control edits recovered from two devices', () => {
    const local = scheduleItem({
      projectControls: {
        ...emptyProjectControls(),
        assignee: 'David',
        revision: 2,
        updatedAt: '2026-07-26T22:00:00.000Z',
        updatedBy: 'David on iPhone',
        fieldRevisions: {
          assignee: {
            revision: 2,
            updatedAt: '2026-07-26T22:00:00.000Z',
            updatedBy: 'David on iPhone',
          },
        },
      },
    });
    const cloud = scheduleItem({
      updatedAt: '2026-07-26T22:01:00.000Z',
      projectControls: {
        ...emptyProjectControls(),
        approvalStatus: 'Pending',
        revision: 2,
        updatedAt: '2026-07-26T22:01:00.000Z',
        updatedBy: 'David on iPad',
        fieldRevisions: {
          approvalStatus: {
            revision: 2,
            updatedAt: '2026-07-26T22:01:00.000Z',
            updatedBy: 'David on iPad',
          },
        },
      },
    });

    const [recovered] = recoverDAVEScheduleRecords({
      local: [local],
      cloud: [cloud],
      allowCloudOnly: true,
    });

    expect(recovered.projectControls).toEqual(expect.objectContaining({
      assignee: 'David',
      approvalStatus: 'Pending',
      fieldRevisions: expect.objectContaining({
        assignee: expect.objectContaining({ updatedBy: 'David on iPhone' }),
        approvalStatus: expect.objectContaining({ updatedBy: 'David on iPad' }),
      }),
    }));
  });

  it('resolves same-control-field edits by later time despite unequal device revisions on every recovery path', () => {
    const local = scheduleItem({
      projectControls: {
        ...emptyProjectControls(),
        assignee: 'Later phone owner',
        revision: 1,
        updatedAt: '2026-07-26T22:02:00.000Z',
        updatedBy: 'David on iPhone',
        fieldRevisions: {
          assignee: {
            revision: 1,
            updatedAt: '2026-07-26T22:02:00.000Z',
            updatedBy: 'David on iPhone',
          },
        },
      },
    });
    const cloud = scheduleItem({
      updatedAt: '2026-07-26T22:01:00.000Z',
      projectControls: {
        ...emptyProjectControls(),
        assignee: 'Earlier tablet owner',
        revision: 9,
        updatedAt: '2026-07-26T22:01:00.000Z',
        updatedBy: 'David on iPad',
        fieldRevisions: {
          assignee: {
            revision: 9,
            updatedAt: '2026-07-26T22:01:00.000Z',
            updatedBy: 'David on iPad',
          },
        },
      },
    });

    const [localFirst] = recoverDAVEScheduleRecords({
      local: [local],
      cloud: [cloud],
      allowCloudOnly: true,
    });
    const [cloudFirst] = recoverDAVEScheduleRecords({
      local: [cloud],
      cloud: [local],
      allowCloudOnly: true,
    });

    expect(localFirst.projectControls?.assignee).toBe('Later phone owner');
    expect(cloudFirst.projectControls?.assignee).toBe('Later phone owner');
    expect(localFirst.projectControls).toEqual(expect.objectContaining({
      revision: 9,
      fieldRevisions: expect.objectContaining({
        assignee: {
          revision: 1,
          updatedAt: '2026-07-26T22:02:00.000Z',
          updatedBy: 'David on iPhone',
        },
      }),
    }));
    expect(cloudFirst.projectControls).toEqual(localFirst.projectControls);
  });
});
