import { useEffect, useState } from 'react';

import { recoverLegacyPIERealityModelCache } from '../services/PIERealityModelCacheRecovery';
import {
  logStartupDiagnostic,
  startupErrorMessage,
} from '../services/StartupDiagnostics';

export function useRealityModelCacheRecovery(): boolean {
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let active = true;
    void recoverLegacyPIERealityModelCache()
      .then(result => {
        logStartupDiagnostic(
          'reality_model_cache_recovered',
          'Oversized derived DAVE Reality Model cache records were removed before authority startup.',
          { removedKeyCount: result.removedKeyCount },
        );
      })
      .catch(error => {
        // v3 uses separate keys, so authority can still start safely. Leave
        // prior derived cache keys untouched for a future retry if native
        // removal failed.
        logStartupDiagnostic(
          'reality_model_cache_recovery_failed',
          'Derived DAVE Reality Model cache cleanup will retry on the next launch.',
          { error: startupErrorMessage(error) },
        );
      })
      .finally(() => {
        if (active) setFinished(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return finished;
}
