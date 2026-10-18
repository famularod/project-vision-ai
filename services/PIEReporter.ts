import type {
  ContactBook,
  ProjectArea,
  ProjectContact,
  ProjectUpdate,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';
import {
  classifyDAVEBlocker,
  classifyDAVECompletion,
  classifyDAVEImplementation,
  classifyDAVEIssue,
  classifyDAVESafety,
} from './DAVEAssertionParser';
import type { PIEDeliberationResult } from './PIEDeliberationEngine';
import type { PIEPhotoProgressEvidence } from './PIEPhotoProgress';
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
import { projectScheduleItemsForReport } from './ReportScheduleProjection';
import { fieldUpdatesNewestFirst, scheduleTasksInReportOrder, whatChangedForWrittenReport, extractScheduleEvidence } from './PIEEvidenceFusion';
import { confirmedComparisonQuoted, isEmptyRuntimeSummary, noteIsAcceptedPhotoSuggestion } from './ReportWrittenFacts';
import { resolvePIEReportProjectNames } from './PIEReportScope';
import { SCHEDULE_CHECK_REVIEW_FLAG } from './ReportApprovalPolicy';
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
  /** The name the area's lines are FILED under: each such group has its own three lines of the report. */
  workAreaName: string;
  /**
   * The name the area is PRINTED under (Build 232 item 3 part 2): its name
   * without the year of a date one of its lines prints ("2026 Site" is
   * "Site"). Missing where it is the name it is filed under.
   */
  printedName?: string;
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
  /**
   * Open item 7.62: the records the area's lines are made from, each with the field update and the photo it is of,
   * so "See Image N" is printed on the line of the photo's own update. Missing in an area made by hand: its lines
   * cite its photos as before.
   */
  lineSources?: readonly PIEWorkAreaLineSource[];
};

/** Open item 7.62: one record an area's lines are made from. */
export type PIEWorkAreaLineSource = Readonly<{
  /** Own-screen label only; never changes the written line's kind or words. */
  previewKind?: PIEReportPreviewKind;
  preservesCapturedFor?: boolean;
  /** Exact authored span protected from machine wording cleanup, never an unverified runtime sentence. */
  preservedCapturedForText?: string;
  evidenceId: string;
  /** Its words as a line prints them, compared without case or closing stop. */
  words: string;
  updateId: string | null;
  photoId: string | null;
}>;

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
  /** Proven photo-only fused quote, for the owner's preview label only. */
  previewKind?: PIEReportPreviewKind;
  /** Schedule action words composed without its generated structured owner field (7.51). */
  scheduleActionSummary?: string;
  /** A Latest quote matched to the newest selected saved plain field note (4.81). */
  authoredPlainLatest?: boolean;
  /** Authored field words, including the fused Latest update sentence; never machine boilerplate. */
  preservesCapturedFor?: boolean;
  /** Exact authored span protected from machine wording cleanup, never an unverified runtime sentence. */
  preservedCapturedForText?: string;
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
  sourceUpdateId?: string | null;
  actionRequired?: string | null;
  status?: string | null;
  /**
   * The words the work area's name is worked out from when not the summary
   * (Build 232 item 2 part B): the "Schedule focus" sentence without the
   * task's date. The name is read off the summary, and takes any four-digit
   * number in it for a building number: the year of the date would have
   * filed the sentence under "2026 <area>".
   */
  workAreaNameFrom?: string;
};

