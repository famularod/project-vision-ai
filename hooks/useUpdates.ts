import { useMemo } from 'react';
import type { ProjectUpdate } from '../types';

export function useUpdates(savedUpdates: ProjectUpdate[]) {
  return useMemo(
    () => ({
      savedUpdates,
      sortedUpdates: [...savedUpdates].sort((a, b) => b.date.localeCompare(a.date)),
    }),
    [savedUpdates],
  );
}
