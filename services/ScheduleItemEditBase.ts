import { PROJECT_ITEM_TYPES, SCHEDULE_PRIORITIES, type ProjectItemActivity, type ScheduleItem } from '../types';
import { projectTimeZoneOrDefault } from './ProjectDateTime';
import { scheduleCalendarDayKey } from './ScheduleCalendarDay';
import { canonicalScheduleItemJson } from './ScheduleItemCloudAcknowledgement';
import { scheduleTaskEarlierIds } from './ScheduleTaskRevisions';
import { mergeProjectControlsRevisions, normalizeProjectControls } from './VitruviusProjectControls';
import { normalizeScheduleDependencies } from './VitruviusScheduleEngine';
import {
  SCHEDULE_CARRIED_PROGRESS_FIELDS, scheduleEntryUndone, scheduleFileTookHisPercentOver, scheduleManagersOwnPercent, scheduleProgressIsManagers, scheduleProgressJudgedAt,
} from './ScheduleProgressSource';

/**
 * Owner answer Q28 (2 Oct 2026): "remember which cloud copy each edit started
 * from ... Schedule tasks keep both devices' changes field by field and ask
 * only when the same field changed on both."
 *
 * A queued task edit names the fields it changed (changedFields). It now also
 * keeps the copy it started from: for each of those fields, the value the
 * task had before the edit, and that copy's stamp. It is kept in the queue
 * item, on the device, for the account that queued it, so it lasts through a
 * relaunch. A queue item made by Build 229 or earlier has none and is sent
 * as before.
 */
export type ScheduleItemEditBase = Readonly<{
  /** The stamp (updatedAt) of the copy the edit started from. */
  updatedAt: string | null;
  /** Each field the edit changed, as that copy had it (null for none). */
  fields: Readonly<Record<string, unknown>>;
  /**
   * The values this edit itself held for a field before its latest one, while
   * it waited (review N1 finding 4): a short mark of each. An upload may have
   * put one in the cloud without the device hearing back (the answer lost on
   * weak signal, the app closed), so the cloud holding one is this device's
   * own earlier text, not another device's change.
   */
  own?: Readonly<Record<string, readonly string[]>>;
  /**
   * On a whole copy's base (review N1 finding 3): a mark of the rest of the
   * task as that copy had it, everything but what is weighed field by field
   * and its stamps. The cloud's row bearing the same mark has changed since
   * only in what David types about the task.
   */
  rest?: string;
  /**
   * On a whole copy's base (review P7-2): the whole task as that copy
   * started from it. With it the copy is weighed field by field when the
   * rest of the cloud's row has changed too (scheduleItemWholeCopyFieldByField).
   * Missing on a copy queued by Build 230 or earlier, which goes as before.
   */
  copy?: Readonly<Record<string, unknown>>;
  /**
   * The fields of which a write has already sent a value of this device's
   * (review P7-3): on the record a waiting new row keeps, and on the edit
   * its retry makes. The cloud's row holding such a field as the row was
   * made is then not "nobody has changed it" but another device's change
   * back (a clear on the web of the owner he typed), and is asked about.
   */
  sent?: readonly string[];
}>;

/**
 * Fields never asked about. Identity, stamps, import memberships and the
 * earlier task ids are no edit of David's (as in the conflict check, A7 pass
 * 15). The progress keeps its own rules (photo results, owner answer Q22's
 * floor, Q32 (b), the carry, Talk's Undo), as do the imports' notes of the
 * task: each goes as before. The project controls have their own merge, and
 * the activity log is appended to by both (scheduleItemActivityOfBoth).
 */
const FIELDS_NEVER_ASKED: ReadonlySet<string> = new Set<string>([
  'id', 'createdAt', 'updatedAt', 'projectId', 'cloudUpdatedAt', 'revisedFromTaskIds', 'alsoImportedInBatchIds',
  'alsoImportedSourceRow', 'projectControls', 'activity', 'progressUndone', 'fileProgressPeak', ...SCHEDULE_CARRIED_PROGRESS_FIELDS,
  // What a schedule's import keeps about the task, under the imports' own rules (with owner answers Q29 and Q30: the
  // file's unique id, the rows David said are not revisions of each other), and the shown copy's lookahead dates,
  // never saved.
  'lookaheadOverlay', 'importBatchId', 'importedFrom', 'importedAt', 'importedAsLookahead', 'sourceDocumentId',
  'sourceActivityId', 'sourceWbsCode', 'sourceRowNumber', 'scheduleRowsAwaitingCurrent', 'percentCompleteStated',
  'sourceUniqueId', 'notRevisionOfTaskIds', 'savedLookaheadDates',
  // Goes with its field (FIELD_COMPANIONS).
  'dependenciesUpdatedAt',
]);

/**
 * A field's stamp, which goes wherever the field goes: the hand links' stamp
 * (owner answer Q29) with the links. Never asked about on its own.
 */
const FIELD_COMPANIONS: Readonly<Record<string, readonly string[]>> = { dependencies: ['dependenciesUpdatedAt'] };

/** These fields with the stamps that go with them (FIELD_COMPANIONS). */
export function scheduleItemFieldsWithCompanions(fields: readonly string[]): string[] {
  return [...new Set(fields.flatMap(field => [field, ...(FIELD_COMPANIONS[field] ?? [])]))];
}

/**
 * The fields a whole copy of a task (a schedule approved, a lookahead deleted,
 * a percent carried on Set Active) is weighed on field by field, after the
 * sync merge (recoverDAVEScheduleRecords) has weighed it whole: what David
 * types about a task. Its dates, progress, lookahead note and import
 * memberships keep the merge's own rules.
 */
const WHOLE_COPY_FIELDS_WEIGHED = [
  'notes', 'owner', 'contractor', 'milestone', 'priority', 'nextAction', 'dependencies', 'itemType', 'parentItemId',
  'wbsCode', 'sortOrder', 'isSummary', 'isMilestone',
] as const;

/** The copy a whole copy of a task started from: its weighed fields as the task had them before (owner answer Q28). */
export function scheduleItemWholeCopyBase(before: ScheduleItem | null | undefined): ScheduleItemEditBase | undefined {
  if (!before || typeof before !== 'object') return undefined;
  const record = before as unknown as Record<string, unknown>;
  return {
    updatedAt: typeof before.updatedAt === 'string' ? before.updatedAt : null,
    fields: Object.fromEntries(WHOLE_COPY_FIELDS_WEIGHED.map(field => [field, record[field] ?? null])),
    rest: restMark(before),
    copy: record,
  };
}

/** Weighed elsewhere, or no change of a copy's: what he types, the controls and the activity (merged), identity and stamps. */
const WHOLE_COPY_ELSEWHERE: ReadonlySet<string> = new Set<string>([
  ...WHOLE_COPY_FIELDS_WEIGHED, ...Object.values(FIELD_COMPANIONS).flat(), 'projectControls', 'activity',
  'id', 'createdAt', 'updatedAt', 'cloudUpdatedAt', 'projectId', 'textFromTask', 'savedLookaheadDates',
]);
/** What two copies of a task both add to: the sync merge's union of them stands. */
const WHOLE_COPY_OF_BOTH: ReadonlySet<string> = new Set<string>(['alsoImportedInBatchIds', 'alsoImportedSourceRow', 'revisedFromTaskIds']);

/** Not part of a task's rest: what is weighed field by field, the stamps, and the project id an upload binds. */
const REST_ASIDE: ReadonlySet<string> = new Set<string>([
  ...WHOLE_COPY_FIELDS_WEIGHED, ...Object.values(FIELD_COMPANIONS).flat(), 'updatedAt', 'cloudUpdatedAt', 'projectId',
  'textFromTask', // what a row took of the fields weighed one by one (review N3 R3)
]);

/**
 * A mark of a task's rest: every field not weighed one by one, stamps aside. Each field as the app reads it back, and
 * one that reads as a missing field left out (review P4 F2): the phone's copy of a row the web's upload wrote has
 * the empty activity list, the blank controls and the time zone the app fills in, and its rest read as changed.
 */
