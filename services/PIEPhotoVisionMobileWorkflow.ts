import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import {
  getCurrentSessionAccessToken,
  getSupabaseClient,
  type JsonValue,
  type SupabaseSessionMissingReason,
  type SupabaseSessionTokenLookupResult,
} from './SupabaseService';
import type { ProjectUpdate, UpdatePhoto } from '../types';
import {
  PIE_PHOTO_FINDING_SCHEMA_VERSION,
  findingDisplayText,
  normalizePIEPhotoFindings,
  type PIEPhotoFinding,
} from './PIEPhotoFindingNormalization';

export type PIEPhotoIntelligenceStatus =
  | 'analyzing'
  | 'analysis_complete'
  | 'completed_with_limitations'
  | 'comparison_unavailable'
  | 'analysis_failed_retry'
  | 'no_suitable_prior_photo';

export type PIEPhotoIntelligenceDisplayState = {
  status: PIEPhotoIntelligenceStatus;
  title: string;
  summary: string;
  visibleChange: string | null;
  location: string | null;
  comparisonConfidence: string | null;
  comparability: string | null;
  captureLimitations: string[];
  projectProgress: 'supported' | 'unsupported' | 'unable_to_determine';
  repeatPhotoGuidance: string | null;
  authorityMessage: string;
  currentObservation?: string | null;
  changedFromPrior?: string | null;
  additions?: string[];
  removals?: string[];
  findings?: PIEPhotoFinding[];
  possibleProgress?: string | null;
  possibleConcerns?: string[];
  priorUpdateUsed?: string | null;
  requestId?: string | null;
  comparisonId?: string | null;
  analysisRequestId?: string | null;
  currentPhotoAssetId?: string | null;
  priorPhotoAssetId?: string | null;
  currentEvidenceId?: string | null;
  priorEvidenceId?: string | null;
  semanticComparisonResultId?: string | null;
  provenance?: 'visual_only' | 'caption_only' | 'visual_and_caption' | 'inferred' | 'unsupported';
  visualGroundingRegions?: string[];
  diagnostics?: PIEPhotoVisionDiagnostics | null;
  updatedAt: string;
};

type AnalyzeInput = {
  update: ProjectUpdate;
  photo: UpdatePhoto;
  priorUpdates: ProjectUpdate[];
  retryAttempt?: boolean;
};

type StagedPhotoEvidence = {
  assetId: string;
  evidenceId: string;
  storagePath: string;
  storagePathHash: string;
  contentHash: string;
  sizeBytes: number;
};

export type PIEPhotoPrepDiagnosticReason =
  | 'current_photo_missing'
  | 'current_photo_unreadable'
  | 'current_photo_zero_bytes'
  | 'current_photo_encoding_failed'
  | 'current_photo_upload_missing'
  | 'current_photo_storage_missing'
  | 'current_photo_unsupported_type'
  | 'prior_photo_missing'
  | 'prior_photo_unreadable'
  | 'prior_photo_zero_bytes'
  | 'prior_photo_encoding_failed'
  | 'prior_photo_upload_missing'
  | 'prior_photo_storage_missing'
  | 'prior_photo_stale_or_invalid'
  | 'prior_photo_wrong_area'
  | 'prior_photo_unsupported_type';

export type PIEImagePrepareFailureReason =
  | PIEPhotoPrepDiagnosticReason
  | 'edge_payload_invalid'
  | 'unknown_image_prepare_failure';

type PhotoPrepRole = 'current' | 'prior';

type PreparedPhotoFile =
  | {
      ok: true;
      role: PhotoPrepRole;
      uri: string;
      mimeType: string;
      extension: string;
      sizeBytes: number;
      sha256: string;
      base64: string;
    }
  | {
      ok: false;
      role: PhotoPrepRole;
      reason: PIEPhotoPrepDiagnosticReason;
      sizeBytes: number | null;
      detail?: string;
    };

export type PIEPhotoVisionDiagnostics = {
  currentPhotoAssetId: string | null;
  priorPhotoAssetId: string | null;
  currentEvidenceId: string | null;
  priorEvidenceId: string | null;
  currentStoragePathHash: string | null;
  priorStoragePathHash: string | null;
  currentImageByteSize: number | null;
  priorImageByteSize: number | null;
  currentImageSha256: string | null;
  priorImageSha256: string | null;
  currentPhotoPrepStatus: 'not_checked' | 'ready' | 'failed';
  priorPhotoPrepStatus: 'not_checked' | 'ready' | 'failed';
  currentPhotoPrepReason: PIEPhotoPrepDiagnosticReason | null;
  priorPhotoPrepReason: PIEPhotoPrepDiagnosticReason | null;
  currentPhotoReadable: boolean | null;
  priorPhotoReadable: boolean | null;
  currentPhotoUploadReady: boolean | null;
  priorPhotoUploadReady: boolean | null;
  usablePriorCandidateFound: boolean | null;
  skippedPriorCandidateCount: number;
  imagePrepareFailureReason: PIEImagePrepareFailureReason | null;
  imageHashesDifferent: boolean | null;
  signedUrlsGenerated: boolean | null;
  providerInvocationId: string | null;
  providerResponseStatus: string | null;
  failureCategory: 'network' | 'auth' | 'malformed_response' | 'provider_side' | 'unknown' | null;
  supabaseAuthState: 'loading' | 'signed_in' | 'signed_out' | 'expired' | 'unknown';
  tokenLookupResult: 'token_present' | 'token_missing' | null;
  tokenMissingReason: SupabaseSessionMissingReason | null;
  appAuthMode: 'supabase_authenticated' | 'local_only' | 'unknown';
  supabaseUserIdPresent: boolean | null;
  sessionTokenPresent: boolean | null;
  lastAuthEvent: string | null;
  screenReachedWithoutSupabaseAuth: boolean | null;
  retryRoutedToSignIn: boolean | null;
  signInClientSource: string | null;
  pieAnalysisClientSource: string | null;
  authHydrationCompleted: boolean | null;
  retryFetchedFreshToken: boolean | null;
  edgeFunctionInvoked: boolean;
  edgeFunctionStatus: string | null;
  analysisRequestId: string | null;
  semanticComparisonResultId: string | null;
  currentProjectKey: string | null;
  currentAreaKey: string | null;
  totalPriorCandidateCount: number;
  priorCandidatesAfterSameProject: number;
  priorCandidatesAfterSameArea: number;
  priorCandidatesAfterTimestamp: number;
  priorCandidatesAfterExcludingCurrent: number;
  priorCandidatesAfterUsableImage: number;
  selectedPriorUpdateId: string | null;
  selectedPriorPhotoId: string | null;
  selectedPriorDate: string | null;
  selectionCandidateCount: number;
  selectedPriorReason: string | null;
  noPriorReason: PIEPriorNoPriorReason | null;
  rejectedPriorReasons: string[];
  resultPairMatchesRequestedPair: boolean | null;
  resultProvenance: 'visual_only' | 'caption_only' | 'visual_and_caption' | 'inferred' | 'unsupported';
  executedStages: string[];
  findingSchemaVersion?: string | null;
  rawFindingCount?: number;
  normalizedFindingCount?: number;
  legacyStringFindingCount?: number;
  rejectedFindingCount?: number;
  findingRejectionCategories?: string[];
};

const PIE_EVIDENCE_BUCKET = 'pie-project-evidence';

export type PIEPriorNoPriorReason =
  | 'no_same_project'
  | 'no_same_area'
  | 'no_earlier_photo'
  | 'only_current_photo'
  | 'no_usable_image'
  | 'missing_project_key'
  | 'missing_area_key'
  | 'timestamp_invalid'
  | 'unknown';

export type PIEPriorPhotoMatchKey = {
  normalizedProjectKey: string | null;
  normalizedAreaKey: string | null;
  capturedOrSavedAt: string | null;
  timestampMs: number | null;
  updateId: string | null;
  photoId: string | null;
};

type PriorSelectionDiagnostics = {
  currentProjectKey: string | null;
  currentAreaKey: string | null;
  totalPriorCandidateCount: number;
  afterSameProject: number;
  afterSameArea: number;
  afterTimestamp: number;
  afterExcludingCurrent: number;
  afterUsableImage: number;
  selectedPriorUpdateId: string | null;
  selectedPriorPhotoId: string | null;
  selectedPriorDate: string | null;
  noPriorReason: PIEPriorNoPriorReason | null;
};

export function buildAnalyzingPhotoIntelligenceState(): PIEPhotoIntelligenceDisplayState {
  return {
    status: 'analyzing',
    title: 'Analyzing photo comparison',
    summary: 'PIE is comparing this photo with prior project evidence.',
    visibleChange: null,
    location: null,
    comparisonConfidence: null,
    comparability: null,
    captureLimitations: [],
    projectProgress: 'unable_to_determine',
    repeatPhotoGuidance: null,
    authorityMessage: 'Visual observations will not update project progress unless the evidence supports it.',
    updatedAt: new Date().toISOString(),
  };
}

