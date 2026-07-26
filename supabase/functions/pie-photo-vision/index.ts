import {
  createClient,
  type SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2.108.2';
import {
  buildVisionProvider,
  type ProviderResult,
  type ProviderRunContext,
  type VisionImageInput,
  type VisionMode,
} from '../_shared/pie-vision-provider.ts';
import {
  PIE_PHOTO_PAIR_SCHEMA_VERSION,
  normalizePhotoFindings,
  validateStrictPhotoPairResponse,
} from '../_shared/pie-photo-comparison-schema.ts';
import {
  PIE_PHOTO_ANALYSIS_CONTRACT,
  normalizePhotoVisionProviderFailureReason,
  photoAnalysisContractEnvelope,
  validatePhotoAnalysisContractEnvelope,
} from '../_shared/pie-photo-analysis-contract.ts';
import { validateVisionAuthority } from '../_shared/pie-vision-authority.ts';
import {
  buildServerPhotoVisionPreflightId,
  buildServerPhotoVisionRequestId,
  callerPhotoVisionRequestIdMatches,
  isCanonicalPhotoEvidenceStoragePath,
  photoVisionCallerScopeIsAuthorized,
  readBoundedUtf8Json,
  type PhotoVisionRequestIdentityVersions,
} from '../_shared/pie-photo-vision-request-security.ts';

type VisionRequest = {
  operation?: 'config_check';
  requestId?: string;
  mode?: VisionMode;
  organizationId: string;
  projectId: string;
  evidenceId?: string;
  baselineEvidenceId?: string;
  currentEvidenceId?: string;
  contractVersion?: string;
  analyzerVersion?: string;
  promptVersion?: string;
  schemaVersion?: string;
  policyVersion?: string;
  forceReanalysis?: boolean;
  projectName?: string;
  areaName?: string | null;
  fieldNotes?: string | null;
};

type ImageDiagnostics = {
  evidenceId: string;
  photoAssetId: string | null;
  storagePathHash: string;
  sizeBytes: number | null;
  sha256: string | null;
  signedUrlGenerated: boolean;
};

type VisionPersistenceResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; failedWrite: string }>;

type EdgeSupabaseClient = SupabaseClient<any, 'public', 'public', any, any>;

const POLICY_VERSION = PIE_PHOTO_ANALYSIS_CONTRACT.policyVersion;
const ANALYZER_ID = PIE_PHOTO_ANALYSIS_CONTRACT.analyzerId;
const ANALYZER_VERSION = PIE_PHOTO_ANALYSIS_CONTRACT.analyzerVersion;
const BUCKET = 'pie-project-evidence';
const SIGNED_URL_EXPIRES_SECONDS = 600;
const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_FIELD_NOTES_LENGTH = 4_000;
const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
};

function defaultPromptVersion(mode: VisionMode): string {
  return photoAnalysisContractEnvelope(mode).promptVersion;
}

