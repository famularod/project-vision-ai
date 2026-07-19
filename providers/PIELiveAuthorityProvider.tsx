import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildPIECoreIntelligence,
  buildLivePIECoreIntelligence,
  type PIECoreOutput,
} from '../services/PIECoreIntelligence';
import {
  buildRuntime,
  type PIERuntimeContext,
  type PIERuntimeState,
} from '../services/PIERuntime';
import type { PIERealityPersistenceStatus } from '../services/PIERealityModelOrchestrator';
import type {
  ContactBook,
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import type { ProjectSyncFreshnessMetadata } from '../services/ProjectIntelligenceEngine';
import type { PIEReportType } from '../services/domains/reporting';
import {
  logStartupDiagnostic,
  startupErrorMessage,
} from '../services/StartupDiagnostics';
import type { DAVEConfirmedCaptureMemory } from '../services/DAVECaptureMemory';
import type { DAVEDailyBriefDocument } from '../services/DAVEDailyBrief';
import {
  buildDAVEProjectTruth,
  type DAVEProjectTruth,
} from '../services/DAVEProjectTruth';
import { createDAVEProjectTruthRepository } from '../services/DAVEProjectTruthRepository';
import {
  authorityInputScopeSignature,
  authorityInputSignature,
} from '../services/PIELiveAuthoritySignature';
import {
  LIVE_AUTHORITY_MAX_AUTO_RETRY_ATTEMPTS,
  liveAuthorityRetryDelayMs,
  resolvePIELiveAuthorityState,
  type PIELiveAuthorityStateName,
} from '../services/PIELiveAuthorityStateMachine';
import { useDebouncedSnapshot } from '../hooks/use-debounced-snapshot';
import {
  buildPIERecommendationTrace,
  type PIERecommendationTrace,
} from '../services/PIETraceability';
import { savePhotoProgressIntelligence } from '../services/PIEPhotoProgressIntelligenceStorage';

export type { PIELiveAuthorityStateName } from '../services/PIELiveAuthorityStateMachine';

const LIVE_AUTHORITY_INPUT_DEBOUNCE_MS = 500;

export type PIELiveAuthorityRefreshReason =
  | 'initial_load'
  | 'project_changed'
  | 'evidence_added'
  | 'evidence_changed'
  | 'evidence_removed'
  | 'evidence_invalidated'
  | 'decision_changed'
  | 'outcome_changed'
  | 'manual_retry'
  | 'background_retry';

export type PIELiveAuthorityPolicy = {
  mayShowRecommendations: boolean;
  highImpactAutomationAllowed: boolean;
  reportGenerationAllowed: boolean;
  layer4DecisionCreationAllowed: boolean;
  userMessage: string;
};

export type PIELiveAuthorityProjectTruthPersistencePolicy =
  | 'persist_project'
  | 'ephemeral_portfolio';

export type PIELiveAuthorityInput = {
  /**
   * Set to false while persisted project evidence is still hydrating.
   * Omitted values preserve the existing ready-by-default behavior.
   */
  hydrated?: boolean;
  organizationId?: string | null;
  projectId?: string | null;
  projectName: string;
  projectNames: string[];
  reportType?: PIEReportType;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
  projectAreas?: ProjectArea[];
  contacts?: ContactBook;
  referenceDocuments?: ReferenceDocument[];
  projectDocuments?: DAVEDailyBriefDocument[];
  captureMemories?: readonly DAVEConfirmedCaptureMemory[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  surface?: PIERuntimeContext['surface'];
  identityTrusted?: boolean;
  cloudAvailable?: boolean;
  /** Combined report portfolios are computed in memory and never saved as project truth. */
  projectTruthPersistencePolicy?: PIELiveAuthorityProjectTruthPersistencePolicy;
};

export type PIELiveAuthorityContextValue = {
  state: PIELiveAuthorityStateName;
  policy: PIELiveAuthorityPolicy;
  core: PIECoreOutput | null;
  runtime: PIECoreOutput['runtime'];
  projectTruth: DAVEProjectTruth;
  organizationId: string | null;
  projectId: string | null;
  realityModel: PIECoreOutput['realityModel'] | null;
  realityModelVersion: number | null;
  realitySnapshotId: string | null;
  executiveJudgment: PIECoreOutput['executiveJudgmentResult'] | null;
  executiveJudgmentRecord: PIECoreOutput['executiveJudgmentRecord'] | null;
  situationIntelligence: PIECoreOutput['situationIntelligence'] | null;
  predictiveReality: PIECoreOutput['predictiveReality'] | null;
  attention: PIECoreOutput['attention'] | null;
  experience: PIECoreOutput['experience'] | null;
  reportDraft: PIECoreOutput['reportDraft'] | null;
  recommendationTrace: PIERecommendationTrace | null;
  persistenceStatus: PIERealityPersistenceStatus | null;
  activeConflicts: PIECoreOutput['realityModel']['evidenceConflicts'];
  activeUncertainties: PIECoreOutput['realityModel']['activeUncertainties'];
  loading: boolean;
  degraded: boolean;
  error: string | null;
  retryPending: boolean;
  lastSuccessfulRefreshAt: string | null;
  refreshAuthority: (reason: PIELiveAuthorityRefreshReason) => Promise<void>;
  invalidateEvidence: (evidenceId: string) => void;
  notifyEvidenceChanged: (evidenceId: string) => void;
  notifyProjectChanged: (projectId: string) => void;
};

const DEFAULT_POLICY: PIELiveAuthorityPolicy = {
  mayShowRecommendations: false,
  highImpactAutomationAllowed: false,
  reportGenerationAllowed: false,
  layer4DecisionCreationAllowed: false,
  userMessage: 'DAVE is preparing the current project view.',
};

const PIELiveAuthorityContext = createContext<PIELiveAuthorityContextValue | null>(null);

export function PIELiveAuthorityProvider({
  input,
  children,
}: {
  input: PIELiveAuthorityInput;
  children: ReactNode;
}) {
  const [core, setCore] = useState<PIECoreOutput | null>(null);
  const [fallbackRuntime, setFallbackRuntime] =
    useState<PIERuntimeState>(() => safeBuildProviderRuntime(input));
  const [coreSignature, setCoreSignature] = useState<string | null>(null);
  const [coreGeneration, setCoreGeneration] = useState<string | null>(null);
  const [state, setState] = useState<PIELiveAuthorityStateName>('loading');
  const [error, setError] = useState<string | null>(null);
  const [retryPending, setRetryPending] = useState(false);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<string | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const inputHydrated = input.hydrated !== false;
  const hydrationKey = inputHydrated ? 'hydrated' : 'pending_hydration';
  const rawSignature = useMemo(
    () => `${authorityInputSignature(input)}:${hydrationKey}`,
    [hydrationKey, input],
  );
  const rawScopeSignature = useMemo(
    () => `${authorityInputScopeSignature(input)}:${hydrationKey}`,
    [hydrationKey, input],
  );
  const authorityGeneration = `${rawScopeSignature}::${rawSignature}`;
  const authoritySnapshot = useDebouncedSnapshot({
    value: input,
    signature: rawSignature,
    priorityKey: rawScopeSignature,
    delayMs: LIVE_AUTHORITY_INPUT_DEBOUNCE_MS,
  });
  const authorityInput = authoritySnapshot.value;
  const signature = authoritySnapshot.signature;
  const authorityInputHydrated = authorityInput.hydrated !== false;
  const readyForAuthority = inputHydrated && authorityInputHydrated;
  const scopeIsCurrent = rawScopeSignature === authoritySnapshot.priorityKey;
  const inputSnapshotIsCurrent = scopeIsCurrent && rawSignature === signature;
  const immediateInputRuntime = useMemo(
    () => inputSnapshotIsCurrent ? null : safeBuildProviderRuntime(input),
    [input, inputSnapshotIsCurrent, rawSignature],
  );
  const displayInput = inputSnapshotIsCurrent ? authorityInput : input;
  const pendingReasonRef = useRef<PIELiveAuthorityRefreshReason | null>(null);
  const latestInputRef = useRef(authorityInput);
  const latestSignatureRef = useRef(signature);
  const latestScopeSignatureRef = useRef(authoritySnapshot.priorityKey);
  const latestRawSignatureRef = useRef(rawSignature);
  const latestRawScopeSignatureRef = useRef(rawScopeSignature);
  const latestAuthorityGenerationRef = useRef(authorityGeneration);
  const authorityReadyRef = useRef(readyForAuthority);
  const authorityWasReadyRef = useRef(readyForAuthority);
  latestInputRef.current = authorityInput;
  latestSignatureRef.current = signature;
  latestScopeSignatureRef.current = authoritySnapshot.priorityKey;
  latestRawSignatureRef.current = rawSignature;
  latestRawScopeSignatureRef.current = rawScopeSignature;
  latestAuthorityGenerationRef.current = authorityGeneration;
  authorityReadyRef.current = readyForAuthority;

  const cancelScheduledRetry = useCallback((resetAttempt: boolean) => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (resetAttempt) retryAttemptRef.current = 0;
    if (mountedRef.current) setRetryPending(false);
  }, []);

  const runRefresh = useCallback(async (reason: PIELiveAuthorityRefreshReason) => {
    if (!mountedRef.current) return;

    if (reason !== 'background_retry') {
      cancelScheduledRetry(true);
    }
    pendingReasonRef.current = reason;

    if (!authorityReadyRef.current) return;

    if (
      latestSignatureRef.current !== latestRawSignatureRef.current ||
      latestScopeSignatureRef.current !== latestRawScopeSignatureRef.current
    ) {
      return;
    }

    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    const refreshInput = latestInputRef.current;
    const refreshSignature = latestSignatureRef.current;
    const refreshScopeSignature = latestScopeSignatureRef.current;
    const refreshGeneration = latestAuthorityGenerationRef.current;
    pendingReasonRef.current = null;
    const refreshSequence = sequenceRef.current + 1;
    sequenceRef.current = refreshSequence;
    setState('loading');
    setRetryPending(false);

    let run!: Promise<void>;
    run = (async () => {
      const refreshIsCurrent = () => Boolean(
        mountedRef.current &&
        authorityReadyRef.current &&
        refreshSequence === sequenceRef.current &&
        refreshSignature === latestSignatureRef.current &&
        refreshScopeSignature === latestScopeSignatureRef.current &&
        refreshSignature === latestRawSignatureRef.current &&
        refreshScopeSignature === latestRawScopeSignatureRef.current &&
        refreshGeneration === latestAuthorityGenerationRef.current
      );

      try {
        const runtime = safeBuildProviderRuntime(refreshInput);
        if (mountedRef.current) setFallbackRuntime(runtime);
        const coreInput = {
          runtime,
          runtimeContext: providerRuntimeContext(refreshInput),
          reportType: refreshInput.reportType,
          reportProjectNames: refreshInput.projectNames,
          organizationId: refreshInput.organizationId || 'local-unverified-anonymous',
          projectId: refreshInput.projectId || safeProjectId(refreshInput.projectName),
          identityTrusted: Boolean(refreshInput.identityTrusted),
          cloudAvailable: Boolean(refreshInput.cloudAvailable),
        };
        const ephemeralPortfolio =
          refreshInput.projectTruthPersistencePolicy === 'ephemeral_portfolio';
        const result = ephemeralPortfolio
          ? buildPIECoreIntelligence(coreInput)
          : await buildLivePIECoreIntelligence(coreInput);
        if (!refreshIsCurrent()) return;
        const expectedOrganizationId =
          refreshInput.organizationId || 'local-unverified-anonymous';
        const expectedProjectId =
          refreshInput.projectId || safeProjectId(refreshInput.projectName);
        if (
          result.realityModel.organizationId !== expectedOrganizationId ||
          result.realityModel.projectId !== expectedProjectId
        ) {
          throw new Error('Live authority returned a Core result for a different scope.');
        }

        // Longitudinal photo reasoning is durable only after the exact scoped
        // Core generation has passed the provider's stale-result checks. A
        // cache write failure must not invalidate the authoritative in-memory
        // result, but is recorded for production diagnosis.
        if (!ephemeralPortfolio && result.longitudinalPhotoIntelligence) {
          try {
            await savePhotoProgressIntelligence(result.longitudinalPhotoIntelligence);
          } catch (storageError) {
            logStartupDiagnostic(
              'photo_progress_intelligence_persistence_failed',
              'Current photo progress intelligence remains available in memory, but its local history could not be saved.',
              { error: startupErrorMessage(storageError) },
            );
          }
        }
        // AsyncStorage cannot cancel an already-started write. It is scoped to
        // the old organization/project key, so it cannot overwrite the new
        // scope; re-check freshness before publishing Core to React state.
        if (!refreshIsCurrent()) return;

        cancelScheduledRetry(true);
        setCore(result);
        setCoreSignature(refreshSignature);
        setCoreGeneration(refreshGeneration);
        setState(stateFromPersistence(result.realityAuthority.persistenceStatus));
        setError(null);
        setLastSuccessfulRefreshAt(new Date().toISOString());
        logStartupDiagnostic('shared_provider_ready', 'DAVE live authority provider is ready.', {
          state: stateFromPersistence(result.realityAuthority.persistenceStatus),
        });
      } catch (error) {
        if (!refreshIsCurrent()) return;
        logStartupDiagnostic('degraded_mode_entered', 'DAVE live authority failed; fallback Runtime remains available.', {
          error: startupErrorMessage(error),
        });
        setError('DAVE could not refresh the current project understanding.');
        setState('unavailable');
        const nextAttempt = retryAttemptRef.current + 1;
        if (nextAttempt <= LIVE_AUTHORITY_MAX_AUTO_RETRY_ATTEMPTS) {
          retryAttemptRef.current = nextAttempt;
          setRetryPending(true);
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (!mountedRef.current || !authorityReadyRef.current) return;
            setRetryPending(false);
            void runRefresh('background_retry');
          }, liveAuthorityRetryDelayMs(nextAttempt));
        } else {
          setRetryPending(false);
        }
      } finally {
        // Keep one authority build in flight per provider. Raw input changes
        // invalidate publication immediately, but they do not detach the
        // promise: the next generation waits until every durable side effect
        // from this build has finished.
        if (inFlightRef.current !== run) return;
        inFlightRef.current = null;
        const pendingReason = pendingReasonRef.current;
        pendingReasonRef.current = null;

        if (
          authorityReadyRef.current &&
          (
            pendingReason ||
            refreshSignature !== latestSignatureRef.current ||
            refreshScopeSignature !== latestScopeSignatureRef.current
          )
        ) {
          void runRefresh(pendingReason || 'project_changed');
        }
      }
    })();

    inFlightRef.current = run;
    return run;
  }, [cancelScheduledRetry]);

  const invalidatedRawFreshnessRef = useRef({
    signature: rawSignature,
    scopeSignature: rawScopeSignature,
  });
  useLayoutEffect(() => {
    const previous = invalidatedRawFreshnessRef.current;
    if (
      previous.signature === rawSignature &&
      previous.scopeSignature === rawScopeSignature
    ) {
      return;
    }

    invalidatedRawFreshnessRef.current = {
      signature: rawSignature,
      scopeSignature: rawScopeSignature,
    };
    sequenceRef.current += 1;
    pendingReasonRef.current = 'project_changed';
    cancelScheduledRetry(true);
    setState('loading');
    setError(null);
    if (previous.scopeSignature !== rawScopeSignature) {
      setLastSuccessfulRefreshAt(null);
    }
  }, [cancelScheduledRetry, rawScopeSignature, rawSignature]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sequenceRef.current += 1;
      inFlightRef.current = null;
      pendingReasonRef.current = null;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!readyForAuthority) {
      if (authorityWasReadyRef.current) {
        authorityWasReadyRef.current = false;
        sequenceRef.current += 1;
        pendingReasonRef.current = null;
        cancelScheduledRetry(true);
        setCore(null);
        setCoreSignature(null);
        setCoreGeneration(null);
        setState('loading');
        setError(null);
        setLastSuccessfulRefreshAt(null);
      }
      return;
    }

    authorityWasReadyRef.current = true;
    void runRefresh(core ? 'project_changed' : 'initial_load');
  }, [readyForAuthority, signature]);

  const notifyEvidenceChanged = useCallback((evidenceId: string) => {
    void evidenceId;
    void runRefresh('evidence_changed');
  }, [runRefresh]);

  const invalidateEvidence = useCallback((evidenceId: string) => {
    void evidenceId;
    void runRefresh('evidence_invalidated');
  }, [runRefresh]);

  const notifyProjectChanged = useCallback((projectId: string) => {
    void projectId;
    void runRefresh('project_changed');
  }, [runRefresh]);

  const authorityResolution = resolvePIELiveAuthorityState({
    hydrated: readyForAuthority,
    refreshState: state,
    corePresent: Boolean(core),
    currentSignature: rawSignature,
    acceptedSignature: coreSignature,
    currentGeneration: authorityGeneration,
    acceptedGeneration: coreGeneration,
  });

  const value = useMemo<PIELiveAuthorityContextValue>(() => {
    const currentCore = authorityResolution.coreIsCurrent ? core : null;
    const currentRuntime = currentCore?.runtime || immediateInputRuntime || fallbackRuntime;
    const persistenceStatus = currentCore?.realityAuthority.persistenceStatus || null;
    const nextState = authorityResolution.state;
    const policy = policyForCore(nextState, currentCore);
    const projectTruth = buildDAVEProjectTruth({
      projectId: displayInput.projectId || safeProjectId(displayInput.projectName),
      projectName: displayInput.projectName,
      updates: displayInput.updates,
      scheduleItems: displayInput.scheduleItems,
      projectAreas: displayInput.projectAreas,
      referenceDocuments: displayInput.referenceDocuments,
      projectDocuments: displayInput.projectDocuments,
      captureMemories: displayInput.captureMemories,
      runtime: currentRuntime,
      core: currentCore,
      now: currentRuntime.generatedAt,
    });
    const recommendationTrace = currentCore?.executiveJudgmentRecord
      ? buildPIERecommendationTrace({
          core: currentCore,
          report: currentCore.reportDraft,
        })
      : null;

    return {
      state: nextState,
      policy,
      core: currentCore,
      runtime: currentRuntime,
      projectTruth,
      organizationId: currentCore?.realityModel.organizationId || displayInput.organizationId || null,
      projectId: currentCore?.realityModel.projectId || displayInput.projectId || null,
      realityModel: currentCore?.realityModel || null,
      realityModelVersion: currentCore?.realityAuthority.modelVersion || null,
      realitySnapshotId: currentCore?.realityAuthority.snapshotId || null,
      executiveJudgment: currentCore?.executiveJudgmentResult || null,
      executiveJudgmentRecord: currentCore?.executiveJudgmentRecord || null,
      situationIntelligence: currentCore?.situationIntelligence || null,
      predictiveReality: currentCore?.predictiveReality || null,
      attention: currentCore?.attention || null,
      experience: currentCore?.experience || null,
      reportDraft: currentCore?.reportDraft || null,
      recommendationTrace,
      persistenceStatus,
      activeConflicts: currentCore?.realityModel.evidenceConflicts || [],
      activeUncertainties: currentCore?.realityModel.activeUncertainties || [],
      loading: nextState === 'loading',
      degraded: nextState !== 'ready',
      error,
      retryPending,
      lastSuccessfulRefreshAt,
      refreshAuthority: runRefresh,
      invalidateEvidence,
      notifyEvidenceChanged,
      notifyProjectChanged,
    };
  }, [
    authorityResolution.coreIsCurrent,
    authorityResolution.state,
    core,
    displayInput,
    error,
    fallbackRuntime,
    immediateInputRuntime,
    invalidateEvidence,
    lastSuccessfulRefreshAt,
    notifyEvidenceChanged,
    notifyProjectChanged,
    retryPending,
    runRefresh,
  ]);

  useEffect(() => {
    if (!readyForAuthority) return;
    if (!authorityResolution.mayPersistProjectTruth || !value.core) return;
    if (authorityInput.projectTruthPersistencePolicy === 'ephemeral_portfolio') return;
    const organizationId = authorityInput.identityTrusted ? authorityInput.organizationId : null;
    if (!organizationId || !value.projectTruth.projectId) return;
    const repository = createDAVEProjectTruthRepository({
      cloudEnabled: Boolean(authorityInput.cloudAvailable),
      identityTrusted: Boolean(authorityInput.identityTrusted),
    });
    void repository.save(organizationId, value.projectTruth)
      .then(result => {
        logStartupDiagnostic(
          'project_truth_persisted',
          'Versioned DAVE Project Truth snapshot persisted.',
          {
            revision: result.snapshot.revision,
            created: result.created,
            cloudStatus: result.cloudStatus,
          },
        );
      })
      .catch(error => {
        logStartupDiagnostic(
          'project_truth_persistence_failed',
          'DAVE Project Truth remains available in memory, but its snapshot could not be persisted.',
          { error: startupErrorMessage(error) },
        );
      });
  }, [
    authorityInput.cloudAvailable,
    authorityInput.identityTrusted,
    authorityInput.organizationId,
    authorityInput.projectTruthPersistencePolicy,
    authorityResolution.mayPersistProjectTruth,
    value.core,
    value.projectTruth,
  ]);

  return (
    <PIELiveAuthorityContext.Provider value={value}>
      {children}
    </PIELiveAuthorityContext.Provider>
  );
}

