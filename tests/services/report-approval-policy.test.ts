import { evaluateReportApprovalPolicy, reviewItemId } from '../../services/ReportApprovalPolicy';

const clean = { needsReview: false, reviewFlags: [] as string[] };

describe('report approval policy', () => {
  it('allows a ready report when live report authority is available', () => {
    const policy = evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: true, authorityState: 'ready' });
    expect(policy.allowed).toBe(true);
    expect(policy.items).toEqual([]);
    expect(policy.message).toBe('The report is ready for approval.');
  });

  it('holds approval until advisory flags are reviewed, then allows it', () => {
    const flags = [
      'Some source evidence has low confidence.',
      'One action needs verification.',
      'One or more action items need an owner.',
    ];
    const report = { needsReview: true, reviewFlags: flags };
    const pending = evaluateReportApprovalPolicy({ report, reportGenerationAllowed: true, authorityState: 'ready' });
    expect(pending.allowed).toBe(false);
    expect(pending.blockingReasons).toEqual(flags);
    expect(pending.items.map(item => item.kind)).toEqual(['advisory', 'advisory', 'advisory']);
    expect(pending.message).toBe('3 items need your review below. Mark them reviewed to approve.');

    const partly = evaluateReportApprovalPolicy({
      report, reportGenerationAllowed: true, authorityState: 'ready',
      acknowledgedItemIds: [reviewItemId(flags[0])],
    });
    expect(partly.allowed).toBe(false);
    expect(partly.pendingAdvisoryIds).toHaveLength(2);

    const reviewed = evaluateReportApprovalPolicy({
      report, reportGenerationAllowed: true, authorityState: 'ready',
      acknowledgedItemIds: flags.map(reviewItemId),
    });
    expect(reviewed.allowed).toBe(true);
  });

  it('never lets a reviewer wave through a report with no evidence or the wrong project', () => {
    for (const flag of ['No supporting evidence was found for this period.', 'Missing project assignment on two updates.']) {
      const policy = evaluateReportApprovalPolicy({
        report: { needsReview: true, reviewFlags: [flag] },
        reportGenerationAllowed: true, authorityState: 'ready',
        acknowledgedItemIds: [reviewItemId(flag)],
      });
      expect(policy.allowed).toBe(false);
      expect(policy.items[0].kind).toBe('blocking');
      expect(policy.message).toContain('must be fixed in the project');
    }
  });

  it('requires review when needsReview is true without a detailed flag', () => {
    const policy = evaluateReportApprovalPolicy({ report: { needsReview: true, reviewFlags: [] }, reportGenerationAllowed: true, authorityState: 'ready' });
    expect(policy.blockingReasons).toEqual(['This report still requires review before sharing.']);
    expect(policy.allowed).toBe(false);
  });

  it('says "loading" only while project data is really loading', () => {
    const loading = evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: false, authorityState: 'loading' });
    expect(loading).toMatchObject({ allowed: false, waitingForProjectData: true });
    expect(loading.message).toContain('still loading');
    for (const state of ['conflict_blocked', 'persistence_failed', 'unavailable', 'stale_model', 'degraded_local_only', 'queued_for_cloud'] as const) {
      const policy = evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: false, authorityState: state });
      expect(policy.waitingForProjectData).toBe(false);
      expect(policy.message).not.toContain('loading');
    }
  });

  it('owner-reported case: finished project, authority not ready, becomes approvable after one review', () => {
    for (const state of ['conflict_blocked', 'persistence_failed', 'unavailable', 'stale_model', 'degraded_local_only', 'queued_for_cloud'] as const) {
      const pending = evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: false, authorityState: state });
      expect(pending.allowed).toBe(false);
      expect(pending.items).toHaveLength(1);
      expect(pending.items[0]).toMatchObject({ id: `authority:${state}`, kind: 'advisory' });
      const reviewed = evaluateReportApprovalPolicy({
        report: clean, reportGenerationAllowed: false, authorityState: state,
        acknowledgedItemIds: pending.pendingAdvisoryIds,
      });
      expect(reviewed.allowed).toBe(true);
    }
  });

  it('adds no authority item when the authority already allows reports', () => {
    const policy = evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: true, authorityState: 'degraded_local_only' });
    expect(policy.items).toEqual([]);
    expect(policy.allowed).toBe(true);
  });

  it('stays blocked without a trusted project connection', () => {
    for (const state of ['blocked_identity', 'blocked_organization'] as const) {
      const policy = evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: false, authorityState: state, acknowledgedItemIds: [`authority:${state}`] });
      expect(policy.allowed).toBe(false);
      expect(policy.message).toContain('trusted project connection');
    }
  });

  it('keeps the old fail-closed behaviour for callers that do not pass an authority state', () => {
    const policy = evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: false });
    expect(policy.allowed).toBe(false);
    expect(policy.message).toContain('live project authority');
  });
});