export function buildPreparingSecurePhotoAnalysisState(
  tokenLookup?: SupabaseSessionTokenLookupResult | null,
  retryFetchedFreshToken: boolean | null = null,
): PIEPhotoIntelligenceDisplayState {
  return {
    status: 'analyzing',
    title: 'Preparing secure photo analysis',
    summary: 'Preparing secure photo analysis…',
    visibleChange: null,
    location: null,
    comparisonConfidence: null,
    comparability: null,
    captureLimitations: [],
    projectProgress: 'unable_to_determine',
    repeatPhotoGuidance: null,
    authorityMessage: 'PIE will compare the photos after the signed-in session is ready.',
    currentObservation: null,
    changedFromPrior: null,
    additions: [],
    removals: [],
    possibleProgress: null,
    possibleConcerns: [],
    priorUpdateUsed: null,
    diagnostics: buildDiagnostics({
      failureCategory: 'auth',
      providerResponseStatus: 'auth_loading',
      executedStages: ['auth_session_lookup'],
      resultProvenance: 'unsupported',
      tokenLookup,
      retryFetchedFreshToken,
    }),
    updatedAt: new Date().toISOString(),
  };
}

export function buildNoSuitablePriorPhotoIntelligenceState(
  summary = 'PIE needs a prior photo from this project area before it can compare visible changes.',
): PIEPhotoIntelligenceDisplayState {
  return {
    status: 'no_suitable_prior_photo',
    title: 'No suitable prior photo',
    summary,
    visibleChange: null,
    location: null,
    comparisonConfidence: null,
    comparability: null,
    captureLimitations: ['No prior photo was available for a reliable comparison.'],
    projectProgress: 'unable_to_determine',
    repeatPhotoGuidance: 'Capture a repeat photo from a similar angle when there is prior evidence to compare.',
    authorityMessage: 'No project progress was inferred from this photo alone.',
    currentObservation: null,
    changedFromPrior: null,
    additions: [],
    removals: [],
    possibleProgress: null,
    possibleConcerns: [],
    priorUpdateUsed: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function analyzeProjectPhotoWithVision({
  update,
  photo,
  priorUpdates,
  retryAttempt = false,
}: AnalyzeInput): Promise<PIEPhotoIntelligenceDisplayState> {
  const currentPrepared = await preparePhotoFileForVision(photo, 'current');
  if (!currentPrepared.ok) {
    return failedRetryState('Photo saved. Visual comparison unavailable.', {
      currentPhotoPrep: currentPrepared,
      providerResponseStatus: currentPrepared.reason,
      imagePrepareFailureReason: currentPrepared.reason,
      failureCategory: 'malformed_response',
      selectedPriorPhotoId: null,
      priorUpdateUsed: null,
      selectionCandidateCount: priorUpdates.reduce((total, item) => total + item.photos.length, 0),
      selectedPriorReason: null,
      priorSelectionDiagnostics: buildEmptyPriorSelectionDiagnostics(update, photo, {
        candidateCount: priorUpdates.reduce((total, item) => total + item.photos.length, 0),
        noPriorReason: 'unknown',
      }),
      rejectedPriorReasons: [`current photo rejected: ${currentPrepared.reason}`],
      executedStages: ['camera_capture', 'local_image_uri', 'current_photo_preparation_failed'],
      resultProvenance: 'unsupported',
      retryFetchedFreshToken: retryAttempt,
    });
  }

  const priorSelection = await findPriorComparablePhoto(update, photo, priorUpdates);
  if (!priorSelection.selected) {
    return {
      ...buildNoSuitablePriorPhotoIntelligenceState(
        priorSelection.candidateCount > 0
          ? 'No reliable prior photo to compare'
          : 'No earlier photo is available for comparison.',
      ),
      diagnostics: buildDiagnostics({
        currentPhotoPrep: currentPrepared,
        selectedPriorPhotoId: null,
        selectionCandidateCount: priorSelection.candidateCount,
        selectedPriorReason: null,
        priorSelectionDiagnostics: priorSelection.diagnostics,
        rejectedPriorReasons: priorSelection.rejectedReasons,
        usablePriorCandidateFound: false,
        skippedPriorCandidateCount: priorSelection.skippedCandidateCount,
        executedStages: ['camera_capture', 'local_image_uri', 'current_photo_prepared', 'prior_photo_selection'],
        resultProvenance: 'unsupported',
      }),
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return unavailableState('Photo intelligence is unavailable until Supabase is configured.', 'unknown');
  }

  const sessionTokenResult = await getCurrentSessionAccessToken();
  const tokenLookup = sessionTokenResult.data;
  if (!sessionTokenResult.ok || !tokenLookup) {
    return unavailableState(
      'Photo intelligence cannot access the signed-in session.',
      'auth',
      tokenLookup ?? null,
      retryAttempt,
    );
  }

  if (tokenLookup.status !== 'token_present' || !tokenLookup.accessToken || !tokenLookup.userId) {
    if (tokenLookup.missingReason === 'auth_loading') {
      return buildPreparingSecurePhotoAnalysisState(tokenLookup, retryAttempt);
    }

    return unavailableState(
      messageForTokenMissingReason(tokenLookup.missingReason),
      'auth',
      tokenLookup,
      retryAttempt,
    );
  }

  const organizationId = tokenLookup.userId;
  const projectId = projectIdForPhotoVision(update.projectName);
  let baselineEvidence: StagedPhotoEvidence | null = null;
  let currentEvidence: StagedPhotoEvidence | null = null;
  const executedStages = [
    'camera_capture',
    'local_image_uri',
    'local_file_readable',
    'current_photo_saved',
    'prior_photo_selected',
  ];

  try {
    baselineEvidence = await stagePhotoEvidence({
      organizationId,
      projectId,
      update: priorSelection.selected.update,
      photo: priorSelection.selected.photo,
      captureSource: 'library',
      preparedFile: priorSelection.selected.preparedFile,
    });
    executedStages.push('prior_photo_uploaded', 'prior_evidence_record_created');
    currentEvidence = await stagePhotoEvidence({
      organizationId,
      projectId,
      update,
      photo,
      captureSource: 'camera',
      preparedFile: currentPrepared,
    });
    executedStages.push('current_photo_uploaded', 'current_evidence_record_created');

    assertComparableEvidencePair(baselineEvidence, currentEvidence);

    const requestId = `pie-mobile-photo-pair-${stableHash([
      organizationId,
      projectId,
      baselineEvidence.evidenceId,
      currentEvidence.evidenceId,
    ].join(':'))}`;

    const { data: functionData, error } = await client.functions.invoke('pie-photo-vision', {
      headers: {
        Authorization: `Bearer ${tokenLookup.accessToken}`,
      },
      body: {
        requestId,
        mode: 'photo_pair',
        organizationId,
        projectId,
        baselineEvidenceId: baselineEvidence.evidenceId,
        currentEvidenceId: currentEvidence.evidenceId,
        projectName: update.projectName,
        areaName: photo.selectedAreaName || update.selectedAreaName || null,
        fieldNotes: update.notes || null,
      },
    });
    executedStages.push('edge_function_invoked');

    if (error) {
      return failedRetryState('Photo intelligence could not finish. PIE will retry when cloud sync runs.', {
        baselineEvidence,
        currentEvidence,
        requestId,
        providerResponseStatus: 'function_error',
        failureCategory: classifyFunctionError(error),
        selectedPriorPhotoId: priorSelection.selected.photo.id,
        priorUpdateUsed: priorSelection.selected.update.date || priorSelection.selected.update.id,
        selectionCandidateCount: priorSelection.candidateCount,
        selectedPriorReason: priorSelection.selected.reason,
        priorSelectionDiagnostics: priorSelection.diagnostics,
        rejectedPriorReasons: priorSelection.rejectedReasons,
        currentPhotoPrep: currentPrepared,
        priorPhotoPrep: priorSelection.selected.preparedFile,
        usablePriorCandidateFound: true,
        skippedPriorCandidateCount: priorSelection.skippedCandidateCount,
        executedStages,
        tokenLookup,
        retryFetchedFreshToken: retryAttempt,
      });
    }

    const functionStatus = providerStatus(functionData);
    if (functionStatus !== 'succeeded') {
      return failedRetryState('Photo intelligence returned an unavailable comparison. Retry analysis.', {
        baselineEvidence,
        currentEvidence,
        requestId,
        providerResponseStatus: functionStatus,
        failureCategory: functionStatus === 'degraded' ? 'malformed_response' : 'provider_side',
        selectedPriorPhotoId: priorSelection.selected.photo.id,
        priorUpdateUsed: priorSelection.selected.update.date || priorSelection.selected.update.id,
        selectionCandidateCount: priorSelection.candidateCount,
        selectedPriorReason: priorSelection.selected.reason,
        priorSelectionDiagnostics: priorSelection.diagnostics,
        rejectedPriorReasons: priorSelection.rejectedReasons,
        currentPhotoPrep: currentPrepared,
        priorPhotoPrep: priorSelection.selected.preparedFile,
        usablePriorCandidateFound: true,
        skippedPriorCandidateCount: priorSelection.skippedCandidateCount,
        executedStages: [...executedStages, 'provider_response_unavailable'],
        tokenLookup,
        retryFetchedFreshToken: retryAttempt,
      });
    }

    const { data, error: queryError } = await client
      .from('pie_photo_semantic_comparison_results')
      .select([
        'id',
        'request_id',
        'baseline_evidence_id',
        'current_evidence_id',
        'comparability_classification',
        'conclusion',
        'confidence',
        'limitations',
        'repeat_photo_guidance',
        'object_additions',
        'object_removals',
        'material_or_structural_changes',
        'visible_concerns',
        'deterministic_metrics',
        'jarvis_result',
      ].join(','))
      .eq('request_id', requestId)
      .eq('baseline_evidence_id', baselineEvidence.evidenceId)
      .eq('current_evidence_id', currentEvidence.evidenceId)
      .maybeSingle();
    executedStages.push('semantic_comparison_persisted');

    if (queryError || !data) {
      return failedRetryState('Photo intelligence finished, but the result is not available on this device yet.', {
        baselineEvidence,
        currentEvidence,
        requestId,
        providerResponseStatus: providerStatus(functionData),
        failureCategory: 'malformed_response',
        selectedPriorPhotoId: priorSelection.selected.photo.id,
        priorUpdateUsed: priorSelection.selected.update.date || priorSelection.selected.update.id,
        selectionCandidateCount: priorSelection.candidateCount,
        selectedPriorReason: priorSelection.selected.reason,
        priorSelectionDiagnostics: priorSelection.diagnostics,
        rejectedPriorReasons: priorSelection.rejectedReasons,
        currentPhotoPrep: currentPrepared,
        priorPhotoPrep: priorSelection.selected.preparedFile,
        usablePriorCandidateFound: true,
        skippedPriorCandidateCount: priorSelection.skippedCandidateCount,
        executedStages,
        tokenLookup,
        retryFetchedFreshToken: retryAttempt,
      });
    }

    const row = toRecord(data);
    const pairMatches =
      row.baseline_evidence_id === baselineEvidence.evidenceId &&
      row.current_evidence_id === currentEvidence.evidenceId;

    if (!pairMatches) {
      return failedRetryState('Photo intelligence returned a stale comparison for a different photo pair.', {
        baselineEvidence,
        currentEvidence,
        requestId,
        providerResponseStatus: providerStatus(functionData),
        failureCategory: 'malformed_response',
        selectedPriorPhotoId: priorSelection.selected.photo.id,
        priorUpdateUsed: priorSelection.selected.update.date || priorSelection.selected.update.id,
        selectionCandidateCount: priorSelection.candidateCount,
        selectedPriorReason: priorSelection.selected.reason,
        priorSelectionDiagnostics: priorSelection.diagnostics,
        rejectedPriorReasons: priorSelection.rejectedReasons,
        currentPhotoPrep: currentPrepared,
        priorPhotoPrep: priorSelection.selected.preparedFile,
        usablePriorCandidateFound: true,
        skippedPriorCandidateCount: priorSelection.skippedCandidateCount,
        executedStages,
        resultPairMatchesRequestedPair: false,
        tokenLookup,
        retryFetchedFreshToken: retryAttempt,
      });
    }

    executedStages.push('jarvis_result_persisted', 'mobile_result_hydrated', 'user_card_render_ready');

    return buildDisplayStateFromComparison(row, {
      baselineEvidence,
      currentEvidence,
      requestId,
      providerResponseStatus: providerStatus(functionData),
      selectedPriorPhotoId: priorSelection.selected.photo.id,
      priorUpdateUsed: priorSelection.selected.update.date || priorSelection.selected.update.id,
      selectionCandidateCount: priorSelection.candidateCount,
      selectedPriorReason: priorSelection.selected.reason,
      priorSelectionDiagnostics: priorSelection.diagnostics,
      rejectedPriorReasons: priorSelection.rejectedReasons,
      currentPhotoPrep: currentPrepared,
      priorPhotoPrep: priorSelection.selected.preparedFile,
      usablePriorCandidateFound: true,
      skippedPriorCandidateCount: priorSelection.skippedCandidateCount,
      executedStages,
      resultPairMatchesRequestedPair: true,
      tokenLookup,
      retryFetchedFreshToken: retryAttempt,
    });
  } catch (error) {
    const prepError = error instanceof PhotoPreparationError ? error : null;
    if (prepError?.role === 'prior') {
      return {
        ...buildNoSuitablePriorPhotoIntelligenceState('Prior photo unavailable'),
        diagnostics: buildDiagnostics({
          baselineEvidence,
          currentEvidence,
          currentPhotoPrep: currentPrepared,
          priorPhotoPrep: prepError.toPreparedFailure(),
          providerResponseStatus: prepError.reason,
          imagePrepareFailureReason: prepError.reason,
          failureCategory: classifyThrownError(error),
          selectedPriorPhotoId: null,
          priorUpdateUsed: null,
          selectionCandidateCount: priorSelection.candidateCount,
          selectedPriorReason: null,
          priorSelectionDiagnostics: {
            ...priorSelection.diagnostics,
            selectedPriorUpdateId: null,
            selectedPriorPhotoId: null,
            selectedPriorDate: null,
            noPriorReason: 'no_usable_image',
          },
          rejectedPriorReasons: [
            ...priorSelection.rejectedReasons,
            `${priorSelection.selected.update.id || 'update'}:${priorSelection.selected.photo.id || 'photo'} rejected: ${prepError.reason}`,
          ],
          usablePriorCandidateFound: false,
          skippedPriorCandidateCount: priorSelection.skippedCandidateCount + 1,
          executedStages,
          tokenLookup,
          retryFetchedFreshToken: retryAttempt,
          resultProvenance: 'unsupported',
        }),
      };
    }

    return failedRetryState('Photo saved. Visual comparison unavailable.', {
      baselineEvidence,
      currentEvidence,
      providerResponseStatus: error instanceof Error ? error.message : 'analysis_exception',
      imagePrepareFailureReason: imagePrepareFailureReasonForError(error),
      failureCategory: classifyThrownError(error),
      selectedPriorPhotoId: priorSelection.selected.photo.id,
      priorUpdateUsed: baselineEvidence && currentEvidence
        ? priorSelection.selected.update.date || priorSelection.selected.update.id
        : null,
      selectionCandidateCount: priorSelection.candidateCount,
      selectedPriorReason: priorSelection.selected.reason,
      priorSelectionDiagnostics: priorSelection.diagnostics,
      rejectedPriorReasons: priorSelection.rejectedReasons,
      currentPhotoPrep: prepError?.role === 'current' ? prepError.toPreparedFailure() : currentPrepared,
      priorPhotoPrep: priorSelection.selected.preparedFile,
      usablePriorCandidateFound: true,
      skippedPriorCandidateCount: priorSelection.skippedCandidateCount,
      executedStages,
      tokenLookup,
      retryFetchedFreshToken: retryAttempt,
    });
  }
}

async function findPriorComparablePhoto(
  update: ProjectUpdate,
  photo: UpdatePhoto,
  priorUpdates: ProjectUpdate[],
) {
  const currentKey = buildPIEPriorPhotoMatchKey(update, photo);
  const acceptedConfirmedArea: Array<{
    update: ProjectUpdate;
    photo: UpdatePhoto;
    reason: string;
    capturedAt: number;
    candidateIndex: number;
    preparedFile: Extract<PreparedPhotoFile, { ok: true }>;
  }> = [];
  const acceptedAreaFallback: Array<{
    update: ProjectUpdate;
    photo: UpdatePhoto;
    reason: string;
    capturedAt: number;
    candidateIndex: number;
    preparedFile: Extract<PreparedPhotoFile, { ok: true }>;
  }> = [];
  const rejectedReasons: string[] = [];
  let candidateCount = 0;
  let skippedCandidateCount = 0;
  let afterSameProject = 0;
  let afterSameArea = 0;
  let afterTimestamp = 0;
  let afterExcludingCurrent = 0;
  let afterUsableImage = 0;

  if (!currentKey.normalizedProjectKey) {
    const diagnostics = buildPriorSelectionDiagnostics(currentKey, {
      candidateCount,
      afterSameProject,
      afterSameArea,
      afterTimestamp,
      afterExcludingCurrent,
      afterUsableImage,
      selected: null,
      noPriorReason: 'missing_project_key',
    });
    return { selected: null, candidateCount, skippedCandidateCount, rejectedReasons, diagnostics };
  }

  for (const candidateUpdate of priorUpdates) {
    for (const candidatePhoto of candidateUpdate.photos) {
      candidateCount += 1;
      const label = `${candidateUpdate.id || 'update'}:${candidatePhoto.id || 'photo'}`;
      const candidateKey = buildPIEPriorPhotoMatchKey(candidateUpdate, candidatePhoto);
      const uri = candidatePhoto.uri || '';

      if (candidateKey.normalizedProjectKey !== currentKey.normalizedProjectKey) {
        rejectedReasons.push(`${label} rejected: different project`);
        continue;
      }
      afterSameProject += 1;

      const isAreaFallbackCandidate =
        Boolean(currentKey.normalizedAreaKey) && !candidateKey.normalizedAreaKey;

      if (
        currentKey.normalizedAreaKey &&
        candidateKey.normalizedAreaKey &&
        candidateKey.normalizedAreaKey !== currentKey.normalizedAreaKey
      ) {
        rejectedReasons.push(`${label} rejected: prior_photo_wrong_area`);
        skippedCandidateCount += 1;
        continue;
      }
      afterSameArea += 1;

      const timestampComparison = comparePriorCandidateTime(candidateKey, currentKey, candidateCount);
      if (timestampComparison === 'invalid_current') {
        rejectedReasons.push(`${label} rejected: timestamp_invalid`);
        continue;
      }
      if (timestampComparison === 'not_earlier') {
        rejectedReasons.push(`${label} rejected: not earlier than current photo`);
        continue;
      }
      afterTimestamp += 1;

      if (candidatePhoto.id === photo.id || candidateUpdate.id === update.id) {
        rejectedReasons.push(`${label} rejected: current photo/update`);
        continue;
      }
      afterExcludingCurrent += 1;

      if (!uri || /^placeholder:/i.test(uri)) {
        rejectedReasons.push(`${label} rejected: prior_photo_missing`);
        skippedCandidateCount += 1;
        continue;
      }

      const preparedFile = await preparePhotoFileForVision(candidatePhoto, 'prior');
      if (!preparedFile.ok) {
        rejectedReasons.push(`${label} rejected: ${preparedFile.reason}`);
        skippedCandidateCount += 1;
        continue;
      }
      afterUsableImage += 1;

      const candidateRecord = {
        update: candidateUpdate,
        photo: candidatePhoto,
        capturedAt: candidateKey.timestampMs ?? 0,
        candidateIndex: candidateCount,
        preparedFile,
        reason: isAreaFallbackCandidate
          ? 'most recent valid earlier photo from same project; prior photo has no area set, matched as area-unconfirmed fallback (no same-area candidate was available)'
          : currentKey.normalizedAreaKey
            ? 'most recent valid earlier photo from same project and area'
            : 'most recent valid earlier photo from same project',
      };

      if (isAreaFallbackCandidate) {
        acceptedAreaFallback.push(candidateRecord);
      } else {
        acceptedConfirmedArea.push(candidateRecord);
      }
    }
  }

  const byRecency = (
    a: { capturedAt: number; candidateIndex: number },
    b: { capturedAt: number; candidateIndex: number },
  ) => b.capturedAt - a.capturedAt || a.candidateIndex - b.candidateIndex;
  acceptedConfirmedArea.sort(byRecency);
  acceptedAreaFallback.sort(byRecency);
  const selected = acceptedConfirmedArea[0] ?? acceptedAreaFallback[0] ?? null;
  const noPriorReason = selected
    ? null
    : noPriorReasonFromCounters({
        currentKey,
        candidateCount,
        afterSameProject,
        afterSameArea,
        afterTimestamp,
        afterExcludingCurrent,
        afterUsableImage,
      });

  return {
    selected,
    candidateCount,
    skippedCandidateCount,
    rejectedReasons,
    diagnostics: buildPriorSelectionDiagnostics(currentKey, {
      candidateCount,
      afterSameProject,
      afterSameArea,
      afterTimestamp,
      afterExcludingCurrent,
      afterUsableImage,
      selected,
      noPriorReason,
    }),
  };
}

export function buildPIEPriorPhotoMatchKey(
  update: ProjectUpdate,
  photo?: UpdatePhoto | null,
): PIEPriorPhotoMatchKey {
  const capturedOrSavedAt = firstNonEmptyString([
    update.workflowTimestamps?.firstPhotoAddedAt,
    update.workflowTimestamps?.sendTappedAt,
    update.workflowTimestamps?.sendResolvedAt,
    photo?.locationCapturedAt,
    update.locationCapturedAt,
    update.pieStartedAt,
    update.date,
  ]);

  return {
    normalizedProjectKey: normalizedMatchKey(update.projectName),
    normalizedAreaKey: normalizedMatchKey(
      photo?.selectedAreaId ||
      update.selectedAreaId ||
      photo?.selectedAreaName ||
      update.selectedAreaName ||
      '',
    ),
    capturedOrSavedAt,
    timestampMs: timestampMsOrNull(capturedOrSavedAt),
    updateId: update.id || null,
    photoId: photo?.id || null,
  };
}

function comparePriorCandidateTime(
  candidateKey: PIEPriorPhotoMatchKey,
  currentKey: PIEPriorPhotoMatchKey,
  candidateIndex: number,
): 'earlier' | 'not_earlier' | 'invalid_current' {
  if (currentKey.timestampMs === null) return 'invalid_current';
  if (candidateKey.timestampMs === null) return candidateIndex > 0 ? 'earlier' : 'not_earlier';
  if (candidateKey.timestampMs < currentKey.timestampMs) return 'earlier';
  if (candidateKey.timestampMs === currentKey.timestampMs) {
    return candidateKey.updateId !== currentKey.updateId || candidateKey.photoId !== currentKey.photoId
      ? 'earlier'
      : 'not_earlier';
  }
  return 'not_earlier';
}

function noPriorReasonFromCounters({
  currentKey,
  candidateCount,
  afterSameProject,
  afterSameArea,
  afterTimestamp,
  afterExcludingCurrent,
  afterUsableImage,
}: {
  currentKey: PIEPriorPhotoMatchKey;
  candidateCount: number;
  afterSameProject: number;
  afterSameArea: number;
  afterTimestamp: number;
  afterExcludingCurrent: number;
  afterUsableImage: number;
}): PIEPriorNoPriorReason {
  if (!currentKey.normalizedProjectKey) return 'missing_project_key';
  if (!currentKey.normalizedAreaKey) return 'missing_area_key';
  if (currentKey.timestampMs === null) return 'timestamp_invalid';
  if (candidateCount === 0) return 'no_earlier_photo';
  if (afterSameProject === 0) return 'no_same_project';
  if (afterSameArea === 0) return 'no_same_area';
  if (afterTimestamp === 0) return 'no_earlier_photo';
  if (afterExcludingCurrent === 0) return 'only_current_photo';
  if (afterUsableImage === 0) return 'no_usable_image';
  return 'unknown';
}

function buildEmptyPriorSelectionDiagnostics(
  update: ProjectUpdate,
  photo: UpdatePhoto,
  options: { candidateCount: number; noPriorReason: PIEPriorNoPriorReason },
): PriorSelectionDiagnostics {
  return buildPriorSelectionDiagnostics(buildPIEPriorPhotoMatchKey(update, photo), {
    candidateCount: options.candidateCount,
    afterSameProject: 0,
    afterSameArea: 0,
    afterTimestamp: 0,
    afterExcludingCurrent: 0,
    afterUsableImage: 0,
    selected: null,
    noPriorReason: options.noPriorReason,
  });
}

function buildPriorSelectionDiagnostics(
  currentKey: PIEPriorPhotoMatchKey,
  input: {
    candidateCount: number;
    afterSameProject: number;
    afterSameArea: number;
    afterTimestamp: number;
    afterExcludingCurrent: number;
    afterUsableImage: number;
    selected: {
      update: ProjectUpdate;
      photo: UpdatePhoto;
      capturedAt: number;
    } | null;
    noPriorReason: PIEPriorNoPriorReason | null;
  },
): PriorSelectionDiagnostics {
  return {
    currentProjectKey: currentKey.normalizedProjectKey,
    currentAreaKey: currentKey.normalizedAreaKey,
    totalPriorCandidateCount: input.candidateCount,
    afterSameProject: input.afterSameProject,
    afterSameArea: input.afterSameArea,
    afterTimestamp: input.afterTimestamp,
    afterExcludingCurrent: input.afterExcludingCurrent,
    afterUsableImage: input.afterUsableImage,
    selectedPriorUpdateId: input.selected?.update.id || null,
    selectedPriorPhotoId: input.selected?.photo.id || null,
    selectedPriorDate: input.selected
      ? firstNonEmptyString([
          input.selected.photo.locationCapturedAt,
          input.selected.update.workflowTimestamps?.firstPhotoAddedAt,
          input.selected.update.date,
        ])
      : null,
    noPriorReason: input.noPriorReason,
  };
}

function buildPhotoEvidenceId(
  organizationId: string,
  projectId: string,
  updateId: string,
  photoId: string,
) {
  return `pie-mobile-photo-${stableHash([
    organizationId,
    projectId,
    updateId,
    photoId,
  ].join(':'))}`;
}

const photoEvidenceStagingCache = new Map<string, Promise<StagedPhotoEvidence>>();

function stagePhotoEvidence(params: {
  organizationId: string;
  projectId: string;
  update: ProjectUpdate;
  photo: UpdatePhoto;
  captureSource: 'camera' | 'library';
  preparedFile: PreparedPhotoFile;
}): Promise<StagedPhotoEvidence> {
  const evidenceId = buildPhotoEvidenceId(
    params.organizationId,
    params.projectId,
    params.update.id,
    params.photo.id,
  );

  const cached = photoEvidenceStagingCache.get(evidenceId);
  if (cached) return cached;

  const staging = stagePhotoEvidenceUncached(params).catch(error => {
    photoEvidenceStagingCache.delete(evidenceId);
    throw error;
  });
  photoEvidenceStagingCache.set(evidenceId, staging);
  return staging;
}

async function stagePhotoEvidenceUncached({
  organizationId,
  projectId,
  update,
  photo,
  captureSource,
  preparedFile,
}: {
  organizationId: string;
  projectId: string;
  update: ProjectUpdate;
  photo: UpdatePhoto;
  captureSource: 'camera' | 'library';
  preparedFile: PreparedPhotoFile;
}): Promise<StagedPhotoEvidence> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase unavailable');

  if (!preparedFile.ok) throw new PhotoPreparationError(preparedFile.role, preparedFile.reason, preparedFile.detail);

  const mimeType = preparedFile.mimeType;
  const extension = preparedFile.extension;
  const evidenceId = buildPhotoEvidenceId(organizationId, projectId, update.id, photo.id);
  const assetId = evidenceId;
  const storagePath = `${organizationId}/${projectId}/photo/${evidenceId}/original.${extension}`;
  const storagePathHash = stableHash(storagePath);
  const contentHash = `sha256:${preparedFile.sha256}`;

  const uploadResult = await uploadPreparedPhoto({
    bucket: PIE_EVIDENCE_BUCKET,
    path: storagePath,
    preparedFile,
    upsert: true,
  });

  if (!uploadResult.ok) {
    throw new PhotoPreparationError(
      preparedFile.role,
      prepReason(preparedFile.role, 'upload_missing'),
      uploadResult.error || 'Photo evidence upload failed',
    );
  }

  const { data: userData } = await client.auth.getUser();
  const receivedAt = new Date().toISOString();
  const storageRefs: JsonValue = [{
    bucket: PIE_EVIDENCE_BUCKET,
    path: storagePath,
    variant: 'original',
    mimeType,
    sizeBytes: preparedFile.sizeBytes,
    sha256: preparedFile.sha256,
  }];

  const evidencePayload = {
    id: evidenceId,
    organization_id: organizationId,
    project_id: projectId,
    evidence_type: 'photo',
    source: 'mobile_photo_update',
    source_system: 'project_photo_update_tool',
    captured_at: photo.locationCapturedAt || update.date || receivedAt,
    effective_at: update.date || receivedAt,
    received_at: receivedAt,
    author_id: userData.user?.id ?? null,
    storage_refs: storageRefs,
    content_hash: contentHash,
    mime_type: mimeType,
    evidence_version: 1,
    authority: 'supporting',
    processing_state: 'queued',
    analyzer_id: 'pie-production-photo-vision',
    analyzer_version: null,
    lineage: {
      parentEvidenceIds: [],
      derivedEvidenceIds: [],
      analyzerRunIds: [],
      correctionIds: [],
    },
    associations: [{
      type: 'location',
      id: photo.selectedAreaId || update.selectedAreaId || projectId,
      role: photo.selectedAreaName || update.selectedAreaName || update.projectName,
    }],
    related_evidence_ids: [],
    hidden_from_normal_queries: false,
  };

  const { error: evidenceError } = await client
    .from('pie_evidence_records')
    .upsert(evidencePayload);

  if (evidenceError) {
    throw new PhotoPreparationError(preparedFile.role, prepReason(preparedFile.role, 'storage_missing'), evidenceError.message);
  }

  const { error: assetError } = await client
    .from('pie_photo_assets')
    .upsert({
      evidence_id: evidenceId,
      organization_id: organizationId,
      project_id: projectId,
      original_storage_path: storagePath,
      analysis_derivative_path: null,
      thumbnail_path: null,
      content_hash: contentHash,
      duplicate_of_evidence_id: null,
      width: null,
      height: null,
      mime_type: mimeType,
      size_bytes: preparedFile.sizeBytes,
      capture_source: captureSource,
      captured_at: photo.locationCapturedAt || update.date || receivedAt,
      exif: {},
      analysis_status: 'queued',
      current_analysis_version: null,
      hidden_from_normal_queries: false,
    });

  if (assetError) {
    throw new PhotoPreparationError(preparedFile.role, prepReason(preparedFile.role, 'storage_missing'), assetError.message);
  }

  return {
    assetId,
    evidenceId,
    storagePath,
    storagePathHash,
    contentHash,
    sizeBytes: preparedFile.sizeBytes,
  };
}

function buildDisplayStateFromComparison(
  row: Record<string, unknown>,
  diagnosticInput: Partial<PIEPhotoVisionDiagnosticInput>,
): PIEPhotoIntelligenceDisplayState {
  const jarvis = toRecord(row.jarvis_result);
  const metrics = toRecord(row.deterministic_metrics);
  const persistedFindingDiagnostics = toRecord(metrics.findingNormalizationDiagnostics);
  const canonicalPersisted = normalizePIEPhotoFindings(metrics.canonicalFindings, 'uncertain');
  const additionsResult = normalizePIEPhotoFindings(row.object_additions, 'added');
  const removalsResult = normalizePIEPhotoFindings(row.object_removals, 'removed');
  const materialResult = normalizePIEPhotoFindings(row.material_or_structural_changes, 'material_change');
  const concernResult = normalizePIEPhotoFindings(row.visible_concerns, 'visible_concern');
  const findings = canonicalPersisted.findings.length > 0
    ? canonicalPersisted.findings
    : [
        ...additionsResult.findings,
        ...removalsResult.findings,
        ...materialResult.findings,
        ...concernResult.findings,
      ];
  const additions = findings.filter(finding => finding.findingType === 'added');
  const removals = findings.filter(finding => finding.findingType === 'removed');
  const materialChanges = findings.filter(finding => finding.findingType === 'material_change');
  const visibleConcerns = findings.filter(finding => finding.findingType === 'visible_concern');
  const additionLabels = additions.map(findingDisplayText);
  const removalLabels = removals.map(findingDisplayText);
  const spatialFinding = arrayRecords(metrics.normalizedSpatialFindings)[0] ?? null;
  const visualGroundingRegions = describeGroundingRegions(
    arrayRecords(metrics.normalizedSpatialFindings),
  );
  const visibleChange = describeVisibleChange(additions, removals, materialChanges);
  const location = describeLocation(spatialFinding, additions[0]);
  const plainLanguageSummary = String(metrics.plainLanguageSummary || '').trim() || null;
  const limitations = stringArray(row.limitations);
  const observationAccepted = jarvis.observationAccepted === true;
  const status = limitations.length > 0
    ? 'completed_with_limitations'
    : 'analysis_complete';
  const progress = progressStatus(String(row.conclusion || ''), String(jarvis.progressDisposition || ''));
  const provenance = visibleChange ? 'visual_only' : 'unsupported';
  const title = observationAccepted
    ? status === 'completed_with_limitations'
      ? 'Analysis complete with limitations'
      : 'Analysis complete'
    : 'Comparison unavailable';

  return {
    status: observationAccepted ? status : 'comparison_unavailable',
    title,
    summary: plainLanguageSummary
      ? plainLanguageSummary
      : visibleChange
        ? `${visibleChange}${location ? ` ${location}.` : '.'}`
        : 'PIE did not find a supported visible change in this comparison.',
    visibleChange,
    location,
    comparisonConfidence: String(row.confidence || 'unknown'),
    comparability: String(row.comparability_classification || 'unknown'),
    captureLimitations: limitations,
    projectProgress: progress,
    repeatPhotoGuidance: stringArray(row.repeat_photo_guidance)[0] ?? null,
    authorityMessage: progress === 'supported'
      ? 'PIE found visual evidence that may support progress, but project status still requires normal evidence checks.'
      : 'This is a visual observation only. PIE did not create a milestone, schedule, cost, compliance, or status update.',
    currentObservation: visibleChange || findings[0]?.description || 'PIE compared the current photo with prior visual evidence.',
    changedFromPrior: visibleChange || 'No reliable visual change was detected.',
    additions: additionLabels,
    removals: removalLabels,
    findings,
    possibleProgress: progress === 'supported'
      ? 'Possible progress observed. Verify against project scope before using it as project status.'
      : progress === 'unsupported'
        ? 'No verified project progress was inferred from this visual comparison.'
        : 'Project progress could not be determined from this visual comparison.',
    possibleConcerns: [...visibleConcerns.map(findingDisplayText), ...limitations],
    priorUpdateUsed: diagnosticInput.priorUpdateUsed ?? null,
    requestId: typeof row.request_id === 'string' ? row.request_id : null,
    comparisonId: typeof row.id === 'string' ? row.id : null,
    analysisRequestId: typeof row.request_id === 'string' ? row.request_id : null,
    currentPhotoAssetId: diagnosticInput.currentEvidence?.assetId ?? null,
    priorPhotoAssetId: diagnosticInput.baselineEvidence?.assetId ?? null,
    currentEvidenceId: typeof row.current_evidence_id === 'string' ? row.current_evidence_id : null,
    priorEvidenceId: typeof row.baseline_evidence_id === 'string' ? row.baseline_evidence_id : null,
    semanticComparisonResultId: typeof row.id === 'string' ? row.id : null,
    provenance,
    visualGroundingRegions,
    diagnostics: buildDiagnostics({
      ...diagnosticInput,
      analysisRequestId: typeof row.request_id === 'string' ? row.request_id : null,
      semanticComparisonResultId: typeof row.id === 'string' ? row.id : null,
      resultProvenance: provenance,
      signedUrlsGenerated: true,
      findingSchemaVersion: String(metrics.schemaVersion || PIE_PHOTO_FINDING_SCHEMA_VERSION),
      rawFindingCount: finiteNumberOrNull(persistedFindingDiagnostics.rawFindingCount) ?? additionsResult.rawFindingCount + removalsResult.rawFindingCount + materialResult.rawFindingCount + concernResult.rawFindingCount,
      normalizedFindingCount: finiteNumberOrNull(persistedFindingDiagnostics.normalizedFindingCount) ?? findings.length,
      legacyStringFindingCount: finiteNumberOrNull(persistedFindingDiagnostics.legacyStringCount) ?? additionsResult.legacyStringCount + removalsResult.legacyStringCount + materialResult.legacyStringCount + concernResult.legacyStringCount,
      rejectedFindingCount: finiteNumberOrNull(persistedFindingDiagnostics.rejectedFindingCount) ?? additionsResult.rejectedFindingCount + removalsResult.rejectedFindingCount + materialResult.rejectedFindingCount + concernResult.rejectedFindingCount,
      findingRejectionCategories: stringArray(persistedFindingDiagnostics.rejectionCategories).length > 0
        ? stringArray(persistedFindingDiagnostics.rejectionCategories)
        : [...new Set([
            ...additionsResult.rejectionCategories,
            ...removalsResult.rejectionCategories,
            ...materialResult.rejectionCategories,
            ...concernResult.rejectionCategories,
          ])],
    }),
    updatedAt: new Date().toISOString(),
  };
}

function unavailableState(
  summary: string,
  failureCategory: NonNullable<PIEPhotoVisionDiagnostics['failureCategory']>,
  tokenLookup: SupabaseSessionTokenLookupResult | null = null,
  retryFetchedFreshToken: boolean | null = null,
): PIEPhotoIntelligenceDisplayState {
  return {
    status: 'comparison_unavailable',
    title: 'Photo intelligence unavailable',
    summary,
    visibleChange: null,
    location: null,
    comparisonConfidence: null,
    comparability: null,
    captureLimitations: [
      'Cloud photo intelligence is unavailable.',
      safeUnavailableReason(summary),
    ],
    projectProgress: 'unable_to_determine',
    repeatPhotoGuidance: null,
    authorityMessage: 'The app will continue saving photos and notes without photo intelligence.',
    currentObservation: null,
    changedFromPrior: null,
    additions: [],
    removals: [],
    possibleProgress: null,
    possibleConcerns: [],
    priorUpdateUsed: null,
    diagnostics: buildDiagnostics({
      providerResponseStatus: safeUnavailableReason(summary),
      failureCategory,
      executedStages: tokenLookup ? ['auth_session_lookup'] : ['cloud_configuration_check'],
      resultProvenance: 'unsupported',
      tokenLookup,
      retryFetchedFreshToken,
    }),
    updatedAt: new Date().toISOString(),
  };
}

function failedRetryState(
  summary: string,
  diagnosticInput: Partial<PIEPhotoVisionDiagnosticInput> = {},
): PIEPhotoIntelligenceDisplayState {
  return {
    status: 'analysis_failed_retry',
    title: 'Visual comparison unavailable',
    summary,
    visibleChange: null,
    location: null,
    comparisonConfidence: null,
    comparability: null,
    captureLimitations: [
      'Photo comparison could not be completed.',
      safeUnavailableReason(summary),
    ],
    projectProgress: 'unable_to_determine',
    repeatPhotoGuidance: 'Keep the photo. PIE can retry from cloud evidence later.',
    authorityMessage: 'No project progress was inferred while analysis was unavailable.',
    currentObservation: null,
    changedFromPrior: null,
    additions: [],
    removals: [],
    possibleProgress: null,
    possibleConcerns: [],
    priorUpdateUsed: diagnosticInput.priorUpdateUsed ?? null,
    analysisRequestId: diagnosticInput.requestId ?? null,
    currentPhotoAssetId: diagnosticInput.currentEvidence?.assetId ?? null,
    priorPhotoAssetId: diagnosticInput.baselineEvidence?.assetId ?? null,
    currentEvidenceId: diagnosticInput.currentEvidence?.evidenceId ?? null,
    priorEvidenceId: diagnosticInput.baselineEvidence?.evidenceId ?? null,
    semanticComparisonResultId: null,
    provenance: 'unsupported',
    diagnostics: buildDiagnostics({
      ...diagnosticInput,
      resultProvenance: 'unsupported',
      signedUrlsGenerated: false,
    }),
    updatedAt: new Date().toISOString(),
  };
}

function assertComparableEvidencePair(
  baselineEvidence: StagedPhotoEvidence,
  currentEvidence: StagedPhotoEvidence,
) {
  if (baselineEvidence.evidenceId === currentEvidence.evidenceId) throw new Error('photo_pair_same_evidence_id');
  if (baselineEvidence.assetId === currentEvidence.assetId) throw new Error('photo_pair_same_asset_id');
  if (baselineEvidence.contentHash === currentEvidence.contentHash) throw new Error('photo_pair_identical_sha256');
  if (baselineEvidence.sizeBytes <= 0 || currentEvidence.sizeBytes <= 0) throw new Error('photo_pair_empty_file');
}

function describeVisibleChange(
  additions: PIEPhotoFinding[],
  removals: PIEPhotoFinding[],
  materialChanges: PIEPhotoFinding[],
) {
  const added = additions[0];
  if (added) {
    return added.description;
  }
  const removed = removals[0];
  if (removed) {
    return removed.description;
  }
  return materialChanges[0]?.description ?? null;
}

function safeUnavailableReason(summary: string) {
  const normalized = summary.toLowerCase();
  if (normalized.includes('previous') || normalized.includes('prior')) return 'previous photo unavailable';
  if (normalized.includes('file') || normalized.includes('image') || normalized.includes('photo saved')) return 'image could not be prepared';
  if (normalized.includes('sign in') || normalized.includes('signed-in')) return 'sign in required';
  if (normalized.includes('expired')) return 'session expired';
  if (normalized.includes('session') || normalized.includes('supabase')) return 'session unavailable';
  if (normalized.includes('connection')) return 'connection unavailable';
  if (normalized.includes('service') || normalized.includes('function') || normalized.includes('cloud')) return 'analysis service unavailable';
  if (normalized.includes('result') || normalized.includes('stale')) return 'comparison returned no usable result';
  return 'comparison returned no usable result';
}

function messageForTokenMissingReason(reason: SupabaseSessionMissingReason | null) {
  if (reason === 'signed_out') return 'Sign in required for photo intelligence';
  if (reason === 'expired_session') return 'Session expired · Sign in again';
  if (reason === 'auth_loading') return 'Preparing secure photo analysis…';
  if (reason === 'storage_unavailable') return 'Photo intelligence cannot read the saved sign-in session.';
  if (reason === 'client_mismatch') return 'Photo intelligence cannot access the signed-in session.';
  return 'Photo intelligence cannot access the signed-in session.';
}

function describeLocation(
  spatialFinding: Record<string, unknown> | null,
  fallback: PIEPhotoFinding | undefined,
) {
  const horizontal = String(spatialFinding?.imageHorizontalRegion || '').replace('unknown', '');
  const vertical = String(spatialFinding?.imageVerticalRegion || '').replace('unknown', '');
  const surface = String(spatialFinding?.surfaceOrArea || '').replace('unknown', '');
  const rawLocation = String(spatialFinding?.rawLocationText || fallback?.location || '').trim();
  const normalized = [vertical, horizontal, surface].filter(Boolean).join(' ');

  if (normalized) return `Location: ${normalized}`;
  if (rawLocation) return `Location: ${rawLocation}`;
  return null;
}

function describeGroundingRegions(items: Record<string, unknown>[]) {
  return items
    .map(item =>
      [
        String(item.normalizedObjectName || item.object || '').trim(),
        String(item.imageVerticalRegion || '').replace('unknown', '').trim(),
        String(item.imageHorizontalRegion || '').replace('unknown', '').trim(),
        String(item.surfaceOrArea || '').replace('unknown', '').trim(),
      ].filter(Boolean).join(' - '),
    )
    .filter(Boolean);
}

function progressStatus(
  conclusion: string,
  disposition: string,
): PIEPhotoIntelligenceDisplayState['projectProgress'] {
  if (disposition === 'supported' || conclusion === 'progress_visible' || conclusion === 'partial_progress_visible') {
    return 'supported';
  }
  if (disposition === 'unsupported' || conclusion === 'no_material_visible_change' || conclusion === 'no_progress_visible') {
    return 'unsupported';
  }
  return 'unable_to_determine';
}

function projectIdForPhotoVision(projectName: string) {
  return `project-${projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'unassigned'}`;
}

function mimeExtension(mimeType: string | null | undefined) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'image/heif') return 'heif';
  return 'jpg';
}

