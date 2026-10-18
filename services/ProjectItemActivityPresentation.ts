import type { ProjectItemActivity } from '../types';

/** Recent means newest dated notes first, independent of sync/append order.
 * Equal or unknown times retain their stored order. Only the view is sorted;
 * callers retain the authored records and their original fingerprint inputs.
 */
export function recentProjectItemActivity(activity: readonly ProjectItemActivity[] | null | undefined): ProjectItemActivity[] {
  const time = (value: string) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  return (activity ?? []).map((entry, index) => ({ entry, index, at: time(entry.createdAt) }))
    .sort((a, b) => a.at === b.at ? a.index - b.index : a.at > b.at ? -1 : 1)
    .slice(0, 3).map(item => item.entry);
}
