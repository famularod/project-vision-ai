import type { ScheduleItem } from '../types';
import { loadDAVEWebReadOnlySnapshot, type DAVEWebReadOnlySnapshot } from './DAVEWebReadOnlyRepository';
import { scheduleTaskLinkTargets } from './ScheduleTaskRevisions';
import { normalizeScheduleDependencies, scheduleCircleThrough, type ScheduleCircleStep } from './VitruviusScheduleEngine';

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
 *
 * Second review of the web area, F7, the sentence only (7 Oct 2026). The
 * refusal always said the other links were made "on another device or in
 * another browser tab". That is not always so: with a project chosen at
 * the top, the Schedule editor works out "comes after" within the tasks it
 * is handed, so it can offer a task that already comes after the item
 * THROUGH a task filed under another schedule name. Every link of that
 * circle is in the schedule this very tab shows. The save is now told
 * what this tab's schedule holds, and blames another device or tab only
 * for a circle that schedule does not hold; otherwise it says the reason
 * and names the same tasks. Whether a save is refused is decided as
 * before, by what the cloud holds, and what the editor offers is unchanged.
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
  // Open item 3.6 (14 Oct 2026): a task may start after a phase, which finishes when the work in it does. A phase
  // waits for its own tasks and milestones too, so a circle through the work in a phase is found as well.
  const workIn = new Map<string, string[]>();
  shown.forEach(task => {
    const parentId = task.parentItemId?.trim();
    if (!parentId || byId.get(parentId)?.isSummary !== true) return;
    const work = workIn.get(parentId);
    if (work) work.push(task.id);
    else workIn.set(parentId, [task.id]);
  });
  // What each task shown waits for, as the cloud holds it; this task, as the save would leave it.
  const waitsFor = (id: string) =>
    (id === self.id ? linksOf(item) : [...linksOf(byId.get(id)), ...(workIn.get(id) ?? [])]);
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

/**
 * Whether every link of the circle is one the tasks given hold too: the predecessor waits for the first task
 * in between, each of those for the next, and the last for the task being saved. By task, as the list shows
 * links (a link that names a row a master has since replaced is the row shown for that task).
 */
function circleStandsIn(circle: DAVEWebLinkCircle, tasks: CloudTasks): boolean {
  const shown = tasks.scheduleItems as readonly ScheduleItem[];
  const target = scheduleTaskLinkTargets(shown, tasks.knownScheduleItems ?? shown);
  const shownIdOf = (id: string) => target(id)?.id ?? id.trim();
  const byId = new Map(shown.map(task => [task.id, task] as const));
  const chain = [circle.predecessor, ...circle.through, circle.task].map(task => shownIdOf(task.id));
  return chain.slice(0, -1).every((id, index) =>
    normalizeScheduleDependencies(byId.get(id)?.dependencies).some(link => shownIdOf(link.predecessorItemId) === chain[index + 1]));
}

/**
 * What he is told when the save is refused. `inThisSchedule`: every link of the circle is in the schedule
 * this tab shows, so nothing is said of another device or tab (second review, web F7).
 */
export function daveWebLinkCircleText(circle: DAVEWebLinkCircle, { inThisSchedule = false }: { inThisSchedule?: boolean } = {}): string {
  const task = circle.task.taskName.trim();
  const predecessor = circle.predecessor.taskName.trim();
  const through = circle.through.map(step => `“${step.taskName.trim()}”`);
  const already = through.length === 0
    ? `“${predecessor}” is already set to start after “${task}”`
    : `“${predecessor}” already comes after “${task}” (through ${through.join(', ')})`;
  const where = inThisSchedule ? '' : ', on another device or in another browser tab';
  const otherLink = through.length === 0 ? 'the other link' : 'one of the existing links in that chain';
  return `Not saved. ${already}${where}. Making “${task}” start after “${predecessor}” as well would put them in a circle, and the schedule could not place either one. Untick “${predecessor}” and save again, or remove ${otherLink} first.`;
}

export const DAVE_WEB_LINK_CHECK_FAILED_TEXT =
  'Not saved. Vitruvius could not read the latest schedule to check this new link against it. Check your connection and try again.';
export const DAVE_WEB_PHASE_CHECK_FAILED_TEXT =
  'Not saved. Vitruvius could not read the latest schedule to check this change against it. Check your connection and try again.';

/**
 * T1b (14 Oct 2026; review pass 6, H6S-1, caused by d9557b83, open item 3.6). Since a task may start after a phase,
 * a circle can run through a phase: Curb is in the phase Sitework and starts after Paving, which starts after
 * Sitework. Two saves made one: a new task ticked to start after Paving and THEN put in Sitework (the editor's lists
 * and its change preview look at an existing task only), and Fence (after Paving) put in Sitework from a tab that had
 * not seen Paving linked to Sitework (the cloud was read only when a save added a link).
 *
 * The circle the item, as this save would leave it, is in among the tasks given, where it was in none before (as
 * opened; a new item was in none), step by step from the item, with the id it has there; or null. By task, as the
 * list shows links (a link or a parent that names a row a master has since replaced is that task's row shown).
 */
