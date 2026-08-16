import {
  bindStableScheduleImportItemIds,
  buildScheduleImportSourceIdentity,
  canonicalScheduleImportScope,
} from '../../services/ScheduleImportSourceIdentity';
import { dedupeScheduleImportItems } from '../../services/PIEScheduleImportBatch';
import { normalizeMicrosoftProjectPdfRows } from '../../services/PIEScheduleIntelligence';
import type { ScheduleItem } from '../../types';

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'temporary-device-id',
    scheduleProjectName: '2321 Compliance Project',
    projectTimeZone: null,
    projectName: '2321 Compliance Project',
    locationName: 'North Lot',
    taskName: 'Place asphalt',
    startDate: '07/27/2026',
    finishDate: '07/28/2026',
    milestone: '',
    owner: '',
    contractor: '',
    durationDays: 2,
    percentComplete: 0,
    progressSource: 'schedule_import',
    progressConfirmedAt: null,
    progressConfirmedBy: null,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    importedFrom: 'schedule.pdf',
    importedAt: '2026-07-26T12:00:00.000Z',
    importBatchId: null,
    sourceDocumentId: null,
    completionVerification: null,
    createdAt: '2026-07-26T12:00:00.000Z',
    updatedAt: '2026-07-26T12:00:00.000Z',
    ...overrides,
  };
}

describe('schedule import source identity', () => {
  it('is stable across file names, devices, timestamps, and project selection order', () => {
    const first = buildScheduleImportSourceIdentity({
      bytes: bytes('same schedule bytes'),
      projects: [
        { id: 'project-b', name: '2375 Compliance Project' },
        { id: 'project-a', name: '2321 Compliance Project' },
      ],
    });
    const second = buildScheduleImportSourceIdentity({
      bytes: bytes('same schedule bytes'),
      projects: [
        { id: 'PROJECT-A', name: 'Renamed display value' },
        { id: 'PROJECT-B', name: 'Another display value' },
      ],
    });

    expect(second).toEqual(first);
    expect(first.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when either the bytes or the authorized project scope changes', () => {
    const original = buildScheduleImportSourceIdentity({
      bytes: bytes('schedule v1'),
      projects: [{ id: 'project-a', name: '2321 Compliance Project' }],
    });
    const changedBytes = buildScheduleImportSourceIdentity({
      bytes: bytes('schedule v2'),
      projects: [{ id: 'project-a', name: '2321 Compliance Project' }],
    });
    const changedScope = buildScheduleImportSourceIdentity({
      bytes: bytes('schedule v1'),
      projects: [{ id: 'project-b', name: '2375 Compliance Project' }],
    });

    expect(changedBytes.idempotencyKey).not.toBe(original.idempotencyKey);
    expect(changedScope.idempotencyKey).not.toBe(original.idempotencyKey);
  });

  it('uses a normalized name only when a stable project ID is unavailable', () => {
    expect(canonicalScheduleImportScope([
      { name: ' 2321   Compliance Project ' },
      { name: '2321 compliance project' },
      { id: 'ABC', name: 'Ignored display name' },
    ])).toEqual([
      'id:abc',
      'name:2321 compliance project',
    ]);
  });

  it('keeps the same identity while a legacy project receives its cloud UUID', () => {
    const importIdentity = 'project-2321-compliance-project';
    const legacy = buildScheduleImportSourceIdentity({
      bytes: bytes('same schedule bytes'),
      projects: [{
        name: '2321 Compliance Project',
        importIdentity,
      }],
    });
    const migrated = buildScheduleImportSourceIdentity({
      bytes: bytes('same schedule bytes'),
      projects: [{
        id: '7d670c3f-6bfd-44d1-a46a-e7c4ef3f50d0',
        name: '2321 Compliance Project',
        importIdentity,
      }],
    });

    expect(migrated).toEqual(legacy);
    expect(migrated.scopeKey).toBe(`id:${importIdentity}`);
  });

  it('assigns stable batch, document, and task IDs across clients', () => {
    const source = buildScheduleImportSourceIdentity({
      bytes: bytes('schedule v1'),
      projects: [{ id: 'project-a', name: '2321 Compliance Project' }],
    });
    const first = bindStableScheduleImportItemIds([item()], source)[0];
    const second = bindStableScheduleImportItemIds([
      item({ id: 'a-different-random-device-id' }),
    ], source)[0];

    expect(second.id).toBe(first.id);
    expect(first.importBatchId).toBe(source.batchId);
    expect(first.sourceDocumentId).toBe(source.documentId);
  });

  it('keeps stable identities for an exact retry but separates different task rows', () => {
    const source = buildScheduleImportSourceIdentity({
      bytes: bytes('schedule v1'),
      projects: [{ id: 'project-a', name: '2321 Compliance Project' }],
    });
    const [first, second] = bindStableScheduleImportItemIds([
      item(),
      item({ taskName: 'Stripe parking area' }),
    ], source);
    const retry = bindStableScheduleImportItemIds([
      item({ id: 'another-device-id' }),
    ], source)[0];

    expect(retry.id).toBe(first.id);
    expect(second.id).not.toBe(first.id);
  });

  it('keeps same-name and same-date Microsoft Project activities separate by source WBS', () => {
    const source = buildScheduleImportSourceIdentity({
      bytes: bytes('schedule v1'),
      projects: [{ id: 'project-a', name: '2321 Compliance Project' }],
    });
    const sourceRows = normalizeMicrosoftProjectPdfRows({
      contents: [
        'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tWBS',
        '1\tALPHA MEDICAL CENTER\t0\t10 days\tMon 7/20/26\tFri 7/31/26\t0%\t1',
        '101\tQUALITY INSPECTION\t1\t1 day\tMon 7/27/26\tMon 7/27/26\t0%\t1.2.1',
        '102\tQUALITY INSPECTION\t1\t1 day\tMon 7/27/26\tMon 7/27/26\t0%\t1.2.2',
      ].join('\n'),
      sourceName: 'same-name-different-wbs.pdf',
      now: new Date('2026-07-26T12:00:00.000Z'),
    });
    const [first, second] = bindStableScheduleImportItemIds(sourceRows, source);

    expect(sourceRows).toHaveLength(2);
    expect(sourceRows.map(row => row.sourceActivityId)).toEqual(['101', '102']);
    expect(sourceRows.map(row => row.sourceWbsCode)).toEqual(['1.2.1', '1.2.2']);
    expect(sourceRows.map(row => row.sourceRowNumber)).toEqual([3, 4]);
    expect(first.id).not.toBe(second.id);
    expect(dedupeScheduleImportItems(sourceRows)).toHaveLength(2);
  });
});
