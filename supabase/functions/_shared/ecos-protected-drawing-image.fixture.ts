import type { ECOSProtectedSourceCitation } from './ecos-protected-drawing-image-protocol.ts';

export function buildProtectedSourceCitation({
  ownerId,
  projectId,
  documentId,
  sourceSha256,
  rasterSha256,
  rasterByteCount,
  rasterWidth,
  rasterHeight,
  revision = '1',
  pageNumber = 6,
  sourcePageCount = 8,
}: Readonly<{
  ownerId: string;
  projectId: string;
  documentId: string;
  sourceSha256: string;
  rasterSha256: string;
  rasterByteCount: number;
  rasterWidth: number;
  rasterHeight: number;
  revision?: string;
  pageNumber?: number;
  sourcePageCount?: number;
}>): ECOSProtectedSourceCitation {
  return {
    evidence_id: 'e1',
    context_id: 's1',
    kind: 'visual_page',
    selected: true,
    source_id: documentId,
    source_sha256: sourceSha256,
    image_id: 'I01',
    locator: {
      organization_id: ownerId,
      project_id: projectId,
      owner_id: ownerId,
      source_id: documentId,
      source_sha256: sourceSha256,
      source_revision: revision,
      source_page_count: sourcePageCount,
      page_number: pageNumber,
      execution_id: '11111111-1111-4111-8111-111111111111',
      binding_id: '22222222-2222-4222-8222-222222222222',
      extraction_version: 'ecos-owner-native-preview/2.0',
      authority_decision_id: '33333333-3333-4333-8333-333333333333',
      authority_receipt_sha256: '3'.repeat(64),
      managed_attempt_id: '44444444-4444-4444-8444-444444444444',
      managed_receipt_sha256: '4'.repeat(64),
      page_attempt_id: '55555555-5555-4555-8555-555555555555',
      page_sha256: '5'.repeat(64),
      image_id: 'I01',
      locator_schema_version: 'ecos-owner-raster-source-locator/2.2',
      image_payload_sha256: '6'.repeat(64),
      visual_payload_sha256: null,
      raster_sha256: rasterSha256,
      raster_byte_count: rasterByteCount,
      raster_width: rasterWidth,
      raster_height: rasterHeight,
      upload_attempt_id: '66666666-6666-4666-8666-666666666666',
      raster_receipt_sha256: '7'.repeat(64),
      pixel_box: [0, 0, rasterWidth, rasterHeight],
      coordinate_system: 'rotated_display_cropbox_pixels_top_left',
      anchor_kind: 'whole_verified_page_image_not_text_quote',
    },
  };
}
