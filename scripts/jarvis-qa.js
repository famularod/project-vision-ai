#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const results = [];

function readFile(relativePath) {
  try {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  } catch (error) {
    return '';
  }
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function hasAll(text, patterns) {
  return patterns.every(pattern =>
    pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern),
  );
}

function hasAny(text, patterns) {
  return patterns.some(pattern =>
    pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern),
  );
}

function addResult(status, workflow, issue, recommendedFix, evidence) {
  results.push({
    status,
    workflow,
    issue,
    recommendedFix,
    evidence,
  });
}

function pass(workflow, issue, evidence) {
  addResult('PASS', workflow, issue, 'None.', evidence);
}

function warn(workflow, issue, recommendedFix, evidence) {
  addResult('WARN', workflow, issue, recommendedFix, evidence);
}

function fail(workflow, issue, recommendedFix, evidence) {
  addResult('FAIL', workflow, issue, recommendedFix, evidence);
}

function checkRequiredFile(relativePath, workflow, expectedText) {
  const text = readFile(relativePath);

  if (!fileExists(relativePath)) {
    fail(
      workflow,
      `${relativePath} was not found.`,
      `Restore or create ${relativePath}.`,
    );
    return '';
  }

  if (expectedText && !text.includes(expectedText)) {
    fail(
      workflow,
      `${relativePath} exists, but "${expectedText}" was not found.`,
      `Add or restore the expected ${workflow} marker.`,
      relativePath,
    );
    return text;
  }

  pass(workflow, `${relativePath} exists.`, relativePath);
  return text;
}

const app = readFile('App.tsx');
const appShellTheme = readFile('components/app-shell-theme.ts');
function liveAppSlice(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, Math.max(0, start + startMarker.length));
  if (start < 0) return '';
  return app.slice(start, end > start ? end : app.length);
}
const packageJson = readFile('package.json');
const bottomNav = checkRequiredFile(
  'components/app-bottom-tabs.tsx',
  'Bottom navigation',
);
const homeDashboard = liveAppSlice('function HomeScreen', 'function SelectProjectScreen');
const pieConductorCard = homeDashboard;
const projectCards = homeDashboard;
const photoCapture = liveAppSlice('function AddPhotosScreen', 'function PIEAnalysisStepScreen');
const buildUpdate = liveAppSlice('function BuildUpdateScreen', 'function ReadOnlyUpdateDetailScreen');
const reportsScreen = readFile('screens/ReportsScreen.tsx');
const projectOverviewScreen = liveAppSlice('function ProjectWorkspaceScreen', 'function ProjectDocumentsScreen');
const liveAuthorityProvider = readFile('providers/PIELiveAuthorityProvider.tsx');
const daveProjectTruth = readFile('services/DAVEProjectTruth.ts');
const daveProjectReasoning = readFile('services/DAVEProjectReasoning.ts');
const projectAssistantScreen = projectOverviewScreen;
const scheduleScreen = liveAppSlice('function ScheduleScreen', 'function ScheduleItemRow');
const scheduleImportFlow = readFile('components/ScheduleImportFlow.tsx');
const adminScreen = readFile('screens/AdminScreen.tsx');
const diagnosticsScreen = liveAppSlice('function DiagnosticsScreen', 'function ContactsScreen');
const runtime = readFile('services/PIERuntime.ts');
const evidenceFusion = readFile('services/PIEEvidenceFusion.ts');
const scheduleIntelligence = readFile('services/PIEScheduleIntelligence.ts');
const photoProgress = readFile('services/PIEPhotoProgress.ts');
const photoProgressIntelligence = readFile('services/PIEPhotoProgressIntelligence.ts');
const photoProgressIntelligenceStorage = readFile('services/PIEPhotoProgressIntelligenceStorage.ts');
const evidenceQuality = readFile('services/PIEEvidenceQuality.ts');
const missingEvidence = readFile('services/PIEMissingEvidence.ts');
const evidenceTimeline = readFile('services/PIEEvidenceTimeline.ts');
const realityModel = readFile('services/PIERealityModel.ts');
const realityModelStorage = readFile('services/PIERealityModelStorage.ts');
const realityModelRepository = readFile('services/PIERealityModelRepository.ts');
const realityModelSynchronization = readFile('services/PIERealityModelSynchronization.ts');
const realityModelOrchestrator = readFile('services/PIERealityModelOrchestrator.ts');
const realityModelGuards = readFile('services/PIERealityModelGuards.ts');
const situationIntelligence = readFile('services/PIESituationIntelligence.ts');
const predictiveReality = readFile('services/PIEPredictiveReality.ts');
const decisionSimulation = readFile('services/PIEDecisionSimulation.ts');
const recommendationChallenge = readFile('services/PIERecommendationChallenge.ts');
const jarvisReasoningValidation = readFile('services/PIEJarvisReasoningValidation.ts');
const confidenceDecomposition = readFile('services/PIEConfidenceDecomposition.ts');
const evidenceValuePrioritization = readFile('services/PIEEvidenceValuePrioritization.ts');
const executiveJudgment = readFile('services/PIEExecutiveJudgment.ts');
const executiveJudgmentRepository = readFile('services/PIEExecutiveJudgmentRepository.ts');
const adaptiveIntelligence = readFile('services/PIEAdaptiveIntelligence.ts');
const decisionMemory = readFile('services/PIEDecisionMemory.ts');
const decisionLedger = readFile('services/PIEDecisionLedger.ts');
const layer4Automation = readFile('services/PIELayer4Automation.ts');
const layer4Identity = readFile('services/PIELayer4Identity.ts');
const decisionLedgerStorage = readFile('services/PIEDecisionLedgerStorage.ts');
const decisionLedgerSync = readFile('services/PIEDecisionLedgerSync.ts');
const supabaseService = readFile('services/SupabaseService.ts');
const layer4SecurityMigration = readFile('supabase/migrations/20260701010000_layer4_decision_ledger_security.sql');
const layer4MembershipRlsMigration = readFile('supabase/migrations/20260701020000_layer4_membership_rls_atomic_sync.sql');
const realityModelMigration = readFile('supabase/migrations/20260701030000_pie_reality_model.sql');
const executiveJudgmentMigration = readFile('supabase/migrations/20260701040000_pie_executive_judgments.sql');
const photoIntelligenceMigration = readFile('supabase/migrations/20260702010000_pie_photo_intelligence.sql');
const multimodalEvidenceMigration = readFile('supabase/migrations/20260702030000_multimodal_evidence_foundation.sql');
const photoVisionFunction = readFile('supabase/functions/pie-photo-vision/index.ts');
const photoVisionProvider = readFile('supabase/functions/_shared/pie-vision-provider.ts');
const photoVisionAuthority = readFile('supabase/functions/_shared/pie-vision-authority.ts');
const productionVisionMigration = readFile('supabase/migrations/20260702040000_production_vision_pipeline.sql');
const multimodalEvidenceDoc = readFile('docs/PIE_MultimodalEvidenceArchitecture.md');
const truePhotoIntelligenceDoc = readFile('docs/PIE_TruePhotoIntelligence.md');
const visualValidationPlan = readFile('docs/PIE_VisualValidationPlan.md');
const multimodalValidationScenarios = readFile('validation/multimodal/photo-vision-scenarios.json');
const masterValidationScenarios = readFile('validation/scenarios/master-validation-scenarios.json');
const masterValidationExpected = readFile('validation/expected/master-validation-expected.json');
const masterValidationTest = readFile('scripts/pie-master-validation-test.js');
const ecosCognitiveFramework = readFile('services/ECOSCognitiveFramework.ts');
const ecosDomainAdapter = readFile('services/ECOSDomainAdapter.ts');
const pieDomainAdapter = readFile('services/PIEDomainAdapter.ts');
const pieReporter = readFile('services/PIEReporter.ts');
const pieCoreIntelligence = readFile('services/PIECoreIntelligence.ts');
const traceability = readFile('services/PIETraceability.ts');
const pieMemoryRecall = readFile('services/PIEMemoryRecall.ts');
const pieDeliberationEngine = readFile('services/PIEDeliberationEngine.ts');
const reflectionEngine = readFile('services/PIEReflectionEngine.ts');
const piePatternEngine = readFile('services/PIEPatternEngine.ts');
const pieScientificMethod = readFile('services/PIEScientificMethod.ts');
const pieBeliefEngine = readFile('services/PIEBeliefEngine.ts');
const pieExecutiveReasoning = readFile('services/PIEExecutiveReasoning.ts');
const piePredictiveEngine = readFile('services/PIEPredictiveEngine.ts');
const pieLearningEngine = readFile('services/PIELearningEngine.ts');
const attentionEngine = readFile('services/PIEAttentionEngine.ts');
const experienceEngine = readFile('services/PIEExperienceEngine.ts');
const piePanel = readFile('components/PIEPanel.tsx');
const syncService = readFile('services/SyncService.ts');
const productOperatingPlan = readFile('docs/PIE_ProductOperatingPlan.md');
const ecosCognitiveFrameworkDoc = readFile('docs/ECOS_CognitiveFramework.md');
const ecosDomainAdapterModel = readFile('docs/ECOS_DomainAdapterModel.md');
const pieEvidenceQualityModel = readFile('docs/PIE_EvidenceQualityModel.md');
const pieMissingEvidenceModel = readFile('docs/PIE_MissingEvidenceModel.md');
const pieEvidenceTimelineModel = readFile('docs/PIE_EvidenceTimelineModel.md');
const pieRealityModel = readFile('docs/PIE_RealityModel.md');
const pieSituationIntelligenceModel = readFile('docs/PIE_SituationIntelligenceModel.md');
const piePredictiveRealityModel = readFile('docs/PIE_PredictiveRealityModel.md');
const pieExecutiveJudgmentModel = readFile('docs/PIE_ExecutiveJudgmentModel.md');
const pieAdaptiveIntelligenceModel = readFile('docs/PIE_AdaptiveIntelligenceModel.md');
const pieDecisionMemoryModel = readFile('docs/PIE_DecisionMemoryModel.md');
const pieCoreIntelligencePlan = readFile('docs/PIE_CoreIntelligencePlan.md');
const pieMemoryRecallModel = readFile('docs/PIE_MemoryRecallModel.md');
const piePatternIntelligenceModel = readFile('docs/PIE_PatternIntelligenceModel.md');
const pieBeliefModel = readFile('docs/PIE_BeliefModel.md');
const pieExecutiveReasoningModel = readFile('docs/PIE_ExecutiveReasoningModel.md');
const piePredictiveSimulationModel = readFile('docs/PIE_PredictiveSimulationModel.md');
const pieContinuousLearningModel = readFile('docs/PIE_ContinuousLearningModel.md');
const pieExperienceConstitution = readFile('docs/PIE_ExperienceConstitution.md');
const pieCognitiveArchitecture = readFile('docs/PIE_CognitiveArchitecture.md');
const pieDeliberationModel = readFile('docs/PIE_DeliberationModel.md');
const pieCognitiveConstitution = readFile('docs/PIE_CognitiveConstitution.md');
const masterArchitecture = readFile('docs/PIE_MasterArchitecture.md');
const jarvisQaDoc = readFile('docs/ProjectVisionAI_JARVIS_QA.md');
const experienceQaStandard = readFile('docs/PIE_JARVIS_ExperienceQA.md');

const majorUiSource = [
  app,
  homeDashboard,
  bottomNav,
  projectCards,
  photoCapture,
  buildUpdate,
  reportsScreen,
  scheduleScreen,
  adminScreen,
  projectOverviewScreen,
  projectAssistantScreen,
  piePanel,
].join('\n');

const cognitiveSource = [
  pieCoreIntelligence,
  pieScientificMethod,
  pieBeliefEngine,
  piePatternEngine,
  pieExecutiveReasoning,
  piePredictiveEngine,
  pieLearningEngine,
  reflectionEngine,
  pieMemoryRecall,
  pieDeliberationEngine,
  attentionEngine,
  experienceEngine,
  runtime,
  evidenceFusion,
  pieReporter,
  ecosCognitiveFramework,
  ecosDomainAdapter,
  pieDomainAdapter,
  evidenceQuality,
  missingEvidence,
  evidenceTimeline,
  realityModel,
  situationIntelligence,
  predictiveReality,
  executiveJudgment,
  adaptiveIntelligence,
  decisionMemory,
].join('\n');
const primaryBottomNavSource = bottomNav.split('function isWalkActive')[0] || bottomNav;

function extractUserFacingLiterals(source) {
  const literals = [];
  const stringPattern = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match;

  while ((match = stringPattern.exec(source)) !== null) {
    const value = match[2]
      .replace(/\\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!value) continue;
    if (
      value.includes('const ') ||
      value.includes('function ') ||
      value.includes('JSON.') ||
      value.includes('=>') ||
      value.includes(');') ||
      value.includes('}:') ||
      value.length > 800
    ) {
      continue;
    }

    if (
      value.startsWith('.') ||
      value.startsWith('../') ||
      value.startsWith('./') ||
      value.startsWith('application/') ||
      value.startsWith('text/') ||
      value.includes('/services/') ||
      value.includes('/components/') ||
      value.includes('/screens/')
    ) {
      continue;
    }

    literals.push(value);
  }

  return literals.join('\n');
}

const normalUserUiText = extractUserFacingLiterals([
  app.slice(app.indexOf('function HomeScreen'), app.indexOf('function ProjectWorkspaceScreen')),
  bottomNav,
  reportsScreen,
  scheduleScreen,
].join('\n'));

function categoryForWorkflow(workflow) {
  if (/Apple|HIG|touch target|safe area|native/i.test(workflow)) return 'Apple HIG';
  if (/Visual|Layout|Text|Card|Typography|Navigation label|Bottom navigation/i.test(workflow)) {
    return 'Visual';
  }
  if (/Executive|Reporter|Report|Review|David-style|Communication/i.test(workflow)) {
    return 'Executive';
  }
  if (
    /ECOS|Scientific|Pattern|Belief|Deliberation|Reflection|Learning|Memory|Core Intelligence|Cognitive|Prediction|Knowledge Graph|Evidence Fusion/i.test(
      workflow,
    )
  ) {
    return 'Cognitive';
  }
  if (/Experience Constitution|Experience QA|Mission|Conductor|Guided Capture|PIE briefing|Invisible Intelligence/i.test(workflow)) {
    return 'Experience';
  }
  if (/UX|User|Capture|Walk|Project cards|Today|More organization|Primary action/i.test(workflow)) {
    return 'UX';
  }
  return 'Technical';
}

function symbolForStatus(status) {
  if (status === 'PASS') return '✓';
  if (status === 'WARN') return '⚠';
  return '✗';
}

function ownerForCategory(category) {
  const owners = {
    Technical: 'Engineering',
    Visual: 'Design / Frontend',
    UX: 'Product / Frontend',
    Executive: 'Product / Reporter',
    Cognitive: 'PIE Intelligence',
    Experience: 'Product Experience',
    'Apple HIG': 'Design / iOS',
  };

  return owners[category] || 'Engineering';
}

function scoreForResults(categoryResults) {
  if (categoryResults.length === 0) return 100;

  const points = categoryResults.reduce((total, result) => {
    if (result.status === 'PASS') return total + 100;
    if (result.status === 'WARN') return total + 70;
    return total;
  }, 0);

  return Math.round(points / categoryResults.length);
}

function buildCategoryScores() {
  const categories = [
    'Technical',
    'Visual',
    'UX',
    'Executive',
    'Cognitive',
    'Experience',
    'Apple HIG',
  ];

  return categories.map(category => {
    const categoryResults = results.filter(
      result => categoryForWorkflow(result.workflow) === category,
    );
    const failCount = categoryResults.filter(result => result.status === 'FAIL').length;
    const warnCount = categoryResults.filter(result => result.status === 'WARN').length;
    const score = scoreForResults(categoryResults);
    const status = failCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'PASS';

    return {
      category,
      score,
      status,
      checks: categoryResults.length,
      failCount,
      warnCount,
    };
  });
}

function severityForResult(result) {
  const base = result.status === 'FAIL' ? 100 : result.status === 'WARN' ? 55 : 0;
  const category = categoryForWorkflow(result.workflow);
  const productBoost = ['Visual', 'UX', 'Executive', 'Experience', 'Apple HIG'].includes(category)
    ? 10
    : 0;

  return base + productBoost;
}

function buildTopProblems() {
  return results
    .filter(result => result.status !== 'PASS')
    .sort((left, right) => severityForResult(right) - severityForResult(left))
    .slice(0, 10)
    .map(result => ({
      ...result,
      category: categoryForWorkflow(result.workflow),
      owner: ownerForCategory(categoryForWorkflow(result.workflow)),
    }));
}

function buildAppleReviewNotes(scores, counts) {
  const notes = [];
  const weakScores = scores
    .filter(score => score.score < 95 || score.status !== 'PASS')
    .sort((left, right) => left.score - right.score);

  weakScores.forEach(score => {
    notes.push(
      `${score.category}: raise the ${score.category.toLowerCase()} score by addressing ${score.failCount} failures and ${score.warnCount} warnings.`,
    );
  });

  if (!hasAll(majorUiSource, ['SafeAreaView', 'spacing', 'typography'])) {
    notes.push('Apple HIG: verify safe areas, spacing tokens, and readable typography on iPhone widths.');
  }

  if (!hasAny(majorUiSource, ['numberOfLines', 'adjustsFontSizeToFit', 'flexWrap'])) {
    notes.push('Visual: add explicit wrapping or dynamic sizing where long field text can appear.');
  }

  if (counts.FAIL === 0 && counts.WARN === 0) {
    notes.push('Run a real-device pass for mission, capture, review, dialogs, and More before TestFlight.');
  }

  notes.push('Confirm every normal screen has one obvious next action and no visible internal PIE terminology.');
  notes.push('Review generated project updates for executive tone, owners, locations, and evidence-backed recommendations.');

  return [...new Set(notes)].slice(0, 5);
}

if (
  fileExists('docs/PIE_ProductOperatingPlan.md') &&
  hasAll(productOperatingPlan, [
    'User -> App Evidence Capture -> PIE Processing -> App Output -> User Approval',
    'Photo + GPS + Schedule + Documents + Notes',
    'Evidence Fusion',
    'Knowledge Graph',
    'Mission',
    'Attention',
    'Reporter',
    'User Summary',
    'Confirm',
    'Capture',
    'Correct',
    'Approve',
    'Communicate',
    'Every sprint must improve PIE, evidence capture, or output clarity.',
    'Every feature must reduce user effort or improve project understanding.',
  ])
) {
  pass(
    'PIE Product Operating Plan',
    'Product Operating Plan exists with the PIE/App/User loop, evidence flow, user actions, and development rules.',
    'docs/PIE_ProductOperatingPlan.md',
  );
} else {
  fail(
    'PIE Product Operating Plan',
    'Product Operating Plan is missing or does not define the required product loop, evidence flow, user actions, and development rules.',
    'Create docs/PIE_ProductOperatingPlan.md with the controlling product model and release rules.',
    'docs/PIE_ProductOperatingPlan.md',
  );
}

if (
  fileExists('services/PIEEvidenceQuality.ts') &&
  hasAll(evidenceQuality, [
    'PIEEvidenceQualityScore',
    'PIEEvidenceQualityFactor',
    'PIEEvidenceFreshness',
    'PIEEvidenceReliability',
    'PIEEvidenceCompleteness',
    'PIEEvidenceRelevance',
    'PIEEvidenceConflict',
    'PIEEvidenceQualityResult',
    "'strong'",
    "'good'",
    "'weak'",
    "'stale'",
    "'conflicting'",
    "'insufficient'",
    'evaluateEvidenceQuality',
    'scoreEvidenceFreshness',
    'scoreEvidenceCompleteness',
    'scoreEvidenceReliability',
    'scoreEvidenceRelevance',
    'detectEvidenceConflicts',
    'rankEvidenceByUsefulness',
    'summarizeEvidenceQuality',
  ])
) {
  pass(
    'PIE Evidence Quality service',
    'PIEEvidenceQuality exists with required quality types, levels, scoring functions, conflict detection, ranking, and summary.',
    'services/PIEEvidenceQuality.ts',
  );
} else {
  fail(
    'PIE Evidence Quality service',
    'PIEEvidenceQuality is missing required types, levels, or functions.',
    'Create services/PIEEvidenceQuality.ts with quality scoring, freshness, completeness, reliability, relevance, conflict detection, ranking, and summary.',
    'services/PIEEvidenceQuality.ts',
  );
}

if (
  hasAll(evidenceQuality, [
    'recent',
    'projectName',
    'areaName',
    'gpsConfirmed',
    'photoSupported',
    'scheduleSupported',
    'userConfirmed',
    'matchesPriorEvidence',
    'unreviewedOCR',
    'correctedPreviously',
  ])
) {
  pass(
    'PIE Evidence Quality rules',
    'Evidence quality rules account for recency, project, area, GPS, photo, schedule, user confirmation, prior match, OCR review, and prior correction.',
    'services/PIEEvidenceQuality.ts',
  );
} else {
  fail(
    'PIE Evidence Quality rules',
    'Evidence quality rules do not cover the requested strengthening and weakening factors.',
    'Score recent/project/area/GPS/photo/schedule/user-confirmed/prior-match evidence higher and old/missing/OCR/corrected/conflicting evidence lower.',
    'services/PIEEvidenceQuality.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'evaluateEvidenceQuality',
    'evidenceQuality',
    'strongEvidence',
    'weakEvidence',
    'conflictingEvidence',
    'staleEvidence',
    'evidenceReadiness',
    'buildRuntimeEvidenceQualityInputs',
  ])
) {
  pass(
    'PIE Core Evidence Quality integration',
    'PIECoreIntelligence evaluates evidence quality and exposes evidenceQuality, strong/weak/conflicting/stale evidence, and evidenceReadiness.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Evidence Quality integration',
    'PIECoreIntelligence does not expose the required evidence quality outputs.',
    'Evaluate evidence quality in Core and expose evidenceQuality, strongEvidence, weakEvidence, conflictingEvidence, staleEvidence, and evidenceReadiness.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(pieBeliefEngine + pieScientificMethod + pieDeliberationEngine, [
    'evidenceQuality',
    'Evidence Quality',
    'weakEvidence',
    'staleEvidence',
    'score.level',
  ])
) {
  pass(
    'Evidence Quality reasoning integration',
    'Belief Engine, Scientific Method, and Deliberation consume evidence quality where practical.',
    'services/PIEBeliefEngine.ts, services/PIEScientificMethod.ts, services/PIEDeliberationEngine.ts',
  );
} else {
  fail(
    'Evidence Quality reasoning integration',
    'Beliefs, Scientific Method, or Deliberation do not clearly consume evidence quality.',
    'Pass evidenceQuality into belief formation, scientific evidence, and deliberation verification/readiness logic.',
    'services/PIEBeliefEngine.ts, services/PIEScientificMethod.ts, services/PIEDeliberationEngine.ts',
  );
}

if (
  fileExists('docs/PIE_EvidenceQualityModel.md') &&
  hasAll(pieEvidenceQualityModel + masterArchitecture + pieCoreIntelligencePlan + productOperatingPlan, [
    'Evidence Quality',
    'Layer 1',
    'freshness',
    'reliability',
    'completeness',
    'relevance',
    'conflict',
    'strongEvidence',
    'weakEvidence',
    'conflictingEvidence',
    'staleEvidence',
    'evidenceReadiness',
  ])
) {
  pass(
    'PIE Evidence Quality documentation',
    'Evidence Quality model and architecture docs define Layer 1 perception, quality factors, conflict handling, and Core outputs.',
    'docs/PIE_EvidenceQualityModel.md and architecture docs',
  );
} else {
  fail(
    'PIE Evidence Quality documentation',
    'Evidence Quality documentation or architecture placement is incomplete.',
    'Create docs/PIE_EvidenceQualityModel.md and update architecture docs with Evidence Quality under Layer 1 Perception.',
    'docs/PIE_EvidenceQualityModel.md',
  );
}

if (
  fileExists('services/PIEMissingEvidence.ts') &&
  hasAll(missingEvidence, [
    'PIEMissingEvidenceItem',
    'PIEMissingEvidenceType',
    'PIEMissingEvidenceImpact',
    'PIEMissingEvidenceReason',
    'PIEMissingEvidenceRequest',
    'PIEMissingEvidencePriority',
    'PIEMissingEvidenceResult',
    "'missing_photo'",
    "'missing_current_photo'",
    "'missing_location'",
    "'missing_schedule'",
    "'missing_owner'",
    "'missing_decision'",
    "'missing_inspection_status'",
    "'missing_safety_confirmation'",
    "'missing_progress_note'",
    "'missing_document'",
    "'missing_report_review'",
    "'missing_user_confirmation'",
    'findMissingEvidence',
    'prioritizeMissingEvidence',
    'buildEvidenceRequests',
    'identifyMinimumEvidenceNeeded',
    'estimateUncertaintyReduction',
    'summarizeMissingEvidence',
  ])
) {
  pass(
    'PIE Missing Evidence service',
    'PIEMissingEvidence exists with required gap types, priority, impact, request, result, prioritization, minimum request, and summary functions.',
    'services/PIEMissingEvidence.ts',
  );
} else {
  fail(
    'PIE Missing Evidence service',
    'PIEMissingEvidence is missing required types, gap kinds, or functions.',
    'Create services/PIEMissingEvidence.ts with missing evidence detection, priority, minimum request, uncertainty reduction, and summary output.',
    'services/PIEMissingEvidence.ts',
  );
}

if (
  hasAll(missingEvidence, [
    'What evidence is missing',
    'Why does it matter',
    'What decision does it affect',
    'smallestEvidenceRequest',
    'nextCaptureAction',
    'Need one current photo',
    'minimumEvidenceNeeded',
  ])
) {
  pass(
    'PIE Missing Evidence behavior',
    'Missing Evidence answers what is missing, why it matters, affected decision, smallest request, and next capture action.',
    'services/PIEMissingEvidence.ts',
  );
} else {
  fail(
    'PIE Missing Evidence behavior',
    'Missing Evidence does not clearly produce minimum evidence requests with decision impact and next capture action.',
    'Ensure the service answers what is missing, why it matters, affected decision, smallest request, and what to capture next.',
    'services/PIEMissingEvidence.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'findMissingEvidence',
    'missingEvidence',
    'highestImpactEvidenceGap',
    'recommendedEvidenceRequests',
    'uncertaintyReductionActions',
    'buildRuntimeMissingEvidenceInput',
  ])
) {
  pass(
    'PIE Core Missing Evidence integration',
    'PIECoreIntelligence detects missing evidence and exposes missingEvidence, highestImpactEvidenceGap, recommendedEvidenceRequests, and uncertaintyReductionActions.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Missing Evidence integration',
    'PIECoreIntelligence does not expose the required missing evidence outputs.',
    'Call findMissingEvidence from Core and expose missingEvidence, highestImpactEvidenceGap, recommendedEvidenceRequests, and uncertaintyReductionActions.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(attentionEngine + experienceEngine, [
    'PIEMissingEvidenceResult',
    'missingEvidence',
    'highestImpactEvidenceGap',
    'minimumEvidenceNeeded',
    'Capture Evidence',
  ])
) {
  pass(
    'Missing Evidence Attention and Experience integration',
    'Attention and Experience can consume Missing Evidence when a gap blocks the next decision or capture step.',
    'services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts',
  );
} else {
  fail(
    'Missing Evidence Attention and Experience integration',
    'Attention or Experience does not clearly consume Missing Evidence.',
    'Pass Missing Evidence into Attention/Experience and request missing evidence when it blocks a decision.',
    'services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts',
  );
}

if (
  fileExists('docs/PIE_MissingEvidenceModel.md') &&
  hasAll(pieMissingEvidenceModel + masterArchitecture + pieCoreIntelligencePlan + productOperatingPlan + jarvisQaDoc, [
    'Missing Evidence',
    'Layer 1',
    'minimum evidence',
    'missing_photo',
    'missing_schedule',
    'missing_owner',
    'missing_decision',
    'highestImpactEvidenceGap',
    'recommendedEvidenceRequests',
  ])
) {
  pass(
    'PIE Missing Evidence documentation',
    'Missing Evidence model, architecture, product plan, and QA docs define Layer 1 gap detection and Core outputs.',
    'docs/PIE_MissingEvidenceModel.md and architecture docs',
  );
} else {
  fail(
    'PIE Missing Evidence documentation',
    'Missing Evidence documentation or architecture placement is incomplete.',
    'Create docs/PIE_MissingEvidenceModel.md and document Missing Evidence under Layer 1 with Core outputs and QA checks.',
    'docs/PIE_MissingEvidenceModel.md',
  );
}

if (
  fileExists('services/PIEEvidenceTimeline.ts') &&
  hasAll(evidenceTimeline, [
    'PIEEvidenceTimeline',
    'PIEEvidenceTimelineEvent',
    'PIEEvidenceTimelineEventType',
    'PIEEvidenceTimelineChange',
    'PIEEvidenceTimelineGap',
    'PIEEvidenceTimelineMomentum',
    'PIEEvidenceTimelineSummary',
    "'photo_added'",
    "'note_added'",
    "'schedule_imported'",
    "'schedule_changed'",
    "'GPS_confirmed'",
    "'user_corrected'",
    "'issue_opened'",
    "'issue_resolved'",
    "'decision_needed'",
    "'decision_made'",
    "'report_generated'",
    "'report_approved'",
    "'inspection_updated'",
    'buildEvidenceTimeline',
    'groupTimelineByProject',
    'groupTimelineByArea',
    'detectTimelineGaps',
    'detectStaleEvidence',
    'detectProgressMomentum',
    'summarizeTimelineChanges',
    'compareTimelinePeriods',
  ])
) {
  pass(
    'PIE Evidence Timeline service',
    'PIEEvidenceTimeline exists with required timeline types, event types, grouping, stale detection, momentum detection, change summary, and period comparison.',
    'services/PIEEvidenceTimeline.ts',
  );
} else {
  fail(
    'PIE Evidence Timeline service',
    'PIEEvidenceTimeline is missing required types, event types, or functions.',
    'Create services/PIEEvidenceTimeline.ts with event timeline, project/area grouping, stale detection, momentum detection, change summary, and period comparison.',
    'services/PIEEvidenceTimeline.ts',
  );
}

if (
  hasAll(evidenceTimeline, [
    'progress_increasing',
    'progress_slowing',
    'no_recent_evidence',
    'repeated_same_issue',
    'area_going_stale',
    'new_activity_after_delay',
    'detectProgressMomentum',
    'detectStaleEvidence',
  ])
) {
  pass(
    'PIE Evidence Timeline momentum',
    'Evidence Timeline detects progress increasing, progress slowing, no recent evidence, repeated issues, stale areas, and new activity after delay.',
    'services/PIEEvidenceTimeline.ts',
  );
} else {
  fail(
    'PIE Evidence Timeline momentum',
    'Evidence Timeline does not detect all required momentum signals.',
    'Add progress increasing/slowing, no recent evidence, repeated same issue, area going stale, and new activity after delay detection.',
    'services/PIEEvidenceTimeline.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildEvidenceTimeline',
    'buildRuntimeEvidenceTimelineEvents',
    'evidenceTimeline',
    'timelineGaps',
    'staleAreas',
    'momentumSignals',
    'recentChanges',
  ])
) {
  pass(
    'PIE Core Evidence Timeline integration',
    'PIECoreIntelligence builds and exposes evidenceTimeline, timelineGaps, staleAreas, momentumSignals, and recentChanges.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Evidence Timeline integration',
    'PIECoreIntelligence does not expose the required timeline outputs.',
    'Build Evidence Timeline from Runtime and expose evidenceTimeline, timelineGaps, staleAreas, momentumSignals, and recentChanges.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(piePatternEngine + pieBeliefEngine, [
    'PIEEvidenceTimeline',
    'evidenceTimeline',
    'momentumSignals',
    'staleAreas',
    'Evidence Timeline',
  ])
) {
  pass(
    'Evidence Timeline reasoning integration',
    'Pattern Engine and Belief Engine consume Evidence Timeline signals where practical.',
    'services/PIEPatternEngine.ts, services/PIEBeliefEngine.ts',
  );
} else {
  fail(
    'Evidence Timeline reasoning integration',
    'Pattern Engine or Belief Engine does not clearly consume Evidence Timeline.',
    'Pass evidenceTimeline into Pattern and Belief reasoning and use momentum/stale signals to influence confidence.',
    'services/PIEPatternEngine.ts, services/PIEBeliefEngine.ts',
  );
}

if (
  fileExists('docs/PIE_EvidenceTimelineModel.md') &&
  hasAll(pieEvidenceTimelineModel + masterArchitecture + pieCoreIntelligencePlan + productOperatingPlan + jarvisQaDoc, [
    'Evidence Timeline',
    'Layer 1',
    'photo_added',
    'schedule_imported',
    'stale',
    'momentum',
    'evidenceTimeline',
    'timelineGaps',
    'staleAreas',
    'momentumSignals',
    'recentChanges',
  ])
) {
  pass(
    'PIE Evidence Timeline documentation',
    'Evidence Timeline model, architecture, product plan, and QA docs define Layer 1 chronology, stale evidence, momentum, and Core outputs.',
    'docs/PIE_EvidenceTimelineModel.md and architecture docs',
  );
} else {
  fail(
    'PIE Evidence Timeline documentation',
    'Evidence Timeline documentation or architecture placement is incomplete.',
    'Create docs/PIE_EvidenceTimelineModel.md and document Evidence Timeline under Layer 1 with Core outputs and QA checks.',
    'docs/PIE_EvidenceTimelineModel.md',
  );
}

if (
  fileExists('services/PIERealityModel.ts') &&
  hasAll(realityModel, [
    'PIERealityModel',
    'PIERealityObject',
    'PIERealityObjectType',
    'PIERealityObjectIdentity',
    'PIERealityObjectState',
    'PIERealityObjectStatus',
    'PIERealityEvidenceLink',
    'PIERealityKnowledgeLink',
    'PIERealityHistoryEvent',
    'PIERealitySyncResult',
    'PIERealityModelSummary',
    'objectRegistry',
    'buildPIERealityModel',
    'createRealityObject',
    'identifyRealityObjects',
    'mergeRealityObjects',
    'updateRealityObjectState',
    'linkEvidenceToRealityObject',
    'linkKnowledgeToRealityObject',
    'appendRealityHistory',
    'synchronizeRealityModel',
    'summarizeRealityModel',
  ])
) {
  pass(
    'PIE Reality Model service',
    'PIERealityModel exists with required model, object registry, object state/status, evidence/knowledge links, history events, sync, and summary functions.',
    'services/PIERealityModel.ts',
  );
} else {
  fail(
    'PIE Reality Model service',
    'PIERealityModel is missing required types, object registry, or core functions.',
    'Create services/PIERealityModel.ts with object registry, evidence links, knowledge links, history, sync, merge, and summary behavior.',
    'services/PIERealityModel.ts',
  );
}

