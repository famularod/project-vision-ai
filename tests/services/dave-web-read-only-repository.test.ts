import {
  loadDAVEWebReadOnlySnapshot,
  normalizeWebPhoto,
  normalizeWebReport,
} from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: {
    loadAuthorizedRows: jest.fn(),
  },
}));

const mockedLoadRows = jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows);

describe('DAVE browser read-only repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('preserves saved report provenance needed to verify freshness and lineage after reload', () => {
    expect(normalizeWebReport({
      status: 'approved',
      title: 'Weekly project report',
      body: 'Current project facts.',
      generatedAt: '2026-07-22T12:00:00.000Z',
      sourceRefreshedAt: '2026-07-22T11:59:00.000Z',
      sourceFingerprint: 'sha256-report-source',
      sourceScopeKey: 'project:2375',
      sourceTaskIds: ['task-1'],
      sourceUpdateIds: ['update-1'],
      sourceDocumentIds: ['document-1'],
      sourceMedia: [{
        bucket: 'project-photos',
        projectId: 'project-1',
        updateId: 'update-1',
        photoId: 'photo-1',
        storagePath: 'owner-1/project-1/photo-1.jpg',
        contentSha256: 'a'.repeat(64),
      }],
      audit: [{
        id: 'audit-1',
        action: 'approved',
        actor: 'pm@example.com',
        at: '2026-07-22T12:01:00.000Z',
      }],
    })).toMatchObject({
      sourceFingerprint: 'sha256-report-source',
      sourceScopeKey: 'project:2375',
      sourceTaskIds: ['task-1'],
      sourceUpdateIds: ['update-1'],
      sourceDocumentIds: ['document-1'],
      sourceMedia: [expect.objectContaining({
        projectId: 'project-1',
        updateId: 'update-1',
        photoId: 'photo-1',
        storagePath: 'owner-1/project-1/photo-1.jpg',
      })],
    });
  });

  test('quarantines malformed or duplicate persisted report source identifiers', () => {
    const report = {
      status: 'approved',
      title: 'Weekly project report',
      body: 'Current project facts.',
      generatedAt: '2026-07-22T12:00:00.000Z',
      sourceRefreshedAt: '2026-07-22T11:59:00.000Z',
      sourceFingerprint: 'sha256-report-source',
      sourceScopeKey: 'project-id:project-b',
      sourceTaskIds: ['task-b'],
      sourceUpdateIds: ['update-b'],
      sourceDocumentIds: ['document-b'],
      audit: [],
    };

    expect(normalizeWebReport({
      ...report,
      sourceTaskIds: ['task-b', 'task-b'],
    })).toBeNull();
    expect(normalizeWebReport({
      ...report,
      sourceDocumentIds: ['document-b', 7],
    })).toBeNull();
    expect(normalizeWebReport({
      ...report,
      sourceUpdateIds: [' update-b '],
    })).toBeNull();
    expect(normalizeWebReport({
      ...report,
      sourceMedia: [{
        bucket: 'project-photos',
        projectId: 'project-b',
        updateId: 'update-b',
        photoId: 'photo-b',
        storagePath: ' owner-1/project-b/photo-b.jpg ',
        contentSha256: null,
      }],
    })).toBeNull();
    expect(normalizeWebReport({
      ...report,
      sourceMedia: [0, 1].map(() => ({
        bucket: 'project-photos',
        projectId: 'project-b',
        updateId: 'update-b',
        photoId: 'photo-b',
        storagePath: 'owner-1/project-b/photo-b.jpg',
        contentSha256: null,
      })),
    })).toBeNull();
  });

  test('preserves cloud photo, GPS, and intelligence fields used by project truth', () => {
    expect(normalizeWebPhoto({
      id: 'photo-1',
      fileName: 'canopy-c.jpg',
      mimeType: 'image/jpeg',
      cloudStoragePath: 'owner-1/project/photo-1.jpg',
      gpsLatitude: 33.701,
      gpsLongitude: -117.812,
      gpsAccuracy: 4.2,
      distanceFromSelectedAreaFeet: 12,
      photoIntelligence: {
        status: 'analysis_complete',
        title: 'Ramp progress',
        summary: 'Rebar is visible.',
        visibleChange: 'Rebar added.',
        location: 'Canopy C',
        comparisonConfidence: 'high',
        captureLimitations: [],
        projectProgress: 'supported',
        repeatPhotoGuidance: null,
        authorityMessage: 'Review current field condition.',
        updatedAt: '2026-07-22T12:00:00.000Z',
      },
    })).toMatchObject({
      fileName: 'canopy-c.jpg',
      mimeType: 'image/jpeg',
      cloudStoragePath: 'owner-1/project/photo-1.jpg',
      gpsLatitude: 33.701,
      gpsLongitude: -117.812,
      gpsAccuracy: 4.2,
      distanceFromSelectedAreaFeet: 12,
      photoIntelligence: {
        visibleChange: 'Rebar added.',
      },
    });
  });

  test('normalizes authorized cloud rows and removes archived evidence', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [{ id: 'p1', name: '2375 Compliance Project', archived: false }],
      scheduleItems: [{
        id: 't1',
        item_data: {
          id: 't1',
          projectName: '2375 Compliance Project',
          taskName: 'Install handrails',
          itemType: 'Issue',
          nextAction: 'Confirm anchor delivery.',
          activity: [{
            id: 'activity-1',
            message: 'Called the steel contractor.',
            author: 'PM',
            createdAt: '2026-07-19T16:00:00.000Z',
          }],
          status: 'In Progress',
          percentComplete: 70,
          wbsCode: '1.2.3',
          parentItemId: 'phase-1',
          sortOrder: 20,
          dependencies: [{
            predecessorItemId: 'predecessor',
            type: 'FS',
            lagDays: 2,
          }],
          isMilestone: false,
          baselineStartDate: '2026-07-20',
          baselineFinishDate: '2026-07-24',
          importBatchId: 'batch-1',
          sourceDocumentId: 'd1',
        },
      }],
      referenceDocuments: [{
        id: 'd1',
        name: 'Schedule.pdf',
        category: 'Schedules',
        updated_at: '2026-07-19T17:00:00.000Z',
        document_data: { id: 'd1', name: 'Schedule.pdf', projectName: null, projectNames: ['2375 Compliance Project', '2321 Compliance Project'], importBatchId: 'batch-1', isCurrent: true },
      }],
      projectUpdates: [
        {
          id: 'visible-update',
          project_name: '2375 Compliance Project',
          area_name: 'Canopy C',
          update_data: {
            id: 'visible-update',
            photos: [],
            notes: 'Visible',
            gpsLatitude: 33.701,
            gpsLongitude: -117.812,
            gpsAccuracy: 4.2,
            locationCapturedAt: '2026-07-22T12:00:00.000Z',
          },
        },
        {
          id: 'archived-update',
          project_name: '2375 Compliance Project',
          area_name: 'Canopy C',
          update_data: { id: 'archived-update', photos: [], notes: 'Archived', isArchived: true },
        },
      ],
      syncTombstones: [],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.projects.map(project => project.name)).toEqual(['2375 Compliance Project']);
    expect(snapshot.scheduleItems.map(item => item.taskName)).toEqual(['Install handrails']);
    expect(snapshot.scheduleItems[0]).toMatchObject({
      itemType: 'Issue',
      nextAction: 'Confirm anchor delivery.',
      activity: [{ message: 'Called the steel contractor.', author: 'PM' }],
      wbsCode: '1.2.3',
      parentItemId: 'phase-1',
      sortOrder: 20,
      dependencies: [{
        predecessorItemId: 'predecessor',
        type: 'FS',
        lagDays: 2,
      }],
      isMilestone: false,
      baselineStartDate: '2026-07-20',
      baselineFinishDate: '2026-07-24',
    });
    expect(snapshot.projectUpdates.map(update => update.id)).toEqual(['visible-update']);
    expect(snapshot.projectUpdates[0].updateData).toMatchObject({
      selectedAreaName: 'Canopy C',
      gpsLatitude: 33.701,
      gpsLongitude: -117.812,
      gpsAccuracy: 4.2,
      locationCapturedAt: '2026-07-22T12:00:00.000Z',
    });
    expect(snapshot.referenceDocuments.map(document => document.name)).toEqual(['Schedule.pdf']);
    expect(snapshot.referenceDocuments[0]).toMatchObject({
      projectName: null,
      projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
      cloudUpdatedAt: '2026-07-19T17:00:00.000Z',
      linkedScheduleItems: [{ id: 't1', cloudUpdatedAt: null }],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  test('drops malformed records instead of presenting invented project truth', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [{ id: 'missing-name' }],
      scheduleItems: [{ id: 'missing-task', item_data: {} }],
      projectUpdates: [{ id: 'missing-project', update_data: {} }],
      referenceDocuments: [{ id: 'missing-name', document_data: {} }],
      syncTombstones: [],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.projects).toEqual([]);
    expect(snapshot.scheduleItems).toEqual([]);
    expect(snapshot.projectUpdates).toEqual([]);
    expect(snapshot.referenceDocuments).toEqual([]);
  });

  test('excludes evidence linked to a deleted task without hiding project-only evidence', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [{ id: 'p1', name: '2375 Compliance Project', archived: false }],
      scheduleItems: [
        {
          id: 'current-task',
          item_data: {
            id: 'current-task',
            projectName: '2375 Compliance Project',
            taskName: 'Install handrails',
            status: 'In Progress',
            percentComplete: 70,
          },
        },
        {
          id: 'deleted-task',
          item_data: {
            id: 'deleted-task',
            projectName: '2375 Compliance Project',
            taskName: 'Form ramp and protective curbs',
            status: 'In Progress',
            percentComplete: 50,
          },
        },
      ],
      referenceDocuments: [],
      projectUpdates: [
        {
          id: 'current-task-update',
          project_name: '2375 Compliance Project',
          update_data: {
            id: 'current-task-update',
            scheduleItemId: 'current-task',
            scheduleTaskName: 'Install handrails',
            photos: [],
            notes: 'Current task evidence',
          },
        },
        {
          id: 'deleted-task-update',
          project_name: '2375 Compliance Project',
          update_data: {
            id: 'deleted-task-update',
            scheduleItemId: 'deleted-task',
            scheduleTaskName: 'Form ramp and protective curbs',
            photos: [],
            notes: 'Evidence from a deleted task',
          },
        },
        {
          id: 'project-only-update',
          project_name: '2375 Compliance Project',
          update_data: {
            id: 'project-only-update',
            photos: [],
            notes: 'General project evidence',
          },
        },
      ],
      syncTombstones: [{
        entity_type: 'schedule_item',
        record_id: 'deleted-task',
        deleted_at: '2026-07-19T11:00:00.000Z',
      }],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.scheduleItems.map(item => item.id)).toEqual(['current-task']);
    expect(snapshot.projectUpdates.map(update => update.id)).toEqual([
      'current-task-update',
      'project-only-update',
    ]);
  });

  test('preserves every durable project while applying deletion, safety, and schedule authority rules', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [
        { id: 'parent', name: '2375 Compliance Project', archived: false },
        { id: 'child', name: 'Canopy A', archived: false },
      ],
      scheduleItems: [
        {
          id: 'current-task',
          item_data: {
            id: 'current-task',
            scheduleProjectName: '2375 Compliance Project',
            projectName: 'Canopy A',
            locationName: 'Canopy A',
            taskName: 'Install panels',
            status: 'Complete',
            percentComplete: 100,
            priority: 'High',
            sourceDocumentId: 'current-schedule',
            createdAt: '2026-07-19T10:00:00.000Z',
          },
        },
        {
          id: 'prior-task',
          item_data: {
            id: 'prior-task',
            scheduleProjectName: '2375 Compliance Project',
            projectName: 'Canopy A',
            locationName: 'Canopy A',
            taskName: 'Old schedule activity',
            status: 'Not Started',
            percentComplete: 0,
            priority: 'Medium',
            sourceDocumentId: 'prior-schedule',
            createdAt: '2026-07-18T10:00:00.000Z',
          },
        },
        {
          id: 'deleted-task',
          item_data: {
            id: 'deleted-task',
            scheduleProjectName: '2375 Compliance Project',
            projectName: 'Canopy A',
            locationName: 'Canopy A',
            taskName: 'Deleted activity',
            status: 'In Progress',
            percentComplete: 50,
            priority: 'Medium',
            sourceDocumentId: 'current-schedule',
            createdAt: '2026-07-19T10:00:00.000Z',
          },
        },
        {
          id: 'unsafe-legacy-task',
          item_data: {
            id: 'unsafe-legacy-task',
            projectName: '2375 Compliance Project',
            taskName: 'Incomplete legacy payload',
          },
        },
      ],
      referenceDocuments: [
        {
          id: 'current-schedule',
          document_data: {
            id: 'current-schedule',
            name: 'Current Schedule.pdf',
            originalFileName: 'Current Schedule.pdf',
            category: 'Schedules',
            isCurrent: true,
            importedAt: '2026-07-19T09:00:00.000Z',
            projectName: '2375 Compliance Project',
          },
        },
        {
          id: 'prior-schedule',
          document_data: {
            id: 'prior-schedule',
            name: 'Prior Schedule.pdf',
            originalFileName: 'Prior Schedule.pdf',
            category: 'Schedules',
            isCurrent: false,
            importedAt: '2026-07-18T09:00:00.000Z',
            projectName: '2375 Compliance Project',
          },
        },
      ],
      projectUpdates: [],
      syncTombstones: [{
        entity_type: 'schedule_item',
        record_id: 'deleted-task',
        deleted_at: '2026-07-19T11:00:00.000Z',
      }],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.projects.map(project => project.name)).toEqual([
      '2375 Compliance Project',
      'Canopy A',
    ]);
    expect(snapshot.scheduleItems.map(item => item.id)).toEqual(['current-task']);
    expect(snapshot.scheduleItems[0]).toMatchObject({ status: 'Complete', percentComplete: 100 });
    expect(snapshot.referenceDocuments.map(document => [document.id, document.isCurrent])).toEqual([
      ['current-schedule', true],
      ['prior-schedule', false],
    ]);
  });

  test('matches the mobile total when a deleted duplicate upload left orphaned cloud tasks', async () => {
    const importedTask = (
      id: string,
      taskNumber: number,
      sourceDocumentId: string,
      importBatchId: string,
    ) => ({
      id,
      updated_at: '2026-07-20T23:56:29.181Z',
      item_data: {
        id,
        scheduleProjectName: taskNumber % 2 === 0
          ? '2321 Compliance Project'
          : '2375 Compliance Project',
        projectName: taskNumber % 2 === 0 ? 'North Lot' : 'Canopy C',
        locationName: taskNumber % 2 === 0 ? 'North Lot' : 'Canopy C',
        taskName: `Imported activity ${taskNumber}`,
        startDate: '2026-07-20',
        finishDate: '2026-07-27',
        status: taskNumber < 4 ? 'Complete' : 'Not Started',
        percentComplete: taskNumber < 4 ? 100 : 0,
        progressSource: 'schedule_import',
        importedFrom: 'shared-schedule.pdf',
        importedAt: '2026-07-20T23:56:29.181Z',
        sourceDocumentId,
        importBatchId,
      },
    });
    const currentTasks = Array.from({ length: 47 }, (_, index) =>
      importedTask(`current-${index}`, index, 'current-document', 'current-batch'));
    const orphanedDuplicates = Array.from({ length: 46 }, (_, index) =>
      importedTask(`orphaned-${index}`, index, 'deleted-document', 'deleted-batch'));

    mockedLoadRows.mockResolvedValue({
      projects: [
        { id: '2321', name: '2321 Compliance Project', archived: false },
        { id: '2375', name: '2375 Compliance Project', archived: false },
      ],
      scheduleItems: [
        ...currentTasks,
        ...orphanedDuplicates,
        {
          id: 'manual-1',
          item_data: {
            id: 'manual-1',
            projectName: '2321 Compliance Project',
            taskName: 'Manual task 1',
            status: 'In Progress',
            percentComplete: 50,
            progressSource: 'project_manager',
          },
        },
        {
          id: 'manual-2',
          item_data: {
            id: 'manual-2',
            projectName: '2375 Compliance Project',
            taskName: 'Manual task 2',
            status: 'Not Started',
            percentComplete: 0,
            progressSource: 'project_manager',
          },
        },
      ],
      referenceDocuments: [{
        id: 'current-document',
        updated_at: '2026-07-20T22:55:37.883Z',
        document_data: {
          id: 'current-document',
          name: 'Shared schedule.pdf',
          originalFileName: 'shared-schedule.pdf',
          category: 'Schedules',
          isCurrent: true,
          importedAt: '2026-07-20T22:55:37.883Z',
          importBatchId: 'current-batch',
        },
      }],
      projectUpdates: [],
      syncTombstones: [],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.scheduleItems).toHaveLength(49);
    expect(snapshot.scheduleItems.filter(item => item.id.startsWith('orphaned-'))).toEqual([]);
    expect(snapshot.scheduleItems.filter(item => item.id.startsWith('current-'))).toHaveLength(47);
    expect(snapshot.scheduleItems.filter(item => item.id.startsWith('manual-'))).toHaveLength(2);
  });

  test('preserves every durable same-name project id once and adds only unmatched schedule shells', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [
        { id: 'project-a', name: 'Shared Project', archived: false },
        { id: 'project-b', name: '  shared   project  ', archived: false },
        { id: 'project-b', name: 'Duplicate row for B', archived: false },
      ],
      scheduleItems: [
        {
          id: 'shared-task',
          item_data: {
            id: 'shared-task',
            scheduleProjectName: 'SHARED PROJECT',
            projectName: 'SHARED PROJECT',
            taskName: 'Shared project task',
            status: 'Not Started',
            percentComplete: 0,
          },
        },
        {
          id: 'legacy-task',
          item_data: {
            id: 'legacy-task',
            scheduleProjectName: 'Legacy Schedule Project',
            projectName: 'Legacy Schedule Project',
            taskName: 'Legacy project task',
            status: 'Not Started',
            percentComplete: 0,
          },
        },
      ],
      referenceDocuments: [],
      projectUpdates: [],
      syncTombstones: [],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.projects.map(project => [project.id, project.name])).toEqual([
      ['project-a', 'Shared Project'],
      ['project-b', '  shared   project  '],
      [null, 'Legacy Schedule Project'],
    ]);
    expect(snapshot.projects.filter(project => project.id === 'project-b')).toHaveLength(1);
    expect(snapshot.projects.filter(project => project.id === null)).toHaveLength(1);
  });

  test('keeps a legitimate document on its exact durable row id', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [{ id: 'project-b', name: 'Shared Project', archived: false }],
      scheduleItems: [],
      projectUpdates: [],
      referenceDocuments: [{
        id: 'drawing-b',
        name: 'B drawing',
        category: 'Drawing',
        updated_at: '2026-08-09T20:00:00.000Z',
        document_data: {
          id: 'drawing-b',
          name: 'B drawing',
          category: 'Drawing',
          projectId: 'project-b',
          projectName: 'Shared Project',
          isCurrent: true,
        },
      }],
      syncTombstones: [],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.referenceDocuments).toHaveLength(1);
    expect(snapshot.referenceDocuments[0]).toMatchObject({
      id: 'drawing-b',
      projectId: 'project-b',
      name: 'B drawing',
    });
  });

  test('carries exact operational project ids and quarantines row/payload disagreement', async () => {
    const scheduleRow = (
      id: string,
      rowProjectId: string,
      payloadProjectId: string,
      payloadId = id,
    ) => ({
      id,
      project_id: rowProjectId,
      item_data: {
        id: payloadId,
        projectId: payloadProjectId,
        scheduleProjectName: 'Shared Project',
        projectName: 'Shared Project',
        taskName: `Task ${id}`,
        status: 'Not Started',
        percentComplete: 0,
      },
    });
    const updateRow = (
      id: string,
      rowProjectId: string,
      payloadProjectId: string,
      payloadId = id,
    ) => ({
      id,
      project_id: rowProjectId,
      project_name: 'Shared Project',
      update_data: {
        id: payloadId,
        projectId: payloadProjectId,
        projectName: 'Shared Project',
        date: '2026-08-09T20:00:00.000Z',
        notes: `Update ${id}`,
        recipients: { contactIds: [] },
        photos: [],
      },
    });
    mockedLoadRows.mockResolvedValue({
      projects: [
        { id: 'project-a', name: 'Shared Project', archived: false },
        { id: 'project-b', name: 'Shared Project', archived: false },
      ],
      scheduleItems: [
        scheduleRow('task-a', 'project-a', 'project-a'),
        scheduleRow('task-b', 'project-b', 'project-b'),
        scheduleRow('task-forged', 'project-a', 'project-b'),
        scheduleRow('task-row-a', 'project-a', 'project-a', 'task-payload-b'),
      ],
      projectUpdates: [
        updateRow('update-a', 'project-a', 'project-a'),
        updateRow('update-b', 'project-b', 'project-b'),
        updateRow('update-forged', 'project-a', 'project-b'),
        updateRow('update-row-a', 'project-a', 'project-a', 'update-payload-b'),
      ],
      referenceDocuments: [],
      syncTombstones: [],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.scheduleItems.map(item => [item.id, item.projectId])).toEqual([
      ['task-a', 'project-a'],
      ['task-b', 'project-b'],
    ]);
    expect(snapshot.projectUpdates.map(update => [
      update.id,
      update.updateData.projectId,
    ])).toEqual([
      ['update-a', 'project-a'],
      ['update-b', 'project-b'],
    ]);
  });

  test('quarantines a row A document whose embedded id forges document B', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [
        { id: 'project-a', name: 'Shared Project', archived: false },
        { id: 'project-b', name: 'Shared Project', archived: false },
      ],
      scheduleItems: [],
      projectUpdates: [],
      referenceDocuments: [
        {
          id: 'drawing-a',
          name: 'A drawing',
          category: 'Drawing',
          updated_at: '2026-08-09T20:00:00.000Z',
          document_data: {
            id: 'drawing-b',
            name: 'Forged B drawing',
            category: 'Drawing',
            projectId: 'project-b',
            isCurrent: true,
          },
        },
        {
          id: 'drawing-malformed',
          name: 'Malformed drawing',
          category: 'Drawing',
          updated_at: '2026-08-09T20:00:00.000Z',
          document_data: {
            id: 7,
            name: 'Malformed drawing',
            category: 'Drawing',
            projectId: 'project-a',
            isCurrent: true,
          },
        },
      ],
      syncTombstones: [],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.referenceDocuments).toEqual([]);
  });
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
