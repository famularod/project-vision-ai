#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const app = read('App.tsx');
const provider = read('providers/PIELiveAuthorityProvider.tsx');
const reports = read('screens/ReportsScreen.tsx');
const home = app;
const capture = app;
const overview = app;
const assistant = app;
const core = read('services/PIECoreIntelligence.ts');
const realityRepo = read('services/PIERealityModelRepository.ts');
const judgmentRepo = read('services/PIEExecutiveJudgmentRepository.ts');
const supabase = read('services/SupabaseService.ts');
const layer4 = read('services/PIELayer4Automation.ts');
const appJson = JSON.parse(read('app.json'));
const easJson = JSON.parse(read('eas.json'));

assert(app.includes('<PIELiveAuthorityProvider input={liveAuthorityInput}>'), 'App must mount shared PIE authority provider.');
assert(provider.includes('buildLivePIECoreIntelligence'), 'Provider must build live PIE Core authority.');
assert(provider.includes('refreshAuthority'), 'Provider must expose refresh/invalidation.');
assert(provider.includes('highImpactAutomationAllowed'), 'Provider must gate high-impact automation.');

[
  ['Home', home],
  ['Capture', capture],
  ['Review', reports],
  ['Share', reports],
  ['Project Workspace', overview],
  ['Project Assistant', assistant],
].forEach(([name, source]) => {
  assert(source.includes('usePIELiveAuthority'), `${name} must consume shared PIE authority.`);
  assert(!source.includes('buildLivePIECoreIntelligence'), `${name} must not bypass provider with direct Core calls.`);
});

assert(!app.includes('buildPIEReportDraft({'), 'App must not rebuild report drafts from raw arrays.');
assert(!reports.includes('buildPIEReportDraft({'), 'Review must not rebuild report drafts from raw arrays.');
assert(reports.includes('liveAuthority.reportDraft || runtime.response.reportDraft'), 'Review must use provider report draft with Runtime recovery only.');
assert(
  reports.includes('reportDraft={effectiveReportDraft}') &&
    reports.includes('const startedReport = effectiveReportDraft;') &&
    reports.includes('const outcome = await communicate(startedReport);') &&
    reports.includes('completeCommunication(onCopyReport)') &&
    reports.includes('completeCommunication(onEmailReport)') &&
    reports.includes('completeCommunication(onTextReport)'),
  'Share actions must receive the authoritative or explicitly reviewed report draft.',
);

assert(app.includes('buildLayer4DecisionCandidateFromExecutiveJudgment'), 'Layer 4 decisions must come from persisted Executive Judgment.');
assert(app.includes('createDecisionSnapshotFromJudgment'), 'App must create decision snapshots from Executive Judgment records.');
assert(!app.includes('buildLayer4DecisionCandidate({'), 'App must not create Layer 4 decisions from report-only input.');
assert(layer4.includes('Layer 4 cannot create live decision candidates from report-only input'), 'Report-only Layer 4 decision creation must be blocked.');

assert(core.includes('runPIERealityModelOrchestration'), 'Core must use live Reality orchestration.');
assert(core.includes('persistStructuredExecutiveJudgment'), 'Core must persist structured Executive Judgment.');
assert(core.includes('buildPIEReportDraftFromExecutiveJudgment'), 'Core must build reports from Executive Judgment.');
assert(core.includes('cloudEnabled: input.cloudAvailable'), 'Core must pass cloud availability into persistence.');
assert(core.includes('identityTrusted: input.identityTrusted'), 'Core must pass trusted identity into persistence.');

assert(realityRepo.includes('createPIERealityModelRepository'), 'Reality repository must expose cloud-backed repository factory.');
assert(realityRepo.includes('loadPIERealityModelCloud'), 'Reality repository must hydrate from cloud when trusted.');
assert(realityRepo.includes('savePIERealityModelCloud'), 'Reality repository must save authoritative model to cloud when trusted.');
assert(judgmentRepo.includes('createPIEExecutiveJudgmentRepository'), 'Executive Judgment repository must expose cloud-backed repository factory.');
assert(judgmentRepo.includes('savePIEExecutiveJudgmentCloud'), 'Executive Judgment repository must save issued judgments to cloud when trusted.');
assert(supabase.includes('loadPIERealityModelCloud'), 'Supabase service must load cloud Reality Model snapshots.');
assert(supabase.includes('savePIEExecutiveJudgmentCloud'), 'Supabase service must save Executive Judgment records.');
assert(supabase.includes('PIE_REALITY_MODEL_SNAPSHOTS_TABLE'), 'Supabase service must reference Reality Model snapshots table.');
assert(supabase.includes('PIE_EXECUTIVE_JUDGMENTS_TABLE'), 'Supabase service must reference Executive Judgment table.');

const ios = appJson.expo && appJson.expo.ios;
assert(ios && ios.bundleIdentifier, 'iOS bundle identifier must be configured.');
assert(ios && ios.buildNumber, 'iOS build number must be configured.');
const infoPlist = ios.infoPlist || {};
[
  'NSCameraUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
  'NSLocationWhenInUseUsageDescription',
].forEach(key => {
  assert(infoPlist[key], `iOS Info.plist must include ${key}.`);
});
assert(easJson.build && easJson.build.production, 'EAS production build profile must exist.');

console.log('PASS e2e core flow authority');
