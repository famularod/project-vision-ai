import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocument } from '../types';
import {
  activateECOSCurrentReferenceDocument,
  type ECOSCurrentReferenceActivationResult,
} from './ECOSHostedIndexer';
import { currentScheduleDocumentsByProject, scheduleProjectScopeKey } from './PIEScheduleReconciliation';

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
}>): Promise<SharedDocumentActivationOutcome> {
  const target = documents.find(document => document.id === documentId);
  if (!client || !target?.cloudUpdatedAt) return { status: 'refresh_required' };

  // What the owner is told comes from the cloud's own current flags. The
  // phone shows one current schedule per project, so an older schedule the
  // cloud still marked current looked retired, and the dialog said a project
  // would show no schedule tasks when it went back to that schedule
  // (whole-app audit A5 pass 3 F2 (30 Sep 2026)).
  let retiring: ScheduleRetirementEffect[] = [];
  if (isScheduleDocument(target)) {
    const cloud = await listDocuments();
    if (!cloud) {
      return { status: 'failed', message: 'The shared schedules could not be read. Try again shortly.' };
    }
    const cloudTarget = cloud.find(document => document.id === documentId);
    if (!cloudTarget) return { status: 'refresh_required' };
    retiring = scheduleActivationEffects(cloudTarget, cloud);
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
      sameEffects(scheduleActivationEffects(freshTarget, fresh), retiring)
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
 * The other projects whose schedule changes, read from the cloud's list. The
 * cloud retires every current schedule sharing a project with the chosen one,
 * so choosing a schedule for one project retires a combined schedule that
 * also covers another project. Each project shows its newest schedule marked
 * current, so a project the retired schedule was showing goes back to an
 * older one still marked current, or is left with none.
 */
export function scheduleActivationEffects(
  target: ReferenceDocument,
  documents: readonly ReferenceDocument[],
): ScheduleRetirementEffect[] {
  if (!isScheduleDocument(target)) return [];
  const targetKeys = projectKeys(target);
  const retired = documents.filter(document =>
    document.id !== target.id && document.isCurrent && isScheduleDocument(document) &&
    [...projectKeys(document)].some(key => targetKeys.has(key)));
  const after = documents.map(document => document.id === target.id
    ? { ...document, isCurrent: true }
    : retired.includes(document) ? { ...document, isCurrent: false } : document);
  const showingBefore = currentScheduleDocumentsByProject(documents);
  const showingAfter = currentScheduleDocumentsByProject(after);
  const effects: ScheduleRetirementEffect[] = [];
  for (const document of retired) {
    for (const name of projectNamesOf(document)) {
      const key = name.trim().toLowerCase();
      if (targetKeys.has(key) || effects.some(effect => effect.projectName.toLowerCase() === key)) continue;
      if (showingBefore.get(scheduleProjectScopeKey(name))?.id !== document.id) continue;
      const fallback = showingAfter.get(scheduleProjectScopeKey(name));
      if (fallback?.id === target.id) continue;
      effects.push({
        projectName: name.trim(),
        fallbackSchedule: fallback ? { id: fallback.id, name: fallback.name } : null,
      });
    }
  }
  return effects;
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

function isScheduleDocument(document: ReferenceDocument): boolean {
  const category = (document.category || '').trim().toLowerCase();
  return category === 'schedules' || category === 'schedule';
}

/** As the cloud compares them: project id, project name and project names. */
function projectKeys(document: ReferenceDocument): Set<string> {
  return new Set(
    [document.projectId, ...projectNamesOf(document)]
      .map(value => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
      .filter(Boolean),
  );
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
