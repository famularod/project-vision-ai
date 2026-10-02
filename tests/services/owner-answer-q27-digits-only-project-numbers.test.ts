import type { SupabaseClient } from '@supabase/supabase-js';
import { askECOSProjectQuestion } from '../../services/ECOSProjectQuestion';
import {
  ecosDigitsOnlyQuestion,
  ecosProjectNumbersAreDigitsOnly,
  ecosProjectReferenceMismatchMessage,
} from '../../services/ECOSProjectRefusal';
import {
  buildDAVETalkMemoryDraft,
  mentionedDAVEProject,
  talkProjectQuestionRefusal,
} from '../../services/DAVEConversationRouter';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '55555555-5555-4555-8555-555555555555'),
}));

// Owner answer Q27 (2 Oct 2026): David has no letters in his project numbers.
// While no project in the list (open, closed or selected) has a lettered
// number, Ask ECOS (phone and desktop) and Talk read project numbers as digits
// only: a letter after the digits ("2375A", "2375-A", a lone "2375 A") is a
// word of its own, never part of a project number. A project with a lettered
// number in the list brings back the full reading (audit A9 passes 7 to 17).
// Synthetic project names.

const SELECTED = '2321 Compliance Project';
const MAIN_2375 = '2375 Main St';
const OAK_2380 = '2380 Oak Ave';
const A_STREET_2375 = '24117 - 2375 A Street';
const PHASE_2375A = '2375A Phase 2';
const N_MAIN_400 = '24117 - 400 N Main St';
const OAK_400 = '400 Oak Ave';
const TOWER_400N = '400N Tower';
const SUITE_300 = '2375 Main St Suite 300';
const ELM_300 = '300 Elm';

const desktop = (question: string, known: readonly string[] | undefined, selected = SELECTED, closed: readonly string[] = []) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'desktop' });
const phone = (question: string, known: readonly string[] | undefined, selected = SELECTED, closed: readonly string[] = []) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const onDesktop = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Select project ${number} above, then ask again.`;
const onPhone = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Close this, open project ${number}, then ask again.`;

/** Ask ECOS on both surfaces and Talk's refusal, or null each when it answers. */
function everywhere(question: string, projects: readonly string[], selected = SELECTED) {
  return {
    desktop: desktop(question, projects, selected),
    phone: phone(question, projects, selected),
    talk: talkProjectQuestionRefusal(question, selected, projects),
  };
}
const refusedEverywhere = (number: string, selected = '2321') =>
  ({ desktop: onDesktop(number, selected), phone: onPhone(number, selected), talk: onPhone(number, selected) });
const answeredEverywhere = { desktop: null, phone: null, talk: null };

describe('owner answer Q27: the switch follows the actual project list', () => {
  it('a list without lettered project numbers reads numbers as digits only', () => {
    expect(ecosProjectNumbersAreDigitsOnly([SELECTED, MAIN_2375, A_STREET_2375, N_MAIN_400, 'Harbor Office'])).toBe(true);
  });

  it.each([PHASE_2375A, '2375-B Annex', TOWER_400N, '480V Switchgear Upgrade 2375'])(
    'adding "%s" brings back the full reading',
    lettered => {
      expect(ecosProjectNumbersAreDigitsOnly([SELECTED, MAIN_2375, lettered])).toBe(false);
    },
  );

  it('only a letter the check would read as part of a number becomes its own word; the rest is unchanged', () => {
    const projects = [SELECTED, MAIN_2375, N_MAIN_400];
    expect(ecosDigitsOnlyQuestion('What is left at 400N?', projects)).toBe('What is left at 400  N?');
    expect(ecosDigitsOnlyQuestion('Is 2375-B done?', projects)).toBe('Is 2375  -B done?');
    expect(ecosDigitsOnlyQuestion('Is 2375 B?', projects)).toBe('Is 2375   B?');
    for (const question of ['Is 2375 a priority?', 'What is left at 400 N?', 'Is the slab 2375mm?', 'Is 2375 done?']) {
      expect(ecosDigitsOnlyQuestion(question, projects)).toBe(question);
    }
  });
});