if (
  fileExists('services/PIERealityModelOrchestrator.ts') &&
  hasAll(realityModelOrchestrator, [
    'runPIERealityModelOrchestration',
    'PIERealityPersistenceStatus',
    'classifyEvidenceDeltas',
    'new',
    'changed',
    'unchanged',
    'removed',
    'invalidated',
    'synchronizeAuthoritativeRealityModel',
    'persistence_failed',
    'stale_model',
    'conflict_blocked',
    'deltaToRealityEvidence',
    'expectedMinimumModelVersion',
  ]) &&
  hasAll(pieCoreIntelligence, [
    'export async function buildLivePIECoreIntelligence',
    'runPIERealityModelOrchestration',
    'persistStructuredExecutiveJudgment',
    'buildPIEReportDraftFromExecutiveJudgment',
    'enforceLiveReality',
    'identityTrusted: input.identityTrusted',
    'realityAuthority',
  ]) &&
  fileExists('providers/PIELiveAuthorityProvider.tsx') &&
  hasAll(liveAuthorityProvider, [
    'buildLivePIECoreIntelligence',
    'buildDAVEProjectTruth',
    'projectTruth: DAVEProjectTruth',
    'refreshAuthority',
    'invalidateEvidence',
    'notifyEvidenceChanged',
    'notifyProjectChanged',
    'inFlightRef',
    'sequenceRef',
    'policyForState',
  ]) &&
  hasAll(app, [
    '<PIELiveAuthorityProvider input={liveAuthorityInput}>',
    'authoritySurfaceForMode',
    'const liveAuthority = usePIELiveAuthority();',
    'const projectIntelligence = liveAuthority.projectTruth.intelligence',
  ]) &&
  hasAll(homeDashboard, [
    'usePIELiveAuthority',
    'liveAuthority.projectTruth.briefing.nextActions',
    'const authoritativePriority =',
  ]) &&
  hasAll(reportsScreen, [
    'usePIELiveAuthority',
    'const runtime = liveAuthority.runtime;',
    'selectStableReportDraft({',
    'liveDraft: liveAuthority.reportDraft',
    'fallbackDraft: runtime.response.reportDraft',
    'const baseReportDraft = stableReportDraft.draft',
  ]) &&
  hasAll(daveProjectTruth, [
    'evidence: DAVEEvidenceAccounting',
    'verificationQueue: DAVEVerificationRequest[]',
    'briefing: DAVEPMBriefing',
  ]) &&
  hasAll(piePanel, [
    'useOptionalPIELiveAuthority',
    'liveAuthority?.runtime || fallbackRuntime',
  ])
) {
  pass(
    'Shared Live PIE Authority Provider',
    'Live Core authority is centralized in PIELiveAuthorityProvider and primary app surfaces consume the shared result.',
    'providers/PIELiveAuthorityProvider.tsx, App.tsx, HomeDashboard, Capture, Review, Share, Project Workspace',
  );
} else {
  fail(
    'Shared Live PIE Authority Provider',
    'Primary surfaces do not clearly share one live PIE authority result.',
    'Mount PIELiveAuthorityProvider above primary screens, call buildLivePIECoreIntelligence only there, and route Home/Capture/Review/Share/Project Workspace through usePIELiveAuthority.',
    'providers/PIELiveAuthorityProvider.tsx',
  );
}

if (
  hasAll(executiveJudgment, [
    'PIEExecutiveJudgmentAuthority',
    'requireExecutiveJudgmentAuthority',
    'Executive Judgment requires authoritative Reality Model metadata',
    'realityModelVersion',
    'realitySnapshotId',
    'activeConflictIds',
    'activeUncertaintyIds',
    'persistenceStatus',
  ]) &&
  fileExists('services/PIEExecutiveJudgmentRepository.ts') &&
  hasAll(executiveJudgmentRepository, [
    'PIEExecutiveJudgmentRecord',
    'persistStructuredExecutiveJudgment',
    'immutable: true',
    'supportingRealityObjectIds',
    'supportingAssertionIds',
    'activeConflictIds',
    'activeUncertaintyIds',
    'persistenceStatus',
    'supersededBy',
  ]) &&
  hasAll(executiveJudgmentMigration, [
    'pie_executive_judgments',
    'reality_model_version',
    'reality_snapshot_id',
    'prevent_mutation',
    'enable row level security',
    'pie_layer4_has_permission',
  ])
) {
  pass(
    'Persisted Executive Judgment authority',
    'Layer 3 requires Reality Model metadata and persists immutable structured judgments before Layer 4 decisions.',
    'services/PIEExecutiveJudgment.ts, services/PIEExecutiveJudgmentRepository.ts, supabase/migrations/20260701040000_pie_executive_judgments.sql',
  );
} else {
  fail(
    'Persisted Executive Judgment authority',
    'Layer 3 can still run or feed downstream systems without immutable Reality Model traceability.',
    'Require authority metadata, persist immutable Executive Judgment records, and add the Supabase schema/RLS migration.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  hasAll(pieReporter, [
    'buildPIEReportDraftFromExecutiveJudgment',
    'enforceCommunicationOnly',
    'requirePersistedExecutiveJudgment',
    'Executive recommendation',
  ]) &&
  hasAll(layer4Automation, [
    'buildLayer4DecisionCandidateFromExecutiveJudgment',
    'Layer 4 cannot create live decision candidates from report-only input',
    'high-impact automation is blocked',
    'stale_model',
    'persistence_failed',
    'requirePersistedExecutiveJudgment',
  ]) &&
  hasAll(traceability, [
    'buildPIERecommendationTrace',
    'executiveJudgmentId',
    'realityModelVersion',
    'realitySnapshotId',
    'assertionIds',
    'evidenceIds',
  ])
) {
  pass(
    'Reporter, Layer 4, and traceability alignment',
    'Reporter is communication-only in the live path, Layer 4 creates decisions from persisted judgments, and recommendations are traceable to Reality evidence.',
    'services/PIEReporter.ts, services/PIELayer4Automation.ts, services/PIETraceability.ts',
  );
} else {
  fail(
    'Reporter, Layer 4, and traceability alignment',
    'Reporter or Layer 4 can still bypass persisted Executive Judgment and Reality Model traceability.',
    'Require persisted judgment input for live reports/decisions and expose report-to-evidence traceability.',
    'services/PIEReporter.ts',
  );
}

if (
  hasAll(realityModel, [
    "'project'",
    "'building'",
    "'area'",
    "'work_package'",
    "'schedule_activity'",
    "'milestone'",
    "'inspection'",
    "'contractor'",
    "'issue'",
    "'risk'",
    "'decision'",
    "'document'",
    "'photo'",
    "'safety_observation'",
    "'report'",
    "'owner_action'",
    "'unknown'",
    "'not_started'",
    "'in_progress'",
    "'ready'",
    "'needs_verification'",
    "'blocked'",
    "'at_risk'",
    "'contradicted'",
    "'complete'",
    "'retired'",
  ])
) {
  pass(
    'PIE Reality Model object contract',
    'Reality Model defines required object types and statuses.',
    'services/PIERealityModel.ts',
  );
} else {
  fail(
    'PIE Reality Model object contract',
    'Reality Model is missing required object types or statuses.',
    'Add all requested reality object types and statuses.',
    'services/PIERealityModel.ts',
  );
}

if (
  hasAll(realityModel, [
    'organizationId: string',
    'projectId: string',
    'version: number',
    'status: PIERealityModelStatus',
    'sourceEvidenceCutoffAt',
    'PIERealityAssertion',
    "'fact'",
    "'assumption'",
    "'inference'",
    "'prediction'",
    'PIERealityConflict',
    'PIERealityUncertaintyRecord',
    'stableObjectId',
    'sourceEvidenceReferences',
    'priorState',
    'expectedState',
    'buildRealityAssertion',
    'Reality facts require supporting evidence',
    'Reality predictions require an expected timeframe',
  ])
) {
  pass(
    'Durable Reality Model authority contract',
    'Reality Model now carries organization/project scope, version/status, source cutoff, stable objects, assertions, conflicts, and uncertainties.',
    'services/PIERealityModel.ts',
  );
} else {
  fail(
    'Durable Reality Model authority contract',
    'Reality Model is missing durable authority fields or explicit knowledge/conflict/uncertainty records.',
    'Add organization/project/model version, stable object IDs, assertion classification, first-class conflicts, first-class uncertainties, and evidence cutoffs.',
    'services/PIERealityModel.ts',
  );
}

if (
  fileExists('services/PIERealityModelStorage.ts') &&
  fileExists('services/PIERealityModelRepository.ts') &&
  hasAll(realityModelStorage + realityModelRepository, [
    'loadCurrentRealityModel',
    'saveSynchronizedRealityModel',
    'appendRealityObjectHistory',
    'getRealityObjectHistory',
    'getRealityModelSnapshots',
    'getRealityConflicts',
    'getRealityUncertainties',
    'queryRealityObjects',
    'organizationId',
    'projectId',
    'PIE_REALITY_MODEL_STORAGE_VERSION',
    'localPIERealityModelRepository',
  ])
) {
  pass(
    'Reality Model durable local repository',
    'Reality Model storage is organization/project-scoped with snapshots, history, conflict, uncertainty, and query access.',
    'services/PIERealityModelStorage.ts, services/PIERealityModelRepository.ts',
  );
} else {
  fail(
    'Reality Model durable local repository',
    'Reality Model repository/storage is missing or not organization/project scoped.',
    'Add scoped Reality Model storage and repository functions for current model, snapshots, history, conflicts, uncertainties, and object queries.',
    'services/PIERealityModelStorage.ts',
  );
}

if (
  fileExists('services/PIERealityModelSynchronization.ts') &&
  hasAll(realityModelSynchronization, [
    'synchronizeAuthoritativeRealityModel',
    'PIEQualifiedRealityEvidence',
    'evidenceQualified: true',
    'identityConfidence',
    'detectAmbiguousIdentityConflicts',
    'buildQualifiedRealityEvidence',
    'identity_mismatch',
    'saveSynchronized',
  ])
) {
  pass(
    'Evidence-to-Reality synchronization',
    'Synchronization accepts qualified evidence, loads the current model, preserves ambiguous identity conflicts, and saves changed authoritative models.',
    'services/PIERealityModelSynchronization.ts',
  );
} else {
  fail(
    'Evidence-to-Reality synchronization',
    'Reality synchronization is missing or accepts raw UI state without identity/conflict handling.',
    'Create a synchronization service that consumes qualified Layer 1 evidence and updates the repository-backed Reality Model.',
    'services/PIERealityModelSynchronization.ts',
  );
}

if (
  fileExists('supabase/migrations/20260701030000_pie_reality_model.sql') &&
  hasAll(realityModelMigration, [
    'create table if not exists public.pie_reality_models',
    'create table if not exists public.pie_reality_objects',
    'create table if not exists public.pie_reality_assertions',
    'create table if not exists public.pie_reality_relationships',
    'create table if not exists public.pie_reality_object_history',
    'create table if not exists public.pie_reality_model_snapshots',
    'create table if not exists public.pie_reality_conflicts',
    'create table if not exists public.pie_reality_uncertainties',
    'organization_id text not null',
    'project_id text not null',
    'unique (organization_id, project_id, model_version)',
    'pie_reality_prevent_history_mutation',
    'enable row level security',
    'pie_layer4_has_permission',
  ]) &&
  !hasAny(realityModelMigration, ['using (true)', 'with check (true)'])
) {
  pass(
    'Reality Model database schema',
    'Supabase migration defines organization/project-scoped Reality Model tables, snapshots, append-only history, indexes, and membership-backed RLS.',
    'supabase/migrations/20260701030000_pie_reality_model.sql',
  );
} else {
  fail(
    'Reality Model database schema',
    'Reality Model database persistence is missing tables, append-only controls, scoped keys, or secure RLS.',
    'Add normalized Reality Model tables with org/project IDs, stable object IDs, snapshots, conflicts, uncertainties, indexes, append-only history, and non-permissive RLS.',
    'supabase/migrations/20260701030000_pie_reality_model.sql',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'authoritativeRealityModel',
    'buildQualifiedRealityEvidence',
    'realityModelSynchronization',
    'previousModel: input.authoritativeRealityModel',
  ]) &&
  hasAll(realityModelGuards, [
    'requireRealityModel',
    'requireRealityOrExecutiveJudgment',
    'DEPRECATED_RAW_EVIDENCE_REPORTER_PATH',
    'DEPRECATED_REPORT_TO_LAYER4_PATH',
  ])
) {
  pass(
    'Reality-first downstream guardrails',
    'Core can use a prior authoritative model and guard helpers mark Reality/Executive Judgment as the intended downstream input boundary.',
    'services/PIECoreIntelligence.ts, services/PIERealityModelGuards.ts',
  );
} else {
  fail(
    'Reality-first downstream guardrails',
    'Core or downstream guardrails still allow new intelligence code to bypass Reality Model authority.',
    'Add authoritativeRealityModel input, synchronization status output, and guard helpers requiring Reality Model or Executive Judgment for downstream intelligence.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(realityModel, [
    'totalObjects',
    'recentlyUpdatedObjects',
    'objectsReady',
    'objectsBlocked',
    'objectsAtRisk',
    'objectsNeedingVerification',
    'strongestCurrentRealityStatement',
    'weakestCurrentRealityAssumption',
    'recommendedEvidenceToImproveModel',
    'confidence',
  ])
) {
  pass(
    'PIE Reality Model summary contract',
    'Reality Model summary exposes consolidated Layer 2 current-state fields.',
    'services/PIERealityModel.ts',
  );
} else {
  fail(
    'PIE Reality Model summary contract',
    'Reality Model summary is missing one or more consolidated Layer 2 current-state fields.',
    'Expose total objects, recent objects, readiness/blocking/risk buckets, strongest statement, weakest assumption, recommended evidence, and confidence.',
    'services/PIERealityModel.ts',
  );
}

if (
  hasAll(realityModel, [
    'PIERealityGoal',
    'PIERealityRelationship',
    'PIERealityDependency',
    'PIERealityConfidence',
    'PIERealityReadiness',
    'PIERealityRiskLevel',
    'PIERealityMomentum',
    'PIERealityNextAction',
    'PIERealityUncertainty',
    'PIERealityObjectIntelligenceResult',
    'goalsSupported',
    'relationships',
    'dependencies',
    'confidence',
    'readiness',
    'riskLevel',
    'momentum',
    'nextBestAction',
    'uncertainty',
    'ownerNeeded',
    'buildRealityObjectIntelligence',
    'identifyObjectGoals',
    'identifyObjectRelationships',
    'identifyObjectDependencies',
    'calculateObjectConfidence',
    'calculateObjectReadiness',
    'calculateObjectRiskLevel',
    'calculateObjectMomentum',
    'buildObjectNextBestAction',
    'summarizeObjectIntelligence',
  ])
) {
  pass(
    'PIE Reality Object Intelligence',
    'Reality Objects expose goals, relationships, dependencies, confidence, readiness, risk, momentum, next best action, uncertainty, owner-needed state, and intelligence functions.',
    'services/PIERealityModel.ts',
  );
} else {
  fail(
    'PIE Reality Object Intelligence',
    'Reality Objects are missing required intelligence fields or functions.',
    'Add object intelligence fields and functions for goals, relationships, dependencies, confidence, readiness, risk, momentum, next action, uncertainty, and owner-needed state.',
    'services/PIERealityModel.ts',
  );
}

if (
  hasAll(realityModel, [
    "'belongs_to'",
    "'supports'",
    "'blocks'",
    "'depends_on'",
    "'confirms'",
    "'contradicts'",
    "'affects'",
    "'assigned_to'",
    "'scheduled_before'",
    "'scheduled_after'",
    "'evidence_for'",
    "'risk_to'",
    "'decision_for'",
    "'inspection_for'",
    "'report_references'",
    "'Ready'",
    "'Needs Verification'",
    "'Uncertain'",
    "'Blocked'",
  ])
) {
  pass(
    'PIE Reality Object relationships and readiness',
    'Reality Model defines required relationship types and readiness language.',
    'services/PIERealityModel.ts',
  );
} else {
  fail(
    'PIE Reality Object relationships and readiness',
    'Reality Model is missing relationship types or readiness language.',
    'Add required relationship types and Ready / Needs Verification / Uncertain / Blocked readiness.',
    'services/PIERealityModel.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIERealityModel',
    'buildRuntimeRealitySourceObjects',
    'realityModel',
    'realityModelSummary',
    'realityObjects',
    'realitySummary',
    'objectsNeedingVerification',
    'objectsAtRisk',
    'objectsBlocked',
    'objectsRecentlyUpdated',
    'objectIntelligence',
    'objectsReady',
    'objectsUncertain',
    'objectsWithHighRisk',
    'objectNextActions',
    'objectNextBestActions',
    'objectRelationshipSummary',
    'currentSituation',
    'situationState',
    'situationIntent',
    'situationSummary',
    'predictiveReality',
    'futureObjectStates',
    'readinessForecasts',
    'cascadingRealityEffects',
    'noActionOutcomes',
    'recoveryPaths',
  ])
) {
  pass(
    'PIE Core Reality Model integration',
    'PIECoreIntelligence builds Reality Model after Layer 1 perception and exposes consolidated Reality, Situation, and Predictive Reality outputs.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Reality Model integration',
    'PIECoreIntelligence does not expose the required Reality Model outputs.',
    'Build Reality Model after Layer 1 perception and expose realityModel, realityObjects, realitySummary, objectsNeedingVerification, objectsAtRisk, objectsBlocked, and objectsRecentlyUpdated.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(
    pieBeliefEngine +
      piePatternEngine +
      piePredictiveEngine +
      pieExecutiveReasoning +
      pieReporter +
      attentionEngine +
      experienceEngine,
    [
      'PIERealityModel',
      'realityModel',
      'PIERealityObjectIntelligenceResult',
      'objectIntelligence',
    ],
  )
) {
  pass(
    'Reality Model downstream hooks',
    'Belief, Pattern, Prediction, Executive Reasoning, Reporter, Attention, and Experience can consume realityModel where practical.',
    'services/PIE*.ts',
  );
} else {
  fail(
    'Reality Model downstream hooks',
    'One or more downstream engines cannot consume realityModel.',
    'Add optional realityModel inputs to Belief, Pattern, Prediction, Executive Reasoning, Reporter, Attention, and Experience.',
    'services/PIE*.ts',
  );
}

if (
  hasAll(
    pieBeliefEngine +
      piePatternEngine +
      piePredictiveEngine +
      pieExecutiveReasoning +
      pieReporter +
      attentionEngine +
      experienceEngine,
    [
      'PIESituationResult',
      'PIEPredictiveRealityResult',
    ],
  )
) {
  pass(
    'Layer 2 downstream consolidation hooks',
    'Downstream engines can consume Situation Intelligence and Predictive Reality alongside the Reality Model.',
    'services/PIE*.ts',
  );
} else {
  fail(
    'Layer 2 downstream consolidation hooks',
    'One or more downstream engines cannot consume consolidated Layer 2 Situation or Predictive Reality outputs.',
    'Wire Situation Intelligence and Predictive Reality into downstream engines where practical.',
    'services/PIE*.ts',
  );
}

if (
  fileExists('docs/PIE_RealityModel.md') &&
  hasAll(pieRealityModel + masterArchitecture + pieCoreIntelligencePlan + pieCognitiveArchitecture + productOperatingPlan + jarvisQaDoc, [
    'Layer 2',
    'Reality Modeling',
    'Reality Model',
    'single current representation of project reality',
    'Evidence updates the Reality Model',
    'Judgment',
    'prediction',
    'reporting',
    'attention',
    'experience',
    'realityModel',
    'objectsNeedingVerification',
    'goalsSupported',
    'relationships',
    'dependencies',
    'nextBestAction',
    'objectIntelligence',
    'contradicted',
    'realityModelSummary',
    'strongestCurrentRealityStatement',
    'weakestCurrentRealityAssumption',
    'recommendedEvidenceToImproveModel',
    'Reporter, Attention, Experience, Prediction, and Executive Reasoning should not rebuild raw context when the Reality Model is available',
  ])
) {
  pass(
    'PIE Reality Model documentation',
    'Reality Model docs and architecture define Layer 2, object registry, evidence sync, Core outputs, and downstream ownership.',
    'docs/PIE_RealityModel.md and architecture docs',
  );
} else {
  fail(
    'PIE Reality Model documentation',
    'Reality Model documentation or architecture placement is incomplete.',
    'Create docs/PIE_RealityModel.md and update architecture docs with Layer 2 = Reality Modeling and Core outputs.',
    'docs/PIE_RealityModel.md',
  );
}

if (
  hasAll(pieRealityModel + masterArchitecture + pieCoreIntelligencePlan + pieCognitiveArchitecture + jarvisQaDoc, [
    'current project reality',
    'what changed recently',
    'which objects matter',
    'what is ready',
    'what is blocked',
    'what is uncertain',
    'supports the current goal',
    'likely to happen next',
    'what evidence would improve the model',
  ])
) {
  pass(
    'Layer 2 answerability contract',
    'Docs define the questions Layer 2 must answer about current reality, change, readiness, blockage, uncertainty, goals, forecast, and missing evidence.',
    'docs/PIE_RealityModel.md and architecture docs',
  );
} else {
  fail(
    'Layer 2 answerability contract',
    'Layer 2 docs do not clearly define the required Reality Modeling answer set.',
    'Document the Layer 2 questions for current reality, recent change, important objects, readiness, blockage, uncertainty, goal support, forecast, and evidence improvement.',
    'docs/PIE_RealityModel.md',
  );
}

if (
  fileExists('services/PIESituationIntelligence.ts') &&
  hasAll(situationIntelligence, [
    'PIESituation',
    'PIESituationState',
    'PIESituationIntent',
    'PIESituationChange',
    'PIESituationRisk',
    'PIESituationOpportunity',
    'PIESituationUnknown',
    'PIESituationPriority',
    'PIESituationBlocker',
    'PIESituationReadiness',
    'PIESituationSummary',
    'PIESituationResult',
    'buildPIESituation',
    'recognizeSituationIntent',
    'detectSituationChanges',
    'identifySituationRisks',
    'identifySituationOpportunities',
    'identifySituationUnknowns',
    'identifySituationBlockers',
    'rankSituationPriorities',
    'determineSituationReadiness',
    'summarizeSituation',
    'explainSituation',
  ])
) {
  pass(
    'PIE Situation Intelligence service',
    'PIESituationIntelligence exists with required situation types and functions.',
    'services/PIESituationIntelligence.ts',
  );
} else {
  fail(
    'PIE Situation Intelligence service',
    'PIESituationIntelligence is missing required types or functions.',
    'Create services/PIESituationIntelligence.ts with current situation, intent, changes, risks, opportunities, unknowns, blockers, priorities, readiness, summary, and explanation functions.',
    'services/PIESituationIntelligence.ts',
  );
}

if (
  hasAll(situationIntelligence, [
    "'stable'",
    "'improving'",
    "'worsening'",
    "'blocked'",
    "'uncertain'",
    "'ready'",
    "'needs_verification'",
    "'at_risk'",
    "'daily_progress_walk'",
    "'inspection_preparation'",
    "'executive_update'",
    "'customer_update'",
    "'contractor_follow_up'",
    "'schedule_risk_review'",
    "'safety_review'",
    "'issue_resolution'",
    "'decision_preparation'",
    "'document_review'",
    "'project_status_review'",
    "'unknown'",
  ])
) {
  pass(
    'PIE Situation states and intent recognition',
    'Situation Intelligence defines required states and intent types.',
    'services/PIESituationIntelligence.ts',
  );
} else {
  fail(
    'PIE Situation states and intent recognition',
    'Situation Intelligence is missing required states or intent types.',
    'Add all requested situation states and intent types.',
    'services/PIESituationIntelligence.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIESituation',
    'situationIntelligence',
    'currentSituation',
    'situationIntent',
    'situationState',
    'situationChanges',
    'situationRisks',
    'situationOpportunities',
    'situationUnknowns',
    'situationBlockers',
    'situationPriorities',
    'situationSummary',
  ])
) {
  pass(
    'PIE Core Situation Intelligence integration',
    'PIECoreIntelligence builds and exposes current situation outputs.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Situation Intelligence integration',
    'PIECoreIntelligence does not expose required situation outputs.',
    'Build Situation Intelligence from Reality Model and expose currentSituation, situationIntent, state, changes, risks, opportunities, unknowns, blockers, priorities, and summary.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(
    piePredictiveEngine +
      pieExecutiveReasoning +
      pieReporter +
      attentionEngine +
      experienceEngine,
    [
      'PIESituationResult',
      'situationIntelligence',
    ],
  ) &&
  hasAll(attentionEngine, ['Situation Intelligence']) &&
  hasAll(experienceEngine, ['situationState']) &&
  hasAll(pieReporter, ['situationReportBullets', 'situationReviewFlags']) &&
  hasAll(piePredictiveEngine, ['situationRisks', 'situationUnknowns']) &&
  hasAll(pieExecutiveReasoning, ['situationPriorities', 'situationRisks'])
) {
  pass(
    'Situation Intelligence downstream hooks',
    'Prediction, Executive Reasoning, Reporter, Attention, and Experience consume situation intelligence where practical.',
    'services/PIE*.ts',
  );
} else {
  fail(
    'Situation Intelligence downstream hooks',
    'One or more downstream engines does not clearly consume Situation Intelligence.',
    'Wire Situation Intelligence into Prediction, Executive Reasoning, Reporter, Attention, and Experience.',
    'services/PIE*.ts',
  );
}

if (
  fileExists('docs/PIE_SituationIntelligenceModel.md') &&
  hasAll(pieSituationIntelligenceModel + masterArchitecture + pieCoreIntelligencePlan + productOperatingPlan + jarvisQaDoc, [
    'Situation Intelligence',
    'Intent Recognition',
    'currentSituation',
    'situationIntent',
    'situationState',
    'situationChanges',
    'situationRisks',
    'situationOpportunities',
    'situationUnknowns',
    'situationBlockers',
    'situationPriorities',
    'situationSummary',
    'Reporter writes from the current situation',
    'Attention prioritizes current situation risks',
    'Experience guides from situation state',
  ])
) {
  pass(
    'PIE Situation Intelligence documentation',
    'Situation Intelligence docs and architecture define current situation, intent, Core outputs, and downstream use.',
    'docs/PIE_SituationIntelligenceModel.md',
  );
} else {
  fail(
    'PIE Situation Intelligence documentation',
    'Situation Intelligence documentation or architecture placement is incomplete.',
    'Create docs/PIE_SituationIntelligenceModel.md and update architecture, Core plan, product plan, and QA docs.',
    'docs/PIE_SituationIntelligenceModel.md',
  );
}

if (
  fileExists('services/PIEPredictiveReality.ts') &&
  hasAll(predictiveReality, [
    'PIEPredictiveReality',
    'PIEFutureObjectState',
    'PIERealityForecast',
    'PIECascadingEffect',
    'PIEReadinessForecast',
    'PIERealityEvolution',
    'PIEPredictiveRealityRisk',
    'PIEPredictiveRealityOpportunity',
    'PIEPredictiveRealityResult',
    'buildPIEPredictiveReality',
    'forecastObjectStates',
    'forecastReadiness',
    'forecastCascadingEffects',
    'forecastRealityEvolution',
    'buildNoActionForecast',
    'buildRecoveryForecast',
    'identifyPredictiveRealityRisks',
    'identifyPredictiveRealityOpportunities',
    'summarizePredictiveReality',
    'explainPredictiveReality',
  ])
) {
  pass(
    'PIE Predictive Reality service',
    'PIEPredictiveReality exists with required forecast types and functions.',
    'services/PIEPredictiveReality.ts',
  );
} else {
  fail(
    'PIE Predictive Reality service',
    'PIEPredictiveReality is missing required forecast types or functions.',
    'Create services/PIEPredictiveReality.ts with future object states, readiness forecasts, cascading effects, no-action and recovery forecasts, risks, opportunities, summary, and explanation.',
    'services/PIEPredictiveReality.ts',
  );
}

if (
  hasAll(predictiveReality, [
    "'most_likely'",
    "'best_case'",
    "'worst_case'",
    "'no_action'",
    "'recovery_action'",
    'PIERealityModel',
    'PIERealityObjectIntelligenceResult',
    'PIESituationResult',
    'PIEEvidenceTimeline',
    'PIEBeliefEngineResult',
    'PIEPatternIntelligence',
    'PIEPredictionResult',
    'PIEMissingEvidenceResult',
  ])
) {
  pass(
    'PIE Predictive Reality inputs and forecast types',
    'Predictive Reality defines all requested forecast types and consumes Reality, Situation, Timeline, Beliefs, Patterns, Prediction, and Missing Evidence.',
    'services/PIEPredictiveReality.ts',
  );
} else {
  fail(
    'PIE Predictive Reality inputs and forecast types',
    'Predictive Reality is missing required forecast types or input integrations.',
    'Add most_likely, best_case, worst_case, no_action, recovery_action and consume Reality Model, Object Intelligence, Situation Intelligence, Evidence Timeline, Beliefs, Patterns, Predictive Engine outputs, and Missing Evidence.',
    'services/PIEPredictiveReality.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIEPredictiveReality',
    'predictiveReality',
    'futureObjectStates',
    'readinessForecasts',
    'cascadingEffects',
    'cascadingRealityEffects',
    'predictiveCascadingEffects',
    'noActionForecast',
    'noActionOutcomes',
    'recoveryForecast',
    'recoveryPaths',
    'predictiveRealitySummary',
  ])
) {
  pass(
    'PIE Core Predictive Reality integration',
    'PIECoreIntelligence builds and exposes predictive reality outputs.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Predictive Reality integration',
    'PIECoreIntelligence does not expose required Predictive Reality outputs.',
    'Build Predictive Reality after Prediction and expose predictiveReality, futureObjectStates, readinessForecasts, cascadingEffects, noActionForecast, recoveryForecast, and predictiveRealitySummary.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(
    pieExecutiveReasoning +
      attentionEngine +
      experienceEngine +
      pieReporter,
    [
      'PIEPredictiveRealityResult',
      'predictiveReality',
    ],
  ) &&
  hasAll(pieExecutiveReasoning, ['Predictive Reality', 'predictiveReality.risks']) &&
  hasAll(attentionEngine, ['Predictive Reality', 'urgentFutureRisk']) &&
  hasAll(experienceEngine, ['predictiveReality?.opportunities', 'predictiveReality?.risks']) &&
  hasAll(pieReporter, ['predictiveRealityReportBullets', 'predictiveRealityReviewFlags'])
) {
  pass(
    'Predictive Reality downstream hooks',
    'Executive Reasoning, Attention, Experience, and Reporter consume Predictive Reality where practical.',
    'services/PIE*.ts',
  );
} else {
  fail(
    'Predictive Reality downstream hooks',
    'One or more downstream engines does not clearly consume Predictive Reality.',
    'Wire Predictive Reality into Executive Reasoning, Attention, Experience, and Reporter.',
    'services/PIE*.ts',
  );
}

if (
  fileExists('docs/PIE_PredictiveRealityModel.md') &&
  hasAll(piePredictiveRealityModel + masterArchitecture + pieCoreIntelligencePlan + productOperatingPlan + jarvisQaDoc, [
    'Predictive Reality',
    'future object states',
    'readiness forecasts',
    'cascading effects',
    'no-action forecasts',
    'recovery forecasts',
    'predictiveReality',
    'futureObjectStates',
    'readinessForecasts',
    'cascadingEffects',
    'cascadingRealityEffects',
    'noActionForecast',
    'noActionOutcomes',
    'recoveryForecast',
    'recoveryPaths',
    'predictiveRealitySummary',
    'Ready',
    'Needs Verification',
    'Uncertain',
    'Blocked',
    'Reporter should mention future impact only when confidence is strong enough',
  ])
) {
  pass(
    'PIE Predictive Reality documentation',
    'Predictive Reality docs and architecture define forecasts, Core outputs, confidence boundary, and downstream use.',
    'docs/PIE_PredictiveRealityModel.md',
  );
} else {
  fail(
    'PIE Predictive Reality documentation',
    'Predictive Reality documentation or architecture placement is incomplete.',
    'Create docs/PIE_PredictiveRealityModel.md and update architecture, Core plan, product plan, and QA docs.',
    'docs/PIE_PredictiveRealityModel.md',
  );
}

