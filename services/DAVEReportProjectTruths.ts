import type {
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import { buildDAVEProjectTruth, daveProjectTruthInStableOrder, type DAVEProjectTruth } from './DAVEProjectTruth';
import type { ProjectRecord } from './ProjectCoverPhotoService';
import { buildDailyReportAuthorityScope } from './ReportAuthorityScope';
import { buildAutomaticReportDrawingReferences } from './ReportDrawingReferences';
import { buildWrittenReportFacts } from './ReportWrittenFacts';
import { reportTaskConfirmedAt } from './DAVEReportIntelligence';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';
import { fieldUpdatesNewestFirst, scheduleTasksInReportOrder } from './PIEEvidenceFusion';

export type DAVEReportProjectTruthsInput = {
  /** The report's projects in the order shown, each with the id its Project Truth carries. */
  projects: readonly Readonly<{ name: string; projectId: string }>[];
  /** The owner's projects: a task's or an update's project is read against them. */
  projectRecords: readonly ProjectRecord[];
  updates: readonly ProjectUpdate[];
  /** The desktop supplies only downloaded cloud rows; their serialized status may still say queued. */
  cloudUpdateReceipts?: boolean;
  /** The tasks shown. */
  scheduleItems: readonly ScheduleItem[];
  /**
   * Every saved task, hidden ones included. With them: a field update on a
   * task a new master moved stays with the task (never by a name its old
   * schedule had twice), and the report knows which detail tasks left with a
   * replaced lookahead. Without them the report reads as it did before they
   * existed.
   */
  knownScheduleItems?: readonly ScheduleItem[];
  /** Every saved schedule, as the shown list was worked out from them; `referenceDocuments` when absent. */
  knownScheduleDocuments?: readonly ReferenceDocument[];
  projectAreas?: readonly ProjectArea[];
  referenceDocuments?: readonly ReferenceDocument[];
  now?: string;
  /**
   * R7 item C: the same tasks as the build before handed them to the report,
   * where that differs from `scheduleItems` and `knownScheduleItems` (the
   * web: a task nobody has edited carried the cloud row's time as its
   * updatedAt). Only for the truth as the build before built it, which the
   * 1.0 fingerprint is taken from; the report is written from the others.
   */
  asBuiltBefore?: Readonly<{ scheduleItems: readonly ScheduleItem[]; knownScheduleItems?: readonly ScheduleItem[] }>;
  /**
   * R8 item 2: the documents the report's drawings are cited from, where that
   * is another list than `referenceDocuments` (the web's Word report cites
   * from every document it has downloaded). The same list, and the same
   * tasks, the screen hands to buildAutomaticReportDrawingReferences.
   */
  drawingDocuments?: readonly ReferenceDocument[];
};

/**
 * The Project Truth a report is written from, one per project: the one
 * recipe for the phone's Reports screen and the web's Reports page (open
 * item, 6 Oct 2026). Each had its own copy.
 *
 * Whose update it is (R3 item 1, under the fingerprint's version 2.0, R4
 * item 4a): the saved tasks are handed to the scope as well as to the truth,
 * so a hidden row decides as a shown one does. A field update on a task's
 * old row (a new master moved the task and hid that row), filed under an
 * older name of the project, is the project's, as the app's own scope
 * already counts it (A10 pass 2 F1); one on another project's hidden row is
 * not.
 *
 * That changes which updates a report counts for the same saved data, and so
 * its fingerprint. Where the two ways of scoping count the same updates,
 * which is nearly always, nothing is built twice and a report approved or
 * sent by Build 230 is known by the 1.0 fingerprint of this very truth.
 *
 * Where they differ (R7 item A, the coordinator's decision on review pass 1,
 * F0): the report has other updates in it than Build 230's report of the
 * same saved data, so it is another report, and no 1.0 fingerprint is a
 * name of its facts. (R4 took the 1.0 fingerprint of the truth as Build 230
 * scoped it as such a name. That name was blind to every update only this
 * build counts: one could be reworded, or a second arrive, and the Build 230
 * report was still taken for it.) The truth as Build 230 scoped it is still
 * built and kept beside the report's truth (daveProjectTruthAsBuilt), to
 * say what Build 230 wrote, and the view is marked
 * (daveProjectTruthCountsOtherUpdatesThanBefore) so that nothing takes it
 * for a name.
 */
export function buildDAVEReportProjectTruths(input: DAVEReportProjectTruthsInput): DAVEProjectTruth[] {
  const known = input.knownScheduleItems;
  return input.projects.map(project => {
    const scopeInput = {
      selectedProjectName: project.name,
      selectedProjectNames: [project.name],
      projectRecords: input.projectRecords,
      updates: input.updates,
      scheduleItems: input.scheduleItems,
      projectAreas: input.projectAreas,
      referenceDocuments: input.referenceDocuments,
    };
    const truthOf = (scope: ReturnType<typeof buildDailyReportAuthorityScope>, knownItems = known) => buildDAVEProjectTruth({
      projectId: project.projectId,
      projectName: project.name,
      updates: scope.updates.map(update => ({ ...update, projectName: project.name })),
      scheduleItems: scope.scheduleItems,
      // The name fallback checks the update's own schedule (A10 pass 6 L2), and
      // what a newer lookahead replaced, for "since the last report" (owner answer 3 Oct 2026).
      ...(knownItems
        ? {
            knownScheduleItems: knownItems,
            knownScheduleDocuments: input.knownScheduleDocuments ?? input.referenceDocuments,
            reportLookaheadReplacement: true,
          }
        : {}),
      projectAreas: scope.projectAreas,
      referenceDocuments: scope.referenceDocuments.map(document => ({
        ...document,
        projectId: project.projectId,
        projectName: project.name,
      })),
      ...(input.now ? { now: input.now } : {}),
    });
    // As Build 230 scoped it: without the saved tasks.
    const scopeAsBefore = buildDailyReportAuthorityScope(scopeInput);
    // Whose task a hidden row is (A10 pass 2 F1), as the app's own scope reads it.
    const scope = known ? buildDailyReportAuthorityScope({ ...scopeInput, knownScheduleItems: known }) : scopeAsBefore;
    const sameUpdates = scope.updates.length === scopeAsBefore.updates.length &&
      scope.updates.every((update, index) => update === scopeAsBefore.updates[index]);
    // Classify equal-caption evidence in the same saved-update order the report
    // writer uses. Cloud row arrival order must not choose a different duplicate
    // winner (and therefore a different report identity) on another device.
    const orderedUpdates = fieldUpdatesNewestFirst(scope.updates, { cloudReceipts: input.cloudUpdateReceipts });
    const sameOrder = orderedUpdates.every((update, index) => update === scope.updates[index]);
    // Resolve duplicate-evidence survivors and equal task-name matches before
    // building modern report facts. Sorting the finished truth cannot undo an
    // arrival-order choice already recorded in a photo's task or disposition.
    // Keep the original input separately below for the frozen raw 1.0 projection.
    const orderedTasks = scheduleTasksInReportOrder(scope.scheduleItems);
    const sameTaskOrder = orderedTasks.every((task, index) => task === scope.scheduleItems[index]);
    const truth = truthOf({ ...scope, updates: orderedUpdates, scheduleItems: orderedTasks });
    // R8 item 2 (the coordinator's decision on review pass 2, P2-2): the drawings the report cites for this
    // project's work areas, worked out as the Reports screen and the Word report work them out, so that the
    // fingerprint holds exactly what the report prints and saves of a drawing.
    const drawingReferences = buildAutomaticReportDrawingReferences({
      documents: [...(input.drawingDocuments ?? input.referenceDocuments ?? [])],
      scheduleItems: [...input.scheduleItems],
      selectedProjectNames: [project.name],
    });
    const drawingCitations = drawingReferences.map(reference => ({ ...reference.citation, projectName: reference.projectName, areaName: reference.areaName }));
    // As the build before built it, where that differs: it scoped the updates without the saved tasks, and (R7 item
    // C) was handed the tasks as `asBuiltBefore` has them.
    const before = input.asBuiltBefore;
    const builtBefore = before
      ? truthOf(buildDailyReportAuthorityScope({ ...scopeInput, scheduleItems: before.scheduleItems }), before.knownScheduleItems ?? known)
      : sameUpdates && sameOrder && sameTaskOrder ? truth : truthOf(scopeAsBefore);
    // HIGH item 1 (F2 to F6b): what the phone's written report prints of this project's own updates and tasks that
    // the truth does not hold, read by the writer's own rules at the truth's own moment, so that the fingerprint
    // holds it on the phone and on the desktop alike.
    const writtenReportFacts = {
      ...buildWrittenReportFacts({
        projectName: project.name,
        updates: scope.updates,
        cloudUpdateReceipts: input.cloudUpdateReceipts,
        scheduleItems: scope.scheduleItems,
        now: truth.generatedAt,
      }),
      // HIGH item 1f: what decides each drawing excerpt's picture beside its citation (held above): the part of the page.
      wordDrawings: drawingReferences.map(reference => ({
        referenceId: reference.id,
        pageNumber: reference.excerpt.pageNumber,
        region: { x: reference.excerpt.region.x, y: reference.excerpt.region.y, width: reference.excerpt.region.width, height: reference.excerpt.region.height },
      })),
    };
    // HIGH item 1c: when each completed task's progress was confirmed, as Completed Work reads it from these tasks.
    const completedWorkConfirmedAt = Object.fromEntries(scope.scheduleItems
      .filter(item => scheduleProgressIsComplete(item))
      .map(item => [item.id, reportTaskConfirmedAt(item)]));
    // In a stable order, so a sync that only reorders the saved rows changes nothing a report says (R4 item 4a).
    return daveProjectTruthInStableOrder(truth, builtBefore, !sameUpdates, drawingCitations, writtenReportFacts, completedWorkConfirmedAt);
  });
}
