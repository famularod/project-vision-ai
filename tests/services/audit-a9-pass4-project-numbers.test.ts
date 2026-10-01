import {
  ecosProjectReferenceMismatchMessage,
  findECOSProjectReferenceMismatch,
} from '../../services/ECOSProjectQuestion';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import { ecosProjectNumberMentions } from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 4 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number and never the selected project's own.
// The live edge function does not check numbers, so this rule is the only
// guard. Pass 3 widened what is not a project number and went too far:
// L1 an address written differently from the project's name ("2375 N. Harbor
//    Blvd" for project "2375 Harbor Blvd") was read as a street, not the project;
// L2 "invoice", "items", "RFIs", "submittals" and lists carried over "to" or
//    "and" let "Did we invoice 2375 yet?" or "Did RFI 12 and 2375 close?" through;
// L3 a closed 3-digit project refused "the 200 bags of grout" and said to
//    reopen project 200.
// When unsure, the rule now refuses: a wrong refusal costs a tap, a missed one
// answers from the wrong project. Synthetic project names.

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

function expectAllowed(question: string, projects: readonly string[], closed?: readonly string[]) {
  expect(phone(question, projects, closed)).toBeNull();
  expect(desktop(question, projects, closed)).toBeNull();
  // Talk keeps it on the selected project.
  expect(mentionedDAVEProject(question, projects)).toBeNull();
}

describe('audit A9 pass 4 L1: an address written differently from the project name still names it', () => {
  const HARBOR = '2375 Harbor Blvd';
  const NORTH_HARBOR = '2375 N. Harbor Blvd';
  const SEVENTH = '2375 West 7th Street';

  it.each([
    ['What is the slab thickness at 2375 N. Harbor Blvd?', HARBOR],
    ['What is the slab thickness at 2375 N Harbor Blvd?', HARBOR],
    ['What is the slab thickness at 2375 North Harbor Boulevard?', HARBOR],
    ['What is the slab thickness at 2375 Harbor Blvd?', NORTH_HARBOR],
    ['What is the slab thickness at 2375 Harbor Boulevard?', NORTH_HARBOR],
    ['What is left at 2375 W 7th St?', SEVENTH],
    ['What is left at 2375 W. 7th St.?', SEVENTH],
    ['Deliver to 2375 west 7th street', SEVENTH],
  ])('"%s" is refused when the other project is "%s", and Talk moves to it', (question, project) => {
    expectRefusedOpen(question, [SELECTED, project], '2375', project);
  });

  it('Talk "Open 2375 N Harbor Blvd" switches to project 2375 Harbor Blvd', () => {
    expect(mentionedDAVEProject('Open 2375 N Harbor Blvd', [SELECTED, HARBOR])).toBe(HARBOR);
  });

  it('a closed address project written differently is refused as closed', () => {
    const question = 'What is the slab thickness at 2375 N. Harbor Blvd?';
    expect(phone(question, [SELECTED], [HARBOR])).toBe(reopenOnPhone('2375'));
    expect(desktop(question, [SELECTED], [HARBOR])).toBe(reopenOnDesktop('2375'));
  });

  it('direction words and street abbreviations match the project name even after a reference word', () => {
    expect(ecosProjectNumberMentions('Which RFIs are open at unit 2375 N. Harbor Blvd?', [HARBOR])).toEqual(['2375']);
    expect(ecosProjectNumberMentions('Which RFIs are open at unit 2375 Harbor Boulevard?', [NORTH_HARBOR])).toEqual(['2375']);
    expect(ecosProjectNumberMentions('Who is in suite 2375 W 7th St?', [SEVENTH])).toEqual(['2375']);
  });

  it('when 2375 is an address project, another street at 2375 is refused too (when unsure, refuse)', () => {
    expectRefusedOpen('When is the delivery to 2375 Main Street?', [SELECTED, HARBOR], '2375', HARBOR);
  });

  it('the selected project\'s own address is never refused', () => {
    expect(findECOSProjectReferenceMismatch('2375 Harbor Blvd', 'What is left at 2375 N. Harbor Blvd?', [HARBOR, SELECTED]))
      .toBeNull();
    expect(findECOSProjectReferenceMismatch(SELECTED, 'What is left at 2321 N. Compliance Blvd?', [SELECTED, HARBOR]))
      .toBeNull();
  });
});

describe('audit A9 pass 4 L2: reference words exempt only the number they label', () => {
  it.each([
    'Did we invoice 2375 yet?',
    'Any open items 2375?',
    'Open RFIs 2375?',
    'Copy submittal 14 to 2375?',
    'Copy submittals 14 and 15 to 2375?',
    'Compare level 2 to 2375',
    'Did RFI 12 and 2375 close?',
    'Did the city permit 2375 yet?',
    'Was permit 2375 issued?',
    'Are submittals 2375 approved?',
  ])('"%s" is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
  });

  it.each([
    'Which finish goes in rooms 2375 and 2376?',
    'Which finish goes in rooms 2374 and 2375?',
    'Are RFIs 2374, 2375 and 2376 answered?',
    'Are rooms 2370 through 2375 painted?',
    'Are rooms from 2370 to 2375 painted?',
    'Was invoice #2375 paid?',
    'Was invoice no. 2375 paid?',
    'Was permit number 2375 issued?',
    'What did RFI 2375 say about the embeds?',
    'What did RFI #2375 say about the embeds?',
    'Is the kitchen in unit 2375 finished?',
    'Was submittal 2375 approved?',
  ])('"%s" is still allowed and Talk stays', question => {
    expectAllowed(question, PROJECTS);
  });
});

