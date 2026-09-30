import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocument } from '../types';
import {
  activateECOSCurrentReferenceDocument,
  type ECOSCurrentReferenceActivationResult,
} from './ECOSHostedIndexer';

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
  confirmRetiringProjects: (projectNames: readonly string[]) => Promise<boolean>;
  activate?: (input: {
    client: SupabaseClient;
    documentId: string;
    expectedUpdatedAt: string;
  }) => Promise<ECOSCurrentReferenceActivationResult>;
}>): Promise<SharedDocumentActivationOutcome> {
  const target = documents.find(document => document.id === documentId);
  if (!client || !target?.cloudUpdatedAt) return { status: 'refresh_required' };

  const retiring = projectsLeftWithoutCurrentSchedule(target, documents);
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
    // once more against the cloud's copy, unless that copy would now retire
    // a project the owner was not asked about.
    const fresh = await listDocuments();
    const freshTarget = fresh?.find(document => document.id === documentId);
    if (
      fresh &&
      freshTarget?.cloudUpdatedAt &&
      sameNames(projectsLeftWithoutCurrentSchedule(freshTarget, fresh), retiring)
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
 * The projects that would be left with no current schedule. The cloud retires
 * every current schedule sharing a project with the chosen one, so choosing a
 * schedule for one project retires a combined schedule that also covers
 * another project.
 */
export function projectsLeftWithoutCurrentSchedule(
  target: ReferenceDocument,
  documents: readonly ReferenceDocument[],
): string[] {
  if (!isScheduleDocument(target)) return [];
  const targetKeys = projectKeys(target);
  const current = documents.filter(document =>
    document.id !== target.id && document.isCurrent && isScheduleDocument(document));
  const retired = current.filter(document =>
    [...projectKeys(document)].some(key => targetKeys.has(key)));
  const remaining = current.filter(document => !retired.includes(document));
  const covered = new Set([
    ...targetKeys,
    ...remaining.flatMap(document => [...projectKeys(document)]),
  ]);
  const left: string[] = [];
  for (const document of retired) {
    for (const name of projectNamesOf(document)) {
      const key = name.trim().toLowerCase();
      if (!covered.has(key) && !left.some(existing => existing.trim().toLowerCase() === key)) {
        left.push(name.trim());
      }
    }
  }
  return left;
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

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  const key = (names: readonly string[]) =>
    names.map(name => name.trim().toLowerCase()).sort().join('|');
  return key(left) === key(right);
}
