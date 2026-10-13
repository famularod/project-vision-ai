import { useEffect, useRef, useState } from 'react';
import type { DraftLocationNotice } from '../services/DraftAreaPresentation';
import {
  draftLocationNoticeToKeep,
  keepDraftLocationNotice,
  readKeptDraftLocationNotice,
  resumedDraftLocationNotice,
} from '../services/DraftLocationNoticeStore';

type ResumableDraft = Readonly<{ id: string; gpsLatitude?: number | null; gpsLongitude?: number | null }>;

/**
 * Keeps the open update's "why there is no GPS" across a relaunch (P1 part
 * B item 3; services/DraftLocationNoticeStore.ts says why).
 *
 * Once the stored update has been read (`ready`), what was kept is read
 * once: if it is this update's and the update still has no GPS, it becomes
 * the notice, unless a capture has already said something newer. Only after
 * that read are changes written, so the empty notice the app starts with
 * can never erase what was kept before it has been looked at.
 */
export function useKeptDraftLocationNotice(input: Readonly<{
  ready: boolean;
  draft: ResumableDraft;
  notice: DraftLocationNotice | null;
  generation: () => number;
  setNotice: (update: (current: DraftLocationNotice | null) => DraftLocationNotice | null) => void;
}>): void {
  const { ready, notice } = input;
  const latest = useRef(input);
  latest.current = input;
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (!ready || restored) return undefined;
    let active = true;
    void readKeptDraftLocationNotice().then(kept => {
      if (!active) return;
      const { draft, generation, setNotice } = latest.current;
      const resumed = resumedDraftLocationNotice({ kept, draft, generation: generation() });
      if (resumed) setNotice(current => current ?? resumed);
      setRestored(true);
    });
    return () => {
      active = false;
    };
  }, [ready, restored]);

  useEffect(() => {
    if (!restored) return;
    void keepDraftLocationNotice(draftLocationNoticeToKeep(notice));
  }, [notice, restored]);
}
