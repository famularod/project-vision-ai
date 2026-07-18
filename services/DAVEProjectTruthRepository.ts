import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DAVEProjectTruth } from './DAVEProjectTruth';
import {
  loadLatestDAVEProjectTruthSnapshotCloud,
  saveDAVEProjectTruthSnapshotCloud,
} from './SupabaseService';

export const DAVE_PROJECT_TRUTH_REPOSITORY_VERSION =
  'dave-project-truth-repository/1.0' as const;
export const DAVE_PROJECT_TRUTH_STORAGE_KEY = '@dave/project-truth-snapshots/v1';

const MAX_SNAPSHOTS_PER_PROJECT = 20;
let projectTruthSaveTail: Promise<void> = Promise.resolve();

export type DAVEProjectTruthSnapshot = Readonly<{
  repositoryVersion: typeof DAVE_PROJECT_TRUTH_REPOSITORY_VERSION;
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  revision: number;
  sourceFingerprint: string;
  truthSchemaVersion: DAVEProjectTruth['schemaVersion'];
  generatedAt: string;
  savedAt: string;
  truth: DAVEProjectTruth;
}>;

export type DAVEProjectTruthSaveResult = Readonly<{
  snapshot: DAVEProjectTruthSnapshot;
  created: boolean;
  cloudStatus: 'saved' | 'local_only' | 'failed';
}>;

export type DAVEProjectTruthStorage = Pick<
  typeof AsyncStorage,
  'getItem' | 'setItem' | 'removeItem'
>;

export type DAVEProjectTruthRepository = Readonly<{
  save(
    organizationId: string,
    truth: DAVEProjectTruth,
  ): Promise<DAVEProjectTruthSaveResult>;
  loadLatest(
    organizationId: string,
    projectId: string,
  ): Promise<DAVEProjectTruthSnapshot | null>;
  list(
    organizationId: string,
    projectId?: string,
  ): Promise<readonly DAVEProjectTruthSnapshot[]>;
}>;

type StoredTruthSnapshots = Readonly<{
  repositoryVersion: typeof DAVE_PROJECT_TRUTH_REPOSITORY_VERSION;
  snapshots: readonly DAVEProjectTruthSnapshot[];
}>;

