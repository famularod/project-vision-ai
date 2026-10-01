// rule simplified A9 pass 5: when unsure, refuse
import {
  ecosProjectReferenceMismatchMessage,
  findECOSProjectReferenceMismatch,
} from '../../services/ECOSProjectQuestion';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import { ecosProjectNumberMentions } from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 4 and 5 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number and never the selected project's own.
// The live edge function does not check numbers, so this rule is the only
// guard. Passes 3 and 4 exempted reference words, plural lists, from/to
// ranges, street addresses, years and closed 3-digit counts; each review found
// new questions those exemptions answered from the wrong project. Pass 5
// keeps five narrow exemptions (measurement with a listed unit, money, a full
// date or clock time, a phone number, a spec section or sheet ID) and refuses
// everything else: a wrong refusal costs a tap, a missed one answers from the
// wrong project. Synthetic project names.

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
    expectRefusedClosed('What is the slab thickness at 2375 N. Harbor Blvd?', HARBOR, '2375');
  });

  it('a reference word before an address project changes nothing', () => {
    expect(ecosProjectNumberMentions('Which RFIs are open at unit 2375 N. Harbor Blvd?', [HARBOR])).toEqual(['2375']);
    expect(ecosProjectNumberMentions('Which RFIs are open at unit 2375 Harbor Boulevard?', [NORTH_HARBOR])).toEqual(['2375']);
    expect(ecosProjectNumberMentions('Who is in suite 2375 W 7th St?', [SEVENTH])).toEqual(['2375']);
  });

  it('another street at 2375 is refused too', () => {
    expectRefusedOpen('When is the delivery to 2375 Main Street?', [SELECTED, HARBOR], '2375', HARBOR);
  });

  it('the selected project\'s own address is never refused', () => {
    expect(findECOSProjectReferenceMismatch('2375 Harbor Blvd', 'What is left at 2375 N. Harbor Blvd?', [HARBOR, SELECTED]))
      .toBeNull();
    expect(findECOSProjectReferenceMismatch(SELECTED, 'What is left at 2321 N. Compliance Blvd?', [SELECTED, HARBOR]))
      .toBeNull();
  });
});

describe('audit A9 pass 4 L2 and pass 5: a reference word does not exempt another project\'s number', () => {
  it.each([
    // Refused since pass 4.
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
    // Allowed by pass 4, refused since pass 5 (David taps to switch, or rephrases).
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
    'Is RFI-2375 answered?',
    'Is the kitchen in unit 2375 finished?',
    'Was submittal 2375 approved?',
  ])('"%s" is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
  });
});

describe('audit A9 pass 4 L3 and pass 5: a closed project\'s number is refused like an open one', () => {
  const OAK = '200 Oak Street';
  const ELM = '120 Elm';

  it.each([
    ['Did the 200 bags of grout arrive?', OAK],
    ['Is the crane rented for 200 days?', OAK],
    ['What is due in the next 120 days?', ELM],
    ['Did the crew log 120 hours this week?', ELM],
    ['Is the slab cure 120 hours?', ELM],
    ['Is the lead time 120 weeks?', ELM],
  ])('"%s" is a measurement with closed project "%s"', (question, closed) => {
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
    // Audit A9 pass 5: these were let through as "not named as the project".
    ['What is overdue on 200?', OAK],
    ['Is 200 done?', OAK],
    ['How did #200 finish?', OAK],
    ['Pull the closeout docs from 200', OAK],
    ['Did the 200 cartons of grout arrive?', OAK],
  ])('"%s" is refused as the closed project "%s"', (question, closed) => {
    expectRefusedClosed(question, closed, closed.split(' ')[0]);
  });

  it('an open 3-digit project: a listed unit is a measurement, any other count names it', () => {
    expectAllowed('Did the 200 bags of grout arrive?', [SELECTED, OAK]);
    expectRefusedOpen('Did the 200 cartons of grout arrive?', [SELECTED, OAK], '200', OAK);
  });

  it('a closed 4-digit project: the same', () => {
    expectAllowed('Did the 2375 bags of grout arrive?', [SELECTED], [OTHER]);
    expectRefusedClosed('Did the 2375 cartons of grout arrive?', OTHER, '2375');
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
    expectRefusedOpen('Who is moving into suite 2375?', [SELECTED, SUITE], '2375', SUITE);
  });
});

