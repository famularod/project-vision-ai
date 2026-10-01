import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectRefusal';
import { resolveDAVEConversationContext } from '../../services/DAVEConversationContext';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';

// Audit A9 pass 15 (1 Oct 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. When unsure, refuse. A plain number
// belongs to the project whose name continues furthest around it. Synthetic
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

describe('audit A9 pass 15 M1: an address with a compass word is that project\'s address', () => {
  const MAIN = '24117 - 400 N Main St';
  const OAK = '400 Oak Ave';
  const MAIN_LABEL = '400 (24117 - 400 N Main St)';

  it.each([
    ['Is 400 N. Main done?', MAIN, MAIN_LABEL],
    ['Is 400 North Main done?', MAIN, MAIN_LABEL],
    ['Is 1200 S. Broadway done?', '24117 - 1200 S Broadway', '1200 (24117 - 1200 S Broadway)'],
    ['Is 2375 W. 7th St done?', '24117 - 2375 W 7th St', '2375 (24117 - 2375 W 7th St)'],
    ['Is 780 SW Harbor done?', '23088 - 780 Southwest Harbor Dr', '780 (23088 - 780 Southwest Harbor Dr)'],
  ])('on 2321, "%s" names "%s" (was answered from 2321)', (question, other, label) => {
    expect(phone(question, [SELECTED, other])).toBe(switchOnPhone(label));
    expect(desktop(question, [SELECTED, other])).toBe(switchOnDesktop(label));
    expect(mentionedDAVEProject(question, [SELECTED, other])).toBe(other);
  });

  it('with 400 Oak Ave also open, "Is 400 N. Main done?" names 24117 - 400 N Main St, and Talk moves there (was 400 Oak Ave)', () => {
    expect(phone('Is 400 N. Main done?', [SELECTED, MAIN, OAK])).toBe(switchOnPhone(MAIN_LABEL));
    expect(mentionedDAVEProject('Is 400 N. Main done?', [SELECTED, MAIN, OAK])).toBe(MAIN);
    expect(mentionedDAVEProject('Crew finished framing at 400 N. Main today', [SELECTED, MAIN, OAK])).toBe(MAIN);
  });

  it('on 24117 - 400 N Main St its own "400 N. Main St" is answered in Ask ECOS and Talk (was refused as 400 Oak Ave)', () => {
    for (const question of ['Is 400 N. Main St done?', 'Is 400 North Main St done?', 'Is 400 N. Main done?']) {
      expect(phone(question, [SELECTED, MAIN, OAK], [], MAIN)).toBeNull();
      expect(desktop(question, [SELECTED, MAIN, OAK], [], MAIN)).toBeNull();
      expect(talkAnswer(question, [SELECTED, MAIN, OAK], [], MAIN)).toBeNull();
    }
  });

  it('a compass word spelled out matches only with another of the name\'s words ("Is 400 North done?" is not N Main St)', () => {
    expect(desktop('Is 400 North done?', [SELECTED, MAIN, OAK], [], OAK)).toBeNull();
  });

  it('a spaced capital that is a project\'s letter is still read as one ("Is 2375 B done?" with 2375B Annex)', () => {
    expect(desktop('Is 2375 B done?', [SELECTED, '2375B Annex', '2375 Main St'])).toBe(switchOnDesktop('2375B'));
  });
});
