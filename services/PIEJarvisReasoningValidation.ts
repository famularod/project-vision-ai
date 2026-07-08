import type { PIEDecisionSimulationResult } from './PIEDecisionSimulation';
import type { PIERecommendationChallengeResult } from './PIERecommendationChallenge';
import type { PIEExecutiveJudgmentResult } from './PIEExecutiveJudgment';
import type { PIERealityModel } from './PIERealityModel';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEJarvisReasoningStatus =
  | 'pass'
  | 'pass_with_warnings'
  | 'needs_more_evidence'
  | 'human_review_required'
  | 'blocked';

export type PIEJarvisReasoningCheck = {
  id: string;
  label: string;
  status: PIEJarvisReasoningStatus;
  evidence: string[];
  issue: string;
  requiredFix: string;
};

export type PIEJarvisReasoningValidation = {
  generatedAt: string;
  validationId: string;
  status: PIEJarvisReasoningStatus;
  checks: PIEJarvisReasoningCheck[];
  blockingIssues: PIEJarvisReasoningCheck[];
  warnings: PIEJarvisReasoningCheck[];
  userFacingBoundary: string;
  summary: string;
};

export type PIEJarvisReasoningInput = {
  realityModel: PIERealityModel;
  executiveJudgment: PIEExecutiveJudgmentResult;
  simulation: PIEDecisionSimulationResult;
  challenge: PIERecommendationChallengeResult;
  generatedAt?: string;
};

export function validatePIEReasoningWithJARVIS(
  input: PIEJarvisReasoningInput,
): PIEJarvisReasoningValidation {
  const generatedAt = input.generatedAt || input.executiveJudgment.generatedAt || new Date().toISOString();
  const checks = [
    checkRealityAuthority(input),
    checkEvidenceTraceability(input),
    checkAssertionClassification(input),
    checkFactSupport(input),
    checkUnresolvedConflicts(input),
    checkUncertaintyDisclosure(input),
    checkOptionCompleteness(input),
    checkNoActionConsidered(input),
    checkTradeoffAnalysis(input),
    checkScoreReproducibility(input),
    checkSimulationReproducibility(input),
    checkSensitivityAnalysis(input),
    checkAuthorityBoundaries(input),
    checkRecommendationRobustness(input),
    checkPhotoEvidenceInterpretation(input),
    checkCausalReasoning(input),
    checkChallengeCompleteness(input),
    checkExplanationQuality(input),
    checkNoFabricatedFacts(input),
    checkHiddenAssumptions(input),
    checkUserSummaryConsistency(input),
  ];
  const status = aggregateStatus(checks);
  const blockingIssues = checks.filter(check => check.status === 'blocked' || check.status === 'human_review_required');
  const warnings = checks.filter(check => check.status === 'pass_with_warnings' || check.status === 'needs_more_evidence');

  return {
    generatedAt,
    validationId: `jarvis-reasoning-${input.simulation.simulationRunId}`,
    status,
    checks,
    blockingIssues,
    warnings,
    userFacingBoundary: status === 'pass'
      ? 'Recommendation may reach the normal user experience.'
      : status === 'pass_with_warnings'
        ? 'Recommendation may be shown with uncertainty wording.'
        : 'Recommendation must request evidence or human review before high-impact action.',
    summary: `JARVIS reasoning validation ${status}: ${checks.length - warnings.length - blockingIssues.length}/${checks.length} checks passed without issue.`,
  };
}

function checkRealityAuthority(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const ok = input.executiveJudgment.authority.realityModelVersion === input.realityModel.version &&
    input.executiveJudgment.authority.realitySnapshotId.length > 0;
  return check('reality-authority', 'Reality Model authority', ok ? 'pass' : 'blocked',
    [input.executiveJudgment.authority.realityModelId, input.executiveJudgment.authority.realitySnapshotId],
    ok ? 'Reality authority is traceable.' : 'Executive Judgment is not tied to the authoritative Reality version.',
    'Build recommendation from the authoritative Reality Model and snapshot.');
}

function checkEvidenceTraceability(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const evidenceCount = input.realityModel.objects.reduce((total, object) => total + object.sourceEvidenceReferences.length, 0);
  return check('evidence-traceability', 'Evidence traceability', evidenceCount > 0 ? 'pass' : 'blocked',
    input.realityModel.objects.flatMap(object => object.sourceEvidenceReferences.map(evidence => evidence.evidenceId)).slice(0, 8),
    evidenceCount > 0 ? 'Reality Objects carry source evidence.' : 'Recommendation lacks source evidence traceability.',
    'Attach qualified evidence references to Reality Objects before recommending.');
}

