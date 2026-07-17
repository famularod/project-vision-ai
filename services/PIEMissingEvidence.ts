import type { PIEEvidenceQualityResult } from './PIEEvidenceQuality';

export type PIEMissingEvidenceType =
  | 'missing_photo'
  | 'missing_current_photo'
  | 'missing_location'
  | 'missing_schedule'
  | 'missing_owner'
  | 'missing_decision'
  | 'missing_inspection_status'
  | 'missing_safety_confirmation'
  | 'missing_progress_note'
  | 'missing_document'
  | 'missing_report_review'
  | 'missing_user_confirmation';

export type PIEMissingEvidencePriority =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low';

export type PIEMissingEvidenceImpact = {
  decisionAffected: string;
  understandingImpact: string;
  recommendationImpact: string;
  reportImpact: string;
  severity: PIEMissingEvidencePriority;
};

export type PIEMissingEvidenceReason = {
  id: string;
  summary: string;
  source:
    | 'Evidence Quality'
    | 'Runtime'
    | 'Schedule'
    | 'Photo'
    | 'GPS'
    | 'Report'
    | 'Safety'
    | 'User Confirmation';
};

export type PIEMissingEvidenceRequest = {
  id: string;
  type: PIEMissingEvidenceType;
  request: string;
  minimumEvidence: string;
  suggestedCaptureAction: string;
  projectName: string | null;
  areaName: string | null;
  priority: PIEMissingEvidencePriority;
  uncertaintyReduction: number;
};

export type PIEMissingEvidenceItem = {
  id: string;
  type: PIEMissingEvidenceType;
  title: string;
  summary: string;
  whyItMatters: string;
  decisionAffected: string;
  smallestEvidenceRequest: string;
  nextCaptureAction: string;
  priority: PIEMissingEvidencePriority;
  impact: PIEMissingEvidenceImpact;
  reasons: PIEMissingEvidenceReason[];
  uncertaintyReduction: number;
};

export type PIEMissingEvidenceResult = {
  generatedAt: string;
  summary: string;
  items: PIEMissingEvidenceItem[];
  prioritizedItems: PIEMissingEvidenceItem[];
  requests: PIEMissingEvidenceRequest[];
  minimumEvidenceNeeded: PIEMissingEvidenceRequest[];
  highestImpactEvidenceGap: PIEMissingEvidenceItem | null;
  uncertaintyReductionActions: string[];
  totalEstimatedUncertaintyReduction: number;
};

export type PIEMissingEvidenceInput = {
  projectName?: string | null;
  areaName?: string | null;
  currentTask?: string | null;
  schedulePriority?: string | null;
  reportNeedsReview?: boolean;
  needsUserConfirmation?: boolean;
  hasAnyPhoto?: boolean;
  hasCurrentPhoto?: boolean;
  hasLocation?: boolean;
  hasSchedule?: boolean;
  hasOwner?: boolean;
  hasDecision?: boolean;
  hasInspectionStatus?: boolean;
  hasSafetyConfirmation?: boolean;
  hasProgressNote?: boolean;
  hasDocument?: boolean;
  hasReportReview?: boolean;
  evidenceQuality?: PIEEvidenceQualityResult | null;
  runtimeEvidenceGaps?: string[];
  recommendedEvidence?: string[];
};

