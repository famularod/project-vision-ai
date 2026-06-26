import AsyncStorage from '@react-native-async-storage/async-storage';

export async function getStoredJson<T>(key: string, fallback: T): Promise<T> {
  const value = await AsyncStorage.getItem(key);

  if (!value) return fallback;

  return JSON.parse(value) as T;
}

export async function setStoredJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}
