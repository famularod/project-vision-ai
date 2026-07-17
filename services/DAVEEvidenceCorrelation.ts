import type {
  DAVECompletionEvidenceKind,
  DAVECompletionVerificationStatus,
  ProjectUpdate,
  ScheduleItem,
  UpdatePhoto,
} from '../types';

export const DAVE_EVIDENCE_CORRELATION_VERSION = 'dave-evidence-correlation/1.0' as const;

export type DAVECorrelatedEvidenceKind =
  | 'schedule'
  | 'email'
  | 'message_screenshot'
  | 'field_update'
  | 'photo'
  | 'pm_confirmation'
  | 'pm_note';

export type DAVEEvidenceStance =
  | 'complete'
  | 'in_progress'
  | 'not_complete'
  | 'unknown';

export type DAVEEvidenceAuthority =
  | 'schedule'
  | 'reported'
  | 'observed'
  | 'verified';

export type DAVETaskEvidenceClaim = Readonly<{
  id: string;
  kind: DAVECorrelatedEvidenceKind;
  sourceRecordId: string;
  stance: DAVEEvidenceStance;
  authority: DAVEEvidenceAuthority;
  summary: string;
  recordedAt: string | null;
}>;

export type DAVETaskCorrelationConclusion =
  | 'verified_complete'
  | 'completion_supported'
  | 'completion_reported'
  | 'progress_observed'
  | 'not_complete'
  | 'conflicting_evidence'
  | 'schedule_only';

export type DAVETaskEvidenceCorrelation = Readonly<{
  taskId: string;
  taskName: string;
  areaName: string | null;
  conclusion: DAVETaskCorrelationConclusion;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  evidence: readonly DAVETaskEvidenceClaim[];
  corroboratingEvidenceIds: readonly string[];
  contradiction: string | null;
  needsVerification: boolean;
  requestedAction: string | null;
}>;

export type DAVEEvidenceCorrelationResult = Readonly<{
  version: typeof DAVE_EVIDENCE_CORRELATION_VERSION;
  generatedAt: string;
  tasks: readonly DAVETaskEvidenceCorrelation[];
  evidenceCount: number;
  multiSourceTaskCount: number;
  conflictCount: number;
  verificationCount: number;
}>;

export function buildDAVEEvidenceCorrelations({
  scheduleItems,
  updates = [],
  now = new Date().toISOString(),
}: {
  scheduleItems: readonly ScheduleItem[];
  updates?: readonly ProjectUpdate[];
  now?: string;
}): DAVEEvidenceCorrelationResult {
  const generatedAt = validTimestamp(now) ? new Date(now).toISOString() : new Date().toISOString();
  const tasks = scheduleItems.map(item => correlateTask(
    item,
    updates.filter(update => updateMatchesTask(update, item, scheduleItems)),
  ));

  return deepFreeze({
    version: DAVE_EVIDENCE_CORRELATION_VERSION,
    generatedAt,
    tasks,
    evidenceCount: tasks.reduce((total, item) => total + item.evidence.length, 0),
    multiSourceTaskCount: tasks.filter(item => new Set(item.evidence.map(evidence => evidence.kind)).size > 1).length,
    conflictCount: tasks.filter(item => item.conclusion === 'conflicting_evidence').length,
    verificationCount: tasks.filter(item => item.needsVerification).length,
  });
}

