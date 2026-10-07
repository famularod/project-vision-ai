import type {
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import { buildDAVEProjectTruth, daveProjectTruthInStableOrder, type DAVEProjectTruth } from './DAVEProjectTruth';
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
 * its fingerprint. A report approved or sent by Build 230 must still be
 * known, so where the two ways of scoping differ the truth is also built as
 * Build 230 scoped it, and kept beside the report's truth for the 1.0
 * fingerprint only (daveProjectTruthAsBuilt). Where they do not differ,
 * which is nearly always, nothing is built twice.
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
    const truthOf = (scope: ReturnType<typeof buildDailyReportAuthorityScope>) => buildDAVEProjectTruth({
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
    // As Build 230 scoped it: without the saved tasks.
    const scopeAsBefore = buildDailyReportAuthorityScope(scopeInput);
    // Whose task a hidden row is (A10 pass 2 F1), as the app's own scope reads it.
    const scope = known ? buildDailyReportAuthorityScope({ ...scopeInput, knownScheduleItems: known }) : scopeAsBefore;
    const sameUpdates = scope.updates.length === scopeAsBefore.updates.length &&
      scope.updates.every((update, index) => update === scopeAsBefore.updates[index]);
    const truth = truthOf(scope);
    // In a stable order, so a sync that only reorders the saved rows changes nothing a report says (R4 item 4a).
    return daveProjectTruthInStableOrder(truth, sameUpdates ? truth : truthOf(scopeAsBefore));
  });
}
