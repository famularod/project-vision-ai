import { useEffect, useRef, useState } from 'react';
import { ecosAskElapsedLabel, ecosAskProgressStage, type ECOSAskProgressStage } from '../services/ECOSAskProgress';

/**
 * Elapsed seconds and a plain-language stage while an Ask ECOS request is in
 * flight. `workingSince`: when the server took a repeat of the request as a
 * run of its own; the stages are counted from then, while the elapsed time
 * still counts from the press (review pass 3 A1w).
 */
export function useECOSAskProgress(
  loading: boolean,
  earlierAskStillRunning = false,
  workingSince: number | null = null,
): Readonly<{
  elapsedSeconds: number;
  elapsedLabel: string;
  stage: ECOSAskProgressStage;
}> {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const loadingSince = useRef(0);
  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    loadingSince.current = startedAt;
    setElapsedSeconds(0);
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [loading]);
  return {
    elapsedSeconds,
    elapsedLabel: ecosAskElapsedLabel(elapsedSeconds),
    stage: ecosAskProgressStage(
      workingSince === null
        ? elapsedSeconds
        : Math.floor((loadingSince.current + elapsedSeconds * 1000 - workingSince) / 1000),
      earlierAskStillRunning,
    ),
  };
}