function normalizedPhotoMimeType(photo: UpdatePhoto): string | null {
  const mimeType = (photo.mimeType || '').trim().toLowerCase();
  if (!mimeType) return 'image/jpeg';
  if (['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'image/webp'].includes(mimeType)) {
    return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
  }
  return null;
}

function prepReason(
  role: PhotoPrepRole,
  kind:
    | 'missing'
    | 'unreadable'
    | 'zero_bytes'
    | 'encoding_failed'
    | 'upload_missing'
    | 'storage_missing'
    | 'stale_or_invalid'
    | 'wrong_area'
    | 'unsupported_type',
): PIEPhotoPrepDiagnosticReason {
  return `${role}_photo_${kind}` as PIEPhotoPrepDiagnosticReason;
}

async function uploadPreparedPhoto({
  bucket,
  path,
  preparedFile,
  upsert,
}: {
  bucket: string;
  path: string;
  preparedFile: Extract<PreparedPhotoFile, { ok: true }>;
  upsert: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, error: 'Supabase unavailable' };

  try {
    const bytes = base64ToBytes(preparedFile.base64);
    const { error } = await client.storage
      .from(bucket)
      .upload(path, bytes, {
        cacheControl: '3600',
        contentType: preparedFile.mimeType,
        upsert,
      });

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'prepared_photo_upload_failed',
    };
  }
}