describe('audit A9 pass 4 L3: a closed 3-digit project is refused only when named as a project', () => {
  const OAK = '200 Oak Street';
  const ELM = '120 Elm';

  it.each([
    ['Did the 200 bags of grout arrive?', OAK],
    ['What is due in the next 120 days?', ELM],
    ['Did the crew log 120 hours this week?', ELM],
    ['Is the slab cure 120 hours?', ELM],
    ['Is the lead time 120 weeks?', ELM],
  ])('"%s" is allowed with closed project "%s"', (question, closed) => {
    expectAllowed(question, [SELECTED], [closed]);
  });

  it.each([
    ['What is left at 200 Oak Street?', OAK],
    ['What is left at 200 Oak St?', OAK],
    ['Is 200 Oak done?', OAK],
    ['What was the slab thickness at 200?', OAK],
    ['Is the rebar for 200 on site?', OAK],
    ['What is overdue on project 200?', OAK],
    ['What is overdue on job 200?', OAK],
    ['What is overdue on job no. 200?', OAK],
    ['What is open on the 200 job?', OAK],
    ['Is 120 Elm closed out?', ELM],
  ])('"%s" is refused as the closed project "%s"', (question, closed) => {
    const number = closed.split(' ')[0];
    expect(phone(question, [SELECTED], [closed])).toBe(reopenOnPhone(number));
    expect(desktop(question, [SELECTED], [closed])).toBe(reopenOnDesktop(number));
  });

  it('an open 3-digit project is unchanged: a bare count still names it (when unsure, refuse)', () => {
    expectRefusedOpen('Did the 200 bags of grout arrive?', [SELECTED, OAK], '200', OAK);
  });

  it('a closed 4-digit project is unchanged: a bare number still names it', () => {
    expect(phone('Did the 2375 bags of grout arrive?', [SELECTED], [OTHER])).toBe(reopenOnPhone('2375'));
  });

  it.each([
    'Is the trench 2375 linear feet?',
    'Is the slab 2375 sqft?',
    'Is the slab 2375 sq. ft.?',
    'Is the slab 2375 square feet?',
    'Is the slab 2375 SF?',
    'Is the curb 2375 LF?',
    'Is the float 2375 days?',
  ])('"%s" is a measurement, not project 2375', question => {
    expectAllowed(question, PROJECTS);
    expect(phone(question, [SELECTED], [OTHER])).toBeNull();
  });

  it.each([
    ['What is due in the next 120 days?', '120 Elm'],
    ['Is the trench 375 linear feet?', '375 Main Street'],
  ])('"%s" is a measurement even when "%s" is open', (question, project) => {
    expectAllowed(question, [SELECTED, project]);
  });
});

describe('audit A9 pass 4: what the review found correctly refused stays refused', () => {
  const MAIN = '2375 Main Street';
  const SUITE = 'Suite 2375 Tenant Improvement';

  it.each([
    ['What is left at 2375 Main?', MAIN],
    ['deliver to 2375 main street', MAIN],
    ['What is overdue on #2375?', OTHER],
    ['Is 2375-A poured?', OTHER],
    ['Is 2375\'s slab poured?', OTHER],
    ['What is overdue on job no. 2375?', OTHER],
    ['What is open on the 2375 job?', OTHER],
    ['What is left at 2375?', OTHER],
    ['Is the rebar for 2375 on site?', OTHER],
    ['What is overdue on project 2375?', OTHER],
    ['What is overdue on job 2375?', OTHER],
    ['What is overdue on 2375 Compliance?', OTHER],
  ])('"%s" is refused when the other project is "%s"', (question, project) => {
    expectRefusedOpen(question, [SELECTED, project], '2375', project);
  });

  it('"suite 2375" is refused when a project is named "Suite 2375 ..."', () => {
    expect(phone('Who is moving into suite 2375?', [SELECTED, SUITE])).toBe(switchOnPhone('2375'));
    expect(desktop('Who is moving into suite 2375?', [SELECTED, SUITE])).toBe(switchOnDesktop('2375'));
    expect(mentionedDAVEProject('Who is moving into suite 2375?', [SELECTED, SUITE])).toBe(SUITE);
  });
});

describe('audit A9 pass 4: what the review found correctly allowed stays allowed', () => {
  it.each([
    ['What strength is the 4000 psi concrete?', [...PROJECTS, '4000 Warehouse']],
    ['Which sealant does spec 03 30 00 call for?', PROJECTS],
    ['Which sealant does 033000 call for?', PROJECTS],
    ['Was the inspection on 9/30/2375 passed?', PROJECTS],
    ['Was the inspection on Sep 30, 2026 passed?', [...PROJECTS, '2026 Fit-Out']],
    ['Was the $2,375 change order approved?', PROJECTS],
    ['Is the beam 2375 lb?', PROJECTS],
    ['Call the super at 555-2375 about the pour.', PROJECTS],
    ['Is the new slab 2375 mm thick?', PROJECTS],
    ['Is the main service a 2375 amp service?', PROJECTS],
    ['Which finish goes in rooms 2375 and 2376?', PROJECTS],
    ['What did RFI 2375 say about the embeds?', PROJECTS],
    ['Is the kitchen in unit 2375 finished?', PROJECTS],
    ['When is the delivery to 2375 Main Street?', PROJECTS],
    ['When is the delivery to 2375 N. Harbor Blvd?', PROJECTS],
    ['Who is moving into suite 2375?', PROJECTS],
  ] as const)('"%s" is allowed and Talk stays', (question, projects) => {
    expectAllowed(question, projects);
  });
});
