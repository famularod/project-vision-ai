import { runPIERealityModelOrchestration } from '../../services/PIERealityModelOrchestrator';
import type { PIERealityModelRepository } from '../../services/PIERealityModelRepository';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const evidence = [{
  id: 'task-1', organizationId: 'org-1', projectId: 'project-1',
  type: 'schedule_activity' as const, name: 'Install drywall', status: 'complete' as const,
  evidenceId: 'schedule-1', evidenceType: 'schedule', evidenceQualified: true as const,
  identityConfidence: 'high' as const, confidence: 'high' as const,
  updatedAt: '2026-09-17T12:00:00.000Z',
}];

function repository(saveRejects = false): PIERealityModelRepository {
  let model: any = null;
  return {
    loadCurrent: async () => model,
    saveSynchronized: async next => {
      model = next;
      if (saveRejects) throw new Error('cloud upsert rejected');
      return next;
    },
    hasFreshCloudAuthority: () => false,
    appendObjectHistory: async () => null,
    getObjectHistory: async () => [], getSnapshots: async () => [], getConflicts: async () => [],
    getUncertainties: async () => [], queryObjects: async () => [],
  };
}

describe('reality authority while local or offline', () => {
  it('marks signed-out local-only reality authoritative_local', async () => {
    const result = await runPIERealityModelOrchestration({
      organizationId: 'org-1', projectId: 'project-1', qualifiedEvidence: evidence,
      repository: repository(), cloudAvailable: false, identityTrusted: false,
    });
    expect(result.persistenceStatus).toBe('authoritative_local');
  });

  it('retains local reality and queues cloud retry when cloud persistence rejects', async () => {
    await expect(runPIERealityModelOrchestration({
      organizationId: 'org-1', projectId: 'project-1', qualifiedEvidence: evidence,
      repository: repository(true), cloudAvailable: true, identityTrusted: true,
    })).resolves.toMatchObject({ persistenceStatus: 'queued_for_cloud' });
  });
});
