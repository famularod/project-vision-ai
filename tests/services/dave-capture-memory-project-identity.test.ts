jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import fs from 'fs';
import path from 'path';

import {
  confirmCaptureMemory,
  createCaptureMemory,
} from '../../services/DAVECaptureMemory';
import {
  captureMemoriesAfterProjectDeletion,
  createDAVECaptureMemoryRepository,
  normalizeConfirmedMemory,
} from '../../services/DAVECaptureMemoryRepository';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildECOSTalkProjectIntelligence } from '../../services/ECOSTalkProjectIntelligence';

function confirmedMemory(projectId: string, projectName = 'Shared Project') {
  const draft = (createCaptureMemory as unknown as (input: Record<string, unknown>) => any)({
    id: `memory-${projectId}`,
    projectId,
    transcript: 'A-only confidential field condition.',
    transcriptSourceRecordId: `transcript-${projectId}`,
    createdAt: '2026-08-10T10:00:00.000Z',
    recommendedProject: {
      value: projectName,
      confidence: 'high',
      confirmed: true,
    },
    fields: { generalMemory: 'A-only retained memory fact.' },
  });
  return confirmCaptureMemory(draft, '2026-08-10T10:01:00.000Z') as any;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { values.delete(key); }),
  };
}

describe('DAVE capture memory immutable project authority', () => {
  it('requires and preserves the exact project ID on the durable record', () => {
    expect(() => (createCaptureMemory as any)({
      id: 'missing-project-id',
      transcript: 'Do not persist this name-only memory.',
      transcriptSourceRecordId: 'transcript-missing-project-id',
      createdAt: '2026-08-10T10:00:00.000Z',
      recommendedProject: { value: 'Shared Project', confidence: 'high', confirmed: true },
    })).toThrow(/project id/i);

    const memory = confirmedMemory('project-a');
    expect(memory.projectId).toBe('project-a');
    expect(normalizeConfirmedMemory(memory).projectId).toBe('project-a');
    expect(() => normalizeConfirmedMemory({ ...memory, projectId: undefined })).toThrow(/project id/i);
    expect(() => normalizeConfirmedMemory({ ...memory, projectId: ' project-a ' })).toThrow(/project id/i);
  });

  it('never rebinds a retained A memory to same-name project B', () => {
    const memoryA = confirmedMemory('project-a');
    const truthB = buildDAVEProjectTruth({
      projectId: 'project-b',
      projectName: 'Shared Project',
      updates: [],
      scheduleItems: [],
      captureMemories: [memoryA],
      now: '2026-08-10T12:00:00.000Z',
    });
    expect(truthB.evidence.records.some(record => record.sourceRecordId === memoryA.id)).toBe(false);

    const talkB = buildECOSTalkProjectIntelligence({
      projectId: 'project-b',
      projectName: 'Shared Project',
      legacyNameScopeIsUnambiguous: true,
      updates: [],
      scheduleItems: [],
      projectDocuments: [],
      referenceDocuments: [],
      captureMemories: [memoryA],
    });
    expect(JSON.stringify(talkB)).not.toContain('A-only retained memory fact.');
  });

  it('admits only an explicit immutable project-ID set for portfolio truth', () => {
    const memoryA = confirmedMemory('project-a', 'Project A');
    const memoryB = confirmedMemory('project-b', 'Project B');
    const truth = buildDAVEProjectTruth({
      projectId: 'portfolio:project-a+project-b',
      projectName: 'Combined Project Portfolio',
      updates: [],
      scheduleItems: [],
      captureMemories: [memoryA, memoryB],
      captureMemoryProjectIds: ['project-a', 'project-b'],
      now: '2026-08-10T12:00:00.000Z',
    });

    expect(truth.evidence.records
      .filter(record => record.kind === 'memory')
      .map(record => record.sourceRecordId)
      .sort()).toEqual([memoryA.id, memoryB.id].sort());
    expect(() => buildDAVEProjectTruth({
      projectId: 'portfolio:unsafe',
      projectName: 'Combined Project Portfolio',
      updates: [],
      scheduleItems: [],
      captureMemories: [memoryA],
      captureMemoryProjectIds: [' project-a '],
    })).toThrow(/project id/i);
  });

  it('lists and updates memories only under their immutable project ID', async () => {
    const storage = memoryStorage();
    const repository = createDAVECaptureMemoryRepository(storage as never);
    const memoryA = confirmedMemory('project-a');
    await repository.save(memoryA);

    expect((await repository.list('project-a')).map(memory => memory.id)).toEqual([memoryA.id]);
    expect(await repository.list('project-b')).toEqual([]);
    await expect(repository.update({ ...memoryA, projectId: 'project-b' })).rejects.toThrow(
      /project identity/i,
    );
  });

  it('removes only the deleted exact project and never a same-name sibling', () => {
    const memoryA = confirmedMemory('project-a');
    const memoryB = confirmedMemory('project-b');

    expect(captureMemoriesAfterProjectDeletion(
      [memoryA, memoryB],
      'project-a',
    )).toEqual([memoryB]);
    expect(() => captureMemoriesAfterProjectDeletion(
      [memoryA, memoryB],
      ' project-a ',
    )).toThrow(/project id/i);
  });

  it('commits exact-project memory deletion in the durable project transaction', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    expect(app).toContain('parseCaptureMemoryRepositoryStorageValue(\n            await AsyncStorage.getItem(DAVE_CAPTURE_MEMORY_STORAGE_KEY),');
    expect(app).toContain('captureMemoriesAfterProjectDeletion(\n            durableCaptureMemories,\n            projectId,');
    expect(app).toContain('key: DAVE_CAPTURE_MEMORY_STORAGE_KEY');
    expect(app).toContain('setCaptureMemories(remainingCaptureMemories)');
    expect(app).toContain('onDeleteProject(projectId, projectName)');
  });
});
