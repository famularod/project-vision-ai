export type DAVEWorkspaceDocument = {
  id: string;
  category: string;
};

export type DAVEProjectScheduleDocument = DAVEWorkspaceDocument & {
  projectId: string;
  isCurrent?: boolean;
  referenceDocumentId?: string | null;
  updatedAt: string;
};

export function filterDAVEDocumentWorkspace<T extends DAVEWorkspaceDocument>({
  documents,
  category,
}: {
  documents: T[];
  category: string | null;
}) {
  if (!category) return documents;
  return documents.filter(document => document.category === category);
}

export function resolveDAVEDocumentWorkspaceDocument<T extends { id: string }>(
  documents: T[],
  selectedDocumentId: string | null,
) {
  if (selectedDocumentId) {
    const selected = documents.find(document => document.id === selectedDocumentId);
    if (selected) return selected;
  }

  return documents[0] || null;
}

export function markCurrentProjectScheduleDocument<
  T extends DAVEProjectScheduleDocument,
>({
  documents,
  documentId,
  referenceDocumentId,
  updatedAt,
}: {
  documents: T[];
  documentId: string;
  referenceDocumentId?: string | null;
  updatedAt: string;
}) {
  const becomesCurrent = (document: T) => document.id === documentId || Boolean(
    referenceDocumentId && document.referenceDocumentId === referenceDocumentId,
  );
  // Only the projects that gain a current schedule card lose their old one:
  // every other project's card was un-marked too (whole-app audit A8 pass 2 #3).
  const projectIds = new Set(documents
    .filter(document => document.category === 'Schedule' && becomesCurrent(document))
    .map(document => document.projectId));
  return documents.map(document => {
    if (document.category !== 'Schedule' || !projectIds.has(document.projectId)) return document;

    const isCurrent = becomesCurrent(document);
    if (Boolean(document.isCurrent) === isCurrent) return document;

    return {
      ...document,
      isCurrent,
      updatedAt,
    };
  });
}
