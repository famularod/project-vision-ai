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

  // Field test, 29 Sep 2026: a report emailed from the phone reached Gmail
  // but not the work address (PLZ email security rejects personal accounts).
  it('offers Email from Outlook (work) only after approval, through the approval gate', () => {
    const approvedShareMenuIndex = reportsScreen.indexOf(
      '{reportApproved && reportApprovalAllowed && shareOpen ? (',
    );
    const outlookButtonIndex = reportsScreen.indexOf('label="Email from Outlook (work)" onPress={onOutlookReport}');
    const menuEnd = reportsScreen.indexOf(') : null}', approvedShareMenuIndex);
    expect(outlookButtonIndex).toBeGreaterThan(approvedShareMenuIndex);
    expect(outlookButtonIndex).toBeLessThan(menuEnd);
    expect(reportsScreen).toMatch(/onOutlookReport=\{\(\) => \{\s+completeCommunication\(report =>\s+onOutlookReport\(report, drawingReferences\)\);/);
    expect(app).toContain('onOutlookReport={outlookReport}');
    // Audit A6 pass 3: the Outlook path shares the Word report and then asks whether it was sent.
    expect(app).toContain("const shared = await shareWordReport(report, drawingReferences, 'Choose Outlook to send from your work account');");
    expect(app).toContain("if (!proceed) return 'canceled';");
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
      // R5 item 6a: the file's name carries the day the report was prepared; pin updated deliberately.
      'downloadBlob(`${safeDownloadName(reportFileTitleWithDate(title, generatedAt))}.docx`, blob);',
    );
    expect(desktopShell.match(/Download Word Report/g)?.length).toBeGreaterThanOrEqual(2);
    expect(desktopShell).not.toMatch(
      /downloadText\([^)]*(?:Project Report|reportTitle)[^)]*\.md/i,
    );
  });
});
