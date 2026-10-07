import {
  buildDAVEWebScheduleItem,
  daveWebTaskProjectRepair,
  daveWebTaskProjectRepairedNotice,
  type DAVEWebProjectListing,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';
import {
  buildOperationalProjectIdentityAuthority,
  resolveOperationalProjectIdentity,
} from '../../services/OperationalProjectIdentity';

// Open item, web batch WS1 item 6 (6 Oct 2026). Before whole-app audit A3
// pass 9 M1 the web's Tasks page could save a task of Lot 9 under the name
// "2375 Main St" with Lot 9's cloud id. That save was stopped; the tasks it
// had already written were not repaired: the phone refuses every upload of
// one ("project name and cloud identity disagree"). The web's next save of
// such a task puts its name back to the project its cloud id names: never a
// project chosen from the name, and only when the id names exactly one open
// project. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const LOT_9_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const MAIN_ST_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
/** The schedule the task was imported from, approved for Lot 9. */
const LOT_9_SCHEDULE = { importBatchId: 'batch-lot9', projectName: 'Lot 9', projectNames: ['Lot 9'] };
const OPEN: DAVEWebProjectListing = {
  projects: [{ id: LOT_9_ID, name: 'Lot 9' }, { id: MAIN_ST_ID, name: '2375 Main St' }],
  openCloudProjects: [{ id: LOT_9_ID, name: 'Lot 9' }, { id: MAIN_ST_ID, name: '2375 Main St' }],
  referenceDocuments: [LOT_9_SCHEDULE],
};
const NOW = '2026-10-06T18:00:00.000Z';

/** A task Lot 9's schedule brought, as the old Tasks page save left it: 2375 Main St's name in both places, Lot 9's cloud id. */
function mismatched(extra: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    importBatchId: 'batch-lot9',
    importedFrom: 'Lot 9 schedule.csv',
    id: 'stripe',
    projectId: LOT_9_ID,
    itemType: 'Task',
    scheduleProjectName: '2375 Main St',
    projectName: '2375 Main St',
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: 'Stripe parking',
    startDate: '10/05/2026',
    finishDate: '10/09/2026',
    milestone: '',
    owner: 'PM',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activity: [],
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
    cloudUpdatedAt: '2026-07-24T12:00:01.000Z',
    ...extra,
  };
}

/** The form's draft: the task as it shows, with one other field changed. */
const draftOf = (current: DAVEWebScheduleItem): DAVEWebTaskDraft => ({
  projectId: current.projectId,
  itemType: 'Task',
  taskName: current.taskName,
  projectName: current.scheduleProjectName || current.projectName,
  locationName: 'South Lot',
  startDate: current.startDate,
  finishDate: current.finishDate,
  milestone: '',
  owner: 'PM',
  contractor: '',
  percentComplete: 0,
  priority: 'Medium',
  status: 'Not Started',
  notes: '',
  nextAction: '',
  activityMessage: '',
});
const save = (current: DAVEWebScheduleItem, projects?: DAVEWebProjectListing | null) =>
  buildDAVEWebScheduleItem({ draft: draftOf(current), current, id: current.id, now: NOW, actor: 'david@example.com', projects });
const project = (item: DAVEWebScheduleItem) => [item.projectName, item.scheduleProjectName, item.projectId];
/** The phone's own check before it uploads a task. */
const phoneAccepts = (item: DAVEWebScheduleItem) =>
  resolveOperationalProjectIdentity(item, buildOperationalProjectIdentityAuthority(OPEN.openCloudProjects!)).ok;