export function daveWebCircleClosedBySave({
  item,
  opened,
  tasks,
}: {
  item: ScheduleItem;
  opened: ScheduleItem | null | undefined;
  tasks: CloudTasks;
}): Readonly<{ selfId: string; steps: readonly ScheduleCircleStep[] }> | null {
  const shown = tasks.scheduleItems as readonly ScheduleItem[];
  const target = scheduleTaskLinkTargets(shown, tasks.knownScheduleItems ?? shown);
  const self = target(item.id) ?? item;
  const shownIdOf = (id: string | null | undefined) => (id?.trim() ? target(id.trim())?.id ?? id.trim() : null);
  const asShown = (task: ScheduleItem): ScheduleItem => ({
    ...task,
    parentItemId: shownIdOf(task.parentItemId),
    dependencies: normalizeScheduleDependencies(task.dependencies)
      .map(link => ({ ...link, predecessorItemId: shownIdOf(link.predecessorItemId) ?? link.predecessorItemId })),
  });
  const others = shown.filter(task => task.id !== self.id).map(asShown);
  const after = scheduleCircleThrough(self.id, [...others, asShown({ ...item, id: self.id })]);
  if (!after) return null;
  const before = opened ? scheduleCircleThrough(self.id, [...others, asShown({ ...opened, id: self.id })]) : null;
  return before ? null : Object.freeze({ selfId: self.id, steps: after });
}

/**
 * What he is told when a save would close a circle through a phase (T1b): the task that closes it first, every step
 * of the circle, and what to change. `elsewhere`: the circle is not in the schedule this tab shows (a link or a phase
 * saved on another device or in another tab is part of it).
 */
export function daveWebCircleText(
  item: ScheduleItem,
  { selfId, steps }: Readonly<{ selfId: string; steps: readonly ScheduleCircleStep[] }>,
  { elsewhere = false }: { elsewhere?: boolean } = {},
): string {
  const quoted = (task: ScheduleItem) => `“${task.taskName.trim()}”`;
  const called = (task: ScheduleItem) => (task.isSummary === true ? `the phase ${quoted(task)}` : quoted(task));
  const phrases = steps.map(step => step.kind === 'after'
    ? `${called(step.item)} starts after ${called(step.predecessor)}`
    : `${called(step.item)} is in the phase ${quoted(step.phase)}`);
  const said = phrases.length < 2 ? phrases.join('') : `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
  // What this item holds in the circle: a link it starts after (untick it), or the phase it is in (move it).
  const own = steps.filter(step => step.item.id === selfId);
  const untick = own.flatMap(step => (step.kind === 'after' ? [quoted(step.predecessor)] : []));
  const moved = own.some(step => step.kind === 'in');
  const remedy = untick.length > 0 && moved
    ? `Untick ${untick.join(' and ')}, or choose another parent phase for ${quoted(item)}, and save again.`
    : untick.length > 0
      ? `Untick ${untick.join(' and ')} and save again.`
      : `Choose another parent phase for ${quoted(item)} and save again.`;
  return `Not saved. ${elsewhere ? 'With what has been saved on another device or in another browser tab, ' : ''}${quoted(item)} would close a circle: ${said}. The schedule could not place them. ${remedy}`;
}

/**
 * Before a web save of an existing task: why it is refused, or null. Reads
 * the cloud only when the save adds a predecessor link; a read that fails
 * refuses the save in plain words, since the link could not be checked.
 *
 * T1b: a new task too (`opened` null), and a circle through a phase. The cloud is read also when the save puts the
 * item in a phase (a new parent phase); a new task, which nothing yet starts after, only when it has both a parent
 * phase and a predecessor (it cannot close a circle otherwise). After the circle of links above (its own sentence, as
 * before), the save is refused if the item, as the form would save it, would close a circle by the cloud's links at
 * this moment (daveWebCircleText); the words say so when this tab's schedule does not show that circle. A circle
 * already saved is not this save's doing (as above).
 */
export async function daveWebLinkCircleRefusal({
  item,
  opened,
  shownIdOf = id => id,
  here,
  load = loadDAVEWebReadOnlySnapshot,
}: {
  item: ScheduleItem;
  /** The item as the editor opened it, or null for a new item. */
  opened: ScheduleItem | null | undefined;
  /**
   * The schedule this tab shows, whatever is chosen at the top of the page: the tasks shown, and every saved row.
   * Only for the sentence: a circle whose links are all in it was not made on another device or in another tab.
   * A caller that does not say gets the sentence as it was.
   */
  here?: CloudTasks | null;
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
  const addsLink = [...links(item)].some(id => !had.has(id));
  const parentOf = (task: Pick<ScheduleItem, 'parentItemId'> | null | undefined) =>
    (task?.parentItemId?.trim() ? shownIdOf(task.parentItemId.trim()) : '');
  const putInPhase = Boolean(parentOf(item)) && parentOf(item) !== parentOf(opened);
  const mayCloseThroughPhase = opened ? addsLink || putInPhase : Boolean(parentOf(item)) && links(item).size > 0;
  if (!(opened && addsLink) && !mayCloseThroughPhase) return null;
  let cloud: CloudTasks;
  try {
    cloud = await load();
  } catch {
    return addsLink ? DAVE_WEB_LINK_CHECK_FAILED_TEXT : DAVE_WEB_PHASE_CHECK_FAILED_TEXT;
  }
  if (opened && addsLink) {
    const circle = daveWebLinkCircleClosedBy({ item, opened, cloud });
    if (circle) return daveWebLinkCircleText(circle, { inThisSchedule: Boolean(here) && circleStandsIn(circle, here as CloudTasks) });
  }
  if (!mayCloseThroughPhase) return null;
  // Decided by the cloud's links at this moment, with the item as the form would save it (F7: a circle only this
  // tab's stale copy still holds refuses nothing). This tab's schedule only chooses the words.
  const inTheCloud = daveWebCircleClosedBySave({ item, opened, tasks: cloud });
  if (!inTheCloud) return null;
  const inThisTab = here ? daveWebCircleClosedBySave({ item, opened, tasks: here }) : null;
  return daveWebCircleText(item, inThisTab ?? inTheCloud, { elsewhere: !inThisTab });
}
