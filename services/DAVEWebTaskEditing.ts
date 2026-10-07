import type {
  ProjectItemType,
  ProjectControls,
  ScheduleDependency,
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
} from '../types';
import {
  reconcileScheduleProgress,
  reconcileScheduleProgressEdit,
} from './ScheduleProgressInvariant';
import {
  appendProjectItemActivity,
  closeProjectItemWorkflow,
  projectItemWorkflowIsClosed,
  reopenProjectItemWorkflow,
  validateProjectItemWorkflowEdit,
} from './ProjectItemWorkflow';
import { normalizeScheduleDependencies } from './VitruviusScheduleEngine';
import { sameScheduleCalendarDay, scheduleCalendarDay } from './ScheduleCalendarDay';
import { scheduleItemAsSaved } from './PIEScheduleReconciliation';
import { scheduleProgressIsManagers } from './ScheduleProgressSource';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import {
  SCHEDULE_DURATION_RANGE_TEXT,
  scheduleDateRangeText,
  scheduleDayIsSupported,
  scheduleDurationIsSupported,
} from './ScheduleInputLimits';
import {
  normalizeProjectControls,
  PROJECT_CONTROL_DATA_FIELDS,
} from './VitruviusProjectControls';

export type DAVEWebScheduleItem = ScheduleItem & Readonly<{
  /** Exact cloud row revision used for optimistic concurrency checks. */
  cloudUpdatedAt: string | null;
}>;

export type DAVEWebTaskDraft = Readonly<{
  /** Immutable cloud project authority required by operational-row writes. */
  projectId?: string | null;
  itemType: ProjectItemType;
  taskName: string;
  projectName: string;
  locationName: string;
  startDate: string;
  finishDate: string;
  milestone: string;
  owner: string;
  contractor: string;
  percentComplete: number | string;
  /**
   * He typed in the form's Percent complete box, and it holds a number (WS1
   * item 5): what it holds is his own entry, also when it is the percent the
   * task already had from a schedule file. Absent or false: the box was left
   * as it opened, or emptied.
   */
  percentEntered?: boolean;
  priority: SchedulePriority;
  status: ScheduleStatus;
  notes: string;
  nextAction: string;
  /** New append-only activity entered during this save. */
  activityMessage: string;
  /** Explicit structured-record transition requested by the workflow control. */
  workflowAction?: 'close' | 'reopen';
  /** Optional planning fields used by the desktop schedule builder. */
  wbsCode?: string;
  parentItemId?: string;
  sortOrder?: number | string | null;
  durationDays?: number | string | null;
  dependencies?: readonly ScheduleDependency[];
  isSummary?: boolean;
  isMilestone?: boolean;
  baselineStartDate?: string;
  baselineFinishDate?: string;
  /** Shared project-control fields edited on desktop or retained from mobile. */
  projectControls?: ProjectControls | null;
}>;

/**
 * Why a web save of an existing task cannot change its project, and what
 * to do instead (whole-app audit A3 pass 9 M1, 30 Sep 2026). Also shown
 * under the project on the Tasks page's Edit Task.
 */
export const DAVE_WEB_TASK_PROJECT_FIXED_TEXT =
  'A task stays in its project. To move it, add it in the right project, then delete it here.';

/** The web's project list, as the signed-in workspace holds it. */
export type DAVEWebProjectListing = Readonly<{
  projects: readonly Readonly<{
    id?: string | null;
    name: string;
    archived?: boolean | null;
  }>[];
  openCloudProjects?: readonly Readonly<{ id: string; name: string }>[];
  /** The schedules saved now: which projects each import was approved for (daveWebTaskProjectRepair, WS2 item 6). */
  referenceDocuments?: readonly Readonly<{
    importBatchId?: string | null;
    projectName?: string | null;
    projectNames?: readonly string[] | null;
  }>[];
}>;

export type DAVEWebNewTaskProjectResult =
  | Readonly<{ ok: true; projectId: string }>
  | Readonly<{ ok: false; message: string }>;

/**
 * The cloud project id a new web task is saved with: the one open cloud
 * project with the task's project name (whole-app audit A12 pass 5 M1,
 * 30 Sep 2026). The Schedule Builder had copied the id of another task in
 * the project, so a project with no tasks could not be started on the web
 * ("Choose a current cloud project before saving this task."), and a
 * project holding one task saved with another project's id passed that
 * wrong id to every new item, which the phone then refused to upload
 * ("project name and cloud identity disagree"). Names are compared as the
 * phone's upload compares them (trimmed, any case). Not exactly one open
 * project of that name: nothing is saved, and he is told why.
 */