export type PIEReportImageReference = {
  imageNumber: number;
  photoId: string;
  projectName: string;
  areaName: string;
  caption: string;
  sourceUpdateId?: string | null;
  classificationStatus?: 'classified' | 'needs_classification';
  classificationReason?: string | null;
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

export type PIEReportPreviewKind = 'field_note' | 'photo';

export type PIEReportBullet = {
  /** Presentation provenance, separate from the established written-report classification. */
  previewKind?: PIEReportPreviewKind;
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
    /** The existing runtime recipe's project scope; never broadened by a report projection. */
    projectName?: string;
    scheduleReconciliation?: PIEScheduleReconciliationResult;
    /** What the written report's "Latest update / Latest photo / Schedule focus" sentence is made from. */
    userUpdateEvidence?: Array<Parameters<typeof whatChangedForWrittenReport>[0]['userUpdateEvidence'][number] & { projectName?: string; areaName?: string | null }>;
    photoEvidence?: Parameters<typeof whatChangedForWrittenReport>[0]['photoEvidence'];
    scheduleEvidence?: Parameters<typeof whatChangedForWrittenReport>[0]['scheduleEvidence'];
  } | null;
  photoProgressSummary?: string;
  photoProgress?: { acceptedEvidence: PIEPhotoProgressEvidence[] } | null;
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
  const scheduleItems = reportScheduleItems(input);
  const evidence: PIEReportSourceEvidence[] = [];

  updates.forEach(update => {
    const context = reportContextForUpdate(update, scheduleItems, selectedProjects.length > 1);
    // The rule the report's fingerprint reads too (ReportWrittenFacts, HIGH item 1: F6).
    const noteWasGeneratedFromPhotoAnalysis = noteIsAcceptedPhotoSuggestion(update);
    const authoredNote = !noteWasGeneratedFromPhotoAnalysis && /captured\s+for/i.test(update.notes)
      ? update.notes.replace(/\s+/g, ' ').trim() : undefined;

    if (
      update.notes.trim() &&
      (!noteWasGeneratedFromPhotoAnalysis || isConstructionRelevantObservation(update.notes))
    ) {
      evidence.push({
        id: `note-${update.id}`,
        source: 'note',
        preservesCapturedFor: !noteWasGeneratedFromPhotoAnalysis,
        preservedCapturedForText: authoredNote,
        projectName: context.projectName,
        areaName: context.areaName,
        summary: cleanReportBulletText(update.notes.replace(/\s+/g, ' ').trim(), authoredNote),
        confidence: isUnclearText(update.notes) ? 'low' : 'medium',
        sourceUpdateId: update.id,
      });
    }

    update.photos.forEach(photo => {
      const photoEvidence = photoToEvidence(update, photo, context);
      if (photoEvidence) evidence.push(photoEvidence);
    });
  });

  scheduleItems
    .filter(item =>
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
        scheduleActionSummary: scheduleSummaryLine(item, false),
        confidence: item.projectName && item.taskName ? 'medium' : 'low',
        owner: item.owner || item.contractor || null,
        actionRequired: scheduleActionLine(item),
        status: item.status,
      });
    });

  const projectedTasks = input.scheduleItems && projectScheduleItemsForReport(input.scheduleItems);
  const originalRuntime = input.runtime;
  const fusedProjectName = originalRuntime?.fusedEvidence?.projectName || selectedProjects[0];
  const fusedProjectKey = normalizeName(fusedProjectName || '');
  const tasksChanged = projectedTasks?.some((item, index) =>
    item !== input.scheduleItems![index] &&
    selectedProjects.includes(normalizeName(item.scheduleProjectName?.trim() || item.projectName)) &&
    (!fusedProjectKey || fusedProjectKey === 'unassigned project' || normalizeName(item.projectName) === fusedProjectKey),
  );
  // The report reads its own projected tasks, while retaining the runtime's authored
  // update/photo recipe and every other model product. Do not change the wider runtime.
  const runtime = tasksChanged && originalRuntime?.fusedEvidence?.scheduleEvidence
    ? {
        ...originalRuntime,
        fusedEvidence: {
          ...originalRuntime.fusedEvidence,
          scheduleEvidence: extractScheduleEvidence({
            projectName: fusedProjectName,
            scheduleItems: projectedTasks!.filter(item => selectedProjects.includes(
              normalizeName(item.scheduleProjectName?.trim() || item.projectName),
            )),
            now: input.generatedAt,
          }),
        },
      }
    : originalRuntime;
  const situation = runtime?.situationIntelligence;
  if (situation?.situationSummary.headline) {
    evidence.push({
      id: SAVED_MODEL_EVIDENCE_ID,
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
  const fused = runtime?.fusedEvidence;
  const latestWrittenUpdate = fieldUpdatesNewestFirst(fused?.userUpdateEvidence ?? [])[0];
  // Match the newest selected saved record, including its project, area, date and words.
  // A complete fusion recipe supplies the quote; arbitrary runtime/provider prose cannot become authored.
  const latestSaved = updates[0];
  const matchedLatest = fused?.photoEvidence && fused.scheduleEvidence && latestWrittenUpdate && latestSaved &&
    latestSaved.id === latestWrittenUpdate.id &&
    normalizeName(latestSaved.projectName) === normalizeName(latestWrittenUpdate.projectName || '') &&
    normalizeName(latestSaved.selectedAreaName || '') === normalizeName(latestWrittenUpdate.areaName || '') &&
    latestSaved.date === latestWrittenUpdate.date &&
    latestSaved.notes.replace(/\s+/g, ' ').trim() === (latestWrittenUpdate.notes ?? '').replace(/\s+/g, ' ').trim() &&
    !noteIsAcceptedPhotoSuggestion(latestSaved)
      ? latestSaved : undefined;
  const authoredPlainLatest = Boolean(matchedLatest && evidence.some(item =>
    item.id === `note-${matchedLatest.id}` && isPlainFieldNote(item)));
  const authoredLatest = matchedLatest && latestWrittenUpdate && (authoredPlainLatest || /captured\s+for/i.test(matchedLatest.notes))
    ? whatChangedForWrittenReport({ userUpdateEvidence: [latestWrittenUpdate], photoEvidence: [], scheduleEvidence: [] }).replace(/\s+/g, ' ').trim()
    : undefined;
  const latestContext = authoredLatest && matchedLatest
    ? reportContextForUpdate(matchedLatest, scheduleItems, selectedProjects.length > 1) : undefined;
  const rawRuntimeChanged = writtenReportWhatChanged(runtime)?.replace(/\s+/g, ' ').trim();
  const runtimeChanged = authoredLatest && rawRuntimeChanged && shouldSuppressReportBullet(rawRuntimeChanged, authoredLatest)
    ? authoredLatest : rawRuntimeChanged;
  if (runtimeChanged && (authoredLatest || !isEmptyRuntimeSummary(runtimeChanged))) {
    const areaWords = writtenReportWhatChanged(runtime, { taskDate: false })?.replace(/\s+/g, ' ').trim() || runtimeChanged;
    // Only a complete photo-only recipe backed by selected saved photos gets a Photo label.
    // Arbitrary runtime prose, authored notes and confirmed comparisons keep their own classification.
    const photoOnlyChange = fused?.userUpdateEvidence && fused.photoEvidence?.length && fused.scheduleEvidence &&
      fused.photoEvidence.every(photo => updates.some(update => update.id === photo.updateId &&
        update.photos.some(saved => (saved.caption || '').trim() === (photo.caption || '').trim()))) &&
      runtimeChanged === whatChangedForWrittenReport({ userUpdateEvidence: [], photoEvidence: fused.photoEvidence, scheduleEvidence: [] }).replace(/\s+/g, ' ').trim();
    evidence.push({
      id: 'runtime-what-changed',
      source: 'runtime',
      ...(photoOnlyChange ? { previewKind: 'photo' as const } : {}),
      authoredPlainLatest,
      preservesCapturedFor: Boolean(authoredLatest),
      preservedCapturedForText: authoredLatest,
      projectName: latestContext?.projectName || input.currentUpdate?.projectName || selectedProjects[0] || '',
      areaName: latestContext?.areaName ?? input.currentUpdate?.selectedAreaName ?? '',
      summary: cleanReportBulletText(runtimeChanged, authoredLatest),
      workAreaNameFrom: cleanReportBulletText(authoredLatest && shouldSuppressReportBullet(areaWords, authoredLatest) ? authoredLatest : areaWords, authoredLatest),
      confidence: 'medium',
    });
  }

  // Audit round 2 H1: only a comparison the owner CONFIRMED is reported as
  // fact, with its own project and area. photoProgressSummary is the newest
  // comparison, confirmed or not, and printed an unconfirmed AI finding.
  const confirmedPhotoNote = recentConfirmedPhotoNote(input, updates);
  if (confirmedPhotoNote) evidence.push(confirmedPhotoNote);

  return uniqueEvidence(
    evidence
      .filter(item => item.source !== 'gps')
      .filter(item => item.summary.trim())
      .filter(item => !isIncidentalReportEvidence(item))
      .filter(item => !containsGenericAiWording(item.preservedCapturedForText ? item.summary.replace(item.preservedCapturedForText, '') : item.summary)),
  );
}

/**
 * The "Latest update / Latest photo / Schedule focus" sentence of the written
 * report, made for it from the evidence the runtime fused (Build 232 item 2):
 * by the updates' own dates, never by the order this device's list holds
 * them in. A runtime handed over without that evidence keeps the sentence it
 * came with.
 */
function writtenReportWhatChanged(
  runtime: PIEReporterRuntimeInput | null | undefined,
  options?: Parameters<typeof whatChangedForWrittenReport>[1],
) {
  const fused = runtime?.fusedEvidence;
  if (fused?.userUpdateEvidence && fused.photoEvidence && fused.scheduleEvidence) {
    return whatChangedForWrittenReport({
      userUpdateEvidence: fused.userUpdateEvidence,
      photoEvidence: fused.photoEvidence,
      scheduleEvidence: fused.scheduleEvidence,
    }, options);
  }
  return runtime?.intelligentSummary?.whatChanged;
}

/**
 * The confirmed comparison quoted as today's photo note: the newest confirmed one, about the work, of this report's
 * updates, at most 7 days old. Chosen by the rule the report's fingerprint reads too (ReportWrittenFacts, HIGH item
 * 1: F4, F6b).
 */
function recentConfirmedPhotoNote(
  input: PIEReportDraftInput,
  updates: ProjectUpdate[],
): PIEReportSourceEvidence | null {
  // Newest first, so [0] is the newest confirmed comparison.
  const quoted = confirmedComparisonQuoted(
    input.runtime?.photoProgress?.acceptedEvidence,
    updates,
    (input.generatedAt || new Date()).getTime(),
  );
  if (!quoted) return null;
  const { confirmed, source } = quoted;
  const context = reportContextForUpdate(source, reportScheduleItems(input), selectedProjectsFromInput(input).length > 1);
  return {
    id: `${CONFIRMED_PHOTO_NOTE_ID}${confirmed.currentPhotoId}`,
    source: 'photo',
    projectName: context.projectName,
    areaName: confirmed.areaName?.trim() || context.areaName,
    summary: cleanReportBulletText(confirmed.summary),
    confidence: 'medium',
  };
}

function isIncidentalReportEvidence(item: PIEReportSourceEvidence) {
  // Not his field notes (Build 232 item 4 part B): the filter is for what a
  // photo's analysis sees in passing (a dog, a desk, a chair). A note he
  // typed with such a word and no construction word ("Conference table and
  // chairs were delivered to the trailer.") was dropped here, unseen.
  if (!['photo', 'runtime'].includes(item.source) || item.preservedCapturedForText) return false;
  return isIncidentalVisualObservation(item.summary);
}

export function buildConstructionUnderstanding(
  input: PIEReportDraftInput,
  rawEvidence: PIEReportSourceEvidence[] = collectReportEvidence(input),
): PIEConstructionUnderstanding {
  // "2375 compliance project" and "2375 Compliance Project" are one project.
  const evidence = withCanonicalProjectNames(input, rawEvidence);
  const imageReferences = buildReportImageReferences(
    selectedUpdates(input, selectedProjectsFromInput(input)),
    selectedProjectsFromInput(input),
  );
  const byArea = new Map<string, PIEReportSourceEvidence[]>();

  evidence.forEach(item => {
    const workAreaName = cleanReportWorkAreaName(
      item.projectName,
      item.areaName,
      item.workAreaNameFrom ?? item.summary,
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
      imageReferenceMatchesWorkArea(ref, {
        projectName,
        areaName,
        evidence: items,
      }),
    );
    const progress = items
      .filter(isVerifiedConstructionProgressEvidence)
      .map(item => ({
        summary: cleanReportBulletText(item.summary, item.preservedCapturedForText),
        sourceEvidenceIds: [item.id],
      }))
      .filter(item => item.summary);
    const issues = items
      .filter(item => item.source === 'issue' || item.source === 'safety' || isRiskText(item.summary))
      .map(item => ({
        summary: cleanReportBulletText(item.summary, item.preservedCapturedForText),
        severity: item.source === 'safety' || classifyDAVEBlocker(item.summary) === 'blocked'
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
    // The area's progress LINES: the verified progress, and with it, in the
    // same order, his field notes of none of the three kinds (item 4 part B).
    // Only verified construction evidence still COUNTS as progress above.
    const changedItems = items
      .filter(item => isVerifiedConstructionProgressEvidence(item) || isPlainFieldNote(item) ||
        (item.id === 'runtime-what-changed' && item.preservesCapturedFor && /^Latest update:/i.test(item.summary)));
    const changed = changedItems
      .map(item => cleanReportBulletText(item.summary, item.preservedCapturedForText))
      .filter(Boolean);

    const reportedIds = new Set([
      ...changedItems.map(item => item.id),
      ...[...progress, ...issues, ...nextSteps].flatMap(item => item.sourceEvidenceIds),
    ]);
    const reportedItems = items.filter(item => reportedIds.has(item.id));
    const printedName = printedNameOfFiledWorkArea(areaName, reportedItems.length ? reportedItems : items);

    return {
      id: slug(`understanding-${location}-${areaName}`),
      projectName,
      locationTitle: location,
      workAreaName: areaName,
      ...(printedName !== areaName ? { printedName } : {}),
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
      hasSafetyConcern: items.some(item =>
        item.source === 'safety' ||
        classifyDAVESafety(item.summary) === 'issue_present'
      ),
      hasInspectionDependency: items.some(item => /inspection|inspect|permit/i.test(item.summary)),
      readerTakeaway: buildReaderTakeaway(areaName, status, progress, issues, nextSteps),
      imageReferences: imageRefs,
      sourceEvidenceIds,
    };
  });

  const numberedWorkAreas = renumberWorkAreaImageReferences(
    withEveryPhotoAttached(input, workAreas, Array.from(byArea.values()), imageReferences, rawEvidence),
  );
  // Open item 7.64: a combined report's work areas by project name, as HIGH item 1e put its other parts.
  const locationGroups = groupUnderstandingByLocation(numberedWorkAreas, selectedProjectsFromInput(input).length > 1);
  const reviewFlags = buildReportReviewFlags({
    evidence,
    workAreas: numberedWorkAreas,
    imageReferences,
  });

  return {
    locationGroups,
    workAreas: numberedWorkAreas,
    executiveSummaryBullets: buildExecutiveSummaryBullets(numberedWorkAreas),
    reviewFlags,
  };
}

function imageReferenceMatchesWorkArea(
  reference: PIEReportImageReference,
  {
    projectName,
    areaName,
    evidence,
  }: {
    projectName: string;
    areaName: string;
    evidence: PIEReportSourceEvidence[];
  },
) {
  if (reference.classificationStatus === 'needs_classification') {
    return false;
  }

  if (normalizeName(reference.projectName) !== normalizeName(projectName)) {
    return false;
  }

  const directPhotoIds = new Set(
    evidence
      .map(item => item.photoId?.trim())
      .filter((photoId): photoId is string => Boolean(photoId)),
  );
  const directUpdateIds = new Set(
    evidence
      .map(item => item.sourceUpdateId?.trim())
      .filter((updateId): updateId is string => Boolean(updateId)),
  );
  const targetArea = normalizeName(areaName);
  const referenceArea = normalizeName(
    cleanReportWorkAreaName(
      reference.projectName,
      reference.areaName,
      reference.caption,
    ),
  );
  const genericArea = !targetArea || /^(project work|unassigned|unknown)/i.test(areaName);

  if (genericArea) {
    return directPhotoIds.has(reference.photoId);
  }

  if (referenceArea !== targetArea) return false;

  return (
    directPhotoIds.has(reference.photoId) ||
    !reference.sourceUpdateId ||
    directUpdateIds.has(reference.sourceUpdateId)
  );
}

/**
 * Open item 4.87 (review pass 7, R7-4; the owner's authorisation of 13 Oct
 * 2026): EVERY PHOTO OF THE REPORT IS NUMBERED AND ATTACHED. A work area took
 * a photo only through a line made from the photo itself, or from a note or
 * photo of the same update in the same area (imageReferenceMatchesWorkArea),
 * and never a photo with no area of its own. So a photo recorded alone whose
 * caption has no word of the writer's building vocabulary (it makes no line),
 * and a photo taken with a note that has no area, had no number, no line, no
 * place in the e-mail or the Word file.
 *
 * A photo no area took goes, in this order (but a photo whose own records
 * name two different areas stays out, as decided, until he classifies it):
 * to the area of the line made from the photo itself; to its own area (same
 * project, same name); to the first
 * area holding a line of the update it was recorded with; else to an area of
 * its own (its own area's name, or else its update's), whose line is its
 * caption where the writer would print it (else "See Image N." alone). Such
 * an area is put among the others by its update's place in the report's
 * order, so every area that was there keeps its place. A report in which
 * every photo was taken already is returned as it was.
 */
function withEveryPhotoAttached(
  input: PIEReportDraftInput,
  workAreas: PIEWorkAreaUnderstanding[],
  itemsOfArea: PIEReportSourceEvidence[][],
  imageReferences: PIEReportImageReference[],
  rawEvidence: PIEReportSourceEvidence[],
): PIEWorkAreaUnderstanding[] {
  const taken = new Set(workAreas.flatMap(area => area.imageReferences.map(reference => reference.photoId)));
  // A photo whose own records name two areas stays out until he classifies it, as it was decided (review flag "N
  // photos need area classification"); a photo with no area at all is not that, and goes with its update.
  const untaken = imageReferences.filter(reference => !taken.has(reference.photoId) &&
    (reference.classificationStatus !== 'needs_classification' || reference.classificationReason === PHOTO_WITH_NO_AREA));
  if (untaken.length === 0) return withLineSources(workAreas, itemsOfArea);

  const selectedProjects = selectedProjectsFromInput(input);
  const updates = selectedUpdates(input, selectedProjects);
  const placeOfUpdate = new Map(updates.map((update, index) => [update.id, index] as const));
  const areas = workAreas.map(area => ({ ...area, imageReferences: [...area.imageReferences] }));
  const items = itemsOfArea.map(list => [...list]);
  const keyOf = (location: string, workAreaName: string) => `${normalizeName(location)}|${normalizeName(workAreaName)}`;
  const firstAreaHolding = (holds: (item: PIEReportSourceEvidence) => boolean) =>
    items.findIndex(list => list.some(holds));
  // An area's place in the report's order: its first line's update (areas are
  // made in the order of their first line; lines of updates come first).
  const placeOfArea = (index: number) => Math.min(
    ...items[index].map(item => placeOfUpdate.get(item.sourceUpdateId || '') ?? Number.POSITIVE_INFINITY),
  );

  untaken.forEach(reference => {
    const ownNames = reference.classificationStatus === 'classified'
      ? new Set([
        cleanReportWorkAreaName(reference.projectName, reference.areaName, reference.caption),
        cleanReportWorkAreaName(reference.projectName, reference.areaName),
      ].map(normalizeName))
      : new Set<string>();
    const place = [
      firstAreaHolding(item => item.photoId === reference.photoId),
      areas.findIndex(area =>
        normalizeName(area.projectName) === normalizeName(reference.projectName) &&
        ownNames.has(normalizeName(area.workAreaName))),
      reference.sourceUpdateId
        ? firstAreaHolding(item => item.sourceUpdateId === reference.sourceUpdateId)
        : -1,
    ].find(index => index >= 0);
    if (place !== undefined) {
      areas[place].imageReferences.push(reference);
      return;
    }

    // A line of its own.
    const update = updates.find(candidate => candidate.id === reference.sourceUpdateId);
    if (!update) return;
    const context = reportContextForUpdate(update, reportScheduleItems(input), selectedProjects.length > 1);
    const caption = cleanReportBulletText(reference.caption);
    const [photoLine] = withCanonicalProjectNames(input, [...rawEvidence, {
      id: `photo-${reference.photoId}`,
      source: 'photo',
      projectName: context.projectName,
      areaName: reference.classificationStatus === 'classified' ? reference.areaName : context.areaName,
      summary: caption,
      confidence: 'medium',
      photoId: reference.photoId,
      sourceUpdateId: update.id,
    }]).slice(-1);
    const printable = Boolean(caption) &&
      !shouldSuppressReportBullet(caption) &&
      !isIncidentalReportEvidence(photoLine) &&
      !containsGenericAiWording(caption);
    const location = locationTitle(photoLine.projectName, photoLine.areaName);
    const workAreaName = cleanReportWorkAreaName(photoLine.projectName, photoLine.areaName, caption);
    const same = areas.findIndex(area => keyOf(area.locationTitle, area.workAreaName) === keyOf(location, workAreaName));
    if (same >= 0) {
      areas[same].imageReferences.push(reference);
      areas[same].whatChanged = uniqueText([...areas[same].whatChanged, ...(printable ? [caption] : [])]).slice(0, 4);
      items[same].push(photoLine);
      return;
    }
    const printedName = printedNameOfFiledWorkArea(workAreaName, [photoLine]);
    const ownPlace = placeOfUpdate.get(update.id) ?? Number.POSITIVE_INFINITY;
    const before = areas.findIndex((_, index) => placeOfArea(index) > ownPlace);
    const at = before >= 0 ? before : areas.length;
    areas.splice(at, 0, {
      id: slug(`understanding-${location}-${workAreaName}-photos`),
      projectName: photoLine.projectName,
      locationTitle: location,
      workAreaName,
      ...(printedName !== workAreaName ? { printedName } : {}),
      status: 'On Track',
      whatWorkIsAbout: workAreaName,
      whatChanged: printable ? [caption] : [],
      progress: [],
      issues: [],
      decisions: [],
      nextSteps: [],
      affectsSchedule: false,
      hasSafetyConcern: false,
      hasInspectionDependency: false,
      readerTakeaway: buildReaderTakeaway(workAreaName, 'On Track', [], [], []),
      imageReferences: [reference],
      sourceEvidenceIds: [photoLine.id],
    });
    items.splice(at, 0, [photoLine]);
  });

  return withLineSources(areas, items);
}

/** Open item 7.62: each area with the records its lines are made from (`items`, area by area). */
function withLineSources(
  areas: PIEWorkAreaUnderstanding[],
  items: readonly PIEReportSourceEvidence[][],
): PIEWorkAreaUnderstanding[] {
  return areas.map((area, index) => ({ ...area, lineSources: (items[index] ?? []).map(lineSourceOf) }));
}

function renumberWorkAreaImageReferences(
  workAreas: PIEWorkAreaUnderstanding[],
): PIEWorkAreaUnderstanding[] {
  const orderedReferences = workAreas
    .flatMap(area => area.imageReferences)
    .sort((left, right) => left.imageNumber - right.imageNumber);
  const imageNumberByPhotoId = new Map<string, number>();

  orderedReferences.forEach(reference => {
    if (!imageNumberByPhotoId.has(reference.photoId)) {
      imageNumberByPhotoId.set(reference.photoId, imageNumberByPhotoId.size + 1);
    }
  });

  return workAreas.map(area => ({
    ...area,
    imageReferences: area.imageReferences
      .map(reference => ({
        ...reference,
        imageNumber:
          imageNumberByPhotoId.get(reference.photoId) || reference.imageNumber,
      }))
      .sort((left, right) => left.imageNumber - right.imageNumber),
  }));
}

export function buildProjectNarrative(
  understanding: PIEConstructionUnderstanding,
): PIEProjectNarrative {
  const locationGroups = understanding.locationGroups.map(group => ({
    id: group.id,
    title: group.title,
    workAreas: workAreasPrintedOncePerName(group.workAreas.map(area => {
      const actionItems = buildReportActionItems(area);
      const bullets = buildReportBulletsFromUnderstanding(area, actionItems);
      const risks = area.issues.map(issue => ({
        id: slug(`risk-${area.id}-${issue.summary}`),
        projectName: area.projectName,
        areaName: printedWorkAreaName(area),
        summary: issue.summary,
        severity: issue.severity,
        sourceEvidenceIds: issue.sourceEvidenceIds,
      }));
      const decisionsNeeded = area.decisions.map(decision => ({
        id: slug(`decision-${area.id}-${decision.summary}`),
        projectName: area.projectName,
        areaName: printedWorkAreaName(area),
        question: decision.summary,
        owner: decision.owner || 'Action Required',
        sourceEvidenceIds: decision.sourceEvidenceIds,
      }));

      return {
        id: area.id,
        title: printedWorkAreaName(area),
        projectName: area.projectName,
        areaName: printedWorkAreaName(area),
        bullets,
        actionItems,
        imageReferences: area.imageReferences,
        risks,
        decisionsNeeded,
      };
    })),
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

/**
 * Build 232 item 3 part 2 (the coordinator's decision): the heading is
 * corrected and NOT ONE LINE LEAVES OR COMES.
 *
 * A work area prints at most three lines (selectConciseAreaBullets). The
 * lines that print a date were filed under "2026 <area>", a work area of
 * their own with its own three, beside "<area>" with the field notes' three.
 * They are filed exactly as before, so each group keeps its own three lines
 * and its own photos, and the groups one name is printed for are joined
 * here, when the report is written: the first group's lines, then the
 * other's, under the one heading. The Reports screen lists the area once.
 */
function workAreasPrintedOncePerName(areas: PIEReportWorkArea[]): PIEReportWorkArea[] {
  const printed: PIEReportWorkArea[] = [];
  const placeOf = new Map<string, number>();
  areas.forEach(area => {
    const key = `${normalizeName(area.projectName)}|${normalizeName(area.title)}`;
    const place = placeOf.get(key);
    if (place === undefined) {
      placeOf.set(key, printed.length);
      printed.push(area);
      return;
    }
    const first = printed[place];
    const photoIds = new Set(first.imageReferences.map(reference => reference.photoId));
    printed[place] = {
      ...first,
      bullets: [...first.bullets, ...area.bullets],
      actionItems: [...first.actionItems, ...area.actionItems],
      imageReferences: [...first.imageReferences, ...area.imageReferences.filter(reference => !photoIds.has(reference.photoId))],
      risks: [...first.risks, ...area.risks],
      decisionsNeeded: [...first.decisionsNeeded, ...area.decisionsNeeded],
    };
  });
  return printed;
}

/** The name a work area is printed under: its own, without the year of a date (see `printedName`). */
function printedWorkAreaName(area: PIEWorkAreaUnderstanding) {
  return area.printedName ?? area.workAreaName;
}

/**
 * The name the lines filed under `filedUnder` are printed under. Each line
 * is named again without the dates it prints; if that gives another name for
 * all of them, the number in the name was only ever a date's year, and the
 * area is printed under the name without it. A number that is any line's
 * own (a building in the task's name) names the area as before.
 */
function printedNameOfFiledWorkArea(filedUnder: string, items: PIEReportSourceEvidence[]) {
  // Advice and a fused Latest recipe may mention another task. Recorded
  // evidence owns this heading; those mentions still remain in the report.
  const recorded = items.filter(item => item.source !== 'runtime');
  const namingItems = recorded.length ? recorded : items.filter(item => item.id !== SAVED_MODEL_EVIDENCE_ID);
  const named = namingItems.map(item =>
    printedReportWorkAreaName(item.projectName, item.areaName, item.workAreaNameFrom ?? item.summary));
  return named.length === 0 || named.includes(filedUnder) ? filedUnder : named[0] || filedUnder;
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
        areaName: printedWorkAreaName(area),
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
  const seenPhotoIds = new Set<string>();

  updates.forEach(update => {
    // Open item 7.54: an update saved from a sub-project's task carries the
    // sub-project's own name and names its parent in scheduleProjectName. The
    // parent's report carries its lines (selectedUpdates), and its photos were
    // left out here, so they had no number and went nowhere. They are numbered
    // with the parent's, filed under the parent its lines are printed under.
    const parent = update.scheduleProjectName?.trim() || '';
    const savedUnderItsParent = selected.length > 0 &&
      !selected.includes(normalizeName(update.projectName)) &&
      Boolean(parent) && selected.includes(normalizeName(parent));
    if (
      selected.length > 0 &&
      !selected.includes(normalizeName(update.projectName)) &&
      !savedUnderItsParent
    ) {
      return;
    }

    update.photos.forEach(photo => {
      if (seenPhotoIds.has(photo.id)) return;
      seenPhotoIds.add(photo.id);
      const areaResolution = resolveReportPhotoArea(update, photo);
      references.push({
        imageNumber: references.length + 1,
        photoId: photo.id,
        projectName: savedUnderItsParent ? parent : update.projectName,
        areaName: areaResolution.areaName,
        caption: cleanReportBulletText(photo.caption),
        sourceUpdateId: update.id,
        classificationStatus: areaResolution.status,
        classificationReason: areaResolution.reason,
      });
    });
  });

  return references;
}

/** Why a photo with no area of its own anywhere needs classification (open item 4.87 reads it). */
const PHOTO_WITH_NO_AREA = 'No project area is recorded for this photo.';

function resolveReportPhotoAreaName(
  update: ProjectUpdate,
  photo: UpdatePhoto,
) {
  return resolveReportPhotoArea(update, photo).areaName;
}

function resolveReportPhotoArea(
  update: ProjectUpdate,
  photo: UpdatePhoto,
): {
  areaName: string;
  status: 'classified' | 'needs_classification';
  reason: string | null;
} {
  const generatedAreaCaption = photo.caption
    .trim()
    .match(/^(?:photo\s+\d+\s*[—-]\s*)?project photo from\s+(.+?)\.?$/i);
  const candidates = [
    photo.selectedAreaName?.trim(),
    photo.continuityAnchor?.areaName?.trim(),
    generatedAreaCaption?.[1]?.trim(),
  ].filter((value): value is string => Boolean(value));
  const uniqueCandidates = candidates.filter((candidate, index) =>
    candidates.findIndex(value => normalizeName(value) === normalizeName(candidate)) === index,
  );

  if (uniqueCandidates.length > 1) {
    return {
      areaName: 'Needs Classification',
      status: 'needs_classification',
      reason: `Conflicting photo areas: ${uniqueCandidates.join(', ')}.`,
    };
  }

  const resolvedArea = uniqueCandidates[0] || update.selectedAreaName?.trim() || '';
  if (!resolvedArea) {
    return {
      areaName: 'Needs Classification',
      status: 'needs_classification',
      reason: PHOTO_WITH_NO_AREA,
    };
  }

  return {
    areaName: resolvedArea,
    status: 'classified',
    reason: null,
  };
}

export function buildReportReviewFlags({
  evidence,
  workAreas,
  imageReferences = [],
}: {
  evidence: PIEReportSourceEvidence[];
  workAreas: PIEWorkAreaUnderstanding[];
  imageReferences?: PIEReportImageReference[];
}): string[] {
  const photosNeedingClassification = imageReferences.filter(
    reference => reference.classificationStatus === 'needs_classification',
  ).length;
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
    photosNeedingClassification > 0
      ? `${photosNeedingClassification} photo${photosNeedingClassification === 1 ? '' : 's'} need${photosNeedingClassification === 1 ? 's' : ''} area classification before report use.`
      : null,
  ].filter(Boolean) as string[];

  return Array.from(new Set(flags));
}

const REPORT_MONTH_NAME =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
/** The dates a line can print: 10/08/2026, 2026-10-08, Oct 8, 2026, 8 Oct 2026, October 2026. */
const REPORT_LINE_DATES = new RegExp([
  '\\b\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}\\b',
  '\\b\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}\\b',
  `\\b${REPORT_MONTH_NAME}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`,
  `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${REPORT_MONTH_NAME},?\\s+\\d{4}\\b`,
  `\\b${REPORT_MONTH_NAME},?\\s+\\d{4}\\b`,
].join('|'), 'gi');

/**
 * The name one line's work area is PRINTED under (Build 232 item 3 part 2,
 * the coordinator's decision): a date printed in a line is never a building
 * number. `cleanReportWorkAreaName` names a work area from the project's
 * name, the area's name and the line's own words, and takes a four-digit
 * number among them for a building number ("Building 2321 East Driveway" is
 * "2321 East Driveway"). It took the year of a date the same way, so every
 * schedule line that prints its due date read "<project> — 2026 <area>".
 * This is that name with the line's dates left out of its words. A number
 * in the project's, the area's or the task's own name still names the area.
 * (How a line is FILED is `cleanReportWorkAreaName`, unchanged.)
 */
export function printedReportWorkAreaName(
  projectName: string,
  areaName: string,
  lineWords = '',
) {
  // Only the Latest recipe's authored portion can name its work area. Its
  // Schedule focus suffix describes a separate task, not the note's location.
  const authoredWords = /^Latest (?:update|photo):/i.test(lineWords)
    ? lineWords.replace(/\s+Schedule focus:.*$/i, '')
    : lineWords;
  const namingWords = authoredWords
    .replace(REPORT_LINE_DATES, ' ')
    .replace(/\b\d{4}(?:[.,]\d+)?\s*(?:psi|psf|ksi|mpa|kpa|pa|mm|cm|m|km|inches|inch|feet|foot|ft|yards|yard|yd|lbs|lb|kg|tons|ton|sf|sq\.?\s*ft|sq\.?\s*m)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  // A generic project's actual name is still preferable to leftover note
  // prose when it has no recorded area or meaningful location number.
  if (!areaName.trim() && /^project$/i.test(projectName.trim()) && !/\b\d{4}\b/.test(namingWords)) {
    return projectName.trim();
  }
  return cleanReportWorkAreaName(projectName, areaName, namingWords);
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
  const explicitArea = candidates[0];
  const explicitAreaIsSpecific = Boolean(
    explicitArea &&
    normalizeName(explicitArea) !== normalizeName(candidates[1]) &&
    !/^(project|project work|schedule area|location|unassigned|unknown)$/i.test(
      explicitArea,
    ),
  );
  const best =
    (explicitAreaIsSpecific ? explicitArea : '') ||
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
      areaName: cleanReportWorkAreaName(item.projectName, item.areaName, item.workAreaNameFrom ?? item.summary),
      summary: cleanReportBulletText(item.summary, item.preservedCapturedForText),
      severity:
        item.source === 'safety' ||
        classifyDAVEBlocker(item.summary) === 'blocked'
          ? 'high'
          : 'medium',
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
    generatedAt,
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

/**
 * The one piece of the report's evidence that comes from the model the app
 * SAVES: the Core's "situation" (its summary sentence and the first action
 * it advises), built on the reality model the live Core keeps on the device
 * and reads back.
 *
 * Build 232 item 4 part A (the owner's answer to question 49, 13 Oct 2026):
 * its lines are not part of the written report. They followed the device's
 * own history and not today's records: a field update he had deleted was
 * still quoted a month later ("Collect current evidence for <its words>"),
 * and two devices holding the same records wrote two reports under one
 * fingerprint. The evidence stays in the draft: the app's own screens read
 * the model's advice from it (the draft's action items, risks and
 * decisions). Only the lines that are written leave.
 *
 * Item 4b (the coordinator's decision, 13 Oct 2026; review pass 5, R1 and
 * R2): it takes NO PLACE among a work area's lines either. An area prints at
 * most three lines (selectConciseAreaBullets: its first progress line, its
 * first problem, its first next step, then the rest). The model's line was
 * chosen with the others and THEN left out, so its place stood empty: of
 * three field notes recorded with no area, one that Build 231 printed was
 * gone (the model's sentence read as a problem and held the "first problem"
 * place), and two devices with two saved models still wrote two texts (on
 * the other the model's advice held the "first next step" place). The three
 * lines are now chosen as if that evidence were not there.
 */
const SAVED_MODEL_EVIDENCE_ID = 'runtime-current-situation';

function onlyFromTheSavedModel(sourceEvidenceIds: readonly string[]) {
  return sourceEvidenceIds.length > 0 && sourceEvidenceIds.every(id => id === SAVED_MODEL_EVIDENCE_ID);
}

/**
 * Item 4c (the coordinator's decision, 13 Oct 2026; review pass 9, R9-1): a
 * plain note takes only a place Build 231 left empty. His plain notes (item 4
 * part B: in whatChanged and not verified progress) were filed with the
 * progress lines, so a plain note of any age took the "first progress" place
 * and pushed out a newer problem or request that Build 231 printed. Now the
 * area's lines are chosen as Build 231 chose them, the plain notes not
 * counted; then the plain notes fill the places left, newest first
 * (whatChanged is in the updates' own date order, items 2 and 3), after those
 * lines. "See Image N" stays where Build 231 put it; a plain note carries it
 * only as the area's ONLY line.
 *
 * Open item 7.62 (Build 232's device checks, check 18): "See Image N" goes
 * only on a line of the photo's own: made from the photo, or from a note or
 * photo of the field update it was taken with. Build 231 put every photo of
 * an area on its first progress line, whoever's it was; when the three-line
 * rule left out the photo's own note, its number ended a note that had no
 * photo ("Concrete washout pit was installed near the gate. See Image 1.").
 * Now a photo whose own line is printed is cited there; one whose own line
 * is not printed keeps its number on a line of its own ("See Image 1."),
 * after the lines Build 231 chose, as an area without a progress line cites
 * its photos. A line that was a photo's own still cites it, to the word.
 */
function buildReportBulletsFromUnderstanding(
  area: PIEWorkAreaUnderstanding,
  actionItems: PIEReportActionItem[],
): PIEReportBullet[] {
  const { lines: chosen, uncited, madeFrom } = linesAsBuild231ChoseThem(area, actionItems);
  const progressKeys = new Set(area.progress.map(item => normalizeName(item.summary)));
  const printedKeys = new Set(chosen.map(bullet => normalizeName(bullet.text)));
  const filling = area.whatChanged
    .filter(summary => summary && !progressKeys.has(normalizeName(summary)) && !shouldSuppressReportBullet(summary, preservesCapturedFor(area, summary)))
    .map(ensureSentence)
    .filter(text => {
      const key = normalizeName(text);
      if (printedKeys.has(key)) return false;
      printedKeys.add(key);
      return true;
    })
    .slice(0, Math.max(0, 3 - chosen.length))
    .map((text, index): PIEReportBullet => ({
      id: slug(`bullet-${area.id}-plain-${index}`),
      previewKind: previewKindForLine(area, text) ?? 'field_note',
      text,
      kind: 'progress',
      sourceEvidenceIds: area.sourceEvidenceIds,
      needsReview: area.status === 'Needs Review',
    }));

  // 7.62: the only plain note carries the area's photo numbers only if they are its own photos.
  if (
    chosen.length === 1 && chosen[0].kind === 'image_reference' && filling.length === 1 &&
    area.imageReferences.every(reference => lineIsOfPhoto(area, lineMadeFrom(madeFrom, filling[0]), reference))
  ) {
    return [{ ...filling[0], text: `${stripTerminalPunctuation(filling[0].text)}. ${chosen[0].text}` }];
  }

  return photosCitedOnTheirOwnLines(area, chosen, filling, uncited, madeFrom);
}

/** Open item 7.62: what one printed line is made from: its records, and its words (a plain note is known by them). */
type ReportLineMadeFrom = Readonly<{ evidenceIds: ReadonlySet<string>; words: string }>;

const CONFIRMED_PHOTO_NOTE_ID = 'runtime-photo-progress-';

function lineWords(text: string) {
  return normalizeName(text).replace(/[\s.!?]+$/, '');
}

function lineSourceOf(item: PIEReportSourceEvidence): PIEWorkAreaLineSource {
  const previewKind = item.source === 'photo' && !item.id.startsWith(CONFIRMED_PHOTO_NOTE_ID) ? 'photo' : item.previewKind ??
    (item.authoredPlainLatest || isPlainFieldNote(item) ? 'field_note' : undefined);
  return {
    ...(previewKind ? { previewKind } : {}),
    evidenceId: item.id,
    preservesCapturedFor: item.preservesCapturedFor,
    preservedCapturedForText: item.preservedCapturedForText,
    words: lineWords(cleanReportBulletText(item.summary, item.preservedCapturedForText)),
    updateId: item.sourceUpdateId?.trim() || null,
    photoId: item.photoId?.trim() ||
      (item.id.startsWith(CONFIRMED_PHOTO_NOTE_ID) ? item.id.slice(CONFIRMED_PHOTO_NOTE_ID.length) : null),
  };
}

/** 7.49: match the line's exact sources, never an area's unrelated photos or notes. */
function previewKindForLine(area: PIEWorkAreaUnderstanding, summary: string, evidenceIds?: readonly string[]): PIEReportPreviewKind | undefined {
  const sources = area.lineSources?.filter(source => evidenceIds
    ? evidenceIds.includes(source.evidenceId) : source.words === lineWords(summary)) ?? [];
  if (sources.length && sources.every(source => source.previewKind === 'photo')) return 'photo';
  if (sources.length && sources.every(source => source.previewKind === 'field_note')) return 'field_note';
  return undefined;
}

function lineMadeFrom(madeFrom: ReadonlyMap<string, ReportLineMadeFrom>, line: PIEReportBullet): ReportLineMadeFrom {
  return madeFrom.get(line.id) ?? { evidenceIds: new Set(), words: lineWords(line.text) };
}

/**
 * Open item 7.62: whether a line is the photo's own: made from the photo itself, or from a note or photo of the field
 * update it was taken with (by the records it is made from, or, a note of his, by its words). An area that does not
 * say what its lines are made from (one made by hand) takes every line for the photo's, as before.
 */
function lineIsOfPhoto(
  area: PIEWorkAreaUnderstanding,
  line: ReportLineMadeFrom | undefined,
  reference: PIEReportImageReference,
) {
  if (!area.lineSources) return true;
  if (!line) return false;
  const updateId = reference.sourceUpdateId?.trim() || '';
  return area.lineSources.some(source =>
    (line.evidenceIds.has(source.evidenceId) || (Boolean(line.words) && source.words === line.words)) &&
    (source.photoId === reference.photoId || (Boolean(updateId) && source.updateId === updateId)));
}

function withCitation(line: PIEReportBullet, references: PIEReportImageReference[]): PIEReportBullet {
  return { ...line, text: `${stripTerminalPunctuation(line.text)}. ${imageReferenceText(references)}` };
}

/**
 * Open item 7.62: the photos no chosen line was the photo's own: each on the first printed line of its own, else, all
 * together, on a line of their own after the lines Build 231 chose (before his plain notes), as Build 231 cited the
 * photos of an area without a progress line. Each photo keeps its number.
 */
function photosCitedOnTheirOwnLines(
  area: PIEWorkAreaUnderstanding,
  chosen: PIEReportBullet[],
  filling: PIEReportBullet[],
  uncited: PIEReportImageReference[],
  madeFrom: ReadonlyMap<string, ReportLineMadeFrom>,
): PIEReportBullet[] {
  if (uncited.length === 0) return [...chosen, ...filling];
  const lines = [...chosen, ...filling];
  const onLine = new Map<number, PIEReportImageReference[]>();
  const alone: PIEReportImageReference[] = [];
  uncited.forEach(reference => {
    const at = lines.findIndex(line =>
      line.kind !== 'image_reference' && lineIsOfPhoto(area, lineMadeFrom(madeFrom, line), reference));
    if (at >= 0) onLine.set(at, [...(onLine.get(at) ?? []), reference]);
    else alone.push(reference);
  });
  const cited = lines.map((line, index) => {
    const references = onLine.get(index);
    return references ? withCitation(line, references) : line;
  });
  if (alone.length === 0) return cited;
  const ownLine: PIEReportBullet = {
    id: slug(`bullet-image-${area.id}-own`),
    text: imageReferenceText(alone),
    kind: 'image_reference',
    sourceEvidenceIds: alone.map(reference => reference.photoId),
    needsReview: false,
  };
  return [...cited.slice(0, chosen.length), ownLine, ...cited.slice(chosen.length)];
}

function linesAsBuild231ChoseThem(
  area: PIEWorkAreaUnderstanding,
  actionItems: PIEReportActionItem[],
): Readonly<{
  lines: PIEReportBullet[];
  /** Open item 7.62: the photos no chosen line is the photo's own, to cite once the plain notes are in. */
  uncited: PIEReportImageReference[];
  madeFrom: ReadonlyMap<string, ReportLineMadeFrom>;
}> {
  const bullets: PIEReportBullet[] = [];
  const madeFrom = new Map<string, ReportLineMadeFrom>();
  // What the lines are chosen from: the area's progress lines, problems and
  // next steps WITHOUT the ones made from the saved model alone (item 4b), in
  // each of its forms. A line of his own with the same words stays: it has
  // evidence of his. The progress lines are his verified progress only, as on
  // Build 231 (item 4c): his plain notes are not counted here.
  const progressLines = uniqueText(area.progress.map(item => item.summary)).filter(summary => !onlyFromTheSavedModel(area.progress
    .filter(item => normalizeName(item.summary) === normalizeName(summary))
    .flatMap(item => item.sourceEvidenceIds)));
  const issues = area.issues.filter(issue => !onlyFromTheSavedModel(issue.sourceEvidenceIds));
  const nextSteps = actionItems.filter(item => !onlyFromTheSavedModel(item.sourceEvidenceIds));

  progressLines.slice(0, 3).forEach((summary, index) => {
    if (!summary || shouldSuppressReportBullet(summary, preservesCapturedFor(area, summary))) return;
    const id = slug(`bullet-${area.id}-progress-${index}`);
    const sourceIds = area.progress.filter(item => normalizeName(item.summary) === normalizeName(summary))
      .flatMap(item => item.sourceEvidenceIds);
    const previewKind = previewKindForLine(area, summary, sourceIds);
    bullets.push({
      id,
      ...(previewKind ? { previewKind } : {}),
      text: ensureSentence(summary),
      kind: 'progress',
      sourceEvidenceIds: area.sourceEvidenceIds,
      needsReview: area.status === 'Needs Review',
    });
    madeFrom.set(id, {
      evidenceIds: new Set(area.progress
        .filter(item => normalizeName(item.summary) === normalizeName(summary))
        .flatMap(item => item.sourceEvidenceIds)),
      words: lineWords(summary),
    });
  });

  issues.slice(0, 2).forEach((issue, index) => {
    const id = slug(`bullet-${area.id}-issue-${index}`);
    bullets.push({
      id,
      text: ensureSentence(issue.summary),
      kind: issue.summary.toLowerCase().includes('safety') ? 'safety' : 'issue',
      sourceEvidenceIds: issue.sourceEvidenceIds,
      needsReview: false,
    });
    madeFrom.set(id, { evidenceIds: new Set(issue.sourceEvidenceIds), words: lineWords(issue.summary) });
  });

  nextSteps.forEach(item => {
    const id = slug(`bullet-action-${item.id}`);
    bullets.push({
      id,
      text: formatActionItem(item),
      kind: 'next_step',
      sourceEvidenceIds: item.sourceEvidenceIds,
      needsReview: item.needsOwner,
    });
    madeFrom.set(id, { evidenceIds: new Set(item.sourceEvidenceIds), words: lineWords(item.action) });
  });

  let uncited: PIEReportImageReference[] = [];
  if (area.imageReferences.length > 0) {
    const lastProgressIndex = bullets.findIndex(
      bullet => bullet.kind === 'progress' || bullet.kind === 'schedule',
    );

    if (lastProgressIndex >= 0) {
      // 7.62: Build 231 cited every photo of the area here; now only the photos whose own line it is.
      const line = bullets[lastProgressIndex];
      const own = area.imageReferences.filter(reference => lineIsOfPhoto(area, madeFrom.get(line.id), reference));
      uncited = area.imageReferences.filter(reference => !own.includes(reference));
      if (own.length > 0) bullets[lastProgressIndex] = withCitation(line, own);
    } else {
      bullets.push({
        id: slug(`bullet-image-${area.id}`),
        text: imageReferenceText(area.imageReferences),
        kind: 'image_reference',
        sourceEvidenceIds: area.imageReferences.map(ref => ref.photoId),
        needsReview: false,
      });
    }
  }

  const concise = selectConciseAreaBullets(uniqueBullets(bullets), area, madeFrom);
  return { lines: concise.lines, uncited: [...uncited, ...concise.uncited], madeFrom };
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
      areaName: cleanReportWorkAreaName(item.projectName, item.areaName, item.workAreaNameFrom ?? item.summary),
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
    return classifyDAVEBlocker(`${item.status || ''} ${item.summary}`) === 'blocked';
  }

  return STRONG_ACTION_LANGUAGE.test(item.summary);
}

function actionFromEvidence(item: PIEReportSourceEvidence) {
  const action = item.actionRequired || item.scheduleActionSummary || item.summary;
  const formatted = action
    .replace(/^next step:\s*/i, '')
    .replace(/^please\s+([a-z]+)(?=\b)/i, (_prefix, word: string) => /^[a-z]+$/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word)
    .replace(/^please\s+/i, '')
    .trim();
  // Ordinary action formatting can remove the Please prefix from an authored note. Protect its resulting words,
  // while keeping the existing cleanup order for every unauthored action.
  return cleanReportBulletText(formatted,
    item.preservedCapturedForText && action.includes(item.preservedCapturedForText) ? formatted : undefined);
}

function formatActionItem(item: PIEReportActionItem) {
  if (item.needsOwner) {
    return ensureSentence(item.action);
  }

  return `${item.owner} – Please ${lowercaseFirst(item.action).replace(/[\s.,;:]+$/, '')}.`;
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
  const workAreaName = printedWorkAreaName(area).trim();

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
    // Its kind, which the approval policy reads (open item 7.63), not the warning's words.
    .map(warning => `${SCHEDULE_CHECK_REVIEW_FLAG}${shortenReportBullet(warning.summary, 180)}`);
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
  /** A report of several projects (open item 7.64). */
  severalProjects = false,
) {
  const byLocation = new Map<string, PIEWorkAreaUnderstanding[]>();

  workAreas.forEach(area => {
    byLocation.set(area.locationTitle, [
      ...(byLocation.get(area.locationTitle) || []),
      area,
    ]);
  });

  const groups = Array.from(byLocation.entries()).map(([title, areas]) => ({
    id: slug(`location-${title}`),
    title,
    workAreas: areas,
  }));
  // Open item 7.64 (Build 232's device checks, check 21): a combined report printed its projects' work areas in the
  // order their newest notes came, so the project with the newest note came first in WORK AREAS / PHOTO NOTES and the
  // Work Areas & Photos cards while every other part listed the projects by name (HIGH item 1e). Now by name too, the
  // same however he ticked them; each project's areas keep their own order, and each photo its number. A report of
  // one project reads as before, to the word.
  return severalProjects
    ? [...groups].sort((left, right) => reportProjectNameOrder(left.title, right.title))
    : groups;
}

/** HIGH item 1e: the order a report of several projects lists them in: by name, not in the order they were ticked. */
function reportProjectNameOrder(left: string, right: string) {
  const byName = (name: string) => normalizeName(name).replace(/[^a-z0-9]+/g, ' ').trim();
  return byName(left).localeCompare(byName(right));
}

function selectedProjectsFromInput(input: PIEReportDraftInput) {
  // HIGH item 1e: by name, not in the order they were ticked: a combined report's line filed under its first project
  // (the open update's project, else the first selected) is the same however he ticked them, as the report's own order is.
  return resolvePIEReportProjectNames({
    selectedProjectNames: input.selectedProjectNames,
    fallbackProjectNames: [
      input.currentUpdate?.projectName,
      ...(input.savedUpdates || []).map(update => update.projectName),
    ],
  }).map(normalizeName).sort(reportProjectNameOrder);
}

/**
 * The report's tasks, in the report's own order: the one place the writer
 * takes its tasks (Build 232 item 3 part 1, the coordinator's decision). The
 * schedule lines of the section, and the task an update is matched to by
 * its names, followed the order this device's list held the tasks in, and
 * two devices hold the same tasks in different orders. The same tasks are
 * read as before; none is added or left out by the order.
 */
function reportScheduleItems(input: PIEReportDraftInput) {
  return scheduleTasksInReportOrder(projectScheduleItemsForReport(input.scheduleItems || []));
}

function selectedUpdates(
  input: PIEReportDraftInput,
  selectedProjects: string[],
) {
  const updates = [
    ...(input.currentUpdate ? [input.currentUpdate] : []),
    ...(input.savedUpdates || []),
  ];

  // A note logged from a sub-project's schedule task is saved under the
  // sub-project name and names its parent in scheduleProjectName; the report
  // for the parent must still carry it.
  //
  // Build 232 item 2 part A (the coordinator's decision): NEWEST FIRST BY THE
  // SHARED SEND TIMES (legacy records keep their dates), the report's update order.
  // Which notes lead each work area, and the numbers of the images, followed
  // the order this device's list held them in, and two devices hold the same
  // updates in different orders. The same updates are read as before; none is
  // added or left out by the order.
  return fieldUpdatesNewestFirst(updates.filter(update =>
    selectedProjects.includes(normalizeName(update.projectName)) ||
    Boolean(
      update.scheduleProjectName?.trim() &&
      selectedProjects.includes(normalizeName(update.scheduleProjectName)),
    ),
  ));
}

function reportContextForUpdate(
  update: ProjectUpdate,
  scheduleItems: ScheduleItem[],
  /** The report covers more than one project (a combined report). */
  severalProjects = false,
) {
  const updateNames = [
    update.projectName,
    update.selectedAreaName,
    projectAreaFromPhotos(update),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeName);
  // Build 232 item 4 part C (the coordinator's decision): IN A REPORT OF
  // SEVERAL PROJECTS A FIELD UPDATE BELONGS TO ITS OWN PROJECT. An update
  // that names no schedule project took the first matching task's, and a
  // task matches by its project name or by its AREA name: two projects that
  // each have a "Site" printed both projects' notes under one of them, the
  // other's own note could be cut by the three-line limit, and its photos
  // were left out. A task that names another schedule project than the one
  // the update was recorded in, and has only an area name in common with
  // it, claims nothing; the update is then the project it was recorded in.
  // A report of one project is handed that project's tasks and is read as
  // before, to the word.
  const recordedIn = normalizeName(update.projectName);
  const ofAnotherProject = (item: ScheduleItem) => {
    const scheduleProject = normalizeName(item.scheduleProjectName);
    return Boolean(scheduleProject) && scheduleProject !== recordedIn &&
      ![item.projectName, item.locationName].some(name => normalizeName(name) === recordedIn);
  };
  const scheduleMatch = scheduleItems.find(item =>
    [item.projectName, item.locationName].some(name => updateNames.includes(normalizeName(name))) &&
    !(severalProjects && ofAnotherProject(item)),
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
    areaName: resolveReportPhotoAreaName(update, photo) || context.areaName,
    summary: cleanReportBulletText(summary),
    confidence: summary ? 'high' : 'medium',
    owner: photo.actionOwner || null,
    photoId: photo.id,
    sourceUpdateId: update.id,
    actionRequired: photo.actionRequired || null,
    status: photo.actionStatus,
  };
}

function scheduleSummaryLine(item: ScheduleItem, includeOwner = true) {
  const scheduleNote = reportScheduleNote(item.notes);
  const parts = [
    cleanReportBulletText(item.taskName),
    !scheduleProgressIsComplete(item) && item.finishDate
      ? `due ${item.finishDate}`
      : null,
    item.status ? `status ${item.status}` : null,
    includeOwner && (item.owner || item.contractor) ? `owner ${item.owner || item.contractor}` : null,
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
  if (item.authoredPlainLatest || isActionEvidence(item)) return false;
  if (item.source === 'schedule' || item.source === 'safety' || item.source === 'issue') {
    return false;
  }

  return isConstructionRelevantObservation(item.summary);
}

/**
 * A field note that is neither progress, nor a problem, nor a next step
 * (Build 232 item 4 part B, the coordinator's decision): no field note
 * falls through.
 *
 * A work area's lines are made from three lists. A note was "progress" only
 * with a word of the writer's construction vocabulary
 * (dave-construction-relevance), a problem only if it read as an issue or a
 * blocker, a next step only with an action word. A note of none of the
 * three was in no list, so in no line of the report: "Glazing shop drawings
 * are approved.", "Sprinkler main is hung in Bay B.", "Anchor bolts were
 * surveyed at the dock.", "Plumber found a broken cleanout at the site
 * lateral. Dana to call the city." It is listed with the progress notes, a
 * plain observation: in the same order (newest first) and under the same
 * allowance of lines. It is printed among the progress lines and is not
 * counted as verified construction progress. Item 4c: it is printed only in a
 * place the area's other lines leave empty (buildReportBulletsFromUnderstanding).
 */
function isPlainFieldNote(item: PIEReportSourceEvidence) {
  return item.source === 'note' &&
    !isActionEvidence(item) &&
    !isRiskText(item.summary) &&
    !isConstructionRelevantObservation(item.summary);
}

function resolveWorkAreaStatus(
  evidence: PIEReportSourceEvidence[],
  issues: PIEWorkAreaIssue[],
  nextSteps: PIEWorkAreaNextStep[],
): PIEWorkAreaStatus {
  if (issues.some(issue => issue.severity === 'high')) return 'Blocked';
  if (
    issues.length > 0 ||
    evidence.some(item =>
      classifyDAVEIssue(item.summary) === 'issue_present' ||
      classifyDAVEBlocker(item.summary) === 'blocked',
    )
  ) return 'At Risk';
  if (nextSteps.some(step => !step.owner)) return 'Needs Review';
  if (evidence.some(item => classifyDAVECompletion(item.summary) === 'complete')) {
    return 'Complete';
  }
  if (evidence.some(item => {
    const status = classifyDAVEImplementation(item.summary);
    return status === 'in_progress' || status === 'implemented';
  })) return 'In Progress';

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

function cleanReportBulletText(value: string, authoredCapturedForText?: string) {
  // A unique placeholder protects only the authoritative authored span through repeated cleaning passes.
  let marker = '\uE000';
  while (value.includes(marker)) marker += '\uE000';
  const protectedText = authoredCapturedForText && value.includes(authoredCapturedForText) ? authoredCapturedForText : undefined;
  let text = (protectedText ? value.replace(protectedText, marker) : value)
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

  if (!protectedText && /structural work is complete/i.test(text) && /electrical work remains/i.test(text)) {
    return 'Structural work is complete. Electrical work remains before the area can advance to the next phase.';
  }

  return protectedText ? text.replace(marker, () => protectedText).replace(/\s+/g, ' ').trim() : text;
}

function preservesCapturedFor(area: PIEWorkAreaUnderstanding, summary: string) {
  return area.lineSources?.find(source => source.preservedCapturedForText && source.words === lineWords(summary))?.preservedCapturedForText;
}

function shouldSuppressReportBullet(value: string, authoredCapturedForText?: string) {
  const machineWords = authoredCapturedForText ? value.replace(authoredCapturedForText, '') : value;
  return /location was captured|gps was captured|captured for|project area|evidence was fused|runtime indicates|no image references included/i.test(machineWords);
}

/** Legacy sends kept no app-text digest. These source words can now print differently under the same facts. */
export function reportWordingRequiresAppTextKey(report: Pick<PIEReportDraft, 'sourceEvidence' | 'daveBriefing' | 'body'>): boolean {
  return Boolean(report.daveBriefing?.dashboard.workAreas.some(area => /[^\u0000-\u007f]/.test(area.areaName))) || report.sourceEvidence.some(item =>
    // Earlier writers removed substantive owner words from action text, even without a Please prefix.
    (isActionEvidence(item) && /\bowner\s*:?\s*[A-Z][A-Za-z]+(?:\s*\/\s*[A-Z][A-Za-z]+)?/i.test(item.actionRequired || item.summary)) ||
    (item.authoredPlainLatest && report.body.includes(item.summary)) ||
    (item.preservesCapturedFor && /captured\s+for/i.test(item.summary)) ||
    /^please\s+[a-z]+\b/i.test((item.actionRequired || item.summary).replace(/^next step:\s*/i, '')),
  );
}

function isRiskText(value: string) {
  return (
    classifyDAVEIssue(value) === 'issue_present' ||
    classifyDAVEBlocker(value) === 'blocked' ||
    classifyDAVESafety(value) === 'issue_present'
  );
}

function isUnclearText(value: string) {
  return value.trim().length < 8 || /\b(todo|tbd|\?{2,}|asdf)\b/i.test(value);
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
  const namedAreas = update.photos
    .map(photo => photo.selectedAreaName?.trim())
    .filter((areaName): areaName is string => Boolean(areaName));
  const uniqueAreas = new Map<string, string>();

  namedAreas.forEach(areaName => {
    uniqueAreas.set(normalizeName(areaName), areaName);
  });

  return uniqueAreas.size === 1
    ? Array.from(uniqueAreas.values())[0]
    : '';
}

/**
 * Records can carry the same project name in different letter case (a typed
 * update, an imported schedule). Pick one spelling per project: the selected
 * project's display name when it matches, otherwise the most common spelling.
 */
function withCanonicalProjectNames(
  input: PIEReportDraftInput,
  evidence: PIEReportSourceEvidence[],
): PIEReportSourceEvidence[] {
  const counts = new Map<string, Map<string, number>>();
  evidence.forEach(item => {
    const key = normalizeName(item.projectName);
    if (!key) return;
    const spellings = counts.get(key) || new Map<string, number>();
    const spelling = item.projectName.trim();
    spellings.set(spelling, (spellings.get(spelling) || 0) + 1);
    counts.set(key, spellings);
  });
  const canonical = new Map<string, string>();
  counts.forEach((spellings, key) => {
    const selected = (input.selectedProjectNames || [])
      .map(name => name.trim())
      .find(name => normalizeName(name) === key);
    if (selected) {
      canonical.set(key, selected);
      return;
    }
    const best = Array.from(spellings.entries()).sort((a, b) => b[1] - a[1])[0];
    canonical.set(key, best[0]);
  });
  return evidence.map(item => {
    const name = canonical.get(normalizeName(item.projectName));
    if (!name || name === item.projectName) return item;
    return { ...item, projectName: name };
  });
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
  area: PIEWorkAreaUnderstanding,
  madeFrom: ReadonlyMap<string, ReportLineMadeFrom>,
): Readonly<{ lines: PIEReportBullet[]; uncited: PIEReportImageReference[] }> {
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
  // Open item 4.87: an area with no progress line cites its photos on a line
  // of their own, after its problems and requests; where those already fill
  // the area's three lines, that line was cut and the photos, numbered and
  // attached, were cited nowhere. They are cited on the area's first line.
  // Open item 7.62: each on the first of those lines that is the photo's own;
  // a photo none of them is the photo's own keeps a line of its own.
  const citation = bullets.find(bullet => bullet.kind === 'image_reference');
  const uncited: PIEReportImageReference[] = [];
  if (citation && selected.length > 0 && !selected.includes(citation)) {
    const onLine = new Map<number, PIEReportImageReference[]>();
    area.imageReferences.forEach(reference => {
      const at = selected.findIndex(line => lineIsOfPhoto(area, madeFrom.get(line.id), reference));
      if (at >= 0) onLine.set(at, [...(onLine.get(at) ?? []), reference]);
      else uncited.push(reference);
    });
    onLine.forEach((references, at) => {
      selected[at] = withCitation(selected[at], references);
    });
  }

  return { lines: selected, uncited };
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

  // Leave ALL-CAPS schedule names and acronyms alone ("INSTALL", "RFI").
  if (/^[A-Z][A-Z0-9]/.test(text)) return text;

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