class PhotoPreparationError extends Error {
  role: PhotoPrepRole;
  reason: PIEPhotoPrepDiagnosticReason;

  constructor(role: PhotoPrepRole, reason: PIEPhotoPrepDiagnosticReason, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'PhotoPreparationError';
    this.role = role;
    this.reason = reason;
  }

  toPreparedFailure(): PreparedPhotoFile {
    return {
      ok: false,
      role: this.role,
      reason: this.reason,
      sizeBytes: null,
      detail: this.message,
    };
  }
}

async function preparePhotoFileForVision(photo: UpdatePhoto, role: PhotoPrepRole): Promise<PreparedPhotoFile> {
  const uri = (photo.uri || '').trim();
  if (!uri || /^placeholder:/i.test(uri)) {
    return { ok: false, role, reason: prepReason(role, 'missing'), sizeBytes: null };
  }

  const mimeType = normalizedPhotoMimeType(photo);
  if (!mimeType) {
    return { ok: false, role, reason: prepReason(role, 'unsupported_type'), sizeBytes: null };
  }

  let info: Awaited<ReturnType<typeof FileSystem.getInfoAsync>>;
  try {
    info = await FileSystem.getInfoAsync(uri);
  } catch (error) {
    return {
      ok: false,
      role,
      reason: prepReason(role, 'unreadable'),
      sizeBytes: null,
      detail: error instanceof Error ? error.message : 'file_info_failed',
    };
  }

  if (!info.exists) {
    return {
      ok: false,
      role,
      reason: role === 'prior' ? 'prior_photo_stale_or_invalid' : 'current_photo_missing',
      sizeBytes: null,
    };
  }

  if (typeof info.size !== 'number') {
    return { ok: false, role, reason: prepReason(role, 'unreadable'), sizeBytes: null };
  }

  if (info.size <= 0) {
    return { ok: false, role, reason: prepReason(role, 'zero_bytes'), sizeBytes: info.size };
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64) {
      return { ok: false, role, reason: prepReason(role, 'encoding_failed'), sizeBytes: info.size };
    }

    return {
      ok: true,
      role,
      uri,
      mimeType,
      extension: mimeExtension(mimeType),
      sizeBytes: info.size,
      sha256: await sha256(base64),
      base64,
    };
  } catch (error) {
    return {
      ok: false,
      role,
      reason: prepReason(role, 'encoding_failed'),
      sizeBytes: info.size,
      detail: error instanceof Error ? error.message : 'base64_read_failed',
    };
  }
}

