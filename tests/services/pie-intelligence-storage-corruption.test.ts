const mockStorageValues = new Map<string, string>();
let mockFailQuarantineWrites = false;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorageValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      if (mockFailQuarantineWrites && (key.includes('.corrupt.') || key.includes('.quarantine.'))) {
        throw new Error('simulated quarantine write failure');
      }
      mockStorageValues.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorageValues.delete(key);
    }),
  },
}));

jest.mock('../../services/SupabaseService', () => ({
  listPIEExecutiveJudgmentsCloud: jest.fn(),
  savePIEExecutiveJudgmentCloud: jest.fn(),
  loadPIERealityModelCloud: jest.fn(),
  savePIERealityModelCloud: jest.fn(),
}));

import {
  DECISION_LEDGER_LEGACY_QUARANTINE_KEY_PREFIX,
  DECISION_LEDGER_LEGACY_STORAGE_KEY,
  loadPIEDecisionLedgerForOrganization,
  storageKeyForOrganization,
} from '../../services/PIEDecisionLedgerStorage';
import {
  getRealityModelSnapshots,
  loadRealityModelState,
  realityModelStorageKey,
  realitySnapshotStorageKey,
} from '../../services/PIERealityModelStorage';
import {
  executiveJudgmentStorageKey,
  localPIEExecutiveJudgmentRepository,
} from '../../services/PIEExecutiveJudgmentRepository';
import {
  loadPhotoProgressIntelligenceState,
  photoProgressIntelligenceStorageKey,
} from '../../services/PIEPhotoProgressIntelligenceStorage';
import {
  classifyEvidenceDeltas,
  evidenceDeltaStorageKey,
} from '../../services/PIERealityModelOrchestrator';

function quarantineValue(storageKey: string, separator = '.corrupt.'): string | undefined {
  const quarantineKey = [...mockStorageValues.keys()]
    .find(key => key.startsWith(`${storageKey}${separator}`));
  return quarantineKey ? mockStorageValues.get(quarantineKey) : undefined;
}

function quarantineValues(storageKey: string, separator = '.corrupt.'): string[] {
  return [...mockStorageValues.entries()]
    .filter(([key]) => key.startsWith(`${storageKey}${separator}`))
    .map(([, value]) => value);
}