if (
  fileExists('services/PIEExecutiveJudgment.ts') &&
  hasAll(executiveJudgment, [
    'PIEExecutiveJudgment',
    'PIEExecutiveJudgmentResult',
    'PIEExecutiveAction',
    'PIEExecutiveActionType',
    'PIEExecutiveDecision',
    'PIEExecutivePriority',
    'PIEExecutiveRisk',
    'PIEExecutiveOpportunity',
    'PIEExecutiveConstraint',
    'PIEExecutiveTradeoff',
    'PIETradeoffAnalysis',
    'PIETradeoffOption',
    'PIETradeoffDimension',
    'PIEEscalationAnalysis',
    'PIEEscalationTrigger',
    'PIEEscalationTarget',
    'PIEOpportunityCost',
    'PIEDecisionTiming',
    'PIENoActionReasoning',
    'PIEWaitForEvidenceReasoning',
    'PIEExecutiveActionSafetyCheck',
    'PIEExecutiveResourceNeed',
    'PIEExecutiveEscalation',
    'PIEExecutiveGovernance',
    'PIEExecutiveReadiness',
    'PIEExecutiveJudgmentExplanation',
    'buildPIEExecutiveJudgment',
    'identifyExecutiveDecisions',
    'rankExecutivePriorities',
    'identifyExecutiveRisks',
    'identifyExecutiveOpportunities',
    'identifyExecutiveConstraints',
    'buildExecutiveActions',
    'scoreExecutiveActions',
    'selectHighestValueAction',
    'analyzeExecutiveTradeoffs',
    'compareExecutiveOptions',
    'calculateOpportunityCost',
    'analyzeEscalationNeed',
    'identifyEscalationTriggers',
    'determineEscalationTarget',
    'evaluateDecisionTiming',
    'evaluateNoActionOption',
    'evaluateWaitForEvidenceOption',
    'explainTradeoffDecision',
    'explainExecutiveJudgment',
    'summarizeExecutiveJudgment',
  ])
) {
  pass(
    'PIE Executive Judgment service',
    'PIEExecutiveJudgment exists with required judgment types and functions.',
    'services/PIEExecutiveJudgment.ts',
  );
} else {
  fail(
    'PIE Executive Judgment service',
    'PIEExecutiveJudgment is missing required judgment types or functions.',
    'Create services/PIEExecutiveJudgment.ts with judgment, action, decision, priority, risk, opportunity, constraint, tradeoff, resource, escalation, governance, readiness, scoring, explanation, and summary contracts.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  hasAll(executiveJudgment, [
    "'speed_vs_quality'",
    "'cost_vs_schedule'",
    "'risk_vs_progress'",
    "'evidence_vs_time'",
    "'safety_vs_productivity'",
    "'communication_vs_noise'",
    "'short_term_vs_long_term'",
    "'escalation_vs_local_resolution'",
    'gains',
    'losses',
    'totalOutcomeScore',
    'uncertaintyReduction',
    'projectGoalProtection',
    'unnecessaryNoiseRisk',
    'leastNoisyOption',
    'preferredOption',
    'bestTotalOutcome',
    'uncertaintyEfficientOption',
  ])
) {
  pass(
    'PIE Executive Judgment tradeoff analysis',
    'Executive Judgment compares options across required tradeoff dimensions with gains, losses, outcome, uncertainty, and project-goal protection.',
    'services/PIEExecutiveJudgment.ts',
  );
} else {
  fail(
    'PIE Executive Judgment tradeoff analysis',
    'Executive Judgment is missing explicit tradeoff analysis.',
    'Add PIETradeoffAnalysis, PIETradeoffOption, PIETradeoffDimension, analyzeExecutiveTradeoffs, compareExecutiveOptions, and explainTradeoffDecision.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  hasAll(executiveJudgment, [
    'PIEEscalationAnalysis',
    'PIEEscalationTrigger',
    'PIEEscalationTarget',
    'shouldEscalate',
    'evidenceRequiredBeforeEscalation',
    'evidenceStrongEnough',
    'localResolutionFirst',
    'decision is blocked',
    'owner is missing',
    'safety risk is present',
    'schedule impact is meaningful',
    'repeated issue is not resolving',
    'lower-level action has failed',
    'timing requires leadership action',
    'evidence is strong enough to justify escalation',
    'Escalation should wait until DAVE verifies the evidence',
  ])
) {
  pass(
    'PIE Executive Judgment escalation analysis',
    'Executive Judgment recommends escalation only with supported triggers and evidence boundaries.',
    'services/PIEExecutiveJudgment.ts',
  );
} else {
  fail(
    'PIE Executive Judgment escalation analysis',
    'Executive Judgment is missing escalation trigger, target, timing, or evidence-boundary logic.',
    'Add analyzeEscalationNeed, identifyEscalationTriggers, determineEscalationTarget, and weak-evidence escalation guardrails.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  hasAll(executiveJudgment, [
    'PIEOpportunityCost',
    'PIEDecisionTiming',
    'PIENoActionReasoning',
    'PIEWaitForEvidenceReasoning',
    'calculateOpportunityCost',
    'evaluateDecisionTiming',
    'evaluateNoActionOption',
    'evaluateWaitForEvidenceOption',
    'costOfActingNow',
    'costOfWaiting',
    'costOfEscalating',
    'costOfNoAction',
    "'wait_for_evidence'",
    'smallestEvidenceRequest',
    'whenWaitingIsBetter',
    'unnecessaryActionRisks',
    'Issue is already resolving',
    'Risk is low and monitoring is enough',
    'Action should wait until inspection result',
    'User needs one more piece of evidence first',
    'Action is not reversible',
    'Likely impact is low',
    'No action is valid',
  ])
) {
  pass(
    'PIE Executive Judgment timing and no-action reasoning',
    'Executive Judgment models opportunity cost, decision timing, no-action, and wait-for-evidence reasoning.',
    'services/PIEExecutiveJudgment.ts',
  );
} else {
  fail(
    'PIE Executive Judgment timing and no-action reasoning',
    'Executive Judgment is missing opportunity cost, decision timing, no-action, or wait-for-evidence reasoning.',
    'Add opportunity cost and timing outputs, and treat no_action/wait_for_evidence as valid executive judgments.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  hasAll(executiveJudgment, [
    "'verify'",
    "'capture_evidence'",
    "'escalate'",
    "'wait'",
    "'communicate'",
    "'assign_owner'",
    "'approve'",
    "'reject'",
    "'monitor'",
    "'recover_schedule'",
    "'resolve_blocker'",
    "'inspect'",
    "'defer'",
    "'no_action'",
    "'Ready'",
    "'Needs Verification'",
    "'Uncertain'",
    "'Blocked'",
  ])
) {
  pass(
    'PIE Executive Judgment action/readiness contract',
    'Executive Judgment defines all requested action types, including no_action, and readiness language.',
    'services/PIEExecutiveJudgment.ts',
  );
} else {
  fail(
    'PIE Executive Judgment action/readiness contract',
    'Executive Judgment is missing required action types or readiness values.',
    'Add all requested executive action types and Ready / Needs Verification / Uncertain / Blocked readiness.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  hasAll(executiveJudgment, [
    'valueCreated',
    'riskReduced',
    'uncertaintyReduced',
    'scheduleImpact',
    'safetyImpact',
    'qualityImpact',
    'communicationImpact',
    'effortRequired',
    'urgency',
    'reversibility',
    'confidenceReadiness',
    'downstreamEffect',
    'readinessReason',
    'recommendation',
    'supportingEvidence',
    'assumptions',
    'uncertainty',
    'alternativesConsidered',
    'whyAlternativesLost',
    'tradeoffs',
    'expectedOutcome',
    'successMeasure',
    'whatWouldChangeRecommendation',
  ])
) {
  pass(
    'PIE Executive Judgment scoring and governance',
    'Executive Judgment scores actions across value/risk/uncertainty/impact/effort/urgency/reversibility/readiness/downstream effect and includes decision governance.',
    'services/PIEExecutiveJudgment.ts',
  );
} else {
  fail(
    'PIE Executive Judgment scoring and governance',
    'Executive Judgment is missing required scoring or governance fields.',
    'Add decision scoring and governance fields for every major recommendation.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  hasAll(executiveJudgment, [
    'PIERealityModel',
    'PIERealityObjectIntelligenceResult',
    'PIESituationResult',
    'PIEPredictiveRealityResult',
    'PIEEvidenceQualityResult',
    'PIEMissingEvidenceResult',
    'PIEBeliefEngineResult',
    'PIEPatternIntelligence',
    'PIEEvidenceTimeline',
  ])
) {
  pass(
    'PIE Executive Judgment input integration',
    'Executive Judgment consumes Reality Model, Object Intelligence, Situation, Predictive Reality, Evidence Quality, Missing Evidence, Beliefs, Patterns, and Timeline.',
    'services/PIEExecutiveJudgment.ts',
  );
} else {
  fail(
    'PIE Executive Judgment input integration',
    'Executive Judgment is missing required input integrations.',
    'Wire Executive Judgment to Reality Model, Object Intelligence, Situation Intelligence, Predictive Reality, Evidence Quality, Missing Evidence, Beliefs, Patterns, and Evidence Timeline.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIEExecutiveJudgment',
    'executiveJudgment',
    'executiveJudgmentResult',
    'executiveJudgmentExplanation',
    'actionSafetyCheck',
    'executiveJudgmentHighestValueAction',
    'executiveDecisions',
    'executiveJudgmentPriorities',
    'executiveRisks',
    'executiveOpportunities',
    'executiveConstraints',
    'tradeoffAnalysis',
    'escalationAnalysis',
    'opportunityCost',
    'decisionTiming',
    'noActionReasoning',
    'waitForEvidenceReasoning',
    'executiveJudgmentReadiness',
    'executiveJudgmentSummary',
    'bestNextStep',
    'whatCanWait',
    'whatNotToDo',
    'decisionNeeded',
    'escalationRecommendation',
    'recommendationWhy',
    'recommendationAlternatives',
    'recommendationSuccessMeasure',
  ])
) {
  pass(
    'PIE Core Executive Judgment integration',
    'PIECoreIntelligence builds and exposes Executive Judgment outputs.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Executive Judgment integration',
    'PIECoreIntelligence does not expose required Executive Judgment outputs.',
    'Build Executive Judgment from Layer 2 and expose judgment, highest-value action, decisions, priorities, risks, opportunities, constraints, readiness, and summary.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(executiveJudgment, [
    'performExecutiveActionSafetyCheck',
    'recommendationIsEvidenceBacked',
    'alignsWithCurrentSituation',
    'doesNotContradictRealityModel',
    'doesNotOverstatePrediction',
    'escalationIsJustified',
    'noActionWasConsidered',
    'missingEvidenceWasConsidered',
    'reportWordingWillNotOverclaim',
    'finalRecommendationSafe',
  ])
) {
  pass(
    'PIE Executive Judgment action safety check',
    'Executive Judgment verifies evidence support, situation alignment, Reality Model consistency, prediction boundary, escalation, no-action, missing evidence, and report wording before downstream use.',
    'services/PIEExecutiveJudgment.ts',
  );
} else {
  fail(
    'PIE Executive Judgment action safety check',
    'Executive Judgment is missing the final action safety check.',
    'Add performExecutiveActionSafetyCheck with evidence, situation, Reality Model, prediction, escalation, no-action, missing evidence, and report wording checks.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  hasAll(executiveJudgment, [
    'Highest-value action:',
    'Decision needed:',
    'Top risk:',
    'Top opportunity:',
    'Best next step:',
    'Can wait:',
    'Do not do:',
    'Readiness:',
    'Why:',
  ])
) {
  pass(
    'PIE Executive Judgment summary contract',
    'summarizeExecutiveJudgment includes action, decision, risk, opportunity, next step, wait, not-to-do, escalation, readiness, and why.',
    'services/PIEExecutiveJudgment.ts',
  );
} else {
  fail(
    'PIE Executive Judgment summary contract',
    'summarizeExecutiveJudgment does not include the full Layer 3 executive summary fields.',
    'Expand summarizeExecutiveJudgment to include highest-value action, decision, top risk, opportunity, next step, wait, not-to-do, escalation, readiness, and why.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'bestNextStep',
    'whatCanWait',
    'whatNotToDo',
    'decisionNeeded',
    'escalationRecommendation',
    'recommendationWhy',
    'recommendationAlternatives',
    'recommendationSuccessMeasure',
  ])
) {
  pass(
    'PIE Core final Executive Judgment output',
    'Core exposes the consolidated plain-language Executive Judgment recommendation surface.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core final Executive Judgment output',
    'Core does not expose the final Layer 3 recommendation fields.',
    'Expose bestNextStep, whatCanWait, whatNotToDo, decisionNeeded, escalationRecommendation, recommendationWhy, recommendationAlternatives, and recommendationSuccessMeasure.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(attentionEngine, ['bestNextStep', 'executiveBestNextStep']) &&
  hasAll(experienceEngine, ['bestNextStep']) &&
  hasAll(pieReporter, ['recommendationWhy', 'decisionNeeded', 'recommendationSuccessMeasure']) &&
  !pieReporter.includes('score.total')
) {
  pass(
    'PIE Executive Judgment downstream plain-language alignment',
    'Attention and Experience use bestNextStep; Reporter uses recommendation why, decision, and success language without exposing scoring totals.',
    'services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts, services/PIEReporter.ts',
  );
} else {
  fail(
    'PIE Executive Judgment downstream plain-language alignment',
    'Downstream Layer 3 consumers are not aligned to the final plain-language output or may expose scoring data.',
    'Wire Attention/Experience to bestNextStep and Reporter to recommendationWhy/decisionNeeded/successMeasure without scoring details.',
    'services/PIE*.ts',
  );
}

if (
  hasAll(pieCoreIntelligence + executiveJudgment, [
    'executiveJudgmentExplanation',
    'whatMattersMost',
    'decisionNeeded',
    'greatestValue',
    'uncertaintyReduction',
    'riskReduction',
    'whatCanWait',
    'whatShouldEscalate',
    'whatShouldNotEscalate',
    'incompleteEvidenceAction',
    'noActionRationale',
    'whatWouldChangeRecommendation',
    'successMeasure',
  ])
) {
  pass(
    'PIE Executive Judgment question answers',
    'Core exposes the Executive Judgment explanation that answers the required Layer 3 judgment questions.',
    'services/PIECoreIntelligence.ts, services/PIEExecutiveJudgment.ts',
  );
} else {
  fail(
    'PIE Executive Judgment question answers',
    'Executive Judgment does not expose the full answer set for the required judgment questions.',
    'Expose executiveJudgmentExplanation with what matters most, decision needed, value, uncertainty, risk, wait, escalation, incomplete evidence, and no-action rationale.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(attentionEngine, ['PIEExecutiveJudgmentResult', 'executiveJudgmentAction']) &&
  hasAll(attentionEngine, ['escalationIsUnsupported', 'waitForEvidence', 'decisionTiming']) &&
  hasAll(experienceEngine, ['PIEExecutiveJudgmentResult', 'waitForEvidenceReasoning.shouldWaitForEvidence', 'smallestEvidenceRequest']) &&
  hasAll(pieReporter, ['PIEExecutiveJudgmentResult', 'executiveJudgmentReportBullets', 'executiveJudgmentReviewFlags', 'escalationAnalysis?.shouldEscalate', 'waitForEvidenceReasoning'])
) {
  pass(
    'PIE Executive Judgment downstream hooks',
    'Attention, Experience, and Reporter consume Executive Judgment, decision timing, and escalation/wait boundaries where practical.',
    'services/PIE*.ts',
  );
} else {
  fail(
    'PIE Executive Judgment downstream hooks',
    'Attention, Experience, or Reporter does not clearly consume Executive Judgment.',
    'Wire Executive Judgment into Attention, Experience, and Reporter.',
    'services/PIE*.ts',
  );
}

if (
  hasAll(pieReporter, [
    'monitoringIsBest',
    "action?.type === 'monitor'",
    "action?.type === 'no_action'",
    "decisionTiming?.recommendation === 'monitor'",
    'Monitoring avoids unnecessary noise',
  ])
) {
  pass(
    'PIE Reporter monitoring boundary',
    'Reporter avoids fake action items when Executive Judgment recommends monitoring or no_action.',
    'services/PIEReporter.ts',
  );
} else {
  fail(
    'PIE Reporter monitoring boundary',
    'Reporter may still turn monitoring or no_action into action-item-like report bullets.',
    'Suppress fake action items when Executive Judgment recommends monitoring/no_action; summarize timing and monitoring only.',
    'services/PIEReporter.ts',
  );
}

if (
  fileExists('docs/PIE_ExecutiveJudgmentModel.md') &&
  hasAll(pieExecutiveJudgmentModel + masterArchitecture + pieCoreIntelligencePlan + pieCognitiveArchitecture + pieCognitiveConstitution + jarvisQaDoc, [
    'Executive Judgment',
    'Layer 3',
    'highest-value executive action',
    'executiveJudgmentExplanation',
    'actionSafetyCheck',
    'bestNextStep',
    'whatNotToDo',
    'recommendationWhy',
    'recommendationSuccessMeasure',
    'Tradeoff Intelligence',
    'Escalation Intelligence',
    'No-Action Reasoning',
    'Wait-for-Evidence Reasoning',
    'Opportunity Cost',
    'Decision Timing',
    'Decision Governance',
    'no_action',
    'unnecessary noise',
    'evidence is strong enough to justify escalation',
    'action is not reversible',
    'likely impact is low',
    'value created',
    'risk reduced',
    'uncertainty reduced',
    'schedule impact',
    'safety impact',
    'quality impact',
    'communication impact',
    'what would change the recommendation',
    'Reporter should use Executive Judgment',
    'Tradeoff and Escalation Intelligence',
    'speed_vs_quality',
    'cost_vs_schedule',
    'risk_vs_progress',
    'evidence_vs_time',
    'safety_vs_productivity',
    'communication_vs_noise',
    'short_term_vs_long_term',
    'escalation_vs_local_resolution',
    'wait_for_evidence',
    'opportunityCost',
    'decisionTiming',
    'noActionReasoning',
    'waitForEvidenceReasoning',
    'avoids unjustified escalation',
  ])
) {
  pass(
    'PIE Executive Judgment documentation',
    'Executive Judgment docs and architecture define Layer 3, scoring, governance, no-action, Core outputs, and downstream use.',
    'docs/PIE_ExecutiveJudgmentModel.md',
  );
} else {
  fail(
    'PIE Executive Judgment documentation',
    'Executive Judgment documentation or architecture placement is incomplete.',
    'Create docs/PIE_ExecutiveJudgmentModel.md and update architecture, Core plan, cognitive docs, constitution, and QA docs.',
    'docs/PIE_ExecutiveJudgmentModel.md',
  );
}

if (
  fileExists('services/PIEAdaptiveIntelligence.ts') &&
  hasAll(adaptiveIntelligence, [
    'PIEAdaptiveIntelligence',
    'PIEAdaptiveResult',
    'PIEOutcomeIntelligence',
    'PIECalibrationIntelligence',
    'PIELearningIntelligence',
    'PIEStrategyIntelligence',
    'PIECommunicationIntelligence',
    'PIETrustIntelligence',
    'PIEEvolutionIntelligence',
    'PIEAdaptivePolicy',
    'PIEConstitutionalPrinciple',
    'PIEAdaptiveLesson',
    'PIEAdaptiveAdjustment',
    'buildPIEAdaptiveIntelligence',
    'evaluateDecisionOutcome',
    'evaluateRecommendationOutcome',
    'calibrateConfidenceFromOutcome',
    'extractAdaptiveLessons',
    'updateAdaptivePolicies',
    'evaluateCommunicationEffectiveness',
    'evaluatePIETrustInSituation',
    'recommendStrategyAdjustment',
    'protectConstitutionalPrinciples',
    'summarizeAdaptiveIntelligence',
  ])
) {
  pass(
    'PIE Adaptive Intelligence service',
    'PIEAdaptiveIntelligence exists with required Layer 4 types and functions.',
    'services/PIEAdaptiveIntelligence.ts',
  );
} else {
  fail(
    'PIE Adaptive Intelligence service',
    'PIEAdaptiveIntelligence is missing required Layer 4 types or functions.',
    'Create services/PIEAdaptiveIntelligence.ts with adaptive intelligence, outcome, calibration, learning, strategy, communication, trust, evolution, policy, principle, lesson, and adjustment contracts.',
    'services/PIEAdaptiveIntelligence.ts',
  );
}

if (
  hasAll(adaptiveIntelligence, [
    'recommendationCorrectness',
    'realityAlignment',
    'userResponse',
    'projectOutcomeEffect',
    'confirmed',
    'contradicted',
    'accepted',
    'rejected',
    'modified',
    'changed_after_judgment',
    'wasConfidenceTooHigh',
    'wasConfidenceTooLow',
    'raise',
    'lower',
    'hold',
  ])
) {
  pass(
    'PIE Adaptive outcome and calibration intelligence',
    'Adaptive Intelligence evaluates outcome correctness, reality alignment, user response, project effect, and confidence calibration.',
    'services/PIEAdaptiveIntelligence.ts',
  );
} else {
  fail(
    'PIE Adaptive outcome and calibration intelligence',
    'Adaptive Intelligence is missing outcome or confidence calibration behavior.',
    'Add outcome intelligence and calibrateConfidenceFromOutcome checks for confirmed/contradicted outcomes and too-high/too-low confidence.',
    'services/PIEAdaptiveIntelligence.ts',
  );
}

if (
  hasAll(adaptiveIntelligence, [
    'preferred_report_style',
    'preferred_evidence_sequence',
    'escalation_threshold',
    'risk_threshold',
    'confidence_calibration',
    'user_communication_style',
    'inspection_readiness_threshold',
    'seek_truth',
    'separate_evidence_from_assumptions',
    'do_not_fabricate',
    'challenge_conclusions',
    'explain_reasoning',
    'identify_uncertainty',
    'prefer_decision_quality_over_appearance',
    'canChange: true',
    'canChange: false',
  ])
) {
  pass(
    'PIE Adaptive constitutional learning',
    'Adaptive Intelligence separates mutable adaptive policies from permanent constitutional principles.',
    'services/PIEAdaptiveIntelligence.ts',
  );
} else {
  fail(
    'PIE Adaptive constitutional learning',
    'Adaptive Intelligence does not clearly separate adaptive policies from constitutional principles.',
    'Add adaptive policies and protected principles with canChange true/false boundaries.',
    'services/PIEAdaptiveIntelligence.ts',
  );
}

if (
  hasAll(adaptiveIntelligence, [
    'learningResult',
    'reflection',
    'memoryRecall',
    'executiveJudgment',
    'predictionResult',
    'reportDraft',
  ]) &&
  hasAll(pieLearningEngine, ['adaptiveIntelligence?: PIEAdaptiveResult']) &&
  hasAll(reflectionEngine, ['adaptiveLessons?: PIEAdaptiveLesson', 'adaptivePolicies?: PIEAdaptivePolicy']) &&
  hasAll(pieMemoryRecall, ['adaptiveIntelligence?: PIEAdaptiveResult'])
) {
  pass(
    'PIE Adaptive learning/reflection/memory integration',
    'Adaptive Intelligence consumes Learning, Reflection, Memory Recall, predictions, reports, and judgment, with optional hooks back into existing learning services.',
    'services/PIEAdaptiveIntelligence.ts, services/PIELearningEngine.ts, services/PIEReflectionEngine.ts, services/PIEMemoryRecall.ts',
  );
} else {
  fail(
    'PIE Adaptive learning/reflection/memory integration',
    'Adaptive Intelligence is not clearly connected to Learning, Reflection, or Memory Recall.',
    'Wire adaptive input to learning signals, reflections, memory recall, report outcomes, prediction outcomes, and judgment outcomes.',
    'services/PIEAdaptiveIntelligence.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIEAdaptiveIntelligence',
    'adaptiveIntelligence',
    'adaptiveResult',
    'outcomeIntelligence',
    'calibrationIntelligence',
    'strategyAdjustments',
    'communicationAdjustments',
    'trustAssessment',
    'adaptiveLessons',
    'adaptivePolicyUpdates',
  ])
) {
  pass(
    'PIE Core Adaptive Intelligence integration',
    'PIECoreIntelligence builds and exposes Adaptive Intelligence outputs.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Adaptive Intelligence integration',
    'PIECoreIntelligence does not expose required Adaptive Intelligence outputs.',
    'Build Adaptive Intelligence and expose adaptiveIntelligence, outcomeIntelligence, calibrationIntelligence, strategyAdjustments, communicationAdjustments, trustAssessment, adaptiveLessons, and adaptivePolicyUpdates.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(executiveJudgment, [
    'PIEAdaptivePolicy',
    'adaptivePolicies',
    'policyAdjustment',
    'escalation_threshold',
    'confidence_calibration',
  ]) &&
  hasAll(pieCoreIntelligence, ['adaptivePolicies: preliminaryAdaptiveResult.adaptivePolicyUpdates'])
) {
  pass(
    'PIE Executive Judgment adaptive policy integration',
    'Executive Judgment consumes adaptive policies where practical for escalation threshold and confidence calibration.',
    'services/PIEExecutiveJudgment.ts, services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Executive Judgment adaptive policy integration',
    'Executive Judgment does not clearly consume adaptive policies.',
    'Pass adaptive policies from Adaptive Intelligence into Executive Judgment and use them for escalation/confidence behavior where practical.',
    'services/PIEExecutiveJudgment.ts',
  );
}

if (
  fileExists('docs/PIE_AdaptiveIntelligenceModel.md') &&
  hasAll(pieAdaptiveIntelligenceModel + masterArchitecture + pieCoreIntelligencePlan + pieCognitiveArchitecture + pieCognitiveConstitution + jarvisQaDoc, [
    'Adaptive Intelligence',
    'Layer 4',
    'outcomeIntelligence',
    'calibrationIntelligence',
    'strategyIntelligence',
    'communicationIntelligence',
    'trustIntelligence',
    'constitutional principles',
    'adaptive policies',
    'preferred report style',
    'escalation threshold',
    'confidence calibration',
    'seek truth',
    'do not fabricate',
    'Executive Judgment consumes adaptive policies',
  ])
) {
  pass(
    'PIE Adaptive Intelligence documentation',
    'Adaptive Intelligence docs and architecture define Layer 4, policy/principle separation, Core outputs, and Executive Judgment integration.',
    'docs/PIE_AdaptiveIntelligenceModel.md',
  );
} else {
  fail(
    'PIE Adaptive Intelligence documentation',
    'Adaptive Intelligence documentation or architecture placement is incomplete.',
    'Create docs/PIE_AdaptiveIntelligenceModel.md and update architecture, core plan, cognitive docs, constitution, and QA docs.',
    'docs/PIE_AdaptiveIntelligenceModel.md',
  );
}

if (
  fileExists('services/PIEDecisionMemory.ts') &&
  hasAll(decisionMemory, [
    'PIEDecisionMemory',
    'PIEDecisionRecord',
    'PIERecommendationRecord',
    'PIEDecisionOutcomeRecord',
    'PIEExecutiveWisdomLesson',
    'PIEWisdomPattern',
    'PIEWhenNotToActReason',
    'PIETrustCalibrationRecord',
    'PIEDecisionMemoryResult',
    'PIEWisdomRecommendation',
    'buildPIEDecisionMemory',
    'recordDecision',
    'recordRecommendation',
    'recordDecisionOutcome',
    'compareDecisionToOutcome',
    'extractWisdomLessons',
    'identifyWhenNotToAct',
    'identifyRepeatedDecisionPatterns',
    'buildWisdomRecommendation',
    'calibrateTrustFromDecisionHistory',
    'summarizeDecisionMemory',
  ])
) {
  pass(
    'PIE Decision Memory service',
    'PIEDecisionMemory exists with required decision memory, outcome, wisdom, when-not-to-act, trust calibration, and recommendation contracts.',
    'services/PIEDecisionMemory.ts',
  );
} else {
  fail(
    'PIE Decision Memory service',
    'PIEDecisionMemory is missing required types or functions.',
    'Create services/PIEDecisionMemory.ts with decision records, recommendation records, outcomes, wisdom lessons, when-not-to-act reasons, trust calibration, and summary functions.',
    'services/PIEDecisionMemory.ts',
  );
}

if (
  hasAll(decisionMemory, [
    'recommendedAction',
    'whyRecommended',
    'evidenceUsed',
    'assumptions',
    'alternativesConsidered',
    'uncertainty',
    'userAction',
    'actualOutcome',
    'recommendationWasCorrect',
    'impact',
    'lessonLearned',
    'futureAdjustment',
  ])
) {
  pass(
    'PIE Decision Memory record contract',
    'Decision Memory records recommendations, reasons, evidence, assumptions, alternatives, uncertainty, user action, outcomes, correctness, impact, lessons, and future adjustment.',
    'services/PIEDecisionMemory.ts',
  );
} else {
  fail(
    'PIE Decision Memory record contract',
    'Decision Memory does not capture the full decision/recommendation/outcome record.',
    'Add fields for recommendation made, why, evidence, assumptions, alternatives, uncertainty, user action, actual outcome, correctness, impact, lesson, and future adjustment.',
    'services/PIEDecisionMemory.ts',
  );
}

if (
  hasAll(decisionMemory, [
    'evidence_too_weak',
    'issue_already_resolving',
    'escalation_creates_noise',
    'waiting_reduces_risk',
    'action_irreversible',
    'decision_impact_low',
    'user_correction_history_suggests_caution',
    'prediction_confidence_low',
    'truth_over_speed',
    'recommendedAlternative',
  ])
) {
  pass(
    'PIE Decision Memory when-not-to-act reasoning',
    'Decision Memory identifies required when-not-to-act reasons and recommended alternatives.',
    'services/PIEDecisionMemory.ts',
  );
} else {
  fail(
    'PIE Decision Memory when-not-to-act reasoning',
    'Decision Memory is missing required when-not-to-act reasons.',
    'Add reasons for weak evidence, resolving issues, escalation noise, waiting reduces risk, irreversible action, low impact, correction caution, low prediction confidence, and truth over speed.',
    'services/PIEDecisionMemory.ts',
  );
}

