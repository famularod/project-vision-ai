import { useCallback, useContext, useEffect, useSyncExternalStore } from 'react';

import { NativeWorkspaceOwnerContext } from '../components/native-workspace-owner';
import type { DAVECaptureMemory } from '../services/DAVECaptureMemory';
import { normalizeConfirmedMemory } from '../services/DAVECaptureMemoryRepository';
import { forgetKeptDrafts, keepDraft, readKeptDraft } from '../services/KeptDraftStore';

/**
 * The Project Walk memory waiting on Confirm Memory, kept until Save or
 * Cancel (whole-app audit A11 pass 4 L3, 30 Sep 2026). It lived in the
 * project screen's state, and the recording is deleted when its words arrive,
 * so iOS closing the app (or leaving the project) before Save lost the
 * dictation. Kept per account and project, in memory and in phone storage;
 * Confirm Memory opens with it again the next time that project does, for
 * that account only. An account change or sign-out removes it.
 */
const drafts = new Map<string, DAVECaptureMemory>();
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

export function useKeptWalkMemoryDraft(
  projectName: string,
): [DAVECaptureMemory | null, (next: DAVECaptureMemory | null) => void] {
  // Outside the workspace owner boundary nothing is kept on the phone.
  const boundary = useContext(NativeWorkspaceOwnerContext);
  const owner = boundary === undefined ? null : boundary ?? 'local-device';
  const slotKey = JSON.stringify([owner, projectName]);
  const draft = useSyncExternalStore(subscribe, () => drafts.get(slotKey) ?? null);

  useEffect(() => {
    if (owner === null || drafts.has(slotKey)) return;
    let current = true;
    void readKeptDraft('walk-memory', owner, projectName).then(kept => {
      const restored = keptWalkMemory(kept?.value);
      if (!current || !restored || drafts.has(slotKey)) return;
      drafts.set(slotKey, restored);
      notify();
    });
    return () => { current = false; };
  }, [owner, projectName, slotKey]);

  const setDraft = useCallback((next: DAVECaptureMemory | null) => {
    if (next) drafts.set(slotKey, next);
    else drafts.delete(slotKey);
    notify();
    if (owner !== null) void keepDraft('walk-memory', owner, projectName, next);
  }, [owner, projectName, slotKey]);

  return [draft, setDraft];
}

/** Account change or sign-out: no unconfirmed memory carries over. */
export function forgetKeptWalkMemoryDrafts() {
  void forgetKeptDrafts('walk-memory');
  if (drafts.size === 0) return;
  drafts.clear();
  notify();
}

/**
 * A kept memory read back from the phone, or null. It is checked as a
 * confirmed memory would be before saving, then returned as the draft it is.
 */
function keptWalkMemory(value: unknown): DAVECaptureMemory | null {
  if (!value || typeof value !== 'object') return null;
  const memory = value as DAVECaptureMemory;
  if (memory.status !== 'draft') return null;
  try {
    const checked = normalizeConfirmedMemory({
      ...memory,
      status: 'confirmed',
      confirmedAt: memory.createdAt,
      cancelledAt: null,
    });
    return { ...checked, status: 'draft', confirmedAt: null, cancelledAt: null };
  } catch {
    return null;
  }
}