Deno.serve(async req => {
  const corsHeaders = corsHeadersFor(req);
  if (!corsHeaders) return json({ error: 'origin_not_allowed' }, 403);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const respond = (body: unknown, status = 200) => json(body, status, corsHeaders);
  if (req.method !== 'POST') return respond({ error: 'method_not_allowed' }, 405);
  const declaredRequestBytes = Number(req.headers.get('content-length') || '0');
  if (
    Number.isFinite(declaredRequestBytes) &&
    declaredRequestBytes > MAX_REQUEST_BYTES
  ) {
    return respond({ error: 'request_too_large' }, 413);
  }

  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const anonKey = requiredEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization') ?? '';

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return respond({ error: 'unauthorized' }, 401);

  // The service client bypasses RLS and can invoke a paid provider. Require
  // the server-maintained singleton owner before parsing any analysis input;
  // organizationId=userId alone is not sufficient authorization.
  const { data: isAppOwner, error: ownerError } = await userClient
    .rpc('dave_is_app_owner');
  if (ownerError) {
    return respond({ error: 'owner_verification_unavailable' }, 503);
  }
  if (isAppOwner !== true) return respond({ error: 'forbidden' }, 403);

  const bodyRead = await readBoundedUtf8Json<VisionRequest>(
    req,
    MAX_REQUEST_BYTES,
  );
  if (!bodyRead.ok) {
    return respond(
      { error: bodyRead.error },
      bodyRead.error === 'request_too_large' ? 413 : 400,
    );
  }
  const body = bodyRead.value;
  if (body?.operation === 'config_check') {
    return respond(buildRedactedConfigCheck());
  }

  const validationError = validateRequestShape(body);
  if (validationError) return respond({ error: validationError }, 400);

  const request = body as Required<Pick<VisionRequest, 'organizationId' | 'projectId'>> & VisionRequest;
  const mode: VisionMode = request.mode ?? (request.baselineEvidenceId && request.currentEvidenceId ? 'photo_pair' : 'single_photo');
  const contractValidation = validatePhotoAnalysisContractEnvelope(mode, request);
  if (!contractValidation.valid) {
    return respond({
      error: 'photo_analysis_contract_mismatch',
      categories: contractValidation.categories,
      expectedContractVersion: PIE_PHOTO_ANALYSIS_CONTRACT.contractVersion,
    }, 409);
  }
  const contractEnvelope = photoAnalysisContractEnvelope(mode);
  const requestIdentityVersions = photoVisionRequestIdentityVersions(mode);

  const hasAccess = photoVisionCallerScopeIsAuthorized({
    isAppOwner,
    authenticatedUserId: userData.user.id,
    organizationId: request.organizationId,
    projectId: request.projectId,
  });
  if (!hasAccess) return respond({ error: 'forbidden' }, 403);

  // Safe provisional ID for failure diagnostics. The primary key is always
  // derived by this server and never copied from request.requestId.
  let requestId = buildServerPhotoVisionPreflightId({
    mode,
    organizationId: request.organizationId,
    projectId: request.projectId,
    evidenceId: request.evidenceId,
    baselineEvidenceId: request.baselineEvidenceId,
    currentEvidenceId: request.currentEvidenceId,
    versions: requestIdentityVersions,
  });

  const evidenceIds = mode === 'single_photo'
    ? [request.evidenceId as string]
    : [request.baselineEvidenceId as string, request.currentEvidenceId as string];
  const images: VisionImageInput[] = [];
  const imageDiagnostics: ImageDiagnostics[] = [];
  for (const evidenceId of evidenceIds) {
    const image = await loadAuthorizedImage(serviceClient, request.organizationId, request.projectId, evidenceId);
    if ('error' in image) {
      const preflightResult = image.degraded
        ? buildPreflightDegradedResult(requestId, image.error)
        : null;
      const persisted = await persistRequestAndResult(
        serviceClient,
        request,
        requestId,
        mode,
        preflightResult,
        preflightResult ? null : image.error,
        validateVisionAuthority(mode, preflightResult?.normalized ?? null),
        imageDiagnostics,
      );
      if (!persisted.ok) {
        return persistenceFailureResponse(requestId, mode, persisted.failedWrite, corsHeaders);
      }
      return respond({ requestId, mode, status: preflightResult?.status ?? 'failed', error: image.error }, image.status);
    }
    imageDiagnostics.push(image.diagnostics);
    images.push(image);
  }

  requestId = buildServerPhotoVisionRequestId({
    mode,
    organizationId: request.organizationId,
    projectId: request.projectId,
    evidenceId: request.evidenceId,
    baselineEvidenceId: request.baselineEvidenceId,
    currentEvidenceId: request.currentEvidenceId,
    evidenceContentSha256: imageDiagnostics[0]?.sha256,
    baselineContentSha256: imageDiagnostics[0]?.sha256,
    currentContentSha256: imageDiagnostics[1]?.sha256,
    versions: requestIdentityVersions,
  });
  if (!callerPhotoVisionRequestIdMatches(request.requestId, requestId)) {
    return respond({
      error: 'request_identity_mismatch',
      requestId,
      mode,
    }, 409);
  }

  if (mode === 'photo_pair') {
    const pairError = validateDistinctImagePair(images);
    if (pairError) {
      const preflightResult = buildPreflightDegradedResult(requestId, pairError);
      const persisted = await persistRequestAndResult(
        serviceClient,
        request,
        requestId,
        mode,
        preflightResult,
        pairError,
        validateVisionAuthority(mode, preflightResult.normalized ?? null),
        imageDiagnostics,
      );
      if (!persisted.ok) {
        return persistenceFailureResponse(requestId, mode, persisted.failedWrite, corsHeaders);
      }
      console.log(JSON.stringify(buildSafeImageDiagnosticLog({
        event: 'pie_vision_image_pair_rejected',
        requestId,
        mode,
        imageDiagnostics,
        providerInvocationId: requestId,
        providerResponseStatus: pairError,
      })));
      return respond({ requestId, mode, status: 'failed', error: pairError }, 422);
    }
  }

  const operationFingerprint = await sha256Hex(JSON.stringify({
    requestId,
    projectId: request.projectId,
    mode,
    evidence: imageDiagnostics.map(image => ({
      evidenceId: image.evidenceId,
      sha256: image.sha256,
      sizeBytes: image.sizeBytes,
    })),
    versions: requestIdentityVersions,
  }));
  const operationBegin = await userClient.rpc('dave_begin_ai_operation', {
    p_operation_type: 'photo_analysis',
    p_idempotency_key: `photo:${await sha256Hex(requestId)}`,
    p_project_ids: [request.projectId],
    p_payload_fingerprint: operationFingerprint,
    p_payload_bytes: new TextEncoder().encode(JSON.stringify(body)).byteLength,
  });
  if (operationBegin.error || !operationBegin.data) {
    return respond({ error: 'ai_operation_control_unavailable' }, 503);
  }
  const operationControl = operationBegin.data as {
    action?: string;
    request_id?: string;
    response_payload?: unknown;
    retry_after_seconds?: number;
  };
  if (operationControl.action === 'replay') {
    return respond(operationControl.response_payload);
  }
  if (operationControl.action === 'in_progress') {
    return respond({
      error: 'analysis_in_progress',
      retryAfterSeconds: operationControl.retry_after_seconds ?? 15,
    }, 409);
  }
  if (operationControl.action === 'rate_limited') {
    return respond({
      error: 'analysis_rate_limited',
      retryAfterSeconds: operationControl.retry_after_seconds ?? 60,
    }, 429);
  }
  if (operationControl.action === 'idempotency_conflict') {
    return respond({ error: 'analysis_idempotency_conflict' }, 409);
  }
  if (
    operationControl.action !== 'start' ||
    typeof operationControl.request_id !== 'string'
  ) {
    return respond({ error: 'ai_operation_control_invalid' }, 503);
  }
  const operationRequestId = operationControl.request_id;

  const context: ProviderRunContext = {
    mode,
    organizationId: request.organizationId,
    projectId: request.projectId,
    requestId,
    promptVersion: contractEnvelope.promptVersion,
    policyVersion: POLICY_VERSION,
    timeoutMs: Number(Deno.env.get('PIE_VISION_TIMEOUT_MS') ?? '45000'),
    maxRetries: Number(Deno.env.get('PIE_VISION_MAX_RETRIES') ?? '1'),
    projectName: request.projectName ?? null,
    areaName: request.areaName ?? null,
    fieldNotes: request.fieldNotes ?? null,
  };

  const provider = buildVisionProvider();
  console.log(JSON.stringify({
    event: 'pie_vision_image_preflight_complete',
    requestId,
    mode,
    currentPhotoAssetId: imageDiagnostics[1]?.photoAssetId ?? imageDiagnostics[0]?.photoAssetId ?? null,
    priorPhotoAssetId: imageDiagnostics[0]?.photoAssetId ?? null,
    currentEvidenceId: imageDiagnostics[1]?.evidenceId ?? imageDiagnostics[0]?.evidenceId ?? null,
    priorEvidenceId: imageDiagnostics[0]?.evidenceId ?? null,
    currentStoragePathHash: imageDiagnostics[1]?.storagePathHash ?? imageDiagnostics[0]?.storagePathHash ?? null,
    priorStoragePathHash: imageDiagnostics[0]?.storagePathHash ?? null,
    currentImageByteSize: imageDiagnostics[1]?.sizeBytes ?? imageDiagnostics[0]?.sizeBytes ?? null,
    priorImageByteSize: imageDiagnostics[0]?.sizeBytes ?? null,
    currentImageSha256: imageDiagnostics[1]?.sha256 ?? imageDiagnostics[0]?.sha256 ?? null,
    priorImageSha256: imageDiagnostics[0]?.sha256 ?? null,
    imageHashesDifferent: imageDiagnostics.length === 2
      ? imageDiagnostics[0]?.sha256 !== imageDiagnostics[1]?.sha256
      : null,
    signedUrlsGenerated: imageDiagnostics.every(image => image.signedUrlGenerated),
    providerInvocationId: requestId,
    imageTransport: images.map(image => image.transport),
    sourceImageByteSizes: images.map(image => image.sizeBytes ?? null),
  }));
  const providerResult = mode === 'single_photo'
    ? await provider.analyzeSinglePhoto(context, images[0])
    : await provider.comparePhotoPair(context, images[0], images[1]);

  const strictValidation = mode === 'photo_pair'
    ? validateStrictPhotoPairResponse(providerResult.normalized)
    : { valid: true as const };
  const malformedPairResponse = !strictValidation.valid;
  if (malformedPairResponse) {
    console.log(JSON.stringify({
      event: 'pie_vision_provider_response_degraded',
      requestId,
      mode,
      schemaVersion: PIE_PHOTO_PAIR_SCHEMA_VERSION,
      degradedResultStatus: 'malformed_comparison_result',
      rejectionCategories: strictValidation.categories,
    }));
  }
  const normalized = malformedPairResponse
    ? null
    : normalizeProviderOutput(mode, providerResult.normalized);
  const jarvis = validateVisionAuthority(mode, normalized);
  const finalResult: ProviderResult = {
    ...providerResult,
    status: malformedPairResponse
      ? 'degraded'
      : providerResult.status === 'succeeded'
        ? jarvis.observationAccepted ? 'succeeded' : 'degraded'
        : providerResult.status,
    normalized,
    error: malformedPairResponse ? 'malformed_comparison_result' : providerResult.error,
  };

  console.log(JSON.stringify(buildSafeImageDiagnosticLog({
    event: 'pie_vision_provider_completed',
    requestId,
    mode,
    imageDiagnostics,
    providerInvocationId: requestId,
    providerResponseStatus: finalResult.status,
  })));

  const persisted = await persistRequestAndResult(
    serviceClient,
    request,
    requestId,
    mode,
    finalResult,
    null,
    jarvis,
    imageDiagnostics,
  );
  if (!persisted.ok) {
    await finishAIOperation(
      userClient,
      operationRequestId,
      'failed',
      null,
      'analysis_persistence_failed',
    );
    return persistenceFailureResponse(requestId, mode, persisted.failedWrite, corsHeaders);
  }

  const responsePayload = {
    requestId,
    mode,
    contractVersion: contractEnvelope.contractVersion,
    analyzerVersion: contractEnvelope.analyzerVersion,
    promptVersion: contractEnvelope.promptVersion,
    schemaVersion: contractEnvelope.schemaVersion,
    policyVersion: contractEnvelope.policyVersion,
    status: finalResult.status,
    providerName: finalResult.providerName,
    modelName: finalResult.modelName,
    modelVersion: finalResult.modelVersion,
    latencyMs: finalResult.latencyMs,
    attempts: finalResult.attempts,
    failureReason: normalizePhotoVisionProviderFailureReason(finalResult.error),
    jarvis,
  };
  const operationFinished = await finishAIOperation(
    userClient,
    operationRequestId,
    'completed',
    responsePayload,
    null,
  );
  if (!operationFinished) {
    return respond({ error: 'ai_operation_finalize_failed' }, 503);
  }
  return respond(responsePayload);
});