if (
  hasAll(adaptiveIntelligence, ['decisionMemory', 'wisdomLessons', 'whenNotToActReasons', 'trustCalibrationHistory']) &&
  hasAll(pieLearningEngine, ['decisionMemory?: PIEDecisionMemoryResult']) &&
  hasAll(reflectionEngine, ['wisdomLessons?: PIEExecutiveWisdomLesson', 'whenNotToActReasons?: PIEWhenNotToActReason']) &&
  hasAll(pieMemoryRecall, ['decisionMemory?: PIEDecisionMemoryResult'])
) {
  pass(
    'PIE Decision Memory adaptive integration',
    'Decision Memory feeds Adaptive Intelligence, Learning, Reflection, and Memory Recall contracts.',
    'services/PIEDecisionMemory.ts, services/PIEAdaptiveIntelligence.ts, services/PIELearningEngine.ts, services/PIEReflectionEngine.ts, services/PIEMemoryRecall.ts',
  );
} else {
  fail(
    'PIE Decision Memory adaptive integration',
    'Decision Memory is not clearly connected to Adaptive Intelligence, Learning, Reflection, and Memory Recall.',
    'Wire Decision Memory into adaptive lessons, future caution, confidence calibration, strategy adjustments, memory recall, and reflection contracts.',
    'services/PIE*.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIEDecisionMemory',
    'decisionMemory',
    'decisionMemoryResult',
    'decisionHistory',
    'wisdomLessons',
    'whenNotToActReasons',
    'wisdomRecommendations',
    'trustCalibrationHistory',
  ])
) {
  pass(
    'PIE Core Decision Memory integration',
    'PIECoreIntelligence builds and exposes Decision Memory outputs.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Decision Memory integration',
    'PIECoreIntelligence does not expose required Decision Memory outputs.',
    'Expose decisionMemory, decisionHistory, wisdomLessons, whenNotToActReasons, wisdomRecommendations, and trustCalibrationHistory.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(executiveJudgment, ['PIEDecisionMemoryResult', 'decisionMemory', 'wisdomSaysNoEscalation', 'whenNotToActReasons']) &&
  hasAll(attentionEngine, ['decisionMemory?: PIEDecisionMemoryResult', 'wisdomCaution', 'wisdomRecommendation']) &&
  hasAll(experienceEngine, ['decisionMemory?: PIEDecisionMemoryResult', 'whenNotToActReasons[0].recommendedAlternative']) &&
  hasAll(pieReporter, ['PIEDecisionMemoryResult', 'Decision Memory says wait', 'whenNotToActReasons'])
) {
  pass(
    'PIE Decision Memory downstream integration',
    'Executive Judgment, Attention, Experience, and Reporter respect Decision Memory wisdom outputs.',
    'services/PIEExecutiveJudgment.ts, services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts, services/PIEReporter.ts',
  );
} else {
  fail(
    'PIE Decision Memory downstream integration',
    'Decision Memory wisdom is not clearly consumed downstream.',
    'Wire Executive Judgment to consult Decision Memory before action, make Attention avoid low-value action, make Experience ask for evidence, and make Reporter avoid overstating recommendations when wisdom says wait.',
    'services/PIE*.ts',
  );
}

if (
  fileExists('docs/PIE_DecisionMemoryModel.md') &&
  hasAll(pieDecisionMemoryModel + masterArchitecture + pieCoreIntelligencePlan + pieCognitiveArchitecture + pieCognitiveConstitution + jarvisQaDoc, [
    'Decision Memory',
    'Executive Wisdom',
    'decisionMemory',
    'decisionHistory',
    'wisdomLessons',
    'whenNotToActReasons',
    'wisdomRecommendations',
    'trustCalibrationHistory',
    'evidence too weak',
    'escalation creates unnecessary noise',
    'truth over speed',
    'Executive Judgment consults Decision Memory',
    'Reporter should avoid overstating recommendations when wisdom says wait',
  ])
) {
  pass(
    'PIE Decision Memory documentation',
    'Decision Memory docs and architecture define executive wisdom, when-not-to-act reasoning, Core outputs, and downstream use.',
    'docs/PIE_DecisionMemoryModel.md',
  );
} else {
  fail(
    'PIE Decision Memory documentation',
    'Decision Memory documentation or architecture placement is incomplete.',
    'Create docs/PIE_DecisionMemoryModel.md and update architecture, core plan, cognitive docs, constitution, and QA docs.',
    'docs/PIE_DecisionMemoryModel.md',
  );
}

if (
  fileExists('services/PIELayer4Identity.ts') &&
  hasAll(layer4Identity, [
    'resolvePIELayer4ActorContext',
    'actorForLayer4Permission',
    'hasLayer4Permission',
    'organization_memberships',
    'cloudTrusted',
    'offline_fallback',
    'missing_membership_schema',
    'assertLayer4CloudTrusted',
    'member',
    'project_manager',
    'decision_owner',
    'validation_authority',
    'organization_admin',
  ]) &&
  !hasAny(app, ['local-user', 'local-organization'])
) {
  pass(
    'Layer 4 trusted identity',
    'Layer 4 uses centralized authenticated identity and separates untrusted local fallback from cloud-trusted actors.',
    'services/PIELayer4Identity.ts, App.tsx',
  );
} else {
  fail(
    'Layer 4 trusted identity',
    'Layer 4 identity still risks placeholder users, fake organizations, or decentralized actor construction.',
    'Use PIELayer4Identity for actor creation, remove local-user/local-organization, and fail closed when membership is unavailable.',
    'services/PIELayer4Identity.ts, App.tsx',
  );
}

if (
  fileExists('services/PIEDecisionSimulation.ts') &&
  fileExists('services/PIERecommendationChallenge.ts') &&
  fileExists('services/PIEJarvisReasoningValidation.ts') &&
  fileExists('services/PIEConfidenceDecomposition.ts') &&
  fileExists('services/PIEEvidenceValuePrioritization.ts') &&
  hasAll(decisionSimulation, [
    'buildPIEDecisionSimulation',
    'generateDecisionOptions',
    'simulateDecisionOption',
    'scoreDecisionOption',
    'runDecisionSensitivityAnalysis',
    'buildSimulationInputSignature',
    'detectMaterialSimulationChange',
    'recommended_action',
    'credible_alternative',
    'no_action',
    'delay_and_gather_evidence',
    'escalation',
    'expected_case',
    'best_reasonable_case',
    'worst_reasonable_case',
    'evidence_deficient_case',
    'execution_failure_case',
    'visual_progress_not_matching_reported_progress',
    'photo_progress_interpretation',
    'deadline',
    'safety',
    'compliance',
    'gateStatus',
    'reproducibilityKey',
  ]) &&
  hasAll(recommendationChallenge, [
    'challengePIERecommendation',
    'strongestArgumentAgainst',
    'disconfirmingEvidenceNeeded',
    'overlookedStakeholdersOrDependencies',
    'implementationFailureRisks',
    'noActionOrDelayCouldBeBetter',
    'authorityBoundaryChallenge',
    'confidenceOverstatementChallenge',
    'visualEvidenceOverinterpretationChallenge',
    'assumptionChangeChallenge',
    'preferredOptionChanged',
  ]) &&
  hasAll(jarvisReasoningValidation, [
    'validatePIEReasoningWithJARVIS',
    'reality-authority',
    'evidence-traceability',
    'assertion-classification',
    'fact-support',
    'unresolved-conflicts',
    'option-completeness',
    'no-action-considered',
    'score-reproducibility',
    'simulation-reproducibility',
    'sensitivity-analysis',
    'photo-evidence-interpretation',
    'causal-reasoning',
    'challenge-completeness',
    'summary-consistency',
    'pass_with_warnings',
    'needs_more_evidence',
    'human_review_required',
    'blocked',
  ]) &&
  hasAll(confidenceDecomposition, [
    'decomposePIERecommendationConfidence',
    'evidence',
    'reality_model',
    'identity',
    'causal',
    'forecast',
    'option_generation',
    'option_comparison',
    'simulation',
    'execution',
    'photo_evidence',
    'outcome_measurement',
    'overall_recommendation',
    'primaryConfidenceLimiter',
  ]) &&
  hasAll(evidenceValuePrioritization, [
    'prioritizeEvidenceByDecisionValue',
    'uncertaintyResolved',
    'optionsItMayChange',
    'expectedConfidenceImprovement',
    'safetyImpact',
    'canProceedWithoutIt',
    'oneRequestForUser',
  ]) &&
  hasAll(predictiveReality, [
    'predictedEvent',
    'timeframe',
    'assumptions',
    'leadingIndicators',
    'probabilityOrConfidence',
    'supportingRealityObjectIds',
    'risksThatCouldAlterForecast',
    'reassessmentTrigger',
    'expectedConfirmingEvidence',
    'priorForecastsForCalibration',
    'forecastInvalidationTriggers',
  ]) &&
  hasAll(pieCoreIntelligence, [
    'buildPIEDecisionSimulation',
    'challengePIERecommendation',
    'validatePIEReasoningWithJARVIS',
    'decomposePIERecommendationConfidence',
    'prioritizeEvidenceByDecisionValue',
    'decisionSimulation',
    'recommendationChallenge',
    'jarvisReasoningValidation',
    'confidenceDecomposition',
    'evidenceValuePrioritization',
    'decisionProvenance',
  ]) &&
  hasAll(liveAuthorityProvider, [
    'policyForCore',
    'jarvisReasoningValidation',
    'needs_more_evidence',
    'human_review_required',
    'layer4DecisionCreationAllowed: false',
  ]) &&
  hasAll(reportsScreen, [
    'liveAuthority.policy.layer4DecisionCreationAllowed',
  ]) &&
  !hasAny(majorUiSource, [
    'Run Simulation',
    'Challenge Recommendation',
    'Validate with JARVIS',
    'Recalculate Confidence',
    'Compare Options',
  ])
) {
  pass(
    'PIE Decision Intelligence advancement',
    'PIE simulates options, challenges recommendations, validates reasoning with JARVIS, decomposes confidence, prioritizes evidence value, improves prediction metadata, and keeps controls out of normal UI.',
    'services/PIEDecisionSimulation.ts, services/PIERecommendationChallenge.ts, services/PIEJarvisReasoningValidation.ts, services/PIEConfidenceDecomposition.ts, services/PIEEvidenceValuePrioritization.ts, services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Decision Intelligence advancement',
    'Decision simulation, challenge, JARVIS validation, confidence decomposition, evidence-value prioritization, Core integration, or minimal UI guardrails are incomplete.',
    'Add deterministic decision simulation, structured challenge, rule-based JARVIS validation, confidence decomposition, evidence value ranking, Core/provider integration, and no normal UI controls for internal analysis.',
    'services/PIEDecisionSimulation.ts',
  );
}

if (
  fileExists('supabase/migrations/20260701020000_layer4_membership_rls_atomic_sync.sql') &&
  hasAll(layer4MembershipRlsMigration, [
    'create table if not exists public.organizations',
    'create table if not exists public.organization_memberships',
    "status text not null check (status in ('active', 'invited', 'suspended', 'removed'))",
    "'member'",
    "'project_manager'",
    "'decision_owner'",
    "'validation_authority'",
    "'organization_admin'",
    'references auth.users(id)',
    'unique (user_id, organization_id)',
  ])
) {
  pass(
    'Layer 4 membership model',
    'Layer 4 has a Supabase-backed organization membership model with active/suspended lifecycle states and required roles.',
    'supabase/migrations/20260701020000_layer4_membership_rls_atomic_sync.sql',
  );
} else {
  fail(
    'Layer 4 membership model',
    'Layer 4 is missing durable organization membership tables, role checks, or Supabase Auth linkage.',
    'Create organizations and organization_memberships tables linked to auth.users with active/invited/suspended/removed statuses and the required roles.',
    'supabase/migrations/20260701020000_layer4_membership_rls_atomic_sync.sql',
  );
}

if (
  fileExists('services/PIELayer4Automation.ts') &&
  hasAll(layer4Automation, [
    'classifyLayer4AutomationPolicy',
    'buildLayer4DecisionCandidate',
    'buildLayer4DecisionCandidateFromExecutiveJudgment',
    'buildDeprecatedReportOnlyLayer4DecisionCandidate',
    'buildAutomaticOutcomePlan',
    'collectRelevantOutcomeEvidence',
    'proposeImplementationQualityFromEvidence',
    'comparePredictedAndActualOutcomesAutomatically',
    'automateLayer4DecisionLifecycle',
    'automatic',
    'confirmation_required',
    'human_decision_required',
    'findDuplicateLayer4Decision',
  ]) &&
  hasAll(app, [
    'buildLayer4DecisionCandidateFromExecutiveJudgment',
    'createDecisionSnapshotFromJudgment',
    'automateLayer4DecisionLifecycle',
  ]) &&
  !app.includes('buildLayer4DecisionCandidate({') &&
  !reportsScreen.includes('buildPIEReportDraft({')
) {
  pass(
    'Layer 4 automation foundation',
    'Layer 4 automatically detects decision candidates, generates predictions/plans, links evidence, and uses a reusable automation policy.',
    'services/PIELayer4Automation.ts, App.tsx',
  );
} else {
  fail(
    'Layer 4 automation foundation',
    'Layer 4 still appears to depend on manual decision-ledger workflow steps.',
    'Create PIELayer4Automation with decision detection, automatic predicted outcomes, outcome planning, evidence collection, lifecycle automation, and three-level policy.',
    'services/PIELayer4Automation.ts',
  );
}

if (
  hasAll(reportsScreen, [
    'Automatic review',
    'routine lifecycle steps',
    'This is not a decision',
    'Outcome not achieved',
    'Correct',
  ]) &&
  !hasAny(reportsScreen, [
    'Record Decision Snapshot',
    'Record Implementation Quality',
    'Record Actual Outcome',
    'Close Decision',
  ])
) {
  pass(
    'Layer 4 review-by-exception UI',
    'Review no longer exposes routine decision status management as the normal workflow.',
    'screens/ReportsScreen.tsx',
  );
} else {
  fail(
    'Layer 4 review-by-exception UI',
    'Review still exposes routine Layer 4 lifecycle controls or lacks correction-by-exception language.',
    'Hide routine snapshot/status/outcome/close controls and show approve, reject, correct, conflict, validation, and missing-evidence exceptions instead.',
    'screens/ReportsScreen.tsx',
  );
}

if (
  hasAll(decisionLedger, [
    'PIELayer4Permission',
    'authorizedPermissions',
    'requireActorPermission',
    'create_decision_candidate',
    'create_decision_snapshot',
    'approve_decision',
    'validate_outcome',
    'append_corrected_version',
    'append_decision_version',
    'synchronize_decision_history',
  ]) &&
  hasAll(layer4Identity, ['ROLE_PERMISSIONS', 'permissionsForRoles', 'hasLayer4Permission', 'organization_admin'])
) {
  pass(
    'Layer 4 authorization policy',
    'Decision ledger domain operations require typed Layer 4 permissions and roles are mapped centrally.',
    'services/PIEDecisionLedger.ts, services/PIELayer4Identity.ts',
  );
} else {
  fail(
    'Layer 4 authorization policy',
    'Layer 4 permissions are missing or only enforced through UI visibility.',
    'Add typed permissions, centralized role mapping, and domain-level permission checks.',
    'services/PIEDecisionLedger.ts',
  );
}

if (
  hasAll(decisionLedgerStorage, [
    'DECISION_LEDGER_STORAGE_VERSION',
    'loadPIEDecisionLedgerForOrganization',
    'savePIEDecisionLedgerForOrganization',
    'quarantineLegacyDecisionLedger',
    'storageKeyForOrganization',
  ]) &&
  hasAll(reportsScreen, ['Local only until organization membership is verified', 'Retry Sync'])
) {
  pass(
    'Layer 4 organization-scoped local storage',
    'Decision ledger local storage is organization-scoped and legacy global records are quarantined instead of silently migrated.',
    'services/PIEDecisionLedgerStorage.ts, screens/ReportsScreen.tsx',
  );
} else {
  fail(
    'Layer 4 organization-scoped local storage',
    'Decision ledger storage may still be global or auto-migrate unverified legacy records.',
    'Use organization-keyed v2 storage and quarantine legacy v1 decision records.',
    'services/PIEDecisionLedgerStorage.ts',
  );
}

if (
  hasAll(decisionLedgerSync, [
    'PIEDecisionSyncState',
    "'failed'",
    'queuePIEDecisionForSync',
    'syncPIEDecisionLedger',
    'hasLayer4Permission',
    'synchronize_decision_history',
    'detectDecisionSyncConflict',
    'immutableSnapshot',
    'Stale offline data cannot reopen a closed cloud decision',
    'savePIEDecisionRecordAtomic',
  ]) &&
  hasAll(supabaseService, ['savePIEDecisionRecordAtomic', 'save_pie_decision_record_atomic'])
) {
  pass(
    'Layer 4 safe synchronization boundary',
    'Decision ledger sync has queue state, retry metadata, conflict detection, and an atomic RPC save boundary.',
    'services/PIEDecisionLedgerSync.ts, services/SupabaseService.ts',
  );
} else {
  fail(
    'Layer 4 safe synchronization boundary',
    'Decision ledger sync may still rely on last-write-wins or non-atomic multi-table saves.',
    'Add decision-ledger queue/sync metadata, conflict detection, and an atomic Supabase RPC boundary.',
    'services/PIEDecisionLedgerSync.ts',
  );
}

if (
  hasAll(decisionLedger, [
    'versionId?: string | null',
    'contentHash?: string | null',
    'evidenceReferences: PIEEvidenceReference[]',
    'mergeEvidenceReferences',
  ]) &&
  hasAll(reportsScreen, ['Evidence linked automatically', 'Automatic review', 'routine lifecycle steps']) &&
  hasAll(app, ['layer4EvidenceCatalog', 'contentHash', 'versionId']) &&
  hasAll(layer4Automation, ['collectRelevantOutcomeEvidence', 'evidenceUsed', 'linkedEvidence'])
) {
  pass(
    'Layer 4 controlled evidence linking',
    'Decision outcomes, plans, validation, and dispute actions can link stable evidence references automatically with version/hash markers and boundary checks.',
    'services/PIEDecisionLedger.ts, services/PIELayer4Automation.ts, App.tsx, screens/ReportsScreen.tsx',
  );
} else {
  fail(
    'Layer 4 controlled evidence linking',
    'Layer 4 evidence linking is missing stable references, version/hash markers, or automatic evidence collection.',
    'Add evidence reference catalog, automatic evidence collection, and evidenceReferences on outcome plans, implementation, outcomes, validation, and dispute actions.',
    'services/PIEDecisionLedger.ts, services/PIELayer4Automation.ts',
  );
}

if (
  hasAll(decisionLedger, [
    'id: `${latest.id}-${validationStatus}',
    '...decision.actualOutcomes',
    'outcomeValidation',
  ]) &&
  hasAll(layer4MembershipRlsMigration, [
    'save_pie_decision_record_atomic',
    'for update',
    'Layer 4 actor identity must match authenticated Supabase user',
    'Layer 4 outcome validation requires validation authority',
    'Layer 4 decision version conflict',
    'Layer 4 outcome history conflict',
    'Layer 4 audit history conflict',
  ]) &&
  !hasAny(layer4MembershipRlsMigration, ['atomic decision save is blocked'])
) {
  pass(
    'Layer 4 validation history and atomic RPC boundary',
    'Outcome validation is append-only locally and the database exposes a membership-protected atomic RPC boundary.',
    'services/PIEDecisionLedger.ts, supabase/migrations/20260701020000_layer4_membership_rls_atomic_sync.sql',
  );
} else {
  fail(
    'Layer 4 validation history and atomic RPC boundary',
    'Outcome validation may still overwrite history or the atomic RPC boundary is missing.',
    'Append validation/dispute records instead of mutating outcome history and save cloud history through a membership-protected atomic RPC.',
    'services/PIEDecisionLedger.ts',
  );
}

if (
  fileExists('supabase/migrations/20260701010000_layer4_decision_ledger_security.sql') &&
  fileExists('supabase/migrations/20260701020000_layer4_membership_rls_atomic_sync.sql') &&
  hasAll(layer4SecurityMigration + layer4MembershipRlsMigration, [
    'pie_decision_prevent_history_update',
    'pie_decision_prevent_history_delete',
    'pie_decision_validate_child_boundary',
    'pie_decision_validate_version_insert',
    'pie_decision_prevent_snapshot_replace',
    'append-only',
    'enable row level security',
    'pie_layer4_has_permission',
  ]) &&
  !hasAny(layer4SecurityMigration + layer4MembershipRlsMigration, ['using (true)', 'with check (true)'])
) {
  pass(
    'Layer 4 database immutability guard',
    'Database migration adds append-only/history immutability guards and avoids permissive RLS policies.',
    'supabase/migrations/20260701010000_layer4_decision_ledger_security.sql',
  );
} else {
  fail(
    'Layer 4 database immutability guard',
    'Database protections are missing or may use permissive policies.',
    'Add append-only triggers, snapshot replacement guards, child-boundary checks, and no permissive RLS policies.',
    'supabase/migrations/20260701010000_layer4_decision_ledger_security.sql',
  );
}

if (
  hasAll(layer4MembershipRlsMigration, [
    'alter table public.organizations enable row level security',
    'alter table public.organization_memberships enable row level security',
    'alter table public.pie_decision_records enable row level security',
    'alter table public.pie_decision_versions enable row level security',
    'alter table public.pie_decision_outcomes enable row level security',
    'alter table public.pie_decision_audit_events enable row level security',
    'create policy pie_decision_records_member_read',
    'create policy pie_decision_records_member_insert',
    'create policy pie_decision_records_member_update',
    'create policy pie_decision_versions_member_insert',
    'create policy pie_decision_outcomes_member_insert',
    'create policy pie_decision_audit_member_insert',
    'public.pie_layer4_has_active_membership',
    'public.pie_layer4_has_permission',
  ]) &&
  !hasAny(layer4MembershipRlsMigration, ['using (true)', 'with check (true)'])
) {
  pass(
    'Layer 4 RLS organization isolation',
    'Layer 4 decision ledger tables have organization-scoped RLS policies backed by active membership and permissions.',
    'supabase/migrations/20260701020000_layer4_membership_rls_atomic_sync.sql',
  );
} else {
  fail(
    'Layer 4 RLS organization isolation',
    'Layer 4 RLS policies are missing, permissive, or not tied to active organization membership.',
    'Enable RLS on membership and decision tables and require active membership/permission helpers in every policy.',
    'supabase/migrations/20260701020000_layer4_membership_rls_atomic_sync.sql',
  );
}

if (
  fileExists('docs/ECOS_CognitiveFramework.md') &&
  hasAll(ecosCognitiveFrameworkDoc, [
    'ECOS = Executive Cognitive Operating System',
    'Cognitive Framework = reusable thinking layer',
    'PIE = project-specific intelligence engine using the framework',
    'User',
    'App / Interface',
    'ECOS',
    'Cognitive Framework',
    'Domain Intelligence Engine',
    'Recommendations / Decisions / Reports',
    'Observation',
    'Evidence Review',
    'Interpretation',
    'Memory Recall',
    'Pattern Recognition',
    'Hypothesis Formation',
    'Self-Challenge',
    'Belief Formation',
    'Deliberation',
    'Prediction',
    'Decision Scoring',
    'Recommendation',
    'Explanation',
    'Reflection',
    'Learning',
    'Uncertainty Reduction',
  ])
) {
  pass(
    'ECOS Cognitive Framework documentation',
    'ECOS Cognitive Framework doc exists and defines ECOS, the reusable framework, PIE as a domain engine, architecture, and general cognitive abilities.',
    'docs/ECOS_CognitiveFramework.md',
  );
} else {
  fail(
    'ECOS Cognitive Framework documentation',
    'ECOS Cognitive Framework doc is missing required definitions, architecture, or cognitive abilities.',
    'Create docs/ECOS_CognitiveFramework.md with ECOS, Cognitive Framework, PIE, architecture, and all required domain-independent abilities.',
    'docs/ECOS_CognitiveFramework.md',
  );
}

if (
  fileExists('services/ECOSCognitiveFramework.ts') &&
  hasAll(ecosCognitiveFramework, [
    'ECOSCognitiveInput',
    'ECOSCognitiveOutput',
    'ECOSObservation',
    'ECOSEvidenceReview',
    'ECOSInterpretation',
    'ECOSMemoryRecall',
    'ECOSPatternRecognition',
    'ECOSHypothesis',
    'ECOSSelfChallenge',
    'ECOSBelief',
    'ECOSDeliberation',
    'ECOSPrediction',
    'ECOSDecisionScore',
    'ECOSRecommendation',
    'ECOSExplanation',
    'ECOSReflection',
    'ECOSLearning',
    'ECOSUncertainty',
    'ECOSReadiness',
    'runECOSCognitiveFramework',
  ])
) {
  pass(
    'ECOS Cognitive Framework service',
    'ECOSCognitiveFramework service exists with all requested domain-neutral input, output, type, readiness, and runner exports.',
    'services/ECOSCognitiveFramework.ts',
  );
} else {
  fail(
    'ECOS Cognitive Framework service',
    'ECOSCognitiveFramework service is missing required types or runECOSCognitiveFramework.',
    'Create the domain-neutral ECOS service with the requested type and function contract.',
    'services/ECOSCognitiveFramework.ts',
  );
}

if (
  hasAll(ecosCognitiveFramework, [
    'observations',
    'evidenceReview',
    'interpretations',
    'memoryRecall',
    'patterns',
    'hypotheses',
    'challenges',
    'beliefs',
    'deliberation',
    'predictions',
    'decisionScores',
    'recommendations',
    'explanations',
    'reflection',
    'learning',
    'uncertainty',
    'readiness',
    'nextBestActions',
  ])
) {
  pass(
    'ECOS Cognitive Framework output contract',
    'Framework output includes observation, evidence, interpretation, memory, patterns, hypotheses, challenge, beliefs, deliberation, prediction, decision, recommendation, explanation, reflection, learning, uncertainty, readiness, and next actions.',
    'services/ECOSCognitiveFramework.ts',
  );
} else {
  fail(
    'ECOS Cognitive Framework output contract',
    'Framework output contract is missing one or more required cognitive outputs.',
    'Expose every required ECOS cognitive output field from runECOSCognitiveFramework.',
    'services/ECOSCognitiveFramework.ts',
  );
}

if (
  hasAll(ecosCognitiveFramework, [
    'subject',
    'evidence',
    'context',
    'goal',
    'risk',
    'constraint',
    'decision',
    'action',
    'outcome',
  ]) &&
  !hasAny(ecosCognitiveFramework, [
    'construction',
    'contractor',
    'inspection',
    'jobsite',
    'schedule item',
    'project recommendation',
    'project risk',
    'project belief',
  ])
) {
  pass(
    'ECOS framework domain neutrality',
    'ECOSCognitiveFramework uses neutral cognitive terms and avoids project-specific hardcoding.',
    'services/ECOSCognitiveFramework.ts',
  );
} else {
  fail(
    'ECOS framework domain neutrality',
    'ECOSCognitiveFramework appears to contain project-specific language or lacks neutral vocabulary.',
    'Keep ECOS generic; move project-specific terms into PIE mapping code.',
    'services/ECOSCognitiveFramework.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'runECOSCognitiveFramework',
    'ecosCognitiveFramework',
    'ECOSCognitiveOutput',
    'buildPIEDomainInput',
    'buildPIEDomainMappingResult',
    'pieDomainIntelligence',
  ])
) {
  pass(
    'PIE Core ECOS integration',
    'PIECoreIntelligence consumes ECOS Cognitive Framework through the PIE domain adapter and exposes the generic cognitive output for project-specific mapping.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core ECOS integration',
    'PIECoreIntelligence does not clearly consume ECOS Cognitive Framework.',
    'Call runECOSCognitiveFramework through the PIE domain adapter and expose the output on PIECoreOutput.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  fileExists('services/ECOSDomainAdapter.ts') &&
  hasAll(ecosDomainAdapter, [
    'ECOSDomain',
    'ECOSDomainInput',
    'ECOSDomainOutput',
    'ECOSDomainEvidence',
    'ECOSDomainContext',
    'ECOSDomainGoal',
    'ECOSDomainRisk',
    'ECOSDomainConstraint',
    'ECOSDomainDecision',
    'ECOSDomainRecommendation',
    'ECOSDomainMappingResult',
    'buildECOSDomainInput',
    'mapDomainEvidenceToECOS',
    'mapDomainGoalsToECOS',
    'mapDomainConstraintsToECOS',
    'mapECOSOutputToDomain',
    'mapECOSRecommendationToDomain',
    'buildDomainRecommendation',
    'explainDomainMapping',
  ])
) {
  pass(
    'ECOS Domain Adapter service',
    'ECOSDomainAdapter exists with required domain types and generic mapping functions.',
    'services/ECOSDomainAdapter.ts',
  );
} else {
  fail(
    'ECOS Domain Adapter service',
    'ECOSDomainAdapter is missing required adapter types or mapping functions.',
    'Create services/ECOSDomainAdapter.ts with the requested domain input/output, evidence, context, goal, risk, constraint, decision, recommendation, mapping result, and mapper functions.',
    'services/ECOSDomainAdapter.ts',
  );
}

if (
  hasAll(ecosDomainAdapter, [
    "'project'",
    "'manufacturing'",
    "'maintenance'",
    "'safety'",
    "'compliance'",
    "'facilities'",
    "'logistics'",
  ])
) {
  pass(
    'ECOS Domain support',
    'Domain adapter supports project now and reserves manufacturing, maintenance, safety, compliance, facilities, and logistics.',
    'services/ECOSDomainAdapter.ts',
  );
} else {
  fail(
    'ECOS Domain support',
    'Domain adapter does not include the required current and future domains.',
    'Add project plus manufacturing, maintenance, safety, compliance, facilities, and logistics to ECOSDomain.',
    'services/ECOSDomainAdapter.ts',
  );
}

if (
  fileExists('services/PIEDomainAdapter.ts') &&
  hasAll(pieDomainAdapter, [
    'buildPIEDomainInput',
    'mapPIEEvidenceToECOS',
    'mapPIEGoalsToECOS',
    'mapPIEConstraintsToECOS',
    'mapECOSToPIEIntelligence',
    'projectBeliefs',
    'projectRisks',
    'projectDecisions',
    'projectRecommendations',
    'projectUncertainty',
    'projectNextBestActions',
    'reportInsights',
  ])
) {
  pass(
    'PIE Domain Adapter service',
    'PIEDomainAdapter maps project evidence/goals/constraints into ECOS and maps ECOS output back into project intelligence.',
    'services/PIEDomainAdapter.ts',
  );
} else {
  fail(
    'PIE Domain Adapter service',
    'PIEDomainAdapter is missing required project adapter functions or output fields.',
    'Create the PIE project adapter with project evidence, goals, constraints, ECOS-to-PIE mapping, and project intelligence outputs.',
    'services/PIEDomainAdapter.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIEDomainInput',
    'buildPIEDomainMappingResult',
    'runECOSCognitiveFramework(pieDomainMapping.ecosInput)',
    'mapECOSToPIEIntelligence',
    'pieDomainIntelligence',
  ])
) {
  pass(
    'PIE Core Domain Adapter path',
    'PIECoreIntelligence now routes PIE data through PIEDomainAdapter into ECOS and maps ECOS output back to PIE output.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Domain Adapter path',
    'PIECoreIntelligence does not clearly use the adapter path between PIE data and ECOS Cognitive Framework.',
    'Use PIEDomainAdapter before runECOSCognitiveFramework and map ECOS output back into PIE domain intelligence.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  fileExists('docs/ECOS_DomainAdapterModel.md') &&
  hasAll(ecosDomainAdapterModel, [
    'ECOS Domain Adapter',
    'Domain Evidence',
    'Domain Adapter',
    'ECOS Cognitive Framework',
    'Domain Intelligence Output',
    'PIEDomainAdapter',
    'project beliefs',
    'project risks',
    'project decisions',
    'project recommendations',
    'project uncertainty',
    'project next best actions',
    'report insights',
  ]) &&
  hasAll(
    [
      ecosCognitiveFrameworkDoc,
      masterArchitecture,
      pieCoreIntelligencePlan,
      productOperatingPlan,
      jarvisQaDoc,
    ].join('\n'),
    [
      'ECOS Domain Adapter',
      'PIEDomainAdapter',
      'Domain Adapter',
      'Domain Intelligence Engine',
    ],
  )
) {
  pass(
    'ECOS Domain Adapter documentation',
    'Domain adapter model and architecture docs explain domain-neutral thinking, domain-specific interpretation, PIE as first adapter, and future adapter pattern.',
    'docs/ECOS_DomainAdapterModel.md and architecture docs',
  );
} else {
  fail(
    'ECOS Domain Adapter documentation',
    'Adapter docs do not fully explain the domain adapter pattern and PIE as first adapter.',
    'Create docs/ECOS_DomainAdapterModel.md and update ECOS/PIE architecture docs with the adapter flow.',
    'Domain adapter docs',
  );
}

if (
  hasAll(
    [
      masterArchitecture,
      productOperatingPlan,
      pieCoreIntelligencePlan,
      pieCognitiveArchitecture,
      pieCognitiveConstitution,
      jarvisQaDoc,
    ].join('\n'),
    [
      'ECOS',
      'Cognitive Framework',
      'Domain Intelligence Engine',
      'PIE as first domain engine',
      'If a capability is domain-independent, it belongs to ECOS Cognitive Framework.',
      'If it is project-specific, it belongs to PIE.',
      'Apps collect input and display',
    ],
  )
) {
  pass(
    'ECOS architecture alignment',
    'Architecture, operating, core, cognitive, constitution, and QA docs separate ECOS, Cognitive Framework, PIE, and App ownership.',
    'docs/PIE_MasterArchitecture.md, docs/PIE_ProductOperatingPlan.md, docs/PIE_CoreIntelligencePlan.md, docs/PIE_CognitiveArchitecture.md, docs/PIE_CognitiveConstitution.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'ECOS architecture alignment',
    'Docs do not fully define PIE as a domain engine inside ECOS or separate ECOS, Cognitive Framework, PIE, and App ownership.',
    'Update architecture and QA docs with the ECOS ownership boundary and domain-engine rule.',
    'Architecture docs and ProjectVisionAI_JARVIS_QA.md',
  );
}

if (
  fileExists('services/PIEPredictiveEngine.ts') &&
  hasAll(piePredictiveEngine, [
    'export type PIEPrediction',
    'export type PIEPredictionScenario',
    'export type PIEPredictionInput',
    'export type PIEPredictionOutcome',
    'export type PIEPredictionRisk',
    'export type PIEPredictionImpact',
    'export type PIEPredictionDependency',
    'export type PIEPredictionTimeline',
    'export type PIEPredictionRecoveryAction',
    'export type PIEPredictionConfidence',
    'export type PIEPredictionExplanation',
    'export type PIEPredictionResult',
    'export function buildPIEPredictions',
    'export function buildPredictionScenarios',
    'export function simulateLikelyOutcome',
    'export function simulateBestCase',
    'export function simulateWorstCase',
    'export function simulateNoAction',
    'export function identifyCascadingImpacts',
    'export function identifyScheduleImpact',
    'export function identifyInspectionImpact',
    'export function identifyContractorImpact',
    'export function buildRecoveryActions',
    'export function scorePredictionConfidence',
    'export function explainPrediction',
  ])
) {
  pass(
    'PIE Predictive Simulation service',
    'PIEPredictiveEngine exists with prediction types and required simulation functions.',
    'services/PIEPredictiveEngine.ts',
  );
} else {
  fail(
    'PIE Predictive Simulation service',
    'Predictive Simulation service is missing required types or functions.',
    'Create services/PIEPredictiveEngine.ts with prediction scenarios, likely/best/worst/no-action simulations, cascading impacts, dependencies, recovery actions, confidence, and explanation.',
    'services/PIEPredictiveEngine.ts',
  );
}

if (
  hasAll(piePredictiveEngine, [
    'schedule_delay',
    'inspection_delay',
    'contractor_delay',
    'missing_evidence',
    'safety_issue',
    'quality_issue',
    'decision_delay',
    'recovery_plan',
    'no_action',
    'best_case',
    'most_likely',
    'worst_case',
    'inspection dependency',
    'contractor dependency',
    'material dependency',
    'approval dependency',
    'safety dependency',
    'evidence dependency',
  ])
) {
  pass(
    'Predictive scenarios and dependencies',
    'Predictive Simulation includes the supported scenarios and non-schedule dependency categories.',
    'services/PIEPredictiveEngine.ts',
  );
} else {
  fail(
    'Predictive scenarios and dependencies',
    'Predictive Simulation does not include all requested scenarios or dependency categories.',
    'Add schedule, inspection, contractor, missing evidence, safety, quality, decision, recovery, no-action, best/most likely/worst scenarios and the supported non-schedule dependency categories.',
    'services/PIEPredictiveEngine.ts',
  );
}

if (
  hasAll(piePredictiveEngine, [
    'beliefSystem',
    'beliefReadiness',
    'beliefsNeedingVerification',
    'patternIntelligence',
    'earlyWarnings',
    'patternBasedRecommendations',
    'scientificResult',
    'hypotheses',
    'uncertainty',
    'alternatives',
    'deliberation',
    'executiveReasoning',
    'noActionOutcome',
    'recoveryActions',
    'evidenceThatWouldImprovePrediction',
  ])
) {
  pass(
    'Predictive cognitive integration',
    'Predictive Simulation consumes beliefs, patterns, Scientific Method, Deliberation, Executive Reasoning, no-action consequences, recovery actions, and evidence needs.',
    'services/PIEPredictiveEngine.ts',
  );
} else {
  fail(
    'Predictive cognitive integration',
    'Predictive Simulation does not clearly consume beliefs, patterns, Scientific Method, Deliberation, and Executive Reasoning.',
    'Wire predictions to belief readiness, recurring patterns, hypotheses, uncertainties, alternatives, executive reasoning, recovery actions, no-action consequence, and prediction evidence needs.',
    'services/PIEPredictiveEngine.ts',
  );
}

if (
  hasAll(pieExecutiveReasoning, [
    'PIEPredictionResult',
    'predictions',
    'prediction',
    'noActionOutcome',
    'recoveryActions',
    'predictedScheduleImpact',
    'risk propagation',
  ]) ||
  hasAll(pieExecutiveReasoning, [
    'PIEPredictionResult',
    'predictions',
    'noActionOutcome',
    'recoveryActions',
    'predictedHighRisk',
    'scheduleImpact',
  ])
) {
  pass(
    'Executive Reasoning Predictive integration',
    'Executive Reasoning consumes predictions for predicted schedule impact, risk propagation, recovery action value, and no-action consequences.',
    'services/PIEExecutiveReasoning.ts',
  );
} else {
  fail(
    'Executive Reasoning Predictive integration',
    'Executive Reasoning does not clearly consume predictions.',
    'Update Executive Reasoning so highest-value action accounts for predicted schedule impact, risk propagation, recovery action value, and no-action consequence.',
    'services/PIEExecutiveReasoning.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIEPredictions',
    'predictionResult',
    'predictions',
    'mostLikelyOutcome',
    'bestCaseOutcome',
    'worstCaseOutcome',
    'noActionOutcome',
    'cascadingImpacts',
    'recoveryActions',
    'predictionConfidence',
  ])
) {
  pass(
    'Predictive Core integration',
    'PIE Core Intelligence builds and exposes predictions, outcomes, cascading impacts, recovery actions, and prediction confidence.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'Predictive Core integration',
    'PIE Core Intelligence does not expose required predictive outputs.',
    'Expose predictions, mostLikelyOutcome, bestCaseOutcome, worstCaseOutcome, noActionOutcome, cascadingImpacts, recoveryActions, and predictionConfidence.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(attentionEngine, [
    'PIEPredictionResult',
    'predictions',
    'Predictive Simulation',
    'cascadingImpacts',
  ]) &&
  hasAll(experienceEngine, [
    'PIEPredictionResult',
    'predictions',
    'Predictive Simulation',
  ]) &&
  hasAll(pieReporter, [
    'PIEPredictionResult',
    'predictionReviewFlags',
    'predictionReportBullets',
    'doNotOverstate',
    "confidence !== 'high'",
  ])
) {
  pass(
    'Predictive Attention Experience Reporter integration',
    'Attention elevates high-impact predictions, Experience can prioritize predicted risks, and Reporter avoids overstating weak predictions.',
    'services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts, services/PIEReporter.ts',
  );
} else {
  fail(
    'Predictive Attention Experience Reporter integration',
    'Attention, Experience, or Reporter does not clearly consume predictions with overstatement safeguards.',
    'Use high-impact predictions in Attention/Experience and ensure Reporter only mentions predicted impact when confidence is strong.',
    'services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts, services/PIEReporter.ts',
  );
}

if (
  hasAll(pieScientificMethod, [
    'PIEPredictionResult',
    'predictiveResult',
    'prediction-predictive-engine',
  ])
) {
  pass(
    'Scientific Method Predictive integration',
    'Scientific Method can use Predictive Simulation output when practical.',
    'services/PIEScientificMethod.ts',
  );
} else {
  fail(
    'Scientific Method Predictive integration',
    'Scientific Method does not expose a pathway for Predictive Simulation output.',
    'Allow Scientific Method predictions to consume PIEPredictiveEngine output when provided.',
    'services/PIEScientificMethod.ts',
  );
}

if (
  fileExists('docs/PIE_PredictiveSimulationModel.md') &&
  hasAll(
    piePredictiveSimulationModel + masterArchitecture + pieCoreIntelligencePlan + pieCognitiveArchitecture + pieCognitiveConstitution,
    [
      'Predictive Simulation',
      'Scenario Analysis',
      'No-Action Simulation',
      'Cascading Impact',
      'Recovery Planning',
    ],
  )
) {
  pass(
    'Predictive Simulation documentation',
    'Predictive Simulation model and architecture docs define scenario analysis, no-action simulation, cascading impact, and recovery planning.',
    'docs/PIE_PredictiveSimulationModel.md',
  );
} else {
  fail(
    'Predictive Simulation documentation',
    'Predictive Simulation documentation is missing required concepts.',
    'Create docs/PIE_PredictiveSimulationModel.md and update architecture docs with Predictive Simulation, Scenario Analysis, No-Action Simulation, Cascading Impact, and Recovery Planning.',
    'docs/PIE_PredictiveSimulationModel.md',
  );
}

if (
  fileExists('services/PIEExecutiveReasoning.ts') &&
  hasAll(pieExecutiveReasoning, [
    'export type PIEExecutiveJudgment',
    'export type PIEExecutiveRisk',
    'export type PIEExecutivePriority',
    'export type PIEExecutiveDecisionNeed',
    'export type PIEExecutiveOpportunity',
    'export type PIEExecutiveConcern',
    'export type PIEExecutiveTradeoff',
    'export type PIEExecutiveAction',
    'export type PIEExecutiveBriefingPoint',
    'export type PIEExecutiveReasoningResult',
    'export type PIEExecutiveDecisionScore',
    'export type PIEExecutiveReadiness',
    'export function buildPIEExecutiveReasoning',
    'export function rankExecutivePriorities',
    'export function identifyBiggestRisk',
    'export function identifyBiggestOpportunity',
    'export function identifyDecisionNeeds',
    'export function identifyScheduleThreats',
    'export function identifyInspectionRisks',
    'export function identifyContractorConcerns',
    'export function identifyCommunicationNeeds',
    'export function scoreExecutiveActions',
    'export function buildExecutiveBriefingPoints',
    'export function explainExecutiveJudgment',
  ])
) {
  pass(
    'PIE Executive Reasoning service',
    'Executive Reasoning service exists with required judgment, risk, priority, decision, opportunity, action scoring, briefing, readiness types and functions.',
    'services/PIEExecutiveReasoning.ts',
  );
} else {
  fail(
    'PIE Executive Reasoning service',
    'Executive Reasoning service is missing required types or functions.',
    'Create services/PIEExecutiveReasoning.ts with executive judgment, priority ranking, biggest risk, highest-value action, decision needs, action scoring, briefing points, and readiness.',
    'services/PIEExecutiveReasoning.ts',
  );
}

if (
  hasAll(pieExecutiveReasoning, [
    'strongestBeliefs',
    'challengedBeliefs',
    'beliefsNeedingVerification',
    'beliefReadiness',
    'contradictingEvidence',
    'patternIntelligence',
    'earlyWarnings',
    'patternBasedRecommendations',
    'memoryRecall',
    'summaryForPIE',
    'scientificResult',
    'primaryUncertainty',
    'decisionQualitySignals',
    'deliberation',
    'tradeoffs',
    'alternativesConsidered',
  ])
) {
  pass(
    'Executive Reasoning cognitive integration',
    'Executive Reasoning consumes Belief, Pattern, Memory, Scientific Method, and Deliberation signals.',
    'services/PIEExecutiveReasoning.ts',
  );
} else {
  fail(
    'Executive Reasoning cognitive integration',
    'Executive Reasoning does not clearly consume beliefs, patterns, memory, Scientific Method, and Deliberation.',
    'Wire Executive Reasoning to strongest/challenged beliefs, belief readiness, contradicting evidence, pattern warnings, memory lessons, scientific uncertainty, decision quality, alternatives, and tradeoffs.',
    'services/PIEExecutiveReasoning.ts',
  );
}

if (
  hasAll(pieExecutiveReasoning, [
    'whatMattersMost',
    'biggestRisk',
    'highestValueAction',
    'decisionNeeded',
    'issueLikelyToGrow',
    'stoppedMoving',
    'shouldBeCommunicated',
    'verifyBeforeActing',
    'canWait',
    'ignoreForNow',
    'expectedValue',
    'riskReduction',
    'uncertaintyReduction',
    'scheduleImpact',
    'safetyImpact',
    'communicationImpact',
    'effortLevel',
    'whyRecommended',
    'Ready',
    'Needs Verification',
    'Uncertain',
    'Blocked',
  ])
) {
  pass(
    'Executive questions and action scoring',
    'Executive Reasoning answers the executive questions and scores actions with readiness.',
    'services/PIEExecutiveReasoning.ts',
  );
} else {
  fail(
    'Executive questions and action scoring',
    'Executive Reasoning does not expose all executive answers or decision scoring fields.',
    'Add the executive answer set and scoring fields: expected value, risk reduction, uncertainty reduction, schedule impact, safety impact, communication impact, effort, readiness, and why recommended.',
    'services/PIEExecutiveReasoning.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIEExecutiveReasoning',
    'executiveReasoning',
    'executivePriorities',
    'biggestRisk',
    'highestValueAction',
    'executiveBriefingPoints',
    'executiveReadiness',
  ])
) {
  pass(
    'Executive Reasoning Core integration',
    'PIE Core Intelligence builds and exposes Executive Reasoning outputs.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'Executive Reasoning Core integration',
    'PIE Core Intelligence does not expose required Executive Reasoning outputs.',
    'Expose executiveReasoning, executivePriorities, biggestRisk, highestValueAction, executiveBriefingPoints, and executiveReadiness from Core.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(attentionEngine, [
    'PIEExecutiveReasoningResult',
    'executiveReasoning',
    'Executive Reasoning',
    'biggestRisk',
    'highestValueAction',
  ]) &&
  hasAll(experienceEngine, [
    'PIEExecutiveReasoningResult',
    'executiveReasoning',
    'highestValueAction',
    'Executive Reasoning',
  ]) &&
  hasAll(pieReporter, [
    'PIEExecutiveReasoningResult',
    'executiveReasoning',
    'executiveReasoningReviewFlags',
    'executiveReasoningReportBullets',
  ])
) {
  pass(
    'Executive Reasoning Attention Experience Reporter integration',
    'Attention, Experience, and Reporter consume Executive Reasoning where practical.',
    'services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts, services/PIEReporter.ts',
  );
} else {
  fail(
    'Executive Reasoning Attention Experience Reporter integration',
    'Attention, Experience, or Reporter does not clearly consume Executive Reasoning.',
    'Use biggest executive risk in Attention, highest-value action in Experience, and executive summary/review improvements in Reporter.',
    'services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts, services/PIEReporter.ts',
  );
}

