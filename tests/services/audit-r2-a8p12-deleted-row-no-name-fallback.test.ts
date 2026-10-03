/**
 * Audit round 2, A8 pass 12 L1 (1 Oct 2026). Master F has two "Pour slab"
 * tasks in the Lot (phase 1 and phase 2). Master M moved phase 1 to a new
 * row, and a "phase 1 is complete" report was filed on it. Master N dropped
 * phase 1 and brought phase 2 in as a new row (one row against two saved,
 * so the import paired with neither). Deleting M with its items wrote M's
 * row id onto F's hidden phase-1 row (fd00285), so the report stayed current
 * evidence; with M's row gone, the name fallback could no longer see that
 * its schedule had two tasks of that name and linked the report to phase 2:
 * "Pour slab complete while the schedule remains Not Started at 0%".
 *
 * Now a deleted row that a saved row still lists answers only through that
 * chain, never by name. Synthetic data.
 */
import type { ScheduleItem } from '../../types';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';

const PROJECT = 'Lot Project';
const task = (id: string, extra: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id,
  projectName: PROJECT,
  scheduleProjectName: PROJECT,
  locationName: 'Lot',
  taskName: 'Pour slab',
  startDate: '10/01/2026',
  finishDate: '10/05/2026',
  percentComplete: 0,
  status: 'Not Started',
  ...extra,
}) as ScheduleItem;

// N's new phase-2 row, shown; F's two rows hidden, phase 1 listing M's deleted row.
const shownPhase2 = task('N-phase-2', { importBatchId: 'batch-N' });
const hiddenPhase1 = task('F-phase-1', { importBatchId: 'batch-F', revisedFromTaskIds: ['M-phase-1'] });
const hiddenPhase2 = task('F-phase-2', { importBatchId: 'batch-F' });

const report = (scheduleItemId: string) => ({
  scheduleItemId,
  scheduleTaskName: 'Pour slab',
  projectName: PROJECT,
  selectedAreaName: 'Lot',
});

describe('a deleted row a saved row still lists never falls back by name (A8 pass 12 L1)', () => {
  const links = scheduleTaskLinks([shownPhase2], [shownPhase2, hiddenPhase1, hiddenPhase2]);

  test('the phase-1 report on M\'s deleted row links to no task, not to phase 2', () => {
    expect(links(report('M-phase-1'))).toBeNull();
  });

  test('control: a report on a row nothing records still links by its unique name', () => {
    expect(links(report('row-nobody-lists'))).toEqual({ item: shownPhase2, basis: 'stored_task_name' });
  });
});
