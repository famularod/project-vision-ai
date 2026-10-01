/**
 * The words Ask ECOS (phone and desktop) and Talk use to refuse a question
 * that names another project (owner answer Q20). Split out of
 * ECOSProjectQuestion.ts in audit A9 pass 6 L6 so Talk's router can use them
 * without loading the network client. No I/O.
 */
import { findECOSProjectReferenceMismatch } from '../supabase/functions/_shared/ecos-project-reference';

/**
 * Audit A9 pass 3 L3 (30 Sep 2026): where the refusal is read. The desktop has
 * a project picker above Ask ECOS; the phone answer sheet has none ("Ask
 * Another Question" asks the same project again), so the phone says how to get
 * to the other project instead of "Select project 2375 above".
 */
export type ECOSProjectRefusalWording = 'phone' | 'desktop';

export type ECOSProjectRefusalContext = Readonly<{
  knownProjectNames?: readonly string[] | null;
  closedProjectNames?: readonly string[] | null;
  refusalWording?: ECOSProjectRefusalWording;
}>;

/**
 * knownProjectNames: the names of the signed-in user's unarchived projects. With
 * them, a number is refused only when it is another project's number (and not
 * written as a measurement, money, a date, a phone number or a spec/sheet ID;
 * audit A9 pass 5). Without them the stricter pre-Q20 check
 * applies unchanged. closedProjectNames: closed (archived, not deleted)
 * projects, whose numbers are refused as closed (audit A9 pass 3 L1).
 */
export function ecosProjectReferenceMismatchMessage(
  projectName: string,
  question: string,
  knownProjectNames?: readonly string[] | null,
  { closedProjectNames, refusalWording = 'desktop' }: Omit<ECOSProjectRefusalContext, 'knownProjectNames'> = {},
): string | null {
  const mismatch = findECOSProjectReferenceMismatch(projectName, question, knownProjectNames, closedProjectNames);
  return mismatch
    ? projectReferenceMismatchText(
      mismatch.selectedProjectIdentifier,
      mismatch.referencedProjectIdentifier,
      mismatch.referencedProjectClosed,
      refusalWording,
    )
    : null;
}

/**
 * `selectedProjectIdentifier` is the selected project's number (or its name
 * when it has none); '' when no project is selected (Talk opened from a
 * screen without one; audit A9 pass 7 L6b). `referencedProjectIdentifier` is
 * the other project's number, or its name when it was named by name.
 */
export function projectReferenceMismatchText(
  selectedProjectIdentifier: string,
  referencedProjectIdentifier: string,
  referencedProjectClosed: boolean,
  refusalWording: ECOSProjectRefusalWording,
) {
  // A name that starts with "Project" is not shown as "Project Project Phoenix" (audit A9 pass 10).
  const selected = selectedProjectIdentifier
    ? `${/^project\b/i.test(selectedProjectIdentifier) ? '' : 'Project '}${selectedProjectIdentifier} is selected, but`
    : 'No project is selected, and';
  if (referencedProjectClosed) {
    // A closed project is not offered anywhere until it is reopened, and only
    // the phone app can reopen one (Archived Projects on the Overview tab).
    const reopenStep = refusalWording === 'phone'
      ? 'Reopen it under Archived Projects on the Overview tab, then ask there.'
      : 'Reopen it in the Vitruvius iPhone or iPad app, then select it above and ask again.';
    return `${selected} ${referencedProjectIdentifier} is a closed project. ${reopenStep}`;
  }
  const switchStep = refusalWording === 'phone'
    ? `Close this, open project ${referencedProjectIdentifier}, then ask again.`
    : `Select project ${referencedProjectIdentifier} above, then ask again.`;
  return `${selected} this question names ${referencedProjectIdentifier}. ${switchStep}`;
}
