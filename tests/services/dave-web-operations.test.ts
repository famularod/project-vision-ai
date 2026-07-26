import {
  buildDAVEWebReportSource,
  buildDAVEWebTruthDiagnostics,
  createDAVEWebBackup,
  daveWebReportSourceIsCurrent,
  prepareDAVEWebDocumentUpload,
  validateDAVEWebBackup,
} from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';

describe('DAVE web phase 4 operations', () => {
  it('parses a reviewed schedule file and binds immutable document/task provenance', () => {
    const prepared = prepareDAVEWebDocumentUpload({
      fileName: 'lookahead.csv',
      mimeType: 'text/csv',
      sizeBytes: 120,
      contents: 'Task,Project,Location,Start,Finish,Owner,Status,Percent Complete\nInstall panels,2375 Compliance Project,Canopy A,7/20/2026,7/27/2026,PM,In Progress,20',
      category: 'Schedules',
      projectName: '2375 Compliance Project',
      projects: ['2375 Compliance Project'],
      fingerprint: 'sha-256-test',
      now: '2026-07-20T12:00:00.000Z',
    });

    expect(prepared.extractionStatus).toBe('ready');
    expect(prepared.scheduleItems).toHaveLength(1);
    expect(prepared.document.importBatchId).toBeTruthy();
    expect(prepared.scheduleItems[0]).toMatchObject({
      taskName: 'Install panels',
      importBatchId: prepared.document.importBatchId,
      sourceDocumentId: prepared.document.id,
    });
  });

  it('does not silently make a PDF schedule current when activities cannot be reviewed', () => {
    const fingerprint = 'a'.repeat(64);
    const prepared = prepareDAVEWebDocumentUpload({
      fileName: 'schedule.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 120,
      contents: null,
      category: 'Schedules',
      projectName: '2375 Compliance Project',
      projects: ['2375 Compliance Project'],
      fingerprint,
    });
    expect(prepared.extractionStatus).toBe('needs_manual_review');
    expect(prepared.document.isCurrent).toBe(false);
    expect(prepared.scheduleItems).toEqual([]);
    expect(prepared.document.contentSha256).toBe(fingerprint);
  });

  it('stores one shared schedule for multiple projects while preserving each task project', () => {
    const prepared = prepareDAVEWebDocumentUpload({
      fileName: 'shared-lookahead.csv',
      mimeType: 'text/csv',
      sizeBytes: 240,
      contents: [
        'Task,Project,Location,Start,Finish,Owner,Status,Percent Complete',
        'Install panels,2375 Compliance Project,Canopy A,7/20/2026,7/27/2026,PM,In Progress,20',
        'Run controls,2321 Compliance Project,North Lot,7/21/2026,7/28/2026,PM,Not Started,0',
      ].join('\n'),
      category: 'Schedules',
      projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
      projects: ['2375 Compliance Project', '2321 Compliance Project'],
      fingerprint: 'shared-sha-256-test',
      now: '2026-07-20T12:00:00.000Z',
    });

    expect(prepared.document).toMatchObject({
      projectName: null,
      projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
    });
    expect(prepared.scheduleItems.map(item => item.projectName)).toEqual([
      '2375 Compliance Project',
      '2321 Compliance Project',
    ]);
    expect(new Set(prepared.scheduleItems.map(item => item.sourceDocumentId))).toEqual(new Set([prepared.document.id]));
  });

  it('reports reconciled totals and validates a portable backup without overwriting semantics', () => {
    const snapshot = {
      projects: [{ id: 'p1', name: 'Project', status: 'Active', archived: false, isFavorite: false, createdAt: null, updatedAt: null, ownerId: null, data: null }],
      scheduleItems: [
        task('a', 'Complete', 100),
        task('b', 'In Progress', 50),
      ],
      projectUpdates: [],
      referenceDocuments: [],
      refreshedAt: '2026-07-20T12:00:00.000Z',
    } as DAVEWebReadOnlySnapshot;
    expect(buildDAVEWebTruthDiagnostics(snapshot)).toMatchObject({
      projectCount: 1,
      taskCount: 2,
      completedTaskCount: 1,
      openTaskCount: 1,
      conflicts: [],
    });
    const backup = createDAVEWebBackup(snapshot);
    expect(validateDAVEWebBackup(JSON.parse(JSON.stringify(backup)))).toMatchObject({
      schemaVersion: 'vitruvius-web-backup/1.0',
      scheduleItems: expect.any(Array),
    });
  });

  it('uses a semantic report source that ignores refresh/order noise and detects changed project facts', () => {
    const original = snapshot([
      task('a', 'Complete', 100),
      task('b', 'In Progress', 50),
    ], '2026-07-20T12:00:00.000Z');
    const reorderedRefresh = snapshot([
      task('b', 'In Progress', 50),
      task('a', 'Complete', 100),
    ], '2026-07-20T12:05:00.000Z');
    const changed = snapshot([
      task('a', 'Complete', 100),
      task('b', 'Complete', 100),
    ], '2026-07-20T12:06:00.000Z');

    const source = buildDAVEWebReportSource(original, 'Alpha Project');
    const sameFacts = buildDAVEWebReportSource(reorderedRefresh, 'Alpha Project');
    const changedFacts = buildDAVEWebReportSource(changed, 'Alpha Project');

    expect(source.fingerprint).toBe(sameFacts.fingerprint);
    expect(source.fingerprint).not.toBe(changedFacts.fingerprint);
    expect(source.taskIds).toEqual(['a', 'b']);
    expect(daveWebReportSourceIsCurrent(source.fingerprint, sameFacts)).toBe(true);
    expect(daveWebReportSourceIsCurrent(source.fingerprint, changedFacts)).toBe(false);
    expect(daveWebReportSourceIsCurrent(null, sameFacts)).toBe(false);
  });

  it('does not invalidate an approved report merely because its artifact was saved', () => {
    const original = snapshot([task('a', 'In Progress', 50)], '2026-07-22T12:00:00.000Z');
    const source = buildDAVEWebReportSource(original, 'Alpha Project');
    const afterApproval = {
      ...original,
      refreshedAt: '2026-07-22T12:01:00.000Z',
      referenceDocuments: [{
        id: 'report-1',
        name: 'Alpha Project Report',
        originalFileName: 'alpha-project-report.md',
        uri: '',
        mimeType: 'text/markdown',
        category: 'Report',
        notes: 'Approved project report',
        isCurrent: true,
        importedAt: '2026-07-22T12:00:30.000Z',
        projectId: null,
        projectName: 'Alpha Project',
        projectNames: [],
        importBatchId: null,
        cloudUpdatedAt: '2026-07-22T12:00:31.000Z',
        linkedScheduleItems: [],
      }],
    } as DAVEWebReadOnlySnapshot;

    expect(buildDAVEWebReportSource(afterApproval, 'Alpha Project').fingerprint).toBe(
      source.fingerprint,
    );
  });

  it('invalidates report freshness when GPS or photo intelligence changes', () => {
    const base = snapshotWithPhoto({
      gpsLatitude: 33.7,
      gpsLongitude: -117.8,
      visibleChange: 'No material change.',
    });
    const changedGps = snapshotWithPhoto({
      gpsLatitude: 33.71,
      gpsLongitude: -117.8,
      visibleChange: 'No material change.',
    });
    const changedIntelligence = snapshotWithPhoto({
      gpsLatitude: 33.7,
      gpsLongitude: -117.8,
      visibleChange: 'Rebar was installed.',
    });

    const baseFingerprint = buildDAVEWebReportSource(base, 'Alpha Project').fingerprint;
    expect(buildDAVEWebReportSource(base, 'Alpha Project').updateIds).toEqual(['update-1']);
    expect(buildDAVEWebReportSource(changedGps, 'Alpha Project').fingerprint).not.toBe(baseFingerprint);
    expect(buildDAVEWebReportSource(changedIntelligence, 'Alpha Project').fingerprint).not.toBe(baseFingerprint);
  });
});

