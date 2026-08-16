import fs from 'node:fs';
import path from 'node:path';

describe('ECOS PDF annotation rendered-corroboration migration', () => {
  const sql = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/migrations/20260809195802_ecos_pdf_annotation_rendered_corroboration.sql',
  ), 'utf8');

  it('fails closed unless every annotation identity item carries bounded rendered proof', () => {
    for (const contract of [
      "evidence_item->'renderedCorroborated' is distinct from 'true'::jsonb",
      "rendered_region_ids := evidence_item->'renderedCorroboratingRegionIds'",
      "rendered_sources := evidence_item->'renderedCorroboratingSources'",
      'jsonb_array_length(rendered_region_ids) not between 1 and 8',
      'jsonb_array_length(rendered_sources) not between 1 and 8',
      'rendered_text = any(seen_rendered_region_ids)',
      'rendered_text = any(seen_rendered_sources)',
    ]) expect(sql).toContain(contract);
  });

  it('allows only the same bounded rendered OCR producers as worker Assurance', () => {
    for (const source of [
      'fixed_visual_tile_coordinate_ocr',
      'sheet_identity_ocr_landscape_native',
      'sheet_identity_ocr_page_bound_validated',
      'sheet_identity_ocr_vertical_outline',
      'title_block_ocr',
    ]) expect(sql).toContain(`'${source}'`);
    expect(sql).not.toContain("'pdf_annotation'\n          ) then");
  });

  it('preserves exact rendered support ids and sources in canonical evidence', () => {
    expect(sql).toContain("'renderedCorroborated', true");
    expect(sql).toContain("'renderedCorroboratingRegionIds', canonical_rendered_region_ids");
    expect(sql).toContain("'renderedCorroboratingSources', canonical_rendered_sources");
    expect(sql).toContain("'evidence', canonical_evidence");
  });

  it('retains exact text, bounds, adjacency, Assurance, and service-role-only gates', () => {
    expect(sql).toContain("regexp_replace(upper(evidence_text), '[[:space:]–—-]+', '', 'g') = sheet_number");
    expect(sql).toContain("elsif upper(evidence_text) = 'SHEET NO.'");
    expect(sql).toContain("(evidence_bounds->>'x')::numeric < 0.948");
    expect(sql).toContain(') not between 0 and 0.025');
    expect(sql).toContain("assurance_data->>'accepted' is distinct from 'true'");
    expect(sql).toContain('from public, anon, authenticated;');
    expect(sql).toContain('to service_role;');
  });
});
