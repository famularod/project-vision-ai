import {
  buildVitruviusScheduleChangeScenario,
} from '../../services/VitruviusScheduleChangeScenario';
import type { ScheduleItem } from '../../types';

describe('VitruviusScheduleChangeScenario', () => {
  test('reports no downstream or finish impact when the draft changes nothing material', () => {
    const items = [
      task('a', {
        finishDate: '2026-07-20',
        status: 'Complete',
        percentComplete: 100,
      }),
      task('b', {
        startDate: '2026-07-21',
        finishDate: '2026-07-22',
        durationDays: 2,
        dependencies: [{ predecessorItemId: 'a', type: 'FS' }],
      }),
    ];

    const scenario = buildVitruviusScheduleChangeScenario({
      items,
      itemId: 'a',
      draft: { finishDate: '2026-07-20' },
    });

    expect(scenario.safety.safeToApply).toBe(true);
    expect(scenario.downstreamChanges).toEqual([]);
    expect(scenario.projectFinish).toEqual({
      before: '2026-07-22',
      after: '2026-07-22',
      deltaCalendarDays: 0,
    });
  });

  test('calculates exact downstream movement and the resulting project finish', () => {
    const items = [
      task('a', {
        finishDate: '2026-07-20',
        status: 'Complete',
        percentComplete: 100,
      }),
      task('b', {
        startDate: '2026-07-21',
        finishDate: '2026-07-22',
        durationDays: 2,
        dependencies: [{ predecessorItemId: 'a', type: 'FS' }],
      }),
      task('c', {
        startDate: '2026-07-23',
        finishDate: '2026-07-23',
        dependencies: [{ predecessorItemId: 'b', type: 'FS' }],
      }),
    ];

    const scenario = buildVitruviusScheduleChangeScenario({
      items,
      itemId: 'a',
      draft: { finishDate: '2026-07-22' },
    });

    expect(scenario.safety.safeToApply).toBe(true);
    expect(scenario.downstreamChanges).toEqual([
      {
        itemId: 'b',
        taskName: 'b',
        previousStartDate: '2026-07-21',
        previousFinishDate: '2026-07-22',
        nextStartDate: '2026-07-23',
        nextFinishDate: '2026-07-24',
      },
      {
        itemId: 'c',
        taskName: 'c',
        previousStartDate: '2026-07-23',
        previousFinishDate: '2026-07-23',
        nextStartDate: '2026-07-27',
        nextFinishDate: '2026-07-27',
      },
    ]);
    expect(scenario.projectFinish).toEqual({
      before: '2026-07-23',
      after: '2026-07-27',
      deltaCalendarDays: 4,
    });
  });

  test('reports critical-path membership changes for a changed branch', () => {
    const items = [
      task('a', {
        startDate: '2026-07-20',
        finishDate: '2026-07-21',
        durationDays: 2,
      }),
      task('b', {
        startDate: '2026-07-22',
        finishDate: '2026-07-27',
        durationDays: 4,
        dependencies: [{ predecessorItemId: 'a', type: 'FS' }],
      }),
      task('c', {
        startDate: '2026-07-22',
        finishDate: '2026-07-22',
        durationDays: 1,
        dependencies: [{ predecessorItemId: 'a', type: 'FS' }],
      }),
      task('d', {
        startDate: '2026-07-28',
        finishDate: '2026-07-29',
        durationDays: 2,
        dependencies: [
          { predecessorItemId: 'b', type: 'FS' },
          { predecessorItemId: 'c', type: 'FS' },
        ],
      }),
    ];

    const scenario = buildVitruviusScheduleChangeScenario({
      items,
      itemId: 'c',
      draft: {
        durationDays: 6,
        finishDate: '2026-07-29',
      },
    });

    expect(scenario.criticalPath.beforeItemIds).toEqual(['a', 'b', 'd']);
    expect(scenario.criticalPath.afterItemIds).toEqual(['a', 'c', 'd']);
    expect(scenario.criticalPath.enteredItemIds).toEqual(['c']);
    expect(scenario.criticalPath.exitedItemIds).toEqual(['b']);
  });

  test('blocks unsafe completed-successor and invalid-date scenarios', () => {
    const completed = buildVitruviusScheduleChangeScenario({
      items: [
        task('a', { finishDate: '2026-07-20' }),
        task('b', {
          startDate: '2026-07-21',
          finishDate: '2026-07-21',
          status: 'Complete',
          percentComplete: 100,
          dependencies: [{ predecessorItemId: 'a', type: 'FS' }],
        }),
      ],
      itemId: 'a',
      draft: { finishDate: '2026-07-31' },
    });
    const invalid = buildVitruviusScheduleChangeScenario({
      items: [task('a')],
      itemId: 'a',
      draft: {
        startDate: 'not-a-date',
        finishDate: '2026-07-20',
      },
    });

    expect(completed.safety.safeToApply).toBe(false);
    expect(completed.safety.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'completed_task_locked', itemId: 'b' }),
    ]));
    expect(invalid.safety.safeToApply).toBe(false);
    expect(invalid.safety.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_start_date', itemId: 'a' }),
    ]));
  });

  test('preserves missing-predecessor and dependency-cycle safety blockers', () => {
    const missing = buildVitruviusScheduleChangeScenario({
      items: [
        task('a', {
          dependencies: [{ predecessorItemId: 'removed-task', type: 'FS' }],
        }),
      ],
      itemId: 'a',
      draft: { finishDate: '2026-07-21' },
    });
    const cycle = buildVitruviusScheduleChangeScenario({
      items: [
        task('a', {
          dependencies: [{ predecessorItemId: 'b', type: 'FS' }],
        }),
        task('b', {
          dependencies: [{ predecessorItemId: 'a', type: 'FS' }],
        }),
      ],
      itemId: 'a',
      draft: { finishDate: '2026-07-21' },
    });

    expect(missing.safety.safeToApply).toBe(false);
    expect(missing.safety.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_predecessor', itemId: 'a' }),
    ]));
    expect(cycle.safety.safeToApply).toBe(false);
    expect(cycle.safety.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'dependency_cycle' }),
    ]));
  });

  test('contains the scenario to the edited project and leaves every source record immutable', () => {
    const items = [
      task('a', {
        finishDate: '2026-07-20',
      }),
      task('b', {
        startDate: '2026-07-21',
        finishDate: '2026-07-21',
        dependencies: [{ predecessorItemId: 'a', type: 'FS' }],
      }),
      task('foreign', {
        scheduleProjectName: '2375 Compliance Project',
        projectName: '2375 Compliance Project',
        startDate: '2026-08-10',
        finishDate: '2026-08-10',
      }),
    ];
    const before = JSON.stringify(items);

    const scenario = buildVitruviusScheduleChangeScenario({
      items,
      itemId: 'a',
      draft: { finishDate: '2026-07-24' },
    });

    expect(scenario.projectName).toBe('2321 Compliance Project');
    expect(scenario.proposedProjectItems.map(item => item.id)).toEqual(['a', 'b']);
    expect(scenario.downstreamChanges.map(change => change.itemId)).toEqual(['b']);
    expect(scenario.projectFinish.after).toBe('2026-07-27');
    expect(JSON.stringify(items)).toBe(before);
    expect(items[0].finishDate).toBe('2026-07-20');
    expect(items[2].finishDate).toBe('2026-08-10');
  });

  test('returns an explicit unsafe result when the edited item no longer exists', () => {
    const scenario = buildVitruviusScheduleChangeScenario({
      items: [task('a')],
      itemId: 'missing',
      draft: { finishDate: '2026-07-30' },
    });

    expect(scenario.safety.safeToApply).toBe(false);
    expect(scenario.safety.issues).toEqual([
      expect.objectContaining({
        code: 'edited_item_missing',
        itemId: 'missing',
      }),
    ]);
    expect(scenario.proposedProjectItems).toEqual([]);
  });
});

function task(
  id: string,
  overrides: Partial<ScheduleItem> = {},
): ScheduleItem {
  return {
    id,
    scheduleProjectName: '2321 Compliance Project',
    projectName: '2321 Compliance Project',
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: id,
    startDate: '2026-07-20',
    finishDate: '2026-07-20',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 1,
    percentComplete: 0,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-24T12:00:00.000Z',
    progressConfirmedBy: 'PM',
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activity: [],
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
    ...overrides,
  };
}
