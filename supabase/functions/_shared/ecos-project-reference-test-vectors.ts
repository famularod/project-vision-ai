/**
 * Owner answer Q20 (30 Sep 2026; audit A9 pass 1 #2) test vectors for the Ask
 * ECOS wrong-project guard. The app's jest suite
 * (tests/services/ecos-project-question.test.ts) and the edge function's Deno
 * suite (ecos-project-reference.test.ts) both run every vector, so the two
 * sides are checked against one list. Synthetic project names.
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
    name: 'a year is not another project even when a project is named after it',
    projectName: SELECTED,
    question: 'Which deliveries are due in 2026?',
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
  // The same five, where each number is also another project's number: the
  // unit or reference word still marks it as a measurement or drawing reference.
  {
    name: 'allows 4000 psi even when project 4000 exists',
    projectName: SELECTED,
    question: 'What strength is the 4000 psi concrete at the footings?',
    knownProjectNames: [...OWNER_PROJECTS, '4000 Warehouse'],
    refused: null,
  },
  {
    name: 'allows Rm. 1105 even when project 1105 exists',
    projectName: SELECTED,
    question: 'What finish is scheduled for Rm. 1105?',
    knownProjectNames: [...OWNER_PROJECTS, '1105 Oak Street'],
    refused: null,
  },
  {
    name: 'allows section 079200 even when project 079200 exists',
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
    name: 'allows El. 1250 even when project 1250 exists',
    projectName: SELECTED,
    question: 'What is at El. 1250 on the east wall?',
    knownProjectNames: [...OWNER_PROJECTS, '1250 Harbor Road'],
    refused: null,
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
  // Other units and reference words from the rule.
  {
    name: 'allows the other units and reference words',
    projectName: SELECTED,
    question: 'Check 2375 ksi, 2375 lbs, 2375 CFM, 2375 SF, 2375 LF, 2375 gal, 2375%, 2375 sq ft, door 2375, grid 2375, level 2375, detail 2375 and sheet #2375.',
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  },
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
  // a measurement, a paperwork or room reference or a street address is not
  // project 2375; naming the project still is.
  ...[
    'Call the super at 555-2375 about the pour.',
    'Call the super at (415) 555-2375 about the pour.',
    'Was the $2375 invoice for the rebar paid?',
    'Is the new slab 2375 mm thick?',
    'Is the main service a 2375 amp service?',
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
    name: 'a reference word followed by the other project\'s name is still refused',
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
  // Audit A9 pass 4 L2: a reference word labels only the number right after
  // it; a plural only a real list; "invoice" and "permit" only with "#", "no."
  // or "number".
  ...[
    'Did we invoice 2375 yet?',
    'Any open items 2375?',
    'Open RFIs 2375?',
    'Copy submittal 14 to 2375?',
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
  ].map(question => ({
    name: `allows "${question}" when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused: null,
  })),
  // Audit A9 pass 4 L3: a closed 3-digit project is refused only when it is
  // named as the project; days, hours, linear feet and sqft are measurements.
  ...([
    ['Did the 200 bags of grout arrive?', '200 Oak Street'],
    ['What is due in the next 120 days?', '120 Elm'],
    ['Did the crew log 120 hours this week?', '120 Elm'],
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
    ['Did the 2375 bags of grout arrive?', '2375 Compliance Project', '2375'],
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
    name: 'an open 3-digit project is still named by a bare count (when unsure, refuse)',
    projectName: SELECTED,
    question: 'Did the 200 bags of grout arrive?',
    knownProjectNames: [SELECTED, '200 Oak Street'],
    refused: '200',
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
