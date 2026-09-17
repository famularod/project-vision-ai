import AsyncStorage from '@react-native-async-storage/async-storage';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';

import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';

export const FIELD_NOTE_VERSION = 'vitruvius-field-note/1.0' as const;
export const FIELD_NOTE_REPOSITORY_VERSION = 'vitruvius-field-note-repository/1.0' as const;
export const FIELD_NOTE_STORAGE_KEY_PREFIX = '@vitruvius/field-notes/v1';

export type FieldNoteSource = 'typed' | 'voice';
export type FieldNoteStatus = 'open' | 'resolved' | 'archived';
export type FieldNoteSyncState = 'pending' | 'synced' | 'conflict';
export type FieldNoteActionKind =
  | 'none'
  | 'follow_up'
  | 'task_candidate'
  | 'issue_candidate'
  | 'safety_candidate';

export type FieldNote = Readonly<{
  schemaVersion: typeof FIELD_NOTE_VERSION;
  id: string;
  originalText: string;
  source: FieldNoteSource;
  projectId: string | null;
  projectName: string | null;
  locationName: string | null;
  actionKind: FieldNoteActionKind;
  actionText: string | null;
  status: FieldNoteStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  archivedAt: string | null;
  revision: number;
  cloudUpdatedAt: string | null;
  syncState: FieldNoteSyncState;
  syncError: string | null;
}>; 

export type CreateFieldNoteInput = Readonly<{
  id: string;
  text: string;
  source?: FieldNoteSource;
  projectId?: string | null;
  projectName?: string | null;
  locationName?: string | null;
  actionKind?: FieldNoteActionKind;
  actionText?: string | null;
  now?: string;
}>;

export type FieldNoteStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;

type StoredFieldNotes = Readonly<{
  schemaVersion: typeof FIELD_NOTE_REPOSITORY_VERSION;
  records: readonly FieldNote[];
}>;

export function fieldNoteStorageKey(ownerKey: string): string {
  return `${FIELD_NOTE_STORAGE_KEY_PREFIX}.owner.${encodeURIComponent(required(ownerKey, 'Owner'))}`;
}

export function createFieldNote(input: CreateFieldNoteInput): FieldNote {
  const now = validTimestamp(input.now ?? new Date().toISOString(), 'Created timestamp');
  const actionKind = normalizeActionKind(input.actionKind ?? 'none');
  const actionText = optional(input.actionText);
  return deepFreeze({
    schemaVersion: FIELD_NOTE_VERSION,
    id: boundedRequired(input.id, 'Field note ID', 160),
    originalText: boundedRequired(input.text, 'Field note', 10_000),
    source: normalizeSource(input.source ?? 'typed'),
    projectId: boundedOptional(input.projectId, 'Project ID', 200),
    projectName: boundedOptional(input.projectName, 'Project name', 500),
    locationName: boundedOptional(input.locationName, 'Location', 500),
    actionKind,
    actionText: actionKind === 'none' ? null : boundedOptional(actionText, 'Possible next step', 2_000),
    status: 'open',
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    archivedAt: null,
    revision: 0,
    cloudUpdatedAt: null,
    syncState: 'pending',
    syncError: null,
  });
}

export function createFieldNoteId(now = Date.now(), random = Math.random()): string {
  const safeNow = Number.isFinite(now) ? Math.max(0, Math.floor(now)) : Date.now();
  const safeRandom = Number.isFinite(random) ? Math.min(0.999999999, Math.max(0, random)) : 0;
  return `field-note-${safeNow.toString(36)}-${Math.floor(safeRandom * 0x100000000).toString(36)}`;
}

export function updateFieldNoteStatus(
  note: FieldNote,
  status: FieldNoteStatus,
  now = new Date().toISOString(),
): FieldNote {
  const current = normalizeFieldNote(note);
  const updatedAt = validTimestamp(now, 'Updated timestamp');
  return deepFreeze({
    ...current,
    status: normalizeStatus(status),
    updatedAt,
    resolvedAt: status === 'resolved' ? updatedAt : null,
    archivedAt: status === 'archived' ? updatedAt : null,
    syncState: 'pending',
    syncError: null,
  });
}

