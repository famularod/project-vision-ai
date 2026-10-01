// rule simplified A9 pass 5: when unsure, refuse
import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectQuestion';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import { ecosProjectNumberMentions } from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 7 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. The live edge function does not check
// numbers, so this rule is the only guard; when unsure, refuse (a wrong
// refusal costs a tap). Each finding is pinned both ways: the phrase the
// review found answered from 2321 is now refused (and Talk moves), and the
// written-as-a-measurement form next to it stays allowed. Synthetic names.

const SELECTED = '2321 Compliance Project';
const OTHER = '2375 Compliance Project';
const PROJECTS = [SELECTED, OTHER];

const phone = (question: string, known: readonly string[], closed?: readonly string[]) =>
  ecosProjectReferenceMismatchMessage(SELECTED, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const desktop = (question: string, known: readonly string[], closed?: readonly string[]) =>
  ecosProjectReferenceMismatchMessage(SELECTED, question, known, { closedProjectNames: closed, refusalWording: 'desktop' });
const switchOnPhone = (number: string) =>
  `Project 2321 is selected, but this question names ${number}. Close this, open project ${number}, then ask again.`;
const switchOnDesktop = (number: string) =>
  `Project 2321 is selected, but this question names ${number}. Select project ${number} above, then ask again.`;
const reopenOnPhone = (number: string) =>
  `Project 2321 is selected, but ${number} is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.`;
const reopenOnDesktop = (number: string) =>
  `Project 2321 is selected, but ${number} is a closed project. Reopen it in the Vitruvius iPhone or iPad app, then select it above and ask again.`;

function expectRefusedOpen(question: string, projects: readonly string[], number: string, project: string) {
  expect(phone(question, projects)).toBe(switchOnPhone(number));
  expect(desktop(question, projects)).toBe(switchOnDesktop(number));
  // Talk moves the question or note to that project.
  expect(mentionedDAVEProject(question, projects)).toBe(project);
}

function expectRefusedClosed(question: string, closed: string, number: string) {
  expect(phone(question, [SELECTED], [closed])).toBe(reopenOnPhone(number));
  expect(desktop(question, [SELECTED], [closed])).toBe(reopenOnDesktop(number));
}

function expectAllowed(question: string, projects: readonly string[], closed?: readonly string[]) {
  expect(phone(question, projects, closed)).toBeNull();
  expect(desktop(question, projects, closed)).toBeNull();
  // Talk keeps it on the selected project.
  expect(mentionedDAVEProject(question, projects)).toBeNull();
}

describe('audit A9 pass 7 L1: "meters", "metres" and "pieces" are not units of measure', () => {
  it.each([
    'Are the 2375 meters set?',
    'Are the 2375 metres set?',
    'Are the 2375 pieces delivered?',
    'Are the 2375 Meters set?',
  ])('"%s" is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expectRefusedClosed(question, OTHER, '2375');
  });

  it('a run in meters or a count of pieces with a 3-digit project costs a tap', () => {
    expectRefusedOpen('Is the run 300 meters?', [SELECTED, '300 Bay'], '300', '300 Bay');
    expectRefusedClosed('Did the 200 pieces of rebar arrive?', '200 Oak Street', '200');
  });

  it.each([
    ['Is the run 300 m?', '300 Bay'],
    ['Is the run 300m?', '300 Bay'],
    ['Did the 200 pcs of rebar arrive?', '200 Oak Street'],
    ['Did the 200 PCS of rebar arrive?', '200 Oak Street'],
  ])('"%s" keeps m and pcs as measurements with "%s" open or closed', (question, project) => {
    expectAllowed(question, [SELECTED, project]);
    expectAllowed(question, [SELECTED], [project]);
  });
});

