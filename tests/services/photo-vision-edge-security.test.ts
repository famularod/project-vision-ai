import fs from 'fs';
import path from 'path';
import { createPhotoAnalysisRunIdentity } from '../../services/PhotoAnalysisIdentity';
import {
  buildServerPhotoVisionPreflightId,
  buildServerPhotoVisionRequestId,
  callerPhotoVisionRequestIdMatches,
  isCanonicalPhotoEvidenceStoragePath,
  photoVisionCallerScopeIsAuthorized,
  readBoundedUtf8Json,
} from '../../supabase/functions/_shared/pie-photo-vision-request-security';
import {
  PIE_PHOTO_ANALYSIS_CONTRACT,
  photoAnalysisContractEnvelope,
} from '../../supabase/functions/_shared/pie-photo-analysis-contract';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = 'project-immutable-1';
const BASELINE_EVIDENCE_ID = 'pie-mobile-photo-v2-baseline';
const CURRENT_EVIDENCE_ID = 'pie-mobile-photo-v2-current';
const BASELINE_SHA = 'a'.repeat(64);
const CURRENT_SHA = 'b'.repeat(64);

function versions() {
  const contract = photoAnalysisContractEnvelope('photo_pair');
  return {
    contractVersion: contract.contractVersion,
    analyzerId: PIE_PHOTO_ANALYSIS_CONTRACT.analyzerId,
    analyzerVersion: contract.analyzerVersion,
    promptVersion: contract.promptVersion,
    schemaVersion: contract.schemaVersion,
    policyVersion: contract.policyVersion,
  };
}

function requestWithStreamedBody(
  chunks: Uint8Array[],
  declaredContentLength?: string,
) {
  let index = 0;
  let cancelled = false;
  return {
    request: {
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-length'
          ? declaredContentLength ?? null
          : null,
      },
      body: {
        getReader: () => ({
          read: async () => index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined },
          cancel: async () => {
            cancelled = true;
          },
          releaseLock: () => undefined,
        }),
      },
    } as unknown as Request,
    wasCancelled: () => cancelled,
  };
}

