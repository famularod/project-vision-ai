import fs from 'node:fs';
import path from 'node:path';

describe('Ask ECOS no-live-legacy evidence boundary', () => {
  const edge = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/functions/ecos-ask-project/index.ts',
  ), 'utf8');

  it('never reads owner-writable legacy chunks or pages in live Ask', () => {
    expect(edge).not.toContain("rpc('ecos_search_document_chunks'");
    expect(edge).not.toContain("from('ecos_document_pages')");
    expect(edge).not.toContain('legacyDocumentEvidenceIsEligible');
    expect(edge).not.toContain('legacyEligible');
    expect(edge).not.toContain('eligibleECOSLegacyPageDocumentIds');
    expect(edge).not.toContain('filterECOSLegacyPageContextRows');
  });

  it('uses the same canonical Drawing/Plans helper at every Ask drawing gate', () => {
    expect(edge).toContain("from '../_shared/ecos-document-category.ts'");
    expect(edge.match(/isECOSDrawingCategory\(/g)).toHaveLength(4);
    expect(edge).not.toContain("normalize(document.category) === 'drawing'");
    expect(edge).not.toContain("normalize(text(data.category)) === 'drawing'");
  });

  it('uses only exact hosted context and the separate service-role shadow path', () => {
    const search = edge.slice(
      edge.indexOf('export async function searchDocumentEvidence('),
      edge.indexOf('async function loadPageIdentityContexts('),
    );
    const identityLoader = edge.slice(
      edge.indexOf('async function loadPageIdentityContexts('),
      edge.indexOf('async function loadMatchedPageNeighborhoods('),
    );
    const neighborhoodLoader = edge.slice(
      edge.indexOf('async function loadMatchedPageNeighborhoods('),
      edge.indexOf('export async function loadShadowPageRows('),
    );
    const shadowLoader = edge.slice(
      edge.indexOf('export async function loadShadowPageRows('),
      edge.indexOf('function hasCompleteDrawingVisualCoverage('),
    );

    expect(search).toContain('if (!hosted.error) return Array.isArray(hosted.data) ? hosted.data : [];');
    expect(search).toContain('const primaryRows = markExactHostedSearchAuthority(');
    expect(search).toContain('rowGroups.flat(),');
    expect(search).toContain('if (hosted.error && !rpcIsUnavailable(hosted.error)) throw hosted.error;');
    expect(search).toContain('return [];');
    expect(identityLoader).toContain('loadECOSCurrentHostedPageContext({');
    expect(identityLoader).toContain('loadShadowPageRows(client, projectId, documentIds, pageNumbers)');
    expect(neighborhoodLoader).toContain('drawingDocumentIds: ReadonlySet<string>');
    expect(neighborhoodLoader).toContain('loadECOSCurrentHostedPageContext({');
    expect(neighborhoodLoader).toContain('loadShadowPageRows(client, projectId, documentIds, pageNumbers)');
    expect(neighborhoodLoader).toContain('return hostedRows.flatMap(row => {');
    for (const exactField of [
      'project_id',
      'source_owner_id',
      'source_sha256',
      'source_revision',
      'committed_evidence_version',
    ]) expect(shadowLoader).toContain(exactField);
    expect(shadowLoader).toContain("text(row.committed_evidence_version) !== 'ecos-hosted-evidence/1.3'");
    expect(shadowLoader).toContain("text(assurance.evidenceVersion) !== 'ecos-hosted-evidence/1.3'");
  });
});
