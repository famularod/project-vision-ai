import { parseScheduleDelimitedText } from './PIEScheduleIntelligence';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocument, ScheduleItem } from '../types';
import {
  activateECOSCurrentReferenceDocument,
  loadECOSScheduleRetirementScope,
  type ECOSCurrentReferenceActivationResult,
  type ScheduleRetirementScope,
} from './ECOSHostedIndexer';
import {
  currentScheduleDocumentsByProject,
  scheduleFullCopyLeftUnshown,
  currentScheduleDocumentWinners,
  scheduleDocumentAddsToMaster,
  scheduleLookaheadReplacedFor,
  scheduleDocumentRetiredProjectNames,
  scheduleProjectScopeKey,
  selectAuthoritativeScheduleItems,
} from './PIEScheduleReconciliation';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import { parseOwnedLocalFileManifest } from './OwnedLocalFileRepository';
import {
  resolveScheduleImportSourceIdentity,
  type ScheduleImportScopeProject,
  type ScheduleImportSourceIdentity,
} from './ScheduleImportSourceIdentity';

export { loadECOSScheduleRetirementScope, type ScheduleRetirementScope };

/**
 * Making a shared document current goes through the cloud's activation call
 * (ecos_activate_current_reference_document), which changes the chosen record
 * and the ones it replaces in one transaction. A schedule's Set Active used to
 * flip flags on the phone only: every merge takes the cloud's current flag,
 * so the choice never reached the cloud and the next refresh undid it
 * (whole-app audit A5 F4, 30 Sep 2026). Nothing changes on the phone until
 * the cloud confirms; the caller then merges the refreshed list.
 */
export type SharedDocumentActivationOutcome =
  | Readonly<{ status: 'activated'; documents: readonly ReferenceDocument[] | null }>
  | Readonly<{ status: 'refresh_required' }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'not_prepared' | 'failed'; message: string }>
  /** A schedule the cloud has never had: this device's copy has not finished uploading (open item 3.1). */
  | Readonly<{ status: 'not_uploaded'; message: string }>;

/**
 * Open item 3.1 (13 Oct 2026; the A5 / A8 recorded Medium). Just after an import, a schedule this device has not
 * finished uploading was refused with "Refresh required ... Sign in and refresh the project documents": not true, and
 * no refresh helps. It is made current only by the cloud, so on every device or on none: it says so.
 */
export const SCHEDULE_NOT_UPLOADED_YET =
  'This schedule has not finished uploading, so your other devices do not have it yet. Nothing was changed on any device. It uploads by itself when this device has signal (Sync Now sends it at once); then try again.';

/**
 * Review pass 5's H5S-1 (14 Oct 2026, Low, caused by 3.1): with no cloud stamp here, a schedule the cloud has was made
 * current by the cloud's own revision; a note typed on its card just before was then outranked by the activation's
 * stamp and never reached the other devices (the protection for text typed before Make Current needs the stamp this
 * device last saw). Such a schedule is made current only while what this device holds for it reads as the cloud's
 * copy does; otherwise this.
 */
export const SCHEDULE_DETAILS_NOT_HEARD_BACK =
  'This device has not yet heard back from the cloud about this schedule, and its details here (such as a note just typed) differ from the cloud’s copy. Nothing was changed on any device, and nothing you typed was lost. Try again in a moment.';

/** The details a person types or picks on a document's card. */
const PERSON_DETAIL_KEYS = ['name', 'notes', 'category', 'drawingNumber', 'drawingRevision', 'drawingDiscipline', 'drawingIssuedAt', 'drawingStatus'] as const;

/** Those details, as text, for comparing two copies of one document. */
function personDetails(document: ReferenceDocument): string {
  const record = document as unknown as Record<string, unknown>;
  const text = (name: string) => (typeof record[name] === 'string' ? (record[name] as string).trim() : '');
  return JSON.stringify(PERSON_DETAIL_KEYS.map(text));
}

