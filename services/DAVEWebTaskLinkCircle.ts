import type { ScheduleItem } from '../types';
import { loadDAVEWebReadOnlySnapshot, type DAVEWebReadOnlySnapshot } from './DAVEWebReadOnlyRepository';
import { scheduleTaskLinkTargets } from './ScheduleTaskRevisions';
import { normalizeScheduleDependencies } from './VitruviusScheduleEngine';

/**
 * Open item, web batch WS1 item 7 (6 Oct 2026): two web sessions (two tabs,
 * two computers) could each save one of two opposite hand links. One sets
 * Framing to start after Survey; the other, which opened before it heard of
 * that, sets Survey to start after Framing. Each save is guarded only by
 * its own task's revision, so both went in: a circle, which the schedule
 * cannot place ("Dependency cycle ..."). One session alone cannot make one:
 * the editor does not offer as a predecessor a task that already comes after
 * the item.
 *
 * A save on the web that ADDS a predecessor link now first reads what the
 * cloud holds at that moment and is refused, with a sentence naming both
 * tasks, when the link would close a circle with it.
 *
 * By task, as the list shows links: a link that names a row a master has
 * since replaced is read as the row shown for that task
 * (scheduleTaskLinkTargets, owner answer Q29), and a link only a replaced,
 * hidden row still holds is not the task's. Round through any number of
 * tasks. Only a link this save adds: a circle already saved is not this
 * save's doing, and the editor lets him remove it.
 */
export type DAVEWebLinkCircle = Readonly<{
  /** The task being saved. */
  task: ScheduleItem;
  /** The predecessor this save adds that already comes after it. */
  predecessor: ScheduleItem;
  /** The tasks between them, from the predecessor back to the task (none when the two are linked directly). */
  through: readonly ScheduleItem[];
}>;

type CloudTasks = Pick<DAVEWebReadOnlySnapshot, 'scheduleItems' | 'knownScheduleItems'>;

/** The first circle the links this save adds would close with the tasks given, or null. */
export function daveWebLinkCircleClosedBy({
  item,
  opened,
  cloud,
}: {
  /** The task as this save would write it. */
  item: ScheduleItem;
  /** The task as the editor opened it: its links then were not added by this save. */
  opened: Pick<ScheduleItem, 'dependencies'> | null | undefined;
  /** The tasks the cloud holds now: those shown, and every saved row. */
  cloud: CloudTasks;
}): DAVEWebLinkCircle | null {
  const shown = cloud.scheduleItems as readonly ScheduleItem[];
  const target = scheduleTaskLinkTargets(shown, cloud.knownScheduleItems ?? shown);
  // The row shown for this task now (a master may have moved it since the editor opened).
  const self = target(item.id) ?? item;
  const shownIdOf = (predecessorId: string) => target(predecessorId)?.id ?? predecessorId.trim();
  const linksOf = (task: Pick<ScheduleItem, 'dependencies'> | null | undefined) =>
    [...new Set(normalizeScheduleDependencies(task?.dependencies).map(link => shownIdOf(link.predecessorItemId)))];
  const had = new Set(linksOf(opened));
  const added = linksOf(item).filter(id => !had.has(id) && id !== self.id);
  if (added.length === 0) return null;
  const byId = new Map(shown.map(task => [task.id, task] as const));
  // What each task shown waits for, as the cloud holds it; this task, as the save would leave it.
  const waitsFor = (id: string) => (id === self.id ? linksOf(item) : linksOf(byId.get(id)));
  for (const start of added) {
    // From the predecessor, back along what it waits for: reaching this task is a circle.
    const cameFrom = new Map<string, string | null>([[start, null]]);
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const next of waitsFor(id)) {
        if (next === self.id) {
          const path: string[] = [];
          for (let step: string | null = id; step && step !== start; step = cameFrom.get(step) ?? null) path.unshift(step);
          const predecessor = byId.get(start);
          if (!predecessor) break;
          return { task: self, predecessor, through: path.map(step => byId.get(step)).filter((task): task is ScheduleItem => Boolean(task)) };
        }
        if (!cameFrom.has(next) && byId.has(next)) {
          cameFrom.set(next, id);
          queue.push(next);
        }
      }
    }
  }
  return null;
}

/** What he is told when the save is refused. */
export function daveWebLinkCircleText(circle: DAVEWebLinkCircle): string {
  const task = circle.task.taskName.trim();
  const predecessor = circle.predecessor.taskName.trim();
  const through = circle.through.map(step => `“${step.taskName.trim()}”`);
  const already = through.length === 0
    ? `“${predecessor}” is already set to start after “${task}”`
    : `“${predecessor}” already comes after “${task}” (through ${through.join(', ')})`;
  return `Not saved. ${already}, on another device or in another browser tab. Making “${task}” start after “${predecessor}” as well would put them in a circle, and the schedule could not place either one. Untick “${predecessor}” and save again, or remove the other link first.`;
}

export const DAVE_WEB_LINK_CHECK_FAILED_TEXT =
  'Not saved. Vitruvius could not read the latest schedule to check this new link against it. Check your connection and try again.';

/**
 * Before a web save of an existing task: why it is refused, or null. Reads
 * the cloud only when the save adds a predecessor link; a read that fails
 * refuses the save in plain words, since the link could not be checked.
 */
export async function daveWebLinkCircleRefusal({
  item,
  opened,
  shownIdOf = id => id,
  load = loadDAVEWebReadOnlySnapshot,
}: {
  item: ScheduleItem;
  opened: Pick<ScheduleItem, 'dependencies'> | null | undefined;
  /**
   * The row this tab shows for a link's predecessor id. The editor saves a link that named a row a master has since
   * replaced as the row shown (owner answer Q29): that is the same link, not one this save adds, and asks nothing.
   */
  shownIdOf?: (predecessorId: string) => string;
  /** Reads every collection from the cloud (never a part answered from this tab's copy). */
  load?: () => Promise<CloudTasks>;
}): Promise<string | null> {
  const links = (task: Pick<ScheduleItem, 'dependencies'> | null | undefined) =>
    new Set(normalizeScheduleDependencies(task?.dependencies).map(link => shownIdOf(link.predecessorItemId.trim())));
  const had = links(opened);
  if (![...links(item)].some(id => !had.has(id))) return null;
  let cloud: CloudTasks;
  try {
    cloud = await load();
  } catch {
    return DAVE_WEB_LINK_CHECK_FAILED_TEXT;
  }
  const circle = daveWebLinkCircleClosedBy({ item, opened, cloud });
  return circle ? daveWebLinkCircleText(circle) : null;
}
