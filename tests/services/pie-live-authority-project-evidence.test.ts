import { buildExactPIELiveAuthorityProjectEvidence } from '../../services/PIELiveAuthorityProjectEvidence';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const sharedTask = {
  scheduleProjectName: 'Shared Project',
  projectName: 'Shared Project',
  locationName: 'North Lot',
  taskName: 'Inspect work',
  startDate: '',
  finishDate: '',
  milestone: '',
  owner: '',
  contractor: '',
  percentComplete: 0,
  priority: 'Medium' as const,
  status: 'Not Started' as const,
  notes: '',
  createdAt: '2026-08-11T00:00:00.000Z',
};

function update(id: string, projectId?: string): ProjectUpdate {
  return {
    id,
    projectId,
    projectName: 'Shared Project',
    date: '2026-08-11T00:00:00.000Z',
    photos: [],
    notes: '',
    recipients: { contactIds: [] },
  };
}

describe('exact PIE live authority project evidence', () => {
  it('returns no project evidence when exact project authority is unresolved', () => {
    expect(buildExactPIELiveAuthorityProjectEvidence({
      reportScope: null,
      project: null,
      projectRecords: [],
      updates: [update('update-a', 'project-a')],
      scheduleItems: [{ ...sharedTask, id: 'task-a', projectId: 'project-a' }],
      currentUpdate: update('draft-a', 'project-a'),
      projectAreas: [{ id: 'area-a', name: 'North Lot', projectName: 'Shared Project', latitude: 0, longitude: 0, radiusFeet: 50 }],
      referenceDocuments: [{ id: 'doc-a', name: 'A', originalFileName: 'A.pdf', uri: '', category: 'drawing', notes: '', isCurrent: true, importedAt: '', projectId: 'project-a' }],
      projectDocuments: [{ id: 'project-doc-a', projectId: 'project-a', name: 'A', category: 'Drawing', createdAt: '', updatedAt: '', importedAt: '', status: 'uploaded' }],
      captureMemories: [],
    })).toEqual({
      updates: [],
      scheduleItems: [],
      currentUpdate: null,
      projectAreas: [],
      referenceDocuments: [],
      projectDocuments: [],
      captureMemories: [],
    });
  });

  it('keeps every evidence domain on the exact project id and rejects ambiguous areas', () => {
    const tasks: ScheduleItem[] = [
      { ...sharedTask, id: 'task-a', projectId: 'project-a' },
      { ...sharedTask, id: 'task-b', projectId: 'project-b' },
    ];
    const evidence = buildExactPIELiveAuthorityProjectEvidence({
      reportScope: null,
      project: { id: 'project-b', name: 'Shared Project' },
      projectRecords: [
        { id: 'project-a', name: 'Shared Project' },
        { id: 'project-b', name: 'Shared Project' },
      ],
      updates: [update('update-a', 'project-a'), update('update-b', 'project-b'), update('legacy')],
      scheduleItems: tasks,
      currentUpdate: update('draft-a', 'project-a'),
      projectAreas: [{ id: 'shared-area', name: 'North Lot', projectName: 'Shared Project', latitude: 0, longitude: 0, radiusFeet: 50 }],
      referenceDocuments: [
        { id: 'doc-a', name: 'A', originalFileName: 'A.pdf', uri: '', category: 'drawing', notes: '', isCurrent: true, importedAt: '', projectId: 'project-a' },
        { id: 'doc-b', name: 'B', originalFileName: 'B.pdf', uri: '', category: 'drawing', notes: '', isCurrent: true, importedAt: '', projectId: 'project-b' },
      ],
      projectDocuments: [
        { id: 'project-doc-a', projectId: 'project-a', name: 'A', category: 'Drawing', createdAt: '', updatedAt: '', importedAt: '', status: 'uploaded' },
        { id: 'project-doc-b', projectId: 'project-b', name: 'B', category: 'Drawing', createdAt: '', updatedAt: '', importedAt: '', status: 'uploaded' },
      ],
      captureMemories: [],
    });

    expect(evidence.updates.map(item => item.id)).toEqual(['update-b']);
    expect(evidence.scheduleItems.map(item => item.id)).toEqual(['task-b']);
    expect(evidence.currentUpdate).toBeNull();
    expect(evidence.projectAreas).toEqual([]);
    expect(evidence.referenceDocuments.map(item => item.id)).toEqual(['doc-b']);
    expect(evidence.projectDocuments.map(item => item.id)).toEqual(['project-doc-b']);
  });
});
