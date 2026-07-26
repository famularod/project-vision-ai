import { groupDAVEWebDocuments } from '../../services/DAVEWebDocumentManagement';
import type { DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';

describe('Vitruvius desktop document management', () => {
  test('separates the current schedule, prior versions, and other documents', () => {
    const current = document({ id: 'current', name: 'July schedule', category: 'Schedules', isCurrent: true, importedAt: '2026-07-19T12:00:00.000Z' });
    const older = document({ id: 'older', name: 'June look-ahead', category: 'Other', isCurrent: false, importedAt: '2026-06-30T12:00:00.000Z' });
    const permit = document({ id: 'permit', name: 'Permit card', category: 'Permit Card', isCurrent: true, importedAt: '2026-07-10T12:00:00.000Z' });

    const grouped = groupDAVEWebDocuments([older, permit, current]);

    expect(grouped.currentSchedule.map(item => item.id)).toEqual(['current']);
    expect(grouped.priorScheduleVersions.map(item => item.id)).toEqual(['older']);
    expect(grouped.otherDocuments.map(item => item.id)).toEqual(['permit']);
  });

  test('orders prior schedule versions from newest to oldest', () => {
    const newest = document({ id: 'newest', name: 'Schedule 2', category: 'Schedules', importedAt: '2026-07-18T12:00:00.000Z' });
    const oldest = document({ id: 'oldest', name: 'Schedule 1', category: 'Schedules', importedAt: '2026-07-01T12:00:00.000Z' });

    expect(groupDAVEWebDocuments([oldest, newest]).priorScheduleVersions.map(item => item.id)).toEqual(['newest', 'oldest']);
  });
});

function document(overrides: Partial<DAVEWebReferenceDocument>): DAVEWebReferenceDocument {
  return {
    id: overrides.id ?? 'document',
    name: overrides.name ?? 'Document',
    originalFileName: overrides.originalFileName ?? `${overrides.name ?? 'Document'}.pdf`,
    uri: '',
    mimeType: 'application/pdf',
    category: overrides.category ?? 'Other',
    notes: '',
    isCurrent: overrides.isCurrent ?? false,
    importedAt: overrides.importedAt ?? '2026-07-01T00:00:00.000Z',
    projectId: 'project-1',
    projectName: '2375 Compliance Project',
    importBatchId: null,
    cloudUpdatedAt: '2026-07-19T00:00:00.000Z',
    linkedScheduleItems: [],
  };
}
