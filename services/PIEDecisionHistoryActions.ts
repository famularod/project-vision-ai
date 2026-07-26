import {
  appendDecisionSnapshotVersion,
  transitionDecisionStatus,
  updateLatestOutcomeValidation,
  type PIEActor,
  type PIEDecisionRecord,
  type PIEDecisionSnapshot,
  type PIEDecisionStatus,
  type PIEEvidenceReference,
  type PIEOutcomeValidationStatus,
} from './PIEDecisionLedger';

export type PIEDecisionHistoryCommitResult = Readonly<{
  decision: PIEDecisionRecord;
  decisions: readonly PIEDecisionRecord[];
  persistence: 'saved_and_queued' | 'saved_queue_failed';
  queueError: string | null;
}>;

export type PIEDecisionHistoryActionDependencies = Readonly<{
  load: (organizationId: string) => Promise<readonly PIEDecisionRecord[]>;
  save: (
    organizationId: string,
    decisions: readonly PIEDecisionRecord[],
  ) => Promise<void>;
  queue: (decision: PIEDecisionRecord) => Promise<unknown>;
}>;

export type PIEDecisionTransitionActionInput = Readonly<{
  organizationId: string;
  decisionId: string;
  nextStatus: PIEDecisionStatus;
  actor: PIEActor;
  reason: string;
  source?: 'user' | 'system' | 'sync' | 'import' | 'review';
  linkedEvidence?: readonly PIEEvidenceReference[];
  timestamp?: string;
}>;

export type PIEDecisionCorrectionActionInput = Readonly<{
  organizationId: string;
  decisionId: string;
  actor: PIEActor;
  snapshot: PIEDecisionSnapshot;
  reason: string;
  timestamp?: string;
}>;

export type PIEDecisionStatusActionInput = Omit<
  PIEDecisionTransitionActionInput,
  'nextStatus'
>;

export type PIEDecisionOutcomeValidationActionInput = Readonly<{
  organizationId: string;
  decisionId: string;
  actor: PIEActor;
  validationStatus: Extract<
    PIEOutcomeValidationStatus,
    'human_validated' | 'disputed'
  >;
  reason: string;
  linkedEvidence?: readonly PIEEvidenceReference[];
  timestamp?: string;
}>;

export type PIEDecisionHistoryActions = Readonly<{
  persistProposal: (
    proposal: PIEDecisionRecord,
  ) => Promise<PIEDecisionHistoryCommitResult>;
  transition: (
    input: PIEDecisionTransitionActionInput,
  ) => Promise<PIEDecisionHistoryCommitResult>;
  correctSnapshot: (
    input: PIEDecisionCorrectionActionInput,
  ) => Promise<PIEDecisionHistoryCommitResult>;
  approve: (
    input: PIEDecisionStatusActionInput,
  ) => Promise<PIEDecisionHistoryCommitResult>;
  reject: (
    input: PIEDecisionStatusActionInput,
  ) => Promise<PIEDecisionHistoryCommitResult>;
  defer: (
    input: PIEDecisionStatusActionInput,
  ) => Promise<PIEDecisionHistoryCommitResult>;
  cancel: (
    input: PIEDecisionStatusActionInput,
  ) => Promise<PIEDecisionHistoryCommitResult>;
  close: (
    input: PIEDecisionStatusActionInput,
  ) => Promise<PIEDecisionHistoryCommitResult>;
  validateOutcome: (
    input: PIEDecisionOutcomeValidationActionInput,
  ) => Promise<PIEDecisionHistoryCommitResult>;
  retryQueue: (
    organizationId: string,
    decisionId: string,
  ) => Promise<Readonly<{
    decision: PIEDecisionRecord;
    state: 'queued' | 'failed';
    error: string | null;
  }>>;
}>;

export class PIEDecisionHistoryActionError extends Error {
  readonly code:
    | 'invalid_proposal'
    | 'proposal_conflict'
    | 'proposal_not_persisted'
    | 'organization_mismatch'
    | 'decision_not_found';

  constructor(code: PIEDecisionHistoryActionError['code'], message: string) {
    super(message);
    this.name = 'PIEDecisionHistoryActionError';
    this.code = code;
  }
}