async function loadAuthorizedImage(
  serviceClient: EdgeSupabaseClient,
  organizationId: string,
  projectId: string,
  evidenceId: string,
): Promise<(VisionImageInput & { diagnostics: ImageDiagnostics }) | { error: string; status: number; degraded?: boolean }> {
  if (!safeRequestScopeSegment(evidenceId)) {
    return { error: 'unsafe_evidence_identity', status: 400 };
  }
  const { data: evidence, error } = await serviceClient
    .from('pie_evidence_records')
    .select('id, organization_id, project_id, evidence_type, storage_refs, content_hash, mime_type')
    .eq('id', evidenceId)
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) {
    return { error: 'photo_evidence_lookup_failed', status: 502 };
  }
  if (!evidence || evidence.evidence_type !== 'photo') {
    return { error: 'photo_evidence_not_found_or_cross_boundary', status: 404 };
  }
  const storagePath = selectOriginalPath(evidence.storage_refs);
  if (!storagePath) return { error: 'missing_original_storage_ref', status: 422 };
  const evidenceSha = sha256FromContentHash(evidence.content_hash);
  if (!evidenceSha) return { error: 'invalid_evidence_content_hash', status: 422 };

  const { data: asset, error: assetError } = await serviceClient
    .from('pie_photo_assets')
    .select('evidence_id, duplicate_of_evidence_id, size_bytes, content_hash, original_storage_path')
    .eq('evidence_id', evidenceId)
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (assetError) return { error: 'photo_asset_lookup_failed', status: 502 };
  if (!asset) return { error: 'photo_asset_not_found_or_cross_boundary', status: 404 };
  if (asset.original_storage_path !== storagePath) {
    return { error: 'photo_asset_storage_ref_mismatch', status: 409 };
  }
  const assetSha = sha256FromContentHash(asset.content_hash);
  if (!assetSha || assetSha !== evidenceSha) {
    return { error: 'photo_asset_content_hash_mismatch', status: 409 };
  }

  // Mobile deduplication deliberately lets a byte-identical lineage record
  // reuse its canonical root object's path. Accept that one exception only
  // after verifying the root record is in the same owner/project boundary,
  // carries the same bytes, and names this exact storage object.
  let storagePathEvidenceId = evidenceId;
  const duplicateOfEvidenceId = typeof asset.duplicate_of_evidence_id === 'string'
    ? asset.duplicate_of_evidence_id.trim()
    : '';
  if (duplicateOfEvidenceId) {
    if (!safeRequestScopeSegment(duplicateOfEvidenceId)) {
      return { error: 'unsafe_duplicate_photo_root_identity', status: 409 };
    }
    const { data: duplicateRoot, error: duplicateRootError } = await serviceClient
      .from('pie_evidence_records')
      .select('id, evidence_type, storage_refs, content_hash')
      .eq('id', duplicateOfEvidenceId)
      .eq('organization_id', organizationId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (duplicateRootError) {
      return { error: 'duplicate_photo_root_lookup_failed', status: 502 };
    }
    const duplicateRootSha = sha256FromContentHash(duplicateRoot?.content_hash);
    if (
      !duplicateRoot ||
      duplicateRoot.evidence_type !== 'photo' ||
      duplicateRootSha !== evidenceSha ||
      selectOriginalPath(duplicateRoot.storage_refs) !== storagePath
    ) {
      return { error: 'duplicate_photo_root_mismatch', status: 409 };
    }
    storagePathEvidenceId = duplicateOfEvidenceId;
  }
  if (!isCanonicalPhotoEvidenceStoragePath({
    path: storagePath,
    organizationId,
    projectId,
    evidenceId: storagePathEvidenceId,
  })) {
    return { error: 'noncanonical_or_cross_boundary_storage_ref', status: 403 };
  }

  const parsedSizeBytes = Number(asset?.size_bytes);
  const sizeBytes = Number.isFinite(parsedSizeBytes) ? parsedSizeBytes : null;
  const diagnosticsBase = {
    evidenceId,
    photoAssetId: typeof asset?.evidence_id === 'string' ? asset.evidence_id : null,
    storagePathHash: stableHash(storagePath),
    sizeBytes,
    sha256: assetSha,
  };
  if (sizeBytes === null || sizeBytes <= 0) return { error: 'image_missing_or_zero_bytes', status: 422 };
  if (!isSupportedImageMimeType(evidence.mime_type)) {
    return { error: 'unsupported_image_mime_type', status: 422 };
  }
  const maxImageBytes = Number(Deno.env.get('PIE_VISION_MAX_IMAGE_BYTES') ?? DEFAULT_MAX_IMAGE_BYTES);
  if (sizeBytes !== null && sizeBytes > maxImageBytes) {
    console.log(JSON.stringify({
      event: 'pie_vision_image_oversize_degraded',
      evidenceId,
      storagePathHash: stableHash(storagePath),
      sizeBytes,
      maxImageBytes,
    }));
    return { error: 'image_exceeds_provider_size_limit', status: 200, degraded: true };
  }

  const { data: signed, error: signedError } = await serviceClient.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_SECONDS);
  if (signedError || !signed?.signedUrl) return { error: 'signed_image_url_failed', status: 502 };

  return {
    evidenceId,
    contentHash: evidence.content_hash,
    mimeType: evidence.mime_type || 'image/jpeg',
    signedUrl: signed.signedUrl,
    storagePath,
    sizeBytes,
    transport: 'signed_url',
    diagnostics: {
      ...diagnosticsBase,
      signedUrlGenerated: true,
    },
  };
}

function validateDistinctImagePair(images: VisionImageInput[]): string | null {
  const [baseline, current] = images;
  if (!baseline || !current) return 'photo_pair_missing_image';
  if (baseline.evidenceId === current.evidenceId) return 'photo_pair_same_evidence_id';
  if (!baseline.signedUrl || !current.signedUrl) return 'photo_pair_missing_signed_url';
  if (!baseline.sizeBytes || !current.sizeBytes) return 'photo_pair_zero_byte_image';
  if (baseline.contentHash && current.contentHash && baseline.contentHash === current.contentHash) {
    return 'photo_pair_identical_sha256';
  }
  return null;
}