async function readPhotoFileDigest(uri: string): Promise<{ exists: boolean; sizeBytes: number; sha256: string }> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || typeof info.size !== 'number') {
      return { exists: false, sizeBytes: 0, sha256: '' };
    }
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return {
      exists: true,
      sizeBytes: info.size,
      sha256: await sha256(base64),
    };
  } catch {
    return { exists: false, sizeBytes: 0, sha256: '' };
  }
}

type PIEPhotoVisionDiagnosticInput = {
  baselineEvidence: StagedPhotoEvidence | null;
  currentEvidence: StagedPhotoEvidence | null;
  currentPhotoPrep: PreparedPhotoFile | null;
  priorPhotoPrep: PreparedPhotoFile | null;
  requestId: string | null;
  analysisRequestId: string | null;
  semanticComparisonResultId: string | null;
  providerResponseStatus: string | null;
  failureCategory: PIEPhotoVisionDiagnostics['failureCategory'];
  selectedPriorPhotoId: string | null;
  priorUpdateUsed: string | null;
  selectionCandidateCount: number;
  selectedPriorReason: string | null;
  priorSelectionDiagnostics: PriorSelectionDiagnostics | null;
  rejectedPriorReasons: string[];
  resultPairMatchesRequestedPair: boolean | null;
  resultProvenance: PIEPhotoVisionDiagnostics['resultProvenance'];
  signedUrlsGenerated: boolean | null;
  tokenLookup: SupabaseSessionTokenLookupResult | null;
  retryFetchedFreshToken: boolean | null;
  usablePriorCandidateFound: boolean | null;
  skippedPriorCandidateCount: number;
  imagePrepareFailureReason: PIEImagePrepareFailureReason | null;
  executedStages: string[];
  findingSchemaVersion: string | null;
  rawFindingCount: number;
  normalizedFindingCount: number;
  legacyStringFindingCount: number;
  rejectedFindingCount: number;
  findingRejectionCategories: string[];
};