describe('photo-vision edge authorization and identity boundary', () => {
  it('bounds actual streamed UTF-8 bytes even when Content-Length is absent or false', async () => {
    const utf8Body = new Uint8Array(Buffer.from(JSON.stringify({
      operation: 'config_check',
      context: 'é'.repeat(16),
    }), 'utf8'));
    const split = Math.floor(utf8Body.byteLength / 2);
    const accepted = requestWithStreamedBody([
      utf8Body.slice(0, split),
      utf8Body.slice(split),
    ]);
    const acceptedResult = await readBoundedUtf8Json<Record<string, unknown>>(
      accepted.request,
      utf8Body.byteLength,
    );

    expect(acceptedResult).toEqual({
      ok: true,
      value: {
        operation: 'config_check',
        context: 'é'.repeat(16),
      },
    });

    const misleadingHeader = requestWithStreamedBody([utf8Body], '1');
    const rejectedResult = await readBoundedUtf8Json<Record<string, unknown>>(
      misleadingHeader.request,
      utf8Body.byteLength - 1,
    );

    expect(rejectedResult).toEqual({
      ok: false,
      error: 'request_too_large',
    });
    expect(misleadingHeader.wasCancelled()).toBe(true);
  });

  it('rejects malformed or non-UTF-8 bodies before JSON parsing', async () => {
    const malformedJson = requestWithStreamedBody([
      new Uint8Array(Buffer.from('{"operation":', 'utf8')),
    ]);
    const malformedUtf8 = requestWithStreamedBody([
      new Uint8Array([0xc3, 0x28]),
    ]);

    await expect(readBoundedUtf8Json(malformedJson.request, 100)).resolves.toEqual({
      ok: false,
      error: 'invalid_json',
    });
    await expect(readBoundedUtf8Json(malformedUtf8.request, 100)).resolves.toEqual({
      ok: false,
      error: 'invalid_json',
    });
  });

  it('fails closed for non-owners, cross-account scope, and unsafe projects', () => {
    const authorized = {
      isAppOwner: true,
      authenticatedUserId: ORGANIZATION_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
    };

    expect(photoVisionCallerScopeIsAuthorized(authorized)).toBe(true);
    expect(photoVisionCallerScopeIsAuthorized({
      ...authorized,
      isAppOwner: false,
    })).toBe(false);
    expect(photoVisionCallerScopeIsAuthorized({
      ...authorized,
      organizationId: '22222222-2222-4222-8222-222222222222',
    })).toBe(false);
    expect(photoVisionCallerScopeIsAuthorized({
      ...authorized,
      projectId: '../other-project',
    })).toBe(false);
  });

  it('recomputes the existing mobile pair identity from verified server inputs', () => {
    const mobile = createPhotoAnalysisRunIdentity({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      priorEvidenceId: BASELINE_EVIDENCE_ID,
      currentEvidenceId: CURRENT_EVIDENCE_ID,
      priorContentSha256: BASELINE_SHA,
      currentContentSha256: CURRENT_SHA,
      versions: versions(),
    });
    const server = buildServerPhotoVisionRequestId({
      mode: 'photo_pair',
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      baselineEvidenceId: BASELINE_EVIDENCE_ID,
      currentEvidenceId: CURRENT_EVIDENCE_ID,
      baselineContentSha256: BASELINE_SHA,
      currentContentSha256: CURRENT_SHA,
      versions: versions(),
    });

    expect(server).toBe(mobile.requestId);
    expect(callerPhotoVisionRequestIdMatches(mobile.requestId, server)).toBe(true);
    expect(callerPhotoVisionRequestIdMatches('attacker-controlled-id', server)).toBe(false);
  });

  it('scopes preflight IDs by owner, project, and evidence without trusting the caller', () => {
    const source = {
      mode: 'photo_pair' as const,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      baselineEvidenceId: BASELINE_EVIDENCE_ID,
      currentEvidenceId: CURRENT_EVIDENCE_ID,
      versions: versions(),
    };

    expect(buildServerPhotoVisionPreflightId(source)).not.toBe(
      buildServerPhotoVisionPreflightId({
        ...source,
        organizationId: '22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(buildServerPhotoVisionPreflightId(source)).not.toBe(
      buildServerPhotoVisionPreflightId({
        ...source,
        projectId: 'project-immutable-2',
      }),
    );
  });

  it('accepts only the canonical owner/project/evidence storage prefix', () => {
    const canonical = `${ORGANIZATION_ID}/${PROJECT_ID}/photo/${CURRENT_EVIDENCE_ID}/original.jpg`;
    const input = {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      evidenceId: CURRENT_EVIDENCE_ID,
    };

    expect(isCanonicalPhotoEvidenceStoragePath({ ...input, path: canonical })).toBe(true);
    expect(isCanonicalPhotoEvidenceStoragePath({
      ...input,
      path: `${ORGANIZATION_ID}/other-project/photo/${CURRENT_EVIDENCE_ID}/original.jpg`,
    })).toBe(false);
    expect(isCanonicalPhotoEvidenceStoragePath({
      ...input,
      path: `${ORGANIZATION_ID}/${PROJECT_ID}/photo/${CURRENT_EVIDENCE_ID}/../other.jpg`,
    })).toBe(false);
    expect(isCanonicalPhotoEvidenceStoragePath({
      ...input,
      path: `${ORGANIZATION_ID}/${PROJECT_ID}/photo/${CURRENT_EVIDENCE_ID}/%2e%2e%2fother.jpg`,
    })).toBe(false);
    expect(isCanonicalPhotoEvidenceStoragePath({
      ...input,
      path: `/absolute/${CURRENT_EVIDENCE_ID}.jpg`,
    })).toBe(false);
  });

  it('keeps owner verification, scoped IDs, metadata checks, and persistence failure checks in the live edge path', () => {
    const root = path.resolve(__dirname, '../..');
    const edge = fs.readFileSync(
      path.join(root, 'supabase/functions/pie-photo-vision/index.ts'),
      'utf8',
    );

    const ownerCheck = edge.indexOf(".rpc('dave_is_app_owner')");
    const bodyParse = edge.indexOf('await readBoundedUtf8Json<VisionRequest>');
    const configCheck = edge.indexOf("body?.operation === 'config_check'");
    expect(ownerCheck).toBeGreaterThan(0);
    expect(ownerCheck).toBeLessThan(bodyParse);
    expect(bodyParse).toBeLessThan(configCheck);
    expect(edge).not.toContain('await req.json()');
    expect(edge).toContain("bodyRead.error === 'request_too_large' ? 413 : 400");
    expect(edge).toContain('isAppOwner !== true');
    expect(edge).toContain('photoVisionCallerScopeIsAuthorized');
    expect(edge).toContain('buildServerPhotoVisionRequestId');
    expect(edge).toContain('callerPhotoVisionRequestIdMatches');
    expect(edge).not.toContain('request.requestId ??');
    expect(edge).toContain('isCanonicalPhotoEvidenceStoragePath');
    expect(edge).toContain('photo_asset_content_hash_mismatch');
    expect(edge).toContain("failedWrite: 'analysis_request'");
    expect(edge).toContain("markVisionPersistenceIncomplete(client, requestId, 'evidence_analysis')");
    expect(edge).toContain("markVisionPersistenceIncomplete(client, requestId, 'jarvis_result')");
    expect(edge).toContain("markVisionPersistenceIncomplete(client, requestId, 'semantic_comparison')");
    expect(edge).toContain("error: 'analysis_persistence_failed'");
  });

  it('keeps the mobile upload and server storage-path contracts aligned', () => {
    const root = path.resolve(__dirname, '../..');
    const mobile = fs.readFileSync(
      path.join(root, 'services/PIEPhotoVisionMobileWorkflow.ts'),
      'utf8',
    );
    const edge = fs.readFileSync(
      path.join(root, 'supabase/functions/pie-photo-vision/index.ts'),
      'utf8',
    );

    expect(mobile).toContain("const PIE_EVIDENCE_BUCKET = 'pie-project-evidence';");
    expect(edge).toContain("const BUCKET = 'pie-project-evidence';");
    expect(mobile).toContain(
      '`${organizationId}/${projectId}/photo/${evidenceId}/original.${extension}`',
    );
    expect(mobile).toContain('const storagePath = plan.existingStoragePath');
    expect(edge).toContain('duplicate_of_evidence_id');
    expect(edge).toContain("error: 'duplicate_photo_root_mismatch'");
    expect(edge).toContain('evidenceId: storagePathEvidenceId');
    expect(edge).toContain('isCanonicalPhotoEvidenceStoragePath');
  });
});