export function usePIELiveAuthority() {
  const value = useContext(PIELiveAuthorityContext);
  if (!value) {
    throw new Error('usePIELiveAuthority must be used within PIELiveAuthorityProvider.');
  }
  return value;
}

export function useOptionalPIELiveAuthority() {
  return useContext(PIELiveAuthorityContext);
}

export function stateFromPersistence(
  status: PIERealityPersistenceStatus,
): PIELiveAuthorityStateName {
  if (status === 'authoritative_local' || status === 'authoritative_cloud') return 'ready';
  return status;
}

export function policyForState(state: PIELiveAuthorityStateName): PIELiveAuthorityPolicy {
  if (state === 'ready') {
    return {
      mayShowRecommendations: true,
      highImpactAutomationAllowed: true,
      reportGenerationAllowed: true,
      layer4DecisionCreationAllowed: true,
      userMessage: 'DAVE is ready.',
    };
  }
  if (state === 'queued_for_cloud' || state === 'degraded_local_only') {
    return {
      mayShowRecommendations: true,
      highImpactAutomationAllowed: false,
      reportGenerationAllowed: true,
      layer4DecisionCreationAllowed: false,
      userMessage: 'DAVE is using the latest information saved on this device.',
    };
  }
  if (state === 'conflict_blocked') {
    return {
      mayShowRecommendations: true,
      highImpactAutomationAllowed: false,
      reportGenerationAllowed: false,
      layer4DecisionCreationAllowed: false,
      userMessage: 'DAVE found a conflict that needs review before final recommendations.',
    };
  }
  if (state === 'stale_model') {
    return {
      mayShowRecommendations: false,
      highImpactAutomationAllowed: false,
      reportGenerationAllowed: false,
      layer4DecisionCreationAllowed: false,
      userMessage: 'DAVE needs to refresh this project before recommending action.',
    };
  }

  return {
    ...DEFAULT_POLICY,
    userMessage:
      state === 'blocked_identity' || state === 'blocked_organization'
        ? 'DAVE needs a trusted project connection before final recommendations.'
        : state === 'persistence_failed'
          ? 'DAVE saved the evidence, but could not update project understanding yet.'
          : DEFAULT_POLICY.userMessage,
  };
}

