export const DAVE_PROJECT_WALK_SESSION_VERSION =
  'dave-project-walk-session/1.0' as const;

export type DAVEProjectWalkSessionStatus = 'active' | 'completed' | 'cancelled';

export type DAVEProjectWalkSession = Readonly<{
  schemaVersion: typeof DAVE_PROJECT_WALK_SESSION_VERSION;
  id: string;
  projectName: string;
  status: DAVEProjectWalkSessionStatus;
  memoryIds: readonly string[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
}>;

export function startDAVEProjectWalkSession({
  id,
  projectName,
  startedAt,
}: {
  id: string;
  projectName: string;
  startedAt: string;
}): DAVEProjectWalkSession {
  return normalizeDAVEProjectWalkSession({
    schemaVersion: DAVE_PROJECT_WALK_SESSION_VERSION,
    id,
    projectName,
    status: 'active',
    memoryIds: [],
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    cancelledAt: null,
  });
}

export function addMemoryToDAVEProjectWalkSession(
  session: DAVEProjectWalkSession,
  memoryId: string,
  updatedAt: string,
) {
  assertActive(session);
  const stableMemoryId = required(memoryId, 'Memory ID');
  if (session.memoryIds.includes(stableMemoryId)) return session;
  return normalizeDAVEProjectWalkSession({
    ...session,
    memoryIds: [...session.memoryIds, stableMemoryId],
    updatedAt,
  });
}

export function removeMemoryFromDAVEProjectWalkSession(
  session: DAVEProjectWalkSession,
  memoryId: string,
  updatedAt: string,
) {
  assertActive(session);
  const stableMemoryId = required(memoryId, 'Memory ID');
  if (!session.memoryIds.includes(stableMemoryId)) return session;
  return normalizeDAVEProjectWalkSession({
    ...session,
    memoryIds: session.memoryIds.filter(id => id !== stableMemoryId),
    updatedAt,
  });
}

export function completeDAVEProjectWalkSession(
  session: DAVEProjectWalkSession,
  completedAt: string,
) {
  assertActive(session);
  if (session.memoryIds.length === 0) {
    throw new Error('Capture at least one observation before finishing the walk.');
  }
  return normalizeDAVEProjectWalkSession({
    ...session,
    status: 'completed',
    updatedAt: completedAt,
    completedAt,
  });
}

export function cancelDAVEProjectWalkSession(
  session: DAVEProjectWalkSession,
  cancelledAt: string,
) {
  assertActive(session);
  return normalizeDAVEProjectWalkSession({
    ...session,
    status: 'cancelled',
    updatedAt: cancelledAt,
    cancelledAt,
  });
}

export function normalizeDAVEProjectWalkSession(value: unknown): DAVEProjectWalkSession {
  if (!isRecord(value) || value.schemaVersion !== DAVE_PROJECT_WALK_SESSION_VERSION) {
    throw new Error('Project Walk session is invalid.');
  }
  const status = value.status;
  if (status !== 'active' && status !== 'completed' && status !== 'cancelled') {
    throw new Error('Project Walk session status is invalid.');
  }
  if (!Array.isArray(value.memoryIds) || !value.memoryIds.every(item => typeof item === 'string')) {
    throw new Error('Project Walk session memory links are invalid.');
  }
  const completedAt = optionalTimestamp(value.completedAt);
  const cancelledAt = optionalTimestamp(value.cancelledAt);
  if (
    (status === 'active' && (completedAt || cancelledAt)) ||
    (status === 'completed' && (!completedAt || cancelledAt)) ||
    (status === 'cancelled' && (!cancelledAt || completedAt))
  ) {
    throw new Error('Project Walk session lifecycle is inconsistent.');
  }
  return deepFreeze({
    schemaVersion: value.schemaVersion,
    id: required(value.id, 'Session ID'),
    projectName: required(value.projectName, 'Project name'),
    status,
    memoryIds: uniqueIds(value.memoryIds),
    startedAt: timestamp(value.startedAt, 'Started timestamp'),
    updatedAt: timestamp(value.updatedAt, 'Updated timestamp'),
    completedAt,
    cancelledAt,
  });
}

function uniqueIds(values: readonly string[]) {
  const seen = new Set<string>();
  return values.map(value => required(value, 'Memory ID')).filter(value => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function assertActive(session: DAVEProjectWalkSession) {
  if (session.status !== 'active') {
    throw new Error('Only an active Project Walk session can be changed.');
  }
}

function timestamp(value: unknown, label: string) {
  const text = required(value, label);
  if (!Number.isFinite(new Date(text).getTime())) throw new Error(`${label} is invalid.`);
  return text;
}

function optionalTimestamp(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  return timestamp(value, 'Lifecycle timestamp');
}

function required(value: unknown, label: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  Object.values(objectValue).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}
