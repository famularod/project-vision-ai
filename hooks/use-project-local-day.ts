import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  plainDateAtInstant,
  projectTimeZoneOrDefault,
} from '../services/ProjectDateTime';

const DAY_CHECK_INTERVAL_MS = 60_000;

/** Today's date (YYYY-MM-DD) in the project's time zone. */
export function projectLocalDay(timeZone: string | null | undefined, now = new Date()): string {
  return plainDateAtInstant(now, projectTimeZoneOrDefault(timeZone)) || now.toISOString().slice(0, 10);
}

/**
 * The project-local day, updated when it rolls over at midnight and when the
 * app returns to the foreground (audit round 2 L3). Checking once a minute
 * only re-renders when the date actually changes.
 */
export function useProjectLocalDay(timeZone: string | null | undefined): string {
  const [day, setDay] = useState(() => projectLocalDay(timeZone));
  useEffect(() => {
    const check = () => setDay(projectLocalDay(timeZone));
    check();
    const timer = setInterval(check, DAY_CHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') check();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [timeZone]);
  return day;
}