describe('a task saved earlier under another project\'s name is repaired by the web\'s next save of it (WS1 item 6)', () => {
  it('the name goes back to the project its cloud id names, the id is not touched, and the phone will upload it again', () => {
    expect(phoneAccepts(mismatched())).toBe(false);
    const saved = save(mismatched(), OPEN);
    expect(project(saved)).toEqual(['Lot 9', 'Lot 9', LOT_9_ID]);
    expect(saved.locationName).toBe('South Lot');
    expect(phoneAccepts(saved)).toBe(true);
  });

  it('a schedule\'s own project name that is not the wrong name stays', () => {
    const saved = save(mismatched({ scheduleProjectName: 'Lot 9 schedule' }), OPEN);
    expect(project(saved)).toEqual(['Lot 9', 'Lot 9 schedule', LOT_9_ID]);
  });

  it('he is told, in plain words', () => {
    const before = mismatched();
    expect(daveWebTaskProjectRepairedNotice(before, save(before, OPEN))).toBe(
      ' This task was saved under “2375 Main St” by mistake: it belongs to “Lot 9” in the cloud, so it is now listed under “Lot 9” and your iPhone and iPad can sync it again.',
    );
    expect(daveWebTaskProjectRepairedNotice(before, save(before, null))).toBe('');
  });

  it('never by guessing: an id that names no open project repairs nothing', () => {
    const closed: DAVEWebProjectListing = { ...OPEN, projects: [{ id: MAIN_ST_ID, name: '2375 Main St' }], openCloudProjects: [{ id: MAIN_ST_ID, name: '2375 Main St' }] };
    expect(daveWebTaskProjectRepair(mismatched(), closed)).toBeNull();
    expect(project(save(mismatched(), closed))).toEqual(['2375 Main St', '2375 Main St', LOT_9_ID]);
  });

  it('never by guessing: a list that gives the id two names repairs nothing', () => {
    const twoNames: DAVEWebProjectListing = { ...OPEN, projects: [], openCloudProjects: [{ id: LOT_9_ID, name: 'Lot 9' }, { id: LOT_9_ID, name: 'Lot Nine' }] };
    expect(daveWebTaskProjectRepair(mismatched(), twoNames)).toBeNull();
    expect(project(save(mismatched(), twoNames))).toEqual(['2375 Main St', '2375 Main St', LOT_9_ID]);
  });

  it('guard: never the other way: the cloud id is never changed to fit the name, whatever the list holds', () => {
    [OPEN, { projects: OPEN.projects, referenceDocuments: OPEN.referenceDocuments }, null].forEach(listing => {
      expect(save(mismatched(), listing).projectId).toBe(LOT_9_ID);
    });
  });

  it('the project list without the cloud\'s own rows is used the same way', () => {
    expect(project(save(mismatched(), { projects: OPEN.projects, referenceDocuments: OPEN.referenceDocuments }))).toEqual(['Lot 9', 'Lot 9', LOT_9_ID]);
    // A closed project in that list names nothing.
    expect(daveWebTaskProjectRepair(mismatched(), { projects: [{ id: LOT_9_ID, name: 'Lot 9', archived: true }], referenceDocuments: OPEN.referenceDocuments })).toBeNull();
  });

  // WS2 item 6 (the coordinator's decision): the id decides only where an import says the id is right.
  it('a task made in the Schedule Builder (no import) is never changed: it may carry the right name and a copied wrong id', () => {
    const builderMade = mismatched({ importBatchId: null, importedFrom: null });
    expect(daveWebTaskProjectRepair(builderMade, OPEN)).toBeNull();
    const saved = save(builderMade, OPEN);
    expect(project(saved)).toEqual(['2375 Main St', '2375 Main St', LOT_9_ID]);
    expect(daveWebTaskProjectRepairedNotice(builderMade, saved)).toBe('');
  });

  it('an imported task whose schedule is no longer saved is not changed: nothing says which project the file was for', () => {
    expect(daveWebTaskProjectRepair(mismatched(), { ...OPEN, referenceDocuments: [] })).toBeNull();
    expect(daveWebTaskProjectRepair(mismatched(), { ...OPEN, referenceDocuments: undefined })).toBeNull();
    expect(project(save(mismatched(), { ...OPEN, referenceDocuments: [] }))).toEqual(['2375 Main St', '2375 Main St', LOT_9_ID]);
  });

  it('an imported task whose schedule was approved for both projects is not changed: either could be meant', () => {
    const combined = { importBatchId: 'batch-lot9', projectName: null, projectNames: ['Lot 9', '2375 Main St'] };
    expect(daveWebTaskProjectRepair(mismatched(), { ...OPEN, referenceDocuments: [combined] })).toBeNull();
  });

  it('an imported task whose schedule was not approved for the project its id names is not changed', () => {
    const other = { importBatchId: 'batch-lot9', projectName: 'Harbor North', projectNames: ['Harbor North'] };
    expect(daveWebTaskProjectRepair(mismatched(), { ...OPEN, referenceDocuments: [other] })).toBeNull();
    // Nor by another import's schedule.
    expect(daveWebTaskProjectRepair(mismatched(), { ...OPEN, referenceDocuments: [{ ...LOT_9_SCHEDULE, importBatchId: 'batch-other' }] })).toBeNull();
  });

  it('guard: a task a later schedule also contains is repaired by that schedule too', () => {
    const rehomed = mismatched({ importBatchId: 'batch-gone', alsoImportedInBatchIds: ['batch-lot9'] });
    expect(project(save(rehomed, OPEN))).toEqual(['Lot 9', 'Lot 9', LOT_9_ID]);
  });

  it('guard: a task whose name is its id\'s project, however it is written, is saved as stored', () => {
    const right = mismatched({ projectName: 'lot 9 ', scheduleProjectName: 'Lot 9 schedule' });
    expect(daveWebTaskProjectRepair(right, OPEN)).toBeNull();
    expect(project(save(right, OPEN))).toEqual(['lot 9 ', 'Lot 9 schedule', LOT_9_ID]);
  });

  it('guard: with no project list the save is as before', () => {
    expect(project(save(mismatched()))).toEqual(['2375 Main St', '2375 Main St', LOT_9_ID]);
  });

  it('guard: a new task is not touched by the repair', () => {
    const created = buildDAVEWebScheduleItem({
      draft: { ...draftOf(mismatched()), projectId: MAIN_ST_ID, projectName: '2375 Main St' },
      id: 'new-task', now: NOW, actor: 'david@example.com', projects: OPEN,
    });
    expect(project(created)).toEqual(['2375 Main St', '2375 Main St', MAIN_ST_ID]);
  });
});
