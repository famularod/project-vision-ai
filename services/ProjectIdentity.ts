import * as Crypto from 'expo-crypto';

declare const projectIdBrand: unique symbol;

export type ProjectId = string & { readonly [projectIdBrand]: 'ProjectId' };

export type ProjectIdentityRecord = {
  id: ProjectId;
  name: string;
};

export type ProjectScope =
  | {
      kind: 'project';
      projectId: ProjectId;
      projectName: string;
    }
  | {
      kind: 'portfolio';
      portfolioId: string;
      projectIds: ProjectId[];
    };

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createProjectId(
  randomUUID: () => string = Crypto.randomUUID,
): ProjectId {
  return requireProjectId(randomUUID());
}

export function isProjectId(value: unknown): value is ProjectId {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value.trim());
}

export function requireProjectId(value: unknown): ProjectId {
  if (!isProjectId(value)) {
    throw new Error('A valid immutable project UUID is required.');
  }
  return value.trim().toLowerCase() as ProjectId;
}

export function createProjectIdentity(
  name: string,
  projectId: ProjectId = createProjectId(),
): ProjectIdentityRecord {
  const normalizedName = normalizeProjectDisplayName(name);
  return {
    id: projectId,
    name: normalizedName,
  };
}

export function renameProjectIdentity(
  project: ProjectIdentityRecord,
  nextName: string,
): ProjectIdentityRecord {
  return {
    ...project,
    name: normalizeProjectDisplayName(nextName),
  };
}

export function projectScopeFor(
  project: ProjectIdentityRecord,
): Extract<ProjectScope, { kind: 'project' }> {
  return {
    kind: 'project',
    projectId: project.id,
    projectName: project.name,
  };
}

export function portfolioScopeFor(
  portfolioId: string,
  projectIds: ProjectId[],
): Extract<ProjectScope, { kind: 'portfolio' }> {
  const normalizedPortfolioId = portfolioId.trim();
  if (!normalizedPortfolioId) {
    throw new Error('A portfolio scope requires an immutable portfolio identifier.');
  }

  return {
    kind: 'portfolio',
    portfolioId: normalizedPortfolioId,
    projectIds: Array.from(new Set(projectIds)),
  };
}

export function scopeContainsProject(
  scope: ProjectScope,
  projectId: ProjectId,
): boolean {
  return scope.kind === 'project'
    ? scope.projectId === projectId
    : scope.projectIds.includes(projectId);
}

export function projectIdForPersistence(scope: ProjectScope): ProjectId | null {
  return scope.kind === 'project' ? scope.projectId : null;
}

export function requireProjectPersistenceScope(scope: ProjectScope): ProjectId {
  const projectId = projectIdForPersistence(scope);
  if (!projectId) {
    throw new Error('Portfolio authority cannot be persisted as a project record.');
  }
  return projectId;
}

function normalizeProjectDisplayName(value: string): string {
  const name = value.trim();
  if (!name) {
    throw new Error('A project display name is required.');
  }
  return name;
}
