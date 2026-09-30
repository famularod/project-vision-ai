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
  /** The number the guard refuses, or null when the question is allowed. */
  refused: string | null;
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
