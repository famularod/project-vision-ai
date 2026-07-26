import {
  initialDAVEWebFreshnessState,
  presentDAVEWebFreshness,
  recordDAVEWebRefreshFailure,
  recordDAVEWebRefreshSuccess,
} from '../../services/DAVEWebFreshness';

describe('DAVE web freshness truth', () => {
  it('starts stale until the first authorized cloud snapshot succeeds', () => {
    expect(initialDAVEWebFreshnessState()).toEqual({
      status: 'stale',
      lastSuccessfulRefreshAt: null,
      lastAttemptAt: null,
      consecutiveFailures: 0,
    });
  });

  it('shows reconnecting during a short refresh interruption without losing the last success time', () => {
    const success = recordDAVEWebRefreshSuccess('2026-07-22T12:00:00.000Z');
    const interrupted = recordDAVEWebRefreshFailure(
      success,
      '2026-07-22T12:00:12.000Z',
    );

    expect(interrupted).toEqual({
      status: 'reconnecting',
      lastSuccessfulRefreshAt: '2026-07-22T12:00:00.000Z',
      lastAttemptAt: '2026-07-22T12:00:12.000Z',
      consecutiveFailures: 1,
    });
  });

  it('becomes stale after the bounded freshness window expires', () => {
    const success = recordDAVEWebRefreshSuccess('2026-07-22T12:00:00.000Z');
    const stale = recordDAVEWebRefreshFailure(
      success,
      '2026-07-22T12:01:00.000Z',
    );

    expect(stale.status).toBe('stale');
    expect(stale.lastSuccessfulRefreshAt).toBe('2026-07-22T12:00:00.000Z');
  });

  it('returns to connected and clears the failure count only after a successful refresh', () => {
    const interrupted = recordDAVEWebRefreshFailure(
      recordDAVEWebRefreshSuccess('2026-07-22T12:00:00.000Z'),
      '2026-07-22T12:00:12.000Z',
    );

    expect(
      recordDAVEWebRefreshSuccess('2026-07-22T12:00:24.000Z'),
    ).toEqual({
      status: 'connected',
      lastSuccessfulRefreshAt: '2026-07-22T12:00:24.000Z',
      lastAttemptAt: '2026-07-22T12:00:24.000Z',
      consecutiveFailures: 0,
    });
    expect(interrupted.consecutiveFailures).toBe(1);
  });

  it.each([
    ['connected', 'Connected and up to date', 'Connected'],
    ['reconnecting', 'Reconnecting to the shared record', 'Reconnecting'],
    ['stale', 'Cloud data needs a refresh', 'Stale'],
  ] as const)('never presents %s freshness as a different state', (status, title, badge) => {
    const presentation = presentDAVEWebFreshness({
      status,
      lastSuccessfulRefreshAt: '2026-07-22T12:00:00.000Z',
      lastAttemptAt: '2026-07-22T12:00:12.000Z',
      consecutiveFailures: status === 'connected' ? 0 : 1,
    });

    expect(presentation).toMatchObject({ title, badge });
  });
});
