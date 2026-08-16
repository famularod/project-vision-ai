import {
  buildDAVEWebReportDraft,
  buildDAVEWebReportSource,
  buildDAVEWebReportTitle,
  buildDAVEWebTruthDiagnostics,
  createDAVEWebBackup,
  daveWebPersistedReportSourceIsAuthorized,
  daveWebReportSourceIsCurrent,
  formatDAVEWebReport,
  prepareDAVEWebLinkedDocument,
  prepareDAVEWebDocumentUpload,
  recoverDAVEWebPreparedUploadBytes,
  validateDAVEWebBackup,
} from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';

const ALPHA_PROJECT_SELECTION = Object.freeze({
  projectId: 'p1',
  projectName: 'Alpha Project',
});

describe('DAVE web phase 4 operations', () => {
  it('prepares a large Google Drive drawing without applying the 50 MB Supabase upload limit', () => {
    const sizeBytes = 140 * 1024 * 1024;
    const prepared = prepareDAVEWebLinkedDocument({
      fileName: 'Architectural.pdf',
      mimeType: 'application/pdf',
      sizeBytes,
      contents: 'A1.01 FLOOR PLAN',
      category: 'Drawing',
      projectId: '2375abcd-0000-4000-8000-000000000001',
      projectNames: ['2375 Compliance Project'],
      projects: ['2375 Compliance Project'],
      fingerprint: 'a'.repeat(64),
      maximumBytes: 250 * 1024 * 1024,
      externalSource: {
        provider: 'google_drive',
        fileId: 'drive-file-1',
        name: 'Architectural.pdf',
        mimeType: 'application/pdf',
        sizeBytes,
        modifiedTime: '2026-08-04T12:00:00.000Z',
        revisionId: 'revision-3',
        md5Checksum: 'drive-md5',
        resourceKey: null,
        webViewLink: 'https://drive.google.com/file/d/drive-file-1/view',
      },
    });

    expect(prepared.document).toMatchObject({
      projectId: '2375abcd-0000-4000-8000-000000000001',
      sourceProvider: 'google_drive',
      sizeBytes,
      externalSource: { fileId: 'drive-file-1', revisionId: 'revision-3' },
    });
    expect(prepared.document).not.toHaveProperty('storagePath');
    expect(prepared.reviewMessage).toMatch(/original PDF will remain in Google Drive/i);
  });

  it('fails closed when a drawing has only a display name or multiple project scopes', () => {
    const common = {
      fileName: 'A101.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      contents: null,
      category: 'Drawing',
      projects: ['Shared Project'],
      fingerprint: 'c'.repeat(64),
    };
    expect(() => prepareDAVEWebDocumentUpload({
      ...common,
      projectNames: ['Shared Project'],
    })).toThrow(/one exact project/i);
    expect(() => prepareDAVEWebDocumentUpload({
      ...common,
      projectId: '2375abcd-0000-4000-8000-000000000001',
      projectNames: ['Shared Project', 'Shared Project B'],
    })).toThrow(/multiple display-name scopes/i);
  });

  it('keeps schedule task imports on the protected upload workflow', () => {
    expect(() => prepareDAVEWebLinkedDocument({
      fileName: 'schedule.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      contents: 'schedule',
      category: 'Schedules',
      projectNames: ['2375 Compliance Project'],
      projects: ['2375 Compliance Project'],
      fingerprint: 'b'.repeat(64),
      maximumBytes: 250 * 1024 * 1024,
      externalSource: {
        provider: 'google_drive',
        fileId: 'drive-schedule',
        name: 'schedule.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        modifiedTime: null,
        revisionId: null,
        md5Checksum: null,
        resourceKey: null,
        webViewLink: null,
      },
    })).toThrow(/schedule imports/i);
  });

  it('recovers a reviewed 4.4 MB file when PDF extraction detached its upload buffer', async () => {
    const expectedSizeBytes = Math.round(4.4 * 1024 * 1024);
    const file = new Blob([new Uint8Array(expectedSizeBytes)], {
      type: 'application/pdf',
    });

    const recovered = await recoverDAVEWebPreparedUploadBytes({
      bytes: new ArrayBuffer(0),
      file,
      expectedSizeBytes,
    });

    expect(recovered.byteLength).toBe(expectedSizeBytes);
  });

  it('parses a reviewed schedule file and binds immutable document/task provenance', () => {
    const projectId = '2375abcd-0000-4000-8000-000000000001';
    const prepared = prepareDAVEWebDocumentUpload({
      fileName: 'lookahead.csv',
      mimeType: 'text/csv',
      sizeBytes: 120,
      contents: 'Task,Project,Location,Start,Finish,Owner,Status,Percent Complete\nInstall panels,2375 Compliance Project,Canopy A,7/20/2026,7/27/2026,PM,In Progress,20',
      category: 'Schedules',
      projectId,
      projectName: '2375 Compliance Project',
      projectRecords: [{ id: projectId, name: '2375 Compliance Project' }],
      projects: ['2375 Compliance Project'],
      fingerprint: 'sha-256-test',
      now: '2026-07-20T12:00:00.000Z',
    });

    expect(prepared.extractionStatus).toBe('ready');
    expect(prepared.scheduleItems).toHaveLength(1);
    expect(prepared.document.importBatchId).toBeTruthy();
    expect(prepared.scheduleItems[0]).toMatchObject({
      projectId,
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
    const firstProjectId = '2375abcd-0000-4000-8000-000000000001';
    const secondProjectId = '2321abcd-0000-4000-8000-000000000002';
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
      projectRecords: [
        { id: firstProjectId, name: '2375 Compliance Project' },
        { id: secondProjectId, name: '2321 Compliance Project' },
      ],
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
    expect(prepared.scheduleItems.map(item => item.projectId)).toEqual([
      firstProjectId,
      secondProjectId,
    ]);
    expect(new Set(prepared.scheduleItems.map(item => item.sourceDocumentId))).toEqual(new Set([prepared.document.id]));
  });

  it('rejects a schedule task when its display name does not resolve to one exact project', () => {
    expect(() => prepareDAVEWebDocumentUpload({
      fileName: 'ambiguous-lookahead.csv',
      mimeType: 'text/csv',
      sizeBytes: 120,
      contents: 'Task,Project,Location,Start,Finish,Owner,Status,Percent Complete\nInstall panels,Shared Project,Canopy A,7/20/2026,7/27/2026,PM,In Progress,20',
      category: 'Schedules',
      projectName: 'Shared Project',
      projectRecords: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Shared Project' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Shared Project' },
      ],
      projects: ['Shared Project'],
      fingerprint: 'ambiguous-sha-256-test',
      now: '2026-07-20T12:00:00.000Z',
    })).toThrow(/one exact project ID/i);
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

    const source = buildDAVEWebReportSource(original, ALPHA_PROJECT_SELECTION);
    const sameFacts = buildDAVEWebReportSource(reorderedRefresh, ALPHA_PROJECT_SELECTION);
    const changedFacts = buildDAVEWebReportSource(changed, ALPHA_PROJECT_SELECTION);

    expect(source.fingerprint).toMatch(
      /^dave-report-source\/1\.0:[a-f0-9]{64}:media-[a-f0-9]{64}$/,
    );
    expect(source.fingerprint).toBe(sameFacts.fingerprint);
    expect(source.fingerprint).not.toBe(changedFacts.fingerprint);
    expect(source.taskIds).toEqual(['a', 'b']);
    expect(daveWebReportSourceIsCurrent(source.fingerprint, sameFacts)).toBe(true);
    expect(daveWebReportSourceIsCurrent(source.fingerprint, changedFacts)).toBe(false);
    expect(daveWebReportSourceIsCurrent(null, sameFacts)).toBe(false);
  });

  it('generates distinct project manager and executive reports from the same facts', () => {
    const current = snapshot([
      task('a', 'Complete', 100),
      task('b', 'In Progress', 50),
    ], '2026-07-20T12:00:00.000Z');
    const briefing = buildDAVEWebReportDraft(current, ALPHA_PROJECT_SELECTION);
    const projectManagerReport = formatDAVEWebReport(briefing, 'project_manager');
    const executiveReport = formatDAVEWebReport(briefing, 'executive');

    expect(buildDAVEWebReportTitle(briefing, 'project_manager')).toBe(
      'Alpha Project — Project Manager Report',
    );
    expect(buildDAVEWebReportTitle(briefing, 'executive')).toBe(
      'Alpha Project — Executive Summary',
    );
    expect(projectManagerReport).toContain('## Current Work');
    expect(projectManagerReport).toContain('## Next Actions');
    expect(executiveReport).toContain('## Executive Snapshot');
    expect(executiveReport).toContain('## Management Actions');
    expect(executiveReport).not.toContain('## Current Work');
    expect(executiveReport).not.toBe(projectManagerReport);
  });

  it('fails closed when report selection is missing, malformed, or disagrees with the durable project', () => {
    const current = snapshot([task('a', 'In Progress', 50)], '2026-07-20T12:00:00.000Z');

    expect(() => buildDAVEWebReportDraft(current, {
      projectId: ' p1 ',
      projectName: 'Alpha Project',
    })).toThrow(/one exact project/i);
    expect(() => buildDAVEWebReportSource(current, {
      projectId: 'p1',
      projectName: 'Other Project',
    })).toThrow(/selected project changed/i);
    expect(() => buildDAVEWebReportSource(current, {
      projectId: '',
      projectName: 'Alpha Project',
    })).toThrow(/one exact project/i);
  });

  it('does not invalidate an approved report merely because its artifact was saved', () => {
    const original = snapshot([task('a', 'In Progress', 50)], '2026-07-22T12:00:00.000Z');
    const source = buildDAVEWebReportSource(original, ALPHA_PROJECT_SELECTION);
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

    expect(buildDAVEWebReportSource(afterApproval, ALPHA_PROJECT_SELECTION).fingerprint).toBe(
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

    const baseFingerprint = buildDAVEWebReportSource(base, ALPHA_PROJECT_SELECTION).fingerprint;
    expect(buildDAVEWebReportSource(base, ALPHA_PROJECT_SELECTION).updateIds).toEqual(['update-1']);
    expect(buildDAVEWebReportSource(changedGps, ALPHA_PROJECT_SELECTION).fingerprint).not.toBe(baseFingerprint);
    expect(buildDAVEWebReportSource(changedIntelligence, ALPHA_PROJECT_SELECTION).fingerprint).not.toBe(baseFingerprint);
  });

  it('binds each report photo to its exact update, storage object, and available byte digest', () => {
    const original = snapshotWithPhoto({
      gpsLatitude: 33.7,
      gpsLongitude: -117.8,
      visibleChange: 'No material change.',
    });
    const source = buildDAVEWebReportSource(original, ALPHA_PROJECT_SELECTION);
    const replacedPath = {
      ...original,
      projectUpdates: original.projectUpdates.map(record => ({
        ...record,
        updateData: {
          ...record.updateData,
          photos: record.updateData.photos.map(photo => ({
            ...photo,
            cloudStoragePath: 'owner-1/project-b/replacement.jpg',
          })),
        },
      })),
    };

    expect(source.media).toEqual([{
      bucket: 'project-photos',
      projectId: 'p1',
      updateId: 'update-1',
      photoId: 'photo-1',
      storagePath: 'owner-1/project-a/photo-1.jpg',
      contentSha256: 'a'.repeat(64),
    }]);
    expect(buildDAVEWebReportSource(
      replacedPath as DAVEWebReadOnlySnapshot,
      ALPHA_PROJECT_SELECTION,
    ).fingerprint).not.toBe(source.fingerprint);
    const persisted = {
      status: 'approved' as const,
      title: 'Photo report',
      body: 'Approved photo evidence.',
      generatedAt: source.refreshedAt,
      sourceRefreshedAt: source.refreshedAt,
      sourceFingerprint: source.fingerprint,
      sourceScopeKey: source.scopeKey,
      sourceTaskIds: source.taskIds,
      sourceUpdateIds: source.updateIds,
      sourceDocumentIds: source.documentIds,
      audit: [],
    };
    expect(daveWebPersistedReportSourceIsAuthorized(persisted, source)).toBe(false);
    expect(daveWebPersistedReportSourceIsAuthorized({
      ...persisted,
      sourceMedia: source.media,
    }, source)).toBe(true);
  });

  it('never rebinds an unbound legacy fact after a same-name sibling leaves the active portfolio', () => {
    const exactTask = {
      ...task('task-b', 'In Progress', 50),
      projectId: 'project-b',
      projectName: 'Shared Project',
      scheduleProjectName: 'Shared Project',
      taskName: 'B exact task',
    };
    const legacyTask = {
      ...task('legacy-a', 'In Progress', 50),
      projectId: null,
      projectName: 'Shared Project',
      scheduleProjectName: 'Shared Project',
      taskName: 'Archived A legacy fact',
    };
    const afterArchive = {
      projects: [{ id: 'project-b', name: 'Shared Project' }],
      scheduleItems: [exactTask, legacyTask],
      projectUpdates: [],
      referenceDocuments: [],
      refreshedAt: '2026-08-09T21:00:00.000Z',
    } as DAVEWebReadOnlySnapshot;

    const briefing = buildDAVEWebReportDraft(afterArchive, {
      projectId: 'project-b',
      projectName: 'Shared Project',
    });
    const source = buildDAVEWebReportSource(afterArchive, {
      projectId: 'project-b',
      projectName: 'Shared Project',
    });

    expect(JSON.stringify(briefing)).toContain('B exact task');
    expect(JSON.stringify(briefing)).not.toContain('Archived A legacy fact');
    expect(source.taskIds).toEqual(['task-b']);
  });

  it('builds and fingerprints same-name project B from immutable ids without A facts', () => {
    const sharedTask = (id: string, projectId: string, label: string) => ({
      ...task(id, 'In Progress', 50),
      projectId,
      scheduleProjectName: 'Shared Project',
      projectName: 'Shared Project',
      taskName: label,
    });
    const sharedUpdate = (id: string, projectId: string, notes: string) => ({
      id,
      projectName: 'Shared Project',
      areaName: 'Area',
      idempotencyKey: null,
      createdAt: '2026-08-09T20:00:00.000Z',
      updatedAt: '2026-08-09T20:00:00.000Z',
      ownerId: 'owner-1',
      updateData: {
        id,
        projectId,
        projectName: 'Shared Project',
        date: '2026-08-09T20:00:00.000Z',
        notes,
        recipients: { contactIds: [] },
        photos: [],
      },
    });
    const sharedDocument = (id: string, projectId: string, name: string) => ({
      id,
      name,
      originalFileName: `${name}.pdf`,
      uri: '',
      mimeType: 'application/pdf',
      category: 'Drawing',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-09T20:00:00.000Z',
      projectId,
      projectName: 'Shared Project',
      projectNames: ['Shared Project'],
      importBatchId: null,
      cloudUpdatedAt: '2026-08-09T20:00:00.000Z',
      linkedScheduleItems: [],
    });
    const sameNameSnapshot = {
      projects: [
        { id: 'project-a', name: 'Shared Project' },
        { id: 'project-b', name: 'Shared Project' },
      ],
      scheduleItems: [
        sharedTask('task-a', 'project-a', 'A only task'),
        sharedTask('task-b', 'project-b', 'B only task'),
        { ...sharedTask('task-legacy', '', 'Ambiguous legacy task'), projectId: null },
      ],
      projectUpdates: [
        sharedUpdate('update-a', 'project-a', 'A only update'),
        sharedUpdate('update-b', 'project-b', 'B only update'),
        sharedUpdate('update-legacy', '', 'Ambiguous legacy update'),
      ],
      referenceDocuments: [
        sharedDocument('document-a', 'project-a', 'A only drawing'),
        sharedDocument('document-b', 'project-b', 'B only drawing'),
        sharedDocument('document-legacy', '', 'Ambiguous legacy drawing'),
      ],
      refreshedAt: '2026-08-09T20:05:00.000Z',
    } as DAVEWebReadOnlySnapshot;
    const selection = { projectId: 'project-b', projectName: 'Shared Project' };

    const briefing = buildDAVEWebReportDraft(sameNameSnapshot, selection);
    const source = buildDAVEWebReportSource(sameNameSnapshot, selection);
    const rendered = JSON.stringify(briefing);

    expect(rendered).toContain('B only task');
    expect(rendered).not.toContain('A only task');
    expect(rendered).not.toContain('A only update');
    expect(rendered).not.toContain('Ambiguous legacy');
    expect(source).toMatchObject({
      scopeKey: 'project-id:project-b',
      taskIds: ['task-b'],
      updateIds: ['update-b'],
      documentIds: ['document-b'],
    });
    const legitimateReport = {
      status: 'approved' as const,
      title: 'B report',
      body: 'B facts only.',
      generatedAt: '2026-08-09T20:05:00.000Z',
      sourceRefreshedAt: source.refreshedAt,
      sourceFingerprint: source.fingerprint,
      sourceScopeKey: source.scopeKey,
      sourceTaskIds: source.taskIds,
      sourceUpdateIds: source.updateIds,
      sourceDocumentIds: source.documentIds,
      audit: [],
    };
    expect(daveWebPersistedReportSourceIsAuthorized(legitimateReport, source)).toBe(true);
    expect(daveWebPersistedReportSourceIsAuthorized({
      ...legitimateReport,
      sourceTaskIds: ['task-a'],
      sourceUpdateIds: ['update-a'],
      sourceDocumentIds: ['document-a'],
    }, source)).toBe(false);
    expect(daveWebPersistedReportSourceIsAuthorized({
      ...legitimateReport,
      sourceTaskIds: ['task-b', 'task-b'],
    }, source)).toBe(false);
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
        projectId: 'p1',
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
          cloudStoragePath: 'owner-1/project-a/photo-1.jpg',
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
            diagnostics: {
              currentPhotoAssetId: 'photo-1',
              priorPhotoAssetId: null,
              currentEvidenceId: 'evidence-photo-1',
              priorEvidenceId: null,
              currentStoragePathHash: null,
              priorStoragePathHash: null,
              currentImageByteSize: 1024,
              priorImageByteSize: null,
              currentImageSha256: 'a'.repeat(64),
              priorImageSha256: null,
              imageHashesDifferent: null,
              signedUrlsGenerated: true,
              providerInvocationId: null,
              providerResponseStatus: null,
              analysisRequestId: null,
              semanticComparisonResultId: null,
              selectedPriorPhotoId: null,
              selectionCandidateCount: 0,
              selectedPriorReason: null,
              rejectedPriorReasons: [],
              resultPairMatchesRequestedPair: null,
              resultProvenance: 'visual_only',
              executedStages: [],
            } as any,
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
    projectId: 'p1',
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