function correlateTask(
  item: ScheduleItem,
  updates: readonly ProjectUpdate[],
): DAVETaskEvidenceCorrelation {
  const evidence: DAVETaskEvidenceClaim[] = [scheduleClaim(item)];
  const verification = item.completionVerification;
  const pmScheduleJudgment = item.progressSource === 'project_manager';

  for (const source of verification?.evidence ?? []) {
    const isPMEvidence = source.kind === 'pm_confirmation' || source.kind === 'pm_note';
    evidence.push({
      id: source.id,
      kind: source.kind,
      sourceRecordId: source.sourceRecordId,
      stance: completionEvidenceStance(source.kind, verification?.status),
      authority: isPMEvidence ? 'verified' : 'reported',
      summary: source.summary,
      recordedAt: isPMEvidence && verification?.status === 'pm_verified'
        ? verification.verifiedAt || source.recordedAt
        : source.recordedAt,
    });
  }

  if (verification?.status === 'pm_verified' || verification?.status === 'rejected') {
    const accepted = verification.status === 'pm_verified';
    evidence.push({
      id: `correlation:pm-decision:${item.id}:${verification.status}`,
      kind: 'pm_confirmation',
      sourceRecordId: item.id,
      stance: accepted ? 'complete' : 'not_complete',
      authority: 'verified',
      summary: verification.verificationNote?.trim() || (accepted
        ? `${verification.verifiedBy || 'Project manager'} confirmed the task complete.`
        : `${verification.verifiedBy || 'Project manager'} rejected the completion claim.`),
      recordedAt: verification.verifiedAt || verification.reportedAt || null,
    });
  }

  for (const update of updates) {
    const noteStance = textStance(update.notes);
    if (update.notes.trim()) {
      evidence.push({
        id: `correlation:update:${update.id}`,
        kind: 'field_update',
        sourceRecordId: update.id,
        stance: noteStance,
        authority: 'verified',
        summary: update.notes.trim(),
        recordedAt: update.date || null,
      });
    }
    for (const photo of update.photos) {
      evidence.push(photoClaim(update, photo));
    }
  }

  const uniqueEvidence = uniqueBy(evidence, value => value.id);
  const rejected = verification?.status === 'rejected';
  const explicitConflict = verification?.status === 'conflicting_evidence';
  const completionReported = verification?.status === 'reported_complete';
  const completionSupported = verification?.status === 'evidence_supported';
  const reportedComplete = uniqueEvidence.some(claim => claim.authority === 'reported' && claim.stance === 'complete');
  const latestPMJudgment = latestClaim(uniqueEvidence.filter(claim =>
    claim.authority === 'verified' && claim.stance !== 'unknown',
  ));
  const directPMComplete = latestPMJudgment?.stance === 'complete';
  const directPMProgress = latestPMJudgment?.stance === 'in_progress';
  const directPMNotComplete = latestPMJudgment?.stance === 'not_complete';
  const reportedNotComplete = uniqueEvidence.some(claim => claim.authority !== 'schedule' && claim.stance === 'not_complete');
  const contradictionAfterVerification = directPMComplete && Boolean(latestPMJudgment?.recordedAt) && uniqueEvidence.some(claim =>
    claim.authority !== 'verified' &&
    claim.stance === 'not_complete' &&
    isAfter(claim.recordedAt, latestPMJudgment?.recordedAt || null),
  );
  const contradictionAfterPMJudgment = directPMComplete && Boolean(item.progressConfirmedAt) && uniqueEvidence.some(claim =>
    claim.authority !== 'verified' &&
    claim.stance === 'not_complete' &&
    isAfter(claim.recordedAt, item.progressConfirmedAt || null),
  );
  const observedProgress = uniqueEvidence.some(claim => claim.authority === 'observed' && claim.stance === 'in_progress');
  const scheduleClaimsComplete = item.status === 'Complete' || item.percentComplete >= 100;
  const scheduleClaimsNotStarted = item.status === 'Not Started' && item.percentComplete === 0;

  let conclusion: DAVETaskCorrelationConclusion = 'schedule_only';
  let confidence: DAVETaskEvidenceCorrelation['confidence'] = 'medium';
  let explanation = `The schedule records ${item.status.toLowerCase()} at ${item.percentComplete}% complete.`;
  let contradiction: string | null = null;
  let needsVerification = false;
  let requestedAction: string | null = null;

  if (contradictionAfterVerification || contradictionAfterPMJudgment) {
    conclusion = 'conflicting_evidence';
    confidence = 'high';
    contradiction = 'Newer field evidence reports unfinished or changed work after the task was previously PM verified.';
    explanation = contradiction;
    needsVerification = true;
    requestedAction = 'Reinspect the changed condition and confirm whether the task must be reopened.';
  } else if (directPMComplete) {
    conclusion = 'verified_complete';
    confidence = 'high';
    explanation = 'A project manager stated that the work was completed. That statement is the authoritative completion evidence.';
  } else if (directPMNotComplete || rejected) {
    conclusion = 'not_complete';
    confidence = 'high';
    explanation = directPMNotComplete
      ? 'A project manager stated that the work is not complete. That statement is the authoritative current-condition evidence.'
      : 'The completion claim was reviewed and rejected; the prior schedule status remains authoritative.';
    needsVerification = false;
    requestedAction = null;
  } else if (directPMProgress || pmScheduleJudgment) {
    conclusion = 'schedule_only';
    confidence = 'high';
    explanation = `A project manager recorded ${item.status.toLowerCase()} at ${item.percentComplete}% complete. That professional judgment is the current progress evidence.`;
    needsVerification = false;
    requestedAction = null;
  } else if (explicitConflict || (reportedComplete && reportedNotComplete)) {
    conclusion = 'conflicting_evidence';
    confidence = 'high';
    contradiction = 'One source reports completion while another source reports unfinished or remaining work.';
    explanation = contradiction;
    needsVerification = true;
    requestedAction = 'Inspect the work or obtain a current verification photo, then confirm or reject completion.';
  } else if (scheduleClaimsComplete) {
    conclusion = 'conflicting_evidence';
    confidence = 'high';
    contradiction = 'The task is marked complete without PM verification or connected completion evidence.';
    explanation = contradiction;
    needsVerification = true;
    requestedAction = 'Confirm completion in the field or attach evidence and identify the verifier.';
  } else if (reportedNotComplete) {
    conclusion = 'not_complete';
    confidence = 'medium';
    explanation = 'A field source reports unfinished or remaining work.';
    needsVerification = true;
    requestedAction = 'Confirm the remaining scope and correct the current percent complete.';
  } else if (completionSupported) {
    conclusion = 'completion_supported';
    confidence = 'medium';
    explanation = 'Multiple sources support completion, but no project manager has verified it.';
    needsVerification = true;
    requestedAction = 'Review the supporting evidence and confirm or reject completion.';
  } else if (completionReported || reportedComplete) {
    conclusion = 'completion_reported';
    confidence = 'medium';
    explanation = observedProgress
      ? 'Completion was reported and visual evidence supports progress, but the evidence does not independently prove completion.'
      : 'Completion was reported by a communication or field source but has not been verified.';
    needsVerification = true;
    requestedAction = 'Confirm in the field, attach a current photo, or reject the completion report.';
  } else if (observedProgress && scheduleClaimsNotStarted) {
    conclusion = 'conflicting_evidence';
    confidence = 'medium';
    contradiction = 'Photo evidence shows visible progress while the schedule still says not started.';
    explanation = contradiction;
    needsVerification = true;
    requestedAction = 'Review the photo and update the schedule status and percent complete.';
  } else if (observedProgress) {
    conclusion = 'progress_observed';
    confidence = 'medium';
    explanation = 'Current visual evidence supports visible progress and is connected to this schedule task.';
  } else if (uniqueEvidence.length === 1) {
    confidence = 'low';
    explanation = `${explanation} No connected field, photo, or communication evidence is available.`;
  }

  return deepFreeze({
    taskId: item.id,
    taskName: item.taskName,
    areaName: clean(item.locationName),
    conclusion,
    confidence,
    explanation,
    evidence: uniqueEvidence,
    corroboratingEvidenceIds: uniqueEvidence
      .filter(claim => claim.kind !== 'schedule')
      .map(claim => claim.id),
    contradiction,
    needsVerification,
    requestedAction,
  });
}