export function daveWebNewTaskProjectId(
  listing: DAVEWebProjectListing | null | undefined,
  projectName: string,
): DAVEWebNewTaskProjectResult {
  const name = projectName.trim();
  const key = projectIdentityKey(name);
  // Every open row, two with one name included; the project list (one
  // entry per name) only where the workspace has no such list.
  const rows: DAVEWebProjectListing['projects'] =
    listing?.openCloudProjects ?? listing?.projects ?? [];
  const ids = new Set(
    rows
      .filter(row => !row.archived && projectIdentityKey(row.name) === key)
      .map(row => row.id?.trim() || '')
      .filter(Boolean),
  );
  if (ids.size === 1) return { ok: true, projectId: [...ids][0] };
  return {
    ok: false,
    message: ids.size === 0
      ? `This item was not saved: “${name}” is not one of your open projects in the cloud. Check the project on your iPhone or iPad, then try again.`
      : `This item was not saved: more than one open project is named “${name}”, so Vitruvius cannot tell which one it belongs to. Check your projects on your iPhone or iPad.`,
  };
}

/** As OperationalProjectIdentity compares a row's project name with its id's. */
function projectIdentityKey(value: string | null | undefined): string {
  return (value || '').trim().toLocaleLowerCase('en-US');
}

/**
 * Open item, web batch WS1 item 6 (6 Oct 2026). Before whole-app audit A3
 * pass 9 M1 the Tasks page could save a task under another project's name
 * with its own project's cloud id, and before A12 pass 5 M1 the Schedule
 * Builder copied such an id onto new items. Those saves were stopped, but
 * the tasks already saved that way stayed as they were: the phone refuses
 * every upload of one ("project name and cloud identity disagree"), and Ask
 * ECOS counts it under the project of its id while the web lists it under
 * its name.
 *
 * The repair, made when the web next saves that task: its project NAME is
 * put back to the name of the project its cloud id names. Never the other
 * way (a project is never chosen from a name: that would move the task's
 * cloud row to another project), and only when the id names exactly one
 * open cloud project. An id that names none (the project was closed or
 * deleted), or a list that gives it two names, repairs nothing. The
 * schedule-scope name is repaired with it only when it carried the same
 * wrong name (the old save wrote both); a schedule's own root name stays.
 *
 * WS2 item 6 (the coordinator's decision, 6 Oct 2026): ONLY A TASK THAT CAME
 * FROM AN IMPORT, and only where the import itself says the id is right.
 * Before A12 pass 5 M1 the Schedule Builder copied the cloud id of another
 * task of the project onto a NEW item; where that other task was one of
 * these, the new item carries the RIGHT name and the WRONG id, and a repair
 * by id would move it to a project he did not put it in: worse than a
 * mismatched label. A Builder item cannot be told from a hand-made task the
 * old Tasks page renamed (right id, wrong name): neither row says which
 * screen made it. So a task with no import is never changed. A task an
 * import brought names its import (importBatchId, written only by an
 * import: a new item made on the web has none), and its id was its
 * project's when that file was approved. It is repaired only when a saved
 * schedule of that import still lists the project its id names, and does
 * not also list the name it carries now (a combined schedule for both
 * projects could mean either). An import whose schedule is no longer saved
 * proves nothing: nothing is changed.
 *
 * Null when there is nothing to repair, or nothing that is certain.
 */
export function daveWebTaskProjectRepair(
  current: Pick<ScheduleItem, 'projectId' | 'projectName' | 'scheduleProjectName' | 'importBatchId' | 'alsoImportedInBatchIds'> | null | undefined,
  listing: DAVEWebProjectListing | null | undefined,
): Readonly<{ projectName: string; scheduleProjectName: string }> | null {
  const projectId = current?.projectId?.trim() || '';
  if (!current || !projectId || !listing) return null;
  const rows: DAVEWebProjectListing['projects'] = listing.openCloudProjects ?? listing.projects ?? [];
  const names = new Map(rows
    .filter(row => !row.archived && (row.id?.trim() || '') === projectId && row.name.trim())
    .map(row => [projectIdentityKey(row.name), row.name.trim()] as const));
  if (names.size !== 1) return null;
  const [projectName] = [...names.values()];
  if (projectIdentityKey(current.projectName) === projectIdentityKey(projectName)) return null;
  // Only a task an import brought, whose import was approved for the id's project and not for the name it carries.
  // (A task with no import has no schedule to say so, and is never changed.)
  const batches = new Set(scheduleItemImportBatchIds(current as ScheduleItem).map(projectIdentityKey));
  const approvedFor = (name: string | null | undefined) => (listing.referenceDocuments ?? []).some(document =>
    batches.has(projectIdentityKey(document.importBatchId)) &&
    [document.projectName, ...(document.projectNames ?? [])].some(listed => Boolean(projectIdentityKey(listed)) && projectIdentityKey(listed) === projectIdentityKey(name)));
  if (!approvedFor(projectName) || approvedFor(current.projectName)) return null;
  const scope = current.scheduleProjectName || '';
  return {
    projectName,
    scheduleProjectName: !scope.trim() || projectIdentityKey(scope) === projectIdentityKey(current.projectName) ? projectName : scope,
  };
}

