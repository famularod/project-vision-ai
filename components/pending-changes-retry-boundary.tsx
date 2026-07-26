import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import {
  requestPendingChangesUpload,
  startPendingChangesRetryController,
  stopPendingChangesRetryController,
} from '../services/SyncService';

export function PendingChangesRetryBoundary({
  children,
}: Readonly<{ children: ReactNode }>) {
  useEffect(() => {
    startPendingChangesRetryController();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        requestPendingChangesUpload('app_foreground');
      }
    });

    return () => {
      subscription.remove();
      stopPendingChangesRetryController();
    };
  }, []);

  return children;
}
