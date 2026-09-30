import { useEffect } from 'react';
import { AppState } from 'react-native';

import { mobileFieldNoteDataSource } from '../services/FieldNoteMobileSync';
import type { FieldNoteWorkspaceDataSource } from '../services/FieldNoteMobileSync';

const RETRY_INTERVAL_MS = 120_000;

/**
 * Field notes saved offline are sent from anywhere in the app: at start, on
 * return to the foreground, and every two minutes while it is open. Every
 * retry lived in the Field Notes screen, so a note saved offline reached the
 * desktop inbox only when that screen was opened again, although the save
 * said it would be sent automatically (whole-app audit A11 pass 1 F3, 30 Sep
 * 2026). Overlapping retries are safe: each note's sync is shared and
 * writes are compare-and-set.
 */
export function useFieldNoteBackgroundRetry(
  ownerKey: string,
  dataSource: Pick<FieldNoteWorkspaceDataSource, 'retryPending'> = mobileFieldNoteDataSource,
  intervalMs = RETRY_INTERVAL_MS,
) {
  useEffect(() => {
    const retryPending = dataSource.retryPending;
    if (!ownerKey || !retryPending) return;
    const retry = () => { void retryPending(ownerKey).catch(() => undefined); };
    retry();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') retry();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') retry();
    }, intervalMs);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [dataSource, intervalMs, ownerKey]);
}