function normalizeProviderOutput(mode: VisionMode, value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  if (mode === 'single_photo') {
    return {
      scene: stringValue(value.scene),
      probableProjectArea: nullableString(value.probableProjectArea),
      visibleSubjects: stringArray(value.visibleSubjects),
      equipment: stringArray(value.equipment),
      materials: stringArray(value.materials),
      visibleWork: stringArray(value.visibleWork),
      installationState: nullableString(value.installationState),
      visibleConditions: stringArray(value.visibleConditions),
      possibleQualityConcerns: stringArray(value.possibleQualityConcerns),
      possibleSafetyConcerns: stringArray(value.possibleSafetyConcerns),
      imageQuality: objectValue(value.imageQuality),
      directObservations: stringArray(value.directObservations),
      inferences: stringArray(value.inferences),
      confidence: confidenceValue(value.confidence),
      limitations: stringArray(value.limitations),
      requiredCorroboration: stringArray(value.requiredCorroboration),
      recommendedFollowUpEvidence: stringArray(value.recommendedFollowUpEvidence),
    };
  }
  const sameSceneProbability = numberValue(value.sameSceneProbability);
  const sameSubjectProbability = numberValue(value.sameSubjectProbability);
  const viewpointAssessment = stringValue(value.viewpointAssessment);
  const lightingDifferences = stringArray(value.lightingDifferences);
  const obstructionDifferences = stringArray(value.obstructionDifferences);
  const limitations = stringArray(value.limitations);
  const providerComparability = comparabilityValue(value.comparabilityClassification);
  const sharedVisualAnchors = stringArray(value.sharedVisualAnchors);
  const sceneOverlapAssessment = stringValue(value.sceneOverlapAssessment);
  const viewpointChange = stringValue(value.viewpointChange);
  const cameraAngleChange = stringValue(value.cameraAngleChange);
  const distanceChange = stringValue(value.distanceChange);
  const framingChange = stringValue(value.framingChange);
  const lightingChange = stringValue(value.lightingChange);
  const lightingComparabilityImpact = comparabilityImpactValue(value.lightingComparabilityImpact);
  const obstructionChange = stringValue(value.obstructionChange);
  const obstructionComparabilityImpact = comparabilityImpactValue(value.obstructionComparabilityImpact);
  const alignmentConfidence = confidenceValue(value.alignmentConfidence);
  const changeDetectionConfidence = confidenceValue(value.changeDetectionConfidence);
  const comparabilityReasons = stringArray(value.comparabilityReasons);
  const normalizedObjectAdditions = normalizeSpatialFindings('object_added', value.objectAdditions);
  const normalizedObjectRemovals = normalizeSpatialFindings('object_removed', value.objectRemovals);
  const normalizedMaterialChanges = normalizeSpatialFindings('material_change', value.materialOrStructuralChanges);
  const normalizedVisibleConcerns = normalizeSpatialFindings('visible_concern', value.visibleConcerns);
  const additions = normalizePhotoFindings(value.objectAdditions, 'added');
  const removals = normalizePhotoFindings(value.objectRemovals, 'removed');
  const materialChanges = normalizePhotoFindings(value.materialOrStructuralChanges, 'material_change');
  const visibleConcerns = normalizePhotoFindings(value.visibleConcerns, 'visible_concern');
  const movedObjects = normalizePhotoFindings(value.movedObjects, 'moved');
  const occludingObjects = normalizePhotoFindings(value.occludingObjects, 'occluding');
  const revealedObjects = normalizePhotoFindings(value.revealedObjects, 'revealed');
  const uncertainFindings = normalizePhotoFindings(value.uncertainFindings, 'uncertain');
  const canonicalFindings = [
    ...additions.findings,
    ...removals.findings,
    ...materialChanges.findings,
    ...visibleConcerns.findings,
    ...movedObjects.findings,
    ...occludingObjects.findings,
    ...revealedObjects.findings,
    ...uncertainFindings.findings,
  ];
  const normalizedSpatialFindings = [
    ...normalizedObjectAdditions,
    ...normalizedObjectRemovals,
    ...normalizedMaterialChanges,
    ...normalizedVisibleConcerns,
  ];
  const comparabilityNormalization = normalizeComparabilityClassification({
    providerComparability,
    sameSceneProbability,
    sameSubjectProbability,
    viewpointAssessment,
    sharedVisualAnchors,
    sceneOverlapAssessment,
    alignmentConfidence,
    changeDetectionConfidence,
    comparabilityReasons,
    lightingDifferences,
    obstructionDifferences,
    lightingComparabilityImpact,
    obstructionComparabilityImpact,
    limitations,
  });
  return {
    schemaVersion: stringValue(value.schemaVersion),
    sameSceneProbability,
    sameSubjectProbability,
    sharedVisualAnchors,
    sceneOverlapAssessment,
    viewpointAssessment,
    viewpointChange,
    cameraAngleChange,
    distanceChange,
    framingChange,
    lightingDifferences,
    lightingChange,
    lightingComparabilityImpact,
    obstructionDifferences,
    obstructionChange,
    obstructionComparabilityImpact,
    alignmentConfidence,
    changeDetectionConfidence,
    objectAdditions: additions.findings,
    objectRemovals: removals.findings,
    materialOrStructuralChanges: materialChanges.findings,
    unchangedConditions: stringArray(value.unchangedConditions),
    possibleRegression: stringArray(value.possibleRegression),
    visibleConcerns: visibleConcerns.findings,
    movedObjects: movedObjects.findings,
    occludingObjects: occludingObjects.findings,
    revealedObjects: revealedObjects.findings,
    uncertainFindings: uncertainFindings.findings,
    canonicalFindings,
    observations: stringArray(value.observations),
    interpretations: stringArray(value.interpretations),
    findingNormalizationDiagnostics: {
      schemaVersion: PIE_PHOTO_PAIR_SCHEMA_VERSION,
      rawFindingCount: additions.diagnostics.rawFindingCount + removals.diagnostics.rawFindingCount + materialChanges.diagnostics.rawFindingCount + visibleConcerns.diagnostics.rawFindingCount + movedObjects.diagnostics.rawFindingCount + occludingObjects.diagnostics.rawFindingCount + revealedObjects.diagnostics.rawFindingCount + uncertainFindings.diagnostics.rawFindingCount,
      normalizedFindingCount: canonicalFindings.length,
      legacyStringCount: additions.diagnostics.legacyStringCount + removals.diagnostics.legacyStringCount + materialChanges.diagnostics.legacyStringCount + visibleConcerns.diagnostics.legacyStringCount + movedObjects.diagnostics.legacyStringCount + occludingObjects.diagnostics.legacyStringCount + revealedObjects.diagnostics.legacyStringCount + uncertainFindings.diagnostics.legacyStringCount,
      rejectedFindingCount: additions.diagnostics.rejectedFindingCount + removals.diagnostics.rejectedFindingCount + materialChanges.diagnostics.rejectedFindingCount + visibleConcerns.diagnostics.rejectedFindingCount + movedObjects.diagnostics.rejectedFindingCount + occludingObjects.diagnostics.rejectedFindingCount + revealedObjects.diagnostics.rejectedFindingCount + uncertainFindings.diagnostics.rejectedFindingCount,
      rejectionCategories: [...new Set([
        ...additions.diagnostics.rejectionCategories,
        ...removals.diagnostics.rejectionCategories,
        ...materialChanges.diagnostics.rejectionCategories,
        ...visibleConcerns.diagnostics.rejectionCategories,
        ...movedObjects.diagnostics.rejectionCategories,
        ...occludingObjects.diagnostics.rejectionCategories,
        ...revealedObjects.diagnostics.rejectionCategories,
        ...uncertainFindings.diagnostics.rejectionCategories,
      ])],
    },
    normalizedSpatialFindings,
    comparabilityClassification: comparabilityNormalization.comparabilityClassification,
    providerComparabilityClassification: providerComparability,
    comparabilityReasons,
    comparabilityNormalizationReasons: comparabilityNormalization.reasons,
    differenceClassifications: arrayValue(value.differenceClassifications),
    conclusion: conclusionValue(value.conclusion),
    confidence: confidenceValue(value.confidence),
    limitations,
    repeatPhotoGuidance: stringArray(value.repeatPhotoGuidance),
    plainLanguageSummary: stringValue(value.plainLanguageSummary),
  };
}

