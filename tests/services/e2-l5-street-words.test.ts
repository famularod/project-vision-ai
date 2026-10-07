import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectRefusal';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import { ECOS_STREET_LETTER_WORDS } from '../../supabase/functions/_shared/ecos-project-reference';

// Review pass 1, L5 (older; the limit of "a project name typed with a
// lower-case street letter is recognised"): the lower-case "a" of a project
// name was read as the street's letter only before ten street words. A
// project named "24117 - 450 a Way" (or Circle, Terrace, Trail, Alley) was
// still read with "a" as the article: on 450 Elm St, "What is left at 450 A?"
// was answered from 450 Elm St, and on the "450 a Way" project itself the
// same question was refused. The street words now cover the common ones.
// Synthetic project names only.

const SELECTED = '2321 Compliance Project';
const ELM = '450 Elm St';

const ask = (question: string, known: readonly string[], selected: string) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { refusalWording: 'desktop' });

const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Every question a person might put about the place, for one street word. */
const questions = (street: string) => [
  `What is left at 450 A ${street}?`, `What is left at 450 a ${street.toLowerCase()}?`, 'What is left at 450 A?', 'What is left at 450 a',
  'What is left at 450 a?', 'Is 450 a priority this week?', 'What is left at 450?', `450 A ${street} punch list`,
  `Show 450 a ${street} punch list`, 'What is left at 450 A St?', 'What is left at 450-A?', 'What is left at 450A?',
  `Add a note for 450 a ${street}: slab poured`, `What is left at the 450 A ${street} job`,
];
const NAME_SHAPES = [
  (letter: string, street: string) => `24117 - 450 ${letter} ${street}`,
  (letter: string, street: string) => `450 ${letter} ${street}`,
  (letter: string, street: string) => `Market 450 ${letter} ${street} Remodel`,
  (letter: string, street: string) => `24117 - 450 ${letter} ${street} NW`,
];

/** Where a name typed with a lower-case "a" is read differently from the same name typed with a capital. */
function differencesFor(street: string): string[] {
  const found: string[] = [];
  for (const shape of NAME_SHAPES) {
    const lower = shape('a', street);
    const capital = shape('A', street);
    const asCapital = (text: string | null) => text?.split(lower).join(capital) ?? null;
    for (const question of questions(street)) {
      for (const selected of [SELECTED, ELM, 'the project itself'] as const) {
        const withLower = ask(question, [SELECTED, ELM, lower], selected === 'the project itself' ? lower : selected);
        const withCapital = ask(question, [SELECTED, ELM, capital], selected === 'the project itself' ? capital : selected);
        if (asCapital(withLower) !== withCapital) found.push(`Ask ECOS, "${lower}", on ${selected}: "${question}"`);
      }
      if (asCapital(mentionedDAVEProject(question, [SELECTED, ELM, lower])) !== mentionedDAVEProject(question, [SELECTED, ELM, capital])) {
        found.push(`Talk, "${lower}": "${question}"`);
      }
    }
  }
  return found;
}

describe('L5: the street words that make a lower-case "a" the street\'s letter', () => {
  it('the list: the ten there were, the five the review named, and the other common ones, each with its usual short form', () => {
    expect([...ECOS_STREET_LETTER_WORDS].sort()).toEqual([
      'alley', 'aly', 'ave', 'avenue', 'bend', 'blvd', 'bnd', 'boulevard', 'cir', 'circle', 'court', 'cove', 'cres', 'crescent',
      'crossing', 'ct', 'cv', 'dr', 'drive', 'expressway', 'expy', 'freeway', 'fwy', 'glen', 'gln', 'heights', 'highway', 'hts', 'hwy',
      'lane', 'ln', 'loop', 'parkway', 'pass', 'path', 'pike', 'pkwy', 'pl', 'place', 'plaza', 'plz', 'point', 'pt', 'rd', 'rdg',
      'ridge', 'road', 'route', 'row', 'rte', 'run', 'sq', 'square', 'st', 'street', 'ter', 'terrace', 'tpke', 'trace', 'trail',
      'trce', 'trl', 'turnpike', 'view', 'vw', 'walk', 'way', 'xing',
    ]);
  });

  it.each(['Way', 'Circle', 'Terrace', 'Trail', 'Alley'])('"24117 - 450 a %s": on 450 Elm St, "What is left at 450 A?" names that project (was answered from 450 Elm St)', street => {
    const name = `24117 - 450 a ${street}`;
    const known = [SELECTED, ELM, name];
    for (const question of ['What is left at 450 A?', 'What is left at 450 a', `What is left at 450 A ${street}?`, `What is left at 450 a ${street.toLowerCase()}?`]) {
      expect([question, ask(question, known, ELM)]).toEqual([
        question,
        `Project 450 is selected, but this question names 450 (${name}). Select project 450 (${name}) above, then ask again.`,
      ]);
      expect([question, mentionedDAVEProject(question, known)]).toEqual([question, name]);
    }
  });

  it.each(['Way', 'Circle', 'Terrace', 'Trail', 'Alley'])('on "24117 - 450 a %s" itself, "What is left at 450 A?" is asked, not refused (was: "this question names 450")', street => {
    const name = `24117 - 450 a ${street}`;
    expect(ask('What is left at 450 A?', [SELECTED, ELM, name], name)).toBeNull();
    expect(ask(`What is left at 450 A ${street}?`, [SELECTED, ELM, name], name)).toBeNull();
  });

  it('every street word in the list, written out, capitalised or short: the lower-case name is read exactly as the capital one', () => {
    const differences = [...ECOS_STREET_LETTER_WORDS].flatMap(word => [word, title(word), word.toUpperCase(), `${title(word)}.`])
      .flatMap(differencesFor);
    expect(differences).toEqual([]);
  });

  // Guards: these already hold.
  it('the word "a" in a question is still not the street letter', () => {
    const known = [SELECTED, ELM, '24117 - 450 a Way'];
    expect(ask('Is 450 a priority this week?', known, ELM)).toBeNull();
    expect(mentionedDAVEProject('Is 450 a priority this week?', known)).toBe(ELM);
  });

  it.each(['new roof', 'Remodel', 'second phase', 'tenant improvement', 'wayfinding package', 'Streetscape', 'Waymart store'])(
    'a name whose "a" is not before a street word keeps its article: "24117 - 450 a %s"',
    rest => {
      const name = `24117 - 450 a ${rest}`;
      expect(ask('What is left at 450 A?', [SELECTED, ELM, name], ELM)).toBeNull();
      expect(ask('What is left at 450 a', [SELECTED, ELM, name], ELM)).toBeNull();
    },
  );

  it('other letters were always read as letters, and still are', () => {
    for (const letter of ['b', 'c', 'n', 's', 'e', 'w', 'i']) {
      const lower = `24117 - 450 ${letter} Way`;
      const capital = `24117 - 450 ${letter.toUpperCase()} Way`;
      const question = `What is left at 450 ${letter.toUpperCase()}?`;
      expect(ask(question, [SELECTED, ELM, lower], ELM)?.split(lower).join(capital) ?? null)
        .toBe(ask(question, [SELECTED, ELM, capital], ELM));
    }
  });
});
