import fs from 'fs';
import path from 'path';

describe('Report Word download visibility contract', () => {
  const root = path.resolve(__dirname, '../..');
  const reportsScreen = fs.readFileSync(
    path.join(root, 'screens/ReportsScreen.tsx'),
    'utf8',
  );
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  const appShellTheme = fs.readFileSync(
    path.join(root, 'components/app-shell-theme.ts'),
    'utf8',
  );
  const projectStatusViews = fs.readFileSync(
    path.join(root, 'components/DAVEProjectStatusViews.tsx'),
    'utf8',
  );
  const desktopShell = fs.readFileSync(
    path.join(root, 'components/web-shell/desktop-read-only-shell.tsx'),
    'utf8',
  );

  it('keeps the Word review copy visible without requiring report approval', () => {
    expect(reportsScreen).toContain('accessibilityLabel="Download Word Report"');
    expect(reportsScreen).toContain('Review copy with available photos and drawing excerpts');
    expect(reportsScreen).toContain('style={[\n          styles.reportWordDownloadButton,');

    const permanentDownloadIndex = reportsScreen.indexOf(
      'accessibilityLabel="Download Word Report"',
    );
    const approvedShareMenuIndex = reportsScreen.indexOf(
      '{reportApproved && reportApprovalAllowed && shareOpen ? (',
    );

    expect(permanentDownloadIndex).toBeGreaterThan(-1);
    expect(approvedShareMenuIndex).toBeGreaterThan(permanentDownloadIndex);
  });

  it('gives the Daily Brief and its rows the full width of the phone column', () => {
    expect(app).toContain(
      '<View style={styles.overviewDailyBriefCard}>',
    );
    expect(app).not.toContain(
      'style={[styles.phase2BriefCard, styles.overviewDailyBriefCard]}',
    );
    expect(appShellTheme).toContain('overviewDailyBriefCard:');
    expect(appShellTheme).toContain("flexDirection: 'column'");
    expect(appShellTheme).toContain("width: '100%'");
    expect(projectStatusViews).toContain(
      '<View style={styles.dailyBriefSection}>',
    );
    expect(projectStatusViews).toMatch(
      /dailyBriefSection:\s*\{[\s\S]*?alignSelf:\s*'stretch'[\s\S]*?minWidth:\s*0[\s\S]*?width:\s*'100%'/,
    );
    expect(projectStatusViews).toMatch(
      /briefRow:\s*\{[\s\S]*?alignSelf:\s*'stretch'[\s\S]*?minWidth:\s*0[\s\S]*?width:\s*'100%'/,
    );
    expect(projectStatusViews).toContain(
      'verificationCopy: { flex: 1, minWidth: 0 }',
    );
  });

  it('downloads desktop reports as Word documents instead of Markdown files', () => {
    expect(desktopShell).toContain('buildReportWordBlob({');
    expect(desktopShell).toContain(
      'downloadBlob(`${safeDownloadName(title)}.docx`, blob);',
    );
    expect(desktopShell.match(/Download Word Report/g)?.length).toBeGreaterThanOrEqual(2);
    expect(desktopShell).not.toMatch(
      /downloadText\([^)]*(?:Project Report|reportTitle)[^)]*\.md/i,
    );
  });
});
