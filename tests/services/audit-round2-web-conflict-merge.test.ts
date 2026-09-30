import {
  buildDAVEWebScheduleItem,
  mergeDAVEWebConflictDraft,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';
import { emptyProjectControls } from '../../services/VitruviusProjectControls';

// Whole-app audit round 2 F4 (30 Sep 2026): "Apply My Changes" after a save
// conflict laid the whole form (the version the owner opened) over the
// phone's newer version, so the phone's 60% and note went back to 40% and
// the old note. Only the fields the owner changed are applied now.

const OPENED_AT = '2026-09-30T14:00:00.000Z';
const PHONE_SAVED_AT = '2026-09-30T14:05:00.000Z';
const APPLIED_AT = '2026-09-30T14:10:00.000Z';

const opened: DAVEWebScheduleItem = {
  id: 'task-1',
  projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
  itemType: 'Task',
  scheduleProjectName: '2321 Compliance Project',
  projectName: '2321 Compliance Project',
  projectTimeZone: 'America/Los_Angeles',
  locationName: 'North Lot',
  taskName: 'Place asphalt',
  startDate: '2026-09-28',
  finishDate: '2026-10-02',
  milestone: '',
  owner: 'Project manager',
  contractor: 'Paving Crew',
  durationDays: 5,
  percentComplete: 40,
  progressSource: 'project_manager',
  progressConfirmedAt: OPENED_AT,
  progressConfirmedBy: 'pm@example.com',
  priority: 'High',
  status: 'In Progress',
  notes: 'Old note',
  nextAction: 'Confirm mix design',
  activity: [],
  projectControls: {
    ...emptyProjectControls(),
    assignee: 'pm@example.com',
    trade: 'Paving',
    revision: 1,
    updatedAt: OPENED_AT,
    updatedBy: 'pm@example.com',
  },
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: OPENED_AT,
  cloudUpdatedAt: '2026-09-30T14:00:01.000Z',
};

// The phone saved 60% with a new note while the web form was open.
const phone: DAVEWebScheduleItem = {
  ...opened,
  percentComplete: 60,
  progressConfirmedAt: PHONE_SAVED_AT,
  progressConfirmedBy: 'field@example.com',
  notes: 'Phone note: north half paved',
  updatedAt: PHONE_SAVED_AT,
  cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
};

/** What the web task form submits for a task with no edits (taskFormState). */
function formFor(task: DAVEWebScheduleItem): DAVEWebTaskDraft {
  return {
    itemType: task.itemType ?? 'Task',
    taskName: task.taskName,
    projectName: task.scheduleProjectName || task.projectName,
    locationName: task.locationName,
    startDate: task.startDate,
    finishDate: task.finishDate,
    milestone: task.milestone ?? '',
    owner: task.owner,
    contractor: task.contractor,
    percentComplete: task.percentComplete,
    priority: task.priority,
    status: task.status,
    notes: task.notes,
    nextAction: task.nextAction ?? '',
    activityMessage: '',
    projectControls: task.projectControls ?? null,
  };
}

function applyMyChanges(
  draft: DAVEWebTaskDraft,
  latest: DAVEWebScheduleItem = phone,
): DAVEWebScheduleItem {
  return buildDAVEWebScheduleItem({
    draft: mergeDAVEWebConflictDraft({
      draft,
      base: opened,
      latest,
      now: APPLIED_AT,
      actor: 'pm@example.com',
    }),
    current: latest,
    id: latest.id,
    now: APPLIED_AT,
    actor: 'pm@example.com',
  });
}

describe('Apply My Changes after a save conflict (audit round 2 F4)', () => {
  test('an owner-only change keeps the phone’s newer progress, its confirmation time, and its note', () => {
    const saved = applyMyChanges({ ...formFor(opened), owner: 'Dana Ruiz' });

    expect(saved).toMatchObject({
      owner: 'Dana Ruiz',
      percentComplete: 60,
      status: 'In Progress',
      progressConfirmedAt: PHONE_SAVED_AT,
      progressConfirmedBy: 'field@example.com',
      notes: 'Phone note: north half paved',
      // The write is checked against the phone's revision.
      cloudUpdatedAt: phone.cloudUpdatedAt,
    });
  });

  test('when both changed progress, the owner’s value wins and is confirmed now', () => {
    const saved = applyMyChanges({
      ...formFor(opened),
      percentComplete: 80,
      notes: 'Web note',
    });

    expect(saved).toMatchObject({
      percentComplete: 80,
      status: 'In Progress',
      progressConfirmedAt: APPLIED_AT,
      progressConfirmedBy: 'pm@example.com',
      notes: 'Web note',
    });
  });

  test('a status-only change keeps the phone’s percent', () => {
    const saved = applyMyChanges({ ...formFor(opened), status: 'Waiting' });

    expect(saved).toMatchObject({ status: 'Waiting', percentComplete: 60 });
  });

  test('fields the owner did not change keep every value the other device saved', () => {
    const latest: DAVEWebScheduleItem = {
      ...phone,
      taskName: 'Place asphalt — north half',
      locationName: 'North Lot east',
      finishDate: '2026-10-05',
      contractor: 'Paving Crew B',
      priority: 'Low',
      nextAction: 'Order second lift',
      milestone: 'Paving complete',
      wbsCode: '2.4',
      dependencies: [{ predecessorItemId: 'grading', type: 'FS', lagDays: 1 }],
      projectControls: {
        ...opened.projectControls!,
        trade: 'Asphalt paving',
        revision: 2,
        updatedAt: PHONE_SAVED_AT,
        updatedBy: 'field@example.com',
        fieldRevisions: {
          trade: { revision: 1, updatedAt: PHONE_SAVED_AT, updatedBy: 'field@example.com' },
        },
      },
    };

    const saved = applyMyChanges({ ...formFor(opened), contractor: 'Paving Crew' }, latest);

    expect(saved).toMatchObject({
      taskName: 'Place asphalt — north half',
      locationName: 'North Lot east',
      finishDate: '2026-10-05',
      contractor: 'Paving Crew B',
      priority: 'Low',
      nextAction: 'Order second lift',
      milestone: 'Paving complete',
      wbsCode: '2.4',
      dependencies: [{ predecessorItemId: 'grading', type: 'FS', lagDays: 1 }],
      percentComplete: 60,
      notes: 'Phone note: north half paved',
      progressConfirmedAt: PHONE_SAVED_AT,
    });
    expect(saved.projectControls).toMatchObject({
      assignee: 'pm@example.com',
      trade: 'Asphalt paving',
      revision: 2,
    });
  });

  test('project controls are merged field by field; a field both changed takes the owner’s value', () => {
    const latest: DAVEWebScheduleItem = {
      ...phone,
      projectControls: {
        ...opened.projectControls!,
        trade: 'Asphalt paving',
        referenceNumber: 'RFI-7',
        revision: 2,
        updatedAt: PHONE_SAVED_AT,
        updatedBy: 'field@example.com',
      },
    };

    const saved = applyMyChanges({
      ...formFor(opened),
      projectControls: {
        ...opened.projectControls!,
        assignee: 'dana@example.com',
        referenceNumber: 'RFI-8',
      },
    }, latest);

    expect(saved.projectControls).toMatchObject({
      assignee: 'dana@example.com',
      trade: 'Asphalt paving',
      referenceNumber: 'RFI-8',
      updatedAt: APPLIED_AT,
      fieldRevisions: {
        assignee: expect.objectContaining({ updatedAt: APPLIED_AT }),
        referenceNumber: expect.objectContaining({ updatedAt: APPLIED_AT }),
      },
    });
    expect(saved.projectControls?.fieldRevisions?.trade).toBeUndefined();
  });

  test('when both changed the same text field, the owner’s value wins', () => {
    const saved = applyMyChanges({ ...formFor(opened), notes: 'Web note' });

    expect(saved.notes).toBe('Web note');
    expect(saved.percentComplete).toBe(60);
  });
});
