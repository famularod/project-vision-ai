import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DAVE_CAPTURE_MEMORY_VERSION,
  isConfirmedCaptureMemory,
  type DAVECaptureConfidence,
  type DAVECaptureCorrection,
  type DAVECaptureEvidenceKind,
  type DAVECaptureEvidenceLink,
  type DAVECaptureMemoryFields,
  type DAVECaptureRecommendation,
  type DAVEConfirmedCaptureMemory,
} from './DAVECaptureMemory';

export const DAVE_CAPTURE_MEMORY_REPOSITORY_VERSION = 'dave-capture-memory-repository/1.0' as const;
export const DAVE_CAPTURE_MEMORY_STORAGE_KEY = '@dave/capture-memories/v1';

export type DAVECaptureMemoryStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;

export type DAVECaptureMemoryRepository = Readonly<{
  save(memory: DAVEConfirmedCaptureMemory): Promise<DAVEConfirmedCaptureMemory>;
  list(projectId?: string): Promise<readonly DAVEConfirmedCaptureMemory[]>;
  read(id: string): Promise<DAVEConfirmedCaptureMemory | null>;
  update(memory: DAVEConfirmedCaptureMemory): Promise<DAVEConfirmedCaptureMemory>;
  delete(id: string): Promise<boolean>;
}>;

type StoredCaptureMemories = Readonly<{
  schemaVersion: typeof DAVE_CAPTURE_MEMORY_REPOSITORY_VERSION;
  records: readonly DAVEConfirmedCaptureMemory[];
}>;

export function createDAVECaptureMemoryRepository(
  storage: DAVECaptureMemoryStorage = AsyncStorage,
): DAVECaptureMemoryRepository {
  async function write(records: readonly DAVEConfirmedCaptureMemory[]): Promise<void> {
    const value: StoredCaptureMemories = {
      schemaVersion: DAVE_CAPTURE_MEMORY_REPOSITORY_VERSION,
      records,
    };
    await storage.setItem(DAVE_CAPTURE_MEMORY_STORAGE_KEY, JSON.stringify(value));
  }

  async function list(projectId?: string): Promise<readonly DAVEConfirmedCaptureMemory[]> {
    const records = await hydrateRecords(storage, write);
    const projectKey = normalizeKey(projectId);
    return Object.freeze(records
      .filter(memory => !projectKey || normalizeKey(memory.recommendedProject.value) === projectKey)
      .sort(compareMemories));
  }

  return Object.freeze({
    async save(memory) {
      const confirmed = normalizeConfirmedMemory(memory);
      const records = [...await list()];
      const existing = records.find(item => item.id === confirmed.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(confirmed)) {
          throw new Error('A confirmed memory with this ID already exists. Use update instead.');
        }
        return existing;
      }
      await write([...records, confirmed].sort(compareMemories));
      return confirmed;
    },

    list,

    async read(id) {
      const stableId = required(id, 'Memory ID');
      return (await list()).find(memory => memory.id === stableId) ?? null;
    },

    async update(memory) {
      const confirmed = normalizeConfirmedMemory(memory);
      const records = [...await list()];
      const index = records.findIndex(item => item.id === confirmed.id);
      if (index < 0) throw new Error('Confirmed memory was not found.');
      assertSourceEvidencePreserved(records[index], confirmed);
      records[index] = confirmed;
      await write(records.sort(compareMemories));
      return confirmed;
    },

    async delete(id) {
      const stableId = required(id, 'Memory ID');
      const records = [...await list()];
      const next = records.filter(memory => memory.id !== stableId);
      if (next.length === records.length) return false;
      await write(next);
      return true;
    },
  });
}

export const localDAVECaptureMemoryRepository = createDAVECaptureMemoryRepository();

async function hydrateRecords(
  storage: DAVECaptureMemoryStorage,
  write: (records: readonly DAVEConfirmedCaptureMemory[]) => Promise<void>,
): Promise<DAVEConfirmedCaptureMemory[]> {
  const raw = await storage.getItem(DAVE_CAPTURE_MEMORY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== DAVE_CAPTURE_MEMORY_REPOSITORY_VERSION || !Array.isArray(parsed.records)) {
      throw new Error('Stored capture memory envelope is invalid.');
    }
    const records: DAVEConfirmedCaptureMemory[] = [];
    let recovered = false;
    for (const value of parsed.records) {
      try {
        const memory = normalizeConfirmedMemory(value);
        if (records.some(item => item.id === memory.id)) {
          recovered = true;
          continue;
        }
        records.push(memory);
      } catch {
        recovered = true;
      }
    }
    const sorted = records.sort(compareMemories);
    if (recovered) await write(sorted);
    return sorted;
  } catch {
    await storage.removeItem(DAVE_CAPTURE_MEMORY_STORAGE_KEY);
    return [];
  }
}

