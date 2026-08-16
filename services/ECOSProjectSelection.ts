import type { ProjectRecord } from './ProjectCoverPhotoService';

export type ECOSProjectSelection = Readonly<{
  id: string;
  name: string;
}>;

export type ECOSProjectSelectionOption = ECOSProjectSelection & Readonly<{
  label: string;
}>;

/**
 * Resolves one immutable project record. Display-name lookup is allowed only
 * when it is unambiguous; an exact ID never falls back to another same-name row.
 */
export function resolveECOSProjectSelection({
  projectId,
  projectName,
  projectRecords,
}: Readonly<{
  projectId: string | null | undefined;
  projectName: string | null | undefined;
  projectRecords: readonly ProjectRecord[];
}>): ECOSProjectSelection | null {
  const projectIdWasSupplied = projectId !== null && projectId !== undefined && projectId !== '';
  const exactId = exactProjectId(projectId);
  const normalizedName = normalizeProjectDisplayName(projectName);
  if (projectIdWasSupplied && !exactId) return null;
  if (exactId) {
    const matches = projectRecords.filter(record => exactProjectId(record.id) === exactId);
    if (matches.length !== 1) return null;
    const recordName = recordProjectName(matches[0]);
    if (!recordName || (normalizedName && normalizeProjectDisplayName(recordName) !== normalizedName)) {
      return null;
    }
    return Object.freeze({ id: exactId, name: recordName });
  }
  if (!normalizedName) return null;
  const matchingRecords = projectRecords.filter(record => {
    const name = recordProjectName(record);
    return Boolean(name && normalizeProjectDisplayName(name) === normalizedName);
  });
  if (matchingRecords.length !== 1) return null;
  const matches = matchingRecords.flatMap(record => {
    const id = exactProjectId(record.id);
    const name = recordProjectName(record);
    return id && name ? [{ id, name }] : [];
  });
  return matches.length === 1 ? Object.freeze(matches[0]) : null;
}

export function buildECOSProjectSelectionOptions({
  projectRecords,
  candidateProjectNames,
}: Readonly<{
  projectRecords: readonly ProjectRecord[];
  candidateProjectNames: readonly string[];
}>): readonly ECOSProjectSelectionOption[] {
  const candidateNames = new Set(candidateProjectNames.map(normalizeProjectDisplayName).filter(Boolean));
  const selections = projectRecords.flatMap(record => {
    const id = exactProjectId(record.id);
    const name = recordProjectName(record);
    if (!id || !name || (candidateNames.size > 0 && !candidateNames.has(normalizeProjectDisplayName(name)))) {
      return [];
    }
    return [{ id, name }];
  });
  const counts = new Map<string, number>();
  for (const selection of selections) {
    const key = normalizeProjectDisplayName(selection.name);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.freeze(selections.map(selection => Object.freeze({
    ...selection,
    label: (counts.get(normalizeProjectDisplayName(selection.name)) || 0) > 1
      ? `${selection.name} (${selection.id})`
      : selection.name,
  })));
}

export function sameECOSProjectSelection(
  left: ECOSProjectSelection | null,
  right: ECOSProjectSelection | null,
) {
  return left?.id === right?.id &&
    normalizeProjectDisplayName(left?.name) === normalizeProjectDisplayName(right?.name);
}

export function normalizeProjectDisplayName(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase().replace(/\s+/g, ' ') : '';
}

function exactProjectId(value: string | null | undefined) {
  return typeof value === 'string' && value.length > 0 && value === value.trim() ? value : null;
}

function recordProjectName(record: ProjectRecord) {
  return typeof record.name === 'string' && record.name.trim() ? record.name.trim() : null;
}