describe('PIE local intelligence storage corruption boundaries', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    mockFailQuarantineWrites = false;
  });

  it('quarantines malformed organization decision bytes exactly and fails the load', async () => {
    const key = storageKeyForOrganization('org-a');
    const raw = '{"decisions":[\n\u0000unfinished';
    mockStorageValues.set(key, raw);

    await expect(loadPIEDecisionLedgerForOrganization('org-a'))
      .rejects.toThrow(/quarantined/i);

    expect(mockStorageValues.has(key)).toBe(false);
    expect(quarantineValue(key)).toBe(raw);
  });

  it('treats an empty stored decision value as corruption rather than missing state', async () => {
    const key = storageKeyForOrganization('org-a');
    mockStorageValues.set(key, '');

    await expect(loadPIEDecisionLedgerForOrganization('org-a')).rejects.toThrow();
    expect(mockStorageValues.has(key)).toBe(false);
    expect(quarantineValue(key)).toBe('');
  });

  it('rejects and preserves a decision envelope for the wrong organization', async () => {
    const key = storageKeyForOrganization('org-a');
    const raw = JSON.stringify({
      version: 'v2',
      organizationId: 'org-b',
      decisions: [],
      savedAt: '2026-07-18T12:00:00.000Z',
    });
    mockStorageValues.set(key, raw);

    await expect(loadPIEDecisionLedgerForOrganization('org-a')).rejects.toThrow();
    expect(quarantineValue(key)).toBe(raw);
  });

  it('preserves malformed legacy ledger bytes rather than rewriting parsed content', async () => {
    const raw = '[{"id":"truncated"}\n';
    mockStorageValues.set(DECISION_LEDGER_LEGACY_STORAGE_KEY, raw);

    await expect(loadPIEDecisionLedgerForOrganization('org-a')).rejects.toThrow();

    expect(mockStorageValues.has(DECISION_LEDGER_LEGACY_STORAGE_KEY)).toBe(false);
    const quarantineKey = [...mockStorageValues.keys()]
      .find(key => key.startsWith(DECISION_LEDGER_LEGACY_QUARANTINE_KEY_PREFIX));
    expect(quarantineKey && mockStorageValues.get(quarantineKey)).toBe(raw);
  });

  it('leaves the active decision ledger untouched when quarantine cannot be written', async () => {
    const key = storageKeyForOrganization('org-a');
    const raw = '{not-json';
    mockStorageValues.set(key, raw);
    mockFailQuarantineWrites = true;

    await expect(loadPIEDecisionLedgerForOrganization('org-a'))
      .rejects.toThrow(/left in place/i);

    expect(mockStorageValues.get(key)).toBe(raw);
    expect(quarantineValue(key)).toBeUndefined();
  });

  it('quarantines malformed Reality Model state and rejects cross-scope snapshots', async () => {
    const modelKey = realityModelStorageKey('org-a', 'project-a');
    const malformed = '{"version":"v1",\u0000';
    mockStorageValues.set(modelKey, malformed);

    await expect(loadRealityModelState('org-a', 'project-a')).rejects.toThrow();
    expect(quarantineValue(modelKey)).toBe(malformed);

    const snapshotKey = realitySnapshotStorageKey('org-a', 'project-a');
    const wrongScope = JSON.stringify([{
      id: 'snapshot-1',
      organizationId: 'org-b',
      projectId: 'project-a',
      modelVersion: 1,
      createdAt: '2026-07-18T12:00:00.000Z',
      model: {},
    }]);
    mockStorageValues.set(snapshotKey, wrongScope);

    await expect(getRealityModelSnapshots('org-a', 'project-a')).rejects.toThrow();
    expect(quarantineValue(snapshotKey)).toBe(wrongScope);
  });

  it('does not treat malformed or cross-scope Executive Judgments as an empty history', async () => {
    const key = executiveJudgmentStorageKey('org-a', 'project-a');
    const malformed = '[{"id":"judgment-1"';
    mockStorageValues.set(key, malformed);

    await expect(localPIEExecutiveJudgmentRepository.listJudgments('org-a', 'project-a'))
      .rejects.toThrow();
    expect(quarantineValue(key)).toBe(malformed);

    const wrongScope = JSON.stringify([{
      id: 'judgment-2',
      organizationId: 'org-b',
      projectId: 'project-a',
      judgmentTime: '2026-07-18T12:00:00.000Z',
      primaryRecommendation: 'Continue work.',
      immutable: true,
    }]);
    mockStorageValues.set(key, wrongScope);

    await expect(localPIEExecutiveJudgmentRepository.listJudgments('org-a', 'project-a'))
      .rejects.toThrow();
    expect(quarantineValues(key)).toContain(wrongScope);
  });

  it('rejects malformed photo-intelligence arrays and cross-scope records', async () => {
    const key = photoProgressIntelligenceStorageKey('org-a', 'project-a');
    const malformedEnvelope = JSON.stringify({
      version: 'v1',
      organizationId: 'org-a',
      projectId: 'project-a',
      currentAnalysis: null,
      sequences: {},
      progressEvents: [],
      comparabilityAssessments: [],
      conflicts: [],
      cacheEntries: [],
      savedAt: '2026-07-18T12:00:00.000Z',
    });
    mockStorageValues.set(key, malformedEnvelope);

    await expect(loadPhotoProgressIntelligenceState('org-a', 'project-a'))
      .rejects.toThrow();
    expect(quarantineValue(key)).toBe(malformedEnvelope);

    const crossScope = JSON.stringify({
      version: 'v1',
      organizationId: 'org-a',
      projectId: 'project-a',
      currentAnalysis: null,
      sequences: [{ id: 'sequence-1', organizationId: 'org-b', projectId: 'project-a' }],
      progressEvents: [],
      comparabilityAssessments: [],
      conflicts: [],
      cacheEntries: [],
      savedAt: '2026-07-18T12:00:00.000Z',
    });
    mockStorageValues.set(key, crossScope);

    await expect(loadPhotoProgressIntelligenceState('org-a', 'project-a'))
      .rejects.toThrow();
    expect(quarantineValues(key)).toContain(crossScope);
  });

  it('quarantines malformed evidence-delta bytes and fails classification before overwrite', async () => {
    const key = evidenceDeltaStorageKey('org-a', 'project-a');
    const raw = '{"evidence-1":\u0000unfinished';
    mockStorageValues.set(key, raw);

    await expect(classifyEvidenceDeltas(
      'org-a',
      'project-a',
      null,
      [],
      '2026-07-18T12:00:00.000Z',
    )).rejects.toMatchObject({
      code: 'corrupt_evidence_delta_storage',
    });

    expect(mockStorageValues.has(key)).toBe(false);
    expect(quarantineValue(key)).toBe(raw);
  });

  it('quarantines cross-scope evidence-delta state and fails classification before overwrite', async () => {
    const key = evidenceDeltaStorageKey('org-a', 'project-a');
    const raw = JSON.stringify({
      'evidence-1': {
        evidenceId: 'evidence-1',
        organizationId: 'org-b',
        projectId: 'project-a',
        evidenceVersionOrHash: 'hash-1',
        status: 'unchanged',
        lastProcessedModelVersion: 1,
        processedAt: '2026-07-18T12:00:00.000Z',
        evidenceStatus: 'active',
      },
    });
    mockStorageValues.set(key, raw);

    await expect(classifyEvidenceDeltas(
      'org-a',
      'project-a',
      null,
      [],
      '2026-07-18T12:00:00.000Z',
    )).rejects.toMatchObject({
      code: 'corrupt_evidence_delta_storage',
    });

    expect(mockStorageValues.has(key)).toBe(false);
    expect(quarantineValue(key)).toBe(raw);
  });

  it('keeps malformed evidence deltas active when their quarantine write fails', async () => {
    const key = evidenceDeltaStorageKey('org-a', 'project-a');
    const raw = '{not-json';
    mockStorageValues.set(key, raw);
    mockFailQuarantineWrites = true;

    await expect(classifyEvidenceDeltas(
      'org-a',
      'project-a',
      null,
      [],
      '2026-07-18T12:00:00.000Z',
    )).rejects.toMatchObject({
      code: 'corrupt_evidence_delta_storage',
    });

    expect(mockStorageValues.get(key)).toBe(raw);
    expect(quarantineValue(key)).toBeUndefined();
  });
});
