// rule simplified A9 pass 5: when unsure, refuse
/**
 * Owner answer Q20 (30 Sep 2026; audit A9 pass 1 #2) test vectors for the Ask
 * ECOS wrong-project guard. The app's jest suite
 * (tests/services/ecos-project-question.test.ts) and the edge function's Deno
 * suite (ecos-project-reference.test.ts) both run every vector, so the two
 * sides are checked against one list. Synthetic project names.
 *
 * Audit A9 pass 5: another project's number is refused unless it is written as
 * a measurement with a listed unit, money, a full date or clock time, a phone
 * number, or a spec section or sheet ID. Reference words ("room", "RFI",
 * "El."), street names, years and closed 3-digit counts no longer exempt it;
 * the vectors that pinned those exemptions now expect a refusal.
 */

export type ECOSProjectReferenceVector = Readonly<{
  name: string;
  projectName: string;
  question: string;
  /** undefined: the caller has no project list (the pre-Q20 check applies). */
  knownProjectNames?: readonly string[] | null;
  /** Closed (archived, not deleted) projects (audit A9 pass 3 L1). */
  closedProjectNames?: readonly string[] | null;
  /** The number the guard refuses, or null when the question is allowed. */
  refused: string | null;
  /** Whether the refused number is only a closed project's; false when omitted. */
  refusedClosed?: boolean;
}>;

const SELECTED = '2321 Compliance Project';
const OWNER_PROJECTS = Object.freeze([SELECTED, '2375 Compliance Project']);