/** What he is told after a save made that repair, or '' (WS1 item 6). */
export function daveWebTaskProjectRepairedNotice(
  before: Pick<ScheduleItem, 'projectName'> | null | undefined,
  saved: Pick<ScheduleItem, 'projectName'>,
): string {
  if (!before || projectIdentityKey(before.projectName) === projectIdentityKey(saved.projectName)) return '';
  return ` This task was saved under “${(before.projectName || '').trim()}” by mistake: it belongs to “${saved.projectName}” in the cloud, so it is now listed under “${saved.projectName}” and your iPhone and iPad can sync it again.`;
}

/** Why a web form's Percent complete box cannot be saved. */
export const DAVE_WEB_PERCENT_RANGE_TEXT = 'Enter a percent from 0 to 100.';

/**
 * The percent a web form's Percent complete box saves (whole-app audit A12
 * pass 5 L1, 30 Sep 2026). An emptied box had saved 0% (Number('') is 0)
 * marked as the project manager's judgment. A blank box now leaves the
 * percent as it was: `stored` (the version the form was opened on), so its
 * source and confirmer are kept too; a new item's form starts at 0. Only a
 * typed number from 0 to 100 changes it ("40" or "40%"); anything else is
 * refused.
 */
export function daveWebPercentFromBox(
  value: string,
  stored: number | null | undefined,
): Readonly<{ ok: true; percentComplete: number }> | Readonly<{ ok: false; message: string }> {
  const text = value.trim();
  if (!text) {
    return {
      ok: true,
      percentComplete: typeof stored === 'number' && Number.isFinite(stored) ? stored : 0,
    };
  }
  const match = /^(\d+(?:\.\d+)?)\s*%?$/.exec(text);
  const percentComplete = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(percentComplete) || percentComplete < 0 || percentComplete > 100) {
    return { ok: false, message: DAVE_WEB_PERCENT_RANGE_TEXT };
  }
  return { ok: true, percentComplete };
}

export class DAVEWebTaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DAVEWebTaskValidationError';
  }
}

export function createDAVEWebTaskId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new DAVEWebTaskValidationError(
      'This browser cannot create a secure task identity. Update the browser and try again.',
    );
  }
  return globalThis.crypto.randomUUID();
}

