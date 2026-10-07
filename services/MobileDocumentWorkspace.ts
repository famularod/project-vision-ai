import type { ReferenceDocument } from '../types';
import { buildOperationalProjectIdentityAuthority, resolveOperationalReferenceDocumentScope } from './OperationalProjectIdentity';
import { canonicalReferenceCategory } from './AuthoritativeDocumentSystem';
import { PROJECT_DOCUMENT_CATEGORIES } from './ProjectDocumentClassification';

type Attachment = {
  id: string; name: string; category: string; status: string;
  referenceDocumentId?: string | null; isArchived?: boolean;
  mimeType?: string | null; note?: string | null;
};
export type MobileDocumentWorkspaceEntry<T extends Attachment> = {
  id: string; name: string; category: string; status: string;
  mimeType?: string | null; note?: string | null;
} & ({ kind: 'attachment'; attachment: T } | { kind: 'reference'; reference: ReferenceDocument });

/** What a device knows of the archived mark (owner answer Q44): services/SharedDocumentArchive.ts. */
export type MobileDocumentArchive = Readonly<{
  installed?: boolean | null;
  archivedIds: ReadonlySet<string>;
  waitingIds?: ReadonlySet<string>;
}>;

/**
 * A document under "Archived (n)" on a project's Documents screen, with
 * Restore. `scope`: hidden on every device (the cloud carries the mark), on
 * this device and waiting to reach the cloud, or on this device only (the
 * mark is not installed, the device has never been able to ask, or the card
 * was archived without the mark: none of those is sent anywhere later).
 */
export type MobileArchivedDocument = Readonly<{
  key: string; name: string; category: string;
  /** The phone's own card, when this device has one. */
  cardId: string | null;
  /** The shared copy, when there is one. */
  sharedDocumentId: string | null;
  scope: 'everywhere' | 'waiting' | 'this_device';
}>;

const NOTHING_ARCHIVED: ReadonlySet<string> = new Set<string>();

/** The shared copy an attachment answers for, as far as its own ids say. */
function sharedIdsOf(attachment: Readonly<{ id: string; referenceDocumentId?: string | null }>): string[] {
  return [attachment.id, attachment.referenceDocumentId?.trim()].filter((id): id is string => Boolean(id));
}

/** Read-only view of already authorized records. Never creates attachment ownership.
 * Attachments must be project-scoped by the caller, including archived entries
 * so their shared bridge cannot accidentally reappear as a second card.
 *
 * A shared document the cloud marks archived is hidden on every device (owner
 * answer Q44, 6 Oct 2026): it is not listed, and neither is this device's own
 * card for it.
 */
export function buildMobileDocumentWorkspace<T extends Attachment>(input: {
  documents: readonly T[];
  referenceDocuments: readonly ReferenceDocument[];
  projectNames: readonly string[];
  projectIdentities: readonly { id?: string | null; name: string }[];
  archivedSharedDocumentIds?: ReadonlySet<string>;
}): MobileDocumentWorkspaceEntry<T>[] {
  const archived = input.archivedSharedDocumentIds ?? NOTHING_ARCHIVED;
  const authority = buildOperationalProjectIdentityAuthority(input.projectIdentities);
  const normalize = (name: string) => name.trim().toLowerCase();
  const selected = new Set(input.projectNames.map(normalize).filter(name =>
    authority.byNormalizedName.get(name)?.length === 1,
  ));
  const represented = new Set(input.documents.flatMap(document =>
    [document.id, document.referenceDocumentId?.trim()].filter((id): id is string => Boolean(id)),
  ));
  const entries: MobileDocumentWorkspaceEntry<T>[] = input.documents
    .filter(document => !document.isArchived && !sharedIdsOf(document).some(id => archived.has(id)))
    .map(attachment => ({
      id: `attachment:${attachment.id}`, name: attachment.name, category: attachment.category,
      status: attachment.status, mimeType: attachment.mimeType, note: attachment.note,
      kind: 'attachment', attachment,
    }));
  const seen = new Set<string>();
  for (const reference of input.referenceDocuments) {
    if (seen.has(reference.id) || represented.has(reference.id) || archived.has(reference.id)) continue;
    const scope = resolveOperationalReferenceDocumentScope(reference, authority);
    if (!scope.ok || !scope.scope.projectNames.some(name => selected.has(normalize(name)))) continue;
    seen.add(reference.id);
    const category = canonicalReferenceCategory(reference);
    entries.push({
      id: `reference:${reference.id}`, name: reference.name,
      category: PROJECT_DOCUMENT_CATEGORIES.find(value => value.toLowerCase() === category) || 'Other',
      status: 'shared reference', mimeType: reference.mimeType, note: reference.notes,
      kind: 'reference', reference,
    });
  }
  return entries;
}

