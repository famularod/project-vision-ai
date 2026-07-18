import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { runExclusiveLocalStorageMutation } from '../services/LocalStorageMutationCoordinator';

const RETRY_DELAYS_MS = [50, 250] as const;
let persistenceAlertVisible = false;

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
  onError = reportStoragePersistenceFailure,
}: {
  enabled: boolean;
  storageKey: string;
  value: T;
  label?: string;
  onError?: (failure: StoragePersistenceFailure) => void;
}) {
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
    void persistStorageItem(storageKey, serialized).catch(error => {
      onError({ storageKey, label, error });
    });
  }, [enabled, label, onError, storageKey, value]);
}

export function useStringStoragePersistence({
  enabled,
  storageKey,
  value,
  label = 'setting',
  onError = reportStoragePersistenceFailure,
}: {
  enabled: boolean;
  storageKey: string;
  value: string;
  label?: string;
  onError?: (failure: StoragePersistenceFailure) => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    void persistStorageItem(storageKey, value).catch(error => {
      onError({ storageKey, label, error });
    });
  }, [enabled, label, onError, storageKey, value]);
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
