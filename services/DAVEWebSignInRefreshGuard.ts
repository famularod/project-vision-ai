/**
 * What a web tab does just before it presents its refresh token (batch W1,
 * 6 Oct 2026; open item "Chrome's Duplicate Tab").
 *
 * Each tab keeps its own sign-in in its own sessionStorage (owner answer
 * Q26). Chrome's Duplicate Tab copies that storage, so the copy and the
 * first tab then hold ONE sign-in, with one refresh token. Supabase replaces
 * the refresh token at every refresh. A tab that presents the token just
 * before the newest is forgiven and handed the newest; a token two or more
 * behind is "reuse", and the server then ends that sign-in for every tab
 * holding it. A copy left untouched for two hours while he worked in the
 * first tab presented exactly that when he opened it: the copy showed the
 * sign-in page at once, and the working tab followed within the hour.
 *
 * Now a tab never presents a refresh token that tabs of this browser have
 * replaced twice or more. It gives way instead: the refresh is answered
 * here with a refusal, auth-js ends the sign-in in THAT tab only, the server
 * is never told, and the working tab stays signed in.
 *
 * How a tab knows: every tab notes, in the browser profile's shared storage,
 * a fingerprint of each refresh token its sign-in is given, newest first. A
 * tab's token that is the newest or the one before is sent as before; an
 * older one is not; one that is not listed (no note, storage blocked, a
 * sign-in older than the note) is sent as before.
 *
 * Nothing here decides whose sign-in a tab holds, and nothing another tab
 * holds is taken or trusted: a tab looks only for the fingerprint of the
 * token it is itself about to present, and the note can only make it send
 * less. Another account's tab has another sign-in and other tokens.
 *
 * Review pass 1 of the web area, L2 (6 Oct 2026): the note was never
 * removed, it named each sign-in by its session id, and its fingerprints
 * were plain SHA-256 prefixes, the first of the token the tab held just
 * then: anyone holding a copy of the profile's storage could test guesses of
 * that token against it. What is kept now, and for how long:
 *
 * - THE KEY. Fingerprints are keyed (HMAC-SHA-256, first 16 hex) with 32
 *   random bytes made in the tab and kept ONLY in the tab's own storage,
 *   next to the sign-in itself. Duplicate Tab copies it with the sign-in,
 *   which is how the copy and the first tab read each other's turns. It is
 *   never in the shared storage. So nothing in the shared storage can be
 *   tested against a guess of a token without also guessing 32 random
 *   bytes, whatever the token's length; and whoever holds the tab's own
 *   storage holds the token itself and learns nothing from a fingerprint.
 *   A tab with no storage of its own notes nothing.
 * - THE NOTE (shared storage), for each sign-in: a keyed name (not the
 *   session id), the time its newest hourly token runs out, and the
 *   fingerprints. Nothing else; the guard reads all three.
 * - REMOVED when the sign-in ends in this browser: a sign-out made in this
 *   tab (This Computer or All Devices), a sign-out of the account heard from
 *   another tab, and a refresh the server refused. The tab's key goes with
 *   it. A tab that only gave way ended nothing, and removes nothing.
 * - EXPIRES: a sign-in nobody refreshed for seven days is dropped, the next
 *   time any tab of this browser opens the app or refreshes. A week, not an
 *   hour, because a working tab is left overnight and over a weekend and
 *   then used again; dropped sooner, the copy he opens on Monday would not
 *   be known as old and would end the sign-in for both tabs. Forgetting is
 *   safe: a token that is not listed is SENT, and the server answers, as on
 *   the build before the fix. It can never make a tab keep quiet.
 *
 * Review pass 1 of the web area, L1 (6 Oct 2026): a tab gave way on the
 * note alone, so it also gave way to a tab that had been CLOSED, and after
 * the phone's "Sign Out of All Devices" nobody asked the server: the
 * account's report periods stayed in the browser, where the build before
 * the fix removed them. Two rules now:
 *
 * - A tab gives way only to a tab that is OPEN NOW and holds a token of
 *   that sign-in the server would take (the newest or the one before).
 *   Every open tab says which token it was last given by holding a browser
 *   lock named after its fingerprint (Web Locks; in memory only, and let go
 *   by the browser itself when the tab is closed, reloaded or discarded).
 *   When no such tab is there, the stale tab presents its token and the
 *   server answers, as before the fix. So does a browser without Web Locks.
 * - Giving way is not the server's answer. The tab that gave way tells its
 *   page (`vouchedFor`) whether the sign-in can still be taken as good: only
 *   while the hourly token that came with the newest refresh has not run
 *   out, and only until the tab it gave way to has gone, or that sign-in
 *   has ended, or that hour is over without the server having been asked
 *   again. Then its page is told, once, and removes what it kept.
 *
 * Open item W1-3 (6 Oct 2026): "too many requests" is not an ended
 * sign-in. When the sign-in server answered a routine refresh with 429,
 * auth-js took it for a refusal: with the hourly token run out the tab
 * dropped to the sign-in page, and the account's report periods went with
 * it. The tab is now told the server could not be reached just then, which
 * is how auth-js keeps a sign-in and tries again; and until the time the
 * server asked for has passed (a minute when it names none) the tab's
 * refreshes are answered here, so its retries do not add to the count.
 *
 * Review pass 1 of the web area, L3 (6 Oct 2026): during that wait Sign Out
 * of This Computer was refused in the tab. auth-js refreshes a run-out
 * hourly token before it signs out, the refresh was answered here with
 * "wait", auth-js tried for half a minute and gave up, and the sign-out
 * failed with the sign-in still in the tab. A sign-out made in this tab
 * now runs inside `signingOut`:
 * - its own refresh is sent to the server once even inside the wait, as
 *   the build before the wait sent it (one request, not auth-js's seven);
 * - for This Computer, a refresh that cannot be done just now (the server
 *   says "too many requests" again, cannot be reached, or does not answer
 *   in five seconds) is answered here as final, so auth-js stops at once
 *   instead of trying for half a minute, and the sign-out request itself is
 *   not waited on for longer than those five seconds. The web client then
 *   takes the sign-in out of this tab whatever the server could be told.
 * All Devices still needs the server (owner answer Q21): it is not cut
 * short, and is refused, as before, when the server cannot do it.
 *
 * Second review of the web area, F5 (7 Oct 2026):
 * - nothing told him when the server could NOT be told. The guard hears
 *   what the server itself answered during a sign-out, and says afterwards
 *   whether that sign-in is over there too (`signOutConfirmed`), so the
 *   page can say so when it is not;
 * - a sign-out HEARD from another tab of the account was not run inside
 *   `signingOut`. With a server that took the request and never answered
 *   it waited for ever, and that tab kept its sign-in behind the sign-in
 *   page. It now has the same limits as a sign-out made in the tab.
 */

