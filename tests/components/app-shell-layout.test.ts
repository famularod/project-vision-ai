import {
  APP_SHELL_BREAKPOINTS,
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
});
