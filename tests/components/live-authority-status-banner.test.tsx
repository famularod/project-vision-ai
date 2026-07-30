import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

jest.mock('../../providers/PIELiveAuthorityProvider', () => ({
  usePIELiveAuthority: jest.fn(),
}));

import { LiveAuthorityStatusBannerView } from '../../components/live-authority-status-banner';

const blockedPolicy = {
  mayShowRecommendations: false,
  highImpactAutomationAllowed: false,
  reportGenerationAllowed: false,
  layer4DecisionCreationAllowed: false,
  userMessage: 'Saved device data requires acknowledgement.',
};

describe('LiveAuthorityStatusBannerView', () => {
  it('explains the limitation before continuing with device-only data', () => {
    const onAcknowledge = jest.fn();
    const screen = render(
      <LiveAuthorityStatusBannerView
        state="degraded_local_only"
        policy={blockedPolicy}
        retryPending={false}
        cloudExpected
        degradedLocalAcknowledged={false}
        onRetry={jest.fn()}
        onAcknowledge={onAcknowledge}
      />,
    );

    expect(screen.getByText('Latest cloud data is not confirmed')).toBeTruthy();
    expect(screen.getByText(
      'Vitruvius could not confirm the latest shared project record. Project totals, task status, and recommendations may be incomplete.',
    )).toBeTruthy();
    expect(screen.queryByText(blockedPolicy.userMessage)).toBeNull();

    fireEvent.press(screen.getByLabelText('Continue with saved device data'));

    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Retry project understanding')).toBeNull();
  });

  it('offers manual recovery after acknowledgement without hiding the warning', () => {
    const onRetry = jest.fn();
    const screen = render(
      <LiveAuthorityStatusBannerView
        state="degraded_local_only"
        policy={{
          ...blockedPolicy,
          mayShowRecommendations: true,
          reportGenerationAllowed: true,
        }}
        retryPending={false}
        cloudExpected
        degradedLocalAcknowledged
        onRetry={onRetry}
        onAcknowledge={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText('Retry project understanding'));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Using saved device data')).toBeTruthy();
  });

  it.each([false, true])(
    'never treats expected combined-report authority as a global failure (acknowledged: %s)',
    degradedLocalAcknowledged => {
    const onRetry = jest.fn();
    const screen = render(
      <LiveAuthorityStatusBannerView
        state="degraded_local_only"
        policy={{
          ...blockedPolicy,
          mayShowRecommendations: true,
          reportGenerationAllowed: true,
        }}
        retryPending={false}
        cloudExpected
        localAuthorityExpected
        degradedLocalAcknowledged={degradedLocalAcknowledged}
        onRetry={onRetry}
        onAcknowledge={jest.fn()}
      />,
    );

    expect(screen.toJSON()).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
    },
  );

  it.each([
    'ready',
    'loading',
    'stale_model',
    'conflict_blocked',
    'blocked_identity',
    'blocked_organization',
  ] as const)('does not turn the %s state into a global interruption', state => {
    const screen = render(
      <LiveAuthorityStatusBannerView
        state={state}
        policy={blockedPolicy}
        retryPending={false}
        cloudExpected
        degradedLocalAcknowledged={false}
        onRetry={jest.fn()}
        onAcknowledge={jest.fn()}
      />,
    );

    expect(screen.toJSON()).toBeNull();
  });

  it('shows retry progress and stays below the device safe area', () => {
    const screen = render(
      <LiveAuthorityStatusBannerView
        state="unavailable"
        policy={{
          ...blockedPolicy,
          userMessage: 'Vitruvius needs to refresh this project before recommending action.',
        }}
        retryPending
        cloudExpected
        degradedLocalAcknowledged={false}
        onRetry={jest.fn()}
        onAcknowledge={jest.fn()}
        safeAreaTop={47}
      />,
    );

    const banner = screen.getByTestId('live-authority-status-banner');
    const flattenedStyle = StyleSheet.flatten(banner.props.style);

    expect(screen.getByText('Retrying…')).toBeTruthy();
    expect(screen.getByLabelText('Retry project understanding').props.accessibilityState)
      .toEqual(expect.objectContaining({ disabled: true }));
    expect(flattenedStyle.marginTop).toBeGreaterThan(47);
  });
});
