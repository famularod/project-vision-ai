import { withoutDocumentUploadState } from './FieldUpdateDocumentPatch';
import { withoutPhotoAnalysis } from './FieldUpdatePhotoAnalysisPatch';

/**
 * Owner answer Q28 (2 Oct 2026): "remember which cloud copy each edit started
 * from. Field updates get Review Conflicts instead of a silent overwrite."
 *
 * The copy of a field update an edit started from: the saved copy David
 * opened as the draft. It is kept as a fingerprint of each part of the
 * update's meaning (its note, area, photos, documents, recipients...), enough
 * to tell which parts changed since, here or in the cloud. What changes with
 * no edit of David's is left out, as the cloud receipt leaves it out
 * (daveProjectUpdatesSemanticallyMatch): the send status and its stamps, the
 * photo files' paths on each device and in the cloud, the photos' analysis
 * (photoAnalysisResultStands weighs it), the documents' upload state (a patch
 * on the cloud's copy), the archive (nothing un-archives an update), the
 * project id an upload binds, and the generated message made from the rest.
 */
export type FieldUpdateEditBase = Readonly<{
  /** When the draft was opened from that copy. */
  takenAt: string;
  /** A fingerprint of each part of the copy's meaning. */
  fields: Readonly<Record<string, string>>;
  /**
   * Kept again for a copy the cloud's newer copy settled with no write (its
   * parts): a later sync attempt of that same copy starts from this base too,
   * and is settled again, not sent whole over the cloud's copy.
   */
  settledParts?: Readonly<Record<string, string>>;
  /**
   * What the queued copy itself held of a part before its latest one, while
   * it waited (review N1 finding 4): an upload may have put one in the cloud
   * without the device hearing back, so the cloud holding one is this
   * device's own earlier copy, not another device's change.
   */
  own?: Readonly<Record<string, readonly string[]>>;
}>;

/** How many of a queued copy's own earlier fingerprints a part keeps (the latest ones). */
const OWN_PARTS_KEPT = 20;

/**
 * The base of a queued copy that a newer copy of the same update replaces
 * on the queue, with what the queued one held: each part the newer copy
 * changes again (review N1 finding 4). The first save's upload landed with
 * its answer lost; David opened the card again and typed more; the retry
 * then found the cloud's copy changed since the base, by his own first save,
 * and sent his update to Review Conflicts against itself.
 */
export function fieldUpdateEditBaseKeepingOwn(base: FieldUpdateEditBase, queued: unknown, newer: unknown): FieldUpdateEditBase {
  const before = fieldUpdateMeaningParts(queued);
  const now = fieldUpdateMeaningParts(newer);
  const own: Record<string, readonly string[]> = { ...(base.own ?? {}) };
  let added = false;
  [...new Set([...Object.keys(before), ...Object.keys(now)])].forEach(part => {
    const mark = before[part] ?? '';
    if (mark === (now[part] ?? '') || mark === (base.fields[part] ?? '')) return;
    own[part] = [...(own[part] ?? []).filter(known => known !== mark), mark].slice(-OWN_PARTS_KEPT);
    added = true;
  });
  return added ? { ...base, own } : base;
}

const PARTS_ASIDE: ReadonlySet<string> = new Set([
  'id', 'status', 'syncDiagnostics', 'deleteDiagnostics', 'sendAttempts', 'lastSendAttemptAt', 'stableSendId',
  'idempotencyKey', 'workflowTimestamps', 'projectId', 'generatedMessage', 'isArchived', 'archivedAt', 'areaStatus',
]);

/**
 * What David sets on a photo. Its file, type and capture details (where and
 * when it was taken, from the library or not) do not change once taken, and
 * a copy read back on another device fills some in (normalizePhoto).
 */
const PHOTO_PARTS = [
  'id', 'caption', 'category', 'actionRequired', 'actionOwner', 'actionDueDate', 'actionStatus', 'continuityAnchor',
  'selectedAreaId', 'selectedAreaName',
] as const;
const PHOTO_DEFAULTS: Readonly<Record<string, string>> = { category: 'Update', actionStatus: 'Open' };

const EMPTY_TEXTS: ReadonlySet<string> = new Set(['null', '""', '[]', '{}', 'false']);

/** Each part of a field update's meaning, fingerprinted; a part stored as null reads as a missing one. */
export function fieldUpdateMeaningParts(copy: unknown): Record<string, string> {
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return {};
  const meaning = withoutDocumentUploadState(withoutPhotoAnalysis(copy) as object) as Record<string, unknown>;
  const parts: Record<string, string> = {};
  Object.keys(meaning).forEach(part => {
    if (PARTS_ASIDE.has(part)) return;
    const value = part === 'photos' ? photosAsSet(meaning[part])
      : part === 'documents' ? documentsAsReadBack(meaning[part], meaning) : meaning[part];
    const text = stableText(value);
    // An empty part reads as a missing one: a copy read back on a device fills in '', [], false and null where the
    // copy it came from has none.
    if (!EMPTY_TEXTS.has(text)) parts[part] = fingerprint(text);
  });
  return parts;
}

export function fieldUpdateEditBaseOf(copy: unknown, takenAt: string): FieldUpdateEditBase {
  return { takenAt, fields: fieldUpdateMeaningParts(copy) };
}

export function isFieldUpdateEditBase(value: unknown): value is FieldUpdateEditBase {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Boolean((value as { fields?: unknown }).fields) && typeof (value as { fields?: unknown }).fields === 'object' &&
    !Array.isArray((value as { fields?: unknown }).fields);
}

