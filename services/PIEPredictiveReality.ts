import type { PIEBeliefEngineResult } from './PIEBeliefEngine';
import type { PIEEvidenceTimeline } from './PIEEvidenceTimeline';
import type { PIEMissingEvidenceResult } from './PIEMissingEvidence';
import type { PIEPatternIntelligence } from './PIEPatternEngine';
import type { PIEPredictionResult } from './PIEPredictiveEngine';
import type {
  PIERealityModel,
  PIERealityObject,
  PIERealityObjectIntelligenceResult,
  PIERealityObjectStatus,
  PIERealityReadiness,
  PIERealityRiskLevel,
} from './PIERealityModel';
import type { PIESituationResult } from './PIESituationIntelligence';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIERealityForecast =
  | 'most_likely'
  | 'best_case'
  | 'worst_case'
  | 'no_action'
  | 'recovery_action';

export type PIEFutureObjectState = {
  id: string;
  objectId: string;
  objectName: string;
  projectName: string | null;
  areaName: string | null;
  forecastType: PIERealityForecast;
  currentStatus: PIERealityObjectStatus;
  futureStatus: PIERealityObjectStatus;
  currentReadiness: PIERealityReadiness;
  futureReadiness: PIERealityReadiness;
  likelyChange: 'becomes_ready' | 'becomes_blocked' | 'stays_blocked' | 'needs_verification' | 'stays_ready' | 'uncertain';
  timeHorizonDays: number;
  reason: string;
  evidenceToVerify: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEReadinessForecast = {
  id: string;
  forecastType: PIERealityForecast;
  readiness: PIERealityReadiness;
  summary: string;
  readyObjectCount: number;
  uncertainObjectCount: number;
  blockedObjectCount: number;
  confidence: ProjectConfidenceLevel;
};

export type PIECascadingEffect = {
  id: string;
  forecastType: PIERealityForecast;
  sourceObjectId: string | null;
  sourceObjectName: string;
  affectedObjectId: string | null;
  effect: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  forecastImpact: string;
  confidence: ProjectConfidenceLevel;
};

export type PIERealityEvolution = {
  id: string;
  forecastType: PIERealityForecast;
  summary: string;
  likelyNextChange: string;
  uncertaintyTomorrow: string;
  verificationNeeded: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEPredictiveRealityRisk = {
  id: string;
  risk: string;
  growsIfNothingChanges: boolean;
  affectedObjectId: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  verificationNeeded: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEPredictiveRealityOpportunity = {
  id: string;
  opportunity: string;
  recoveryAction: string;
  objectId: string | null;
  expectedRealityChange: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEPredictiveReality = {
  generatedAt: string;
  forecastType: PIERealityForecast;
  predictedEvent: string;
  timeframe: string;
  assumptions: string[];
  leadingIndicators: string[];
  probabilityOrConfidence: ProjectConfidenceLevel;
  supportingRealityObjectIds: string[];
  risksThatCouldAlterForecast: string[];
  reassessmentTrigger: string;
  expectedConfirmingEvidence: string[];
  summary: string;
  futureObjectStates: PIEFutureObjectState[];
  readinessForecast: PIEReadinessForecast;
  cascadingEffects: PIECascadingEffect[];
  realityEvolution: PIERealityEvolution;
  risks: PIEPredictiveRealityRisk[];
  opportunities: PIEPredictiveRealityOpportunity[];
  confidence: ProjectConfidenceLevel;
};

export type PIEPredictiveRealityResult = {
  generatedAt: string;
  predictiveReality: PIEPredictiveReality;
  forecasts: PIEPredictiveReality[];
  futureObjectStates: PIEFutureObjectState[];
  readinessForecasts: PIEReadinessForecast[];
  cascadingEffects: PIECascadingEffect[];
  noActionForecast: PIEPredictiveReality;
  recoveryForecast: PIEPredictiveReality;
  risks: PIEPredictiveRealityRisk[];
  opportunities: PIEPredictiveRealityOpportunity[];
  predictiveRealitySummary: string;
  explanation: string;
  priorForecastsForCalibration: PIEPredictiveReality[];
  forecastInvalidationTriggers: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEPredictiveRealityInput = {
  realityModel: PIERealityModel;
  objectIntelligence?: PIERealityObjectIntelligenceResult | null;
  situationIntelligence?: PIESituationResult | null;
  evidenceTimeline?: PIEEvidenceTimeline | null;
  beliefSystem?: PIEBeliefEngineResult | null;
  patternIntelligence?: PIEPatternIntelligence | null;
  predictionResult?: PIEPredictionResult | null;
  missingEvidence?: PIEMissingEvidenceResult | null;
  priorForecasts?: PIEPredictiveReality[];
  generatedAt?: string;
};

export function buildPIEPredictiveReality(
  input: PIEPredictiveRealityInput,
): PIEPredictiveRealityResult {
  const generatedAt = input.generatedAt || input.realityModel.generatedAt || new Date().toISOString();
  const forecasts: PIEPredictiveReality[] = [
    buildForecast(input, 'most_likely', generatedAt),
    buildForecast(input, 'best_case', generatedAt),
    buildForecast(input, 'worst_case', generatedAt),
    buildNoActionForecast(input, generatedAt),
    buildRecoveryForecast(input, generatedAt),
  ];
  const noActionForecast = forecasts.find(forecast => forecast.forecastType === 'no_action') || forecasts[0];
  const recoveryForecast = forecasts.find(forecast => forecast.forecastType === 'recovery_action') || forecasts[0];
  const predictiveReality = forecasts[0];
  const futureObjectStates = forecastObjectStates(input, 'most_likely', generatedAt);
  const readinessForecasts = forecasts.map(forecast => forecast.readinessForecast);
  const cascadingEffects = forecastCascadingEffects(input, 'most_likely');
  const risks = identifyPredictiveRealityRisks(input, noActionForecast);
  const opportunities = identifyPredictiveRealityOpportunities(input, recoveryForecast);
  const predictiveRealitySummary = summarizePredictiveReality({
    ...predictiveReality,
    risks,
    opportunities,
  });

  return {
    generatedAt,
    predictiveReality: {
      ...predictiveReality,
      risks,
      opportunities,
      summary: predictiveRealitySummary,
    },
    forecasts,
    futureObjectStates,
    readinessForecasts,
    cascadingEffects,
    noActionForecast,
    recoveryForecast,
    risks,
    opportunities,
    predictiveRealitySummary,
    explanation: explainPredictiveReality({
      ...predictiveReality,
      risks,
      opportunities,
      summary: predictiveRealitySummary,
    }),
    priorForecastsForCalibration: input.priorForecasts || [],
    forecastInvalidationTriggers: buildForecastInvalidationTriggers(input),
    confidence: scorePredictiveRealityConfidence(input),
  };
}

export function forecastObjectStates(
  input: PIEPredictiveRealityInput,
  forecastType: PIERealityForecast = 'most_likely',
  generatedAt: string = input.generatedAt || input.realityModel.generatedAt || new Date().toISOString(),
): PIEFutureObjectState[] {
  return input.realityModel.objects
    .slice(0, 12)
    .map(object => forecastObjectState(object, input, forecastType, generatedAt));
}

export function forecastReadiness(
  input: PIEPredictiveRealityInput,
  forecastType: PIERealityForecast = 'most_likely',
  states: PIEFutureObjectState[] = forecastObjectStates(input, forecastType),
): PIEReadinessForecast {
  const readyObjectCount = states.filter(state => state.futureReadiness === 'Ready').length;
  const uncertainObjectCount = states.filter(state =>
    state.futureReadiness === 'Uncertain' ||
    state.futureReadiness === 'Needs Verification',
  ).length;
  const blockedObjectCount = states.filter(state => state.futureReadiness === 'Blocked').length;
  const readiness =
    blockedObjectCount > 0
      ? 'Blocked'
      : uncertainObjectCount > readyObjectCount
        ? 'Needs Verification'
        : readyObjectCount > 0
          ? 'Ready'
          : 'Uncertain';

  return {
    id: `readiness-${forecastType}`,
    forecastType,
    readiness,
    summary:
      readiness === 'Ready'
        ? `${readyObjectCount} object${readyObjectCount === 1 ? '' : 's'} can likely be treated as ready.`
        : readiness === 'Blocked'
          ? `${blockedObjectCount} object${blockedObjectCount === 1 ? '' : 's'} may remain or become blocked.`
          : `${uncertainObjectCount} object${uncertainObjectCount === 1 ? '' : 's'} need verification before the forecast is reliable.`,
    readyObjectCount,
    uncertainObjectCount,
    blockedObjectCount,
    confidence: scorePredictiveRealityConfidence(input),
  };
}

export function forecastCascadingEffects(
  input: PIEPredictiveRealityInput,
  forecastType: PIERealityForecast = 'most_likely',
): PIECascadingEffect[] {
  const dependencyEffects = input.realityModel.objects.flatMap(object =>
    object.intelligence.dependencies
      .filter(dependency =>
        dependency.blocked ||
        object.currentStatus === 'blocked' ||
        object.currentStatus === 'at_risk' ||
        object.intelligence.riskLevel === 'high' ||
        object.intelligence.riskLevel === 'critical',
      )
      .map((dependency, index) => ({
        id: `cascade-${forecastType}-${object.identity.id}-${index + 1}`,
        forecastType,
        sourceObjectId: object.identity.id,
        sourceObjectName: object.name,
        affectedObjectId: dependency.affectsObjectId,
        effect: dependency.summary,
        severity: severityFromRisk(object.intelligence.riskLevel),
        forecastImpact:
          forecastType === 'recovery_action'
            ? `Recovery could reduce impact from ${object.name}.`
            : `${object.name} may affect dependent work if not verified.`,
        confidence: dependency.confidence,
      })),
  );
  const predictionEffects = (input.predictionResult?.cascadingImpacts || [])
    .slice(0, 4)
    .map((impact, index) => ({
      id: `cascade-prediction-${forecastType}-${index + 1}`,
      forecastType,
      sourceObjectId: null,
      sourceObjectName: impact.area,
      affectedObjectId: null,
      effect: impact.summary,
      severity: impact.severity === 'high' ? 'high' as const : impact.severity,
      forecastImpact: propagationForForecast(impact.area),
      confidence: impact.confidence,
    }));

  return uniqueCascadingEffects([...dependencyEffects, ...predictionEffects]).slice(0, 10);
}

export function forecastRealityEvolution(
  input: PIEPredictiveRealityInput,
  forecastType: PIERealityForecast = 'most_likely',
  states: PIEFutureObjectState[] = forecastObjectStates(input, forecastType),
): PIERealityEvolution {
  const nextReady = states.find(state => state.likelyChange === 'becomes_ready');
  const nextBlocked = states.find(state =>
    state.likelyChange === 'becomes_blocked' ||
    state.likelyChange === 'stays_blocked',
  );
  const unknown = input.situationIntelligence?.situationUnknowns[0] ||
    input.missingEvidence?.highestImpactEvidenceGap;
  const verificationNeeded =
    states.find(state => state.evidenceToVerify.length > 0)?.evidenceToVerify[0] ||
    input.missingEvidence?.minimumEvidenceNeeded[0]?.suggestedCaptureAction ||
    input.predictionResult?.evidenceThatWouldImprovePrediction[0] ||
    'Verify the current field condition before relying on this forecast.';

  return {
    id: `evolution-${forecastType}`,
    forecastType,
    summary:
      nextBlocked
        ? `${nextBlocked.objectName} is the object most likely to block reality.`
        : nextReady
          ? `${nextReady.objectName} is the object most likely to become ready.`
          : 'Project reality is likely to remain uncertain until more evidence arrives.',
    likelyNextChange:
      nextReady?.reason ||
      nextBlocked?.reason ||
      input.situationIntelligence?.situationSummary.whatUserShouldKnowNow ||
      'No strong future change is clear yet.',
    uncertaintyTomorrow:
      'unknown' in (unknown || {})
        ? (unknown as { unknown: string }).unknown
        : 'summary' in (unknown || {})
          ? (unknown as { summary: string }).summary
          : 'The forecast depends on current evidence staying valid tomorrow.',
    verificationNeeded,
    confidence: scorePredictiveRealityConfidence(input),
  };
}

export function buildNoActionForecast(
  input: PIEPredictiveRealityInput,
  generatedAt: string = input.generatedAt || input.realityModel.generatedAt || new Date().toISOString(),
): PIEPredictiveReality {
  return buildForecast(input, 'no_action', generatedAt);
}

export function buildRecoveryForecast(
  input: PIEPredictiveRealityInput,
  generatedAt: string = input.generatedAt || input.realityModel.generatedAt || new Date().toISOString(),
): PIEPredictiveReality {
  return buildForecast(input, 'recovery_action', generatedAt);
}

export function identifyPredictiveRealityRisks(
  input: PIEPredictiveRealityInput,
  noActionForecast: PIEPredictiveReality = buildNoActionForecast(input),
): PIEPredictiveRealityRisk[] {
  const stateRisks = noActionForecast.futureObjectStates
    .filter(state =>
      state.futureReadiness === 'Blocked' ||
      state.futureStatus === 'blocked' ||
      state.futureStatus === 'at_risk',
    )
    .map((state, index) => ({
      id: `predictive-reality-risk-state-${index + 1}`,
      risk: `${state.objectName} may ${state.futureStatus === 'blocked' ? 'remain blocked' : 'become at risk'}.`,
      growsIfNothingChanges: true,
      affectedObjectId: state.objectId,
      severity: state.futureReadiness === 'Blocked' ? 'high' as const : 'medium' as const,
      verificationNeeded: state.evidenceToVerify[0] || state.reason,
      confidence: state.confidence,
    }));
  const situationRisks = (input.situationIntelligence?.situationRisks || [])
    .filter(risk => risk.severity === 'high' || risk.severity === 'critical')
    .map((risk, index) => ({
      id: `predictive-reality-risk-situation-${index + 1}`,
      risk: risk.risk,
      growsIfNothingChanges: true,
      affectedObjectId: risk.objectId,
      severity: risk.severity,
      verificationNeeded: risk.whyItMatters,
      confidence: risk.confidence,
    }));

  return uniquePredictiveRisks([...stateRisks, ...situationRisks]).slice(0, 8);
}

export function identifyPredictiveRealityOpportunities(
  input: PIEPredictiveRealityInput,
  recoveryForecast: PIEPredictiveReality = buildRecoveryForecast(input),
): PIEPredictiveRealityOpportunity[] {
  const recoveryAction = input.predictionResult?.recoveryActions[0]?.action ||
    input.missingEvidence?.minimumEvidenceNeeded[0]?.suggestedCaptureAction ||
    input.situationIntelligence?.situationPriorities[0]?.action ||
    'Collect the evidence needed to improve readiness.';

  return recoveryForecast.futureObjectStates
    .filter(state =>
      state.likelyChange === 'becomes_ready' ||
      state.futureReadiness === 'Ready' ||
      state.futureReadiness === 'Needs Verification',
    )
    .slice(0, 6)
    .map((state, index) => ({
      id: `predictive-reality-opportunity-${index + 1}`,
      opportunity: `${state.objectName} could move toward ${state.futureReadiness}.`,
      recoveryAction: state.evidenceToVerify[0] || recoveryAction,
      objectId: state.objectId,
      expectedRealityChange: state.reason,
      confidence: state.confidence,
    }));
}

export function summarizePredictiveReality(
  predictiveReality: PIEPredictiveReality,
): string {
  const risk = predictiveReality.risks[0];
  const opportunity = predictiveReality.opportunities[0];
  const readiness = predictiveReality.readinessForecast.readiness;

  if (risk) {
    return `${predictiveReality.forecastType} forecast: ${risk.risk} ${risk.verificationNeeded}`;
  }
  if (opportunity) {
    return `${predictiveReality.forecastType} forecast: ${opportunity.opportunity} ${opportunity.recoveryAction}`;
  }

  return `${predictiveReality.forecastType} forecast: reality readiness is ${readiness}. ${predictiveReality.realityEvolution.verificationNeeded}`;
}

export function explainPredictiveReality(
  predictiveReality: PIEPredictiveReality,
): string {
  return [
    predictiveReality.summary,
    predictiveReality.readinessForecast.summary,
    predictiveReality.realityEvolution.summary,
    predictiveReality.realityEvolution.verificationNeeded,
  ].filter(Boolean).join(' ');
}

function buildForecast(
  input: PIEPredictiveRealityInput,
  forecastType: PIERealityForecast,
  generatedAt: string,
): PIEPredictiveReality {
  const futureObjectStates = forecastObjectStates(input, forecastType, generatedAt);
  const readinessForecast = forecastReadiness(input, forecastType, futureObjectStates);
  const cascadingEffects = forecastCascadingEffects(input, forecastType);
  const realityEvolution = forecastRealityEvolution(input, forecastType, futureObjectStates);
  const forecast: PIEPredictiveReality = {
    generatedAt,
    forecastType,
    predictedEvent: predictedEventForForecast(futureObjectStates, forecastType),
    timeframe: timeframeForForecast(forecastType),
    assumptions: forecastAssumptions(input, forecastType),
    leadingIndicators: forecastLeadingIndicators(input, futureObjectStates),
    probabilityOrConfidence: scorePredictiveRealityConfidence(input),
    supportingRealityObjectIds: futureObjectStates.map(state => state.objectId).slice(0, 8),
    risksThatCouldAlterForecast: forecastAlteringRisks(input),
    reassessmentTrigger: forecastReassessmentTrigger(input),
    expectedConfirmingEvidence: forecastConfirmingEvidence(input, futureObjectStates),
    summary: '',
    futureObjectStates,
    readinessForecast,
    cascadingEffects,
    realityEvolution,
    risks: [],
    opportunities: [],
    confidence: scorePredictiveRealityConfidence(input),
  };
  const risks = identifyPredictiveRealityRisks(input, forecast);
  const opportunities = identifyPredictiveRealityOpportunities(input, forecast);

  return {
    ...forecast,
    risks,
    opportunities,
    summary: summarizePredictiveReality({ ...forecast, risks, opportunities }),
  };
}

function predictedEventForForecast(
  states: PIEFutureObjectState[],
  forecastType: PIERealityForecast,
): string {
  const state = states.find(item => item.likelyChange !== 'uncertain') || states[0];
  if (!state) return `${forecastType} project reality remains uncertain.`;
  return `${state.objectName} ${state.likelyChange.replace(/_/g, ' ')}.`;
}

function timeframeForForecast(forecastType: PIERealityForecast): string {
  if (forecastType === 'no_action') return 'If no action is taken before the next review.';
  if (forecastType === 'recovery_action') return 'After the recommended recovery evidence or action is completed.';
  if (forecastType === 'worst_case') return 'Within the current schedule risk window.';
  return 'Within the next field review window.';
}

function forecastAssumptions(
  input: PIEPredictiveRealityInput,
  forecastType: PIERealityForecast,
): string[] {
  return [
    `Forecast type is ${forecastType}.`,
    `Reality Model version ${input.realityModel.version} remains the source of truth.`,
    input.missingEvidence?.minimumEvidenceNeeded[0]?.minimumEvidence,
    input.situationIntelligence?.situationSummary.whatUserShouldKnowNow,
  ].filter((item): item is string => Boolean(item)).slice(0, 6);
}

function forecastLeadingIndicators(
  input: PIEPredictiveRealityInput,
  states: PIEFutureObjectState[],
): string[] {
  return [
    ...states.slice(0, 3).map(state => `${state.objectName}: ${state.currentStatus} to ${state.futureStatus}`),
    ...(input.evidenceTimeline?.events || []).slice(0, 3).map(event => event.summary),
  ].filter(Boolean);
}

function forecastAlteringRisks(input: PIEPredictiveRealityInput): string[] {
  return [
    ...(input.situationIntelligence?.situationRisks || []).map(risk => risk.risk),
    ...(input.realityModel.evidenceConflicts || []).map(conflict => `Conflict remains unresolved: ${conflict.conflictType}`),
    ...(input.missingEvidence?.minimumEvidenceNeeded || []).map(request => `Missing evidence remains unavailable: ${request.minimumEvidence}`),
  ].slice(0, 8);
}

function forecastReassessmentTrigger(input: PIEPredictiveRealityInput): string {
  return [
    input.missingEvidence?.minimumEvidenceNeeded[0]?.minimumEvidence,
    input.realityModel.evidenceConflicts[0]?.conflictType
      ? `Conflict changes: ${input.realityModel.evidenceConflicts[0].conflictType}`
      : null,
    input.situationIntelligence?.situationRisks[0]?.risk,
    'A predicted event fails to occur inside the forecast window.',
  ].find((item): item is string => Boolean(item)) || 'Any material evidence, schedule, resource, or authority change.';
}

function forecastConfirmingEvidence(
  input: PIEPredictiveRealityInput,
  states: PIEFutureObjectState[],
): string[] {
  return [
    ...states.flatMap(state => state.evidenceToVerify).slice(0, 4),
    ...(input.missingEvidence?.minimumEvidenceNeeded || []).map(request => request.minimumEvidence),
  ].filter(Boolean).slice(0, 6);
}

function buildForecastInvalidationTriggers(input: PIEPredictiveRealityInput): string[] {
  return [
    'new_evidence_arrives',
    'assumption_changes',
    'conflict_resolved_or_added',
    'schedule_changes',
    'resource_availability_changes',
    'expected_event_fails_to_occur',
    input.missingEvidence?.highestImpactEvidenceGap ? 'highest_value_missing_evidence_received' : null,
  ].filter((item): item is string => Boolean(item));
}

function forecastObjectState(
  object: PIERealityObject,
  input: PIEPredictiveRealityInput,
  forecastType: PIERealityForecast,
  generatedAt: string,
): PIEFutureObjectState {
  const currentReadiness = object.intelligence.readiness;
  const baseStatus = object.currentStatus;
  const stale = isObjectStale(object, input.evidenceTimeline, generatedAt);
  const hasMissingEvidence = missingEvidenceForObject(object, input);
  const hasBlockingRisk =
    object.currentStatus === 'blocked' ||
    object.currentStatus === 'at_risk' ||
    object.intelligence.riskLevel === 'high' ||
    object.intelligence.riskLevel === 'critical' ||
    object.intelligence.dependencies.some(dependency => dependency.blocked);
  const hasRecovery =
    forecastType === 'recovery_action' ||
    Boolean(input.predictionResult?.recoveryActions.some(action =>
      objectMatchesText(object, `${action.action} ${action.recovers} ${action.requiredEvidence.join(' ')}`),
    ));

  const futureStatus = nextStatusForForecast({
    currentStatus: baseStatus,
    forecastType,
    stale,
    hasMissingEvidence,
    hasBlockingRisk,
    hasRecovery,
  });
  const futureReadiness = readinessForFutureStatus(futureStatus, currentReadiness, forecastType);
  const likelyChange = likelyChangeForState(baseStatus, futureStatus, currentReadiness, futureReadiness);
  const evidenceToVerify = [
    object.intelligence.uncertainty[0]?.recommendedEvidence,
    input.missingEvidence?.minimumEvidenceNeeded.find(request =>
      objectMatchesText(object, `${request.projectName || ''} ${request.areaName || ''} ${request.request}`),
    )?.suggestedCaptureAction,
    input.predictionResult?.evidenceThatWouldImprovePrediction.find(item => objectMatchesText(object, item)),
    stale ? `Capture current evidence for ${object.areaName || object.projectName || object.name}.` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    id: `future-${forecastType}-${object.identity.id}`,
    objectId: object.identity.id,
    objectName: object.name,
    projectName: object.projectName,
    areaName: object.areaName,
    forecastType,
    currentStatus: baseStatus,
    futureStatus,
    currentReadiness,
    futureReadiness,
    likelyChange,
    timeHorizonDays: horizonForForecast(forecastType),
    reason: reasonForFutureState(object, {
      forecastType,
      futureStatus,
      futureReadiness,
      stale,
      hasMissingEvidence,
      hasBlockingRisk,
      hasRecovery,
    }),
    evidenceToVerify,
    confidence: confidenceForObjectForecast(object, input, forecastType),
  };
}

function nextStatusForForecast(input: {
  currentStatus: PIERealityObjectStatus;
  forecastType: PIERealityForecast;
  stale: boolean;
  hasMissingEvidence: boolean;
  hasBlockingRisk: boolean;
  hasRecovery: boolean;
}): PIERealityObjectStatus {
  if (input.forecastType === 'best_case' || input.forecastType === 'recovery_action') {
    if (input.currentStatus === 'blocked' || input.currentStatus === 'at_risk' || input.hasMissingEvidence) {
      return 'needs_verification';
    }
    if (input.currentStatus === 'needs_verification' && input.hasRecovery) return 'ready';
    return input.currentStatus === 'unknown' ? 'needs_verification' : input.currentStatus;
  }

  if (input.forecastType === 'worst_case' || input.forecastType === 'no_action') {
    if (input.currentStatus === 'blocked') return 'blocked';
    if (input.hasBlockingRisk) return 'blocked';
    if (input.hasMissingEvidence || input.stale || input.currentStatus === 'needs_verification') return 'at_risk';
    return input.currentStatus;
  }

  if (input.currentStatus === 'blocked') return 'blocked';
  if (input.hasBlockingRisk && (input.hasMissingEvidence || input.stale)) return 'at_risk';
  if (input.currentStatus === 'needs_verification' && input.hasRecovery) return 'ready';
  if (input.hasMissingEvidence || input.stale) return 'needs_verification';
  return input.currentStatus;
}

function readinessForFutureStatus(
  status: PIERealityObjectStatus,
  currentReadiness: PIERealityReadiness,
  forecastType: PIERealityForecast,
): PIERealityReadiness {
  if (status === 'blocked') return 'Blocked';
  if (status === 'ready' || status === 'complete') return 'Ready';
  if (status === 'at_risk' || status === 'needs_verification') return 'Needs Verification';
  if (forecastType === 'recovery_action' && currentReadiness !== 'Blocked') return 'Needs Verification';
  return 'Uncertain';
}

function likelyChangeForState(
  currentStatus: PIERealityObjectStatus,
  futureStatus: PIERealityObjectStatus,
  currentReadiness: PIERealityReadiness,
  futureReadiness: PIERealityReadiness,
): PIEFutureObjectState['likelyChange'] {
  if (futureReadiness === 'Ready' && currentReadiness !== 'Ready') return 'becomes_ready';
  if (futureReadiness === 'Blocked' && currentReadiness !== 'Blocked') return 'becomes_blocked';
  if (futureReadiness === 'Blocked') return 'stays_blocked';
  if (futureReadiness === 'Ready') return 'stays_ready';
  if (futureStatus === 'needs_verification' || futureReadiness === 'Needs Verification') return 'needs_verification';
  if (currentStatus !== futureStatus) return 'uncertain';
  return 'uncertain';
}

function reasonForFutureState(
  object: PIERealityObject,
  input: {
    forecastType: PIERealityForecast;
    futureStatus: PIERealityObjectStatus;
    futureReadiness: PIERealityReadiness;
    stale: boolean;
    hasMissingEvidence: boolean;
    hasBlockingRisk: boolean;
    hasRecovery: boolean;
  },
) {
  if (input.forecastType === 'no_action' && input.hasBlockingRisk) {
    return `If nothing changes, ${object.name} may continue blocking dependent work.`;
  }
  if (input.forecastType === 'recovery_action' && input.hasRecovery) {
    return `${object.name} can improve if the recovery action and evidence are completed.`;
  }
  if (input.stale) return `${object.name} may become unreliable because evidence is stale.`;
  if (input.hasMissingEvidence) return `${object.name} needs evidence before readiness can improve.`;
  if (input.futureReadiness === 'Ready') return `${object.name} is supported by current object intelligence.`;
  return `${object.name} is forecast as ${input.futureStatus} from current reality, dependencies, and uncertainty.`;
}

function isObjectStale(
  object: PIERealityObject,
  timeline: PIEEvidenceTimeline | null | undefined,
  generatedAt: string,
) {
  if (object.currentState.stale) return true;
  if (timeline?.staleAreas.some(area =>
    normalize(area.areaName) === normalize(object.areaName) ||
    normalize(area.projectName) === normalize(object.projectName),
  )) return true;

  return daysBetween(object.lastUpdated, generatedAt) > 21;
}

function missingEvidenceForObject(
  object: PIERealityObject,
  input: PIEPredictiveRealityInput,
) {
  return Boolean(
    object.intelligence.uncertainty.length > 0 ||
    input.missingEvidence?.prioritizedItems.some(item =>
      objectMatchesText(object, `${item.title} ${item.summary} ${item.smallestEvidenceRequest}`),
    ) ||
    input.situationIntelligence?.situationUnknowns.some(unknown =>
      objectMatchesText(object, `${unknown.unknown} ${unknown.recommendedEvidence}`),
    ),
  );
}

function objectMatchesText(object: PIERealityObject, text: string) {
  const source = normalize([
    object.name,
    object.projectName,
    object.areaName,
    object.currentState.summary,
  ].filter(Boolean).join(' '));
  const target = normalize(text);
  if (!source || !target) return false;

  return source.split(/\s+/).some(part => part.length > 3 && target.includes(part));
}

function confidenceForObjectForecast(
  object: PIERealityObject,
  input: PIEPredictiveRealityInput,
  forecastType: PIERealityForecast,
): ProjectConfidenceLevel {
  if (
    forecastType === 'worst_case' ||
    input.predictionResult?.predictionConfidence === 'low' ||
    input.beliefSystem?.beliefReadiness === 'Blocked' ||
    object.intelligence.confidence.level === 'low'
  ) {
    return 'low';
  }
  if (
    forecastType === 'recovery_action' ||
    input.predictionResult?.predictionConfidence === 'high' ||
    object.intelligence.confidence.level === 'high'
  ) {
    return 'high';
  }
  return 'medium';
}

function scorePredictiveRealityConfidence(
  input: PIEPredictiveRealityInput,
): ProjectConfidenceLevel {
  if (
    input.predictionResult?.predictionConfidence === 'low' ||
    input.beliefSystem?.beliefReadiness === 'Blocked' ||
    input.missingEvidence?.prioritizedItems.some(item => item.priority === 'critical')
  ) {
    return 'low';
  }
  if (
    input.predictionResult?.predictionConfidence === 'high' &&
    input.situationIntelligence?.situationReadiness.confidence === 'high' &&
    input.realityModel.summary.confidence === 'high'
  ) {
    return 'high';
  }
  return 'medium';
}

function severityFromRisk(risk: PIERealityRiskLevel): PIECascadingEffect['severity'] {
  if (risk === 'critical') return 'critical';
  if (risk === 'high') return 'high';
  if (risk === 'medium') return 'medium';
  return 'low';
}

function propagationForForecast(area: string) {
  if (/inspection/i.test(area)) return 'May affect inspection readiness and follow-on work.';
  if (/schedule/i.test(area)) return 'May affect successor work or milestone readiness.';
  if (/contractor/i.test(area)) return 'May affect crew sequencing or owner follow-up.';
  if (/safety/i.test(area)) return 'May require verification before work continues.';
  return 'May reduce forecast reliability until verified.';
}

function horizonForForecast(forecastType: PIERealityForecast) {
  if (forecastType === 'no_action') return 1;
  if (forecastType === 'recovery_action') return 1;
  if (forecastType === 'worst_case') return 7;
  return 3;
}

function uniqueCascadingEffects(effects: PIECascadingEffect[]) {
  const seen = new Set<string>();
  return effects.filter(effect => {
    const key = `${effect.sourceObjectName}|${effect.effect}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniquePredictiveRisks(risks: PIEPredictiveRealityRisk[]) {
  const seen = new Set<string>();
  return risks.filter(risk => {
    const key = `${risk.affectedObjectId || ''}|${risk.risk}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function daysBetween(earlier: string, later: string) {
  const left = new Date(earlier).getTime();
  const right = new Date(later).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round((right - left) / 86_400_000));
}

function normalize(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}