export function createDAVEProjectTruthRepository({
  storage = AsyncStorage,
  cloudEnabled = false,
  identityTrusted = false,
}: {
  storage?: DAVEProjectTruthStorage;
  cloudEnabled?: boolean;
  identityTrusted?: boolean;
} = {}): DAVEProjectTruthRepository {
  const useCloud = Boolean(cloudEnabled && identityTrusted);

  async function write(snapshots: readonly DAVEProjectTruthSnapshot[]) {
    const envelope: StoredTruthSnapshots = {
      repositoryVersion: DAVE_PROJECT_TRUTH_REPOSITORY_VERSION,
      snapshots,
    };
    await storage.setItem(DAVE_PROJECT_TRUTH_STORAGE_KEY, JSON.stringify(envelope));
  }

  async function list(organizationId: string, projectId?: string) {
    const owner = required(organizationId, 'Organization ID');
    const project = optional(projectId);
    const snapshots = await hydrate(storage, write);
    return Object.freeze(snapshots
      .filter(snapshot =>
        snapshot.organizationId === owner &&
        (!project || snapshot.projectId === project),
      )
      .sort(compareSnapshots));
  }

  async function storeSnapshot(snapshot: DAVEProjectTruthSnapshot) {
    const all = await hydrate(storage, write);
    const withoutSameId = all.filter(item => item.id !== snapshot.id);
    const sameProject = [snapshot, ...withoutSameId.filter(item =>
      item.organizationId === snapshot.organizationId &&
      item.projectId === snapshot.projectId,
    )]
      .sort(compareSnapshots)
      .slice(0, MAX_SNAPSHOTS_PER_PROJECT);
    const otherProjects = withoutSameId.filter(item =>
      item.organizationId !== snapshot.organizationId ||
      item.projectId !== snapshot.projectId,
    );
    await write([...sameProject, ...otherProjects].sort(compareSnapshots));
  }

  async function persistSnapshotCloud(
    initialSnapshot: DAVEProjectTruthSnapshot,
    created: boolean,
  ): Promise<DAVEProjectTruthSaveResult> {
    let candidate = initialSnapshot;
    let createdRevision = created;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const cloud = await saveDAVEProjectTruthSnapshotCloud(candidate);
      if (cloud.ok && cloud.data) {
        const accepted = normalizeSnapshot(cloud.data);
        assertSnapshotBoundary(accepted, candidate.organizationId, candidate.projectId);
        await storeSnapshot(accepted);
        return { snapshot: accepted, created: createdRevision, cloudStatus: 'saved' };
      }

      if (cloud.status !== 409 && cloud.code !== 'truth_revision_conflict') {
        return { snapshot: candidate, created: createdRevision, cloudStatus: 'failed' };
      }

      const latest = await loadLatestDAVEProjectTruthSnapshotCloud(
        candidate.organizationId,
        candidate.projectId,
      );
      if (!latest.ok || !latest.data) {
        return { snapshot: candidate, created: createdRevision, cloudStatus: 'failed' };
      }
      const cloudHead = normalizeSnapshot(latest.data);
      assertSnapshotBoundary(cloudHead, candidate.organizationId, candidate.projectId);
      await storeSnapshot(cloudHead);
      if (
        fingerprintDAVEProjectTruth(cloudHead.truth) ===
        fingerprintDAVEProjectTruth(candidate.truth)
      ) {
        return { snapshot: cloudHead, created: false, cloudStatus: 'saved' };
      }

      const revision = cloudHead.revision + 1;
      const savedAt = new Date().toISOString();
      const sourceFingerprint = fingerprintDAVEProjectTruth(candidate.truth);
      candidate = deepFreeze({
        ...candidate,
        id: truthSnapshotId(
          candidate.organizationId,
          candidate.projectId,
          revision,
          sourceFingerprint,
        ),
        revision,
        sourceFingerprint,
        savedAt,
      });
      createdRevision = true;
      await storeSnapshot(candidate);
    }

    return { snapshot: candidate, created: createdRevision, cloudStatus: 'failed' };
  }

  return Object.freeze({
    async save(organizationId, truth) {
      const owner = required(organizationId, 'Organization ID');
      validateTruthBoundary(truth);
      return serializeProjectTruthSave(owner, truth.projectId, async () => {
        let current = (await list(owner, truth.projectId))[0] || null;
        if (!current && useCloud) {
          const cloud = await loadLatestDAVEProjectTruthSnapshotCloud(owner, truth.projectId);
          if (cloud.ok && cloud.data) {
            const recovered = normalizeSnapshot(cloud.data);
            assertSnapshotBoundary(recovered, owner, truth.projectId);
            await storeSnapshot(recovered);
            current = recovered;
          }
        }
        const sourceFingerprint = fingerprintDAVEProjectTruth(truth);
        let snapshot = current;
        let created = false;

        if (
          !current ||
          fingerprintDAVEProjectTruth(current.truth) !== sourceFingerprint
        ) {
          const revision = (current?.revision || 0) + 1;
          const savedAt = new Date().toISOString();
          snapshot = deepFreeze({
            repositoryVersion: DAVE_PROJECT_TRUTH_REPOSITORY_VERSION,
            id: truthSnapshotId(owner, truth.projectId, revision, sourceFingerprint),
            organizationId: owner,
            projectId: truth.projectId,
            projectName: truth.projectName,
            revision,
            sourceFingerprint,
            truthSchemaVersion: truth.schemaVersion,
            generatedAt: truth.generatedAt,
            savedAt,
            truth,
          });
          await storeSnapshot(snapshot);
          created = true;
        }

        if (!snapshot) throw new Error('Project Truth snapshot could not be created.');
        if (!useCloud) {
          return { snapshot, created, cloudStatus: 'local_only' };
        }

        return persistSnapshotCloud(snapshot, created);
      });
    },

    async loadLatest(organizationId, projectId) {
      const owner = required(organizationId, 'Organization ID');
      const project = required(projectId, 'Project ID');

      return serializeProjectTruthSave(owner, project, async () => {
        if (useCloud) {
          const cloud = await loadLatestDAVEProjectTruthSnapshotCloud(owner, project);
          if (cloud.ok && cloud.data) {
            const snapshot = normalizeSnapshot(cloud.data);
            assertSnapshotBoundary(snapshot, owner, project);
            await storeSnapshot(snapshot);
            return snapshot;
          }
        }

        return (await list(owner, project))[0] || null;
      });
    },

    list,
  });
}

