import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2';
import {
  buildVisionProvider,
  type ProviderResult,
  type ProviderRunContext,
  type VisionImageInput,
  type VisionMode,
} from '../_shared/pie-vision-provider.ts';

type VisionRequest = {
  operation?: 'config_check';
  requestId?: string;
  mode?: VisionMode;
  organizationId: string;
  projectId: string;
  evidenceId?: string;
  baselineEvidenceId?: string;
  currentEvidenceId?: string;
  promptVersion?: string;
  forceReanalysis?: boolean;
};

type ImageDiagnostics = {
  evidenceId: string;
  photoAssetId: string | null;
  storagePathHash: string;
  sizeBytes: number | null;
  sha256: string | null;
  signedUrlGenerated: boolean;
};

const POLICY_VERSION = '2026.07.02-production-vision-policy';
const ANALYZER_ID = 'pie-production-photo-vision';
const ANALYZER_VERSION = '2026.07.02-production';
const BUCKET = 'pie-project-evidence';
const SIGNED_URL_EXPIRES_SECONDS = 600;
const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

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
  if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => null) as VisionRequest | null;
  if (body?.operation === 'config_check') {
    return json(buildRedactedConfigCheck());
  }

  const validationError = validateRequestShape(body);
  if (validationError) return json({ error: validationError }, 400);

  const request = body as Required<Pick<VisionRequest, 'organizationId' | 'projectId'>> & VisionRequest;
  const mode: VisionMode = request.mode ?? (request.baselineEvidenceId && request.currentEvidenceId ? 'photo_pair' : 'single_photo');
  const requestId = request.requestId ?? buildRequestId(request, mode);

  const hasAccess = await verifyProjectAccess(userClient, request.organizationId, request.projectId);
  if (!hasAccess) return json({ error: 'forbidden' }, 403);

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
      await persistRequestAndResult(
        serviceClient,
        request,
        requestId,
        mode,
        preflightResult,
        preflightResult ? null : image.error,
        validateNormalizedOutput(mode, preflightResult?.normalized ?? null),
        imageDiagnostics,
      );
      return json({ requestId, mode, status: preflightResult?.status ?? 'failed', error: image.error }, image.status);
    }
    imageDiagnostics.push(image.diagnostics);
    images.push(image);
  }

  if (mode === 'photo_pair') {
    const pairError = validateDistinctImagePair(images);
    if (pairError) {
      const preflightResult = buildPreflightDegradedResult(requestId, pairError);
      await persistRequestAndResult(
        serviceClient,
        request,
        requestId,
        mode,
        preflightResult,
        pairError,
        validateNormalizedOutput(mode, preflightResult.normalized ?? null),
        imageDiagnostics,
      );
      console.log(JSON.stringify(buildSafeImageDiagnosticLog({
        event: 'pie_vision_image_pair_rejected',
        requestId,
        mode,
        imageDiagnostics,
        providerInvocationId: requestId,
        providerResponseStatus: pairError,
      })));
      return json({ requestId, mode, status: 'failed', error: pairError }, 422);
    }
  }

  const context: ProviderRunContext = {
    mode,
    organizationId: request.organizationId,
    projectId: request.projectId,
    requestId,
    promptVersion: request.promptVersion ?? '2026.07.02-production-photo-vision',
    policyVersion: POLICY_VERSION,
    timeoutMs: Number(Deno.env.get('PIE_VISION_TIMEOUT_MS') ?? '45000'),
    maxRetries: Number(Deno.env.get('PIE_VISION_MAX_RETRIES') ?? '2'),
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

  const normalized = normalizeProviderOutput(mode, providerResult.normalized);
  const jarvis = validateNormalizedOutput(mode, normalized);
  const finalResult: ProviderResult = {
    ...providerResult,
    status: providerResult.status === 'succeeded' && jarvis.observationAccepted ? 'succeeded' : providerResult.status,
    normalized,
  };

  console.log(JSON.stringify(buildSafeImageDiagnosticLog({
    event: 'pie_vision_provider_completed',
    requestId,
    mode,
    imageDiagnostics,
    providerInvocationId: requestId,
    providerResponseStatus: finalResult.status,
  })));

  await persistRequestAndResult(serviceClient, request, requestId, mode, finalResult, null, jarvis, imageDiagnostics);

  return json({
    requestId,
    mode,
    status: finalResult.status,
    providerName: finalResult.providerName,
    modelName: finalResult.modelName,
    modelVersion: finalResult.modelVersion,
    latencyMs: finalResult.latencyMs,
    attempts: finalResult.attempts,
    jarvis,
  });
});

async function verifyProjectAccess(client: ReturnType<typeof createClient>, organizationId: string, projectId: string): Promise<boolean> {
  const { data, error } = await client.rpc('pie_layer4_has_permission', {
    org_id: organizationId,
    project_id: projectId,
    permission_name: 'synchronize_decision_history',
  });
  return !error && data === true;
}