function snapshotWithPhoto({
  gpsLatitude,
  gpsLongitude,
  visibleChange,
}: {
  gpsLatitude: number;
  gpsLongitude: number;
  visibleChange: string;
}): DAVEWebReadOnlySnapshot {
  const base = snapshot([task('a', 'In Progress', 50)], '2026-07-22T12:00:00.000Z');
  return {
    ...base,
    projectUpdates: [{
      id: 'update-1',
      projectName: 'Alpha Project',
      areaName: 'Area',
      idempotencyKey: null,
      createdAt: '2026-07-22T11:00:00.000Z',
      updatedAt: '2026-07-22T11:00:00.000Z',
      ownerId: 'owner-1',
      updateData: {
        id: 'update-1',
        projectName: 'Alpha Project',
        scheduleProjectName: 'Alpha Project',
        scheduleItemId: 'a',
        scheduleTaskName: 'Task a',
        selectedAreaName: 'Area',
        date: '2026-07-22T11:00:00.000Z',
        notes: 'Ramp progress.',
        recipients: { contactIds: [] },
        photos: [{
          id: 'photo-1',
          uri: '',
          caption: 'Ramp',
          category: 'Update',
          actionRequired: '',
          actionOwner: '',
          actionDueDate: '',
          actionStatus: 'Open',
          selectedAreaName: 'Area',
          gpsLatitude,
          gpsLongitude,
          photoIntelligence: {
            status: 'analysis_complete',
            title: 'Ramp progress',
            summary: visibleChange,
            visibleChange,
            location: 'Area',
            comparisonConfidence: 'high',
            comparability: 'comparable',
            captureLimitations: [],
            projectProgress: 'supported',
            repeatPhotoGuidance: null,
            authorityMessage: 'Review current condition.',
            updatedAt: '2026-07-22T11:00:00.000Z',
          },
        }],
      },
    }],
  };
}

function snapshot(
  scheduleItems: ReturnType<typeof task>[],
  refreshedAt: string,
): DAVEWebReadOnlySnapshot {
  return {
    projects: [{ id: 'p1', name: 'Alpha Project', status: 'Active', archived: false, isFavorite: false, createdAt: null, updatedAt: null, ownerId: null, data: null }],
    scheduleItems,
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt,
  };
}

function task(id: string, status: 'Complete' | 'In Progress', percentComplete: number) {
  return {
    id,
    scheduleProjectName: 'Alpha Project',
    projectName: 'Alpha Project',
    projectTimeZone: null,
    locationName: 'Area',
    taskName: `Task ${id}`,
    startDate: '2026-07-20',
    finishDate: '2026-07-27',
    milestone: '',
    owner: '',
    contractor: '',
    durationDays: null,
    percentComplete,
    progressSource: 'project_manager' as const,
    progressConfirmedAt: null,
    progressConfirmedBy: null,
    priority: 'Medium' as const,
    status,
    notes: '',
    importedFrom: null,
    importedAt: null,
    importBatchId: null,
    sourceDocumentId: null,
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
    cloudUpdatedAt: '2026-07-20T12:00:00.000Z',
  };
}
