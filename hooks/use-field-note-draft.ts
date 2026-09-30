import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type {
  FieldNoteActionKind,
  FieldNoteSource,
} from '../services/FieldNoteRepository';

/**
 * The field note being typed or dictated, kept outside the screen until Save
 * (whole-app audit A2 M3, 30 Sep 2026). The compose fields lived in the
 * screen, and the tab bar rides above the keyboard, so tapping a tab while
 * writing, or leaving before Save, dropped the note silently, a dictated one
 * included. One draft, for one owner: reading it as another owner discards
 * it, and an account change or sign-out forgets it
 * (forgetFieldNoteDraft). Memory only: it does not survive the app being
 * closed, as with task progress drafts.
 */
export type FieldNoteDraft = Readonly<{
  text: string;
  source: FieldNoteSource;
  projectName: string;
  locationName: string;
  actionKind: FieldNoteActionKind;
  actionText: string;
  captureOpen: boolean;
}>;

let slot: Readonly<{ key: string; draft: FieldNoteDraft }> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  listeners.forEach(listener => listener());
}

export function useFieldNoteDraft(
  key: string,
  initial: FieldNoteDraft,
): [FieldNoteDraft, <K extends keyof FieldNoteDraft>(field: K, value: FieldNoteDraft[K]) => void] {
  const stored = useSyncExternalStore(subscribe, () => (slot?.key === key ? slot.draft : null));
  // The starting values of this screen visit, as the screen's own state had.
  const initialRef = useRef(initial);

  useEffect(() => {
    if (slot && slot.key !== key) {
      slot = null;
      notify();
    }
    // Leaving with nothing written starts the next visit fresh, so a saved
    // note's project no longer sticks to every later note (audit A4 pass 6).
    return () => {
      if (slot?.key === key && !hasWrittenContent(slot.draft)) {
        slot = null;
        notify();
      }
    };
  }, [key]);

  const update = useCallback(<K extends keyof FieldNoteDraft>(field: K, value: FieldNoteDraft[K]) => {
    const current = slot?.key === key ? slot.draft : initialRef.current;
    if (current[field] === value && slot?.key === key) return;
    slot = { key, draft: { ...current, [field]: value } };
    notify();
  }, [key]);

  return [stored ?? initialRef.current, update];
}

function hasWrittenContent(draft: FieldNoteDraft): boolean {
  return Boolean(draft.text.trim() || draft.actionText.trim() || draft.locationName.trim());
}

/** Account change or sign-out: nobody's unsaved note carries over. */
export function forgetFieldNoteDraft() {
  if (!slot) return;
  slot = null;
  notify();
}
