/**
 * The browser's Web Locks for the tabs of one browser profile (review pass 1,
 * web L1, 6 Oct 2026): `navigator.locks` as the Web Locks standard describes
 * it, with nothing left out that the sign-in guard uses.
 *
 * - A lock is asked for by name, 'shared' or 'exclusive', and is held until
 *   what the callback returned settles.
 * - Requests for one name are granted in the order they were made. The first
 *   in line is granted when it is 'exclusive' and nobody holds that name, or
 *   when it is 'shared' and nobody holds it 'exclusive'. A request behind an
 *   'exclusive' one that is still waiting waits too.
 * - `query()` lists what is held and what is waiting, each with its name,
 *   mode and the page that asked.
 * - A request can be withdrawn while it waits (`signal`).
 * - A page is TOLD of a lock it was granted a moment after the browser
 *   granted it (in a browser that is a message to the page): for that
 *   moment the lock is held and its callback has not run. A `query()` made
 *   then sees it held, and sees whoever is next in line still waiting.
 * - A page that is closed or reloaded lets go of everything at once: what it
 *   held and what it was waiting for. That is `gone()`. Nothing the page's
 *   own code does is needed for it, as in a browser.
 *
 * Each tab gets its own `page()`; all pages made by one `createBrowserLocks()`
 * share the locks, as the tabs of one browser profile do.
 */
type Mode = 'shared' | 'exclusive';
type LockRequest = {
  name: string;
  mode: Mode;
  page: number;
  /** The lock is granted: runs the callback. */
  granted: () => void;
};

export type BrowserPageLocks = Readonly<{
  request: (
    name: string,
    options: { mode: Mode; signal?: AbortSignal },
    callback: () => Promise<unknown> | unknown,
  ) => Promise<unknown>;
  query: () => Promise<{
    held: Array<{ name: string; mode: Mode; clientId: string }>;
    pending: Array<{ name: string; mode: Mode; clientId: string }>;
  }>;
}>;

export function createBrowserLocks() {
  const held: LockRequest[] = [];
  const waiting = new Map<string, LockRequest[]>();
  let pages = 0;

  const queueFor = (name: string) => {
    const queue = waiting.get(name) ?? [];
    waiting.set(name, queue);
    return queue;
  };
  const grantable = (request: LockRequest) => {
    if (queueFor(request.name)[0] !== request) return false;
    const holders = held.filter(lock => lock.name === request.name);
    return request.mode === 'exclusive' ? holders.length === 0 : holders.every(lock => lock.mode === 'shared');
  };
  /** Grants every request of `name` that can be granted now, in order. */
  const grant = (name: string) => {
    const queue = queueFor(name);
    while (queue.length > 0 && grantable(queue[0])) {
      const request = queue.shift()!;
      held.push(request);
      request.granted();
    }
  };
  const letGo = (request: LockRequest) => {
    const index = held.indexOf(request);
    if (index < 0) return;
    held.splice(index, 1);
    grant(request.name);
  };
  const withdrawn = () => Object.assign(new Error('The request was aborted.'), { name: 'AbortError' });
  const listed = (request: LockRequest) => ({ name: request.name, mode: request.mode, clientId: `page-${request.page}` });

  /** One tab's page. */
  function page() {
    pages += 1;
    const id = pages;
    let isGone = false;

    const locks: BrowserPageLocks = {
      request(name, options, callback) {
        return new Promise((resolve, reject) => {
          // A page that is gone asks for nothing, and is told nothing.
          if (isGone) return;
          const signal = options.signal;
          if (signal?.aborted) {
            reject(withdrawn());
            return;
          }
          const request: LockRequest = {
            name,
            mode: options.mode,
            page: id,
            granted: () => {
              signal?.removeEventListener('abort', onAbort);
              // The page hears of it a few turns later.
              Promise.resolve().then(() => undefined).then(() => undefined).then(() => undefined).then(callback).then(
                value => { letGo(request); if (!isGone) resolve(value); },
                (error: unknown) => { letGo(request); if (!isGone) reject(error); },
              );
            },
          };
          const onAbort = () => {
            const queue = queueFor(name);
            const index = queue.indexOf(request);
            if (index < 0) return;
            queue.splice(index, 1);
            grant(name);
            reject(withdrawn());
          };
          signal?.addEventListener('abort', onAbort);
          queueFor(name).push(request);
          // Granted a moment later, never inside the call itself.
          queueMicrotask(() => grant(name));
        });
      },
      async query() {
        await Promise.resolve();
        return {
          held: held.map(listed),
          pending: [...waiting.values()].flat().map(listed),
        };
      },
    };

    return {
      locks,
      /** The tab is closed, or its page is reloaded: the browser lets go of everything it held and asked for. */
      gone() {
        isGone = true;
        const names = new Set<string>();
        for (let index = held.length - 1; index >= 0; index -= 1) {
          if (held[index].page !== id) continue;
          names.add(held[index].name);
          held.splice(index, 1);
        }
        waiting.forEach((queue, name) => {
          const kept = queue.filter(request => request.page !== id);
          if (kept.length !== queue.length) names.add(name);
          waiting.set(name, kept);
        });
        names.forEach(grant);
      },
    };
  }

  return {
    page,
    /** The names held now, for a test to look at. */
    heldNames: () => held.map(lock => lock.name),
  };
}
export type BrowserLocks = ReturnType<typeof createBrowserLocks>;
export type BrowserPage = ReturnType<BrowserLocks['page']>;