function serializeProjectTruthSave<T>(
  _organizationId: string,
  _projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const result = projectTruthSaveTail.then(operation, operation);
  projectTruthSaveTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function fingerprintDAVEProjectTruth(truth: DAVEProjectTruth): string {
  validateTruthBoundary(truth);
  const authoritativeContent = {
    schemaVersion: truth.schemaVersion,
    projectId: truth.projectId,
    projectName: truth.projectName,
    evidence: truth.evidence.records,
    entityLinks: truth.entityLinks,
    photoComparisons: truth.photoComparisons,
    correlations: truth.correlations,
    reasoning: truth.reasoning,
    schedule: truth.schedule,
    verificationQueue: truth.verificationQueue,
    briefing: truth.briefing,
  };
  return stableHash(stableStringify(withoutVolatileGeneratedAt(authoritativeContent)));
}

function legacyFingerprintDAVEProjectTruth(truth: DAVEProjectTruth): string {
  const authoritativeContent = {
    schemaVersion: truth.schemaVersion,
    projectId: truth.projectId,
    projectName: truth.projectName,
    asOfDay: truth.generatedAt.slice(0, 10),
    evidence: truth.evidence.records,
    entityLinks: truth.entityLinks,
    photoComparisons: truth.photoComparisons,
    correlations: truth.correlations,
    reasoning: truth.reasoning,
    schedule: truth.schedule,
    verificationQueue: truth.verificationQueue,
    briefing: truth.briefing,
  };
  return stableHash(stableStringify(authoritativeContent));
}

async function hydrate(
  storage: DAVEProjectTruthStorage,
  write: (snapshots: readonly DAVEProjectTruthSnapshot[]) => Promise<void>,
): Promise<DAVEProjectTruthSnapshot[]> {
  const raw = await storage.getItem(DAVE_PROJECT_TRUTH_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.repositoryVersion !== DAVE_PROJECT_TRUTH_REPOSITORY_VERSION ||
      !Array.isArray(parsed.snapshots)
    ) {
      throw new Error('Stored Project Truth envelope is invalid.');
    }
    const snapshots: DAVEProjectTruthSnapshot[] = [];
    let recovered = false;
    for (const value of parsed.snapshots) {
      try {
        const snapshot = normalizeSnapshot(value);
        if (snapshots.some(item => item.id === snapshot.id)) {
          recovered = true;
          continue;
        }
        snapshots.push(snapshot);
      } catch {
        recovered = true;
      }
    }
    const sorted = snapshots.sort(compareSnapshots);
    if (recovered) await write(sorted);
    return sorted;
  } catch {
    await storage.removeItem(DAVE_PROJECT_TRUTH_STORAGE_KEY);
    return [];
  }
}

function normalizeSnapshot(value: unknown): DAVEProjectTruthSnapshot {
  if (!isRecord(value) || !isRecord(value.truth)) {
    throw new Error('Project Truth snapshot is invalid.');
  }
  const truth = value.truth as unknown as DAVEProjectTruth;
  validateTruthBoundary(truth);
  const snapshot = {
    repositoryVersion: value.repositoryVersion,
    id: required(value.id, 'Snapshot ID'),
    organizationId: required(value.organizationId, 'Organization ID'),
    projectId: required(value.projectId, 'Project ID'),
    projectName: required(value.projectName, 'Project name'),
    revision: positiveInteger(value.revision, 'Truth revision'),
    sourceFingerprint: required(value.sourceFingerprint, 'Source fingerprint'),
    truthSchemaVersion: value.truthSchemaVersion,
    generatedAt: validTimestamp(value.generatedAt, 'Truth generation time'),
    savedAt: validTimestamp(value.savedAt, 'Truth save time'),
    truth,
  } as DAVEProjectTruthSnapshot;
  if (
    snapshot.repositoryVersion !== DAVE_PROJECT_TRUTH_REPOSITORY_VERSION ||
    snapshot.truthSchemaVersion !== truth.schemaVersion ||
    snapshot.projectId !== truth.projectId ||
    snapshot.projectName !== truth.projectName ||
    ![
      fingerprintDAVEProjectTruth(truth),
      legacyFingerprintDAVEProjectTruth(truth),
    ].includes(snapshot.sourceFingerprint)
  ) {
    throw new Error('Project Truth snapshot boundary is invalid.');
  }
  return deepFreeze(snapshot);
}

function validateTruthBoundary(truth: DAVEProjectTruth) {
  if (!truth || !required(truth.projectId, 'Project ID')) {
    throw new Error('Project Truth project boundary is invalid.');
  }
  required(truth.projectName, 'Project name');
  validTimestamp(truth.generatedAt, 'Truth generation time');
  if (!Array.isArray(truth.evidence?.records) || !Array.isArray(truth.schedule)) {
    throw new Error('Project Truth authoritative content is invalid.');
  }
}

function assertSnapshotBoundary(
  snapshot: DAVEProjectTruthSnapshot,
  organizationId: string,
  projectId: string,
) {
  if (snapshot.organizationId !== organizationId || snapshot.projectId !== projectId) {
    throw new Error('Cloud Project Truth belongs to a different owner or project.');
  }
}

function truthSnapshotId(
  organizationId: string,
  projectId: string,
  revision: number,
  fingerprint: string,
) {
  return `dave-truth:${stableHash(organizationId)}:${stableHash(projectId)}:${revision}:${fingerprint}`;
}

function compareSnapshots(a: DAVEProjectTruthSnapshot, b: DAVEProjectTruthSnapshot) {
  return b.revision - a.revision || b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id);
}

function withoutVolatileGeneratedAt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatileGeneratedAt);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'generatedAt')
        .map(([key, child]) => [key, withoutVolatileGeneratedAt(child)]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function required(value: unknown, label: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function optional(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function positiveInteger(value: unknown, label: string) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} is invalid.`);
  return number;
}

function validTimestamp(value: unknown, label: string) {
  const text = required(value, label);
  if (!Number.isFinite(new Date(text).getTime())) throw new Error(`${label} is invalid.`);
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export const localDAVEProjectTruthRepository = createDAVEProjectTruthRepository();