export function buildDAVEWebScheduleItem({
  draft,
  current = null,
  id,
  now,
  actor,
  projects = null,
}: {
  draft: DAVEWebTaskDraft;
  current?: DAVEWebScheduleItem | null;
  id: string;
  now: string;
  actor: string;
  /**
   * The web's project list, when the page has it: a task saved earlier under
   * a project name that is not its cloud id's is repaired by this save
   * (daveWebTaskProjectRepair, WS1 item 6).
   */
  projects?: DAVEWebProjectListing | null;
}): DAVEWebScheduleItem {
  const taskName = requiredText(draft.taskName, 'Task name');
  const projectName = requiredText(draft.projectName, 'Project');
  // Independent review R08: a duration or a date beyond what the schedule
  // supports is refused here, before a task is built or anything calculated.
  refuseUnsupportedDuration(draft.durationDays);
  refuseUnsupportedDay('Start date', draft.startDate, current?.startDate);
  refuseUnsupportedDay('Finish date', draft.finishDate, current?.finishDate);
  refuseUnsupportedDay('Baseline start', draft.baselineStartDate, current?.baselineStartDate);
  refuseUnsupportedDay('Baseline finish', draft.baselineFinishDate, current?.baselineFinishDate);
  const normalizedDraftProgress = reconcileScheduleProgress(
    draft.status,
    draft.percentComplete,
  );
  const statusChanged = !current || draft.status !== current.status;
  const draftPercentNumber = typeof draft.percentComplete === 'number'
    ? draft.percentComplete
    : Number(draft.percentComplete.replace('%', '').trim());
  const boundedDraftPercent = Number.isFinite(draftPercentNumber)
    ? Math.max(0, Math.min(100, Math.round(draftPercentNumber)))
    : current?.percentComplete;
  const percentChanged = !current || boundedDraftPercent !== current.percentComplete;
  const progress = current
    ? reconcileScheduleProgressEdit(current, {
        ...(statusChanged ? { status: draft.status } : {}),
        ...(percentChanged ? { percentComplete: draft.percentComplete } : {}),
      })
    : normalizedDraftProgress;
  // An existing task keeps its project: its names and its cloud id exactly
  // as stored (whole-app audit A3 pass 9 M1, 30 Sep 2026). The Tasks page
  // had let a task be moved to another project; the save wrote the new name
  // with the old project's cloud id, so the phone refused every upload of it
  // ("project name and cloud identity disagree") and Ask ECOS counted it
  // under the old project. Moving it between projects would also carry its
  // parent phase, predecessors, schedule import and time zone into a
  // project they do not belong to, which is why the Schedule Builder refuses
  // it too.
  const currentProjectNames = [current?.scheduleProjectName, current?.projectName]
    .map(normalized)
    .filter(Boolean);
  const namesCurrentProject = currentProjectNames.includes(normalized(projectName));
  if (current && currentProjectNames.length > 0 && !namesCurrentProject) {
    throw new DAVEWebTaskValidationError(DAVE_WEB_TASK_PROJECT_FIXED_TEXT);
  }
  const keepsCurrentProject = Boolean(current) && namesCurrentProject;
  // A task saved earlier under a name that is not its cloud id's project is put back under that project (WS1 item 6).
  const repaired = daveWebTaskProjectRepair(current, projects);
  const projectNameForRecord = repaired ? repaired.projectName
    : current && keepsCurrentProject
      ? current.projectName
      : projectName;
  const scheduleProjectNameForRecord = repaired ? repaired.scheduleProjectName
    : current && keepsCurrentProject
      ? current.scheduleProjectName || current.projectName
      : projectName;
  // The progress is marked as the project manager's only when this save
  // changes its percent or status, as on the phone. Every web save had
  // marked it, so changing only the area of an imported 100% task made the
  // summaries say it "was verified complete" (whole-app audit A12 pass 4
  // M1, 30 Sep 2026). Compared with the task's own progress as stored
  // (99.6% is 100%), so a value the save only tidies is not a change; an
  // unchanged progress keeps its source, confirmer and time exactly,
  // absent included, and the time David judged a percent given back to him
  // (progressJudgment, whole-app audit A10 pass 5 L1).
  const storedProgress = current
    ? reconcileScheduleProgress(current.status, current.percentComplete)
    : null;
  const progressChangedHere = !storedProgress ||
    storedProgress.status !== progress.status ||
    storedProgress.percentComplete !== progress.percentComplete;
  // Open item, web batch WS1 item 5 (6 Oct 2026): a percent he typed that is the percent the task already held from a
  // schedule file (a master's 60% over his 30%, "Schedule update"; a lookahead's; an import's) was no change, so it
  // stayed the file's: the next file could lower it, and deleting that lookahead with its tasks put his older 30%
  // back, though he had entered 60% himself. A percent he typed is his entry, at the time he saved it. Only when he
  // typed in the box (percentEntered): a save that changes something else still leaves the file's percent the file's
  // (A12 pass 4 M1), and so does an emptied box (A12 pass 5 L1). His own percent typed again is left as it was, with
  // its time; a close or reopen is the workflow's.
  const percentEnteredOverAFiles = Boolean(current) && !progressChangedHere && draft.percentEntered === true &&
    !draft.workflowAction && Number.isFinite(draftPercentNumber) && !scheduleProgressIsManagers(current!);
  const progressEditedHere = progressChangedHere || percentEnteredOverAFiles;
  const progressMarking: Pick<
    ScheduleItem,
    'progressSource' | 'progressConfirmedAt' | 'progressConfirmedBy' | 'progressJudgment'
  > = progressEditedHere || !current
    ? {
        progressSource: 'project_manager',
        progressConfirmedAt: now,
        progressConfirmedBy: actor.trim() || 'Project manager',
      }
    : {
        ...('progressSource' in current ? { progressSource: current.progressSource } : {}),
        ...('progressConfirmedAt' in current ? { progressConfirmedAt: current.progressConfirmedAt } : {}),
        ...('progressConfirmedBy' in current ? { progressConfirmedBy: current.progressConfirmedBy } : {}),
        ...(current.progressJudgment ? { progressJudgment: current.progressJudgment } : {}),
      };
  const activityMessage = draft.activityMessage.trim();
  const activity = draft.workflowAction
    ? [...(current?.activity || [])]
    : appendProjectItemActivity({
        activity: current?.activity,
        message: activityMessage,
        author: actor,
        createdAt: now,
        id: `activity-${now}-${current?.activity?.length ?? 0}`,
      });
  const projectId = current?.projectId?.trim() || draft.projectId?.trim() || null;
  if (!projectId) {
    throw new DAVEWebTaskValidationError(
      'Choose a current cloud project before saving this task.',
    );
  }

  const dependencies = normalizeScheduleDependencies(
    draft.dependencies === undefined ? current?.dependencies : draft.dependencies,
  );
  const linkKeys = (links: readonly { predecessorItemId: string; lagDays?: number | null }[]) =>
    links.map(link => `${link.predecessorItemId}+${link.lagDays ?? 0}`).sort().join('\n');
  const linksChanged = linkKeys(dependencies) !== linkKeys(normalizeScheduleDependencies(current?.dependencies));
  const shownDates = current?.savedLookaheadDates;
  const keepsSavedDates = Boolean(shownDates) &&
    sameScheduleCalendarDay(draft.startDate.trim(), shownDates!.shownStartDate) &&
    sameScheduleCalendarDay(draft.finishDate.trim(), shownDates!.shownFinishDate);

  const item: DAVEWebScheduleItem = {
    id: requiredText(id, 'Task identity'),
    projectId,
    itemType: draft.itemType,
    scheduleProjectName: scheduleProjectNameForRecord,
    projectTimeZone: current?.projectTimeZone ?? null,
    projectName: projectNameForRecord,
    locationName: draft.locationName.trim(),
    taskName,
    // Dates left as shown on a task shown on the master's dates keep the dates saved (owner answer Q25).
    ...(keepsSavedDates && current?.savedLookaheadDates
      ? { startDate: current.savedLookaheadDates.startDate, finishDate: current.savedLookaheadDates.finishDate }
      : { startDate: draft.startDate.trim(), finishDate: draft.finishDate.trim() }),
    milestone: draft.milestone.trim(),
    owner: draft.owner.trim(),
    contractor: draft.contractor.trim(),
    durationDays: optionalPlanningNumber(draft.durationDays, current?.durationDays),
    wbsCode: optionalPlanningText(draft.wbsCode, current?.wbsCode),
    parentItemId: optionalPlanningText(draft.parentItemId, current?.parentItemId),
    sortOrder: optionalPlanningNumber(draft.sortOrder, current?.sortOrder),
    dependencies,
    // When David changed the links by hand: of two rows of one task, the one changed later holds them as the
    // task moves between rows (owner answer Q29).
    ...(linksChanged ? { dependenciesUpdatedAt: now } : current?.dependenciesUpdatedAt ? { dependenciesUpdatedAt: current.dependenciesUpdatedAt } : {}),
    isSummary: draft.isSummary === undefined
      ? current?.isSummary === true
      : draft.isSummary === true,
    isMilestone: draft.isMilestone === undefined
      ? current?.isMilestone === true
      : draft.isMilestone === true,
    baselineStartDate: optionalPlanningText(
      draft.baselineStartDate,
      current?.baselineStartDate,
    ),
    baselineFinishDate: optionalPlanningText(
      draft.baselineFinishDate,
      current?.baselineFinishDate,
    ),
    percentComplete: progress.percentComplete,
    ...progressMarking,
    priority: draft.priority,
    status: progress.status,
    notes: draft.notes.trim(),
    nextAction: draft.nextAction.trim(),
    activity,
    projectControls: normalizeProjectControls(
      draft.projectControls === undefined
        ? current?.projectControls
        : draft.projectControls,
    ),
    importedFrom: current?.importedFrom ?? null,
    importedAt: current?.importedAt ?? null,
    importBatchId: current?.importBatchId ?? null,
    // Kept on a web edit, as the phone keeps it (whole-app audit A5 pass 2).
    ...(current?.alsoImportedInBatchIds?.length ? { alsoImportedInBatchIds: current.alsoImportedInBatchIds } : {}),
    // The row its latest import gives it, for twins' file order (A5 pass 19 L4).
    ...(current?.alsoImportedSourceRow ? { alsoImportedSourceRow: current.alsoImportedSourceRow } : {}),
    // A task a lookahead added says so (A6 pass 19 M2).
    ...(current?.importedAsLookahead === true ? { importedAsLookahead: true } : {}),
    // What the task said before a lookahead restated it (owner answer Q22).
    ...(current?.lookaheadOverlay ? { lookaheadOverlay: current.lookaheadOverlay } : {}),
    // David's own percent a file's replaced, while the file's stays (A5 recorded Low, Q22 floor gap).
    ...(typeof current?.managersPercentUnderFile === 'number' && !progressEditedHere ? {
      managersPercentUnderFile: current.managersPercentUnderFile,
      // With when David judged it (A6 pass 24 L1).
      ...(current.managersPercentUnderFileJudgedAt !== undefined ? { managersPercentUnderFileJudgedAt: current.managersPercentUnderFileJudgedAt } : {}),
    } : {}),
    ...(current?.revisedFromTaskIds?.length ? { revisedFromTaskIds: current.revisedFromTaskIds } : {}), // the ids a new master's moves gave it (A10 pass 5 M1)
    ...(current?.notRevisionOfTaskIds?.length ? { notRevisionOfTaskIds: current.notRevisionOfTaskIds } : {}), // tasks David said it is not (owner answer Q30)
    // What a master's new row took from the task's earlier row (review N3 R3). Dropped by a save here, an owner cleared
    // on this page read as a blank nobody had typed, and an edit from a device that had not heard went over it unasked.
    ...(current?.textFromTask ? { textFromTask: current.textFromTask } : {}),
    // The rows of uploaded schedules waiting to restate it at Make Current (A5 pass 18 L3).
    ...(current?.scheduleRowsAwaitingCurrent?.length ? { scheduleRowsAwaitingCurrent: current.scheduleRowsAwaitingCurrent } : {}),
    sourceDocumentId: current?.sourceDocumentId ?? null,
    sourceActivityId: current?.sourceActivityId ?? null,
    sourceWbsCode: current?.sourceWbsCode ?? null,
    sourceRowNumber: current?.sourceRowNumber ?? null,
    ...(current?.sourceUniqueId ? { sourceUniqueId: current.sourceUniqueId } : {}), // its own identity (owner answer Q30)
    completionVerification: progressEditedHere ? null : current?.completionVerification ?? null,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    cloudUpdatedAt: current?.cloudUpdatedAt ?? null,
  };

  if (draft.workflowAction) {
    if (
      draft.workflowAction === 'reopen' &&
      current &&
      projectItemWorkflowIsClosed(current) &&
      (current.itemType || 'Task') !== draft.itemType
    ) {
      throw new DAVEWebTaskValidationError(
        `Reopen ${current.itemType || 'Task'} before changing its project item type.`,
      );
    }
    const transition = draft.workflowAction === 'close'
      ? closeProjectItemWorkflow({
          item,
          actor,
          now,
          note: activityMessage || undefined,
          activityId: `activity-close-${id}-${now}`,
        })
      : reopenProjectItemWorkflow({
          item,
          actor,
          now,
          note: activityMessage || undefined,
          activityId: `activity-reopen-${id}-${now}`,
        });
    if (!transition.ok) {
      throw new DAVEWebTaskValidationError(transition.message);
    }
    return {
      ...item,
      ...transition.item,
      cloudUpdatedAt: item.cloudUpdatedAt,
    };
  }

  const workflowValidation = validateProjectItemWorkflowEdit({
    current,
    next: item,
  });
  if (!workflowValidation.ok) {
    throw new DAVEWebTaskValidationError(workflowValidation.message);
  }

  return item;
}

