import type {
  DAVECompletionEvidence,
  DAVECompletionEvidenceKind,
  DAVECompletionVerification,
  DAVECompletionVerificationStatus,
  ScheduleItem,
  ScheduleStatus,
} from '../types';

export function createReportedCompletionVerification({
  sourceName,
  sourceRecordId,
  summary,
  reportedAt,
  reportedBy = null,
  priorScheduleStatus = 'Not Started',
  priorPercentComplete = 0,
}: {
  sourceName: string;
  sourceRecordId: string;
  summary: string;
  reportedAt: string;
  reportedBy?: string | null;
  priorScheduleStatus?: ScheduleStatus;
  priorPercentComplete?: number;
}): DAVECompletionVerification {
  const evidence = completionEvidence({
    kind: sourceName.toLowerCase().includes('email') ? 'email' : 'message_screenshot',
    sourceName,
    sourceRecordId,
    summary,
    recordedAt: reportedAt,
  });

  return freezeVerification({
    status: 'reported_complete',
    reportedAt,
    reportedBy: optional(reportedBy),
    priorScheduleStatus,
    priorPercentComplete: clampPercent(priorPercentComplete),
    verifiedAt: null,
    verifiedBy: null,
    verificationNote: null,
    evidence: [evidence],
  });
}

export function scheduleItemNeedsCompletionVerification(item: Pick<ScheduleItem, 'completionVerification'>) {
  const status = item.completionVerification?.status;
  return status === 'reported_complete' || status === 'evidence_supported' || status === 'conflicting_evidence';
}

export function scheduleCompletionVerificationLabel(item: Pick<ScheduleItem, 'completionVerification'>) {
  const status = item.completionVerification?.status;
  if (status === 'pm_verified') return 'Verified complete';
  if (status === 'rejected') return 'Completion report not confirmed';
  if (status === 'conflicting_evidence') return 'Conflicting evidence';
  if (status === 'evidence_supported') return 'Evidence supports completion';
  if (status === 'reported_complete') return 'Reported complete · Needs verification';
  return null;
}

export function verifyScheduleItemCompletion(
  item: ScheduleItem,
  {
    verifiedAt,
    verifiedBy,
    note = null,
  }: { verifiedAt: string; verifiedBy: string; note?: string | null },
): ScheduleItem {
  const current = requiredVerification(item);
  const cleanNote = optional(note);
  const evidence = [
    ...current.evidence,
    completionEvidence({
      kind: cleanNote ? 'pm_note' : 'pm_confirmation',
      sourceName: verifiedBy,
      sourceRecordId: item.id,
      summary: cleanNote || `${verifiedBy} confirmed the work was completed.`,
      recordedAt: verifiedAt,
    }),
  ];

  return {
    ...item,
    status: 'Complete',
    percentComplete: 100,
    completionVerification: freezeVerification({
      ...current,
      status: 'pm_verified',
      verifiedAt,
      verifiedBy: required(verifiedBy, 'Verifier'),
      verificationNote: cleanNote,
      evidence: uniqueEvidence(evidence),
    }),
  };
}

export function rejectScheduleItemCompletion(
  item: ScheduleItem,
  {
    rejectedAt,
    rejectedBy,
    note = null,
  }: { rejectedAt: string; rejectedBy: string; note?: string | null },
): ScheduleItem {
  const current = requiredVerification(item);
  const cleanNote = optional(note);
  const evidence = [
    ...current.evidence,
    completionEvidence({
      kind: cleanNote ? 'pm_note' : 'pm_confirmation',
      sourceName: rejectedBy,
      sourceRecordId: item.id,
      summary: cleanNote || `${rejectedBy} did not confirm the completion report.`,
      recordedAt: rejectedAt,
    }),
  ];

  return {
    ...item,
    status: current.priorScheduleStatus,
    percentComplete: current.priorPercentComplete,
    completionVerification: freezeVerification({
      ...current,
      status: 'rejected',
      verifiedAt: rejectedAt,
      verifiedBy: required(rejectedBy, 'Reviewer'),
      verificationNote: cleanNote,
      evidence: uniqueEvidence(evidence),
    }),
  };
}

export function mergeReportedCompletionClaim(
  scheduledItem: ScheduleItem,
  reportedItem: ScheduleItem,
): ScheduleItem {
  const claim = requiredVerification(reportedItem);
  const existing = scheduledItem.completionVerification;
  if (existing?.status === 'pm_verified') return scheduledItem;

  return {
    ...scheduledItem,
    completionVerification: freezeVerification({
      ...claim,
      priorScheduleStatus: scheduledItem.status,
      priorPercentComplete: scheduledItem.percentComplete,
      evidence: uniqueEvidence([...(existing?.evidence || []), ...claim.evidence]),
    }),
  };
}

