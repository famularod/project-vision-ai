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

/** Read-only view of already authorized records. Never creates attachment ownership.
 * Attachments must be project-scoped by the caller, including archived entries
 * so their shared bridge cannot accidentally reappear as a second card.
 */
export function buildMobileDocumentWorkspace<T extends Attachment>(input: {
  documents: readonly T[];
  referenceDocuments: readonly ReferenceDocument[];
  projectNames: readonly string[];
  projectIdentities: readonly { id?: string | null; name: string }[];
}): MobileDocumentWorkspaceEntry<T>[] {
  const authority = buildOperationalProjectIdentityAuthority(input.projectIdentities);
  const normalize = (name: string) => name.trim().toLowerCase();
  const selected = new Set(input.projectNames.map(normalize).filter(name =>
    authority.byNormalizedName.get(name)?.length === 1,
  ));
  const represented = new Set(input.documents.flatMap(document =>
    [document.id, document.referenceDocumentId?.trim()].filter((id): id is string => Boolean(id)),
  ));
  const entries: MobileDocumentWorkspaceEntry<T>[] = input.documents
    .filter(document => !document.isArchived)
    .map(attachment => ({
      id: `attachment:${attachment.id}`, name: attachment.name, category: attachment.category,
      status: attachment.status, mimeType: attachment.mimeType, note: attachment.note,
      kind: 'attachment', attachment,
    }));
  const seen = new Set<string>();
  for (const reference of input.referenceDocuments) {
    if (seen.has(reference.id) || represented.has(reference.id)) continue;
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