/**
 * What the save-conflict card says on the Tasks page and in the Schedule
 * Builder. Both choices are spelled out: Load Latest Version throws away what
 * he typed, and Apply My Changes uses the form as it is when he presses it
 * (audit round 2 follow-up, 30 Sep 2026).
 */
export const DAVE_WEB_CONFLICT_CHOICE_TEXT =
  'Load Latest Version shows the other device’s changes so you can review them. Your unsaved edits will be discarded. Apply My Changes saves only the fields you changed; everything you did not change keeps the other device’s newer values.';

/**
 * "Apply My Changes" after a save conflict keeps what the other device saved
 * in every field the owner left alone (whole-app audit round 2 F4, 30 Sep
 * 2026). The whole form had been laid over the latest version, so a phone's
 * newer 60% and note went back to the 40% and old note the web had opened.
 * A field counts as changed when the form differs from `base`, the version
 * the form was opened on; when both devices changed it, the owner's value
 * wins. An unchanged progress value keeps the latest one and its
 * confirmation time, because buildDAVEWebScheduleItem then sees no progress
 * change. Project controls are merged field by field in the same way.
 */
export function mergeDAVEWebConflictDraft({
  draft,
  base,
  latest,
  now,
  actor,
}: {
  draft: DAVEWebTaskDraft;
  base: ScheduleItem;
  latest: ScheduleItem;
  now: string;
  actor: string;
}): DAVEWebTaskDraft {
  const text = (
    mine: string,
    opened: string | null | undefined,
    theirs: string | null | undefined,
  ) => (mine.trim() === (opened ?? '').trim() ? theirs ?? '' : mine);
  // A date is left alone when it is the same calendar day as the version he
  // opened: the builder's inputs hold 2026-10-05 for a stored 10/05/2026, and
  // comparing them as text put back the dates the phone had just moved, a
  // lookahead's included (whole-app audit A12 pass 3 M1, 30 Sep 2026).
  const date = (
    mine: string,
    opened: string | null | undefined,
    theirs: string | null | undefined,
  ) => (daveWebScheduleDatesMatch(mine, opened) ? theirs ?? '' : mine);
  const minePercent = boundedPercent(draft.percentComplete);
  const openedProject = base.scheduleProjectName || base.projectName;
  const latestProject = latest.scheduleProjectName || latest.projectName;
  const planningText = (
    mine: string | undefined,
    opened: string | null | undefined,
  ) => (mine === undefined || mine.trim() === (opened ?? '').trim() ? undefined : mine);
  const planningNumber = (
    mine: number | string | null | undefined,
    opened: number | null | undefined,
  ) => (
    mine === undefined ||
    optionalPlanningNumber(mine, null) === optionalPlanningNumber(opened ?? null, null)
      ? undefined
      : mine
  );
  const planningDate = (
    mine: string | undefined,
    opened: string | null | undefined,
  ) => (mine === undefined || daveWebScheduleDatesMatch(mine, opened) ? undefined : mine);
  const planningFlag = (mine: boolean | undefined, opened: boolean | undefined) => (
    mine === undefined || (mine === true) === (opened === true) ? undefined : mine
  );
  const dependenciesChanged = draft.dependencies !== undefined &&
    JSON.stringify(normalizeScheduleDependencies(draft.dependencies)) !==
      JSON.stringify(normalizeScheduleDependencies(base.dependencies));

  return {
    ...draft,
    itemType: draft.itemType === (base.itemType || 'Task')
      ? latest.itemType || 'Task'
      : draft.itemType,
    taskName: text(draft.taskName, base.taskName, latest.taskName),
    projectName: normalized(draft.projectName) === normalized(openedProject)
      ? latestProject
      : draft.projectName,
    locationName: text(draft.locationName, base.locationName, latest.locationName),
    startDate: date(draft.startDate, base.startDate, latest.startDate),
    finishDate: date(draft.finishDate, base.finishDate, latest.finishDate),
    milestone: text(draft.milestone, base.milestone, latest.milestone),
    owner: text(draft.owner, base.owner, latest.owner),
    contractor: text(draft.contractor, base.contractor, latest.contractor),
    percentComplete: minePercent === null || minePercent === base.percentComplete
      ? latest.percentComplete
      : draft.percentComplete,
    // A percent he typed that is the one he opened (WS1 item 5) is his entry only while the other device left the
    // percent alone: over a percent that device changed, the newer value stays, and it is not marked as his.
    percentEntered: draft.percentEntered === true && minePercent !== null && minePercent === base.percentComplete &&
      latest.percentComplete !== base.percentComplete
      ? false
      : draft.percentEntered,
    priority: draft.priority === (base.priority ?? 'Medium')
      ? latest.priority ?? 'Medium'
      : draft.priority,
    status: draft.status === base.status ? latest.status : draft.status,
    notes: text(draft.notes, base.notes, latest.notes),
    nextAction: text(draft.nextAction, base.nextAction, latest.nextAction),
    wbsCode: planningText(draft.wbsCode, base.wbsCode),
    parentItemId: planningText(draft.parentItemId, base.parentItemId),
    sortOrder: planningNumber(draft.sortOrder, base.sortOrder),
    durationDays: planningNumber(draft.durationDays, base.durationDays),
    dependencies: dependenciesChanged ? draft.dependencies : undefined,
    isSummary: planningFlag(draft.isSummary, base.isSummary),
    isMilestone: planningFlag(draft.isMilestone, base.isMilestone),
    baselineStartDate: planningDate(draft.baselineStartDate, base.baselineStartDate),
    baselineFinishDate: planningDate(draft.baselineFinishDate, base.baselineFinishDate),
    projectControls: draft.projectControls === undefined
      ? undefined
      : mergeConflictProjectControls({
          mine: draft.projectControls,
          opened: base.projectControls,
          theirs: latest.projectControls,
          now,
          actor,
        }),
  };
}

