import {
  filterDAVEDocumentWorkspace,
  markCurrentProjectScheduleDocument,
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

  it('keeps exactly one current schedule per project', () => {
    const scheduleDocuments = [
      {
        id: 'schedule-a-old',
        projectId: 'project-a',
        category: 'Schedule',
        isCurrent: true,
        updatedAt: '2026-07-19T10:00:00.000Z',
      },
      {
        id: 'schedule-a-new',
        projectId: 'project-a',
        category: 'Schedule',
        isCurrent: false,
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
      {
        id: 'schedule-b',
        projectId: 'project-b',
        category: 'Schedule',
        isCurrent: true,
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
      {
        id: 'drawing-a',
        projectId: 'project-a',
        category: 'Drawing',
        isCurrent: false,
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
    ];

    const result = markCurrentProjectScheduleDocument({
      documents: scheduleDocuments,
      documentId: 'schedule-a-new',
      projectId: 'project-a',
      updatedAt: '2026-07-20T12:00:00.000Z',
    });

    expect(result.find(document => document.id === 'schedule-a-old')?.isCurrent)
      .toBe(false);
    expect(result.find(document => document.id === 'schedule-a-new')?.isCurrent)
      .toBe(true);
    expect(result.find(document => document.id === 'schedule-b')?.isCurrent)
      .toBe(true);
    expect(result.find(document => document.id === 'drawing-a'))
      .toBe(scheduleDocuments[3]);
  });
});
