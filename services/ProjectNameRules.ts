import { legacyProjectNameKey } from './OperationalProjectIdentity';

/**
 * Rules for a typed project name and for project changes still waiting in the
 * offline queue (whole-app audit A3, 30 Sep 2026).
 */

type ProjectTombstone = Readonly<{
  entityType: string;
  recordId: string;
  deletedAt?: string | null;
}>;

type QueuedChange = Readonly<{
  entity: string;
  operation: string;
  payload: unknown;
}>;

export type ProjectNameAvailability =
  | Readonly<{ kind: 'available' }>
  | Readonly<{ kind: 'deleted'; deletedAt: string | null }>
  | Readonly<{ kind: 'archived'; projectName: string }>
  | Readonly<{ kind: 'exists' }>
  | Readonly<{ kind: 'similar'; projectName: string; source: 'active' | 'archived' | 'deleted' }>;

/**
 * Whether a typed name can start a new project. A deleted project's name is
 * recorded on every device and never retires, so a project re-created under
 * it vanished on the next refresh and its updates were dropped from the upload
 * queue without a word: it is refused with the reason until the cloud can
 * record that a deletion was cleared (owner question Q12). An archived name is
 * offered for reopening instead of "Already added". A name that differs from
 * another project's only in punctuation or spacing ("Lot 5" and "Lot-5") is
 * refused too: phone documents, cover photos and the delete cascade are keyed
 * by legacyProjectNameKey, so the two projects would share documents and
 * deleting one would remove the other's (audit A3 pass 3).
 */
export function projectNameAvailability({
  projectName,
  projects,
  archivedProjects,
  deletedProjectNames,
  tombstones,
}: Readonly<{
  projectName: string;
  projects: readonly string[];
  archivedProjects: readonly string[];
  deletedProjectNames: readonly string[];
  tombstones: readonly ProjectTombstone[];
}>): ProjectNameAvailability {
  const key = nameKey(projectName);
  const tombstone = tombstones.find(candidate =>
    candidate.entityType === 'project' && nameKey(candidate.recordId) === key);
  if (tombstone) return { kind: 'deleted', deletedAt: tombstone.deletedAt || null };
  if (deletedProjectNames.some(name => nameKey(name) === key)) {
    return { kind: 'deleted', deletedAt: null };
  }
  const archived = archivedProjects.find(name => nameKey(name) === key);
  if (archived) return { kind: 'archived', projectName: archived };
  if (projects.some(name => nameKey(name) === key)) return { kind: 'exists' };
  const documentKey = legacyProjectNameKey(projectName);
  const lookAlike = (names: readonly string[]) =>
    names.filter(name => name.trim() && legacyProjectNameKey(name) === documentKey).map(name => name.trim());
  const active = lookAlike(projects)[0];
  if (active) return { kind: 'similar', projectName: active, source: 'active' };
  const archivedLookAlike = lookAlike(archivedProjects)[0];
  if (archivedLookAlike) return { kind: 'similar', projectName: archivedLookAlike, source: 'archived' };
  // The cloud keeps a deletion record's name in lower case ("lot 5 eats"),
  // and that copy reaches this phone's deleted list too: the name is shown as
  // the owner typed it wherever this phone still has that spelling (audit A3
  // pass 4).
  const deleted = lookAlike([
    ...deletedProjectNames,
    ...tombstones.filter(candidate => candidate.entityType === 'project').map(candidate => candidate.recordId),
  ]);
  if (deleted.length) {
    const typed = deleted.find(name => name !== name.toLowerCase()) || deleted[0];
    return { kind: 'similar', projectName: typed, source: 'deleted' };
  }
  return { kind: 'available' };
}

/**
 * Why a look-alike name is refused. A deleted project shares nothing with the
 * new one, so it is not said to (audit A3 pass 4); an archived look-alike is
 * offered for reopening instead (archivedProjectNameMessage).
 */
export function similarProjectNameMessage(
  projectName: string,
  similarTo: string,
  source: 'active' | 'archived' | 'deleted' = 'active',
): string {
  if (source === 'deleted') {
    return `${projectName} is too close to ${similarTo}, a deleted project. The app compares project names with ` +
      'punctuation and spacing ignored, and a deleted project\'s name cannot be used again yet. Please choose a different name.';
  }
  return `${projectName} is too close to ${similarTo}. The app files documents by project name with ` +
    'punctuation and spacing ignored, so the two projects would share documents. Please choose a different name.';
}

/** The typed name is an archived project's, or looks like one (audit A3 pass 4): Reopen is offered. */
export function archivedProjectNameMessage(projectName: string, archivedName: string): string {
  return nameKey(projectName) === nameKey(archivedName)
    ? `${projectName} is in your archived projects. Reopen it to record updates against it again.`
    : `${projectName} is too close to ${archivedName}, which is in your archived projects. ` +
      `Reopen ${archivedName} to record updates against it again, or choose a different name.`;
}

export function deletedProjectNameMessage(projectName: string, deletedOn: string | null): string {
  return `${projectName} was deleted${deletedOn ? ` on ${deletedOn}` : ''}. ` +
    'A deleted project\'s name cannot be used again yet, because the deletion is still recorded on every device. ' +
    'Use a different name, for example with the year added.';
}

/**
 * Project deletions and reopens still in the offline queue. A reopen done
 * offline must not be re-archived by the cloud's archived list at startup
 * until the queue lands; the operational refresh already honours the queue.
 */
export function queuedProjectNameChanges(queue: readonly QueuedChange[]): {
  deletedNames: string[];
  reopenedKeys: Set<string>;
} {
  const projectChanges = queue.filter(item => item.entity === 'project');
  const payloadOf = (item: QueuedChange) =>
    (item.payload && typeof item.payload === 'object' ? item.payload : {}) as Record<string, unknown>;
  return {
    deletedNames: projectChanges
      .filter(item => item.operation === 'delete')
      .map(item => payloadOf(item).name)
      .filter((name): name is string => typeof name === 'string' && Boolean(name.trim())),
    reopenedKeys: new Set(projectChanges
      .filter(item => item.operation !== 'delete')
      .map(payloadOf)
      .filter(payload => payload.archived === false)
      .map(payload => nameKey(String(payload.previousName || payload.name || '')))
      .filter(Boolean)),
  };
}

function nameKey(value: string): string {
  return value.trim().toLowerCase();
}
