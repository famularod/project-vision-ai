import type { ScheduleItem } from '../../types';
import {
  buildPIEScheduleDependencyNetwork,
  SCHEDULE_DEPENDENCY_EXTRACTION_ENABLED,
} from '../../services/PIEScheduleDependencyNetwork';
import {
  applyVitruviusSchedulePreview,
  normalizeScheduleDependencies,
  previewVitruviusFinishToStartSchedule,
  VitruviusScheduleCalculationError,
} from '../../services/VitruviusScheduleEngine';

function task(
  id: string,
  overrides: Partial<ScheduleItem> = {},
): ScheduleItem {
  return {
    id,
    projectName: '2321 Compliance Project',
    locationName: 'North Lot',
    taskName: id,
    startDate: '2026-07-20',
    finishDate: '2026-07-20',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 1,
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-07-24T12:00:00.000Z',
    ...overrides,
  };
}

describe('Vitruvius schedule engine', () => {
  test('trusts structured dependencies while leaving free-text extraction disabled', () => {
    const foundation = task('foundation', {
      taskName: 'Foundation',
      status: 'In Progress',
      percentComplete: 50,
      wbsCode: '1.1',
    });
    const structure = task('structure', {
      taskName: 'Structure',
      dependencies: [{ predecessorItemId: foundation.id, type: 'FS' }],
    });
    const enclosure = task('enclosure', {
      taskName: 'Enclosure',
      notes: 'Predecessors: structure.',
    });

    const network = buildPIEScheduleDependencyNetwork([
      foundation,
      structure,
      enclosure,
    ]);

    expect(SCHEDULE_DEPENDENCY_EXTRACTION_ENABLED).toBe(false);
    expect(network.nodes).toHaveLength(3);
    expect(network.edges).toEqual([
      expect.objectContaining({
        fromScheduleItemId: 'foundation',
        toScheduleItemId: 'structure',
        sourceLabel: 'FS',
      }),
    ]);
    expect(network.nodes.find(node => node.scheduleItemId === 'structure')).toMatchObject({
      activityId: 'structure',
      blocked: true,
      blockingPredecessorIds: ['foundation'],
    });
    expect(network.nodes.find(node => node.scheduleItemId === 'enclosure')).toMatchObject({
      predecessorItemIds: [],
      blocked: false,
    });
  });

  test('moves a finish-to-start successor later across a weekend', () => {
    const preview = previewVitruviusFinishToStartSchedule([
      task('predecessor', {
        finishDate: 'Jul 24, 2026',
        status: 'Complete',
        percentComplete: 100,
      }),
      task('successor', {
        startDate: '2026-07-24',
        finishDate: '2026-07-28',
        durationDays: 3,
        dependencies: [{ predecessorItemId: 'predecessor', type: 'FS' }],
      }),
    ]);

    expect(preview.safeToApply).toBe(true);
    expect(preview.changes).toEqual([
      expect.objectContaining({
        itemId: 'successor',
        previousStartDate: '2026-07-24',
        nextStartDate: '2026-07-27',
        nextFinishDate: '2026-07-29',
      }),
    ]);
    expect(preview.items.find(item => item.id === 'successor')).toMatchObject({
      startDate: '2026-07-27',
      finishDate: '2026-07-29',
    });
  });

  test('uses the latest predecessor finish plus working-day lag', () => {
    const preview = previewVitruviusFinishToStartSchedule([
      task('early', {
        finishDate: '2026-07-22',
        status: 'Complete',
        percentComplete: 100,
      }),
      task('late', {
        finishDate: '2026-07-24',
        status: 'Complete',
        percentComplete: 100,
      }),
      task('successor', {
        startDate: '',
        finishDate: '',
        durationDays: 2,
        dependencies: [
          { predecessorItemId: 'early', type: 'FS' },
          { predecessorItemId: 'late', type: 'FS', lagDays: 2 },
        ],
      }),
    ]);

    expect(preview.safeToApply).toBe(true);
    expect(preview.items.find(item => item.id === 'successor')).toMatchObject({
      startDate: '2026-07-29',
      finishDate: '2026-07-30',
    });
  });

  test('never pulls an already later PM date earlier', () => {
    const preview = previewVitruviusFinishToStartSchedule([
      task('predecessor', {
        finishDate: '2026-07-20',
        status: 'Complete',
        percentComplete: 100,
      }),
      task('successor', {
        startDate: '2026-08-03',
        finishDate: '2026-08-04',
        dependencies: [{ predecessorItemId: 'predecessor', type: 'FS' }],
      }),
    ]);

    expect(preview.safeToApply).toBe(true);
    expect(preview.changes).toEqual([]);
    expect(preview.items.find(item => item.id === 'successor')?.startDate)
      .toBe('2026-08-03');
  });

  test('blocks application for missing predecessors, cycles, and completed-task shifts', () => {
    const missing = previewVitruviusFinishToStartSchedule([
      task('task-with-missing', {
        dependencies: [{ predecessorItemId: 'missing', type: 'FS' }],
      }),
    ]);
    expect(missing.safeToApply).toBe(false);
    expect(missing.issues).toEqual([
      expect.objectContaining({ code: 'missing_predecessor' }),
    ]);

    const cycle = previewVitruviusFinishToStartSchedule([
      task('a', { dependencies: [{ predecessorItemId: 'b', type: 'FS' }] }),
      task('b', { dependencies: [{ predecessorItemId: 'a', type: 'FS' }] }),
    ]);
    expect(cycle.safeToApply).toBe(false);
    expect(cycle.issues).toEqual([
      expect.objectContaining({ code: 'dependency_cycle' }),
    ]);

    const completed = previewVitruviusFinishToStartSchedule([
      task('predecessor', {
        finishDate: '2026-07-31',
        status: 'Complete',
        percentComplete: 100,
      }),
      task('completed-successor', {
        startDate: '2026-07-20',
        finishDate: '2026-07-20',
        status: 'Complete',
        percentComplete: 100,
        dependencies: [{ predecessorItemId: 'predecessor', type: 'FS' }],
      }),
    ]);
    expect(completed.safeToApply).toBe(false);
    expect(completed.issues).toEqual([
      expect.objectContaining({ code: 'completed_task_locked' }),
    ]);
    expect(() => applyVitruviusSchedulePreview(completed))
      .toThrow(VitruviusScheduleCalculationError);
  });

  test('normalizes duplicate and unsupported dependency input conservatively', () => {
    expect(normalizeScheduleDependencies([
      { predecessorItemId: ' a ', type: 'FS', lagDays: 2.7 },
      { predecessorItemId: 'a', type: 'FS', lagDays: 10 },
      { predecessorItemId: 'b', type: 'SS', lagDays: -3 },
      { predecessorItemId: '', type: 'FS' },
    ])).toEqual([
      { predecessorItemId: 'a', type: 'FS', lagDays: 2 },
    ]);
  });
});
