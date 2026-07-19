import { act, render } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text } from 'react-native';

import { AppShellFrame } from '../../components/app-shell-frame';
import {
  OverviewResponsiveColumn,
  OverviewResponsiveFrame,
  OverviewResponsiveWorkspace,
} from '../../components/overview-responsive-layout';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('Overview responsive layout', () => {
  afterEach(() => {
    setWindowWidth(390, 844);
  });

  it('keeps the Overview workspace stacked at medium width', () => {
    setWindowWidth(768, 1024);
    const screen = render(<OverviewLayoutProbe />);

    expect(
      StyleSheet.flatten(screen.getByTestId('overview-responsive-workspace').props.style)
        .flexDirection,
    ).not.toBe('row');
  });

  it('uses a bounded two-column command center at wide width', () => {
    setWindowWidth(1024, 768);
    const screen = render(<OverviewLayoutProbe />);

    expect(
      StyleSheet.flatten(screen.getByTestId('overview-responsive-frame').props.style)
        .maxWidth,
    ).toBe(1240);
    expect(
      StyleSheet.flatten(screen.getByTestId('overview-responsive-workspace').props.style)
        .flexDirection,
    ).toBe('row');
    expect(
      StyleSheet.flatten(screen.getByTestId('overview-primary-column').props.style).flex,
    ).toBeGreaterThan(
      StyleSheet.flatten(screen.getByTestId('overview-secondary-column').props.style).flex,
    );
  });
});

function OverviewLayoutProbe() {
  return (
    <AppShellFrame
      currentScreen="Home"
      onScreenChange={jest.fn()}
      onTalk={jest.fn()}
    >
      <OverviewResponsiveFrame>
        <OverviewResponsiveWorkspace>
          <OverviewResponsiveColumn priority="primary">
            <Text>Priority and projects</Text>
          </OverviewResponsiveColumn>
          <OverviewResponsiveColumn priority="secondary">
            <Text>Activity and archives</Text>
          </OverviewResponsiveColumn>
        </OverviewResponsiveWorkspace>
      </OverviewResponsiveFrame>
    </AppShellFrame>
  );
}

function setWindowWidth(width: number, height: number) {
  act(() => {
    Dimensions.set({
      window: { width, height, scale: 2, fontScale: 1 },
      screen: { width, height, scale: 2, fontScale: 1 },
    });
  });
}
