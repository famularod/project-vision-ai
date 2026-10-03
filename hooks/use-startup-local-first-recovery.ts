import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AppState } from 'react-native';

import type { DAVESyncTombstone } from '../types';
import type { StartupStorageReadResult } from '../services/StartupRecovery';

type CloudCollectionResult<T> = {
  ok: boolean;
  data: T[] | null;
};

type TombstoneSyncResult = {
  cloudAuthoritative: boolean;
  tombstones: DAVESyncTombstone[];
};

/**
 * After a failed first download: 30 s, 2 min, 5 min, then every 10 min, and
 * whenever the app returns to the foreground.
 */
const CLOUD_BOOTSTRAP_RETRY_DELAYS_MS = [30_000, 120_000, 300_000, 600_000];

/**
 * Loads and applies a required local collection first. Cloud recovery is a
 * missing-key-only bootstrap; a present local key (including `[]`) can only
 * receive cloud-only records through the explicit Sync workflow. A failed
 * download is retried until it lands or the collection is edited here: the
 * refresh skips a collection that never loaded, so one failed request on a
 * new device left it empty all session, inviting a re-import (whole-app audit
 * A2 M5). Returns whether the first download is still pending.
 */
export function useStartupLocalFirstRecovery<TLocal, TCloud, TRecord>({
  retryAttempt,
  startupReady,
  localLoaded,
  localAuthorityReady,
  localAuthorityRef,
  resetLocalLoaded,
  readLocal,
  acceptLocal,
  normalizeLocal,
  applyLocal,
  onLocalError,
  loadCloud,
  synchronizeTombstones,
  normalizeCloud,
  applyCloud,
  onCloudApplied,
  onCloudDeferred,
}: {
  retryAttempt: number;
  startupReady: boolean;
  localLoaded: boolean;
  localAuthorityReady: boolean;
  localAuthorityRef: MutableRefObject<boolean>;
  resetLocalLoaded: () => void;
  readLocal: () => Promise<StartupStorageReadResult<TLocal[]>>;
  acceptLocal: (result: StartupStorageReadResult<TLocal[]>) => boolean;
  normalizeLocal: (value: TLocal[]) => TRecord[];
  applyLocal: (value: TRecord[], found: boolean) => void;
  onLocalError: (error: unknown) => void;
  loadCloud: () => Promise<CloudCollectionResult<TCloud>>;
  synchronizeTombstones: () => Promise<TombstoneSyncResult>;
  normalizeCloud: (value: TCloud[]) => TRecord[];
  applyCloud: (value: TRecord[], tombstones: DAVESyncTombstone[]) => void;
  onCloudApplied: () => void;
  onCloudDeferred: () => void;
}): boolean {
  const optionsRef = useRef({
    localAuthorityReady,
    localAuthorityRef,
    resetLocalLoaded,
    readLocal,
    acceptLocal,
    normalizeLocal,
    applyLocal,
    onLocalError,
    loadCloud,
    synchronizeTombstones,
    normalizeCloud,
    applyCloud,
    onCloudApplied,
    onCloudDeferred,
  });
  optionsRef.current = {
    localAuthorityReady,
    localAuthorityRef,
    resetLocalLoaded,
    readLocal,
    acceptLocal,
    normalizeLocal,
    applyLocal,
    onLocalError,
    loadCloud,
    synchronizeTombstones,
    normalizeCloud,
    applyCloud,
    onCloudApplied,
    onCloudDeferred,
  };

  const localSnapshotRef = useRef<{ attempt: number; found: boolean } | null>(null);
  const cloudAttemptRef = useRef(-1);
  const [cloudPending, setCloudPending] = useState(false);

  useEffect(() => {
    let active = true;
    const options = optionsRef.current;
    localSnapshotRef.current = null;
    options.resetLocalLoaded();
    void options.readLocal()
      .then(result => {
        if (!active || !options.acceptLocal(result)) return;
        localSnapshotRef.current = { attempt: retryAttempt, found: result.found };
        options.applyLocal(options.normalizeLocal(result.value), result.found);
      })
      .catch(error => {
        if (active) options.onLocalError(error);
      });
    return () => { active = false; };
  }, [retryAttempt]);

  useEffect(() => {
    const snapshot = localSnapshotRef.current;
    if (
      !startupReady || !localLoaded || !snapshot ||
      snapshot.attempt !== retryAttempt || cloudAttemptRef.current === retryAttempt
    ) return;
    cloudAttemptRef.current = retryAttempt;
    if (snapshot.found) return;

    let active = true;
    let settled = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      settled = true;
      setCloudPending(false);
    };
    const deferAndRetry = () => {
      if (failures === 0) optionsRef.current.onCloudDeferred();
      setCloudPending(true);
      timer = setTimeout(
        bootstrap,
        CLOUD_BOOTSTRAP_RETRY_DELAYS_MS[Math.min(failures, CLOUD_BOOTSTRAP_RETRY_DELAYS_MS.length - 1)],
      );
      failures += 1;
    };
    function bootstrap() {
      if (!active || settled || inFlight) return;
      if (timer) clearTimeout(timer);
      timer = null;
      inFlight = true;
      const options = optionsRef.current;
      void Promise.all([options.loadCloud(), options.synchronizeTombstones()])
        .then(([cloudResult, tombstoneSync]) => {
          if (!active) return;
          const latestOptions = optionsRef.current;
          if (latestOptions.localAuthorityReady || latestOptions.localAuthorityRef.current) {
            // Edited here meanwhile: the normal refresh takes over.
            if (failures === 0) latestOptions.onCloudDeferred();
            settle();
            return;
          }
          if (!cloudResult.ok || !cloudResult.data || !tombstoneSync.cloudAuthoritative) {
            deferAndRetry();
            return;
          }
          latestOptions.applyCloud(
            latestOptions.normalizeCloud(cloudResult.data),
            tombstoneSync.tombstones,
          );
          latestOptions.onCloudApplied();
          settle();
        })
        .catch(() => {
          if (active) deferAndRetry();
        })
        .finally(() => {
          inFlight = false;
        });
    }
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active' && failures > 0) bootstrap();
    });
    bootstrap();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      foreground.remove();
      // Interrupted before it landed: the next run of this effect starts over.
      if (!settled && cloudAttemptRef.current === retryAttempt) cloudAttemptRef.current = -1;
    };
  }, [localLoaded, retryAttempt, startupReady]);

  return cloudPending;
}