function restMark(item: unknown): string {
  const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  const text = canonicalScheduleItemJson(Object.fromEntries(Object.entries(record)
    .filter(([field]) => !REST_ASIDE.has(field) && fieldValue(record, field) !== fieldValue(null, field))
    .map(([field, value]) => [field, scheduleItemFieldAsRead(field, value)])));
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/**
 * Whether the cloud's row has changed since a whole copy's base only in what
 * David types about the task (review N1 finding 3, Low, caused by 79a5ae1).
 * A lookahead approved offline met a note another device typed meanwhile: the
 * note's upload had stamped the cloud's row newer, so the sync merge took the
 * cloud's row whole and the lookahead's dates were on no device, with no
 * card. With the rest of the cloud's row still as this copy started from it,
 * this copy stands for the rest (its dates, lookahead, progress), and the
 * typed fields are weighed one by one as before.
 */
export function scheduleItemWholeCopyRestUnchanged(base: ScheduleItemEditBase | null | undefined, remote: ScheduleItem): boolean {
  return isEditBase(base) && typeof base.rest === 'string' && base.rest === restMark(remote);
}

/**
 * The stamp of a row made from this device's copy and the cloud's: just after
 * the later of the two (review N1 finding 3). Stamped with the time of the
 * upload, the older of two lookaheads approved offline outranked the newer
 * one, uploaded after it: its dates were shown on every device.
 */
export function scheduleItemStampAfter(...stamps: Array<string | null | undefined>): string {
  const times = stamps.map(stamp => (stamp ? Date.parse(stamp) : Number.NaN)).filter(Number.isFinite);
  return new Date(times.length > 0 ? Math.max(...times) + 1 : Date.now()).toISOString();
}

/**
 * A whole copy as the sync merge made it with the cloud's row, weighed on its
 * base's fields (owner answer Q28): one this device left as it was keeps the
 * cloud's value, one only this device changed keeps this device's, and one
 * changed on both to different values is asked about.
 */
export function scheduleItemWholeCopyAgainstCloud(
  merged: ScheduleItem,
  local: ScheduleItem,
  base: ScheduleItemEditBase | null | undefined,
  remote: ScheduleItem,
  /** The task of a row id, for his hand links (review P6-1). */
  taskOf?: (rowId: string) => string,
): Readonly<{ itemData: ScheduleItem; asked: string[]; sentHere: string[] }> {
  if (!isEditBase(base)) return { itemData: merged, asked: [], sentHere: [] };
  const next = { ...merged } as unknown as Record<string, unknown>;
  const asked: string[] = [];
  const sentHere: string[] = [];
  const byTask = comparedBy(taskOf);
  WHOLE_COPY_FIELDS_WEIGHED.forEach(field => {
    if (!Object.prototype.hasOwnProperty.call(base.fields, field)) return;
    const was = fieldValue(base.fields, field);
    const here = fieldValue(local, field);
    const cloud = fieldValue(remote, field);
    // (The cloud holding a value this copy held earlier is this device's own write, not another's change: review P7-4.)
    // (Nor is the cloud holding the copy it started from "unchanged there" for a field of his a write has sent: S2 item 6.)
    const byIds = here === was ? remote : (cloud === was && !base.sent?.includes(field)) || cloud === here || isOwnEarlierValue(base, field, cloud) ? local : null;
    // Review P6-1: links that would be asked about for the rows they name are weighed by the tasks they name. His
    // unchanged by task, or the same by task on both sides: the cloud's, as written there. The cloud's unchanged by
    // task: his, each naming the row the cloud's copy names for its task.
    const [wasBy, hereBy, cloudBy] = !byIds && field === 'dependencies' && taskOf ? [base.fields, local, remote].map(source => byTask(source, field)) : [];
    const hisByTask = !byIds && wasBy !== undefined && cloudBy === wasBy && hereBy !== wasBy;
    const source = byIds ?? (wasBy === undefined ? null : hereBy === wasBy || cloudBy === hereBy ? remote : hisByTask ? local : null);
    const companions = FIELD_COMPANIONS[field] ?? [];
    if (!source) {
      asked.push(field);
      [field, ...companions].forEach(name => setField(next, name, remote));
      setRecordEntry(next, field, remote);
      return;
    }
    if (here !== was && source === local) sentHere.push(field);
    [field, ...companions].forEach(name => setField(next, name, source));
    if (hisByTask) next.dependencies = scheduleItemLinksAsNamedIn(local, remote, taskOf!);
    setRecordEntry(next, field, source);
  });
  return { itemData: next as unknown as ScheduleItem, asked, sentHere };
}

/**
 * Review P7-2 (6 Oct 2026, Medium; older: Build 229 lost the same for any
 * edit made meanwhile, and 3 Oct's d0bdf4f saved only a note or an owner
 * typed on the phone or iPad): a whole copy of a task weighed against the
 * cloud's row FIELD BY FIELD, when the rest of the cloud's row has changed
 * since the copy this one started from.
 *
 * A lookahead approved with no signal moved Framing to 10/22 at 40%.
 * Meanwhile an approval status, a schedule impact, his own percent or a hand
 * move of the dates was set on the task on another device, or a note was
 * typed on the web (whose save stamps more of the row than the note). The
 * cloud's row then read as "changed", was the later, and was taken whole:
 * 10/15 at 0% on every device, with no card, under a lookahead in effect
 * that lists the task.
 *
 * The one rule, as for an edit (owner answer Q28): the copy is this device's
 * changes since the copy it started from.
 *  - a field only this copy changed goes on the cloud's row (the lookahead's
 *    dates, its note of the master's dates, its percent);
 *  - a field only the cloud's row changed stays (the approval, the impact,
 *    the web's note, his percent entered elsewhere);
 *  - a field changed on both to different values is asked about, and the
 *    cloud's stays until he chooses (dates moved by hand against the
 *    lookahead's);
 *  - what is never asked keeps its own rule: the project controls, each
 *    field by its own time; the activity of both; the progress, when both
 *    changed it, as the sync merge states it (`merged`: his own later percent
 *    over a file's, owner answer Q22); the imports a task belongs to, of both.
 * What he types about the task (WHOLE_COPY_FIELDS_WEIGHED) is weighed after,
 * on the row this gives (scheduleItemWholeCopyAgainstCloud).
 *
 * Null, and the copy goes as before, without the copy it started from, or
 * when both changed something that is an import's own and has no rule here
 * (two lookaheads approved apart: the sync merge orders those).
 */
export function scheduleItemWholeCopyFieldByField(
  local: ScheduleItem,
  base: ScheduleItemEditBase | null | undefined,
  remote: ScheduleItem,
  merged: ScheduleItem,
): Readonly<{ itemData: ScheduleItem; asked: string[] }> | null {
  const was = isEditBase(base) ? base.copy : undefined;
  if (!was || typeof was !== 'object') return null;
  const changedHere = (field: string) => fieldValue(local, field) !== fieldValue(was, field);
  const changedThere = (field: string) => fieldValue(remote, field) !== fieldValue(was, field);
  const next = { ...remote } as unknown as Record<string, unknown>;
  const asked: string[] = [];
  const progress: readonly string[] = SCHEDULE_PROGRESS_FIELDS;
  for (const field of new Set([...Object.keys(local), ...Object.keys(was), ...Object.keys(remote)])) {
    if (WHOLE_COPY_ELSEWHERE.has(field) || progress.includes(field) || !changedHere(field)) continue;
    if (!changedThere(field) || fieldValue(remote, field) === fieldValue(local, field) || isOwnEarlierValue(base as ScheduleItemEditBase, field, fieldValue(remote, field))) setField(next, field, local);
    else if (WHOLE_COPY_OF_BOTH.has(field)) setField(next, field, merged);
    else if (FIELDS_NEVER_ASKED.has(field)) return null;
    else asked.push(field);
  }
  // The progress goes together: this copy's when only it changed it, the sync merge's when both did.
  if (progress.some(changedHere)) progress.forEach(field => setField(next, field, progress.some(changedThere) ? merged : local));
  const controls = local.projectControls && remote.projectControls ? mergeProjectControlsRevisions(local.projectControls, remote.projectControls) : local.projectControls ?? remote.projectControls;
  if (controls) next.projectControls = controls;
  if (changedHere('activity')) next.activity = scheduleItemActivityOfBoth(local.activity, remote.activity);
  return { itemData: next as unknown as ScheduleItem, asked };
}

/** A whole copy waiting here, as shown over the cloud's row: the weighed fields it left as they were take the cloud's. */
export function scheduleItemWholeCopyOverCloud(
  local: ScheduleItem,
  base: ScheduleItemEditBase | null | undefined,
  cloud: ScheduleItem,
): ScheduleItem {
  if (!isEditBase(base)) return local;
  const next = { ...local } as unknown as Record<string, unknown>;
  WHOLE_COPY_FIELDS_WEIGHED.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(base.fields, field) && fieldValue(local, field) === fieldValue(base.fields, field)) {
      [field, ...(FIELD_COMPANIONS[field] ?? [])].forEach(name => setField(next, name, cloud));
      setRecordEntry(next, field, cloud);
    }
  });
  return next as unknown as ScheduleItem;
}

/**
 * Review P4: what a row says it took for a field (textFromTask) goes with the
 * field's value when two copies of the row are put together. The cloud's
 * copy held an owner an edit had been sent on to it with, and its record said
 * so; a whole copy from a device that had not heard (a master approved there
 * that left the task where it was) kept the cloud's owner beside its own
 * older record, a blank. The owner cleared on the row after that read as "a
 * blank the row took", and came back from the old row (the reviewer's
 * generator, two masters apart, seed 9139).
 */
function setRecordEntry(target: Record<string, unknown>, field: string, source: unknown) {
  const own = target.textFromTask as ScheduleItem['textFromTask'];
  const from = source && typeof source === 'object' ? (source as ScheduleItem).textFromTask : undefined;
  if (!own || !from || own.taskId !== from.taskId) return;
  const has = (record: object) => Object.prototype.hasOwnProperty.call(record, field);
  if (!has(own) || !has(from) || fieldValue(own, field) === fieldValue(from, field)) return;
  target.textFromTask = { ...own, [field]: (from as Record<string, unknown>)[field] } as ScheduleItem['textFromTask'];
}

function setField(target: Record<string, unknown>, field: string, source: unknown) {
  const value = source && typeof source === 'object' ? (source as Record<string, unknown>)[field] : undefined;
  if (value === undefined) delete target[field];
  else target[field] = value;
}

/** The copy an edit of these fields started from, or none without that copy. */
export function scheduleItemEditBase(
  before: ScheduleItem | null | undefined,
  changedFields: readonly string[] | null | undefined,
): ScheduleItemEditBase | undefined {
  if (!before || typeof before !== 'object' || !Array.isArray(changedFields)) return undefined;
  const record = before as unknown as Record<string, unknown>;
  const fields = changedFields.filter(field => field !== 'updatedAt');
  if (fields.length === 0) return undefined;
  return {
    updatedAt: typeof before.updatedAt === 'string' ? before.updatedAt : null,
    fields: Object.fromEntries(fields.map(field => [field, record[field] ?? null])),
  };
}

/**
 * The fields an edit changed, with the whole of the task's progress when the
 * edit is David's own percent and the cloud's row shows a file's percent with
 * his earlier one noted under it (schedule review N1 M3, Medium; caused by
 * 79a5ae1 on a cold start, older on a refresh). David's 15% stood under a
 * lookahead's 20% ("Schedule update", his own 15% noted under it). On a phone
 * that had not heard of that lookahead he entered 85%: there the percent was
 * already his, so the edit named only the percent and its time, and the
 * cloud's row then read 85% by "Schedule update" with his own still noted as
 * 15%. The next lookahead listed 20%, above "his" 15%, and 85% became 20% on
 * every device. Who stated the percent, when he judged it and what it stands
 * over go with it then, so his own entry reaches the cloud as his: owner
 * answer Q22's floor sees it, and a lookahead never sets the task below it.
 * Any other edit names its own fields, as before.
 */
export function scheduleItemFieldsWithOwnProgress<T extends string>(local: ScheduleItem, changedFields: readonly T[], remote: ScheduleItem): T[] {
  const progress: readonly string[] = SCHEDULE_CARRIED_PROGRESS_FIELDS;
  const ownOverFiles = changedFields.some(field => progress.includes(field)) && scheduleProgressIsManagers(local) &&
    !scheduleProgressIsManagers(remote) && typeof remote.managersPercentUnderFile === 'number';
  return ownOverFiles ? [...new Set([...changedFields, ...(progress as readonly T[])])] : [...changedFields];
}

type EditScope = Readonly<{ changedFields?: unknown; base?: unknown; itemData?: unknown; carriedText?: unknown }>;

/** How many of an edit's own earlier values a field keeps (the latest ones). */
const OWN_VALUES_KEPT = 40;

