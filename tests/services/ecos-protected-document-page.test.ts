import { createHash } from 'node:crypto';
import {
  ECOS_PROTECTED_SOURCE_ENDPOINT,
  ECOSProtectedDocumentPageError,
  loadECOSProtectedDocumentPage,
  normalizeECOSProtectedSourceCitation,
} from '../../services/ECOSProtectedDocumentPage';
import type { ECOSDocumentProofClaim } from '../../services/ECOSDocumentProofAuthority';
import { buildProtectedSourceCitation } from '../fixtures/ecos-protected-source';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '77777777-7777-4777-8777-777777777777'),
}));

const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const DOCUMENT_ID = 'web-document-edb4a270-4a4e-463f-90fc-e378dd23dd3c';
const SOURCE_SHA = 'eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01';

const claim: ECOSDocumentProofClaim = Object.freeze({
  documentId: DOCUMENT_ID,
  projectId: PROJECT_ID,
  sourceSha256: SOURCE_SHA,
  evidenceVersion: 'ecos-hosted-evidence/1.3',
  revision: '1',
  pageNumber: 6,
  sheetNumber: 'C6',
  regionId: 'structured-table-fact:relationship:24bf97ccee6a45baca12ec44',
});

function pngBytes(width = 2, height = 3) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function sha(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function citation(bytes = pngBytes()) {
  return buildProtectedSourceCitation({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourceSha256: SOURCE_SHA,
    rasterSha256: sha(bytes),
    rasterByteCount: bytes.length,
    rasterWidth: 2,
    rasterHeight: 3,
  });
}

function responseBody(requestId: string, expectedCitation: ReturnType<typeof citation>, bytes = pngBytes()) {
  const locator = expectedCitation.locator;
  const pageKeys = [
    'organization_id', 'project_id', 'owner_id', 'source_id', 'source_sha256',
    'source_revision', 'source_page_count', 'page_number', 'execution_id',
    'binding_id', 'extraction_version', 'authority_decision_id',
    'authority_receipt_sha256', 'managed_attempt_id',
    'managed_receipt_sha256', 'page_attempt_id', 'page_sha256',
  ] as const;
  const rasterKeys = [
    'locator_schema_version', 'image_payload_sha256', 'visual_payload_sha256',
    'raster_sha256', 'raster_byte_count', 'raster_width', 'raster_height',
    'upload_attempt_id', 'raster_receipt_sha256', 'pixel_box',
    'coordinate_system', 'anchor_kind',
  ] as const;
  return {
    schemaVersion: 'ecos-owner-source-view/2.2',
    projectId: PROJECT_ID,
    requestId,
    preview: true,
    read_only: true,
    server_checks: 'owner_before_and_after_source_read_only',
    source: {
      kind: 'document_page',
      result: {
        schema_version: 'ecos-owner-document-source-view/2.1',
        state: 'current_exact_page_image',
        citation: expectedCitation,
        page: Object.fromEntries(pageKeys.map(key => [key, locator[key]])),
        raster: Object.fromEntries(rasterKeys.map(key => [key, locator[key]])),
        image_relation: 'exact_cited_visual_receipt',
        authorization: 'caller_required_before_and_after',
        highlight: null,
        coordinate_relationship: 'native_pdf_points_and_rotated_raster_pixels_not_converted',
        freshness: 'fresh_sequential_source_page_and_raster_readbacks_only',
        inventory_epoch_sha256: 'a'.repeat(64),
        index_epoch_sha256: 'b'.repeat(64),
        semantic_verified: false,
        whole_answer_verified: false,
        atomic_project_snapshot: false,
        retrieval_authorized: false,
      },
      png: {
        media_type: 'image/png',
        encoding: 'base64',
        data: Buffer.from(bytes).toString('base64'),
      },
    },
  };
}

function client() {
  const getSession = jest.fn(async () => ({
    data: { session: { user: { id: OWNER_ID }, access_token: 'owner-access-token' } },
    error: null,
  }));
  const unsubscribe = jest.fn();
  return {
    client: {
      auth: {
        getSession,
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe } } })),
      },
    } as any,
    getSession,
    unsubscribe,
  };
}

describe('protected Ask ECOS document page', () => {
  it('opens exact current PNG bytes without a local file, storage path, or public URL', async () => {
    const bytes = pngBytes();
    const expectedCitation = citation(bytes);
    const auth = client();
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(ECOS_PROTECTED_SOURCE_ENDPOINT);
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer owner-access-token' });
      const request = JSON.parse(String(init?.body));
      expect(request.citation).toEqual(expectedCitation);
      expect(request).not.toHaveProperty('storagePath');
      return new Response(JSON.stringify(responseBody(request.requestId, expectedCitation, bytes)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await loadECOSProtectedDocumentPage({
      client: auth.client,
      claim,
      citation: expectedCitation,
      fetchImpl: fetchImpl as any,
    });

    expect(result).toEqual({
      dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
      width: 2,
      height: 3,
      sha256: sha(bytes),
    });
    expect(auth.getSession).toHaveBeenCalledTimes(2);
    expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('rejects bytes that do not match the current raster receipt', async () => {
    const bytes = pngBytes();
    const expectedCitation = citation(bytes);
    const changed = bytes.slice();
    changed[32] = 1;
    const auth = client();
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(responseBody(request.requestId, expectedCitation, changed)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    await expect(loadECOSProtectedDocumentPage({
      client: auth.client,
      claim,
      citation: expectedCitation,
      fetchImpl: fetchImpl as any,
    })).rejects.toBeInstanceOf(ECOSProtectedDocumentPageError);
  });

  it('rejects a raster locator that is not pinned to the answer claim', () => {
    expect(normalizeECOSProtectedSourceCitation(
      { ...citation(), source_sha256: 'f'.repeat(64) },
      claim,
    )).toBeNull();
  });

  it('rejects an unauthenticated source-open attempt before making a network request', async () => {
    const fetchImpl = jest.fn();
    const unsubscribe = jest.fn();
    const unauthenticatedClient = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe } } })),
      },
    } as any;

    await expect(loadECOSProtectedDocumentPage({
      client: unauthenticatedClient,
      claim,
      citation: citation(),
      fetchImpl: fetchImpl as any,
    })).rejects.toMatchObject({ message: 'Sign in before opening the cited page.' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('rejects duplicate JSON keys even when ordinary JSON parsing would accept them', async () => {
    const bytes = pngBytes();
    const expectedCitation = citation(bytes);
    const auth = client();
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const valid = JSON.stringify(responseBody(request.requestId, expectedCitation, bytes));
      const duplicate = valid.replace(
        '"schemaVersion":"ecos-owner-source-view/2.2",',
        '"schemaVersion":"ecos-owner-source-view/2.2","schemaVersion":"ecos-owner-source-view/2.2",',
      );
      return new Response(duplicate, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(loadECOSProtectedDocumentPage({
      client: auth.client,
      claim,
      citation: expectedCitation,
      fetchImpl: fetchImpl as any,
    })).rejects.toBeInstanceOf(ECOSProtectedDocumentPageError);
  });

  it('fails closed when the protected source service denies project access', async () => {
    const auth = client();
    await expect(loadECOSProtectedDocumentPage({
      client: auth.client,
      claim,
      citation: citation(),
      fetchImpl: jest.fn(async () => new Response('{}', {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })) as any,
    })).rejects.toMatchObject({
      message: 'The current account cannot open this project source.',
    });
  });
});
