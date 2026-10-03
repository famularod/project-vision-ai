import {
  buildDAVEWebScheduleItem,
  daveWebScheduleDateForSave,
  daveWebScheduleDatesMatch,
  mergeDAVEWebConflictDraft,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';

// Whole-app audit A12 pass 3 M1 and M2 (30 Sep 2026): the web's date inputs
// hold 2026-10-05 while files and the phone store 10/05/2026. "Apply My
// Changes" compared the two as text, so an untouched date counted as the
// owner's change and put back the dates the phone had just moved; and every
// builder save rewrote dates as 2026-10-05.

const opened: DAVEWebScheduleItem = {
  id: 'task-1',
  projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
  itemType: 'Task',
  scheduleProjectName: 'Alpha',
  projectName: 'Alpha',
  projectTimeZone: 'America/Los_Angeles',
  locationName: 'North Lot',
  taskName: 'Place asphalt',
  startDate: '10/05/2026',
  finishDate: '10/09/2026',
  baselineStartDate: '10/05/2026',
  baselineFinishDate: '10/09/2026',
  milestone: '',
  owner: 'Project manager',
  contractor: '',
  durationDays: 5,
  percentComplete: 0,
  progressSource: 'project_manager',
  progressConfirmedAt: '2026-09-30T14:00:00.000Z',
  progressConfirmedBy: 'pm@example.com',
  priority: 'Medium',
  status: 'Not Started',
  notes: '',
  nextAction: '',
  activity: [],
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-30T14:00:00.000Z',
  cloudUpdatedAt: '2026-09-30T14:00:01.000Z',
};

const phone: DAVEWebScheduleItem = {
  ...opened,
  startDate: '10/12/2026',
  finishDate: '10/16/2026',
  baselineStartDate: '10/06/2026',
  baselineFinishDate: '10/10/2026',
  cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
};

/** The builder's draft: dates as the browser's date inputs hold them. */
function builderDraft(overrides: Partial<DAVEWebTaskDraft> = {}): DAVEWebTaskDraft {
  return {
    projectId: opened.projectId,
    itemType: 'Task',
    taskName: opened.taskName,
    projectName: 'Alpha',
    locationName: 'South Yard',
    startDate: '2026-10-05',
    finishDate: '2026-10-09',
    milestone: '',
    owner: opened.owner,
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activityMessage: '',
    baselineStartDate: '2026-10-05',
    baselineFinishDate: '2026-10-09',
    ...overrides,
  };
}

function applyMyChanges(draft: DAVEWebTaskDraft) {
  return buildDAVEWebScheduleItem({
    draft: mergeDAVEWebConflictDraft({
      draft,
      base: opened,
      latest: phone,
      now: '2026-09-30T14:10:00.000Z',
      actor: 'pm@example.com',
    }),
    current: phone,
    id: phone.id,
    now: '2026-09-30T14:10:00.000Z',
    actor: 'pm@example.com',
  });
}

describe('Apply My Changes compares dates by calendar day (A12 pass 3 M1)', () => {
  test('2026-10-05 in the form is the same day as a stored 10/05/2026: the phone’s dates stay', () => {
    expect(applyMyChanges(builderDraft())).toMatchObject({
      locationName: 'South Yard',
      startDate: '10/12/2026',
      finishDate: '10/16/2026',
      baselineStartDate: '10/06/2026',
      baselineFinishDate: '10/10/2026',
    });
  });

  test('a date the owner did change is still his', () => {
    expect(applyMyChanges(builderDraft({
      finishDate: '2026-10-20',
      baselineStartDate: '2026-10-01',
    }))).toMatchObject({
      startDate: '10/12/2026',
      finishDate: '2026-10-20',
      baselineStartDate: '2026-10-01',
      baselineFinishDate: '10/10/2026',
    });
  });

  test('a cleared baseline is a change', () => {
    expect(applyMyChanges(builderDraft({ baselineStartDate: '', baselineFinishDate: '' })))
      .toMatchObject({ baselineStartDate: null, baselineFinishDate: null });
  });
});

describe('dates are saved in the format the task already has (A12 pass 3 M2)', () => {
  test('the same calendar day in any written form matches', () => {
    expect(daveWebScheduleDatesMatch('2026-10-05', '10/05/2026')).toBe(true);
    expect(daveWebScheduleDatesMatch('10/5/2026', 'Oct 5, 2026')).toBe(true);
    expect(daveWebScheduleDatesMatch('', null)).toBe(true);
    expect(daveWebScheduleDatesMatch('2026-10-05', '10/06/2026')).toBe(false);
    expect(daveWebScheduleDatesMatch('', '10/05/2026')).toBe(false);
  });

  test('an unchanged day keeps its exact stored text', () => {
    expect(daveWebScheduleDateForSave('2026-10-05', '10/05/2026')).toBe('10/05/2026');
    expect(daveWebScheduleDateForSave('2026-07-24', 'Jul 24, 2026')).toBe('Jul 24, 2026');
  });

  test('a changed day takes the task’s format; a new or undated item takes MM/DD/YYYY', () => {
    expect(daveWebScheduleDateForSave('2026-10-07', '10/05/2026')).toBe('10/07/2026');
    expect(daveWebScheduleDateForSave('2026-10-07', '2026-10-05')).toBe('2026-10-07');
    expect(daveWebScheduleDateForSave('2026-10-07', null)).toBe('10/07/2026');
    // An empty baseline follows the task's other dates.
    expect(daveWebScheduleDateForSave('2026-10-07', '', ['2026-10-05'])).toBe('2026-10-07');
    expect(daveWebScheduleDateForSave('2026-10-07', '', ['10/05/2026'])).toBe('10/07/2026');
    expect(daveWebScheduleDateForSave('', '10/05/2026')).toBe('');
  });
});