/** A short mark of a field's value as compared (fieldValue): itself when short, else its length and a hash. */
function valueMark(value: string): string {
  if (value.length <= 48) return value;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `#${value.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * Among a field's own earlier values: the cloud's row had nothing in the field when a carry filled it on this
 * device, and David typed over the carried value before it went up (review N3 P3-1). No value's mark reads so.
 */
const BLANK_UNDER_CARRY = '(blank)';

/** Whether the cloud's value of a field is one this edit itself held earlier (ScheduleItemEditBase.own). */
function isOwnEarlierValue(base: ScheduleItemEditBase, field: string, cloud: string): boolean {
  const own = base.own?.[field];
  if (!Array.isArray(own)) return false;
  return own.includes(valueMark(cloud)) || (own.includes(BLANK_UNDER_CARRY) && (cloud === 'null' || /^"\s*"$/.test(cloud)));
}

/**
 * Two queued edits of a task made one: each field keeps the copy its first
 * edit started from. A field the earlier edit changed without a base (a
 * queue item from Build 229 or earlier) gets none: it is sent as before.
 *
 * Review N3 P3-1 (pass 3, sync; Low, caused by c3899ef): an owner, a
 * contractor or a note the sync carried to a task's new row waits to go up
 * in the same queue record (review N2 P1: `carriedText` names those fields).
 * It is the sync's, not an edit of David's, and started from no copy. When he
 * typed over one before it had gone up, the carry counted as that field's
 * first edit, so his own kept no copy and went up unweighed: over an owner
 * another device had set on that row meanwhile, with no card. His edit of
 * such a field is the field's first: it keeps the copy he saw (the carried
 * value), and the blank the carry was to fill counts as a value this record
 * started from. So over a blank his goes up, as the carry would have; over
 * the very value he typed over (another device carried the same) his goes
 * up; over anything else Review Conflicts asks, as for any edit of his.
 */
export function scheduleItemEditBasesMerged(existing: EditScope, incoming: EditScope): ScheduleItemEditBase | undefined {
  const earlier = isEditBase(existing.base) ? existing.base : undefined;
  const later = isEditBase(incoming.base) ? incoming.base : undefined;
  // A whole copy queued earlier may have changed any field: its own base, or none.
  if (!Array.isArray(existing.changedFields)) return earlier;
  const earlierFields = new Set(existing.changedFields.map(String));
  const carried = new Set(Array.isArray(existing.carriedText) ? existing.carriedText.map(String) : []);
  const overWaitingCarry = (field: string) => carried.has(field) && !Object.prototype.hasOwnProperty.call(earlier?.fields ?? {}, field);
  const fields: Record<string, unknown> = { ...(earlier?.fields ?? {}) };
  Object.entries(later?.fields ?? {}).forEach(([field, value]) => {
    if (!earlierFields.has(field) || overWaitingCarry(field)) fields[field] = value;
  });
  if (Object.keys(fields).length === 0) return undefined;
  // What the waiting edit held for a field the newer edit changes again is its own earlier value (review N1 finding
  // 4): an upload may have landed it with its answer lost, and the retry then set David's text against his own.
  const own: Record<string, readonly string[]> = { ...(earlier?.own ?? {}) };
  (Array.isArray(incoming.changedFields) ? incoming.changedFields.map(String) : []).forEach(field => {
    if (overWaitingCarry(field) && Object.prototype.hasOwnProperty.call(later?.fields ?? {}, field)) { own[field] = [BLANK_UNDER_CARRY]; return; }
    if (field === 'updatedAt' || !earlierFields.has(field) || !Object.prototype.hasOwnProperty.call(earlier?.fields ?? {}, field)) return;
    const before = fieldValue(existing.itemData, field);
    if (before === fieldValue(incoming.itemData, field)) return;
    const mark = valueMark(before);
    own[field] = [...(own[field] ?? []).filter(known => known !== mark), mark].slice(-OWN_VALUES_KEPT);
  });
  // A whole copy joining an edit still waiting (a note typed with no signal, then a lookahead approved): the task as the
  // cloud last gave it is the copy the whole copy started from, less what that edit had changed (review P7-2).
  const copy = !Array.isArray(incoming.changedFields) && later?.copy ? { ...later.copy, ...(earlier?.fields ?? {}) } : undefined;
  return { updatedAt: earlier?.updatedAt ?? later?.updatedAt ?? null, fields, ...(Object.keys(own).length > 0 ? { own } : {}), ...(copy ? { copy } : {}) };
}

/**
 * Review P6-2 (6 Oct 2026, Low; older): what he has changed on a master's new
 * row since the approval made it, kept beside the row's whole copy while it
 * waits to go up for the first time. The approval queues the row with this
 * record empty; each edit of his that joins the waiting copy adds the fields
 * it changed, each as the row was made (the copy his first edit of it
 * started from) and the values he has held for it since (as any waiting edit
 * keeps them). The retry of a first upload whose answer was lost reads it
 * (scheduleItemNewRowMetAgain).
 *
 * Kept only while every change to the waiting copy is such an edit. A change
 * of the sync's own (a carry) may have changed anything: the record is
 * dropped, and the copy goes on as it did before there was one. A whole copy
 * saved over it (a lookahead approved on the task) takes the record as the
 * copy it started from (review P7-4, scheduleItemWholeCopyBaseSinceMade).
 *
 * Review P7-5: on every row the approval makes, a task the master adds too
 * (it replaces no row); it was only on a row that replaces one.
 */
export const SCHEDULE_ITEM_AS_MADE: ScheduleItemEditBase = { updatedAt: null, fields: {} };

export function scheduleItemChangedSinceMade(existing: EditScope & Readonly<{ sinceMade?: unknown; writeTried?: unknown }>, incoming: EditScope): ScheduleItemEditBase | undefined {
  const known = existing.sinceMade;
  const base = incoming.base;
  if (!isEditBase(known) || Array.isArray(existing.changedFields) || !Array.isArray(incoming.changedFields) || !isEditBase(base)) return undefined;
  const fields = incoming.changedFields.map(String).filter(field => field !== 'updatedAt');
  if (!fields.every(field => Object.prototype.hasOwnProperty.call(base.fields, field))) return undefined;
  const merged = scheduleItemEditBasesMerged({ changedFields: Object.keys(known.fields), base: known, itemData: existing.itemData }, incoming) ?? known;
  // Review P7-3: a write of the waiting copy has been tried as it stood (existing.writeTried): what he had changed on
  // it by then has been sent.
  const sent = [...new Set([...(known.sent ?? []), ...(existing.writeTried === true ? scheduleItemFieldsChangedSinceMade(existing.itemData, known) : [])])];
  return sent.length > 0 ? { ...merged, sent } : merged;
}

/** The fields the record names that the waiting copy no longer holds as the row was made. */
function scheduleItemFieldsChangedSinceMade(waiting: unknown, sinceMade: ScheduleItemEditBase): string[] {
  return Object.keys(sinceMade.fields).filter(field => fieldValue(waiting, field) !== fieldValue(sinceMade.fields, field));
}

/**
 * Review P7-4 (6 Oct 2026, Low; older: the same on 8f8ec54): a whole copy
 * saved over a row this device's approval made and that still waits to go up
 * (a lookahead approved on the task), as the copy the waiting record started
 * from: the row AS THE APPROVAL MADE IT, what he has changed on it since put
 * back (the record, `sinceMade`). The record itself was dropped there, and
 * the copy then went up whole over the row its own first write had made:
 * with that write's answer lost, the note and owner the first write had
 * taken from the other device were gone from the task, with no card.
 * Weighed from the row as made (scheduleItemWholeCopyFieldByField), the
 * lookahead's dates and his own changes go on the cloud's row and the rest
 * of it stays. Undefined without the record or without the copy the whole
 * copy started from.
 */
export function scheduleItemWholeCopyBaseSinceMade(
  sinceMade: unknown,
  incomingBase: unknown,
  /** The copy that waited, and whether a write of it was tried as it stood (Build 231, S2 item 6). */
  waiting?: Readonly<{ itemData?: unknown; writeTried?: unknown }>,
): ScheduleItemEditBase | undefined {
  if (!isEditBase(sinceMade) || !isEditBase(incomingBase) || !incomingBase.copy) return undefined;
  const made: Record<string, unknown> = { ...incomingBase.copy, ...sinceMade.fields };
  // S2 item 6 (the gap review P7-3 left on this path): what a write has already sent of his goes with the record, so
  // the whole copy's weighing asks, as the retry's edit does, when another device has put such a field back.
  const sent = [...new Set([...(sinceMade.sent ?? []), ...(waiting?.writeTried === true ? scheduleItemFieldsChangedSinceMade(waiting.itemData, sinceMade) : [])])];
  return {
    updatedAt: null,
    fields: Object.fromEntries(WHOLE_COPY_FIELDS_WEIGHED.map(field => [field, made[field] ?? null])),
    copy: made,
    ...(sinceMade.own ? { own: sinceMade.own } : {}),
    ...(sent.length > 0 ? { sent } : {}),
  };
}

export function isEditBase(value: unknown): value is ScheduleItemEditBase {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Boolean((value as { fields?: unknown }).fields) && typeof (value as { fields?: unknown }).fields === 'object';
}

/** His text on a task: the app holds '' for none. */
const TEXT_FIELDS_BLANK_WHEN_MISSING: ReadonlySet<string> = new Set([
  'projectName', 'locationName', 'milestone', 'owner', 'contractor', 'notes', 'nextAction',
]);
/** Text the app holds as null for none. */
const TEXT_FIELDS_NULL_WHEN_MISSING: ReadonlySet<string> = new Set([
  'scheduleProjectName', 'wbsCode', 'parentItemId', 'baselineStartDate', 'baselineFinishDate', 'progressConfirmedAt', 'progressConfirmedBy',
  'importedFrom', 'importedAt', 'importBatchId', 'sourceDocumentId', 'sourceActivityId', 'sourceWbsCode', 'updatedAt',
]);

/**
 * Review P4 F2 (6 Oct 2026, Medium; caused by 79a5ae1, owner answer Q28): one
 * field of a task as the app itself reads it back. The phone and the iPad
 * hold every task as App.tsx's normalizeScheduleItem leaves it: a field the
 * saved row lacks is filled in (a blank next step, an empty list of links,
 * "Task", "Medium", the blank project controls...). A row the web's upload
 * writes has no next step and no links at all. Compared as stored, his first
 * next step or hand link on such a task read as "started from a blank, and
 * the cloud has something else (nothing)": changed on both. It was kept off
 * the task and Review Conflicts asked "Next action: Call the inspector /
 * (none)", though nobody had changed anything anywhere else.
 *
 * Two copies of a task are compared as the app would read each of them: a
 * missing field, a null and the value the app fills in for a missing one are
 * the same thing, and a date is its calendar day however it is written. Every
 * field the app's normalizer fills in or rewrites is here; the test
 * (review-p4-sched-fields-as-the-app-reads-them) runs rows through that
 * normalizer itself, compiled from App.tsx, and compares each field.
 */
export function scheduleItemFieldAsRead(field: string, value: unknown): unknown {
  const text = typeof value === 'string' && value.trim() ? value : null;
  if (TEXT_FIELDS_BLANK_WHEN_MISSING.has(field)) return text ?? '';
  if (TEXT_FIELDS_NULL_WHEN_MISSING.has(field)) return text;
  switch (field) {
    case 'startDate': case 'finishDate': return scheduleCalendarDayKey(value);
    case 'dependencies': return normalizeScheduleDependencies(value);
    case 'activity': return Array.isArray(value) ? value : [];
    case 'isSummary': case 'isMilestone': return value === true;
    // (As normalizeProjectItemType reads it; that module is not loaded here, for the scripts that load the sync with no types.)
    case 'itemType': return (PROJECT_ITEM_TYPES as readonly unknown[]).includes(value) ? value : 'Task';
    case 'priority': return (SCHEDULE_PRIORITIES as readonly unknown[]).includes(value) ? value : 'Medium';
    case 'projectControls': return normalizeProjectControls(value);
    case 'projectTimeZone': return projectTimeZoneOrDefault(value);
    case 'percentComplete': return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    case 'status': return text ?? 'Not Started';
    default: return value ?? null;
  }
}

/** One field as compared: as the app reads it back (scheduleItemFieldAsRead), key order aside. */
function fieldValue(source: unknown, field: string): string {
  const value = scheduleItemFieldAsRead(field, source && typeof source === 'object' ? (source as Record<string, unknown>)[field] : undefined);
  return value === undefined || value === null ? 'null' : canonicalScheduleItemJson(value);
}

/**
 * Review P6-1 (6 Oct 2026, Low; half caused by the hand-link commit, 12ab6a3,
 * half older): one field as two copies of a task are weighed against each
 * other, wherever they are weighed. His hand links are compared by the tasks
 * they name when the rows' tasks are known (`taskOf`, scheduleTaskOfRowId):
 * a link names its predecessor by a row's id, and a master gives a task a
 * new row. That was done only where a master's new row first goes up
 * (scheduleItemAgainstItsTask); an EDIT of the links was still weighed by
 * row ids. So the very same link made on both sides of a master was "changed
 * on both" (a card whose two sides both read "Predecessors: 1 item"), and a
 * second link added by a device that had not heard of the master, over a
 * link the approval had only re-pointed, was held in a card too.
 */
const comparedBy = (taskOf?: (rowId: string) => string) => (source: unknown, field: string): string =>
  (field === 'dependencies' && taskOf ? scheduleItemLinksKey(source, taskOf) : fieldValue(source, field));

/**
 * Review P6-1: this device's links, each naming the row the cloud's copy
 * names for the same task where it names one (the approval's re-pointing, or
 * the other device's link, stays as it is written there).
 */
function scheduleItemLinksAsNamedIn(source: unknown, cloud: unknown, taskOf: (rowId: string) => string): ReturnType<typeof normalizeScheduleDependencies> {
  const linksOf = (copy: unknown) => normalizeScheduleDependencies(copy && typeof copy === 'object' ? (copy as { dependencies?: unknown }).dependencies : undefined);
  const named = new Map(linksOf(cloud).map(link => [taskOf(String(link.predecessorItemId ?? '').trim()), link.predecessorItemId] as const));
  return linksOf(source).map(link => ({ ...link, predecessorItemId: named.get(taskOf(String(link.predecessorItemId ?? '').trim())) ?? link.predecessorItemId }));
}

export type ScheduleItemEditAgainstCloud = Readonly<{
  /** The device's copy to send, with both devices' activity entries. */
  itemData: ScheduleItem;
  /** Changed here and on another device to something else: Review Conflicts asks. */
  asked: string[];
  /** Back to the copy it started from here, changed on another device: the cloud's value stays. */
  keptFromCloud: string[];
  /** The stamps of the fields asked about, held back with them (FIELD_COMPANIONS). */
  held: string[];
}>;

/**
 * A queued edit weighed against the cloud's row, field by field (owner answer
 * Q28): a field the cloud still has as the edit's copy had it takes this
 * device's value; one the cloud changed to this device's value needs
 * nothing; one changed on both to different values is asked about. Fields
 * without a base, and those never asked about, go as before.
 */
export function scheduleItemEditAgainstCloud(
  itemData: ScheduleItem,
  changedFields: readonly string[],
  base: ScheduleItemEditBase | null | undefined,
  remote: ScheduleItem,
  /** The task of a row id, for his hand links (review P6-1). */
  taskOf?: (rowId: string) => string,
): ScheduleItemEditAgainstCloud {
  if (!isEditBase(base)) return { itemData, asked: [], keptFromCloud: [], held: [] };
  const asked: string[] = [];
  const keptFromCloud: string[] = [];
  let next = itemData;
  const byTask = comparedBy(taskOf);
  changedFields.forEach(field => {
    if (!Object.prototype.hasOwnProperty.call(base.fields, field)) return;
    const was = fieldValue(base.fields, field);
    const here = fieldValue(itemData, field);
    const cloud = fieldValue(remote, field);
    // The cloud holds what this edit started from, what it has now, or what it held earlier and may have sent itself
    // (review N1 finding 4): nobody else changed the field, and this device's value goes up.
    // (Review P7-3: not "what it started from" when a value of his for the field has already been sent. The cloud had
    // it and holds the row's first value again: another device put it back. Asked, unless it is never asked about.)
    if ((cloud === was && !base.sent?.includes(field)) || cloud === here || isOwnEarlierValue(base, field, cloud)) return;
    if (field === 'dependencies' && taskOf) {
      // Review P6-1: links that differ in the rows they name are weighed by the tasks they name. The cloud's are, by
      // task, the links this edit started from (the approval only pointed one at its task's new row): his go up,
      // each naming the row the cloud's copy names for its task. The same links by task on both sides (the same link
      // made twice), or his unchanged by task: the cloud's stand as written there. Nothing is asked in either case.
      const [wasBy, hereBy, cloudBy] = [base.fields, itemData, remote].map(source => byTask(source, field));
      if (cloudBy === wasBy && hereBy !== wasBy) { next = { ...next, dependencies: scheduleItemLinksAsNamedIn(itemData, remote, taskOf) }; return; }
      if (cloudBy === hereBy || hereBy === wasBy) { keptFromCloud.push(field); return; }
    }
    if (field === 'activity') {
      next = { ...next, activity: scheduleItemActivityOfBoth(itemData.activity, remote.activity) };
      return;
    }
    if (FIELDS_NEVER_ASKED.has(field)) return;
    if (here === was) keptFromCloud.push(field);
    else asked.push(field);
  });
  // A field's stamp stays with it: held back with a field asked about, the cloud's with a field the cloud's stays.
  const held = asked.flatMap(field => (FIELD_COMPANIONS[field] ?? []).filter(companion => changedFields.includes(companion)));
  keptFromCloud.push(...keptFromCloud.flatMap(field => (FIELD_COMPANIONS[field] ?? []).filter(companion => changedFields.includes(companion))));
  return { itemData: next, asked, keptFromCloud, held };
}

/** The progress fields: the sync merge's own rules decide them (owner answer Q28 keeps every one). */
export const SCHEDULE_PROGRESS_FIELDS: readonly string[] = [...SCHEDULE_CARRIED_PROGRESS_FIELDS, 'progressUndone'];

/**
 * Whether an edit's percent meets a later percent of David's own in the cloud
 * (owner answer Q28): his later entry stands, as the sync merge orders his
 * entries. The edit's percent changed here and the cloud's changed since the
 * copy the edit started from, and the cloud holds a percent he stated himself
 * (the one shown, or the one noted under a file's percent that stands over
 * it; not one Talk's Undo took back), judged after the edit's own. Sent as it
 * was, the phone's older entry went over the web's newer 30%, and with the
 * task sent whole no more, nothing put the 30% back. Anything else goes as
 * before: the edit's percent goes up.
 */
/**
 * Build 231, S3 item 1 (owner answer Q32, option b): a percent he entered
 * offline, on a row where a master's file has since taken it over in the
 * cloud (scheduleFileTookHisPercentOver), is not sent: the cloud's percent,
 * the newest master's, stands, as on one device. Only for an edit that
 * changes the progress and keeps the copy it started from.
 */
export function scheduleItemFileTookPercentOverInCloud(
  local: ScheduleItem,
  changedFields: readonly string[],
  base: ScheduleItemEditBase | null | undefined,
  remote: ScheduleItem,
): boolean {
  if (!isEditBase(base) || !changedFields.some(field => SCHEDULE_PROGRESS_FIELDS.includes(field))) return false;
  return scheduleFileTookHisPercentOver(local, remote);
}

export function scheduleItemLaterPercentInCloud(
  local: ScheduleItem,
  changedFields: readonly string[],
  base: ScheduleItemEditBase | null | undefined,
  remote: ScheduleItem,
): boolean {
  if (!isEditBase(base)) return false;
  const progress = changedFields.filter(field => SCHEDULE_PROGRESS_FIELDS.includes(field) &&
    Object.prototype.hasOwnProperty.call(base.fields, field));
  if (progress.length === 0 || !progress.some(field => fieldValue(remote, field) !== fieldValue(base.fields, field))) return false;
  const theirs = scheduleManagersOwnPercent(remote);
  // His own word in the cloud: the percent shown, or the one noted under a file's (schedule review N1 L3: a master's
  // 50% stood over his 20% of the 13th; Talk's Undo, offline, gave the phone's 10% of the 12th back, and it went up over
  // both, below his 20%).
  if (!theirs || scheduleEntryUndone(local, theirs) || scheduleEntryUndone(remote, theirs)) return false;
  const time = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);
  const theirsAt = time(theirs.judgedAt);
  const oursAt = time(scheduleProgressJudgedAt(local));
  return Number.isFinite(theirsAt) && (!Number.isFinite(oursAt) || theirsAt > oursAt);
}

/**
 * The cloud's later percent of David's, given back over this device's older
 * entry (review N1 finding 6, Low, caused by 79a5ae1). The upload sent nothing
 * of the older entry, but the device still held it, confirmed later than the
 * cloud's (Talk's Undo confirms the percent it gives back at that moment), so
 * its next Full Sync sent it whole: after Talk and Undo offline, the phone's
 * 20% of the 14th ended over the 10% David entered on the 16th. The cloud's
 * entry is confirmed again just after this device's, with when he judged it
 * kept (progressJudgment, as a percent given back is): every device then
 * takes it. Null when the cloud's entry is already the later confirmed.
 */
export function scheduleItemLaterPercentGivenBack(
  local: ScheduleItem,
  remote: ScheduleItem,
): Pick<ScheduleItem, 'progressConfirmedAt' | 'progressJudgment'> | null {
  const time = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);
  const ours = time(local.progressConfirmedAt);
  const theirs = time(remote.progressConfirmedAt);
  if (!Number.isFinite(ours) || (Number.isFinite(theirs) && theirs > ours)) return null;
  const givenBackAt = new Date(ours + 1).toISOString();
  return { progressConfirmedAt: givenBackAt, progressJudgment: { judgedAt: scheduleProgressJudgedAt(remote) ?? givenBackAt, givenBackAt } };
}

/** The activity log both copies added to: the cloud's entries, then this device's the cloud lacks. */
export function scheduleItemActivityOfBoth(
  local: readonly ProjectItemActivity[] | null | undefined,
  remote: readonly ProjectItemActivity[] | null | undefined,
): ProjectItemActivity[] {
  const cloudEntries = Array.isArray(remote) ? remote : [];
  const known = new Set(cloudEntries.map(entry => entry?.id));
  return [...cloudEntries, ...(Array.isArray(local) ? local : []).filter(entry => !known.has(entry?.id))];
}

/** The base kept for the asked fields only, as the conflict saves it. */
export function scheduleItemEditBaseOf(base: ScheduleItemEditBase, fields: readonly string[]): ScheduleItemEditBase {
  return {
    updatedAt: base.updatedAt,
    // (A field of a whole copy's rest that is asked about, review P7-2: as the copy it started from had it.)
    fields: Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(base.fields, field) || Object.prototype.hasOwnProperty.call(base.copy ?? {}, field))
      .map(field => [field, Object.prototype.hasOwnProperty.call(base.fields, field) ? base.fields[field] : base.copy![field]])),
  };
}

/**
 * After a queued edit landed, a newer edit merged into the same queue item
 * meanwhile starts from what landed: its fields' base becomes the landed
 * values, so another device's later change of them reads as the cloud's own.
 */
export function scheduleItemEditBaseAfterLanding(
  current: EditScope & { itemData?: unknown },
  landed: EditScope & { itemData?: unknown },
): ScheduleItemEditBase | undefined {
  if (!isEditBase(current.base) || !Array.isArray(landed.changedFields)) return isEditBase(current.base) ? current.base : undefined;
  const fields: Record<string, unknown> = { ...current.base.fields };
  const landedData = landed.itemData && typeof landed.itemData === 'object' ? landed.itemData as Record<string, unknown> : {};
  const own: Record<string, readonly string[]> = { ...(current.base.own ?? {}) };
  landed.changedFields.map(String).forEach(field => {
    if (field === 'updatedAt' || !Object.prototype.hasOwnProperty.call(fields, field)) return;
    fields[field] = landedData[field] ?? null;
    delete own[field]; // what landed is the copy the field starts from now
  });
  return {
    updatedAt: typeof landedData.updatedAt === 'string' ? landedData.updatedAt : current.base.updatedAt, fields,
    ...(Object.keys(own).length > 0 ? { own } : {}),
  };
}

/** What David types about a task that follows it from row to row (review N2 P1; next step and milestone: review N3 C). */
export const SCHEDULE_TYPED_TEXT_FIELDS = ['owner', 'contractor', 'notes', 'nextAction', 'milestone'] as const;
/**
 * And what else he sets on a task that an edit typed on a replaced row takes on to the task's row (review N3 C): its
 * project controls (approval status, schedule impact, assignee, checklist and the rest). Never asked about: two
 * copies are merged field by field, the later entry of each field standing.
 */
// (And his hand links, review P5-2: one more thing he sets on a task. Weighed as a set of links, by the task each
// names: scheduleItemLinksKey.)
const SCHEDULE_SET_FIELDS_FOLLOWING = [...SCHEDULE_TYPED_TEXT_FIELDS, 'projectControls', 'dependencies'] as const;

/**
 * Review P5-2 (6 Oct 2026, Medium; older, the same on 1fb4166): a task's hand
 * links as compared between two rows of the task. A link names its
 * predecessor by a row's id, and the rows of one task have different ids (a
 * master that moves the predecessor too re-points the link at its new row),
 * so two copies of the same links can differ in their ids alone. `taskOf`
 * gives the task of a row id (scheduleTaskOfRowId); the links are compared
 * as the set of tasks they name, with each link's kind and lag.
 */
function scheduleItemLinksKey(source: unknown, taskOf: (rowId: string) => string): string {
  const links = normalizeScheduleDependencies(source && typeof source === 'object' ? (source as { dependencies?: unknown }).dependencies : undefined);
  return canonicalScheduleItemJson(links.map(link => ({ ...link, predecessorItemId: taskOf(String(link.predecessorItemId ?? '').trim()) }))
    .sort((left, right) => String(left.predecessorItemId).localeCompare(String(right.predecessorItemId))));
}

/**
 * The task of a row id, among these rows (review P5-2): the rows of one task
 * answer to one another (revisedFromTaskIds), so every id of a task gives the
 * same name here; an id no row knows gives itself.
 */
export function scheduleTaskOfRowId(rows: readonly Pick<ScheduleItem, 'id' | 'revisedFromTaskIds'>[]): (rowId: string) => string {
  const parent = new Map<string, string>();
  const find = (id: string): string => { let root = id; while (parent.has(root)) root = parent.get(root)!; return root; };
  rows.forEach(row => scheduleTaskEarlierIds(row).forEach(earlier => {
    const [one, other] = [find(String(row.id).trim()), find(earlier)];
    if (one !== other) parent.set(one > other ? one : other, one > other ? other : one);
  }));
  return rowId => find(rowId);
}

/**
 * Review P4 F1 (6 Oct 2026): the one rule for what David has set on a task
 * that a master moved to a new row.
 *
 * The new row says what it took from the row it replaces, and which row that
 * is (textFromTask): for each of his owner, contractor, note, next step and
 * milestone that the file left unset, the value that row had, a blank
 * included. That record is the copy the new row started from. So, of a field
 * with an entry there:
 *  - the row still holds it as recorded: it is a copy, typed by nobody on
 *    this row;
 *  - the row holds something else: it was set or cleared on this row.
 * A field with no entry is the file's own value, or the row was saved before
 * rows kept this record (Build 229, and the first builds of this round, which
 * recorded only the values a row took): those keep the older rules.
 *
 * (A row never changed since its import holds nothing David set on it: a
 * blank there where the record has text is no clear of his. No import leaves
 * a row so; the schedule reviewer's generator does, to stand for a row Build
 * 229 left blank.)
 */
export function scheduleItemHoldsAsTaken(row: ScheduleItem, field: string): boolean {
  const taken = row.textFromTask;
  if (!taken || !Object.prototype.hasOwnProperty.call(taken, field)) return false;
  return fieldValue(row, field) === fieldValue(taken, field) || (isBlank(fieldValue(row, field)) && !row.updatedAt);
}

const isBlank = (value: string) => value === 'null' || /^"\s*"$/.test(value);

/**
 * Review P4 F1: a master's new row weighed against the row of its task
 * (`task`), field by field, by the rules of owner answer Q28, with what the
 * new row took as the copy both started from:
 *  - only the task's row has changed since: its value goes on the new row (a
 *    clear like any other change), and the record with it;
 *  - only the new row has: its value stands;
 *  - both have, to different values: `bothChanged` says which stands, or that
 *    David is to be asked. Asked, the task's value goes on the new row until
 *    he chooses, and the field is named in `asked`.
 * His project controls are merged as two copies of one task's always are:
 * each field has its own time, the later entry stands, nothing is asked.
 * A row that changes is stamped just after both rows and all its own times,
 * so every device takes it. The same row when nothing differs.
 *
 * Used where the two rows meet: when the new row first goes up (against the
 * cloud's row; the approval may have had no signal, and the device may not
 * have heard what another device did to the task), and at Set Active and Make
 * Current (against the row hidden for it).
 *
 * Review P5-2: with `taskOf` (the first upload gives it), his hand links are
 * weighed the same way, from the links the row was made with (the record's
 * `dependencies`, none included): linked on the phone with signal while the
 * iPad, with no signal, approved the master, the new row had no link and the
 * task had none anywhere. Set Active and Make Current keep their own rule for
 * links (owner answer Q29, scheduleTaskLinksFollowingShownTasks).
 */
export function scheduleItemAgainstItsTask(
  row: ScheduleItem,
  task: ScheduleItem | null | undefined,
  bothChanged: 'ask' | 'row' | 'task',
  taskOf?: (rowId: string) => string,
): Readonly<{ row: ScheduleItem; asked: string[]; base: ScheduleItemEditBase }> {
  const taken = row.textFromTask;
  const none = { row, asked: [], base: { updatedAt: null, fields: {} } };
  if (!taken || !task) return none;
  const next: Record<string, unknown> = {};
  const asked: string[] = [];
  SCHEDULE_TYPED_TEXT_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(taken, field)).forEach(field => {
    const here = fieldValue(row, field);
    const theirs = fieldValue(task, field);
    if (theirs === here) return;
    if (!scheduleItemHoldsAsTaken(row, field)) {
      // Set or cleared on this row: it stands unless the task's row has changed since too.
      if (theirs === fieldValue(taken, field) || bothChanged === 'row') return;
      if (bothChanged === 'ask') asked.push(field);
    }
    next[field] = task[field] ?? '';
  });
  let linksStamp: Partial<Pick<ScheduleItem, 'dependenciesUpdatedAt'>> = {};
  if (taskOf && Object.prototype.hasOwnProperty.call(taken, 'dependencies')) {
    const [here, theirs, was] = [row, task, taken].map(source => scheduleItemLinksKey(source, taskOf));
    // The task's links, when its row's have changed since and this row's have not, or both have and he is asked.
    if (theirs !== here && (here === was || (theirs !== was && bothChanged !== 'row'))) {
      if (here !== was && bothChanged === 'ask') asked.push('dependencies');
      next.dependencies = normalizeScheduleDependencies(task.dependencies);
      linksStamp = { dependenciesUpdatedAt: task.dependenciesUpdatedAt ?? null };
    }
  }
  const controls = task.projectControls ? mergeProjectControlsRevisions(row.projectControls, task.projectControls) : row.projectControls;
  const controlsChanged = fieldValue({ projectControls: controls }, 'projectControls') !== fieldValue(row, 'projectControls');
  if (Object.keys(next).length === 0 && !controlsChanged) return none;
  return {
    row: {
      ...row, ...next, ...linksStamp, ...(controlsChanged ? { projectControls: controls } : {}), textFromTask: { ...taken, ...next },
      // (After the row's own import time too: a row is ranked by the latest of its times.)
      updatedAt: scheduleItemStampAfter(row.updatedAt, row.importedAt, row.createdAt, task.updatedAt),
    } as ScheduleItem,
    asked,
    base: { updatedAt: null, fields: Object.fromEntries(asked.map(field => [field, taken[field as keyof typeof taken] ?? ''])) },
  };
}

/**
 * Review P5 S-P5-4 (6 Oct 2026, Low, brief; caused by the one-rule commit):
 * the cloud's row of a task as this device's own waiting edit of it will
 * leave it. A master's new row is weighed against the row it replaces when
 * it first goes up. This device's own edit of that row goes up before it,
 * but its write can fail in that pass (weak signal), or land with its answer
 * lost: the new row was then weighed against a row that did not hold this
 * device's own word yet, took the blank, and the task showed no owner and no
 * note on the web and the other device until the next upload.
 *
 * Only what the weighing reads (what he sets on a task), and only a field
 * the cloud still has as the waiting edit's copy started: one another device
 * has changed since is asked about when that edit goes up, and stays the
 * cloud's here. The same row with no such edit.
 */
export function scheduleItemAsOwnWaitingEditLeavesIt(
  remote: ScheduleItem,
  edit: Readonly<{ itemData: ScheduleItem; changedFields?: readonly string[] | null; base?: unknown }> | null | undefined,
  /** The task of a row id, for his hand links (review P6-1). */
  taskOf?: (rowId: string) => string,
): ScheduleItem {
  const base = edit?.base;
  if (!edit || !isEditBase(base)) return remote;
  const fields = (Array.isArray(edit.changedFields) ? edit.changedFields : Object.keys(base.fields));
  const byTask = comparedBy(taskOf);
  const mine = SCHEDULE_SET_FIELDS_FOLLOWING.filter(field => fields.includes(field) && Object.prototype.hasOwnProperty.call(base.fields, field) &&
    (fieldValue(remote, field) === fieldValue(base.fields, field) || byTask(remote, field) === byTask(base.fields, field)) &&
    fieldValue(remote, field) !== fieldValue(edit.itemData, field));
  return mine.length === 0 ? remote : { ...remote, ...Object.fromEntries(mine.map(field => [field, edit.itemData[field]])) } as ScheduleItem;
}

/**
 * Review P5-1 / S-P5-2 (6 Oct 2026, Low; from the first-upload weighing,
 * reached more often since the one-rule commit): a master's new row still
 * waiting to go up for the first time, when the cloud already has the row.
 * Its first write reached the cloud and the answer was lost on weak signal.
 * That write may have gone up corrected (scheduleItemAgainstItsTask), and the
 * web or another device may have typed on the row since.
 *
 * What is left to send is what he has set on the row since it was made: each
 * field the row says it took and no longer holds as taken (his links by the
 * tasks they name), as an edit that started from what it took; and his
 * project controls where his are the later, merged as ever. Null when he has
 * set nothing: the cloud's row stands as it is, whatever else it holds by
 * now.
 *
 * Review P6-2 and P6-3 (6 Oct 2026, Low; older): and everything else he has
 * changed on the row since it was made (his percent, a date, a field its
 * file stated), from the record the waiting copy keeps of that (`sinceMade`,
 * scheduleItemChangedSinceMade), each as an edit that started from the row
 * as made. The retry then weighs field by field like any edit: his percent
 * goes up, an owner and a note set on another device or typed on the web
 * since stay, and a field changed on both sides is asked about. Before, a
 * copy he had changed in more than his text went up whole: with 30% entered
 * after the lost answer, the note and owner the other device had set were
 * gone from the task, with no card; with an owner typed before the first
 * upload and a note typed on the web after it, a card for the whole task.
 *
 * Without that record (a copy queued by a build before it, or one a whole
 * copy has been saved over since): undefined when the copy has been changed
 * here since it was made AND differs from the cloud's row in more than what
 * he sets. Not this case, and the copy goes on as a whole copy does.
 */
export function scheduleItemNewRowMetAgain(
  waiting: ScheduleItem,
  remote: ScheduleItem,
  taskOf: () => (rowId: string) => string,
  sinceMade?: unknown,
  /** A write of the waiting copy has been tried as it stands (review P7-3): what he has changed on it has been sent. */
  writeTried = false,
): Readonly<{ changedFields: string[]; base: ScheduleItemEditBase }> | null | undefined {
  const tracked = isEditBase(sinceMade) ? sinceMade : null;
  // (Review P7-5: a task a master adds replaces no row and says nothing of what it took. With the record it is this
  // device's own row all the same; without, not this case.)
  const taken = waiting.textFromTask?.taskId ? waiting.textFromTask : tracked ? ({} as NonNullable<ScheduleItem['textFromTask']>) : null;
  if (!taken) return undefined;
  // (A row is saved unstamped by the approval; every edit of his stamps it.)
  const changedHere = Boolean(waiting.updatedAt) && waiting.updatedAt !== (waiting.importedAt || waiting.createdAt);
  const rest = (item: ScheduleItem) => restMark({ ...item, projectControls: undefined });
  if (!tracked && changedHere && rest(waiting) !== rest(remote)) return undefined;
  const recorded = (field: string) => Object.prototype.hasOwnProperty.call(taken, field);
  // (With the record, a value of his the cloud's row already holds is left out: his first write put it there, and
  // nothing more is written for it.)
  const toSend = (field: string) => !tracked || fieldValue(waiting, field) !== fieldValue(remote, field);
  const text = SCHEDULE_TYPED_TEXT_FIELDS.filter(field => recorded(field) && !scheduleItemHoldsAsTaken(waiting, field) && toSend(field));
  const links = recorded('dependencies') && scheduleItemLinksKey(waiting, taskOf()) !== scheduleItemLinksKey(taken, taskOf()) &&
    (!tracked || scheduleItemLinksKey(waiting, taskOf()) !== scheduleItemLinksKey(remote, taskOf())) ? scheduleItemFieldsWithCompanions(['dependencies']) : [];
  const merged = waiting.projectControls && remote.projectControls ? mergeProjectControlsRevisions(waiting.projectControls, remote.projectControls) : waiting.projectControls ?? remote.projectControls;
  const controls = fieldValue({ projectControls: merged }, 'projectControls') !== fieldValue(remote, 'projectControls') ? ['projectControls'] : [];
  // (What the record above and the controls' own merge already answer for is left to them.)
  const answered = (field: string) => field === 'projectControls' || recorded(field) || (recorded('dependencies') && field === 'dependenciesUpdatedAt');
  const others = Object.keys(tracked?.fields ?? {}).filter(field => !answered(field) && fieldValue(waiting, field) !== fieldValue(tracked!.fields, field) && toSend(field));
  if (text.length + links.length + controls.length + others.length === 0) return null;
  const own = Object.fromEntries(Object.entries(tracked?.own ?? {}).filter(([field]) => (text as string[]).includes(field) || others.includes(field)));
  // Review P7-3: the fields of these of which a write has already sent a value of his.
  const sent = tracked ? [...new Set([...(tracked.sent ?? []), ...(writeTried ? scheduleItemFieldsChangedSinceMade(waiting, tracked) : [])])] : [];
  return {
    changedFields: [...text, ...links, ...controls, ...others, 'updatedAt'],
    base: {
      updatedAt: null,
      fields: {
        ...Object.fromEntries([...text, ...links].map(field => [field, (taken as Record<string, unknown>)[field] ?? null])),
        ...Object.fromEntries(others.map(field => [field, tracked!.fields[field]])),
        ...(controls.length > 0 ? { projectControls: remote.projectControls ?? null } : {}),
      },
      ...(Object.keys(own).length > 0 ? { own } : {}),
      ...(sent.length > 0 ? { sent } : {}),
    },
  };
}

/**
 * Review P4 L1 (6 Oct 2026, Low; older, the same on Build 229; the reports
 * reviewer's seed "plain 46"): the same weighing the other way round. An
 * older row of a task, shown again (Set Active to an older master), with
 * what has been set since on the newer row that replaced it (`newRow`, which
 * says what it took from this row). A field changed only on the newer row
 * takes that row's value, a clear too; one changed only here, or on neither,
 * stays; one changed on both is the row's changed later, as nothing is asked
 * at Set Active. Before, only a blank here was filled: the owner he had
 * changed from Dana to Sam on the task showed as Dana again, and the report
 * said "owner changed from Sam to Dana". The same row when nothing differs.
 */
export function scheduleItemWithItsNewRow(row: ScheduleItem, newRow: ScheduleItem, newRowLater: boolean): ScheduleItem {
  const taken = newRow.textFromTask;
  if (!taken || taken.taskId !== row.id) return row;
  const next: Record<string, unknown> = {};
  SCHEDULE_TYPED_TEXT_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(taken, field)).forEach(field => {
    const here = fieldValue(row, field);
    if (scheduleItemHoldsAsTaken(newRow, field) || fieldValue(newRow, field) === here) return;
    if (here !== fieldValue(taken, field) && !newRowLater) return;
    next[field] = newRow[field] ?? '';
  });
  return Object.keys(next).length === 0 ? row : { ...row, ...next } as ScheduleItem;
}

/**
 * Review N2 P1, N3 R3, N3 C, review P4 F1 and L1, review P5 R-A: the row now
 * shown for a task (`row`: `shown` with the change's other edits) with what
 * David has set on the task, when the change hid another row of it
 * (`hidden`). His owner, contractor, note, next step and milestone, weighed
 * from what one row took of the other (below); his project controls, each
 * field by its own time. Null when nothing differs; else stamped `now`.
 *
 * For every change that makes another row the one shown: Set Active and Make
 * Current (ScheduleImportMerge), and a schedule's delete, with its tasks or
 * alone (ScheduleLookahead; review P5 R-A: after Set Active to an older
 * master, deleting an old lookahead showed the older master's row without
 * the owner, approval and schedule impact he had set, and the report said
 * they had changed. The delete carried only his percent).
 */
export function scheduleItemAsLastSetOnItsOtherRow(
  hidden: ScheduleItem,
  shown: ScheduleItem,
  row: ScheduleItem,
  now: string,
  /** Every saved task, when known: the rows between the two (Set Active across two masters or more). */
  known?: readonly ScheduleItem[],
): ScheduleItem | null {
  const timeOf = (when: string | null | undefined) => { const time = Date.parse(when || ''); return Number.isFinite(time) ? time : 0; };
  const hiddenLater = timeOf(hidden.updatedAt) > timeOf(shown.updatedAt);
  // Review N3 R3, review P4 F1 and L1: one of the two rows replaced the other, and a row says what it took of his text
  // from the row it replaced (textFromTask). That record is the copy both rows are weighed from, field by field: one
  // only the hidden row has changed since shows on this row (he typed over it on the task, or cleared it, since the
  // upload or under the other master); one only the shown row has changed keeps its own, a clear too, whichever row
  // was changed later (a percent recorded on the older row while it was shown brought a cleared note back); one
  // changed on both is the later row's, as nothing is asked here.
  // The shown row is the newer one (Make Current, Set Active forward), or the older one (review P4 L1: Set Active to an
  // older master showed the owner that master's row had, not the one he had set on the task since).
  const [older, newer] = scheduleTaskEarlierIds(shown).includes(hidden.id) ? [hidden, shown]
    : scheduleTaskEarlierIds(hidden).includes(shown.id) ? [shown, hidden] : [null, null];
  const base = older && newer ? recordOfWhatWasTaken(older, newer, known) : null;
  // (Two masters apart, the newer row's blank may be a clear he typed on the row in between, which that row passed
  // on: the newer row is then weighed as a row that has been changed, though nothing was typed on it. "A row never
  // changed since its import holds no clear of his" is said of a row against its own record only.)
  const apart = base && base !== newer!.textFromTask ? { updatedAt: newer!.updatedAt || now } : {};
  const weighed = !base ? row
    : newer === shown ? { ...scheduleItemAgainstItsTask({ ...row, updatedAt: shown.updatedAt, ...apart, textFromTask: base }, hidden, hiddenLater ? 'task' : 'row').row,
        // (And the shown row's own record is of the row in between: it stays as it is.)
        ...(row.textFromTask?.taskId === hidden.id ? {} : { textFromTask: row.textFromTask }) }
    : scheduleItemWithItsNewRow(row, { ...hidden, ...apart, textFromTask: base }, hiddenLater);
  const changed = base && JSON.stringify({ ...weighed, updatedAt: row.updatedAt }) !== JSON.stringify(row) ? weighed : row;
  // A field with no such record (a row saved before rows kept one): the hidden row's fills a blank when it was the row
  // changed later, as before.
  const recorded = SCHEDULE_TYPED_TEXT_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(base ?? {}, field));
  const lender = recorded.length === 0 ? hidden : { ...hidden, ...Object.fromEntries(recorded.map(field => [field, ''])) };
  // His project controls come whichever row was changed later (review N3 C): each field of them has its own time,
  // and the later entry stands.
  const blanks = hiddenLater ? SCHEDULE_TYPED_TEXT_FIELDS.filter(field => isBlank(fieldValue(changed, field)) && !isBlank(fieldValue(lender, field))) : [];
  const withText = blanks.length === 0 ? changed : { ...changed, ...Object.fromEntries(blanks.map(field => [field, lender[field]])) } as ScheduleItem;
  const controls = !hidden.projectControls ? withText.projectControls
    : withText.projectControls ? mergeProjectControlsRevisions(withText.projectControls, hidden.projectControls) : hidden.projectControls;
  const filled = JSON.stringify(controls ?? null) === JSON.stringify(withText.projectControls ?? null) ? withText : { ...withText, projectControls: controls } as ScheduleItem;
  return filled === row || JSON.stringify({ ...filled, updatedAt: row.updatedAt }) === JSON.stringify(row) ? null : { ...filled, updatedAt: now };
}

/**
 * What the newer of two rows of one task took from the older one: the record of the row that replaced the older row.
 * That is the newer row itself, or, two masters or more apart (review P4 L1), a row in between, when every saved task
 * is known; then only the fields the newer row's own record names too (one its file stated is the file's, not his).
 */
function recordOfWhatWasTaken(older: ScheduleItem, newer: ScheduleItem, known?: readonly ScheduleItem[]): ScheduleItem['textFromTask'] | null {
  if (newer.textFromTask?.taskId === older.id) return newer.textFromTask;
  const own = newer.textFromTask;
  const chain = scheduleTaskEarlierIds(newer);
  const between = own ? (known ?? []).find(item => item.textFromTask?.taskId === older.id && chain.includes(item.id)) : undefined;
  if (!own || !between) return null;
  return { ...Object.fromEntries(Object.entries(between.textFromTask!).filter(([field]) => Object.prototype.hasOwnProperty.call(own, field))), taskId: older.id };
}

/**
 * Review N3 R3: an edit of what David sets on a task, typed on a row a newer
 * master has since replaced (by a device that had not heard of that master),
 * as an edit of the row the task lives on now: that row with his values,
 * weighed from the copy his edit started from, by the same rules as any edit
 * (owner answer Q28). Null when the edit holds no such field with its copy,
 * or changes nothing on that row.
 *
 * A field that row still holds as it took it (scheduleItemHoldsAsTaken) was
 * not typed on that row: it counts as the copy his edit started from, so his
 * goes over it with nothing asked. `between`: the rows of the task between
 * the one he typed on and this one (he missed two masters). Only a value
 * every one of them also still holds as taken came down untouched: one typed
 * on a row in between, and copied on by the second master, is another
 * device's edit of the task, and his is asked about over it.
 *
 * Review P4 F3: not a field whose value in this edit is the very value the
 * task's new row recorded as taken from the row he typed on. That row was
 * made from this edit (on this device, after he typed it), so whatever it
 * holds now was set after it: one device, no signal, owner Mike typed, the
 * master approved, the owner cleared; "Mike" was then sent on to the new row
 * and went over the clear.
 *
 * A row saved before rows recorded what they took: a field it holds nothing
 * in counts as taken (a blank nobody typed), anything else as typed there.
 */
export function scheduleItemTextEditOnRow(
  edit: Readonly<{ id?: string; itemData: ScheduleItem; changedFields?: readonly string[] | null; base?: unknown }>,
  fields: readonly string[],
  row: ScheduleItem,
  between: readonly ScheduleItem[] = [],
  /** The task of a row id, for his hand links (review P6-1): links that name the same tasks are not a change to send on. */
  taskOf?: (rowId: string) => string,
): { id: string; itemData: ScheduleItem; changedFields: string[]; base: ScheduleItemEditBase; sentOn: string[] } | null {
  const base = edit.base;
  if (!isEditBase(base)) return null;
  const value = comparedBy(taskOf);
  // (Made after it: a row saved before he typed can say it took the same value, a blank most of all. The note typed
  // and cleared again on a row made current in between was not sent on to the newest row, which had taken a blank.)
  const typedAt = Date.parse(edit.itemData.updatedAt || '');
  const madeFromThisEdit = (field: string) => Boolean(edit.id) && [row, ...between].some(held => Boolean(held.textFromTask) &&
    held.textFromTask!.taskId === edit.id && Object.prototype.hasOwnProperty.call(held.textFromTask, field) &&
    value(held.textFromTask, field) === value(edit.itemData, field) && Date.parse(held.importedAt || held.createdAt || '') > typedAt);
  const typed = SCHEDULE_SET_FIELDS_FOLLOWING.filter(field => fields.includes(field) && Object.prototype.hasOwnProperty.call(base.fields, field) &&
    value(edit.itemData, field) !== value(row, field) && value(edit.itemData, field) !== value(base.fields, field) &&
    !madeFromThisEdit(field));
  if (typed.length === 0) return null;
  const asTaken = (held: ScheduleItem, field: string) => (held.textFromTask && Object.prototype.hasOwnProperty.call(held.textFromTask, field)
    ? scheduleItemHoldsAsTaken(held, field) || (field === 'dependencies' && Boolean(taskOf) && value(held, field) === value(held.textFromTask, field))
    : isBlank(fieldValue(held, field)));
  const stillAsTaken = (field: string) => [row, ...between].every(held => asTaken(held, field));
  return {
    id: row.id,
    // (A field goes with its stamp: his links with when he changed them.)
    itemData: { ...row, ...Object.fromEntries(scheduleItemFieldsWithCompanions(typed).map(field => [field, (edit.itemData as unknown as Record<string, unknown>)[field]])) } as ScheduleItem,
    changedFields: [...scheduleItemFieldsWithCompanions(typed), 'updatedAt'],
    base: { updatedAt: base.updatedAt, fields: Object.fromEntries(typed.map(field => [field, stillAsTaken(field) ? row[field] : base.fields[field]])) },
    // (Only for the row that replaced the very row he typed on: that row holds his value too now, so the two agree
    // again. Sent on past a row in between, which is not written, the newest row's record stays what that row had:
    // an owner cleared so, two masters on, read as "a blank it took", and the row in between gave the owner back.)
    sentOn: Boolean(edit.id) && row.textFromTask?.taskId === edit.id ? [...typed] : [],
  };
}

/**
 * Review P4: the record a row keeps of what it took (textFromTask), after
 * the sync itself has written some of those fields on it: an edit sent on
 * from the row it replaces (scheduleItemTextEditOnRow, sentOn), or a carry.
 * Such a field is again a copy of what that row has, so the record follows
 * it; a clear David then types on the row reads as his, not as the blank the
 * row once took. (A note sent on to the
 * task's new row and cleared there afterwards read as "still as taken", and
 * was filled again from the old row.) An edit he makes on the row itself
 * leaves the record alone: that is what makes the field read as set there.
 * Nothing when the row keeps no record, or none of the fields is in it.
 */
export function scheduleItemRecordAfterTheSyncWrote(
  row: ScheduleItem,
  written: ScheduleItem,
  fields: readonly string[],
): Partial<Pick<ScheduleItem, 'textFromTask'>> {
  const taken = row.textFromTask;
  const synced = taken ? SCHEDULE_TYPED_TEXT_FIELDS.filter(field => fields.includes(field) && Object.prototype.hasOwnProperty.call(taken, field)) : [];
  return taken && synced.length > 0 ? { textFromTask: { ...taken, ...Object.fromEntries(synced.map(field => [field, written[field] ?? ''])) } } : {};
}

/**
 * Review N3 R2 (5 Oct 2026, Low; caused by the carry of review N2 P1): the
 * copy an edit is weighed from, where David typed an owner, a contractor or
 * a note over a blank and the cloud's row has that field filled since with
 * the very text a row it answers to holds (`earlier`: the cloud's rows of
 * the task before this one). That is the carry bringing the task's earlier
 * text forward on another device, not anything typed on this row: it counts
 * as the copy his edit started from, so his goes up over it and nothing is
 * asked. Text typed on this row itself reads otherwise and is asked about as
 * before. The same copy when no field is so.
 */
export function scheduleItemEditBaseOverTextBroughtForward(
  base: ScheduleItemEditBase,
  changedFields: readonly string[],
  remote: ScheduleItem,
  earlier: readonly ScheduleItem[],
): ScheduleItemEditBase {
  // Review P4 F5: only on a row that keeps no record of taking the field. The carry brings text forward to rows saved
  // before rows recorded what they took. On a row that says it took the field, the same text on an earlier row is that
  // copy's source: an owner typed on the row in between and copied on by the second master read as "brought forward",
  // and an older owner from a device with no signal across both masters went over it with no card.
  const brought = SCHEDULE_TYPED_TEXT_FIELDS.filter(field => changedFields.includes(field) &&
    Object.prototype.hasOwnProperty.call(base.fields, field) && isBlank(fieldValue(base.fields, field)) && !isBlank(fieldValue(remote, field)) &&
    !Object.prototype.hasOwnProperty.call(remote.textFromTask ?? {}, field) &&
    earlier.some(row => fieldValue(row, field) === fieldValue(remote, field)));
  return brought.length === 0 ? base : { ...base, fields: { ...base.fields, ...Object.fromEntries(brought.map(field => [field, remote[field]])) } };
}

/** A task conflict's copy of this device's, as far as these rules read it. */
type ConflictCopy = Readonly<{
  itemData?: unknown;
  changedFields?: unknown;
  base?: unknown;
  askedFields?: unknown;
}> & Readonly<Record<string, unknown>>;

/**
 * This device's copy in a task's conflict, saved over the conflict already
 * open for the task (review N1, High, caused by 79a5ae1): nothing David typed
 * that the open card holds is dropped. `sent` names the fields this upload
 * wrote of his (null for a whole copy, which decides none).
 *
 * A card of the fields changed on both devices keeps those fields, with this
 * device's values and the copy they started from, when a whole copy of the
 * task (a lookahead deleted, a schedule approved, a queue item of Build 229)
 * ends in the older whole-copy conflict: saved alone, that conflict took the
 * card's place and the note in it was in no card, on no device and not in the
 * cloud. And a whole copy waiting in a card stays there when a field of the
 * task is asked about later, with the field's new value on it. Keep Phone then
 * sends the whole copy with those values; Keep Cloud leaves the cloud's row.
 */
export function scheduleItemConflictCopyKeeping<T extends ConflictCopy>(
  open: ConflictCopy | null | undefined,
  incoming: T,
  sent: readonly string[] | null,
  /** The cloud's row after this upload: the fields it wrote, for a whole copy staying in its card. */
  cloudRow?: unknown,
): T {
  const record = (value: unknown): Record<string, unknown> | null =>
    (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);
  const openData = record(open?.itemData);
  if (!open || !openData) return incoming;
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((field): field is string => typeof field === 'string') : []);
  const incomingAsked = strings(incoming.askedFields);
  const kept = strings(open.askedFields).filter(field => !incomingAsked.includes(field) && !(sent ?? []).includes(field));
  const openWhole = !Array.isArray(open.changedFields);
  const incomingWhole = !Array.isArray(incoming.changedFields);
  // The open card holds nothing this one lacks: a card of fields this one asks about again, or a whole copy under a newer whole copy.
  if (kept.length === 0 && (!openWhole || incomingWhole)) return incoming;
  const incomingData = record(incoming.itemData) ?? {};
  const openBase = isEditBase(open.base) ? open.base : undefined;
  const incomingBase = isEditBase(incoming.base) ? incoming.base : undefined;
  const fieldsOf = (source: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.map(field => [field, source[field]]));
  const baseOf = (base: ScheduleItemEditBase | undefined, fields: readonly string[]) =>
    Object.fromEntries(fields.map(field => [field, base?.fields[field] ?? null]));
  if (incomingWhole) {
    // A whole copy over a card of fields: the whole copy, with the card's fields as David left them.
    const fields = scheduleItemFieldsWithCompanions(kept);
    return {
      ...incoming,
      itemData: { ...incomingData, ...fieldsOf(openData, fields) },
      askedFields: [...kept, ...incomingAsked],
      base: { updatedAt: incomingBase?.updatedAt ?? openBase?.updatedAt ?? null, fields: { ...(incomingBase?.fields ?? {}), ...baseOf(openBase, kept) } },
    };
  }
  const incomingFields = strings(incoming.changedFields);
  if (openWhole) {
    // Fields asked about over a whole copy waiting in its card: the whole copy stays, with those fields' new values
    // and the ones this upload wrote.
    const { changedFields: _fields, ...whole } = incoming;
    const stamp = (field: string) => field !== 'updatedAt';
    return {
      ...open,
      ...whole,
      itemData: { ...openData, ...fieldsOf(record(cloudRow) ?? {}, (sent ?? []).filter(stamp)), ...fieldsOf(incomingData, incomingFields.filter(stamp)) },
      askedFields: [...kept, ...incomingAsked],
      base: { updatedAt: openBase?.updatedAt ?? incomingBase?.updatedAt ?? null, fields: { ...(openBase?.fields ?? {}), ...(incomingBase?.fields ?? {}) } },
    } as unknown as T;
  }
  // Fields asked about over fields asked about before: both, each with its own value and base.
  const keptWith = scheduleItemFieldsWithCompanions(kept).filter(field => strings(open.changedFields).includes(field));
  return {
    ...incoming,
    itemData: { ...incomingData, ...fieldsOf(openData, keptWith) },
    askedFields: [...kept, ...incomingAsked],
    changedFields: [...new Set([...keptWith, ...incomingFields])],
    base: { updatedAt: incomingBase?.updatedAt ?? null, fields: { ...(incomingBase?.fields ?? {}), ...baseOf(openBase, kept) } },
  };
}

/**
 * The row a task lives on now, by the cloud's rows alone: for a cloud that
 * lists no schedule file to work the shown tasks out from (review N1 finding
 * 2). From this row, the next row that answers to it (a newer master moved
 * the task and saved it as a new row naming this one among its earlier ids),
 * and on from there (A→B→C: C); where masters approved on two devices each
 * moved the task from the same row, the later imported. It stops at a row
 * holding a lookahead's dates the next row has not heard of: the lookahead's
 * row is then the task shown, and the master's row its hidden twin. Null
 * when the task has not moved.
 */
export function scheduleItemRowAnsweringTo(taskId: string, rows: readonly ScheduleItem[]): ScheduleItem | null {
  const byId = new Map(rows.map(row => [row.id, row] as const));
  const time = (row: ScheduleItem) => Date.parse(row.importedAt || row.createdAt || '') || 0;
  const passed = new Set([taskId]);
  let id = taskId;
  for (;;) {
    const from = id;
    const answering = rows.filter(row => !passed.has(row.id) && scheduleTaskEarlierIds(row).includes(from));
    const next = answering.filter(row => !answering.some(other => other !== row && scheduleTaskEarlierIds(row).includes(other.id)))
      .sort((left, right) => time(right) - time(left))[0];
    if (!next) break;
    const heardOf = new Set((next.lookaheadOverlay?.lookaheads ?? []).map(entry => entry.batchId));
    if ((byId.get(from)?.lookaheadOverlay?.lookaheads ?? []).some(entry => !entry.datesReplacedByMaster && !heardOf.has(entry.batchId))) break;
    passed.add(next.id);
    id = next.id;
  }
  return id === taskId ? null : byId.get(id) ?? null;
}

/**
 * This device's copy in a card of fields, moved with its task to the row the
 * task lives on now (review N1 finding 2, Medium, caused by 79a5ae1): that
 * row, with this device's values of the fields asked about. A field the row
 * already holds as this device has it is asked about no more; null when none
 * is left. Before, the card stayed on the row a newer master had hidden:
 * Keep Phone wrote the note there and closed the card, and every device went
 * on showing the cloud's note.
 */
export function scheduleItemConflictCopyOnRow(
  copy: ConflictCopy | null | undefined,
  row: ScheduleItem,
  /** The task of a row id, for his hand links (review P6-1): the same links under other row ids are asked about no more. */
  taskOf?: (rowId: string) => string,
): ConflictCopy | null {
  const data = copy?.itemData && typeof copy.itemData === 'object' ? copy.itemData as Record<string, unknown> : null;
  if (!copy || !data) return null;
  const value = comparedBy(taskOf);
  const asked = scheduleItemConflictFields(copy).filter(field => value(data, field) !== value(row, field));
  if (asked.length === 0) return null;
  const fields = scheduleItemFieldsWithCompanions(asked);
  const base = isEditBase(copy.base) ? copy.base : undefined;
  return {
    id: row.id,
    itemData: { ...row, ...Object.fromEntries(fields.map(field => [field, data[field]])) },
    changedFields: [...fields, 'updatedAt'],
    askedFields: asked,
    base: { updatedAt: base?.updatedAt ?? null, fields: Object.fromEntries(asked.map(field => [field, base?.fields[field] ?? null])) },
  };
}

/**
 * Review P5 S-P5-3 (6 Oct 2026, Low; older in its root, ee705c9, made worse
 * by the one-rule commit): this device's copy in the one card of a task that
 * had two, one on the row the task lives on now (`onRow`) and one moved to it
 * from a row a master replaced (`moved`, already as a copy of that row:
 * scheduleItemConflictCopyOnRow). Of a field both ask about, the value he set
 * later stands (when each card's edit was made); every other field of either
 * is kept. Before, the moved card always won: he typed a note with no
 * signal, approved a master and typed the note again on the task's new row;
 * the two cards became one holding the FIRST note, and the note he typed
 * last was on no card and, after his choice, on no device.
 */
export function scheduleItemConflictCopyOfBoth(
  moved: ConflictCopy,
  movedChangedAt: string | null | undefined,
  onRow: ConflictCopy,
  onRowChangedAt: string | null | undefined,
  row: ScheduleItem,
): ConflictCopy {
  const at = (when: string | null | undefined) => { const time = Date.parse(when || ''); return Number.isFinite(time) ? time : 0; };
  return at(onRowChangedAt) >= at(movedChangedAt)
    ? scheduleItemConflictCopyKeeping(moved, onRow, null, row)
    : scheduleItemConflictCopyKeeping(onRow, moved, null, row);
}

/** The fields a task conflict found changed on both, for Review Conflicts; empty for a conflict of whole copies. */
export function scheduleItemConflictFields(localPayload: unknown): string[] {
  const asked = localPayload && typeof localPayload === 'object' ? (localPayload as { askedFields?: unknown }).askedFields : undefined;
  return Array.isArray(asked) ? asked.filter((field): field is string => typeof field === 'string') : [];
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  notes: 'Note', owner: 'Owner', contractor: 'Contractor', startDate: 'Start', finishDate: 'Finish', taskName: 'Task',
  locationName: 'Area', milestone: 'Milestone', priority: 'Priority', nextAction: 'Next action', dependencies: 'Predecessors',
  lookaheadOverlay: 'Lookahead', durationDays: 'Duration', itemType: 'Type', parentItemId: 'Phase', wbsCode: 'WBS',
  baselineStartDate: 'Baseline start', baselineFinishDate: 'Baseline finish', isMilestone: 'Milestone flag',
};

/** A task field as Review Conflicts names it. */
export function scheduleItemConflictFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase());
}

/**
 * One copy of a task in a conflict of the fields changed on both devices
 * (owner answer Q28), as Review Conflicts shows it: each of those fields and
 * its value in this copy ("Note: Crew short Tuesday · Owner: Mike").
 */
export function scheduleItemConflictCopyOfFields(item: unknown, fields: readonly string[]): string {
  const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  return fields.map(field => `${scheduleItemConflictFieldLabel(field)}: ${conflictValueText(record[field])}`).join(' · ');
}

function conflictValueText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '(none)';
  if (typeof value === 'string') return value.trim().slice(0, 80) || '(none)';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length === 0 ? '(none)' : `${value.length} item${value.length === 1 ? '' : 's'}`;
  return 'changed';
}
