import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectRefusal';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';

// Build 231 E1 item 9 (audit A9 pass 17 L2): a project NAME typed with a
// lower-case street letter ("24117 - 450 a Street") is read as "450 A
// Street" by the Ask ECOS project check and by Talk. Synthetic project names.

const SELECTED = '2321 Compliance Project';
const ELM = '450 Elm St';
const LOWER = '24117 - 450 a Street';

const ask = (question: string, known: readonly string[], selected: string, refusalWording: 'phone' | 'desktop' = 'desktop') =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { refusalWording });
const switchOnDesktop = (number: string, selected: string) =>
  `Project ${selected} is selected, but this question names ${number}. Select project ${number} above, then ask again.`;
const switchOnPhone = (number: string, selected: string) =>
  `Project ${selected} is selected, but this question names ${number}. Close this, open project ${number}, then ask again.`;

describe('E1 item 9: a project name typed with a lower-case street letter', () => {
  const PROJECTS = [SELECTED, ELM, LOWER];
  const LABEL = `450 (${LOWER})`;

  it.each([
    'What is left at 450 A St?',
    'What is left at 450 a st?',
    'What is left at 450 A?',
    'What is left at 450 a',
  ])('on 450 Elm St, "%s" names 24117 - 450 a Street (was answered from 450 Elm St)', question => {
    expect(ask(question, PROJECTS, ELM)).toBe(switchOnDesktop(LABEL, '450'));
    expect(ask(question, PROJECTS, ELM, 'phone')).toBe(switchOnPhone(LABEL, '450'));
    expect(mentionedDAVEProject(question, PROJECTS)).toBe(LOWER);
  });

  it('on 2321, "What is left at 450 A St?" names the one project, not either 450 (was "names 450")', () => {
    expect(ask('What is left at 450 A St?', PROJECTS, SELECTED)).toBe(switchOnDesktop(LABEL, '2321'));
  });

  it('reads the lower-case name exactly as the same name with a capital A', () => {
    const CAPITAL = '24117 - 450 A Street';
    const asCapital = (text: string | null) => text?.split(LOWER).join(CAPITAL) ?? null;
    for (const question of [
      'What is left at 450 a Street?', 'What is left at 450 A Street?', 'What is left at 450 A St?',
      'What is left at 450 a st?', 'What is left at 450 A?', 'What is left at 450 a',
      'Is 450 a priority this week?', 'What is left at 450 a street punch list?', 'What is left at 450?',
    ]) {
      for (const selected of [SELECTED, ELM]) {
        expect([question, selected, asCapital(ask(question, PROJECTS, selected))])
          .toEqual([question, selected, ask(question, [SELECTED, ELM, CAPITAL], selected)]);
      }
      expect([question, asCapital(mentionedDAVEProject(question, PROJECTS))])
        .toEqual([question, mentionedDAVEProject(question, [SELECTED, ELM, CAPITAL])]);
    }
  });

  // Guards: these already hold on 594a71d.
  it('the word "a" in a question is still not the street letter', () => {
    expect(ask('Is 450 a priority this week?', PROJECTS, ELM)).toBeNull();
    expect(mentionedDAVEProject('Is 450 a priority this week?', PROJECTS)).toBe(ELM);
  });

  it('a name whose "a" is not before a street word keeps its article', () => {
    const ROOF = '24117 - 450 a new roof';
    expect(ask('What is left at 450 A?', [SELECTED, ELM, ROOF], ELM)).toBeNull();
    expect(ask('What is left at 450 a', [SELECTED, ELM, ROOF], ELM)).toBeNull();
  });
});