if (
  fileExists('docs/PIE_ExecutiveReasoningModel.md') &&
  hasAll(
    pieExecutiveReasoningModel + masterArchitecture + pieCoreIntelligencePlan + pieCognitiveArchitecture + pieCognitiveConstitution,
    [
      'Executive Reasoning',
      'Decision Scoring',
      'Highest-Value Action',
      'Executive Risk',
      'Executive Judgment',
      'expected value',
      'risk reduction',
      'uncertainty reduction',
      'schedule impact',
      'safety impact',
      'communication impact',
    ],
  )
) {
  pass(
    'Executive Reasoning documentation',
    'Executive Reasoning model and architecture docs define judgment, risk, highest-value action, and decision scoring.',
    'docs/PIE_ExecutiveReasoningModel.md',
  );
} else {
  fail(
    'Executive Reasoning documentation',
    'Executive Reasoning documentation is missing required concepts.',
    'Create docs/PIE_ExecutiveReasoningModel.md and update architecture docs with Executive Reasoning, Decision Scoring, Highest-Value Action, Executive Risk, and Executive Judgment.',
    'docs/PIE_ExecutiveReasoningModel.md',
  );
}

if (
  hasAll(masterArchitecture + jarvisQaDoc, [
    'PIE_ProductOperatingPlan.md',
    'Every sprint must improve PIE, evidence capture, or output clarity',
    /feature improves? PIE, app evidence capture, or output clarity/i,
    /user (is not forced into|kept out of) unnecessary options/i,
    /outputs (are )?clear and reviewable/i,
  ])
) {
  pass(
    'Product operating alignment gate',
    'Master Architecture and JARVIS QA document the Product Operating Plan release gate.',
    'docs/PIE_MasterArchitecture.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'Product operating alignment gate',
    'Architecture or JARVIS docs do not enforce Product Operating Plan alignment.',
    'Reference the operating plan and require every sprint to improve PIE, evidence capture, or output clarity without unnecessary options.',
    'docs/PIE_MasterArchitecture.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
}

if (
  fileExists('services/PIECoreIntelligence.ts') &&
  hasAll(pieCoreIntelligence, [
    'export type PIECoreInput',
    'export type PIECoreOutput',
    'export type PIEEvidenceReview',
    'export type PIEInterpretation',
    'export type PIERelationshipAnalysis',
    'export type PIEBelief',
    'export type PIEOpinion',
    'export type PIEDecisionSupport',
    'export type PIERecommendation',
    'export type PIEExplanation',
    'export type PIEReflectionResult',
    'export type PIELearningSignal',
    'export function buildPIECoreIntelligence',
    'evidenceReview',
    'interpretations',
    'relationships',
    'beliefs',
    'opinions',
    'decisionsNeeded',
    'recommendations',
    'explanations',
    'missingData',
    'confidence',
    'nextBestActions',
    'learningSignals',
  ])
) {
  pass(
    'PIE Core Intelligence service',
    'PIECoreIntelligence service exists with the reusable core input, output, capability layer types, function, and required output fields.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Intelligence service',
    'PIECoreIntelligence service or required output contract was not found.',
    'Create services/PIECoreIntelligence.ts with evidenceReview, interpretations, relationships, beliefs, opinions, decisionsNeeded, recommendations, explanations, missingData, confidence, nextBestActions, and learningSignals.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  fileExists('docs/PIE_CognitiveConstitution.md') &&
  hasAll(pieCognitiveConstitution, [
    'PIE seeks truth, not agreement.',
    'PIE separates evidence from assumptions.',
    'PIE forms beliefs that can be revised.',
    'PIE challenges its own conclusions before recommending action.',
    'PIE identifies uncertainty and seeks to reduce it.',
    'PIE explains every important recommendation.',
    'PIE learns from outcomes, not just inputs.',
    'PIE optimizes for decision quality, not information quantity.',
    'Every recommendation must be traceable to evidence.',
    'Every cognitive ability should be reusable across domains.',
    'Question -> Observe -> Collect Evidence -> Interpret -> Recall Similar Situations -> Generate Hypotheses -> Challenge Hypotheses -> Evaluate Alternatives -> Predict Outcomes -> Select Best Decision -> Explain -> Monitor Result -> Reflect -> Learn',
  ])
) {
  pass(
    'PIE Cognitive Constitution',
    'Cognitive Constitution exists with the truth-seeking principles and Scientific Method loop.',
    'docs/PIE_CognitiveConstitution.md',
  );
} else {
  fail(
    'PIE Cognitive Constitution',
    'Cognitive Constitution is missing required principles or the Scientific Method loop.',
    'Create docs/PIE_CognitiveConstitution.md with all ten principles and the complete thinking loop.',
    'docs/PIE_CognitiveConstitution.md',
  );
}

if (
  fileExists('services/PIEScientificMethod.ts') &&
  hasAll(pieScientificMethod, [
    'export type PIEScientificQuestion',
    'export type PIEScientificObservation',
    'export type PIEScientificEvidence',
    'export type PIEScientificInterpretation',
    'export type PIEScientificMemoryRecall',
    'export type PIEScientificHypothesis',
    'export type PIEScientificChallenge',
    'export type PIEScientificAlternative',
    'export type PIEScientificPrediction',
    'export type PIEScientificDecision',
    'export type PIEScientificExplanation',
    'export type PIEScientificOutcomeMonitor',
    'export type PIEScientificReflection',
    'export type PIEScientificLearning',
    'export type PIEScientificResult',
    'export function runPIEScientificMethod',
    'buildQuestion',
    'buildObservations',
    'buildEvidence',
    'buildInterpretations',
    'buildScientificMemoryRecall',
    'generateHypotheses',
    'challengeHypotheses',
    'buildScientificAlternatives',
    'predictOutcomes',
    'selectBestDecision',
    'buildExplanation',
    'buildOutcomeMonitor',
    'buildScientificReflection',
    'buildScientificLearning',
  ])
) {
  pass(
    'PIE Scientific Method service',
    'Scientific Method service exists with the required thinking loop types and functions.',
    'services/PIEScientificMethod.ts',
  );
} else {
  fail(
    'PIE Scientific Method service',
    'Scientific Method service is missing required loop types or functions.',
    'Create services/PIEScientificMethod.ts with Question, Observe, Evidence, Interpret, Recall, Hypothesize, Challenge, Alternatives, Predict, Decide, Explain, Monitor, Reflect, and Learn.',
    'services/PIEScientificMethod.ts',
  );
}

if (
  hasAll(pieScientificMethod, [
    'export type PIEUncertainty',
    'export type PIEUncertaintyReductionAction',
    'primaryUncertainty',
    'uncertaintyReductionActions',
    'buildUncertainty',
    'buildUncertaintyReductionActions',
  ])
) {
  pass(
    'Scientific Method uncertainty model',
    'Scientific Method includes uncertainty and uncertainty reduction behavior.',
    'services/PIEScientificMethod.ts',
  );
} else {
  fail(
    'Scientific Method uncertainty model',
    'Scientific Method does not expose uncertainty and uncertainty reduction behavior.',
    'Add PIEUncertainty, PIEUncertaintyReductionAction, primaryUncertainty, and uncertaintyReductionActions.',
    'services/PIEScientificMethod.ts',
  );
}

if (
  hasAll(pieScientificMethod, [
    'export type PIEScientificHypothesis',
    'generateHypotheses',
    'supportingEvidence',
    'contradictingEvidence',
    'testNeeded',
  ])
) {
  pass(
    'Scientific Method hypothesis model',
    'Scientific Method includes hypothesis generation with supporting and contradicting evidence.',
    'services/PIEScientificMethod.ts',
  );
} else {
  fail(
    'Scientific Method hypothesis model',
    'Scientific Method hypothesis model is incomplete.',
    'Add PIEScientificHypothesis with statement, supporting evidence, contradicting evidence, confidence/readiness, and test needed.',
    'services/PIEScientificMethod.ts',
  );
}

if (
  hasAll(pieScientificMethod, [
    'export type PIEScientificChallenge',
    'challengeHypotheses',
    'whatCouldMakePIEWrong',
    'weakestAssumption',
    'whatShouldBeVerifiedFirst',
  ])
) {
  pass(
    'Scientific Method self-challenge model',
    'Scientific Method challenges hypotheses before recommendations.',
    'services/PIEScientificMethod.ts',
  );
} else {
  fail(
    'Scientific Method self-challenge model',
    'Scientific Method self-challenge model is incomplete.',
    'Add PIEScientificChallenge with what could make PIE wrong, contradicting evidence, weakest assumption, and what to verify first.',
    'services/PIEScientificMethod.ts',
  );
}

if (
  hasAll(pieScientificMethod, [
    'export type PIEDecisionQualityScore',
    'scoreDecisionQuality',
    'evidenceTraceability',
    'hypothesisStrength',
    'selfChallengeStrength',
    'uncertaintyReduction',
    'explanationClarity',
  ])
) {
  pass(
    'Scientific Method decision quality model',
    'Scientific Method scores decision quality across evidence, hypothesis, self-challenge, uncertainty, and explanation.',
    'services/PIEScientificMethod.ts',
  );
} else {
  fail(
    'Scientific Method decision quality model',
    'Scientific Method decision quality model is incomplete.',
    'Add PIEDecisionQualityScore and scoreDecisionQuality with traceability, hypothesis, self-challenge, uncertainty, and explanation signals.',
    'services/PIEScientificMethod.ts',
  );
}

if (
  fileExists('services/PIEPatternEngine.ts') &&
  hasAll(piePatternEngine, [
    'export type PIEPattern',
    'export type PIEPatternType',
    'export type PIEPatternMatch',
    'export type PIEPatternSignal',
    'export type PIEPatternEvidence',
    'export type PIEPatternSimilarity',
    'export type PIEPatternOutcome',
    'export type PIEPatternRecommendation',
    'export type PIEPatternWarning',
    'export type PIEPatternTimeline',
    'export type PIEPatternConfidence',
    'schedule_slippage',
    'contractor_slowdown',
    'inspection_risk',
    'recurring_safety_issue',
    'missing_evidence',
    'repeated_user_correction',
    'recurring_blocker',
    'recovery_sequence',
    'successful_resolution',
    'failed_recommendation',
    'communication_gap',
    'resource_constraint',
    'quality_concern',
  ])
) {
  pass(
    'PIE Pattern Engine service',
    'PIEPatternEngine exists with pattern types and all required pattern model exports.',
    'services/PIEPatternEngine.ts',
  );
} else {
  fail(
    'PIE Pattern Engine service',
    'PIEPatternEngine is missing required pattern types or pattern categories.',
    'Create services/PIEPatternEngine.ts with pattern types, matches, signals, evidence, similarity, outcomes, recommendations, warnings, timelines, and confidence.',
    'services/PIEPatternEngine.ts',
  );
}

if (
  hasAll(piePatternEngine, [
    'export function buildPIEPatternIntelligence',
    'export function findMatchingPatterns',
    'export function detectEarlyWarnings',
    'export function compareCurrentToHistorical',
    'export function scorePatternSimilarity',
    'export function buildPatternTimeline',
    'export function buildPatternBasedRecommendations',
    'export function explainPatternMatch',
    'export function identifyRecurringIssues',
    'export function identifySuccessfulRecoveryPatterns',
    'export function identifyFailedPatterns',
  ])
) {
  pass(
    'PIE Pattern Engine functions',
    'Pattern Engine exposes matching, warning, similarity, timeline, recommendation, explanation, recurring issue, recovery, and failed pattern functions.',
    'services/PIEPatternEngine.ts',
  );
} else {
  fail(
    'PIE Pattern Engine functions',
    'Pattern Engine is missing required pattern intelligence functions.',
    'Add buildPIEPatternIntelligence, findMatchingPatterns, detectEarlyWarnings, compareCurrentToHistorical, scorePatternSimilarity, buildPatternTimeline, buildPatternBasedRecommendations, explainPatternMatch, identifyRecurringIssues, identifySuccessfulRecoveryPatterns, and identifyFailedPatterns.',
    'services/PIEPatternEngine.ts',
  );
}

if (
  hasAll(piePatternEngine, [
    "from './PIEMemoryRecall'",
    "from './PIEReflectionEngine'",
    'memoryRecall',
    'pastReflections',
    'lessonsLearned',
    'pastCorrections',
    'pastRecommendations',
    'report_history',
    'historical project',
  ])
) {
  pass(
    'PIE Pattern Memory and Reflection integration',
    'Pattern Engine consumes Memory Recall and Reflection history, lessons, corrections, recommendations, report history, and project events.',
    'services/PIEPatternEngine.ts',
  );
} else {
  fail(
    'PIE Pattern Memory and Reflection integration',
    'Pattern Engine does not clearly consume Memory Recall and Reflection context.',
    'Wire Pattern Engine to memory recall, reflection lessons, prior corrections, past recommendations, report notes, recurring issues, and historical project events.',
    'services/PIEPatternEngine.ts',
  );
}

if (
  hasAll(pieScientificMethod, [
    'PIEPatternIntelligence',
    'patternIntelligence',
    'patternMatchIds',
    'patternBasedRecommendations',
    'earlyWarnings',
    'hypothesis-pattern',
    'prediction-${match.id}',
    'patternIntelligence?.patternBasedRecommendations',
  ])
) {
  pass(
    'Scientific Method Pattern integration',
    'Scientific Method consumes pattern matches in recall, hypotheses, challenges, predictions, and uncertainty reduction actions.',
    'services/PIEScientificMethod.ts',
  );
} else {
  fail(
    'Scientific Method Pattern integration',
    'Scientific Method does not clearly consume Pattern Intelligence.',
    'Pass patternIntelligence into Scientific Method and use it in recalledMemory, hypotheses, challenges, predictions, and uncertaintyReductionActions.',
    'services/PIEScientificMethod.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIEPatternIntelligence',
    'patternIntelligence',
    'patternMatches',
    'earlyWarnings',
    'recurringPatterns',
    'patternBasedRecommendations',
    'patternConfidence',
    'Pattern context:',
  ])
) {
  pass(
    'PIE Core Pattern integration',
    'PIE Core builds and exposes Pattern Intelligence and uses patterns in recommendations.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Pattern integration',
    'PIE Core does not expose or use Pattern Intelligence.',
    'Build Pattern Intelligence in Core and expose patternIntelligence, patternMatches, earlyWarnings, recurringPatterns, patternBasedRecommendations, and patternConfidence.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(pieReporter, [
    'patternIntelligence',
    'patternMatches',
    'earlyWarnings',
    'patternBasedRecommendations',
    'patternReviewFlags',
    'patternReportBullets',
    'This issue has appeared in multiple updates',
    'Progress appears to have resumed after the prior delay',
  ])
) {
  pass(
    'PIE Reporter Pattern integration',
    'Reporter can use pattern context sparingly for review flags and useful history bullets.',
    'services/PIEReporter.ts',
  );
} else {
  fail(
    'PIE Reporter Pattern integration',
    'Reporter cannot use Pattern Intelligence context.',
    'Add pattern-aware report flags and limited history bullets without dumping raw pattern analysis.',
    'services/PIEReporter.ts',
  );
}

if (
  fileExists('docs/PIE_PatternIntelligenceModel.md') &&
  hasAll(
    piePatternIntelligenceModel +
      masterArchitecture +
      pieCoreIntelligencePlan +
      pieCognitiveArchitecture +
      pieCognitiveConstitution +
      jarvisQaDoc,
    [
      'Pattern Intelligence',
      'Recurring Pattern Detection',
      'Early Warning Signals',
      'Historical Recovery Patterns',
      'PIEPatternEngine',
    ],
  )
) {
  pass(
    'PIE Pattern Intelligence documentation',
    'Pattern Intelligence docs explain recurring patterns, early warnings, historical recovery patterns, and the Pattern Engine.',
    'docs/PIE_PatternIntelligenceModel.md, docs/PIE_MasterArchitecture.md, docs/PIE_CoreIntelligencePlan.md, docs/PIE_CognitiveArchitecture.md, docs/PIE_CognitiveConstitution.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'PIE Pattern Intelligence documentation',
    'Pattern Intelligence documentation is missing required concepts.',
    'Document Pattern Intelligence, recurring pattern detection, early warning signals, historical recovery patterns, and PIEPatternEngine.',
    'docs/',
  );
}

if (
  fileExists('services/PIEBeliefEngine.ts') &&
  hasAll(pieBeliefEngine, [
    'export type PIEBelief',
    'export type PIEBeliefType',
    'export type PIEBeliefStatus',
    'export type PIEBeliefConfidence',
    'export type PIEBeliefEvidence',
    'export type PIEBeliefContradiction',
    'export type PIEBeliefAssumption',
    'export type PIEBeliefRevision',
    'export type PIEBeliefHistory',
    'export type PIEBeliefExplanation',
    'export type PIEBeliefReadiness',
    'export type PIEBeliefUncertainty',
    'export type PIEBeliefChange',
    'progress',
    'schedule',
    'risk',
    'safety',
    'quality',
    'inspection',
    'contractor',
    'decision',
    'communication',
    'evidence_gap',
    'location',
    'issue',
    'completion',
    'readiness',
    'forming',
    'supported',
    'challenged',
    'weakened',
    'strengthened',
    'contradicted',
    'retired',
    'needs_verification',
    'Ready',
    'Needs Verification',
    'Uncertain',
    'Blocked',
  ])
) {
  pass(
    'PIE Belief Engine service',
    'PIEBeliefEngine exists with belief types, statuses, readiness, evidence, contradiction, assumption, revision, history, explanation, uncertainty, and change models.',
    'services/PIEBeliefEngine.ts',
  );
} else {
  fail(
    'PIE Belief Engine service',
    'PIEBeliefEngine is missing required types, statuses, or readiness language.',
    'Create services/PIEBeliefEngine.ts with the full belief model and readiness/status contract.',
    'services/PIEBeliefEngine.ts',
  );
}

if (
  hasAll(pieBeliefEngine, [
    'export function buildPIEBeliefs',
    'export function formBeliefsFromEvidence',
    'export function reviseBeliefs',
    'export function strengthenBelief',
    'export function weakenBelief',
    'export function retireBelief',
    'export function identifySupportingEvidence',
    'export function identifyContradictingEvidence',
    'export function identifyWeakestAssumption',
    'export function calculateBeliefReadiness',
    'export function explainBelief',
    'export function compareBeliefs',
    'export function summarizeBeliefChanges',
  ])
) {
  pass(
    'PIE Belief Engine functions',
    'Belief Engine exposes formation, revision, strengthening, weakening, retiring, evidence, contradiction, weakest assumption, readiness, explanation, comparison, and summary functions.',
    'services/PIEBeliefEngine.ts',
  );
} else {
  fail(
    'PIE Belief Engine functions',
    'Belief Engine is missing required functions.',
    'Add all requested belief formation, revision, evidence, readiness, explanation, comparison, and summary functions.',
    'services/PIEBeliefEngine.ts',
  );
}

if (
  hasAll(pieBeliefEngine, [
    'supportingEvidence',
    'contradictingEvidence',
    'weakestAssumption',
    'recommendedEvidence',
    'readinessReason',
    'reflectionBeliefChanges',
    'memoryRecall',
    'patternIntelligence',
    'scientificResult',
  ])
) {
  pass(
    'PIE Belief evidence and revision behavior',
    'Belief Engine separates supporting evidence, contradicting evidence, weakest assumptions, recommended evidence, readiness, memory, pattern, reflection, and scientific inputs.',
    'services/PIEBeliefEngine.ts',
  );
} else {
  fail(
    'PIE Belief evidence and revision behavior',
    'Belief Engine does not clearly separate evidence from beliefs or consume required inputs.',
    'Ensure Belief Engine uses Scientific Method, Pattern Intelligence, Memory Recall, and Reflection to form and revise beliefs.',
    'services/PIEBeliefEngine.ts',
  );
}

if (
  hasAll(pieScientificMethod, [
    'beliefCandidateHypotheses',
  ]) &&
  hasAll(pieBeliefEngine, [
    'PIEScientificResult',
    'hypotheses',
    'challenges',
    'uncertainty',
    'selectedDecision',
    'recommendedNextEvidence',
  ])
) {
  pass(
    'Scientific Method Belief integration',
    'Scientific Method produces belief candidates and Belief Engine consumes scientific hypotheses, challenges, uncertainty, selected decision, and recommended evidence.',
    'services/PIEScientificMethod.ts, services/PIEBeliefEngine.ts',
  );
} else {
  fail(
    'Scientific Method Belief integration',
    'Scientific Method and Belief Engine are not connected.',
    'Expose beliefCandidateHypotheses and consume Scientific Method hypotheses, challenges, uncertainty, selectedDecision, and recommendedNextEvidence in Belief Engine.',
    'services/PIEScientificMethod.ts, services/PIEBeliefEngine.ts',
  );
}

if (
  hasAll(piePatternEngine + pieBeliefEngine, [
    'beliefInfluences',
    'buildPatternBeliefInfluences',
    'Pattern Intelligence',
    'patternIntelligence',
    'strengthen',
    'weaken',
  ])
) {
  pass(
    'Pattern Belief integration',
    'Pattern Engine can influence belief strengthening or weakening and Belief Engine consumes pattern intelligence.',
    'services/PIEPatternEngine.ts, services/PIEBeliefEngine.ts',
  );
} else {
  fail(
    'Pattern Belief integration',
    'Pattern Engine cannot clearly influence beliefs.',
    'Add pattern belief influences and consume pattern intelligence when revising beliefs.',
    'services/PIEPatternEngine.ts, services/PIEBeliefEngine.ts',
  );
}

if (
  hasAll(pieMemoryRecall + reflectionEngine + pieBeliefEngine, [
    'relatedBeliefs',
    'beliefChanges',
    'lessonsLearned',
    'reflectionBeliefChanges',
  ])
) {
  pass(
    'Memory and Reflection Belief integration',
    'Memory retrieves related beliefs and Reflection belief changes feed the Belief Engine.',
    'services/PIEMemoryRecall.ts, services/PIEReflectionEngine.ts, services/PIEBeliefEngine.ts',
  );
} else {
  fail(
    'Memory and Reflection Belief integration',
    'Memory/Reflection are not clearly connected to belief changes.',
    'Expose related beliefs in Memory Recall and pass Reflection belief changes and lessons into the Belief Engine.',
    'services/PIEMemoryRecall.ts, services/PIEReflectionEngine.ts, services/PIEBeliefEngine.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIEBeliefs',
    'beliefSystem',
    'beliefChanges',
    'strongestBeliefs',
    'challengedBeliefs',
    'beliefsNeedingVerification',
    'beliefReadiness',
    'beliefExplanations',
    'Verify belief:',
    'Belief support:',
  ])
) {
  pass(
    'PIE Core Belief integration',
    'PIE Core exposes Belief Engine outputs and references beliefs in opinions and recommendations.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Belief integration',
    'PIE Core does not expose or use Belief Engine outputs.',
    'Build beliefs in Core and expose beliefs, beliefChanges, strongestBeliefs, challengedBeliefs, beliefsNeedingVerification, beliefReadiness, and beliefExplanations.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(pieReporter + attentionEngine + experienceEngine, [
    'beliefsNeedingVerification',
    'beliefReadiness',
    'Verify Belief',
    'Belief Engine',
    'beliefReviewFlags',
    'beliefReportBullets',
  ])
) {
  pass(
    'Reporter Experience Attention Belief integration',
    'Reporter uses belief context, Experience can ask for verification, and Attention prioritizes beliefs needing verification.',
    'services/PIEReporter.ts, services/PIEExperienceEngine.ts, services/PIEAttentionEngine.ts',
  );
} else {
  fail(
    'Reporter Experience Attention Belief integration',
    'Reporter, Experience, or Attention do not clearly consume belief verification context.',
    'Use beliefs in Reporter narrative, Experience verification flow, and Attention prioritization.',
    'services/PIEReporter.ts, services/PIEExperienceEngine.ts, services/PIEAttentionEngine.ts',
  );
}

if (
  fileExists('docs/PIE_BeliefModel.md') &&
  hasAll(
    pieBeliefModel +
      masterArchitecture +
      pieCoreIntelligencePlan +
      pieCognitiveArchitecture +
      pieCognitiveConstitution +
      jarvisQaDoc,
    [
      'Belief Formation',
      'Belief Revision',
      'Evidence vs Belief',
      'Belief Readiness',
      'Belief Explainability',
      'PIEBeliefEngine',
    ],
  )
) {
  pass(
    'PIE Belief documentation',
    'Belief docs explain belief formation, revision, evidence vs belief, readiness, explainability, and the Belief Engine.',
    'docs/PIE_BeliefModel.md, docs/PIE_MasterArchitecture.md, docs/PIE_CoreIntelligencePlan.md, docs/PIE_CognitiveArchitecture.md, docs/PIE_CognitiveConstitution.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'PIE Belief documentation',
    'Belief documentation is missing required concepts.',
    'Document Belief Formation, Belief Revision, Evidence vs Belief, Belief Readiness, Belief Explainability, and PIEBeliefEngine.',
    'docs/',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'runPIEScientificMethod',
    'scientificResult',
    'primaryHypothesis',
    'challengedAssumptions',
    'primaryUncertainty',
    'uncertaintyReductionActions',
    'decisionQualitySignals',
  ])
) {
  pass(
    'PIE Core Scientific Method integration',
    'PIECoreIntelligence consumes Scientific Method and exposes scientific outputs.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core Scientific Method integration',
    'PIECoreIntelligence does not consume or expose Scientific Method outputs.',
    'Call runPIEScientificMethod before final opinions/recommendations and expose scientificResult, primaryHypothesis, challengedAssumptions, primaryUncertainty, uncertaintyReductionActions, and decisionQualitySignals.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(pieCoreIntelligence + pieReporter, [
    'uncertaintyReductionActions',
    /Reduce uncertainty by|Recommended verification/i,
  ])
) {
  pass(
    'Scientific recommendation uncertainty reduction',
    'Core and Reporter include uncertainty reduction where practical.',
    'services/PIECoreIntelligence.ts, services/PIEReporter.ts',
  );
} else {
  fail(
    'Scientific recommendation uncertainty reduction',
    'Recommendations do not include uncertainty reduction where practical.',
    'Include uncertainty reduction in Core recommendations and Reporter review guidance.',
    'services/PIECoreIntelligence.ts, services/PIEReporter.ts',
  );
}

if (
  hasAll(
    masterArchitecture +
      pieCoreIntelligencePlan +
      productOperatingPlan +
      pieCognitiveArchitecture +
      pieDeliberationModel +
      jarvisQaDoc,
    [
      'Scientific Method',
      'PIE should not make important recommendations without evidence, hypothesis, self-challenge, uncertainty statement, and explanation.',
      'Uncertainty Reduction',
      'Hypothesis',
      'Self-Challenge',
      'Decision Quality',
    ],
  )
) {
  pass(
    'Scientific Method architecture docs',
    'Architecture and QA docs state PIE uses Scientific Method, uncertainty reduction, hypothesis testing, self-challenge, and decision quality.',
    'docs/PIE_MasterArchitecture.md, docs/PIE_CoreIntelligencePlan.md, docs/PIE_ProductOperatingPlan.md, docs/PIE_CognitiveArchitecture.md, docs/PIE_DeliberationModel.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'Scientific Method architecture docs',
    'Architecture or QA docs are missing Scientific Method operating rules.',
    'Document Scientific Method, Cognitive Constitution, uncertainty reduction, hypothesis testing, self-challenge, decision quality, and the important recommendation rule.',
    'docs/',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildRuntime',
    'buildPIEAttentionState',
    'buildPIEExperience',
    'buildPIEReportDraft',
    'Evidence Fusion',
    'Knowledge Graph',
    'Reflection',
    'Mission',
    'Executive',
    'Attention',
    'Experience',
    'Reporter',
    'Runtime',
  ])
) {
  pass(
    'PIE Core existing engine orchestration',
    'PIE Core Intelligence orchestrates existing Runtime, Attention, Experience, Reporter, Evidence Fusion, Knowledge Graph, Reflection, Mission, and Executive outputs instead of duplicating engine logic.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Core existing engine orchestration',
    'PIE Core Intelligence does not clearly connect to existing PIE engines.',
    'Build the core output from Runtime and existing PIE engine outputs rather than app-specific UI logic.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  fileExists('docs/PIE_CoreIntelligencePlan.md') &&
  hasAll(pieCoreIntelligencePlan + masterArchitecture + productOperatingPlan + jarvisQaDoc, [
    'reusable intelligence brain',
    'support multiple applications',
    'review data',
    'interpret evidence',
    'analyze relationships',
    'form beliefs',
    'form strong opinions',
    'recommend decisions',
    'explain reasoning',
    'identify missing data',
    'learn from corrections',
    'maintenance',
    'manufacturing',
    'safety',
    'compliance',
    'operations',
    'facilities',
    'logistics',
    'Apps do not own intelligence',
    'Apps collect input and display PIE output',
  ])
) {
  pass(
    'PIE Core Intelligence architecture',
    'Docs define PIE as a reusable intelligence brain, keep app ownership separate from intelligence ownership, and document domain adaptability.',
    'docs/PIE_CoreIntelligencePlan.md, docs/PIE_MasterArchitecture.md, docs/PIE_ProductOperatingPlan.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'PIE Core Intelligence architecture',
    'Core intelligence plan or app/intelligence ownership boundary is incomplete.',
    'Document PIE as a reusable intelligence brain, domain-ready platform, and clarify that apps collect input and display PIE output.',
    'docs/PIE_CoreIntelligencePlan.md, docs/PIE_MasterArchitecture.md, docs/PIE_ProductOperatingPlan.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
}

if (
  fileExists('services/PIEMemoryRecall.ts') &&
  hasAll(pieMemoryRecall, [
    'export type PIEMemoryRecallInput',
    'export type PIEMemoryRecallResult',
    'export type PIERelevantMemory',
    'export type PIEMemoryPattern',
    'export type PIEMemoryComparison',
    'export type PIEPastLesson',
    'export type PIEPastRecommendation',
    'export type PIEPastCorrection',
    'export type PIEMemoryInfluence',
    'export type PIEMemoryConfidence',
    'source',
    'dateTime',
    'project',
    'area',
    'summary',
    'whyRelevant',
    'confidence',
    'influence',
  ])
) {
  pass(
    'PIE Memory Recall service',
    'PIEMemoryRecall service exists with relevant memory, pattern, comparison, lesson, recommendation, correction, influence, and confidence types.',
    'services/PIEMemoryRecall.ts',
  );
} else {
  fail(
    'PIE Memory Recall service',
    'PIEMemoryRecall service or required recall types were not found.',
    'Create services/PIEMemoryRecall.ts with the requested recall types and memory fields.',
    'services/PIEMemoryRecall.ts',
  );
}

if (
  hasAll(pieMemoryRecall, [
    'export function buildPIEMemoryRecall',
    'export function findRelevantPastEvents',
    'export function findRelevantPastUpdates',
    'export function findRelevantPastPhotos',
    'export function findRelevantPastScheduleItems',
    'export function findRelevantPastRecommendations',
    'export function findRelevantCorrections',
    'export function findRelevantLessons',
    'export function compareNewEvidenceToPast',
    'export function buildMemoryInfluences',
    'export function summarizeRecallForPIE',
    'Have we seen this before',
    'recurring',
    'user_corrected_similar_item',
    'history_caution',
  ])
) {
  pass(
    'PIE Memory Recall behavior',
    'Memory Recall compares new evidence to past evidence, finds relevant history, detects recurrence/corrections, builds influences, and summarizes recall for PIE.',
    'services/PIEMemoryRecall.ts',
  );
} else {
  fail(
    'PIE Memory Recall behavior',
    'Memory Recall functions or comparison behavior are incomplete.',
    'Add recall functions for past events, updates, photos, schedules, recommendations, corrections, lessons, comparisons, influences, and PIE summary.',
    'services/PIEMemoryRecall.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    "from './PIEMemoryRecall'",
    'buildPIEMemoryRecall',
    'memoryRecall',
    'memoryInfluences',
    'pastLessons',
    'recurringPatterns',
    'similarPastEvents',
    'buildInterpretations(runtime, memoryRecall)',
    'buildPIEBeliefs',
    'buildOpinions(runtime, memoryRecall.memoryInfluences, deliberation, scientificResult, patternIntelligence, beliefSystem, executiveReasoning, predictionResult)',
    'buildRecommendations(runtime.recommendations, memoryRecall.memoryInfluences, deliberation, scientificResult, patternIntelligence, beliefSystem, executiveReasoning, predictionResult)',
    'buildExplanations(runtime, recommendations, memoryRecall, deliberation, scientificResult, patternIntelligence, beliefSystem, executiveReasoning, predictionResult)',
  ])
) {
  pass(
    'PIE Memory Recall Core integration',
    'PIE Core Intelligence consumes Memory Recall before forming interpretations, beliefs, opinions, recommendations, and explanations.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Memory Recall Core integration',
    'PIE Core Intelligence does not clearly consume Memory Recall.',
    'Use PIEMemoryRecall in PIECoreIntelligence before forming interpretations, beliefs, opinions, recommendations, and explanations.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(reflectionEngine, [
    'memoryRecall',
    'Past memory should influence DAVE interpretation',
    'User corrections indicate similar future assumptions should be treated carefully',
    'Lower confidence and ask for verification',
  ]) &&
  hasAll(pieReporter, [
    'memoryRecallSummary',
    'memoryInfluences',
    'recurringPatterns',
    'similarPastEvents',
    'memoryRecallReviewFlags',
    'memoryRecallReportBullets',
  ]) &&
  hasAll(attentionEngine + experienceEngine, [
    'memoryRecall',
    'Memory Recall',
    'memoryInfluences',
    'Verify History',
  ])
) {
  pass(
    'PIE Memory Recall engine integration',
    'Reflection produces recall-friendly lessons, Reporter can use past context, and Experience/Attention can use memory influence for verification.',
    'services/PIEReflectionEngine.ts, services/PIEReporter.ts, services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts',
  );
} else {
  fail(
    'PIE Memory Recall engine integration',
    'Memory Recall is not connected across Reflection, Reporter, Experience, and Attention.',
    'Connect recall lessons, report context, and verification/attention hooks.',
    'services/PIEReflectionEngine.ts, services/PIEReporter.ts, services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts',
  );
}

