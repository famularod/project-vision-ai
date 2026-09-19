export type OperationalProjectIdentity = Readonly<{
  id: string;
  name: string;
}>;

export type OperationalProjectIdentityAuthority = Readonly<{
  byId: ReadonlyMap<string, OperationalProjectIdentity>;
  byNormalizedName: ReadonlyMap<string, readonly OperationalProjectIdentity[]>;
}>;

export type OperationalProjectIdentityResult =
  | Readonly<{ ok: true; identity: OperationalProjectIdentity }>
  | Readonly<{
      ok: false;
      code:
        | 'project_identity_required'
        | 'project_identity_invalid'
        | 'project_identity_mismatch'
        | 'project_identity_ambiguous';
      error: string;
    }>;

export type OperationalReferenceDocumentScope = Readonly<{
  projectId: string | null;
  projectName: string | null;
  projectNames: readonly string[];
}>;

export type OperationalReferenceDocumentScopeResult =
  | Readonly<{ ok: true; scope: OperationalReferenceDocumentScope }>
  | Exclude<OperationalProjectIdentityResult, { ok: true }>;

type CloudProjectIdentityInput = Readonly<{
  id?: string | null;
  name: string;
}>;

type OperationalRecordIdentityInput = Readonly<{
  projectId?: string | null;
  projectName?: string | null;
}>;

type OperationalReferenceDocumentScopeInput = OperationalRecordIdentityInput & Readonly<{
  projectNames?: readonly string[] | null;
}>;

const EXACT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function buildOperationalProjectIdentityAuthority(
  projects: readonly CloudProjectIdentityInput[],
): OperationalProjectIdentityAuthority {
  const byId = new Map<string, OperationalProjectIdentity>();
  const byNormalizedName = new Map<string, OperationalProjectIdentity[]>();

  projects.forEach(project => {
    const id = exactProjectId(project.id);
    const name = project.name.trim();
    if (!id || !name) return;
    const identity = { id, name };
    byId.set(id, identity);
    const normalizedName = normalizeProjectName(name);
    const matches = byNormalizedName.get(normalizedName) || [];
    matches.push(identity);
    byNormalizedName.set(normalizedName, matches);
  });

  return { byId, byNormalizedName };
}

export function resolveOperationalProjectIdentity(
  record: OperationalRecordIdentityInput,
  authority: OperationalProjectIdentityAuthority,
): OperationalProjectIdentityResult {
  const projectName = record.projectName?.trim() || '';
  const suppliedProjectId = record.projectId;

  if (suppliedProjectId !== undefined && suppliedProjectId !== null) {
    const projectId = exactProjectId(suppliedProjectId);
    if (!projectId) {
      return failure(
        'project_identity_invalid',
        'The saved item has an invalid cloud project identity and was preserved for review.',
      );
    }
    const identity = authority.byId.get(projectId);
    if (!identity) {
      return failure(
        'project_identity_invalid',
        'The saved item no longer matches an active cloud project and was preserved for review.',
      );
    }
    if (
      projectName &&
      normalizeProjectName(projectName) !== normalizeProjectName(identity.name)
    ) {
      return failure(
        'project_identity_mismatch',
        'The saved item project name and cloud identity disagree, so it was not uploaded.',
      );
    }
    return { ok: true, identity };
  }

  if (!projectName) {
    return failure(
      'project_identity_required',
      'The saved item does not identify its project and was preserved for review.',
    );
  }

  const matches = authority.byNormalizedName.get(normalizeProjectName(projectName)) || [];
  if (matches.length === 0) {
    return failure(
      'project_identity_required',
      `The cloud project “${projectName}” could not be found. The saved item was preserved.`,
    );
  }
  if (matches.length !== 1) {
    return failure(
      'project_identity_ambiguous',
      `More than one cloud project is named “${projectName}”. The saved item was preserved for review.`,
    );
  }
  return { ok: true, identity: matches[0] };
}

/**
 * Reference documents may intentionally cover more than one active project.
 * Validate every named project without inventing a single primary project for
 * a shared record. Single-project documents retain the ordinary operational
 * identity contract above.
 */
export function resolveOperationalReferenceDocumentScope(
  record: OperationalReferenceDocumentScopeInput,
  authority: OperationalProjectIdentityAuthority,
): OperationalReferenceDocumentScopeResult {
  const hasSingleIdentity = Boolean(
    record.projectId !== undefined && record.projectId !== null ||
    record.projectName?.trim(),
  );
  const singleIdentity = hasSingleIdentity
    ? resolveOperationalProjectIdentity(record, authority)
    : null;
  if (singleIdentity && !singleIdentity.ok) return singleIdentity;

  const suppliedNames = Array.isArray(record.projectNames)
    ? record.projectNames
      .map(name => typeof name === 'string' ? name.trim() : '')
      .filter(Boolean)
    : [];
  const uniqueNames = suppliedNames.filter((name, index) =>
    suppliedNames.findIndex(candidate =>
      normalizeProjectName(candidate) === normalizeProjectName(name),
    ) === index,
  );

  if (uniqueNames.length === 0) {
    if (!singleIdentity?.ok) {
      return failure(
        'project_identity_required',
        'The saved document does not identify any active project and was preserved for review.',
      );
    }
    return {
      ok: true,
      scope: {
        projectId: singleIdentity.identity.id,
        projectName: singleIdentity.identity.name,
        projectNames: [singleIdentity.identity.name],
      },
    };
  }

  const identities: OperationalProjectIdentity[] = [];
  for (const projectName of uniqueNames) {
    const matches = authority.byNormalizedName.get(normalizeProjectName(projectName)) || [];
    if (matches.length === 0) {
      return failure(
        'project_identity_required',
        `The cloud project “${projectName}” could not be found. The saved document was preserved.`,
      );
    }
    if (matches.length !== 1) {
      return failure(
        'project_identity_ambiguous',
        `More than one cloud project is named “${projectName}”. The saved document was preserved for review.`,
      );
    }
    identities.push(matches[0]);
  }

  if (
    singleIdentity?.ok &&
    !identities.some(identity => identity.id === singleIdentity.identity.id)
  ) {
    return failure(
      'project_identity_mismatch',
      'The saved document project identity is not included in its project list, so it was not uploaded.',
    );
  }

  if (identities.length === 1) {
    return {
      ok: true,
      scope: {
        projectId: singleIdentity?.ok
          ? singleIdentity.identity.id
          : identities[0].id,
        projectName: singleIdentity?.ok
          ? singleIdentity.identity.name
          : identities[0].name,
        projectNames: [identities[0].name],
      },
    };
  }

  return {
    ok: true,
    scope: {
      projectId: singleIdentity?.ok ? singleIdentity.identity.id : null,
      projectName: singleIdentity?.ok ? singleIdentity.identity.name : null,
      projectNames: identities.map(identity => identity.name),
    },
  };
}

export function exactProjectId(value: unknown): string | null {
  return typeof value === 'string' && value === value.trim() && EXACT_UUID_PATTERN.test(value)
    ? value
    : null;
}

function normalizeProjectName(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function failure(
  code: Exclude<OperationalProjectIdentityResult, { ok: true }>['code'],
  error: string,
): Extract<OperationalProjectIdentityResult, { ok: false }> {
  return { ok: false, code, error };
}