export function updateFieldNoteDetails(
  note: FieldNote,
  input: Readonly<{
    text: string;
    projectId?: string | null;
    projectName?: string | null;
    locationName?: string | null;
    actionKind?: FieldNoteActionKind;
    actionText?: string | null;
    status?: FieldNoteStatus;
    now?: string;
  }>,
): FieldNote {
  const current = normalizeFieldNote(note);
  const updatedAt = validTimestamp(input.now ?? new Date().toISOString(), 'Updated timestamp');
  const status = normalizeStatus(input.status ?? current.status);
  const actionKind = normalizeActionKind(input.actionKind ?? current.actionKind);
  return deepFreeze({
    ...current,
    originalText: boundedRequired(input.text, 'Field note', 10_000),
    projectId: boundedOptional(input.projectId, 'Project ID', 200),
    projectName: boundedOptional(input.projectName, 'Project name', 500),
    locationName: boundedOptional(input.locationName, 'Location', 500),
    actionKind,
    actionText: actionKind === 'none' ? null : boundedOptional(input.actionText, 'Possible next step', 2_000),
    status,
    updatedAt,
    resolvedAt: status === 'resolved'
      ? current.status === 'resolved' && current.resolvedAt ? current.resolvedAt : updatedAt
      : null,
    archivedAt: status === 'archived'
      ? current.status === 'archived' && current.archivedAt ? current.archivedAt : updatedAt
      : null,
    syncState: 'pending',
    syncError: null,
  });
}

export function markFieldNoteSynced(
  note: FieldNote,
  revision: number,
  cloudUpdatedAt: string,
): FieldNote {
  const current = normalizeFieldNote(note);
  return deepFreeze({
    ...current,
    revision: positiveInteger(revision, 'Field note revision'),
    cloudUpdatedAt: validTimestamp(cloudUpdatedAt, 'Cloud updated timestamp'),
    syncState: 'synced' as const,
    syncError: null,
  });
}

export function markFieldNoteConflict(note: FieldNote, message: string): FieldNote {
  const current = normalizeFieldNote(note);
  return deepFreeze({
    ...current,
    syncState: 'conflict' as const,
    syncError: required(message, 'Conflict message'),
  });
}