// Contract: What evidence is missing? Why does it matter? What decision does it affect?
// Return the smallest evidence request and next capture action that reduce uncertainty.
export function findMissingEvidence(
  input: PIEMissingEvidenceInput,
  generatedAt: string = new Date().toISOString(),
): PIEMissingEvidenceResult {
  const items = [
    missingWhen(!input.hasAnyPhoto, buildPhotoGap(input, 'missing_photo')),
    missingWhen(!input.hasCurrentPhoto, buildPhotoGap(input, 'missing_current_photo')),
    missingWhen(!input.hasLocation, buildLocationGap(input)),
    missingWhen(!input.hasSchedule, buildScheduleGap(input)),
    missingWhen(!input.hasOwner, buildOwnerGap(input)),
    missingWhen(!input.hasDecision, buildDecisionGap(input)),
    missingWhen(!input.hasInspectionStatus, buildInspectionGap(input)),
    missingWhen(!input.hasSafetyConfirmation, buildSafetyGap(input)),
    missingWhen(!input.hasProgressNote, buildProgressNoteGap(input)),
    missingWhen(!input.hasDocument, buildDocumentGap(input)),
    missingWhen(Boolean(input.reportNeedsReview) && !input.hasReportReview, buildReportReviewGap(input)),
    missingWhen(Boolean(input.needsUserConfirmation), buildUserConfirmationGap(input)),
    ...qualityDrivenGaps(input),
    ...runtimeDrivenGaps(input),
  ].filter((item): item is PIEMissingEvidenceItem => Boolean(item));
  const prioritizedItems = prioritizeMissingEvidence(items);
  const requests = buildEvidenceRequests(prioritizedItems);
  const minimumEvidenceNeeded = identifyMinimumEvidenceNeeded(prioritizedItems);

  return {
    generatedAt,
    summary: summarizeMissingEvidence(prioritizedItems),
    items,
    prioritizedItems,
    requests,
    minimumEvidenceNeeded,
    highestImpactEvidenceGap: prioritizedItems[0] || null,
    uncertaintyReductionActions: requests.map(request => request.suggestedCaptureAction),
    totalEstimatedUncertaintyReduction: Math.min(
      100,
      minimumEvidenceNeeded.reduce(
        (total, request) => total + request.uncertaintyReduction,
        0,
      ),
    ),
  };
}

export function prioritizeMissingEvidence(
  items: PIEMissingEvidenceItem[],
): PIEMissingEvidenceItem[] {
  return [...items].sort(
    (left, right) =>
      priorityScore(right.priority) - priorityScore(left.priority) ||
      right.uncertaintyReduction - left.uncertaintyReduction,
  );
}

export function buildEvidenceRequests(
  items: PIEMissingEvidenceItem[],
): PIEMissingEvidenceRequest[] {
  return prioritizeMissingEvidence(items).map(item => ({
    id: `request-${item.id}`,
    type: item.type,
    request: item.smallestEvidenceRequest,
    minimumEvidence: item.smallestEvidenceRequest,
    suggestedCaptureAction: item.nextCaptureAction,
    projectName: projectFromItem(item),
    areaName: areaFromItem(item),
    priority: item.priority,
    uncertaintyReduction: item.uncertaintyReduction,
  }));
}

export function identifyMinimumEvidenceNeeded(
  items: PIEMissingEvidenceItem[],
): PIEMissingEvidenceRequest[] {
  const prioritized = prioritizeMissingEvidence(items);
  const selected: PIEMissingEvidenceItem[] = [];
  const seenTypes = new Set<PIEMissingEvidenceType>();

  for (const item of prioritized) {
    if (selected.length >= 3) break;
    if (seenTypes.has(item.type)) continue;
    selected.push(item);
    seenTypes.add(item.type);
    if (selected.reduce((total, next) => total + next.uncertaintyReduction, 0) >= 55) break;
  }

  return buildEvidenceRequests(selected);
}

export function estimateUncertaintyReduction(
  item: PIEMissingEvidenceItem,
): number {
  return item.uncertaintyReduction;
}

export function summarizeMissingEvidence(
  items: PIEMissingEvidenceItem[],
): string {
  if (items.length === 0) return 'No blocking evidence gaps detected.';
  const highest = prioritizeMissingEvidence(items)[0];
  return `${items.length} evidence gap${items.length === 1 ? '' : 's'} detected. Highest priority: ${highest.smallestEvidenceRequest}`;
}

function buildPhotoGap(
  input: PIEMissingEvidenceInput,
  type: 'missing_photo' | 'missing_current_photo',
): PIEMissingEvidenceItem {
  const area = input.areaName || input.schedulePriority || 'the priority work area';
  const current = type === 'missing_current_photo';

  return buildItem({
    input,
    type,
    title: current ? 'Current photo needed' : 'Photo evidence needed',
    summary: current
      ? `There is no current photo for ${area}.`
      : `There is no photo evidence for ${area}.`,
    whyItMatters: 'A photo is the fastest way to verify actual field progress before strengthening recommendations or report language.',
    decisionAffected: 'Inspection readiness and progress reporting.',
    smallestEvidenceRequest: `Need one current photo of ${area} to verify progress.`,
    nextCaptureAction: `Capture one current photo for ${area}.`,
    priority: current ? 'high' : 'medium',
    uncertaintyReduction: current ? 28 : 22,
    source: 'Photo',
  });
}