async function loadAuthorizedImage(
  serviceClient: ReturnType<typeof createClient>,
  organizationId: string,
  projectId: string,
  evidenceId: string,
): Promise<(VisionImageInput & { diagnostics: ImageDiagnostics }) | { error: string; status: number; degraded?: boolean }> {
  const { data: evidence, error } = await serviceClient
    .from('pie_evidence_records')
    .select('id, organization_id, project_id, evidence_type, storage_refs, content_hash, mime_type')
    .eq('id', evidenceId)
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (error || !evidence || evidence.evidence_type !== 'photo') {
    return { error: 'photo_evidence_not_found_or_cross_boundary', status: 404 };
  }
  const storagePath = selectOriginalPath(evidence.storage_refs);
  if (!storagePath) return { error: 'missing_original_storage_ref', status: 422 };
  const evidenceSha = sha256FromContentHash(evidence.content_hash);

  const { data: asset } = await serviceClient
    .from('pie_photo_assets')
    .select('evidence_id, size_bytes, content_hash')
    .eq('evidence_id', evidenceId)
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .maybeSingle();
  const parsedSizeBytes = Number(asset?.size_bytes);
  const sizeBytes = Number.isFinite(parsedSizeBytes) ? parsedSizeBytes : null;
  const diagnosticsBase = {
    evidenceId,
    photoAssetId: typeof asset?.evidence_id === 'string' ? asset.evidence_id : null,
    storagePathHash: stableHash(storagePath),
    sizeBytes,
    sha256: sha256FromContentHash(asset?.content_hash) ?? evidenceSha,
  };
  if (sizeBytes === null || sizeBytes <= 0) return { error: 'image_missing_or_zero_bytes', status: 422 };
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
  const obstructionChange = stringValue(value.obstructionChange);
  const alignmentConfidence = confidenceValue(value.alignmentConfidence);
  const changeDetectionConfidence = confidenceValue(value.changeDetectionConfidence);
  const comparabilityReasons = stringArray(value.comparabilityReasons);
  const normalizedObjectAdditions = normalizeSpatialFindings('object_added', value.objectAdditions);
  const normalizedObjectRemovals = normalizeSpatialFindings('object_removed', value.objectRemovals);
  const normalizedMaterialChanges = normalizeSpatialFindings('material_change', value.materialOrStructuralChanges);
  const normalizedVisibleConcerns = normalizeSpatialFindings('visible_concern', value.visibleConcerns);
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
    limitations,
  });
  return {
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
    obstructionDifferences,
    obstructionChange,
    alignmentConfidence,
    changeDetectionConfidence,
    objectAdditions: arrayValue(value.objectAdditions),
    objectRemovals: arrayValue(value.objectRemovals),
    materialOrStructuralChanges: arrayValue(value.materialOrStructuralChanges),
    unchangedConditions: stringArray(value.unchangedConditions),
    possibleRegression: stringArray(value.possibleRegression),
    visibleConcerns: arrayValue(value.visibleConcerns),
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
  };
}

