import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { DAVETypedCaptureSheet } from '../components/DAVETypedCaptureSheet';
import { DAVEVoiceCaptureSheet } from '../components/DAVEVoiceCaptureSheet';
import { ECOSProjectAnswerSheet } from '../components/ECOSProjectAnswerSheet';
import type { DAVEAskEvidence } from '../services/DAVEAsk';
import {
  askECOSProjectQuestion,
  type ECOSProjectQuestionAnswer,
} from '../services/ECOSProjectQuestion';
import type { ProjectRecord } from '../services/ProjectCoverPhotoService';
import { getSupabaseClient } from '../services/SupabaseService';
import {
  buildECOSProjectSelectionOptions,
  normalizeProjectDisplayName,
  resolveECOSProjectSelection,
  sameECOSProjectSelection,
  type ECOSProjectSelection,
} from '../services/ECOSProjectSelection';

type QuestionState = Readonly<{
  projectId: string;
  projectName: string;
  question: string;
  answer: ECOSProjectQuestionAnswer | null;
  loading: boolean;
  error: string | null;
}>;

type PendingQuestion = Readonly<{
  project: ECOSProjectSelection;
  question: string;
}>;

const CAPTURE_DISMISS_FALLBACK_MS = 550;

export function useECOSProjectQuestionExperience({
  contextualProjectName,
  contextualProjectId,
  projectRecords,
  candidateProjects,
  onOpenEvidence,
}: {
  contextualProjectName: string | null;
  contextualProjectId: string | null;
  projectRecords: readonly ProjectRecord[];
  candidateProjects: readonly string[];
  onOpenEvidence: (projectId: string, projectName: string, evidence: DAVEAskEvidence) => void;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [typedOpen, setTypedOpen] = useState(false);
  const [result, setResult] = useState<QuestionState | null>(null);
  const contextualProject = useMemo(() => resolveECOSProjectSelection({
    projectId: contextualProjectId,
    projectName: contextualProjectName,
    projectRecords,
  }), [contextualProjectId, contextualProjectName, projectRecords]);
  const selectedProject = useMemo(() => resolveECOSProjectSelection({
    projectId: selectedProjectId,
    projectName: null,
    projectRecords,
  }), [projectRecords, selectedProjectId]);
  const projectId = selectedProject?.id || null;
  const projectName = selectedProject?.name || '';
  const projectOptions = useMemo(() => buildECOSProjectSelectionOptions({
    projectRecords,
    candidateProjectNames: candidateProjects,
  }), [candidateProjects, projectRecords]);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const pendingQuestionRef = useRef<PendingQuestion | null>(null);
  const captureDismissFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedProjectRef = useRef<ECOSProjectSelection | null>(selectedProject);
  const contextKey = `${contextualProjectId || ''}\u0000${normalizeProjectDisplayName(contextualProjectName)}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  selectedProjectRef.current = selectedProject;

  const clearCaptureDismissFallback = useCallback(() => {
    if (captureDismissFallbackRef.current) clearTimeout(captureDismissFallbackRef.current);
    captureDismissFallbackRef.current = null;
  }, []);

  const invalidateRequests = useCallback(() => {
    requestGenerationRef.current += 1;
    pendingQuestionRef.current = null;
    clearCaptureDismissFallback();
  }, [clearCaptureDismissFallback]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      pendingQuestionRef.current = null;
      clearCaptureDismissFallback();
    };
  }, [clearCaptureDismissFallback]);

  useEffect(() => {
    invalidateRequests();
    selectedProjectRef.current = contextualProject;
    setSelectedProjectId(contextualProject?.id || null);
    setResult(null);
  }, [contextKey, contextualProject, invalidateRequests]);

  const open = useCallback(() => {
    invalidateRequests();
    selectedProjectRef.current = contextualProject;
    setSelectedProjectId(contextualProject?.id || null);
    setResult(null);
    setTypedOpen(false);
    setVoiceOpen(true);
  }, [contextualProject, invalidateRequests]);

  const runQuestion = useCallback(async (capturedProject: ECOSProjectSelection, cleanQuestion: string) => {
    const selectedProjectName = capturedProject?.name || '';
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const capturedContextKey = contextKeyRef.current;
    setResult({ projectId: capturedProject.id, projectName: selectedProjectName, question: cleanQuestion, answer: null, loading: true, error: null });
    try {
      const answer = await askECOSProjectQuestion({
        client: getSupabaseClient(),
        projectId: capturedProject.id,
        projectName: selectedProjectName,
        question: cleanQuestion,
      });
      if (!requestCompletionIsCurrent({
        mounted: mountedRef.current,
        requestGeneration,
        currentRequestGeneration: requestGenerationRef.current,
        capturedContextKey,
        currentContextKey: contextKeyRef.current,
        capturedProject,
        currentProject: selectedProjectRef.current,
      })) return;
      setResult(current => current?.projectId === capturedProject.id &&
        normalizeProjectDisplayName(current.projectName) === normalizeProjectDisplayName(selectedProjectName) &&
        current.question === cleanQuestion
        ? { ...current, answer, loading: false, error: null }
        : current);
    } catch (error) {
      if (!requestCompletionIsCurrent({
        mounted: mountedRef.current,
        requestGeneration,
        currentRequestGeneration: requestGenerationRef.current,
        capturedContextKey,
        currentContextKey: contextKeyRef.current,
        capturedProject,
        currentProject: selectedProjectRef.current,
      })) return;
      setResult(current => current?.projectId === capturedProject.id &&
        normalizeProjectDisplayName(current.projectName) === normalizeProjectDisplayName(selectedProjectName) &&
        current.question === cleanQuestion
        ? { ...current, loading: false, error: error instanceof Error ? error.message : 'Ask ECOS could not complete the question.' }
        : current);
    }
  }, []);

  const pendingQuestion = useCallback((question: string): PendingQuestion | null => {
    const project = selectedProjectRef.current;
    const cleanQuestion = question.replace(/\s+/g, ' ').trim();
    if (!project?.name || !project.id) {
      Alert.alert('Choose a project', 'Ask ECOS needs one synchronized project before it can review project evidence.');
      return null;
    }
    return { project, question: cleanQuestion };
  }, []);

  const continuePendingQuestion = useCallback(() => {
    const pending = pendingQuestionRef.current;
    if (!pending) return;
    pendingQuestionRef.current = null;
    clearCaptureDismissFallback();
    void runQuestion(pending.project, pending.question);
  }, [clearCaptureDismissFallback, runQuestion]);

  const submitCapturedQuestion = useCallback((question: string) => {
    const pending = pendingQuestion(question);
    if (!pending) return;
    pendingQuestionRef.current = pending;
    setVoiceOpen(false);
    setTypedOpen(false);
    clearCaptureDismissFallback();
    captureDismissFallbackRef.current = setTimeout(continuePendingQuestion, CAPTURE_DISMISS_FALLBACK_MS);
  }, [clearCaptureDismissFallback, continuePendingQuestion, pendingQuestion]);

  const askImmediately = useCallback((question: string) => {
    const pending = pendingQuestion(question);
    if (!pending) return;
    void runQuestion(pending.project, pending.question);
  }, [pendingQuestion, runQuestion]);

  const sheets = <>
    <DAVEVoiceCaptureSheet
      visible={voiceOpen}
      projectId={projectId}
      projectName={projectName}
      candidateProjects={[]}
      candidateProjectOptions={projectOptions}
      candidateLocations={[]}
      title="Ask ECOS"
      prompt="What do you want to know?"
      guidance="Ask one project question. ECOS will review current tasks, field updates, and indexed documents, then show the exact proof it used."
      continueLabel="Ask ECOS"
      transcriptionPurpose="question"
      showWalkContext={false}
      ecosExperience
      onMemoryReady={answer => submitCapturedQuestion(answer.transcript)}
      onProjectSelectionChange={project => {
        invalidateRequests();
        selectedProjectRef.current = project;
        setSelectedProjectId(project.id);
        setResult(null);
      }}
      onTypeInstead={() => {
        if (!projectName.trim()) {
          Alert.alert('Choose a project', 'Select the project before typing a question.');
          return;
        }
        setVoiceOpen(false);
        setTypedOpen(true);
      }}
      onCancel={() => setVoiceOpen(false)}
      onDismiss={continuePendingQuestion}
    />
    <DAVETypedCaptureSheet
      visible={typedOpen}
      projectName={projectName}
      title="Ask ECOS"
      prompt="What do you want to know?"
      guidance="ECOS will answer only from current project records and indexed documents, with proof."
      placeholder="Example: How thick is the new concrete on the north side?"
      continueLabel="Ask ECOS"
      accessibilityLabel="Project question for ECOS"
      ecosExperience
      onContinue={submitCapturedQuestion}
      onCancel={() => setTypedOpen(false)}
      onDismiss={continuePendingQuestion}
    />
    <ECOSProjectAnswerSheet
      visible={Boolean(result)}
      projectName={result?.projectName || projectName}
      question={result?.question || ''}
      answer={result?.answer || null}
      loading={result?.loading || false}
      error={result?.error || null}
      onOpenEvidence={evidence => {
        const answerProjectId = result?.projectId || projectId;
        const answerProject = result?.projectName || projectName;
        if (!answerProjectId || !answerProject) return;
        setResult(null);
        onOpenEvidence(answerProjectId, answerProject, evidence);
      }}
      onAskAnother={suggestedQuestion => {
        if (suggestedQuestion) {
          askImmediately(suggestedQuestion);
          return;
        }
        setResult(null);
        setVoiceOpen(true);
      }}
      onClose={() => setResult(null)}
    />
  </>;

  return { open, sheets, active: voiceOpen || typedOpen || Boolean(result) };
}

function requestCompletionIsCurrent({
  mounted,
  requestGeneration,
  currentRequestGeneration,
  capturedContextKey,
  currentContextKey,
  capturedProject,
  currentProject,
}: Readonly<{
  mounted: boolean;
  requestGeneration: number;
  currentRequestGeneration: number;
  capturedContextKey: string;
  currentContextKey: string;
  capturedProject: ECOSProjectSelection;
  currentProject: ECOSProjectSelection | null;
}>) {
  return mounted &&
    requestGeneration === currentRequestGeneration &&
    capturedContextKey === currentContextKey &&
    sameECOSProjectSelection(capturedProject, currentProject);
}
