import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type {
  FieldNoteActionKind,
  FieldNoteSource,
} from '../services/FieldNoteRepository';
import { forgetKeptDrafts, keepDraft, readKeptDraft } from '../services/KeptDraftStore';

/**
 * The field note being typed or dictated, kept outside the screen until Save
 * (whole-app audit A2 M3, 30 Sep 2026). The compose fields lived in the
 * screen, and the tab bar rides above the keyboard, so tapping a tab while
 * writing, or leaving before Save, dropped the note silently, a dictated one
 * included. One draft, for one owner: reading it as another owner discards
 * it, and an account change or sign-out forgets it
 * (forgetFieldNoteDraft). On the phone (keptFor: the account) it is also
 * kept in phone storage until Save, so iOS closing the app before Save no
 * longer loses a dictated note (whole-app audit A11 pass 4 L3); it comes back
 * the next time Field Notes opens for that account, and only that account.
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

let slot: Readonly<{
  key: string;
  draft: FieldNoteDraft;
  keptFor: string | null;
  /** Set when the draft came back from phone storage. */
  keptAt?: string;
}> | null = null;
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

/** A written note is kept on the phone; one with nothing written is removed. */
function keepOnPhone(kept: typeof slot, keptFor: string | null = kept?.keptFor ?? null) {
  if (!keptFor) return;
  void keepDraft('field-note', keptFor, '', kept && hasWrittenContent(kept.draft) ? kept.draft : null);
}

export function useFieldNoteDraft(
  key: string,
  initial: FieldNoteDraft,
  keptFor: string | null = null,
): [
  FieldNoteDraft,
  <K extends keyof FieldNoteDraft>(field: K, value: FieldNoteDraft[K]) => void,
  string | null,
] {
  const stored = useSyncExternalStore(subscribe, () => (slot?.key === key ? slot.draft : null));
  const keptAt = useSyncExternalStore(subscribe, () => (slot?.key === key ? slot.keptAt ?? null : null));
  // The starting values of this screen visit, as the screen's own state had.
  const initialRef = useRef(initial);

  useEffect(() => {
    if (slot && slot.key !== key) {
      slot = null;
      notify();
    }
    let current = true;
    if (keptFor && !slot) {
      void readKeptDraft('field-note', keptFor).then(kept => {
        const draft = keptFieldNoteDraft(kept?.value);
        if (!current || !kept || !draft || slot) return;
        slot = { key, draft: { ...draft, captureOpen: true }, keptFor, keptAt: kept.keptAt };
        notify();
      });
    }
    // Leaving with nothing written starts the next visit fresh, so a saved
    // note's project no longer sticks to every later note (audit A4 pass 6).
    return () => {
      current = false;
      if (slot?.key === key && !hasWrittenContent(slot.draft)) {
        slot = null;
        notify();
      }
    };
  }, [key, keptFor]);

  const update = useCallback(<K extends keyof FieldNoteDraft>(field: K, value: FieldNoteDraft[K]) => {
    const current = slot?.key === key ? slot.draft : initialRef.current;
    if (current[field] === value && slot?.key === key) return;
    slot = { key, draft: { ...current, [field]: value }, keptFor };
    notify();
    keepOnPhone(slot);
  }, [key, keptFor]);

  return [stored ?? initialRef.current, update, keptAt];
}

const SOURCES: readonly FieldNoteSource[] = ['typed', 'voice'];
const ACTION_KINDS: readonly FieldNoteActionKind[] = [
  'none', 'follow_up', 'task_candidate', 'issue_candidate', 'safety_candidate',
];

/** A kept draft read back from the phone, or null if it is not one. */
function keptFieldNoteDraft(value: unknown): FieldNoteDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Record<string, unknown>;
  const text = (field: string) => (typeof draft[field] === 'string' ? draft[field] as string : '');
  const restored: FieldNoteDraft = {
    text: text('text'),
    source: SOURCES.includes(draft.source as FieldNoteSource) ? draft.source as FieldNoteSource : 'typed',
    projectName: text('projectName'),
    locationName: text('locationName'),
    actionKind: ACTION_KINDS.includes(draft.actionKind as FieldNoteActionKind)
      ? draft.actionKind as FieldNoteActionKind
      : 'none',
    actionText: text('actionText'),
    captureOpen: true,
  };
  return hasWrittenContent(restored) ? restored : null;
}

function hasWrittenContent(draft: FieldNoteDraft): boolean {
  return Boolean(draft.text.trim() || draft.actionText.trim() || draft.locationName.trim());
}

/**
 * A save that finishes after the owner left the screen: the saved note must
 * not stay in the box, where a second Save filed it twice (audit A11 pass 1
 * F7). Cleared only if the draft still holds what was saved, so a note typed
 * after returning is kept.
 */
export function clearFieldNoteDraftIfUnchanged(
  key: string,
  saved: Pick<FieldNoteDraft, 'text' | 'locationName' | 'actionKind' | 'actionText'>,
) {
  if (!slot || slot.key !== key) return;
  const draft = slot.draft;
  if (
    draft.text !== saved.text || draft.locationName !== saved.locationName ||
    draft.actionKind !== saved.actionKind || draft.actionText !== saved.actionText
  ) return;
  const keptFor = slot.keptFor;
  slot = null;
  notify();
  keepOnPhone(null, keptFor);
}

/** Account change or sign-out: nobody's unsaved note carries over, on the phone either. */
export function forgetFieldNoteDraft() {
  void forgetKeptDrafts('field-note');
  if (!slot) return;
  slot = null;
  notify();
}
