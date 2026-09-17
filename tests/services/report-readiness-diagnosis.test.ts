import { diagnoseReportReadiness } from '../../services/ReportReadinessDiagnosis';

const base = {
  reportGenerationAllowed: false,
  degradedLocalAcknowledged: false,
  activeConflictCount: 0,
  report: { needsReview: false, reviewFlags: [] },
};

describe('report readiness diagnosis', () => {
  it.each([
    ['loading', 'authority_loading'],
    ['persistence_failed', 'authority_offline_or_save_failed'],
    ['unavailable', 'authority_offline_or_save_failed'],
    ['queued_for_cloud', 'authority_needs_device_data_ack'],
    ['degraded_local_only', 'authority_needs_device_data_ack'],
    ['stale_model', 'authority_stale'],
  ] as const)('diagnoses %s as %s', (state, code) => {
    expect(diagnoseReportReadiness({ ...base, state }).code).toBe(code);
  });

  it('reports the number of active authority conflicts', () => {
    expect(diagnoseReportReadiness({ ...base, state: 'conflict_blocked', activeConflictCount: 2 }))
      .toEqual({ code: 'authority_conflicts', count: 2 });
  });

  it('returns the distinct report review flags', () => {
    expect(diagnoseReportReadiness({
      ...base,
      state: 'ready',
      reportGenerationAllowed: true,
      degradedLocalAcknowledged: true,
      report: { needsReview: true, reviewFlags: ['Check owner', 'Check owner'] },
    })).toEqual({ code: 'review_flags', flags: ['Check owner'] });
  });

  it('returns ready when authority and report checks pass', () => {
    expect(diagnoseReportReadiness({
      ...base,
      state: 'ready',
      reportGenerationAllowed: true,
      degradedLocalAcknowledged: true,
    })).toEqual({ code: 'ready' });
  });
});
