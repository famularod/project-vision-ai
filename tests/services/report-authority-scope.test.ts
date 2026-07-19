import {
  buildCombinedReportAuthorityScope,
  buildDailyReportAuthorityScope,
  COMBINED_REPORT_PROJECT_TRUTH_POLICY,
} from '../../services/ReportAuthorityScope';
import type { ProjectRecord } from '../../services/ProjectCoverPhotoService';
import type { DAVEConfirmedCaptureMemory } from '../../services/DAVECaptureMemory';
import type { DAVEDailyBriefDocument } from '../../services/DAVEDailyBrief';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const PROJECT_A = '2375 Compliance Project';
const PROJECT_B = '2321 Compliance Project';

function scheduleItem(
  id: string,
  parentProjectName: string,
  locationName = 'Canopy A',
): ScheduleItem {
  return {
    id,
    scheduleProjectName: parentProjectName,
    projectName: locationName,
    locationName,
    taskName: `Task ${id}`,
    startDate: '07/18/2026',
    finishDate: '07/25/2026',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-07-18T12:00:00.000Z',
  };
}

function update(
  id: string,
  overrides: Partial<ProjectUpdate>,
): ProjectUpdate {
  return {
    id,
    projectName: 'Canopy A',
    date: '2026-07-18T12:00:00.000Z',
    photos: [],
    notes: '',
    recipients: { contactIds: [] },
    ...overrides,
  };
}