export function createFieldNoteRepository(storage: FieldNoteStorage = AsyncStorage) {
  const exclusive = <T>(ownerKey: string, operation: () => Promise<T>) =>
    runExclusiveLocalStorageMutation([fieldNoteStorageKey(ownerKey)], operation);
  const read = async (ownerKey: string) => Object.freeze(await hydrateRecords(storage, ownerKey));
  async function list(ownerKey: string): Promise<readonly FieldNote[]> {
    // Hydration can quarantine/repair bytes, so it participates in the same lock.
    return exclusive(ownerKey, () => read(ownerKey));
  }

  async function write(ownerKey: string, records: readonly FieldNote[]): Promise<void> {
    const key = fieldNoteStorageKey(ownerKey);
    const raw = JSON.stringify(fieldNoteRepositoryStorageValue(records));
    await storage.setItem(key, raw);
    if (await storage.getItem(key) !== raw) {
      throw new Error('Field notes could not be verified after saving.');
    }
  }

  return Object.freeze({
    list,
    async save(ownerKey: string, note: FieldNote): Promise<FieldNote> {
      return exclusive(ownerKey, async () => {
        const normalized = normalizeFieldNote(note);
        const records = [...await read(ownerKey)];
        const existing = records.find(item => item.id === normalized.id);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
            throw new Error('A different field note already uses this ID.');
          }
          return existing;
        }
        await write(ownerKey, [...records, normalized].sort(compareFieldNotes));
        return normalized;
      });
    },
    async updateStatus(
      ownerKey: string,
      id: string,
      status: FieldNoteStatus,
      now?: string,
    ): Promise<FieldNote> {
      return exclusive(ownerKey, async () => {
        const stableId = required(id, 'Field note ID');
        const records = [...await read(ownerKey)];
        const index = records.findIndex(item => item.id === stableId);
        if (index < 0) throw new Error('Field note was not found.');
        const updated = updateFieldNoteStatus(records[index], status, now);
        records[index] = updated;
        await write(ownerKey, records.sort(compareFieldNotes));
        return updated;
      });
    },
    async replace(ownerKey: string, note: FieldNote): Promise<FieldNote> {
      return exclusive(ownerKey, async () => {
        const normalized = normalizeFieldNote(note);
        const records = [...await read(ownerKey)];
        const index = records.findIndex(item => item.id === normalized.id);
        if (index < 0) throw new Error('Field note was not found.');
        records[index] = normalized;
        await write(ownerKey, records.sort(compareFieldNotes));
        return normalized;
      });
    },
    async replaceIfUnchanged(ownerKey: string, expected: FieldNote, replacement: FieldNote): Promise<FieldNote> {
      return exclusive(ownerKey, async () => {
        const records = [...await read(ownerKey)];
        const index = records.findIndex(item => item.id === expected.id);
        if (index < 0) throw new Error('Field note was not found.');
        if (JSON.stringify(records[index]) !== JSON.stringify(normalizeFieldNote(expected))) return records[index];
        const next = normalizeFieldNote(replacement);
        if (next.id !== expected.id) throw new Error('Field note identity changed during synchronization.');
        records[index] = next;
        await write(ownerKey, records.sort(compareFieldNotes));
        return next;
      });
    },
    async merge(ownerKey: string, mergeRecords: (current: readonly FieldNote[]) => readonly FieldNote[]): Promise<readonly FieldNote[]> {
      return exclusive(ownerKey, async () => {
        // Calculate against the latest durable notes INSIDE the mutation lock.
        const normalized = mergeRecords(await read(ownerKey)).map(normalizeFieldNote).sort(compareFieldNotes);
        if (new Set(normalized.map(note => note.id)).size !== normalized.length) throw new Error('Field notes contain duplicate IDs.');
        await write(ownerKey, normalized);
        return Object.freeze(normalized);
      });
    },
    async replaceAll(ownerKey: string, records: readonly FieldNote[]): Promise<readonly FieldNote[]> {
      return exclusive(ownerKey, async () => {
        const normalized = records.map(normalizeFieldNote).sort(compareFieldNotes);
        if (new Set(normalized.map(note => note.id)).size !== normalized.length) {
          throw new Error('Field notes contain duplicate IDs.');
        }
        await write(ownerKey, normalized);
        return Object.freeze(normalized);
      });
    },
  });
}

export const localFieldNoteRepository = createFieldNoteRepository();

export function fieldNoteRepositoryStorageValue(records: readonly FieldNote[]): StoredFieldNotes {
  return {
    schemaVersion: FIELD_NOTE_REPOSITORY_VERSION,
    records: records.map(normalizeFieldNote).sort(compareFieldNotes),
  };
}

export function normalizeFieldNote(value: unknown): FieldNote {
  if (!isRecord(value) || value.schemaVersion !== FIELD_NOTE_VERSION) {
    throw new Error('Field note is invalid.');
  }
  const status = normalizeStatus(value.status);
  const actionKind = normalizeActionKind(value.actionKind);
  const createdAt = validTimestamp(value.createdAt, 'Created timestamp');
  const updatedAt = validTimestamp(value.updatedAt, 'Updated timestamp');
  const resolvedAt = optionalTimestamp(value.resolvedAt, 'Resolved timestamp');
  const archivedAt = optionalTimestamp(value.archivedAt, 'Archived timestamp');
  if (status === 'resolved' && !resolvedAt) throw new Error('Resolved field note timestamp is required.');
  if (status === 'archived' && !archivedAt) throw new Error('Archived field note timestamp is required.');
  if (status === 'open' && (resolvedAt || archivedAt)) throw new Error('Open field note cannot have a closure timestamp.');
  return deepFreeze({
    schemaVersion: FIELD_NOTE_VERSION,
    id: boundedRequired(value.id, 'Field note ID', 160),
    originalText: boundedRequired(value.originalText, 'Field note', 10_000),
    source: normalizeSource(value.source),
    projectId: boundedOptional(value.projectId, 'Project ID', 200),
    projectName: boundedOptional(value.projectName, 'Project name', 500),
    locationName: boundedOptional(value.locationName, 'Location', 500),
    actionKind,
    actionText: actionKind === 'none' ? null : boundedOptional(value.actionText, 'Possible next step', 2_000),
    status,
    createdAt,
    updatedAt,
    resolvedAt: status === 'resolved' ? resolvedAt : null,
    archivedAt: status === 'archived' ? archivedAt : null,
    revision: optionalNonNegativeInteger(value.revision, 'Field note revision'),
    cloudUpdatedAt: optionalTimestamp(value.cloudUpdatedAt, 'Cloud updated timestamp'),
    syncState: normalizeSyncState(value.syncState),
    syncError: optional(value.syncError),
  });
}