type ComparabilityNormalizationInput = {
  providerComparability: string;
  sameSceneProbability: number;
  sameSubjectProbability: number;
  viewpointAssessment: string;
  sharedVisualAnchors: string[];
  sceneOverlapAssessment: string;
  alignmentConfidence: string;
  changeDetectionConfidence: string;
  comparabilityReasons: string[];
  lightingDifferences: string[];
  obstructionDifferences: string[];
  lightingComparabilityImpact: string;
  obstructionComparabilityImpact: string;
  limitations: string[];
};

const MIN_SHARED_VISUAL_ANCHORS = 2;

function normalizeComparabilityClassification(input: ComparabilityNormalizationInput): {
  comparabilityClassification: string;
  reasons: string[];
} {
  if (input.providerComparability !== 'strong') {
    return { comparabilityClassification: input.providerComparability, reasons: [] };
  }
  const triggers = collectStrongComparabilityDowngradeTriggers(input);
  if (triggers.length === 0) {
    return { comparabilityClassification: input.providerComparability, reasons: [] };
  }
  return {
    comparabilityClassification: 'probable',
    reasons: [`comparability downgraded from strong: ${triggers.join('; ')}`],
  };
}

function collectStrongComparabilityDowngradeTriggers(input: ComparabilityNormalizationInput): string[] {
  const triggers: string[] = [];
  if (input.sameSceneProbability < 0.9) {
    triggers.push(`sameSceneProbability ${input.sameSceneProbability} below 0.9 threshold`);
  }
  if (input.sameSubjectProbability < 0.85) {
    triggers.push(`sameSubjectProbability ${input.sameSubjectProbability} below 0.85 threshold`);
  }
  if (input.alignmentConfidence === 'low') triggers.push('alignmentConfidence reported low');
  if (input.changeDetectionConfidence === 'low') triggers.push('changeDetectionConfidence reported low');
  if (input.sharedVisualAnchors.length < MIN_SHARED_VISUAL_ANCHORS) {
    triggers.push(`only ${input.sharedVisualAnchors.length} shared visual anchor(s) reported, below minimum of ${MIN_SHARED_VISUAL_ANCHORS}`);
  }
  if (hasAlignmentOrOverlapInconsistencyText(input)) {
    triggers.push('alignment/overlap limitation language present in provider free text');
  }
  if (input.lightingComparabilityImpact === 'limiting') {
    triggers.push('lightingComparabilityImpact reported limiting');
  }
  if (input.obstructionComparabilityImpact === 'limiting') {
    triggers.push('obstructionComparabilityImpact reported limiting');
  }
  return triggers;
}

// Anchor sufficiency and alignment-confidence checks above are structured
// (sharedVisualAnchors.length, alignmentConfidence). This remaining text
// match is a cross-consistency safety net for cases where the model's free
// text hedges on alignment/overlap ("cannot align", "missing comparison
// region") without also lowering alignmentConfidence - not fully
// replaceable by a structured field without a prompt change.
function hasAlignmentOrOverlapInconsistencyText(input: ComparabilityNormalizationInput): boolean {
  const text = [
    input.viewpointAssessment,
    input.sceneOverlapAssessment,
    ...input.comparabilityReasons,
    ...input.limitations,
  ].join(' ').toLowerCase();
  return includesAny(text, [
    'missing comparison region',
    'important region missing',
    'cannot align',
    'not reliably aligned',
    'poor alignment',
    'significantly reduces confidence',
  ]);
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some(needle => text.includes(needle));
}

type NormalizedSpatialFinding = {
  findingType: string;
  rawObjectDescription: string;
  rawLocationText: string;
  object: string;
  location: string;
  confidence: 'high' | 'medium' | 'low';
  normalizedObjectName: string;
  imageHorizontalRegion: 'left' | 'center' | 'right' | 'unknown';
  imageVerticalRegion: 'upper' | 'middle' | 'lower' | 'unknown';
  subjectRelativeRegion: 'left_of_subject' | 'right_of_subject' | 'above_subject' | 'below_subject' | 'in_front_of_subject' | 'behind_subject' | 'beside_subject' | 'on_subject' | 'unknown';
  surfaceOrArea: 'table' | 'desk' | 'floor' | 'wall' | 'equipment' | 'structure' | 'unknown';
  locationConfidence: 'high' | 'medium' | 'low';
  normalizationReasons: string[];
};

function normalizeSpatialFindings(findingType: string, value: unknown): NormalizedSpatialFinding[] {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return entries.map(item => normalizeSpatialFinding(findingType, item)).filter(Boolean) as NormalizedSpatialFinding[];
}

function normalizeSpatialFinding(findingType: string, value: unknown): NormalizedSpatialFinding | null {
  const object = objectValue(value);
  const rawObjectDescription = stringValue(
    object.object ?? object.name ?? object.item ?? object.subject ?? object.description ?? object.change ?? object.finding ?? value,
  );
  const rawLocationText = stringValue(
    object.location ?? object.region ?? object.area ?? object.position ?? object.approximateRegion ?? object.where ?? '',
  );
  const combined = `${rawObjectDescription} ${rawLocationText}`.toLowerCase();
  if (!rawObjectDescription && !rawLocationText) return null;
  const reasons: string[] = [];
  const imageHorizontalRegion = normalizeHorizontalRegion(combined, reasons);
  const imageVerticalRegion = normalizeVerticalRegion(combined, reasons);
  const subjectRelativeRegion = normalizeSubjectRelativeRegion(combined, reasons);
  const surfaceOrArea = normalizeSurfaceOrArea(combined, reasons);
  const locationConfidence = normalizeLocationConfidence({
    rawLocationText,
    imageHorizontalRegion,
    imageVerticalRegion,
    subjectRelativeRegion,
    surfaceOrArea,
  });
  if (rawLocationText) reasons.push('spatial location normalized from provider text');
  else reasons.push('provider did not supply explicit location text');
  return {
    findingType,
    rawObjectDescription,
    rawLocationText,
    object: normalizeObjectName(rawObjectDescription),
    location: rawLocationText,
    confidence: locationConfidence,
    normalizedObjectName: normalizeObjectName(rawObjectDescription),
    imageHorizontalRegion,
    imageVerticalRegion,
    subjectRelativeRegion,
    surfaceOrArea,
    locationConfidence,
    normalizationReasons: reasons,
  };
}

function normalizeHorizontalRegion(text: string, reasons: string[]): NormalizedSpatialFinding['imageHorizontalRegion'] {
  if (includesAny(text, ['left side', 'left edge', 'left-hand', 'left hand', 'lower left', 'bottom left', 'front left', 'upper left'])) {
    reasons.push('horizontal region normalized as left');
    return 'left';
  }
  if (includesAny(text, ['right side', 'right edge', 'right-hand', 'right hand', 'lower right', 'lower-right', 'bottom right', 'front right', 'front-right', 'upper right', 'foreground right', 'on the right', 'to the right', 'right of'])) {
    reasons.push('horizontal region normalized as right');
    return 'right';
  }
  if (includesAny(text, ['center', 'middle', 'central'])) {
    reasons.push('horizontal region normalized as center');
    return 'center';
  }
  return 'unknown';
}

