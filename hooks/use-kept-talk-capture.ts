import { useState } from 'react';

/**
 * Whole-app audit A11 pass 1 F8 (30 Sep 2026): a panel that failed to render
 * closed every sheet and also threw away an unconfirmed Talk memory. The
 * memory is now kept with only its sheet closed, and the next tap on Talk
 * brings it back. A new memory (a new id) shows as usual.
 */
export function useKeptTalkCapture<T extends { id: string }>(draft: T | null) {
  const [keptId, setKeptId] = useState<string | null>(null);
  const sheetDraft = draft && draft.id === keptId ? null : draft;
  return {
    /** The memory the Confirm Memory sheet shows, or null while it is kept closed. */
    sheetDraft,
    /** Closes the sheet and keeps the memory. */
    keep: () => setKeptId(draft?.id ?? null),
    /** Reopens a kept memory; false when there is none. */
    reopen: () => {
      if (!draft || sheetDraft) return false;
      setKeptId(null);
      return true;
    },
  };
}
