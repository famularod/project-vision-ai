import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { runExclusiveLocalStorageMutation } from '../services/LocalStorageMutationCoordinator';

const RETRY_DELAYS_MS = [50, 250] as const;
let persistenceAlertVisible = false;
const pendingPersistenceByKey = new Map<string, {
  value: string;
  label: string;
  onError: (failure: StoragePersistenceFailure) => void;
  timer: ReturnType<typeof setTimeout> | null;
}>();

export type StoragePersistenceFailure = Readonly<{
  storageKey: string;
  label: string;
  error: unknown;
}>;

export function reportStoragePersistenceFailure({ label }: StoragePersistenceFailure) {
  if (persistenceAlertVisible) return;
  persistenceAlertVisible = true;
  Alert.alert(
    'Changes not saved',
    `This phone could not save the latest ${label}. Keep the app open, check available storage, and try the change again.`,
    [{ text: 'OK', onPress: () => { persistenceAlertVisible = false; } }],
    { cancelable: true, onDismiss: () => { persistenceAlertVisible = false; } },
  );
}

export function persistStorageItem(storageKey: string, value: string): Promise<void> {
  return runExclusiveLocalStorageMutation([storageKey], () => retryStorageMutation(
    () => AsyncStorage.setItem(storageKey, value),
  ));
}

export function removePersistedStorageItem(storageKey: string): Promise<void> {
  return runExclusiveLocalStorageMutation([storageKey], () => retryStorageMutation(
    () => AsyncStorage.removeItem(storageKey),
  ));
}

export function useJsonStoragePersistence<T>({
  enabled,
  storageKey,
  value,
  label = 'app data',
  debounceMs = 750,
  onError = reportStoragePersistenceFailure,
}: {
  enabled: boolean;
  storageKey: string;
  value: T;
  label?: string;
  debounceMs?: number;
  onError?: (failure: StoragePersistenceFailure) => void;
}) {
  const lastScheduledValueRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let serialized: string;
    try {
      const candidate = JSON.stringify(value);
      if (typeof candidate !== 'string') {
        throw new TypeError('The value cannot be represented as JSON.');
      }
      serialized = candidate;
    } catch (error) {
      onError({ storageKey, label, error });
      return;
    }
    const signature = `${storageKey}\u0000${serialized}`;
    if (lastScheduledValueRef.current === signature) return;
    lastScheduledValueRef.current = signature;
    scheduleStoragePersistence({
      storageKey,
      value: serialized,
      label,
      debounceMs,
      onError: failure => {
        if (lastScheduledValueRef.current === signature) {
          lastScheduledValueRef.current = null;
        }
        onError(failure);
      },
    });
  }, [debounceMs, enabled, label, onError, storageKey, value]);
}

export function useStringStoragePersistence({
  enabled,
  storageKey,
  value,
  label = 'setting',
  debounceMs = 0,
  onError = reportStoragePersistenceFailure,
}: {
  enabled: boolean;
  storageKey: string;
  value: string;
  label?: string;
  debounceMs?: number;
  onError?: (failure: StoragePersistenceFailure) => void;
}) {
  const lastScheduledValueRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const signature = `${storageKey}\u0000${value}`;
    if (lastScheduledValueRef.current === signature) return;
    lastScheduledValueRef.current = signature;
    scheduleStoragePersistence({
      storageKey,
      value,
      label,
      debounceMs,
      onError: failure => {
        if (lastScheduledValueRef.current === signature) {
          lastScheduledValueRef.current = null;
        }
        onError(failure);
      },
    });
  }, [debounceMs, enabled, label, onError, storageKey, value]);
}

export async function flushPendingStoragePersistence(): Promise<void> {
  const storageKeys = [...pendingPersistenceByKey.keys()];
  await Promise.all(storageKeys.map(writePendingStoragePersistence));
}

function scheduleStoragePersistence({
  storageKey,
  value,
  label,
  debounceMs,
  onError,
}: {
  storageKey: string;
  value: string;
  label: string;
  debounceMs: number;
  onError: (failure: StoragePersistenceFailure) => void;
}) {
  const existing = pendingPersistenceByKey.get(storageKey);
  if (existing?.value === value) {
    pendingPersistenceByKey.set(storageKey, { ...existing, label, onError });
    return;
  }

  if (existing?.timer) clearTimeout(existing.timer);
  const delay = Number.isFinite(debounceMs) ? Math.max(0, debounceMs) : 0;
  const pending = {
    value,
    label,
    onError,
    timer: null as ReturnType<typeof setTimeout> | null,
  };
  pendingPersistenceByKey.set(storageKey, pending);
  if (delay === 0) {
    void writePendingStoragePersistence(storageKey);
    return;
  }
  pending.timer = setTimeout(() => {
    void writePendingStoragePersistence(storageKey);
  }, delay);
}

async function writePendingStoragePersistence(storageKey: string): Promise<void> {
  const pending = pendingPersistenceByKey.get(storageKey);
  if (!pending) return;
  pendingPersistenceByKey.delete(storageKey);
  if (pending.timer) clearTimeout(pending.timer);
  try {
    await persistStorageItem(storageKey, pending.value);
  } catch (error) {
    pending.onError({ storageKey, label: pending.label, error });
  }
}

async function retryStorageMutation(mutate: () => Promise<void>) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await mutate();
      return;
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}
