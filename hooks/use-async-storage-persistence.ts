import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';

export function useJsonStoragePersistence<T>({
  enabled,
  storageKey,
  value,
}: {
  enabled: boolean;
  storageKey: string;
  value: T;
}) {
  useEffect(() => {
    if (!enabled) return;

    AsyncStorage.setItem(storageKey, JSON.stringify(value)).catch(() => undefined);
  }, [enabled, storageKey, value]);
}

export function useStringStoragePersistence({
  enabled,
  storageKey,
  value,
}: {
  enabled: boolean;
  storageKey: string;
  value: string;
}) {
  useEffect(() => {
    if (!enabled) return;

    AsyncStorage.setItem(storageKey, value).catch(() => undefined);
  }, [enabled, storageKey, value]);
}
