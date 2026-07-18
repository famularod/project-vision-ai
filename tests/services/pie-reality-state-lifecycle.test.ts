import {
  buildPIERealityModel,
  createRealityObject,
  mergeRealityObjects,
  type PIERealityObjectStatus,
} from '../../services/PIERealityModel';

function reality(
  status: PIERealityObjectStatus,
  updatedAt: string,
  overrides: { confidence?: 'low' | 'medium' | 'high'; stale?: boolean; uncertain?: boolean } = {},
) {
  return createRealityObject({
    id: 'task-electrical',
    organizationId: 'org-1',
    projectId: 'project-1',
    type: 'schedule_activity',
    name: 'Electrical rough-in',
    summary: `Electrical rough-in is ${status}.`,
    status,
    evidenceId: `evidence-${status}-${updatedAt}`,
    evidenceType: 'field_update',
    updatedAt,
    confidence: overrides.confidence ?? 'medium',
    stale: overrides.stale,
    uncertain: overrides.uncertain,
  }, updatedAt);
}

describe('Reality object current-state lifecycle', () => {
  it('allows newer completion evidence to recover from an older blocked state', () => {
    const blocked = reality('blocked', '2026-07-18T10:00:00.000Z', {
      confidence: 'high',
      stale: true,
      uncertain: true,
    });
    const completed = reality('complete', '2026-07-18T11:00:00.000Z', {
      confidence: 'low',
    });

    const merged = mergeRealityObjects(blocked, completed, '2026-07-18T11:01:00.000Z');

    expect(merged.currentStatus).toBe('complete');
    expect(merged.currentState).toMatchObject({
      status: 'complete',
      confidence: 'low',
      stale: false,
      uncertain: false,
    });
    expect(merged.priorState?.status).toBe('blocked');
  });

  it('does not let an older late-arriving record overwrite newer current Reality', () => {
    const completed = reality('complete', '2026-07-18T11:00:00.000Z');
    const olderBlocked = reality('blocked', '2026-07-18T10:00:00.000Z', { confidence: 'high' });

    const merged = mergeRealityObjects(completed, olderBlocked, '2026-07-18T11:01:00.000Z');

    expect(merged.currentStatus).toBe('complete');
    expect(merged.currentState.summary).toContain('complete');
  });

  it('supports blocked to resolved to reopened transitions without erasing history', () => {
    const blocked = reality('blocked', '2026-07-18T09:00:00.000Z');
    const resolved = mergeRealityObjects(
      blocked,
      reality('complete', '2026-07-18T10:00:00.000Z'),
      '2026-07-18T10:01:00.000Z',
    );
    const reopened = mergeRealityObjects(
      resolved,
      reality('blocked', '2026-07-18T11:00:00.000Z'),
      '2026-07-18T11:01:00.000Z',
    );

    expect(resolved.currentStatus).toBe('complete');
    expect(reopened.currentStatus).toBe('blocked');
    expect(reopened.priorState?.status).toBe('complete');
    expect(reopened.history.some(event => event.previousStatus === 'blocked' && event.nextStatus === 'complete')).toBe(true);
    expect(reopened.history.some(event => event.previousStatus === 'complete' && event.nextStatus === 'blocked')).toBe(true);
  });

  it('allows a newer explicit retirement to become current', () => {
    const completed = reality('complete', '2026-07-18T10:00:00.000Z');
    const retired = reality('retired', '2026-07-18T11:00:00.000Z');

    expect(mergeRealityObjects(completed, retired).currentStatus).toBe('retired');
  });

  it('clears an old contradiction from the active model after newer resolution evidence', () => {
    const contradictedSource = {
      id: 'task-electrical',
      organizationId: 'org-1',
      projectId: 'project-1',
      type: 'schedule_activity' as const,
      name: 'Electrical rough-in',
      summary: 'Electrical rough-in evidence is contradictory.',
      status: 'contradicted' as const,
      evidenceId: 'field-electrical-conflict',
      evidenceType: 'field_update',
      updatedAt: '2026-07-18T10:00:00.000Z',
      confidence: 'medium' as const,
    };
    const conflicted = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      objects: [contradictedSource],
      generatedAt: '2026-07-18T10:01:00.000Z',
    });
    const resolved = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      previousModel: conflicted,
      objects: [{
        ...contradictedSource,
        summary: 'Electrical rough-in is complete.',
        status: 'complete',
        evidenceId: 'field-electrical-resolved',
        updatedAt: '2026-07-18T11:00:00.000Z',
      }],
      generatedAt: '2026-07-18T11:01:00.000Z',
    });

    expect(conflicted.status).toBe('conflicted');
    expect(resolved.objects[0].currentStatus).toBe('complete');
    expect(resolved.evidenceConflicts).toEqual([]);
    expect(resolved.status).toBe('authoritative');
  });

  it('does not invent a version or history event when identical evidence is replayed', () => {
    const source = {
      id: 'task-electrical',
      organizationId: 'org-1',
      projectId: 'project-1',
      type: 'schedule_activity' as const,
      name: 'Electrical rough-in',
      summary: 'Electrical rough-in is in progress.',
      status: 'in_progress' as const,
      evidenceId: 'field-electrical',
      evidenceType: 'field_update',
      updatedAt: '2026-07-18T10:00:00.000Z',
      confidence: 'medium' as const,
    };
    const first = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      objects: [source],
      generatedAt: '2026-07-18T10:01:00.000Z',
    });
    const replayed = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      previousModel: first,
      objects: [source],
      generatedAt: '2026-07-18T10:05:00.000Z',
    });

    expect(replayed.version).toBe(first.version);
    expect(replayed.objects[0].history).toEqual(first.objects[0].history);
    expect(replayed.changeHistory).toEqual(first.changeHistory);
  });

  it('keeps newer assertion provenance when older evidence arrives late with the same id', () => {
    const current = createRealityObject({
      id: 'task-electrical',
      organizationId: 'org-1',
      projectId: 'project-1',
      type: 'schedule_activity',
      name: 'Electrical rough-in',
      summary: 'Electrical rough-in is complete.',
      status: 'complete',
      evidenceId: 'field-electrical',
      evidenceType: 'field_update',
      updatedAt: '2026-07-18T11:00:00.000Z',
    }, '2026-07-18T11:01:00.000Z');
    const late = createRealityObject({
      id: 'task-electrical',
      organizationId: 'org-1',
      projectId: 'project-1',
      type: 'schedule_activity',
      name: 'Electrical rough-in',
      summary: 'Electrical rough-in evidence is contradictory.',
      status: 'contradicted',
      evidenceId: 'field-electrical',
      evidenceType: 'field_update',
      updatedAt: '2026-07-18T10:00:00.000Z',
    }, '2026-07-18T12:00:00.000Z');

    const merged = mergeRealityObjects(current, late, '2026-07-18T12:01:00.000Z');

    expect(merged.currentStatus).toBe('complete');
    expect(merged.assertions.find(assertion => assertion.id.includes('field-electrical'))?.statement)
      .toBe('Electrical rough-in is complete.');
  });

  it('creates an order-independent conflict for materially different equal-time states', () => {
    const base = {
      id: 'task-electrical',
      organizationId: 'org-1',
      projectId: 'project-1',
      type: 'schedule_activity' as const,
      name: 'Electrical rough-in',
      evidenceType: 'field_update',
      updatedAt: '2026-07-18T11:00:00.000Z',
      confidence: 'high' as const,
    };
    const blocked = {
      ...base,
      summary: 'Electrical rough-in is blocked.',
      status: 'blocked' as const,
      evidenceId: 'field-electrical-blocked',
    };
    const complete = {
      ...base,
      summary: 'Electrical rough-in is complete.',
      status: 'complete' as const,
      evidenceId: 'field-electrical-complete',
    };
    const leftFirst = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      objects: [blocked, complete],
      generatedAt: '2026-07-18T11:01:00.000Z',
    });
    const rightFirst = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      objects: [complete, blocked],
      generatedAt: '2026-07-18T11:01:00.000Z',
    });
    const authoritativeState = (model: typeof leftFirst) => ({
      status: model.status,
      currentState: model.objects[0].currentState,
      readiness: model.objects[0].readiness,
      risk: model.objects[0].risk,
      evidenceIds: model.objects[0].sourceEvidenceReferences
        .map(link => link.evidenceId)
        .sort(),
    });

    expect(authoritativeState(leftFirst)).toEqual(authoritativeState(rightFirst));
    expect(leftFirst.status).toBe('conflicted');
    expect(leftFirst.objects[0].currentStatus).toBe('contradicted');
    expect(leftFirst.objects[0].currentState.uncertain).toBe(true);
    expect(leftFirst.evidenceConflicts).toHaveLength(1);
  });

  it('updates a renamed object through its namespaced canonical source id and keeps the old key as an alias', () => {
    const originalSource = {
      id: 'activity-42',
      organizationId: 'org-1',
      projectId: 'project-1',
      type: 'schedule_activity' as const,
      name: 'Install exterior lights',
      projectName: '2375 Compliance Project',
      areaName: 'Canopy A',
      summary: 'Install exterior lights is in progress.',
      status: 'in_progress' as const,
      evidenceType: 'schedule',
      evidenceId: 'activity-42',
      updatedAt: '2026-07-18T10:00:00.000Z',
    };
    const first = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      objects: [originalSource],
      generatedAt: '2026-07-18T10:01:00.000Z',
    });
    const originalKey = first.objects[0].identity.stableKey;
    const originalStableId = first.objects[0].stableObjectId;
    const renamed = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      previousModel: first,
      objects: [{
        ...originalSource,
        name: 'Install electrical wall packs',
        summary: 'Install electrical wall packs is complete.',
        status: 'complete',
        updatedAt: '2026-07-18T11:00:00.000Z',
      }],
      generatedAt: '2026-07-18T11:01:00.000Z',
    });

    expect(renamed.objects).toHaveLength(1);
    expect(renamed.objects[0].identity.id).toBe(first.objects[0].identity.id);
    expect(renamed.objects[0].stableObjectId).toBe(originalStableId);
    expect(renamed.objects[0].name).toBe('Install electrical wall packs');
    expect(renamed.objects[0].currentStatus).toBe('complete');
    expect(renamed.objects[0].identity.stableKeyAliases).toContain(originalKey);
    expect(renamed.objects[0].history.length).toBeGreaterThan(first.objects[0].history.length);
  });

  it('does not merge the same raw id from different source namespaces', () => {
    const model = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      generatedAt: '2026-07-18T10:01:00.000Z',
      objects: [{
        id: 'shared-42',
        organizationId: 'org-1',
        projectId: 'project-1',
        type: 'schedule_activity',
        name: 'Electrical rough-in',
        areaName: 'Canopy A',
        summary: 'Electrical rough-in is in progress.',
        evidenceType: 'schedule',
        evidenceId: 'schedule-shared-42',
      }, {
        id: 'shared-42',
        organizationId: 'org-1',
        projectId: 'project-1',
        type: 'schedule_activity',
        name: 'Roof membrane',
        areaName: 'Roof',
        summary: 'Roof membrane is in progress.',
        evidenceType: 'field_update',
        evidenceId: 'field-shared-42',
      }],
    });

    expect(model.objects).toHaveLength(2);
    expect(new Set(model.objects.map(object => object.identity.id)).size).toBe(2);
    expect(model.objects.flatMap(object => object.identity.sourceIdentityKeys || []).sort()).toEqual([
      'field-update:shared-42',
      'schedule:shared-42',
    ]);
    expect(model.evidenceConflicts.some(conflict => conflict.conflictType === 'identity_mismatch')).toBe(false);
  });

  it('surfaces a canonical source-id collision instead of overwriting either object', () => {
    const model = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      generatedAt: '2026-07-18T10:01:00.000Z',
      objects: [{
        id: 'duplicate-7',
        organizationId: 'org-1',
        projectId: 'project-1',
        type: 'schedule_activity',
        name: 'Electrical rough-in',
        areaName: 'Canopy A',
        summary: 'Electrical rough-in is in progress.',
        evidenceType: 'schedule',
        evidenceId: 'duplicate-7',
      }, {
        id: 'duplicate-7',
        organizationId: 'org-1',
        projectId: 'project-1',
        type: 'issue',
        name: 'Missing inspection',
        areaName: 'Canopy A',
        summary: 'Missing inspection is an open issue.',
        evidenceType: 'schedule',
        evidenceId: 'duplicate-7',
      }],
    });

    expect(model.objects).toHaveLength(2);
    expect(new Set(model.objects.map(object => object.identity.id)).size).toBe(2);
    expect(model.status).toBe('conflicted');
    expect(model.evidenceConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conflictType: 'identity_mismatch',
        severity: 'high',
      }),
    ]));
  });

  it('treats a same-namespace task id reused in another area as a collision, not a rename', () => {
    const model = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      generatedAt: '2026-07-18T10:01:00.000Z',
      objects: [{
        id: 'activity-77',
        organizationId: 'org-1',
        projectId: 'project-1',
        type: 'schedule_activity',
        name: 'Electrical rough-in',
        areaName: 'Canopy A',
        summary: 'Electrical rough-in is in progress.',
        evidenceType: 'schedule',
        evidenceId: 'activity-77',
      }, {
        id: 'activity-77',
        organizationId: 'org-1',
        projectId: 'project-1',
        type: 'schedule_activity',
        name: 'Roof membrane',
        areaName: 'Roof',
        summary: 'Roof membrane is in progress.',
        evidenceType: 'schedule',
        evidenceId: 'activity-77',
      }],
    });

    expect(model.objects).toHaveLength(2);
    expect(model.status).toBe('conflicted');
    expect(model.evidenceConflicts.some(conflict => conflict.conflictType === 'identity_mismatch')).toBe(true);
  });

  it('does not overwrite source or stable-key targets when those identities disagree', () => {
    const base = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      generatedAt: '2026-07-18T10:01:00.000Z',
      objects: [{
        id: 'source-a',
        organizationId: 'org-1',
        projectId: 'project-1',
        type: 'schedule_activity',
        name: 'Electrical rough-in',
        areaName: 'Canopy A',
        summary: 'Electrical rough-in is in progress.',
        evidenceType: 'schedule',
        evidenceId: 'source-a',
      }, {
        id: 'source-b',
        organizationId: 'org-1',
        projectId: 'project-1',
        type: 'schedule_activity',
        name: 'Roof membrane',
        areaName: 'Roof',
        summary: 'Roof membrane is in progress.',
        evidenceType: 'schedule',
        evidenceId: 'source-b',
      }],
    });
    const conflicted = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      previousModel: base,
      generatedAt: '2026-07-18T11:01:00.000Z',
      objects: [{
        id: 'source-a',
        organizationId: 'org-1',
        projectId: 'project-1',
        type: 'schedule_activity',
        name: 'Roof membrane',
        areaName: 'Roof',
        summary: 'Ambiguous source identity update.',
        evidenceType: 'schedule',
        evidenceId: 'source-a',
        updatedAt: '2026-07-18T11:00:00.000Z',
      }],
    });

    expect(conflicted.objects).toHaveLength(3);
    expect(conflicted.objects.filter(object => object.name === 'Electrical rough-in')).toHaveLength(1);
    expect(conflicted.objects.filter(object => object.name === 'Roof membrane')).toHaveLength(2);
    expect(conflicted.evidenceConflicts.some(conflict => conflict.conflictType === 'identity_mismatch')).toBe(true);
  });

  it('preserves changed evidence versions even when they arrive older than current state', () => {
    const source = {
      id: 'activity-42',
      organizationId: 'org-1',
      projectId: 'project-1',
      type: 'schedule_activity' as const,
      name: 'Electrical rough-in',
      areaName: 'Canopy A',
      summary: 'Electrical rough-in is complete.',
      status: 'complete' as const,
      evidenceType: 'schedule',
      evidenceId: 'activity-42',
      evidenceContentHash: 'hash-current',
      updatedAt: '2026-07-18T11:00:00.000Z',
    };
    const current = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      objects: [source],
      generatedAt: '2026-07-18T11:01:00.000Z',
    });
    const withLateVersion = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      previousModel: current,
      objects: [{
        ...source,
        summary: 'Older field record reported electrical rough-in in progress.',
        status: 'in_progress',
        evidenceContentHash: 'hash-older-version',
        updatedAt: '2026-07-18T10:00:00.000Z',
      }],
      generatedAt: '2026-07-18T12:00:00.000Z',
    });

    expect(withLateVersion.objects[0].currentStatus).toBe('complete');
    expect(withLateVersion.objects[0].sourceEvidenceReferences).toHaveLength(2);
    expect(withLateVersion.objects[0].sourceEvidenceReferences.map(link => link.evidenceContentHash))
      .toEqual(expect.arrayContaining(['hash-current', 'hash-older-version']));
    expect(withLateVersion.version).toBeGreaterThan(current.version);
  });
});
