import { useCallback, useContext, useEffect, useSyncExternalStore } from 'react';

import { NativeWorkspaceOwnerContext } from '../components/native-workspace-owner';
import type { DAVECaptureMemory, DAVECaptureRecommendation } from '../services/DAVECaptureMemory';
import { normalizeConfirmedMemory } from '../services/DAVECaptureMemoryRepository';
import { forgetKeptDrafts, keepDraft, keptDraftScopes, readKeptDraft } from '../services/KeptDraftStore';

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

/**
 * Whether this account has a Project Walk memory not yet saved, on screen or
 * kept on the phone, which a sign-out discards (whole-app audit A11 pass 5
 * L3: the Sign Out warning named only an unsaved field note).
 */
export async function unsavedWalkMemoryExists(ownerKey: string): Promise<boolean> {
  if ([...drafts.keys()].some(slotKey => JSON.parse(slotKey)[0] === ownerKey)) return true;
  for (const projectName of await keptDraftScopes('walk-memory', ownerKey)) {
    if (keptWalkMemory((await readKeptDraft('walk-memory', ownerKey, projectName))?.value)) return true;
  }
  return false;
}

/**
 * A sign-out this device did not ask for (everyday item 7): the memories
 * leave the screen but stay kept on the phone for their account, and Confirm
 * Memory opens with them again when that account opens their project.
 */
export function setAsideKeptWalkMemoryDrafts() {
  if (drafts.size === 0) return;
  drafts.clear();
  notify();
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
 * Its project and location suggestions are checked as if confirmed and come
 * back as they were: Project Walk keeps a suggested location unconfirmed, and
 * that check dropped every such memory (A2 pass 5 L1, 30 Sep 2026), so
 * Confirm Memory now opens with it and still asks for the location.
 */
function keptWalkMemory(value: unknown): DAVECaptureMemory | null {
  if (!value || typeof value !== 'object') return null;
  const memory = value as DAVECaptureMemory;
  if (memory.status !== 'draft') return null;
  const asConfirmed = (suggestion: unknown) =>
    suggestion && typeof suggestion === 'object' ? { ...suggestion, confirmed: true } : suggestion;
  const asKept = (checked: DAVECaptureRecommendation, kept: unknown): DAVECaptureRecommendation => ({
    ...checked,
    confirmed: Boolean(checked.value && (kept as { confirmed?: unknown } | null)?.confirmed === true),
  });
  try {
    const checked = normalizeConfirmedMemory({
      ...memory,
      recommendedProject: asConfirmed(memory.recommendedProject),
      recommendedLocation: asConfirmed(memory.recommendedLocation),
      status: 'confirmed',
      confirmedAt: memory.createdAt,
      cancelledAt: null,
    });
    return {
      ...checked,
      recommendedProject: asKept(checked.recommendedProject, memory.recommendedProject),
      recommendedLocation: asKept(checked.recommendedLocation, memory.recommendedLocation),
      status: 'draft',
      confirmedAt: null,
      cancelledAt: null,
    };
  } catch {
    return null;
  }
}