function buildDiagnostics(input: Partial<PIEPhotoVisionDiagnosticInput>): PIEPhotoVisionDiagnostics {
  const baseline = input.baselineEvidence ?? null;
  const current = input.currentEvidence ?? null;
  const currentPrep = input.currentPhotoPrep ?? null;
  const priorPrep = input.priorPhotoPrep ?? null;
  const currentSha = current?.contentHash.replace(/^sha256:/, '') ?? (currentPrep?.ok ? currentPrep.sha256 : null);
  const priorSha = baseline?.contentHash.replace(/^sha256:/, '') ?? (priorPrep?.ok ? priorPrep.sha256 : null);
  const currentByteSize = current?.sizeBytes ?? (currentPrep?.ok ? currentPrep.sizeBytes : currentPrep?.sizeBytes ?? null);
  const priorByteSize = baseline?.sizeBytes ?? (priorPrep?.ok ? priorPrep.sizeBytes : priorPrep?.sizeBytes ?? null);

  return {
    currentPhotoAssetId: current?.assetId ?? null,
    priorPhotoAssetId: baseline?.assetId ?? null,
    currentEvidenceId: current?.evidenceId ?? null,
    priorEvidenceId: baseline?.evidenceId ?? null,
    currentStoragePathHash: current?.storagePathHash ?? null,
    priorStoragePathHash: baseline?.storagePathHash ?? null,
    currentImageByteSize: currentByteSize,
    priorImageByteSize: priorByteSize,
    currentImageSha256: currentSha,
    priorImageSha256: priorSha,
    currentPhotoPrepStatus: prepStatus(currentPrep),
    priorPhotoPrepStatus: prepStatus(priorPrep),
    currentPhotoPrepReason: prepFailureReason(currentPrep),
    priorPhotoPrepReason: prepFailureReason(priorPrep),
    currentPhotoReadable: prepReadable(currentPrep),
    priorPhotoReadable: prepReadable(priorPrep),
    currentPhotoUploadReady: Boolean(current),
    priorPhotoUploadReady: Boolean(baseline),
    usablePriorCandidateFound: input.usablePriorCandidateFound ?? null,
    skippedPriorCandidateCount: input.skippedPriorCandidateCount ?? 0,
    imagePrepareFailureReason: input.imagePrepareFailureReason ?? imagePrepareFailureReasonFromPrep(currentPrep, priorPrep),
    imageHashesDifferent: currentSha && priorSha ? currentSha !== priorSha : null,
    signedUrlsGenerated: input.signedUrlsGenerated ?? null,
    providerInvocationId: input.requestId ?? input.analysisRequestId ?? null,
    providerResponseStatus: input.providerResponseStatus ?? null,
    failureCategory: input.failureCategory ?? null,
    supabaseAuthState: input.tokenLookup?.authState ?? 'unknown',
    tokenLookupResult: input.tokenLookup?.status ?? null,
    tokenMissingReason: input.tokenLookup?.missingReason ?? null,
    appAuthMode: input.tokenLookup?.appAuthMode ?? 'unknown',
    supabaseUserIdPresent: input.tokenLookup?.supabaseUserIdPresent ?? null,
    sessionTokenPresent: input.tokenLookup?.sessionTokenPresent ?? null,
    lastAuthEvent: input.tokenLookup?.lastAuthEvent ?? null,
    screenReachedWithoutSupabaseAuth: input.tokenLookup
      ? input.tokenLookup.appAuthMode !== 'supabase_authenticated'
      : null,
    retryRoutedToSignIn: false,
    signInClientSource: input.tokenLookup?.signInClientSource ?? null,
    pieAnalysisClientSource: input.tokenLookup?.tokenLookupClientSource ?? null,
    authHydrationCompleted: input.tokenLookup?.authHydrationCompleted ?? null,
    retryFetchedFreshToken: input.retryFetchedFreshToken ?? null,
    edgeFunctionInvoked: Boolean(input.executedStages?.includes('edge_function_invoked')),
    edgeFunctionStatus: input.providerResponseStatus ?? null,
    analysisRequestId: input.analysisRequestId ?? input.requestId ?? null,
    semanticComparisonResultId: input.semanticComparisonResultId ?? null,
    currentProjectKey: input.priorSelectionDiagnostics?.currentProjectKey ?? null,
    currentAreaKey: input.priorSelectionDiagnostics?.currentAreaKey ?? null,
    totalPriorCandidateCount: input.priorSelectionDiagnostics?.totalPriorCandidateCount ?? input.selectionCandidateCount ?? 0,
    priorCandidatesAfterSameProject: input.priorSelectionDiagnostics?.afterSameProject ?? 0,
    priorCandidatesAfterSameArea: input.priorSelectionDiagnostics?.afterSameArea ?? 0,
    priorCandidatesAfterTimestamp: input.priorSelectionDiagnostics?.afterTimestamp ?? 0,
    priorCandidatesAfterExcludingCurrent: input.priorSelectionDiagnostics?.afterExcludingCurrent ?? 0,
    priorCandidatesAfterUsableImage: input.priorSelectionDiagnostics?.afterUsableImage ?? 0,
    selectedPriorUpdateId: input.priorSelectionDiagnostics?.selectedPriorUpdateId ?? null,
    selectedPriorPhotoId: input.selectedPriorPhotoId ?? null,
    selectedPriorDate: input.priorSelectionDiagnostics?.selectedPriorDate ?? null,
    selectionCandidateCount: input.selectionCandidateCount ?? 0,
    selectedPriorReason: input.selectedPriorReason ?? null,
    noPriorReason: input.priorSelectionDiagnostics?.noPriorReason ?? null,
    rejectedPriorReasons: input.rejectedPriorReasons ?? [],
    resultPairMatchesRequestedPair: input.resultPairMatchesRequestedPair ?? null,
    resultProvenance: input.resultProvenance ?? 'unsupported',
    executedStages: input.executedStages ?? [],
    findingSchemaVersion: input.findingSchemaVersion ?? null,
    rawFindingCount: input.rawFindingCount ?? 0,
    normalizedFindingCount: input.normalizedFindingCount ?? 0,
    legacyStringFindingCount: input.legacyStringFindingCount ?? 0,
    rejectedFindingCount: input.rejectedFindingCount ?? 0,
    findingRejectionCategories: input.findingRejectionCategories ?? [],
  };
}

