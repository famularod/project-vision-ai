import fs from 'fs';
import path from 'path';
import { VITRUVIUS_NATIVE_MIN_TOUCH_TARGET } from '../../services/NativeInteractionPolicy';

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
});
