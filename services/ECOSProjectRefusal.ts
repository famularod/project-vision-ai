/**
 * The words Ask ECOS (phone and desktop) and Talk use to refuse a question
 * that names another project (owner answer Q20). Split out of
 * ECOSProjectQuestion.ts in audit A9 pass 6 L6 so Talk's router can use them
 * without loading the network client. No I/O.
 */
import {
  ecosProjectIdentifiers,
  ecosProjectNumberMentionsAt,
  findECOSProjectReferenceMismatch,
} from '../supabase/functions/_shared/ecos-project-reference';

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
  /**
   * Owner answer Q27: read project numbers as digits only (see
   * ecosDigitsOnlyQuestion). Left out, it is decided from the lists passed
   * in; Talk passes what the whole list says when it checks a shorter one.
   */
  digitsOnlyProjectNumbers?: boolean;
}>;

/**
 * Owner answer Q27 (2 Oct 2026): David has no letters in his project
 * numbers. Whether no project here (open, closed or selected) has a number
 * with a letter in it ("2375A", "2375-B", "480V ..."), by the same reading
 * the check uses. Decided from the actual list, so adding a project with a
 * lettered number brings back the full reading (audit A9 passes 7-17).
 */
export function ecosProjectNumbersAreDigitsOnly(projectNames: readonly string[]): boolean {
  return projectNames.every(name => ecosProjectIdentifiers(name).every(({ letter }) => !letter));
}

/**
 * Owner answer Q27: the question as the check reads it when project numbers
 * are digits only. A letter the check would read as part of a project number
 * (glued "2375A", hyphen-joined "2375-A", or a lone capital "2375 A?") is
 * written as a word of its own, so "2375A" reads as "2375 A" does today: the
 * number 2375, then the word A. Two spaces go in right after the number,
 * because one space and a capital is how the check spots a letter. Nothing
 * else changes, and only the check reads this copy of the question.
 */
export function ecosDigitsOnlyQuestion(
  question: string,
  projectNames: readonly string[],
  selectedProjectName = '',
): string {
  return ecosProjectNumberMentionsAt(question, projectNames, selectedProjectName)
    .filter(({ letter, spacedLetter }) => letter || spacedLetter)
    .reduceRight((text, { end }) => `${text.slice(0, end)}  ${text.slice(end)}`, question);
}

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
  { closedProjectNames, refusalWording = 'desktop', digitsOnlyProjectNumbers }: Omit<ECOSProjectRefusalContext, 'knownProjectNames'> = {},
): string | null {
  // Owner answer Q27: only with a project list; without one the stricter
  // pre-Q20 check applies unchanged.
  const listed = (names: readonly string[] | null | undefined) =>
    (Array.isArray(names) ? names : []).filter(name => typeof name === 'string' && name.trim());
  const projects = [projectName, ...listed(knownProjectNames), ...listed(closedProjectNames)];
  const digitsOnly = listed(knownProjectNames).length > 0 &&
    (digitsOnlyProjectNumbers ?? ecosProjectNumbersAreDigitsOnly(projects));
  const read = digitsOnly ? ecosDigitsOnlyQuestion(question, projects, projectName) : question;
  const mismatch = findECOSProjectReferenceMismatch(projectName, read, knownProjectNames, closedProjectNames);
  if (mismatch?.namedProjects) return projectsNamedTogetherText(mismatch.namedProjects);
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

/**
 * A question that names two or more projects, none more than another, so it
 * is not clear which is meant (audit A9 pass 6 L6a in Talk). Audit A9 pass
 * 14 L2: Ask ECOS (phone and desktop) uses the same words when the selected
 * project is one of them ("What is left at 450 Elm St?" on "24117 - 450 Elm
 * St" with a closed "23088 - 450 Elm St"), instead of only naming the other.
 */
export function projectsNamedTogetherText(labels: readonly string[]) {
  const count = labels.length === 2 ? 'two' : String(labels.length);
  const list = `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `This question names ${count} projects, ${list}. Which one do you mean? Ask again about just that project.`;
}