function prepStatus(prep: PreparedPhotoFile | null): 'not_checked' | 'ready' | 'failed' {
  if (!prep) return 'not_checked';
  return prep.ok ? 'ready' : 'failed';
}

function prepFailureReason(prep: PreparedPhotoFile | null): PIEPhotoPrepDiagnosticReason | null {
  return prep && !prep.ok ? prep.reason : null;
}

function prepReadable(prep: PreparedPhotoFile | null): boolean | null {
  if (!prep) return null;
  return prep.ok;
}

function imagePrepareFailureReasonFromPrep(
  currentPrep: PreparedPhotoFile | null,
  priorPrep: PreparedPhotoFile | null,
): PIEImagePrepareFailureReason | null {
  if (currentPrep && !currentPrep.ok) return currentPrep.reason;
  if (priorPrep && !priorPrep.ok) return priorPrep.reason;
  return null;
}

function imagePrepareFailureReasonForError(error: unknown): PIEImagePrepareFailureReason {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  if (/same_evidence|same_asset|identical|empty|missing|zero|payload|pair/.test(message)) return 'edge_payload_invalid';
  if (/upload/.test(message)) return 'unknown_image_prepare_failure';
  if (/storage|evidence|asset/.test(message)) return 'unknown_image_prepare_failure';
  if (/file|image|photo|base64|encoding|read/.test(message)) return 'unknown_image_prepare_failure';
  return 'unknown_image_prepare_failure';
}