function checkAssertionClassification(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const assertions = input.realityModel.objects.flatMap(object => object.assertions);
  const unclassified = assertions.filter(assertion => !assertion.classification);
  return check('assertion-classification', 'Assertion classification', unclassified.length === 0 ? 'pass' : 'blocked',
    assertions.map(assertion => assertion.id).slice(0, 8),
    unclassified.length === 0 ? 'Assertions are classified.' : 'Some assertions are not classified.',
    'Classify assertions as fact, assumption, inference, or prediction.');
}

function checkFactSupport(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const unsupportedFacts = input.realityModel.objects
    .flatMap(object => object.assertions)
    .filter(assertion => assertion.classification === 'fact' && assertion.supportingEvidenceIds.length === 0);
  return check('fact-support', 'Fact support', unsupportedFacts.length === 0 ? 'pass' : 'blocked',
    unsupportedFacts.map(assertion => assertion.id),
    unsupportedFacts.length === 0 ? 'Facts have supporting evidence.' : 'Fact assertions lack supporting evidence.',
    'Downgrade unsupported facts or add supporting evidence.');
}

function checkUnresolvedConflicts(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const open = input.realityModel.evidenceConflicts.filter(conflict => conflict.status === 'open' || conflict.status === 'investigating');
  return check('unresolved-conflicts', 'Unresolved conflicts', open.length === 0 ? 'pass' : 'needs_more_evidence',
    open.map(conflict => conflict.id),
    open.length === 0 ? 'No blocking unresolved conflicts.' : 'Open conflicts must remain visible and reduce confidence.',
    'Request targeted evidence or human review for material conflicts.');
}

function checkUncertaintyDisclosure(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const uncertainty = input.realityModel.activeUncertainties.length + input.simulation.sensitivityAnalysis.assumptionsThatMatterMost.length;
  const disclosed = input.executiveJudgment.waitForEvidenceReasoning.evidenceNeeded.length > 0 ||
    input.executiveJudgment.actionSafetyCheck.warnings.length > 0 ||
    input.simulation.sensitivityAnalysis.missingEvidenceThatImprovesDecision.length > 0;
  return check('uncertainty-disclosure', 'Uncertainty disclosure', uncertainty === 0 || disclosed ? 'pass' : 'needs_more_evidence',
    input.realityModel.activeUncertainties.map(item => item.id),
    uncertainty === 0 || disclosed ? 'Uncertainty is disclosed.' : 'Uncertainty exists but is not disclosed.',
    'Disclose the most important uncertainty and the evidence that would reduce it.');
}

function checkOptionCompleteness(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const hasRecommendation = input.simulation.options.some(option => option.optionType === 'recommended_action');
  const hasAlternative = input.simulation.options.some(option => option.optionType === 'credible_alternative');
  const hasNoAction = input.simulation.options.some(option => option.optionType === 'no_action');
  const complete = hasRecommendation && hasAlternative && hasNoAction;
  return check('option-completeness', 'Option completeness', complete ? 'pass' : 'blocked',
    input.simulation.options.map(option => option.optionId),
    complete ? 'Recommendation, alternative, and no-action options were considered.' : 'A required option class is missing.',
    'Include recommended action, credible alternative, and no-action options.');
}

function checkNoActionConsidered(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const ok = input.simulation.options.some(option => option.optionType === 'no_action') &&
    input.executiveJudgment.noActionReasoning.reason.length > 0;
  return check('no-action-considered', 'No-action consideration', ok ? 'pass' : 'blocked',
    ['option-no-action'],
    ok ? 'No-action was considered.' : 'No-action was not considered.',
    'Evaluate no action as a valid executive option.');
}

function checkTradeoffAnalysis(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const ok = input.executiveJudgment.tradeoffAnalysis.options.length > 0 &&
    input.executiveJudgment.tradeoffAnalysis.explanation.length > 0;
  return check('tradeoff-analysis', 'Tradeoff analysis', ok ? 'pass' : 'blocked',
    input.executiveJudgment.tradeoffAnalysis.options.map(option => option.id),
    ok ? 'Tradeoffs are documented.' : 'Tradeoff analysis is missing.',
    'Document gains, losses, and why alternatives lost.');
}

