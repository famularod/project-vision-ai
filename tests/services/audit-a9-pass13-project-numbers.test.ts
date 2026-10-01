import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectQuestion';
import { resolveDAVEConversationContext } from '../../services/DAVEConversationContext';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';

// Audit A9 pass 13 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. When unsure, refuse. One principle: a
// number belongs to the project whose name continues around it in the
// question, when exactly one does; more than one is refused as ambiguous;
// none falls back to the identifier rules. Synthetic project names.

const SELECTED = '2321 Compliance Project';

const phone = (question: string, known: readonly string[] | undefined, closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const desktop = (question: string, known: readonly string[] | undefined, closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'desktop' });
const switchOnPhone = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Close this, open project ${number}, then ask again.`;
const switchOnDesktop = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Select project ${number} above, then ask again.`;
const closedOnPhone = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but ${number} is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.`;

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

describe('audit A9 pass 13 L1: another project\'s name continuing around a number names that project', () => {
  const ANNEX = '2375-B Annex Suite 300';
  const ELM = '300 Elm';
  const SWITCHGEAR = '480V Switchgear Upgrade 2375';
  const MAIN = '2375 Main St';

  it('"Is 300 Elm done?" on "2375-B Annex Suite 300" names 300 Elm, open or closed (was answered from the Annex)', () => {
    expect(desktop('Is 300 Elm done?', [SELECTED, ANNEX, ELM], [], ANNEX)).toBe(switchOnDesktop('300', '2375B'));
    expect(phone('Is 300 Elm done?', [SELECTED, ANNEX], [ELM], ANNEX)).toBe(closedOnPhone('300', '2375B'));
    expect(talkAnswer('Is 300 Elm done?', [SELECTED, ANNEX, ELM], [], ANNEX)).not.toBeNull();
  });

  it('"Is 2375 Main St done?" on "480V Switchgear Upgrade 2375" names 2375 Main St, open or closed (was answered)', () => {
    expect(desktop('Is 2375 Main St done?', [SELECTED, SWITCHGEAR, MAIN], [], SWITCHGEAR)).toBe(switchOnDesktop('2375', '480V'));
    expect(phone('Is 2375 Main St done?', [SELECTED, SWITCHGEAR], [MAIN], SWITCHGEAR)).toBe(closedOnPhone('2375', '480V'));
    expect(talkAnswer('Is 2375 Main St done?', [SELECTED, SWITCHGEAR, MAIN], [], SWITCHGEAR)).not.toBeNull();
  });

  it('when the selected one\'s name continues around it too, it is ambiguous and refused', () => {
    expect(desktop('Is Suite 300 Elm done?', [SELECTED, ANNEX, ELM], [], ANNEX)).toBe(switchOnDesktop('300', '2375B'));
  });

  it('a bare number with no name around it is still the selected one\'s own (pass 12 L1)', () => {
    expect(desktop('What is left at 300?', [SELECTED, ANNEX, ELM], [], ANNEX)).toBeNull();
    expect(desktop('What is left on 2375?', [SELECTED, SWITCHGEAR, MAIN], [], SWITCHGEAR)).toBeNull();
  });

  it('a project sharing the selected one\'s shown number is still its own, whatever name follows', () => {
    const projects = [SELECTED, MAIN, '2375 Main St Phase 2'];
    expect(desktop('Is 2375 Main St done?', projects, [], MAIN)).toBeNull();
    expect(desktop('Is 2375 Main St Phase 2 done?', projects, [], MAIN)).toBeNull();
  });
});

describe('audit A9 pass 13 L2: a street abbreviation continues a name written in full', () => {
  const A_STREET = '2375 A Street';
  const PHASE = '2375A Phase 2';
  const PROJECTS = [SELECTED, A_STREET, PHASE];

  it.each(['Is 2375 A St. done?', 'Is 2375 A St done?', 'Is 2375 A street. done?'])(
    '"%s" on 2375 A Street is its own, in Ask ECOS and Talk (was read as 2375A)',
    question => {
      expect(desktop(question, PROJECTS, [], A_STREET)).toBeNull();
      expect(talkAnswer(question, PROJECTS, [], A_STREET)).toBeNull();
    },
  );

  it('on 2321 it names 2375 A Street, and Talk moves there (was 2375A Phase 2)', () => {
    expect(desktop('Is 2375 A St. done?', PROJECTS)).toBe(switchOnDesktop('2375'));
    expect(mentionedDAVEProject('Is 2375 A St. done?', PROJECTS)).toBe(A_STREET);
  });

  it('on 2375A Phase 2 it names 2375 A Street (was answered as its own)', () => {
    expect(desktop('Is 2375 A St. done?', PROJECTS, [], PHASE)).toBe(switchOnDesktop('2375', '2375A'));
  });

  it.each([
    ['Ave', 'Avenue'], ['Rd', 'Road'], ['Blvd', 'Boulevard'], ['Dr', 'Drive'], ['Ln', 'Lane'],
    ['Ct', 'Court'], ['Pl', 'Place'], ['Hwy', 'Highway'], ['Pkwy', 'Parkway'], ['Street', 'St'],
  ])('"2375 B %s." continues "2375 B %s"', (written, inName) => {
    const projects = [SELECTED, `2375 B ${inName}`, '2375B Annex'];
    expect(desktop(`Is 2375 B ${written}. done?`, projects, [], `2375 B ${inName}`)).toBeNull();
  });

  it('another street word is still the letter: "2375 A Ave" is not 2375 A Street', () => {
    expect(desktop('Is 2375 A Ave done?', PROJECTS, [], A_STREET)).toBe(switchOnDesktop('2375A', '2375'));
  });
});
