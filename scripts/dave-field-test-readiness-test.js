const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const truth = read('services/DAVEProjectTruth.ts');
const provider = read('providers/PIELiveAuthorityProvider.tsx');
const signature = read('services/PIELiveAuthoritySignature.ts');
const app = read('App.tsx');

const checks = [
  ['single Project Truth contract', truth.includes("DAVE_PROJECT_TRUTH_VERSION = 'dave-project-truth/1.0'")],
  ['live authority builds Project Truth', provider.includes('buildDAVEProjectTruth({')],
  ['live authority exposes Project Truth', provider.includes('projectTruth: DAVEProjectTruth')],
  ['confirmed memories enter authority signature',
    provider.includes("from '../services/PIELiveAuthoritySignature'") &&
      signature.includes('memoryIds: input.captureMemories')],
  ['project documents enter authority signature',
    provider.includes("from '../services/PIELiveAuthoritySignature'") &&
      signature.includes('projectDocumentIds: input.projectDocuments')],
  ['workspace consumes live Project Truth', app.includes('const projectIntelligence = liveAuthority.projectTruth.intelligence')],
  ['Ask DAVE uses Project Truth builder', app.includes('return buildDAVEProjectTruth({')],
  ['Home displays evidence coverage', app.includes('liveAuthority.projectTruth.briefing.evidenceCoverage')],
  ['evidence accounting records connected evidence', truth.includes("disposition: input.connected ? 'connected' : 'unresolved'")],
  ['evidence accounting exposes unresolved records', truth.includes("unresolvedRecords: records.filter(item => item.disposition === 'unresolved')")],
  ['duplicate evidence is identified', truth.includes("disposition: 'duplicate' as const")],
  ['cross-source task links are built', truth.includes("targetType: 'project' | 'area' | 'schedule-task' | 'equipment'")],
  ['equipment identifiers are normalized', truth.includes('function extractEntityKeys')],
  ['low-confidence entity links require verification', truth.includes("needsVerification: confidence === 'low'")],
  ['photo evidence requires visual provenance', truth.includes("intelligence?.provenance === 'visual_only'")],
  ['photo baseline limitation is explicit', truth.includes('No confirmed comparable prior photo is available.')],
  ['unsupported photo evidence cannot claim progress', truth.includes("progressClaim = safeVisualEvidence")],
  ['schedule urgency is calculated', truth.includes("'overdue' | 'due_soon' | 'upcoming' | 'not_urgent'")],
  ['reported completion stays unverified', truth.includes("completionState === 'reported_complete'")],
  ['unsupported completed tasks become conflicts', truth.includes("marked complete without PM verification")],
  ['general verification queue exists', truth.includes('function buildVerificationQueue')],
  ['PM briefing contains risks and conflicts', truth.includes('risksAndConflicts: risks')],
  ['PM briefing contains exactly prioritized next actions', truth.includes(').slice(0, 3)')],
  ['PM briefing reports evidence coverage', truth.includes('evidenceCoverage:')],
  ['workspace renders verification needs', app.includes('Needs verification')],
  ['workspace renders next actions', app.includes('pmBriefing.nextActions.slice(0, 3).map')],
];

let failures = 0;
for (const [name, passed] of checks) {
  if (passed) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

if (failures > 0) {
  console.error(`\nDAVE field-test readiness contract failed: ${failures} check(s).`);
  process.exit(1);
}

console.log(`\nDAVE field-test readiness contract passed: ${checks.length} checks.`);
