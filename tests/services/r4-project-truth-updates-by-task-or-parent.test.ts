/**
 * R4 (the owner's open item): "Project Truth keeps only updates whose project
 * name matches exactly, so older updates filed under a building name are
 * left out (Reports are unaffected)". The saved Project Truth (home and
 * workspace summaries) now takes an update that is the project's by its
 * parent project or by its task, whatever name it was filed under. An
 * update with a building name and nothing else is left as it was: the id an
 * update carries is made from the name it was filed under, so it is no
 * identity of the project. Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ProjectUpdate, ScheduleItem } from '../../types';
import { buildDAVEProjectTruth, daveProjectTruthUpdatesFor } from '../../services/DAVEProjectTruth';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');

const NOW = '2026-09-20T12:00:00.000Z';
const task = (id: string, projectName: string, scheduleProjectName: string, taskName: string) => ({
  id, projectName, scheduleProjectName, locationName: 'Level 2', taskName,
  startDate: '09/01/2026', finishDate: '12/15/2026', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: 40, priority: 'Medium', status: 'In Progress', notes: '', createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
// An older schedule files each task under its building, with the parent project beside it.
const SHOWN = [task('t-frame', 'Building 2321', 'Campus', 'Frame walls'), task('t-roof', 'Campus', 'Campus', 'Roofing')];
const HIDDEN = task('t-frame-old', 'Building 2321', 'Campus', 'Frame walls');
const OTHER = task('t-dig', 'Harbor', 'Harbor', 'Excavate');
const update = (id: string, fields: Partial<ProjectUpdate>): ProjectUpdate => ({
  id, projectName: 'Building 2321', date: '2026-09-10T15:00:00.000Z', photos: [], recipients: { contactIds: [] }, notes: 'Walls going up.',
  selectedAreaName: 'Level 2', ...fields,
}) as unknown as ProjectUpdate;
const withParent = update('u-parent', { scheduleProjectName: 'Campus' });
const onShownTask = update('u-task', { scheduleItemId: 't-frame' });
const onHiddenTask = update('u-hidden-task', { scheduleItemId: 't-frame-old' });
const nameOnly = update('u-name-only', {});
const ofOtherProject = update('u-other', { projectName: 'Building 9', scheduleItemId: 't-dig' });
const underItsName = update('u-campus', { projectName: 'Campus' });
const ALL = [withParent, onShownTask, onHiddenTask, nameOnly, ofOtherProject, underItsName];
const inTruth = (updates: ProjectUpdate[]) => buildDAVEProjectTruth({
  projectId: 'project-campus', projectName: 'Campus', updates, scheduleItems: SHOWN, knownScheduleItems: [...SHOWN, HIDDEN, OTHER], now: NOW,
}).evidence.records.filter(record => record.kind === 'update').map(record => record.sourceRecordId).sort();

describe('R4: Project Truth takes a project\'s own updates whatever name they were filed under', () => {
  it('the scenario: handed as they are, only the update filed under the project\'s own name is kept', () => {
    expect(inTruth(ALL)).toEqual(['u-campus']);
  });

  it('by the parent kept on the update, and by its task (shown or hidden), it is the project\'s', () => {
    const taken = daveProjectTruthUpdatesFor({ projectName: 'Campus', updates: ALL, scheduleItems: SHOWN, knownScheduleItems: [...SHOWN, HIDDEN, OTHER] });
    expect(taken.filter(entry => entry.projectName === 'Campus').map(entry => entry.id).sort()).toEqual(['u-campus', 'u-hidden-task', 'u-parent', 'u-task']);
    expect(inTruth(taken)).toEqual(['u-campus', 'u-hidden-task', 'u-parent', 'u-task']);
  });

  it('a building name with nothing else, and another project\'s task, stay as they were', () => {
    const taken = daveProjectTruthUpdatesFor({ projectName: 'Campus', updates: ALL, scheduleItems: SHOWN, knownScheduleItems: [...SHOWN, HIDDEN, OTHER] });
    expect(taken.find(entry => entry.id === 'u-name-only')).toBe(nameOnly);
    expect(taken.find(entry => entry.id === 'u-other')).toBe(ofOtherProject);
    // Nothing else of an update is touched.
    expect(taken.find(entry => entry.id === 'u-task')).toEqual({ ...onShownTask, projectName: 'Campus' });
    expect(taken.find(entry => entry.id === 'u-campus')).toBe(underItsName);
  });

  it('the other project is not handed Campus\'s updates', () => {
    const taken = daveProjectTruthUpdatesFor({ projectName: 'Harbor', updates: ALL, scheduleItems: [OTHER], knownScheduleItems: [...SHOWN, HIDDEN, OTHER] });
    expect(taken.filter(entry => entry.projectName === 'Harbor').map(entry => entry.id)).toEqual(['u-other']);
  });

  it('the saved Project Truth is built from them, for a project only (not for the combined portfolio or a name that is no project)', () => {
    const provider = fs.readFileSync(path.resolve(__dirname, '../..', 'providers/PIELiveAuthorityProvider.tsx'), 'utf8');
    expect(provider).toMatch(/updates: \(truthInput\.projectTruthPersistencePolicy \|\| 'persist_project'\) === 'persist_project'\n\s+\? daveProjectTruthUpdatesFor\(\{\n\s+projectName: truthInput\.projectName,\n\s+updates: truthInput\.updates,\n\s+scheduleItems: truthInput\.scheduleItems,\n\s+knownScheduleItems: truthInput\.knownScheduleItems,\n\s+\}\)\n\s+: truthInput\.updates,/);
  });
});