function normalizeVerticalRegion(text: string, reasons: string[]): NormalizedSpatialFinding['imageVerticalRegion'] {
  if (includesAny(text, ['lower', 'lower-right', 'lower right', 'bottom', 'foreground', 'front right', 'front-right', 'front left', 'front-left'])) {
    reasons.push('vertical region normalized as lower');
    return 'lower';
  }
  if (includesAny(text, ['upper', 'top edge', 'top side', 'above'])) {
    reasons.push('vertical region normalized as upper');
    return 'upper';
  }
  if (includesAny(text, ['middle', 'center', 'central'])) {
    reasons.push('vertical region normalized as middle');
    return 'middle';
  }
  return 'unknown';
}

function normalizeSubjectRelativeRegion(text: string, reasons: string[]): NormalizedSpatialFinding['subjectRelativeRegion'] {
  if (includesAny(text, ['right of', 'to the right', 'on the right'])) {
    reasons.push('subject-relative region normalized as right_of_subject');
    return 'right_of_subject';
  }
  if (includesAny(text, ['left of', 'to the left', 'on the left'])) {
    reasons.push('subject-relative region normalized as left_of_subject');
    return 'left_of_subject';
  }
  if (includesAny(text, ['above'])) return 'above_subject';
  if (includesAny(text, ['below', 'under'])) return 'below_subject';
  if (includesAny(text, ['in front', 'foreground', 'front-right', 'front right', 'front-left', 'front left'])) return 'in_front_of_subject';
  if (includesAny(text, ['behind', 'background'])) return 'behind_subject';
  if (includesAny(text, ['beside', 'next to', 'adjacent'])) {
    reasons.push('subject-relative region normalized as beside_subject');
    return 'beside_subject';
  }
  if (includesAny(text, ['on table', 'on the table', 'on desk', 'on the desk', 'on tabletop', 'tabletop', 'desktop'])) return 'on_subject';
  return 'unknown';
}

function normalizeSurfaceOrArea(text: string, reasons: string[]): NormalizedSpatialFinding['surfaceOrArea'] {
  if (includesAny(text, ['tabletop', 'table top', 'table'])) {
    reasons.push('surface normalized as table');
    return 'table';
  }
  if (includesAny(text, ['desktop', 'desk'])) {
    reasons.push('surface normalized as desk');
    return 'desk';
  }
  if (text.includes('floor')) return 'floor';
  if (text.includes('wall')) return 'wall';
  if (includesAny(text, ['equipment', 'machine', 'laptop', 'cabinet', 'panel'])) return 'equipment';
  if (includesAny(text, ['structure', 'beam', 'column', 'ceiling', 'roof', 'framing'])) return 'structure';
  return 'unknown';
}

function normalizeLocationConfidence(input: {
  rawLocationText: string;
  imageHorizontalRegion: string;
  imageVerticalRegion: string;
  subjectRelativeRegion: string;
  surfaceOrArea: string;
}): 'high' | 'medium' | 'low' {
  if (!input.rawLocationText.trim()) return 'low';
  let score = 0;
  if (input.imageHorizontalRegion !== 'unknown') score += 1;
  if (input.imageVerticalRegion !== 'unknown') score += 1;
  if (input.subjectRelativeRegion !== 'unknown') score += 1;
  if (input.surfaceOrArea !== 'unknown') score += 1;
  if (score >= 3) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

function normalizeObjectName(value: string): string {
  const text = value.toLowerCase();
  if (text.includes('mouse')) return text.includes('black') ? 'black computer mouse' : 'computer mouse';
  if (text.includes('damage')) return 'damage';
  if (text.includes('obstruction') || text.includes('blocked')) return 'obstruction';
  if (text.includes('equipment')) return 'equipment';
  return text.trim();
}

function spatialFindings(value: unknown): NormalizedSpatialFinding[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is NormalizedSpatialFinding => Boolean(item && typeof item === 'object'));
}

function buildPreflightDegradedResult(requestId: string, error: string): ProviderResult {
  return {
    status: 'degraded',
    providerName: null,
    modelName: null,
    modelVersion: null,
    normalized: null,
    rawResponse: { failureReason: error },
    usage: {},
    latencyMs: 0,
    attempts: 0,
    error: `${error}; request=${requestId}`,
  };
}

