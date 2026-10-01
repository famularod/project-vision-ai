/**
 * Whole-app audit A12 pass 4 M1 (30 Sep 2026). Every web save of a task
 * marked its progress as the project manager's, confirmed by the signed-in
 * email at that moment, even when David changed only the area. An imported
 * Pour slab at 100% then read as David's own verified completion: "Pour slab
 * was verified complete." The phone only marks progress as the manager's
 * when the percent or status itself changed (App.tsx updateScheduleItem).
 *
 * Now the web does the same: a save that leaves the percent and status alone
 * keeps the task's progress source, confirmer and confirmation time exactly
 * as they were (absent stays absent), on a normal save and on Apply My
 * Changes. A percent or status David changes on the web is still his.
 * Checked through the real summaries (DAVE evidence correlation and Project
 * Truth). Synthetic schedule text only.
 */
import { buildDAVEEvidenceCorrelations } from '../../services/DAVEEvidenceCorrelation';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVEWebScheduleItem,
  mergeDAVEWebConflictDraft,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';
import { SCHEDULE_FILE_PROGRESS_CONFIRMER } from '../../services/ScheduleProgressInvariant';

const PROJECT = 'Alpha Tower';
const IMPORTED_AT = '2026-09-01T09:00:00.000Z';
const OPENED_AT = '2026-09-30T14:00:00.000Z';
const SAVED_AT = '2026-09-30T15:00:00.000Z';
const NOW = '2026-09-30T16:00:00.000Z';
const ACTOR = 'pm@example.com';

/** Pour slab as a schedule file brought it in: 100%, never touched by David. */
const imported: DAVEWebScheduleItem = {
  id: 'pour-slab',
  projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
  itemType: 'Task',
  scheduleProjectName: PROJECT,
  projectName: PROJECT,
  projectTimeZone: 'America/Los_Angeles',
  locationName: 'Level 1',
  taskName: 'Pour slab',
  startDate: '09/14/2026',
  finishDate: '09/18/2026',
  milestone: '',
  owner: 'Concrete crew',
  contractor: 'Ready Mix Co',
  durationDays: 5,
  percentComplete: 100,
  // How the web reads a task the file set: no manager marking.
  progressSource: null,
  progressConfirmedAt: null,
  progressConfirmedBy: null,
  priority: 'Medium',
  status: 'Complete',
  notes: '',
  nextAction: '',
  activity: [],
  importedFrom: 'MASTER UPDATE 8312026.pdf',
  importedAt: IMPORTED_AT,
  importBatchId: 'batch-master-update',
  sourceDocumentId: 'doc-master-update',
  createdAt: IMPORTED_AT,
  updatedAt: OPENED_AT,
  cloudUpdatedAt: '2026-09-30T14:00:01.000Z',
};

/** The form as both web editors fill it from a task, with `changes` typed in. */
function draftOf(task: DAVEWebScheduleItem, changes: Partial<DAVEWebTaskDraft> = {}): DAVEWebTaskDraft {
  return {
    projectId: task.projectId,
    itemType: task.itemType ?? 'Task',
    taskName: task.taskName,
    projectName: task.scheduleProjectName || task.projectName,
    locationName: task.locationName,
    startDate: task.startDate,
    finishDate: task.finishDate,
    milestone: task.milestone,
    owner: task.owner,
    contractor: task.contractor,
    percentComplete: String(task.percentComplete),
    priority: task.priority ?? 'Medium',
    status: task.status,
    notes: task.notes,
    nextAction: task.nextAction ?? '',
    activityMessage: '',
    projectControls: task.projectControls ?? null,
    ...changes,
  };
}

function save(task: DAVEWebScheduleItem, changes: Partial<DAVEWebTaskDraft>, now = NOW) {
  return buildDAVEWebScheduleItem({ draft: draftOf(task, changes), current: task, id: task.id, now, actor: ACTOR });
}

function correlation(item: DAVEWebScheduleItem) {
  return buildDAVEEvidenceCorrelations({ scheduleItems: [item], now: NOW }).tasks[0];
}

function whatChanged(item: DAVEWebScheduleItem) {
  return buildDAVEProjectTruth({
    projectId: 'project-alpha',
    projectName: PROJECT,
    updates: [],
    scheduleItems: [item],
    referenceDocuments: [],
    now: NOW,
  }).briefing.whatChanged;
}

const provenance = (item: DAVEWebScheduleItem) => ({
  progressSource: item.progressSource,
  progressConfirmedAt: item.progressConfirmedAt,
  progressConfirmedBy: item.progressConfirmedBy,
});

