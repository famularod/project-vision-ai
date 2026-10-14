import type { ScheduleItem } from '../types';
import { schedulePriorityAsRead, scheduleTaskEarlierIds } from './ScheduleTaskRevisions';

/**
 * Open item 2.38 (13 Oct 2026). Since the owner's answers to questions 47 and 51 a newer schedule turns a task High
 * when its file marks it Critical or lists its finish within the week, also on a task it leaves on its dates, and
 * also on a task whose priority he lowered before Build 231 (or, on the day his devices are on different builds, one
 * he set back on the device not yet updated). Nothing said which tasks it had turned High, so he could not set them
 * back. The tasks a schedule turned High, by comparing the tasks before it with the tasks after it:
 * - a row it restated in place (the same id) that reads High now and did not before;
 * - a task it moved, whose new row reads High while the row it replaces did not (the last of the new row's earlier
 *   ids found among the rows before: the row he saw).
 * A new task (no row before it) is not named: nothing was turned. Read from priorities only, so a lookahead, which
 * never changes a priority, names none. In the order of `after`.
 */
export function scheduleTasksTurnedHigh(
  before: readonly ScheduleItem[],
  after: readonly ScheduleItem[],
): ScheduleItem[] {
  const beforeById = new Map(before.map(item => [item.id, item]));
  const high = (item: ScheduleItem | undefined) => schedulePriorityAsRead(item?.priority) === 'High';
  return after.filter(item => {
    if (!high(item)) return false;
    const same = beforeById.get(item.id);
    if (same) return !high(same);
    const replaced = scheduleTaskEarlierIds(item).reverse().map(id => beforeById.get(id)).find(Boolean);
    return Boolean(replaced) && !high(replaced);
  });
}

const NAMED = 3;

/** How a task is named in the line: its name, and its area where it has one. */
function taskLabel(item: ScheduleItem): string {
  const name = (item.taskName || '').trim() || 'A task';
  const area = (item.locationName || '').trim();
  return area ? `${name} (${area})` : name;
}

/**
 * The one line he reads where he approved the schedule (the phone's and iPad's import review, the desktop's upload
 * and Make Current): the tasks it turned High, each once, in alphabetical order, three by name and "and N more"
 * after, and how to set one back. Null when it turned none.
 */
export function scheduleTurnedHighLine(tasks: readonly ScheduleItem[]): string | null {
  const labels = [...new Set(tasks.map(taskLabel))].sort((left, right) => left.localeCompare(right));
  if (labels.length === 0) return null;
  const named = labels.slice(0, NAMED);
  const more = labels.length - named.length;
  const list = more > 0
    ? `${named.join(', ')} and ${more} more`
    : named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  const count = `${labels.length} ${labels.length === 1 ? 'task' : 'tasks'}`;
  return `This schedule turned ${count} High: ${list}. To set one back, open it and change its priority.`;
}

/** Both at once: the line for the tasks a schedule turned High between `before` and `after`, or null. */
export function scheduleTurnedHighLineBetween(
  before: readonly ScheduleItem[],
  after: readonly ScheduleItem[],
): string | null {
  return scheduleTurnedHighLine(scheduleTasksTurnedHigh(before, after));
}

/**
 * The desktop's upload of a full schedule (planDAVEWebScheduleImport): a task the schedule leaves on its dates is
 * restated, and raised, at the upload, before Make Current (item 8's decision 1), so it is named at the upload. Its
 * moved tasks' new rows show only from Make Current, and are named there (scheduleTurnedHighLineBetween over the
 * tasks shown before and after).
 */
export function scheduleUploadTurnedHighLine(
  plan: Readonly<{ revisions: readonly Readonly<{ item: ScheduleItem; previous: ScheduleItem }>[] }> | null | undefined,
): string | null {
  if (!plan) return null;
  return scheduleTurnedHighLineBetween(plan.revisions.map(revision => revision.previous), plan.revisions.map(revision => revision.item));
}
