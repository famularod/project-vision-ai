import { useEffect, useRef, type MutableRefObject } from 'react';

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
 * Loads and applies a required local collection first. Cloud recovery is a
 * one-shot, missing-key-only bootstrap; a present local key (including `[]`)
 * can only receive cloud-only records through the explicit Sync workflow.
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
}) {
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
    const options = optionsRef.current;
    void Promise.all([options.loadCloud(), options.synchronizeTombstones()])
      .then(([cloudResult, tombstoneSync]) => {
        if (!active) return;
        const latestOptions = optionsRef.current;
        if (latestOptions.localAuthorityReady || latestOptions.localAuthorityRef.current) {
          latestOptions.onCloudDeferred();
          return;
        }
        if (!cloudResult.ok || !cloudResult.data || !tombstoneSync.cloudAuthoritative) {
          latestOptions.onCloudDeferred();
          return;
        }
        latestOptions.applyCloud(
          latestOptions.normalizeCloud(cloudResult.data),
          tombstoneSync.tombstones,
        );
        latestOptions.onCloudApplied();
      })
      .catch(() => {
        if (active) optionsRef.current.onCloudDeferred();
      });
    return () => { active = false; };
  }, [localLoaded, retryAttempt, startupReady]);
}
