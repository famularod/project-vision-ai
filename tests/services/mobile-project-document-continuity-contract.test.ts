import fs from 'node:fs';
import path from 'node:path';

describe('mobile project-document continuity contract', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const documentCardSource = fs.readFileSync(
    path.join(process.cwd(), 'components/project-document-card.tsx'),
    'utf8',
  );

  it('carries validated drawing metadata into the pre-upload local record', () => {
    expect(source).toContain('validateECOSMobileDrawingControls(drawingControls)');
    expect(source).toContain('mobileDrawingMetadataForUpload(drawingControls, replacementDocument)');
    expect(source).toContain("...(context?.category === 'Drawing' ? context.drawingMetadata : null)");
  });

  it('mirrors later metadata edits into the queued shared ECOS record', () => {
    expect(source).toContain('synchronizeSharedReferenceDocumentMetadata({');
    expect(source).toContain('void queueReferenceDocumentRecord(synchronizedDocument)');
  });

  // The transaction moved into services/SharedDocumentActivation.ts and now
  // serves schedules too (whole-app audit A5 F4, 30 Sep 2026): a schedule has
  // no ECOS preparation gate, and a conflict is retried once.
  const activationSource = fs.readFileSync(
    path.join(process.cwd(), 'services/SharedDocumentActivation.ts'),
    'utf8',
  );

  it('uses the shared readiness card and one server-owned Make Current transaction', () => {
    expect(documentCardSource).toContain('<MobileDocumentECOSStatus');
    expect(source).toContain('onMakeCurrentDocument={markReferenceDocumentCurrent}');
    expect(source).toContain('const readiness = buildECOSDocumentReadiness(target)');
    expect(source).toContain("canonicalReferenceCategory(target) !== 'schedule' && !readiness.canMakeCurrent");
    expect(source).toContain('await activateSharedReferenceDocument({');
    expect(activationSource).toContain('expectedUpdatedAt: target.cloudUpdatedAt');
    expect(activationSource).toContain('activate = activateECOSCurrentReferenceDocument');
    expect(source).toContain('const result = await listReferenceDocuments()');
  });

  it('does not optimistically queue independent current-revision record writes', () => {
    const workflow = source.match(
      /async function activateReferenceDocument[\s\S]+?\n  async function ensureVerifiedReferenceDocumentBytes/,
    )?.[0] || '';
    expect(workflow).toContain('function markReferenceDocumentCurrent');
    expect(workflow).not.toContain('markAuthoritativeDocumentCurrent');
    expect(workflow).not.toContain('unmarkAuthoritativeDocumentCurrent');
    expect(workflow).not.toContain('queueReferenceDocumentRecord');
    expect(workflow).not.toContain('Promise.all');
  });

  it('makes a shared schedule current through the same transaction from both screens', () => {
    const setActive = source.match(
      /function setActiveScheduleDocument\(documentId: string\) \{[\s\S]+?\n  \}\n/,
    )?.[0] || '';
    expect(setActive).toContain('markReferenceDocumentCurrent(documentId)');
    expect(setActive).not.toContain('queueReferenceDocumentRecord');
    expect(setActive).not.toContain('isCurrent');
    expect(source).toContain(
      'if (alreadyShared && !(await activateReferenceDocument(selectedReferenceDocument.id))) return;',
    );
    expect(source).toContain('    if (alreadyShared) return;\n    referenceDocumentsCurrentRef.current = nextReferenceDocuments;');
  });
});
