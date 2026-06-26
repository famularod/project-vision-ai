import AsyncStorage from '@react-native-async-storage/async-storage';

export type StorageBackend = 'local' | 'supabase';

export type LocalFirstReadOptions<T> = {
  key: string;
  fallback: T;
  loadCloud?: () => Promise<T | null>;
};

export type LocalFirstWriteOptions<T> = {
  key: string;
  value: T;
  sync?: () => Promise<void> | void;
};

export async function getStoredJson<T>(key: string, fallback: T): Promise<T> {
  const value = await AsyncStorage.getItem(key);

  if (!value) return fallback;

  return JSON.parse(value) as T;
}

export async function setStoredJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function loadLocalFirst<T>({
  key,
  fallback,
  loadCloud,
}: LocalFirstReadOptions<T>): Promise<T> {
  const localValue = await getStoredJson<T>(key, fallback);

  if (!loadCloud) return localValue;

  try {
    const cloudValue = await loadCloud();

    return cloudValue ?? localValue;
  } catch {
    return localValue;
  }
}

export async function saveLocalFirst<T>({
  key,
  value,
  sync,
}: LocalFirstWriteOptions<T>): Promise<void> {
  await setStoredJson(key, value);

  if (sync) {
    void Promise.resolve(sync()).catch(() => undefined);
  }
}
