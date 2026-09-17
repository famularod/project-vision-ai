import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeECOSDrawingIntakeSuggestion, reviewedECOSDrawingUpload, suggestECOSDrawingIntake } from '../../services/ECOSDocumentUploadIntake';
import { createECOSMobileDrawingControls, validateECOSMobileDrawingControls } from '../../services/ECOSMobileDrawingOnboarding';
import { suggestProjectDocumentCategory } from '../../services/ProjectDocumentClassification';
import type { ReferenceDocument } from '../../types';

describe('reviewed document intake', () => {
  it('replaces old automatic suggestions for another file but preserves user corrections', () => {
    expect(mergeECOSDrawingIntakeSuggestion('A-2.10', 'A-2.10', 'E-1.1')).toBe('E-1.1');
    expect(mergeECOSDrawingIntakeSuggestion('Architectural', 'Architectural', '')).toBe('');
    expect(mergeECOSDrawingIntakeSuggestion('Mixed set', 'Architectural', 'Electrical')).toBe('Mixed set');
    expect(mergeECOSDrawingIntakeSuggestion('', '', 'Civil')).toBe('Civil');
  });
  it.each(['Architectural', 'Civil', 'Electrical', 'Structural', 'Mechanical', 'Plumbing', 'Fire Protection', 'Landscape'])(
    'suggests %s without inventing a sheet, revision, project or approval', discipline => {
      const controls = createECOSMobileDrawingControls(`2375 ${discipline}.pdf`);
      expect(controls).toMatchObject({ drawingDiscipline: discipline, drawingNumber: '', drawingRevision: '', drawingStatus: 'For Review', replacementDocumentId: null });
      expect(validateECOSMobileDrawingControls(controls).valid).toBe(false);
      expect(suggestProjectDocumentCategory({ name: `2375 ${discipline}.pdf` })).toBe('Drawing');
    });
  it('supports mixed disciplines and only unambiguous explicit sheet/revision suggestions', () => {
    expect(suggestECOSDrawingIntake('A-2.10 Electrical_Plumbing Rev 3.pdf')).toEqual({ drawingDiscipline: 'Electrical / Plumbing', drawingNumber: 'A-2.10', drawingRevision: '3' });
    expect(suggestECOSDrawingIntake('A-2.10 A-2.11 Rev 1 Rev 2.pdf')).toEqual({ drawingDiscipline: '', drawingNumber: '', drawingRevision: '' });
  });
  it('does not infer discipline from a parent folder, substring, number or short letter', () => {
    expect(suggestECOSDrawingIntake('/Electrical/Mechanicality 2375 E.pdf').drawingDiscipline).toBe('');
    expect(suggestECOSDrawingIntake('misc.pdf').drawingNumber).toBe('');
    expect(suggestProjectDocumentCategory({ name: 'Electrical submittal.pdf' })).toBe('Vendor Document');
  });
  it('saves current reviewed edits without changing source identity or activating the revision', () => {
    const original: ReferenceDocument = { id: 'new-drawing', name: 'Set', originalFileName: 'set.pdf', uri: '', category: 'Drawing', notes: '', importedAt: '2026-09-15', isCurrent: false, projectId: 'project-a', drawingRevision: '1', contentSha256: 'a'.repeat(64) };
    const result = reviewedECOSDrawingUpload(original, { ...createECOSMobileDrawingControls(), drawingNumber: ' Set A ', drawingRevision: ' 2 ', drawingDiscipline: ' Civil / Electrical ' });
    expect(result).toMatchObject({ drawingNumber: 'Set A', drawingRevision: '2', drawingDiscipline: 'Civil / Electrical', isCurrent: false, projectId: 'project-a', contentSha256: original.contentSha256 });
    expect(original.drawingRevision).toBe('1');
  });
  it('wires reviewed metadata to both desktop storage destinations and mobile selection', () => {
    const desktop = readFileSync(resolve(__dirname, '../../components/web-shell/desktop-read-only-shell.tsx'), 'utf8');
    expect(desktop).toMatch(/auth\.linkDocument\(\s*reviewedUpload,/);
    expect(desktop).toMatch(/auth\.uploadDocument\(\s*reviewedUpload,/);
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain("createECOSMobileDrawingControls(asset.name || '')");
  });
});
