/**
 * A phone project document's shared record ("bridge"): built when its bytes
 * upload, with the document's own id and a storage path
 * project-documents/<project>/<document id>/<file> (App
 * buildProjectDocumentStoragePath). Schedule imports (mobile/...) and a Make
 * Current schedule record (a fresh id) never match.
 *
 * Deleting the phone document left the bridge in the list and in the upload
 * queue. Before audit A7 M1 (batch 1) its name-key project id never
 * uploaded, so it stayed hidden; since then it came back as a "Shared
 * project document" card and uploaded to the iPad and the cloud (whole-app
 * audit A7 pass 4, 30 Sep 2026). A queued bridge whose document is gone is
 * withdrawn, as the delete itself does now. A bridge already in the cloud is
 * left alone: removing it everywhere is the owner's decision (Q14).
 */
import { exactProjectId, legacyProjectNameKey } from './OperationalProjectIdentity';

export const PROJECT_DOCUMENTS_STORAGE_KEY = 'projectPhotoUpdate.projectDocuments.v1';

type BridgeRecord = Readonly<{ id: string; storagePath?: string | null }>;
type SharedRecord = BridgeRecord & Readonly<{
  projectId?: string | null;
  projectName?: string | null;
  isCurrent?: boolean;
}>;
type LinkingDocument = Readonly<{
  id: string;
  referenceDocumentId?: string | null;
  storagePath?: string | null;
}>;

export function isProjectDocumentBridge(record: BridgeRecord): boolean {
  const segments = (record.storagePath || '').trim().split('/');
  return segments.length >= 4 && segments[0] === 'project-documents' && segments[2] === record.id.trim();
}

/** A bridge no remaining project document (archived included) links to. */
export function projectDocumentBridgeOrphaned(
  record: BridgeRecord,
  projectDocuments: readonly LinkingDocument[],
): boolean {
  if (!isProjectDocumentBridge(record)) return false;
  const id = record.id.trim();
  const storagePath = (record.storagePath || '').trim();
  return !projectDocuments.some(document =>
    document.id.trim() === id ||
    document.referenceDocumentId?.trim() === id ||
    (document.storagePath || '').trim() === storagePath);
}

/**
 * The persisted project documents, or null when they are missing or cannot
 * be read (the bridge then uploads as before rather than guessing).
 */
export function parseStoredProjectDocuments(raw: string | null): LinkingDocument[] | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    return value.filter((item): item is LinkingDocument =>
      Boolean(item) && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string');
  } catch {
    return null;
  }
}

/**
 * Bridges left by documents deleted on Build 228 or earlier: they still carry
 * the phone's name key as project id (never accepted by the cloud, so never
 * uploaded) and no document links to them. Dropped at startup; the queue
 * gate withdraws their queue items.
 */
export function legacyOrphanedProjectDocumentBridges<T extends SharedRecord>(
  records: readonly T[],
  projectDocuments: readonly LinkingDocument[],
): T[] {
  return records.filter(record => {
    const projectId = record.projectId?.trim();
    const projectName = record.projectName?.trim();
    return Boolean(
      !record.isCurrent && projectId && projectName && !exactProjectId(projectId) &&
      projectId === legacyProjectNameKey(projectName) &&
      projectDocumentBridgeOrphaned(record, projectDocuments),
    );
  });
}

/**
 * On a phone document delete: its bridge, if nothing else links to it, it is
 * not current and it has not uploaded yet (still queued), leaves the list and
 * the queue. A bridge already in the cloud stays until the owner decides
 * whether a phone delete removes it everywhere (Q14).
 */
export async function withdrawUnsentProjectDocumentBridge({
  bridge,
  remainingDocuments,
  isQueued,
  withdraw,
}: Readonly<{
  bridge: SharedRecord | null;
  remainingDocuments: readonly LinkingDocument[];
  isQueued: (recordId: string) => Promise<boolean>;
  withdraw: (recordId: string) => Promise<void>;
}>): Promise<string | null> {
  if (!bridge || bridge.isCurrent || !projectDocumentBridgeOrphaned(bridge, remainingDocuments)) return null;
  if (!(await isQueued(bridge.id))) return null;
  await withdraw(bridge.id);
  return bridge.id;
}

