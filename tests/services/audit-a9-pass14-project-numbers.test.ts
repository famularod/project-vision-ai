import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectRefusal';
import { resolveDAVEConversationContext } from '../../services/DAVEConversationContext';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';

// Audit A9 pass 14 (1 Oct 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. When unsure, refuse. Pass 13 gave a
// plain number to the project whose name continues furthest around it in
// the question; this pass fixes how that is counted and worded. Synthetic
// project names.

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

describe('audit A9 pass 14 L1: a function word in a name is not a name word', () => {
  const AT = 'Suite 300 at 2375 Main';
  const ELM = '2375 Elm';
  const PROJECTS = [SELECTED, AT, ELM, '300 Oak'];

  it('on 2375 Elm, "What is left at 2375?" and "... at 2375 Elm?" are its own (were refused as Suite 300 at 2375 Main)', () => {
    expect(phone('What is left at 2375?', PROJECTS, [], ELM)).toBeNull();
    expect(phone('What is left at 2375 Elm?', PROJECTS, [], ELM)).toBeNull();
    expect(talkAnswer('What is left at 2375?', PROJECTS, [], ELM)).toBeNull();
  });

  it('on "2025 Roof Replacement at 450 Elm St", "at" does not tie it with 450 Oak Ave', () => {
    const projects = [SELECTED, '2025 Roof Replacement at 450 Elm St', '450 Oak Ave'];
    expect(desktop('What is left at 450 Oak?', projects, [], '450 Oak Ave')).toBeNull();
  });

  it('on "Suite 300 at 2375 Main", "What is left at 2375?" names 2375 Elm, open or closed (was answered)', () => {
    expect(phone('What is left at 2375?', PROJECTS, [], AT)).toBe(switchOnPhone('2375', '300'));
    expect(phone('What is left at 2375?', [SELECTED, AT, '300 Oak'], [ELM], AT)).toBe(closedOnPhone('2375', '300'));
    expect(talkAnswer('What is left at 2375?', PROJECTS, [], AT)).toBe(switchOnPhone('2375', '300'));
  });

  it('a function word still joins the name words around it: the full name is its own', () => {
    expect(desktop('Is Suite 300 at 2375 Main done?', PROJECTS, [], AT)).toBeNull();
    expect(desktop('Is 300 at 2375 Main done?', PROJECTS, [], ELM)).toBe(switchOnDesktop('300', '2375'));
  });

  it('Talk: a note "at 2375" stays with 2375 Elm (moved to Suite 300 at 2375 Main)', () => {
    expect(mentionedDAVEProject('Crew finished framing at 2375 today', PROJECTS)).toBe(ELM);
    expect(mentionedDAVEProject('Crew finished framing on 2375 today', PROJECTS)).toBe(ELM);
  });

  it('a capital letter A in a name is still a name word ("2375 A?" is 2375 A Street; pass 10 L1)', () => {
    const projects = [SELECTED, '2375 A Street', '2375A Phase 2'];
    expect(desktop('What is left on 2375 A?', projects, [], '2375 A Street')).toBeNull();
    expect(desktop('Is 2375 A St. done?', projects, [], '2375 A Street')).toBeNull();
  });
});