/**
 * Whether two schedule dates are the same calendar day, however each is
 * written (2026-10-05, 10/05/2026, 10/5/2026, Oct 5, 2026, and since A12
 * pass 4 L1 also 2026-10-05 08:00, 10/5/2026 8:00 AM, Mon 10/5/26,
 * 2026-10-5: every form the builder's date box shows as a day). Two empty
 * dates match; an empty and a set date do not. Text that is not a date
 * matches only itself.
 */
export function daveWebScheduleDatesMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftText = (left ?? '').trim();
  const rightText = (right ?? '').trim();
  if (leftText === rightText) return true;
  const leftDay = scheduleCalendarDay(leftText);
  return leftDay !== null && leftDay === scheduleCalendarDay(rightText);
}

/**
 * A date from the builder's date input (2026-10-05) as the task stores it
 * (whole-app audit A12 pass 3 M2, 30 Sep 2026). Every builder save had
 * rewritten dates as 2026-10-05 while schedule files and the phone use
 * 10/05/2026. The same day as `stored` keeps its exact stored text, so a
 * save that changed nothing changes nothing for other readers; a changed day
 * is written in the format the task already uses (`stored`, else the first
 * of `formatFrom` that is a date): 2026-10-05 for a task stored that way,
 * otherwise the app's MM/DD/YYYY, which is also what a new item gets.
 */
