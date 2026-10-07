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
 * Open item W1-3 (6 Oct 2026): "too many requests" is not an ended
 * sign-in. When the sign-in server answered a routine refresh with 429,
 * auth-js took it for a refusal: with the hourly token run out the tab
 * dropped to the sign-in page, and the account's report periods went with
 * it. The tab is now told the server could not be reached just then, which
 * is how auth-js keeps a sign-in and tries again; and until the time the
 * server asked for has passed (a minute when it names none) the tab's
 * refreshes are answered here, so its retries do not add to the count.
 */

/** The browser profile's storage, shared by its tabs (localStorage). */
export type DAVEWebSharedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** This tab's own storage (sessionStorage), where its sign-in is kept. */
export type DAVEWebTabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

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
/** How many replaced tokens of one sign-in are remembered (one an hour: over a week). */
const TOKENS_REMEMBERED = 200;
/** How many sign-ins are remembered. */
const SIGN_INS_REMEMBERED = 8;
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
}>): DAVEWebSignInRefreshGuard {
  let gaveWay = false;
  /** Until when the sign-in server asked this tab not to refresh. */
  let refreshWaitsUntil = 0;
  /** The tab's key as it was last made ready for use. */
  let readied: { key: string; made: Promise<CryptoKey | null> } | null = null;

  /** auth-js keeps the sign-in and tries again later (a 503 is "not reachable just now" to it). */
  const askedToWait = () => new Response(JSON.stringify({
    message: 'The sign-in server asked this tab to wait before it refreshes again.',
  }), { status: 503, headers: { 'content-type': 'application/json' } });

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

  /** What this tab keeps in its own storage: its key, and the keyed name of the sign-in it was last given tokens for. */
  function tabItem(): { key: string; signIn: string | null } | null {
    const kept = parsed(tabStorage()?.getItem(DAVE_WEB_SIGN_IN_TAB_KEY));
    const key = textField(kept, 'key');
    return key && bytesOfKey(key) ? { key, signIn: textField(kept, 'signIn') } : null;
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

  /** This tab was given tokens for the sign-in `name`. */
  function noteTabSignIn(key: string, name: string) {
    try {
      if (tabItem()?.signIn !== name) tabStorage()?.setItem(DAVE_WEB_SIGN_IN_TAB_KEY, JSON.stringify({ key, signIn: name }));
    } catch {
      // The tab's storage is full: its key stays as it was.
    }
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
      if (now?.key === kept.key && (!now.signIn || now.signIn === over)) tabStorage()?.removeItem(DAVE_WEB_SIGN_IN_TAB_KEY);
    } catch {
      // Never in the way of a sign-out.
    }
  }

  async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (pathOf(input)?.pathname.endsWith('/auth/v1/logout')) {
      const sessionId = sessionIdOf(bearerOf(init));
      const response = await options.fetch(input, init);
      // auth-js takes the sign-in out of this tab on these answers (the others it reports as a failure).
      if (response.ok || response.status === 401 || response.status === 403 || response.status === 404) {
        gaveWay = false;
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
      // Replaced twice or more by tabs of this browser: presenting it would end the sign-in for all of them.
      if (Object.values(readTurns()).some(turn => turn.tokens.indexOf(mine) >= 2)) {
        gaveWay = true;
        return new Response(JSON.stringify({
          code: DAVE_WEB_REFRESH_TOKEN_REPLACED_CODE,
          error_code: DAVE_WEB_REFRESH_TOKEN_REPLACED_CODE,
          message: 'This tab’s sign-in was refreshed in another tab; this tab did not present its older token.',
        }), { status: 400, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });
      }
    }
    if (grant === 'refresh_token' && Date.now() < refreshWaitsUntil) return askedToWait();
    const response = await options.fetch(input, init);
    if (grant === 'refresh_token' && response.status === 429) {
      const asked = Number(response.headers.get('retry-after')) * 1_000;
      refreshWaitsUntil = Date.now() + (asked > 0 ? Math.min(asked, REFRESH_WAIT_LIMIT_MS) : DAVE_WEB_REFRESH_WAIT_MS);
      return askedToWait();
    }
    if (grant === 'refresh_token' && !response.ok && ![502, 503, 504].includes(response.status)) {
      // The server refused this tab's token (auth-js takes every answer but these for a refusal): the sign-in
      // has ended, for every tab holding it. Its note goes, and this tab's key with it.
      gaveWay = false;
      try {
        if (mine) forgetTurns((_name, tokens) => tokens.includes(mine));
        const now = tabItem();
        if (now && now.key === key && now.signIn === signInAtStart) tabStorage()?.removeItem(DAVE_WEB_SIGN_IN_TAB_KEY);
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
        noteTabSignIn(key, name);
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
    FORMER_SIGN_IN_TURNS_KEYS.forEach(former => sharedStorage()?.removeItem(former));
    forgetTurns(() => false);
  } catch {
    // Nothing noted, nothing removed: every token is sent as before.
  }

  return Object.freeze({ fetch: guardedFetch, gaveWay: () => gaveWay, signInOver });
}
