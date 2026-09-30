import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { AppBottomTabs } from '../../components/app-bottom-tabs';
import { VITRUVIUS_NATIVE_MIN_TOUCH_TARGET } from '../../services/NativeInteractionPolicy';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('native compact action accessibility contract', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../App.tsx'),
    'utf8',
  );
  const themeSource = fs.readFileSync(
    path.resolve(__dirname, '../../components/app-shell-theme.ts'),
    'utf8',
  );

  test('compact action controls keep a 44 point minimum touch target', () => {
    const styleBlock = themeSource.match(
      /compactInlineAction:\s*\{([\s\S]*?)\n\s*\},/,
    )?.[1] ?? '';

    expect(VITRUVIUS_NATIVE_MIN_TOUCH_TARGET).toBe(44);
    expect(styleBlock).toContain('minHeight: VITRUVIUS_NATIVE_MIN_TOUCH_TARGET');
    expect(styleBlock).toContain('minWidth: VITRUVIUS_NATIVE_MIN_TOUCH_TARGET');
    expect(styleBlock).toContain("alignItems: 'center'");
    expect(styleBlock).toContain("justifyContent: 'center'");
  });

  test('schedule and intelligence actions expose explicit accessible names', () => {
    expect(appSource).toContain('accessibilityLabel={`Confirm ${title}`}');
    expect(appSource).toContain('accessibilityLabel={`Dismiss ${title}`}');
    expect(appSource).toContain('accessibilityLabel={`Open ${document.name}`}');
    expect(appSource).toContain(
      'accessibilityLabel={`Set ${document.name} as the active schedule`}',
    );
    expect(appSource).toContain('accessibilityLabel={`Delete ${document.name}`}');
  });

  // Whole-app audit A2 pass 2 L4: the phone's Overview, Tasks and Reports
  // tabs and the centre button were about 36 points tall.
  test('phone bottom tabs and the centre button are at least 44 points tall (48 with padding inside)', async () => {
    for (const audience of ['owner_internal', 'outside_pilot'] as const) {
      const screen = await render(createElement(AppBottomTabs, {
        current: 'Home', onChange: jest.fn(), onTalk: jest.fn(), onAskECOS: jest.fn(), audience,
      }));
      const centre = audience === 'owner_internal' ? 'Ask ECOS' : 'Project actions';
      const buttons = [
        ...['Overview', 'Tasks', 'Reports'].map(name => screen.getByRole('tab', { name })),
        screen.getByRole('button', { name: centre }),
      ];
      for (const button of buttons) {
        const style = StyleSheet.flatten(button.props.style);
        expect(style.minHeight).toBeGreaterThanOrEqual(VITRUVIUS_NATIVE_MIN_TOUCH_TARGET);
        expect(style.minHeight).toBe(48);
        expect(style.paddingTop).toBeGreaterThan(0);
      }
      screen.unmount();
    }
  });
});