async function hydrateRecords(storage: FieldNoteStorage, ownerKey: string): Promise<FieldNote[]> {
  const key = fieldNoteStorageKey(ownerKey);
  const raw = await storage.getItem(key);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    const recovery = await quarantineCorruptLocalValue({
      storage,
      storageKey: key,
      quarantineKeyPrefix: `${key}.corrupt.`,
      raw,
      replacementRaw: null,
    });
    throw localCorruptionRecoveryError({ label: 'Stored field notes', recovery });
  }

  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== FIELD_NOTE_REPOSITORY_VERSION ||
    !Array.isArray(parsed.records)
  ) {
    const recovery = await quarantineCorruptLocalValue({
      storage,
      storageKey: key,
      quarantineKeyPrefix: `${key}.corrupt.`,
      raw,
      replacementRaw: null,
    });
    throw localCorruptionRecoveryError({ label: 'Stored field notes', recovery });
  }

  const records: FieldNote[] = [];
  let recovered = false;
  for (const value of parsed.records) {
    try {
      const note = normalizeFieldNote(value);
      if (records.some(item => item.id === note.id)) {
        recovered = true;
        continue;
      }
      records.push(note);
    } catch {
      recovered = true;
    }
  }
  const sorted = records.sort(compareFieldNotes);
  if (recovered) {
    const recovery = await quarantineCorruptLocalValue({
      storage,
      storageKey: key,
      quarantineKeyPrefix: `${key}.corrupt.`,
      raw,
      replacementRaw: JSON.stringify(fieldNoteRepositoryStorageValue(sorted)),
    });
    throw localCorruptionRecoveryError({
      label: 'Stored field notes',
      recovery,
      salvagedRecords: sorted.length,
    });
  }
  return sorted;
}

function compareFieldNotes(left: FieldNote, right: FieldNote): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    left.id.localeCompare(right.id);
}

function normalizeSource(value: unknown): FieldNoteSource {
  if (value === 'typed' || value === 'voice') return value;
  throw new Error('Field note source is invalid.');
}

function normalizeStatus(value: unknown): FieldNoteStatus {
  if (value === 'open' || value === 'resolved' || value === 'archived') return value;
  throw new Error('Field note status is invalid.');
}

function normalizeSyncState(value: unknown): FieldNoteSyncState {
  if (value === 'synced' || value === 'conflict') return value;
  return 'pending';
}

function normalizeActionKind(value: unknown): FieldNoteActionKind {
  if (
    value === 'none' ||
    value === 'follow_up' ||
    value === 'task_candidate' ||
    value === 'issue_candidate' ||
    value === 'safety_candidate'
  ) return value;
  throw new Error('Field note action type is invalid.');
}

function required(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.includes('\0')) throw new Error(`${label} is required.`);
  return normalized;
}

function optional(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  return required(value, 'Optional value');
}

function boundedRequired(value: unknown, label: string, maxLength: number): string {
  const normalized = required(value, label);
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function boundedOptional(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  const normalized = optional(value);
  if (normalized && normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function validTimestamp(value: unknown, label: string): string {
  const timestamp = required(value, label);
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) throw new Error(`${label} is invalid.`);
  return instant.toISOString();
}

function optionalTimestamp(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : validTimestamp(value, label);
}

function optionalNonNegativeInteger(value: unknown, label: string): number {
  if (value === null || value === undefined) return 0;
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid.`);
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${label} is invalid.`);
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}
