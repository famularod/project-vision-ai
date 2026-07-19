export type DAVEWorkspaceDocument = {
  id: string;
  category: string;
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
