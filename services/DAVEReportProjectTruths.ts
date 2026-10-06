import type {
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import { buildDAVEProjectTruth, type DAVEProjectTruth } from './DAVEProjectTruth';
import type { ProjectRecord } from './ProjectCoverPhotoService';
import { buildDailyReportAuthorityScope } from './ReportAuthorityScope';

export type DAVEReportProjectTruthsInput = {
  /** The report's projects in the order shown, each with the id its Project Truth carries. */
  projects: readonly Readonly<{ name: string; projectId: string }>[];
  /** The owner's projects: a task's or an update's project is read against them. */
  projectRecords: readonly ProjectRecord[];
  updates: readonly ProjectUpdate[];
  /** The tasks shown. */
  scheduleItems: readonly ScheduleItem[];
  /**
   * Every saved task, hidden ones included. With them: a field update on a
   * task a new master moved stays with the task (never by a name its old
   * schedule had twice), an update on a hidden row belongs to that row's
   * project, and the report knows which detail tasks left with a replaced
   * lookahead. Without them the report reads as it did before they existed.
   */
  knownScheduleItems?: readonly ScheduleItem[];
  /** Every saved schedule, as the shown list was worked out from them; `referenceDocuments` when absent. */
  knownScheduleDocuments?: readonly ReferenceDocument[];
  projectAreas?: readonly ProjectArea[];
  referenceDocuments?: readonly ReferenceDocument[];
  now?: string;
};

/**
 * The Project Truth a report is written from, one per project: the one
 * recipe for the phone's Reports screen and the web's Reports page (open
 * item, 6 Oct 2026). Each had its own copy, and the copies took the saved
 * tasks differently: the phone's read whose update it is without them, so an
 * update the app had already counted for the project by its task's hidden
 * row could be left out of the report's facts again; the web's did the same.
 * Both now hand the saved tasks to the one scope and the one truth.
 */
export function buildDAVEReportProjectTruths(input: DAVEReportProjectTruthsInput): DAVEProjectTruth[] {
  const known = input.knownScheduleItems;
  return input.projects.map(project => {
    const scope = buildDailyReportAuthorityScope({
      selectedProjectName: project.name,
      selectedProjectNames: [project.name],
      projectRecords: input.projectRecords,
      updates: input.updates,
      scheduleItems: input.scheduleItems,
      // Whose task a hidden row is (A10 pass 2 F1), as the app's own scope reads it.
      ...(known ? { knownScheduleItems: known } : {}),
      projectAreas: input.projectAreas,
      referenceDocuments: input.referenceDocuments,
    });
    return buildDAVEProjectTruth({
      projectId: project.projectId,
      projectName: project.name,
      updates: scope.updates.map(update => ({ ...update, projectName: project.name })),
      scheduleItems: scope.scheduleItems,
      // The name fallback checks the update's own schedule (A10 pass 6 L2), and
      // what a newer lookahead replaced, for "since the last report" (owner answer 3 Oct 2026).
      ...(known
        ? {
            knownScheduleItems: known,
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
  });
}
