import {
  createPIEDecisionHistoryActions,
  type PIEDecisionHistoryActionDependencies,
} from '../../services/PIEDecisionHistoryActions';
import {
  createDecisionRecord,
  type PIEActor,
  type PIEDecisionRecord,
  type PIEDecisionSnapshot,
} from '../../services/PIEDecisionLedger';

const ORG = 'org-1';
const PROJECT = 'project-1';
const ALL_PERMISSIONS: NonNullable<PIEActor['authorizedPermissions']> = [
  'create_decision_candidate',
  'create_decision_snapshot',
  'approve_decision',
  'reject_decision',
  'defer_decision',
  'cancel_decision',
  'close_decision',
  'append_corrected_version',
  'append_decision_version',
];
const actor: PIEActor = {
  id: 'user-1',
  name: 'David',
  role: 'decision_owner',
  organizationId: ORG,
  authorizedPermissions: ALL_PERMISSIONS,
};

function snapshot(
  overrides: Partial<PIEDecisionSnapshot> = {},
): PIEDecisionSnapshot {
  return {
    projectId: PROJECT,
    situationId: 'situation-1',
    recommendationId: 'recommendation-1',
    selectedOption: 'Proceed with the approved scope.',
    decisionOwner: 'David',
    decisionAuthority: 'David',
    decisionDate: '2026-07-22',
    evidenceAvailable: [],
    knownEvidenceGaps: [],
    assumptions: [],
    risks: [],
    constraints: [],
    predictedOutcomes: [],
    recommendationConfidence: 'medium',
    confidenceExplanation: 'Current project facts support review.',
    selectedReason: 'The reviewed option best fits the current project state.',
    ...overrides,
  };
}

function proposal() {
  return createDecisionRecord({
    id: 'decision-1',
    organizationId: ORG,
    projectId: PROJECT,
    snapshot: snapshot(),
    createdBy: actor,
    createdAt: '2026-07-22T12:00:00.000Z',
  });
}

function fixture(
  initial: PIEDecisionRecord[] = [],
  overrides: Partial<PIEDecisionHistoryActionDependencies> = {},
) {
  let persisted = [...initial];
  const dependencies = {
    load: jest.fn(async () => [...persisted]),
    save: jest.fn(async (_organizationId, decisions) => {
      persisted = [...decisions];
    }),
    queue: jest.fn(async () => undefined),
    ...overrides,
  } as PIEDecisionHistoryActionDependencies;
  return {
    dependencies,
    get persisted() {
      return persisted;
    },
  };
}

