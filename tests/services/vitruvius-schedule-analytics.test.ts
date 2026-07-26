import {
  analyzeBaselineVariance,
  analyzeVitruviusCriticalPath,
  analyzeVitruviusSchedule,
} from '../../services/VitruviusScheduleAnalytics';
import type { ScheduleItem } from '../../types';

describe('VitruviusScheduleAnalytics', () => {
  test('identifies the longest dependency chain and float on a shorter branch', () => {
    const analysis = analyzeVitruviusCriticalPath([
      item('a', { durationDays: 3 }),
      item('b', {
        durationDays: 4,
        dependencies: [{ predecessorItemId: 'a', type: 'FS' }],
      }),
      item('c', {
        durationDays: 1,
        dependencies: [{ predecessorItemId: 'a', type: 'FS' }],
      }),
      item('d', {
        durationDays: 2,
        dependencies: [
          { predecessorItemId: 'b', type: 'FS' },
          { predecessorItemId: 'c', type: 'FS' },
        ],
      }),
    ]);

    expect(analysis.safe).toBe(true);
    expect(analysis.projectDurationDays['2321 Compliance Project']).toBe(9);
    expect([...analysis.criticalItemIds]).toEqual(['a', 'b', 'd']);
    expect(analysis.items.find(candidate => candidate.itemId === 'c')).toMatchObject({
      totalFloatDays: 3,
      critical: false,
    });
  });

  test('includes dependency lag in critical-path timing', () => {
    const analysis = analyzeVitruviusCriticalPath([
      item('a', { durationDays: 2 }),
      item('b', {
        durationDays: 2,
        dependencies: [{ predecessorItemId: 'a', type: 'FS', lagDays: 3 }],
      }),
    ]);

    expect(analysis.projectDurationDays['2321 Compliance Project']).toBe(7);
    expect(analysis.items.find(candidate => candidate.itemId === 'b')).toMatchObject({
      earliestStart: 5,
      earliestFinish: 7,
      critical: true,
    });
  });

  test('does not claim a critical path when the network is unsafe', () => {
    const analysis = analyzeVitruviusCriticalPath([
      item('a', { dependencies: [{ predecessorItemId: 'b', type: 'FS' }] }),
      item('b', { dependencies: [{ predecessorItemId: 'a', type: 'FS' }] }),
    ]);

    expect(analysis.safe).toBe(false);
    expect(analysis.criticalItemIds.size).toBe(0);
    expect(analysis.issues[0]).toMatch(/dependency cycle/i);
  });

  test('reports current date movement against the saved baseline', () => {
    expect(analyzeBaselineVariance(item('late', {
      baselineStartDate: '2026-07-20',
      baselineFinishDate: '2026-07-23',
      startDate: '2026-07-21',
      finishDate: '2026-07-26',
    }))).toMatchObject({
      startVarianceDays: 1,
      finishVarianceDays: 3,
      status: 'late',
    });
    expect(analyzeBaselineVariance(item('early', {
      baselineStartDate: '2026-07-20',
      baselineFinishDate: '2026-07-23',
      startDate: '2026-07-19',
      finishDate: '2026-07-22',
    })).status).toBe('early');
    expect(analyzeBaselineVariance(item('none')).status).toBe('no_baseline');
  });

  test('returns a non-mutating finish-to-start impact preview with the controls', () => {
    const source = [
      item('predecessor', {
        finishDate: '2026-07-24',
        status: 'Complete',
        percentComplete: 100,
      }),
      item('successor', {
        startDate: '2026-07-24',
        finishDate: '2026-07-27',
        durationDays: 2,
        dependencies: [{ predecessorItemId: 'predecessor', type: 'FS' }],
      }),
    ];
    const analysis = analyzeVitruviusSchedule(source);

    expect(analysis.impactPreview.changes[0]).toMatchObject({
      itemId: 'successor',
      nextStartDate: '2026-07-27',
      nextFinishDate: '2026-07-28',
    });
    expect(source[1].startDate).toBe('2026-07-24');
  });
});

function item(
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
