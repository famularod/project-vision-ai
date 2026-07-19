/**
 * Secure Supabase auth token storage (audit finding P0-14 / P1-30).
 *
 * Auth session tokens previously lived in plain AsyncStorage, which is
 * readable on rooted devices and included in Android OS backups
 * (allowBackup). This adapter stores tokens with expo-secure-store
 * (Keychain / Android Keystore) instead.
 *
 * SecureStore values are limited to ~2048 bytes on some platforms, and a
 * Supabase session JSON can exceed that, so values are transparently
 * chunked across multiple SecureStore entries:
 *   `${key}.meta`                  -> JSON { v: 2, generation, chunks: n }
 *   `${key}.chunk.<generation>.N`  -> chunk payload
 *
 * Any legacy session found in AsyncStorage is migrated to SecureStore on
 * first read and then removed from AsyncStorage, so existing signed-in
 * users keep their session without ever re-persisting it insecurely.
 *
 * This mobile app fails closed when SecureStore is unavailable. It never
 * reads or writes a session token through AsyncStorage as a fallback. The
 * only AsyncStorage access is one-way legacy migration into verified secure
 * storage (or removal during sign-out/unavailable-storage cleanup).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1800;
const META_VERSION = 2;

type LegacyChunkMeta = Readonly<{ v: 1; chunks: number }>;
type ChunkMeta = Readonly<{ v: 2; generation: string; chunks: number }>;
type AnyChunkMeta = LegacyChunkMeta | ChunkMeta;

let secureAvailability: Promise<boolean> | null = null;
let operationTail: Promise<void> = Promise.resolve();
let generationSequence = 0;

function isSecureStoreAvailable(): Promise<boolean> {
  if (secureAvailability === null) {
    secureAvailability = (async () => {
      try {
        return await SecureStore.isAvailableAsync();
      } catch {
        return false;
      }
    })();
  }
  return secureAvailability;
}

/** SecureStore keys must match [A-Za-z0-9._-]. */
function sanitizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

function metaKey(key: string): string {
  return `${sanitizeKey(key)}.meta`;
}

function chunkKey(key: string, generation: string, index: number): string {
  return `${sanitizeKey(key)}.chunk.${generation}.${index}`;
}

function legacyChunkKey(key: string, index: number): string {
  return `${sanitizeKey(key)}.chunk.${index}`;
}