/** A document's revision as the recovery merge ranks it (DAVECloudRecovery): its own stamp, else the cloud's, else its import. */
function revisionOf(document: ReferenceDocument): number {
  for (const value of [document.updatedAt, document.cloudUpdatedAt, document.importedAt]) {
    const parsed = new Date(value || '').getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * The details a person types or picks that differ between two copies of one document (`after`'s values): what one
 * edit of his changed. The card's text sync records them as this device's own (noteOwnEdit; S1e).
 */
export function personDetailsChanged(before: ReferenceDocument, after: ReferenceDocument): Record<string, unknown> {
  const text = (document: ReferenceDocument, name: string) => {
    const value = (document as unknown as Record<string, unknown>)[name];
    return typeof value === 'string' ? value.trim() : '';
  };
  return Object.fromEntries(PERSON_DETAIL_KEYS.filter(name => text(before, name) !== text(after, name))
    .map(name => [name, (after as unknown as Record<string, unknown>)[name]]));
}

/**
 * Review pass 6's H6S-2 (14 Oct 2026, Low): a note typed on a document's card WHILE Make Current was on its way (after
 * the press read the cloud, before the cloud answered) stayed on this phone's card only: the activation's answer
 * outranked the copy typed meanwhile, the press left the shared copy with the old note, and the upload that followed
 * sent nothing (with no cloud stamp here: caused by 3.1; with the pause in typing after the press: older).
 * The documents the press leaves on this device (`merged`, the cloud's answer merged in), with what THIS device typed
 * on any of them during the press (`ownEdits`: document id to the details its card text sync recorded as its own
 * since the press began) put back, stamped just after the cloud's copy so they outrank it here and on the other
 * devices; the cloud's current flags stay. `carried` are the ones to send.
 * The final review's F2 (14 Oct 2026, Low, caused by S1d): S1d took any card whose words changed on this device during
 * the press as typed here, words received from another device included, and sent another device's OLDER words as the
 * newest. Only this device's own edits are put back now; a card it did not type on is left as the cloud has it.
 */
export function withDetailsTypedDuringActivation<T extends ReferenceDocument>(
  merged: readonly T[],
  ownEdits: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  now = Date.now(),
): Readonly<{ documents: T[]; carried: T[] }> {
  const carried: T[] = [];
  const documents = merged.map(document => {
    const mine = ownEdits.get(document.id);
    if (!mine) return document;
    const changed = personDetailsChanged(document, { ...document, ...mine } as T);
    if (Object.keys(changed).length === 0) return document;
    const next = { ...document, ...changed, updatedAt: new Date(Math.max(now, revisionOf(document) + 1)).toISOString() } as T;
    carried.push(next);
    return next;
  });
  return { documents, carried };
}

/** What making a schedule current does to another project's schedule. */
export type ScheduleRetirementEffect = Readonly<{
  projectName: string;
  /** The older schedule the cloud still marks current there, shown next; null when none is left. */
  fallbackSchedule: Readonly<{ id: string; name: string }> | null;
  /**
   * Set for one of the chosen schedule's own projects: the newer schedule it
   * shows now, which the chosen schedule (fallbackSchedule) replaces there
   * (whole-app audit A8 pass 7 L1).
   */
  newerScheduleReplaced?: Readonly<{ id: string; name: string }>;
}>;

export async function activateSharedReferenceDocument({
  documentId,
  documents,
  client,
  listDocuments,
  confirmRetiringProjects,
  activate = activateECOSCurrentReferenceDocument,
  loadRetirementScope = loadECOSScheduleRetirementScope,
}: Readonly<{
  documentId: string;
  documents: readonly ReferenceDocument[];
  client: SupabaseClient | null;
  /** The cloud's documents, normalized, or null when they could not be read. */
  listDocuments: () => Promise<readonly ReferenceDocument[] | null>;
  /** Asked before a schedule replaces the current schedule of other projects. */
  confirmRetiringProjects: (effects: readonly ScheduleRetirementEffect[]) => Promise<boolean>;
  activate?: (input: {
    client: SupabaseClient;
    documentId: string;
    expectedUpdatedAt: string;
  }) => Promise<ECOSCurrentReferenceActivationResult>;
  /** Whether the cloud keeps a combined schedule current per project (owner answer Q15). */
  loadRetirementScope?: (client: SupabaseClient) => Promise<ScheduleRetirementScope | null>;
}>): Promise<SharedDocumentActivationOutcome> {
  const target = documents.find(document => document.id === documentId);
  // A schedule this device never heard back about is looked for in the cloud below (open item 3.1).
  if (!client || !target || (!target.cloudUpdatedAt && !isScheduleDocument(target))) return { status: 'refresh_required' };
  let expectedUpdatedAt = target.cloudUpdatedAt || '';

  // What the owner is told comes from the cloud's own current flags. The
  // phone shows one current schedule per project, so an older schedule the
  // cloud still marked current looked retired, and the dialog said a project
  // would show no schedule tasks when it went back to that schedule
  // (whole-app audit A5 pass 3 F2 (30 Sep 2026)).
  // Before the Q15 migration the cloud retires a combined schedule for every
  // project, after it only for the chosen schedule's projects; the question
  // follows what this cloud does, and is not asked when that is unknown.
  let retiring: ScheduleRetirementEffect[] = [];
  let scope: ScheduleRetirementScope = 'schedule';
  if (isScheduleDocument(target)) {
    const cloud = await listDocuments();
    const knownScope = cloud ? await loadRetirementScope(client) : null;
    if (!cloud || !knownScope) {
      return { status: 'failed', message: 'The shared schedules could not be read. Try again shortly.' };
    }
    scope = knownScope;
    const cloudTarget = cloud.find(document => document.id === documentId);
    // Never in the cloud: still uploading from this device (3.1). Once there and gone since: a refresh shows why.
    if (!cloudTarget) return target.cloudUpdatedAt ? { status: 'refresh_required' } : { status: 'not_uploaded', message: SCHEDULE_NOT_UPLOADED_YET };
    // Uploaded since this device last heard: made current by the cloud's own revision (3.1), only while nothing typed
    // here since is missing from the cloud's copy (H5S-1: the activation's stamp would outrank it).
    if (!target.cloudUpdatedAt && personDetails(target) !== personDetails(cloudTarget)) {
      return { status: 'not_uploaded', message: SCHEDULE_DETAILS_NOT_HEARD_BACK };
    }
    expectedUpdatedAt ||= cloudTarget.cloudUpdatedAt || '';
    if (!expectedUpdatedAt) return { status: 'refresh_required' };
    retiring = scheduleActivationEffects(cloudTarget, cloud, scope);
  }
  if (retiring.length > 0 && !(await confirmRetiringProjects(retiring))) {
    return { status: 'cancelled' };
  }

  let activation = await activate({
    client,
    documentId,
    expectedUpdatedAt,
  });
  if (activation.status === 'conflict') {
    // The record changed first (often this phone's own queued upload). Try
    // once more against the cloud's copy, unless that copy would now change
    // another project's schedule other than as the owner was told.
    const fresh = await listDocuments();
    const freshTarget = fresh?.find(document => document.id === documentId);
    if (
      fresh &&
      freshTarget?.cloudUpdatedAt &&
      sameEffects(scheduleActivationEffects(freshTarget, fresh, scope), retiring)
    ) {
      activation = await activate({
        client,
        documentId,
        expectedUpdatedAt: freshTarget.cloudUpdatedAt,
      });
    }
  }
  if (activation.status !== 'activated') {
    return {
      status: activation.status === 'not_prepared' ? 'not_prepared' : 'failed',
      message: activation.message || 'Refresh the project documents and try again.',
    };
  }
  return { status: 'activated', documents: await listDocuments() };
}

/**
 * The other projects whose schedule changes, read from the cloud's list.
 * Before the Q15 migration ('schedule') the cloud retires every current
 * schedule sharing a project with the chosen one, so choosing a schedule for
 * one project retires a combined schedule that also covers another project.
 * Each project shows its newest schedule marked current, so a project the
 * retired schedule was showing goes back to an older one still marked
 * current, or is left with none. After it ('project') a combined schedule
 * stays current for its other projects, and only a schedule sharing a
 * project with the chosen one by its project id alone is retired for them.
 */
export function scheduleActivationEffects(
  target: ReferenceDocument,
  documents: readonly ReferenceDocument[],
  scope: ScheduleRetirementScope = 'schedule',
): ScheduleRetirementEffect[] {
  if (!isScheduleDocument(target)) return [];
  const targetKeys = projectKeys(target);
  const { retired, after } = documentsAfterScheduleActivation(target, documents, scope);
  const effects: ScheduleRetirementEffect[] = [];
  for (const document of retired) {
    for (const name of projectNamesOf(document)) {
      const key = name.trim().toLowerCase();
      if (targetKeys.has(key) || effects.some(effect => effect.projectName.toLowerCase() === key)) continue;
      if (scheduleShownFor(name, documents)?.id !== document.id) continue;
      const fallback = scheduleShownFor(name, after);
      if (fallback?.id === target.id) continue;
      effects.push({
        projectName: name.trim(),
        fallbackSchedule: fallback ? { id: fallback.id, name: fallback.name } : null,
      });
    }
  }
  // Whole-app audit A8 pass 7 L1 (30 Sep 2026): the chosen schedule's own projects were left out, so Set
  // Active on a combined master F, for Beta which showed nothing, quietly replaced the newer MA Alpha showed.
  // Each own project that shows a newer schedule now is named, when Set Active is for another of its
  // projects (one showing nothing, or an older schedule); a rollback of every project it covers asks nothing.
  const own = scopeNamesOf(target)
    .map(name => ({ name, before: scheduleShownFor(name, documents) }))
    .filter(({ before }) => before?.id !== target.id);
  const replacing = own.flatMap(({ name, before }) => before && importedAtOf(before) > importedAtOf(target) &&
    scheduleShownFor(name, after)?.id === target.id ? [{ name, before }] : []);
  if (replacing.length < own.length) {
    replacing.forEach(({ name, before }) => effects.push({
      projectName: name,
      fallbackSchedule: { id: target.id, name: target.name },
      newerScheduleReplaced: { id: before.id, name: before.name },
    }));
  }
  return effects;
}

function importedAtOf(document: ReferenceDocument): number {
  return Date.parse(document.importedAt || '') || 0;
}

/**
 * The schedule a project shows: its own current schedule or, with none, a
 * current schedule that lists it, as the task list falls back
 * (selectAuthoritativeScheduleItems). A combined schedule retired for Alpha
 * still shows Alpha's tasks once Alpha has no schedule of its own; the Set
 * Active question left Alpha out when that schedule was retired for Beta
 * too (whole-app audit A5 pass 4 #4, 30 Sep 2026).
 */
function scheduleShownFor(name: string, documents: readonly ReferenceDocument[]): ReferenceDocument | undefined {
  const key = scheduleProjectScopeKey(name);
  return currentScheduleDocumentsByProject(documents).get(key) ??
    currentScheduleDocumentWinners(documents).find(document =>
      projectNamesOf(document).some(listed => scheduleProjectScopeKey(listed) === key));
}

/** What making a schedule with no tasks of its own current hides. */
export type ScheduleTasksHiddenByActivation = Readonly<{
  count: number;
  /** The schedule the hidden tasks were imported from. */
  scheduleName: string;
}>;

/**
 * The cloud retires every current schedule in the chosen schedule's project
 * (for that project only, once the Q15 migration is applied), and each
 * device then shows only the tasks a current schedule contains. A schedule
 * PDF with no imported tasks, made current, hid every imported task of the
 * project on every device, without a word (whole-app audit A8 pass 1 F6,
 * 30 Sep 2026). Nothing is deleted; making the older schedule current again
 * shows them. Null when no task is hidden, or when the schedule brings tasks
 * of its own (a replacement, which asks nothing, as before).
 */
export function scheduleTasksHiddenByActivation(
  target: ReferenceDocument,
  documents: readonly ReferenceDocument[],
  scheduleItems: readonly ScheduleItem[],
  scope: ScheduleRetirementScope | null = 'schedule',
): ScheduleTasksHiddenByActivation | null {
  if (!isScheduleDocument(target) || scheduleItems.some(item => scheduleContainsItem(target, item))) {
    return null;
  }
  const showing = (scheduleDocuments: readonly ReferenceDocument[]) =>
    selectAuthoritativeScheduleItems({ scheduleItems: [...scheduleItems], scheduleDocuments: [...scheduleDocuments] });
  const before = showing(documents);
  const shownBefore = new Set(before.map(item => item.id));
  const after = showing(documentsAfterScheduleActivation(target, documents, scope).after);
  // A task shown only afterwards comes with the chosen schedule: a replacement.
  if (after.some(item => !shownBefore.has(item.id))) return null;
  const shownAfter = new Set(after.map(item => item.id));
  const hidden = before.filter(item => !shownAfter.has(item.id));
  if (hidden.length === 0) return null;
  const sources = documents
    .filter(document => document.id !== target.id && isScheduleDocument(document))
    .map(document => ({ document, count: hidden.filter(item => scheduleContainsItem(document, item)).length }))
    .filter(source => source.count > 0)
    .sort((left, right) => right.count - left.count);
  const current = currentScheduleDocumentsByProject(documents);
  const projectCurrent = projectNamesOf(target)
    .map(name => current.get(scheduleProjectScopeKey(name)))
    .find(document => document && document.id !== target.id);
  return {
    count: hidden.length,
    scheduleName: sources[0]?.document.name || projectCurrent?.name || 'the current schedule',
  };
}

/** The question asked before those tasks are hidden, or null when none are. */
export function scheduleTasksHiddenWarning(
  targetName: string,
  hidden: ScheduleTasksHiddenByActivation | null,
): Readonly<{ title: string; message: string }> | null {
  if (!hidden) return null;
  const tasks = `${hidden.count} ${hidden.count === 1 ? 'task' : 'tasks'}`;
  return {
    title: `Make ${targetName} current?`,
    message: `${targetName} has no imported tasks. The ${tasks} from ${hidden.scheduleName} will be hidden on every device.`,
  };
}

/**
 * The shared schedule a phone schedule PDF already is, or the record it is
 * shared as when it is made current.
 */
export function phoneScheduleActivationTarget(
  document: Readonly<{ id: string; name: string; referenceDocumentId?: string | null; importedAt: string }>,
  projectName: string | null,
  documents: readonly ReferenceDocument[],
): ReferenceDocument {
  const shared = document.referenceDocumentId
    ? documents.find(item => item.id === document.referenceDocumentId)
    : null;
  return shared || {
    id: document.id,
    name: document.name.replace(/\.[^/.]+$/, ''),
    originalFileName: document.name,
    uri: '',
    category: 'Schedules',
    notes: '',
    isCurrent: false,
    importedAt: document.importedAt,
    projectName,
  };
}

/**
 * Open item 3.1 (13 Oct 2026; the A5 / A8 recorded Medium). Make Current on a phone schedule card with no shared copy
 * (never shared, or its file still uploading) made a shared record current on this phone only and marked the others
 * not current here alone; the cloud kept its own flags, so the other devices never changed, and the card's own upload
 * finishing then linked it to a second copy that was not current. It is now made current only by the cloud. Such a
 * card is not made current: an uploaded card never shared is shared first (`share`), and the line says what to do.
 */
export function phoneScheduleCardNotSharedYet(
  card: Readonly<{ status?: string | null; storagePath?: string | null; referenceDocumentId?: string | null }>,
): Readonly<{ share: boolean; message: string }> {
  if (card.status === 'failed') {
    return { share: false, message: 'This schedule did not finish uploading from this device, so your other devices do not have it. Nothing was changed on any device. Tap Retry on its card; once it has uploaded, use Make Current again.' };
  }
  if (card.status !== 'uploaded' || !card.storagePath?.trim()) {
    return { share: false, message: 'This schedule has not finished uploading from this device, so your other devices do not have it yet. Nothing was changed on any device. Once it has uploaded, use Make Current again.' };
  }
  if (card.referenceDocumentId?.trim()) {
    return { share: false, message: 'This schedule’s shared copy is no longer on this device, so it cannot be made current on your other devices. Nothing was changed on any device. Add the file again to share it.' };
  }
  return { share: true, message: 'This schedule was not yet shared with your other devices. It is being shared now; nothing was changed on any device. Once it has uploaded, use Make Current again (Sync Now sends it at once when you have signal).' };
}

/**
 * The imported schedule a phone schedule PDF already is: the same file (the
 * lowercase SHA-256 of its bytes, kept by the phone's file record, its shared
 * copy and the import alike) imported for the card's project. Make Current
 * on the card made the task-less upload copy current instead and hid that
 * import's tasks on every device (whole-app audit A8 pass 2 #2). The one
 * already current first, then the newest; null when the file was never
 * imported for that project.
 */
export function importedScheduleOfPhoneSchedule(
  document: Readonly<{ ownedFileId?: string | null; ownedFileManifest?: unknown; referenceDocumentId?: string | null }>,
  projectName: string | null,
  documents: readonly ReferenceDocument[],
): ReferenceDocument | null {
  let sha256 = '';
  try {
    sha256 = cloudKey(document.ownedFileId
      ? parseOwnedLocalFileManifest(document.ownedFileManifest).files[document.ownedFileId]?.sha256 : '');
  } catch {
    sha256 = '';
  }
  if (!sha256) sha256 = cloudKey(documents.find(item => item.id === document.referenceDocumentId)?.contentSha256);
  const project = cloudKey(projectName);
  if (!sha256 || !project) return null;
  return documents
    .filter(item => isScheduleDocument(item) && cloudKey(item.importBatchId) && cloudKey(item.contentSha256) === sha256 &&
      projectNamesOf(item).some(name => cloudKey(name) === project))
    .sort((left, right) => Number(Boolean(right.isCurrent)) - Number(Boolean(left.isCurrent)) ||
      String(right.importedAt || '').localeCompare(String(left.importedAt || '')))[0] || null;
}

/**
 * Whether a phone schedule card reads "Current Schedule": the schedule this
 * phone shows for the card's project (Q15 retirements included) is the
 * card's shared copy or its import. The card's own flag was set only by
 * its Make Current and never followed the cloud, so the badge stayed and
 * the button stayed disabled after Set Active, an import, the iPad or the
 * web made another schedule current (whole-app audit A8 pass 3 L1). The
 * flag is used only when the card has no shared copy or import on this
 * phone, or no known project.
 */
export function phoneScheduleCardIsCurrent(
  card: Readonly<{
    id: string;
    isCurrent?: boolean | null;
    referenceDocumentId?: string | null;
    ownedFileId?: string | null;
    ownedFileManifest?: unknown;
  }>,
  projectName: string | null,
  documents: readonly ReferenceDocument[],
): boolean {
  const sharedId = card.referenceDocumentId || card.id;
  const own = [
    documents.find(document => document.id === sharedId && isScheduleDocument(document)),
    importedScheduleOfPhoneSchedule(card, projectName, documents),
  ].filter((document): document is ReferenceDocument => Boolean(document));
  if (own.length === 0 || !projectName?.trim()) return Boolean(card.isCurrent);
  // A lookahead is in effect by its role (owner answer Q22) while it is the newest for the project (owner answer Q25).
  if (own.some(scheduleDocumentAddsToMaster)) {
    const replaced = scheduleLookaheadReplacedFor(documents);
    return own.some(document => scheduleDocumentAddsToMaster(document) && !replaced(document, projectName));
  }
  const shown = currentScheduleDocumentsByProject(documents);
  const current = [shown.get(scheduleProjectScopeKey(projectName)), shown.get('')];
  return own.some(document => current.some(candidate => candidate?.id === document.id));
}

/**
 * Whether these schedule bytes are already imported for exactly these
 * projects, so the import is refused as a duplicate. Only an import counts:
 * a schedule with an import batch (the phone's, the iPad's and the web's
 * imports all have one) or with tasks of its own. A phone schedule card's
 * shared copy (its upload, or the record Make Current made of it) has
 * neither, and it refused "Import This Schedule" on every card that had
 * uploaded, and the same file from the Schedule screen, with "Schedule
 * already added" (whole-app audit A8 pass 3 M1).
 */
export function scheduleImportAlreadyAdded(input: ScheduleImportSavedForFileInput): boolean {
  return scheduleImportsSavedForFile(input).length > 0;
}

type ScheduleImportSavedForFileInput = Readonly<{
  documents: readonly ReferenceDocument[];
  scheduleItems: readonly ScheduleItem[];
  /** The import's own record id; the same id is the same import. */
  documentId: string;
  contentSha256: string;
  projectNames: readonly string[];
  /** Complete explicit incoming projects, when positively read from the file. */
  resolvedProjectNames?: readonly string[];
}>;

function scheduleImportsSavedForFile({
  documents,
  scheduleItems,
  documentId,
  contentSha256,
  projectNames,
  resolvedProjectNames,
}: ScheduleImportSavedForFileInput): ReferenceDocument[] {
  const scope = canonicalProjectNames(projectNames);
  const resolvedScope = resolvedProjectNames?.length ? canonicalProjectNames(resolvedProjectNames) : null;
  return documents.filter(document => document.id === documentId || (
    isScheduleDocument(document) &&
    document.contentSha256 === contentSha256 &&
    (canonicalProjectNames(document.projectNames || []) === scope ||
      resolvedScope !== null && canonicalProjectNames(document.projectNames || []) === resolvedScope) &&
    (Boolean(cloudKey(document.importBatchId)) || scheduleItems.some(item => scheduleContainsItem(document, item)))
  ));
}

/**
 * Importing schedule bytes into a project scope: its identity, and whether
 * the import is refused as already added (scheduleImportAlreadyAdded).
 *
 * Whole-app audit A8 pass 5 L3 (30 Sep 2026): a lookahead imported before
 * owner answer Q22 is saved as a full schedule, and the way to make it one
 * (import the same file again, choose Lookahead) was refused "Schedule
 * already added". A file saved only as a full schedule may now be imported
 * again as a lookahead (asLookahead: the review comes preset, and saving it
 * as a full schedule again is refused there, ScheduleLookahead). It is a new
 * import of its own, the next free identity, so the saved schedule and its
 * tasks are left as they are and the lookahead restates the tasks of the
 * master shown now, as any lookahead does. A file already saved as a
 * lookahead is refused, as before.
 *
 * Whole-app audit A8 pass 5 M1 / A5 pass 6 L1 (30 Sep 2026): that offer
 * did not check whether the saved copy is the schedule in use. Picking the
 * current master again (by accident, or to finish the rows an Accept
 * Selected left) opened the review preset to Lookahead, and accepting made
 * the master its own lookahead, whose tasks always show: a task the next
 * master dropped stayed and went overdue. A pre-Q22 lookahead still shown
 * as a full schedule paired with its own copy, and showed twice after the
 * master was made current. The file is offered as a lookahead only while no
 * saved full copy of it is the schedule shown for its projects; otherwise
 * "Schedule already added" says to make the master current first.
 *
 * Whole-app audit A8 pass 6 L1 (30 Sep 2026): with no schedule shown for the
 * project (master F replaced by M2, M2 deleted), picking F's file again was
 * still offered as a lookahead, and accepted, the master became its own
 * lookahead. The saved full copy is now in use too while any project it
 * covers shows no full schedule: the import is refused, saying to open it in
 * Schedule Sources and use Set Active.
 *
 * Whole-app audit A8 pass 7 L1 (30 Sep 2026): Set Active on a combined
 * master also replaces the newer schedule another of its projects shows, so
 * that advice is given only when no project it covers shows a different
 * schedule; otherwise the refusal is plain ("already saved under Schedule
 * Sources"). A project shown through the task list's fallback (a combined
 * schedule retired for it, current for another) counts as showing one.
 */
export function scheduleImportOfFile({
  bytes,
  projects,
  documentIdIsDeleted,
  documents,
  scheduleItems,
  projectNames,
  onDocumentsScreen = false,
}: Readonly<{
  bytes: ArrayBuffer | Uint8Array;
  projects: readonly ScheduleImportScopeProject[];
  documentIdIsDeleted: (documentId: string) => boolean;
  documents: readonly ReferenceDocument[];
  scheduleItems: readonly ScheduleItem[];
  projectNames: readonly string[];
  /** Picked on the Documents screen: the refusal says where Schedule Sources is (A8 pass 7). */
  onDocumentsScreen?: boolean;
}>): {
  identity: ScheduleImportSourceIdentity;
  alreadyImported: boolean;
  asLookahead: boolean;
  /** What "Schedule already added" says (A8 pass 5 M1). */
  alreadyAddedMessage: string;
} {
  const identity = resolveScheduleImportSourceIdentity({ bytes, projects, documentIdIsDeleted });
  const saved = scheduleImportsSavedForFile({
    documents, scheduleItems, documentId: identity.documentId, contentSha256: identity.contentSha256, projectNames,
    resolvedProjectNames: explicitIncomingScheduleProjects(bytes, projects),
  });
  const savedAsFullSchedule = saved.length > 0 &&
    saved.every(document => isScheduleDocument(document) && !scheduleDocumentAddsToMaster(document));
  const shown = new Set([...currentScheduleDocumentsByProject(documents).values()].map(document => document.id));
  const inUse = savedAsFullSchedule && saved.some(document => shown.has(document.id));
  // A project it covers shows no full schedule: Set Active shows it again (A8 pass 6 L1), and is the advice
  // only when it replaces no schedule another project it covers shows (A8 pass 7 L1).
  const unshown = savedAsFullSchedule && !inUse ? saved.map(document => scheduleFullCopyLeftUnshown(document, documents)) : [];
  const leftUnshown = unshown.includes('other_shown') ? 'other_shown' : unshown.includes('set_active') ? 'set_active' : null;
  if (!savedAsFullSchedule || inUse || leftUnshown) {
    // The phone's Schedule Sources panel and its Set Active button: the same words as ScheduleLookahead's review.
    const sources = onDocumentsScreen ? 'Schedule Sources on the Schedule screen' : 'Schedule Sources';
    return {
      identity,
      alreadyImported: saved.length > 0,
      asLookahead: false,
      alreadyAddedMessage: inUse ? `${SCHEDULE_ALREADY_ADDED} ${SCHEDULE_MASTER_CURRENT_FIRST}`
        : leftUnshown === 'set_active' ? `This schedule file is already saved. Open it in ${sources} and use Set Active to show it again.`
        : leftUnshown ? `This schedule file is already saved under ${sources}.` : SCHEDULE_ALREADY_ADDED,
    };
  }
  const savedIds = new Set(documents.map(document => document.id));
  return {
    identity: resolveScheduleImportSourceIdentity({ bytes, projects, documentIdIsDeleted: id => documentIdIsDeleted(id) || savedIds.has(id) }),
    alreadyImported: false,
    asLookahead: true,
    alreadyAddedMessage: SCHEDULE_ALREADY_ADDED,
  };
}

/** An early duplicate check may use only a complete explicit delimited
 * Project column. Projectless, ambiguous, binary and larger files still reach
 * review; reviewed rows supply their scope there. Never infer intent from a
 * saved SHA or from a saved scope being contained in the active selection.
 */
function explicitIncomingScheduleProjects(bytes: ArrayBuffer | Uint8Array, projects: readonly ScheduleImportScopeProject[]): string[] | undefined {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!data.length || data.length > 1_000_000) return undefined;
  let text: string;
  try {
    text = typeof TextDecoder === 'function'
      ? new TextDecoder('utf-8', {fatal: true}).decode(data)
      : decodeURIComponent(Array.from(data, byte => '%' + byte.toString(16).padStart(2, '0')).join(''));
  } catch { return undefined; }
  if (text.includes('\0')) return undefined;
  const selected = new Map<string, string[]>();
  for (const project of projects) {
    const key = canonicalProjectNames([project.name]);
    selected.set(key, [...(selected.get(key) || []), project.name]);
  }
  for (const delimiter of [',', '\t'] as const) {
    const parsed = parseScheduleDelimitedText(text, delimiter);
    if (parsed.issues.length || parsed.rows.length < 2) continue;
    const header = parsed.rows[0].map(value => value.trim().toLowerCase().replace(/[_\s]+/g, ' '));
    const columns = header.flatMap((value, index) => value === 'project' || value === 'project name' ? [index] : []);
    if (columns.length !== 1 || !header.some(value => ['task', 'task name', 'activity', 'activity name'].includes(value))) continue;
    const rows = parsed.rows.slice(1).filter(row => row.some(value => value.trim()));
    if (!rows.length || rows.some(row => row.length !== header.length)) continue;
    const names: string[] = [];
    for (const row of rows) {
      const matches = selected.get(canonicalProjectNames([row[columns[0]]])) || [];
      if (matches.length !== 1) return undefined;
      names.push(matches[0]);
    }
    return [...new Set(names)];
  }
  return undefined;
}

const SCHEDULE_ALREADY_ADDED = 'This exact schedule is already saved for the selected projects. Open the existing schedule source instead of importing a duplicate.';
const SCHEDULE_MASTER_CURRENT_FIRST = 'If this file is a lookahead, make your master schedule current first, then import it again.';

function canonicalProjectNames(projectNames: readonly unknown[]): string {
  return [...new Set(projectNames
    .map(name => typeof name === 'string' ? name.trim().toLowerCase().replace(/\s+/g, ' ') : '')
    .filter(Boolean))]
    .sort()
    .join('|');
}

/**
 * What the web says once a schedule is made current, true before and after
 * the Q15 migration: the projects it is now current for and, when the
 * activation's response says the cloud keeps combined schedules current per
 * project, each combined schedule that stays current for its other projects.
 * The web has always made a schedule current without asking first.
 */
export function scheduleActivationNotice(
  target: ReferenceDocument,
  documentsBefore: readonly ReferenceDocument[],
  scope: ScheduleRetirementScope,
): string {
  const projects = scopeNamesOf(target);
  const sentences = [`“${target.name}” is now the current schedule${projects.length ? ` for ${projects.join(', ')}` : ''}.`];
  if (scope === 'project') {
    const retiredBefore = new Map(documentsBefore.map(document =>
      [document.id, scheduleDocumentRetiredProjectNames(document).length]));
    documentsAfterScheduleActivation(target, documentsBefore, scope).after.forEach(document => {
      const retired = scheduleDocumentRetiredProjectNames(document).map(cloudKey);
      if (document.id === target.id || !document.isCurrent || retired.length <= (retiredBefore.get(document.id) ?? 0)) return;
      const remaining = scopeNamesOf(document).filter(name => !retired.includes(cloudKey(name)));
      sentences.push(`“${document.name}” stays current for ${remaining.join(', ')}.`);
    });
  }
  return [...sentences, 'Earlier schedules remain available as history.'].join(' ');
}

/**
 * The Set Active confirmation: what each other project shows next, then each
 * of the chosen schedule's own projects that switches away from a newer
 * schedule (A8 pass 7 L1).
 */
export function scheduleRetirementMessage(effects: readonly ScheduleRetirementEffect[]): string {
  const others = effects.filter(effect => !effect.newerScheduleReplaced);
  return [
    ...(others.length > 0 ? [`The schedule now current for ${others.map(effect => effect.projectName).join(', ')} will be retired too.`] : []),
    ...others.map(effect => effect.fallbackSchedule
      ? `${effect.projectName} goes back to ${effect.fallbackSchedule.name}, an older schedule still marked current there.`
      : `${effect.projectName} is left with no current schedule and shows no schedule tasks until you set one.`),
    ...effects.flatMap(effect => effect.newerScheduleReplaced && effect.fallbackSchedule
      ? [`${effect.projectName} now shows ${effect.newerScheduleReplaced.name} (newer). Set Active on ${effect.fallbackSchedule.name} will show ${effect.fallbackSchedule.name} for ${effect.projectName} too.`]
      : []),
  ].join(' ');
}

/**
 * The schedules after the chosen one is made current, by the same rule as
 * the cloud, for a schedule made current on this phone before it is shared
 * (App.tsx makeProjectScheduleDocumentCurrent). It used to retire every
 * schedule of every project. Only the documents that change are new objects,
 * stamped with updatedAt when given; a chosen schedule not in the list comes
 * first.
 *
 * With the cloud's rule unknown (scope null: offline, or no answer in 5 s)
 * only the chosen schedule is marked current here (whole-app audit A5 pass 4
 * #5, 30 Sep 2026). The old rule retired the combined master for Beta
 * without asking, until the next refresh put it back; another schedule's
 * flags never reach the cloud from here, so the cloud settles them.
 */
export function scheduleDocumentsAfterActivation<T extends ReferenceDocument>(
  target: T,
  documents: readonly T[],
  scope: ScheduleRetirementScope | null,
  updatedAt?: string,
): T[] {
  const withTarget = documents.some(document => document.id === target.id) ? documents : [target, ...documents];
  const { after } = documentsAfterScheduleActivation(target, withTarget, scope);
  return after.map((document, index) => document === withTarget[index] || !updatedAt
    ? document as T
    : { ...document, updatedAt } as T);
}

/**
 * As the cloud does it (ecos_activate_current_reference_document): the
 * chosen schedule current, with no project retired, and every current
 * schedule sharing a project with it retired. With the Q15 migration
 * ('project', ecos_schedule_after_current_activation) a schedule that also
 * covers projects the chosen one does not, by name, is retired for the
 * chosen schedule's projects only and stays current for the rest.
 */
function documentsAfterScheduleActivation(
  target: ReferenceDocument,
  documents: readonly ReferenceDocument[],
  scope: ScheduleRetirementScope | null,
): { retired: ReferenceDocument[]; after: ReferenceDocument[] } {
  const targetKeys = projectKeys(target);
  // Unknown (null): no other schedule changes (A5 pass 4 #5).
  const sharing = scope === null ? [] : documents.filter(document =>
    document.id !== target.id && document.isCurrent && isScheduleDocument(document) &&
    [...projectKeys(document)].some(key => targetKeys.has(key)));
  const partly = new Map<ReferenceDocument, string[]>();
  if (scope === 'project') {
    sharing.forEach(document => {
      const names = scopeNamesOf(document);
      const alreadyRetired: unknown[] = Array.isArray(document.retiredForProjectNames) ? document.retiredForProjectNames : [];
      const covered = new Set([...targetKeys, ...alreadyRetired.map(cloudKey)]);
      const retiredNames = names.filter(name => covered.has(cloudKey(name)));
      if (retiredNames.length > 0 && retiredNames.length < names.length) partly.set(document, retiredNames);
    });
  }
  const retired = sharing.filter(document => !partly.has(document));
  const withTarget = documents.some(document => document.id === target.id) ? documents : [...documents, target];
  const after = withTarget.map(document => {
    if (document.id === target.id) return withoutRetirement({ ...document, isCurrent: true });
    const retiredNames = partly.get(document);
    if (retiredNames) return { ...document, retiredForProjectNames: retiredNames };
    return retired.includes(document) ? withoutRetirement({ ...document, isCurrent: false }) : document;
  });
  return { retired, after };
}

function withoutRetirement(document: ReferenceDocument): ReferenceDocument {
  const { retiredForProjectNames: _retired, ...rest } = document;
  return rest;
}

/** As the cloud reads them: the project list, or the single project name when the list is empty. */
function scopeNamesOf(document: ReferenceDocument): string[] {
  const listed = (document.projectNames || []).filter(name => typeof name === 'string' && name.trim());
  const names = listed.length > 0 ? listed : [document.projectName || ''].filter(name => name.trim());
  return names
    .map(name => name.trim())
    .filter((name, index, all) => all.findIndex(other => cloudKey(other) === cloudKey(name)) === index);
}

function cloudKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** A task imported from the schedule, or found unchanged in its import. */
function scheduleContainsItem(document: ReferenceDocument, item: ScheduleItem): boolean {
  const key = (value: string | null | undefined) => (value || '').trim().toLowerCase();
  const batchId = key(document.importBatchId);
  return (Boolean(key(item.sourceDocumentId)) && key(item.sourceDocumentId) === key(document.id)) ||
    (Boolean(batchId) && scheduleItemImportBatchIds(item).some(id => key(id) === batchId));
}

function isScheduleDocument(document: ReferenceDocument): boolean {
  const category = (document.category || '').trim().toLowerCase();
  return category === 'schedules' || category === 'schedule';
}

/** As the cloud compares them: project id, project name and project names. */
function projectKeys(document: ReferenceDocument): Set<string> {
  return new Set([document.projectId, ...projectNamesOf(document)].map(cloudKey).filter(Boolean));
}

function projectNamesOf(document: ReferenceDocument): string[] {
  return [document.projectName, ...(document.projectNames || [])]
    .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()));
}

function sameEffects(
  left: readonly ScheduleRetirementEffect[],
  right: readonly ScheduleRetirementEffect[],
): boolean {
  const key = (effects: readonly ScheduleRetirementEffect[]) => effects
    .map(effect => `${effect.projectName.trim().toLowerCase()}>${effect.fallbackSchedule?.id ?? ''}>${effect.newerScheduleReplaced?.id ?? ''}`)
    .sort()
    .join('|');
  return key(left) === key(right);
}
