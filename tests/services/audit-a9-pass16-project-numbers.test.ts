import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectRefusal';
import { resolveDAVEConversationContext } from '../../services/DAVEConversationContext';
import { buildDAVETalkMemoryDraft, mentionedDAVEProject } from '../../services/DAVEConversationRouter';

// Audit A9 pass 16 (1 Oct 2026): owner answer Q20 refuses a question that
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

/** Whether a Talk note on `selected` is pre-confirmed to it, the way App.tsx builds the draft. */
function notePreConfirmed(note: string, selected: string, open: readonly string[], closed: readonly string[] = []) {
  const projectName = mentionedDAVEProject(note, open, closed) || selected;
  return buildDAVETalkMemoryDraft({
    id: 'talk-memory-1',
    createdAt: '2026-10-01T12:00:00.000Z',
    projectName,
    switchedProject: projectName !== selected,
    projectNames: open,
    closedProjectNames: closed,
    transcript: note,
    fields: { generalMemory: note },
  }).recommendedProject.confirmed;
}

describe('audit A9 pass 16 L1: a lower-case "a" continues an "A Street" name when the next name word follows', () => {
  const A_2375 = '24117 - 2375 A Street';
  const MAIN_2375 = '2375 Main St';
  const A_450 = '24117 - 450 A Street';
  const A_ST_450 = '24117 - 450 A St';
  const ELM = '450 Elm St';

  it('on 2321, "What is left at 2375 a st?" names 24117 - 2375 A Street (was answered from 2321)', () => {
    const label = '2375 (24117 - 2375 A Street)';
    expect(phone('What is left at 2375 a st?', [SELECTED, A_2375])).toBe(switchOnPhone(label));
    expect(desktop('What is left at 2375 a st?', [SELECTED, A_2375])).toBe(switchOnDesktop(label));
    expect(talkAnswer('What is left at 2375 a st?', [SELECTED, A_2375], [], SELECTED)).not.toBeNull();
  });

  it('on 2321, "what is left at 450 a street" names 24117 - 450 A St (was answered from 2321)', () => {
    const label = '450 (24117 - 450 A St)';
    expect(phone('what is left at 450 a street', [SELECTED, A_ST_450])).toBe(switchOnPhone(label));
    expect(desktop('what is left at 450 a street', [SELECTED, A_ST_450])).toBe(switchOnDesktop(label));
  });

  it('with 2375 Main St also open, Ask names the A Street job and Talk moves there (was 2375 Main St)', () => {
    expect(desktop('What is left at 2375 a st?', [SELECTED, A_2375, MAIN_2375])).toBe(switchOnDesktop('2375 (24117 - 2375 A Street)'));
    expect(mentionedDAVEProject('What is left at 2375 a st?', [SELECTED, A_2375, MAIN_2375])).toBe(A_2375);
  });

  it('on 24117 - 450 A Street with 450 Elm St open, its own "What is left at 450 a St?" is answered and Talk stays (was refused as 450 Elm St)', () => {
    const projects = [SELECTED, A_450, ELM];
    expect(phone('What is left at 450 a St?', projects, [], A_450)).toBeNull();
    expect(desktop('What is left at 450 a St?', projects, [], A_450)).toBeNull();
    expect(talkAnswer('What is left at 450 a St?', projects, [], A_450)).toBeNull();
    expect(mentionedDAVEProject('What is left at 450 a St?', projects)).toBe(A_450);
  });

  it('the note "Crew finished framing at 450 a St today" on 2321 with a closed 24117 - 450 A Street is not pre-confirmed (was)', () => {
    const note = 'Crew finished framing at 450 a St today';
    expect(phone(note, [SELECTED], [A_450])).not.toBeNull();
    expect(notePreConfirmed(note, SELECTED, [SELECTED], [A_450])).toBe(false);
  });

  it('a lower-case "a" that ends the question continues the name too', () => {
    expect(desktop('What is left at 450 a', [SELECTED, A_450, ELM], [], ELM)).toBe(switchOnDesktop('450 (24117 - 450 A Street)', '450'));
  });

  it('a lower-case "a" that starts the question does not continue a name before the number ("a 2375 update" is not "Tower A 2375")', () => {
    const projects = [SELECTED, 'Tower A 2375', MAIN_2375];
    expect(mentionedDAVEProject('a 2375 update please', projects)).toBeNull();
    expect(notePreConfirmed('a 2375 update please', MAIN_2375, projects)).toBe(true);
    // with the name word before it, it does
    expect(mentionedDAVEProject('Is tower a 2375 done?', projects)).toBe('Tower A 2375');
  });

  it('"Is 450 a priority this week?" is still answered on 450 Elm St, and Talk stays (pass 15 L5)', () => {
    for (const projects of [[SELECTED, ELM, A_450], [SELECTED, ELM, A_ST_450]]) {
      expect(phone('Is 450 a priority this week?', projects, [], ELM)).toBeNull();
      expect(desktop('Is 450 a priority this week?', projects, [], ELM)).toBeNull();
      expect(talkAnswer('Is 450 a priority this week?', projects, [], ELM)).toBeNull();
      expect(mentionedDAVEProject('Is 450 a priority this week?', projects)).toBe(ELM);
    }
  });
});