/**
 * P1-05/P1-35/P1-36 service gate:
 * 1. persistProposal stores the immutable proposed record first;
 * 2. every human transition reloads that exact persisted proposal lineage;
 * 3. authorized transition logic runs against the persisted record;
 * 4. local save completes before a cloud-sync queue entry is attempted.
 */
export function createPIEDecisionHistoryActions(
  dependencies: PIEDecisionHistoryActionDependencies,
): PIEDecisionHistoryActions {
  async function persistProposal(
    proposal: PIEDecisionRecord,
  ): Promise<PIEDecisionHistoryCommitResult> {
    assertImmutableProposalBaseline(proposal);
    const decisions = await dependencies.load(proposal.organizationId);
    const existing = decisions.find(item => item.id === proposal.id);
    if (existing && !sameProposalBaseline(existing, proposal)) {
      throw new PIEDecisionHistoryActionError(
        'proposal_conflict',
        'A different decision proposal already uses this identity.',
      );
    }
    const persisted = existing || proposal;
    const next = existing
      ? [...decisions]
      : [proposal, ...decisions];
    if (!existing) {
      await dependencies.save(proposal.organizationId, next);
    }
    return queueAfterSave(persisted, next, dependencies);
  }

  async function transition(
    input: PIEDecisionTransitionActionInput,
  ): Promise<PIEDecisionHistoryCommitResult> {
    assertActorOrganization(input.organizationId, input.actor);
    const { current, decisions } = await loadPersistedDecision(
      input.organizationId,
      input.decisionId,
      dependencies,
    );
    const updated = transitionDecisionStatus({
      decision: current,
      nextStatus: input.nextStatus,
      actor: input.actor,
      reason: input.reason,
      source: input.source || 'user',
      linkedEvidence: [...(input.linkedEvidence || [])],
      timestamp: input.timestamp,
    });
    return persistAuthorizedAction(updated, decisions, dependencies);
  }

  async function correctSnapshot(
    input: PIEDecisionCorrectionActionInput,
  ): Promise<PIEDecisionHistoryCommitResult> {
    assertActorOrganization(input.organizationId, input.actor);
    const { current, decisions } = await loadPersistedDecision(
      input.organizationId,
      input.decisionId,
      dependencies,
    );
    const updated = appendDecisionSnapshotVersion(
      current,
      input.snapshot,
      input.actor,
      input.reason,
      input.timestamp,
    );
    return persistAuthorizedAction(updated, decisions, dependencies);
  }

  const statusAction = (
    nextStatus: PIEDecisionStatus,
    input: PIEDecisionStatusActionInput,
  ) => transition({ ...input, nextStatus });

  async function validateOutcome(
    input: PIEDecisionOutcomeValidationActionInput,
  ): Promise<PIEDecisionHistoryCommitResult> {
    assertActorOrganization(input.organizationId, input.actor);
    const { current, decisions } = await loadPersistedDecision(
      input.organizationId,
      input.decisionId,
      dependencies,
    );
    const updated = updateLatestOutcomeValidation(
      current,
      input.validationStatus,
      input.actor,
      input.reason,
      [...(input.linkedEvidence || [])],
      input.timestamp,
    );
    return persistAuthorizedAction(updated, decisions, dependencies);
  }

  async function retryQueue(
    organizationId: string,
    decisionId: string,
  ) {
    const { current } = await loadPersistedDecision(
      organizationId,
      decisionId,
      dependencies,
    );
    try {
      await dependencies.queue(current);
      return Object.freeze({
        decision: current,
        state: 'queued' as const,
        error: null,
      });
    } catch (error) {
      return Object.freeze({
        decision: current,
        state: 'failed' as const,
        error: errorMessage(error),
      });
    }
  }

  return Object.freeze({
    persistProposal,
    transition,
    correctSnapshot,
    approve: input => statusAction('approved', input),
    reject: input => statusAction('rejected', input),
    defer: input => statusAction('deferred', input),
    cancel: input => statusAction('cancelled', input),
    close: input => statusAction('closed', input),
    validateOutcome,
    retryQueue,
  });
}

