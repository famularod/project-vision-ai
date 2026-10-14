/**
 * HIGH item 1f (the final review's F1; the coordinator's decision): "already sent" and an approval are true to the
 * reader only where no output of the report moves while its fingerprint stays. The Executive report's fingerprint held
 * what its text and screen print and not its drawings, which every Word file and the Reports screen show. The kept guard
 * (r8-report-fingerprint-moves-whenever-the-report-does) now runs for EACH format over EVERY output that format
 * produces (tests/fixtures/report-every-output). This test pins the outputs themselves, read from the app's own code, so
 * that a new one cannot slip: a new share route, a new panel of the report, a new section of the Word file or a new
 * field it prints of a photo or a drawing fails here. Then: hold it in the report's fingerprint for each format that
 * prints it (services/DAVEReportIntelligence.ts), model it in the fixture, and only then move this inventory.
 */
import * as fs from 'fs';
import * as path from 'path';
import { REPORT_OUTPUTS_MODELLED } from '../fixtures/report-every-output';

const source = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
const found = (text: string, pattern: RegExp) => [...new Set(text.match(pattern) ?? [])].sort();

describe('HIGH 1f: every output of a report, on every device, is held in its fingerprint and modelled in the kept guard', () => {
  it('the phone: the outputs of a report the app gives the Reports screen (Copy, Email, Text, Download Word Report, Outlook)', () => {
    expect(found(source('App.tsx'), /on[A-Z][A-Za-z]*Report=\{/g)).toEqual([
      'onCopyReport={', 'onDownloadWordReport={', 'onEmailReport={', 'onOutlookReport={', 'onTextReport={',
    ]);
  });

  it('the phone: what the Reports screen shows of a report (the overview, the written report, the Work Areas & Photos and Drawing References panels)', () => {
    const screen = source('screens/ReportsScreen.tsx');
    const view = (name: string) => {
      const from = screen.indexOf(`function ${name}(`);
      const to = screen.indexOf('\nfunction ', from + 10);
      return screen.slice(from, to < 0 ? undefined : to);
    };
    // The report on screen: its overview, its written report and its Work Areas & Photos panel ...
    expect(found(view('ReportDocumentPreview'), /<(Report|DAVEReport)[A-Za-z]+/g)).toEqual(['<DAVEReportOverview', '<ReportInsightSection', '<ReportWorkArea']);
    expect(found(view('ReportDocumentPreview'), /reportDisclosureTitle\}>[^<{]+/g)).toEqual(['reportDisclosureTitle}>Full Written Report', 'reportDisclosureTitle}>Work Areas & Photos']);
    // ... the overview's parts ...
    expect(found(view('DAVEReportOverview'), /<(Report|DAVEReport)[A-Za-z]+/g)).toEqual([
      '<ReportAreaProgressRow', '<ReportControlSummary', '<ReportInsightSection', '<ReportManagementActions', '<ReportMilestones', '<ReportPeriodSummary',
      '<ReportProjectPosition', '<ReportScheduleHealth', '<ReportStatusDistribution', '<ReportSummaryCard',
    ]);
    // ... and, around it, the Drawing References panel (the rest is the share and send controls).
    expect(found(view('PIEReporterPreview'), /<(Report|DAVEReport)[A-Za-z]+/g)).toEqual([
      '<ReportDocumentPreview', '<ReportDrawingReferencePreview', '<ReportMarkSentPanel', '<ReportShareButton', '<ReporterTypeButton',
    ]);
    expect(view('PIEReporterPreview')).toContain('reportPreviewLabel}>Drawing References');
  });

  it('the desktop: the outputs of a report (Copy, Email, Download Word Report)', () => {
    const shell = source('components/web-shell/desktop-read-only-shell.tsx');
    expect((shell.match(/navigator\.clipboard\.writeText\(/g) ?? []).length).toBe(1);
    expect((shell.match(/mailto:\?subject=/g) ?? []).length).toBe(1);
    expect((shell.match(/buildReportWordBlob\(/g) ?? []).length).toBe(1);
  });

  it('the Word file: its sections, and what it prints of each photo and drawing', () => {
    const word = source('services/ReportWordDocument.ts');
    expect(found(word, /mediaSection\('[^']+'/g)).toEqual(["mediaSection('Current Drawing References'", "mediaSection('Project Photos'"]);
    expect(found(word, /text: '(Photo Reference Guide|Media Requiring Review)'/g)).toEqual(["text: 'Media Requiring Review'", "text: 'Photo Reference Guide'"]);
    const media = word.slice(word.indexOf('export type ReportWordMedia = Readonly<{'), word.indexOf('}>;', word.indexOf('export type ReportWordMedia = Readonly<{')));
    expect(found(media, /^\s{2}[a-zA-Z]+\??:/gm).map(key => key.trim().replace(/\??:$/, ''))).toEqual([
      'areaName', 'caption', 'citation', 'data', 'displayNumber', 'height', 'id', 'kind', 'linkedTaskName', 'mimeType', 'projectName',
      'reasonForInclusion', 'recordedAt', 'width',
    ]);
    expect(found(source('services/ReportWordDocument.ts'), /input\.[a-zA-Z]+/g)).toEqual(['input.body', 'input.generatedAt', 'input.media', 'input.title', 'input.unavailableMedia']);
  });

  it('both Word builders print a photo and a drawing in the words of one description, which the fingerprint holds', () => {
    for (const file of ['services/ReportWordMedia.native.ts', 'services/ReportWordMedia.web.ts']) {
      const resolver = source(file);
      expect([file, resolver.includes('reportWordPhotoDescription(photo, update)'), resolver.includes('reportWordDrawingDescription(reference)')]).toEqual([file, true, true]);
      // No words of their own beside it.
      expect([file, /Project photo from|This excerpt comes from|This photo is attached/.test(resolver)]).toEqual([file, false]);
    }
    expect(source('services/ReportWrittenFacts.ts')).toContain('reportWordPhotoDescription(photo, update)');
  });

  it('the kept guard models each of them', () => {
    expect(REPORT_OUTPUTS_MODELLED).toEqual({
      phone: ['written report', 'Reports screen overview', 'Drawing References panel', 'Work Areas & Photos panel', 'Word file', 'e-mail and text photos'],
      desktop: ['report', 'Word file'],
    });
    const guard = source('tests/services/r8-report-fingerprint-moves-whenever-the-report-does.test.ts');
    expect(guard).toContain("describe.each(FORMATS)('R8 item 4");
    expect(guard).toContain('phoneOutputs({');
    expect(guard).toContain('desktopOutputs({');
  });
});