function checkScoreReproducibility(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const ok = input.simulation.scores.every(score => score.components.every(component =>
    Number.isFinite(component.score) && Number.isFinite(component.weight) && component.explanation.length > 0));
  return check('score-reproducibility', 'Score reproducibility', ok ? 'pass' : 'blocked',
    input.simulation.scores.map(score => score.optionId),
    ok ? 'Scores include category, weight, and explanation.' : 'Scores are not reproducible from structured components.',
    'Store category scores, weights, evidence, assumptions, adjustments, and explanation.');
}

function checkSimulationReproducibility(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const ok = input.simulation.scenarios.every(scenario => scenario.reproducibilityKey.length > 0) &&
    input.simulation.inputSignature.length > 0;
  return check('simulation-reproducibility', 'Simulation reproducibility', ok ? 'pass' : 'blocked',
    [input.simulation.inputSignature],
    ok ? 'Simulation has deterministic signature and scenario keys.' : 'Simulation lacks reproducibility keys.',
    'Use deterministic scenario generation and persist the input signature.');
}

function checkSensitivityAnalysis(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const ok = input.simulation.sensitivityAnalysis.factors.length >= 10;
  return check('sensitivity-analysis', 'Sensitivity analysis', ok ? 'pass' : 'blocked',
    input.simulation.sensitivityAnalysis.factors.map(factor => factor.factor),
    ok ? 'Required sensitivity factors were tested.' : 'Sensitivity analysis is incomplete.',
    'Test cost, duration, resources, evidence, risk, implementation, stakeholders, deadlines, and regulatory interpretation.');
}

function checkAuthorityBoundaries(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const status = input.challenge.authorityBoundaryChallenge.severity === 'critical'
    ? 'human_review_required'
    : 'pass';
  return check('authority-boundaries', 'Authority boundaries', status,
    input.simulation.provenance.conflictsConsidered,
    status === 'pass' ? 'Authority boundary is respected.' : 'Recommendation requires human authority.',
    'Require approval before high-impact or authority-bound action.');
}

function checkRecommendationRobustness(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const robustness = input.simulation.sensitivityAnalysis.robustness;
  const status: PIEJarvisReasoningStatus =
    robustness === 'robust' || robustness === 'moderately_sensitive'
      ? 'pass'
      : robustness === 'insufficient_evidence'
        ? 'needs_more_evidence'
        : 'pass_with_warnings';
  return check('recommendation-robustness', 'Recommendation robustness', status,
    [robustness],
    `Recommendation robustness is ${robustness}.`,
    'Disclose sensitive assumptions or collect evidence before high-impact action.');
}

function checkPhotoEvidenceInterpretation(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const photoScenario = input.simulation.scenarios.some(scenario => scenario.scenarioType === 'visual_progress_not_matching_reported_progress');
  const photoEvents = input.simulation.provenance.photoProgressEventIdsUsed;
  const challengeExists = Boolean(input.challenge.visualEvidenceOverinterpretationChallenge);
  const status: PIEJarvisReasoningStatus =
    photoScenario && input.challenge.visualEvidenceOverinterpretationChallenge.severity === 'high'
      ? 'needs_more_evidence'
      : challengeExists
        ? 'pass'
        : 'pass_with_warnings';
  return check('photo-evidence-interpretation', 'Photo evidence interpretation', status,
    [...photoEvents, input.challenge.visualEvidenceOverinterpretationChallenge?.id].filter(Boolean),
    status === 'pass'
      ? 'Photo evidence is qualified and not treated as proof of completion.'
      : photoScenario
        ? 'Visual evidence conflicts with written status and requires targeted confirmation.'
        : 'Photo interpretation challenge was not fully recorded.',
    'Separate observation, inference, and verified conclusion; request confirmation for conflicts.');
}

function checkCausalReasoning(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const causalClaims = [
    ...input.executiveJudgment.executiveRisks.map(risk => risk.whyItMatters),
    input.executiveJudgment.executiveJudgment.explanation.riskReduction,
  ].filter(text => /because|caus|due to|drives|leads to|results in/i.test(text));
  const hasContradictionReview = input.realityModel.evidenceConflicts.length === 0 ||
    input.challenge.strongestArgumentAgainst.evidenceReference.length > 0;
  const hasMechanism = causalClaims.length === 0 ||
    causalClaims.some(text => /because|due to|block|affect|schedule|inspection|safety|compliance/i.test(text));
  const ok = hasMechanism && hasContradictionReview;
  return check('causal-reasoning', 'Causal reasoning', ok ? 'pass' : 'pass_with_warnings',
    causalClaims.slice(0, 4),
    ok ? 'Causal language is bounded by mechanism and conflict review.' : 'Causal language may overstate sequence or correlation.',
    'Before claiming cause, preserve mechanism, competing-cause review, contradictory evidence, and confidence.');
}

