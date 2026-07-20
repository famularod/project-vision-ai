import fs from 'fs';
import path from 'path';

describe('Overview color contract', () => {
  it('uses the shared primary blue instead of a separate dark Overview blue', () => {
    const root = path.resolve(__dirname, '../..');
    const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
    const webShell = fs.readFileSync(
      path.join(root, 'components/web-shell/desktop-read-only-shell.tsx'),
      'utf8',
    );
    const healthCard = app.slice(
      app.indexOf('overviewHealthCard: {'),
      app.indexOf('overviewDashboardSectionHeader: {'),
    );

    expect(healthCard).toContain('backgroundColor: colors.primary');
    expect(healthCard).not.toContain("backgroundColor: '#123F8C'");
    expect(webShell).toContain('metricCard: { flexGrow: 1, flexBasis: 190, minHeight: 132, borderRadius: 20, backgroundColor: colors.primary');
  });
});
