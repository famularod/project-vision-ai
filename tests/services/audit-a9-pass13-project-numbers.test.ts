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

describe('audit A9 pass 13 L3: the selected project\'s own name continuing around a number makes it its own', () => {
  const SUITE = '2375 Main St Suite 300';
  const ELM = '300 Elm';
  const ELM_ST = '24117 - 450 Elm St';
  const OAK = '450 Oak Ave';

  it('"Is 2375 Main St Suite 300 done?" on that project, with 300 Elm, is answered (was refused)', () => {
    expect(desktop('Is 2375 Main St Suite 300 done?', [SELECTED, SUITE, ELM], [], SUITE)).toBeNull();
    expect(desktop('What is left in Suite 300?', [SELECTED, SUITE, ELM], [], SUITE)).toBeNull();
    expect(desktop('What is left in Suite 300?', [SELECTED, SUITE], [ELM], SUITE)).toBeNull();
  });

  it('"What is left at 450 Elm St?" on "24117 - 450 Elm St", with 450 Oak Ave open or closed, is answered (was refused)', () => {
    expect(desktop('What is left at 450 Elm St?', [SELECTED, ELM_ST, OAK], [], ELM_ST)).toBeNull();
    expect(desktop('What is left at 450 Elm Street?', [SELECTED, ELM_ST, OAK], [], ELM_ST)).toBeNull();
    expect(desktop('What is left at 450 Elm St?', [SELECTED, ELM_ST], [OAK], ELM_ST)).toBeNull();
  });

  it('another project\'s name, or a bare number, still names the other project', () => {
    expect(desktop('Is 300 Elm done?', [SELECTED, SUITE, ELM], [], SUITE)).toBe(switchOnDesktop('300', '2375'));
    expect(desktop('What is left at 450 Oak Ave?', [SELECTED, ELM_ST, OAK], [], ELM_ST)).toBe(switchOnDesktop('450', '24117'));
    expect(desktop('What is left at 450?', [SELECTED, ELM_ST, OAK], [], ELM_ST)).toBe(switchOnDesktop('450', '24117'));
  });

  it('when another project\'s name continues as far around it, it is ambiguous and refused', () => {
    expect(desktop('What is left at 450 Elm?', [SELECTED, ELM_ST, '450 Elm Annex'], [], ELM_ST)).toBe(switchOnDesktop('450', '24117'));
  });

  it('the name that continues furthest owns it: the selected one\'s full name is not refused for a shorter match', () => {
    const MAIN = '2375 Main St';
    const BLDG = 'Bldg 100A 2375 Main';
    const REMODEL = '1950s Remodel 2377 Days Inn';
    const RENOVATION = '2377 Days Inn Renovation';
    expect(desktop('Is 2375 Main St done?', [SELECTED, MAIN, BLDG], [], MAIN)).toBeNull();
    expect(desktop('Is Bldg 100A 2375 Main done?', [SELECTED, MAIN, BLDG], [], BLDG)).toBeNull();
    expect(desktop('Is 1950s Remodel 2377 Days Inn done?', [SELECTED, REMODEL, RENOVATION], [], REMODEL)).toBeNull();
    expect(desktop('Is 2377 Days Inn Renovation done?', [SELECTED, REMODEL, RENOVATION], [], RENOVATION)).toBeNull();
    // Further for the other project names it; as far is ambiguous.
    expect(desktop('Is Bldg 100A 2375 Main St done?', [SELECTED, MAIN, BLDG], [], MAIN)).toMatch(/this question names /);
    expect(desktop('What is left at 2375 Main?', [SELECTED, MAIN, BLDG], [], BLDG)).toBe(switchOnDesktop('2375', '100A'));
  });
});