function scheduleClaim(item: ScheduleItem): DAVETaskEvidenceClaim {
  const pmJudgment = item.progressSource === 'project_manager';
  return {
    id: `correlation:schedule:${item.id}`,
    kind: pmJudgment ? 'pm_confirmation' : 'schedule',
    sourceRecordId: item.id,
    stance: item.status === 'Complete' || item.percentComplete >= 100
      ? 'complete'
      : item.status === 'Not Started' && item.percentComplete === 0
        ? 'not_complete'
        : 'in_progress',
    authority: pmJudgment ? 'verified' : 'schedule',
    summary: pmJudgment
      ? `${item.progressConfirmedBy || 'Project manager'} recorded ${item.taskName} as ${item.status}, ${item.percentComplete}% complete.`
      : `${item.taskName}: ${item.status}, ${item.percentComplete}% complete.`,
    recordedAt: item.progressConfirmedAt || item.importedAt || item.createdAt || null,
  };
}

function photoClaim(update: ProjectUpdate, photo: UpdatePhoto): DAVETaskEvidenceClaim {
  const intelligence = photo.photoIntelligence;
  const visuallyGrounded = intelligence?.provenance === 'visual_only' ||
    intelligence?.provenance === 'visual_and_caption';
  const progressSupported = visuallyGrounded && intelligence?.projectProgress === 'supported';
  const summary = clean(intelligence?.currentObservation) ||
    clean(intelligence?.changedFromPrior) ||
    clean(intelligence?.visibleChange) ||
    clean(photo.caption) ||
    'A task-connected field photo is available.';
  return {
    id: `correlation:photo:${photo.id}`,
    kind: 'photo',
    sourceRecordId: photo.id,
    stance: progressSupported ? 'in_progress' : 'unknown',
    authority: 'observed',
    summary,
    recordedAt: intelligence?.updatedAt || photo.locationCapturedAt || update.date || null,
  };
}

