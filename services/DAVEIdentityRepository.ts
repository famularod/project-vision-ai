import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  normalizeDAVEIdentityName,
  type DAVEEntityKind,
  type DAVEIdentityCorrection,
} from './DAVEIdentity';

export const DAVE_IDENTITY_REPOSITORY_VERSION = 'dave-identity-repository/1.0' as const;
export const DAVE_IDENTITY_STORAGE_KEY = '@dave/identity-corrections/v1';

export type DAVEIdentityStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;

export type DAVEIdentityRepository = Readonly<{
  save(correction: DAVEIdentityCorrection): Promise<DAVEIdentityCorrection>;
  list(): Promise<readonly DAVEIdentityCorrection[]>;
  delete(id: string): Promise<boolean>;
}>;

type StoredDAVEIdentityCorrections = {
  schemaVersion: typeof DAVE_IDENTITY_REPOSITORY_VERSION;
  records: DAVEIdentityCorrection[];
};

export function createDAVEIdentityRepository(
  storage: DAVEIdentityStorage = AsyncStorage,
): DAVEIdentityRepository {
  async function write(records: readonly DAVEIdentityCorrection[]) {
    const value: StoredDAVEIdentityCorrections = {
      schemaVersion: DAVE_IDENTITY_REPOSITORY_VERSION,
      records: [...records],
    };
    await storage.setItem(DAVE_IDENTITY_STORAGE_KEY, JSON.stringify(value));
  }

  async function list() {
    return Object.freeze((await hydrateCorrections(storage, write)).sort(compareCorrections));
  }

  return Object.freeze({
    async save(value) {
      const correction = normalizeCorrection(value);
      const records = [...await list()];
      const existing = records.find(item => item.id === correction.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(correction)) {
          throw new Error('An identity correction with this ID already exists.');
        }
        return existing;
      }
      const supersededKey = correctionKey(correction);
      const next = records.filter(item => correctionKey(item) !== supersededKey);
      await write([...next, correction].sort(compareCorrections));
      return correction;
    },

    list,

    async delete(id) {
      const stableId = required(id, 'Correction ID');
      const records = [...await list()];
      const next = records.filter(item => item.id !== stableId);
      if (next.length === records.length) return false;
      await write(next);
      return true;
    },
  });
}

export const localDAVEIdentityRepository = createDAVEIdentityRepository();

async function hydrateCorrections(
  storage: DAVEIdentityStorage,
  write: (records: readonly DAVEIdentityCorrection[]) => Promise<void>,
) {
  const raw = await storage.getItem(DAVE_IDENTITY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== DAVE_IDENTITY_REPOSITORY_VERSION ||
      !Array.isArray(parsed.records)
    ) {
      throw new Error('Stored identity correction envelope is invalid.');
    }
    const records: DAVEIdentityCorrection[] = [];
    let recovered = false;
    for (const value of parsed.records) {
      try {
        const correction = normalizeCorrection(value);
        const duplicate = records.some(item => item.id === correction.id);
        if (duplicate) {
          recovered = true;
        } else {
          records.push(correction);
        }
      } catch {
        recovered = true;
      }
    }
    if (recovered) await write(records);
    return records;
  } catch {
    await storage.removeItem(DAVE_IDENTITY_STORAGE_KEY);
    return [];
  }
}

function normalizeCorrection(value: unknown): DAVEIdentityCorrection {
  if (!isRecord(value)) throw new Error('Identity correction is invalid.');
  const kinds: DAVEEntityKind[] = ['project', 'area', 'task', 'person', 'company', 'asset'];
  if (!kinds.includes(value.kind as DAVEEntityKind)) {
    throw new Error('Identity correction kind is invalid.');
  }
  const rawName = required(value.rawName, 'Raw identity');
  const canonicalName = required(value.canonicalName, 'Canonical identity');
  if (normalizeDAVEIdentityName(rawName) === normalizeDAVEIdentityName(canonicalName)) {
    throw new Error('An identity correction must change the normalized identity.');
  }
  return Object.freeze({
    id: required(value.id, 'Correction ID'),
    kind: value.kind as DAVEEntityKind,
    rawName,
    canonicalName,
    parentProjectName: optional(value.parentProjectName),
    sourceRecordId: required(value.sourceRecordId, 'Source record ID'),
    confirmedAt: validTimestamp(value.confirmedAt),
    confirmedBy: required(value.confirmedBy, 'Confirmed by'),
  });
}

function correctionKey(value: DAVEIdentityCorrection) {
  return [
    value.kind,
    normalizeDAVEIdentityName(value.parentProjectName),
    normalizeDAVEIdentityName(value.rawName),
  ].join('|');
}

function compareCorrections(left: DAVEIdentityCorrection, right: DAVEIdentityCorrection) {
  return right.confirmedAt.localeCompare(left.confirmedAt) || left.id.localeCompare(right.id);
}

function validTimestamp(value: unknown) {
  const timestamp = required(value, 'Confirmation timestamp');
  if (!Number.isFinite(new Date(timestamp).getTime())) {
    throw new Error('Confirmation timestamp is invalid.');
  }
  return timestamp;
}

function required(value: unknown, label: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function optional(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
