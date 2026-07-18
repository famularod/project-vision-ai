import { useCallback, useState } from 'react';

import { startupErrorMessage } from '../services/StartupDiagnostics';
import {
  reconcileStartupHydrationFailures,
  type StartupHydrationFailure,
  type StartupHydrationObservation,
} from '../services/StartupRecovery';

export function useStartupHydration() {
  const [failures, setFailures] = useState<StartupHydrationFailure[]>([]);
  const [retryAttempt, setRetryAttempt] = useState(0);

  const accept = useCallback((observations: readonly StartupHydrationObservation[]) => {
    setFailures(current => reconcileStartupHydrationFailures(current, observations));
    return observations.every(result => result.state === 'loaded' || result.state === 'missing');
  }, []);

  const fail = useCallback((key: string, label: string, error: unknown) => {
    setFailures(current => reconcileStartupHydrationFailures(current, [{
      state: 'read_failed',
      key,
      label,
      error: startupErrorMessage(error),
    }]));
  }, []);

  const loaded = useCallback((key: string, label: string) => {
    setFailures(current => reconcileStartupHydrationFailures(current, [{
      state: 'loaded',
      key,
      label,
      error: null,
    }]));
  }, []);

  const retry = useCallback(() => setRetryAttempt(attempt => attempt + 1), []);

  return { failures, retryAttempt, accept, fail, loaded, retry };
}