function checkChallengeCompleteness(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const required = [
    input.challenge.strongestArgumentAgainst,
    input.challenge.disconfirmingEvidenceNeeded,
    input.challenge.noActionOrDelayCouldBeBetter,
    input.challenge.authorityBoundaryChallenge,
    input.challenge.confidenceOverstatementChallenge,
    input.challenge.visualEvidenceOverinterpretationChallenge,
    input.challenge.assumptionChangeChallenge,
  ];
  const ok = required.every(item => item && item.challenge.length > 0 && item.actionRequired.length > 0) &&
    input.challenge.implementationFailureRisks.length > 0 &&
    input.challenge.overlookedStakeholdersOrDependencies.length > 0;
  return check('challenge-completeness', 'Recommendation challenge completeness', ok ? 'pass' : 'blocked',
    required.map(item => item?.id).filter(Boolean),
    ok ? 'Challenge covers opposition, disconfirmation, dependencies, no-action, delay, authority, confidence, visual evidence, and assumptions.' : 'Recommendation challenge is incomplete.',
    'Run the full adversarial challenge before finalizing a material recommendation.');
}

function checkExplanationQuality(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const explanation = input.executiveJudgment.executiveJudgment.explanation;
  const ok = Boolean(explanation.whatMattersMost && explanation.decisionNeeded && explanation.noActionRationale);
  return check('explanation-quality', 'Explanation quality', ok ? 'pass' : 'blocked',
    [input.executiveJudgment.executiveJudgmentSummary],
    ok ? 'Explanation covers what matters, decision, and no-action rationale.' : 'Explanation is incomplete.',
    'Explain why the recommendation is better than alternatives.');
}

function checkNoFabricatedFacts(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const unsupported = input.executiveJudgment.highestValueAction?.governance.supportingEvidence.length === 0;
  return check('no-fabricated-facts', 'Absence of fabricated facts', unsupported ? 'needs_more_evidence' : 'pass',
    input.executiveJudgment.highestValueAction?.governance.supportingEvidence || [],
    unsupported ? 'Recommendation needs explicit supporting evidence.' : 'Recommendation is tied to supporting evidence.',
    'Use only evidence-backed statements and mark assumptions clearly.');
}

function checkHiddenAssumptions(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const assumptions = input.simulation.provenance.assumptions;
  return check('hidden-assumptions', 'Absence of hidden assumptions', assumptions.length > 0 ? 'pass' : 'pass_with_warnings',
    assumptions,
    assumptions.length > 0 ? 'Assumptions are recorded.' : 'No assumptions were recorded.',
    'Record assumptions that affect option ranking or confidence.');
}

function checkUserSummaryConsistency(input: PIEJarvisReasoningInput): PIEJarvisReasoningCheck {
  const selected = input.simulation.selectedOption?.action || '';
  const summary = input.executiveJudgment.executiveJudgmentSummary;
  const ok = !selected || summary.includes(selected.slice(0, Math.min(24, selected.length))) ||
    input.challenge.recalculatedRecommendation.includes(selected.slice(0, Math.min(24, selected.length)));
  return check('summary-consistency', 'User-facing summary consistency', ok ? 'pass' : 'pass_with_warnings',
    [selected, summary],
    ok ? 'User-facing summary is consistent with selected option.' : 'Summary may not match selected option wording.',
    'Keep Reporter and UI wording aligned with Executive Judgment and simulation outcome.');
}

function aggregateStatus(checks: PIEJarvisReasoningCheck[]): PIEJarvisReasoningStatus {
  if (checks.some(check => check.status === 'blocked')) return 'blocked';
  if (checks.some(check => check.status === 'human_review_required')) return 'human_review_required';
  if (checks.some(check => check.status === 'needs_more_evidence')) return 'needs_more_evidence';
  if (checks.some(check => check.status === 'pass_with_warnings')) return 'pass_with_warnings';
  return 'pass';
}

function check(
  id: string,
  label: string,
  status: PIEJarvisReasoningStatus,
  evidence: string[],
  issue: string,
  requiredFix: string,
): PIEJarvisReasoningCheck {
  return { id, label, status, evidence, issue, requiredFix };
}
