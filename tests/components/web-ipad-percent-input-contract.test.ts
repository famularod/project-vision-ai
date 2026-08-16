import fs from 'node:fs';
import path from 'node:path';

describe('iPad web percent complete input', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/web-shell/desktop-read-only-shell.tsx'),
    'utf8',
  );

  it('uses one stable browser numeric input and digit-only updates', () => {
    expect(source).toContain("'data-testid': 'stable-web-numeric-input'");
    expect(source).toContain("type: 'text'");
    expect(source).toContain("inputMode: 'numeric'");
    expect(source).toContain("pattern: '[0-9]*'");
    expect(source).toContain("value.replace(/[^0-9]/g, '').slice(0, 3)");
  });
});