function updateMatchesTask(
  update: ProjectUpdate,
  task: ScheduleItem,
  scheduleItems: readonly ScheduleItem[],
) {
  if (update.scheduleItemId) return update.scheduleItemId === task.id;
  const updateTaskKey = normalizedKey(update.scheduleTaskName || '');
  if (!updateTaskKey || updateTaskKey !== normalizedKey(task.taskName)) return false;

  const possibleTasks = scheduleItems.filter(candidate =>
    normalizedKey(candidate.taskName) === updateTaskKey &&
    compatibleContext(candidate.projectName || candidate.scheduleProjectName || '', update.projectName) &&
    compatibleContext(candidate.locationName, update.selectedAreaName || ''),
  );
  return possibleTasks.length === 1 && possibleTasks[0].id === task.id;
}

function completionEvidenceStance(
  kind: DAVECompletionEvidenceKind,
  status: DAVECompletionVerificationStatus | undefined,
): DAVEEvidenceStance {
  if ((kind === 'pm_confirmation' || kind === 'pm_note') && status === 'rejected') return 'not_complete';
  if (kind === 'email' || kind === 'message_screenshot' || status === 'pm_verified') return 'complete';
  return 'unknown';
}

function textStance(value: string): DAVEEvidenceStance {
  const text = value.toLowerCase();
  if (!text.trim()) return 'unknown';
  if (/\b(?:will|expected|scheduled|planned|targeted|should|forecast|anticipated)\b.{0,32}\b(?:done|complete|completed|finished)\b/i.test(text)) {
    return 'unknown';
  }
  if (/\b(?:not|isn['’]?t|wasn['’]?t|remain(?:s|ing)?|unfinished|incomplete|pending)\b.{0,24}\b(?:done|complete|completed|finished|work|scope)?\b/i.test(text)) {
    return 'not_complete';
  }
  if (/\b(?:done|complete|completed|finished|installed and operational)\b/i.test(text)) return 'complete';
  if (/\b(?:started|working|in progress|underway|installed|placed|poured|framed)\b/i.test(text)) return 'in_progress';
  return 'unknown';
}

function compatibleContext(left: string, right: string) {
  const leftKey = normalizedKey(left);
  const rightKey = normalizedKey(right);
  return !leftKey || !rightKey || leftKey === rightKey;
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/\b(building|project|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function clean(value: string | null | undefined) {
  const next = value?.trim();
  return next || null;
}

function validTimestamp(value: string) {
  return Boolean(value.trim()) && Number.isFinite(new Date(value).getTime());
}

function isAfter(left: string | null, right: string | null) {
  if (!left || !right || !validTimestamp(left) || !validTimestamp(right)) return false;
  return new Date(left).getTime() > new Date(right).getTime();
}

function latestClaim(claims: readonly DAVETaskEvidenceClaim[]) {
  return claims.reduce<DAVETaskEvidenceClaim | null>((latest, claim) => {
    if (!latest) return claim;
    const latestTime = latest.recordedAt && validTimestamp(latest.recordedAt)
      ? new Date(latest.recordedAt).getTime()
      : null;
    const claimTime = claim.recordedAt && validTimestamp(claim.recordedAt)
      ? new Date(claim.recordedAt).getTime()
      : null;
    if (claimTime !== null && latestTime !== null) return claimTime >= latestTime ? claim : latest;
    if (claimTime !== null) return claim;
    if (latestTime !== null) return latest;
    return claim;
  }, null);
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter(value => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  Object.values(value as object).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}