/** The browser profile's storage, shared by its tabs (localStorage). */
export type DAVEWebSharedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** This tab's own storage (sessionStorage), where its sign-in is kept. */
export type DAVEWebTabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The browser's Web Locks (navigator.locks), as far as the guard uses them. */
export type DAVEWebTabLocks = Readonly<{
  request: (
    name: string,
    options: { mode: 'shared' | 'exclusive'; signal?: AbortSignal },
    held: () => Promise<unknown>,
  ) => Promise<unknown>;
  query: () => Promise<{
    held?: ReadonlyArray<{ name?: string; mode?: string }>;
    pending?: ReadonlyArray<{ name?: string; mode?: string }>;
  }>;
}>;

/** The note, in the shared storage. */
export const DAVE_WEB_SIGN_IN_TURNS_KEY = 'vitruvius.web.sign-in-turns.v2';
/** The key the note's fingerprints are made with, in the tab's own storage. */
export const DAVE_WEB_SIGN_IN_TAB_KEY = 'vitruvius.web.sign-in-tab.v1';
/** The note as the Duplicate Tab fix first wrote it (never in a build): removed when a tab opens the app. */
const FORMER_SIGN_IN_TURNS_KEYS = ['vitruvius.web.sign-in-turns.v1'];
/** What the refusal a stale tab is answered with is called. */
export const DAVE_WEB_REFRESH_TOKEN_REPLACED_CODE = 'refresh_token_replaced_in_another_tab';
/** How long a tab waits before it refreshes again after "too many requests", when the server names no time. */
export const DAVE_WEB_REFRESH_WAIT_MS = 60_000;
/** The longest wait the server may ask for. */
const REFRESH_WAIT_LIMIT_MS = 10 * 60_000;
/** What a refresh that Sign Out of This Computer does not wait for is answered with. */
export const DAVE_WEB_SIGN_OUT_WITHOUT_REFRESH_CODE = 'sign_out_without_refresh';
/** The longest Sign Out of This Computer waits for the sign-in server, from the click. */
export const DAVE_WEB_SIGN_OUT_HERE_LIMIT_MS = 5_000;
/** How many replaced tokens of one sign-in are remembered (one an hour: over a week). */
const TOKENS_REMEMBERED = 200;
/** How many sign-ins are remembered. */
const SIGN_INS_REMEMBERED = 8;
/** What the lock an open tab holds for its token is called, before the token's fingerprint. */
const SIGN_IN_LOCK_PREFIX = 'vitruvius.web.sign-in.';
/** The longest an hourly token is taken to last. */
const REFRESH_PERIOD_MS = 60 * 60_000;
/** A sign-in nobody refreshed for this long is dropped from the note. */
const SIGN_IN_FORGOTTEN_AFTER_MS = 7 * 24 * 60 * 60_000;

