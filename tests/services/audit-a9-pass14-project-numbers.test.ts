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
