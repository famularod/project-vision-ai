import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Unsaved work kept on this phone until Save (whole-app audit A11 pass 4 L3,
 * 30 Sep 2026): the field note being written and the Project Walk memory
 * waiting on Confirm Memory. Both lived in memory only, and the recording is
 * deleted when its words arrive, so iOS closing the app before Save lost the
 * dictation. Each key names the account that wrote it (as the field notes'
 * own store does), so another account never reads it; Settings' Sign Out
 * removes that account's (forgetKeptDrafts), and only that account's (review
 * N2). Not an owner-sandbox key on purpose: the sandbox would set a draft
 * aside at sign-out and hand it back when the same account signs in again,
 * and a sign-out forgets it.
 */
export const KEPT_DRAFT_KEY_PREFIX = '@vitruvius/kept-drafts/v1/';

/** 'voice-recording': a recording waiting for signal, one entry per recording (everyday item 4, review N1 M1; KeptVoiceRecording). */
export type KeptDraftKind = 'field-note' | 'walk-memory' | 'voice-recording';
export type KeptDraft = Readonly<{ value: unknown; keptAt: string }>;

// Moved on when an account's drafts of a kind are forgotten: a keep or a read under way for that account is dropped.
const generations = new Map<string, number>();
const revisions = new Map<string, number>();
// Every write, removal and read runs in the order asked for.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T | null> {
  const run = queue.then(work).catch(() => null);
  queue = run;
  return run;
}

export function keptDraftKey(kind: KeptDraftKind, ownerKey: string, scope = ''): string {
  return `${KEPT_DRAFT_KEY_PREFIX}${kind}/${encodeURIComponent(ownerKey)}${scope ? `/${encodeURIComponent(scope)}` : ''}`;
}

/** Keeps `value` (or, with null, removes what is kept). Only the latest call for a key is written. */
export function keepDraft(
  kind: KeptDraftKind,
  ownerKey: string,
  scope: string,
  value: unknown,
): Promise<void> {
  const key = keptDraftKey(kind, ownerKey, scope);
  const revision = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, revision);
  const account = keptDraftKey(kind, ownerKey);
  const generation = generations.get(account) ?? 0;
  const raw = value === null || value === undefined
    ? null
    : JSON.stringify({ version: 1, keptAt: new Date().toISOString(), value });
  return enqueue(async () => {
    if (generation !== (generations.get(account) ?? 0) || revisions.get(key) !== revision) return;
    if (raw === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, raw);
  }).then(() => undefined);
}

/**
 * What is kept for this account, or null. A read overtaken by a keep or a
 * forget for the same key answers null: what was typed since wins.
 */
export async function readKeptDraft(
  kind: KeptDraftKind,
  ownerKey: string,
  scope = '',
): Promise<KeptDraft | null> {
  const key = keptDraftKey(kind, ownerKey, scope);
  const revision = revisions.get(key) ?? 0;
  const account = keptDraftKey(kind, ownerKey);
  const generation = generations.get(account) ?? 0;
  const raw = await enqueue(() => AsyncStorage.getItem(key));
  if (generation !== (generations.get(account) ?? 0) || revision !== (revisions.get(key) ?? 0)) return null;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; keptAt?: unknown; value?: unknown };
    if (parsed?.version !== 1 || typeof parsed.keptAt !== 'string') return null;
    return Object.freeze({ value: parsed.value, keptAt: parsed.keptAt });
  } catch {
    return null;
  }
}

/**
 * The scopes (for a walk memory, the project) with a draft of this kind kept
 * for this account, for the Sign Out warning (whole-app audit A11 pass 5 L3).
 */
export async function keptDraftScopes(kind: KeptDraftKind, ownerKey: string): Promise<string[]> {
  const prefix = `${keptDraftKey(kind, ownerKey)}/`;
  const keys = await enqueue(() => AsyncStorage.getAllKeys());
  return (keys ?? [])
    .filter(key => key.startsWith(prefix))
    .map(key => decodeURIComponent(key.slice(prefix.length)));
}

/**
 * Every draft of this kind kept on this phone, for every account, or null
 * when the phone's storage could not be listed (review N1 M1: the sweep of
 * kept recordings nothing points at must not read "could not list" as
 * "nothing is kept").
 */
export async function keptDraftsOnDevice(
  kind: KeptDraftKind,
): Promise<ReadonlyArray<Readonly<{ ownerKey: string; scope: string }>> | null> {
  const prefix = `${KEPT_DRAFT_KEY_PREFIX}${kind}/`;
  const keys = await enqueue(() => AsyncStorage.getAllKeys());
  if (!Array.isArray(keys)) return null;
  try {
    return keys.filter(key => key.startsWith(prefix)).map(key => {
      const [ownerKey, scope = ''] = key.slice(prefix.length).split('/');
      return { ownerKey: decodeURIComponent(ownerKey), scope: decodeURIComponent(scope) };
    });
  } catch {
    return null;
  }
}

/**
 * Settings' Sign Out for this account: its kept drafts of this kind go. Only
 * its own (review N2, 5 Oct 2026): every account's went, so work set aside
 * for an account whose sign-in had ended unasked (everyday item 7) was
 * deleted when another account signed out of this phone, which had warned
 * that account about its own work only. Another account's stays kept for
 * it, and is still read by no one else.
 */
export function forgetKeptDrafts(kind: KeptDraftKind, ownerKey: string): Promise<void> {
  const account = keptDraftKey(kind, ownerKey);
  generations.set(account, (generations.get(account) ?? 0) + 1);
  return enqueue(async () => {
    // The account's own key, and its keys by scope: never an account whose id only starts the same.
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key === account || key.startsWith(`${account}/`));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  }).then(() => undefined);
}