async function persistRequestAndResult(
  client: EdgeSupabaseClient,
  request: VisionRequest,
  requestId: string,
  mode: VisionMode,
  providerResult: ProviderResult | null,
  failureReason: string | null,
  jarvis: ReturnType<typeof validateVisionAuthority>,
  imageDiagnostics: ImageDiagnostics[] = [],
): Promise<VisionPersistenceResult> {
  const rejectedClaims = jarvis.rejectedClaims;
  const warnings = jarvis.warnings;
  const requestWrite = await client.from('pie_vision_analysis_requests').upsert({
    id: requestId,
    organization_id: request.organizationId,
    project_id: request.projectId,
    mode,
    evidence_id: request.evidenceId ?? null,
    baseline_evidence_id: request.baselineEvidenceId ?? null,
    current_evidence_id: request.currentEvidenceId ?? null,
    analyzer_id: ANALYZER_ID,
    analyzer_version: ANALYZER_VERSION,
    policy_version: POLICY_VERSION,
    prompt_version: defaultPromptVersion(mode),
    force_reanalysis: Boolean(request.forceReanalysis),
    status: providerResult?.status ?? 'failed',
    failure_reason: failureReason ?? providerResult?.error ?? null,
    latency_ms: providerResult?.latencyMs ?? null,
    attempt_count: providerResult?.attempts ?? 0,
    usage: providerResult?.usage ?? {},
    deterministic_metrics: {
      imageDiagnostics,
      imageHashesDifferent: imageDiagnostics.length === 2
        ? imageDiagnostics[0]?.sha256 !== imageDiagnostics[1]?.sha256
        : null,
      signedUrlsGenerated: imageDiagnostics.every(image => image.signedUrlGenerated),
      providerInvocationId: requestId,
      providerResponseStatus: providerResult?.status ?? failureReason ?? 'failed',
      contractVersion: PIE_PHOTO_ANALYSIS_CONTRACT.contractVersion,
      schemaVersion: photoAnalysisContractEnvelope(mode).schemaVersion,
    },
  });
  if (requestWrite.error) {
    return { ok: false, failedWrite: 'analysis_request' };
  }

  const evidenceId = mode === 'single_photo' ? request.evidenceId : request.currentEvidenceId;
  if (evidenceId) {
    const analysisWrite = await client.from('pie_evidence_analyses').upsert({
      id: `${requestId}:analysis`,
      evidence_id: evidenceId,
      organization_id: request.organizationId,
      project_id: request.projectId,
      analysis_type: mode === 'single_photo' ? 'production_single_photo' : 'production_photo_pair',
      analyzer_id: ANALYZER_ID,
      analyzer_version: ANALYZER_VERSION,
      provider_name: providerResult?.providerName ?? null,
      model_name: providerResult?.modelName ?? null,
      model_version: providerResult?.modelVersion ?? null,
      prompt_version: defaultPromptVersion(mode),
      policy_version: POLICY_VERSION,
      status: providerResult?.status ?? 'failed',
      observations: mode === 'single_photo'
        ? stringArray(providerResult?.normalized?.directObservations)
        : stringArray(providerResult?.normalized?.materialOrStructuralChanges),
      inferences: mode === 'single_photo'
        ? stringArray(providerResult?.normalized?.inferences)
        : stringArray(providerResult?.normalized?.visibleConcerns),
      extracted_entities: [],
      dates: [],
      commitments: [],
      owners: [],
      measurements: [],
      risks: [],
      conflicts: [],
      missing_information: stringArray(providerResult?.normalized?.recommendedFollowUpEvidence),
      confidence: confidenceValue(providerResult?.normalized?.confidence),
      limitations: stringArray(providerResult?.normalized?.limitations),
      authority: 'visual_observation_only',
      corroboration_required: true,
      visual_findings: providerResult?.normalized ?? {},
      unsafe_claims_rejected: rejectedClaims,
      raw_response: null,
      usage: providerResult?.usage ?? {},
    });
    if (analysisWrite.error) {
      return markVisionPersistenceIncomplete(client, requestId, 'evidence_analysis');
    }

    const jarvisWrite = await client.from('pie_visual_jarvis_results').upsert({
      id: `${requestId}:jarvis`,
      analysis_id: `${requestId}:analysis`,
      evidence_id: evidenceId,
      organization_id: request.organizationId,
      project_id: request.projectId,
      accepted: jarvis.observationAccepted && providerResult?.status === 'succeeded',
      outcome: jarvis.observationAccepted && providerResult?.status === 'succeeded' ? 'supported_with_limitations' : 'blocked',
      rejected_claims: rejectedClaims,
      warnings,
      limitations: stringArray(providerResult?.normalized?.limitations),
      policy_version: POLICY_VERSION,
    });
    if (jarvisWrite.error) {
      return markVisionPersistenceIncomplete(client, requestId, 'jarvis_result');
    }
  }

  if (mode === 'photo_pair' && request.baselineEvidenceId && request.currentEvidenceId && providerResult?.normalized) {
    const comparisonWrite = await client.from('pie_photo_semantic_comparison_results').upsert({
      id: `${requestId}:comparison`,
      request_id: requestId,
      organization_id: request.organizationId,
      project_id: request.projectId,
      baseline_evidence_id: request.baselineEvidenceId,
      current_evidence_id: request.currentEvidenceId,
      same_scene_probability: numberValue(providerResult.normalized.sameSceneProbability),
      same_subject_probability: numberValue(providerResult.normalized.sameSubjectProbability),
      viewpoint_assessment: stringValue(providerResult.normalized.viewpointAssessment),
      lighting_differences: stringArray(providerResult.normalized.lightingDifferences),
      obstruction_differences: stringArray(providerResult.normalized.obstructionDifferences),
      object_additions: arrayValue(providerResult.normalized.objectAdditions),
      object_removals: arrayValue(providerResult.normalized.objectRemovals),
      material_or_structural_changes: arrayValue(providerResult.normalized.materialOrStructuralChanges),
      unchanged_conditions: stringArray(providerResult.normalized.unchangedConditions),
      possible_regression: stringArray(providerResult.normalized.possibleRegression),
      visible_concerns: arrayValue(providerResult.normalized.visibleConcerns),
      comparability_classification: comparabilityValue(providerResult.normalized.comparabilityClassification),
      conclusion: conclusionValue(providerResult.normalized.conclusion),
      confidence: confidenceValue(providerResult.normalized.confidence),
      limitations: stringArray(providerResult.normalized.limitations),
      repeat_photo_guidance: stringArray(providerResult.normalized.repeatPhotoGuidance),
      deterministic_metrics: {
        ...(objectValue(providerResult.normalized.deterministicMetrics)),
        plainLanguageSummary: stringValue(providerResult.normalized.plainLanguageSummary),
        rawProviderComparability: stringValue(providerResult.normalized.providerComparabilityClassification),
        rawProviderViewpointAssessment: stringValue(providerResult.normalized.viewpointAssessment),
        normalizedComparability: comparabilityValue(providerResult.normalized.comparabilityClassification),
        comparabilityNormalizationReasons: stringArray(providerResult.normalized.comparabilityNormalizationReasons),
        sharedVisualAnchors: stringArray(providerResult.normalized.sharedVisualAnchors),
        sceneOverlapAssessment: stringValue(providerResult.normalized.sceneOverlapAssessment),
        viewpointChange: stringValue(providerResult.normalized.viewpointChange),
        cameraAngleChange: stringValue(providerResult.normalized.cameraAngleChange),
        distanceChange: stringValue(providerResult.normalized.distanceChange),
        framingChange: stringValue(providerResult.normalized.framingChange),
        lightingChange: stringValue(providerResult.normalized.lightingChange),
        lightingComparabilityImpact: comparabilityImpactValue(providerResult.normalized.lightingComparabilityImpact),
        obstructionChange: stringValue(providerResult.normalized.obstructionChange),
        obstructionComparabilityImpact: comparabilityImpactValue(providerResult.normalized.obstructionComparabilityImpact),
        alignmentConfidence: confidenceValue(providerResult.normalized.alignmentConfidence),
        changeDetectionConfidence: confidenceValue(providerResult.normalized.changeDetectionConfidence),
        differenceClassifications: arrayValue(providerResult.normalized.differenceClassifications),
        normalizedSpatialFindings: arrayValue(providerResult.normalized.normalizedSpatialFindings),
        schemaVersion: stringValue(providerResult.normalized.schemaVersion),
        canonicalFindings: arrayValue(providerResult.normalized.canonicalFindings),
        observations: stringArray(providerResult.normalized.observations),
        interpretations: stringArray(providerResult.normalized.interpretations),
        findingNormalizationDiagnostics: objectValue(providerResult.normalized.findingNormalizationDiagnostics),
        imageDiagnostics,
        imageHashesDifferent: imageDiagnostics.length === 2
          ? imageDiagnostics[0]?.sha256 !== imageDiagnostics[1]?.sha256
          : null,
        signedUrlsGenerated: imageDiagnostics.every(image => image.signedUrlGenerated),
        providerInvocationId: requestId,
        providerResponseStatus: providerResult.status,
      },
      provider_response: null,
      jarvis_result: {
        accepted: jarvis.observationAccepted && providerResult.status === 'succeeded',
        rejectedClaims,
        warnings,
        observationDisposition: jarvis.observationDisposition,
        observationAccepted: jarvis.observationAccepted,
        observationReasons: jarvis.observationReasons,
        progressDisposition: jarvis.progressDisposition,
        progressAccepted: jarvis.progressAccepted,
        progressReasons: jarvis.progressReasons,
        realityDisposition: jarvis.realityDisposition,
        realityEligible: jarvis.realityEligible,
        authorityBoundaryReasons: jarvis.authorityBoundaryReasons,
        authoritativeProgressAssertionCount: jarvis.authoritativeProgressAssertionCount,
        comparabilityClassification: comparabilityValue(providerResult.normalized.comparabilityClassification),
        normalizedSpatialFindings: arrayValue(providerResult.normalized.normalizedSpatialFindings),
        policyVersion: POLICY_VERSION,
      },
    });
    if (comparisonWrite.error) {
      return markVisionPersistenceIncomplete(client, requestId, 'semantic_comparison');
    }
  }

  return { ok: true };
}

async function markVisionPersistenceIncomplete(
  client: EdgeSupabaseClient,
  requestId: string,
  failedWrite: string,
): Promise<VisionPersistenceResult> {
  const marker = await client
    .from('pie_vision_analysis_requests')
    .update({
      status: 'failed',
      failure_reason: `persistence_incomplete:${failedWrite}`,
    })
    .eq('id', requestId);

  if (marker.error) {
    console.error(JSON.stringify({
      event: 'pie_vision_persistence_failure_marker_failed',
      requestId,
      failedWrite,
    }));
  }
  return { ok: false, failedWrite };
}