describe('audit A9 pass 13 L4: Talk applies the same principle', () => {
  const SWITCHGEAR = '480V Switchgear Upgrade 2375';
  const MAIN = '2375 Main St';
  const ANNEX = '2375-B Annex Suite 300';
  const SUITE = '2375 Main St Suite 300';
  const ELM = '300 Elm';
  const ELM_ST = '24117 - 450 Elm St';
  const OAK = '450 Oak Ave';
  const TWO_PROJECTS = /^This question names two projects/;

  it('"What is left at 2375 Main St?" moves to 2375 Main St, not also the switchgear job (was "names two projects")', () => {
    const projects = [SELECTED, SWITCHGEAR, MAIN];
    expect(mentionedDAVEProject('What is left at 2375 Main St?', projects)).toBe(MAIN);
    expect(talkAnswer('What is left at 2375 Main St?', projects)).toBe(switchOnPhone('2375'));
  });

  it('L1 in Talk: another project\'s name around the number names just that project', () => {
    expect(talkAnswer('Is 2375 Main St done?', [SELECTED, SWITCHGEAR, MAIN], [], SWITCHGEAR)).toBe(switchOnPhone('2375', '480V'));
    expect(talkAnswer('Is 300 Elm done?', [SELECTED, ANNEX, ELM], [], ANNEX)).toBe(switchOnPhone('300', '2375B'));
    expect(talkAnswer('Is 300 Elm done?', [SELECTED, ANNEX], [ELM], ANNEX)).toBe(closedOnPhone('300', '2375B'));
    expect(mentionedDAVEProject('Is 300 Elm done?', [SELECTED, ANNEX, ELM])).toBe(ELM);
  });

  it('L3 in Talk: the selected project\'s own address or full name is answered, and Talk does not move away', () => {
    expect(talkAnswer('Is 2375 Main St Suite 300 done?', [SELECTED, SUITE, ELM], [], SUITE)).toBeNull();
    expect(talkAnswer('What is left in Suite 300?', [SELECTED, SUITE, ELM], [], SUITE)).toBeNull();
    expect(talkAnswer('What is left at 450 Elm St?', [SELECTED, ELM_ST, OAK], [], ELM_ST)).toBeNull();
    // Talk moved this to 450 Oak Ave and answered it there.
    expect(mentionedDAVEProject('What is left at 450 Elm St?', [SELECTED, ELM_ST, OAK])).toBe(ELM_ST);
  });

  it('two projects whose names continue around the number: Talk asks which', () => {
    const projects = [SELECTED, ELM_ST, '450 Elm Annex'];
    expect(mentionedDAVEProject('What is left at 450 Elm?', projects)).toBeNull();
    expect(talkAnswer('What is left at 450 Elm?', projects)).toMatch(TWO_PROJECTS);
  });

  it('a bare number still moves by identifier (pass 12 L1)', () => {
    expect(mentionedDAVEProject('What is left on 2375?', [SELECTED, SWITCHGEAR])).toBe(SWITCHGEAR);
    expect(talkAnswer('What is left on 2375?', [SELECTED, SWITCHGEAR, MAIN])).toMatch(TWO_PROJECTS);
  });
});

describe('audit A9 pass 13 wording: a refusal names the number the question used', () => {
  const SWITCHGEAR = '480V Switchgear Upgrade 2375';
  const ELM_ST = '24117 - 450 Elm St';

  it('"What is left on 2375?" names 2375 and the project it is, not 480V, open or closed (was "names 480V")', () => {
    const label = '2375 (480V Switchgear Upgrade 2375)';
    expect(desktop('What is left on 2375?', [SELECTED, SWITCHGEAR])).toBe(switchOnDesktop(label));
    expect(phone('What is left on 2375?', [SELECTED], [SWITCHGEAR])).toBe(closedOnPhone(label));
  });

  it('a number in another project\'s name around which its name continues shows that name', () => {
    expect(desktop('What is left at 450 Elm St?', [SELECTED, ELM_ST])).toBe(switchOnDesktop('450 (24117 - 450 Elm St)'));
  });

  it('Talk lists the numbers David said the same way', () => {
    expect(talkAnswer('What is left on 2375?', [SELECTED, SWITCHGEAR, '2375 Main St'])).toBe(
      'This question names two projects, 2375 (480V Switchgear Upgrade 2375) and 2375. Which one do you mean? Ask again about just that project.',
    );
  });

  it('a project named by its shown number keeps the short label', () => {
    expect(desktop('Is the 480V gear in?', [SELECTED, SWITCHGEAR])).toBe(switchOnDesktop('480V'));
    expect(desktop('What is left at 2375?', [SELECTED, '2375A Main', '2375a Annex'])).toBe(switchOnDesktop('2375A'));
    expect(desktop('What is left at 2375-B?', [SELECTED, '2375-B Annex Suite 300'])).toBe(switchOnDesktop('2375B'));
  });
});