export const ECOS_PROJECT_REFERENCE_VECTORS: readonly ECOSProjectReferenceVector[] = Object.freeze([
  // The protection is kept: another known project named by its number.
  {
    name: 'refuses the other known project on the north side of 2375',
    projectName: SELECTED,
    question: 'How thick is the new concrete on the north side of 2375?',
    knownProjectNames: OWNER_PROJECTS,
    refused: '2375',
  },
  {
    name: 'does not mistake a year for a different project number',
    projectName: SELECTED,
    question: 'What work is scheduled at 2321 in 2026?',
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  },
  {
    name: 'a bare year names a project numbered after it (pass 5: no year exemption outside a full date)',
    projectName: SELECTED,
    question: 'Which deliveries are due in 2026?',
    knownProjectNames: [...OWNER_PROJECTS, '2026 Fit-Out'],
    refused: '2026',
  },
  {
    name: 'a full date is not a project numbered after its year',
    projectName: SELECTED,
    question: 'Which deliveries are due on Oct 5, 2026?',
    knownProjectNames: [...OWNER_PROJECTS, '2026 Fit-Out'],
    refused: null,
  },
  {
    name: 'a length in feet is not a 3-digit project number',
    projectName: SELECTED,
    question: 'Run 375 feet of conduit along the east wall?',
    knownProjectNames: [...OWNER_PROJECTS, 'Building 375'],
    refused: null,
  },
  // The five questions that used to be refused are allowed.
  {
    name: 'allows 4000 psi concrete',
    projectName: SELECTED,
    question: 'What strength is the 4000 psi concrete at the footings?',
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  },
  {
    name: 'allows room 1105',
    projectName: SELECTED,
    question: 'What finish is scheduled for room 1105?',
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  },
  {
    name: 'allows spec section 079200',
    projectName: SELECTED,
    question: 'Which sealant does section 079200 require?',
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  },
  {
    name: 'allows a 12000 BTU unit',
    projectName: SELECTED,
    question: 'Where is the 12000 BTU split unit mounted?',
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  },
  {
    name: 'allows elevation 1250',
    projectName: SELECTED,
    question: 'What is at elevation 1250 on the east wall?',
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  },
  // The same five, where each number is also another project's number: a unit
  // or a spec section written as such is exempt; a reference word (pass 5) is not.
  {
    name: 'allows 4000 psi even when project 4000 exists',
    projectName: SELECTED,
    question: 'What strength is the 4000 psi concrete at the footings?',
    knownProjectNames: [...OWNER_PROJECTS, '4000 Warehouse'],
    refused: null,
  },
  {
    name: 'refuses Rm. 1105 when project 1105 exists (pass 5)',
    projectName: SELECTED,
    question: 'What finish is scheduled for Rm. 1105?',
    knownProjectNames: [...OWNER_PROJECTS, '1105 Oak Street'],
    refused: '1105',
  },
  {
    name: 'allows section 079200 even when project 079200 exists (six digits starting with 0)',
    projectName: SELECTED,
    question: 'Which sealant does Section 079200 require?',
    knownProjectNames: [...OWNER_PROJECTS, '079200 Envelope Study'],
    refused: null,
  },
  {
    name: 'allows 12000 BTU even when project 12000 exists',
    projectName: SELECTED,
    question: 'Where is the 12000 btu split unit mounted?',
    knownProjectNames: [...OWNER_PROJECTS, 'Job 12000 Retail'],
    refused: null,
  },
  {
    name: 'refuses El. 1250 when project 1250 exists (pass 5)',
    projectName: SELECTED,
    question: 'What is at El. 1250 on the east wall?',
    knownProjectNames: [...OWNER_PROJECTS, '1250 Harbor Road'],
    refused: '1250',
  },
  // Owner-requested cases.
  {
    name: 'allows a number that is not a known project',
    projectName: SELECTED,
    question: 'How thick is the new concrete on the north side of 2400?',
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  },
  {
    name: 'allows a known project number followed by psi',
    projectName: SELECTED,
    question: 'Is 2375 psi enough for the slab on grade?',
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  },
  {
    name: 'refuses the known project named without a unit',
    projectName: SELECTED,
    question: 'Is the slab at 2375 ready for inspection?',
    knownProjectNames: OWNER_PROJECTS,
    refused: '2375',
  },
  // Other units from the rule; reference words no longer exempt (pass 5).
  {
    name: 'allows the other units',
    projectName: SELECTED,
    question: 'Check 2375 ksi, 2375 lbs, 2375 CFM, 2375 SF, 2375 LF, 2375 gal, 2375%, 2375 sq ft, 2375 kVA and 2375 hp.',
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  },
  ...['door 2375', 'grid 2375', 'level 2375', 'detail 2375', 'sheet #2375'].map(reference => ({
    name: `refuses "${reference}" when 2375 is another project (pass 5)`,
    projectName: SELECTED,
    question: `Check ${reference}.`,
    knownProjectNames: OWNER_PROJECTS,
    refused: '2375',
  })),
  {
    name: 'refuses a bare project number after allowed measurements',
    projectName: SELECTED,
    question: 'Is 2375 psi used at 2375 as well?',
    knownProjectNames: OWNER_PROJECTS,
    refused: '2375',
  },
  {
    name: 'refuses a 3-digit project identifier',
    projectName: SELECTED,
    question: 'Did the crew finish the curb at 375 yet?',
    knownProjectNames: [...OWNER_PROJECTS, '375 Main Street'],
    refused: '375',
  },
  {
    name: 'ignores another project that shares the selected number',
    projectName: SELECTED,
    question: 'What is left at 2321?',
    knownProjectNames: [...OWNER_PROJECTS, '2321 Annex'],
    refused: null,
  },
  {
    name: 'allows any number when the selected project is the only project',
    projectName: SELECTED,
    question: 'How thick is the new concrete on the north side of 2375?',
    knownProjectNames: [SELECTED],
    refused: null,
  },
  {
    name: 'never refuses when the selected project name has no number',
    projectName: 'Harbor Office',
    question: 'How thick is the new concrete on the north side of 2375?',
    knownProjectNames: ['Harbor Office', ...OWNER_PROJECTS],
    refused: null,
  },
  // Audit A9 pass 3 L2: one number rule with Talk. A phone number, an amount,
  // a measurement or a date is not project 2375; naming the project still is.
  ...[
    'Call the super at 555-2375 about the pour.',
    'Call the super at (415) 555-2375 about the pour.',
    'Was the $2375 invoice for the rebar paid?',
    'Is the new slab 2375 mm thick?',
    'Is the main service a 2375 amp service?',
    'Was the inspection on 9/30/2375 passed?',
  ].map(question => ({
    name: `allows "${question}" when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  })),
  ...[
    'Are the 450 kcmil feeders pulled?',
    'Is the new panel 200 amp?',
    'Is the service 208 V or 480 V?',
    'Are the 120 volt circuits tested?',
    'Did we pour 100 cubic yards today?',
  ].map(question => ({
    name: `allows "${question}" when a 3-digit number is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: [...OWNER_PROJECTS, '450 Harrison', '200 Oak Street', '208 Pine', '120 Elm', '100 Main Street', '480 Bay'],
    refused: null,
  })),
  // Pass 3 allowed these as paperwork or room references or street addresses;
  // pass 5 refuses them (when unsure, refuse).
  ...[
    'Which finish goes in rooms 2375 and 2376?',
    'What did RFI 2375 say about the embeds?',
    'What did RFI #2375 say about the embeds?',
    'Is the kitchen in unit 2375 finished?',
    'Was submittal 2375 approved?',
    'What does keynote 2375 call for?',
    'Who is moving into suite 2375?',
    'What is on sheet 2375?',
    'Which wall type is detail 2375?',
    'When is the delivery to 2375 Main Street?',
    'When is the delivery to 2375 N. Harbor Blvd?',
  ].map(question => ({
    name: `refuses "${question}" when 2375 is another project (pass 5)`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused: '2375',
  })),
  ...([
    ['What was the slab thickness at 2375?', '2375'],
    ['Is the rebar for 2375 on site?', '2375'],
    ['What is overdue on 2375 Compliance?', '2375'],
    ['What is overdue on project 2375?', '2375'],
    ['What is overdue on job 2375?', '2375'],
    ['Is the slab at 2375 by the service road done?', '2375'],
    ['When did the pour at 2375 take place?', '2375'],
    ['Call about 2375 at 555-1234 today.', '2375'],
  ] as const).map(([question, refused]) => ({
    name: `still refuses "${question}"`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused,
  })),
  {
    name: 'a street address that is the other project is still refused',
    projectName: SELECTED,
    question: 'What is left at 1105 Oak Street?',
    knownProjectNames: [...OWNER_PROJECTS, '1105 Oak Street'],
    refused: '1105',
  },
  {
    name: 'a reference word followed by the other project\'s name is refused',
    projectName: SELECTED,
    question: 'Which RFIs are open at unit 2375 Compliance?',
    knownProjectNames: OWNER_PROJECTS,
    refused: '2375',
  },
  {
    name: 'a 3-digit project named without a unit is still refused',
    projectName: SELECTED,
    question: 'What is overdue at 450 Harrison?',
    knownProjectNames: [...OWNER_PROJECTS, '450 Harrison'],
    refused: '450',
  },
  // Audit A9 pass 3 L1: a closed project is not in the pickable list, yet its
  // number still names it.
  {
    name: 'refuses a closed project named by its number',
    projectName: SELECTED,
    question: 'What was the slab thickness at 2375?',
    knownProjectNames: [SELECTED],
    closedProjectNames: ['2375 Compliance Project'],
    refused: '2375',
    refusedClosed: true,
  },
  {
    name: 'a measurement is not a closed project either',
    projectName: SELECTED,
    question: 'Is 2375 psi enough for the slab on grade?',
    knownProjectNames: [SELECTED],
    closedProjectNames: ['2375 Compliance Project'],
    refused: null,
  },
  {
    name: 'a number an open and a closed project share is read as the open one',
    projectName: SELECTED,
    question: 'What was the slab thickness at 2375?',
    knownProjectNames: OWNER_PROJECTS,
    closedProjectNames: ['2375 Old Phase'],
    refused: '2375',
    refusedClosed: false,
  },
  {
    name: 'a closed project that shares the selected number is not another project',
    projectName: SELECTED,
    question: 'What is left at 2321?',
    knownProjectNames: [SELECTED],
    closedProjectNames: ['2321 Phase 1'],
    refused: null,
  },
  {
    name: 'without a project list, a closed project is still refused and marked closed',
    projectName: SELECTED,
    question: 'What was the slab thickness at 2375?',
    closedProjectNames: ['2375 Compliance Project'],
    refused: '2375',
    refusedClosed: true,
  },
  // Audit A9 pass 4 L1: an address written differently from a project's name
  // still names it, and a number that is an address project's is never let
  // through as a street address.
  ...([
    ['What is the slab thickness at 2375 N. Harbor Blvd?', '2375 Harbor Blvd'],
    ['What is the slab thickness at 2375 North Harbor Boulevard?', '2375 Harbor Blvd'],
    ['What is the slab thickness at 2375 Harbor Blvd?', '2375 N. Harbor Blvd'],
    ['What is left at 2375 W 7th St?', '2375 West 7th Street'],
    ['Which RFIs are open at unit 2375 N. Harbor Blvd?', '2375 Harbor Blvd'],
    ['When is the delivery to 2375 Main Street?', '2375 Harbor Blvd'],
    ['What is left at 2375 Main?', '2375 Main Street'],
    ['deliver to 2375 main street', '2375 Main Street'],
  ] as const).map(([question, project]) => ({
    name: `refuses "${question}" when the other project is "${project}"`,
    projectName: SELECTED,
    question,
    knownProjectNames: [SELECTED, project],
    refused: '2375',
  })),
  {
    name: 'refuses a closed address project written differently, marked closed',
    projectName: SELECTED,
    question: 'What is the slab thickness at 2375 N. Harbor Blvd?',
    knownProjectNames: [SELECTED],
    closedProjectNames: ['2375 Harbor Blvd'],
    refused: '2375',
    refusedClosed: true,
  },
  {
    name: 'never refuses the selected project\'s own address written differently',
    projectName: '2375 Harbor Blvd',
    question: 'What is left at 2375 N. Harbor Blvd?',
    knownProjectNames: ['2375 Harbor Blvd', SELECTED],
    refused: null,
  },
  // Audit A9 pass 4 L2 and pass 5: a reference word, a list or a range does
  // not exempt another project's number.
  ...[
    'Did we invoice 2375 yet?',
    'Any open items 2375?',
    'Open RFIs 2375?',
    'Copy submittal 14 to 2375?',
    'Copy submittals 14 and 15 to 2375?',
    'Compare level 2 to 2375',
    'Did RFI 12 and 2375 close?',
    'Was permit 2375 issued?',
  ].map(question => ({
    name: `refuses "${question}" when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused: '2375',
  })),
  ...[
    'Which finish goes in rooms 2374 and 2375?',
    'Are RFIs 2374, 2375 and 2376 answered?',
    'Are rooms 2370 through 2375 painted?',
    'Are rooms from 2370 to 2375 painted?',
    'Was invoice #2375 paid?',
    'Was invoice no. 2375 paid?',
    'Was permit number 2375 issued?',
    // Audit A9 pass 5 review.
    'Compare the drawings from 2375 and 2321',
    'Do the specs from 2321 and 2375 match?',
    'Copy the submittals from 2321 to 2375?',
    'Are the RFIs from 2375 and 2380 answered?',
  ].map(question => ({
    name: `refuses "${question}" when 2375 is another project (pass 5)`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused: '2375',
  })),
  // Audit A9 pass 4 L3 and pass 5: a closed project's number is refused like
  // an open one's; days, hours, bags, linear feet and sqft are measurements.
  ...([
    ['Did the 200 bags of grout arrive?', '200 Oak Street'],
    ['Is the crane rented for 200 days?', '200 Oak Street'],
    ['What is due in the next 120 days?', '120 Elm'],
    ['Did the crew log 120 hours this week?', '120 Elm'],
    ['Did the 2375 bags of grout arrive?', '2375 Compliance Project'],
  ] as const).map(([question, closed]) => ({
    name: `allows "${question}" when "${closed}" is closed`,
    projectName: SELECTED,
    question,
    knownProjectNames: [SELECTED],
    closedProjectNames: [closed],
    refused: null,
  })),
  ...([
    ['What is left at 200 Oak St?', '200 Oak Street', '200'],
    ['Is 200 Oak done?', '200 Oak Street', '200'],
    ['What is overdue on job no. 200?', '200 Oak Street', '200'],
    ['Is the rebar for 200 on site?', '200 Oak Street', '200'],
    ['What is open on the 200 job?', '200 Oak Street', '200'],
    ['Is 120 Elm closed out?', '120 Elm', '120'],
    ['Did the 2375 cartons of grout arrive?', '2375 Compliance Project', '2375'],
    // Audit A9 pass 5 review.
    ['What is overdue on 200?', '200 Oak Street', '200'],
    ['Is 200 done?', '200 Oak Street', '200'],
    ['How did #200 finish?', '200 Oak Street', '200'],
    ['Pull the closeout docs from 200', '200 Oak Street', '200'],
    ['What is left at 2375 Days Inn?', '2375 Days Inn Renovation', '2375'],
  ] as const).map(([question, closed, refused]) => ({
    name: `refuses "${question}" as the closed project "${closed}"`,
    projectName: SELECTED,
    question,
    knownProjectNames: [SELECTED],
    closedProjectNames: [closed],
    refused,
    refusedClosed: true,
  })),
  {
    name: 'an open 3-digit project is named by a count without a listed unit (when unsure, refuse)',
    projectName: SELECTED,
    question: 'Did the 200 cartons of grout arrive?',
    knownProjectNames: [SELECTED, '200 Oak Street'],
    refused: '200',
  },
  {
    name: 'an open 3-digit project is not named by a count with a listed unit',
    projectName: SELECTED,
    question: 'Did the 200 bags of grout arrive?',
    knownProjectNames: [SELECTED, '200 Oak Street'],
    refused: null,
  },
  ...[
    'Is the trench 2375 linear feet?',
    'Is the slab 2375 sqft?',
    'Is the float 2375 days?',
  ].map(question => ({
    name: `allows the measurement "${question}" when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  })),
  // Audit A9 pass 5: the project's own next name word beats a unit, and a
  // year is exempt only inside a full date.
  ...([
    ['What is left at 2375 Days Inn?', '2375 Days Inn Renovation', '2375'],
    ['Is the float 2375 days?', '2375 Days Inn Renovation', '2375'],
    ['What is overdue on project 2050?', '2050 Harbor Blvd', '2050'],
  ] as const).map(([question, project, refused]) => ({
    name: `refuses "${question}" when the other project is "${project}"`,
    projectName: SELECTED,
    question,
    knownProjectNames: [SELECTED, project],
    refused,
  })),
  // Audit A9 pass 5: the five exemptions.
  ...([
    ['What strength is the 4000 psi concrete?', '4000 Warehouse'],
    ['Is the new slab 2375 mm thick?', '2375 Compliance Project'],
    ['Is the crane rented for 200 days?', '200 Oak Street'],
    ['Was the $2,375 change order approved?', '2375 Compliance Project'],
    ['Was the inspection on 10/05/2026 passed?', '2026 Fit-Out'],
    ['Call the super at 555-2375.', '2375 Compliance Project'],
    ['Which sealant does spec 03 30 00 call for?', '2375 Compliance Project'],
    ['What is on sheet A-201?', '201 Market Street'],
    ['Is the run 2375\' long?', '2375 Compliance Project'],
    ['Was the $2,375 change order approved?', '375 Main Street'],
  ] as const).map(([question, project]) => ({
    name: `allows "${question}" when "${project}" is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: [SELECTED, project],
    refused: null,
  })),
  // Audit A9 pass 6 M1: "units" and "sheets" are not units of measure; "bags"
  // and "ea" still are.
  ...([
    ['Are the 2375 units framed?', '2375'],
    ['Are the 2375 sheets issued?', '2375'],
    ['Are the 2375 bags here?', null],
    ['Are the 2375 ea anchors here?', null],
  ] as const).map(([question, refused]) => ({
    name: `pass 6 M1: "${question}" when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused,
  })),
  // Audit A9 pass 6 L1: a spaced capital "A" before a word is a wing or
  // building letter; before punctuation or the end it is amps.
  ...([
    ['What is left in the 2375 A wing?', '2375'],
    ['Is the 2375 A building topped out?', '2375'],
    ['Is 2375 A or B behind?', '2375'],
    ['Is the panel 2375 A?', null],
    ['Is the breaker 2375A?', null],
    ['Is the service 2375 V or 480 V?', null],
  ] as const).map(([question, refused]) => ({
    name: `pass 6 L1: "${question}" when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused,
  })),
  // Audit A9 pass 6 L2: " or ” after a number closes an open quotation; it is
  // an inch mark only with no quotation open, or in a feet-inch pair.
  ...([
    ['The super wrote "delivered to 2375" this morning, right?', '2375'],
    ['The super wrote “delivered to 2375” this morning, right?', '2375'],
    ['Is the pipe 2375" long?', null],
    ['Is the 6" pipe 2375" long?', null],
    ['He wrote "set the sleeve at 12\'-2375" above grade" today?', null],
  ] as const).map(([question, refused]) => ({
    name: `pass 6 L2: ${question} when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused,
  })),
  // Fail closed: without a usable list, today's stricter check applies exactly.
  {
    name: 'without a project list, 4000 psi is still refused (unchanged)',
    projectName: SELECTED,
    question: 'What strength is the 4000 psi concrete at the footings?',
    refused: '4000',
  },
  {
    name: 'with a null project list, room 1105 is still refused (unchanged)',
    projectName: SELECTED,
    question: 'What finish is scheduled for room 1105?',
    knownProjectNames: null,
    refused: '1105',
  },
  {
    name: 'with an empty project list, the stricter check applies',
    projectName: SELECTED,
    question: 'Where is the 12000 BTU split unit mounted?',
    knownProjectNames: [],
    refused: '12000',
  },
  {
    name: 'without a project list, a year is still not a project number (unchanged)',
    projectName: SELECTED,
    question: 'What work is scheduled at 2321 in 2026?',
    refused: null,
  },
  {
    name: 'without a project list, the north side of 2375 is still refused (unchanged)',
    projectName: SELECTED,
    question: 'How thick is the new concrete on the north side of 2375?',
    refused: '2375',
  },
]);
