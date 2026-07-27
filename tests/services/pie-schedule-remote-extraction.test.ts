import {
  PIEScheduleRemoteExtractionError,
  scheduleExtractionFailureMessage,
  scheduleExtractorUrl,
  scheduleItemsFromRemoteExtractorPayload,
} from '../../services/PIEScheduleRemoteExtraction';

describe('PIE schedule remote extraction', () => {
  it('uses only the reviewed HTTPS extraction endpoint', () => {
    process.env.EXPO_PUBLIC_SCHEDULE_EXTRACTOR_URL = 'https://attacker.invalid/upload';

    expect(scheduleExtractorUrl()).toBe(
      'https://project-schedule-extractor-backend.vercel.app/api/extract-schedule',
    );

    delete process.env.EXPO_PUBLIC_SCHEDULE_EXTRACTOR_URL;
  });

  it('maps extracted PDF activities into reviewable schedule records', () => {
    const result = scheduleItemsFromRemoteExtractorPayload({
      ok: true,
      extractedAt: '2026-07-21T17:00:00.000Z',
      warnings: ['Review the owner.'],
      items: [{
        taskName: 'Install side panels',
        projectName: '2375 Compliance Project',
        locationName: 'Canopy A',
        startDate: '07/21/2026',
        finishDate: '07/27/2026',
        owner: 'Project manager',
        status: 'In Progress',
        percentComplete: '45%',
        notes: 'Panels are scheduled for delivery.',
      }],
    }, {
      fileName: 'lookahead.pdf',
      projects: ['2375 Compliance Project'],
      extractedAt: '2026-07-21T17:00:00.000Z',
    });

    expect(result.warnings).toEqual(['Review the owner.']);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      scheduleProjectName: '2375 Compliance Project',
      projectName: '2375 Compliance Project',
      locationName: 'Canopy A',
      taskName: 'Install side panels',
      startDate: '07/21/2026',
      finishDate: '07/27/2026',
      status: 'In Progress',
      percentComplete: 45,
      progressSource: 'schedule_import',
      importedFrom: 'lookahead.pdf',
    });
  });

  it('uses due date and parent project fallbacks without inventing progress', () => {
    const result = scheduleItemsFromRemoteExtractorPayload({
      items: [{ taskName: 'Final inspection', dueDate: '07/30/2026', status: 'Unknown' }],
    }, {
      fileName: 'schedule.pdf',
      projects: ['2321 Compliance Project'],
      extractedAt: '2026-07-21T17:00:00.000Z',
    });

    expect(result.items[0]).toMatchObject({
      projectName: '2321 Compliance Project',
      finishDate: '07/30/2026',
      status: 'Not Started',
      percentComplete: 0,
    });
  });

  it('normalizes trustworthy progress and rejects malformed provider progress', () => {
    const result = scheduleItemsFromRemoteExtractorPayload({
      items: [
        { taskName: 'Mobilize', status: 'Not Started', percentComplete: 35 },
        { taskName: 'Punch list', status: 'Complete', percentComplete: 12 },
        { taskName: 'Closeout', status: 'In Progress', percentComplete: 'unknown' },
        { taskName: 'Invalid percent', status: 'In Progress', percentComplete: 150 },
      ],
    }, {
      fileName: 'schedule.pdf',
      projects: ['2321 Compliance Project'],
      extractedAt: '2026-07-21T17:00:00.000Z',
    });

    expect(result.items.map(item => [item.status, item.percentComplete])).toEqual([
      ['In Progress', 35],
      ['Complete', 100],
      ['In Progress', 0],
      ['In Progress', 0],
    ]);
  });

  it('requires PM review instead of guessing a project for a shared schedule', () => {
    const result = scheduleItemsFromRemoteExtractorPayload({
      items: [{ taskName: 'Shared site inspection', dueDate: '07/30/2026' }],
    }, {
      fileName: 'shared-schedule.pdf',
      projects: ['2321 Compliance Project', '2375 Compliance Project'],
      extractedAt: '2026-07-21T17:00:00.000Z',
    });

    expect(result.items[0].projectName).toBe('');
  });

  it('fails visibly when the provider returns no usable activities', () => {
    expect(() => scheduleItemsFromRemoteExtractorPayload({ items: [] }, {
      fileName: 'unreadable.pdf',
      projects: ['2321 Compliance Project'],
      extractedAt: '2026-07-21T17:00:00.000Z',
    })).toThrow(PIEScheduleRemoteExtractionError);
  });

  it('never exposes raw server or provider error text', () => {
    const rawProviderError =
      'Provider timeout for tenant secret-project-42 using key sk-private-value';

    expect(scheduleExtractionFailureMessage({
      ok: false,
      code: 'PROVIDER_FAILURE',
      error: rawProviderError,
    }, 502)).toBe(
      'The schedule could not be analyzed. The PDF remains saved so you can retry.',
    );
    expect(scheduleExtractionFailureMessage({
      ok: false,
      code: 'REQUEST_IN_PROGRESS',
      error: rawProviderError,
    }, 409)).toBe(
      'This schedule is already being analyzed. Wait a moment, then retry.',
    );
    expect(scheduleExtractionFailureMessage({
      ok: false,
      error: rawProviderError,
    }, 401)).toBe(
      'Your Vitruvius session has expired. Sign in and try again.',
    );
  });
});
