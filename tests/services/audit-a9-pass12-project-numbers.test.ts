import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectQuestion';
import { resolveDAVEConversationContext } from '../../services/DAVEConversationContext';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import {
  ecosProjectDisplayIdentifier,
  ecosProjectIdentifiers,
} from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 12 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. When unsure, refuse. Synthetic project
// names.

const SELECTED = '2321 Compliance Project';

const phone = (question: string, known: readonly string[] | undefined, closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const desktop = (question: string, known: readonly string[] | undefined, closed?: readonly string[], selected = SELECTED) =>
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

describe('audit A9 pass 12 L1: a name whose first number is lettered keeps its job number too', () => {
  // [name, shown (its first number), its job number (first plain number)]
  const NAMES = [
    ['480V Switchgear Upgrade 2375', '480V', '2375'],
    ['120K SF Warehouse 2376', '120K', '2376'],
    ['1950s Bungalow Remodel 2377', '1950s', '2377'],
    ['200A Service Upgrade 2378', '200A', '2378'],
    ['Bldg 100A 2375 Main', '100A', '2375'],
  ] as const;

  it.each(NAMES)('"%s" has both numbers and is shown by the first', (name, shown, job) => {
    expect(ecosProjectIdentifiers(name).map(({ digits, letter }) => `${digits}${letter}`)).toEqual([shown, job]);
    expect(ecosProjectDisplayIdentifier(name)).toBe(shown);
  });

  it.each(NAMES)('on 2321, "What is left on <job number>?" names "%s" in Ask ECOS, and Talk moves there (was answered)', (name, shown, job) => {
    const projects = [SELECTED, name];
    const question = `What is left on ${job}?`;
    expect(desktop(question, projects)).toBe(switchOnDesktop(shown));
    expect(phone(question, projects)).toBe(switchOnPhone(shown));
    expect(mentionedDAVEProject(question, projects)).toBe(name);
  });

  it.each(NAMES)('on 2321, its first number still names "%s"', (name, shown) => {
    const projects = [SELECTED, name];
    const question = `Is the ${shown} work in?`;
    expect(desktop(question, projects)).toBe(switchOnDesktop(shown));
    expect(mentionedDAVEProject(question, projects)).toBe(name);
  });

  it.each(NAMES)('on "%s" itself, both numbers are its own, in Ask ECOS and Talk', (name, shown, job) => {
    const projects = [SELECTED, name];
    for (const question of [`What is left on ${job}?`, `Is the ${shown} work in?`]) {
      expect(desktop(question, projects, [], name)).toBeNull();
      expect(talkAnswer(question, projects, [], name)).toBeNull();
    }
  });

  it('on another project, the job number of a closed "480V Switchgear Upgrade 2375" is refused as closed', () => {
    expect(phone('What is left on 2375?', [SELECTED], ['480V Switchgear Upgrade 2375'])).toBe(
      'Project 2321 is selected, but 480V is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    );
  });

  it('without a project list, its own job number is not refused on "480V Switchgear Upgrade 2375" (was refused as 2375)', () => {
    expect(desktop('What is left on 2375?', undefined, undefined, '480V Switchgear Upgrade 2375')).toBeNull();
    expect(desktop('What is left on 2321?', undefined, undefined, '480V Switchgear Upgrade 2375')).toBe(
      switchOnDesktop('2321', '480V'),
    );
  });

  it('the name continuing around its job number names it even when written as a measurement ("2377 Days Inn")', () => {
    const projects = [SELECTED, '1950s Remodel 2377 Days Inn'];
    expect(desktop('Is 2377 Days Inn done?', projects)).toBe(switchOnDesktop('1950s'));
  });
});
