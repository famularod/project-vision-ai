import fs from 'node:fs';
import path from 'node:path';

describe('ECOS PDF annotation title-band provenance migration', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20260809131713_ecos_pdf_annotation_title_band_provenance.sql',
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('extends both page-table source constraints without editing applied history', () => {
    expect(sql.match(/drop constraint if exists ecos_(?:hosted_)?document_pages_sheet_mapping_source_check/g))
      .toHaveLength(2);
    expect(sql.match(/'pdf_annotation_title_band'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("'pdf_bookmark'");
    expect(sql).toContain("'native_title_band'");
    expect(sql).toContain("'coordinate_text'");
  });

  it('delegates every pre-existing source to the proven provenance helper', () => {
    expect(sql).toContain(
      'rename to ecos_sheet_provenance_payload_without_annotation_title_band',
    );
    expect(sql).toContain(
      "if mapping_source is distinct from 'pdf_annotation_title_band'",
    );
    expect(sql).toContain(
      'return public.ecos_sheet_provenance_payload_without_annotation_title_band(',
    );
  });

  it('requires exact Square subtype, page-bound ids, fixed bands, and adjacent label', () => {
    for (const proof of [
      "annotation_subtype <> 'Square'",
      "evidence_source <> 'pdf_annotation'",
      "'^pdf-annotation-[0-9]+-page-' || page_number::text || '$'",
      "sheet_number !~ '^C[1-9][0-9]{0,2}$'",
      '(evidence_bounds->>\'x\')::numeric < 0.948',
      '(evidence_bounds->>\'y\')::numeric < 0.904',
      '(evidence_bounds->>\'x\')::numeric < 0.94',
      '(evidence_bounds->>\'y\')::numeric < 0.888',
      'token_count <> 1 or label_count <> 1',
      ') not between 0 and 0.025',
    ]) expect(sql).toContain(proof);
  });

  it('preserves subtype, exact structural identity, and Assurance acceptance', () => {
    expect(sql).toContain("'annotationSubtype', annotation_subtype");
    expect(sql).toContain("'source', mapping_source");
    expect(sql).toContain("'evidence', canonical_evidence");
    expect(sql).toContain("assurance_data->>'accepted' is distinct from 'true'");
    expect(sql).toContain(
      "assurance_data#>>'{checks,sheetMappingUsable}' is distinct from 'true'",
    );
    expect(sql).toContain("'sheetMappingAssurance', canonical_assurance");
  });

  it('keeps both helper functions service-role only', () => {
    expect(sql.match(/from public, anon, authenticated;/g)).toHaveLength(2);
    expect(sql.match(/to service_role;/g)).toHaveLength(2);
  });
});