function parseMeta(raw: string | null): AnyChunkMeta | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      ((parsed as { v?: unknown }).v === 1 ||
        (parsed as { v?: unknown }).v === META_VERSION) &&
      typeof (parsed as { chunks?: unknown }).chunks === 'number' &&
      Number.isInteger((parsed as { chunks: number }).chunks) &&
      (parsed as { chunks: number }).chunks > 0
    ) {
      if ((parsed as { v: number }).v === 1) return parsed as LegacyChunkMeta;
      if (
        typeof (parsed as { generation?: unknown }).generation === 'string' &&
        /^[A-Za-z0-9_-]+$/.test((parsed as { generation: string }).generation)
      ) {
        return parsed as ChunkMeta;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

async function secureReadUnlocked(key: string): Promise<string | null> {
  const meta = parseMeta(await SecureStore.getItemAsync(metaKey(key)));
  if (meta === null) return null;
  const chunks: string[] = [];
  for (let i = 0; i < meta.chunks; i += 1) {
    const chunk = await SecureStore.getItemAsync(
      meta.v === 1
        ? legacyChunkKey(key, i)
        : chunkKey(key, meta.generation, i),
    );
    if (chunk === null) {
      // Torn/partial state: treat as absent rather than returning a
      // corrupted session, and clean up what remains.
      await secureRemoveUnlocked(key);
      return null;
    }
    chunks.push(chunk);
  }
  return chunks.join('');
}

async function secureWriteUnlocked(key: string, value: string): Promise<void> {
  const previous = parseMeta(await SecureStore.getItemAsync(metaKey(key)));
  const chunkCount = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
  const generation = nextGeneration();

  try {
    for (let i = 0; i < chunkCount; i += 1) {
      await SecureStore.setItemAsync(
        chunkKey(key, generation, i),
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
    // Publish the new generation only after all of its chunks exist. Until
    // this single manifest write succeeds, readers continue using the prior
    // generation without observing mixed old/new token bytes.
    await SecureStore.setItemAsync(
      metaKey(key),
      JSON.stringify({ v: META_VERSION, generation, chunks: chunkCount }),
    );
  } catch (error) {
    await deleteGenerationBestEffort(key, generation, chunkCount);
    throw error;
  }

  if (previous !== null) await deleteMetaChunksBestEffort(key, previous);
}

async function secureRemoveUnlocked(key: string): Promise<void> {
  const meta = parseMeta(await SecureStore.getItemAsync(metaKey(key)));
  await SecureStore.deleteItemAsync(metaKey(key));
  if (meta !== null) await deleteMetaChunksBestEffort(key, meta);
  // Defensive sweep for a legacy chunk 0 orphaned by a torn v1 write.
  await SecureStore.deleteItemAsync(legacyChunkKey(key, 0));
}

async function migrateLegacyValueUnlocked(key: string): Promise<string | null> {
  const legacy = await AsyncStorage.getItem(key);
  if (legacy === null) return null;
  await secureWriteUnlocked(key, legacy);
  // Only remove the insecure copy once the secure write round-trips.
  const verified = await secureReadUnlocked(key);
  if (verified === legacy) {
    await AsyncStorage.removeItem(key);
    return verified;
  }
  throw new Error('Secure auth token migration could not be verified.');
}

/**
 * True when tokens can be protected by SecureStore. False means auth must
 * fail closed; there is deliberately no plaintext fallback.
 */
export async function isAuthStorageSecure(): Promise<boolean> {
  return isSecureStoreAvailable();
}

/** Supabase `auth.storage` adapter. */
export const supabaseSecureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    return serializeAuthStorageOperation(async () => {
      if (!(await isSecureStoreAvailable())) {
        // Never hydrate a plaintext legacy token when secure storage is not
        // available. Best-effort removal prevents backup/root exposure.
        await AsyncStorage.removeItem(key).catch(() => undefined);
        return null;
      }
      const stored = await secureReadUnlocked(key);
      if (stored !== null) return stored;
      return migrateLegacyValueUnlocked(key);
    });
  },

  async setItem(key: string, value: string): Promise<void> {
    return serializeAuthStorageOperation(async () => {
      if (!(await isSecureStoreAvailable())) {
        await AsyncStorage.removeItem(key).catch(() => undefined);
        throw new Error(
          'Secure auth storage is unavailable; the session was not persisted.',
        );
      }
      await secureWriteUnlocked(key, value);
      // A copy must never linger in AsyncStorage once secure writes work.
      await AsyncStorage.removeItem(key);
    });
  },

  async removeItem(key: string): Promise<void> {
    return serializeAuthStorageOperation(async () => {
      if (await isSecureStoreAvailable()) {
        await secureRemoveUnlocked(key);
      }
      // Sign-out/cleanup must remove any legacy plaintext copy even if the
      // secure-store native module is unavailable.
      await AsyncStorage.removeItem(key);
    });
  },
};

function nextGeneration(): string {
  generationSequence += 1;
  return `${Date.now().toString(36)}_${generationSequence.toString(36)}`;
}

async function deleteMetaChunksBestEffort(
  key: string,
  meta: AnyChunkMeta,
): Promise<void> {
  for (let i = 0; i < meta.chunks; i += 1) {
    const keyToDelete = meta.v === 1
      ? legacyChunkKey(key, i)
      : chunkKey(key, meta.generation, i);
    try {
      await SecureStore.deleteItemAsync(keyToDelete);
    } catch {
      // The published manifest no longer references this stale generation,
      // so cleanup failure cannot corrupt the active session.
    }
  }
}

async function deleteGenerationBestEffort(
  key: string,
  generation: string,
  chunks: number,
): Promise<void> {
  await deleteMetaChunksBestEffort(key, {
    v: META_VERSION,
    generation,
    chunks,
  });
}

function serializeAuthStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationTail.then(operation, operation);
  operationTail = result.then(() => undefined, () => undefined);
  return result;
}

/** Test-only: reset cached SecureStore availability. */
export function resetAuthStorageAvailabilityForTests(): void {
  secureAvailability = null;
  operationTail = Promise.resolve();
  generationSequence = 0;
}