function persistenceFailureResponse(
  requestId: string,
  mode: VisionMode,
  failedWrite: string,
  corsHeaders: Record<string, string>,
): Response {
  console.error(JSON.stringify({
    event: 'pie_vision_persistence_failed',
    requestId,
    mode,
    failedWrite,
  }));
  return json({
    requestId,
    mode,
    status: 'failed',
    error: 'analysis_persistence_failed',
  }, 502, corsHeaders);
}

function buildSafeImageDiagnosticLog(input: {
  event: string;
  requestId: string;
  mode: VisionMode;
  imageDiagnostics: ImageDiagnostics[];
  providerInvocationId: string;
  providerResponseStatus: string;
}) {
  return {
    event: input.event,
    requestId: input.requestId,
    mode: input.mode,
    currentPhotoAssetId: input.imageDiagnostics[1]?.photoAssetId ?? input.imageDiagnostics[0]?.photoAssetId ?? null,
    priorPhotoAssetId: input.imageDiagnostics[0]?.photoAssetId ?? null,
    currentEvidenceId: input.imageDiagnostics[1]?.evidenceId ?? input.imageDiagnostics[0]?.evidenceId ?? null,
    priorEvidenceId: input.imageDiagnostics[0]?.evidenceId ?? null,
    currentStoragePathHash: input.imageDiagnostics[1]?.storagePathHash ?? input.imageDiagnostics[0]?.storagePathHash ?? null,
    priorStoragePathHash: input.imageDiagnostics[0]?.storagePathHash ?? null,
    currentImageByteSize: input.imageDiagnostics[1]?.sizeBytes ?? input.imageDiagnostics[0]?.sizeBytes ?? null,
    priorImageByteSize: input.imageDiagnostics[0]?.sizeBytes ?? null,
    currentImageSha256: input.imageDiagnostics[1]?.sha256 ?? input.imageDiagnostics[0]?.sha256 ?? null,
    priorImageSha256: input.imageDiagnostics[0]?.sha256 ?? null,
    imageHashesDifferent: input.imageDiagnostics.length === 2
      ? input.imageDiagnostics[0]?.sha256 !== input.imageDiagnostics[1]?.sha256
      : null,
    signedUrlsGenerated: input.imageDiagnostics.every(image => image.signedUrlGenerated),
    providerInvocationId: input.providerInvocationId,
    providerResponseStatus: input.providerResponseStatus,
  };
}

function sha256FromContentHash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^sha256:([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function validateRequestShape(body: VisionRequest | null): string | null {
  if (!body?.organizationId || !body.projectId) return 'organizationId and projectId are required';
  const mode = body.mode ?? (body.baselineEvidenceId && body.currentEvidenceId ? 'photo_pair' : 'single_photo');
  if (mode !== 'single_photo' && mode !== 'photo_pair') return 'unsupported photo analysis mode';
  if (!safeRequestScopeSegment(body.organizationId) || !safeRequestScopeSegment(body.projectId)) {
    return 'organizationId and projectId must be safe identity values';
  }
  if (body.requestId !== undefined && (
    typeof body.requestId !== 'string' || body.requestId.length > 4_096
  )) {
    return 'requestId is invalid';
  }
  if (mode === 'single_photo' && !body.evidenceId) return 'evidenceId is required for single_photo';
  if (mode === 'photo_pair' && (!body.baselineEvidenceId || !body.currentEvidenceId)) {
    return 'baselineEvidenceId and currentEvidenceId are required for photo_pair';
  }
  const evidenceIds = mode === 'single_photo'
    ? [body.evidenceId]
    : [body.baselineEvidenceId, body.currentEvidenceId];
  if (evidenceIds.some(value => !safeRequestScopeSegment(value))) {
    return 'evidence IDs must be safe identity values';
  }
  if (!boundedOptionalText(body.projectName, 256) ||
    !boundedOptionalText(body.areaName, 256) ||
    !boundedOptionalText(body.fieldNotes, MAX_FIELD_NOTES_LENGTH)) {
    return 'photo analysis context is too large';
  }
  return null;
}

function photoVisionRequestIdentityVersions(
  mode: VisionMode,
): PhotoVisionRequestIdentityVersions {
  const contract = photoAnalysisContractEnvelope(mode);
  return {
    contractVersion: contract.contractVersion,
    analyzerId: ANALYZER_ID,
    analyzerVersion: contract.analyzerVersion,
    promptVersion: contract.promptVersion,
    schemaVersion: contract.schemaVersion,
    policyVersion: contract.policyVersion,
  };
}

function safeRequestScopeSegment(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function boundedOptionalText(value: unknown, maxLength: number): boolean {
  return value === undefined ||
    value === null ||
    (typeof value === 'string' && value.length <= maxLength);
}

function isSupportedImageMimeType(value: unknown): boolean {
  return typeof value === 'string' &&
    /^image\/(jpeg|jpg|png|heic|heif|webp)$/i.test(value);
}

function selectOriginalPath(storageRefs: unknown): string | null {
  if (!Array.isArray(storageRefs)) return null;
  const original = storageRefs.find(ref =>
    ref && typeof ref === 'object' && 'variant' in ref && ref.variant === 'original' && 'path' in ref,
  ) as { path?: unknown } | undefined;
  return typeof original?.path === 'string' ? original.path : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function confidenceValue(value: unknown): string {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function comparabilityValue(value: unknown): string {
  return ['strong', 'probable', 'weak', 'not_comparable'].includes(String(value)) ? String(value) : 'not_comparable';
}

function comparabilityImpactValue(value: unknown): string {
  return value === 'none' || value === 'minor' || value === 'limiting'
    ? value
    : 'none';
}

function conclusionValue(value: unknown): string {
  return ['progress_visible', 'partial_progress_visible', 'no_material_visible_change', 'possible_regression', 'unable_to_determine'].includes(String(value))
    ? String(value)
    : 'unable_to_determine';
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function buildRedactedConfigCheck() {
  const provider = Deno.env.get('PIE_VISION_PROVIDER');
  const model = Deno.env.get('PIE_OPENAI_VISION_MODEL');
  const timeout = Deno.env.get('PIE_VISION_TIMEOUT_MS');
  const retries = Deno.env.get('PIE_VISION_MAX_RETRIES');
  return {
    status: 'ok',
    secrets: {
      PIE_VISION_PROVIDER: Boolean(provider),
      PIE_OPENAI_API_KEY: Boolean(Deno.env.get('PIE_OPENAI_API_KEY')),
      PIE_OPENAI_VISION_MODEL: Boolean(model),
      PIE_VISION_TIMEOUT_MS: Boolean(timeout),
      PIE_VISION_MAX_RETRIES: Boolean(retries),
    },
    providerName: provider ?? null,
    modelName: model ?? null,
    timeoutMs: timeout ? Number(timeout) : null,
    maxRetries: retries ? Number(retries) : null,
    photoPairContract: photoAnalysisContractEnvelope('photo_pair'),
    singlePhotoContract: photoAnalysisContractEnvelope('single_photo'),
  };
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = BASE_CORS_HEADERS,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function corsHeadersFor(request: Request): Record<string, string> | null {
  const origin = request.headers.get('origin');
  if (!origin) return { ...BASE_CORS_HEADERS };
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    ...BASE_CORS_HEADERS,
    'Access-Control-Allow-Origin': origin,
  };
}

async function finishAIOperation(
  client: EdgeSupabaseClient,
  requestId: string,
  status: 'completed' | 'failed',
  responsePayload: unknown,
  errorCode: string | null,
): Promise<boolean> {
  const result = await client.rpc('dave_finish_ai_operation', {
    p_request_id: requestId,
    p_status: status,
    p_response_payload: responsePayload,
    p_error_code: errorCode,
  });
  return !result.error;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
