import {
  buildDAVEWebReportDraft,
  buildDAVEWebReportSource,
  buildDAVEWebReportTitle,
  buildDAVEWebTruthDiagnostics,
  createDAVEWebBackup,
  daveWebReportSourceIsCurrent,
  formatDAVEWebReport,
  prepareDAVEWebLinkedDocument,
  prepareDAVEWebReportEmailBody,
  DAVE_WEB_REPORT_EMAIL_SHORTENED,
  prepareDAVEWebDocumentUpload,
  planDAVEWebScheduleImport,
  recoverDAVEWebPreparedUploadBytes,
  validateDAVEWebBackup,
} from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { createReportedCompletionVerification } from '../../services/DAVECompletionVerification';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

describe('DAVE web phase 4 operations', () => {
  it('prepares a large Google Drive drawing without applying the 50 MB Supabase upload limit', () => {
    const sizeBytes = 140 * 1024 * 1024;
    const prepared = prepareDAVEWebLinkedDocument({
      fileName: 'Architectural.pdf',
      mimeType: 'application/pdf',
      sizeBytes,
      contents: 'A1.01 FLOOR PLAN',
      category: 'Drawing',
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
      sourceProvider: 'google_drive',
      sizeBytes,
      externalSource: { fileId: 'drive-file-1', revisionId: 'revision-3' },
    });
    expect(prepared.document).not.toHaveProperty('storagePath');
    expect(prepared.reviewMessage).toMatch(/original PDF will remain in Google Drive/i);
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

  it('imports only positioned Microsoft Project leaf activities from a web PDF', () => {
    const extractedPages = [microsoftProjectSchedulePage([
      ['1', 'PLZ CORP CAMPUS COMPLIANCE', 0, '417 days', 'Wed 9/3/25', 'Wed 4/7/27', '79%'],
      ['2', 'PLZ 2321 THIRD STREET CAMPUS', 1, '417 days', 'Wed 9/3/25', 'Wed 4/7/27', '72%'],
      ['3', 'PHASE 2 - NORTH LOT & DRIVEWAY', 2, '20 days', 'Mon 6/22/26', 'Fri 7/17/26', '0%'],
      ['4', 'PLACE CONCRETE PAVING (NORTH LOT)', 3, '2 days', 'Thu 7/2/26', 'Fri 7/3/26', '50%'],
      ['5', 'PLZ 2375 THIRD STREET CAMPUS', 1, '30 days', 'Mon 6/22/26', 'Fri 7/31/26', '0%'],
      ['6', 'CANOPY B', 2, '10 days', 'Mon 6/22/26', 'Fri 7/3/26', '0%'],
      ['7', 'FORM COLUMN CONCRETE BASES', 3, '1 day', 'Thu 7/2/26', 'Thu 7/2/26', '100%'],
    ])];
    const prepared = prepareDAVEWebDocumentUpload({
      fileName: 'PLZ 2321 & 2375 MASTER CONSTRUCTION SCHEDULE.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 536_000,
      contents: [
        'ID Task Name',
        'Duration Start',
        'Finish',
        '% Actual Start Actual Finish',
        'Qtr 1, 2026',
        'Jan Feb Mar Apr',
        'Task Summary Inactive Milestone Duration-only',
        'Project: PLZ 2321 & 2375 MAST',
        'Date: Mon 8/31/26',
        'Page 1',
      ].join('\n'),
      extractedPages,
      category: 'Schedules',
      projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
      projects: ['2375 Compliance Project', '2321 Compliance Project'],
      fingerprint: 'c'.repeat(64),
      now: '2026-08-31T12:00:00.000Z',
    });

    expect(prepared.extractionStatus).toBe('ready');
    expect(prepared.scheduleItems).toHaveLength(2);
    expect(prepared.scheduleItems.map(item => item.taskName)).toEqual([
      'PLACE CONCRETE PAVING (NORTH LOT)',
      'FORM COLUMN CONCRETE BASES',
    ]);
    expect(prepared.scheduleItems.map(item => item.scheduleProjectName)).toEqual([
      '2321 Compliance Project',
      '2375 Compliance Project',
    ]);
    expect(prepared.scheduleItems.map(item => item.projectName)).toEqual([
      '2321 Compliance Project',
      '2375 Compliance Project',
    ]);
    expect(prepared.scheduleItems.map(item => item.taskName)).not.toEqual(
      expect.arrayContaining(['ID Task Name', 'Duration Start', 'Qtr 1, 2026', 'Page 1']),
    );
  });

  it('fails a readable PDF schedule closed when positioned activity rows are unavailable', () => {
    const prepared = prepareDAVEWebDocumentUpload({
      fileName: 'fragmented-schedule.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 120,
      contents: 'ID Task Name\nDuration Start\nFinish\nQtr 1, 2026\nPage 1\n7/2/2026',
      category: 'Schedules',
      projectName: '2375 Compliance Project',
      projects: ['2375 Compliance Project'],
      fingerprint: 'd'.repeat(64),
    });

    expect(prepared.extractionStatus).toBe('needs_manual_review');
    expect(prepared.scheduleItems).toEqual([]);
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

  it('generates distinct project manager and executive reports from the same facts', () => {
    const current = snapshot([
      task('a', 'Complete', 100),
      task('b', 'In Progress', 50),
    ], '2026-07-20T12:00:00.000Z');
    const briefing = buildDAVEWebReportDraft(current, 'Alpha Project');
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
        // Required since audit A5 pass 3 F5: the tasks a schedule import contains.
        importedScheduleItemCount: 0,
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

function microsoftProjectSchedulePage(
  rows: Array<[string, string, number, string, string, string, string]>,
) {
  const regions: any[] = [];
  const addRegion = (text: string, x: number, y: number, width = 0.04) => {
    regions.push({
      id: `region-${regions.length + 1}`,
      text,
      label: text,
      x,
      y,
      width,
      height: 0.01,
      source: 'embedded_text',
      confidence: 1,
    });
  };
  [
    ['ID', 0.03],
    ['Task Name', 0.05],
    ['Duration', 0.31],
    ['Start', 0.36],
    ['Finish', 0.41],
    ['%', 0.46],
    ['Actual Start', 0.49],
    ['Actual Finish', 0.55],
    ['Qtr 1, 2026', 0.61],
  ].forEach(([text, x]) => addRegion(String(text), Number(x), 0.02));

  rows.forEach(([id, taskName, indent, duration, start, finish, percentComplete], index) => {
    const y = 0.05 + index * 0.02;
    const taskX = 0.05 + indent * 0.007;
    regions.push({
      id: `activity-${id}`,
      text: `${id} ${taskName}`,
      label: `${id} ${taskName}`,
      x: 0.03,
      y,
      width: 0.26,
      height: 0.01,
      source: 'embedded_text',
      confidence: 1,
      constituentEvidence: [{
        id: `activity-${id}-id`,
        text: id,
        source: 'embedded_text',
        confidence: 1,
        bounds: { x: 0.03, y, width: 0.012, height: 0.01 },
      }, {
        id: `activity-${id}-task`,
        text: taskName,
        source: 'embedded_text',
        confidence: 1,
        bounds: { x: taskX, y, width: 0.29 - taskX, height: 0.01 },
      }],
    });
    addRegion(duration, 0.31, y);
    addRegion(start, 0.36, y);
    addRegion(finish, 0.41, y);
    addRegion(percentComplete, 0.46, y, 0.025);
  });
  addRegion('Task Summary Inactive Milestone', 0.12, 0.82, 0.3);
  addRegion('Project: PLZ 2321 & 2375 MAST', 0.03, 0.86, 0.3);
  addRegion('Date: Mon 8/31/26', 0.03, 0.88, 0.16);
  addRegion('Page 1', 0.49, 0.9, 0.05);

  return {
    pageNumber: 1,
    text: regions.map(region => region.text).join('\n'),
    regions,
  };
}

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

// Code review, 27 Sep 2026: the desktop cut a long report at 12,000
// characters mid-sentence and said nothing.
describe('desktop report email body', () => {
  it('leaves a report that fits unchanged', () => {
    expect(prepareDAVEWebReportEmailBody('  Short report.\n')).toEqual({ text: 'Short report.', shortened: false });
  });

  it('cuts a long report at a line break, marks it, and says so', () => {
    const lines = Array.from({ length: 400 }, (_, index) => `Line ${index}: ${'x'.repeat(40)}`);
    const result = prepareDAVEWebReportEmailBody(lines.join('\n'), 2_000);
    expect(result.shortened).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(2_000);
    expect(result.text.endsWith(`\n\n${DAVE_WEB_REPORT_EMAIL_SHORTENED}`)).toBe(true);
    const kept = result.text.slice(0, -(DAVE_WEB_REPORT_EMAIL_SHORTENED.length + 2)).split('\n');
    expect(kept.every(line => /^Line \d+: x{40}$/.test(line))).toBe(true);
  });
});

// Whole-app audit A5 pass 3 F5 (30 Sep 2026): the web saved every row of a
// revised schedule as a new task at the file's percent, so making it current
// hid the manager's progress everywhere. The upload now joins the file to the
// tasks the web shows, as the phone's approval does. Synthetic schedule data.
describe('web schedule import plan (audit A5 pass 3 F5)', () => {
  const HEADER = 'Task,Project,Location,Start,Finish,Owner,Status,Percent Complete';

  function upload(version: string, rows: readonly string[]) {
    return prepareDAVEWebDocumentUpload({
      fileName: `alpha-${version}.csv`,
      mimeType: 'text/csv',
      sizeBytes: 200,
      contents: [HEADER, ...rows].join('\n'),
      category: 'Schedules',
      projectName: 'Alpha Tower',
      projects: ['Alpha Tower'],
      fingerprint: version.padEnd(64, '0'),
      now: '2026-09-01T12:00:00.000Z',
    });
  }

  function saved(item: ScheduleItem, changes: Partial<ScheduleItem> = {}): DAVEWebScheduleItem {
    return { ...item, ...changes, cloudUpdatedAt: `cloud-${item.taskName}-${item.finishDate}` };
  }

  function manager(percentComplete: number): Partial<ScheduleItem> {
    return {
      percentComplete,
      status: percentComplete >= 100 ? 'Complete' : 'In Progress',
      progressSource: 'project_manager',
      progressConfirmedAt: '2026-09-10T12:00:00.000Z',
      progressConfirmedBy: 'PM',
    };
  }

  const byName = (items: readonly ScheduleItem[], taskName: string) =>
    items.find(item => item.taskName === taskName)!;

  it('re-homes an unchanged task with its id, progress and owner, and adds only the new task', () => {
    const first = upload('r1', ['Frame walls,Alpha Tower,Level 1,9/1/2026,9/5/2026,,Not Started,0']);
    const framing = saved(first.scheduleItems[0], { ...manager(60), owner: 'Framing Co', notes: 'Crew of six' });
    const revised = upload('r2', [
      'Frame walls,Alpha Tower,Level 1,9/1/2026,9/5/2026,,Not Started,0',
      'Paint,Alpha Tower,Level 1,9/16/2026,9/20/2026,,Not Started,0',
    ]);

    const plan = planDAVEWebScheduleImport({
      snapshot: { scheduleItems: [framing] },
      importedScheduleItems: revised.scheduleItems,
    });

    expect(plan.additions.map(item => item.taskName)).toEqual(['Paint']);
    expect(plan.revisions).toHaveLength(1);
    const [revision] = plan.revisions;
    expect(revision.cloudUpdatedAt).toBe(framing.cloudUpdatedAt);
    expect(revision.item).toMatchObject({
      id: framing.id,
      percentComplete: 60,
      owner: 'Framing Co',
      notes: 'Crew of six',
      importBatchId: first.document.importBatchId,
      alsoImportedInBatchIds: [revised.document.importBatchId],
    });
    // Browser-only revision metadata never reaches the saved task.
    expect(revision.item).not.toHaveProperty('cloudUpdatedAt');
    expect(revision.previous).not.toHaveProperty('cloudUpdatedAt');
    expect(revision.previous).toMatchObject({ id: framing.id, percentComplete: 60 });
    expect(revision.previous.alsoImportedInBatchIds).toBeUndefined();
  });

  it('carries the manager\'s 100% and 60% onto tasks whose dates changed', () => {
    const first = upload('r1', [
      'Pour slab,Alpha Tower,Level 1,9/2/2026,9/4/2026,,Not Started,0',
      'Hang drywall,Alpha Tower,Level 1,9/8/2026,9/12/2026,,Not Started,0',
    ]);
    const current = [
      saved(byName(first.scheduleItems, 'Pour slab'), manager(100)),
      saved(byName(first.scheduleItems, 'Hang drywall'), { ...manager(60), owner: 'Drywall Co' }),
    ];
    const revised = upload('r2', [
      'Pour slab,Alpha Tower,Level 1,9/3/2026,9/5/2026,,Not Started,0',
      'Hang drywall,Alpha Tower,Level 1,9/10/2026,9/15/2026,,Not Started,0',
    ]);

    const plan = planDAVEWebScheduleImport({
      snapshot: { scheduleItems: current },
      importedScheduleItems: revised.scheduleItems,
    });

    expect(plan.revisions).toEqual([]);
    expect(byName(plan.additions, 'Pour slab')).toMatchObject({
      id: byName(revised.scheduleItems, 'Pour slab').id,
      startDate: '09/03/2026',
      percentComplete: 100,
      status: 'Complete',
      progressSource: 'project_manager',
      importBatchId: revised.document.importBatchId,
    });
    expect(byName(plan.additions, 'Hang drywall')).toMatchObject({
      finishDate: '09/15/2026',
      percentComplete: 60,
      status: 'In Progress',
      owner: 'Drywall Co',
    });
  });

  it('carries nothing when two tasks the manager sees could be the revised one', () => {
    const first = upload('r1', [
      'Install panels,Alpha Tower,Level 1,9/1/2026,9/3/2026,,Not Started,0',
      'Install panels,Alpha Tower,Level 1,9/8/2026,9/10/2026,,Not Started,0',
    ]);
    const current = first.scheduleItems.map((item, index) => saved(item, manager(index ? 30 : 60)));
    const revised = upload('r2', ['Install panels,Alpha Tower,Level 1,9/15/2026,9/17/2026,,Not Started,0']);

    const plan = planDAVEWebScheduleImport({
      snapshot: { scheduleItems: current },
      importedScheduleItems: revised.scheduleItems,
    });

    expect(plan.revisions).toEqual([]);
    expect(plan.additions).toHaveLength(1);
    expect(plan.additions[0]).toMatchObject({ percentComplete: 0, status: 'Not Started' });
    expect(plan.additions[0].progressSource).not.toBe('project_manager');
  });

  it('leaves a task entered by hand alone and does not add it twice', () => {
    const revised = upload('r2', ['Frame walls,Alpha Tower,Level 1,9/1/2026,9/5/2026,,Not Started,0']);
    const handEntered = saved({
      ...revised.scheduleItems[0],
      id: 'hand-entered',
      importBatchId: null,
      sourceDocumentId: null,
      importedFrom: null,
      ...manager(40),
    });

    const plan = planDAVEWebScheduleImport({
      snapshot: { scheduleItems: [handEntered] },
      importedScheduleItems: revised.scheduleItems,
    });

    expect(plan).toEqual({ additions: [], revisions: [] });
  });

  it('merges a completion claim into the task it names', () => {
    const first = upload('r1', ['Frame walls,Alpha Tower,Level 1,9/1/2026,9/5/2026,,Not Started,0']);
    const framing = saved(first.scheduleItems[0], manager(60));
    const claim: ScheduleItem = {
      ...upload('claim', ['Frame walls,Alpha Tower,Level 1,9/1/2026,9/5/2026,,Complete,100']).scheduleItems[0],
      completionVerification: createReportedCompletionVerification({
        sourceName: 'Superintendent email',
        sourceRecordId: 'email-1',
        summary: 'Framing is done on Level 1.',
        reportedAt: '2026-09-12T12:00:00.000Z',
      }),
    };

    const plan = planDAVEWebScheduleImport({
      snapshot: { scheduleItems: [framing] },
      importedScheduleItems: [claim],
    });

    expect(plan.additions).toEqual([]);
    expect(plan.revisions).toHaveLength(1);
    expect(plan.revisions[0].item).toMatchObject({
      id: framing.id,
      percentComplete: 60,
      completionVerification: { status: 'reported_complete', priorPercentComplete: 60 },
    });
    expect(plan.revisions[0].previous.completionVerification).toBeUndefined();
  });

  it('plans against the tasks the web shows: an older revision\'s hidden copy would leave nothing to carry', () => {
    const first = upload('r1', ['Hang drywall,Alpha Tower,Level 1,9/8/2026,9/12/2026,,Not Started,0']);
    const second = upload('r2', ['Hang drywall,Alpha Tower,Level 1,9/10/2026,9/15/2026,,Not Started,0']);
    const documents = [
      { ...first.document, isCurrent: false },
      { ...second.document, isCurrent: true },
    ] as ReferenceDocument[];
    const rows = [
      saved(first.scheduleItems[0], manager(40)),
      saved(second.scheduleItems[0], manager(60)),
    ];
    // The web snapshot's scheduleItems are these: the current schedule's.
    const shown = selectAuthoritativeScheduleItems({ scheduleItems: rows, scheduleDocuments: documents }) as DAVEWebScheduleItem[];
    expect(shown.map(item => item.id)).toEqual([second.scheduleItems[0].id]);
    const third = upload('r3', ['Hang drywall,Alpha Tower,Level 1,9/12/2026,9/18/2026,,Not Started,0']);

    const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: shown }, importedScheduleItems: third.scheduleItems });
    const everyRow = planDAVEWebScheduleImport({ snapshot: { scheduleItems: rows }, importedScheduleItems: third.scheduleItems });

    expect(plan.additions[0]).toMatchObject({ percentComplete: 60, progressSource: 'project_manager' });
    expect(everyRow.additions[0]).toMatchObject({ percentComplete: 0 });
  });
});
