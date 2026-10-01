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
  /** The selected project's identifier in a refusal; '2321' when omitted (audit A9 pass 8 L7). */
  refusedSelected?: string;
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
  // Audit A9 pass 9 M1: this vector used to pin "never refuses when the
  // selected project name has no number", which answered another project's
  // 2375 from Harbor Office. A name without a number has no numbers of its
  // own, so another project's number is refused as usual, shown by name.
  {
    name: 'pass 9 M1: refuses another project\'s number when the selected project name has no number',
    projectName: 'Harbor Office',
    question: 'How thick is the new concrete on the north side of 2375?',
    knownProjectNames: ['Harbor Office', ...OWNER_PROJECTS],
    refused: '2375',
    refusedSelected: 'Harbor Office',
  },
  {
    name: 'pass 9 M1: without a project list, an unnumbered selection gets the stricter check',
    projectName: 'Harbor Office',
    question: 'How thick is the new concrete on the north side of 2375?',
    refused: '2375',
    refusedSelected: 'Harbor Office',
  },
  {
    name: 'pass 9 M1: without a project list, an unnumbered selection still reads no year and no 3-digit number',
    projectName: 'Harbor Office',
    question: 'Which of the 450 deliveries are due in 2026?',
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
    // "9/30/2375" was allowed here until audit A9 pass 6 L3: a date's year
    // must be 19xx or 20xx, so 2375 now names the project (refusing is right;
    // see the pass 6 L3 vectors below).
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
    // "Is the run 2375' long?" was here: since audit A9 pass 8 a lone ' is not a feet mark (refused in the pass 7 L3 vectors).
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
  // building letter. Since audit A9 pass 7 L5 a spaced " A" is never amps,
  // so "Is the panel 2375 A?" (allowed, null, in pass 6) is refused too.
  ...([
    ['What is left in the 2375 A wing?', '2375'],
    ['Is the 2375 A building topped out?', '2375'],
    ['Is 2375 A or B behind?', '2375'],
    ['Is the panel 2375 A?', '2375'],
    // Pass 9 L5: a glued A is never amps, so this flips to refused.
    ['Is the breaker 2375A?', '2375'],
    ['Is the service 2375 V or 480 V?', null],
  ] as const).map(([question, refused]) => ({
    name: `pass 6 L1: "${question}" when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused,
  })),
  // Audit A9 pass 6 L2: " or ” after a number closes an open quotation. Since
  // audit A9 pass 8 it is an inch mark only in a feet-inch pair.
  ...([
    ['The super wrote "delivered to 2375" this morning, right?', '2375'],
    ['The super wrote “delivered to 2375” this morning, right?', '2375'],
    // Pass 8: a lone " is not an inch mark (the quotation tracking was removed), so these two flip to refused.
    ['Is the pipe 2375" long?', '2375'],
    ['Is the 6" pipe 2375" long?', '2375'],
    // Pass 9 L4: inches are one or two digits, so 12'-2375" is not a
    // measurement and this flips to refused.
    ['He wrote "set the sleeve at 12\'-2375" above grade" today?', '2375'],
    ['Is it 12\' 2375"?', '2375'],
    ['Is the run 2375\' 11.5" long?', null],
  ] as const).map(([question, refused]) => ({
    name: `pass 6 L2: ${question} when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused,
  })),
  // Audit A9 pass 6 L3: a four-digit date year is 19xx or 20xx in every shape.
  ...([
    ['Pull the Sept 30 2375 daily log', '2375'],
    ['Did the May 3 2375 pour pass?', '2375'],
    ['Send the Oct 5, 2375 report', '2375'],
    ['Was the inspection on 9/30/2375 passed?', '2375'],
    ['Was the inspection on 2375-10-05 passed?', '2375'],
    ['Was the inspection on 5 Oct 2375 passed?', '2375'],
  ] as const).map(([question, refused]) => ({
    name: `pass 6 L3: refuses "${question}" when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused,
  })),
  ...[
    'Pull the Sept 30 2026 daily log',
    'Send the Oct 5, 2026 report',
    'Was the inspection on 9/30/2026 passed?',
    'Was the inspection on 2026-10-05 passed?',
  ].map(question => ({
    name: `pass 6 L3: allows "${question}" when 2026 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: [...OWNER_PROJECTS, '2026 Fit-Out'],
    refused: null,
  })),
  // Audit A9 pass 6 L4: a number written with thousands commas is read as its
  // digits outside money and measurements ("2,375" is 2375, not 375).
  ...([
    ['What is overdue on project 2,375?', OWNER_PROJECTS, '2375'],
    // Audit A9 pass 7 L2: these two were allowed (null) in pass 6. A grouped
    // number that is no project's is now checked part by part too.
    ['What is overdue on project 2,375?', [SELECTED, '375 Main Street'], '375'],
    ['What is overdue on project 2,321?', OWNER_PROJECTS, null],
    ['Is the slab 2,375 sqft?', OWNER_PROJECTS, null],
    ['Did we lay 1,234,567 bricks?', [SELECTED, '234 Elm'], '234'],
  ] as const).map(([question, knownProjectNames, refused]) => ({
    name: `pass 6 L4: "${question}" with ${knownProjectNames.slice(1).join(', ')}`,
    projectName: SELECTED,
    question,
    knownProjectNames,
    refused,
  })),
  // Audit A9 pass 6 L5: units the earlier rule exempted are measurements
  // again for an open or a closed 3-digit project.
  ...([
    ['Are the 500 MCM feeders pulled?', '500 Harrison'],
    ['Is the RTU 250 MBH?', '250 Main Street'],
    ['Is the beam load 600 plf?', '600 Pine'],
    // "300 meters", "300 metres" and "200 pieces" were here until audit A9
    // pass 7 L1; they now name the project (see the pass 7 L1 vectors).
    ['Is the run 300 m?', '300 Bay'],
    ['Is the heater 500 watts?', '500 Harrison'],
    ['Did the 200 pcs of rebar arrive?', '200 Oak Street'],
    ['Is the cure 120 min?', '120 Elm'],
  ] as const).flatMap(([question, project]) => [
    {
      name: `pass 6 L5: allows "${question}" when "${project}" is open`,
      projectName: SELECTED,
      question,
      knownProjectNames: [SELECTED, project],
      refused: null,
    },
    {
      name: `pass 6 L5: allows "${question}" when "${project}" is closed`,
      projectName: SELECTED,
      question,
      knownProjectNames: [SELECTED],
      closedProjectNames: [project],
      refused: null,
    },
  ]),
  {
    name: 'pass 6 L5: a count without a listed unit still names the 3-digit project',
    projectName: SELECTED,
    question: 'Did the 200 crates of rebar arrive?',
    knownProjectNames: [SELECTED, '200 Oak Street'],
    refused: '200',
  },
  // Audit A9 pass 7 L1: "meters", "metres" and "pieces" are construction
  // nouns like "units" and "sheets", not units; "m" and "pcs" still are.
  ...([
    ['Are the 2375 meters set?', OWNER_PROJECTS, '2375'],
    ['Are the 2375 metres set?', OWNER_PROJECTS, '2375'],
    ['Are the 2375 pieces delivered?', OWNER_PROJECTS, '2375'],
    ['Is the run 300 meters?', [SELECTED, '300 Bay'], '300'],
    ['Did the 200 pieces of rebar arrive?', [SELECTED, '200 Oak Street'], '200'],
    ['Is the run 2375 m?', OWNER_PROJECTS, null],
    ['Did the 2375 pcs of rebar arrive?', OWNER_PROJECTS, null],
  ] as const).map(([question, knownProjectNames, refused]) => ({
    name: `pass 7 L1: "${question}" with ${knownProjectNames.slice(1).join(', ')}`,
    projectName: SELECTED,
    question,
    knownProjectNames,
    refused,
  })),
  // Audit A9 pass 7 L2: a comma-grouped number that is not itself a known
  // project's number is checked part by part as well ("200,375" is 200 and
  // 375); money and measurements stay exempt, and a known grouped number
  // (the selected "2,321") is read whole.
  ...([
    ['Compare 200,375', [SELECTED, '200 Oak Street', '375 Main Street'], '200'],
    ['Punch list for 101,205?', [SELECTED, '205 Yard'], '205'],
    ['Compare 200,375,450', [SELECTED, '450 Bay'], '450'],
    ['What is overdue on project 2,321?', [SELECTED, '321 Pine'], null],
    ['What is overdue on project 2,375?', [...OWNER_PROJECTS, '375 Main Street'], '2375'],
    ['Was the $200,375 change order approved?', [SELECTED, '200 Oak Street', '375 Main Street'], null],
    ['Is the slab 200,375 sqft?', [SELECTED, '200 Oak Street', '375 Main Street'], null],
  ] as const).map(([question, knownProjectNames, refused]) => ({
    name: `pass 7 L2: "${question}" with ${knownProjectNames.slice(1).join(', ')}`,
    projectName: SELECTED,
    question,
    knownProjectNames,
    refused,
  })),
  {
    name: 'pass 7 L2: a closed project in a comma-grouped list is refused, marked closed',
    projectName: SELECTED,
    question: 'Punch list for 101,205?',
    knownProjectNames: [SELECTED],
    closedProjectNames: ['101 Shop'],
    refused: '101',
    refusedClosed: true,
  },
  // Audit A9 pass 7 L3: ' or ’ after a number closes an open single
  // quotation. Since audit A9 pass 8 it is a feet mark only in a feet-inch pair.
  ...([
    ["The super wrote 'delivered to 2375' this morning, right?", '2375'],
    ['The super wrote ‘delivered to 2375’ this morning, right?', '2375'],
    ["I don't know, he wrote 'send it to 2375' today?", '2375'],
    ["Is the '2375' job done?", '2375'],
    // Pass 8: a lone ' is not a feet mark (the quotation tracking was removed), so these two flip to refused.
    ["Is the run 2375' long?", '2375'],
    ["I don't think the run is 2375' long?", '2375'],
    ["He wrote 'set the sleeve at 2375'-6\" above grade' today?", null],
    ["He wrote 'set the sleeve at 2375'6\" above grade' today?", null],
  ] as const).map(([question, refused]) => ({
    name: `pass 7 L3: ${question} when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused,
  })),
  // Audit A9 pass 7 L4: "the 6" pipe at 2375"" names 2375. Since audit A9
  // pass 8 no quotation is tracked: a " is an inch mark only in a feet-inch pair.
  ...([
    ['He wrote "the 6" pipe at 2375" this morning?', '2375'],
    ['He wrote “the 6" pipe at 2375” this morning?', '2375'],
    ['Is the "2375" job done?', '2375'],
    // Pass 8: a lone " is not an inch mark (the quotation tracking was removed), so this flips to refused.
    ['Is the 6" pipe 2375" long?', '2375'],
    // Pass 9 L4: inches are one or two digits, so this flips to refused.
    ['He wrote "set the 6" sleeve at 12\' 2375" above grade" today?', '2375'],
    ['He wrote "set the 6" sleeve at 2375\' 6" above grade" today?', null],
  ] as const).map(([question, refused]) => ({
    name: `pass 7 L4: ${question} when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused,
  })),
  // Audit A9 pass 7 L5: a glued "A" is amps unless a letter list or a
  // site-part word follows; a spaced " A" is never amps; "amps" and
  // "amperes" are units.
  ...([
    ['Are the 2375 A, B and C wings done?', OWNER_PROJECTS, '2375'],
    ['What is left at 2375 A?', OWNER_PROJECTS, '2375'],
    ['What is left in the 2375A wing?', OWNER_PROJECTS, '2375'],
    ['Are the 2375A, B and C wings done?', OWNER_PROJECTS, '2375'],
    ['Is 2375A/B done?', OWNER_PROJECTS, '2375'],
    ['Is 2375A & B done?', OWNER_PROJECTS, '2375'],
    ['Is 2375A and B done?', OWNER_PROJECTS, '2375'],
    ['Is the 2375A Tower topped out?', OWNER_PROJECTS, '2375'],
    ['Is the panel 200 A?', [SELECTED, '200 Oak Street'], '200'],
    // Pass 9 L5: a glued A is never amps, so these two flip to refused.
    ['Is the panel 200A?', [SELECTED, '200 Oak Street'], '200'],
    ['Is the main 2375A, 3 phase?', OWNER_PROJECTS, '2375'],
    ['Is the panel 200 amps?', [SELECTED, '200 Oak Street'], null],
    ['Is the panel 200 amperes?', [SELECTED, '200 Oak Street'], null],
  ] as const).map(([question, knownProjectNames, refused]) => ({
    name: `pass 7 L5: "${question}" with ${knownProjectNames.slice(1).join(', ')}`,
    projectName: SELECTED,
    question,
    knownProjectNames,
    refused,
  })),
  // Audit A9 pass 8 L1, L3: the quotation tracking is gone. A quote mark after
  // a number is a measurement only in a feet-inch pair with both marks; word
  // units ("ft", "in.", "inch", "feet", "LF") still are.
  ...([
    ['Did he write "Gate 5" or "go to 2375" today?', '2375'],
    ['He wrote “the 6” pipe at 2375” this morning', '2375'],
    ["He wrote 'the 12' beam at 2375' this morning", '2375'],
    ['He wrote ‘the 12’ beam at 2375’ this morning', '2375'],
    ['Is the pipe 2375” long?', '2375'],
    ['Is the run 2375’ long?', '2375'],
    ["Is the run 2375'-6\" long?", null],
    ["Is the run 2375' 6\" long?", null],
    ["Is the run 2375'6\" long?", null],
    ['Is the run 2375’-6” long?', null],
    ['Is the run 2375′-6″ long?', null],
    ['Is the run 2375 ft long?', null],
    ['Is the pipe 2375 inch?', null],
    ['Is the run 2375 LF?', null],
  ] as const).map(([question, refused]) => ({
    name: `pass 8 L1/L3: ${question} when 2375 is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: OWNER_PROJECTS,
    refused,
  })),
  // Audit A9 pass 8 L2: a part of a comma group is unsure. Ask ECOS refuses
  // it (the accepted trade-off; Talk asks instead of moving to 200).
  {
    name: 'pass 8 L2: "the 1,200 bricks" with an open project 200 is refused',
    projectName: SELECTED,
    question: 'How many of the 1,200 bricks are laid?',
    knownProjectNames: [SELECTED, '200 Oak Street'],
    refused: '200',
  },
  // Audit A9 pass 8 L4 made 3-4 digits with am or pm a clock time. Audit A9
  // pass 9 L2 removed that exemption ("Who is the 1130 PM?" means project
  // manager), so the first four vectors, which expected null, now expect the
  // project: an accepted policy refusal. A time with a colon is still exempt.
  ...([
    ['Will the crew arrive at 730am?', '730 Bay', '730'],
    ['Will the crew arrive at 730 am?', '730 Bay', '730'],
    ['Is the walkthrough at 1130 pm?', '1130 Pine', '1130'],
    ['Is the pour at 0730am?', '0730 Night Works', '0730'],
    ['Is the crew at 2375am?', '2375 Compliance Project', '2375'],
    ['Is the crew at 1330pm?', '1330 Elm', '1330'],
    ['Will the crew arrive at 730?', '730 Bay', '730'],
    ['Who is the 1130 PM?', '1130 Pine', '1130'],
    ['Will the crew arrive at 7:30am?', '730 Bay', null],
    ['Is the pour at 0730 hrs?', '0730 Night Works', null],
  ] as const).map(([question, project, refused]) => ({
    name: `pass 8 L4 / pass 9 L2: "${question}" when "${project}" is another project`,
    projectName: SELECTED,
    question,
    knownProjectNames: [SELECTED, project],
    refused,
  })),
  // Audit A9 pass 8 L7: "2375A Main" is project 2375, shown as 2375A. A bare
  // "2375" names both 2375A and 2375B; "2375B" names 2375B Main only; the
  // selected project's own "2375A" or "2375" is never refused; "2375A" was
  // amps only when no project is written that way (until pass 9 L5).
  ...([
    ['What is left at 2375?', SELECTED, [SELECTED, '2375A Main'], '2375A', undefined],
    ['Is 2375A done?', SELECTED, [SELECTED, '2375A Main'], '2375A', undefined],
    // Audit A9 pass 10 (b): both are named (was '2375', which no project is called).
    ['What is left at 2375?', SELECTED, [SELECTED, '2375A Main', '2375B Main'], '2375A or 2375B', undefined],
    ['What is left at 2375B?', SELECTED, [SELECTED, '2375A Main', '2375B Main'], '2375B', undefined],
    ['What is left at 2375A?', '2375A Main', [SELECTED, '2375A Main', '2375B Main'], null, undefined],
    ['What is left at 2375?', '2375A Main', [SELECTED, '2375A Main', '2375B Main'], null, undefined],
    ['What is left at 2375B?', '2375A Main', [SELECTED, '2375A Main', '2375B Main'], '2375B', '2375A'],
    ['What is left at 2321?', '2375A Main', [SELECTED, '2375A Main'], '2321', '2375A'],
    // Pass 9 L5: a glued A is never amps, so this flips to refused.
    ['Is the breaker 2375A?', SELECTED, OWNER_PROJECTS, '2375', undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 8 L7: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  // Audit A9 pass 9 L1: identifiers are compared whole and upper-cased, so
  // "2375" is not "2375A". A bare number names a project numbered just that,
  // even with 2375A selected; the selected one's own "2375A" (and its digits
  // when no project is numbered just 2375) is never refused; a spaced
  // "2375 B" or "2375-B" names 2375B.
  ...([
    ['What is left at 2375?', '2375A Phase 2', [SELECTED, '2375A Phase 2', '2375 Main St'], '2375', '2375A'],
    ['What is left at 2375A?', '2375A Phase 2', [SELECTED, '2375A Phase 2', '2375 Main St'], null, undefined],
    ['What is left at 2375?', '2375 Main St', [SELECTED, '2375A Phase 2', '2375 Main St'], null, undefined],
    ['What is left at 2375A?', '2375 Main St', [SELECTED, '2375A Phase 2', '2375 Main St'], '2375A', '2375'],
    ['What is left at 2375 B?', '2375A Main', [SELECTED, '2375A Main', '2375B Main'], '2375B', '2375A'],
    ['What is left at 2375-B?', SELECTED, [SELECTED, '2375A Main', '2375B Main'], '2375B', undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 9 L1: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  // Audit A9 pass 9 L5: a glued A is never amps, so "Is 2375A done?" names
  // "2375 A Street" (project 2375), or "2375A Phase 2" when that exists.
  ...([
    ['Is 2375A done?', SELECTED, [SELECTED, '2375 A Street'], '2375', undefined],
    ['Is 2375A done?', SELECTED, [SELECTED, '2375 A Street', '2375A Phase 2'], '2375A', undefined],
    ['Is 2375A done?', '2375 A Street', [SELECTED, '2375 A Street'], null, undefined],
    ['Is the breaker 400A?', SELECTED, OWNER_PROJECTS, null, undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 9 L5: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  // Audit A9 pass 10 L1: a spaced letter is the number's only as a capital
  // standing alone ("2375 A?") or after a hyphen, and never when it continues
  // the name of a project numbered just that ("2375 A Street").
  ...([
    ['Is 2375 a priority this week?', '2375 Main St', [SELECTED, '2375 Main St', '2375A Phase 2'], null, undefined],
    // Audit A9 pass 11 F1: a capital with a word after it that makes a
    // project's identifier is the letter again (was null: answered).
    ['Is 2375 A priority this week?', '2375 Main St', [SELECTED, '2375 Main St', '2375A Phase 2'], '2375A', '2375'],
    ['What is left at 2375 A?', '2375 Main St', [SELECTED, '2375 Main St', '2375A Phase 2'], '2375A', '2375'],
    ['What is left on 2375 A Street?', SELECTED, [SELECTED, '2375 A Street', '2375A Phase 2'], '2375', undefined],
    ['What is left on 2375 A?', SELECTED, [SELECTED, '2375 A Street', '2375A Phase 2'], '2375', undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 10 L1: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  // Audit A9 pass 11 F1: a spaced capital with a word after it is the letter
  // when the number and it are a known project's identifier (open or
  // closed), unless it continues a plain project's own name.
  ...([
    ['Is 2375 B done?', '2375 Main St', [SELECTED, '2375 Main St', '2375B Annex'], '2375B', '2375'],
    ['What is left on 2375 B wing?', SELECTED, [SELECTED, '2375 Main St', '2375B Annex'], '2375B', undefined],
    ['Did 2375 B pass inspection?', '2375B Annex', [SELECTED, '2375 Main St', '2375B Annex'], null, undefined],
    ['Is 2375 B done?', '2375 Main St', [SELECTED, '2375 Main St'], null, undefined],
    ['Is 2375 b done?', '2375 Main St', [SELECTED, '2375 Main St', '2375B Annex'], null, undefined],
    ['Is 2375 A Street done?', '2375 A Street', [SELECTED, '2375 A Street', '2375A Phase 2'], null, undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 11 F1: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  // Audit A9 pass 11 F2: a hyphen letter always counts, even when it
  // continues a plain project's name ("2375-A" with "2375 A Street").
  ...([
    ['Is 2375-A done?', '2375 A Street', [SELECTED, '2375 A Street', '2375A Phase 2'], '2375A', '2375'],
    ['Is 2375-A done?', SELECTED, [SELECTED, '2375 A Street', '2375A Phase 2'], '2375A', undefined],
    ['Is 2375-A done?', '2375A Phase 2', [SELECTED, '2375 A Street', '2375A Phase 2'], null, undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 11 F2: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  // Audit A9 pass 11 F3: a project's number is the first number in its
  // name, lettered or plain ("2375-B Annex Suite 300" is 2375B, not 300).
  ...([
    ['What is left at 2375-B?', SELECTED, [SELECTED, '2375 Main St', '2375-B Annex Suite 300'], '2375B', undefined],
    ['What is left at 2375B?', '2375 Main St', [SELECTED, '2375 Main St', '2375B Annex Suite 300'], '2375B', '2375'],
    ['What is left at 2375?', '2375B Annex Suite 300', [SELECTED, '2375 Main St', '2375B Annex Suite 300'], '2375', '2375B'],
    ['What is left at 2375-B?', '2375-B Annex Suite 300', [SELECTED, '2375 Main St', '2375-B Annex Suite 300'], null, undefined],
    // Audit A9 pass 12 L1: its first plain number (300) is a second
    // identifier (when unsure, refuse); was null (answered).
    ['What is left at 300?', SELECTED, [SELECTED, '2375-B Annex Suite 300'], '2375B', undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 11 F3: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  // Audit A9 pass 11 F4: one identifier written in two cases is shown as the
  // first project writes it, not as a bare number no project has.
  {
    name: 'pass 11 F4: a bare 2375 with "2375A Main" and "2375a Annex" names 2375A',
    projectName: SELECTED,
    question: 'What is left at 2375?',
    knownProjectNames: [SELECTED, '2375A Main', '2375a Annex'],
    refused: '2375A',
  },
  {
    name: 'pass 11 F4: the same, closed, names 2375A marked closed',
    projectName: SELECTED,
    question: 'What is left at 2375?',
    knownProjectNames: [SELECTED],
    closedProjectNames: ['2375A Main', '2375a Annex'],
    refused: '2375A',
    refusedClosed: true,
  },
  {
    name: 'pass 11 F1: a closed lettered project named by a spaced capital before a word is refused as closed',
    projectName: '2375 Main St',
    question: 'Is 2375 B done?',
    knownProjectNames: [SELECTED, '2375 Main St'],
    closedProjectNames: ['2375B Annex'],
    refused: '2375B',
    refusedClosed: true,
    refusedSelected: '2375',
  },
  // Audit A9 pass 10 L2: a hyphen-joined letter in a project name is part of
  // its identifier ("2375-B Annex" is 2375B), as in a question.
  ...([
    ['What is left at 2375-B?', '2375 Main St', [SELECTED, '2375 Main St', '2375-B Annex'], '2375B', '2375'],
    ['What is left at 2375?', '2375-B Annex', [SELECTED, '2375 Main St', '2375-B Annex'], '2375', '2375B'],
    ['What is left at 2375-B?', '2375-B Annex', [SELECTED, '2375 Main St', '2375-B Annex'], null, undefined],
    ['What is left at 2375?', SELECTED, [SELECTED, '2375-B Annex'], '2375B', undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 10 L2: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  {
    name: 'pass 8 L7: a closed lettered project is refused with its letter, marked closed',
    projectName: SELECTED,
    question: 'What is left at 2375A?',
    knownProjectNames: [SELECTED],
    closedProjectNames: ['2375A Main'],
    refused: '2375A',
    refusedClosed: true,
  },
  {
    name: 'pass 8 L7: without a project list, a lettered selected project still refuses another number',
    projectName: '2375A Main',
    question: 'How thick is the slab at 2321?',
    refused: '2321',
    refusedSelected: '2375A',
  },
  // Audit A9 pass 12 L1: a name whose first number is lettered ("480V",
  // "120K", "1950s", "200A", "Bldg 100A") also keeps its first plain number
  // (the job number). Either names it on another project and either is its
  // own; it is shown by the first.
  ...([
    ['What is left on 2375?', SELECTED, [SELECTED, '480V Switchgear Upgrade 2375'], '480V', undefined],
    ['What is left on 2376?', SELECTED, [SELECTED, '120K SF Warehouse 2376'], '120K', undefined],
    ['What is left on 2377?', SELECTED, [SELECTED, '1950s Bungalow Remodel 2377'], '1950s', undefined],
    ['What is left on 2378?', SELECTED, [SELECTED, '200A Service Upgrade 2378'], '200A', undefined],
    ['What is left on 2375?', SELECTED, [SELECTED, 'Bldg 100A 2375 Main'], '100A', undefined],
    ['Is the 480V gear in?', SELECTED, [SELECTED, '480V Switchgear Upgrade 2375'], '480V', undefined],
    ['What is left on 2375?', '480V Switchgear Upgrade 2375', [SELECTED, '480V Switchgear Upgrade 2375'], null, undefined],
    ['Is the 480V gear in?', '480V Switchgear Upgrade 2375', [SELECTED, '480V Switchgear Upgrade 2375'], null, undefined],
    ['What is left on 2321?', '480V Switchgear Upgrade 2375', [SELECTED, '480V Switchgear Upgrade 2375'], '2321', '480V'],
    ['Is 2377 Days Inn done?', SELECTED, [SELECTED, '1950s Remodel 2377 Days Inn'], '1950s', undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 12 L1: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  {
    name: 'pass 12 L1: a closed "480V Switchgear Upgrade 2375" is refused as closed by its job number',
    projectName: SELECTED,
    question: 'What is left on 2375?',
    knownProjectNames: [SELECTED],
    closedProjectNames: ['480V Switchgear Upgrade 2375'],
    refused: '480V',
    refusedClosed: true,
  },
  {
    name: 'pass 12 L1: without a project list, "480V Switchgear Upgrade 2375" keeps 2375 as its own',
    projectName: '480V Switchgear Upgrade 2375',
    question: 'What is left on 2375?',
    refused: null,
  },
  {
    name: 'pass 12 L1: without a project list, a closed "480V Switchgear Upgrade 2375" is marked closed by its job number',
    projectName: SELECTED,
    question: 'What is left on 2375?',
    closedProjectNames: ['480V Switchgear Upgrade 2375'],
    refused: '2375',
    refusedClosed: true,
  },
  // Audit A9 pass 12 L2: only the selected project's identifiers are its own;
  // another number in its name ("Suite 300") names a project numbered that.
  ...([
    ['Is 300 Elm done?', '2375 Main St Suite 300', [SELECTED, '2375 Main St Suite 300', '300 Elm'], '300', '2375'],
    ['What is left at 300?', '2375 Main St Suite 300', [SELECTED, '2375 Main St Suite 300', '300A Wing'], '300A', '2375'],
    ['What is left in Suite 300?', '2375 Main St Suite 300', [SELECTED, '2375 Main St Suite 300'], null, undefined],
    ['What is left at 2375?', '2375 Main St Suite 300', [SELECTED, '2375 Main St Suite 300', '300 Elm'], null, undefined],
    ['What is left at 300?', '2375-B Annex Suite 300', [SELECTED, '2375-B Annex Suite 300', '300 Elm'], null, undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 12 L2: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  {
    name: 'pass 12 L2: a closed 300 Elm is refused as closed on 2375 Main St Suite 300',
    projectName: '2375 Main St Suite 300',
    question: 'What is left at 300?',
    knownProjectNames: [SELECTED, '2375 Main St Suite 300'],
    closedProjectNames: ['300 Elm'],
    refused: '300',
    refusedClosed: true,
    refusedSelected: '2375',
  },
  // Audit A9 pass 12 L3: a spaced capital with a word after it continues a
  // plain project's name only when that word continues it too.
  ...([
    ['Is 2375 A Phase 2 done?', '2375 A Street', [SELECTED, '2375 A Street', '2375A Phase 2'], '2375A', '2375'],
    ['Is 2375 A Phase 2 done?', SELECTED, [SELECTED, '2375 A Street', '2375A Phase 2'], '2375A', undefined],
    ['Is 2375 A Phase 2 done?', '2375A Phase 2', [SELECTED, '2375 A Street', '2375A Phase 2'], null, undefined],
    ['Is 2375 A Street done?', '2375 A Street', [SELECTED, '2375 A Street', '2375A Phase 2'], null, undefined],
    ['What is left on 2375 A?', SELECTED, [SELECTED, '2375 A Street', '2375A Phase 2'], '2375', undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 12 L3: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  // Audit A9 pass 13 L1: another project's name continuing around a number
  // names that project, even when the number is also the selected one's.
  ...([
    ['Is 300 Elm done?', '2375-B Annex Suite 300', [SELECTED, '2375-B Annex Suite 300', '300 Elm'], '300', '2375B'],
    ['Is 2375 Main St done?', '480V Switchgear Upgrade 2375', [SELECTED, '480V Switchgear Upgrade 2375', '2375 Main St'], '2375', '480V'],
    ['Is Suite 300 Elm done?', '2375-B Annex Suite 300', [SELECTED, '2375-B Annex Suite 300', '300 Elm'], '300', '2375B'],
    ['What is left at 300?', '2375-B Annex Suite 300', [SELECTED, '2375-B Annex Suite 300', '300 Elm'], null, undefined],
    ['Is 2375 Main St Phase 2 done?', '2375 Main St', [SELECTED, '2375 Main St', '2375 Main St Phase 2'], null, undefined],
  ] as const).map(([question, projectName, knownProjectNames, refused, refusedSelected]) => ({
    name: `pass 13 L1: "${question}" on "${projectName}" with ${knownProjectNames.filter(name => name !== projectName).join(', ')}`,
    projectName,
    question,
    knownProjectNames,
    refused,
    ...(refusedSelected ? { refusedSelected } : {}),
  })),
  {
    name: 'pass 13 L1: a closed 300 Elm is refused as closed on "2375-B Annex Suite 300"',
    projectName: '2375-B Annex Suite 300',
    question: 'Is 300 Elm done?',
    knownProjectNames: [SELECTED, '2375-B Annex Suite 300'],
    closedProjectNames: ['300 Elm'],
    refused: '300',
    refusedClosed: true,
    refusedSelected: '2375B',
  },
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
