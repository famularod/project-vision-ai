import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
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
import type { PIEReportType } from '../services/PIEReporter';
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
import { authorityInputSignature } from '../services/PIELiveAuthoritySignature';

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

export type PIELiveAuthorityStateName =
  | 'loading'
  | 'ready'
  | 'degraded_local_only'
  | 'queued_for_cloud'
  | 'stale_model'
  | 'conflict_blocked'
  | 'blocked_identity'
  | 'blocked_organization'
  | 'persistence_failed'
  | 'unavailable';

export type PIELiveAuthorityPolicy = {
  mayShowRecommendations: boolean;
  highImpactAutomationAllowed: boolean;
  reportGenerationAllowed: boolean;
  layer4DecisionCreationAllowed: boolean;
  userMessage: string;
};

export type PIELiveAuthorityInput = {
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
  const [state, setState] = useState<PIELiveAuthorityStateName>('loading');
  const [error, setError] = useState<string | null>(null);
  const [retryPending, setRetryPending] = useState(false);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<string | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const sequenceRef = useRef(0);
  const latestProjectRef = useRef<string | null>(input.projectId || safeProjectId(input.projectName));
  const pendingReasonRef = useRef<PIELiveAuthorityRefreshReason | null>(null);
  const signature = useMemo(() => authorityInputSignature(input), [input]);
  const currentInputRuntime = useMemo(
    () => safeBuildProviderRuntime(input),
    [signature],
  );
  const latestInputRef = useRef(input);
  const latestSignatureRef = useRef(signature);
  latestInputRef.current = input;
  latestSignatureRef.current = signature;

  const runRefresh = useCallback(async (reason: PIELiveAuthorityRefreshReason) => {
    pendingReasonRef.current = reason;

    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    const refreshInput = latestInputRef.current;
    const refreshSignature = latestSignatureRef.current;
    pendingReasonRef.current = null;
    const refreshSequence = sequenceRef.current + 1;
    sequenceRef.current = refreshSequence;
    setState(previous => previous === 'ready' ? previous : 'loading');
    setRetryPending(false);

    const run = (async () => {
      try {
        const runtime = safeBuildProviderRuntime(refreshInput);
        setFallbackRuntime(runtime);
        const result = await buildLivePIECoreIntelligence({
          runtime,
          runtimeContext: providerRuntimeContext(refreshInput),
          reportType: refreshInput.reportType,
          reportProjectNames: refreshInput.projectNames,
          organizationId: refreshInput.organizationId || 'local-unverified-anonymous',
          projectId: refreshInput.projectId || safeProjectId(refreshInput.projectName),
          identityTrusted: Boolean(refreshInput.identityTrusted),
          cloudAvailable: Boolean(refreshInput.cloudAvailable),
        });
        const nextProjectId =
          result.realityAuthority.modelId ||
          refreshInput.projectId ||
          safeProjectId(refreshInput.projectName);

        if (refreshSequence !== sequenceRef.current) return;
        if (refreshSignature !== latestSignatureRef.current) return;
        if (latestProjectRef.current && nextProjectId && !nextProjectId.includes(latestProjectRef.current)) {
          return;
        }

        setCore(result);
        setCoreSignature(refreshSignature);
        setState(stateFromPersistence(result.realityAuthority.persistenceStatus));
        setError(null);
        setLastSuccessfulRefreshAt(new Date().toISOString());
        logStartupDiagnostic('shared_provider_ready', 'DAVE live authority provider is ready.', {
          state: stateFromPersistence(result.realityAuthority.persistenceStatus),
        });
      } catch (error) {
        if (refreshSequence !== sequenceRef.current) return;
        if (refreshSignature !== latestSignatureRef.current) return;
        logStartupDiagnostic('degraded_mode_entered', 'DAVE live authority failed; fallback Runtime remains available.', {
          error: startupErrorMessage(error),
        });
        setError('DAVE could not refresh the current project understanding.');
        setState('unavailable');
        setRetryPending(true);
        setTimeout(() => {
          if (pendingReasonRef.current) {
            void runRefresh('background_retry');
          }
        }, 2500);
      } finally {
        inFlightRef.current = null;
        const pendingReason = pendingReasonRef.current;
        pendingReasonRef.current = null;

        if (pendingReason || refreshSignature !== latestSignatureRef.current) {
          void runRefresh(pendingReason || 'project_changed');
        }
      }
    })();

    inFlightRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    latestProjectRef.current = input.projectId || safeProjectId(input.projectName);
    setFallbackRuntime(safeBuildProviderRuntime(input));
    void runRefresh(core ? 'project_changed' : 'initial_load');
  }, [signature]);

  const notifyEvidenceChanged = useCallback((evidenceId: string) => {
    void evidenceId;
    void runRefresh('evidence_changed');
  }, [runRefresh]);

  const invalidateEvidence = useCallback((evidenceId: string) => {
    void evidenceId;
    void runRefresh('evidence_invalidated');
  }, [runRefresh]);

  const notifyProjectChanged = useCallback((projectId: string) => {
    latestProjectRef.current = projectId;
    void runRefresh('project_changed');
  }, [runRefresh]);

  const value = useMemo<PIELiveAuthorityContextValue>(() => {
    const currentCore = coreSignature === signature ? core : null;
    const currentRuntime = currentCore?.runtime ||
      (coreSignature === signature ? fallbackRuntime : currentInputRuntime);
    const persistenceStatus = currentCore?.realityAuthority.persistenceStatus || null;
    const nextState = state === 'loading' && currentCore
      ? stateFromPersistence(currentCore.realityAuthority.persistenceStatus)
      : state;
    const policy = policyForCore(nextState, currentCore);
    const projectTruth = buildDAVEProjectTruth({
      projectId: input.projectId || safeProjectId(input.projectName),
      projectName: input.projectName,
      updates: input.updates,
      scheduleItems: input.scheduleItems,
      projectAreas: input.projectAreas,
      referenceDocuments: input.referenceDocuments,
      projectDocuments: input.projectDocuments,
      captureMemories: input.captureMemories,
      runtime: currentRuntime,
      core: currentCore,
      now: currentRuntime.generatedAt,
    });

    return {
      state: nextState,
      policy,
      core: currentCore,
      runtime: currentRuntime,
      projectTruth,
      organizationId: currentCore?.realityModel.organizationId || input.organizationId || null,
      projectId: currentCore?.realityModel.projectId || input.projectId || null,
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
    core,
    coreSignature,
    currentInputRuntime,
    error,
    fallbackRuntime,
    input.organizationId,
    input.projectId,
    input.projectName,
    input.updates,
    input.scheduleItems,
    input.projectAreas,
    input.referenceDocuments,
    input.projectDocuments,
    input.captureMemories,
    invalidateEvidence,
    lastSuccessfulRefreshAt,
    notifyEvidenceChanged,
    notifyProjectChanged,
    retryPending,
    runRefresh,
    signature,
    state,
  ]);

  useEffect(() => {
    const organizationId = input.identityTrusted ? input.organizationId : null;
    if (!organizationId || !value.projectTruth.projectId) return;
    const repository = createDAVEProjectTruthRepository({
      cloudEnabled: Boolean(input.cloudAvailable),
      identityTrusted: Boolean(input.identityTrusted),
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
    input.cloudAvailable,
    input.identityTrusted,
    input.organizationId,
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
