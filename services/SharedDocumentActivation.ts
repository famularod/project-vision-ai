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
  currentScheduleDocumentWinners,
  scheduleDocumentAddsToMaster,
  scheduleDocumentRetiredProjectNames,
  scheduleProjectScopeKey,
  selectAuthoritativeScheduleItems,
} from './PIEScheduleReconciliation';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import { parseOwnedLocalFileManifest } from './OwnedLocalFileRepository';

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
  | Readonly<{ status: 'not_prepared' | 'failed'; message: string }>;

/** What making a schedule current does to another project's schedule. */
export type ScheduleRetirementEffect = Readonly<{
  projectName: string;
  /** The older schedule the cloud still marks current there, shown next; null when none is left. */
  fallbackSchedule: Readonly<{ id: string; name: string }> | null;
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
  if (!client || !target?.cloudUpdatedAt) return { status: 'refresh_required' };

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
    if (!cloudTarget) return { status: 'refresh_required' };
    retiring = scheduleActivationEffects(cloudTarget, cloud, scope);
  }
  if (retiring.length > 0 && !(await confirmRetiringProjects(retiring))) {
    return { status: 'cancelled' };
  }

  let activation = await activate({
    client,
    documentId,
    expectedUpdatedAt: target.cloudUpdatedAt,
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
  return effects;
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
  if (own.some(scheduleDocumentAddsToMaster)) return true; // a lookahead is in effect by its role (owner answer Q22)
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
export function scheduleImportAlreadyAdded({
  documents,
  scheduleItems,
  documentId,
  contentSha256,
  projectNames,
}: Readonly<{
  documents: readonly ReferenceDocument[];
  scheduleItems: readonly ScheduleItem[];
  /** The import's own record id; the same id is the same import. */
  documentId: string;
  contentSha256: string;
  projectNames: readonly string[];
}>): boolean {
  const scope = canonicalProjectNames(projectNames);
  return documents.some(document => document.id === documentId || (
    isScheduleDocument(document) &&
    document.contentSha256 === contentSha256 &&
    canonicalProjectNames(document.projectNames || []) === scope &&
    (Boolean(cloudKey(document.importBatchId)) || scheduleItems.some(item => scheduleContainsItem(document, item)))
  ));
}

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

/** The Set Active confirmation: what each other project shows next. */
export function scheduleRetirementMessage(effects: readonly ScheduleRetirementEffect[]): string {
  return [
    `The schedule now current for ${effects.map(effect => effect.projectName).join(', ')} will be retired too.`,
    ...effects.map(effect => effect.fallbackSchedule
      ? `${effect.projectName} goes back to ${effect.fallbackSchedule.name}, an older schedule still marked current there.`
      : `${effect.projectName} is left with no current schedule and shows no schedule tasks until you set one.`),
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
    .map(effect => `${effect.projectName.trim().toLowerCase()}>${effect.fallbackSchedule?.id ?? ''}`)
    .sort()
    .join('|');
  return key(left) === key(right);
}
