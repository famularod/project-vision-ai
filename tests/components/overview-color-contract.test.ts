import fs from 'fs';
import path from 'path';

describe('Overview color contract', () => {
  it('keeps native blue while using the approved Cool Blueprint desktop palette', () => {
    const root = path.resolve(__dirname, '../..');
    const appTheme = fs.readFileSync(
      path.join(root, 'components/app-shell-theme.ts'),
      'utf8',
    );
    const webShell = fs.readFileSync(
      path.join(root, 'components/web-shell/desktop-read-only-shell.tsx'),
      'utf8',
    );
    const webOverview = fs.readFileSync(
      path.join(root, 'components/web-shell/desktop-overview-page.tsx'),
      'utf8',
    );
    const healthCard = appTheme.slice(
      appTheme.indexOf('overviewHealthCard: {'),
      appTheme.indexOf('overviewDashboardSectionHeader: {'),
    );

    expect(healthCard).toContain('backgroundColor: colors.primary');
    expect(healthCard).not.toContain("backgroundColor: '#123F8C'");
    expect(webShell).toContain('<DesktopOverviewPage');
    expect(webOverview).toContain('backgroundColor: desktopSurfaces.hero');
    expect(webOverview).toContain('color: desktopSurfaces.heroText');
    expect(webOverview).toContain('borderTopColor: desktopSurfaces.accent');
    expect(webOverview).not.toContain('backgroundColor: colors.primary');
    expect(webOverview).not.toContain("backgroundColor: '#123F8C'");
  });

  it('keeps the redesigned web Overview focused on PM-facing project facts', () => {
    const root = path.resolve(__dirname, '../..');
    const webOverview = fs.readFileSync(
      path.join(root, 'components/web-shell/desktop-overview-page.tsx'),
      'utf8',
    );

    expect(webOverview).toContain('SectionHeading title="Current Focus"');
    expect(webOverview).toContain('SectionHeading title="Active Projects"');
    expect(webOverview).toContain('SectionHeading title="Recent Activity"');
    expect(webOverview).not.toContain('Current attention');
    expect(webOverview).not.toContain('Cloud task accounting');
  });

  it('does not label a real priority as all clear when its cover photo is missing', () => {
    const root = path.resolve(__dirname, '../..');
    const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
    const priorityCard = app.slice(
      app.indexOf('<View style={styles.overviewPriorityCard}>'),
      app.indexOf('{overviewRows.length === 0 ?'),
    );

    expect(priorityCard).toContain(') : currentFocusProject ? (');
    expect(priorityCard).toContain('Current focus');
    expect(priorityCard).toContain('No project cover photo is available.');
    expect(priorityCard).toContain(
      "{currentFocus?.stateLabel || (topPriority ? 'NEEDS SETUP' : 'ALL CLEAR')}",
    );
    expect(priorityCard).toContain(
      "{currentFocus ? 'Review task' : topPriority ? 'Set up project' : 'Add project'}",
    );
  });

  it('describes the due-today rollup as projects rather than individual tasks', () => {
    const root = path.resolve(__dirname, '../..');
    const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');

    expect(app).toContain("project${dueTodayCount === 1 ? '' : 's'} with work due today");
    expect(app).not.toContain("item${dueTodayCount === 1 ? '' : 's'} due today");
  });
});
