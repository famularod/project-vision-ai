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
 *   `${key}.meta`     -> JSON { v: 1, chunks: n }
 *   `${key}.chunk.N`  -> chunk payload
 *
 * Any legacy session found in AsyncStorage is migrated to SecureStore on
 * first read and then removed from AsyncStorage, so existing signed-in
 * users keep their session without ever re-persisting it insecurely.
 *
 * If SecureStore is unavailable (e.g. web or a misconfigured build), the
 * adapter falls back to AsyncStorage and reports itself as not secure via
 * `isAuthStorageSecure()`; callers surface that as a degraded state rather
 * than silently pretending tokens are protected.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1800;
const META_VERSION = 1;

type ChunkMeta = Readonly<{ v: number; chunks: number }>;

let secureAvailability: Promise<boolean> | null = null;

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

function chunkKey(key: string, index: number): string {
  return `${sanitizeKey(key)}.chunk.${index}`;
}

function parseMeta(raw: string | null): ChunkMeta | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { v?: unknown }).v === META_VERSION &&
      typeof (parsed as { chunks?: unknown }).chunks === 'number' &&
      Number.isInteger((parsed as { chunks: number }).chunks) &&
      (parsed as { chunks: number }).chunks >= 0
    ) {
      return parsed as ChunkMeta;
    }
    return null;
  } catch {
    return null;
  }
}

async function secureRead(key: string): Promise<string | null> {
  const meta = parseMeta(await SecureStore.getItemAsync(metaKey(key)));
  if (meta === null) return null;
  const chunks: string[] = [];
  for (let i = 0; i < meta.chunks; i += 1) {
    const chunk = await SecureStore.getItemAsync(chunkKey(key, i));
    if (chunk === null) {
      // Torn/partial state: treat as absent rather than returning a
      // corrupted session, and clean up what remains.
      await secureRemove(key);
      return null;
    }
    chunks.push(chunk);
  }
  return chunks.join('');
}

async function secureWrite(key: string, value: string): Promise<void> {
  const previous = parseMeta(await SecureStore.getItemAsync(metaKey(key)));
  const chunkCount = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
  for (let i = 0; i < chunkCount; i += 1) {
    await SecureStore.setItemAsync(
      chunkKey(key, i),
      value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
    );
  }
  // Meta written last so a torn write is detected as absent, never as a
  // truncated session.
  await SecureStore.setItemAsync(
    metaKey(key),
    JSON.stringify({ v: META_VERSION, chunks: chunkCount }),
  );
  if (previous !== null && previous.chunks > chunkCount) {
    for (let i = chunkCount; i < previous.chunks; i += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
  }
}

async function secureRemove(key: string): Promise<void> {
  const meta = parseMeta(await SecureStore.getItemAsync(metaKey(key)));
  await SecureStore.deleteItemAsync(metaKey(key));
  const knownChunks = meta === null ? 0 : meta.chunks;
  for (let i = 0; i < knownChunks; i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
  // Defensive sweep for a chunk 0 orphaned by a torn write with no meta.
  await SecureStore.deleteItemAsync(chunkKey(key, 0));
}

async function migrateLegacyValue(key: string): Promise<string | null> {
  const legacy = await AsyncStorage.getItem(key);
  if (legacy === null) return null;
  await secureWrite(key, legacy);
  // Only remove the insecure copy once the secure write round-trips.
  const verified = await secureRead(key);
  if (verified === legacy) {
    await AsyncStorage.removeItem(key);
    return verified;
  }
  return legacy;
}

/**
 * True when tokens are actually protected by SecureStore. False means the
 * AsyncStorage fallback is active and the caller should treat auth storage
 * as degraded (see buildSessionTokenLookup / storageAvailable reporting).
 */
export async function isAuthStorageSecure(): Promise<boolean> {
  return isSecureStoreAvailable();
}

/** Supabase `auth.storage` adapter. */
export const supabaseSecureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!(await isSecureStoreAvailable())) {
      return AsyncStorage.getItem(key);
    }
    const stored = await secureRead(key);
    if (stored !== null) return stored;
    return migrateLegacyValue(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!(await isSecureStoreAvailable())) {
      await AsyncStorage.setItem(key, value);
      return;
    }
    await secureWrite(key, value);
    // A copy must never linger in AsyncStorage once secure writes work.
    await AsyncStorage.removeItem(key);
  },

  async removeItem(key: string): Promise<void> {
    if (!(await isSecureStoreAvailable())) {
      await AsyncStorage.removeItem(key);
      return;
    }
    await secureRemove(key);
    await AsyncStorage.removeItem(key);
  },
};

/** Test-only: reset cached SecureStore availability. */
export function resetAuthStorageAvailabilityForTests(): void {
  secureAvailability = null;
}
