import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectQuestion';
import { resolveDAVEConversationContext } from '../../services/DAVEConversationContext';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import { findECOSProjectReferenceMismatch } from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 9 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. When unsure, refuse: a wrong refusal
// costs David a tap, a missed one answers from the wrong project. Synthetic
// project names.

const SELECTED = '2321 Compliance Project';
const OTHER = '2375 Compliance Project';
const PROJECTS = [SELECTED, OTHER];

const phone = (question: string, known: readonly string[] | null, closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const desktop = (question: string, known: readonly string[] | null, closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'desktop' });
const switchOnPhone = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Close this, open project ${number}, then ask again.`;
const switchOnDesktop = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Select project ${number} above, then ask again.`;

/** What Talk says instead of answering, on `selected`, or null when it answers. */
function talkAnswer(question: string, open: readonly string[], closed: readonly string[] = [], selected = SELECTED) {
  const context = resolveDAVEConversationContext({
    transcript: question,
    history: [],
    projectId: `project-${selected}`,
    projectName: selected,
    projectNames: open,
    closedProjectNames: closed,
  });
  return context.status === 'ambiguous_follow_up' ? context.effectiveQuestion : null;
}

describe('audit A9 pass 9 M1: a selected project whose name has no number still refuses another project\'s number', () => {
  const OFFICE = 'Harbor Office';
  const WITH_OFFICE = [OFFICE, ...PROJECTS];

  it('"What is left at 2375?" on Harbor Office is refused, naming Harbor Office', () => {
    expect(desktop('What is left at 2375?', WITH_OFFICE, [], OFFICE)).toBe(switchOnDesktop('2375', OFFICE));
    expect(phone('What is left at 2375?', WITH_OFFICE, [], OFFICE)).toBe(switchOnPhone('2375', OFFICE));
    expect(talkAnswer('What is left at 2375?', WITH_OFFICE, [], OFFICE)).toBe(switchOnPhone('2375', OFFICE));
  });

  it('a closed project\'s number is refused as closed', () => {
    expect(findECOSProjectReferenceMismatch(OFFICE, 'What is left at 2375?', [OFFICE], [OTHER])).toEqual({
      selectedProjectIdentifier: OFFICE,
      referencedProjectIdentifier: '2375',
      referencedProjectClosed: true,
    });
  });

  it('a number that is no project\'s, or is written as a measurement, is still answered', () => {
    expect(desktop('What is left at 2400?', WITH_OFFICE, [], OFFICE)).toBeNull();
    expect(desktop('Is 2375 psi enough for the slab?', WITH_OFFICE, [], OFFICE)).toBeNull();
    expect(desktop('What is overdue?', WITH_OFFICE, [], OFFICE)).toBeNull();
  });

  it('without a project list, the stricter check refuses a 4-6 digit number that is not a year, as for a numbered project', () => {
    expect(desktop('What is left at 2375?', null, [], OFFICE)).toBe(switchOnDesktop('2375', OFFICE));
    expect(desktop('What is left at 2375?', null, [], SELECTED)).toBe(switchOnDesktop('2375'));
    // The stricter check reads 4-6 digits and never a year, for every selection.
    for (const selected of [OFFICE, SELECTED]) {
      expect(desktop('Which deliveries are due in 2026?', null, [], selected)).toBeNull();
      expect(desktop('What is left at 450?', null, [], selected)).toBeNull();
    }
  });

  it('Talk keeps the question on Harbor Office and does not move to 2375 when it is closed', () => {
    expect(mentionedDAVEProject('What is left at 2375?', [OFFICE, SELECTED], [OTHER])).toBeNull();
    expect(talkAnswer('What is left at 2375?', [OFFICE, SELECTED], [OTHER], OFFICE)).toBe(
      'Project Harbor Office is selected, but 2375 is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    );
  });
});
