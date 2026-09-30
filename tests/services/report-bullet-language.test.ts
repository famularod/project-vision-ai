import {
  reportBulletText,
  stripProjectWalkBoilerplate,
  toPMReportLanguage,
} from '../../services/DAVEReportIntelligence';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');

// Whole-app audit, area A6 (29 Sep 2026): the report-language filter that
// drops engine "not confirmed" phrasing was applied to the manager's own
// captions and notes, so "Guardrail missing at stair 2 landing." reached the
// owner as nothing.
describe('the manager’s own words reach the owner report as written', () => {
  it('prints captions and notes verbatim, however they are worded', () => {
    for (const text of [
      'Guardrail missing at stair 2 landing.',
      'Crew cannot pour footings until the inspection on Friday.',
      'Unknown pipe found under slab at grid C4, needs engineer review.',
      'Electrician could not access the roof; access hatch is locked.',
      'Verify anchor bolt torque on the mezzanine columns.',
      'Unresolved RFI 42 holding up the soffit framing.',
    ]) {
      expect(reportBulletText({ text, kind: 'safety' })).toBe(text);
      expect(reportBulletText({ text, kind: 'progress' })).toBe(text);
      expect(reportBulletText({ text, kind: 'issue' })).toBe(text);
    }
  });

  it('treats every bullet kind alike (none is engine review text; pass 2), and strips Project Walk drafting headers from notes', () => {
    for (const kind of ['progress', 'schedule', 'issue', 'safety', 'next_step', 'image_reference', 'needs_review']) {
      expect(reportBulletText({ text: 'Current condition is unknown and needs verification.', kind }))
        .toBe('Current condition is unknown and needs verification.');
    }
    const walkNote = 'Project Walk draft — review before sending Field note: Guardrail missing at stair 2 landing.';
    expect(reportBulletText({ text: walkNote, kind: 'progress' })).toBe('Guardrail missing at stair 2 landing.');
    expect(stripProjectWalkBoilerplate(walkNote)).toContain('Guardrail missing');
  });

  it('never drops an engine safety statement for its wording', () => {
    expect(toPMReportLanguage('An unresolved safety concern is recorded in the Pump House.'))
      .toBe('An unresolved safety concern is recorded in the Pump House.');
    expect(toPMReportLanguage('Completion is not confirmed for the Pump House.')).toBe('');
  });

  it('is what the sent body and the preview use', () => {
    const intelligence = read('services/DAVEReportIntelligence.ts');
    expect(intelligence).toMatch(/group\.workAreas\.flatMap\(area => area\.bullets\n\s+\.map\(reportBulletText\)/);
    const screen = read('screens/ReportsScreen.tsx');
    expect(screen).toContain('.map(bullet => ({ ...bullet, text: reportBulletText(bullet) }))');
    expect(screen).not.toContain('toPMReportLanguage(bullet.text)');
  });
});

describe('what a report is built from and sends (audit A6)', () => {
  const app = read('App.tsx');
  const screen = read('screens/ReportsScreen.tsx');

  it('builds report scopes from recorded updates only, never the open draft', () => {
    expect(app).not.toContain("currentUpdate: draft as unknown as import('./types').ProjectUpdate,");
    expect(app.match(/updates: activeSavedUpdates as unknown as import\('\.\/types'\)\.ProjectUpdate\[\],\n\s+scheduleItems: authoritativeScheduleItems,\n\s+currentUpdate: null,/g)?.length).toBe(2);
  });

  it('attaches images to email and text only when the body cites them', () => {
    // Audit A6 pass 4: the check ignores case.
    expect(app).toContain("return reportFormat !== 'executive' && /\\bSee Images?\\s+\\d/i.test(report.body);");
    expect(app).toContain('const images = await reportImageFiles(reportBodyCitesImages(report) ? report : { ...report, locationGroups: [] }, REPORT_EMAIL_IMAGE_LIMIT);');
    expect(app).toContain('const images = await reportImageFiles(reportBodyCitesImages(report) ? report : { ...report, locationGroups: [] }, REPORT_TEXT_IMAGE_LIMIT);');
  });

  it('numbers Word photos as the text does and fetches only the cited photos', () => {
    expect(app).toMatch(/const reportPhotoIds = \[\.\.\.reportPhotoNumbers\.keys\(\)\]\.sort\(\n\s+\(left, right\) => \(reportPhotoNumbers\.get\(left\) \?\? 0\) - \(reportPhotoNumbers\.get\(right\) \?\? 0\),\n\s+\);/);
    expect(app).toMatch(/relevantUpdates\.map\(update => hydrateRecoveredProjectUpdatePhotos\(\{\n\s+\.\.\.update,\n\s+photos: update\.photos\.filter\(photo => reportPhotoIdSet\.has\(photo\.id\)\),\n\s+\}\)\)/);
  });

  it('lists period changes only against a previous approved report, as the body does', () => {
    expect(screen).toContain("{changes.length > 0 && period.basis === 'previous_approved_report' ? (");
  });
});
