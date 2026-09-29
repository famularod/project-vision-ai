/**
 * A location fix shared for a short time.
 *
 * Review, 29 Sep 2026: home-screen project detection took a new fix every
 * time saved updates, areas, tasks or projects changed. At ten-meter
 * precision a fix can take several seconds, so bursts of changes (startup,
 * a cloud refresh, typing an area radius) kept detection in "checking" and
 * New Update fell back to the project picker. One fix now serves for
 * `maxAgeMs`, and callers during a pending fix share it. A failed fix, or
 * none (location not allowed), is not kept, so allowing location in
 * Settings takes effect on the next check (review pass 2).
 */
export type RecentLocationFix<T> = Readonly<{
  /** The last fix if it is at most `maxAgeMs` old, else null. */
  fresh: () => { fix: T } | null;
  /** The fresh fix, or one shared request for a new one. */
  get: () => Promise<T | null>;
}>;

export function createRecentLocationFix<T>(
  takeFix: () => Promise<T | null>,
  maxAgeMs: number,
  now: () => number = Date.now,
): RecentLocationFix<T> {
  let last: { fix: T; at: number } | null = null;
  let pending: Promise<T | null> | null = null;

  const fresh = () => (last && now() - last.at <= maxAgeMs ? { fix: last.fix } : null);

  return {
    fresh,
    get: () => {
      const recent = fresh();
      if (recent) return Promise.resolve(recent.fix);
      if (!pending) {
        const request = takeFix().then(fix => {
          last = fix === null ? null : { fix, at: now() };
          return fix;
        });
        pending = request;
        const clear = () => {
          if (pending === request) pending = null;
        };
        request.then(clear, clear);
      }
      return pending;
    },
  };
}