if (
  fileExists('docs/PIE_MemoryRecallModel.md') &&
  hasAll(pieMemoryRecallModel + masterArchitecture + pieCoreIntelligencePlan + productOperatingPlan + jarvisQaDoc, [
    'PIE uses past experience to interpret new evidence',
    'past project events',
    'past updates',
    'past photos',
    'past schedule items',
    'past recommendations',
    'past user corrections',
    'past reflection lessons',
    'recurring pattern',
    'user correction',
    'reflection-to-memory',
    'interpret new information',
  ])
) {
  pass(
    'PIE Memory Recall documentation',
    'Docs state that PIE uses past experience to interpret new information and define recall sources, relevance, comparisons, recurrence, corrections, and reflection loop.',
    'docs/PIE_MemoryRecallModel.md, docs/PIE_MasterArchitecture.md, docs/PIE_CoreIntelligencePlan.md, docs/PIE_ProductOperatingPlan.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'PIE Memory Recall documentation',
    'Memory Recall documentation or architecture alignment is incomplete.',
    'Document recall purpose, sources, relevance rules, comparisons, recurrence, correction learning, reflection loop, and PIE use of past experience.',
    'docs/PIE_MemoryRecallModel.md, docs/PIE_MasterArchitecture.md, docs/PIE_CoreIntelligencePlan.md, docs/PIE_ProductOperatingPlan.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
}

if (
  fileExists('docs/PIE_CognitiveArchitecture.md') &&
  fileExists('docs/PIE_DeliberationModel.md') &&
  hasAll(pieCognitiveArchitecture + pieDeliberationModel + masterArchitecture + pieCoreIntelligencePlan + productOperatingPlan + jarvisQaDoc, [
    'Observe',
    'Understand',
    'Recall',
    'Reason',
    'Form Beliefs',
    'Challenge Itself',
    'Decide',
    'Simulate',
    'Recommend',
    'Explain',
    'Reflect',
    'Learn',
    'Observation',
    'Understanding',
    'Memory',
    'Reflection',
    'Causal Reasoning',
    'Self-Challenge',
    'Trade-Off Analysis',
    'Constraint Awareness',
    'Decision Scoring',
    'Goal Awareness',
    'Scenario Simulation',
    'Strategic Memory',
    'Meta-Cognition',
    'Deliberation',
    'PIE should not recommend important actions without deliberating',
  ])
) {
  pass(
    'PIE Cognitive Architecture docs',
    'Cognitive Architecture and Deliberation docs exist and define the cognitive cycle, abilities, and deliberation-before-important-recommendations rule.',
    'docs/PIE_CognitiveArchitecture.md, docs/PIE_DeliberationModel.md, docs/PIE_MasterArchitecture.md, docs/PIE_CoreIntelligencePlan.md, docs/PIE_ProductOperatingPlan.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'PIE Cognitive Architecture docs',
    'Cognitive Architecture or Deliberation documentation is incomplete.',
    'Create the cognitive architecture and deliberation model docs and update architecture/product/core/JARVIS docs with cognitive abilities and deliberation rule.',
    'docs/PIE_CognitiveArchitecture.md, docs/PIE_DeliberationModel.md, docs/PIE_MasterArchitecture.md, docs/PIE_CoreIntelligencePlan.md, docs/PIE_ProductOperatingPlan.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
}

if (
  fileExists('services/PIEDeliberationEngine.ts') &&
  hasAll(pieDeliberationEngine, [
    'export type PIEDeliberationResult',
    'export type PIEDeliberationQuestion',
    'export type PIEDeliberationAssumption',
    'export type PIEDeliberationAlternative',
    'export type PIEDeliberationTradeoff',
    'export type PIEDeliberationContradiction',
    'export type PIEDeliberationUncertainty',
    'export type PIEDeliberationRecommendation',
    'export type PIEDeliberationDecisionScore',
    'export function buildPIEDeliberation',
    'export function identifyAssumptions',
    'export function identifyContradictions',
    'export function identifyMissingEvidence',
    'export function buildAlternatives',
    'export function scoreAlternatives',
    'export function compareTradeoffs',
    'export function buildDeliberatedRecommendation',
    'export function explainDeliberation',
    'recommendedAction',
    'decisionScore',
    'whyRecommended',
    'alternativesConsidered',
    'tradeoffs',
    'assumptions',
    'missingEvidence',
    'contradictions',
    'uncertainty',
    'whatWouldChangeRecommendation',
    'recommendationReadiness',
    'Ready',
    'Needs Verification',
    'Uncertain',
    'Blocked',
  ])
) {
  pass(
    'PIE Deliberation Engine',
    'PIEDeliberationEngine exists with required types, functions, output fields, and readiness language.',
    'services/PIEDeliberationEngine.ts',
  );
} else {
  fail(
    'PIE Deliberation Engine',
    'PIEDeliberationEngine service or required deliberation contract is incomplete.',
    'Create PIEDeliberationEngine with assumptions, contradictions, missing evidence, alternatives, scores, trade-offs, recommendation, explanation, and readiness output.',
    'services/PIEDeliberationEngine.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    "from './PIEDeliberationEngine'",
    'buildPIEDeliberation',
    'deliberation',
    'assumptions',
    'alternatives',
    'tradeoffs',
    'recommendationReadiness',
    'whatWouldChangeRecommendation',
    'buildOpinions(runtime, memoryRecall.memoryInfluences, deliberation, scientificResult, patternIntelligence, beliefSystem, executiveReasoning, predictionResult)',
    'buildRecommendations(runtime.recommendations, memoryRecall.memoryInfluences, deliberation, scientificResult, patternIntelligence, beliefSystem, executiveReasoning, predictionResult)',
    'buildExplanations(runtime, recommendations, memoryRecall, deliberation, scientificResult, patternIntelligence, beliefSystem, executiveReasoning, predictionResult)',
  ]) &&
  hasAll(attentionEngine + experienceEngine + pieReporter, [
    'deliberation',
    'recommendationReadiness',
    'whatWouldChangeRecommendation',
    'Deliberation',
  ])
) {
  pass(
    'PIE Deliberation integration',
    'PIE Core consumes Deliberation before recommendations/opinions and Attention, Experience, and Reporter can use deliberated readiness and alternatives.',
    'services/PIECoreIntelligence.ts, services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts, services/PIEReporter.ts',
  );
} else {
  fail(
    'PIE Deliberation integration',
    'Deliberation is not connected through Core, Attention, Experience, and Reporter.',
    'Connect PIEDeliberationEngine into Core output and use readiness/alternatives where practical downstream.',
    'services/PIECoreIntelligence.ts, services/PIEAttentionEngine.ts, services/PIEExperienceEngine.ts, services/PIEReporter.ts',
  );
}

if (
  fileExists('services/PIEExperienceEngine.ts') &&
  hasAll(experienceEngine, [
    'export type PIEExperienceState',
    'export type PIEExperienceMode',
    'export type PIEExperienceAction',
    'export type PIEExperienceTransition',
    'export type PIEExperienceContext',
    'export type PIEExperienceOutput',
    'greeting',
    'mission',
    'collect_evidence',
    'confirm_location',
    'capture_photo',
    'capture_note',
    'verify_progress',
    'continue_walk',
    'finish_walk',
    'review_walk_update',
    'report_ready',
    'report_needs_review',
    'report_editing',
    'report_approved',
    'communicate_ready',
    'communication_complete',
    'thinking',
    'review',
    'communicate',
    'complete',
    'blocked',
    'morning',
    'field_walk',
    'report_review',
    'schedule_review',
    'issue_review',
    'monitor',
    'confirm',
    'capture',
    'correct',
    'approve',
    'wait',
  ])
) {
  pass(
    'PIE Experience Engine',
    'PIEExperienceEngine exists with required states, modes, actions, transition, context, and output types.',
    'services/PIEExperienceEngine.ts',
  );
} else {
  fail(
    'PIE Experience Engine',
    'PIEExperienceEngine service or required experience state/mode/action types were not found.',
    'Create services/PIEExperienceEngine.ts with the required state machine contract.',
    'services/PIEExperienceEngine.ts',
  );
}

if (
  hasAll(experienceEngine, [
    'export function buildPIEExperience',
    'export function buildPIEWalkExperience',
    'export function getExperienceState',
    'export function getExperienceMode',
    'export function getPrimaryMessage',
    'export function getExperienceReason',
    'export function getPrimaryAction',
    'export function getSecondaryAction',
    'export function getNextExperienceState',
    'export function getExperienceTransition',
    'currentState',
    'primaryMessage',
    'reason',
    'primaryAction',
    'secondaryAction',
    'nextState',
    'confidence',
    'needsUserInput',
    'userActionType',
    'currentProject',
    'currentArea',
    'reportTitle',
    'reportReadiness',
    'reviewWarnings',
  ])
) {
  pass(
    'PIE Experience output contract',
    'Experience output includes currentState, mode, primaryMessage, reason, primaryAction, secondaryAction, nextState, confidence, needsUserInput, userActionType, currentProject, and currentArea.',
    'services/PIEExperienceEngine.ts',
  );
} else {
  fail(
    'PIE Experience output contract',
    'Experience Engine functions or output contract fields are incomplete.',
    'Expose the required Experience Engine functions and output fields.',
    'services/PIEExperienceEngine.ts',
  );
}

if (
  hasAll(experienceEngine, [
    'buildPIEReviewExperience',
    'report_ready',
    'report_needs_review',
    'report_editing',
    'report_approved',
    'communicate_ready',
    'communication_complete',
    'reportDraft',
    'reportReadiness',
    'reviewFlags',
    'actionItems',
    'imageReferences',
    'combinedUpdateSelectedItems',
    'scheduleImportStatus',
    'photo progress',
    'missing owner',
    'uncertain schedule impact',
    'missing supporting photos',
  ])
) {
  pass(
    'PIE Experience Review states',
    'Experience Engine decides Review steps from reporter draft status, readiness, flags, action items, image references, confidence, missing evidence, schedule status, photo progress, and combined-update selection.',
    'services/PIEExperienceEngine.ts',
  );
} else {
  fail(
    'PIE Experience Review states',
    'Experience Engine Review state handling is incomplete.',
    'Add report_ready, report_needs_review, report_editing, report_approved, communicate_ready, and communication_complete handling from report context.',
    'services/PIEExperienceEngine.ts',
  );
}

if (
  hasAll(experienceEngine, [
    'buildPIEWalkExperience',
    'confirm_location',
    'capture_photo',
    'capture_note',
    'verify_progress',
    'continue_walk',
    'finish_walk',
    'review_walk_update',
    'gpsRecommendation',
    'currentProject',
    'currentArea',
    'schedulePriority',
    'missingEvidence',
    'photoProgressStatus',
    'lastCapturedPhoto',
    'walkCompletionState',
    'Photo saved. Next, verify',
  ])
) {
  pass(
    'PIE Experience Walk states',
    'Experience Engine decides Walk steps from GPS, project, area, schedule priority, missing evidence, photo progress, last captured photo, and completion state.',
    'services/PIEExperienceEngine.ts',
  );
} else {
  fail(
    'PIE Experience Walk states',
    'Experience Engine Walk state handling is incomplete.',
    'Add confirm_location, capture_photo, capture_note, verify_progress, continue_walk, finish_walk, and review_walk_update handling from Walk context.',
    'services/PIEExperienceEngine.ts',
  );
}

if (
  fileExists('services/PIELearningEngine.ts') &&
  hasAll(pieLearningEngine, [
    'export type PIELearningSignal',
    'export type PIELearningEvent',
    'export type PIELearningSource',
    'export type PIELearningOutcome',
    'export type PIELearningLesson',
    'export type PIELearningAdjustment',
    'export type PIELearningPatternUpdate',
    'export type PIELearningBeliefUpdate',
    'export type PIELearningConfidenceCalibration',
    'export type PIELearningRecommendationImprovement',
    'export type PIELearningMemoryConsolidation',
    'export type PIELearningResult',
    'export function buildPIELearning',
    'export function extractLearningSignals',
    'export function learnFromUserCorrections',
    'export function learnFromReportApproval',
    'export function learnFromReportEdits',
    'export function learnFromRecommendationOutcome',
    'export function learnFromPredictionOutcome',
    'export function learnFromReflection',
    'export function calibrateConfidence',
    'export function updatePatternLearning',
    'export function updateBeliefLearning',
    'export function consolidateMemory',
    'export function buildFutureAdjustment',
    'export function summarizeLearning',
  ])
) {
  pass(
    'PIE Continuous Learning Engine',
    'Learning Engine exists with learning signals, outcomes, lessons, adjustments, calibration, memory consolidation, and required functions.',
    'services/PIELearningEngine.ts',
  );
} else {
  fail(
    'PIE Continuous Learning Engine',
    'Learning Engine service or required continuous learning contract was not found.',
    'Create services/PIELearningEngine.ts with the requested types and functions.',
    'services/PIELearningEngine.ts',
  );
}

if (
  hasAll(pieLearningEngine, [
    'user_correction',
    'report_approval',
    'report_edit',
    'recommendation_accepted',
    'recommendation_rejected',
    'prediction_confirmed',
    'prediction_failed',
    'reflection_lesson',
    'pattern_match',
    'schedule_change',
    'photo_evidence',
    'GPS_correction',
    'decision_outcome',
    'whatPIELearned',
    'shouldTrustMore',
    'shouldTrustLess',
    'futureBehavior',
  ])
) {
  pass(
    'PIE Continuous Learning sources',
    'Learning Engine supports all requested sources and answers trust/future behavior questions.',
    'services/PIELearningEngine.ts',
  );
} else {
  fail(
    'PIE Continuous Learning sources',
    'Learning sources or learning questions are incomplete.',
    'Add all required learning sources and output what PIE learned, what to trust more/less, and future behavior.',
    'services/PIELearningEngine.ts',
  );
}

if (
  hasAll(reflectionEngine, [
    "from './PIELearningEngine'",
    'learningSignals',
    'buildReflectionLearningSignals',
  ])
) {
  pass(
    'PIE Learning Reflection integration',
    'Reflection produces learning signals for the Learning Engine.',
    'services/PIEReflectionEngine.ts',
  );
} else {
  fail(
    'PIE Learning Reflection integration',
    'Reflection does not expose learning signals.',
    'Connect Reflection lessons and belief/confidence changes into Learning signals.',
    'services/PIEReflectionEngine.ts',
  );
}

if (
  hasAll(pieMemoryRecall, [
    "from './PIELearningEngine'",
    'learningResult',
    'findRelevantLearning',
    'learning_signal',
    'preference pattern',
    'user correction pattern',
  ])
) {
  pass(
    'PIE Learning Memory integration',
    'Memory Recall consumes learning signals and converts them into future influences.',
    'services/PIEMemoryRecall.ts',
  );
} else {
  fail(
    'PIE Learning Memory integration',
    'Memory Recall does not clearly consume Learning output.',
    'Feed learningResult into Memory Recall and convert memoryConsolidation into recall influences.',
    'services/PIEMemoryRecall.ts',
  );
}

if (
  hasAll(piePatternEngine, [
    "from './PIELearningEngine'",
    'learningResult',
    'patternUpdates',
    'recommendationImprovements',
    'continuous_learning',
  ]) &&
  hasAll(pieBeliefEngine, [
    "from './PIELearningEngine'",
    'learningResult',
    'beliefUpdates',
    'confidenceCalibration',
  ]) &&
  hasAll(piePredictiveEngine, [
    "from './PIELearningEngine'",
    'learningResult',
    'confidenceCalibration',
    'prediction_failed',
  ])
) {
  pass(
    'PIE Learning cognitive integration',
    'Pattern, Belief, and Prediction engines consume Learning output for updates and calibration.',
    'services/PIEPatternEngine.ts, services/PIEBeliefEngine.ts, services/PIEPredictiveEngine.ts',
  );
} else {
  fail(
    'PIE Learning cognitive integration',
    'Pattern, Belief, or Prediction engines do not clearly consume Learning output.',
    'Wire learningResult into Pattern updates, Belief confidence changes, and Prediction confidence calibration.',
    'services/PIEPatternEngine.ts, services/PIEBeliefEngine.ts, services/PIEPredictiveEngine.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    "from './PIELearningEngine'",
    'buildPIELearning',
    'learningResult',
    'learningSignals',
    'lessonsLearned',
    'confidenceCalibration',
    'futureAdjustments',
    'memoryConsolidation',
    'decisionQualityLearning',
    'Continuous Learning',
  ])
) {
  pass(
    'PIE Learning Core integration',
    'Core Intelligence builds and exposes Learning output.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Learning Core integration',
    'Core Intelligence does not expose required Learning outputs.',
    'Build Learning in PIECoreIntelligence and expose learningSignals, lessonsLearned, confidenceCalibration, futureAdjustments, memoryConsolidation, and decisionQualityLearning.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  hasAll(pieReporter, [
    "from './PIELearningEngine'",
    'learningResult',
    'learningReviewFlags',
    'learningReportBullets',
    'Report style note',
    'Continuous Learning found a report style preference',
  ])
) {
  pass(
    'PIE Learning Reporter integration',
    'Reporter consumes Learning for report style, confidence wording, recommendations, and review warnings.',
    'services/PIEReporter.ts',
  );
} else {
  fail(
    'PIE Learning Reporter integration',
    'Reporter does not clearly consume Learning output.',
    'Use Learning output to improve report style, confidence wording, recommendations, and review warnings without auto-sending.',
    'services/PIEReporter.ts',
  );
}

if (
  hasAll(
    pieContinuousLearningModel +
      masterArchitecture +
      pieCoreIntelligencePlan +
      pieCognitiveArchitecture +
      pieCognitiveConstitution +
      jarvisQaDoc,
    [
      'Continuous Learning',
      'Outcome-Based Learning',
      'Confidence Calibration',
      'Memory Consolidation',
      'Decision Quality Learning',
      'Report Style Learning',
      'user_correction',
      'report_approval',
      'prediction_failed',
      'GPS_correction',
    ],
  )
) {
  pass(
    'PIE Continuous Learning documentation',
    'Learning model, architecture, core plan, cognitive docs, and QA document continuous learning responsibilities.',
    'docs/PIE_ContinuousLearningModel.md, docs/PIE_MasterArchitecture.md, docs/PIE_CoreIntelligencePlan.md, docs/PIE_CognitiveArchitecture.md, docs/PIE_CognitiveConstitution.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'PIE Continuous Learning documentation',
    'Continuous Learning documentation is incomplete.',
    'Document Continuous Learning, Outcome-Based Learning, Confidence Calibration, Memory Consolidation, Decision Quality Learning, and Report Style Learning across model, architecture, cognitive, and QA docs.',
    'docs/PIE_ContinuousLearningModel.md',
  );
}

if (
  hasAll(experienceEngine, [
    "from './PIEAttentionEngine'",
    "from './PIERuntime'",
    'attentionState',
    'runtime',
    'Runtime, Mission, Executive, Schedule Intelligence, Evidence Fusion, Photo Progress, GPS Walk recommendation, Reporter readiness, and Attention output',
  ])
) {
  pass(
    'PIE Experience inputs',
    'Experience Engine consumes Attention and Runtime-backed outputs instead of duplicating intelligence.',
    'services/PIEExperienceEngine.ts',
  );
} else {
  fail(
    'PIE Experience inputs',
    'Experience Engine does not clearly consume Attention/Runtime or the existing PIE output chain.',
    'Keep Experience Engine focused on user flow and consume PIEAttentionEngine plus PIERuntime outputs.',
    'services/PIEExperienceEngine.ts',
  );
}

if (
  fileExists('services/PIEReflectionEngine.ts') &&
  hasAll(reflectionEngine, [
    'export type PIEReflection',
    'export type PIEReflectionEvent',
    'export type PIELessonLearned',
    'export type PIEBeliefChange',
    'export type PIEConfidenceChange',
    'export type PIERecommendationImprovement',
    'export type PIEReflectionSummary',
    'export function buildPIEReflection',
    'export function buildDailyReflection',
    'export function inferReflectionEvent',
    'whatChanged',
    'previousBeliefs',
    'beliefsStrengthened',
    'beliefsWeakened',
    'outstandingUnknowns',
    'recommendedEvidence',
    'reflectionConfidence',
  ])
) {
  pass(
    'PIE Reflection Engine',
    'Reflection Engine exists with reflection types, lessons, belief changes, confidence changes, recommendation improvements, summaries, daily reflection, and event inference.',
    'services/PIEReflectionEngine.ts',
  );
} else {
  fail(
    'PIE Reflection Engine',
    'Reflection Engine service or required learning contract was not found.',
    'Create services/PIEReflectionEngine.ts with the requested reflection types and functions.',
    'services/PIEReflectionEngine.ts',
  );
}

if (
  hasAll(reflectionEngine, [
    'schedule_import',
    'accepted_photo',
    'accepted_note',
    'gps_correction',
    'project_correction',
    'area_correction',
    'report_approval',
    'walk_completion',
    'daily_reflection',
    'What changed',
    'What did DAVE previously believe',
    'Was DAVE wrong',
    'Was DAVE correct',
    'What still needs verification',
    'What should DAVE do differently next time',
  ])
) {
  pass(
    'PIE Reflection triggers and questions',
    'Reflection supports all requested events and answers the required learning questions.',
    'services/PIEReflectionEngine.ts',
  );
} else {
  fail(
    'PIE Reflection triggers and questions',
    'Reflection events or required learning questions are incomplete.',
    'Add schedule/photo/note/GPS/project/area/report/walk/daily events and answer what changed, previous belief, correctness, verification, and next behavior.',
    'services/PIEReflectionEngine.ts',
  );
}

if (
  hasAll(runtime, [
    "from './PIEReflectionEngine'",
    'buildPIEReflection',
    'buildReflectionOutputsFromState',
    'reflectionSummary',
    'lessonsLearned',
    'beliefChanges',
    'confidenceChanges',
    'recommendedEvidence',
    'reflectionConfidence',
  ])
) {
  pass(
    'PIE Reflection Runtime contract',
    'Runtime builds Reflection output and exposes reflectionSummary, lessonsLearned, beliefChanges, confidenceChanges, recommendedEvidence, and reflectionConfidence.',
    'services/PIERuntime.ts',
  );
} else {
  fail(
    'PIE Reflection Runtime contract',
    'Runtime does not expose the required Reflection outputs.',
    'Build Reflection from Runtime state and expose summary, lessons, belief changes, confidence changes, recommended evidence, and reflection confidence.',
    'services/PIERuntime.ts',
  );
}

if (
  hasAll(experienceEngine, [
    'runtime.recommendedEvidence',
    'runtime.beliefChanges',
    "change.direction === 'weakened'",
    'Reflection recommends collecting',
  ])
) {
  pass(
    'PIE Reflection Experience integration',
    'Experience consumes Reflection so missing evidence drives collection and weakened beliefs drive verification.',
    'services/PIEExperienceEngine.ts',
  );
} else {
  fail(
    'PIE Reflection Experience integration',
    'Experience does not clearly consume Reflection outputs.',
    'Use Runtime reflection recommendedEvidence and weakened beliefChanges to choose collect/verify experience states.',
    'services/PIEExperienceEngine.ts',
  );
}

if (
  hasAll(pieReporter, [
    'reflectionReviewFlags',
    'recommendedEvidence',
    'beliefChanges',
    'reflectionConfidence',
    'Reflection weakened at least one project belief',
    'Reflection recommends more evidence',
  ])
) {
  pass(
    'PIE Reflection Reporter integration',
    'Reporter consumes Reflection indirectly through confidence/review warnings rather than putting raw Reflection in the report body.',
    'services/PIEReporter.ts',
  );
} else {
  fail(
    'PIE Reflection Reporter integration',
    'Reporter does not clearly consume Reflection for report review quality.',
    'Use Reflection to improve review flags, confidence wording, action recommendations, and narrative quality without pasting raw Reflection into reports.',
    'services/PIEReporter.ts',
  );
}

if (
  hasAll(productOperatingPlan + masterArchitecture + jarvisQaDoc, [
    'Reflection Layer',
    'Continuous Learning',
    'Reflection Events',
    'Reflection Responsibilities',
    'Evidence Fusion',
    'Knowledge Graph',
    'Reflection',
    'Beliefs',
    'Project Objects',
    'Prediction',
    'Core Brain',
    'Experience',
    'Reporter',
    'App',
    'Runtime exposes reflectionSummary, lessonsLearned, beliefChanges, confidenceChanges, recommendedEvidence, and reflectionConfidence',
  ])
) {
  pass(
    'PIE Reflection documentation',
    'Product plan, Master Architecture, and JARVIS QA document Reflection as the continuous learning layer and active QA contract.',
    'docs/PIE_ProductOperatingPlan.md, docs/PIE_MasterArchitecture.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'PIE Reflection documentation',
    'Reflection architecture or QA documentation is incomplete.',
    'Document Reflection Layer, Continuous Learning, events, responsibilities, architecture sequence, and Runtime/JARVIS outputs.',
    'docs/PIE_ProductOperatingPlan.md, docs/PIE_MasterArchitecture.md, docs/ProjectVisionAI_JARVIS_QA.md',
  );
}

if (
  hasAll(homeDashboard, [
    'usePIELiveAuthority',
    "Today's Priority",
    'liveAuthority.projectTruth.briefing.nextActions',
    'topPriority.taskCount',
    'topPriority.scheduleHealth',
    'Review priority',
  ])
) {
  pass(
    'Today Experience integration',
    'Overview turns live DAVE authority into one current priority, supporting reason, schedule context, and one review action.',
    'App.tsx',
  );
} else {
  fail(
    'Today Experience integration',
    'Overview does not clearly render the current DAVE priority and one next action.',
    'Render the live project-truth priority, current task and schedule facts, and one dominant review action on Overview.',
    'App.tsx',
  );
}

if (
  hasAll(homeDashboard, [
    'timeOfDayGreeting(displayName)',
    "Today's Priority",
    'Project Health',
    'No immediate priority',
    'Review priority',
    'Observed today:',
  ])
) {
  pass(
    'PIE Mission screen',
    'Overview starts with a greeting, project health, one current priority, evidence context, and one dominant review action.',
    'App.tsx',
  );
} else {
  fail(
    'PIE Mission screen',
    'Overview priority placement or simplified decision language was not detected.',
    'Keep greeting, project health, current priority, supporting evidence, and one review action near the top of Overview.',
    'App.tsx',
  );
}

const forbiddenNormalUiTerms = [
  'Scientific Method',
  'Pattern Engine',
  'Belief Engine',
  'Deliberation',
  'Reflection Engine',
  'Learning Engine',
  'Runtime',
  'Knowledge Graph',
  'Evidence Fusion',
  'Core Intelligence',
  'Prediction Engine',
  'Confidence:',
  'Confidence %',
  'raw diagnostics',
  'OCR endpoint',
  'API endpoint',
  'Supabase',
  'REST',
  'JSON',
  'stack trace',
];
function containsStandaloneTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(text);
}

const leakedNormalUiTerms = forbiddenNormalUiTerms.filter(term =>
  containsStandaloneTerm(normalUserUiText, term),
);

if (
  leakedNormalUiTerms.length === 0 &&
  hasAll(adminScreen, [
    'Advanced / Diagnostics',
    'Developer Support',
    'Diagnostics',
  ]) &&
  hasAll(app, ['ScheduleImportFlow', 'Capture Evidence']) &&
  hasAll(
    app + reportsScreen,
    [
      'Evidence support',
      'Needs Review',
      'Why:',
    ],
  )
) {
  pass(
    'PIE invisible intelligence cleanup',
    'Normal UI hides cognitive engine names, raw diagnostics, endpoint wording, vendor names, JSON/REST details, and confidence percentages while Developer Tools remains reachable.',
    'App.tsx, components, screens, scripts/jarvis-qa.js',
  );
} else {
  fail(
    'PIE invisible intelligence cleanup',
    leakedNormalUiTerms.length
      ? `Normal UI exposes internal terms: ${leakedNormalUiTerms.join(', ')}.`
      : 'Plain-language markers or Developer Tools placement markers were not detected.',
    'Replace normal UI text with what matters, why, what PIE needs, and the next action; keep raw diagnostics only in Developer Tools.',
    'App.tsx, components, screens',
  );
}

if (
  hasAll(app, [
    'function AddPhotosScreen',
    'Capture Evidence',
    'Why:',
    'Accept Suggested Area',
    'onChangeArea',
    'onTakePhoto',
    'onNext',
    'Photo saved.',
    'Add Another Photo',
    'Add Note',
    'Add Document',
    'Continue',
  ])
) {
  pass(
    'Capture Experience integration',
    'Capture consumes PIEExperienceEngine, starts with PIE guidance, preserves correction and capture controls, keeps users in Capture after photo capture, and keeps document, note, issue, and safety actions reachable.',
    'App.tsx',
  );
} else {
  fail(
    'Capture Experience integration',
    'Guided Capture Experience Engine integration markers were not detected.',
    'Use buildPIEWalkExperience in PhotoCapturePanel with GuidedCaptureCard, one dominant primary action, location correction, after-photo recommendation, and secondary Upload Document, Add Note, Add Issue, and Add Safety actions.',
    'App.tsx',
  );
}

if (
  hasAll(reportsScreen, [
    'BeforeYouSharePanel',
    'Report Check',
    'Prepared Report',
    'Edit Report',
    'Approve Report',
    'Share Report',
    'Copy Report',
    'Email Report',
    'Fix before approval',
    'reportApproved',
    'reportApproved && reportApprovalAllowed && shareOpen',
    'No report is sent automatically',
    'Project Status Details',
    'Read the report and approve it when it matches the current project status.',
  ]) &&
  !hasAny(reportsScreen, [
    'Validation Requests',
    'Evidence & Uncertainty',
    'HOW THIS CONCLUSION WAS REACHED',
    'Draft recovery mode:',
  ]) &&
  hasAll(app, [
    'async function emailReport',
    'MailComposer.composeAsync',
    'body: report.body',
  ])
) {
  pass(
    'Review Experience integration',
    'Review presents a concise PM report check, keeps internal diagnostics out of the report surface, approval-gates copy/email, avoids automatic sending, and keeps existing report functions reachable.',
    'screens/ReportsScreen.tsx, App.tsx',
  );
} else {
  fail(
    'Review Experience integration',
    'The concise report check or approval boundary markers were not detected.',
    'Keep internal diagnostics out of the published report, show actionable PM warnings, require approval before copy/email, and preserve existing report actions.',
    'screens/ReportsScreen.tsx, App.tsx',
  );
}