function providerStatus(value: unknown): string {
  const record = toRecord(value);
  return typeof record.status === 'string' ? record.status : 'unknown';
}

function classifyFunctionError(error: unknown): NonNullable<PIEPhotoVisionDiagnostics['failureCategory']> {
  const message = JSON.stringify(error || {}).toLowerCase();

  return classifyPIEPhotoVisionFailureMessage(message);
}

function classifyThrownError(error: unknown): NonNullable<PIEPhotoVisionDiagnostics['failureCategory']> {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();

  return classifyPIEPhotoVisionFailureMessage(message);
}

export function classifyPIEPhotoVisionFailureMessage(
  message: string,
): NonNullable<PIEPhotoVisionDiagnostics['failureCategory']> {
  if (/auth|jwt|token|permission|unauthorized|forbidden|401|403/.test(message)) return 'auth';
  if (/provider|openai|vision|model|secret|api key|upstream|function/.test(message)) return 'provider_side';
  if (/network|fetch|timeout|offline|connection|unreachable|supabase/.test(message)) return 'network';
  if (/stale|result|pair|same_evidence|same_asset|identical|empty|missing|file/.test(message)) return 'malformed_response';

  return 'unknown';
}

function timestampMs(value: string | null | undefined): number {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : Number.NaN;
}

function timestampMsOrNull(value: string | null | undefined): number | null {
  const time = timestampMs(value);
  return Number.isFinite(time) ? time : null;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

async function sha256(base64: string): Promise<string> {
  const bytes = base64ToBytes(base64);
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes as Uint8Array<ArrayBuffer>,
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Uint8Array(128).fill(255);
for (let index = 0; index < BASE64_CHARS.length; index += 1) {
  BASE64_LOOKUP[BASE64_CHARS.charCodeAt(index)] = index;
}

function base64ToBytes(base64: string): Uint8Array {
  const sanitized = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const output = new Uint8Array(Math.floor((sanitized.length * 3) / 4));
  let outputIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let index = 0; index < sanitized.length; index += 1) {
    const value = BASE64_LOOKUP[sanitized.charCodeAt(index)];
    if (value === 255) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[outputIndex] = (buffer >> bits) & 0xff;
      outputIndex += 1;
    }
  }

  return output.subarray(0, outputIndex);
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizedMatchKey(value: string | null | undefined) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return key || null;
}

function firstNonEmptyString(values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object' && !Array.isArray(item)),
      )
    : [];
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return Array.isArray(value)
    ? value.map(String).filter(item => item.trim().length > 0)
    : [];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function capitalize(value: string) {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