function validateNormalizedOutput(mode: VisionMode, normalized: Record<string, unknown> | null) {
  const observationReasons: string[] = [];
  const progressReasons: string[] = [];
  const authorityBoundaryReasons: string[] = [];
  const rejectedClaims: string[] = [];
  const warnings: string[] = [];
  if (!normalized) observationReasons.push('provider output missing or malformed');
  if (normalized && stringArray(normalized.limitations).length === 0) warnings.push('limitations not supplied by provider');
  for (const reason of stringArray(normalized?.comparabilityNormalizationReasons)) {
    warnings.push(reason);
  }
  const claims = JSON.stringify(normalized ?? {}).toLowerCase();
  for (const unsafe of ['fully compliant', 'passed inspection', 'caused by', 'responsible for', '100% complete', 'percent complete', 'hidden work', 'cost impact', 'schedule impact', 'milestone complete']) {
    if (claims.includes(unsafe)) observationReasons.push(`unsafe visual claim: ${unsafe}`);
  }
  let progressDisposition = 'unable_to_determine';
  let progressAccepted = false;
  let realityDisposition = 'not_eligible';
  let realityEligible = false;
  if (mode === 'photo_pair' && normalized) {
    const comparable = normalized.comparabilityClassification;
    const conclusion = normalized.conclusion;
    if ((comparable === 'weak' || comparable === 'not_comparable') && ['progress_visible', 'partial_progress_visible', 'possible_regression'].includes(String(conclusion))) {
      progressReasons.push('weak or not-comparable images cannot support progress conclusion');
    }
    for (const finding of spatialFindings(normalized.normalizedSpatialFindings)) {
      const objectName = stringValue(finding.normalizedObjectName || finding.rawObjectDescription || finding.findingType);
      if (objectName) observationReasons.push(`${objectName} visibly observed`);
      if (finding.locationConfidence === 'high' || finding.locationConfidence === 'medium') {
        const locationParts = [
          finding.imageHorizontalRegion !== 'unknown' ? finding.imageHorizontalRegion : '',
          finding.surfaceOrArea !== 'unknown' ? finding.surfaceOrArea : '',
        ].filter(Boolean).join(' ');
        observationReasons.push(locationParts ? `location supported as ${locationParts}` : 'location reasonably supported');
      }
      for (const reason of stringArray(finding.normalizationReasons)) {
        if (reason.includes('spatial location normalized from provider text')) warnings.push(reason);
      }
      if (finding.locationConfidence === 'low' && stringValue(finding.rawLocationText)) {
        warnings.push(`low confidence spatial location for ${stringValue(finding.normalizedObjectName || finding.findingType)}`);
      }
    }
    if (stringValue(normalized.viewpointAssessment)) {
      observationReasons.push(`viewpoint/framing limitation disclosed: ${stringValue(normalized.viewpointAssessment)}`);
    }
    if (['progress_visible', 'partial_progress_visible', 'possible_regression'].includes(String(conclusion))) {
      progressAccepted = progressReasons.length === 0 && observationReasons.length === 0;
      progressDisposition = progressAccepted ? 'supported' : 'blocked';
    } else if (conclusion === 'unable_to_determine') {
      progressDisposition = 'unable_to_determine';
      progressReasons.push('visual observation does not establish project progress');
    } else {
      progressDisposition = 'unsupported';
      progressReasons.push('no material visible project progress conclusion');
    }
  } else if (mode === 'single_photo' && normalized) {
    progressDisposition = 'unable_to_determine';
    progressReasons.push('single-photo analysis is visual observation only');
  }
  const blockingObservationReasons = observationReasons.filter(reason =>
    reason.includes('provider output missing or malformed') ||
    reason.includes('unsafe visual claim') ||
    reason.includes('location confidence insufficient') ||
    reason.includes('unsupported') ||
    reason.includes('conflict')
  );
  const observationAccepted = blockingObservationReasons.length === 0 && Boolean(normalized);
  const observationDisposition = observationAccepted
    ? warnings.length > 0 || stringArray(normalized?.limitations).length > 0
      ? 'accepted_with_limitations'
      : 'accepted'
    : normalized
      ? 'rejected'
      : 'quarantined';
  if (observationAccepted) {
    realityEligible = true;
    realityDisposition = progressAccepted ? 'eligible_as_observation' : 'eligible_as_observation';
    authorityBoundaryReasons.push(
      progressAccepted
        ? 'progress-supporting visual evidence still requires normal downstream authority checks'
        : 'accepted as limited visual observation only; no authoritative project-progress assertion',
    );
  } else if (normalized) {
    realityDisposition = 'evidence_request_only';
    authorityBoundaryReasons.push('observation rejected or unsafe; request corroborating evidence');
  } else {
    realityDisposition = 'not_eligible';
    authorityBoundaryReasons.push('provider output unavailable or malformed');
  }
  rejectedClaims.push(...blockingObservationReasons, ...progressReasons.filter(reason => reason.includes('cannot support')));
  return {
    accepted: observationAccepted,
    outcome: observationAccepted ? 'supported_with_limitations' : 'blocked',
    observationDisposition,
    observationAccepted,
    observationReasons,
    progressDisposition,
    progressAccepted,
    progressReasons,
    realityDisposition,
    realityEligible,
    authorityBoundaryReasons,
    authoritativeProgressAssertionCount: progressAccepted ? 1 : 0,
    rejectedClaims,
    warnings,
    limitations: normalized ? stringArray(normalized.limitations) : ['Provider output unavailable.'],
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
  limitations: string[];
};

function normalizeComparabilityClassification(input: ComparabilityNormalizationInput): {
  comparabilityClassification: string;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (input.providerComparability === 'strong' && shouldDowngradeStrongComparability(input)) {
    reasons.push('comparability downgraded from strong because scene overlap, visual anchors, alignment confidence, change-detection confidence, or limiting image conditions do not support a strong comparison');
    return { comparabilityClassification: 'probable', reasons };
  }
  return { comparabilityClassification: input.providerComparability, reasons };
}

function shouldDowngradeStrongComparability(input: ComparabilityNormalizationInput): boolean {
  if (input.sameSceneProbability < 0.9 || input.sameSubjectProbability < 0.85) return true;
  if (input.alignmentConfidence === 'low' || input.changeDetectionConfidence === 'low') return true;
  if (hasInsufficientAnchorsOrOverlap(input)) return true;
  if (hasLimitingLightingOrObstruction(input)) return true;
  return false;
}

function hasInsufficientAnchorsOrOverlap(input: ComparabilityNormalizationInput): boolean {
  const text = [
    input.viewpointAssessment,
    input.sceneOverlapAssessment,
    ...input.sharedVisualAnchors,
    ...input.comparabilityReasons,
    ...input.limitations,
  ].join(' ').toLowerCase();
  return includesAny(text, [
    'insufficient anchor',
    'limited anchor',
    'few anchor',
    'limited overlap',
    'insufficient overlap',
    'missing comparison region',
    'important region missing',
    'cannot align',
    'not reliably aligned',
    'poor alignment',
    'significantly reduces confidence',
  ]);
}

function hasLimitingLightingOrObstruction(input: ComparabilityNormalizationInput): boolean {
  const text = [
    ...input.lightingDifferences,
    ...input.obstructionDifferences,
    ...input.limitations,
  ].join(' ').toLowerCase();
  return includesAny(text, [
    'limits comparison',
    'limited comparison',
    'limits comparability',
    'obstruct',
    'occluded',
    'blocked',
    'poor lighting',
    'lighting changed materially',
    'shadow',
    'glare',
    'blur',
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
  client: ReturnType<typeof createClient>,
  request: VisionRequest,
  requestId: string,
  mode: VisionMode,
  providerResult: ProviderResult | null,
  failureReason: string | null,
  jarvis: ReturnType<typeof validateNormalizedOutput>,
  imageDiagnostics: ImageDiagnostics[] = [],
): Promise<void> {
  const rejectedClaims = jarvis.rejectedClaims;
  const warnings = jarvis.warnings;
  await client.from('pie_vision_analysis_requests').upsert({
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
    prompt_version: request.promptVersion ?? '2026.07.02-production-photo-vision',
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
    },
  });

  const evidenceId = mode === 'single_photo' ? request.evidenceId : request.currentEvidenceId;
  if (evidenceId) {
    await client.from('pie_evidence_analyses').upsert({
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
      prompt_version: request.promptVersion ?? '2026.07.02-production-photo-vision',
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
      raw_response: providerResult?.rawResponse ?? { failureReason },
      usage: providerResult?.usage ?? {},
    });

    await client.from('pie_visual_jarvis_results').upsert({
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
  }

  if (mode === 'photo_pair' && request.baselineEvidenceId && request.currentEvidenceId && providerResult?.normalized) {
    await client.from('pie_photo_semantic_comparison_results').upsert({
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
      material_or_structural_changes: stringArray(providerResult.normalized.materialOrStructuralChanges),
      unchanged_conditions: stringArray(providerResult.normalized.unchangedConditions),
      possible_regression: stringArray(providerResult.normalized.possibleRegression),
      visible_concerns: stringArray(providerResult.normalized.visibleConcerns),
      comparability_classification: comparabilityValue(providerResult.normalized.comparabilityClassification),
      conclusion: conclusionValue(providerResult.normalized.conclusion),
      confidence: confidenceValue(providerResult.normalized.confidence),
      limitations: stringArray(providerResult.normalized.limitations),
      repeat_photo_guidance: stringArray(providerResult.normalized.repeatPhotoGuidance),
      deterministic_metrics: {
        ...(objectValue(providerResult.normalized.deterministicMetrics)),
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
        obstructionChange: stringValue(providerResult.normalized.obstructionChange),
        alignmentConfidence: confidenceValue(providerResult.normalized.alignmentConfidence),
        changeDetectionConfidence: confidenceValue(providerResult.normalized.changeDetectionConfidence),
        differenceClassifications: arrayValue(providerResult.normalized.differenceClassifications),
        normalizedSpatialFindings: arrayValue(providerResult.normalized.normalizedSpatialFindings),
        imageDiagnostics,
        imageHashesDifferent: imageDiagnostics.length === 2
          ? imageDiagnostics[0]?.sha256 !== imageDiagnostics[1]?.sha256
          : null,
        signedUrlsGenerated: imageDiagnostics.every(image => image.signedUrlGenerated),
        providerInvocationId: requestId,
        providerResponseStatus: providerResult.status,
      },
      provider_response: providerResult.rawResponse,
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
  }
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
  if (mode === 'single_photo' && !body.evidenceId) return 'evidenceId is required for single_photo';
  if (mode === 'photo_pair' && (!body.baselineEvidenceId || !body.currentEvidenceId)) {
    return 'baselineEvidenceId and currentEvidenceId are required for photo_pair';
  }
  return null;
}

function buildRequestId(request: VisionRequest, mode: VisionMode): string {
  const ids = mode === 'single_photo'
    ? request.evidenceId
    : `${request.baselineEvidenceId}:${request.currentEvidenceId}`;
  return `${mode}:${request.organizationId}:${request.projectId}:${ids}:${ANALYZER_VERSION}:${request.promptVersion ?? 'default'}`;
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
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