if (
  hasAll(bottomNav, [
    /label=["']Overview["']/,
    /label=["']Tasks["']/,
    'Talk',
    /label=["']Reports["']/,
    "onPress={() => onChange('Home')}",
    "onPress={() => onChange('Schedule')}",
    'onPress={onTalk}',
    "onPress={() => onChange('Reports')}",
  ]) &&
  !hasAny(bottomNav, [/label=["']More["']/]) &&
  (bottomNav.match(/<TabButton/g) || []).length === 3 &&
  bottomNav.indexOf('label="Overview"') < bottomNav.indexOf('label="Tasks"') &&
  bottomNav.indexOf('label="Tasks"') < bottomNav.indexOf('onPress={onTalk}') &&
  bottomNav.indexOf('onPress={onTalk}') < bottomNav.indexOf('label="Reports"')
) {
  pass(
    'Bottom navigation',
    'The live workflow labels Overview, Tasks, Talk, and Reports are present in the correct order.',
    'components/app-bottom-tabs.tsx',
  );
} else {
  fail(
    'Bottom navigation',
    'One or more required workflow bottom nav labels are missing or out of order.',
    'Ensure the live bottom navigation exposes Overview, Tasks, Talk, and Reports in workflow order.',
    'components/app-bottom-tabs.tsx',
  );
}

if (
  !hasAny(bottomNav, [
    /label=["']Projects["']/,
    /label=["']Schedule["']/,
    /label=["']Diagnostics["']/,
    /label=["']Developer Tools["']/,
  ]) &&
  hasAll(adminScreen, [
    'Settings',
    'Advanced / Diagnostics',
    'Developer Support',
    'Diagnostics',
  ]) &&
  hasAll(app, [
    "onSettings={() => setScreen('Admin')}",
    "onOpenDocuments={() => setScreen('ProjectDocuments')}",
    'Archived Projects',
    'View All Activity',
    "onDiagnostics={() => setScreen('Diagnostics')}",
  ])
) {
  pass(
    'PIE minimal navigation collapse',
    'Projects, Schedule, Documents, History, Admin, and Diagnostics remain reachable from Home overflow / More while Developer Tools and Diagnostics are not primary navigation.',
    'components/app-bottom-tabs.tsx, screens/AdminScreen.tsx, App.tsx',
  );
} else {
  fail(
    'PIE minimal navigation collapse',
    'More organization or secondary workflow reachability is incomplete.',
    'Keep daily navigation minimal and expose Projects, Documents, History, Settings, Admin, and Developer Tools from secondary surfaces.',
    'components/app-bottom-tabs.tsx, screens/AdminScreen.tsx, App.tsx',
  );
}

if (
  hasAll(homeDashboard, [
    "Today's Priority",
    'Review priority',
    'Active Projects',
    'Recent Activity',
  ]) &&
  hasAll(reportsScreen, [
    'BeforeYouSharePanel',
    'Report Check',
    'Fix before approval',
  ]) &&
  hasAll(photoCapture, [
    'Capture Evidence',
    'Accept Suggested Area',
    'Add Another Photo',
    'Add Note',
  ])
) {
  pass(
    'ECOS UI simplification workflow',
    'Overview presents one actionable priority, Capture keeps guided collection, and Review presents a concise PM report check.',
    'App.tsx, screens/ReportsScreen.tsx',
  );
} else {
  fail(
    'ECOS UI simplification workflow',
    'JARVIS cannot verify actionable summaries, guided Capture, or the concise PM report check.',
    'Keep Overview action-led, Capture guided, and Review focused on current facts and actionable approval warnings.',
    'App.tsx, screens/ReportsScreen.tsx',
  );
}

if (
  fileExists('docs/PIE_ExperienceConstitution.md') &&
  hasAll(pieExperienceConstitution, [
    'One screen, one purpose.',
    'One dominant primary action.',
    'PIE leads; the user verifies.',
    'The user should not search for workflows.',
    'The user should not configure daily workflows.',
    'PIE asks only for the minimum evidence needed.',
    'Every interaction should reduce uncertainty.',
    'Advanced tools live under More.',
    'Never expose internal cognitive models to normal users.',
    'The interface should become simpler as PIE becomes smarter.',
  ])
) {
  pass(
    'PIE Experience Constitution',
    'Experience Constitution exists with the minimal interface rules.',
    'docs/PIE_ExperienceConstitution.md',
  );
} else {
  fail(
    'PIE Experience Constitution',
    'Experience Constitution is missing or incomplete.',
    'Create docs/PIE_ExperienceConstitution.md with the minimal experience rules.',
    'docs/PIE_ExperienceConstitution.md',
  );
}

if (
  hasAll(scheduleScreen + app, [
    'ScheduleImportFlow',
    'onImportFile={onImport}',
    'Confirm the highlighted fields before adding them',
  ])
) {
  pass(
    'Schedule import',
    'The live schedule workflow extracts draft items and requires confirmation before adding them.',
    'App.tsx, components/ScheduleImportFlow.tsx',
  );
} else {
  fail(
    'Schedule import',
    'The production schedule import and confirmation path was not found.',
    'Keep ScheduleImportFlow wired to draft extraction and explicit confirmation.',
    'App.tsx, components/ScheduleImportFlow.tsx',
  );
}

if (
  hasAll(scheduleScreen + app, [
    'isDavePdfTextExtractionAvailable',
    'isDaveTextRecognitionAvailable',
    'no dated activities were extracted',
  ]) &&
  !app.includes('extractScheduleItemsWithAiEndpoint') &&
  !adminScreen.includes('Advanced schedule OCR endpoint')
) {
  pass(
    'Schedule import',
    'Schedule import uses bounded local extraction, has a user-facing failure path, and exposes no arbitrary upload endpoint.',
    'App.tsx',
  );
} else {
  fail(
    'Schedule import',
    'Safe local schedule extraction or its failure handling was not found.',
    'Preserve bounded local extraction and clear failure handling without a user-configurable upload endpoint.',
    'App.tsx',
  );
}

if (
  hasAll(app + runtime + piePanel, [
    'setScheduleItems',
    'scheduleItems',
    'buildRuntime',
  ])
) {
  pass(
    'PIE schedule path',
    'Schedule items are stored in app state and flow into Runtime-backed PIE surfaces.',
    'App.tsx, services/PIERuntime.ts, components/PIEPanel.tsx',
  );
} else {
  warn(
    'PIE schedule path',
    'Schedule items may not be flowing into Runtime/PIE.',
    'Verify imported schedule items are passed to Runtime, project cards, Today priorities, and Review.',
    'App.tsx, services/PIERuntime.ts',
  );
}

if (
  fileExists('services/PIEEvidenceFusion.ts') &&
  hasAll(evidenceFusion, [
    'export type PIEFusedEvidence',
    'export type PIEEvidenceFusionSummary',
    'export type PIEIntelligentSummary',
    'export function buildFusedEvidence',
    'export function findEvidenceGaps',
    'export function findEvidenceConflicts',
  ])
) {
  pass(
    'Evidence Fusion',
    'Evidence Fusion service exists with fused evidence, summary, gaps, and conflicts exports.',
    'services/PIEEvidenceFusion.ts',
  );
} else {
  fail(
    'Evidence Fusion',
    'Evidence Fusion service or required exports were not found.',
    'Restore services/PIEEvidenceFusion.ts with PIEFusedEvidence, summary, intelligent summary, gaps, conflicts, and build helpers.',
    'services/PIEEvidenceFusion.ts',
  );
}

if (
  hasAll(runtime, [
    'export type PIERuntimeState',
    'fusedEvidence',
    'evidenceFusionSummary',
    'intelligentSummary',
    'evidenceGaps',
    'evidenceConflicts',
  ])
) {
  pass(
    'Runtime evidence fusion contract',
    'Runtime exposes fusedEvidence, evidenceFusionSummary, intelligentSummary, evidenceGaps, and evidenceConflicts.',
    'services/PIERuntime.ts',
  );
} else {
  fail(
    'Runtime evidence fusion contract',
    'Runtime does not expose all required Evidence Fusion fields.',
    'Expose fusedEvidence, evidenceFusionSummary, intelligentSummary, evidenceGaps, and evidenceConflicts from PIERuntimeState.',
    'services/PIERuntime.ts',
  );
}

if (
  fileExists('services/PIEScheduleIntelligence.ts') &&
  hasAll(scheduleIntelligence, [
    'export type PIENormalizedScheduleTask',
    'export function detectScheduleFormat',
    'export function extractPdfScheduleText',
    'export function normalizeScheduleImport',
    'export function buildScheduleIntelligence',
    'Feed Runtime',
    'Feed Mission',
    'Feed Executive',
    'Feed Knowledge Graph',
  ])
) {
  pass(
    'Schedule Intelligence pipeline',
    'Schedule Intelligence service exists with import, format detection, text extraction, normalization, review, Runtime, Mission, Executive, and Knowledge Graph pipeline markers.',
    'services/PIEScheduleIntelligence.ts',
  );
} else {
  fail(
    'Schedule Intelligence pipeline',
    'Schedule Intelligence service or pipeline markers were not found.',
    'Create services/PIEScheduleIntelligence.ts with import, detect format, extract text, normalize, review, Runtime, Mission, Executive, and Knowledge Graph outputs.',
    'services/PIEScheduleIntelligence.ts',
  );
}

if (
  hasAll(scheduleIntelligence, [
    'PDF text detected',
    'Scanned PDF detected',
    'scannedDetected',
    'textDetected',
    'No schedule items were added automatically, so this import did not silently fail.',
  ])
) {
  pass(
    'Schedule PDF detection',
    'PDF text and scanned/flattened PDF detection are present and no-silent-failure handling is visible.',
    'services/PIEScheduleIntelligence.ts, App.tsx',
  );
} else {
  fail(
    'Schedule PDF detection',
    'PDF text detected, scanned PDF detected, or no-silent-failure handling was not found.',
    'Detect embedded PDF text, detect scanned/flattened PDFs, and show a review/failure message instead of silently failing.',
    'services/PIEScheduleIntelligence.ts, App.tsx',
  );
}

if (
  hasAll(scheduleIntelligence, [
    'project:',
    'area:',
    'task:',
    'wbs:',
    'milestone:',
    'start:',
    'finish:',
    'duration:',
    'status:',
    'percentComplete:',
    'owner:',
    'contractor:',
    'critical:',
    'float:',
    'needsReview',
    'reviewFields',
  ])
) {
  pass(
    'Schedule normalization',
    'Normalized schedule tasks include project, area, task, WBS, milestone, dates, duration, status, percent complete, owner, contractor, critical, float, notes, confidence, and review fields without importing schedule dependencies.',
    'services/PIEScheduleIntelligence.ts',
  );
} else {
  fail(
    'Schedule normalization',
    'Normalized schedule task fields are incomplete.',
    'Normalize every schedule activity into the Schedule Intelligence task contract and flag low-confidence review fields.',
    'services/PIEScheduleIntelligence.ts',
  );
}

if (
  hasAll(runtime + scheduleIntelligence, [
    'scheduleSummary',
    'upcomingTasks',
    'overdueTasks',
    'criticalTasks',
    'milestones',
    'recommendedWalkAreas',
    'scheduleConfidence',
    'scheduleIntelligence',
    'buildScheduleOutputsFromState',
  ])
) {
  pass(
    'Runtime schedule intelligence contract',
    'Runtime exposes scheduleSummary, upcomingTasks, overdueTasks, criticalTasks, milestones, recommendedWalkAreas, and scheduleConfidence.',
    'services/PIERuntime.ts, services/PIEScheduleIntelligence.ts',
  );
} else {
  fail(
    'Runtime schedule intelligence contract',
    'Runtime schedule intelligence fields are missing.',
    'Expose scheduleSummary, upcomingTasks, overdueTasks, criticalTasks, milestones, recommendedWalkAreas, and scheduleConfidence from Runtime.',
    'services/PIERuntime.ts',
  );
}

if (
  hasAll(scheduleIntelligence + runtime, [
    'missionFeed',
    'executiveFeed',
    'knowledgeGraphFeed',
    'recommendedMission',
    'executiveSummary',
    'relationships',
    'buildExecutiveOutputsFromState',
    'buildMissionOutputsFromState',
    'buildGraphOutputsFromState',
  ])
) {
  pass(
    'Schedule engine feeds',
    'Schedule Intelligence exposes Mission, Executive, and Knowledge Graph feeds while Runtime still builds those engines from schedule-aware state.',
    'services/PIEScheduleIntelligence.ts, services/PIERuntime.ts',
  );
} else {
  fail(
    'Schedule engine feeds',
    'Mission, Executive, or Knowledge Graph schedule feeds were not found.',
    'Expose missionFeed, executiveFeed, knowledgeGraphFeed, and keep Runtime connected to Mission, Executive, and Knowledge Graph builders.',
    'services/PIEScheduleIntelligence.ts, services/PIERuntime.ts',
  );
}

if (
  hasAll(scheduleIntelligence + scheduleImportFlow, [
    'detectScheduleType',
    'Import Successful',
    'Import Partial',
    'Needs Review',
    'OCR Required',
    'Unsupported Schedule',
    'extractionConfidencePercent',
    'Review Imported Schedule',
    'need review',
  ])
) {
  pass(
    'Schedule import reliability',
    'Schedule import detects schedule type and maps outcomes to field-friendly statuses with low-confidence review wording.',
    'services/PIEScheduleIntelligence.ts, App.tsx',
  );
} else {
  fail(
    'Schedule import reliability',
    'Schedule type detection, no-silent-failure statuses, or low-confidence review wording was not found.',
    'Detect schedule type and only show Import Successful, Import Partial, Needs Review, OCR Required, or Unsupported Schedule.',
    'services/PIEScheduleIntelligence.ts, App.tsx',
  );
}

if (
  hasAll(scheduleImportFlow, [
    'Review Imported Schedule',
    'Accept All',
    'Accept Selected',
    'Reject Import',
    'Project, Area, Task, Dates, Status, and Owner',
  ])
) {
  pass(
    'Schedule draft review',
    'Draft activities are reviewed before import with Accept All, Accept Selected, Reject, and editable field guidance.',
    'App.tsx',
  );
} else {
  fail(
    'Schedule draft review',
    'Pre-import draft review actions were not detected.',
    'Show draft activities before importing and expose Accept All, Accept Selected, Reject, and correction fields.',
    'App.tsx',
  );
}

if (
  hasAll(scheduleIntelligence + app, [
    'validationOutput',
    'scheduleSummary:',
    'criticalActivities:',
    'overdueActivities:',
    'upcomingActivities7Days',
    'recommendedWalkAreas:',
    'recommendedInspectionAreas:',
    'executiveSummary:',
    'topPriority.scheduleHealth',
  ])
) {
  pass(
    'Schedule validation output',
    'Imported schedules immediately produce summary, critical, overdue, upcoming, walk, inspection, and executive outputs.',
    'services/PIEScheduleIntelligence.ts, App.tsx',
  );
} else {
  fail(
    'Schedule validation output',
    'Post-import schedule validation outputs were not detected.',
    'Generate Schedule Summary, Critical Activities, Overdue Activities, Upcoming Activities, Recommended Walk Areas, Recommended Inspection Areas, and Executive Summary after import.',
    'services/PIEScheduleIntelligence.ts, App.tsx',
  );
}

if (
  hasAll(app, [
    "source: 'schedule'",
    'Next Area to Visit',
    'getScheduleDrivenWalkRecommendation',
    'Capture recommendations',
  ])
) {
  pass(
    'Walk recommendation updated',
    'Walk recommendations can be driven by urgent imported schedule activities.',
    'App.tsx',
  );
} else {
  fail(
    'Walk recommendation updated',
    'Schedule-driven Walk recommendation markers were not found.',
    'Use imported schedule urgency to recommend the next walk area.',
    'App.tsx',
  );
}

if (
  hasAll(homeDashboard, [
    'const authoritativePriority =',
    'overviewPrioritySupport',
    'buildOverviewProjectRows',
    'scheduleItems',
  ])
) {
  pass(
    'Today schedule updated',
    'Overview reflects imported schedule evidence in the current project priority and supporting context.',
    'App.tsx',
  );
} else {
  fail(
    'Today schedule updated',
    'Overview schedule-backed priority markers were not detected.',
    'Surface imported schedule context with the current Overview priority.',
    'App.tsx',
  );
}

if (
  hasAll(app, [
    'approveScheduleImport',
    'SCHEDULE_ITEMS_STORAGE_KEY',
    'AsyncStorage.setItem',
    'setScheduleItems(previous =>',
    'ScheduleImportFlow',
    'reportEvidenceScope ? reportEvidenceScope.scheduleItems : authoritativeScheduleItems',
    'authoritativeScheduleItems',
    'topPriority.scheduleHealth',
  ]) &&
  hasAll(daveProjectTruth, [
    'function buildScheduleTruth',
    "'overdue' | 'due_soon' | 'upcoming' | 'not_urgent'",
    "completionState === 'reported_complete'",
    'schedule: DAVEScheduleTruth[]',
    'briefing: DAVEPMBriefing',
  ])
) {
  pass(
    'Schedule import to Today Runtime path',
    'Imported schedules are committed to state/storage and flow through the shared provider Runtime into HomeDashboard.',
    'App.tsx, services/DAVEProjectTruth.ts',
  );
} else {
  fail(
    'Schedule import to Today Runtime path',
    'Schedule import state/storage/Runtime/HomeDashboard connection is incomplete.',
    'Commit imported schedules to scheduleItems and AsyncStorage, pass scheduleItems into the shared live authority provider Runtime, and prevent Today from rendering the empty schedule summary when scheduleItems exist.',
    'App.tsx, services/DAVEProjectTruth.ts',
  );
}

if (
  fileExists('services/PIEPhotoProgress.ts') &&
  hasAll(photoProgress, [
    'export type PIEPhotoProgressComparison',
    'export function buildPhotoProgress',
    'previousPhoto',
    'currentPhoto',
    'daysBetween',
    'confidence',
    'Project',
    'Area',
    'GPS proximity',
    'User-selected comparison',
  ])
) {
  pass(
    'Photo comparison service',
    'Photo comparison service exists and matches by project, area, GPS proximity, time, and user-selected comparison markers.',
    'services/PIEPhotoProgress.ts',
  );
} else {
  fail(
    'Photo comparison service',
    'Photo comparison service or matching markers were not found.',
    'Create services/PIEPhotoProgress.ts with project, area, GPS proximity, time, user-selected matching, and previous/current comparison output.',
    'services/PIEPhotoProgress.ts',
  );
}

if (
  hasAll(photoProgress, [
    'No visible change',
    'Minor progress',
    'Moderate progress',
    'Major progress',
    'Completed work',
    'Material added',
    'Material removed',
    'Equipment installed',
    'Equipment removed',
    'Housekeeping improved',
    'Housekeeping declined',
    'New safety concern',
    'Safety concern resolved',
    'Could not determine confidently',
    'No external AI or computer vision was used.',
  ])
) {
  pass(
    'Photo comparison summary',
    'Photo comparison generates bounded change summaries and includes no-fabrication language for low-confidence/local-only comparison.',
    'services/PIEPhotoProgress.ts',
  );
} else {
  fail(
    'Photo comparison summary',
    'Bounded change labels or no-fabrication language were not found.',
    'Generate only approved change labels and state when change cannot be determined confidently.',
    'services/PIEPhotoProgress.ts',
  );
}

if (
  hasAll(photoProgress + runtime, [
    'comparisonConfidence',
    'comparisonNeedsReview',
    'Does this summary look correct?',
    'Accept',
    'Edit',
    'Reject',
    'acceptedEvidence',
    'buildPhotoProgressOutputsFromState',
    'photoProgressSummary',
    'lastComparison',
    'visualProgressEstimate',
  ])
) {
  pass(
    'Runtime photo progress contract',
    'Runtime exposes photoProgressSummary, lastComparison, comparisonConfidence, visualProgressEstimate, comparisonNeedsReview, and accepted comparison evidence.',
    'services/PIEPhotoProgress.ts, services/PIERuntime.ts',
  );
} else {
  fail(
    'Runtime photo progress contract',
    'Photo progress Runtime fields or review flow markers are missing.',
    'Expose photoProgressSummary, lastComparison, comparisonConfidence, visualProgressEstimate, comparisonNeedsReview, and accepted comparison evidence from Runtime.',
    'services/PIEPhotoProgress.ts, services/PIERuntime.ts',
  );
}

if (
  fileExists('services/PIEAttentionEngine.ts') &&
  hasAll(attentionEngine, [
    'export type PIEAttentionItem',
    'export type PIEAttentionPriority',
    'export type PIEAttentionReason',
    'export type PIEAttentionRecommendation',
    'export type PIEAttentionState',
    'buildPIEAttentionState',
    'buildPIEWalkAttentionState',
    'getPrimaryAttentionItem',
    'getAttentionReasons',
    'getRecommendedUserAction',
    'getAttentionNextStep',
    'whatMattersNow',
    'whyItMatters',
    'nextStep',
    'userActionType',
    "'recommend_project_area'",
    "'confirm_location'",
    "'capture_photo'",
    "'add_note'",
    "'verify_progress'",
    "'continue_to_next_area'",
    "'finish_walk'",
    "'review_update'",
    "'Confirm'",
    "'Capture'",
    "'Correct'",
    "'Approve'",
    "'Communicate'",
  ])
) {
  pass(
    'PIE Attention Engine',
    'PIEAttentionEngine exists and outputs what matters now, why it matters, recommended action, confidence, next step, and allowed user action types.',
    'services/PIEAttentionEngine.ts',
  );
} else {
  fail(
    'PIE Attention Engine',
    'PIEAttentionEngine foundation is missing or incomplete.',
    'Create services/PIEAttentionEngine.ts with attention types and build/get helper functions constrained to Confirm, Capture, Correct, Approve, Communicate.',
    'services/PIEAttentionEngine.ts',
  );
}

if (
  hasAll(homeDashboard, [
    "Today's Priority",
    'authoritativePriority',
    'liveAuthority.projectTruth.briefing.nextActions',
    'Review priority',
  ])
) {
  pass(
    'PIE Conductor Today',
    'DAVE starts with one authority-backed priority and one dominant review action while existing navigation remains available.',
    'App.tsx',
  );
} else {
  fail(
    'PIE Conductor Today',
    'DAVE priority guidance was not detected on the live Overview.',
    'Render one authority-backed current priority with one dominant review action.',
    'App.tsx',
  );
}

if (
  hasAll(photoCapture, [
    'Capture Evidence',
    'Current Area',
    'Why:',
    'Accept Suggested Area',
    'Change Area',
    'Photo saved.',
    'Add Another Photo',
    'Add Note',
  ])
) {
  pass(
    'PIE Guided Capture',
    'Capture starts from location guidance, preserves Accept/Change Area, and keeps the user in context after photo capture.',
    'App.tsx',
  );
} else {
  fail(
    'PIE Guided Capture',
    'Live guided capture markers were not detected.',
    'Preserve current-area guidance, Accept/Change Area, capture confirmation, and subordinate repeat/note actions.',
    'App.tsx',
  );
}

if (
  hasAll(photoProgress + runtime + evidenceFusion + app, [
    'missionFeed',
    'executiveFeed',
    'evidenceFusionFeed',
    'knowledgeGraphFeed',
    'reviewFeed',
    'combinedUpdateFeed',
    'photoProgressEvidence',
    'Accepted photo progress',
  ])
) {
  pass(
    'Accepted photo progress integration',
    'Accepted photo progress feeds Mission, Executive, Evidence Fusion, Knowledge Graph, Review, and Combined Update pathways.',
    'services/PIEPhotoProgress.ts, services/PIERuntime.ts, services/PIEEvidenceFusion.ts, App.tsx',
  );
} else {
  fail(
    'Accepted photo progress integration',
    'Accepted photo progress is not visibly feeding all required PIE surfaces.',
    'Feed accepted comparison evidence into Runtime, Mission, Executive, Evidence Fusion, Knowledge Graph, Review, and Combined Update.',
    'services/PIEPhotoProgress.ts, services/PIERuntime.ts, services/PIEEvidenceFusion.ts, App.tsx',
  );
}

if (
  fileExists('services/PIEPhotoProgressIntelligence.ts') &&
  hasAll(photoProgressIntelligence, [
    'export type PIEPhotoSequence',
    'export type PIEPhotoProgressEvent',
    'export type PIEPhotoComparability',
    'strong_match',
    'probable_match',
    'weak_match',
    'not_comparable',
    'buildPIEPhotoProgressIntelligence',
    'buildPhotoSequences',
    'assessPhotoComparability',
    'detectPhotoProgressEvent',
    'validateVisualProgressWithJARVIS',
    'qualifiedRealityEvidence',
    'repeatPhotoGuidance',
    'comparisonInputSignature',
    'analysisVersion',
  ])
) {
  pass(
    'Longitudinal Photo Intelligence service',
    'PIEPhotoProgressIntelligence creates stable photo sequences, comparability assessments, conservative progress events, visual JARVIS validation, repeat-photo guidance, cache signatures, and qualified Reality evidence.',
    'services/PIEPhotoProgressIntelligence.ts',
  );
} else {
  fail(
    'Longitudinal Photo Intelligence service',
    'Longitudinal photo sequence, comparability, JARVIS, repeat guidance, cache, or Reality evidence markers are missing.',
    'Create services/PIEPhotoProgressIntelligence.ts with sequence grouping, comparability gates, typed progress events, visual JARVIS validation, repeat-photo guidance, and qualified Reality evidence output.',
    'services/PIEPhotoProgressIntelligence.ts',
  );
}

if (
  hasAll(daveProjectTruth, [
    'const hasComparablePrior',
    'comparisonCompleted',
    "comparability === 'strong' || comparability === 'probable'",
    'safeVisualEvidence && hasComparablePrior',
    "evidenceClass: safeVisualEvidence ? 'observation' : intelligence ? 'interpretation' : 'uncertainty'",
    "progressClaim !== 'supported'",
    'No confirmed prior photo is available.',
    'The prior photo is not sufficiently comparable to support a change or progress conclusion.',
    'The result is not supported by visual evidence alone.',
    'Current project records disagree about task completion.',
  ])
) {
  pass(
    'Longitudinal photo claim safety',
    'Photo intelligence separates observation from inference, requires verification/corroboration, avoids unsupported completion percentages, and discloses invisible-work limits.',
    'services/DAVEProjectTruth.ts',
  );
} else {
  fail(
    'Longitudinal photo claim safety',
    'Photo intelligence may be overclaiming completion or progress.',
    'Separate observations from inferences, require corroboration for completion, avoid invented percentages, and disclose invisible-work limits.',
    'services/DAVEProjectTruth.ts',
  );
}

if (
  fileExists('services/DAVEProjectReasoning.ts') &&
  hasAll(daveProjectReasoning, [
    'DAVEReasoningRelationship',
    "'supports'",
    "'contradicts'",
    "'depends_on'",
    "'delays'",
    "'completes'",
    "'changes'",
    'DAVEReasoningHypothesis',
    'DAVEReasoningChallenge',
    'known_fact',
    'supported_conclusion',
    'reasonable_inference',
    'unresolved_uncertainty',
    'consequenceOfInaction',
    'smallestNextAction',
    'learningCues',
    'buildDAVEProjectReasoning',
  ]) &&
  hasAll(daveProjectTruth, [
    'buildDAVEProjectReasoning',
    'reasoning: DAVEProjectReasoning',
    'reasoning.decisions',
  ])
) {
  pass(
    'DAVE project reasoning authority',
    'Project Truth connects evidence relationships, competing hypotheses, adversarial challenges, bounded conclusions, explained decisions, follow-through consequences, and outcome learning.',
    'services/DAVEProjectReasoning.ts, services/DAVEProjectTruth.ts',
  );
} else {
  fail(
    'DAVE project reasoning authority',
    'DAVE does not expose the complete evidence-to-decision reasoning contract.',
    'Connect relationships, alternatives, challenges, knowledge classes, reasoning trails, decisions, consequences, and learned outcomes through Project Truth.',
    'services/DAVEProjectReasoning.ts, services/DAVEProjectTruth.ts',
  );
}

if (
  hasAll(photoProgressIntelligence, [
    'reported_complete_but_visibly_incomplete',
    'schedule_no_progress_but_visual_progress',
    'issue_closed_but_condition_visible',
    'temporary_condition_persisting',
    'visual_regression_candidate',
    'human_review_required',
    'regressionCandidates',
    'stalledProgressEvents',
  ])
) {
  pass(
    'Longitudinal visual conflict handling',
    'Photo intelligence detects recorded-status conflicts, stalled progress, and regression candidates requiring validation.',
    'services/PIEPhotoProgressIntelligence.ts',
  );
} else {
  fail(
    'Longitudinal visual conflict handling',
    'Conflict, stalled progress, or regression validation markers are missing.',
    'Add recorded-status conflict detection, stalled progress detection, regression candidates, and human/JARVIS review requirements.',
    'services/PIEPhotoProgressIntelligence.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'buildPIEPhotoProgressIntelligence',
    'longitudinalPhotoIntelligence',
    'photoSequences',
    'photoProgressEvents',
    'photoProgressConflicts',
    'photoRepeatGuidance',
    'visualJarvisValidation',
  ])
) {
  pass(
    'Longitudinal Photo Intelligence Core integration',
    'PIECoreIntelligence exposes longitudinal photo intelligence, progress events, visual conflicts, repeat-photo guidance, and visual JARVIS results.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'Longitudinal Photo Intelligence Core integration',
    'Core does not expose longitudinal photo intelligence outputs.',
    'Build photo progress intelligence from Runtime context and Reality Model, then expose sequences, events, conflicts, repeat guidance, and visual JARVIS validation from Core.',
    'services/PIECoreIntelligence.ts',
  );
}

if (
  fileExists('services/PIEPhotoProgressIntelligenceStorage.ts') &&
  fileExists('supabase/migrations/20260702010000_pie_photo_intelligence.sql') &&
  hasAll(photoProgressIntelligenceStorage, [
    'savePhotoProgressIntelligence',
    'loadLatestPhotoProgressIntelligence',
    'loadPhotoProgressIntelligenceState',
    'clearPhotoProgressIntelligenceForTesting',
    'PIEPhotoProgressIntelligenceStoredState',
    'cacheEntries',
    'comparabilityAssessments',
    'corrupt',
  ]) &&
  hasAll(photoIntelligenceMigration, [
    'create table if not exists public.pie_photo_sequences',
    'create table if not exists public.pie_photo_progress_events',
    'create table if not exists public.pie_photo_progress_conflicts',
    'create table if not exists public.pie_photo_comparability_results',
    'enable row level security',
    'organization_memberships',
    "status = 'active'",
  ])
) {
  pass(
    'Longitudinal photo durable persistence',
    'Photo sequences, progress events, comparability results, conflicts, cache signatures, local hydration, corruption quarantine, and cloud RLS schema are present.',
    'services/PIEPhotoProgressIntelligenceStorage.ts, supabase/migrations/20260702010000_pie_photo_intelligence.sql',
  );
} else {
  fail(
    'Longitudinal photo durable persistence',
    'Photo intelligence persistence, cache hydration, corruption quarantine, or cloud isolation schema is incomplete.',
    'Persist photo sequences/events/comparability/conflicts/cache entries locally, add cloud tables with RLS, and keep organization/project isolation.',
    'services/PIEPhotoProgressIntelligenceStorage.ts',
  );
}

if (
  hasAll(homeDashboard + photoCapture, [
    'repeatPhotoGuidance',
    'continuityAnchor',
    'Photo saved.',
    'Next Suggested Action',
    'Add Another Photo',
  ]) &&
  !hasAny(homeDashboard + photoCapture + bottomNav, [
    'Compare Photos',
    'Analyze Progress',
    'Run Visual Review',
    'Calculate Progress',
    'Validate Image',
    'Photo Progress',
  ])
) {
  pass(
    'Longitudinal photo minimal UI',
    'Photo intelligence stays automatic, Capture shows only high-value repeat guidance, and no manual analysis controls or permanent photo tab were added.',
    'App.tsx, components/app-bottom-tabs.tsx',
  );
} else {
  fail(
    'Longitudinal photo minimal UI',
    'Photo intelligence UI is either missing repeat guidance or exposes manual analysis controls.',
    'Keep processing automatic, show only concise progress/repeat-photo guidance, and avoid new navigation or manual compare/analyze buttons.',
    'App.tsx, components/app-bottom-tabs.tsx',
  );
}

if (
  hasAll(packageJson, [
    'test:perception',
    'test:conflicts',
    'test:causal-reasoning',
    'test:evidence-value',
    'test:photo-sequences',
    'test:photo-comparison',
    'test:photo-progress',
    'test:visual-jarvis',
    'test:repeat-photo-guidance',
    'test:photo-progress-ui',
  ])
) {
  pass(
    'Longitudinal photo test scripts',
    'Requested photo intelligence test scripts are registered.',
    'package.json',
  );
} else {
  fail(
    'Longitudinal photo test scripts',
    'One or more requested photo intelligence test scripts are missing.',
    'Add test:photo-sequences, test:photo-comparison, test:photo-progress, test:visual-jarvis, test:repeat-photo-guidance, and test:photo-progress-ui.',
    'package.json',
  );
}

if (
  hasAll(photoVisionFunction + photoVisionAuthority + photoProgressIntelligence, [
    'photo_pair',
    'validateVisionAuthority',
    'buildPIEPhotoProgressIntelligence',
    'visualJarvisValidation',
  ])
) {
  pass(
    'Multimodal evidence architecture',
    'The live server vision boundary and mobile longitudinal intelligence provide structured analysis and visual validation.',
    'supabase/functions/pie-photo-vision/index.ts, services/PIEPhotoProgressIntelligence.ts',
  );
} else {
  fail(
    'Multimodal evidence architecture',
    'The production visual evidence and longitudinal validation path is incomplete.',
    'Keep structured server vision authority and mobile longitudinal validation connected.',
    'supabase/functions/pie-photo-vision/index.ts, services/PIEPhotoProgressIntelligence.ts',
  );
}

if (
  fileExists('supabase/migrations/20260702030000_multimodal_evidence_foundation.sql') &&
  hasAll(multimodalEvidenceMigration, [
    'pie-project-evidence',
    'public.pie_evidence_records',
    'public.pie_photo_assets',
    'public.pie_evidence_analyses',
    'public.pie_visual_jarvis_results',
    'public.pie_evidence_corrections',
    'enable row level security',
    'pie_layer4_has_permission',
    'pie_cleanup_automated_evidence_test_records',
    "auth.role() <> 'service_role'",
  ])
) {
  pass(
    'Multimodal evidence persistence and RLS',
    'Private evidence bucket, evidence/photo/analysis/JARVIS/correction tables, RLS, and service-role-only test cleanup are present.',
    'supabase/migrations/20260702030000_multimodal_evidence_foundation.sql',
  );
} else {
  fail(
    'Multimodal evidence persistence and RLS',
    'Evidence persistence, private storage, RLS, or restricted cleanup markers are missing.',
    'Add the multimodal evidence migration with private storage, RLS, parent-child boundaries, and service-role-only automated-test cleanup.',
    'supabase/migrations/20260702030000_multimodal_evidence_foundation.sql',
  );
}

if (
  fileExists('supabase/functions/pie-photo-vision/index.ts') &&
  fileExists('supabase/functions/_shared/pie-vision-provider.ts') &&
  hasAll(photoVisionFunction, [
    'auth.getUser()',
    'photoVisionCallerScopeIsAuthorized',
    'loadAuthorizedImage',
    'photo_pair',
    'pie_photo_semantic_comparison_results',
    'validateVisionAuthority',
  ]) &&
  hasAll(photoVisionAuthority, [
    'blockingObservationReasons',
    'progressAccepted = progressReasons.length === 0 && blockingObservationReasons.length === 0',
  ]) &&
  hasAll(photoVisionProvider, [
    'interface VisionProvider',
    'analyzeSinglePhoto',
    'comparePhotoPair',
    'PIE_VISION_PROVIDER',
    'timeoutMs',
    'maxRetries',
    'PIE_OPENAI_API_KEY',
    'degradedResult',
  ]) &&
  !hasAny(app + runtime + evidenceFusion + photoProgressIntelligence + supabaseService, [
    'PIE_OPENAI_API_KEY',
    'OPENAI_API_KEY',
  ])
) {
  pass(
    'Raw-pixel photo backend boundary',
    'Raw-pixel analysis is isolated to an authenticated server function and provider secrets are absent from app services.',
    'supabase/functions/pie-photo-vision/index.ts',
  );
} else {
  fail(
    'Raw-pixel photo backend boundary',
    'Raw-pixel analysis may be missing server auth/project checks or leaking provider-secret markers into app code.',
    'Keep image-capable provider calls inside Supabase Edge Functions and never reference provider keys from mobile app code.',
    'supabase/functions/pie-photo-vision/index.ts',
  );
}

if (
  fileExists('docs/PIE_MultimodalEvidenceArchitecture.md') &&
  fileExists('docs/PIE_TruePhotoIntelligence.md') &&
  fileExists('docs/PIE_VisualValidationPlan.md') &&
  hasAll(multimodalEvidenceDoc + truePhotoIntelligenceDoc + visualValidationPlan, [
    'visual_observation_only',
    'Provider secrets must never appear in the mobile bundle',
    'Photo findings',
    'Validation Dataset',
    'current authorization provides organization membership authorization plus project identity checks',
  ])
) {
  pass(
    'Multimodal and true photo documentation',
    'Docs define universal evidence, true photo intelligence limits, visual validation, backend secrets, and current authorization limitation.',
    'docs/PIE_MultimodalEvidenceArchitecture.md, docs/PIE_TruePhotoIntelligence.md, docs/PIE_VisualValidationPlan.md',
  );
} else {
  fail(
    'Multimodal and true photo documentation',
    'Required multimodal/photo validation docs are missing or incomplete.',
    'Document universal evidence architecture, true photo intelligence backend requirements, JARVIS visual validation, and authorization limitations.',
    'docs/PIE_MultimodalEvidenceArchitecture.md',
  );
}

if (
  fileExists('validation/multimodal/photo-vision-scenarios.json') &&
  fileExists('supabase/migrations/20260702040000_production_vision_pipeline.sql') &&
  fileExists('scripts/pie-photo-vision-authority-test.js') &&
  hasAll(packageJson, [
    'test:photo-vision-authority',
    'test:photo-comparison',
    'test:visual-jarvis',
  ]) &&
  hasAll(multimodalValidationScenarios + productionVisionMigration + photoVisionFunction + photoProgressIntelligence, [
    'hidden-condition-rejected',
    'comparison-not-comparable',
    'project-boundary-mismatch',
    'user-correction-preserved',
    'mouse_added_to_table',
    'failed_build_21',
    'black computer mouse',
    'does not establish project progress',
    'pie_vision_analysis_requests',
    'pie_photo_semantic_comparison_results',
    'validateVisionAuthority',
    'visualJarvisValidation',
  ])
) {
  pass(
    'Multimodal evidence regression tests',
    'Production photo authority, longitudinal comparison, adversarial visual validation, and regression scenarios are covered.',
    'scripts/pie-photo-vision-authority-test.js, scripts/photo-progress-intelligence-test.js, validation/multimodal/photo-vision-scenarios.json',
  );
} else {
  fail(
    'Multimodal evidence regression tests',
    'Production photo authority or longitudinal regression coverage is incomplete.',
    'Preserve live photo authority, comparison, visual JARVIS, and scenario coverage.',
    'scripts/pie-photo-vision-authority-test.js, scripts/photo-progress-intelligence-test.js',
  );
}

if (
  fileExists('validation/scenarios/master-validation-scenarios.json') &&
  fileExists('validation/expected/master-validation-expected.json') &&
  fileExists('scripts/pie-master-validation-test.js') &&
  hasAll(masterValidationScenarios, [
    'coverageMatrix',
    'materialScenarios',
    'evidenceQuality',
    'realityModel',
    'decisionQuality',
    'prediction',
    'photoIntelligence',
    'failureRecovery',
    'authorityEthics',
    'expectedJudgment',
    'prohibitedJudgment',
    'expectedConfidenceBehavior',
    'expectedJarvisResult',
    'expectedAttentionBehavior',
    'expectedLayer4Eligibility',
  ]) &&
  hasAll(masterValidationExpected, [
    'requiredScenarioFields',
    'confidenceComponents',
    'calibrationMeaning',
    'minimumActivatedSampleSize',
    'allowedAdaptiveAreas',
    'protectedAreas',
    'photoCapability',
  ]) &&
  hasAll(masterValidationTest, [
    'evaluateScenario',
    'validateConfidenceCalibration',
    'backtestPredictionsAndJudgments',
    'validateLayer4LearningControls',
    'preventOverlearning',
    'validateRlsLiveReadiness',
    'validateJarvisAdversarial',
    'validateReporterFidelity',
    'validateAttentionQuality',
    'validateFailureContainment',
    'validatePerformance',
    'validateAccessibility',
    'validateSecurityIsolation',
  ]) &&
  hasAll(packageJson, [
    'test:master-validation',
    'test:calibration',
    'test:prediction-backtest',
    'test:layer4-learning',
    'test:learning-guards',
    'test:rls-live',
    'test:jarvis-adversarial',
    'test:reporter-fidelity',
    'test:attention-quality',
    'test:failure-containment',
    'test:performance',
    'test:accessibility',
    'test:minimal-ui-complete',
    'test:security-isolation',
  ])
) {
  pass(
    'PIE Master Validation harness',
    'Reusable scenario fixtures and executable validation modes cover reasoning accuracy, calibration, prediction back-testing, bounded learning, RLS readiness, JARVIS adversarial checks, Reporter fidelity, Attention quality, failure containment, performance, accessibility, UI minimalism, and security isolation.',
    'validation/scenarios/master-validation-scenarios.json, validation/expected/master-validation-expected.json, scripts/pie-master-validation-test.js, package.json',
  );
} else {
  fail(
    'PIE Master Validation harness',
    'The master validation scenario library, expected contracts, executable harness, or required npm scripts are incomplete.',
    'Restore the validation fixtures, mode-specific runner functions, and all required test:* scripts for the final PIE checkpoint.',
    'scripts/pie-master-validation-test.js',
  );
}

if (
  fileExists('services/PIEReporter.ts') &&
  hasAll(pieReporter, [
    'export type PIEReportAudience',
    'export type PIEReportType',
    'export type PIEReportDraft',
    'export type PIEReportLocationGroup',
    'export type PIEReportWorkArea',
    'export type PIEReportBullet',
    'export type PIEReportActionItem',
    'export type PIEReportImageReference',
    'export type PIEReportConfidence',
    'export type PIEReportSourceEvidence',
    'export type PIEConstructionUnderstanding',
    'export type PIEWorkAreaUnderstanding',
    'collectReportEvidence',
    'buildConstructionUnderstanding',
    'buildProjectNarrative',
    'buildDavidStyleReport',
    'buildReportActionItems',
    'buildReportImageReferences',
    'buildReportReviewFlags',
    'buildPIEReportDraft',
    'buildDailyProjectUpdate',
    'buildCombinedProjectUpdate',
  ])
) {
  pass(
    'PIE Reporter service',
    'PIE Reporter service exists with report types, draft model, grouped work areas, bullets, action items, image references, confidence, and source evidence.',
    'services/PIEReporter.ts',
  );
} else {
  fail(
    'PIE Reporter service',
    'PIE Reporter service or required TypeScript models/functions were not found.',
    'Create services/PIEReporter.ts with the requested report models and build functions.',
    'services/PIEReporter.ts',
  );
}

if (
  hasAll(pieReporter, [
    'Please review the updates below and look for action items assigned to your name.',
    'Please let me know if you have any questions.',
    'groupEvidenceByLocation',
    'groupEvidenceByWorkArea',
    'formatDavidStyleProjectUpdate',
    '${index + 1}. ${areaTitle}',
    'reportBulletLabel(bullet)',
    'See Image',
    'See Images',
    'return ensureSentence(item.action);',
    '${item.owner} – Please ${lowercaseFirst(item.action)}',
  ]) &&
  !hasAny(pieReporter, ['as an AI', 'AI says', 'based on the data', 'Owner needed'])
) {
  pass(
    'PIE Reporter David-style format',
    'Reporter uses David-style opening, location groups, numbered work areas, bullets, image references, inline action items, and avoids generic AI wording.',
    'services/PIEReporter.ts',
  );
} else {
  fail(
    'PIE Reporter David-style format',
    'David-style report formatting markers were incomplete or generic AI wording appeared.',
    'Use the required opening/closing, location headings, numbered work areas, bullet lines, image references, and owner action item format without generic AI phrasing.',
    'services/PIEReporter.ts',
  );
}

if (
  hasAll(pieReporter, [
    'cleanReportWorkAreaName',
    'chooseBestWorkAreaName',
    'removeDuplicateWorkAreaPhrases',
    'removeRepeatedPhrases',
    'Executive Summary',
    'buildExecutiveSummaryBullets',
    'ACTION_LANGUAGE',
    'STRONG_ACTION_LANGUAGE',
    'isActionEvidence',
    'shouldSuppressReportBullet',
    'buildReportReviewFlags',
    'reviewFlags',
    'return ensureSentence(item.action);',
    'Building 2321 East Driveway East Driveway',
    'Fire Pump House Pump House',
    'Canopy B Location',
    'Location was captured',
    'GPS was captured',
    'Evidence was fused',
    'Runtime indicates',
    'No image references included',
  ]) &&
  !hasAny(pieReporter, [
    'Owner needed – Please assign an owner',
  ]) &&
  hasAll(reportsScreen, [
    'reviewFlagsPanel',
    'Fix before approval',
    'Report Check',
    'Task Status',
    'Schedule Health',
    'Current Work',
    'Needs Attention',
    'Next Steps',
    'Recent Changes',
    'Progress by Work Area',
    'Full Written Report',
    'Copy Report',
    'Email Report',
    'reportApproved && reportApprovalAllowed && shareOpen',
    'Project Status Details',
    'Current task position and schedule',
  ]) &&
  !hasAny(reportsScreen, [
    'No image references included.',
    'Validation Requests',
    'Evidence & Uncertainty',
    'Details & Reasoning',
  ])
) {
  pass(
    'PIE Reporter narrative quality',
    'Reporter builds construction understanding, cleans work-area names, suppresses system and verification-gap phrasing, requires real action language, and omits empty or unknown-state sections.',
    'services/PIEReporter.ts, screens/ReportsScreen.tsx',
  );
} else {
  fail(
    'PIE Reporter narrative quality',
    'Reporter 2.0 quality gates were not satisfied.',
    'Keep construction understanding and review rigor internal while publishing only known current conditions, real actions, and non-empty report sections.',
    'services/PIEReporter.ts, screens/ReportsScreen.tsx',
  );
}

if (
  hasAll(reportsScreen + app + pieReporter, [
    'Prepared Report',
    'PIEReporterPreview',
    'buildPIEReportDraft',
    'Single Project Update',
    'Combined Project Update',
    'Copy Report',
    'Email Report',
    'Copy, Email, and Text unlock after approval',
    'No report is sent automatically',
    'reportApproved && reportApprovalAllowed && shareOpen',
    'ReportShareButton',
    'onEmailReport',
    'onCopyReport',
  ]) &&
  !hasAny(pieReporter, ['MailComposer', 'SMS.sendSMSAsync', 'Clipboard.setStringAsync'])
) {
  pass(
    'PIE Reporter review boundary',
    'PIE Reporter is integrated into Review/Build Update preview and does not send, text, copy, or auto-approve anything by itself.',
    'App.tsx, screens/ReportsScreen.tsx, services/PIEReporter.ts',
  );
} else {
  fail(
    'PIE Reporter review boundary',
    'Reporter review boundary or Build Update integration was incomplete.',
    'Show Generate PIE Project Update in Review/Build Update, preserve Single/Combined choices, and keep send/copy behind explicit user actions.',
    'App.tsx, screens/ReportsScreen.tsx, services/PIEReporter.ts',
  );
}

if (
  hasAll(pieReporter + runtime, [
    'fusedEvidence',
    'intelligentSummary',
    'scheduleItems',
    'photoProgressSummary',
    "'gps'",
    'notes',
    'reportDraft',
    'reportReadiness',
    'reportNeedsReview',
    'reportActionItems',
  ])
) {
  pass(
    'PIE Reporter Runtime evidence',
    'Reporter uses Runtime/Fusion, schedule, photos, GPS, and notes, and Runtime exposes report draft readiness, review state, and action items.',
    'services/PIEReporter.ts, services/PIERuntime.ts',
  );
} else {
  fail(
    'PIE Reporter Runtime evidence',
    'Reporter did not expose or consume enough PIE evidence paths.',
    'Connect reporter to fused evidence/runtime, schedule, photo progress/photos, GPS, notes, and Runtime report readiness fields.',
    'services/PIEReporter.ts, services/PIERuntime.ts',
  );
}

if (
  hasAll(photoCapture, ['Capture Evidence', 'Current Area', 'onTakePhoto'])
) {
  pass(
    'Capture workflow',
    'The live field-update screen presents location-guided evidence collection.',
    'App.tsx',
  );
} else {
  fail(
    'Capture workflow',
    'The live evidence-capture workflow was not found.',
    'Keep location-guided evidence capture in the existing field-update flow.',
    'App.tsx',
  );
}

if (
  hasAll(app, [
    'exact-gps-area',
    'gps-radius',
    'schedule',
    'last-active-area',
    'user-selection',
    'locationSource',
  ]) &&
  hasAny(app, ['areaSuggestion', 'selectedArea', 'Current Area'])
) {
  pass(
    'GPS recommendation exists',
    'GPS recommendation priority order is present: exact area, radius, project boundary, last active project, last active area, and user selection.',
    'App.tsx',
  );
} else {
  fail(
    'GPS recommendation exists',
    'GPS recommendation priority markers were not fully detected.',
    'Add exact GPS area, radius, project boundary, last active project, last active area, and user selection recommendation logic.',
    'App.tsx',
  );
}

if (
  hasAll(app, [
    'Accept Suggested Area',
    'Change Area',
    'setWalkCorrectionMemory',
    'correctionPenalty',
    'AreaSelectionSheet',
  ])
) {
  pass(
    'Walk correction flow',
    'Accept, change/choose project, change/choose area, and correction confidence penalty behavior are exposed.',
    'App.tsx',
  );
} else {
  fail(
    'Walk correction flow',
    'Accept/correction controls or correction memory were not found.',
    'Expose Accept, Change/Choose Project, Change/Choose Area, and remember corrections for the current session.',
    'App.tsx',
  );
}

if (
  hasAll(app, [
    'confidenceScore',
    'Why:',
    'Location is uncertain.',
    'Choose the project area',
    'Next Area to Visit',
  ])
) {
  pass(
    'Capture location confidence and reason',
    'Capture keeps location confidence in the recommendation model while displaying plain-language why, low-location uncertainty, and next area guidance.',
    'App.tsx',
  );
} else {
  fail(
    'Capture location confidence and reason',
    'Location confidence, why/reason, low-location uncertainty, or next area guidance was not detected.',
    'Keep confidence in the model, display plain-language why, low-location uncertainty copy, and next area recommendation.',
    'App.tsx',
  );
}

if (
  hasAll(photoCapture, [
    'Photo saved.',
    'Current Area',
    'Next Suggested Action',
    'Add Another Photo',
    'Add Note',
  ]) &&
  hasAll(app, ['Finish Walk', "setScreen('AddPhotos')"])
) {
  pass(
    'Capture photo flow',
    'Photo confirmation, current area, next action, and repeat/save buttons keep the user in Capture.',
    'App.tsx',
  );
} else {
  fail(
    'Capture photo flow',
    'Capture photo flow may not keep the user in context after adding a photo.',
    'Show Photo saved, Current Area, Next Suggested Action, Add Another Photo, Add Note, Save Walk Update, and return to Capture after photos.',
    'App.tsx',
  );
}

if (
  hasAll(app, [
    'finishProjectWalk',
    'prepareProjectWalkFieldUpdate',
    'localDAVEProjectWalkSessionRepository',
    'setCaptureMemories',
    'liveAuthority.projectTruth',
  ]) &&
  hasAll(runtime + evidenceFusion, [
    'fusedEvidence',
    'evidenceFusionSummary',
    'intelligentSummary',
  ])
) {
  pass(
    'Walk completion updates PIE',
    'Save Walk Update updates saved evidence and explicitly feeds Mission, Runtime, Evidence Fusion, Executive Summary, Today, and Project Workspace.',
    'App.tsx, services/PIERuntime.ts, services/PIEEvidenceFusion.ts',
  );
} else {
  fail(
    'Walk completion updates PIE',
    'Walk completion integration markers were not detected.',
    'Ensure Save Walk Update updates Mission, Runtime, Evidence Fusion, Executive Summary, Today priorities, and Project Workspace.',
    'App.tsx',
  );
}

const syncUserUi = adminScreen;

if (
  hasAll(syncService + syncUserUi + app, [
    'isPhotoFileAvailable',
    'missingPhotos',
    'Keep Update, Skip Photo',
    'could not be synced because',
    'removeMissingPhotosFromSyncQueue',
    'markMissingPhotosUnavailable',
  ]) &&
  hasAny(syncService + app, ['Photo sync could not finish', 'cleanupStoredPhotoDirectory']) &&
  hasAny(syncService + app, ['catch', 'try'])
) {
  pass(
    'Photo sync resilience',
    'Missing photos are detected before upload, skipped, reported with friendly actions, and removable from local updates plus sync queue.',
    'services/SyncService.ts, App.tsx, screens/AdminScreen.tsx',
  );
} else {
  fail(
    'Photo sync resilience',
    'Graceful missing photo sync handling was not fully detected.',
    'Detect missing local photos before upload, preserve the field update, show Keep Update, Skip Photo / Retry / Dismiss, and clear orphaned queue references after confirmation.',
    'services/SyncService.ts, App.tsx, screens/AdminScreen.tsx',
  );
}

if (
  !hasAny(syncUserUi, [
    'readAsStringAsync',
    'error.message',
    'error.stack',
    'Stack:',
    'file path',
    'internal exception',
    'internal error',
    'does not exist',
    'Sync failed:',
    'caused by',
    'Caused by',
    '/var/mobile/',
    'Containers/Data/Application',
    'project-photos',
    'Caused by:',
    '/var/',
    'file:',
  ])
) {
  pass(
    'Photo sync user-safe errors',
    'Admin and Diagnostics sync UI do not expose raw exceptions, file paths, stack traces, or readAsStringAsync.',
    'screens/AdminScreen.tsx, App.tsx',
  );
} else {
  fail(
    'Photo sync user-safe errors',
    'Raw exception, file path, stack, or readAsStringAsync marker was found in sync UI.',
    'Never display raw exceptions, file paths, stack traces, internal errors, or readAsStringAsync in user-facing sync UI.',
    'screens/AdminScreen.tsx, App.tsx',
  );
}

if (
  hasAll(syncService, [
    'sanitizeUserFacingSyncMessage',
    'cleanupStoredSyncStatusMessages',
    'AsyncStorage.getAllKeys',
    'sanitizeStoredSyncValue',
    'cleanupSyncQueueValue',
    'SYNC_QUEUE_STORAGE_KEY',
    'lastError:',
    'sanitizedResult',
    'readAsStringAsync',
    'readAsString',
    '\\/var\\/mobile',
    'Containers\\/Data\\/Application',
    'project-photos',
    '\\.heic',
    'does not exist',
    'Caused by',
    'Sync failed:',
    'Some photos could not be synced because the original files are no longer available. The remaining items will continue syncing.',
  ]) &&
  hasAll(app, [
    'cleanupStoredSyncStatusMessages',
    'setSyncCleanupNotice',
    'Sync status cleaned up.',
    'syncCleanupNotice={syncCleanupNotice}',
  ]) &&
  hasAll(adminScreen, [
    'Cloud sync tools are available.',
    'Field update history preserved. Unavailable photo retries were cleared.',
    'formatMissingPhotoSyncMessage',
    'syncCleanupNotice',
    'setAdminActionSummary',
  ]) &&
  !hasAny(adminScreen, [
    'error.message',
    'error.stack',
    'readAsStringAsync',
    'Sync failed',
    '/var/mobile',
    'does not exist',
  ])
) {
  pass(
    'Sync status display sanitizer',
    'Admin renders bounded, non-technical sync summaries while Diagnostics sync display paths use sanitizeUserFacingSyncMessage.',
    'services/SyncService.ts, screens/AdminScreen.tsx, App.tsx',
  );
} else {
  fail(
    'Sync status display sanitizer',
    'Sync display paths are not fully protected by sanitizeUserFacingSyncMessage.',
    'Apply sanitizeUserFacingSyncMessage to syncStatus, sync result, sync progress, alerts/status messages, and keep raw diagnostics under Developer Support > Raw Diagnostics.',
    'services/SyncService.ts, screens/AdminScreen.tsx, App.tsx',
  );
}

if (
  !hasAny(adminScreen, [
    'error.message',
    'error.stack',
    'readAsStringAsync',
    'Sync failed',
    '/var/mobile',
    'does not exist',
  ]) &&
  hasAll(adminScreen, [
    'Cloud sync tools are available.',
    'Field update history preserved. Unavailable photo retries were cleared.',
    'setAdminActionSummary',
    'formatMissingPhotoSyncMessage',
  ])
) {
  pass(
    'Admin sync status removed',
    'AdminScreen renders bounded, non-technical sync status without sync logs, raw file paths, or raw errors.',
    'screens/AdminScreen.tsx',
  );
} else {
  fail(
    'Admin sync status removed',
    'AdminScreen still contains dynamic sync status/log/progress or raw sync error markers.',
    'Remove user-facing syncStatus, syncMessage, syncResult, syncLog, syncProgress, readAsStringAsync, Sync failed, /var/mobile, and does not exist from AdminScreen.',
    'screens/AdminScreen.tsx',
  );
}

if (
  !hasAny(syncService, [
    'lastError: result',
    'errors.push(result)',
    'AsyncStorage.setItem(key, value)',
  ]) &&
  hasAll(syncService, [
    'lastError: sanitizedResult',
    'formatQueueItemFailure(item, sanitizedResult)',
    'await persistVerifiedOfflineQueue(parseOfflineQueueValue(result.value))',
    'await AsyncStorage.setItem(key, nextValue)',
  ])
) {
  pass(
    'Persisted sync error cleanup',
    'Sync queue/status storage sanitizes stale raw messages and does not persist raw sync errors.',
    'services/SyncService.ts, App.tsx',
  );
} else {
  fail(
    'Persisted sync error cleanup',
    'Persisted sync storage may still save raw sync errors.',
    'Sanitize stored sync/admin/status keys, clean queue lastError values, remove stale missing-photo queue entries, and write sanitized values back to AsyncStorage.',
    'services/SyncService.ts, App.tsx',
  );
}

if (
  hasAll(reportsScreen, ['combined_project_update']) &&
  hasAny(reportsScreen, [
    'No report is sent automatically',
    'Copy, Email, and Text unlock after approval',
  ])
) {
  pass(
    'Combined update',
    'Combined Update exists and requires review before sending/copying.',
    'screens/ReportsScreen.tsx',
  );
} else {
  warn(
    'Combined update',
    'Combined Update or review-before-send language was not found.',
    'Add Combined Update mode and keep send/copy behind explicit user review.',
    'screens/ReportsScreen.tsx',
  );
}

if (
  !hasAny(bottomNav, ['Locations', 'Project Areas']) &&
  hasAny(adminScreen, ['Advanced Configuration', 'Area Mapping'])
) {
  pass(
    'Location workflow placement',
    'Locations/Project Areas are not primary navigation and Area Mapping is in advanced admin configuration.',
    'components/app-bottom-tabs.tsx, screens/AdminScreen.tsx',
  );
} else {
  warn(
    'Location workflow placement',
    'Location or Project Areas may still appear as a primary workflow.',
    'Keep location/project-area setup behind More > Admin > Advanced Configuration > Area Mapping.',
    'components/app-bottom-tabs.tsx, screens/AdminScreen.tsx',
  );
}

const diagnosticsIndex = adminScreen.indexOf('label="Diagnostics"');
const advancedIndex = adminScreen.indexOf('Advanced / Diagnostics');
const developerSupportIndex = adminScreen.indexOf('Developer Support');

if (diagnosticsIndex === -1) {
  warn(
    'Admin diagnostics',
    'Diagnostics action was not found.',
    'Keep diagnostics available behind More/Admin or an advanced/dev area for support.',
    'screens/AdminScreen.tsx',
  );
} else if (
  advancedIndex !== -1 &&
  developerSupportIndex > advancedIndex &&
  diagnosticsIndex > developerSupportIndex
) {
  pass(
    'Admin diagnostics',
    'Diagnostics is under Advanced Configuration / Developer Support with friendly setup checks and connection tools.',
    'screens/AdminScreen.tsx',
  );
} else {
  warn(
    'Admin diagnostics',
    'Diagnostics is behind More/Admin, but not clearly inside Advanced Configuration / Developer Support.',
    'Move Diagnostics under Advanced Configuration or Developer Support and label raw diagnostics, connection tests, and debug data as support tools.',
    'screens/AdminScreen.tsx',
  );
}

const adminRawDiagnosticMarkers = [
  'rawSupabaseUrl',
  'createClientUrl',
  'rootFetch.url',
  'rootFetch.status',
  'restFetch.url',
  'restFetch.status',
  'projectUrl',
  'Supabase REST',
];
const adminRawDiagnosticLeaks = adminRawDiagnosticMarkers.filter(marker =>
  adminScreen.includes(marker),
);

if (
  adminRawDiagnosticLeaks.length === 0 &&
  hasAll(adminScreen, [
    'Cloud configuration is ready.',
    'Projects currently shown in Vitruvius',
    'Developer Support',
    'label="Diagnostics"',
  ]) &&
  hasAll(diagnosticsScreen, [
    'Admin Diagnostics',
    'System Check',
    'GPS Setup Status',
    'Basic setup status',
  ])
) {
  pass(
    'Admin raw diagnostics visibility',
    'Normal Admin and Diagnostics use friendly setup and cloud status without exposing raw backend details.',
    'screens/AdminScreen.tsx, App.tsx',
  );
} else {
  fail(
    'Admin raw diagnostics visibility',
    `Normal Admin can expose raw diagnostic details${adminRawDiagnosticLeaks.length ? `: ${adminRawDiagnosticLeaks.join(', ')}` : '.'}`,
    'Remove raw backend URLs, fetch status details, and diagnostic identifiers from normal Admin and Diagnostics.',
    'screens/AdminScreen.tsx, App.tsx',
  );
}

if (
  hasAll(app, [
    'authoritativeScheduleItems',
    'overviewPrioritySupport',
    'topPriority.scheduleHealth',
  ]) &&
  hasAll(daveProjectTruth, [
    'function buildScheduleTruth',
    'activities complete.',
    'due within 7 days',
  ])
) {
  pass(
    'Today schedule loaded fallback',
    'Today renders a non-empty Schedule loaded summary whenever scheduleItems are present, even while Runtime is preparing insights.',
    'App.tsx, services/DAVEProjectTruth.ts',
  );
} else {
  fail(
    'Today schedule loaded fallback',
    'Today can still render the empty schedule message while scheduleItems are present.',
    'Build Today schedule text from scheduleItems first, show Schedule loaded: X activities, and reserve the empty Runtime summary only for zero scheduleItems.',
    'App.tsx, services/DAVEProjectTruth.ts',
  );
}

if (hasAll(homeDashboard, ["Today's Priority", 'Review priority', 'liveAuthority.projectTruth.briefing'])) {
  pass(
    'Today PIE briefing',
    'Overview shows DAVE’s current priority, supporting briefing, and one review action.',
    'App.tsx',
  );
} else {
  warn(
    'Today PIE briefing',
    'DAVE priority briefing was not detected on Overview.',
    'Show the current priority, supporting briefing, and one review action on Overview.',
    'App.tsx',
  );
}

if (
  hasAll(projectCards, [
    'overviewProjectHealth',
    'overviewProjectSummary',
    'overviewProjectActivity',
    'onOpenProject(row.project)',
  ])
) {
  pass(
    'Project cards',
    'Project cards show current health, bounded project status, recent activity, and open the project workspace.',
    'App.tsx',
  );
} else {
  warn(
    'Project cards',
    'Project cards may be missing current health, status, activity, or workspace navigation.',
    'Show project health, bounded status, recent activity, and a clear project destination.',
    'App.tsx',
  );
}

if (
  fileExists('docs/PIE_JARVIS_ExperienceQA.md') &&
  hasAll(experienceQaStandard, [
    'Technical QA',
    'Visual QA',
    'UX QA',
    'Executive QA',
    'Cognitive QA',
    'Apple HIG QA',
    'Experience Constitution QA',
    'PIE Intelligence QA',
    'Build Score',
    'Rejection Report',
    'If Apple reviewed this build tomorrow, what would they reject?',
  ])
) {
  pass(
    'Experience QA Standard',
    'JARVIS Experience QA 2.0 standard defines technical, visual, UX, executive, cognitive, Experience Constitution, Apple HIG, scoring, and rejection reporting.',
    'docs/PIE_JARVIS_ExperienceQA.md',
  );
} else {
  fail(
    'Experience QA Standard',
    'The Experience QA 2.0 standard is missing required product-review categories or reporting rules.',
    'Create docs/PIE_JARVIS_ExperienceQA.md with all requested QA categories, build scoring, rejection report, and Apple Review Notes.',
    'docs/PIE_JARVIS_ExperienceQA.md',
  );
}

if (
  hasAll(jarvisQaDoc, [
    'Technical',
    'Visual',
    'UX',
    'Executive',
    'Cognitive',
    'Experience',
    'Apple HIG',
    'Overall',
    'PASS WITH WARNINGS',
  ])
) {
  pass(
    'Experience QA documentation',
    'Project JARVIS documentation describes the new category scoring model.',
    'docs/ProjectVisionAI_JARVIS_QA.md',
  );
} else {
  fail(
    'Experience QA documentation',
    'Project JARVIS documentation does not describe the Experience QA 2.0 score categories and status model.',
    'Document the category scores and PASS / PASS WITH WARNINGS / FAIL release statuses.',
    'docs/ProjectVisionAI_JARVIS_QA.md',
  );
}

if (
  hasAll(homeDashboard, ['numberOfLines', 'overviewPriorityRecommendation', 'overviewPrioritySupport']) &&
  hasAll(app, ['adjustsFontSizeToFit', 'minimumFontScale']) &&
  hasAll(appShellTheme, ['flexWrap']) &&
  hasAll(photoCapture, ['Capture Evidence', 'Photo saved.', 'Next Suggested Action']) &&
  hasAll(reportsScreen, ['numberOfLines', 'flexWrap', 'BeforeYouSharePanel'])
) {
  pass(
    'Visual QA - flexible content',
    'Mission, report, and capture surfaces avoid obvious fixed-height variable-content cards and include text wrapping safeguards.',
    'Major UI source includes wrapping/dynamic text markers.',
  );
} else {
  fail(
    'Visual QA - flexible content',
    'JARVIS cannot verify that variable mission, report, and capture content avoids clipping or fixed-height card failures.',
    'Use flexible card heights and explicit wrapping/dynamic text safeguards for variable content.',
    'Mission/report/capture card source review required.',
  );
}

if (
  hasAll(bottomNav, ['Overview', 'Tasks', 'Talk', 'Reports']) &&
  !hasAny(primaryBottomNavSource, ['Diagnostics', 'Developer Tools']) &&
  hasAny(bottomNav, ['flex: 1', 'numberOfLines', 'justifyContent'])
) {
  pass(
    'Visual QA - navigation labels',
    'Bottom navigation uses the live Overview / Tasks / Talk / Reports workflow and does not expose developer labels.',
    'components/app-bottom-tabs.tsx',
  );
} else {
  fail(
    'Visual QA - navigation labels',
    'Navigation labels may clip, confuse the user, or expose developer tools as primary navigation.',
    'Keep bottom navigation to Overview, Tasks, Talk, and Reports with resilient label sizing.',
    'components/app-bottom-tabs.tsx',
  );
}

if (
  hasAll(majorUiSource, ['SafeAreaView']) &&
  hasAny(majorUiSource, ['minHeight: 44', 'minHeight: 48', 'minHeight: 52', 'minHeight: 54'])
) {
  pass(
    'Apple HIG - safe area and touch targets',
    'App surfaces use safe-area handling and include 44pt-or-larger touch target markers.',
    'SafeAreaView and minHeight touch target markers found.',
  );
} else {
  fail(
    'Apple HIG - safe area and touch targets',
    'JARVIS cannot verify safe-area handling and minimum touch target sizing.',
    'Use safe-area containers and 44pt minimum touch targets for primary controls.',
    'Major UI source review required.',
  );
}

if (hasAll(majorUiSource, ['spacing']) && hasAll(majorUiSource, ['typography'])) {
  pass(
    'Apple HIG - spacing and typography',
    'Major screens use shared spacing and typography tokens for a consistent native-feeling interface.',
    'theme/spacing.ts and theme/typography.ts markers are consumed.',
  );
} else {
  warn(
    'Apple HIG - spacing and typography',
    'Some major screens may still rely on local spacing or typography instead of shared tokens.',
    'Prefer shared spacing and typography tokens on normal user-facing surfaces.',
    'Major UI source review required.',
  );
}

if (
  hasAll(homeDashboard, ["Today's Priority", 'Review priority']) &&
  hasAll(photoCapture, ['Capture Evidence', 'Add Another Photo', 'Add Note']) &&
  hasAll(reportsScreen, ['BeforeYouSharePanel', 'Approve Report', 'reportActionButtonPrimary'])
) {
  pass(
    'UX QA - one dominant action',
    'PIE, Capture, and Review expose one dominant action with secondary actions kept subordinate.',
    'App.tsx, screens/ReportsScreen.tsx',
  );
} else {
  fail(
    'UX QA - one dominant action',
    'JARVIS cannot verify that major daily screens keep one dominant next action.',
    'Render one primary action on PIE, Capture, and Review, with secondary controls visually subordinate.',
    'App.tsx, screens/ReportsScreen.tsx',
  );
}

if (
  hasAll(app, ['Why:', 'Photo saved.', 'Next Suggested Action']) &&
  hasAll(reportsScreen, [
    'Report Check',
    'Read the report and approve it when it matches the current project status.',
    'Approve Report',
    'No report is sent automatically',
  ])
) {
  pass(
    'Experience QA - user always has a next step',
    'PIE, Capture, and Review show what matters, why, and the next user action in plain language.',
    'Major daily screens',
  );
} else {
  fail(
    'Experience QA - user always has a next step',
    'A normal user may still need to ask what to do next on PIE, Capture, or Review.',
    'Show what matters, why it matters, and one next action at the top of each daily-use screen.',
    'Major daily screens',
  );
}

if (
  hasAll(pieExperienceConstitution, [
    'One screen, one purpose.',
    'One dominant primary action.',
    'PIE leads; the user verifies.',
    'Advanced tools live under More.',
    'Never expose internal cognitive models to normal users.',
    'The interface should become simpler as PIE becomes smarter.',
  ]) &&
  !hasAny(normalUserUiText, [
    'Scientific Method',
    'Pattern Engine',
    'Belief Engine',
    'Deliberation',
    'Reflection Engine',
    'Learning Engine',
    'Core Intelligence',
    'Knowledge Graph',
  ])
) {
  pass(
    'Experience Constitution QA',
    'The Experience Constitution exists and normal user-facing text avoids internal cognitive model names.',
    'docs/PIE_ExperienceConstitution.md and extracted UI literals',
  );
} else {
  fail(
    'Experience Constitution QA',
    'The app may violate the Experience Constitution by missing required rules or exposing internal cognitive model names.',
    'Keep internal cognitive models out of normal user-facing UI and align daily screens to one purpose and one dominant action.',
    'docs/PIE_ExperienceConstitution.md',
  );
}

if (
  hasAll(pieReporter, [
    'removeRepeatedPhrases',
    'removeDuplicateWorkAreaPhrases',
    'buildReportReviewFlags',
    'sourceEvidenceIds',
    'imageReferences',
    'owner',
    'locationGroups',
    'whyRecommended',
  ]) &&
  hasAll(reportsScreen, ['reviewFlags', 'Copy, Email, and Text unlock after approval', 'No report is sent automatically'])
) {
  pass(
    'Executive QA - report quality gates',
    'Reporter removes duplicate phrasing, tracks evidence/images/owners/locations, shows review flags, and preserves the approval boundary.',
    'services/PIEReporter.ts and screens/ReportsScreen.tsx',
  );
} else {
  fail(
    'Executive QA - report quality gates',
    'Report generation may allow weak executive output, missing evidence, or communication before approval.',
    'Keep duplicate cleanup, review flags, owners, locations, image references, evidence links, and approval-before-copy/email checks.',
    'Reporter and Review source review required.',
  );
}

if (
  hasAll(pieReporter, [
    'No supporting evidence was found for this report.',
    'Some evidence is missing a project.',
    'One or more action items need an owner.',
    'One or more evidence items need a confirmed location.',
    'One or more work areas need a clearer evidence summary.',
    'Evidence-backed recommendation:',
  ])
) {
  pass(
    'Executive QA - evidence-backed recommendations',
    'Reporter flags missing evidence, missing project context, missing owners, and explains recommendations from evidence.',
    'services/PIEReporter.ts',
  );
} else {
  fail(
    'Executive QA - evidence-backed recommendations',
    'Reporter may produce recommendations without enough executive-quality evidence, owners, or locations.',
    'Add report warnings for missing evidence, missing owners, missing locations, weak summaries, and recommendations without why.',
    'services/PIEReporter.ts',
  );
}

if (
  hasAll(cognitiveSource, [
    'runPIEScientificMethod',
    'buildPIEBeliefs',
    'buildPIEPatternIntelligence',
    'buildPIEExecutiveReasoning',
    'buildPIEPredictions',
    'buildPIELearning',
    'buildPIEReflection',
    'buildPIEMemoryRecall',
    'explanations',
    'missingData',
  ])
) {
  pass(
    'Cognitive QA - connected intelligence layers',
    'Scientific Method, beliefs, patterns, executive reasoning, prediction, learning, reflection, memory, explanation, and missing-data checks are connected in PIE source.',
    'services/PIE*.ts',
  );
} else {
  fail(
    'Cognitive QA - connected intelligence layers',
    'PIE cognitive layers are not fully detectable as connected product intelligence.',
    'Ensure core intelligence consumes Scientific Method, beliefs, patterns, executive reasoning, prediction, learning, reflection, memory, explanations, and missing-data signals.',
    'services/PIE*.ts',
  );
}

if (
  hasAll(pieCoreIntelligence, [
    'evidenceReview',
    'interpretations',
    'relationships',
    'beliefs',
    'opinions',
    'decisionsNeeded',
    'recommendations',
    'explanations',
    'learningSignals',
    'nextBestActions',
  ])
) {
  pass(
    'PIE Intelligence QA - reusable brain output',
    'PIE Core Intelligence exposes review, interpretation, relationships, beliefs, opinions, decisions, recommendations, explanations, learning, and next best actions.',
    'services/PIECoreIntelligence.ts',
  );
} else {
  fail(
    'PIE Intelligence QA - reusable brain output',
    'PIE Core Intelligence output is missing required reusable intelligence fields.',
    'Restore the core output contract for evidenceReview, interpretations, relationships, beliefs, opinions, decisionsNeeded, recommendations, explanations, learningSignals, and nextBestActions.',
    'services/PIECoreIntelligence.ts',
  );
}

const missingEvidencePaths = Array.from(new Set(
  results.flatMap(result => {
    const concretePaths = result.evidence?.match(
      /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:tsx|ts|js|md|json|sql)\b/g,
    ) || [];

    return concretePaths.filter(relativePath =>
      !relativePath.includes('*') && !fileExists(relativePath),
    );
  }),
));

if (missingEvidencePaths.length > 0) {
  fail(
    'QA evidence integrity',
    `JARVIS results cite missing files: ${missingEvidencePaths.join(', ')}.`,
    'Update each affected result to cite the live implementation or remove the stale check.',
    'scripts/jarvis-qa.js',
  );
} else {
  pass(
    'QA evidence integrity',
    'Every concrete file cited by a JARVIS result exists in the current repository.',
    'scripts/jarvis-qa.js',
  );
}

const counts = results.reduce(
  (summary, result) => {
    summary[result.status] += 1;
    return summary;
  },
  { PASS: 0, WARN: 0, FAIL: 0 },
);

const categoryScores = buildCategoryScores();
const overallScore = Math.round(
  categoryScores.reduce((total, item) => total + item.score, 0) / categoryScores.length,
);
const contractStatus =
  counts.FAIL > 0 ? 'FAIL' : counts.WARN > 0 ? 'PASS WITH WARNINGS' : 'PASS';
const topProblems = buildTopProblems();
const appleReviewNotes = buildAppleReviewNotes(categoryScores, counts);

console.log('V.I.C. Static Contract Audit');
console.log(`Generated: ${new Date().toISOString()}`);
console.log(`Contract Status: ${contractStatus}`);
console.log(
  `Contract Summary: ${counts.PASS} PASS / ${counts.WARN} WARN / ${counts.FAIL} FAIL`,
);
console.log(`Contract Score: ${overallScore}/100`);
console.log('Runtime behavior: NOT EVALUATED');
console.log('Physical-device behavior: NOT EVALUATED');
console.log('Run npm run jarvis:qa for the complete automated release gate.');
console.log('');

console.log('Category Scores');
categoryScores.forEach(score => {
  console.log(
    `${symbolForStatus(score.status)} ${score.category}: ${score.score}/100 (${score.checks} checks, ${score.failCount} fail, ${score.warnCount} warn)`,
  );
});
console.log(`Overall: ${overallScore}/100`);
console.log('');

console.log('Static Contract Problems - Top 10');
if (topProblems.length === 0) {
  console.log('No static contract problems or warnings found. Runtime and device validation are still required.');
} else {
  topProblems.forEach((problem, index) => {
    console.log(`${index + 1}. ${problem.workflow} [${problem.status}]`);
    console.log(`   Problem: ${problem.issue}`);
    console.log(`   Why it matters: This can reduce product trust, field usability, or release readiness.`);
    console.log(`   Suggested correction: ${problem.recommendedFix}`);
    console.log(`   Owner: ${problem.owner}`);

    if (problem.evidence) {
      console.log(`   Evidence: ${problem.evidence}`);
    }
  });
}
console.log('');

console.log('Detailed Checks');
results.forEach(result => {
  console.log(`${symbolForStatus(result.status)} [${result.status}] ${result.workflow}`);
  console.log(`  Issue: ${result.issue}`);
  console.log(`  Recommended fix: ${result.recommendedFix}`);

  if (result.evidence) {
    console.log(`  Evidence: ${result.evidence}`);
  }

  console.log('');
});

console.log('Apple Review Notes');
console.log('If Apple reviewed this build tomorrow, what would they reject?');
appleReviewNotes.forEach((note, index) => {
  console.log(`${index + 1}. ${note}`);
});
console.log('');

if (counts.FAIL > 0) {
  process.exitCode = 1;
}