describe('audit A9 pass 4: of what the review found correctly allowed, the five exemptions stay allowed', () => {
  it.each([
    ['What strength is the 4000 psi concrete?', [...PROJECTS, '4000 Warehouse']],
    ['Which sealant does spec 03 30 00 call for?', PROJECTS],
    ['Which sealant does 033000 call for?', PROJECTS],
    // Audit A9 pass 6 L3: "9/30/2375" is no real date, so 2375 names the
    // project and is refused (see the pass 6 tests); a 20xx year is a date.
    ['Was the inspection on 9/30/2026 passed?', [...PROJECTS, '2026 Fit-Out']],
    ['Was the inspection on Sep 30, 2026 passed?', [...PROJECTS, '2026 Fit-Out']],
    ['Was the $2,375 change order approved?', PROJECTS],
    ['Is the beam 2375 lb?', PROJECTS],
    ['Call the super at 555-2375 about the pour.', PROJECTS],
    ['Is the new slab 2375 mm thick?', PROJECTS],
    ['Is the main service a 2375 amp service?', PROJECTS],
  ] as const)('"%s" is allowed and Talk stays', (question, projects) => {
    expectAllowed(question, projects);
  });

  it.each([
    'Which finish goes in rooms 2375 and 2376?',
    'What did RFI 2375 say about the embeds?',
    'Is the kitchen in unit 2375 finished?',
    'When is the delivery to 2375 Main Street?',
    'When is the delivery to 2375 N. Harbor Blvd?',
    'Who is moving into suite 2375?',
  ])('"%s" is refused since pass 5 when 2375 is another project', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
  });
});

describe('audit A9 pass 5: what the review found let through is refused', () => {
  it.each([
    'Compare the drawings from 2375 and 2321',
    'Do the specs from 2321 and 2375 match?',
    'Copy the submittals from 2321 to 2375?',
    'Are the RFIs from 2375 and 2380 answered?',
  ])('"%s" is refused and Talk reads 2375 as a project number', question => {
    expect(phone(question, PROJECTS)).toBe(switchOnPhone('2375'));
    expect(desktop(question, PROJECTS)).toBe(switchOnDesktop('2375'));
    expect(ecosProjectNumberMentions(question, PROJECTS)).toContain('2375');
  });

  it('Talk moves a note naming only 2375 to it (one naming 2321 and 2375 names two projects and stays)', () => {
    expect(mentionedDAVEProject('Are the RFIs from 2375 and 2380 answered?', PROJECTS)).toBe(OTHER);
    expect(mentionedDAVEProject('Compare the drawings from 2375 and 2321', PROJECTS)).toBeNull();
  });

  it('a unit word that is the project\'s own next name word names the project', () => {
    const DAYS_INN = '2375 Days Inn Renovation';
    expectRefusedOpen('What is left at 2375 Days Inn?', [SELECTED, DAYS_INN], '2375', DAYS_INN);
    expectRefusedOpen('Is the float 2375 days?', [SELECTED, DAYS_INN], '2375', DAYS_INN);
    expectRefusedClosed('What is left at 2375 Days Inn?', DAYS_INN, '2375');
    // "Tower E-2375": the name word before a sheet-like number names it too.
    expectRefusedOpen('What is left at Tower E-2375?', [SELECTED, 'Tower E-2375'], '2375', 'Tower E-2375');
  });

  it.each([
    ['What is overdue on project 2050?', '2050 Harbor Blvd'],
    ['Which deliveries are due in 2026?', '2026 Fit-Out'],
    ['What changed in 2026?', '2026 Fit-Out'],
  ])('a year is not exempt outside a full date: "%s" names "%s"', (question, project) => {
    expectRefusedOpen(question, [SELECTED, project], project.split(' ')[0], project);
  });

  it.each([
    // Words that read as English after a project number are not units.
    'Is 2375 in progress?',
    'What did 2375 each week cost?',
    'Is 2375 unit 4 done?',
    'Who is the 2375 PM?',
    'Is the 2375 A/C done?',
    'Is 2375 A-OK?',
    'Is the job "at 2375"?',
    'Is the job at 2375\'?',
    'Is the job \'2375\' closed?',
    'Is the slab 2375  psi?',
    'Is the mix 2375-4000 psi?',
  ])('"%s" is refused (when unsure, refuse)', question => {
    expect(desktop(question, PROJECTS)).toBe(switchOnDesktop('2375'));
  });

  it('a later spec division written without spaces is not exempt; with spaces it is', () => {
    const ELECTRICAL = '260519 Electrical Study';
    expectRefusedOpen('Which conduit does 260519 call for?', [SELECTED, ELECTRICAL], '260519', ELECTRICAL);
    expectAllowed('Which conduit does 26 05 19 call for?', [SELECTED, ELECTRICAL]);
  });
});