export function policyForCore(
  state: PIELiveAuthorityStateName,
  core: PIECoreOutput | null,
): PIELiveAuthorityPolicy {
  const base = policyForState(state);
  if (!core) {
    return {
      ...base,
      mayShowRecommendations: false,
      highImpactAutomationAllowed: false,
      reportGenerationAllowed: false,
      layer4DecisionCreationAllowed: false,
    };
  }
  const jarvisStatus = core?.jarvisReasoningValidation?.status;
  if (!jarvisStatus || jarvisStatus === 'pass') return base;

  if (jarvisStatus === 'pass_with_warnings') {
    return {
      ...base,
      highImpactAutomationAllowed: false,
      userMessage: 'DAVE has a recommendation, but important uncertainty remains.',
    };
  }

  if (jarvisStatus === 'needs_more_evidence') {
    return {
      ...base,
      highImpactAutomationAllowed: false,
      reportGenerationAllowed: false,
      layer4DecisionCreationAllowed: false,
      userMessage:
        core?.evidenceValuePrioritization.oneRequestForUser ||
        'DAVE needs one more piece of evidence before final recommendation.',
    };
  }

  return {
    ...base,
    mayShowRecommendations: false,
    highImpactAutomationAllowed: false,
    reportGenerationAllowed: false,
    layer4DecisionCreationAllowed: false,
    userMessage:
      jarvisStatus === 'human_review_required'
        ? 'DAVE needs human review before this recommendation can be final.'
        : 'DAVE blocked this recommendation because reasoning validation failed.',
  };
}

