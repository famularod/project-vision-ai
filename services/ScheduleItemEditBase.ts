import type { ProjectItemActivity, ScheduleItem } from '../types';
import { canonicalScheduleItemJson } from './ScheduleItemCloudAcknowledgement';
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
  };
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

type EditScope = Readonly<{ changedFields?: unknown; base?: unknown }>;

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
  return { updatedAt: earlier?.updatedAt ?? later?.updatedAt ?? null, fields };
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
    if (cloud === was || cloud === here) return;
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
  landed.changedFields.map(String).forEach(field => {
    if (field !== 'updatedAt' && Object.prototype.hasOwnProperty.call(fields, field)) fields[field] = landedData[field] ?? null;
  });
  return { updatedAt: typeof landedData.updatedAt === 'string' ? landedData.updatedAt : current.base.updatedAt, fields };
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