type Turns = Record<string, { until: number; tokens: string[] }>;

export type DAVEWebSignInRefreshGuard = Readonly<{
  /** The fetch the web client uses for everything. Only a request for tokens, and a sign-out, is looked at. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /**
   * True from the moment this tab declined to present its refresh token
   * until it is next given tokens (a sign-in made here): its sign-in ended
   * in this tab only, not on the server.
   */
  gaveWay: () => boolean;
  /**
   * This tab's sign-in of `sessionId` is over in this browser (a sign-out
   * made or heard here, or the server ended it): its note and this tab's
   * key are removed. Not for a tab that only gave way. Never throws.
   */
  signInOver: (sessionId: string | null) => Promise<void>;
  /**
   * For a tab that gave way: whether the sign-in it gave way for can still
   * be taken as good without asking the server. True only when the hourly
   * token that came with that sign-in's newest refresh has not run out.
   * `lapsed` then runs once, as soon as that stops being so: the tab it gave
   * way to is gone, or the sign-in ended, or the hour ran out and the server
   * was not asked again. It never runs once the server has said "good" to a
   * tab of that sign-in again, nor after this tab is given tokens itself.
   */
  vouchedFor: (lapsed: () => void) => boolean;
  /**
   * A sign-out made in this tab runs inside this ('here': Sign Out of This
   * Computer; 'everywhere': Sign Out of All Devices). Its own refresh is not
   * held back by a "too many requests" wait, and for 'here' nothing the
   * server does or fails to do keeps `work` waiting for more than a few
   * seconds. Resolves or rejects as `work` does.
   */
  signingOut: <T>(where: 'here' | 'everywhere', work: () => Promise<T>) => Promise<T>;
  /**
   * After a sign-out run inside `signingOut`: whether the sign-in server's own answers mean that sign-in is
   * over there too. It took the sign-out, or said that sign-in is not there, or refused its token. False
   * when it could not be told or did not say: no connection, "unavailable", "too many requests", another
   * error, or no answer in time (the request stays sent, so the server may still end it later).
   */
  signOutConfirmed: () => boolean;
}>;

function pathOf(input: RequestInfo | URL): URL | null {
  try {
    return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  } catch {
    return null;
  }
}

/** The grant a request to the sign-in server's token endpoint asks for, or null. */
function tokenGrantOf(input: RequestInfo | URL): string | null {
  const url = pathOf(input);
  return url?.pathname.endsWith('/auth/v1/token') ? url.searchParams.get('grant_type') : null;
}

function textField(json: unknown, field: string): string | null {
  const value = json && typeof json === 'object' ? (json as Record<string, unknown>)[field] : null;
  return typeof value === 'string' && value ? value : null;
}

function parsed(text: unknown): unknown {
  try {
    return typeof text === 'string' ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** The `session_id` claim of an access token, read from its payload only (as SupabaseAuthStorage.web does). */
function sessionIdOf(accessToken: string | null): string | null {
  const parts = (accessToken ?? '').split('.');
  if (parts.length !== 3 || typeof atob !== 'function') return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return textField(JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))), 'session_id');
  } catch {
    return null;
  }
}

