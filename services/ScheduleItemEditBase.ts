import type { ProjectItemActivity, ScheduleItem } from '../types';
import { canonicalScheduleItemJson } from './ScheduleItemCloudAcknowledgement';
import { scheduleTaskEarlierIds } from './ScheduleTaskRevisions';
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
]);

/** A mark of a task's rest: every field not weighed one by one, stamps aside; a field stored as null reads as a missing one. */
function restMark(item: unknown): string {
  const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  const text = canonicalScheduleItemJson(Object.fromEntries(
    Object.entries(record).filter(([field, value]) => !REST_ASIDE.has(field) && value !== undefined && value !== null)));
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

type EditScope = Readonly<{ changedFields?: unknown; base?: unknown; itemData?: unknown }>;

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

/** Whether the cloud's value of a field is one this edit itself held earlier (ScheduleItemEditBase.own). */
function isOwnEarlierValue(base: ScheduleItemEditBase, field: string, cloud: string): boolean {
  const own = base.own?.[field];
  return Array.isArray(own) && own.includes(valueMark(cloud));
}

/**
 * Two queued edits of a task made one: each field keeps the copy its first
 * edit started from. A field the earlier edit changed without a base (a
 * queue item from Build 229 or earlier) gets none: it is sent as before.
 */
export function scheduleItemEditBasesMerged(existing: EditScope, incoming: EditScope): ScheduleItemEditBase | undefined {
  const earlier = isEditBase(existing.base) ? existing.base : undefined;
  const later = isEditBase(incoming.base) ? incoming.base : undefined;
  // A whole copy queued earlier may have changed any field: its own base, or none.
  if (!Array.isArray(existing.changedFields)) return earlier;
  const earlierFields = new Set(existing.changedFields.map(String));
  const fields: Record<string, unknown> = { ...(earlier?.fields ?? {}) };
  Object.entries(later?.fields ?? {}).forEach(([field, value]) => {
    if (!earlierFields.has(field)) fields[field] = value;
  });
  if (Object.keys(fields).length === 0) return undefined;
  // What the waiting edit held for a field the newer edit changes again is its own earlier value (review N1 finding
  // 4): an upload may have landed it with its answer lost, and the retry then set David's text against his own.
  const own: Record<string, readonly string[]> = { ...(earlier?.own ?? {}) };
  (Array.isArray(incoming.changedFields) ? incoming.changedFields.map(String) : []).forEach(field => {
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

/** One field as compared: key order aside, and a missing field reads as null. */
function fieldValue(source: unknown, field: string): string {
  const value = source && typeof source === 'object' ? (source as Record<string, unknown>)[field] : undefined;
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
 * copy the edit started from, to a percent he stated himself (not a file's,
 * nor one Talk's Undo gave back or took back), judged after the edit's own.
 * Sent as it was, the phone's older entry went over the web's newer 30%, and
 * with the task sent whole no more, nothing put the 30% back. Anything else
 * goes as before: the edit's percent goes up.
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
  if (!theirs || !scheduleProgressIsManagers(remote) || scheduleEntryUndone(local, theirs) || scheduleEntryUndone(remote, theirs)) return false;
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
