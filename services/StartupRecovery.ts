import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  logStartupDiagnostic,
  startupErrorMessage,
} from './StartupDiagnostics';

export type StartupStorageReadResult<T> = {
  value: T;
  recovered: boolean;
  isolatedRecordCount: number;
  error: string | null;
  found?: boolean;
};

export async function readStartupJson<T>(
  key: string,
  fallback: T,
  label: string,
): Promise<StartupStorageReadResult<T>> {
  logStartupDiagnostic('storage_hydration_started', `${label} hydration started.`, {
    key,
  });
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      logStartupDiagnostic('storage_hydration_completed', `${label} hydration completed with defaults.`, {
        key,
      });
      return {
        value: fallback,
        recovered: false,
        isolatedRecordCount: 0,
        error: null,
        found: false,
      };
    }

    try {
      const parsed = JSON.parse(raw) as T;
      logStartupDiagnostic('storage_hydration_completed', `${label} hydration completed.`, {
        key,
      });
      return {
        value: parsed,
        recovered: false,
        isolatedRecordCount: 0,
        error: null,
        found: true,
      };
    } catch (error) {
      await quarantineStartupStorageValue(key, raw, label, error);
      return {
        value: fallback,
        recovered: true,
        isolatedRecordCount: 1,
        error: startupErrorMessage(error),
        found: false,
      };
    }
  } catch (error) {
    logStartupDiagnostic('startup_failure', `${label} storage read failed.`, {
      key,
      error: startupErrorMessage(error),
    });
    return {
      value: fallback,
      recovered: true,
      isolatedRecordCount: 0,
      error: startupErrorMessage(error),
      found: false,
    };
  }
}

export function normalizeStartupArray<T>(
  value: unknown,
  normalizeRecord: (record: unknown) => T,
  label: string,
): StartupStorageReadResult<T[]> {
  if (!Array.isArray(value)) {
    if (value !== null && value !== undefined) {
      logStartupDiagnostic('storage_record_isolated', `${label} storage was not an array.`, {
        label,
      });
    }
    return {
      value: [],
      recovered: value !== null && value !== undefined,
      isolatedRecordCount: value !== null && value !== undefined ? 1 : 0,
      error: null,
    };
  }

  const normalized: T[] = [];
  let isolatedRecordCount = 0;
  value.forEach((record, index) => {
    try {
      normalized.push(normalizeRecord(record));
    } catch (error) {
      isolatedRecordCount += 1;
      logStartupDiagnostic('storage_record_isolated', `${label} record was isolated.`, {
        label,
        index,
        error: startupErrorMessage(error),
      });
    }
  });

  return {
    value: normalized,
    recovered: isolatedRecordCount > 0,
    isolatedRecordCount,
    error: null,
  };
}

export async function quarantineStartupStorageValue(
  key: string,
  raw: string,
  label: string,
  error: unknown,
) {
  const quarantineKey = `${key}.corrupt.${Date.now()}`;
  try {
    await AsyncStorage.setItem(quarantineKey, raw);
    await AsyncStorage.removeItem(key);
    logStartupDiagnostic('storage_record_isolated', `${label} storage was quarantined.`, {
      key,
      quarantineKey,
      error: startupErrorMessage(error),
    });
  } catch (quarantineError) {
    logStartupDiagnostic('storage_record_isolated', `${label} storage could not be quarantined.`, {
      key,
      error: startupErrorMessage(quarantineError),
    });
  }
}