export function daveWebScheduleDateForSave(
  value: string,
  stored: string | null | undefined,
  formatFrom: readonly (string | null | undefined)[] = [],
): string {
  const text = value.trim();
  if (!text) return '';
  const storedText = (stored ?? '').trim();
  if (storedText && daveWebScheduleDatesMatch(text, storedText)) return storedText;
  const day = scheduleCalendarDay(text);
  if (!day) return text;
  const reference = [storedText, ...formatFrom.map(candidate => (candidate ?? '').trim())]
    .find(candidate => scheduleCalendarDay(candidate) !== null);
  if (reference && /^\d{4}-\d{1,2}-\d{1,2}/.test(reference)) return day;
  const [year, month, dayOfMonth] = day.split('-');
  return `${month}/${dayOfMonth}/${year}`;
}

function mergeConflictProjectControls({
  mine,
  opened,
  theirs,
  now,
  actor,
}: {
  mine: ProjectControls | null;
  opened: ProjectControls | null | undefined;
  theirs: ProjectControls | null | undefined;
  now: string;
  actor: string;
}): ProjectControls | null {
  const minePC = normalizeProjectControls(mine);
  const openedPC = normalizeProjectControls(opened);
  const changed = PROJECT_CONTROL_DATA_FIELDS.filter(field =>
    JSON.stringify(minePC[field]) !== JSON.stringify(openedPC[field]));
  if (changed.length === 0) return theirs ?? null;
  const theirsPC = normalizeProjectControls(theirs);
  const updatedBy = actor.trim() || 'Project manager';
  const fieldRevisions = { ...(theirsPC.fieldRevisions || {}) };
  const values: Partial<ProjectControls> = {};
  changed.forEach(field => {
    (values as Record<string, unknown>)[field] = JSON.parse(JSON.stringify(minePC[field]));
    // Stamped now: the owner chose to write his value over the other device's.
    fieldRevisions[field] = {
      revision: Math.max(
        minePC.fieldRevisions?.[field]?.revision || 0,
        theirsPC.fieldRevisions?.[field]?.revision || 0,
      ) + 1,
      updatedAt: now,
      updatedBy,
    };
  });
  return normalizeProjectControls({
    ...theirsPC,
    ...values,
    revision: Math.max(minePC.revision, theirsPC.revision) + 1,
    updatedAt: now,
    updatedBy,
    fieldRevisions,
  });
}

