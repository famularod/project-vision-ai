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

  it('uses the shared readiness card and one server-owned Make Current transaction', () => {
    expect(documentCardSource).toContain('<MobileDocumentECOSStatus');
    expect(source).toContain('onMakeCurrentDocument={markReferenceDocumentCurrent}');
    expect(source).toContain('const readiness = buildECOSDocumentReadiness(target)');
    expect(source).toContain('if (!readiness.canMakeCurrent)');
    expect(source).toContain('await activateECOSCurrentReferenceDocument({');
    expect(source).toContain('expectedUpdatedAt: target.cloudUpdatedAt');
    expect(source).toContain('const documentsResult = await listReferenceDocuments()');
  });

  it('does not optimistically queue independent current-revision record writes', () => {
    const workflow = source.match(
      /function markReferenceDocumentCurrent[\s\S]+?\n  async function ensureVerifiedReferenceDocumentBytes/,
    )?.[0] || '';
    expect(workflow).not.toContain('markAuthoritativeDocumentCurrent');
    expect(workflow).not.toContain('unmarkAuthoritativeDocumentCurrent');
    expect(workflow).not.toContain('queueReferenceDocumentRecord');
    expect(workflow).not.toContain('Promise.all');
  });
});
