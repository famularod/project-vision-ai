import { cleanup, render } from '@testing-library/react-native';

import { DesktopConnectionStatus } from '../../components/web-shell/desktop-connection-status';
import type { DAVEWebFreshnessState } from '../../services/DAVEWebFreshness';

function freshness(
  status: DAVEWebFreshnessState['status'],
  lastSuccessfulRefreshAt: string | null = '2026-07-22T12:00:00.000Z',
): DAVEWebFreshnessState {
  return {
    status,
    lastSuccessfulRefreshAt,
    lastAttemptAt: '2026-07-22T12:00:12.000Z',
    consecutiveFailures: status === 'connected' ? 0 : 1,
  };
}

afterEach(cleanup);

describe('DesktopConnectionStatus', () => {
  it.each([
    ['connected', 'Connected'],
    ['reconnecting', 'Reconnecting'],
    ['stale', 'Stale'],
  ] as const)('renders the %s state with the last successful cloud update', (status, label) => {
    const screen = render(<DesktopConnectionStatus freshness={freshness(status)} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(/Last cloud update/)).toBeTruthy();
  });

  it('does not claim a cloud update before the first successful snapshot', () => {
    const screen = render(
      <DesktopConnectionStatus freshness={freshness('stale', null)} />,
    );

    expect(screen.getByText('Stale')).toBeTruthy();
    expect(screen.getByText('No successful cloud refresh yet')).toBeTruthy();
  });
});