function buildLocationGap(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem {
  return buildItem({
    input,
    type: 'missing_location',
    title: 'Location confirmation needed',
    summary: 'There is not enough location context to trust the project or area assignment.',
    whyItMatters: 'Location affects project history, schedule matching, recommendations, and report grouping.',
    decisionAffected: 'Project and area assignment.',
    smallestEvidenceRequest: 'Confirm the current project and area.',
    nextCaptureAction: 'Confirm or correct the project and area before capture.',
    priority: 'high',
    uncertaintyReduction: 24,
    source: 'GPS',
  });
}

function buildScheduleGap(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem {
  return buildItem({
    input,
    type: 'missing_schedule',
    title: 'Schedule evidence needed',
    summary: 'There is no usable current schedule.',
    whyItMatters: 'Schedule evidence determines overdue work, upcoming work, critical activities, and walk priority.',
    decisionAffected: 'Schedule risk and next area to inspect.',
    smallestEvidenceRequest: 'Import or confirm the current project schedule.',
    nextCaptureAction: 'Add the current schedule or confirm that no schedule is available.',
    priority: 'high',
    uncertaintyReduction: 25,
    source: 'Schedule',
  });
}

function buildOwnerGap(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem {
  return buildItem({
    input,
    type: 'missing_owner',
    title: 'Owner needed',
    summary: 'Work or an action item does not have a clear owner.',
    whyItMatters: 'Reports and recommendations are weaker when responsibility is unclear.',
    decisionAffected: 'Action assignment.',
    smallestEvidenceRequest: 'Identify the owner for the open work or action item.',
    nextCaptureAction: 'Add the responsible owner or contractor.',
    priority: 'medium',
    uncertaintyReduction: 16,
    source: 'Runtime',
  });
}

function buildDecisionGap(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem {
  return buildItem({
    input,
    type: 'missing_decision',
    title: 'Decision needed',
    summary: 'Evidence points to a decision, but the decision is not confirmed.',
    whyItMatters: 'Recommendations should not be presented as settled while a user decision is still open.',
    decisionAffected: 'Approve, defer, or collect more evidence.',
    smallestEvidenceRequest: 'Confirm the decision or mark that more evidence is needed.',
    nextCaptureAction: 'Confirm the decision status.',
    priority: 'high',
    uncertaintyReduction: 22,
    source: 'User Confirmation',
  });
}

function buildInspectionGap(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem {
  return buildItem({
    input,
    type: 'missing_inspection_status',
    title: 'Inspection status needed',
    summary: 'Inspection readiness has not been verified.',
    whyItMatters: 'Inspection status changes schedule risk, field priority, and executive summary wording.',
    decisionAffected: 'Inspection readiness.',
    smallestEvidenceRequest: 'Confirm inspection status for the priority area.',
    nextCaptureAction: 'Add inspection status or capture the evidence needed to verify it.',
    priority: 'medium',
    uncertaintyReduction: 18,
    source: 'Schedule',
  });
}

function buildSafetyGap(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem {
  return buildItem({
    input,
    type: 'missing_safety_confirmation',
    title: 'Safety confirmation needed',
    summary: 'Safety confirmation is needed before the area is treated as clear.',
    whyItMatters: 'Safety uncertainty should block confident recommendations and report language.',
    decisionAffected: 'Safety readiness.',
    smallestEvidenceRequest: 'Confirm whether safety concerns are present or resolved.',
    nextCaptureAction: 'Add a safety observation or confirm no safety concern is present.',
    priority: 'critical',
    uncertaintyReduction: 30,
    source: 'Safety',
  });
}

function buildProgressNoteGap(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem {
  const area = input.areaName || 'the priority area';
  return buildItem({
    input,
    type: 'missing_progress_note',
    title: 'Progress note needed',
    summary: `A short progress note is needed for ${area}.`,
    whyItMatters: 'A short note explains what the photo means and improves report wording.',
    decisionAffected: 'Progress interpretation.',
    smallestEvidenceRequest: `Add one short note about current progress at ${area}.`,
    nextCaptureAction: `Add one progress note for ${area}.`,
    priority: 'medium',
    uncertaintyReduction: 14,
    source: 'Runtime',
  });
}

function buildDocumentGap(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem {
  return buildItem({
    input,
    type: 'missing_document',
    title: 'Document evidence needed',
    summary: 'The supporting document needed for this item is missing.',
    whyItMatters: 'Document support is needed when photos or notes are not enough to verify scope, schedule, or decision context.',
    decisionAffected: 'Document-backed verification.',
    smallestEvidenceRequest: 'Attach or confirm the supporting document.',
    nextCaptureAction: 'Upload the supporting document if available.',
    priority: 'low',
    uncertaintyReduction: 10,
    source: 'Runtime',
  });
}

function buildReportReviewGap(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem {
  return buildItem({
    input,
    type: 'missing_report_review',
    title: 'Report review needed',
    summary: 'Report content still needs user review.',
    whyItMatters: 'Communication must be reviewed before copy or email.',
    decisionAffected: 'Report approval.',
    smallestEvidenceRequest: 'Review and approve or correct the report draft.',
    nextCaptureAction: 'Review the report draft.',
    priority: 'medium',
    uncertaintyReduction: 15,
    source: 'Report',
  });
}

function buildUserConfirmationGap(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem {
  return buildItem({
    input,
    type: 'missing_user_confirmation',
    title: 'User confirmation needed',
    summary: 'Confirmation is needed before treating this understanding as reliable.',
    whyItMatters: 'User confirmation prevents uncertain evidence from being overstated.',
    decisionAffected: 'Confidence and recommendation readiness.',
    smallestEvidenceRequest: 'Confirm, correct, or reject the current understanding.',
    nextCaptureAction: 'Confirm or correct the current understanding.',
    priority: 'medium',
    uncertaintyReduction: 18,
    source: 'User Confirmation',
  });
}

function qualityDrivenGaps(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem[] {
  const quality = input.evidenceQuality;
  if (!quality) return [];

  return [
    ...quality.staleEvidence.slice(0, 2).map((item, index) =>
      buildItem({
        input,
        type: 'missing_current_photo',
        title: 'Stale evidence needs refresh',
        summary: item.evidence.summary,
        whyItMatters: 'Stale evidence should be refreshed before recommendations are strengthened.',
        decisionAffected: 'Current understanding.',
        smallestEvidenceRequest: `Capture one current update to refresh: ${item.evidence.summary}`,
        nextCaptureAction: 'Capture current evidence for this item.',
        priority: index === 0 ? 'high' : 'medium',
        uncertaintyReduction: 20 - index * 4,
        source: 'Evidence Quality',
      }),
    ),
    ...quality.weakEvidence.slice(0, 2).map((item, index) =>
      buildItem({
        input,
        type: item.completeness.missing.includes('supporting photo')
          ? 'missing_photo'
          : 'missing_user_confirmation',
        title: 'Weak evidence needs verification',
        summary: item.evidence.summary,
        whyItMatters: 'Weak evidence limits confidence in recommendations and report language.',
        decisionAffected: 'Recommendation confidence.',
        smallestEvidenceRequest: item.completeness.missing.includes('supporting photo')
          ? `Need one supporting photo for: ${item.evidence.summary}`
          : `Confirm or correct: ${item.evidence.summary}`,
        nextCaptureAction: item.completeness.missing.includes('supporting photo')
          ? 'Capture a supporting photo.'
          : 'Confirm or correct the evidence.',
        priority: index === 0 ? 'medium' : 'low',
        uncertaintyReduction: 16 - index * 3,
        source: 'Evidence Quality',
      }),
    ),
  ];
}

function runtimeDrivenGaps(input: PIEMissingEvidenceInput): PIEMissingEvidenceItem[] {
  return [
    ...(input.runtimeEvidenceGaps || []),
    ...(input.recommendedEvidence || []),
  ].slice(0, 4).map((gap, index) =>
    buildItem({
      input,
      type: inferMissingType(gap),
      title: 'Runtime evidence gap',
      summary: gap,
      whyItMatters: 'Runtime already identified this as limiting stronger understanding.',
      decisionAffected: 'Recommendation readiness.',
      smallestEvidenceRequest: minimumRequestForGap(gap, input),
      nextCaptureAction: minimumRequestForGap(gap, input),
      priority: index === 0 ? 'medium' : 'low',
      uncertaintyReduction: 14 - index * 2,
      source: 'Runtime',
    }),
  );
}

function buildItem(config: {
  input: PIEMissingEvidenceInput;
  type: PIEMissingEvidenceType;
  title: string;
  summary: string;
  whyItMatters: string;
  decisionAffected: string;
  smallestEvidenceRequest: string;
  nextCaptureAction: string;
  priority: PIEMissingEvidencePriority;
  uncertaintyReduction: number;
  source: PIEMissingEvidenceReason['source'];
}): PIEMissingEvidenceItem {
  return {
    id: `missing-${config.type}-${normalizeId(config.title)}`,
    type: config.type,
    title: config.title,
    summary: config.summary,
    whyItMatters: config.whyItMatters,
    decisionAffected: config.decisionAffected,
    smallestEvidenceRequest: config.smallestEvidenceRequest,
    nextCaptureAction: config.nextCaptureAction,
    priority: config.priority,
    impact: {
      decisionAffected: config.decisionAffected,
      understandingImpact: config.whyItMatters,
      recommendationImpact: 'Recommendation confidence should remain reduced until this evidence is supplied.',
      reportImpact: 'Report wording should mark this item as Needs Review if it remains unresolved.',
      severity: config.priority,
    },
    reasons: [{
      id: `reason-${config.type}`,
      summary: config.summary,
      source: config.source,
    }],
    uncertaintyReduction: config.uncertaintyReduction,
  };
}

function missingWhen(
  condition: boolean,
  item: PIEMissingEvidenceItem,
) {
  return condition ? item : null;
}

function inferMissingType(gap: string): PIEMissingEvidenceType {
  if (/current photo|recent photo|photo/i.test(gap)) return 'missing_current_photo';
  if (/location|gps|area|project/i.test(gap)) return 'missing_location';
  if (/schedule|critical|overdue/i.test(gap)) return 'missing_schedule';
  if (/owner|contractor|assigned/i.test(gap)) return 'missing_owner';
  if (/decision|approve|approval/i.test(gap)) return 'missing_decision';
  if (/inspection/i.test(gap)) return 'missing_inspection_status';
  if (/safety/i.test(gap)) return 'missing_safety_confirmation';
  if (/document|pdf|file/i.test(gap)) return 'missing_document';
  if (/report|review/i.test(gap)) return 'missing_report_review';
  if (/note|progress/i.test(gap)) return 'missing_progress_note';
  return 'missing_user_confirmation';
}

function minimumRequestForGap(
  gap: string,
  input: PIEMissingEvidenceInput,
) {
  const area = input.areaName || input.schedulePriority || 'the priority area';
  if (/photo/i.test(gap)) return `Need one current photo of ${area} to verify this item.`;
  if (/owner|contractor|assigned/i.test(gap)) return 'Identify the responsible owner or contractor.';
  if (/schedule/i.test(gap)) return 'Confirm or import the current schedule.';
  if (/decision|approval/i.test(gap)) return 'Confirm the decision or approval status.';
  if (/safety/i.test(gap)) return 'Confirm safety status.';
  if (/inspection/i.test(gap)) return 'Confirm inspection status.';
  if (/document|pdf|file/i.test(gap)) return 'Attach the supporting document.';
  if (/location|gps|area|project/i.test(gap)) return 'Confirm the project and area.';
  return gap;
}

function priorityScore(priority: PIEMissingEvidencePriority) {
  if (priority === 'critical') return 4;
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function projectFromItem(_item: PIEMissingEvidenceItem) {
  return null;
}

function areaFromItem(_item: PIEMissingEvidenceItem) {
  return null;
}

function normalizeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
