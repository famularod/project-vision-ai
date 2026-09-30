import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DAVEProjectTruth } from './DAVEProjectTruth';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';
import {
  loadLatestDAVEProjectTruthSnapshotCloud,
  saveDAVEProjectTruthSnapshotCloud,
} from './SupabaseService';

export const DAVE_PROJECT_TRUTH_REPOSITORY_VERSION =
  'dave-project-truth-repository/1.0' as const;
export const DAVE_PROJECT_TRUTH_STORAGE_KEY = '@dave/project-truth-snapshots/v1';
export const DAVE_PROJECT_TRUTH_QUARANTINE_KEY_PREFIX =
  `${DAVE_PROJECT_TRUTH_STORAGE_KEY}.corrupt.`;

// Audit round 2 M1b: 3, not 20. Nothing reads older local history (the cloud
// keeps it), and every snapshot is 0.3-2 MB in one shared storage key, so 20
// made each save rewrite tens of MB.
const MAX_SNAPSHOTS_PER_PROJECT = 3;
let projectTruthSaveTail: Promise<void> = Promise.resolve();
// Snapshots the cloud confirmed during this app session. Only these may skip
// the upload: a snapshot never confirmed (saved offline, or the upload failed)
// is always sent again, which is how an offline save reaches the cloud.
const cloudConfirmedSnapshots = new Set<string>();
const MAX_CLOUD_CONFIRMED_SNAPSHOTS = 200;
// Each project's newest stored snapshot this app session, per storage, by
// owner and project, without its truth (A10 pass 2 F2). A save whose Project
// Truth has the same fingerprint returns before reading the storage key,
// which holds every project's snapshots and was re-read and re-checked in
// full on every save (after each typing pause, sync and project switch).
type StoredHead = Readonly<{
  fingerprint: string;
  snapshot: Omit<DAVEProjectTruthSnapshot, 'truth'>;
}>;
const storedHeads = new WeakMap<object, Map<string, StoredHead>>();
// A built Project Truth is frozen, so its fingerprint never changes: the
// provider saves the same truth again whenever the Core refreshes.
const frozenTruthFingerprints = new WeakMap<object, string>();
// Snapshots read whose stored fingerprint is the current format: comparing
// with it needs no second walk of the truth.
const currentFormatSnapshots = new WeakSet<object>();

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
    await storage.setItem(
      DAVE_PROJECT_TRUTH_STORAGE_KEY,
      serializeTruthSnapshots(snapshots),
    );
  }

  function heads() {
    let map = storedHeads.get(storage);
    if (!map) {
      map = new Map();
      storedHeads.set(storage, map);
    }
    return map;
  }

  function rememberStoredHead(head: DAVEProjectTruthSnapshot, fingerprint = head.sourceFingerprint) {
    const { truth: _truth, ...snapshot } = head;
    heads().set(headKey(head.organizationId, head.projectId), { fingerprint, snapshot });
  }

  async function list(organizationId: string, projectId?: string) {
    const owner = required(organizationId, 'Organization ID');
    const project = optional(projectId);
    const snapshots = await hydrate(storage, project ? { owner, projectId: project } : null);
    return Object.freeze(snapshots
      .filter(snapshot =>
        snapshot.organizationId === owner &&
        (!project || snapshot.projectId === project),
      )
      .sort(compareSnapshots));
  }

  async function storeSnapshot(
    snapshot: DAVEProjectTruthSnapshot,
    // Snapshots this same queued operation just read, so one save does not
    // parse and validate the whole key twice.
    alreadyRead?: readonly DAVEProjectTruthSnapshot[],
  ) {
    const all = alreadyRead || await hydrate(storage, {
      owner: snapshot.organizationId,
      projectId: snapshot.projectId,
    });
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
    rememberStoredHead(sameProject[0]);
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
        // The cloud holds exactly this snapshot, which is already stored on
        // this device: no need to validate its copy and rewrite the key.
        if (isSameSnapshot(cloud.data, candidate)) {
          rememberCloudConfirmed(candidate);
          return { snapshot: candidate, created: createdRevision, cloudStatus: 'saved' };
        }
        const accepted = normalizeSnapshot(cloud.data);
        assertSnapshotBoundary(accepted, candidate.organizationId, candidate.projectId);
        await storeSnapshot(accepted);
        rememberCloudConfirmed(accepted);
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
        rememberCloudConfirmed(cloudHead);
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
        const sourceFingerprint = fingerprintOf(truth);
        // Unchanged since this session last stored it (A10 pass 2 F2): no
        // storage read. The snapshot keeps the stored revision's identity and
        // carries the truth just built, which differs from the stored one
        // only in generation times (the fingerprint leaves those out). One
        // the cloud has not confirmed takes the full path, which sends the
        // stored snapshot again.
        const head = heads().get(headKey(owner, truth.projectId));
        if (head && head.fingerprint === sourceFingerprint) {
          const confirmed = cloudConfirmedSnapshots.has(cloudConfirmationKey(head.snapshot));
          if (!useCloud || confirmed) {
            return {
              snapshot: deepFreeze({ ...head.snapshot, truth }),
              created: false,
              cloudStatus: useCloud ? 'saved' : 'local_only',
            };
          }
        }
        // Only this project's stored snapshots are re-checked in full; the
        // others are only rewritten (A10 pass 2 F2).
        const stored = await hydrate(storage, { owner, projectId: truth.projectId });
        let current = stored
          .filter(item => item.organizationId === owner && item.projectId === truth.projectId)
          .sort(compareSnapshots)[0] || null;
        let storedIsCurrent = true;
        if (!current && useCloud) {
          const cloud = await loadLatestDAVEProjectTruthSnapshotCloud(owner, truth.projectId);
          if (cloud.ok && cloud.data) {
            const recovered = normalizeSnapshot(cloud.data);
            assertSnapshotBoundary(recovered, owner, truth.projectId);
            await storeSnapshot(recovered, stored);
            rememberCloudConfirmed(recovered);
            storedIsCurrent = false;
            current = recovered;
          }
        }
        let snapshot = current;
        let created = false;

        if (
          !current ||
          // The stored fingerprint first: recomputing it walks the whole
          // multi-MB truth, and it is the answer whenever it matches, or
          // when the read found it in the current format.
          (
            current.sourceFingerprint !== sourceFingerprint &&
            (currentFormatSnapshots.has(current) || fingerprintDAVEProjectTruth(current.truth) !== sourceFingerprint)
          )
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
          await storeSnapshot(snapshot, storedIsCurrent ? stored : undefined);
          created = true;
        } else {
          rememberStoredHead(current, sourceFingerprint);
        }

        if (!snapshot) throw new Error('Project Truth snapshot could not be created.');
        if (!useCloud) {
          return { snapshot, created, cloudStatus: 'local_only' };
        }
        // Unchanged and already confirmed by the cloud this session: sending
        // it again only made the cloud reject the duplicate and the app
        // download it back (audit round 2 M1c).
        if (!created && cloudConfirmedSnapshots.has(cloudConfirmationKey(snapshot))) {
          return { snapshot, created, cloudStatus: 'saved' };
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
            rememberCloudConfirmed(snapshot);
            return snapshot;
          }
        }

        return (await list(owner, project))[0] || null;
      });
    },

    list,
  });
}

