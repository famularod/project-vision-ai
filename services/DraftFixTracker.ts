/**
 * Bookkeeping for a draft's GPS fix.
 *
 * GPS review, 29 Sep 2026: a fix takes seconds at ten-meter precision.
 * Each start is a new generation; a fix from an older generation is stale
 * and dropped. A fix stays pending for its draft until it is written into
 * the draft, which React does at the next render, not when the fix arrives
 * (pass 6). A save drops any pending fix, so a fix landing during the write
 * cannot make the saved draft look edited (pass 3), and reports whether it
 * dropped one for the draft being saved, which alone may take a new fix if
 * it stays open (pass 5).
 */
export type DraftFixTracker = Readonly<{
  /** Starts a fix for a draft; returns its generation. */
  start: (draftId: string) => number;
  /** The newest generation; a fix of any other is stale. */
  generation: () => number;
  /** The draft whose fix is still pending, if any. */
  pendingDraftId: () => string | null;
  /** The fix of `generation` was written into its draft, or abandoned. */
  settle: (generation: number) => void;
  /** A save of `draftId` starts: true if a fix was pending for it. */
  beginSave: (draftId: string) => boolean;
}>;

export function createDraftFixTracker(): DraftFixTracker {
  let current = 0;
  let pending: string | null = null;
  return {
    start: draftId => {
      current += 1;
      pending = draftId;
      return current;
    },
    generation: () => current,
    pendingDraftId: () => pending,
    settle: generation => {
      if (generation === current) pending = null;
    },
    beginSave: draftId => {
      const dropped = pending === draftId;
      current += 1;
      pending = null;
      return dropped;
    },
  };
}

/** One task per key at a time, e.g. one Save GPS fix per area (review pass 1). */
export function createKeyedInFlight(): Readonly<{
  tryStart: (key: string) => boolean;
  finish: (key: string) => void;
}> {
  const running = new Set<string>();
  return {
    tryStart: key => {
      if (running.has(key)) return false;
      running.add(key);
      return true;
    },
    finish: key => {
      running.delete(key);
    },
  };
}
