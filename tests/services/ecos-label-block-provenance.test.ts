import fs from 'node:fs';
import path from 'node:path';

describe('ECOS deterministic label-block provenance migration', () => {
  const sql = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260809021651_ecos_label_block_provenance.sql',
  ), 'utf8');

  it('enriches shadow, live, and legacy chunks from their authoritative page region', () => {
    for (const marker of [
      'ecos_enrich_shadow_chunk_provenance',
      'ecos_enrich_hosted_chunk_provenance',
      'ecos_enrich_legacy_chunk_provenance',
      'public.ecos_hosted_index_pages',
      'public.ecos_hosted_document_pages',
      'public.ecos_document_pages',
      "'rawSource'",
      "'reconstructionMethod'",
      "'evidenceSources'",
      "'constituentEvidence'",
      "'corroboratingEvidence'",
    ]) {
      expect(sql).toContain(marker);
    }
  });

  it('retains the raw producer source instead of rewriting chunk provenance to OCR', () => {
    expect(sql).toContain("= 'deterministic_label_block'");
    expect(sql).not.toMatch(/'source'\s*,\s*'ocr'/);
  });
});
