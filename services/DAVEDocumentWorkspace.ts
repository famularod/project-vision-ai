export type DAVEWorkspaceDocument = {
  id: string;
  category: string;
};

export type DAVEProjectScheduleDocument = DAVEWorkspaceDocument & {
  projectId: string;
  isCurrent?: boolean;
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
  projectId,
  updatedAt,
}: {
  documents: T[];
  documentId: string;
  projectId: string;
  updatedAt: string;
}) {
  return documents.map(document => {
    if (document.projectId !== projectId || document.category !== 'Schedule') {
      return document;
    }

    const isCurrent = document.id === documentId;
    if (Boolean(document.isCurrent) === isCurrent) return document;

    return {
      ...document,
      isCurrent,
      updatedAt,
    };
  });
}
