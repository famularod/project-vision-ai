import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Unsaved work kept on this phone until Save (whole-app audit A11 pass 4 L3,
 * 30 Sep 2026): the field note being written and the Project Walk memory
 * waiting on Confirm Memory. Both lived in memory only, and the recording is
 * deleted when its words arrive, so iOS closing the app before Save lost the
 * dictation. Each key names the account that wrote it (as the field notes'
 * own store does), so another account never reads it; an account change or
 * sign-out removes them all (forgetKeptDrafts). Not an owner-sandbox key on
 * purpose: the sandbox would set a draft aside at sign-out and hand it back
 * when the same account signs in again, and a sign-out forgets it.
 */
export const KEPT_DRAFT_KEY_PREFIX = '@vitruvius/kept-drafts/v1/';

export type KeptDraftKind = 'field-note' | 'walk-memory';
export type KeptDraft = Readonly<{ value: unknown; keptAt: string }>;

const generations = new Map<KeptDraftKind, number>();
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
  const generation = generations.get(kind) ?? 0;
  const raw = value === null || value === undefined
    ? null
    : JSON.stringify({ version: 1, keptAt: new Date().toISOString(), value });
  return enqueue(async () => {
    if (generation !== (generations.get(kind) ?? 0) || revisions.get(key) !== revision) return;
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
  const generation = generations.get(kind) ?? 0;
  const raw = await enqueue(() => AsyncStorage.getItem(key));
  if (generation !== (generations.get(kind) ?? 0) || revision !== (revisions.get(key) ?? 0)) return null;
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

/** Account change or sign-out: every account's kept drafts of this kind go. */
export function forgetKeptDrafts(kind: KeptDraftKind): Promise<void> {
  generations.set(kind, (generations.get(kind) ?? 0) + 1);
  const prefix = `${KEPT_DRAFT_KEY_PREFIX}${kind}/`;
  return enqueue(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  }).then(() => undefined);
}