/**
 * The project's archived documents, for "Archived (n)" and Restore (owner
 * answer Q44): this device's own archived cards, and shared documents the
 * cloud marks archived that this device has no card for (an iPad, another
 * phone, this phone after a reinstall). The caller scopes the attachments to
 * the project, as for the list above.
 */
export function buildMobileArchivedDocuments<T extends Attachment>(input: {
  documents: readonly T[];
  referenceDocuments: readonly ReferenceDocument[];
  projectNames: readonly string[];
  projectIdentities: readonly { id?: string | null; name: string }[];
  archive: MobileDocumentArchive;
}): MobileArchivedDocument[] {
  const { archivedIds, waitingIds = NOTHING_ARCHIVED, installed = null } = input.archive;
  const scopeOf = (sharedId: string | null): MobileArchivedDocument['scope'] => {
    if (!sharedId || !archivedIds.has(sharedId)) return 'this_device';
    if (!waitingIds.has(sharedId)) return 'everywhere';
    // Not yet told to the cloud. (Only a device that knows the mark is installed has anything waiting.)
    return installed === true ? 'waiting' : 'this_device';
  };
  const sharedById = new Set(input.referenceDocuments.map(reference => reference.id));
  const entries: MobileArchivedDocument[] = [];
  const represented = new Set<string>();
  for (const attachment of input.documents) {
    const ids = sharedIdsOf(attachment);
    ids.forEach(id => represented.add(id));
    const marked = ids.find(id => archivedIds.has(id)) ?? null;
    if (!attachment.isArchived && !marked) continue;
    const sharedDocumentId = marked ?? ids.find(id => sharedById.has(id)) ?? null;
    entries.push({
      key: `attachment:${attachment.id}`, name: attachment.name, category: attachment.category,
      cardId: attachment.id, sharedDocumentId, scope: scopeOf(sharedDocumentId),
    });
  }
  const authority = buildOperationalProjectIdentityAuthority(input.projectIdentities);
  const normalize = (name: string) => name.trim().toLowerCase();
  const selected = new Set(input.projectNames.map(normalize).filter(name =>
    authority.byNormalizedName.get(name)?.length === 1,
  ));
  const seen = new Set<string>();
  for (const reference of input.referenceDocuments) {
    if (!archivedIds.has(reference.id) || seen.has(reference.id) || represented.has(reference.id)) continue;
    const scope = resolveOperationalReferenceDocumentScope(reference, authority);
    if (!scope.ok || !scope.scope.projectNames.some(name => selected.has(normalize(name)))) continue;
    seen.add(reference.id);
    const category = canonicalReferenceCategory(reference);
    entries.push({
      key: `reference:${reference.id}`, name: reference.name,
      category: PROJECT_DOCUMENT_CATEGORIES.find(value => value.toLowerCase() === category) || 'Other',
      cardId: null, sharedDocumentId: reference.id, scope: scopeOf(reference.id),
    });
  }
  return entries;
}

/** The line under each archived document's name. */
export function mobileArchivedDocumentScopeText(scope: MobileArchivedDocument['scope']): string {
  if (scope === 'everywhere') return 'Hidden on all your devices. Kept in the cloud.';
  // True with no signal and while the request is on its way (review of D1, L9).
  if (scope === 'waiting') return 'Hidden on this device. Your other devices follow as soon as this one reaches the cloud.';
  return 'Hidden on this device.';
}
