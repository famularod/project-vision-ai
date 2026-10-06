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
 * a fingerprint of each refresh token its sign-in is given, newest first,
 * by session id. A fingerprint is the first 16 hex characters of the token's
 * SHA-256: it tells two tokens apart and cannot be turned back into one. No
 * token is ever written there. A tab's token that is the newest or the one
 * before is sent as before; an older one is not; one that is not listed (no
 * note, storage blocked, a sign-in older than the note) is sent as before.
 *
 * Nothing here decides whose sign-in a tab holds, and nothing another tab
 * holds is taken or trusted: a tab looks only for the fingerprint of the
 * token it is itself about to present, and the note can only make it send
 * less. Another account's tab has another sign-in and other tokens.
 */

/** The browser profile's storage, shared by its tabs (localStorage). */
export type DAVEWebSharedStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const DAVE_WEB_SIGN_IN_TURNS_KEY = 'vitruvius.web.sign-in-turns.v1';
/** What the refusal a stale tab is answered with is called. */
export const DAVE_WEB_REFRESH_TOKEN_REPLACED_CODE = 'refresh_token_replaced_in_another_tab';
/** How many replaced tokens of one sign-in are remembered (one an hour: over a week). */
const TOKENS_REMEMBERED = 200;
/** How many sign-ins are remembered. */
const SIGN_INS_REMEMBERED = 8;

type Turns = Record<string, { at: number; tokens: string[] }>;

export type DAVEWebSignInRefreshGuard = Readonly<{
  /** The fetch the web client uses for everything. Only a request for tokens is looked at. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /**
   * True from the moment this tab declined to present its refresh token
   * until it is next given tokens (a sign-in made here): its sign-in ended
   * in this tab only, not on the server.
   */
  gaveWay: () => boolean;
}>;

async function fingerprintOf(token: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || !token) return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest).slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** The grant a request to the sign-in server's token endpoint asks for, or null. */
function tokenGrantOf(input: RequestInfo | URL): string | null {
  try {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return url.pathname.endsWith('/auth/v1/token') ? url.searchParams.get('grant_type') : null;
  } catch {
    return null;
  }
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

export function createDAVEWebSignInRefreshGuard(options: Readonly<{
  /** The browser's fetch. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** The profile's shared storage; null when the browser blocks it. */
  shared: () => DAVEWebSharedStorage | null;
}>): DAVEWebSignInRefreshGuard {
  let gaveWay = false;

  function readTurns(): Turns | null {
    try {
      const stored = parsed(options.shared()?.getItem(DAVE_WEB_SIGN_IN_TURNS_KEY));
      return stored && typeof stored === 'object' ? stored as Turns : null;
    } catch {
      return null;
    }
  }

  function tokensOf(turn: Turns[string] | undefined): string[] {
    const tokens = turn?.tokens;
    return Array.isArray(tokens) ? tokens.filter(token => typeof token === 'string') : [];
  }

  /** This tab was given `given` for `presented` (null: a new sign-in). Newest first. */
  function noteTurn(sessionId: string, given: string, presented: string | null) {
    const shared = options.shared();
    if (!shared) return;
    const turns = readTurns() ?? {};
    const before = tokensOf(turns[sessionId]);
    // The one presented is the one just before it, whatever the note said (a tab that was forgiven
    // is handed the newest again, and the note comes out as it was).
    const tokens = [given, ...(presented ? [presented] : []), ...before.filter(token => token !== given && token !== presented)];
    turns[sessionId] = { at: Date.now(), tokens: tokens.slice(0, TOKENS_REMEMBERED) };
    const kept = Object.entries(turns)
      .filter(([, turn]) => turn && typeof turn.at === 'number')
      .sort(([, left], [, right]) => right.at - left.at)
      .slice(0, SIGN_INS_REMEMBERED);
    try {
      shared.setItem(DAVE_WEB_SIGN_IN_TURNS_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
      // Not noted (the profile's storage is full): a token that is not listed is sent as before.
    }
  }

  async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const grant = tokenGrantOf(input);
    if (grant === null) return options.fetch(input, init);
    const presented = grant === 'refresh_token' ? textField(parsed(init?.body), 'refresh_token') : null;
    const mine = presented ? await fingerprintOf(presented) : null;
    if (mine) {
      // Replaced twice or more by tabs of this browser: presenting it would end the sign-in for all of them.
      if (Object.values(readTurns() ?? {}).some(turn => tokensOf(turn).indexOf(mine) >= 2)) {
        gaveWay = true;
        return new Response(JSON.stringify({
          code: DAVE_WEB_REFRESH_TOKEN_REPLACED_CODE,
          error_code: DAVE_WEB_REFRESH_TOKEN_REPLACED_CODE,
          message: 'This tab’s sign-in was refreshed in another tab; this tab did not present its older token.',
        }), { status: 400, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });
      }
    }
    const response = await options.fetch(input, init);
    if (response.ok) {
      const tokens = await response.clone().json().catch(() => null) as unknown;
      const sessionId = sessionIdOf(textField(tokens, 'access_token'));
      const given = await fingerprintOf(textField(tokens, 'refresh_token') ?? '');
      if (sessionId && given) {
        gaveWay = false;
        noteTurn(sessionId, given, mine);
      }
    }
    return response;
  }

  return Object.freeze({ fetch: guardedFetch, gaveWay: () => gaveWay });
}