describe('combined report authority scope', () => {
  const projectRecords: ProjectRecord[] = [
    { id: 'project-record-a', name: PROJECT_A },
    { id: 'project-record-b', name: PROJECT_B },
  ];

  it('does not admit records through a shared area name and prefers exact schedule identity', () => {
    const scheduleA = scheduleItem('task-a', PROJECT_A);
    const scheduleB = scheduleItem('task-b', PROJECT_B);
    const updates = [
      update('a-by-id', { scheduleItemId: 'task-a' }),
      update('b-by-id', { scheduleItemId: 'task-b' }),
      update('a-by-parent', { scheduleProjectName: PROJECT_A }),
      update('b-by-parent', { scheduleProjectName: PROJECT_B }),
      update('bare-shared-area', {}),
      update('id-wins-over-parent', {
        scheduleItemId: 'task-b',
        scheduleProjectName: PROJECT_A,
      }),
      update('unknown-id-fails-closed', {
        scheduleItemId: 'missing-task',
        scheduleProjectName: PROJECT_A,
      }),
    ];

    const scope = buildCombinedReportAuthorityScope({
      selectedProjectNames: [PROJECT_A],
      projectRecords,
      updates,
      scheduleItems: [scheduleA, scheduleB],
      currentUpdate: update('current-shared-area', {}),
    });

    expect(scope.scheduleItems.map(item => item.id)).toEqual(['task-a']);
    expect(scope.updates.map(item => item.id)).toEqual(['a-by-id', 'a-by-parent']);
    expect(scope.currentUpdate).toBeNull();
  });

  it('fails closed when a schedule ID is ambiguous across parent projects', () => {
    const duplicatedA = scheduleItem('duplicate-task', PROJECT_A);
    const duplicatedB = scheduleItem('duplicate-task', PROJECT_B);

    const scope = buildCombinedReportAuthorityScope({
      selectedProjectNames: [PROJECT_A],
      projectRecords,
      updates: [update('ambiguous', { scheduleItemId: 'duplicate-task' })],
      scheduleItems: [duplicatedA, duplicatedB],
    });

    expect(scope.updates).toEqual([]);
  });

  it('derives an order-independent portfolio identity from immutable record IDs', () => {
    const first = buildCombinedReportAuthorityScope({
      selectedProjectNames: [PROJECT_A, PROJECT_B],
      projectRecords,
      updates: [],
      scheduleItems: [],
    });
    const reversed = buildCombinedReportAuthorityScope({
      selectedProjectNames: [PROJECT_B, PROJECT_A],
      projectRecords,
      updates: [],
      scheduleItems: [],
    });

    expect(first.projectId).toBe(reversed.projectId);
    expect(first.projectIdentityKeys).toEqual([
      'id:project-record-a',
      'id:project-record-b',
    ]);
    expect(first.projectId).not.toContain(PROJECT_A.toLowerCase());
    expect(first.projectTruthPersistencePolicy).toBe(
      COMBINED_REPORT_PROJECT_TRUTH_POLICY,
    );
  });

  it('uses a deterministic name fallback for an unmigrated record', () => {
    const first = buildCombinedReportAuthorityScope({
      selectedProjectNames: [PROJECT_A],
      projectRecords: [{ name: PROJECT_A }],
      updates: [],
      scheduleItems: [],
    });
    const second = buildCombinedReportAuthorityScope({
      selectedProjectNames: [`  ${PROJECT_A.toUpperCase()}  `],
      projectRecords: [{ name: PROJECT_A }],
      updates: [],
      scheduleItems: [],
    });

    expect(first.projectId).toBe(second.projectId);
    expect(first.projectIdentityKeys).toEqual([
      'legacy-name:2375 compliance project',
    ]);
  });

  it('fails closed for a daily report when another parent shares the same area', () => {
    const scheduleA = scheduleItem('task-a', PROJECT_A, 'Canopy A');
    const scheduleB = scheduleItem('task-b', PROJECT_B, 'Canopy A');
    const scope = buildDailyReportAuthorityScope({
      selectedProjectName: PROJECT_A,
      selectedProjectNames: [PROJECT_A],
      projectRecords,
      scheduleItems: [scheduleA, scheduleB],
      updates: [
        update('explicit-a', { scheduleProjectName: PROJECT_A }),
        update('task-a', { scheduleItemId: 'task-a' }),
        update('task-b', { scheduleItemId: 'task-b' }),
        update('shared-legacy-area', { projectName: 'Canopy A' }),
        update('unknown-legacy-area', { projectName: 'Unknown Area' }),
      ],
    });

    expect(scope.scheduleItems.map(item => item.id)).toEqual(['task-a']);
    expect(scope.updates.map(item => item.id)).toEqual(['explicit-a', 'task-a']);
  });

  it('admits daily legacy area-only evidence when schedule ownership is unique', () => {
    const scheduleA = scheduleItem('task-a', PROJECT_A, 'Unique Canopy');
    const legacySchedule = {
      ...scheduleItem('legacy-task', '', 'Unique Canopy'),
      scheduleProjectName: null,
      projectName: 'Unique Canopy',
    };
    const scope = buildDailyReportAuthorityScope({
      selectedProjectName: PROJECT_A,
      selectedProjectNames: [PROJECT_A],
      projectRecords,
      scheduleItems: [scheduleA, legacySchedule],
      updates: [update('unique-legacy-area', { projectName: 'Unique Canopy' })],
    });

    expect(scope.scheduleItems.map(item => item.id)).toEqual(['task-a', 'legacy-task']);
    expect(scope.updates.map(item => item.id)).toEqual(['unique-legacy-area']);
  });

  it('scopes every supporting evidence category to the selected parent', () => {
    const updateA = update('update-a', {
      scheduleProjectName: PROJECT_A,
      selectedAreaId: 'area-a',
      selectedAreaName: 'Canopy A',
      recipients: { contactIds: ['contact-a'] },
    });
    const updateB = update('update-b', {
      scheduleProjectName: PROJECT_B,
      selectedAreaId: 'area-b',
      selectedAreaName: 'Canopy A',
      recipients: { contactIds: ['contact-b'] },
    });
    const scheduleA = {
      ...scheduleItem('task-a', PROJECT_A, 'Canopy A'),
      sourceDocumentId: 'source-a',
      importBatchId: 'batch-a',
    };
    const scheduleB = {
      ...scheduleItem('task-b', PROJECT_B, 'Canopy A'),
      sourceDocumentId: 'source-b',
      importBatchId: 'batch-b',
    };
    const projectDocuments: DAVEDailyBriefDocument[] = [
      { id: 'project-doc-a', projectId: 'project-record-a', name: 'A', category: 'Schedule', status: 'local', createdAt: '2026-07-18' },
      { id: 'project-doc-b', projectId: 'project-record-b', name: 'B', category: 'Schedule', status: 'local', createdAt: '2026-07-18' },
      { id: 'update-doc-a', updateId: 'update-a', name: 'A update', category: 'Photo', status: 'local', createdAt: '2026-07-18' },
      { id: 'update-doc-b', updateId: 'update-b', name: 'B update', category: 'Photo', status: 'local', createdAt: '2026-07-18' },
    ];
    const memory = (id: string, projectName: string) => ({
      id,
      status: 'confirmed',
      confirmedAt: '2026-07-18T12:00:00.000Z',
      cancelledAt: null,
      recommendedProject: { value: projectName },
    }) as unknown as DAVEConfirmedCaptureMemory;

    const scope = buildDailyReportAuthorityScope({
      selectedProjectName: PROJECT_A,
      selectedProjectNames: [PROJECT_A],
      projectRecords,
      updates: [updateA, updateB],
      scheduleItems: [scheduleA, scheduleB],
      projectAreas: [
        { id: 'area-a', name: 'Canopy A', latitude: 1, longitude: 1, radiusFeet: 100 },
        { id: 'area-b', name: 'Canopy A', latitude: 2, longitude: 2, radiusFeet: 100 },
      ],
      referenceDocuments: [
        { id: 'source-a', name: 'A source', originalFileName: 'a.pdf', uri: 'a', category: 'Schedules', notes: '', isCurrent: true, importedAt: '2026-07-18' },
        { id: 'source-b', name: 'B source', originalFileName: 'b.pdf', uri: 'b', category: 'Schedules', notes: '', isCurrent: true, importedAt: '2026-07-18' },
        { id: 'batch-a-doc', importBatchId: 'batch-a', name: 'A batch', originalFileName: 'a2.pdf', uri: 'a2', category: 'Schedules', notes: '', isCurrent: true, importedAt: '2026-07-18' },
        { id: 'unowned-schedule', name: 'Other', originalFileName: 'other.pdf', uri: 'o', category: 'Schedules', notes: '', isCurrent: true, importedAt: '2026-07-18' },
        { id: 'explicit-a', projectId: 'project-record-a', name: 'A explicit', originalFileName: 'ae.pdf', uri: 'ae', category: 'Plans', notes: '', isCurrent: true, importedAt: '2026-07-18' },
        { id: 'explicit-b', projectName: PROJECT_B, name: 'B explicit', originalFileName: 'be.pdf', uri: 'be', category: 'Plans', notes: '', isCurrent: true, importedAt: '2026-07-18' },
      ],
      projectDocuments,
      captureMemories: [memory('memory-a', PROJECT_A), memory('memory-b', PROJECT_B)],
      contacts: {
        contacts: [
          { id: 'contact-a', name: 'A', email: 'a@example.com', phone: '' },
          { id: 'contact-b', name: 'B', email: 'b@example.com', phone: '' },
        ],
      },
    });

    expect(scope.projectAreas.map(area => area.id)).toEqual(['area-a']);
    expect(scope.referenceDocuments.map(document => document.id)).toEqual([
      'source-a',
      'batch-a-doc',
      'explicit-a',
    ]);
    expect(scope.projectDocuments.map(document => document.id)).toEqual([
      'project-doc-a',
      'update-doc-a',
    ]);
    expect(scope.captureMemories.map(item => item.id)).toEqual(['memory-a']);
    expect(scope.contacts.contacts.map(contact => contact.id)).toEqual(['contact-a']);
  });
});
