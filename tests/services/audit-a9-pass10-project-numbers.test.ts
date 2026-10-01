import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectQuestion';
import { resolveDAVEConversationContext } from '../../services/DAVEConversationContext';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import {
  ecosProjectDisplayIdentifier,
  ecosProjectIdentifier,
  findECOSProjectReferenceMismatch,
} from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 10 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. When unsure, refuse. Synthetic project
// names.

const SELECTED = '2321 Compliance Project';

const phone = (question: string, known: readonly string[], closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const desktop = (question: string, known: readonly string[], closed?: readonly string[], selected = SELECTED) =>
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

describe('audit A9 pass 10 L1: a spaced letter is part of the number only as a capital standing alone, or after a hyphen', () => {
  const MAIN = '2375 Main St';
  const PHASE = '2375A Phase 2';
  const A_STREET = '2375 A Street';

  it.each(['Is 2375 a priority this week?', 'Is 2375 A priority this week?', 'Is 2375 a.k.a. Main done?'])(
    '"%s" on 2375 Main St, with 2375A Phase 2, is answered in Ask ECOS and Talk',
    question => {
      expect(desktop(question, [SELECTED, MAIN, PHASE], [], MAIN)).toBeNull();
      expect(phone(question, [SELECTED, MAIN, PHASE], [], MAIN)).toBeNull();
      expect(talkAnswer(question, [SELECTED, MAIN, PHASE], [], MAIN)).toBeNull();
    },
  );

  it('the same question on 2321 names 2375 Main St, not 2375A', () => {
    expect(desktop('Is 2375 a priority this week?', [SELECTED, MAIN, PHASE])).toBe(switchOnDesktop('2375'));
    expect(mentionedDAVEProject('Is 2375 a priority this week?', [SELECTED, MAIN, PHASE])).toBe(MAIN);
  });

  it('a lower-case spaced letter is never a suffix: "2375 b" is a bare 2375', () => {
    expect(desktop('What is left at 2375 b?', [SELECTED, MAIN, '2375B Main'])).toBe(switchOnDesktop('2375'));
    expect(desktop('What is left at 2375 b?', [SELECTED, MAIN, '2375B Main'], [], MAIN)).toBeNull();
  });

  it.each(['What is left at 2375 A?', 'What is left at 2375-A?', 'What is left at 2375-a?', 'Is 2375 A, the east wing, done?', 'Is 2375 A 2nd floor done?'])(
    '"%s" on 2375 Main St still names 2375A',
    question => {
      expect(desktop(question, [SELECTED, MAIN, PHASE], [], MAIN)).toBe(switchOnDesktop('2375A', '2375'));
    },
  );

  it('"What is left on 2375 A Street?" with 2375A Phase 2 names 2375 A Street, in Ask ECOS and Talk', () => {
    const projects = [SELECTED, A_STREET, PHASE];
    const question = 'What is left on 2375 A Street?';
    expect(desktop(question, projects)).toBe(switchOnDesktop('2375'));
    expect(talkAnswer(question, [SELECTED, PHASE], [A_STREET])).toBe(
      'Project 2321 is selected, but 2375 is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    );
    // Talk moves to the one project named in full instead of asking which.
    expect(mentionedDAVEProject(question, projects)).toBe(A_STREET);
    expect(talkAnswer(question, projects, [], A_STREET)).toBeNull();
    expect(desktop(question, projects, [], A_STREET)).toBeNull();
  });

  it('a capital standing alone that continues a project\'s own name ("2375 A" for "2375 A Street") is that project\'s', () => {
    const projects = [SELECTED, A_STREET, PHASE];
    expect(desktop('What is left on 2375 A?', projects)).toBe(switchOnDesktop('2375'));
    expect(desktop('What is left on 2375 A?', projects, [], A_STREET)).toBeNull();
    // Without such a project it is the lettered one.
    expect(desktop('What is left on 2375 A?', [SELECTED, PHASE])).toBe(switchOnDesktop('2375A'));
  });
});

describe('audit A9 pass 10 L2: a hyphen-joined letter in a project name is part of its identifier', () => {
  const MAIN = '2375 Main St';
  const ANNEX = '2375-B Annex';
  const PROJECTS = [SELECTED, MAIN, ANNEX];

  it('"2375-B Annex" is project 2375, shown as 2375B; a spaced "2375 A Street" stays 2375', () => {
    expect(ecosProjectIdentifier(ANNEX)).toBe('2375');
    expect(ecosProjectDisplayIdentifier(ANNEX)).toBe('2375B');
    expect(ecosProjectDisplayIdentifier('2375 A Street')).toBe('2375');
    expect(ecosProjectDisplayIdentifier('Building 2375-Phase 2')).toBe('2375');
  });

  it('on 2375 Main St, "2375-B" names the Annex, in Ask ECOS and Talk', () => {
    expect(desktop('What is left at 2375-B?', PROJECTS, [], MAIN)).toBe(switchOnDesktop('2375B', '2375'));
    expect(phone('What is left at 2375B?', PROJECTS, [], MAIN)).toBe(switchOnPhone('2375B', '2375'));
    expect(talkAnswer('What is left at 2375-B?', PROJECTS, [], MAIN)).toBe(switchOnPhone('2375B', '2375'));
    expect(mentionedDAVEProject('What is left at 2375-B?', PROJECTS)).toBe(ANNEX);
    expect(findECOSProjectReferenceMismatch(MAIN, 'What is left at 2375-B?', [SELECTED, MAIN], [ANNEX])).toEqual({
      selectedProjectIdentifier: '2375',
      referencedProjectIdentifier: '2375B',
      referencedProjectClosed: true,
    });
  });

  it('on the Annex, a bare "2375" names 2375 Main St, in Ask ECOS and Talk', () => {
    expect(desktop('What is left at 2375?', PROJECTS, [], ANNEX)).toBe(switchOnDesktop('2375', '2375B'));
    expect(talkAnswer('What is left at 2375?', PROJECTS, [], ANNEX)).toBe(switchOnPhone('2375', '2375B'));
    expect(mentionedDAVEProject('What is left at 2375?', PROJECTS)).toBe(MAIN);
  });

  it.each(['What is left at 2375-B?', 'What is left at 2375B?', 'What is left on 2375-B Annex?', 'Is 2375 B?'])(
    'on the Annex, its own "%s" is answered, in Ask ECOS and Talk',
    question => {
      expect(desktop(question, PROJECTS, [], ANNEX)).toBeNull();
      expect(talkAnswer(question, PROJECTS, [], ANNEX)).toBeNull();
    },
  );

  it('accepted: a spaced capital with a word after it is a word (L1), so "Is 2375 B done?" on the Annex names 2375 Main St', () => {
    expect(desktop('Is 2375 B done?', PROJECTS, [], ANNEX)).toBe(switchOnDesktop('2375', '2375B'));
  });

  it('on 2321, a bare "2375" names 2375 Main St, or the Annex when there is no plain 2375', () => {
    expect(desktop('What is left at 2375?', PROJECTS)).toBe(switchOnDesktop('2375'));
    expect(desktop('What is left at 2375?', [SELECTED, ANNEX])).toBe(switchOnDesktop('2375B'));
    expect(desktop('What is left at 2375?', [SELECTED, ANNEX], [], ANNEX)).toBeNull();
  });
});
