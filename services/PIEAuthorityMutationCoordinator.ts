const scopeMutationTails = new Map<string, Promise<void>>();

/**
 * Serializes the full durable PIE authority pipeline for one organization and
 * project. A stale build may finish first, but a newer generation always runs
 * after it and therefore owns the final durable model and judgment state.
 */
export function runExclusivePIEAuthorityMutation<T>(
  organizationId: string,
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const scopeKey = authorityMutationScopeKey(organizationId, projectId);
  const predecessor = (scopeMutationTails.get(scopeKey) || Promise.resolve())
    .catch(() => undefined);
  let release: () => void = () => undefined;
  const completion = new Promise<void>(resolve => { release = resolve; });
  scopeMutationTails.set(scopeKey, completion);

  const result = predecessor.then(operation);
  result.finally(() => {
    release();
    if (scopeMutationTails.get(scopeKey) === completion) {
      scopeMutationTails.delete(scopeKey);
    }
  }).catch(() => undefined);
  return result;
}

export function authorityMutationScopeKey(
  organizationId: string,
  projectId: string,
): string {
  const organization = organizationId.trim();
  const project = projectId.trim();
  if (!organization || !project) {
    throw new Error('DAVE authority persistence requires an exact organization and project scope.');
  }
  return `${organization.length}:${organization}|${project.length}:${project}`;
}