describe('a web edit that leaves progress alone keeps whose progress it is (A12 pass 4 M1)', () => {
  test('Pour slab: an area-only edit keeps the file’s 100% as the schedule’s', () => {
    expect(correlation(imported).conclusion).toBe('schedule_only');

    const edited = save(imported, { locationName: 'Level 1 East' });

    expect(edited).toMatchObject({ locationName: 'Level 1 East', percentComplete: 100, status: 'Complete' });
    expect(provenance(edited)).toEqual(provenance(imported));
    expect(correlation(edited)).toMatchObject({
      conclusion: 'schedule_only',
      explanation: 'The current schedule records this task complete at 100%.',
      evidence: [expect.objectContaining({ kind: 'schedule', authority: 'schedule' })],
    });
    expect(whatChanged(edited)).not.toContain('Pour slab was verified complete.');
    expect(JSON.stringify(correlation(edited))).not.toMatch(/project manager stated|pm@example\.com recorded/i);
  });

  test('a task stored without any marking keeps it absent', () => {
    const {
      progressSource: _source,
      progressConfirmedAt: _at,
      progressConfirmedBy: _by,
      ...unmarked
    } = imported;
    const edited = save(unmarked as DAVEWebScheduleItem, { notes: 'Cure blankets on.' });

    expect(edited).not.toHaveProperty('progressSource');
    expect(edited).not.toHaveProperty('progressConfirmedAt');
    expect(edited).not.toHaveProperty('progressConfirmedBy');
    expect(correlation(edited).conclusion).toBe('schedule_only');
  });

  test('a task the schedule file raised keeps "Schedule update" and its time', () => {
    const raised: DAVEWebScheduleItem = {
      ...imported,
      progressSource: 'project_manager',
      progressConfirmedBy: SCHEDULE_FILE_PROGRESS_CONFIRMER,
      progressConfirmedAt: IMPORTED_AT,
    };
    const edited = save(raised, { owner: 'Dana Ruiz', locationName: 'Level 1 East' });

    expect(provenance(edited)).toEqual(provenance(raised));
    expect(correlation(edited).conclusion).toBe('schedule_only');
  });

  test('Apply My Changes on an area-only edit keeps the other device’s marking', () => {
    // The phone saved a note while the web was open on the imported version.
    const latest: DAVEWebScheduleItem = {
      ...imported,
      notes: 'Phone note: slab poured',
      updatedAt: SAVED_AT,
      cloudUpdatedAt: '2026-09-30T15:00:01.000Z',
    };
    const draft = mergeDAVEWebConflictDraft({
      draft: draftOf(imported, { locationName: 'Level 1 East' }),
      base: imported,
      latest,
      now: NOW,
      actor: ACTOR,
    });
    const applied = buildDAVEWebScheduleItem({ draft, current: latest, id: latest.id, now: NOW, actor: ACTOR });

    expect(applied).toMatchObject({ locationName: 'Level 1 East', notes: 'Phone note: slab poured' });
    expect(provenance(applied)).toEqual(provenance(latest));
    expect(correlation(applied).conclusion).toBe('schedule_only');
  });

  test('a stored 99.6% read as 100% is not a change David made', () => {
    const fractional = { ...imported, percentComplete: 99.6, status: 'In Progress' as const };
    const edited = save(fractional, { locationName: 'Level 1 East' });

    expect(provenance(edited)).toEqual(provenance(fractional));
  });
});

describe('progress David changes on the web is still his (A12 pass 4 M1)', () => {
  const atSixty: DAVEWebScheduleItem = { ...imported, percentComplete: 60, status: 'In Progress' };

  test('setting the file’s 60% to 100% on the web is his verified completion', () => {
    expect(correlation(atSixty).conclusion).toBe('schedule_only');

    const edited = save(atSixty, { percentComplete: '100' });

    expect(edited).toMatchObject({
      percentComplete: 100,
      status: 'Complete',
      progressSource: 'project_manager',
      progressConfirmedAt: NOW,
      progressConfirmedBy: ACTOR,
    });
    expect(correlation(edited)).toMatchObject({
      conclusion: 'verified_complete',
      explanation: 'A project manager stated that the work was completed. That statement is the authoritative completion evidence.',
    });
    expect(whatChanged(edited)).toContain('Pour slab was verified complete.');
  });

  test('changing only the status counts as his change too', () => {
    const edited = save(atSixty, { status: 'Waiting' });

    expect(edited).toMatchObject({
      status: 'Waiting',
      percentComplete: 60,
      progressSource: 'project_manager',
      progressConfirmedAt: NOW,
      progressConfirmedBy: ACTOR,
    });
    expect(correlation(edited).explanation)
      .toBe('A project manager recorded waiting at 60% complete. That professional judgment is the current progress evidence.');
  });

  test('a percent he changed wins on Apply My Changes and is marked his', () => {
    const latest: DAVEWebScheduleItem = { ...atSixty, notes: 'Phone note', updatedAt: SAVED_AT };
    const draft = mergeDAVEWebConflictDraft({
      draft: draftOf(atSixty, { percentComplete: '80' }),
      base: atSixty,
      latest,
      now: NOW,
      actor: ACTOR,
    });
    const applied = buildDAVEWebScheduleItem({ draft, current: latest, id: latest.id, now: NOW, actor: ACTOR });

    expect(applied).toMatchObject({
      percentComplete: 80,
      notes: 'Phone note',
      progressSource: 'project_manager',
      progressConfirmedAt: NOW,
      progressConfirmedBy: ACTOR,
    });
  });

  test('a new web item is the manager’s, as before', () => {
    const created = buildDAVEWebScheduleItem({
      draft: draftOf(imported, { taskName: 'Strip forms', percentComplete: '0', status: 'Not Started' }),
      id: 'strip-forms',
      now: NOW,
      actor: ACTOR,
    });
    expect(provenance(created)).toEqual({
      progressSource: 'project_manager',
      progressConfirmedAt: NOW,
      progressConfirmedBy: ACTOR,
    });
  });
});