function buildProviderRuntime(input: PIELiveAuthorityInput) {
  return buildRuntime(providerRuntimeContext(input));
}

function providerRuntimeContext(input: PIELiveAuthorityInput): PIERuntimeContext {
  return {
    projectName: input.projectName,
    projectNames: input.projectNames,
    reportType: input.reportType,
    updates: Array.isArray(input.updates) ? input.updates : [],
    scheduleItems: Array.isArray(input.scheduleItems) ? input.scheduleItems : [],
    currentUpdate: input.currentUpdate,
    projectAreas: Array.isArray(input.projectAreas) ? input.projectAreas : [],
    contacts: input.contacts,
    referenceDocuments: Array.isArray(input.referenceDocuments) ? input.referenceDocuments : [],
    syncMetadata: input.syncMetadata,
    surface: input.surface || 'home',
  };
}

function safeBuildProviderRuntime(input: PIELiveAuthorityInput) {
  try {
    return buildProviderRuntime(input);
  } catch (error) {
    logStartupDiagnostic('degraded_mode_entered', 'Provider Runtime initialization failed; using safe local defaults.', {
      error: startupErrorMessage(error),
    });
    try {
      return buildRuntime({
        projectName: input.projectName || 'Current Project',
        projectNames: [input.projectName || 'Current Project'],
        updates: [],
        scheduleItems: [],
        projectAreas: [],
        referenceDocuments: [],
        surface: input.surface || 'home',
      });
    } catch (fallbackError) {
      logStartupDiagnostic('startup_failure', 'Fallback Runtime initialization failed.', {
        error: startupErrorMessage(fallbackError),
      });
      throw fallbackError;
    }
  }
}

function safeProjectId(value: string) {
  return `project-${value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unassigned'}`;
}