describe('PIE Decision History action and proposal persistence gate', () => {
  it('persists the immutable proposal before queueing it', async () => {
    const state = fixture();
    const service = createPIEDecisionHistoryActions(state.dependencies);

    const result = await service.persistProposal(proposal());

    expect(state.dependencies.save).toHaveBeenCalledTimes(1);
    expect(state.dependencies.queue).toHaveBeenCalledTimes(1);
    expect(
      (state.dependencies.save as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (state.dependencies.queue as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(result.persistence).toBe('saved_and_queued');
    expect(state.persisted[0].currentStatus).toBe('proposed');
    expect(state.persisted[0].immutableSnapshot)
      .toEqual(state.persisted[0].versions[0].snapshot);
  });

  it('refuses to combine an unpersisted proposal with an authorized transition', async () => {
    const state = fixture();
    const service = createPIEDecisionHistoryActions(state.dependencies);

    await expect(service.transition({
      organizationId: ORG,
      decisionId: 'decision-1',
      nextStatus: 'approved',
      actor,
      reason: 'Approved after review.',
    })).rejects.toMatchObject({ code: 'decision_not_found' });
    expect(state.dependencies.save).not.toHaveBeenCalled();
    expect(state.dependencies.queue).not.toHaveBeenCalled();
  });

  it.each([
    ['approved', 'Approved after review.'],
    ['rejected', 'Rejected after review.'],
    ['deferred', 'Deferred pending a field check.'],
    ['cancelled', 'Cancelled by the decision owner.'],
  ] as const)('persists and queues an authorized %s transition', async (nextStatus, reason) => {
    const state = fixture([proposal()]);
    const service = createPIEDecisionHistoryActions(state.dependencies);

    const result = await service.transition({
      organizationId: ORG,
      decisionId: 'decision-1',
      nextStatus,
      actor,
      reason,
      timestamp: '2026-07-22T13:00:00.000Z',
    });

    expect(result.decision.currentStatus).toBe(nextStatus);
    expect(state.persisted[0].currentStatus).toBe(nextStatus);
    expect(state.dependencies.save).toHaveBeenCalledTimes(1);
    expect(state.dependencies.queue).toHaveBeenCalledWith(result.decision);
  });

  it('exposes named callback boundaries for direct ReportsScreen wiring', async () => {
    const state = fixture([proposal()]);
    const service = createPIEDecisionHistoryActions(state.dependencies);

    await expect(service.approve({
      organizationId: ORG,
      decisionId: 'decision-1',
      actor,
      reason: 'Approved from Decision History.',
    })).resolves.toMatchObject({
      decision: { currentStatus: 'approved' },
      persistence: 'saved_and_queued',
    });
  });

  it('persists a corrected append-only snapshot version and retains the original', async () => {
    const original = proposal();
    const state = fixture([original]);
    const service = createPIEDecisionHistoryActions(state.dependencies);

    const result = await service.correctSnapshot({
      organizationId: ORG,
      decisionId: original.id,
      actor,
      snapshot: snapshot({ selectedOption: 'Use the corrected scope.' }),
      reason: 'Corrected after PM review.',
      timestamp: '2026-07-22T13:00:00.000Z',
    });

    expect(result.decision.currentVersion).toBe(2);
    expect(result.decision.immutableSnapshot.selectedOption)
      .toBe('Proceed with the approved scope.');
    expect(result.decision.versions[1].snapshot.selectedOption)
      .toBe('Use the corrected scope.');
  });

  it('never queues a transition when the durable local save fails', async () => {
    const state = fixture([proposal()], {
      save: jest.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const service = createPIEDecisionHistoryActions(state.dependencies);

    await expect(service.transition({
      organizationId: ORG,
      decisionId: 'decision-1',
      nextStatus: 'approved',
      actor,
      reason: 'Approved after review.',
    })).rejects.toThrow('disk full');
    expect(state.dependencies.queue).not.toHaveBeenCalled();
  });

  it('keeps a saved transition retryable when queueing fails', async () => {
    const queue = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const state = fixture([proposal()], { queue });
    const service = createPIEDecisionHistoryActions(state.dependencies);

    const result = await service.transition({
      organizationId: ORG,
      decisionId: 'decision-1',
      nextStatus: 'approved',
      actor,
      reason: 'Approved after review.',
    });

    expect(result.persistence).toBe('saved_queue_failed');
    expect(result.queueError).toBe('offline');
    expect(state.persisted[0].currentStatus).toBe('approved');
    await expect(service.retryQueue(ORG, 'decision-1')).resolves.toMatchObject({
      state: 'queued',
      error: null,
    });
  });

  it('rejects cross-organization actors before loading or writing', async () => {
    const state = fixture([proposal()]);
    const service = createPIEDecisionHistoryActions(state.dependencies);

    await expect(service.transition({
      organizationId: ORG,
      decisionId: 'decision-1',
      nextStatus: 'approved',
      actor: { ...actor, organizationId: 'org-2' },
      reason: 'Cross-account attempt.',
    })).rejects.toMatchObject({ code: 'organization_mismatch' });
    expect(state.dependencies.load).not.toHaveBeenCalled();
    expect(state.dependencies.save).not.toHaveBeenCalled();
  });
});
