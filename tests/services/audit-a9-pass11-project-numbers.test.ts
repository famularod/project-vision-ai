import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectQuestion';
import { resolveDAVEConversationContext } from '../../services/DAVEConversationContext';
import { buildDAVETalkMemoryDraft, mentionedDAVEProject } from '../../services/DAVEConversationRouter';

// Audit A9 pass 11 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. When unsure, refuse. Identifiers are
// compared whole and upper-cased ("2375" is not "2375B"). Synthetic project
// names; whether any real project number carries a letter is owner question
// Q27.

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

function noteDraft(note: string, selected: string, open: readonly string[]) {
  return buildDAVETalkMemoryDraft({
    id: 'note-1',
    createdAt: '2026-09-30T12:00:00.000Z',
    projectName: selected,
    switchedProject: false,
    projectNames: open,
    closedProjectNames: [],
    transcript: note,
    fields: { generalMemory: note },
  });
}

describe('audit A9 pass 11 F1: a spaced capital with a word after it is the letter when number and capital are a project\'s identifier', () => {
  const MAIN = '2375 Main St';
  const ANNEX = '2375B Annex';
  const PROJECTS = [SELECTED, MAIN, ANNEX];
  const QUESTIONS = ['Is 2375 B done?', 'How is 2375 B going?', 'What is left on 2375 B wing?', 'Did 2375 B pass inspection?'];

  it.each(QUESTIONS)('"%s" on 2375 Main St names the Annex, in Ask ECOS and Talk (was answered from Main St)', question => {
    expect(desktop(question, PROJECTS, [], MAIN)).toBe(switchOnDesktop('2375B', '2375'));
    expect(phone(question, PROJECTS, [], MAIN)).toBe(switchOnPhone('2375B', '2375'));
    expect(talkAnswer(question, PROJECTS, [], MAIN)).toBe(switchOnPhone('2375B', '2375'));
  });

  it.each(QUESTIONS)('"%s" on 2321 sends David to the Annex, and Talk moves there (was Main St)', question => {
    expect(desktop(question, PROJECTS)).toBe(switchOnDesktop('2375B'));
    expect(mentionedDAVEProject(question, PROJECTS)).toBe(ANNEX);
  });

  it.each(QUESTIONS)('"%s" on the Annex is its own, in Ask ECOS and Talk', question => {
    expect(desktop(question, PROJECTS, [], ANNEX)).toBeNull();
    expect(talkAnswer(question, PROJECTS, [], ANNEX)).toBeNull();
  });

  it('a closed Annex is refused as closed', () => {
    expect(phone('Is 2375 B done?', [SELECTED, MAIN], [ANNEX], MAIN)).toBe(
      'Project 2375 is selected, but 2375B is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    );
  });

  it('with no project 2375B, "Is 2375 B done?" is a bare 2375: answered on Main St, refused elsewhere', () => {
    expect(desktop('Is 2375 B done?', [SELECTED, MAIN], [], MAIN)).toBeNull();
    expect(desktop('Is 2375 B done?', [SELECTED, MAIN])).toBe(switchOnDesktop('2375'));
  });

  it('a lower-case "b" is still a word: "Is 2375 b done?" on Main St is answered', () => {
    expect(desktop('Is 2375 b done?', PROJECTS, [], MAIN)).toBeNull();
  });

  it('"Is 2375 A priority this week?" (capital A) on Main St names 2375A Phase 2 again; lower-case "a" is answered', () => {
    const projects = [SELECTED, MAIN, '2375A Phase 2'];
    expect(desktop('Is 2375 A priority this week?', projects, [], MAIN)).toBe(switchOnDesktop('2375A', '2375'));
    expect(desktop('Is 2375 a priority this week?', projects, [], MAIN)).toBeNull();
  });

  it('a capital that continues a plain project\'s own name is that project\'s: "2375 A Street" with 2375A Phase 2', () => {
    const projects = [SELECTED, '2375 A Street', '2375A Phase 2'];
    expect(desktop('What is left on 2375 A Street?', projects)).toBe(switchOnDesktop('2375'));
    expect(desktop('Is 2375 A Street done?', projects, [], '2375 A Street')).toBeNull();
    expect(mentionedDAVEProject('What is left on 2375 A Street?', projects)).toBe('2375 A Street');
  });

  it('a note "Crew at 2375 B left early." on 2375A is not pre-confirmed there when 2375B is a project', () => {
    const lettered = [SELECTED, '2375A Phase 2', '2375B Main'];
    expect(noteDraft('Crew at 2375 B left early.', '2375A Phase 2', lettered).recommendedProject.confirmed).toBe(false);
  });
});

describe('audit A9 pass 11 F2: a hyphen letter always counts, even when it continues a plain project\'s name', () => {
  const A_STREET = '2375 A Street';
  const PHASE = '2375A Phase 2';
  const PROJECTS = [SELECTED, A_STREET, PHASE];

  it('"Is 2375-A done?" on 2375 A Street names 2375A Phase 2, in Ask ECOS and Talk (was answered)', () => {
    expect(desktop('Is 2375-A done?', PROJECTS, [], A_STREET)).toBe(switchOnDesktop('2375A', '2375'));
    expect(phone('Is 2375-A done?', PROJECTS, [], A_STREET)).toBe(switchOnPhone('2375A', '2375'));
    expect(talkAnswer('Is 2375-A done?', PROJECTS, [], A_STREET)).toBe(switchOnPhone('2375A', '2375'));
  });

  it('on 2321 it names 2375A Phase 2, and Talk moves there', () => {
    expect(desktop('Is 2375-A done?', PROJECTS)).toBe(switchOnDesktop('2375A'));
    expect(mentionedDAVEProject('Is 2375-A done?', PROJECTS)).toBe(PHASE);
  });

  it('on 2375A Phase 2 it is its own; a spaced "2375 A Street" is still A Street\'s', () => {
    expect(desktop('Is 2375-A done?', PROJECTS, [], PHASE)).toBeNull();
    expect(talkAnswer('Is 2375-A done?', PROJECTS, [], PHASE)).toBeNull();
    expect(desktop('Is 2375 A Street done?', PROJECTS, [], A_STREET)).toBeNull();
  });
});
