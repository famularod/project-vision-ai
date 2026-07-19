import {
  filterDAVEDocumentWorkspace,
  resolveDAVEDocumentWorkspaceDocument,
} from '../../services/DAVEDocumentWorkspace';

const documents = [
  { id: 'drawing-a', category: 'Drawing' },
  { id: 'permit-a', category: 'Permit Card' },
  { id: 'drawing-b', category: 'Drawing' },
];

describe('DAVE document workspace', () => {
  it('filters documents without changing their source order', () => {
    expect(filterDAVEDocumentWorkspace({ documents, category: 'Drawing' }))
      .toEqual([documents[0], documents[2]]);
    expect(filterDAVEDocumentWorkspace({ documents, category: null }))
      .toBe(documents);
  });

  it('preserves a valid selection and falls back after filtering or deletion', () => {
    expect(resolveDAVEDocumentWorkspaceDocument(documents, 'permit-a'))
      .toBe(documents[1]);
    expect(resolveDAVEDocumentWorkspaceDocument([documents[0], documents[2]], 'permit-a'))
      .toBe(documents[0]);
    expect(resolveDAVEDocumentWorkspaceDocument([], 'permit-a')).toBeNull();
  });
});
