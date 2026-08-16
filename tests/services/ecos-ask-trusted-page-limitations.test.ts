import fs from 'node:fs';
import path from 'node:path';

describe('Ask ECOS trusted hosted-page limitation boundary', () => {
  const edge = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/functions/ecos-ask-project/index.ts',
  ), 'utf8');
  const search = edge.slice(
    edge.indexOf('async function searchDocumentEvidence('),
    edge.indexOf('async function loadPageIdentityContexts('),
  );
  const assurance = edge.slice(
    edge.indexOf('export function boundedSheetAssurance('),
    edge.indexOf('function boundedNormalizedBounds('),
  );
  const exactAuthority = edge.slice(
    edge.indexOf('function markExactHostedSearchAuthority('),
    edge.indexOf('function exactAuthorityText('),
  );

  it('marks only exact hosted and shadow search rows as trusted', () => {
    expect(search).toContain('const primaryRows = markExactHostedSearchAuthority(');
    expect(search).toContain('rowGroups.flat(),');
    expect(search).toContain('documentById,');
    expect(exactAuthority).toContain('const jobId = canonicalProjectId(row.job_id)');
    expect(exactAuthority).toContain('const organizationId = exactAuthorityText(row.organization_id, 500)');
    expect(exactAuthority).toContain('projectId !== document.projectId');
    expect(exactAuthority).toContain('sourceSha256 !== document.sourceSha256');
    expect(exactAuthority).toContain("evidenceVersion !== 'ecos-hosted-evidence/1.3'");
    expect(exactAuthority).toContain('rejectedDocuments.add(documentId)');
    expect(search).not.toContain('markHostedAssuranceTrust(legacy.data, false)');
    expect(search).not.toContain("rpc('ecos_search_document_chunks'");
    expect(search).toContain('row[TRUSTED_HOSTED_ASSURANCE_MARKER] === true');
  });

  it('bounds, maps, and deduplicates accepted string codes without returning raw diagnostics', () => {
    expect(edge).toContain('MAX_TRUSTED_PAGE_LIMITATION_CODES = 32');
    expect(edge).toContain('MAX_TRUSTED_PAGE_LIMITATION_CODE_LENGTH = 160');
    expect(edge).toContain('MAX_SOURCE_LIMITATIONS = 16');
    expect(assurance).toContain('assurance.accepted !== true');
    expect(assurance).toContain("typeof rawCode !== 'string'");
    expect(assurance).toContain('code.length > MAX_TRUSTED_PAGE_LIMITATION_CODE_LENGTH');
    expect(assurance).toContain('TRUSTED_PAGE_LIMITATION_MESSAGES[code.toLowerCase()]');
    expect(assurance).toContain('GENERIC_TRUSTED_PAGE_LIMITATION');
    expect(assurance).toContain('if (!result.includes(message)) result.push(message)');
    expect(assurance).not.toContain('result.limitationCodes');
  });

  it('includes safe limits in source identity, provider evidence, and deterministic output gates', () => {
    expect(search).toContain('...textArray(pageAssurance.limitations)');
    expect(edge).toContain('source.documentLimitations || [],');
    expect(edge).toContain('limitations: boundedSourceLimitations(source.documentLimitations || [])');
    expect(edge).toContain('const documentLimitations = citedSources.flatMap');
    expect(edge).toContain('const allDocumentLimitations = allDocumentSources.flatMap');
    expect(edge).toContain('...allDocumentLimitations');
    expect(edge).toContain("const confidence = hasConflict || limitations.length > 0");
    expect(edge).toContain("? 'verified_with_limits'");
    expect(edge).toContain("ecos-project-answer-policy/2.8");
  });
});
