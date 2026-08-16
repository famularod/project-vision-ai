import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import type { ReferenceDocument, ScheduleItem } from '../../types';

const projectId = 'project-2321';
const projectName = '2321 Compliance Project';

function schedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'task-1',
    scheduleProjectName: projectName,
    projectName,
    locationName: 'North Lot',
    taskName: 'Install guardrail',
    startDate: '2026-08-01',
    finishDate: '2026-08-20',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    importedFrom: 'shared-schedule.pdf',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function document(id: string, overrides: Partial<ReferenceDocument> = {}): ReferenceDocument {
  return {
    id,
    name: `${id}.pdf`,
    originalFileName: `${id}.pdf`,
    uri: '',
    category: 'Plans',
    notes: '',
    isCurrent: true,
    importedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DAVE project truth document scope', () => {
  it('rejects an explicit project-id mismatch even when the mutable name matches', () => {
    const truth = buildDAVEProjectTruth({
      projectId,
      projectName,
      updates: [],
      scheduleItems: [],
      referenceDocuments: [document('wrong-project', {
        projectId: 'project-other',
        projectName,
      })],
      now: '2026-08-09T00:00:00.000Z',
    });

    expect(truth.intelligence.referenceDocuments).toEqual([]);
  });

  it('does not bind an unscoped document by a matching schedule filename', () => {
    const truth = buildDAVEProjectTruth({
      projectId,
      projectName,
      updates: [],
      scheduleItems: [schedule()],
      referenceDocuments: [document('unscoped', {
        name: 'shared-schedule.pdf',
        originalFileName: 'shared-schedule.pdf',
      })],
      now: '2026-08-09T00:00:00.000Z',
    });

    expect(truth.intelligence.referenceDocuments).toEqual([]);
  });

  it('accepts a current document with the exact immutable project id', () => {
    const exact = document('exact', {
      projectId,
      projectName: 'Earlier display name',
    });
    const truth = buildDAVEProjectTruth({
      projectId,
      projectName,
      updates: [],
      scheduleItems: [],
      referenceDocuments: [exact],
      now: '2026-08-09T00:00:00.000Z',
    });

    expect(truth.intelligence.referenceDocuments.map(item => item.id)).toEqual(['exact']);
  });
});
