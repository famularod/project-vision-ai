import type { ScheduleItem } from '../../types';
import {
  buildVitruviusScheduleHierarchy,
  nextScheduleSortOrder,
  nextScheduleWbsCode,
  planningDependenciesFromIds,
  scheduleParentOptions,
  schedulePredecessorOptions,
} from '../../services/VitruviusScheduleWorkspace';

function task(id: string, overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    projectName: 'Project Alpha',
    locationName: '',
    taskName: id,
    startDate: '2026-07-20',
    finishDate: '2026-07-21',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-07-24T12:00:00.000Z',
    ...overrides,
  };
}

describe('Vitruvius schedule workspace model', () => {
  test('builds stable phase hierarchy ordered by sort order and WBS', () => {
    const phase = task('phase', {
      taskName: 'Site work',
      wbsCode: '1',
      sortOrder: 10,
      isSummary: true,
    });
    const second = task('second', {
      taskName: 'Slurry seal',
      wbsCode: '1.2',
      parentItemId: phase.id,
      sortOrder: 20,
    });
    const first = task('first', {
      taskName: 'Place asphalt',
      wbsCode: '1.1',
      parentItemId: phase.id,
      sortOrder: 10,
    });

    const hierarchy = buildVitruviusScheduleHierarchy([second, phase, first]);

    expect(hierarchy.issues).toEqual([]);
    expect(hierarchy.rows.map(row => ({
      id: row.item.id,
      depth: row.depth,
      children: row.childCount,
    }))).toEqual([
      { id: 'phase', depth: 0, children: 2 },
      { id: 'first', depth: 1, children: 0 },
      { id: 'second', depth: 1, children: 0 },
    ]);
  });

  test('keeps orphaned and cyclic work visible with explicit issues', () => {
    const orphan = task('orphan', { parentItemId: 'missing' });
    const a = task('a', { parentItemId: 'b', isSummary: true });
    const b = task('b', { parentItemId: 'a', isSummary: true });

    const hierarchy = buildVitruviusScheduleHierarchy([orphan, a, b]);

    expect(hierarchy.rows.map(row => row.item.id).sort()).toEqual(['a', 'b', 'orphan']);
    expect(hierarchy.rows.find(row => row.item.id === 'orphan')?.orphaned).toBe(true);
    expect(hierarchy.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_parent', itemId: 'orphan' }),
      expect.objectContaining({ code: 'hierarchy_cycle' }),
    ]));
  });

  test('prevents choosing hierarchy descendants or dependency successors', () => {
    const phase = task('phase', { isSummary: true });
    const child = task('child', { parentItemId: phase.id });
    const successor = task('successor', {
      dependencies: [{ predecessorItemId: child.id, type: 'FS' }],
    });

    expect(scheduleParentOptions('phase', [phase, child, successor]).map(item => item.id))
      .not.toContain('child');
    expect(schedulePredecessorOptions('child', [phase, child, successor]).map(item => item.id))
      .not.toContain('successor');
  });

  test('creates normalized finish-to-start dependency and next ordering defaults', () => {
    const phase = task('phase', { wbsCode: '2', isSummary: true });
    const child = task('child', {
      parentItemId: phase.id,
      wbsCode: '2.1',
      sortOrder: 10,
    });

    expect(planningDependenciesFromIds([' child ', 'child'], 2.8)).toEqual([
      { predecessorItemId: 'child', type: 'FS', lagDays: 2 },
    ]);
    expect(nextScheduleSortOrder(phase.id, [phase, child])).toBe(20);
    expect(nextScheduleWbsCode(phase.id, [phase, child])).toBe('2.2');
    expect(nextScheduleSortOrder(null, [phase, child])).toBe(10);
    expect(nextScheduleWbsCode(null, [phase, child])).toBe('2');
  });
});
