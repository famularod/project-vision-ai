import type { ScheduleItem } from '../../types';
import {
  scheduleImportItemHasCoreFacts,
  scheduleImportItemIsReady,
  scheduleImportReviewFields,
} from '../../services/PIEScheduleImportBatch';

function scheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'schedule-item',
    scheduleProjectName: null,
    projectName: '2321 Compliance Project',
    locationName: 'North Lot',
    taskName: 'Place asphalt',
    startDate: '07/20/2026',
    finishDate: '07/24/2026',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    completionVerification: null,
    createdAt: '2026-07-18T12:00:00.000Z',
    ...overrides,
  };
}

describe('schedule import batch date safety', () => {
  it.each([
    {
      label: 'an invalid start date',
      overrides: { startDate: '02/30/2026' },
    },
    {
      label: 'a start date after the finish date',
      overrides: {
        startDate: '07/25/2026',
        finishDate: '07/24/2026',
      },
    },
  ])('keeps $label out of one-tap and bulk approval', ({ overrides }) => {
    const item = scheduleItem(overrides);

    expect(scheduleImportReviewFields(item)).toContain('date');
    expect(scheduleImportItemIsReady(item)).toBe(false);
    expect(scheduleImportItemHasCoreFacts(item)).toBe(false);
  });

  it('allows a completion-verification claim to omit dates', () => {
    const item = scheduleItem({
      startDate: '',
      finishDate: '',
      completionVerification: {
        status: 'reported_complete',
        reportedAt: '2026-07-18T12:00:00.000Z',
        reportedBy: null,
        priorScheduleStatus: 'Not Started',
        priorPercentComplete: 0,
        verifiedAt: null,
        verifiedBy: null,
        verificationNote: null,
        evidence: [],
      },
    });

    expect(scheduleImportReviewFields(item)).not.toContain('date');
    expect(scheduleImportItemIsReady(item)).toBe(true);
    expect(scheduleImportItemHasCoreFacts(item)).toBe(true);
  });

  it('still rejects malformed dates supplied with a completion claim', () => {
    const item = scheduleItem({
      startDate: 'not-a-date',
      finishDate: '',
      completionVerification: {
        status: 'reported_complete',
        reportedAt: '2026-07-18T12:00:00.000Z',
        reportedBy: null,
        priorScheduleStatus: 'Not Started',
        priorPercentComplete: 0,
        verifiedAt: null,
        verifiedBy: null,
        verificationNote: null,
        evidence: [],
      },
    });

    expect(scheduleImportReviewFields(item)).toContain('date');
    expect(scheduleImportItemHasCoreFacts(item)).toBe(false);
  });
});
