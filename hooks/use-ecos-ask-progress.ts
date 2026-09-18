import { useEffect, useState } from 'react';
import { ecosAskElapsedLabel, ecosAskProgressStage, type ECOSAskProgressStage } from '../services/ECOSAskProgress';

/** Elapsed seconds and a plain-language stage while an Ask ECOS request is in flight. */
export function useECOSAskProgress(loading: boolean): Readonly<{
  elapsedSeconds: number;
  elapsedLabel: string;
  stage: ECOSAskProgressStage;
}> {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [loading]);
  return {
    elapsedSeconds,
    elapsedLabel: ecosAskElapsedLabel(elapsedSeconds),
    stage: ecosAskProgressStage(elapsedSeconds),
  };
}
