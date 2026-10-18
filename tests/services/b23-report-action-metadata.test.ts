import { reportFileTitleWithDate, reportSubjectWithDate } from '../../services/ReportCommunication';
import fs from 'fs';
import path from 'path';
const before = '2026-10-16T12:00:00';
const action = new Date(2026, 9, 17, 12);
const day = '2026-10-17';
describe('7.23 action metadata', () => {
  it('dates an old draft at the actual action, including later deferred action', () => {
    expect(reportSubjectWithDate('Report', before, action)).toBe('Report — Oct 17, 2026');
    expect(reportFileTitleWithDate('Report', before, action)).toBe(`Report ${day}`);
    expect(reportFileTitleWithDate('Report', action, action)).toBe(`Report ${day}`);
    expect(reportFileTitleWithDate('Report', before, new Date(2026,9,19,12))).toBe('Report 2026-10-19');
  });
  it.each(['2026-10-16','10/16/2026','16/10/2026','October 16, 2026','16 Oct 2026','Oct. 16 2026'])('preserves deliberate date %s', date => {
    const title = `Tower ${date}`;
    expect(reportSubjectWithDate(title,before,action)).toBe(title);
    expect(reportFileTitleWithDate(title,before,action)).not.toContain(day);
  });
  it.each(['Project 2026','Version 1.2.2026','Project 2026-99-99','Tower 1234-10-16'])('does not treat identifiers or invalid dates as dates: %s', title => {
    expect(reportSubjectWithDate(title,before,action)).toBe(`${title} — Oct 17, 2026`);
  });
  it.each(['.hidden','../a/b\\c\u0000\n','...','', '工程🏗️'.repeat(200)])('produces visible safe bounded Unicode Word basenames', title => {
    const name = reportFileTitleWithDate(title,before,action);
    expect(name).not.toMatch(/^[.\s]|[\\/\x00-\x1f\x7f<>:"|?*]/);
    expect(name.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(name+'.docx','utf8')).toBeLessThanOrEqual(240);
    expect(name).toContain(day);
    if (title.startsWith('工程')) expect(name).toContain('工程');
  });
  it('both real Word producers use the report-specific basename directly, preserving body inputs', () => {
    const app=fs.readFileSync(path.resolve(__dirname,'../../App.tsx'),'utf8');
    const web=fs.readFileSync(path.resolve(__dirname,'../../components/web-shell/desktop-read-only-shell.tsx'),'utf8');
    expect(app).toContain("${directory}${reportFileTitleWithDate(report.title || 'Vitruvius Project Report', report.generatedAt)}.docx");
    expect(web).toContain('downloadBlob(`${reportFileTitleWithDate(title, generatedAt)}.docx`, blob)');
    expect(app).toContain('body: report.body,');
    expect(web).toContain('taskLines: briefing.wordTaskLines ?? [],');
  });
});