/** The access token a request to the sign-in server carries, or null. */
function bearerOf(init: RequestInit | undefined): string | null {
  try {
    const header = new Headers(init?.headers).get('Authorization') ?? '';
    return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '') : null;
  } catch {
    return null;
  }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/** The 32 bytes of a tab's key, or null when it is not one. */
function bytesOfKey(key: string): ArrayBuffer | null {
  try {
    const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
    const text = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    if (text.length !== 32) return null;
    const buffer = new ArrayBuffer(32);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < 32; index += 1) bytes[index] = text.charCodeAt(index);
    return buffer;
  } catch {
    return null;
  }
}

export function createDAVEWebSignInRefreshGuard(options: Readonly<{
  /** The browser's fetch. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** The profile's shared storage; null when the browser blocks it. */
  shared: () => DAVEWebSharedStorage | null;
  /** This tab's own storage; null when the browser blocks it (nothing is noted then). */
  tab?: () => DAVEWebTabStorage | null;
  /** The browser's Web Locks; null when it has none (a tab then never gives way). */
  locks?: () => DAVEWebTabLocks | null;
}>): DAVEWebSignInRefreshGuard {
  let gaveWay = false;
  /** The lock this tab holds for the token it was last given, so that other tabs can tell it is open and holds it. */
  let held: { token: string; letGo: () => void } | null = null;
  /** After this tab gave way: the sign-in it gave way for, as the note had it at that moment. */
  let gaveWayFor: { name: string; tokens: readonly string[]; until: number } | null = null;
  /** Ends the watch `vouchedFor` started, without telling the page anything. */
  let stopWatching: (() => void) | null = null;
  /** The sign-out under way in this tab: whether it is of this computer only, until when the server is waited for, and whether its one refresh has gone out. */
  let leaving: { here: boolean; until: number; refreshSent: boolean } | null = null;
  /** Whether the server's own answers during the last sign-out in this tab mean that sign-in is over there too. */
  let signOutConfirmed = false;
  /** Until when the sign-in server asked this tab not to refresh. */
  let refreshWaitsUntil = 0;
  /** The tab's key as it was last made ready for use. */
  let readied: { key: string; made: Promise<CryptoKey | null> } | null = null;

  /** auth-js keeps the sign-in and tries again later (a 503 is "not reachable just now" to it). */
  const askedToWait = () => new Response(JSON.stringify({
    message: 'The sign-in server asked this tab to wait before it refreshes again.',
  }), { status: 503, headers: { 'content-type': 'application/json' } });

  /** auth-js takes this for the server's last word on the refresh, and does not try again. */
  const signOutWithoutRefresh = () => new Response(JSON.stringify({
    code: DAVE_WEB_SIGN_OUT_WITHOUT_REFRESH_CODE,
    error_code: DAVE_WEB_SIGN_OUT_WITHOUT_REFRESH_CODE,
    message: 'This tab is signing out; its sign-in could not be refreshed first.',
  }), { status: 400, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });

  /** The server's answer, or null when Sign Out of This Computer has waited for it as long as it will. Rejects as the request does. */
  function answeredWhileSigningOut(until: number, request: Promise<Response>): Promise<Response | null> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), Math.max(0, until - Date.now()));
      (timer as unknown as { unref?: () => void }).unref?.();
      request.then(
        response => { clearTimeout(timer); resolve(response); },
        (error: unknown) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  async function signingOut<T>(where: 'here' | 'everywhere', work: () => Promise<T>): Promise<T> {
    const mine = { here: where === 'here', until: Date.now() + DAVE_WEB_SIGN_OUT_HERE_LIMIT_MS, refreshSent: false };
    leaving = mine;
    signOutConfirmed = false;
    try {
      return await work();
    } finally {
      if (leaving === mine) leaving = null;
    }
  }

  function sharedStorage(): DAVEWebSharedStorage | null {
    try {
      return options.shared();
    } catch {
      return null;
    }
  }

  function tabStorage(): DAVEWebTabStorage | null {
    try {
      return options.tab?.() ?? null;
    } catch {
      return null;
    }
  }

  function tabLocks(): DAVEWebTabLocks | null {
    try {
      return options.locks?.() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * What this tab keeps in its own storage: its key, the keyed name of the sign-in it was last given
   * tokens for, and the fingerprint of the token it was given (so a reloaded tab can say what it holds).
   */
  function tabItem(): { key: string; signIn: string | null; holds: string | null } | null {
    const kept = parsed(tabStorage()?.getItem(DAVE_WEB_SIGN_IN_TAB_KEY));
    const key = textField(kept, 'key');
    return key && bytesOfKey(key) ? { key, signIn: textField(kept, 'signIn'), holds: textField(kept, 'holds') } : null;
  }

  /**
   * This tab holds the token with this fingerprint (null: none the server would take). While it is open,
   * the browser shows that to the other tabs as a lock; nothing is written anywhere.
   */
  function hold(token: string | null) {
    if ((held?.token ?? null) === token) return;
    const before = held;
    held = null;
    const locks = tabLocks();
    if (token && locks) {
      let letGo: () => void = () => undefined;
      const untilLetGo = new Promise<void>(resolve => { letGo = resolve; });
      held = { token, letGo };
      try {
        void Promise.resolve(locks.request(`${SIGN_IN_LOCK_PREFIX}${token}`, { mode: 'shared' }, () => untilLetGo))
          .catch(() => undefined);
      } catch {
        held = null;
      }
    }
    // Let go only after the new one was asked for: the browser never sees this tab holding neither.
    before?.letGo();
  }

  /** The first of these tokens that a tab other than this one, open now, holds; null when none does. */
  async function someoneElseHolds(tokens: readonly string[]): Promise<string | null> {
    try {
      const locks = tabLocks();
      if (!locks) return null;
      const state = await locks.query();
      // Waiting for it counts too: that tab is open and holds the token. A tab watching (below) asks 'exclusive'.
      const shared = [...(state.held ?? []), ...(state.pending ?? [])].filter(lock => lock.mode === 'shared');
      for (const token of tokens) {
        const holders = shared.filter(lock => lock.name === `${SIGN_IN_LOCK_PREFIX}${token}`).length;
        if (holders - (held?.token === token ? 1 : 0) > 0) return token;
      }
    } catch {
      // The browser cannot say who is open: nobody is taken to be.
    }
    return null;
  }

  /** The key this tab's fingerprints are made with; made now when the tab has none. Null: nothing is noted. */
  function tabKey(): string | null {
    try {
      const tab = tabStorage();
      const random = globalThis.crypto;
      if (!tab || !random?.subtle || typeof random.getRandomValues !== 'function' || typeof btoa !== 'function') return null;
      const kept = tabItem();
      if (kept) return kept.key;
      const made = btoa(String.fromCharCode(...random.getRandomValues(new Uint8Array(32))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      tab.setItem(DAVE_WEB_SIGN_IN_TAB_KEY, JSON.stringify({ key: made }));
      return made;
    } catch {
      return null;
    }
  }

  /** This tab was given the token `holds` for the sign-in `name`. */
  function noteTabSignIn(key: string, name: string, holds: string) {
    try {
      tabStorage()?.setItem(DAVE_WEB_SIGN_IN_TAB_KEY, JSON.stringify({ key, signIn: name, holds }));
    } catch {
      // The tab's storage is full: its key stays as it was.
    }
  }

  /** This tab holds no token the server would take any more; its key stays. */
  function noteTabHoldsNothing() {
    hold(null);
    try {
      const kept = tabItem();
      if (kept?.holds) tabStorage()?.setItem(DAVE_WEB_SIGN_IN_TAB_KEY, JSON.stringify({ key: kept.key, ...(kept.signIn ? { signIn: kept.signIn } : {}) }));
    } catch {
      // As it was: the lock is let go either way.
    }
  }

  /** This tab's key goes (its sign-in is over), and it holds nothing. */
  function forgetTabKey() {
    hold(null);
    tabStorage()?.removeItem(DAVE_WEB_SIGN_IN_TAB_KEY);
  }

  /** A keyed fingerprint of a token, or the keyed name of a sign-in. Null: it cannot be made here. */
  async function fingerprintOf(key: string | null, kind: 'token' | 'sign-in', value: string | null): Promise<string | null> {
    try {
      const subtle = globalThis.crypto?.subtle;
      const bytes = key ? bytesOfKey(key) : null;
      if (!subtle || !key || !bytes || !value) return null;
      if (readied?.key !== key) {
        readied = {
          key,
          made: subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']).catch(() => null),
        };
      }
      const hmacKey = await readied.made;
      if (!hmacKey) return null;
      const digest = await subtle.sign('HMAC', hmacKey, new TextEncoder().encode(`${kind}:${value}`));
      return hex(new Uint8Array(digest).slice(0, 8));
    } catch {
      return null;
    }
  }

  /** The note, without the sign-ins nobody refreshed for a week. */
  function readTurns(): Turns {
    const turns: Turns = {};
    try {
      const stored = parsed(sharedStorage()?.getItem(DAVE_WEB_SIGN_IN_TURNS_KEY));
      if (!stored || typeof stored !== 'object') return turns;
      const now = Date.now();
      Object.entries(stored as Record<string, unknown>).forEach(([name, turn]) => {
        const until = turn && typeof turn === 'object' ? (turn as { until?: unknown }).until : null;
        const tokens = turn && typeof turn === 'object' ? (turn as { tokens?: unknown }).tokens : null;
        if (typeof until !== 'number' || !Array.isArray(tokens) || now > until + SIGN_IN_FORGOTTEN_AFTER_MS) return;
        turns[name] = { until, tokens: tokens.filter(token => typeof token === 'string') };
      });
    } catch {
      // Not readable: as no note.
    }
    return turns;
  }

  function writeTurns(turns: Turns) {
    const shared = sharedStorage();
    if (!shared) return;
    const kept = Object.entries(turns)
      .sort(([, left], [, right]) => right.until - left.until)
      .slice(0, SIGN_INS_REMEMBERED);
    try {
      const next = kept.length === 0 ? null : JSON.stringify(Object.fromEntries(kept));
      if (next === (shared.getItem(DAVE_WEB_SIGN_IN_TURNS_KEY) ?? null)) return;
      if (next === null) shared.removeItem(DAVE_WEB_SIGN_IN_TURNS_KEY);
      else shared.setItem(DAVE_WEB_SIGN_IN_TURNS_KEY, next);
    } catch {
      // Not noted (the profile's storage is full): a token that is not listed is sent as before.
    }
  }

  /** Takes out of the note every sign-in `ended` says has ended, and every one that expired. Says which ended. */
  function forgetTurns(ended: (name: string, tokens: readonly string[]) => boolean): string[] {
    const names: string[] = [];
    try {
      const shared = sharedStorage();
      const written = shared?.getItem(DAVE_WEB_SIGN_IN_TURNS_KEY);
      if (!shared || written === null || written === undefined) return names;
      const turns = readTurns();
      Object.keys(turns).forEach(name => {
        if (!ended(name, turns[name].tokens)) return;
        names.push(name);
        delete turns[name];
      });
      writeTurns(turns);
    } catch {
      // Not reachable: nothing to remove that this browser can read back.
    }
    return names;
  }

  /** This tab was given `given` for `presented` (null: a new sign-in). Newest first. */
  function noteTurn(name: string, given: string, presented: string | null, until: number) {
    const turns = readTurns();
    const before = turns[name]?.tokens ?? [];
    // The one presented is the one just before it, whatever the note said (a tab that was forgiven
    // is handed the newest again, and the note comes out as it was).
    const tokens = [given, ...(presented ? [presented] : []), ...before.filter(token => token !== given && token !== presented)];
    turns[name] = { until, tokens: tokens.slice(0, TOKENS_REMEMBERED) };
    writeTurns(turns);
  }

  /**
   * This tab's sign-in of `sessionId` is over in this browser: its note goes, and with it this tab's key,
   * unless the tab has been given tokens of another sign-in since (one made here while the old one was
   * still ending).
   */
  async function signInOver(sessionId: string | null) {
    if (gaveWay) return;
    try {
      const kept = tabItem();
      if (!kept) return;
      const over = await fingerprintOf(kept.key, 'sign-in', sessionId);
      if (over) forgetTurns(name => name === over);
      const now = tabItem();
      if (now?.key === kept.key && (!now.signIn || now.signIn === over)) forgetTabKey();
    } catch {
      // Never in the way of a sign-out.
    }
  }

  function vouchedFor(lapsed: () => void): boolean {
    const watched = gaveWayFor;
    if (!gaveWay || !watched || Date.now() >= watched.until) return false;
    stopWatching?.();
    let over = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const withdrawn = typeof AbortController === 'function' ? new AbortController() : null;
    const end = (lapse: boolean) => {
      if (over) return;
      over = true;
      if (timer) clearTimeout(timer);
      if (stopWatching === stop) stopWatching = null;
      withdrawn?.abort();
      if (!lapse) return;
      try {
        lapsed();
      } catch {
        // The page's own affair.
      }
    };
    const stop = () => end(false);
    stopWatching = stop;
    /** A tab of that sign-in was given tokens since: the server said "good" again, and that tab carries it now. */
    const answeredSince = () => (readTurns()[watched.name]?.until ?? 0) > watched.until;
    // The hour ran out: the tab given way to has not asked the server again (hidden, asleep or gone).
    timer = setTimeout(() => end(!answeredSince()), Math.max(0, watched.until - Date.now()));
    (timer as unknown as { unref?: () => void }).unref?.();
    void (async () => {
      const locks = tabLocks();
      while (!over && locks) {
        if (answeredSince()) {
          end(false);
          return;
        }
        const there = await someoneElseHolds(watched.tokens);
        if (over) return;
        if (!there) break;
        // Granted once every tab holding that token has let go of it: it was closed, or given a newer token,
        // or its sign-in ended. Asked 'exclusive', so this request never counts as a tab holding the token.
        await locks.request(`${SIGN_IN_LOCK_PREFIX}${there}`, { mode: 'exclusive', signal: withdrawn?.signal }, async () => undefined);
      }
      end(!answeredSince());
    })().catch(() => undefined); // Withdrawn, or the browser cannot say: the hour still ends it.
    return true;
  }

  async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (pathOf(input)?.pathname.endsWith('/auth/v1/logout')) {
      const sessionId = sessionIdOf(bearerOf(init));
      // Sign Out of This Computer does not wait on a server that does not answer (review pass 1, web L3): the
      // request stays sent, and auth-js is told the server is not reachable just now.
      const response = leaving?.here
        ? await answeredWhileSigningOut(leaving.until, options.fetch(input, init)) ?? new Response(JSON.stringify({
            message: 'The sign-in server did not answer the sign-out in time.',
          }), { status: 503, headers: { 'content-type': 'application/json' } })
        : await options.fetch(input, init);
      // auth-js takes the sign-in out of this tab on these answers (the others it reports as a failure).
      if (response.ok || response.status === 401 || response.status === 403 || response.status === 404) {
        // The server took the sign-out, or says that sign-in is not there (second review, web F5).
        if (leaving) signOutConfirmed = true;
        gaveWay = false;
        stopWatching?.();
        await signInOver(sessionId);
      }
      return response;
    }
    const grant = tokenGrantOf(input);
    if (grant === null) return options.fetch(input, init);
    const key = tabKey();
    /** The sign-in this tab was last given tokens for, as this request goes out. */
    const signInAtStart = tabItem()?.signIn ?? null;
    const presented = grant === 'refresh_token' ? textField(parsed(init?.body), 'refresh_token') : null;
    const mine = await fingerprintOf(key, 'token', presented);
    if (mine) {
      for (let look = 0; look < 3; look += 1) {
        // Replaced twice or more by tabs of this browser: presenting it would end the sign-in for all of them…
        const replaced = Object.entries(readTurns()).find(([, turn]) => turn.tokens.indexOf(mine) >= 2);
        if (!replaced) break;
        // …for all of them that are still there. Is a tab open now that holds the newest token, or the one before?
        const current = replaced[1].tokens.slice(0, 2);
        if (await someoneElseHolds(current)) {
          gaveWay = true;
          gaveWayFor = { name: replaced[0], tokens: current, until: replaced[1].until };
          stopWatching?.();
          noteTabHoldsNothing();
          return new Response(JSON.stringify({
            code: DAVE_WEB_REFRESH_TOKEN_REPLACED_CODE,
            error_code: DAVE_WEB_REFRESH_TOKEN_REPLACED_CODE,
            message: 'This tab’s sign-in was refreshed in another tab; this tab did not present its older token.',
          }), { status: 400, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });
        }
        // Nobody is, unless a tab was given a newer token while the browser was being asked: then look again.
        if ((readTurns()[replaced[0]]?.tokens[0] ?? current[0]) === current[0]) break;
      }
      // The tabs that were given the newer tokens are gone. The token is presented and the server answers,
      // as before the Duplicate Tab fix (review pass 1, web L1).
      hold(mine);
    }
    /** The sign-out this refresh is part of, if one is under way in this tab (review pass 1, web L3). */
    const signOut = grant === 'refresh_token' ? leaving : null;
    /** What a refresh that cannot be done just now is answered with: final for Sign Out of This Computer. */
    const notNow = () => (signOut?.here ? signOutWithoutRefresh() : askedToWait());
    // Inside the wait the server asked for, only a sign-out's own refresh goes out, and only once.
    if (grant === 'refresh_token' && Date.now() < refreshWaitsUntil && (!signOut || signOut.refreshSent)) return notNow();
    if (signOut) signOut.refreshSent = true;
    let response: Response;
    if (signOut?.here) {
      try {
        const answered = await answeredWhileSigningOut(signOut.until, options.fetch(input, init));
        if (!answered) return notNow();
        response = answered;
      } catch {
        return notNow();
      }
      if ([502, 503, 504].includes(response.status)) return notNow();
    } else {
      response = await options.fetch(input, init);
    }
    if (grant === 'refresh_token' && response.status === 429) {
      const asked = Number(response.headers.get('retry-after')) * 1_000;
      refreshWaitsUntil = Date.now() + (asked > 0 ? Math.min(asked, REFRESH_WAIT_LIMIT_MS) : DAVE_WEB_REFRESH_WAIT_MS);
      return notNow();
    }
    if (grant === 'refresh_token' && !response.ok && ![502, 503, 504].includes(response.status)) {
      // The server refused this tab's token (auth-js takes every answer but these for a refusal): the sign-in
      // has ended, for every tab holding it. Its note goes, and this tab's key with it.
      if (signOut) signOutConfirmed = true;
      gaveWay = false;
      stopWatching?.();
      try {
        if (mine) forgetTurns((_name, tokens) => tokens.includes(mine));
        const now = tabItem();
        if (now && now.key === key && now.signIn === signInAtStart) forgetTabKey();
        else if (held?.token === mine) hold(null);
      } catch {
        // Not removed: it expires.
      }
    }
    if (response.ok) {
      const tokens = await response.clone().json().catch(() => null) as unknown;
      const name = await fingerprintOf(key, 'sign-in', sessionIdOf(textField(tokens, 'access_token')));
      const given = await fingerprintOf(key, 'token', textField(tokens, 'refresh_token'));
      if (key && name && given) {
        gaveWay = false;
        gaveWayFor = null;
        stopWatching?.();
        noteTabSignIn(key, name, given);
        // The lock for the new token is asked for before the note says it is the newest, and the one for the
        // old token is let go after: a tab reading the note always finds this tab holding one of the two.
        hold(given);
        const lasts = Number((tokens as { expires_in?: unknown } | null)?.expires_in) * 1_000;
        noteTurn(name, given, mine, Date.now() + (lasts > 0 ? Math.min(lasts, REFRESH_PERIOD_MS) : REFRESH_PERIOD_MS));
      }
    }
    return response;
  }

  // A tab that opens the app: its key is made (a copy made by Duplicate Tab before this tab's first
  // refresh must carry it), what expired leaves the note, and so does the note as it was first written.
  try {
    tabKey();
    // A tab that was reloaded, or copied by Duplicate Tab, holds the token its storage says it was given.
    hold(tabItem()?.holds ?? null);
    FORMER_SIGN_IN_TURNS_KEYS.forEach(former => sharedStorage()?.removeItem(former));
    forgetTurns(() => false);
  } catch {
    // Nothing noted, nothing removed: every token is sent as before.
  }

  return Object.freeze({ fetch: guardedFetch, gaveWay: () => gaveWay, signInOver, vouchedFor, signingOut, signOutConfirmed: () => signOutConfirmed });
}