describe('owner answer Q27: "Is 2375 a priority?"', () => {
  const digitsOnly = [SELECTED, MAIN_2375, OAK_2380];
  const withLettered = [SELECTED, MAIN_2375, PHASE_2375A];

  it('with no lettered project, it names 2375 on 2321, and "2375A" reads the same as "2375 a"', () => {
    expect(everywhere('Is 2375 a priority?', digitsOnly)).toEqual(refusedEverywhere('2375'));
    expect(everywhere('Is 2375A a priority?', digitsOnly)).toEqual(refusedEverywhere('2375'));
    expect(mentionedDAVEProject('Is 2375 a priority?', digitsOnly, [], SELECTED)).toBe(MAIN_2375);
    expect(mentionedDAVEProject('Is 2375A a priority?', digitsOnly, [], SELECTED)).toBe(MAIN_2375);
  });

  it('with no lettered project, it is answered on 2375 Main St, spelled either way', () => {
    expect(everywhere('Is 2375 a priority?', digitsOnly, MAIN_2375)).toEqual(answeredEverywhere);
    expect(everywhere('Is 2375A a priority?', digitsOnly, MAIN_2375)).toEqual(answeredEverywhere);
  });

  it('with 2375A Phase 2 in the list, the lettered reading is unchanged', () => {
    expect(everywhere('Is 2375 a priority?', withLettered)).toEqual(refusedEverywhere('2375'));
    expect(everywhere('Is 2375A a priority?', withLettered)).toEqual(refusedEverywhere('2375A'));
    expect(everywhere('Is 2375A a priority?', withLettered, MAIN_2375)).toEqual(refusedEverywhere('2375A', '2375'));
    expect(mentionedDAVEProject('Is 2375A a priority?', withLettered, [], SELECTED)).toBe(PHASE_2375A);
  });
});

describe('owner answer Q27: "2375 a st"', () => {
  const digitsOnly = [SELECTED, A_STREET_2375, MAIN_2375];
  const withLettered = [SELECTED, A_STREET_2375, PHASE_2375A];
  const aStreet = '2375 (24117 - 2375 A Street)';

  it('with no lettered project, "2375 a st", "2375A St" and "2375-A St" all name the A Street job (the last two named 2375 Main St)', () => {
    for (const question of ['What is left at 2375 a st?', 'What is left at 2375A St?', 'What is left at 2375-A St?']) {
      expect(everywhere(question, digitsOnly)).toEqual(refusedEverywhere(aStreet));
      expect(mentionedDAVEProject(question, digitsOnly, [], SELECTED)).toBe(A_STREET_2375);
    }
  });

  it('with no lettered project, the A Street job answers its own "2375A St" (it was refused as 2375 Main St)', () => {
    expect(everywhere('What is left at 2375A St?', digitsOnly, A_STREET_2375)).toEqual(answeredEverywhere);
  });

  it('with 2375A Phase 2 in the list, "2375 a st" still names the A Street job and "2375A St" still names 2375A', () => {
    expect(everywhere('What is left at 2375 a st?', withLettered)).toEqual(refusedEverywhere(aStreet));
    expect(everywhere('What is left at 2375A St?', withLettered)).toEqual(refusedEverywhere('2375A'));
    expect(mentionedDAVEProject('What is left at 2375A St?', withLettered, [], SELECTED)).toBe(PHASE_2375A);
  });
});