function normalizeConfirmedMemory(value: unknown): DAVEConfirmedCaptureMemory {
  if (!isRecord(value)) throw new Error('Confirmed memory is invalid.');
  if (
    value.schemaVersion !== DAVE_CAPTURE_MEMORY_VERSION ||
    value.status !== 'confirmed' ||
    !clean(value.confirmedAt) ||
    value.cancelledAt !== null
  ) {
    throw new Error('Only PM-confirmed memories can be stored.');
  }
  const memory = {
    schemaVersion: value.schemaVersion,
    id: required(value.id, 'Memory ID'),
    status: value.status,
    transcript: required(value.transcript, 'Transcript'),
    transcriptEvidenceId: required(value.transcriptEvidenceId, 'Transcript evidence ID'),
    recommendedProject: normalizeRecommendation(value.recommendedProject, true, 'Project'),
    recommendedLocation: normalizeRecommendation(value.recommendedLocation, false, 'Location'),
    fields: normalizeFields(value.fields),
    evidence: normalizeEvidence(value.evidence),
    corrections: normalizeCorrections(value.corrections),
    createdAt: validTimestamp(value.createdAt, 'Created timestamp'),
    confirmedAt: validTimestamp(value.confirmedAt, 'Confirmation timestamp'),
    cancelledAt: value.cancelledAt,
  } as DAVEConfirmedCaptureMemory;
  if (!isConfirmedCaptureMemory(memory)) {
    throw new Error('Only PM-confirmed memories can be stored.');
  }
  if (!memory.evidence.some(item => item.id === memory.transcriptEvidenceId && item.kind === 'transcript')) {
    throw new Error('Transcript evidence link is required.');
  }
  return deepFreeze(memory);
}

function normalizeRecommendation(value: unknown, requiredValue: boolean, label: string): DAVECaptureRecommendation {
  if (!isRecord(value)) throw new Error(`${label} recommendation is invalid.`);
  const selected = optional(value.value);
  if (requiredValue && !selected) throw new Error(`${label} is required.`);
  if (selected && value.confirmed !== true) throw new Error(`${label} confirmation is required.`);
  if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every(item => typeof item === 'string')) {
    throw new Error(`${label} evidence links are invalid.`);
  }
  return {
    value: selected,
    confidence: normalizeConfidence(value.confidence),
    evidenceIds: [...value.evidenceIds],
    confirmed: Boolean(selected && value.confirmed),
  };
}

function normalizeFields(value: unknown): DAVECaptureMemoryFields {
  if (!isRecord(value)) throw new Error('Memory fields are invalid.');
  return {
    peopleOrCompany: optional(value.peopleOrCompany),
    commitment: optional(value.commitment),
    dueDate: optional(value.dueDate),
    decision: optional(value.decision),
    ownerRequest: optional(value.ownerRequest),
    inspectionChange: optional(value.inspectionChange),
    scheduleChange: optional(value.scheduleChange),
    issue: optional(value.issue),
    risk: optional(value.risk),
    followUp: optional(value.followUp),
    generalMemory: optional(value.generalMemory),
  };
}

function normalizeEvidence(value: unknown): DAVECaptureEvidenceLink[] {
  if (!Array.isArray(value)) throw new Error('Memory evidence is invalid.');
  const kinds: DAVECaptureEvidenceKind[] = ['transcript', 'project_record', 'location_record', 'pm_correction'];
  return value.map(item => {
    if (!isRecord(item) || !kinds.includes(item.kind as DAVECaptureEvidenceKind)) {
      throw new Error('Memory evidence entry is invalid.');
    }
    return {
      id: required(item.id, 'Evidence ID'),
      kind: item.kind as DAVECaptureEvidenceKind,
      sourceRecordId: required(item.sourceRecordId, 'Evidence source record ID'),
      summary: required(item.summary, 'Evidence summary'),
    };
  });
}

function normalizeCorrections(value: unknown): DAVECaptureCorrection[] {
  if (!Array.isArray(value)) throw new Error('Memory corrections are invalid.');
  const fields = new Set([
    'project', 'location', 'peopleOrCompany', 'commitment', 'dueDate', 'decision',
    'ownerRequest', 'inspectionChange', 'scheduleChange', 'issue', 'risk', 'followUp', 'generalMemory',
  ]);
  return value.map(item => {
    if (!isRecord(item) || typeof item.field !== 'string' || !fields.has(item.field)) {
      throw new Error('Memory correction is invalid.');
    }
    return {
      field: item.field as DAVECaptureCorrection['field'],
      previousValue: optional(item.previousValue),
      correctedValue: optional(item.correctedValue),
      correctedAt: validTimestamp(item.correctedAt, 'Correction timestamp'),
    };
  });
}

function normalizeConfidence(value: unknown): DAVECaptureConfidence {
  return value === 'high' || value === 'medium' || value === 'low' || value === 'unknown' ? value : 'unknown';
}

function compareMemories(a: DAVEConfirmedCaptureMemory, b: DAVEConfirmedCaptureMemory): number {
  return b.confirmedAt.localeCompare(a.confirmedAt) || a.id.localeCompare(b.id);
}

function assertSourceEvidencePreserved(
  existing: DAVEConfirmedCaptureMemory,
  next: DAVEConfirmedCaptureMemory,
): void {
  if (existing.transcript !== next.transcript || existing.transcriptEvidenceId !== next.transcriptEvidenceId) {
    throw new Error('A confirmed memory update must preserve its source transcript.');
  }
  const nextEvidence = new Map(next.evidence.map(item => [item.id, JSON.stringify(item)]));
  if (existing.evidence.some(item => nextEvidence.get(item.id) !== JSON.stringify(item))) {
    throw new Error('A confirmed memory update must preserve its linked evidence.');
  }
  const nextCorrections = new Set(next.corrections.map(item => JSON.stringify(item)));
  if (existing.corrections.some(item => !nextCorrections.has(JSON.stringify(item)))) {
    throw new Error('A confirmed memory update must preserve PM corrections.');
  }
}

function validTimestamp(value: unknown, label: string): string {
  const text = required(value, label);
  if (!Number.isFinite(new Date(text).getTime())) throw new Error(`${label} is invalid.`);
  return text;
}

function required(value: unknown, label: string): string {
  const text = clean(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function optional(value: unknown): string | null { return clean(value) || null; }
function clean(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function normalizeKey(value: unknown): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  Object.values(objectValue).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}
