/**
 * Audit round 2, A10 pass 8 L4 (30 Sep 2026): every project's saved tasks
 * went everywhere.
 *
 * (a) The live authority's input took every saved task of every project
 * (knownScheduleItems, for the name fallback), and they are part of its
 * evidence signature, so a task change in Beta changed Alpha's signature and
 * rebuilt Alpha's intelligence in the background. It now takes the saved
 * tasks (hidden ones included) of the projects its own tasks belong to: the
 * update's old row and its schedule's rows are always among them.
 *
 * (b) Home's overview rows and the commitment register built the saved-task
 * index again for each project on every render (84 ms against 67 ms per Home
 * render at 3,300 tasks in plain Node). The index is now kept with the saved
 * tasks array (by identity) and built once.
 *
 * Timings are measured in plain Node (see the commit); these tests pin the
 * work done and the inputs. Synthetic data.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ProjectUpdate, ScheduleItem } from '../../types';
import type { PIELiveAuthorityInput } from '../../providers/PIELiveAuthorityProvider';
import { authorityInputSignature } from '../../services/PIELiveAuthoritySignature';
import { scheduleSavedTasksOfProjects, scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';

const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

function task(id: string, project: string, name: string, batch: string, start: string): ScheduleItem {
  return {
    id, projectName: project, scheduleProjectName: project, locationName: 'Lot', taskName: name, startDate: start, finishDate: start,
    milestone: '', owner: '', contractor: '', percentComplete: 0, status: 'Not Started', priority: 'Medium', notes: '',
    importBatchId: batch, sourceDocumentId: batch, createdAt: '2026-08-31T12:00:00.000Z',
  } as ScheduleItem;
}
const alphaOld = task('alpha-old', 'Alpha', 'Pour slab', 'alpha-0831', '10/01/2026');
const alphaNew = task('alpha-new', 'Alpha', 'Pour slab', 'alpha-0926', '10/02/2026');
const betaTask = task('beta-1', 'Beta', 'Framing', 'beta-0831', '10/05/2026');
const saved = [alphaOld, alphaNew, betaTask];
const report = {
  id: 'u-alpha', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-25T15:00:00.000Z', photos: [], recipients: { contactIds: [] },
  notes: 'Pour slab: forms set.', scheduleItemId: alphaOld.id, scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
} as ProjectUpdate;

/** Alpha's live-authority input as the phone builds it. */
const alphaInput = (all: ScheduleItem[]) => ({
  projectName: 'Alpha', projectNames: ['Alpha'], updates: [report], scheduleItems: [alphaNew],
  knownScheduleItems: scheduleSavedTasksOfProjects(all, [alphaNew], ['Alpha']),
}) as unknown as PIELiveAuthorityInput;

describe('A10 p8 L4 (a): the live authority takes its own projects\' saved tasks', () => {
  it('Alpha\'s input holds Alpha\'s saved tasks, the hidden old row included, and no Beta task', () => {
    expect(alphaInput(saved).knownScheduleItems!.map(item => item.id)).toEqual(['alpha-old', 'alpha-new']);
    // The name fallback still finds the update's old row among them.
    expect(scheduleTaskLinks([alphaNew], alphaInput(saved).knownScheduleItems)(report)).toMatchObject({ item: alphaNew, basis: 'stored_task_name' });
  });

  it('a task change in Beta leaves Alpha\'s signature as it was; one in Alpha changes it', () => {
    const before = authorityInputSignature(alphaInput(saved));
    const betaChanged = [alphaOld, alphaNew, { ...betaTask, percentComplete: 50, status: 'In Progress' } as ScheduleItem];
    expect(authorityInputSignature(alphaInput(betaChanged))).toBe(before);
    const alphaChanged = [{ ...alphaOld, notes: 'Hidden row note' }, alphaNew, betaTask];
    expect(authorityInputSignature(alphaInput(alphaChanged))).not.toBe(before);
  });

  it('the same saved tasks and projects give the same array, so the signature reuses its serialized form', () => {
    expect(scheduleSavedTasksOfProjects(saved, [alphaNew], ['Alpha'])).toBe(scheduleSavedTasksOfProjects(saved, [alphaNew], ['Alpha']));
  });

  it('the phone passes them to the live authority', () => {
    expect(app).toMatch(/knownScheduleItems: scheduleSavedTasksOfProjects\(scheduleItems as unknown as import\('\.\/types'\)\.ScheduleItem\[\], \(reportEvidenceScope \? reportEvidenceScope\.scheduleItems : authoritativeScheduleItems\)/);
  });
});

describe('A10 p8 L4 (b): the saved-task index is built once per saved tasks array', () => {
  it('ten projects\' reconciliations over the same saved tasks read each task\'s id about twice in all', () => {
    let reads = 0;
    const counted = Array.from({ length: 200 }, (_, index) => {
      const row = { ...task(`t-${index}`, `Project ${index % 10}`, `Task ${index}`, `batch-${index % 10}`, '10/01/2026') } as Partial<ScheduleItem>;
      delete row.id;
      Object.defineProperty(row, 'id', { enumerable: true, get: () => { reads += 1; return `t-${index}`; } });
      return row as ScheduleItem;
    });
    for (let project = 0; project < 10; project += 1) scheduleTaskLinks([], counted);
    expect(reads).toBeLessThanOrEqual(2 * counted.length);
  });
});
