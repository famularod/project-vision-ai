import {
  APP_SHELL_BREAKPOINTS,
  appShellContentTopPadding,
  appShellContentSafeAreaEdges,
  appShellHidesSystemStatusBar,
  appShellLayoutForWidth,
} from '../../components/app-shell-layout';

describe('appShellLayoutForWidth', () => {
  it('keeps compact widths on bottom navigation', () => {
    expect(appShellLayoutForWidth(APP_SHELL_BREAKPOINTS.medium - 1)).toMatchObject({
      sizeClass: 'compact',
      navigationPlacement: 'bottom',
      expandedRail: false,
    });
  });

  it('uses a compact rail at medium widths', () => {
    expect(appShellLayoutForWidth(APP_SHELL_BREAKPOINTS.medium)).toMatchObject({
      sizeClass: 'medium',
      navigationPlacement: 'rail',
      expandedRail: false,
    });
  });

  it('uses an expanded rail at wide widths', () => {
    expect(appShellLayoutForWidth(APP_SHELL_BREAKPOINTS.wide)).toMatchObject({
      sizeClass: 'wide',
      navigationPlacement: 'rail',
      expandedRail: true,
    });
  });

  it('falls back safely when a layout width is unavailable', () => {
    expect(appShellLayoutForWidth(Number.NaN)).toMatchObject({
      sizeClass: 'compact',
      viewportWidth: 390,
      navigationPlacement: 'bottom',
    });
  });

  it('does not apply the phone safe area twice below the branded header', () => {
    expect(appShellContentTopPadding({
      layout: appShellLayoutForWidth(390),
      safeAreaTop: 59,
      platform: 'ios',
    })).toBe(0);
  });

  it('does not apply a second top safe-area inset inside compact screens', () => {
    expect(
      appShellContentSafeAreaEdges(appShellLayoutForWidth(390)),
    ).toEqual(['left', 'right']);
  });

  it('preserves top protection beside the iPad navigation rail', () => {
    expect(appShellContentTopPadding({
      layout: appShellLayoutForWidth(1024),
      safeAreaTop: 24,
      platform: 'ios',
    })).toBe(72);
    expect(
      appShellContentSafeAreaEdges(appShellLayoutForWidth(1024)),
    ).toEqual(['top', 'left', 'right']);
  });

  it('hides the iPadOS status bar beside the navigation rail', () => {
    expect(appShellHidesSystemStatusBar({
      layout: appShellLayoutForWidth(1024),
      platform: 'ios',
    })).toBe(true);
  });

  it('keeps the iPhone status bar above the compact branded header', () => {
    expect(appShellHidesSystemStatusBar({
      layout: appShellLayoutForWidth(390),
      platform: 'ios',
    })).toBe(false);
  });

  it('does not hide the system status bar on non-iOS layouts', () => {
    expect(appShellHidesSystemStatusBar({
      layout: appShellLayoutForWidth(1024),
      platform: 'android',
    })).toBe(false);
  });
});
