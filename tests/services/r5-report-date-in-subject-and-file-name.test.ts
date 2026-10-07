/**
 * R5 item 6a (a send extra deferred on 29 Sep 2026): the report's date in the
 * email subject and in the Word file's name.
 *
 * Both were the report's title alone ("Tower Project Status Report"), so two
 * reports of one project made on different days could not be told apart in a
 * mailbox or a folder, and a second Word copy saved under the first one's
 * name. The day is the one the Word copy prints as "Prepared ...": the
 * device's calendar day of the report's own time.
 */
import * as fs from 'fs';
import * as path from 'path';

import { reportFileTitleWithDate, reportSubjectWithDate } from '../../services/ReportCommunication';

// A time that is the same calendar day in every time zone the app is used in.
const PREPARED = '2026-10-06T18:00:00.000Z';
const NOW = new Date('2026-11-02T18:00:00.000Z');

describe('R5 item 6a: the email subject carries the day the report was prepared', () => {
  it('the title, then the day', () => {
    expect(reportSubjectWithDate('Tower Project Status Report', PREPARED, NOW)).toBe('Tower Project Status Report — Oct 6, 2026');
    expect(reportSubjectWithDate('  Tower — Executive Summary ', new Date(PREPARED), NOW)).toBe('Tower — Executive Summary — Oct 6, 2026');
  });

  it('a title he typed the day into is left as it is', () => {
    expect(reportSubjectWithDate('Tower report, Oct 6, 2026', PREPARED, NOW)).toBe('Tower report, Oct 6, 2026');
  });

  it('a report with no time of its own, or one that cannot be read, is dated today, as its Word copy is', () => {
    expect(reportSubjectWithDate('Tower Project Status Report', null, NOW)).toBe('Tower Project Status Report — Nov 2, 2026');
    expect(reportSubjectWithDate('Tower Project Status Report', 'not a date', NOW)).toBe('Tower Project Status Report — Nov 2, 2026');
  });

  it('with no title the day alone', () => {
    expect(reportSubjectWithDate('  ', PREPARED, NOW)).toBe('Oct 6, 2026');
  });
});

describe('R5 item 6a: the Word file\'s name carries the day the report was prepared', () => {
  it('the title, then the day as numbers, so the files sort by day in a folder', () => {
    expect(reportFileTitleWithDate('Tower Project Status Report', PREPARED, NOW)).toBe('Tower Project Status Report 2026-10-06');
    expect(reportFileTitleWithDate('Tower Project Status Report', '2026-01-09T18:00:00.000Z', NOW)).toBe('Tower Project Status Report 2026-01-09');
  });

  it('a title that already says the day is left as it is; none, or an unreadable time, is today', () => {
    expect(reportFileTitleWithDate('Tower 2026-10-06', PREPARED, NOW)).toBe('Tower 2026-10-06');
    expect(reportFileTitleWithDate('Tower Project Status Report', undefined, NOW)).toBe('Tower Project Status Report 2026-11-02');
    expect(reportFileTitleWithDate('', 'not a date', NOW)).toBe('2026-11-02');
  });
});

describe('R5 item 6a: where they are used', () => {
  const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

  it('the phone: the Mail subject and the Word file it shares (also the file attached for Outlook)', () => {
    const app = source('App.tsx');
    expect(app).toContain('subject: reportSubjectWithDate(report.subject || report.title, report.generatedAt),');
    expect(app).toContain("sanitizeFilename(reportFileTitleWithDate(report.title || 'Vitruvius Project Report', report.generatedAt))}.docx`;");
    // The title alone is no longer the subject or the file name.
    expect(app).not.toContain('subject: report.subject || report.title,');
    expect(app).not.toContain("sanitizeFilename(report.title || 'Vitruvius Project Report')");
  });

  it('the web: the email draft\'s subject and the Word download', () => {
    const shell = source('components/web-shell/desktop-read-only-shell.tsx');
    expect(shell).toContain('const subject = encodeURIComponent(reportSubjectWithDate(reportTitle, reportGeneratedAt));');
    expect(shell).toContain('downloadBlob(`${safeDownloadName(reportFileTitleWithDate(title, generatedAt))}.docx`, blob);');
  });
});
