/**
 * Whole-app audit A4 pass 15 L2 (30 Sep 2026), extending A7 pass 12 M-1: the
 * saved conflicts behind the field update cards ("Needs Review") were read
 * once per launch, then kept by this phone's own conflict writes. Switching
 * accounts swaps the stored conflicts in place (the owner storage sandbox),
 * with no conflict write: account B's updates held in conflict read as
 * waiting until a relaunch, and account A's conflicts were still the ones the
 * cards read. The list is now read again when the sandbox switches accounts,
 * as is the queue behind "Document change waiting to sync".
 *
 * The real owner storage sandbox, SyncService conflict store and card
 * snapshot, on an in-memory AsyncStorage.
 */
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStorage.get(key) ?? null])),
    multiSet: jest.fn(async (pairs: Array<[string, string]>) => { pairs.forEach(([key, value]) => mockStorage.set(key, value)); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
  };
  return { __esModule: true, default: api, ...api };
});
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: 'file:///phone/Documents/',
  cacheDirectory: 'file:///phone/Library/Caches/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fieldUpdateConflictsSnapshot,
  fieldUpdateDocumentChangeWaiting,
  fieldUpdateHasOpenConflict,
  queuedDocumentChangesSnapshot,
  subscribeToFieldUpdateConflicts,
  subscribeToQueuedDocumentChanges,
} from '../../services/FieldUpdateDocumentChangeNotice';
import { createOwnerStorageSandbox } from '../../services/OwnerStorageSandbox';
import { clearResolvedConflict } from '../../services/SyncService';

const CONFLICTS_KEY = 'projectVisionAI.syncConflicts.v1';
const QUEUE_KEY = 'projectVisionAI.syncQueue.v1';
const conflictFor = (updateId: string) => ({
  id: `project_update_conflict-${updateId}`, entity: 'project_update', localId: updateId,
  localChangedAt: '2026-09-28T09:00:00.000Z', remoteChangedAt: '2026-09-28T10:00:00.000Z',
  reason: 'Remote update changed after the local pending change.', detectedAt: '2026-09-28T10:05:00.000Z',
  localPayload: { id: updateId, updateData: { id: updateId, notes: 'Typed on the phone with no signal' } },
  remotePayload: { id: updateId, notes: 'Typed on the iPad' },
});
/** A document taken off a sent update, its upload refused: its card says the change waits. */
const waitingPatchFor = (updateId: string) => ({
  id: `project-update-${updateId}`, entity: 'project_update', operation: 'update',
  payload: { id: updateId, updateData: { id: updateId, status: 'sent' }, documentPatches: [{ documentId: 'permit', remove: true }], pendingPhotoAssetIds: [] },
  createdAt: '2026-09-28T09:00:00.000Z', changedAt: '2026-09-28T09:00:00.000Z', retryCount: 1, lastError: 'Network request failed',
});
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve)); };
const needsReview = (updateId: string) => fieldUpdateHasOpenConflict(fieldUpdateConflictsSnapshot(), updateId);
const changeWaits = (updateId: string) => fieldUpdateDocumentChangeWaiting(queuedDocumentChangesSnapshot(), updateId).shown;

it('switching accounts reads the saved conflicts and the queue again: account B\'s held cards read Needs Review, A\'s no longer do', async () => {
  const sandbox = createOwnerStorageSandbox({ storage: AsyncStorage as never });
  // Account B, earlier on this phone: an update held in conflict, a document change waiting.
  await sandbox.activateOwner('owner-b');
  mockStorage.set(CONFLICTS_KEY, JSON.stringify([conflictFor('u-b')]));
  mockStorage.set(QUEUE_KEY, JSON.stringify([waitingPatchFor('u-b')]));
  // Account A now, with its own conflict; the cards are showing.
  await sandbox.activateOwner('owner-a');
  mockStorage.set(CONFLICTS_KEY, JSON.stringify([conflictFor('u-a')]));
  mockStorage.set(QUEUE_KEY, JSON.stringify([waitingPatchFor('u-a')]));
  subscribeToFieldUpdateConflicts(() => undefined);
  subscribeToQueuedDocumentChanges(() => undefined);
  await settle();
  expect(needsReview('u-a')).toBe(true);
  expect(changeWaits('u-a')).toBe(true);

  await sandbox.activateOwner('owner-b');
  await settle();
  expect(JSON.parse(mockStorage.get(CONFLICTS_KEY)!)).toEqual([conflictFor('u-b')]); // the sandbox swapped them in place
  expect(needsReview('u-b')).toBe(true);
  expect(needsReview('u-a')).toBe(false);
  expect(changeWaits('u-b')).toBe(true);
  expect(changeWaits('u-a')).toBe(false);

  // And this phone's own writes keep them, as before.
  await clearResolvedConflict(conflictFor('u-b').id);
  expect(needsReview('u-b')).toBe(false);
});
