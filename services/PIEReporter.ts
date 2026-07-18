import type {
  ContactBook,
  ProjectArea,
  ProjectContact,
  ProjectUpdate,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';
import type { PIEDeliberationResult } from './PIEDeliberationEngine';
import type {
  PIEDecisionQualityScore,
  PIEScientificResult,
} from './PIEScientificMethod';
import type {
  PIEPatternConfidence,
  PIEPatternIntelligence,
  PIEPatternMatch,
  PIEPatternRecommendation,
  PIEPatternWarning,
} from './PIEPatternEngine';
import type {
  PIEBelief,
  PIEBeliefChange,
  PIEBeliefExplanation,
  PIEBeliefReadiness,
} from './PIEBeliefEngine';
import type {
  PIEExecutiveAction,
  PIEExecutiveBriefingPoint,
  PIEExecutivePriority,
  PIEExecutiveReadiness,
  PIEExecutiveReasoningResult,
  PIEExecutiveRisk,
} from './PIEExecutiveReasoning';
import type {
  PIEExecutiveAction as PIEJudgmentAction,
  PIEExecutiveConstraint as PIEJudgmentConstraint,
  PIEExecutiveDecision as PIEJudgmentDecision,
  PIEExecutiveJudgmentResult,
  PIEExecutiveOpportunity as PIEJudgmentOpportunity,
  PIEExecutiveRisk as PIEJudgmentRisk,
  PIEEscalationAnalysis,
  PIEOpportunityCost,
  PIEDecisionTiming,
  PIENoActionReasoning,
  PIETradeoffAnalysis,
  PIEWaitForEvidenceReasoning,
} from './PIEExecutiveJudgment';
import type {
  PIEDecisionMemoryResult,
  PIEDecisionRecord,
  PIEExecutiveWisdomLesson,
  PIETrustCalibrationRecord,
  PIEWhenNotToActReason,
  PIEWisdomRecommendation,
} from './PIEDecisionMemory';
import type {
  PIEPredictionImpact,
  PIEPredictionOutcome,
  PIEPredictionRecoveryAction,
  PIEPredictionResult,
} from './PIEPredictiveEngine';
import type {
  PIECascadingEffect,
  PIEFutureObjectState,
  PIEPredictiveReality,
  PIEPredictiveRealityResult,
  PIEReadinessForecast,
} from './PIEPredictiveReality';
import type {
  PIELearningConfidenceCalibration,
  PIELearningDecisionQuality,
  PIELearningMemoryConsolidation,
  PIELearningResult,
  PIELearningSignal,
} from './PIELearningEngine';
import type {
  PIERealityModel,
  PIERealityObjectIntelligenceResult,
} from './PIERealityModel';
import type { PIESituationResult } from './PIESituationIntelligence';
import type { PIEDecisionSimulationResult } from './PIEDecisionSimulation';
import type { PIERecommendationChallengeResult } from './PIERecommendationChallenge';
import type { PIEJarvisReasoningValidation } from './PIEJarvisReasoningValidation';
import type { PIEConfidenceDecomposition } from './PIEConfidenceDecomposition';
import type { PIEEvidenceValuePrioritization } from './PIEEvidenceValuePrioritization';
import { resolvePIEReportProjectNames } from './PIEReportScope';
import type { PIEScheduleReconciliationResult } from './PIEScheduleReconciliation';
import {
  isConstructionRelevantObservation,
  isIncidentalVisualObservation,
} from './dave-construction-relevance';
import {
  requirePersistedExecutiveJudgment,
  type PIEExecutiveJudgmentRecord,
} from './PIEExecutiveJudgmentRepository';

export type PIEReportAudience =
  | 'internal_team'
  | 'executive'
  | 'customer'
  | 'contractor'
  | 'safety'
  | 'inspection';

export type PIEReportType =
  | 'daily_project_update'
  | 'combined_project_update'
  | 'executive_summary'
  | 'customer_update'
  | 'safety_update'
  | 'inspection_readiness';

export type PIEReportConfidence = 'high' | 'medium' | 'low';

export type PIEWorkAreaStatus =
  | 'On Track'
  | 'In Progress'
  | 'At Risk'
  | 'Blocked'
  | 'Needs Review'
  | 'Complete';

export type PIEWorkAreaProgress = {
  summary: string;
  sourceEvidenceIds: string[];
};

export type PIEWorkAreaIssue = {
  summary: string;
  severity: 'low' | 'medium' | 'high';
  sourceEvidenceIds: string[];
};

export type PIEWorkAreaDecision = {
  summary: string;
  owner: string | null;
  sourceEvidenceIds: string[];
};

export type PIEWorkAreaNextStep = {
  summary: string;
  owner: string | null;
  sourceEvidenceIds: string[];
};

export type PIEWorkAreaUnderstanding = {
  id: string;
  projectName: string;
  locationTitle: string;
  workAreaName: string;
  status: PIEWorkAreaStatus;
  whatWorkIsAbout: string;
  whatChanged: string[];
  progress: PIEWorkAreaProgress[];
  issues: PIEWorkAreaIssue[];
  decisions: PIEWorkAreaDecision[];
  nextSteps: PIEWorkAreaNextStep[];
  affectsSchedule: boolean;
  hasSafetyConcern: boolean;
  hasInspectionDependency: boolean;
  readerTakeaway: string;
  imageReferences: PIEReportImageReference[];
  sourceEvidenceIds: string[];
};

export type PIEConstructionUnderstanding = {
  locationGroups: Array<{
    id: string;
    title: string;
    workAreas: PIEWorkAreaUnderstanding[];
  }>;
  workAreas: PIEWorkAreaUnderstanding[];
  executiveSummaryBullets: string[];
  reviewFlags: string[];
};

export type PIEReportSourceEvidence = {
  id: string;
  source:
    | 'runtime'
    | 'fused_evidence'
    | 'schedule'
    | 'photo'
    | 'gps'
    | 'note'
    | 'issue'
    | 'safety'
    | 'saved_update';
  projectName: string;
  areaName: string;
  summary: string;
  confidence: PIEReportConfidence;
  owner?: string | null;
  photoId?: string | null;
  actionRequired?: string | null;
  status?: string | null;
};

export type PIEReportImageReference = {
  imageNumber: number;
  photoId: string;
  projectName: string;
  areaName: string;
  caption: string;
};

export type PIEReportActionItem = {
  id: string;
  owner: string;
  action: string;
  projectName: string;
  areaName: string;
  needsOwner: boolean;
  sourceEvidenceIds: string[];
};

export type PIEReportRisk = {
  id: string;
  projectName: string;
  areaName: string;
  summary: string;
  severity: 'low' | 'medium' | 'high';
  sourceEvidenceIds: string[];
};

export type PIEReportDecisionNeeded = {
  id: string;
  projectName: string;
  areaName: string;
  question: string;
  owner: string;
  sourceEvidenceIds: string[];
};

export type PIEReportBullet = {
  id: string;
  text: string;
  kind:
    | 'progress'
    | 'schedule'
    | 'issue'
    | 'safety'
    | 'next_step'
    | 'image_reference'
    | 'needs_review';
  sourceEvidenceIds: string[];
  needsReview: boolean;
};

export type PIEReportWorkArea = {
  id: string;
  title: string;
  projectName: string;
  areaName: string;
  bullets: PIEReportBullet[];
  actionItems: PIEReportActionItem[];
  imageReferences: PIEReportImageReference[];
  risks: PIEReportRisk[];
  decisionsNeeded: PIEReportDecisionNeeded[];
};

export type PIEReportLocationGroup = {
  id: string;
  title: string;
  workAreas: PIEReportWorkArea[];
};

export type PIEReportSection = {
  id: string;
  title: string;
  locationGroups: PIEReportLocationGroup[];
};

export type PIEReportDraft = {
  id: string;
  reportType: PIEReportType;
  audience: PIEReportAudience;
  title: string;
  subject: string;
  body: string;
  openingLine: string;
  closingLine: string;
  executiveSummary: string[];
  sections: PIEReportSection[];
  locationGroups: PIEReportLocationGroup[];
  actionItems: PIEReportActionItem[];
  imageReferences: PIEReportImageReference[];
  risks: PIEReportRisk[];
  decisionsNeeded: PIEReportDecisionNeeded[];
  confidence: PIEReportConfidence;
  reportReadiness: PIEReportConfidence;
  needsReview: boolean;
  reviewFlags: string[];
  sourceEvidence: PIEReportSourceEvidence[];
  constructionUnderstanding: PIEConstructionUnderstanding;
  daveBriefing?: import('./DAVEReportIntelligence').DAVEReportBriefing | null;
  generatedAt: string;
};

export type PIEReporterRuntimeInput = {
  intelligentSummary?: {
    projectStatus?: string;
    whatChanged?: string;
    scheduleStatus?: string;
    photoEvidenceSummary?: string;
    risksAndIssues?: string;
    safetySummary?: string;
    nextAction?: string;
    trust?: number;
  };
  fusedEvidence?: {
    scheduleReconciliation?: PIEScheduleReconciliationResult;
  } | null;
  photoProgressSummary?: string;
  recommendedWalkAreas?: string[];
  reflectionSummary?: string | { summary?: string; recommendedEvidence?: string[] };
  lessonsLearned?: unknown[];
  beliefChanges?: Array<{
    direction?: string;
    reason?: string;
    verificationNeeded?: string | null;
  }> | PIEBeliefChange[];
  confidenceChanges?: unknown[];
  recommendedEvidence?: string[];
  reflectionConfidence?: PIEReportConfidence;
  memoryRecallSummary?: string;
  memoryInfluences?: Array<{
    appliesTo?: string;
    summary?: string;
    influence?: string;
    confidence?: PIEReportConfidence;
  }>;
  recurringPatterns?: Array<{
    summary?: string;
    confidence?: PIEReportConfidence;
  }>;
  similarPastEvents?: Array<{
    summary?: string;
    source?: string;
    confidence?: PIEReportConfidence;
  }>;
  deliberation?: PIEDeliberationResult | null;
  recommendationReadiness?: string;
  whatWouldChangeRecommendation?: string[];
  scientificResult?: PIEScientificResult | null;
  primaryUncertainty?: string | null;
  uncertaintyReductionActions?: string[];
  decisionQualitySignals?: PIEDecisionQualityScore;
  patternIntelligence?: PIEPatternIntelligence | null;
  patternMatches?: PIEPatternMatch[];
  earlyWarnings?: PIEPatternWarning[];
  patternBasedRecommendations?: PIEPatternRecommendation[];
  patternConfidence?: PIEPatternConfidence;
  beliefs?: PIEBelief[];
  strongestBeliefs?: PIEBelief[];
  challengedBeliefs?: PIEBelief[];
  beliefsNeedingVerification?: PIEBelief[];
  beliefReadiness?: PIEBeliefReadiness;
  beliefExplanations?: PIEBeliefExplanation[];
  executiveReasoning?: PIEExecutiveReasoningResult | null;
  executivePriorities?: Array<PIEExecutivePriority | unknown>;
  biggestRisk?: PIEExecutiveRisk | null;
  highestValueAction?: PIEExecutiveAction | null;
  executiveBriefingPoints?: PIEExecutiveBriefingPoint[];
  executiveReadiness?: PIEExecutiveReadiness;
  executiveJudgment?: PIEExecutiveJudgmentResult | null;
  executiveJudgmentRecord?: PIEExecutiveJudgmentRecord | null;
  executiveJudgmentSummary?: string;
  executiveJudgmentHighestValueAction?: PIEJudgmentAction | null;
  selectedOption?: string;
  bestNextStep?: string;
  whatCanWait?: string;
  whatNotToDo?: string;
  decisionNeeded?: string;
  escalationRecommendation?: string;
  recommendationWhy?: string;
  recommendationAlternatives?: string[];
  recommendationSuccessMeasure?: string;
  decisionSimulation?: PIEDecisionSimulationResult;
  recommendationChallenge?: PIERecommendationChallengeResult;
  jarvisReasoningValidation?: PIEJarvisReasoningValidation;
  confidenceDecomposition?: PIEConfidenceDecomposition;
  evidenceValuePrioritization?: PIEEvidenceValuePrioritization;
  executiveDecisions?: PIEJudgmentDecision[];
  executiveRisks?: PIEJudgmentRisk[];
  executiveOpportunities?: PIEJudgmentOpportunity[];
  executiveConstraints?: PIEJudgmentConstraint[];
  decisionMemory?: PIEDecisionMemoryResult | null;
  decisionHistory?: PIEDecisionRecord[];
  wisdomLessons?: PIEExecutiveWisdomLesson[];
  whenNotToActReasons?: PIEWhenNotToActReason[];
  wisdomRecommendations?: PIEWisdomRecommendation[];
  trustCalibrationHistory?: PIETrustCalibrationRecord[];
  tradeoffAnalysis?: PIETradeoffAnalysis;
  escalationAnalysis?: PIEEscalationAnalysis;
  opportunityCost?: PIEOpportunityCost;
  decisionTiming?: PIEDecisionTiming;
  noActionReasoning?: PIENoActionReasoning;
  waitForEvidenceReasoning?: PIEWaitForEvidenceReasoning;
  predictionResult?: PIEPredictionResult | null;
  predictions?: PIEPredictionResult['predictions'];
  mostLikelyOutcome?: PIEPredictionOutcome;
  bestCaseOutcome?: PIEPredictionOutcome;
  worstCaseOutcome?: PIEPredictionOutcome;
  noActionOutcome?: PIEPredictionOutcome;
  cascadingImpacts?: PIEPredictionImpact[];
  recoveryActions?: PIEPredictionRecoveryAction[];
  predictionConfidence?: PIEPredictionResult['predictionConfidence'];
  realityModel?: PIERealityModel | null;
  realitySummary?: string;
  objectIntelligence?: PIERealityObjectIntelligenceResult | null;
  situationIntelligence?: PIESituationResult | null;
  situationSummary?: string;
  predictiveReality?: PIEPredictiveRealityResult | null;
  futureObjectStates?: PIEFutureObjectState[];
  readinessForecasts?: PIEReadinessForecast[];
  predictiveCascadingEffects?: PIECascadingEffect[];
  noActionForecast?: PIEPredictiveReality;
  recoveryForecast?: PIEPredictiveReality;
  predictiveRealitySummary?: string;
  learningResult?: PIELearningResult | null;
  learningSignals?: PIELearningSignal[];
  learningSummary?: string;
  confidenceCalibration?: PIELearningConfidenceCalibration[];
  futureAdjustments?: string[];
  memoryConsolidation?: PIELearningMemoryConsolidation[];
  decisionQualityLearning?: PIELearningDecisionQuality[];
};

export type PIEReportDraftInput = {
  reportType?: PIEReportType;
  audience?: PIEReportAudience;
  currentUpdate?: ProjectUpdate | null;
  savedUpdates?: ProjectUpdate[];
  scheduleItems?: ScheduleItem[];
  projectAreas?: ProjectArea[];
  contacts?: ContactBook | ProjectContact[];
  selectedProjectNames?: string[];
  runtime?: PIEReporterRuntimeInput | null;
  executiveJudgmentRecord?: PIEExecutiveJudgmentRecord | null;
  enforceCommunicationOnly?: boolean;
  generatedAt?: Date;
};

type PIEProjectNarrative = {
  executiveSummaryBullets: string[];
  locationGroups: PIEReportLocationGroup[];
  actionItems: PIEReportActionItem[];
  risks: PIEReportRisk[];
  decisionsNeeded: PIEReportDecisionNeeded[];
};

const DAVID_STYLE_OPENING =
  'Please review the updates below and look for action items assigned to your name.';

const DAVID_STYLE_CLOSING = 'Please let me know if you have any questions.';

const ACTION_LANGUAGE =
  /\b(please|need|needs|confirm|review|move|verify|provide|approve|assign|resolve|coordinate|schedule|complete|required|follow up|follow-up)\b/i;

const STRONG_ACTION_LANGUAGE =
  /\b(please|confirm|review|move|verify|provide|approve|assign|resolve|coordinate|schedule|complete|required|follow up|follow-up|need to|needs to|must|before work can continue)\b/i;

const REPORT_WORK_AREA_CLEANUP_EXAMPLES: Record<string, string> = {
  'Building 2321 East Driveway East Driveway': '2321 East Driveway',
  'Fire Pump House Pump House': 'Fire Pump House',
  '2321 Trash Enclosure Building 2321': '2321 Trash Enclosure',
  'Canopy B Location': 'Canopy B',
};

export function buildPIEReportDraft(
  input: PIEReportDraftInput,
): PIEReportDraft {
  if (input.enforceCommunicationOnly) {
    requirePersistedExecutiveJudgment(
      input.executiveJudgmentRecord || input.runtime?.executiveJudgmentRecord,
    );
  }
  if (input.reportType === 'combined_project_update') {
    return buildCombinedProjectUpdate(input);
  }

  if (!input.reportType || input.reportType === 'daily_project_update') {
    return buildDailyProjectUpdate(input);
  }

  return buildReport(input, input.reportType);
}

export function buildPIEReportDraftFromExecutiveJudgment(
  input: Omit<PIEReportDraftInput, 'enforceCommunicationOnly' | 'executiveJudgmentRecord'> & {
    executiveJudgmentRecord: PIEExecutiveJudgmentRecord;
  },
): PIEReportDraft {
  const record = requirePersistedExecutiveJudgment(input.executiveJudgmentRecord);
  const draft = buildPIEReportDraft({
    ...input,
    enforceCommunicationOnly: true,
    executiveJudgmentRecord: record,
    runtime: {
      ...(input.runtime || {}),
      executiveJudgmentRecord: record,
      executiveJudgmentSummary: record.primaryRecommendation,
      selectedOption: record.primaryRecommendation,
      bestNextStep: record.primaryRecommendation,
      decisionNeeded: record.authorityRequirement,
      recommendationWhy: record.priorityRationale,
      recommendationAlternatives: record.alternativesConsidered,
      recommendationSuccessMeasure: record.conditionsThatWouldChangeRecommendation[0] ||
        'Success is measured by verified project evidence after the decision is implemented.',
    },
  });
  if (draft.reportType !== 'executive_summary') return draft;

  const recommendationLine = `Executive recommendation: ${cleanReportBulletText(record.primaryRecommendation)}`;
  return {
    ...draft,
    executiveSummary: Array.from(new Set([recommendationLine, ...draft.executiveSummary])),
    body: draft.body.includes(record.primaryRecommendation)
      ? draft.body
      : `${draft.body}\n\n${recommendationLine}`,
  };
}

export function buildDailyProjectUpdate(
  input: PIEReportDraftInput,
): PIEReportDraft {
  return buildReport(input, 'daily_project_update');
}

export function buildCombinedProjectUpdate(
  input: PIEReportDraftInput,
): PIEReportDraft {
  return buildReport(input, 'combined_project_update');
}

export function collectReportEvidence(
  input: PIEReportDraftInput,
): PIEReportSourceEvidence[] {
  const selectedProjects = selectedProjectsFromInput(input);
  const updates = selectedUpdates(input, selectedProjects);
  const evidence: PIEReportSourceEvidence[] = [];

  updates.forEach(update => {
    const context = reportContextForUpdate(update, input.scheduleItems || []);
    const suggestedNote = update.pieSuggestedNote?.trim() || '';
    const noteWasGeneratedFromPhotoAnalysis = Boolean(
      update.pieSuggestedNoteAccepted &&
      suggestedNote &&
      suggestedNote === update.notes.trim(),
    );

    if (
      update.notes.trim() &&
      (!noteWasGeneratedFromPhotoAnalysis || isConstructionRelevantObservation(update.notes))
    ) {
      evidence.push({
        id: `note-${update.id}`,
        source: 'note',
        projectName: context.projectName,
        areaName: context.areaName,
        summary: cleanReportBulletText(update.notes),
        confidence: isUnclearText(update.notes) ? 'low' : 'medium',
      });
    }

    update.photos.forEach(photo => {
      const photoEvidence = photoToEvidence(update, photo, context);
      if (photoEvidence) evidence.push(photoEvidence);
    });
  });

  input.scheduleItems
    ?.filter(item =>
      [item.scheduleProjectName, item.projectName, item.locationName]
        .some(name => selectedProjects.includes(normalizeName(name || ''))),
    )
    .forEach(item => {
      const scheduleProjectName = item.scheduleProjectName?.trim() || item.projectName || selectedProjects[0] || '';
      const scheduleAreaName = item.locationName?.trim() || (
        normalizeName(item.projectName) !== normalizeName(scheduleProjectName)
          ? item.projectName
          : ''
      );
      evidence.push({
        id: `schedule-${item.id}`,
        source: 'schedule',
        projectName: scheduleProjectName,
        areaName: scheduleAreaName,
        summary: scheduleSummaryLine(item),
        confidence: item.projectName && item.taskName ? 'medium' : 'low',
        owner: item.owner || item.contractor || null,
        actionRequired: scheduleActionLine(item),
        status: item.status,
      });
    });

  const runtime = input.runtime;
  const situation = runtime?.situationIntelligence;
  if (situation?.situationSummary.headline) {
    evidence.push({
      id: 'runtime-current-situation',
      source: 'runtime',
      projectName: input.currentUpdate?.projectName || selectedProjects[0] || '',
      areaName: input.currentUpdate?.selectedAreaName || '',
      summary: cleanReportBulletText(
        [
          situation.situationSummary.headline,
          situation.situationSummary.whatChangedRecently,
          situation.situationSummary.whatMattersNow,
        ].filter(Boolean).join(' '),
      ),
      confidence: confidenceForReport(situation.currentSituation.confidence),
      actionRequired: situation.situationPriorities[0]?.action,
      status: situation.situationReadiness.readiness,
    });
  }
  const runtimeChanged = runtime?.intelligentSummary?.whatChanged;
  if (runtimeChanged && !isEmptyRuntimeSummary(runtimeChanged)) {
    evidence.push({
      id: 'runtime-what-changed',
      source: 'runtime',
      projectName: input.currentUpdate?.projectName || selectedProjects[0] || '',
      areaName: input.currentUpdate?.selectedAreaName || '',
      summary: cleanReportBulletText(runtimeChanged),
      confidence: 'medium',
    });
  }

  if (
    runtime?.photoProgressSummary &&
    !isEmptyRuntimeSummary(runtime.photoProgressSummary) &&
    isConstructionRelevantObservation(runtime.photoProgressSummary)
  ) {
    evidence.push({
      id: 'runtime-photo-progress',
      source: 'photo',
      projectName: input.currentUpdate?.projectName || selectedProjects[0] || '',
      areaName: input.currentUpdate?.selectedAreaName || '',
      summary: cleanReportBulletText(runtime.photoProgressSummary),
      confidence: 'medium',
    });
  }

  return uniqueEvidence(
    evidence
      .filter(item => item.source !== 'gps')
      .filter(item => item.summary.trim())
      .filter(item => !isIncidentalReportEvidence(item))
      .filter(item => !containsGenericAiWording(item.summary)),
  );
}

function isIncidentalReportEvidence(item: PIEReportSourceEvidence) {
  if (!['note', 'photo', 'runtime'].includes(item.source)) return false;
  return isIncidentalVisualObservation(item.summary);
}

export function buildConstructionUnderstanding(
  input: PIEReportDraftInput,
  evidence: PIEReportSourceEvidence[] = collectReportEvidence(input),
): PIEConstructionUnderstanding {
  const imageReferences = buildReportImageReferences(
    selectedUpdates(input, selectedProjectsFromInput(input)),
    selectedProjectsFromInput(input),
  );
  const byArea = new Map<string, PIEReportSourceEvidence[]>();

  evidence.forEach(item => {
    const workAreaName = cleanReportWorkAreaName(
      item.projectName,
      item.areaName,
      item.summary,
    );
    const key = `${locationTitle(item.projectName, item.areaName)}|${workAreaName}`;
    byArea.set(key, [...(byArea.get(key) || []), item]);
  });

  const workAreas = Array.from(byArea.entries()).map(([key, items]) => {
    const [location, workAreaName] = key.split('|');
    const projectName = strongestProjectName(items);
    const areaName = workAreaName || 'Project Work';
    const sourceEvidenceIds = items.map(item => item.id);
    const imageRefs = imageReferences.filter(ref =>
      normalizeName(cleanReportWorkAreaName(ref.projectName, ref.areaName, ref.caption)) ===
      normalizeName(areaName),
    );
    const progress = items
      .filter(isVerifiedConstructionProgressEvidence)
      .map(item => ({
        summary: cleanReportBulletText(item.summary),
        sourceEvidenceIds: [item.id],
      }))
      .filter(item => item.summary);
    const issues = items
      .filter(item => item.source === 'issue' || item.source === 'safety' || isRiskText(item.summary))
      .map(item => ({
        summary: cleanReportBulletText(item.summary),
        severity: item.source === 'safety' || /overdue|blocked/i.test(item.summary)
          ? 'high' as const
          : 'medium' as const,
        sourceEvidenceIds: [item.id],
      }));
    const nextSteps = items
      .filter(isActionEvidence)
      .map(item => ({
        summary: actionFromEvidence(item),
        owner: item.owner || ownerFromText(item.summary),
        sourceEvidenceIds: [item.id],
      }))
      .filter(item => item.summary);
    const decisions = nextSteps
      .filter(item => /confirm|approve|decision|verify|review/i.test(item.summary))
      .map(item => ({
        summary: item.summary,
        owner: item.owner,
        sourceEvidenceIds: item.sourceEvidenceIds,
      }));
    const status = resolveWorkAreaStatus(items, issues, nextSteps);
    const changed = progress.map(item => item.summary);

    return {
      id: slug(`understanding-${location}-${areaName}`),
      projectName,
      locationTitle: location,
      workAreaName: areaName,
      status,
      whatWorkIsAbout: areaName,
      whatChanged: uniqueText(changed).slice(0, 4),
      progress,
      issues,
      decisions,
      nextSteps,
      affectsSchedule: items.some(
        item => item.source === 'schedule' || /schedule|due|overdue|critical|milestone/i.test(item.summary),
      ),
      hasSafetyConcern: items.some(item => item.source === 'safety' || /safety|hot work|hazard/i.test(item.summary)),
      hasInspectionDependency: items.some(item => /inspection|inspect|permit/i.test(item.summary)),
      readerTakeaway: buildReaderTakeaway(areaName, status, progress, issues, nextSteps),
      imageReferences: imageRefs,
      sourceEvidenceIds,
    };
  });

  const locationGroups = groupUnderstandingByLocation(workAreas);
  const reviewFlags = buildReportReviewFlags({ evidence, workAreas });

  return {
    locationGroups,
    workAreas,
    executiveSummaryBullets: buildExecutiveSummaryBullets(workAreas),
    reviewFlags,
  };
}

export function buildProjectNarrative(
  understanding: PIEConstructionUnderstanding,
): PIEProjectNarrative {
  const locationGroups = understanding.locationGroups.map(group => ({
    id: group.id,
    title: group.title,
    workAreas: group.workAreas.map(area => {
      const actionItems = buildReportActionItems(area);
      const bullets = buildReportBulletsFromUnderstanding(area, actionItems);
      const risks = area.issues.map(issue => ({
        id: slug(`risk-${area.id}-${issue.summary}`),
        projectName: area.projectName,
        areaName: area.workAreaName,
        summary: issue.summary,
        severity: issue.severity,
        sourceEvidenceIds: issue.sourceEvidenceIds,
      }));
      const decisionsNeeded = area.decisions.map(decision => ({
        id: slug(`decision-${area.id}-${decision.summary}`),
        projectName: area.projectName,
        areaName: area.workAreaName,
        question: decision.summary,
        owner: decision.owner || 'Action Required',
        sourceEvidenceIds: decision.sourceEvidenceIds,
      }));

      return {
        id: area.id,
        title: area.workAreaName,
        projectName: area.projectName,
        areaName: area.workAreaName,
        bullets,
        actionItems,
        imageReferences: area.imageReferences,
        risks,
        decisionsNeeded,
      };
    }),
  }));

  const actionItems = locationGroups.flatMap(group =>
    group.workAreas.flatMap(area => area.actionItems),
  );
  const risks = locationGroups.flatMap(group =>
    group.workAreas.flatMap(area => area.risks),
  );
  const decisionsNeeded = locationGroups.flatMap(group =>
    group.workAreas.flatMap(area => area.decisionsNeeded),
  );

  return {
    executiveSummaryBullets: understanding.executiveSummaryBullets,
    locationGroups,
    actionItems,
    risks,
    decisionsNeeded,
  };
}

export function buildDavidStyleReport({
  openingLine,
  executiveSummary,
  locationGroups,
  closingLine,
  format = 'project_manager',
  includeProjectNames = false,
}: {
  openingLine: string;
  executiveSummary: string[];
  locationGroups: PIEReportLocationGroup[];
  closingLine: string;
  format?: 'project_manager' | 'executive';
  includeProjectNames?: boolean;
}) {
  const summaryTitle = format === 'executive'
    ? 'Executive Summary'
    : 'Project Summary';
  const executiveText = executiveSummary.length
    ? `${summaryTitle}\n${executiveSummary.map(item => `• ${item}`).join('\n')}`
    : '';
  const locationText = format === 'executive'
    ? ''
    : locationGroups
    .filter(group => group.workAreas.length > 0)
    .map(group => {
      const areas = group.workAreas
        .filter(area => area.bullets.length > 0)
        .map((area, index) => {
          const bullets = area.bullets
            .map(bullet => `• ${reportBulletLabel(bullet)}: ${bullet.text}`)
            .join('\n');
          const areaTitle = includeProjectNames && normalizeName(group.title) !== normalizeName(area.projectName)
            ? `${area.projectName} — ${area.title}`
            : area.title;

          return `${index + 1}. ${areaTitle}\n${bullets}`;
        })
        .join('\n\n');

      return areas ? `${group.title}\n\n${areas}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  return [
    openingLine,
    executiveText,
    locationText,
    closingLine,
  ].filter(Boolean).join('\n\n');
}

function reportBulletLabel(bullet: PIEReportBullet) {
  if (bullet.kind === 'safety') return 'Safety';
  if (bullet.kind === 'issue') return 'Issue';
  if (bullet.kind === 'next_step') return 'Action';
  if (bullet.kind === 'schedule') return 'Schedule';
  if (bullet.kind === 'image_reference') return 'Evidence';

  return 'Progress';
}

export function buildReportActionItems(
  area: PIEWorkAreaUnderstanding | PIEReportSourceEvidence[],
): PIEReportActionItem[] {
  const items = Array.isArray(area)
    ? actionItemsFromEvidence(area)
    : area.nextSteps.map(step => ({
        id: slug(`action-${area.id}-${step.summary}`),
        owner: step.owner || 'Action Required',
        action: step.summary,
        projectName: area.projectName,
        areaName: area.workAreaName,
        needsOwner: !step.owner,
        sourceEvidenceIds: step.sourceEvidenceIds,
      }));

  return uniqueActionItems(items).slice(0, 12);
}

export function buildReportImageReferences(
  updates: ProjectUpdate[],
  selectedProjectNames: string[],
): PIEReportImageReference[] {
  const selected = selectedProjectNames.map(normalizeName);
  const references: PIEReportImageReference[] = [];

  updates.forEach(update => {
    if (
      selected.length > 0 &&
      !selected.includes(normalizeName(update.projectName))
    ) {
      return;
    }

    update.photos.forEach(photo => {
      references.push({
        imageNumber: references.length + 1,
        photoId: photo.id,
        projectName: update.projectName,
        areaName: photo.selectedAreaName || update.selectedAreaName || cleanReportWorkAreaName(update.projectName, '', photo.caption),
        caption: cleanReportBulletText(photo.caption),
      });
    });
  });

  return references;
}

export function buildReportReviewFlags({
  evidence,
  workAreas,
}: {
  evidence: PIEReportSourceEvidence[];
  workAreas: PIEWorkAreaUnderstanding[];
}): string[] {
  const flags = [
    evidence.length === 0 ? 'No supporting evidence was found for this report.' : null,
    evidence.some(item => !item.projectName.trim()) ? 'Some evidence is missing a project.' : null,
    workAreas.some(area => !area.workAreaName.trim() || area.workAreaName === 'Project Work')
      ? 'One or more work areas need review.'
      : null,
    evidence.some(item => item.confidence === 'low') ? 'Some source evidence has low confidence.' : null,
    evidence.some(item => isUnclearText(item.summary)) ? 'Some notes may need grammar or typo review.' : null,
    workAreas.some(area => area.nextSteps.some(step => !step.owner))
      ? 'One or more action items need an owner.'
      : null,
    evidence.some(item => !item.areaName.trim())
      ? 'One or more evidence items need a confirmed location.'
      : null,
    workAreas.some(area =>
      area.progress.length === 0 && area.issues.length === 0 && area.nextSteps.length === 0,
    )
      ? 'One or more work areas need a clearer evidence summary.'
      : null,
    workAreas.some(area => area.status === 'Blocked' || area.status === 'At Risk')
      ? 'Schedule or work-area conflict may need review.'
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

export function cleanReportWorkAreaName(
  projectName: string,
  areaName: string,
  fallback = '',
) {
  const exactCleanup = [areaName, projectName, fallback]
    .map(value => REPORT_WORK_AREA_CLEANUP_EXAMPLES[value.trim()])
    .find(Boolean);

  if (exactCleanup) return exactCleanup;

  const locationNumber =
    projectName.match(/\b\d{4}\b/)?.[0] ||
    areaName.match(/\b\d{4}\b/)?.[0] ||
    fallback.match(/\b\d{4}\b/)?.[0] ||
    '';
  const candidates = [
    areaName,
    projectName,
    fallback,
  ].map(value =>
    value
      .replace(/\bLocation\b/gi, '')
      .replace(/\bProject Area\b/gi, '')
      .replace(/\bBuilding\s+(\d{4})\b/gi, '$1')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  const best =
    chooseBestWorkAreaName(candidates.slice(0, 2)) ||
    chooseBestWorkAreaName(candidates.slice(2)) ||
    'Project Work';
  const withoutDuplicateNumber = locationNumber
    ? best.replace(new RegExp(`\\b${locationNumber}\\b`, 'g'), '').trim()
    : best;
  const withNumber =
    locationNumber && !withoutDuplicateNumber.startsWith(locationNumber)
      ? `${locationNumber} ${withoutDuplicateNumber}`
      : withoutDuplicateNumber;

  const cleaned = removeRepeatedPhrases(removeDuplicateWorkAreaPhrases(withNumber))
    .replace(/\s*[-–]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= 70) return cleaned;

  return projectName.trim().slice(0, 70) || 'Project Work';
}

export function groupEvidenceByLocation(
  evidence: PIEReportSourceEvidence[],
): PIEReportLocationGroup[] {
  return groupUnderstandingByLocation(
    buildConstructionUnderstanding({}, evidence).workAreas,
  ).map(group => ({
    id: group.id,
    title: group.title,
    workAreas: group.workAreas.map(area => ({
      id: area.id,
      title: area.workAreaName,
      projectName: area.projectName,
      areaName: area.workAreaName,
      bullets: buildReportBulletsFromUnderstanding(area, buildReportActionItems(area)),
      actionItems: buildReportActionItems(area),
      imageReferences: area.imageReferences,
      risks: area.issues.map(issue => ({
        id: slug(`risk-${area.id}-${issue.summary}`),
        projectName: area.projectName,
        areaName: area.workAreaName,
        summary: issue.summary,
        severity: issue.severity,
        sourceEvidenceIds: issue.sourceEvidenceIds,
      })),
      decisionsNeeded: [],
    })),
  }));
}

export function groupEvidenceByWorkArea(
  evidence: PIEReportSourceEvidence[],
): PIEReportWorkArea[] {
  return groupEvidenceByLocation(evidence).flatMap(group => group.workAreas);
}

export function buildReportBullets(
  evidence: PIEReportSourceEvidence[],
  actionItems: PIEReportActionItem[] = buildReportActionItems(evidence),
): PIEReportBullet[] {
  const understanding = buildConstructionUnderstanding({}, evidence).workAreas[0];
  if (!understanding) return [];

  return buildReportBulletsFromUnderstanding(understanding, actionItems);
}

export const extractReportActionItems = buildReportActionItems;
export const buildImageReferences = buildReportImageReferences;

export function buildReportRisks(
  evidence: PIEReportSourceEvidence[],
): PIEReportRisk[] {
  return evidence
    .filter(item => item.source === 'issue' || item.source === 'safety' || isRiskText(item.summary))
    .map(item => ({
      id: slug(`risk-${item.id}`),
      projectName: item.projectName,
      areaName: cleanReportWorkAreaName(item.projectName, item.areaName, item.summary),
      summary: cleanReportBulletText(item.summary),
      severity: item.source === 'safety' || /overdue|blocked/i.test(item.summary) ? 'high' : 'medium',
      sourceEvidenceIds: [item.id],
    }));
}

export function buildDecisionNeededItems(
  evidence: PIEReportSourceEvidence[],
  actionItems: PIEReportActionItem[] = buildReportActionItems(evidence),
): PIEReportDecisionNeeded[] {
  return actionItems
    .filter(item => /confirm|approve|decision|verify|review/i.test(item.action))
    .map(item => ({
      id: slug(`decision-${item.id}`),
      projectName: item.projectName,
      areaName: item.areaName,
      question: item.action,
      owner: item.owner,
      sourceEvidenceIds: item.sourceEvidenceIds,
    }));
}

export function formatDavidStyleProjectUpdate(
  draft: Pick<
    PIEReportDraft,
    'openingLine' | 'executiveSummary' | 'locationGroups' | 'closingLine'
  >,
): string {
  return buildDavidStyleReport(draft);
}

export function buildReportConfidence({
  sourceEvidence,
  actionItems,
  decisionsNeeded,
  reviewFlags = [],
}: {
  sourceEvidence: PIEReportSourceEvidence[];
  actionItems: PIEReportActionItem[];
  decisionsNeeded: PIEReportDecisionNeeded[];
  reviewFlags?: string[];
}): PIEReportConfidence {
  if (sourceEvidence.length === 0 || reviewFlags.length > 2) return 'low';
  if (
    decisionsNeeded.length > 0 ||
    actionItems.some(item => item.needsOwner) ||
    reviewFlags.length > 0 ||
    sourceEvidence.some(item => item.confidence === 'low')
  ) {
    return 'medium';
  }

  return 'high';
}

export const getReportSourceEvidence = collectReportEvidence;

function buildReport(
  input: PIEReportDraftInput,
  reportType: PIEReportType,
): PIEReportDraft {
  const generatedAt = input.generatedAt || new Date();
  const audience = input.audience || 'internal_team';
  const executiveFormat = reportType === 'executive_summary';
  const sourceEvidence = collectReportEvidence({
    ...input,
    reportType,
    audience,
  });
  const constructionUnderstanding = buildConstructionUnderstanding(input, sourceEvidence);
  const narrative = buildProjectNarrative(constructionUnderstanding);
  const reviewFlags = [
    ...constructionUnderstanding.reviewFlags,
    ...reflectionReviewFlags(input.runtime),
    ...memoryRecallReviewFlags(input.runtime),
    ...deliberationReviewFlags(input.runtime),
    ...scientificMethodReviewFlags(input.runtime),
    ...patternReviewFlags(input.runtime),
    ...beliefReviewFlags(input.runtime),
    ...predictionReviewFlags(input.runtime),
    ...predictiveRealityReviewFlags(input.runtime),
    ...executiveJudgmentReviewFlags(input.runtime),
    ...executiveReasoningReviewFlags(input.runtime),
    ...situationReviewFlags(input.runtime),
    ...learningReviewFlags(input.runtime),
    ...scheduleReconciliationReviewFlags(input.runtime),
  ];
  const executiveSummary = uniqueText([
    ...narrative.executiveSummaryBullets,
    scheduleReconciliationExecutiveBullet(input.runtime),
  ].filter((item): item is string => Boolean(item))).slice(0, 5);
  const confidence = buildReportConfidence({
    sourceEvidence,
    actionItems: narrative.actionItems,
    decisionsNeeded: narrative.decisionsNeeded,
    reviewFlags,
  });
  const title =
    executiveFormat
      ? 'Executive Summary'
      : reportType === 'combined_project_update'
      ? 'Combined Project Update'
      : 'Project Update';
  const subject =
    executiveFormat
      ? `Executive Summary - ${
          (input.selectedProjectNames || []).length === 1
            ? input.selectedProjectNames?.[0]
            : 'Combined Projects'
        } - ${formatDate(generatedAt)}`
      : reportType === 'combined_project_update'
      ? `Combined Project Update - ${formatDate(generatedAt)}`
      : `Project Update - ${input.currentUpdate?.projectName || 'Project'} - ${formatDate(generatedAt)}`;
  const openingLine = executiveFormat ? '' : DAVID_STYLE_OPENING;
  const closingLine = executiveFormat ? '' : DAVID_STYLE_CLOSING;
  const body = buildDavidStyleReport({
    openingLine,
    executiveSummary,
    locationGroups: narrative.locationGroups,
    closingLine,
    format: executiveFormat ? 'executive' : 'project_manager',
    includeProjectNames: reportType === 'combined_project_update',
  });

  return {
    id: `pie-report-${generatedAt.getTime()}`,
    reportType,
    audience,
    title,
    subject,
    body: body || (executiveFormat ? 'Executive Summary\n• No reportable project changes.' : `${DAVID_STYLE_OPENING}\n\n${DAVID_STYLE_CLOSING}`),
    openingLine,
    closingLine,
    executiveSummary,
    sections: [
      {
        id: 'project-updates',
        title: 'Project Updates',
        locationGroups: narrative.locationGroups,
      },
    ],
    locationGroups: narrative.locationGroups,
    actionItems: narrative.actionItems,
    imageReferences: narrative.locationGroups.flatMap(group =>
      group.workAreas.flatMap(area => area.imageReferences),
    ),
    risks: narrative.risks,
    decisionsNeeded: narrative.decisionsNeeded,
    confidence,
    reportReadiness: confidence,
    needsReview: reviewFlags.length > 0,
    reviewFlags,
    sourceEvidence,
    constructionUnderstanding,
    generatedAt: generatedAt.toISOString(),
  };
}

function buildReportBulletsFromUnderstanding(
  area: PIEWorkAreaUnderstanding,
  actionItems: PIEReportActionItem[],
): PIEReportBullet[] {
  const bullets: PIEReportBullet[] = [];

  area.whatChanged.slice(0, 3).forEach((summary, index) => {
    if (!summary || shouldSuppressReportBullet(summary)) return;
    bullets.push({
      id: slug(`bullet-${area.id}-progress-${index}`),
      text: ensureSentence(summary),
      kind: 'progress',
      sourceEvidenceIds: area.sourceEvidenceIds,
      needsReview: area.status === 'Needs Review',
    });
  });

  area.issues.slice(0, 2).forEach((issue, index) => {
    bullets.push({
      id: slug(`bullet-${area.id}-issue-${index}`),
      text: ensureSentence(issue.summary),
      kind: issue.summary.toLowerCase().includes('safety') ? 'safety' : 'issue',
      sourceEvidenceIds: issue.sourceEvidenceIds,
      needsReview: false,
    });
  });

  actionItems.forEach(item => {
    bullets.push({
      id: slug(`bullet-action-${item.id}`),
      text: formatActionItem(item),
      kind: 'next_step',
      sourceEvidenceIds: item.sourceEvidenceIds,
      needsReview: item.needsOwner,
    });
  });

  if (area.imageReferences.length > 0) {
    const lastProgressIndex = bullets.findIndex(
      bullet => bullet.kind === 'progress' || bullet.kind === 'schedule',
    );
    const imageText = imageReferenceText(area.imageReferences);

    if (lastProgressIndex >= 0) {
      bullets[lastProgressIndex] = {
        ...bullets[lastProgressIndex],
        text: `${stripTerminalPunctuation(bullets[lastProgressIndex].text)}. ${imageText}`,
      };
    } else {
      bullets.push({
        id: slug(`bullet-image-${area.id}`),
        text: imageText,
        kind: 'image_reference',
        sourceEvidenceIds: area.imageReferences.map(ref => ref.photoId),
        needsReview: false,
      });
    }
  }

  return selectConciseAreaBullets(uniqueBullets(bullets));
}

function actionItemsFromEvidence(
  evidence: PIEReportSourceEvidence[],
): PIEReportActionItem[] {
  return evidence
    .filter(isActionEvidence)
    .map(item => ({
      id: slug(`action-${item.id}`),
      owner: item.owner || ownerFromText(item.summary) || 'Action Required',
      action: actionFromEvidence(item),
      projectName: item.projectName,
      areaName: cleanReportWorkAreaName(item.projectName, item.areaName, item.summary),
      needsOwner: !(item.owner || ownerFromText(item.summary)),
      sourceEvidenceIds: [item.id],
    }))
    .filter(item => item.action.trim());
}

function isActionEvidence(item: PIEReportSourceEvidence) {
  if (item.actionRequired?.trim()) return true;
  if (item.owner || ownerFromText(item.summary)) return ACTION_LANGUAGE.test(item.summary);
  if (item.source === 'safety' || item.source === 'issue') {
    return STRONG_ACTION_LANGUAGE.test(item.summary) || isRiskText(item.summary);
  }
  if (item.source === 'schedule') {
    return /waiting|blocked|overdue|high/i.test(`${item.status || ''} ${item.summary}`);
  }

  return STRONG_ACTION_LANGUAGE.test(item.summary);
}

function actionFromEvidence(item: PIEReportSourceEvidence) {
  const action = item.actionRequired || item.summary;

  return cleanReportBulletText(
    action
      .replace(/^next step:\s*/i, '')
      .replace(/^please\s+/i, '')
      .replace(/\bowner\s*:?\s*[A-Z][A-Za-z]+(?:\s*\/\s*[A-Z][A-Za-z]+)?/i, '')
      .trim(),
  );
}

function formatActionItem(item: PIEReportActionItem) {
  if (item.needsOwner) {
    return ensureSentence(item.action);
  }

  return `${item.owner} – Please ${lowercaseFirst(item.action)}.`;
}

function buildExecutiveSummaryBullets(
  workAreas: PIEWorkAreaUnderstanding[],
) {
  if (workAreas.length === 0) {
    return ['Several updates need review before this report is ready to send.'];
  }

  const areasWithProgress = workAreas.filter(area => area.progress.length > 0).length;
  const progressHighlight = workAreas.find(area => area.progress.length > 0);
  const concernHighlight = [
    ...workAreas.filter(area => area.hasSafetyConcern),
    ...workAreas.filter(area => !area.hasSafetyConcern && area.issues.length > 0),
  ][0];
  const actionHighlight = workAreas.find(area => area.nextSteps.length > 0);
  const scheduleCount = workAreas.filter(area => area.affectsSchedule).length;
  const bullets = [
    areasWithProgress > 0
      ? `Construction progress was reported or visually observed in ${areasWithProgress} area${areasWithProgress === 1 ? '' : 's'}; verification status is identified in the detailed evidence.`
      : 'No construction progress was reported or visually observed in the selected updates.',
    progressHighlight
      ? shortenReportBullet(
          `Key update: ${executiveAreaLabel(progressHighlight)} — ${progressHighlight.progress[0].summary}`,
          180,
        )
      : null,
    concernHighlight
      ? shortenReportBullet(
          `${concernHighlight.hasSafetyConcern ? 'Safety' : 'Priority concern'}: ${executiveAreaLabel(concernHighlight)} — ${concernHighlight.issues[0]?.summary || concernHighlight.readerTakeaway}`,
          180,
        )
      : null,
    actionHighlight
      ? shortenReportBullet(
          `Next action: ${executiveAreaLabel(actionHighlight)} — ${actionHighlight.nextSteps[0].summary}${actionHighlight.nextSteps[0].owner ? ` (${actionHighlight.nextSteps[0].owner})` : ''}`,
          180,
        )
      : null,
    scheduleCount > 0
      ? `Schedule attention is indicated in ${scheduleCount} area${scheduleCount === 1 ? '' : 's'}.`
      : null,
  ];

  return (bullets.filter(Boolean) as string[]).slice(0, 5);
}

function executiveAreaLabel(area: PIEWorkAreaUnderstanding) {
  const projectName = area.projectName.trim();
  const workAreaName = area.workAreaName.trim();

  if (!workAreaName || normalizeName(workAreaName) === normalizeName(projectName)) {
    return projectName || 'Project';
  }

  return `${projectName} / ${workAreaName}`;
}

function reflectionReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const flags = [
    runtime?.beliefChanges?.some(change => 'direction' in change && change.direction === 'weakened')
      ? 'Reflection weakened at least one project belief; verify before sending.'
      : null,
    runtime?.recommendedEvidence?.[0]
      ? `Reflection recommends more evidence: ${runtime.recommendedEvidence[0]}.`
      : null,
    runtime?.reflectionConfidence === 'low'
      ? 'Reflection confidence is low; review the report before communication.'
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function memoryRecallReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const flags = [
    runtime?.memoryInfluences?.some(influence => influence.appliesTo === 'report')
      ? 'Memory Recall found prior context that may need review before sending.'
      : null,
    runtime?.recurringPatterns?.[0]
      ? 'Memory Recall found a recurring pattern; verify current status before communicating.'
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function memoryRecallReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const bullets = [
    runtime?.recurringPatterns?.[0]?.summary
      ? `This appears connected to prior updates: ${cleanReportBulletText(runtime.recurringPatterns[0].summary)}`
      : null,
    runtime?.similarPastEvents?.[0]?.summary && runtime.similarPastEvents[0].confidence !== 'low'
      ? `Prior context: ${cleanReportBulletText(runtime.similarPastEvents[0].summary)}`
      : null,
    runtime?.memoryRecallSummary && /recurring|prior|past|previous|open|resumed/i.test(runtime.memoryRecallSummary)
      ? cleanReportBulletText(runtime.memoryRecallSummary)
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 2);
}

function deliberationReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const readiness = runtime?.deliberation?.recommendationReadiness ||
    runtime?.recommendationReadiness;
  const flags = [
    readiness && readiness !== 'Ready'
      ? `Deliberation readiness is ${readiness}; verify before communicating.`
      : null,
    runtime?.deliberation?.contradictions?.[0]
      ? 'Deliberation found contradictory evidence that needs review.'
      : null,
    runtime?.deliberation?.missingEvidence?.[0]
      ? 'Deliberation found missing evidence that may affect the recommendation.'
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function deliberationReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  if (!runtime?.deliberation || runtime.deliberation.recommendationReadiness === 'Blocked') {
    return [];
  }

  const recommendation = runtime.deliberation.deliberatedRecommendation;
  const bullets = [
    recommendation?.whyRecommended
      ? `Evidence-backed recommendation: ${cleanReportBulletText(recommendation.whyRecommended)}`
      : null,
    runtime.deliberation.tradeoffs[0]?.benefit && runtime.deliberation.recommendationReadiness === 'Ready'
      ? `Alternatives considered: ${cleanReportBulletText(runtime.deliberation.tradeoffs[0].benefit)}`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 2);
}

function scientificMethodReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const quality = runtime?.scientificResult?.decisionQualitySignals ||
    runtime?.decisionQualitySignals;
  const primaryUncertainty = runtime?.scientificResult?.primaryUncertainty?.uncertainty ||
    runtime?.primaryUncertainty;
  const weakestAssumption = runtime?.scientificResult?.challenges?.[0]?.weakestAssumption;
  const flags = [
    primaryUncertainty
      ? `Scientific Method identified uncertainty: ${primaryUncertainty}.`
      : null,
    weakestAssumption
      ? `Verify the weakest assumption: ${weakestAssumption}.`
      : null,
    quality && quality.readiness !== 'Ready'
      ? `Decision quality is ${quality.readiness}; review before communicating.`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function scientificMethodReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const result = runtime?.scientificResult;
  const action = result?.uncertaintyReductionActions?.[0]?.action ||
    runtime?.uncertaintyReductionActions?.[0];
  const decision = result?.selectedDecision?.selectedAction;
  const bullets = [
    result?.decisionQualitySignals?.readiness === 'Ready' && decision
      ? `Evidence-backed recommendation: ${cleanReportBulletText(decision)}`
      : null,
    action
      ? `Recommended verification: ${cleanReportBulletText(action)}`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 2);
}

function patternReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const warnings = runtime?.patternIntelligence?.earlyWarnings ||
    runtime?.earlyWarnings ||
    [];
  const flags = [
    warnings[0]
      ? `Pattern Intelligence found a recurring warning: ${warnings[0].warning}.`
      : null,
    runtime?.patternConfidence === 'low'
      ? 'Pattern Intelligence confidence is low; avoid relying on history without current evidence.'
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function patternReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const matches = runtime?.patternIntelligence?.patternMatches ||
    runtime?.patternMatches ||
    [];
  const recommendations = runtime?.patternIntelligence?.patternBasedRecommendations ||
    runtime?.patternBasedRecommendations ||
    [];
  const firstMatch = matches.find(match => match.confidence !== 'low');
  const firstRecommendation = recommendations.find(recommendation => recommendation.confidence !== 'low');
  const bullets = [
    firstMatch?.pattern.timeline.trend === 'recurring'
      ? `This issue has appeared in multiple updates: ${cleanReportBulletText(firstMatch.pattern.summary)}`
      : null,
    firstMatch?.pattern.timeline.trend === 'better'
      ? `Progress appears to have resumed after the prior delay: ${cleanReportBulletText(firstMatch.pattern.summary)}`
      : null,
    firstRecommendation?.recommendation && /previous|prior|history|recurring|again|resumed|multiple/i.test(firstRecommendation.reason)
      ? cleanReportBulletText(firstRecommendation.recommendation)
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 2);
}

function beliefReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const belief = runtime?.beliefsNeedingVerification?.[0] ||
    runtime?.challengedBeliefs?.[0];
  const flags = [
    belief
      ? `Belief needs verification: ${belief.statement}.`
      : null,
    runtime?.beliefReadiness && runtime.beliefReadiness !== 'Ready'
      ? `Belief readiness is ${runtime.beliefReadiness}; verify before relying on this narrative.`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function beliefReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const supported = runtime?.strongestBeliefs?.[0];
  const challenged = runtime?.beliefsNeedingVerification?.[0] ||
    runtime?.challengedBeliefs?.[0];
  const bullets = [
    supported && supported.readiness === 'Ready'
      ? `Current belief: ${cleanReportBulletText(supported.statement)}`
      : null,
    challenged
      ? `Needs verification: ${cleanReportBulletText(challenged.recommendedEvidence[0] || challenged.explanation.readinessReason)}`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 2);
}

function predictionReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const prediction = runtime?.predictionResult;
  const confidence = prediction?.predictionConfidence || runtime?.predictionConfidence;
  const flags = [
    confidence === 'low'
      ? 'Prediction confidence is low; do not communicate predicted impact as fact.'
      : null,
    prediction?.explanation.doNotOverstate
      ? 'Predictive Simulation requires verification before predicted impact is communicated.'
      : null,
    prediction?.noActionOutcome.riskLevel === 'high' && confidence !== 'high'
      ? 'No-action consequence may be high, but prediction should be reviewed before communication.'
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function predictionReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const prediction = runtime?.predictionResult;
  const confidence = prediction?.predictionConfidence || runtime?.predictionConfidence;
  if (confidence !== 'high' || !prediction || prediction.explanation.doNotOverstate) {
    return [];
  }

  const mostLikely = prediction.mostLikelyOutcome || runtime?.mostLikelyOutcome;
  const recovery = prediction.recoveryActions[0] || runtime?.recoveryActions?.[0];
  const impact = prediction.scheduleImpact || runtime?.cascadingImpacts?.[0];
  const bullets = [
    mostLikely?.likelyOutcome
      ? `Predicted impact: ${cleanReportBulletText(mostLikely.likelyOutcome)}`
      : null,
    impact?.summary
      ? `Cascading impact: ${cleanReportBulletText(impact.summary)}`
      : null,
    recovery?.action
      ? `Recovery action: ${cleanReportBulletText(recovery.action)}`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 3);
}

function predictiveRealityReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const forecast = runtime?.predictiveReality;
  const flags = [
    forecast?.confidence === 'low'
      ? 'Predictive Reality confidence is low; do not communicate future reality as fact.'
      : null,
    forecast?.risks[0] && forecast.risks[0].confidence !== 'high'
      ? `Future reality risk needs verification: ${forecast.risks[0].verificationNeeded}.`
      : null,
    forecast?.noActionForecast.readinessForecast.readiness === 'Blocked'
      ? 'No-action forecast may leave project reality blocked; review before communicating.'
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function predictiveRealityReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const forecast = runtime?.predictiveReality;
  if (!forecast || forecast.confidence !== 'high') return [];

  const risk = forecast.risks.find(item => item.confidence === 'high');
  const opportunity = forecast.opportunities.find(item => item.confidence === 'high');
  const readyState = forecast.futureObjectStates.find(state =>
    state.futureReadiness === 'Ready' && state.confidence === 'high',
  );
  const bullets = [
    risk
      ? `Future impact: ${cleanReportBulletText(risk.risk)}`
      : null,
    opportunity
      ? `Recovery action: ${cleanReportBulletText(opportunity.recoveryAction)}`
      : null,
    readyState
      ? `Readiness forecast: ${cleanReportBulletText(`${readyState.objectName} can move to ${readyState.futureReadiness}.`)}`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 3);
}

function situationReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const situation = runtime?.situationIntelligence;
  const flags = [
    situation?.situationState === 'blocked'
      ? `Current situation is blocked: ${situation.situationSummary.whatNeedsVerification}.`
      : null,
    situation?.situationState === 'needs_verification' ||
    situation?.situationState === 'uncertain'
      ? `Current situation needs verification: ${situation.situationSummary.whatNeedsVerification}.`
      : null,
    situation?.situationUnknowns[0]
      ? `Current situation needs evidence: ${situation.situationUnknowns[0].recommendedEvidence}.`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function situationReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const situation = runtime?.situationIntelligence;
  const summary = runtime?.situationSummary || situation?.situationSummary.headline;
  const bullets = [
    summary
      ? `Current situation: ${cleanReportBulletText(summary)}`
      : null,
    situation?.situationSummary.whatChangedRecently &&
    !/no recent change is clear/i.test(situation.situationSummary.whatChangedRecently)
      ? `Recent change: ${cleanReportBulletText(situation.situationSummary.whatChangedRecently)}`
      : null,
    situation?.situationPriorities[0]?.action
      ? `Recommended next step: ${cleanReportBulletText(situation.situationPriorities[0].action)}`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 3);
}

function learningReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const learning = runtime?.learningResult;
  const calibration = learning?.confidenceCalibration ||
    runtime?.confidenceCalibration ||
    [];
  const memory = learning?.memoryConsolidation ||
    runtime?.memoryConsolidation ||
    [];
  const decisionQuality = learning?.decisionQualityLearning ||
    runtime?.decisionQualityLearning ||
    [];
  const flags = [
    calibration.some(item => item.adjustment === 'lower')
      ? 'Continuous Learning lowered confidence for a similar recommendation; verify before communicating.'
      : null,
    memory.some(item => item.influenceType === 'preference pattern')
      ? 'Continuous Learning found a report style preference; keep wording concise and location-based.'
      : null,
    memory.some(item => item.influenceType === 'user correction pattern')
      ? 'Continuous Learning found a user correction pattern; verify project, area, owner, or status wording.'
      : null,
    decisionQuality.some(item => /verify|review/i.test(item.decisionQualityLearning))
      ? 'Continuous Learning found decision-quality evidence that needs review.'
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function scheduleReconciliationReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  return (runtime?.fusedEvidence?.scheduleReconciliation?.warnings || [])
    .filter(warning =>
      warning.severity === 'high' ||
      warning.severity === 'critical' ||
      warning.type === 'field_progress_not_reflected'
    )
    .slice(0, 2)
    .map(warning => `Schedule check: ${shortenReportBullet(warning.summary, 180)}`);
}

function scheduleReconciliationExecutiveBullet(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const warning = runtime?.fusedEvidence?.scheduleReconciliation?.warnings.find(
    item =>
      item.severity === 'critical' ||
      item.severity === 'high' ||
      item.type === 'field_progress_not_reflected',
  );

  return warning
    ? `Schedule attention: ${shortenReportBullet(warning.summary, 165)}`
    : null;
}

function learningReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const learning = runtime?.learningResult;
  const memory = learning?.memoryConsolidation ||
    runtime?.memoryConsolidation ||
    [];
  const futureAdjustment = learning?.futureAdjustments?.[0] ||
    runtime?.futureAdjustments?.[0];
  const approvedStyle = memory.find(item =>
    item.influenceType === 'preference pattern' &&
    /approved|report|wording|owner\/action phrasing|David-style/i.test(`${item.summary} ${item.influence}`) &&
    item.confidence !== 'low',
  );
  const successfulResponse = memory.find(item =>
    item.influenceType === 'successful response' &&
    item.confidence === 'high',
  );
  const bullets = [
    approvedStyle
      ? `Report style note: ${cleanReportBulletText(approvedStyle.influence)}`
      : null,
    successfulResponse
      ? `Recommended follow-up: ${cleanReportBulletText(successfulResponse.influence)}`
      : null,
    futureAdjustment && /verify|review|ask|lower confidence/i.test(futureAdjustment)
      ? `Recommended verification: ${cleanReportBulletText(futureAdjustment)}`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 2);
}

function executiveReasoningReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const reasoning = runtime?.executiveReasoning;
  const readiness = reasoning?.executiveReadiness || runtime?.executiveReadiness;
  const risk = reasoning?.biggestRisk || runtime?.biggestRisk;
  const flags = [
    readiness && readiness !== 'Ready'
      ? `Executive Reasoning readiness is ${readiness}; verify before communicating.`
      : null,
    risk?.likelyToGrow
      ? `Executive Reasoning identified growing risk: ${risk.risk}.`
      : null,
    reasoning?.decisionNeeds?.[0]
      ? `Executive decision needs review: ${reasoning.decisionNeeds[0].decisionNeeded}.`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function executiveJudgmentReviewFlags(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const judgment = runtime?.executiveJudgment;
  const action = judgment?.highestValueAction || runtime?.executiveJudgmentHighestValueAction;
  const escalationAnalysis = runtime?.escalationAnalysis || judgment?.escalationAnalysis;
  const waitForEvidenceReasoning = runtime?.waitForEvidenceReasoning || judgment?.waitForEvidenceReasoning;
  const decisionTiming = runtime?.decisionTiming || judgment?.decisionTiming;
  const wisdomCaution = runtime?.decisionMemory?.whenNotToActReasons[0] || runtime?.whenNotToActReasons?.[0];
  const flags = [
    judgment?.executiveReadiness && judgment.executiveReadiness !== 'Ready'
      ? `Executive Judgment readiness is ${judgment.executiveReadiness}; review before communicating.`
      : null,
    action?.score.readiness && action.score.readiness !== 'Ready'
      ? `Executive action needs verification: ${action.governance.whatWouldChangeRecommendation[0] || action.action}.`
      : null,
    judgment?.executiveRisks[0]?.shouldEscalate && escalationAnalysis?.shouldEscalate
      ? `Executive Judgment identified escalation risk: ${judgment.executiveRisks[0].risk}.`
      : null,
    action?.type === 'escalate' && escalationAnalysis?.shouldEscalate === false
      ? `Escalation is not justified yet: ${escalationAnalysis.justification}`
      : null,
    waitForEvidenceReasoning?.shouldWaitForEvidence
      ? `Wait for evidence before final recommendation: ${waitForEvidenceReasoning.smallestEvidenceRequest}`
      : null,
    decisionTiming?.recommendation === 'wait_for_evidence'
      ? `Decision timing requires verification: ${decisionTiming.reason}`
      : null,
    wisdomCaution
      ? `Decision Memory says wait: ${wisdomCaution.explanation}`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

function executiveJudgmentReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const judgment = runtime?.executiveJudgment;
  const judgmentRecord = runtime?.executiveJudgmentRecord;
  const action = judgment?.highestValueAction || runtime?.executiveJudgmentHighestValueAction;
  const risk = judgment?.executiveRisks[0] || runtime?.executiveRisks?.[0];
  const decision = judgment?.executiveDecisions[0] || runtime?.executiveDecisions?.[0];
  const escalationAnalysis = runtime?.escalationAnalysis || judgment?.escalationAnalysis;
  const decisionTiming = runtime?.decisionTiming || judgment?.decisionTiming;
  const tradeoffAnalysis = runtime?.tradeoffAnalysis || judgment?.tradeoffAnalysis;
  const wisdomCaution = runtime?.decisionMemory?.whenNotToActReasons[0] || runtime?.whenNotToActReasons?.[0];
  const monitoringIsBest =
    action?.type === 'monitor' ||
    action?.type === 'no_action' ||
    decisionTiming?.recommendation === 'monitor' ||
    runtime?.noActionReasoning?.isValid ||
    judgment?.noActionReasoning?.isValid;

  if (wisdomCaution || (judgment?.executiveReadiness !== 'Ready' && action?.score.readiness !== 'Ready')) {
    return [];
  }

  if (monitoringIsBest) {
    const monitoringBullets = [
      runtime?.executiveJudgmentSummary || judgment?.executiveJudgmentSummary
        ? cleanReportBulletText(runtime?.executiveJudgmentSummary || judgment?.executiveJudgmentSummary || '')
        : null,
      decisionTiming?.reason
        ? `Decision timing: ${cleanReportBulletText(decisionTiming.reason)}`
        : null,
      tradeoffAnalysis?.leastNoisyOption
        ? `Monitoring avoids unnecessary noise: ${cleanReportBulletText(tradeoffAnalysis.leastNoisyOption)}`
        : null,
    ].filter(Boolean) as string[];

    return Array.from(new Set(monitoringBullets)).slice(0, 3);
  }

  const bullets = [
    judgmentRecord?.primaryRecommendation
      ? `Executive recommendation: ${cleanReportBulletText(judgmentRecord.primaryRecommendation)}`
      : null,
    runtime?.executiveJudgmentSummary || judgment?.executiveJudgmentSummary
      ? cleanReportBulletText(runtime?.executiveJudgmentSummary || judgment?.executiveJudgmentSummary || '')
      : null,
    runtime?.decisionNeeded || decision?.decision
      ? `Decision needed: ${cleanReportBulletText(runtime?.decisionNeeded || decision?.decision || '')}`
      : null,
    runtime?.recommendationWhy
      ? cleanReportBulletText(runtime.recommendationWhy)
      : null,
    action?.score.readiness === 'Ready' && (action.type !== 'escalate' || escalationAnalysis?.shouldEscalate)
      ? `Executive next step: ${cleanReportBulletText(runtime?.bestNextStep || action.action)}`
      : null,
    decisionTiming?.recommendation && decisionTiming.recommendation !== 'escalate_now'
      ? `Decision timing: ${cleanReportBulletText(decisionTiming.reason)}`
      : null,
    tradeoffAnalysis?.preferredOption
      ? `Tradeoff: ${cleanReportBulletText(tradeoffAnalysis.explanation)}`
      : null,
    risk && risk.confidence !== 'low'
      ? `Executive risk: ${cleanReportBulletText(risk.risk)}`
      : null,
    decision && decision.confidence !== 'low'
      ? `Decision needed: ${cleanReportBulletText(decision.decision)}`
      : null,
    runtime?.recommendationSuccessMeasure
      ? `Success measure: ${cleanReportBulletText(runtime.recommendationSuccessMeasure)}`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 4);
}

function executiveReasoningReportBullets(
  runtime: PIEReporterRuntimeInput | null | undefined,
) {
  const reasoning = runtime?.executiveReasoning;
  const briefingPoint = reasoning?.briefingPoints?.[0] ||
    runtime?.executiveBriefingPoints?.[0];
  const action = reasoning?.highestValueAction ||
    runtime?.highestValueAction;
  const risk = reasoning?.biggestRisk ||
    runtime?.biggestRisk;
  const bullets = [
    briefingPoint?.summary
      ? cleanReportBulletText(briefingPoint.summary)
      : null,
    action?.readiness === 'Ready'
      ? `Highest-value action: ${cleanReportBulletText(action.action)}`
      : null,
    risk && risk.confidence !== 'low'
      ? `Executive risk: ${cleanReportBulletText(risk.risk)}`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(bullets)).slice(0, 3);
}

function confidenceForReport(confidence: 'low' | 'medium' | 'high'): PIEReportConfidence {
  return confidence;
}

function groupUnderstandingByLocation(
  workAreas: PIEWorkAreaUnderstanding[],
) {
  const byLocation = new Map<string, PIEWorkAreaUnderstanding[]>();

  workAreas.forEach(area => {
    byLocation.set(area.locationTitle, [
      ...(byLocation.get(area.locationTitle) || []),
      area,
    ]);
  });

  return Array.from(byLocation.entries()).map(([title, areas]) => ({
    id: slug(`location-${title}`),
    title,
    workAreas: areas,
  }));
}

function selectedProjectsFromInput(input: PIEReportDraftInput) {
  return resolvePIEReportProjectNames({
    selectedProjectNames: input.selectedProjectNames,
    fallbackProjectNames: [
      input.currentUpdate?.projectName,
      ...(input.savedUpdates || []).map(update => update.projectName),
    ],
  }).map(normalizeName);
}

function selectedUpdates(
  input: PIEReportDraftInput,
  selectedProjects: string[],
) {
  const updates = [
    ...(input.currentUpdate ? [input.currentUpdate] : []),
    ...(input.savedUpdates || []),
  ];

  return updates.filter(update =>
    selectedProjects.includes(normalizeName(update.projectName)),
  );
}

function reportContextForUpdate(
  update: ProjectUpdate,
  scheduleItems: ScheduleItem[],
) {
  const updateNames = [
    update.projectName,
    update.selectedAreaName,
    projectAreaFromPhotos(update),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeName);
  const scheduleMatch = scheduleItems.find(item =>
    [item.projectName, item.locationName].some(name => updateNames.includes(normalizeName(name))),
  );
  const projectName =
    update.scheduleProjectName?.trim() ||
    scheduleMatch?.scheduleProjectName?.trim() ||
    update.projectName;
  const explicitArea = update.selectedAreaName || projectAreaFromPhotos(update) || '';
  const areaName = explicitArea || (
    normalizeName(update.projectName) !== normalizeName(projectName)
      ? update.projectName
      : ''
  );

  return { projectName, areaName };
}

function photoToEvidence(
  update: ProjectUpdate,
  photo: UpdatePhoto,
  context: { projectName: string; areaName: string },
): PIEReportSourceEvidence | null {
  const summary =
    photo.caption.trim() ||
    photo.actionRequired.trim() ||
    `${photo.category} photo captured.`;
  const source =
    photo.category === 'Open Issue'
      ? 'issue' as const
      : photo.category === 'Safety Concern'
        ? 'safety' as const
        : 'photo' as const;

  if (
    source === 'photo' &&
    !photo.actionRequired.trim() &&
    !isConstructionRelevantObservation(summary)
  ) {
    return null;
  }

  return {
    id: `photo-${photo.id}`,
    source,
    projectName: context.projectName,
    areaName: photo.selectedAreaName || context.areaName,
    summary: cleanReportBulletText(summary),
    confidence: summary ? 'high' : 'medium',
    owner: photo.actionOwner || null,
    photoId: photo.id,
    actionRequired: photo.actionRequired || null,
    status: photo.actionStatus,
  };
}

function scheduleSummaryLine(item: ScheduleItem) {
  const scheduleNote = reportScheduleNote(item.notes);
  const parts = [
    cleanReportBulletText(item.taskName),
    !scheduleProgressIsComplete(item) && item.finishDate
      ? `due ${item.finishDate}`
      : null,
    item.status ? `status ${item.status}` : null,
    item.owner || item.contractor ? `owner ${item.owner || item.contractor}` : null,
    scheduleNote || null,
  ].filter(Boolean);

  return parts.join(', ');
}

function scheduleActionLine(item: ScheduleItem) {
  const taskName = cleanReportBulletText(item.taskName);
  if (!taskName) return null;
  if (item.status === 'Waiting') return `Confirm what is blocking ${taskName}.`;
  if (item.priority === 'High' && !scheduleProgressIsComplete(item)) {
    return `Confirm the current status of ${taskName}.`;
  }

  return null;
}

function reportScheduleNote(value: string) {
  return cleanReportBulletText(value)
    .replace(/\bActivity ID:\s*[^.]+\.?\s*/gi, '')
    .replace(/\bDuration:\s*[^.]+\.?\s*/gi, '')
    .replace(/\bPredecessors?:\s*[^.]+\.?\s*/gi, '')
    .replace(/\bImported from (?:a )?structured Microsoft Project PDF;?\s*/gi, '')
    .replace(/\bverify highlighted fields before approval\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVerifiedConstructionProgressEvidence(item: PIEReportSourceEvidence) {
  if (isActionEvidence(item)) return false;
  if (item.source === 'schedule' || item.source === 'safety' || item.source === 'issue') {
    return false;
  }

  return isConstructionRelevantObservation(item.summary);
}

function resolveWorkAreaStatus(
  evidence: PIEReportSourceEvidence[],
  issues: PIEWorkAreaIssue[],
  nextSteps: PIEWorkAreaNextStep[],
): PIEWorkAreaStatus {
  if (issues.some(issue => issue.severity === 'high')) return 'Blocked';
  if (issues.length > 0 || evidence.some(item => /overdue|risk/i.test(item.summary))) return 'At Risk';
  if (nextSteps.some(step => !step.owner)) return 'Needs Review';
  if (evidence.some(item => /complete|completed|done|finished/i.test(item.summary))) return 'Complete';
  if (evidence.some(item => /started|underway|progress|installed|poured|framing|removed/i.test(item.summary))) return 'In Progress';

  return 'On Track';
}

function buildReaderTakeaway(
  areaName: string,
  status: PIEWorkAreaStatus,
  progress: PIEWorkAreaProgress[],
  issues: PIEWorkAreaIssue[],
  nextSteps: PIEWorkAreaNextStep[],
) {
  if (issues.length > 0) return `${areaName} needs attention before work can continue cleanly.`;
  if (nextSteps.length > 0) return `${areaName} has follow-up items assigned for review.`;
  if (status === 'Complete') return `${areaName} appears complete from the selected evidence.`;
  if (progress.length > 0) return `${areaName} progressed since the last update.`;

  return `${areaName} has evidence that should be reviewed before sending.`;
}

function cleanReportBulletText(value: string) {
  let text = value
    .replace(/\s+/g, ' ')
    .replace(/\.\.+/g, '.')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\bLocation was captured\b\.?/gi, '')
    .replace(/\bGPS was captured\b\.?/gi, '')
    .replace(/\bEvidence was fused\b\.?/gi, '')
    .replace(/\bRuntime indicates\b[:,]?\s*/gi, '')
    .replace(/\bNo image references included\b\.?/gi, '')
    .replace(/\bpuddings\b/gi, 'footings')
    .replace(/\brebar is installed\b/gi, 'rebar has been installed')
    .replace(/\bstructure builders complete\b/gi, 'structural work is complete')
    .replace(/\bstill needs electrical\b/gi, 'electrical work remains')
    .replace(/\bphoto captured\b/gi, 'photo added for reference')
    .trim();

  text = text.replace(/([.!?])\1+$/g, '$1');

  if (/structural work is complete/i.test(text) && /electrical work remains/i.test(text)) {
    return 'Structural work is complete. Electrical work remains before the area can advance to the next phase.';
  }

  return text;
}

function shouldSuppressReportBullet(value: string) {
  return /location was captured|gps was captured|captured for|project area|evidence was fused|runtime indicates|no image references included/i.test(value);
}

function isRiskText(value: string) {
  return /risk|blocked|overdue|waiting|safety|hazard|concern/i.test(value);
}

function isUnclearText(value: string) {
  return value.trim().length < 8 || /\b(todo|tbd|\?{2,}|asdf)\b/i.test(value);
}

function isEmptyRuntimeSummary(value: string) {
  return /no .*summarize|no .*evidence|not enough/i.test(value);
}

function ownerFromText(value: string) {
  const match = value.match(
    /\b([A-Z][A-Za-z]+(?:\s*\/\s*[A-Z][A-Za-z]+)?(?:\s+[A-Z][A-Za-z]+)?)\s*[–-]\s*Please\b/,
  );

  return match?.[1]?.trim() || null;
}

function strongestProjectName(items: PIEReportSourceEvidence[]) {
  return items.find(item => item.projectName.trim())?.projectName || 'Project';
}

function projectAreaFromPhotos(update: ProjectUpdate) {
  return update.photos.find(photo => photo.selectedAreaName)?.selectedAreaName || '';
}

function locationTitle(projectName: string, areaName: string) {
  return projectName.trim() || areaName.trim() || 'Project';
}

function imageReferenceText(refs: PIEReportImageReference[]) {
  const numbers = refs.map(ref => ref.imageNumber);

  if (numbers.length === 1) return `See Image ${numbers[0]}.`;
  if (numbers.length === 2) return `See Images ${numbers[0]} and ${numbers[1]}.`;

  return `See Images ${numbers.slice(0, -1).join(', ')}, and ${numbers[numbers.length - 1]}.`;
}

function uniqueEvidence(evidence: PIEReportSourceEvidence[]) {
  const seen = new Set<string>();

  return evidence.filter(item => {
    const key = `${normalizeName(item.projectName)}|${normalizeName(item.areaName)}|${normalizeName(item.summary)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueBullets(bullets: PIEReportBullet[]) {
  const seen = new Set<string>();

  return bullets.filter(bullet => {
    const key = normalizeName(bullet.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectConciseAreaBullets(
  bullets: PIEReportBullet[],
): PIEReportBullet[] {
  const preferred = [
    bullets.find(bullet =>
      bullet.kind === 'progress' || bullet.kind === 'schedule'
    ),
    bullets.find(bullet =>
      bullet.kind === 'safety' || bullet.kind === 'issue'
    ),
    bullets.find(bullet => bullet.kind === 'next_step'),
  ].filter((bullet): bullet is PIEReportBullet => Boolean(bullet));
  const selectedIds = new Set(preferred.map(bullet => bullet.id));
  const selected = [
    ...preferred,
    ...bullets.filter(bullet => !selectedIds.has(bullet.id)),
  ].slice(0, 3);

  return selected.map(bullet => ({
    ...bullet,
    text: shortenReportBullet(bullet.text),
  }));
}

function shortenReportBullet(value: string, maximumLength = 160) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maximumLength) return text;

  const shortened = text.slice(0, maximumLength - 1);
  const lastWordBoundary = shortened.lastIndexOf(' ');

  const visibleText = lastWordBoundary > 0
    ? shortened.slice(0, lastWordBoundary)
    : shortened;

  return `${visibleText.trim()}…`;
}

function uniqueActionItems(items: PIEReportActionItem[]) {
  const seen = new Set<string>();

  return items.filter(item => {
    const key = `${normalizeName(item.owner)}|${normalizeName(item.action)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueText(items: string[]) {
  const seen = new Set<string>();

  return items.filter(item => {
    const key = normalizeName(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeRepeatedPhrases(value: string) {
  const words = value.split(' ').filter(Boolean);
  const cleaned: string[] = [];

  words.forEach(word => {
    const previous = cleaned[cleaned.length - 1];
    if (previous && normalizeName(previous) === normalizeName(word)) return;
    cleaned.push(word);
  });

  const half = Math.floor(cleaned.length / 2);
  if (
    half > 1 &&
    cleaned.slice(0, half).join(' ').toLowerCase() ===
      cleaned.slice(half, half * 2).join(' ').toLowerCase()
  ) {
    return cleaned.slice(0, half).join(' ');
  }

  return cleaned.join(' ');
}

function chooseBestWorkAreaName(candidates: string[]) {
  const usable = candidates.filter(
    value => value && !/^(project|schedule area|location)$/i.test(value),
  );

  const scored = usable.map(value => ({
    value,
    score:
      (/\b\d{4}\b/.test(value) ? 4 : 0) +
      (/\b(firewall|stormwater|canopy|truck|access|racking|pump|trash|enclosure|driveway|wall|tank|room|lot|pad|construction)\b/i.test(value) ? 3 : 0) +
      Math.min(value.split(/\s+/).length, 8),
  }));

  return scored.sort((left, right) => right.score - left.score)[0]?.value || '';
}

function removeDuplicateWorkAreaPhrases(value: string) {
  const cleaned = value.trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  for (let size = Math.floor(words.length / 2); size >= 2; size -= 1) {
    const tail = words.slice(-size).join(' ').toLowerCase();
    const beforeTail = words.slice(-size * 2, -size).join(' ').toLowerCase();

    if (tail && tail === beforeTail) {
      return words.slice(0, -size).join(' ');
    }
  }

  return cleaned
    .replace(/\b(East Driveway)\s+\1\b/gi, '$1')
    .replace(/\b(Pump House)\s+\1\b/gi, '$1')
    .replace(/\b(Trash Enclosure)\s+\1\b/gi, '$1')
    .replace(/\b(Canopy B)\s+\1\b/gi, '$1')
    .replace(/\b(Location)\b/gi, '')
    .trim();
}

function ensureSentence(value: string) {
  const text = value.trim();
  if (!text) return '';
  if (/[.!?]$/.test(text)) return text;

  return `${text}.`;
}

function stripTerminalPunctuation(value: string) {
  return value.replace(/[.!?]+$/g, '');
}

function lowercaseFirst(value: string) {
  const text = value.trim();
  if (!text) return text;

  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function joinHumanList(items: string[]) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;

  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function normalizeName(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function slug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (normalized.length <= 80) return normalized;

  return `${normalized.slice(0, 72).replace(/-$/g, '')}-${stableSlugHash(normalized)}`;
}

function stableSlugHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36).padStart(7, '0').slice(-7);
}

function formatDate(value: Date) {
  return value.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function containsGenericAiWording(value: string) {
  const text = value.toLowerCase();

  return [
    'as an ai',
    'ai says',
    'based on available data',
  ].some(pattern => text.includes(pattern));
}