describe('audit A9 pass 5: the five exemptions', () => {
  const OAK = '200 Oak Street';
  const MARKET = '201 Market Street';
  const FIT_OUT = '2026 Fit-Out';

  it.each([
    // 1. Measurement: a listed unit right after the number.
    ['What strength is the 4000 psi concrete?', [SELECTED, '4000 Warehouse']],
    ['Is the 4000-psi mix approved?', [SELECTED, '4000 Warehouse']],
    ['Is the new slab 2375 mm thick?', PROJECTS],
    ['Is the new slab 2375mm thick?', PROJECTS],
    ['Is the slab 2375 sqft?', PROJECTS],
    ['Is the trench 2375 linear feet?', PROJECTS],
    ['Is the beam 2375.5 mm deep?', PROJECTS],
    ['Is the slab 2375 in. thick?', PROJECTS],
    ['Is the run 2375\' long?', PROJECTS],
    ['Is the bearing 2,375 ksf?', [SELECTED, '375 Main Street']],
    // "2375 A or 2375 V" is refused since audit A9 pass 6 L1 (a spaced "A"
    // before a word reads as a wing letter). Since audit A9 pass 7 L5 a
    // spaced " A" is never amps ("with a 2375 A?" was here); a glued A is.
    ['Is the service 2375 V, with a 2375A?', PROJECTS],
    ['Is the grade 2375 m above datum?', PROJECTS],
    ['Is framing 2375% done?', PROJECTS],
    ['Is the cure at 2375°F?', PROJECTS],
    ['Did we pour 2375 c.y. today?', PROJECTS],
    ['Is the crane rented for 200 days?', [SELECTED, OAK]],
    ['Did the 200 bags of grout arrive?', [SELECTED, OAK]],
    // "200 units" and "200 sheets" left the list in audit A9 pass 6 M1 ("Are
    // the 2375 units framed?" named project 2375); see the pass 6 tests.
    ['Are the 200 EA anchors here?', [SELECTED, OAK]],
    // 2. Money.
    ['Was the $2,375 change order approved?', PROJECTS],
    ['Was the $2,375 change order approved?', [SELECTED, '375 Main Street']],
    ['Was the $ 2375.50 invoice paid?', PROJECTS],
    ['Was USD 2375 paid?', PROJECTS],
    ['Was 2375 dollars paid?', PROJECTS],
    // 3. Full dates and clock times.
    ['Was the inspection on 10/05/2026 passed?', [SELECTED, FIT_OUT]],
    ['Was the inspection on 2026-10-05 passed?', [SELECTED, FIT_OUT]],
    ['Was the inspection on Oct 5, 2026 passed?', [SELECTED, FIT_OUT]],
    ['Was the inspection on 5 Oct 2026 passed?', [SELECTED, FIT_OUT]],
    ['Does the pour start at 0730 hrs?', [SELECTED, '0730 Night Works']],
    // 4. Phone numbers.
    ['Call the super at 555-2375 about the pour.', PROJECTS],
    ['Call the super at (415) 555-2375.', [SELECTED, '415 Bay Street']],
    ['Call the super at 415-555-2375.', [SELECTED, '415 Bay Street']],
    ['Call the super at 415.555.2375.', [SELECTED, '415 Bay Street']],
    // 5. Spec sections and sheet IDs.
    ['Which sealant does spec 03 30 00 call for?', PROJECTS],
    ['Which sealant does 033000 call for?', [SELECTED, '033000 Concrete Study']],
    ['What is on sheet A-201?', [SELECTED, MARKET]],
    ['What is on E-2375?', PROJECTS],
  ] as const)('"%s" is allowed and Talk stays', (question, projects) => {
    expectAllowed(question, projects);
  });

  it('"for 200 days" and "the 200 bags" are measurements with 200 closed too', () => {
    expectAllowed('Is the crane rented for 200 days?', [SELECTED], [OAK]);
    expectAllowed('Did the 200 bags of grout arrive?', [SELECTED], [OAK]);
  });

  it('an exempt number next to a bare one: the bare one still names the project', () => {
    expect(desktop('Is the 2375 mm slab at 2375 done?', PROJECTS)).toBe(switchOnDesktop('2375'));
    expect(desktop('Call 555-2375 about 2375.', PROJECTS)).toBe(switchOnDesktop('2375'));
    expect(desktop('What is on A-201 at 201?', [SELECTED, MARKET])).toBe(switchOnDesktop('201'));
  });
});