describe('audit A9 pass 14 L2: a tie with the selected project asks which one, and a name said in full is its own', () => {
  const ELM_ST = '24117 - 450 Elm St';
  const OLD_ELM_ST = '23088 - 450 Elm St';
  const both = (...labels: string[]) =>
    `This question names two projects, ${labels.join(' and ')}. Which one do you mean? Ask again about just that project.`;

  it('own address with an older closed job at the same address: Ask ECOS asks which, as Talk does (was "Reopen it")', () => {
    const open = [SELECTED, ELM_ST, '2375 Main St'];
    const expected = both('450 (24117 - 450 Elm St)', '450 (23088 - 450 Elm St)');
    expect(phone('What is left at 450 Elm St?', open, [OLD_ELM_ST], ELM_ST)).toBe(expected);
    expect(desktop('What is left at 450 Elm St?', open, [OLD_ELM_ST], ELM_ST)).toBe(expected);
    expect(talkAnswer('What is left at 450 Elm St?', open, [OLD_ELM_ST], ELM_ST)).toBe(expected);
  });

  it('an open tie is worded the same way (was "this question names 450")', () => {
    const open = [SELECTED, ELM_ST, '450 Elm Annex'];
    const expected = both('450 (24117 - 450 Elm St)', '450');
    expect(desktop('What is left at 450 Elm?', open, [], ELM_ST)).toBe(expected);
    expect(phone('What is left at 450 Elm?', open, [], ELM_ST)).toBe(expected);
    expect(talkAnswer('What is left at 450 Elm?', open, [], ELM_ST)).toBe(expected);
  });

  it('"Is 2375 Main St done?" on 2375 Main St is its own with a closed "24117 - 2375 Main St" (was "Reopen it")', () => {
    const open = [SELECTED, '2375 Main St'];
    const closed = ['24117 - 2375 Main St'];
    expect(phone('Is 2375 Main St done?', open, closed, '2375 Main St')).toBeNull();
    expect(desktop('Is 2375 Main St done?', open, closed, '2375 Main St')).toBeNull();
    expect(talkAnswer('Is 2375 Main St done?', open, closed, '2375 Main St')).toBeNull();
  });

  it('the other name said in full still names it, and so does a bare job number', () => {
    const open = [SELECTED, '2375 Main St'];
    const closed = ['24117 - 2375 Main St'];
    expect(phone('Is 24117 - 2375 Main St done?', open, closed, '2375 Main St')).toBe(closedOnPhone('24117', '2375'));
    expect(phone('Is 24117 done?', open, closed, '2375 Main St')).toBe(closedOnPhone('24117', '2375'));
    // The other project's name said in full and the selected one's only in part.
    expect(desktop('What is left at 450 Elm St?', [SELECTED, ELM_ST, '450 Elm St'], [], ELM_ST)).toBe(switchOnDesktop('450', '24117'));
  });
});

describe('audit A9 pass 14 L3: a project sharing the selected one\'s shown number is its own only for that number', () => {
  const PINE = '452 Pine Ave';
  const KROGER = 'Kroger #452 - 2375 Main St';
  const STORE = 'Store 452 at 2375 Main St';
  const ELM = '2375 Elm St';
  const KROGER_LABEL = '2375 (Kroger #452 - 2375 Main St)';

  it('on 452 Pine Ave, "Is 2375 Main St done?" names the Kroger job, open or closed, in Ask ECOS and Talk (was answered)', () => {
    expect(desktop('Is 2375 Main St done?', [SELECTED, PINE, KROGER, ELM], [], PINE)).toBe(switchOnDesktop(KROGER_LABEL, '452'));
    expect(phone('Is 2375 Main St done?', [SELECTED, PINE, ELM], [KROGER], PINE)).toBe(closedOnPhone(KROGER_LABEL, '452'));
    expect(talkAnswer('Is 2375 Main St done?', [SELECTED, PINE, KROGER, ELM], [], PINE)).toBe(switchOnPhone(KROGER_LABEL, '452'));
    expect(mentionedDAVEProject('Is 2375 Main St done?', [PINE, KROGER, ELM])).toBe(KROGER);
  });

  it('with "Store 452 at 2375 Main St", "Is 2375 Main St done?" names the store and "What is left at 2375?" names 2375 Elm St', () => {
    const projects = [SELECTED, PINE, STORE, ELM];
    expect(desktop('Is 2375 Main St done?', projects, [], PINE)).toBe(switchOnDesktop('2375 (Store 452 at 2375 Main St)', '452'));
    expect(desktop('What is left at 2375?', projects, [], PINE)).toBe(switchOnDesktop('2375', '452'));
  });

  it('the shared shown number itself is still the selected one\'s own (Q20)', () => {
    const projects = [SELECTED, PINE, KROGER, ELM];
    expect(desktop('What is left at 452?', projects, [], PINE)).toBeNull();
    expect(desktop('Is Kroger #452 done?', projects, [], PINE)).toBeNull();
    expect(desktop('Is 452 Pine Ave done?', projects, [], PINE)).toBeNull();
    expect(talkAnswer('Is Kroger #452 done?', projects, [], PINE)).toBeNull();
  });
});