export function findExactScheduleTaskForCompletionClaim(
  claim: ScheduleItem,
  scheduledItems: readonly ScheduleItem[],
): ScheduleItem | null {
  if (!scheduleItemNeedsCompletionVerification(claim)) return null;
  const taskKey = normalizedKey(claim.taskName);
  if (!taskKey) return null;

  const candidates = scheduledItems.filter(item => {
    if (normalizedKey(item.taskName) !== taskKey) return false;
    if (!compatibleContext(item.projectName, claim.projectName)) return false;
    if (!compatibleContext(item.locationName, claim.locationName)) return false;
    return true;
  });

  return candidates.length === 1 ? candidates[0] : null;
}

export function normalizeDAVECompletionVerification(value: unknown): DAVECompletionVerification | null {
  if (!isRecord(value)) return null;
  const statuses: DAVECompletionVerificationStatus[] = [
    'reported_complete', 'evidence_supported', 'pm_verified', 'rejected', 'conflicting_evidence',
  ];
  const scheduleStatuses: ScheduleStatus[] = ['Not Started', 'In Progress', 'Waiting', 'Complete'];
  const status = statuses.includes(value.status as DAVECompletionVerificationStatus)
    ? value.status as DAVECompletionVerificationStatus
    : null;
  const priorScheduleStatus = scheduleStatuses.includes(value.priorScheduleStatus as ScheduleStatus)
    ? value.priorScheduleStatus as ScheduleStatus
    : 'Not Started';
  if (!status || !validTimestamp(value.reportedAt) || !Array.isArray(value.evidence)) return null;

  const evidence = value.evidence.map(normalizeEvidence).filter(Boolean) as DAVECompletionEvidence[];
  if (!evidence.length) return null;
  return freezeVerification({
    status,
    reportedAt: value.reportedAt as string,
    reportedBy: optional(value.reportedBy),
    priorScheduleStatus,
    priorPercentComplete: clampPercent(value.priorPercentComplete),
    verifiedAt: validTimestamp(value.verifiedAt) ? value.verifiedAt as string : null,
    verifiedBy: optional(value.verifiedBy),
    verificationNote: optional(value.verificationNote),
    evidence: uniqueEvidence(evidence),
  });
}

function requiredVerification(item: Pick<ScheduleItem, 'completionVerification'>) {
  if (!item.completionVerification) throw new Error('A completion report is required before verification.');
  return item.completionVerification;
}

function completionEvidence({
  kind,
  sourceName,
  sourceRecordId,
  summary,
  recordedAt,
}: {
  kind: DAVECompletionEvidenceKind;
  sourceName: string;
  sourceRecordId: string;
  summary: string;
  recordedAt: string;
}): DAVECompletionEvidence {
  const stableSourceId = required(sourceRecordId, 'Evidence source');
  return Object.freeze({
    id: `completion-evidence:${kind}:${stableSourceId}:${stableHash(`${summary}|${recordedAt}`)}`,
    kind,
    sourceRecordId: stableSourceId,
    sourceName: required(sourceName, 'Evidence source name'),
    summary: required(summary, 'Evidence summary'),
    recordedAt: required(recordedAt, 'Evidence timestamp'),
  });
}

function normalizeEvidence(value: unknown): DAVECompletionEvidence | null {
  if (!isRecord(value)) return null;
  const kinds: DAVECompletionEvidenceKind[] = ['email', 'message_screenshot', 'photo', 'pm_confirmation', 'pm_note'];
  if (!kinds.includes(value.kind as DAVECompletionEvidenceKind) || !validTimestamp(value.recordedAt)) return null;
  try {
    return completionEvidence({
      kind: value.kind as DAVECompletionEvidenceKind,
      sourceName: required(value.sourceName, 'Evidence source name'),
      sourceRecordId: required(value.sourceRecordId, 'Evidence source'),
      summary: required(value.summary, 'Evidence summary'),
      recordedAt: value.recordedAt as string,
    });
  } catch {
    return null;
  }
}

function freezeVerification(value: DAVECompletionVerification): DAVECompletionVerification {
  Object.freeze(value.evidence);
  return Object.freeze(value);
}

function uniqueEvidence(items: DAVECompletionEvidence[]) {
  const seen = new Set<string>();
  return items.filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)));
}

function compatibleContext(left: string, right: string) {
  const leftKey = normalizedKey(left);
  const rightKey = normalizedKey(right);
  return !leftKey || !rightKey || leftKey === rightKey;
}

function normalizedKey(value: unknown) {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

function clampPercent(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 0;
}

function validTimestamp(value: unknown) {
  return typeof value === 'string' && Boolean(value.trim()) && Number.isFinite(new Date(value).getTime());
}

function required(value: unknown, label: string) {
  const text = optional(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function optional(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