/** Whether this copy is the one a settled base was kept again for (its parts, every one). */
export function fieldUpdateCopyIsSettled(base: FieldUpdateEditBase, copy: unknown): boolean {
  if (!base.settledParts) return false;
  const parts = fieldUpdateMeaningParts(copy);
  const keys = new Set([...Object.keys(parts), ...Object.keys(base.settledParts)]);
  return [...keys].every(part => (parts[part] ?? null) === (base.settledParts![part] ?? null));
}

/** The parts of `copy` that differ from the base. */
export function fieldUpdatePartsChangedSince(base: FieldUpdateEditBase, copy: unknown): string[] {
  const now = fieldUpdateMeaningParts(copy);
  return [...new Set([...Object.keys(base.fields), ...Object.keys(now)])]
    .filter(part => (base.fields[part] ?? null) !== (now[part] ?? null))
    .sort();
}

/**
 * A field update's edit weighed against the cloud's copy, part by part, by
 * the copy the edit started from (owner answer Q28). Of the parts where this
 * copy and the cloud's differ: one only this device changed is its own
 * change; one the cloud changed (alone, or both) would be overwritten.
 * - 'conflict': both: it goes to Review Conflicts;
 * - 'cloud': the cloud's changes only (this device's are in the cloud
 *   already, or it made none): nothing of this device's is sent over them;
 * - 'as-before': this device's changes only, or no difference: sent as before.
 */
export function fieldUpdateEditAgainstCloud(base: FieldUpdateEditBase, local: unknown, cloud: unknown): 'conflict' | 'cloud' | 'as-before' {
  const { here, there } = fieldUpdatePartsDiffering(base, local, cloud);
  if (there.length === 0) return 'as-before';
  return here.length > 0 ? 'conflict' : 'cloud';
}

/** The parts where this copy and the cloud's differ, by the side that changed them since the base (both: in each). */
export function fieldUpdatePartsDiffering(base: FieldUpdateEditBase, local: unknown, cloud: unknown): { here: string[]; there: string[] } {
  const mine = fieldUpdateMeaningParts(local);
  const theirs = fieldUpdateMeaningParts(cloud);
  const differing = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])]
    .filter(part => (mine[part] ?? null) !== (theirs[part] ?? null)).sort();
  return {
    here: differing.filter(part => (mine[part] ?? null) !== (base.fields[part] ?? null)),
    // Not a part the cloud holds as this queued copy itself held it earlier (its own upload, the answer lost).
    there: differing.filter(part => (theirs[part] ?? null) !== (base.fields[part] ?? null) &&
      !(base.own?.[part] ?? []).includes(theirs[part] ?? '')),
  };
}

function photosAsSet(photos: unknown): unknown {
  if (!Array.isArray(photos)) return photos;
  return photos.map(photo => {
    if (!photo || typeof photo !== 'object') return photo;
    const record = photo as Record<string, unknown>;
    return Object.fromEntries(PHOTO_PARTS.map(part => [part, record[part] ?? PHOTO_DEFAULTS[part] ?? null]));
  });
}

/**
 * The documents as the app reads a saved update back (review N2 L5, caused
 * by 79a5ae1 on older normalising code): a document with no area or update
 * of its own is under the update's (App.tsx normalizeUpdate). One attached
 * before the area was chosen went up with no area; after a relaunch or a
 * refresh the device's copy had it under the update's area, so it differed
 * from the cloud's, and David's next edit raised "Changed on another device:
 * Documents" with one device in the story. Its project, which the read-back
 * takes from the app's own project list, is left as it is.
 */
function documentsAsReadBack(documents: unknown, update: Record<string, unknown>): unknown {
  if (!Array.isArray(documents)) return documents;
  const own = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
  return documents.map(document => {
    if (!document || typeof document !== 'object') return document;
    const record = document as Record<string, unknown>;
    return { ...record, areaId: own(record.areaId) ?? own(update.selectedAreaId), updateId: own(record.updateId) ?? own(update.id) };
  });
}

/** Key order aside; a field that is empty (null, '', [], {}, false) reads as a missing one. */
function stableText(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort()
      .map(key => [key, stableText(record[key])] as const)
      .filter(([, text]) => !EMPTY_TEXTS.has(text))
      .map(([key, text]) => `${JSON.stringify(key)}:${text}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A short fingerprint of a text (cyrb53). */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const PART_LABELS: Readonly<Record<string, string>> = {
  notes: 'Note', selectedAreaName: 'Area', selectedAreaId: 'Area', photos: 'Photos', documents: 'Documents',
  recipients: 'Recipients', date: 'Date', projectName: 'Project', scheduleItemId: 'Task', scheduleTaskName: 'Task',
  scheduleProjectName: 'Task', quickContext: 'Context', safetyFlag: 'Safety flag', blockerFlag: 'Blocker flag',
};

/**
 * What changed on each side of a field update's conflict since the copy the
 * edit started from (owner answer Q28), as Review Conflicts says it:
 * "Changed on this phone: Area. Changed on another device: Note." Null for a
 * conflict without that copy (found as before).
 */
export function fieldUpdateConflictChanges(localPayload: unknown, cloudCopy: unknown): string | null {
  const payload = localPayload && typeof localPayload === 'object' ? localPayload as { base?: unknown; updateData?: unknown } : null;
  if (!payload || !isFieldUpdateEditBase(payload.base)) return null;
  const labels = (parts: string[]) => [...new Set(parts.map(part => PART_LABELS[part] ?? part.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, letter => letter.toUpperCase())))].join(', ');
  const differing = fieldUpdatePartsDiffering(payload.base, payload.updateData, cloudCopy);
  const here = labels(differing.here);
  const there = labels(differing.there);
  if (!here && !there) return null;
  return [here ? `Changed on this phone: ${here}.` : '', there ? `Changed on another device: ${there}.` : ''].filter(Boolean).join(' ');
}
