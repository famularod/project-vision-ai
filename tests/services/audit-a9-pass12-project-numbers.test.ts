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

  // Audit A9 pass 13 wording: the refusal shows the job number the question
  // used and the name ("2375 (480V Switchgear Upgrade 2375)"; was "480V").
  it.each(NAMES)('on 2321, "What is left on <job number>?" names "%s" in Ask ECOS, and Talk moves there (was answered)', (name, _shown, job) => {
    const projects = [SELECTED, name];
    const question = `What is left on ${job}?`;
    expect(desktop(question, projects)).toBe(switchOnDesktop(`${job} (${name})`));
    expect(phone(question, projects)).toBe(switchOnPhone(`${job} (${name})`));
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
    // Audit A9 pass 13 wording: was "but 480V is a closed project".
    expect(phone('What is left on 2375?', [SELECTED], ['480V Switchgear Upgrade 2375'])).toBe(
      'Project 2321 is selected, but 2375 (480V Switchgear Upgrade 2375) is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
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
    // Audit A9 pass 13 wording: was "names 1950s".
    expect(desktop('Is 2377 Days Inn done?', projects)).toBe(switchOnDesktop('2377 (1950s Remodel 2377 Days Inn)'));
  });
});

describe('audit A9 pass 12 L2: another number in the selected name is its own only when no other project is numbered that', () => {
  const SUITE = '2375 Main St Suite 300';
  const ELM = '300 Elm';

  it('"Is 300 Elm done?" on 2375 Main St Suite 300 names 300 Elm, in Ask ECOS and Talk (was answered from Suite 300)', () => {
    const projects = [SELECTED, SUITE, ELM];
    expect(desktop('Is 300 Elm done?', projects, [], SUITE)).toBe(switchOnDesktop('300', '2375'));
    expect(phone('What is left at 300?', projects, [], SUITE)).toBe(switchOnPhone('300', '2375'));
    expect(talkAnswer('Is 300 Elm done?', projects, [], SUITE)).toBe(switchOnPhone('300', '2375'));
  });

  it('a closed 300 Elm is refused as closed, and a lettered 300A by a bare 300', () => {
    expect(phone('What is left at 300?', [SELECTED, SUITE], [ELM], SUITE)).toBe(
      'Project 2375 is selected, but 300 is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    );
    expect(desktop('What is left at 300?', [SELECTED, SUITE, '300A Wing'], [], SUITE)).toBe(switchOnDesktop('300A', '2375'));
  });

  it('with no project numbered 300, Suite 300 and its own 2375 are answered', () => {
    const projects = [SELECTED, SUITE];
    expect(desktop('What is left in Suite 300?', projects, [], SUITE)).toBeNull();
    expect(desktop('What is left at 2375?', projects, [], SUITE)).toBeNull();
    expect(talkAnswer('What is left in Suite 300?', projects, [], SUITE)).toBeNull();
  });

  it('either identifier of a lettered name stays its own (pass 12 L1): 300 on "2375-B Annex Suite 300"', () => {
    expect(desktop('What is left at 300?', [SELECTED, '2375-B Annex Suite 300', ELM], [], '2375-B Annex Suite 300')).toBeNull();
  });

  it('without a project list the pre-Q20 check is unchanged: every number in the selected name is its own', () => {
    expect(desktop('What is left at 3000?', undefined, undefined, '2375 Main St Suite 3000')).toBeNull();
  });
});

describe('audit A9 pass 12 L3: a spaced capital continues a plain project\'s name only when the word after it does too', () => {
  const A_STREET = '2375 A Street';
  const PHASE = '2375A Phase 2';
  const PROJECTS = [SELECTED, A_STREET, PHASE];

  it('"Is 2375 A Phase 2 done?" on 2375 A Street names 2375A Phase 2, in Ask ECOS and Talk (was answered)', () => {
    expect(desktop('Is 2375 A Phase 2 done?', PROJECTS, [], A_STREET)).toBe(switchOnDesktop('2375A', '2375'));
    expect(phone('Is 2375 A Phase 2 done?', PROJECTS, [], A_STREET)).toBe(switchOnPhone('2375A', '2375'));
    expect(talkAnswer('Is 2375 A Phase 2 done?', PROJECTS, [], A_STREET)).toBe(switchOnPhone('2375A', '2375'));
  });

  it('on 2321 it names 2375A Phase 2, and Talk moves there (was 2375 A Street)', () => {
    expect(desktop('Is 2375 A Phase 2 done?', PROJECTS)).toBe(switchOnDesktop('2375A'));
    expect(mentionedDAVEProject('Is 2375 A Phase 2 done?', PROJECTS)).toBe(PHASE);
  });

  it('on 2375A Phase 2 it is its own', () => {
    expect(desktop('Is 2375 A Phase 2 done?', PROJECTS, [], PHASE)).toBeNull();
    expect(talkAnswer('Is 2375 A Phase 2 done?', PROJECTS, [], PHASE)).toBeNull();
  });

  it('the plain project\'s own name, and a capital standing alone, are still 2375 A Street\'s', () => {
    expect(desktop('Is 2375 A Street done?', PROJECTS, [], A_STREET)).toBeNull();
    expect(talkAnswer('Is 2375 A Street done?', PROJECTS, [], A_STREET)).toBeNull();
    expect(desktop('What is left on 2375 A Street?', PROJECTS)).toBe(switchOnDesktop('2375'));
    expect(desktop('What is left on 2375 A?', PROJECTS)).toBe(switchOnDesktop('2375'));
    expect(mentionedDAVEProject('What is left on 2375 A Street?', PROJECTS)).toBe(A_STREET);
  });
});