function boundedPercent(value: number | string): number | null {
  const parsed = typeof value === 'number'
    ? value
    : value.trim()
      ? Number(value.replace('%', '').trim())
      : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null;
}

export function scheduleItemForCloud(
  item: DAVEWebScheduleItem | ScheduleItem,
): ScheduleItem {
  const { cloudUpdatedAt: _cloudUpdatedAt, ...scheduleItem } = item as DAVEWebScheduleItem;
  // Every web write of a task passes here: the shown copy's marker (savedLookaheadDates) is never saved, and dates
  // only shown go back to the saved ones (review N1 L1).
  return scheduleItemAsSaved(scheduleItem);
}

function refuseUnsupportedDuration(value: number | string | null | undefined) {
  if (value === undefined || value === null || value === '') return;
  const days = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(days) || !scheduleDurationIsSupported(days)) {
    throw new DAVEWebTaskValidationError(SCHEDULE_DURATION_RANGE_TEXT);
  }
}

/**
 * A date this save changes must be a day the schedule supports. A date left
 * as stored is not judged here, and text that names no day ("TBD") is kept
 * as the forms already keep it.
 */
function refuseUnsupportedDay(label: string, value: string | undefined, stored: string | null | undefined) {
  if (value === undefined || daveWebScheduleDatesMatch(value, stored)) return;
  const day = scheduleCalendarDay(value);
  if (day && !scheduleDayIsSupported(day)) {
    throw new DAVEWebTaskValidationError(scheduleDateRangeText(label));
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new DAVEWebTaskValidationError(`${label} is required.`);
  return normalized;
}

function normalized(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function optionalPlanningText(
  value: string | undefined,
  fallback: string | null | undefined,
): string | null {
  if (value === undefined) return fallback?.trim() || null;
  return value.trim() || null;
}

function optionalPlanningNumber(
  value: number | string | null | undefined,
  fallback: number | null | undefined,
): number | null {
  if (value === undefined) return fallback ?? null;
  if (value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}
