import type { ScheduleItem } from '../types';
import { scheduleItemsTakingCarriedProgress, scheduleItemsTakingCarriedText } from './DAVEScheduleRecovery';
import { queueScheduleItemProgressCarried, queueScheduleItemTextCarried } from './SyncService';

const queued = new WeakSet<ScheduleItem>();
const queuedText = new WeakSet<ScheduleItem>();

/**
 * Whole-app audit A7 pass 26 M-1 and L-1 (1 Oct 2026, caused by 3035b7a):
 * the percent the sync merge carries to a task's newest row (Full Sync's
 * download, the routine refresh, the startup cloud load) stayed on the
 * device. The cloud and the web desktop kept 0% until a second Full Sync,
 * a realtime echo of the task put 0% back on both devices, and that device's
 * next Full Sync wrote its whole old copy over the other device's newer
 * notes, owner, dates and lookahead note. Each row the merge gives a carried
 * percent now goes to the cloud once, as a change of its progress alone
 * (queueScheduleItemProgressCarried), as Set Active sends its carried rows.
 * Returns how many were sent.
 *
 * Review N2 P1 (5 Oct 2026): an owner, contractor or note the merge carries
 * to a task's newest row goes up the same way, as those fields alone
 * (queueScheduleItemTextCarried), after the row's carried percent when it
 * has both.
 */
export async function queueScheduleProgressCarriedToCloud(items: readonly ScheduleItem[]): Promise<number> {
  const carried = scheduleItemsTakingCarriedProgress(items).filter(({ item }) => !queued.has(item));
  const carriedText = scheduleItemsTakingCarriedText(items).filter(({ item }) => !queuedText.has(item));
  carried.forEach(({ item }) => queued.add(item));
  carriedText.forEach(({ item }) => queuedText.add(item));
  try {
    await Promise.all(carried.map(({ item, before }) => queueScheduleItemProgressCarried(item, before)));
    await Promise.all(carriedText.map(({ item, fields }) => queueScheduleItemTextCarried(item, fields)));
  } catch {
    // A queue that cannot be written leaves the percent on this device, as before; Full Sync still weighs it.
    carried.forEach(({ item }) => queued.delete(item));
    carriedText.forEach(({ item }) => queuedText.delete(item));
    return 0;
  }
  return carried.length + carriedText.length;
}
