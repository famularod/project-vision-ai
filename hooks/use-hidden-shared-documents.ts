import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

// Owner-sensitive prefix: an account switch moves it with that owner's data.
export const HIDDEN_SHARED_DOCUMENTS_STORAGE_KEY = 'projectPhotoUpdate.hiddenSharedDocuments.v1';

/**
 * Shared documents the owner removed from this phone with Delete from This
 * Device (owner answer Q14). A copy already in the cloud stays on the other
 * devices; without this it came straight back on this phone as a "Shared
 * project document" card with no Delete (whole-app audit A8 pass 1 F2, 30
 * Sep 2026). Only the phone's Documents list reads it.
 */
export function useHiddenSharedDocuments() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(HIDDEN_SHARED_DOCUMENTS_STORAGE_KEY)
      .then(raw => {
        const stored = parseHiddenIds(raw);
        if (active && stored.length > 0) setHidden(current => new Set([...stored, ...current]));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const hide = useCallback((documentId: string) => {
    setHidden(current => {
      if (current.has(documentId)) return current;
      const next = new Set(current).add(documentId);
      void AsyncStorage.setItem(HIDDEN_SHARED_DOCUMENTS_STORAGE_KEY, JSON.stringify([...next])).catch(() => undefined);
      return next;
    });
  }, []);

  return { hidden, hide };
}

function parseHiddenIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && Boolean(id)) : [];
  } catch {
    return [];
  }
}
