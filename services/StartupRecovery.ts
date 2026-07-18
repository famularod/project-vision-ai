import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  logStartupDiagnostic,
  startupErrorMessage,
} from './StartupDiagnostics';

export type StartupStorageReadState =
  | 'missing'
  | 'loaded'
  | 'corrupt_quarantined'
  | 'read_failed';

type StartupStorageReadBase = {
  state: StartupStorageReadState;
  key: string;
  label: string;
  recovered: boolean;
  isolatedRecordCount: number;
  error: string | null;
  found: boolean;
};

export type StartupStorageReadResult<T> =
  | (StartupStorageReadBase & {
      state: 'loaded';
      value: T;
      error: null;
      found: true;
    })
  | (StartupStorageReadBase & {
      state: 'missing';
      value: T;
      error: null;
      found: false;
    })
  | (StartupStorageReadBase & {
      state: 'corrupt_quarantined';
      /** Access throws so legacy consumers cannot hydrate a fallback. */
      value: never;
      error: string;
      found: false;
    })
  | (StartupStorageReadBase & {
      state: 'read_failed';
      /** Access throws so legacy consumers cannot hydrate a fallback. */
      value: never;
      error: string;
      found: false;
    });

export type StartupNormalizationResult<T> = {
  value: T;
  recovered: boolean;
  isolatedRecordCount: number;
  error: string | null;
};

export type StartupHydrationFailure = {
  state: 'corrupt_quarantined' | 'read_failed';
  key: string;
  label: string;
  error: string;
};

export type StartupHydrationObservation = Pick<
  StartupStorageReadBase,
  'state' | 'key' | 'label' | 'error'
>;

export function reconcileStartupHydrationFailures(
  current: readonly StartupHydrationFailure[],
  observations: readonly StartupHydrationObservation[],
): StartupHydrationFailure[] {
  const observedKeys = new Set(observations.map(observation => observation.key));
  const next = current.filter(failure => !observedKeys.has(failure.key));

  observations.forEach(observation => {
    if (
      (observation.state !== 'corrupt_quarantined' && observation.state !== 'read_failed') ||
      !observation.error
    ) return;
    next.push({
      state: observation.state,
      key: observation.key,
      label: observation.label,
      error: observation.error,
    });
  });

  return next;
}

export class StartupStorageUnavailableError extends Error {
  readonly state: 'corrupt_quarantined' | 'read_failed';
  readonly key: string;

  constructor({
    state,
    key,
    label,
    detail,
  }: {
    state: 'corrupt_quarantined' | 'read_failed';
    key: string;
    label: string;
    detail: string;
  }) {
    super(`${label} cannot hydrate because storage is ${state}: ${detail}`);
    this.name = 'StartupStorageUnavailableError';
    this.state = state;
    this.key = key;
  }
}

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
    if (raw === null) {
      logStartupDiagnostic('storage_hydration_completed', `${label} hydration completed with defaults.`, {
        key,
      });
      return {
        state: 'missing',
        key,
        label,
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
        state: 'loaded',
        key,
        label,
        value: parsed,
        recovered: false,
        isolatedRecordCount: 0,
        error: null,
        found: true,
      };
    } catch (error) {
      const parseError = startupErrorMessage(error);
      const quarantine = await quarantineStartupStorageValue(key, raw, label, error);
      if (!quarantine.quarantined) {
        return unavailableStartupResult({
          state: 'read_failed',
          key,
          label,
          error: `${parseError}; quarantine failed: ${quarantine.error}`,
          recovered: false,
          isolatedRecordCount: 0,
        });
      }
      return unavailableStartupResult({
        state: 'corrupt_quarantined',
        key,
        label,
        error: parseError,
        recovered: true,
        isolatedRecordCount: 1,
      });
    }
  } catch (error) {
    logStartupDiagnostic('startup_failure', `${label} storage read failed.`, {
      key,
      error: startupErrorMessage(error),
    });
    return unavailableStartupResult({
      state: 'read_failed',
      key,
      label,
      error: startupErrorMessage(error),
      recovered: false,
      isolatedRecordCount: 0,
    });
  }
}

export function normalizeStartupArray<T>(
  value: unknown,
  normalizeRecord: (record: unknown) => T,
  label: string,
): StartupNormalizationResult<T[]> {
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
    return { quarantined: true as const, quarantineKey, error: null };
  } catch (quarantineError) {
    const quarantineErrorMessage = startupErrorMessage(quarantineError);
    logStartupDiagnostic('storage_record_isolated', `${label} storage could not be quarantined.`, {
      key,
      error: quarantineErrorMessage,
    });
    return {
      quarantined: false as const,
      quarantineKey: null,
      error: quarantineErrorMessage,
    };
  }
}

function unavailableStartupResult<T>({
  state,
  key,
  label,
  error,
  recovered,
  isolatedRecordCount,
}: {
  state: 'corrupt_quarantined' | 'read_failed';
  key: string;
  label: string;
  error: string;
  recovered: boolean;
  isolatedRecordCount: number;
}): StartupStorageReadResult<T> {
  const unavailable = {
    state,
    key,
    label,
    recovered,
    isolatedRecordCount,
    error,
    found: false as const,
    get value(): never {
      throw new StartupStorageUnavailableError({
        state,
        key,
        label,
        detail: error,
      });
    },
  };
  return unavailable as StartupStorageReadResult<T>;
}
