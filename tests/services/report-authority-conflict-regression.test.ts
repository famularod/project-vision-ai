import { buildPIERealityModel, type PIERealitySourceObject } from '../../services/PIERealityModel';
import { policyForState, stateFromPersistence } from '../../providers/PIELiveAuthorityProvider';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('report authority conflict regression', () => {
  it('does not block reports for shared task prefixes or conflict words in notes', () => {
    const tasks: PIERealitySourceObject[] = Array.from({ length: 30 }, (_, index) => ({
      id: `task-${index}`,
      organizationId: 'org-1',
      projectId: 'project-1',
      projectName: '2375 Compliance Project',
      type: 'schedule_activity',
      areaName: `Area ${(index % 3) + 1}`,
      name: index < 15 ? `Install drywall L${(index % 3) + 1}` : `Pour slab ${String.fromCharCode(65 + (index % 3))}`,
      summary: 'Scheduled project work.',
      status: 'in_progress',
      evidenceId: `schedule-${index}`,
      evidenceType: 'schedule',
      updatedAt: '2026-09-17T12:00:00.000Z',
      confidence: 'high',
    }));
    tasks.push({
      id: 'field-update-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      projectName: '2375 Compliance Project',
      type: 'issue',
      areaName: 'Area 1',
      name: 'Coordination note',
      summary: 'Resolved conflict with plumber.',
      status: 'complete',
      evidenceId: 'field-update-1',
      evidenceType: 'field_update',
      updatedAt: '2026-09-17T12:05:00.000Z',
      confidence: 'high',
    });

    const model = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      objects: tasks,
      generatedAt: '2026-09-17T12:10:00.000Z',
    });
    const persistenceStatus = model.evidenceConflicts.length ? 'conflict_blocked' : 'authoritative_local';
    const state = stateFromPersistence(persistenceStatus, false);

    expect(model.evidenceConflicts).toEqual([]);
    expect(persistenceStatus).not.toBe('conflict_blocked');
    expect(policyForState(state).reportGenerationAllowed).toBe(true);
  });

  it('keeps a genuine cross-source contradiction blocking', () => {
    const initial = buildPIERealityModel({
      organizationId: 'org-1',
      projectId: 'project-1',
      objects: [{
        id: 'task-1', type: 'schedule_activity', name: 'Electrical rough-in',
        status: 'complete', evidenceId: 'schedule-1', evidenceType: 'schedule',
        summary: 'Complete per schedule.', confidence: 'high',
      }],
      generatedAt: '2026-09-17T12:00:00.000Z',
    });
    initial.objects[0].assertions[0].contradictingEvidenceIds = ['field-update-9'];
    initial.objects[0].sourceEvidenceReferences.push({
      ...initial.objects[0].sourceEvidenceReferences[0],
      id: 'field-link-9',
      evidenceId: 'field-update-9',
      evidenceType: 'field_update',
    });
    const rebuilt = buildPIERealityModel({
      organizationId: 'org-1', projectId: 'project-1', objects: [],
      previousModel: initial, generatedAt: '2026-09-17T12:10:00.000Z',
    });
    expect(rebuilt.evidenceConflicts).toHaveLength(1);
    expect(rebuilt.status).toBe('conflicted');
  });
});
