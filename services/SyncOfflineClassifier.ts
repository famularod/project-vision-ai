/**
 * Everyday item 6 (2 Oct 2026): whether a sync failure is the device being
 * offline is decided by the error's type and code, not by words in its
 * message. The message of a sync failure can carry a project, task or
 * document name ("Field update for “Fiber Network” could not sync."), so a
 * project with "Network" in its name made a real failure read as "offline"
 * (and be retried as one).
 *
 * What counts as offline:
 * - an Error the platform raised for a transport failure: fetch's TypeError
 *   ("Network request failed", "Failed to fetch", "Load failed", "fetch
 *   failed"), Supabase's AuthRetryableFetchError, an NSURLErrorDomain
 *   transport code, a POSIX/Node transport code (ECONNREFUSED, ENOTFOUND, ...),
 *   or an HTTP status of 0 (no response);
 * - in a message, only those same platform signatures, and the app's own
 *   "Cloud sync could not connect" sentence, with every quoted name and every
 *   database row echo taken out first. A bare "network", "offline" or
 *   "connection" no longer counts.
 */

/** The fixed text the platform gives each transport failure, and the app's own sentence for one. */
const TRANSPORT_FAILURE_SIGNATURES = new RegExp([
  'network request failed',
  'failed to fetch',
  'fetch failed',
  '\\bload failed\\b',
  'networkerror when attempting to fetch resource',
  'authretryablefetcherror',
  'the internet connection appears to be offline',
  'the network connection was lost',
  'could not connect to the server',
  'a server with the specified hostname could not be found',
  'the request timed out',
  'nsurlerrordomain\\s+code=-10(?:01|03|04|05|09|18|20)\\b',
  '\\be(?:connrefused|connreset|connaborted|notfound|timedout|netunreach|hostunreach|ai_again)\\b',
  'cloud sync could not connect',
].join('|'));

const TRANSPORT_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN',
  'ERR_NETWORK', 'ERR_INTERNET_DISCONNECTED', 'ERR_NAME_NOT_RESOLVED',
]);
const OFFLINE_NSURL_CODES = new Set([-1001, -1003, -1004, -1005, -1009, -1018, -1020]);

/**
 * The message without the names it quotes and the rows a database error
 * echoes: “Fiber Network”, "Network Rail", ‘Offline Storage’, Key (name)=(...),
 * Failing row contains (...).
 */
export function syncMessageWithoutNames(message: string): string {
  return message
    .replace(/“[^”]*”/g, '“”')
    .replace(/‘[^’]*’/g, '‘’')
    .replace(/"[^"]*"/g, '""')
    .replace(/\bkey \([^)]*\)=\([^)]*\)/gi, 'Key ()=()')
    .replace(/failing row contains \([^)]*\)/gi, 'Failing row contains ()');
}

/** Whether a failure message reads as a transport failure, by the platform's fixed wording only. */
export function syncMessageIsTransportFailure(message: string): boolean {
  return TRANSPORT_FAILURE_SIGNATURES.test(syncMessageWithoutNames(message).toLowerCase());
}

/** Whether a thrown error is a transport failure, by its type and code. */
export function syncErrorIsTransportFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return typeof error === 'string' && syncMessageIsTransportFailure(error);
  const failure = error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
  const name = typeof failure.name === 'string' ? failure.name : '';
  const message = typeof failure.message === 'string' ? failure.message : '';
  if (name === 'AuthRetryableFetchError') return true;
  if (typeof failure.code === 'string' && TRANSPORT_ERROR_CODES.has(failure.code.toUpperCase())) return true;
  if (typeof failure.code === 'number' && OFFLINE_NSURL_CODES.has(failure.code) && /nsurlerrordomain/i.test(message)) return true;
  if (failure.status === 0) return true;
  // fetch rejects with a TypeError whose message is the platform's own; any
  // other error counts only by the platform's fixed wording in its message.
  return syncMessageIsTransportFailure(message);
}

/**
 * What the sync's user-facing sentence treats as "could not connect": a
 * transport failure, or a time-out, read without the names in the message.
 */
export function syncMessageReadsAsConnectionFailure(message: string): boolean {
  return syncMessageIsTransportFailure(message) || /\btime(?:d)?[ -]?out\b/i.test(syncMessageWithoutNames(message));
}
