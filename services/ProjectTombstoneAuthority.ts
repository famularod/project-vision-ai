const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProjectTombstoneRecord = Readonly<{
  id?: string | null;
  name: string;
}>;

export type ProjectTombstoneAuthority = 'exact_id' | 'legacy_name' | 'ambiguous';

export function normalizedProjectAuthorityKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isCanonicalProjectId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value.trim());
}

/**
 * Current project tombstones contain immutable UUIDs. Older releases stored a
 * display name in recordId. A non-UUID value is treated as an exact ID when it
 * is still present in the supplied project authority; otherwise it is an
 * unmistakable legacy name barrier.
 */
export function projectTombstoneUsesExactId(
  recordId: unknown,
  knownProjects: readonly ProjectTombstoneRecord[],
): boolean {
  return resolveProjectTombstoneAuthority(recordId, knownProjects) === 'exact_id';
}

export function resolveProjectTombstoneAuthority(
  recordId: unknown,
  knownProjects: readonly ProjectTombstoneRecord[],
): ProjectTombstoneAuthority {
  const tombstoneKey = normalizedProjectAuthorityKey(recordId);
  if (!tombstoneKey) return 'legacy_name';
  const idMatches = knownProjects.filter(project =>
    normalizedProjectAuthorityKey(project.id) === tombstoneKey
  );
  const nameMatches = knownProjects.filter(project =>
    normalizedProjectAuthorityKey(project.name) === tombstoneKey
  );
  if (idMatches.length === 1 && nameMatches.length === 0) return 'exact_id';
  if (idMatches.length > 0) return 'ambiguous';
  return 'legacy_name';
}

export function projectTombstoneMatchesRecord(
  recordId: unknown,
  project: ProjectTombstoneRecord,
  knownProjects: readonly ProjectTombstoneRecord[],
): boolean {
  const tombstoneKey = normalizedProjectAuthorityKey(recordId);
  if (!tombstoneKey) return false;
  const authority = resolveProjectTombstoneAuthority(recordId, knownProjects);
  if (authority === 'ambiguous') return false;
  if (authority === 'exact_id') {
    return normalizedProjectAuthorityKey(project.id) === tombstoneKey;
  }
  return normalizedProjectAuthorityKey(project.name) === tombstoneKey;
}
