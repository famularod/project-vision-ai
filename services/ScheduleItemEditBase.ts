import { PROJECT_ITEM_TYPES, SCHEDULE_PRIORITIES, type ProjectItemActivity, type ScheduleItem } from '../types';
import { projectTimeZoneOrDefault } from './ProjectDateTime';
import { scheduleCalendarDayKey } from './ScheduleCalendarDay';
import { canonicalScheduleItemJson } from './ScheduleItemCloudAcknowledgement';
import { scheduleTaskEarlierIds } from './ScheduleTaskRevisions';
import { mergeProjectControlsRevisions, normalizeProjectControls } from './VitruviusProjectControls';
import { normalizeScheduleDependencies } from './VitruviusScheduleEngine';
import {
  SCHEDULE_CARRIED_PROGRESS_FIELDS, scheduleEntryUndone, scheduleManagersOwnPercent, scheduleProgressIsManagers, scheduleProgressJudgedAt,
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
  'alsoImportedSourceRow', 'projectControls', 'activity', 'progressUndone', ...SCHEDULE_CARRIED_PROGRESS_FIELDS,
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
  };
}

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
): Readonly<{ itemData: ScheduleItem; asked: string[]; sentHere: string[] }> {
  if (!isEditBase(base)) return { itemData: merged, asked: [], sentHere: [] };
  const next = { ...merged } as unknown as Record<string, unknown>;
  const asked: string[] = [];
  const sentHere: string[] = [];
  WHOLE_COPY_FIELDS_WEIGHED.forEach(field => {
    if (!Object.prototype.hasOwnProperty.call(base.fields, field)) return;
    const was = fieldValue(base.fields, field);
    const here = fieldValue(local, field);
    const cloud = fieldValue(remote, field);
    const source = here === was ? remote : cloud === was || cloud === here ? local : null;
    const companions = FIELD_COMPANIONS[field] ?? [];
    if (!source) {
      asked.push(field);
      [field, ...companions].forEach(name => setField(next, name, remote));
      return;
    }
    if (here !== was) sentHere.push(field);
    [field, ...companions].forEach(name => setField(next, name, source));
  });
  return { itemData: next as unknown as ScheduleItem, asked, sentHere };
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
    }
  });
  return next as unknown as ScheduleItem;
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
  return { updatedAt: earlier?.updatedAt ?? later?.updatedAt ?? null, fields, ...(Object.keys(own).length > 0 ? { own } : {}) };
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
): ScheduleItemEditAgainstCloud {
  if (!isEditBase(base)) return { itemData, asked: [], keptFromCloud: [], held: [] };
  const asked: string[] = [];
  const keptFromCloud: string[] = [];
  let next = itemData;
  changedFields.forEach(field => {
    if (!Object.prototype.hasOwnProperty.call(base.fields, field)) return;
    const was = fieldValue(base.fields, field);
    const here = fieldValue(itemData, field);
    const cloud = fieldValue(remote, field);
    // The cloud holds what this edit started from, what it has now, or what it held earlier and may have sent itself
    // (review N1 finding 4): nobody else changed the field, and this device's value goes up.
    if (cloud === was || cloud === here || isOwnEarlierValue(base, field, cloud)) return;
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
    fields: Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(base.fields, field))
      .map(field => [field, base.fields[field]])),
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
const SCHEDULE_SET_FIELDS_FOLLOWING = [...SCHEDULE_TYPED_TEXT_FIELDS, 'projectControls'] as const;

/**
 * Review N3 R3 (5 Oct 2026, Medium): a master's new row for a task, as it
 * should first reach the cloud. The row took his owner, contractor and note
 * from the copy of the task the approving device held (textFromTask). `task`
 * is the cloud's row of that task now. A field the new row still holds as
 * taken, which the cloud's row has otherwise, was changed or cleared on
 * another device before this one heard: only that side changed it, so the
 * cloud's stands (owner answer Q28) and the new row takes it, stamped just
 * after both rows so that this device takes the corrected row back. When
 * this device changed it too, its own edit of the task's row has already
 * been weighed in this pass and waits in Review Conflicts: the cloud's value
 * stays on the new row until he chooses. The same row when nothing differs,
 * when nothing was taken, or when the cloud has no such row.
 */
export function scheduleItemTextAsItsTaskHasIt(
  row: ScheduleItem,
  task: ScheduleItem | null | undefined,
  /**
   * The copy this device's own edit of the task's row started from, while that edit still waits in the queue: the
   * cloud's row reading as that copy has not been changed by anyone else, it is only behind this device, and the
   * value taken stands (the reviewer's generator, seeds 1126, 1190, 1281: the new row went up before the edit did,
   * and took the blank the cloud's row still had).
   */
  ownEditWaiting?: ScheduleItemEditBase | null,
  /** The row's first upload: a blank it had nothing to take for takes the cloud's value too (not at Set Active, where a blank on a row already shown may be one he left). */
  firstUpload = false,
): ScheduleItem {
  const taken = row.textFromTask;
  if (!taken || !task || task.id !== taken.taskId) return row;
  const blank = (value: string) => value === 'null' || /^"\s*"$/.test(value);
  const same = (left: string, right: string) => left === right || (blank(left) && blank(right));
  const agreed = (field: string) => (ownEditWaiting && Object.prototype.hasOwnProperty.call(ownEditWaiting.fields, field)
    ? fieldValue(ownEditWaiting.fields, field) : fieldValue(taken, field));
  // Still as taken; or a blank where the copy this device held had nothing to take (the cloud's row may have been given
  // an owner on another device since: seed 20251, where the row's new stamp then kept the sync's carry from filling it).
  const asTaken = (field: string) => (Object.prototype.hasOwnProperty.call(taken, field)
    ? fieldValue(row, field) === fieldValue(taken, field) : firstUpload && blank(fieldValue(row, field)));
  const behind = SCHEDULE_TYPED_TEXT_FIELDS.filter(field => asTaken(field) &&
    !same(fieldValue(task, field), fieldValue(row, field)) && !same(fieldValue(task, field), agreed(field)));
  const now: Partial<ScheduleItem> = Object.fromEntries(behind.map(field => [field, task[field] ?? '']));
  // Review N3 C: his project controls came the same way. The cloud's row of the task may hold an approval or a
  // schedule impact set on another device since: of the two, the later entry of each field (as two copies of one
  // task's are merged).
  const controls = task.projectControls ? mergeProjectControlsRevisions(row.projectControls, task.projectControls) : row.projectControls;
  if (fieldValue({ controls }, 'controls') !== fieldValue({ controls: row.projectControls && normalizeProjectControls(row.projectControls) }, 'controls')) now.projectControls = controls;
  if (Object.keys(now).length === 0) return row;
  // (After the row's own import time too: a row is ranked by the latest of its times.)
  return {
    ...row, ...now, textFromTask: { ...taken, ...Object.fromEntries(behind.map(field => [field, task[field] ?? ''])) },
    updatedAt: scheduleItemStampAfter(row.updatedAt, row.importedAt, row.createdAt, task.updatedAt),
  };
}

/**
 * Review N3 R3: an edit of David's owner, contractor or note typed on a row
 * a newer master has since replaced (by a device that had not heard of that
 * master), as an edit of the row the task lives on now: that row with his
 * values, weighed from the copy his edit started from, by the same rules as
 * any edit (owner answer Q28). Null when the edit holds no such field with
 * its copy, or changes nothing on that row. A field that row still holds
 * exactly as it took it from the task (textFromTask: the web's upload saved
 * the row days ago, and the task's note has been typed over since) was not
 * typed on that row: it counts as the copy his edit started from, so his
 * goes over it with nothing asked (the reviewer's always-online run with
 * clears, seed 65096: a card "his note / the note the upload copied").
 * `between`: the rows of the task between the one he typed on and this one
 * (he missed two masters). Only a value every one of them also still holds
 * as it took it came down untouched: one typed on a row in between, and
 * copied on by the second master, is another device's edit of the task, and
 * his is asked about over it.
 */
export function scheduleItemTextEditOnRow(
  edit: Readonly<{ itemData: ScheduleItem; changedFields?: readonly string[] | null; base?: unknown }>,
  fields: readonly string[],
  row: ScheduleItem,
  between: readonly ScheduleItem[] = [],
): { id: string; itemData: ScheduleItem; changedFields: string[]; base: ScheduleItemEditBase } | null {
  const base = edit.base;
  if (!isEditBase(base)) return null;
  const typed = SCHEDULE_SET_FIELDS_FOLLOWING.filter(field => fields.includes(field) && Object.prototype.hasOwnProperty.call(base.fields, field) &&
    fieldValue(edit.itemData, field) !== fieldValue(row, field));
  if (typed.length === 0) return null;
  // (Or holds nothing there and took nothing for it: a blank nobody typed. Seed 5052 of the always-online run: an owner
  // set on the web, which sends no edit on, then changed on the phone, asked "Ana / blank" about an uploaded row.)
  const asTaken = (held: ScheduleItem, field: string) => (held.textFromTask && Object.prototype.hasOwnProperty.call(held.textFromTask, field)
    ? fieldValue(held, field) === fieldValue(held.textFromTask, field) : /^(null|"\s*")$/.test(fieldValue(held, field)));
  const stillAsTaken = (field: string) => [row, ...between].every(held => asTaken(held, field));
  return {
    id: row.id,
    itemData: { ...row, ...Object.fromEntries(typed.map(field => [field, edit.itemData[field]])) },
    changedFields: [...typed, 'updatedAt'],
    base: { updatedAt: base.updatedAt, fields: Object.fromEntries(typed.map(field => [field, stillAsTaken(field) ? row[field] : base.fields[field]])) },
  };
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
  const blank = (value: string) => value === 'null' || /^"\s*"$/.test(value);
  const brought = SCHEDULE_TYPED_TEXT_FIELDS.filter(field => changedFields.includes(field) &&
    Object.prototype.hasOwnProperty.call(base.fields, field) && blank(fieldValue(base.fields, field)) && !blank(fieldValue(remote, field)) &&
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
export function scheduleItemConflictCopyOnRow(copy: ConflictCopy | null | undefined, row: ScheduleItem): ConflictCopy | null {
  const data = copy?.itemData && typeof copy.itemData === 'object' ? copy.itemData as Record<string, unknown> : null;
  if (!copy || !data) return null;
  const asked = scheduleItemConflictFields(copy).filter(field => fieldValue(data, field) !== fieldValue(row, field));
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