describe('owner answer Q27: the "400 N Main" / "400N Tower" circle does not arise without letters', () => {
  const digitsOnly = [SELECTED, N_MAIN_400, OAK_400];
  const nMain = '400 (24117 - 400 N Main St)';
  const spellings = ['What is left at 400 N?', 'What is left at 400N?', 'What is left at 400-N?'];

  it('on 2321, "400 N", "400N" and "400-N" all name the N Main job, and Talk moves there (400N and 400-N named 400 Oak Ave)', () => {
    for (const question of spellings) {
      expect(everywhere(question, digitsOnly)).toEqual(refusedEverywhere(nMain));
      expect(mentionedDAVEProject(question, digitsOnly, [], SELECTED)).toBe(N_MAIN_400);
    }
  });

  it('on the N Main job, every spelling is answered and Talk stays', () => {
    for (const question of spellings) {
      expect(everywhere(question, digitsOnly, N_MAIN_400)).toEqual(answeredEverywhere);
      expect(mentionedDAVEProject(question, digitsOnly, [], N_MAIN_400)).toBe(N_MAIN_400);
    }
  });

  it('on 400 Oak Ave, "400N" names the N Main job (it was answered from 400 Oak Ave)', () => {
    expect(everywhere('What is left at 400N?', digitsOnly, OAK_400)).toEqual(refusedEverywhere(nMain, '400'));
  });

  it('with 400N Tower in the list, audit A9 pass 16 L2 is unchanged: "400 N" and "400N" name 400N', () => {
    const withLettered = [SELECTED, N_MAIN_400, TOWER_400N];
    expect(everywhere('What is left at 400 N?', withLettered)).toEqual(refusedEverywhere('400N'));
    expect(everywhere('What is left at 400N?', withLettered)).toEqual(refusedEverywhere('400N'));
    expect(everywhere('What is left at 400 N?', withLettered, N_MAIN_400)).toEqual(refusedEverywhere('400N', '24117'));
  });
});

describe('owner answer Q27: other parts of the reading', () => {
  it('a glued letter is a word, so "Suite 300B" is the Suite 300 job (it named 300 Elm)', () => {
    const projects = [SELECTED, SUITE_300, ELM_300];
    expect(everywhere('Is Suite 300B?', projects)).toEqual(refusedEverywhere('300 (2375 Main St Suite 300)'));
    expect(mentionedDAVEProject('Is Suite 300B?', projects, [], SELECTED)).toBe(SUITE_300);
  });

  it('without a project list the stricter pre-Q20 check is unchanged ("2375A" is not read there)', () => {
    expect(desktop('Is 2375A done?', undefined)).toBeNull();
    expect(desktop('Is 2375A done?', [])).toBeNull();
  });

  it('Talk checks a shorter list by what the whole list says (a closed 2375B Annex keeps the full reading)', () => {
    const open = [SELECTED, '24117 - 2375 B Street', MAIN_2375];
    const note = 'Crew from 2375B moves to 24117';
    expect(mentionedDAVEProject(note, open, ['2375B Annex'], SELECTED)).toBeNull();
    expect(buildDAVETalkMemoryDraft({
      id: 'talk-memory-1',
      createdAt: '2026-10-02T12:00:00.000Z',
      projectName: SELECTED,
      switchedProject: false,
      projectNames: open,
      closedProjectNames: ['2375B Annex'],
      transcript: note,
      fields: { generalMemory: note },
    }).recommendedProject.confirmed).toBe(false);
  });

  it('Ask ECOS refuses before asking the server, in the same words', async () => {
    const invoke = jest.fn();
    const getSession = jest.fn();
    const client = { auth: { getSession }, functions: { invoke } } as unknown as SupabaseClient;
    await expect(askECOSProjectQuestion({
      client,
      projectId: 'project-2321',
      projectName: SELECTED,
      question: 'What is left at 400N?',
      knownProjectNames: [SELECTED, N_MAIN_400, OAK_400],
      refusalWording: 'phone',
    })).rejects.toMatchObject({
      code: 'project_reference_mismatch',
      message: onPhone('400 (24117 - 400 N Main St)'),
    });
    expect(getSession).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