describe('audit A9 pass 7 L2: a comma-grouped number that is no project is checked part by part', () => {
  const OAK = '200 Oak Street';
  const MAIN = '375 Main Street';
  const SHOP = '101 Shop';
  const YARD = '205 Yard';

  it.each([
    ['Compare 200,375', [SELECTED, OAK, MAIN], '200'],
    ['Compare 200,375?', [SELECTED, OAK, MAIN], '200'],
    ['Punch list for 101,205?', [SELECTED, SHOP, YARD], '101'],
    ['Compare 2321,375', [SELECTED, MAIN], '375'],
    ['Compare 200,375,450', [SELECTED, '450 Bay'], '450'],
  ] as const)('"%s" is refused', (question, projects, number) => {
    expect(phone(question, projects)).toBe(switchOnPhone(number));
    expect(desktop(question, projects)).toBe(switchOnDesktop(number));
  });

  it('a closed project in a comma-grouped list is refused in the closed wording', () => {
    expect(phone('Punch list for 101,205?', [SELECTED], [SHOP, YARD])).toBe(reopenOnPhone('101'));
    expect(desktop('Punch list for 101,205?', [SELECTED], [YARD])).toBe(reopenOnDesktop('205'));
  });

  it('Talk reads each part: one project moves, two do not', () => {
    expect(mentionedDAVEProject('Punch list for 101,205?', [SELECTED, YARD])).toBe(YARD);
    expect(mentionedDAVEProject('Compare 200,375', [SELECTED, OAK, MAIN])).toBeNull();
  });

  it('a grouped number that is itself a known project is read whole, not split', () => {
    expect(ecosProjectNumberMentions('What is overdue on project 2,375?', [...PROJECTS, MAIN])).toEqual(['2375']);
    expect(phone('What is overdue on project 2,375?', [...PROJECTS, MAIN])).toBe(switchOnPhone('2375'));
    // The selected project's own number is never refused, nor split into 321.
    expect(phone('What is overdue on project 2,321?', [SELECTED, '321 Pine'])).toBeNull();
    expect(desktop('What is overdue on project 2,321?', [SELECTED, '321 Pine'])).toBeNull();
  });

  it('"2,375" with a project 375 and no project 2375 now names 375 (when unsure, refuse)', () => {
    expect(ecosProjectNumberMentions('What is overdue on project 2,375?', [SELECTED, MAIN])).toEqual(['2375', '375']);
    expect(phone('What is overdue on project 2,375?', [SELECTED, MAIN])).toBe(switchOnPhone('375'));
  });

  it.each([
    ['Was the $200,375 change order approved?', [SELECTED, OAK, MAIN]],
    ['Is the slab 200,375 sqft?', [SELECTED, OAK, MAIN]],
    ['Was 101,205 dollars paid?', [SELECTED, SHOP, YARD]],
    ['Compare 200,375', [SELECTED, '2375 Days Inn']],
  ] as const)('"%s" stays allowed (money, a measurement, or no part is a project)', (question, projects) => {
    expectAllowed(question, projects);
  });
});

describe('audit A9 pass 7 L3: a closing single quote after a number is not a feet mark', () => {
  it.each([
    "The super wrote 'delivered to 2375' this morning, right?",
    'The super wrote ‘delivered to 2375’ this morning, right?',
    "I don't know, he wrote 'send it to 2375' today?",
    "Did he say 'the pour at 2375' went fine?",
    "He said 'ok' then wrote 'send it to 2375' again?",
    "Is the '2375' job done?",
  ])('%s is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expectRefusedClosed(question, OTHER, '2375');
  });

  it.each([
    // No single quotation is open before the mark: a feet mark.
    "Is the run 2375' long?",
    'Is the run 2375’ long?',
    "I don't think the run is 2375' long?",
    'The crew’s run is 2375’ long?',
    "He said 'ok' and the run is 2375' long?",
    // A feet-inch pair is a measurement even inside a quotation.
    "He wrote 'set the sleeve at 2375'-6\" above grade' today?",
    "He wrote 'set the sleeve at 2375' 6\" above grade' today?",
    "He wrote 'set the sleeve at 2375'6\" above grade' today?",
    'He wrote ‘set the sleeve at 2375’-6” above grade’ today?',
  ])('%s is a measurement and is allowed', question => {
    expectAllowed(question, PROJECTS);
  });
});

describe('audit A9 pass 7 L4: an inch mark inside a double quotation does not close it', () => {
  it.each([
    'He wrote "the 6" pipe at 2375" this morning?',
    'He wrote “the 6" pipe at 2375” this morning?',
    'He wrote "run 4" conduit, 2" sleeves to 2375" today?',
    'Is the "2375" job done?',
  ])('%s is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expectRefusedClosed(question, OTHER, '2375');
  });

  it.each([
    'Is the 6" pipe 2375" long?',
    'Is the pipe 2375" long?',
    'He said "ok" and the pipe is 2375" long?',
    'He wrote "set the sleeve at 12\'-2375" above grade" today?',
    'He wrote "set the 6" sleeve at 12\' 2375" above grade" today?',
  ])('%s is a measurement and is allowed', question => {
    expectAllowed(question, PROJECTS);
  });
});