async function loadPersistedDecision(
  organizationId: string,
  decisionId: string,
  dependencies: PIEDecisionHistoryActionDependencies,
): Promise<Readonly<{
  current: PIEDecisionRecord;
  decisions: readonly PIEDecisionRecord[];
}>> {
  const normalizedOrganization = requireValue(organizationId, 'organization');
  const normalizedDecisionId = requireValue(decisionId, 'decision');
  const decisions = await dependencies.load(normalizedOrganization);
  const current = decisions.find(item => item.id === normalizedDecisionId);
  if (!current) {
    throw new PIEDecisionHistoryActionError(
      'decision_not_found',
      'The decision is not present in the persisted organization ledger.',
    );
  }
  if (current.organizationId !== normalizedOrganization) {
    throw new PIEDecisionHistoryActionError(
      'organization_mismatch',
      'The persisted decision does not belong to the requested organization.',
    );
  }
  assertPersistedProposalLineage(current);
  return Object.freeze({ current, decisions });
}

async function persistAuthorizedAction(
  updated: PIEDecisionRecord,
  decisions: readonly PIEDecisionRecord[],
  dependencies: PIEDecisionHistoryActionDependencies,
): Promise<PIEDecisionHistoryCommitResult> {
  const next = [
    updated,
    ...decisions.filter(item => item.id !== updated.id),
  ];
  // This await is the external-action gate. A failed local commit prevents the
  // queue call and leaves the caller with no successful transition result.
  await dependencies.save(updated.organizationId, next);
  return queueAfterSave(updated, next, dependencies);
}

async function queueAfterSave(
  decision: PIEDecisionRecord,
  decisions: readonly PIEDecisionRecord[],
  dependencies: PIEDecisionHistoryActionDependencies,
): Promise<PIEDecisionHistoryCommitResult> {
  try {
    await dependencies.queue(decision);
    return Object.freeze({
      decision,
      decisions: Object.freeze([...decisions]),
      persistence: 'saved_and_queued',
      queueError: null,
    });
  } catch (error) {
    return Object.freeze({
      decision,
      decisions: Object.freeze([...decisions]),
      persistence: 'saved_queue_failed',
      queueError: errorMessage(error),
    });
  }
}

function assertImmutableProposalBaseline(proposal: PIEDecisionRecord): void {
  if (
    proposal.currentStatus !== 'proposed' ||
    proposal.currentVersion !== 1 ||
    proposal.versions.length !== 1 ||
    proposal.versions[0]?.version !== 1 ||
    canonical(proposal.versions[0]?.snapshot) !== canonical(proposal.immutableSnapshot) ||
    !proposal.auditHistory.some(event =>
      event.field === 'status' &&
      event.previousValue === null &&
      event.newValue === 'proposed')
  ) {
    throw new PIEDecisionHistoryActionError(
      'invalid_proposal',
      'A decision must be an immutable version-1 proposal before it can enter the human gate.',
    );
  }
  assertPersistedProposalLineage(proposal);
}

function assertPersistedProposalLineage(decision: PIEDecisionRecord): void {
  const versionOne = decision.versions.find(version => version.version === 1);
  const createdEvent = decision.auditHistory.find(event =>
    event.field === 'status' &&
    event.previousValue === null &&
    event.newValue === 'proposed');
  if (
    !versionOne ||
    canonical(versionOne.snapshot) !== canonical(decision.immutableSnapshot) ||
    !createdEvent ||
    createdEvent.organizationId !== decision.organizationId ||
    createdEvent.projectId !== decision.projectId ||
    createdEvent.decisionId !== decision.id
  ) {
    throw new PIEDecisionHistoryActionError(
      'proposal_not_persisted',
      'The persisted decision is missing its immutable proposal baseline.',
    );
  }
}

function sameProposalBaseline(
  existing: PIEDecisionRecord,
  proposal: PIEDecisionRecord,
): boolean {
  return existing.organizationId === proposal.organizationId &&
    existing.projectId === proposal.projectId &&
    canonical(existing.immutableSnapshot) === canonical(proposal.immutableSnapshot);
}

function assertActorOrganization(organizationId: string, actor: PIEActor): void {
  if (requireValue(organizationId, 'organization') !== actor.organizationId) {
    throw new PIEDecisionHistoryActionError(
      'organization_mismatch',
      'The actor is not authorized for the requested organization ledger.',
    );
  }
}

function requireValue(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new PIEDecisionHistoryActionError(
      label === 'organization' ? 'organization_mismatch' : 'decision_not_found',
      `A ${label} identity is required.`,
    );
  }
  return normalized;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(
        (value as Record<string, unknown>)[key],
      )}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