function headKey(organizationId: string, projectId: string) {
  return `${organizationId}|${projectId}`;
}

function fingerprintOf(truth: DAVEProjectTruth) {
  if (!Object.isFrozen(truth)) return fingerprintDAVEProjectTruth(truth);
  const known = frozenTruthFingerprints.get(truth);
  if (known) return known;
  const fingerprint = fingerprintDAVEProjectTruth(truth);
  frozenTruthFingerprints.set(truth, fingerprint);
  return fingerprint;
}

function cloudConfirmationKey(snapshot: Pick<DAVEProjectTruthSnapshot, 'organizationId' | 'projectId' | 'id'>) {
  return [snapshot.organizationId, snapshot.projectId, snapshot.id].join('|');
}

function rememberCloudConfirmed(snapshot: DAVEProjectTruthSnapshot) {
  const key = cloudConfirmationKey(snapshot);
  cloudConfirmedSnapshots.delete(key);
  cloudConfirmedSnapshots.add(key);
  while (cloudConfirmedSnapshots.size > MAX_CLOUD_CONFIRMED_SNAPSHOTS) {
    const oldest = cloudConfirmedSnapshots.values().next().value;
    if (oldest === undefined) break;
    cloudConfirmedSnapshots.delete(oldest);
  }
}

/** The same snapshot: same owner, project, revision and content fingerprint. */
function isSameSnapshot(value: unknown, snapshot: DAVEProjectTruthSnapshot) {
  if (value === snapshot) return true;
  return isRecord(value) &&
    value.id === snapshot.id &&
    value.organizationId === snapshot.organizationId &&
    value.projectId === snapshot.projectId &&
    value.revision === snapshot.revision &&
    value.sourceFingerprint === snapshot.sourceFingerprint;
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
    intelligence: truth.intelligence,
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

/**
 * Compatibility fingerprint used by snapshots created after volatile
 * generatedAt fields were removed but before canonical Project Truth
 * intelligence was included in semantic history.
 */
function priorSemanticFingerprintDAVEProjectTruth(truth: DAVEProjectTruth): string {
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

/**
 * Reads every stored snapshot. With a focus, only that owner's project is
 * re-checked in full (fingerprint, deep freeze); the other projects' are
 * checked for shape and trusted until their own project is read (A10 pass 2
 * F2): re-fingerprinting every project's multi-MB snapshots made each save
 * take ~0.2-1.5 s on the phone.
 */
async function hydrate(
  storage: DAVEProjectTruthStorage,
  focus: Readonly<{ owner: string; projectId: string }> | null = null,
): Promise<DAVEProjectTruthSnapshot[]> {
  const raw = await storage.getItem(DAVE_PROJECT_TRUTH_STORAGE_KEY);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    const recovery = await quarantineProjectTruthValue(storage, raw, null);
    throw localCorruptionRecoveryError({
      label: 'Stored Project Truth snapshots',
      recovery,
    });
  }

  if (
    !isRecord(parsed) ||
    parsed.repositoryVersion !== DAVE_PROJECT_TRUTH_REPOSITORY_VERSION ||
    !Array.isArray(parsed.snapshots)
  ) {
    const recovery = await quarantineProjectTruthValue(storage, raw, null);
    throw localCorruptionRecoveryError({
      label: 'Stored Project Truth snapshots',
      recovery,
    });
  }

  const snapshots: DAVEProjectTruthSnapshot[] = [];
  let recovered = false;
  for (const value of parsed.snapshots) {
    try {
      const inFocus = !focus || (
        isRecord(value) && value.organizationId === focus.owner && value.projectId === focus.projectId
      );
      const snapshot = normalizeSnapshot(value, inFocus);
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
  if (recovered) {
    const recovery = await quarantineProjectTruthValue(
      storage,
      raw,
      serializeTruthSnapshots(sorted),
    );
    throw localCorruptionRecoveryError({
      label: 'Stored Project Truth snapshots',
      recovery,
      salvagedRecords: sorted.length,
    });
  }
  return sorted;
}

function serializeTruthSnapshots(
  snapshots: readonly DAVEProjectTruthSnapshot[],
): string {
  const envelope: StoredTruthSnapshots = {
    repositoryVersion: DAVE_PROJECT_TRUTH_REPOSITORY_VERSION,
    snapshots,
  };
  return JSON.stringify(envelope);
}

function quarantineProjectTruthValue(
  storage: DAVEProjectTruthStorage,
  raw: string,
  replacementRaw: string | null,
) {
  return quarantineCorruptLocalValue({
    storage,
    storageKey: DAVE_PROJECT_TRUTH_STORAGE_KEY,
    quarantineKeyPrefix: DAVE_PROJECT_TRUTH_QUARANTINE_KEY_PREFIX,
    raw,
    replacementRaw,
  });
}

function normalizeSnapshot(value: unknown, verifyContent = true): DAVEProjectTruthSnapshot {
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
    snapshot.projectName !== truth.projectName
  ) {
    throw new Error('Project Truth snapshot boundary is invalid.');
  }
  // Another project's snapshot is only rewritten, never handed out.
  if (!verifyContent) return Object.freeze(snapshot);
  const format = snapshotFingerprintFormat(truth, snapshot.sourceFingerprint);
  if (!format) throw new Error('Project Truth snapshot boundary is invalid.');
  const frozen = deepFreeze(snapshot);
  if (format === 'current') currentFormatSnapshots.add(frozen);
  return frozen;
}

/**
 * Current fingerprint first; the two older formats only when it does not
 * match. Each one walks the whole truth, and computing all three for every
 * stored snapshot on every read was most of the cost of a read.
 */
function snapshotFingerprintFormat(truth: DAVEProjectTruth, sourceFingerprint: string) {
  if (fingerprintDAVEProjectTruth(truth) === sourceFingerprint) return 'current';
  return priorSemanticFingerprintDAVEProjectTruth(truth) === sourceFingerprint ||
    legacyFingerprintDAVEProjectTruth(truth) === sourceFingerprint
    ? 'older'
    : null;
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
