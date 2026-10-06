import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { DAVETypedCaptureSheet } from '../components/DAVETypedCaptureSheet';
import { DAVEVoiceCaptureSheet } from '../components/DAVEVoiceCaptureSheet';
import { ECOSProjectAnswerSheet } from '../components/ECOSProjectAnswerSheet';
import type { DAVEAskEvidence } from '../services/DAVEAsk';
import { createECOSAskWait, isECOSAskStopped } from '../services/ECOSAskWait';
import {
  askECOSProjectQuestion,
  ecosAskCanRetry,
  ecosClosedProjectNames,
  type ECOSProjectQuestionAnswer,
} from '../services/ECOSProjectQuestion';
import type { ProjectRecord } from '../services/ProjectCoverPhotoService';
import { getSupabaseClient } from '../services/SupabaseService';
import { useNativeWorkspaceOwner } from '../components/native-workspace-owner';
import { useECOSConversation } from './use-ecos-conversation';

type QuestionState = Readonly<{
  requestGeneration: number;
  projectName: string;
  question: string;
  answer: ECOSProjectQuestionAnswer | null;
  loading: boolean;
  error: string | null;
  /** Whether Try Again is offered: the same question could end differently. */
  canRetry: boolean;
  /** The server was already working on this question; the wait is for that answer (review pass 2 A1). */
  earlierAskStillRunning: boolean;
  /** When the server took a repeat as a run of its own: the usual steps count from then (review pass 3 A1w). */
  workingSince: number | null;
}>;

function projectIdFor(projectRecords: readonly ProjectRecord[], name: string): string | null {
  return projectRecords.find(project =>
    project.name.trim().toLowerCase() === name.trim().toLowerCase(),
  )?.id?.trim() || null;
}

const NO_NAMES: readonly string[] = [];

const alertChooseProject = () =>
  Alert.alert('Choose a project', 'Ask ECOS needs one synchronized project before it can review project evidence.');

export function useECOSProjectQuestionExperience({
  contextualProjectName,
  projectRecords,
  candidateProjects,
  archivedProjectNames = NO_NAMES,
  deletedProjectNames = NO_NAMES,
  onOpenEvidence,
  documentEvidenceVisible = false,
}: {
  contextualProjectName: string | null;
  projectRecords: readonly ProjectRecord[];
  candidateProjects: readonly string[];
  /** Closed projects; a deleted one is left out (audit A9 pass 3 L1). */
  archivedProjectNames?: readonly string[];
  deletedProjectNames?: readonly string[];
  onOpenEvidence: (projectName: string, evidence: DAVEAskEvidence) => void;
  documentEvidenceVisible?: boolean;
}) {
  const [projectName, setProjectName] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [typedOpen, setTypedOpen] = useState(false);
  const [result, setResult] = useState<QuestionState | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<Readonly<{ projectName: string; question: string }> | null>(null);
  // Bumped only by askFor: a question sent from Talk starts a new Ask ECOS
  // conversation, so the server cannot read it against an older Ask ECOS
  // question of the project (audit A9 pass 2 F2).
  const [conversationEpoch, setConversationEpoch] = useState(0);
  const requestGeneration = useRef(0);
  // Bounds the wait, stops it, and keeps a stopped question's request id (independent review R10).
  const [askWait] = useState(createECOSAskWait);
  const dismissResult = useCallback(() => {
    requestGeneration.current += 1;
    // The request is stopped too, not only its answer ignored.
    askWait.cancel();
    setResult(null);
  }, [askWait]);
  useEffect(() => () => { requestGeneration.current += 1; askWait.reset(); }, [askWait]);
  const projectId = useMemo(() => projectIdFor(projectRecords, projectName), [projectName, projectRecords]);
  // The unarchived projects the user can pick, so Ask ECOS refuses a number only
  // when it names one of them (owner answer Q20; audit A9 pass 1 #2).
  const knownProjectNames = useMemo(
    () => [...new Set(candidateProjects.map(name => name.trim()).filter(Boolean))],
    [candidateProjects],
  );
  // Closed projects are not pickable, but a question naming one is still refused (audit A9 pass 3 L1).
  const closedProjectNames = useMemo(
    () => ecosClosedProjectNames({ archived: archivedProjectNames, deleted: deletedProjectNames, open: knownProjectNames }),
    [archivedProjectNames, deletedProjectNames, knownProjectNames],
  );
  const ownerKey = useNativeWorkspaceOwner();
  const conversation = useECOSConversation(JSON.stringify([ownerKey, projectId, projectName, conversationEpoch]));
  useEffect(() => { dismissResult(); }, [conversation, dismissResult]);

  const open = useCallback(() => {
    setProjectName(contextualProjectName || '');
    dismissResult();
    setTypedOpen(false);
    setVoiceOpen(true);
  }, [contextualProjectName, dismissResult]);

  const ask = useCallback(async (question: string) => {
    const selectedProjectName = projectName.trim();
    const cleanQuestion = question.replace(/\s+/g, ' ').trim();
    if (!selectedProjectName || !projectId) {
      alertChooseProject();
      return;
    }
    setVoiceOpen(false);
    setTypedOpen(false);
    const generation = ++requestGeneration.current;
    const turn = conversation.begin();
    setResult({ requestGeneration: generation, projectName: selectedProjectName, question: cleanQuestion, answer: null, loading: true, error: null, canRetry: false, earlierAskStillRunning: false, workingSince: null });
    try {
      const answer = await askWait.run(
        [projectId, cleanQuestion, turn.request.conversationId, turn.request.priorTurnId],
        control => askECOSProjectQuestion({
          client: getSupabaseClient(),
          projectId,
          projectName: selectedProjectName,
          question: cleanQuestion,
          knownProjectNames,
          closedProjectNames,
          // The answer sheet has no project picker (audit A9 pass 3 L3).
          refusalWording: 'phone',
          ...turn.request,
          ...control,
        }),
        (earlierAskStillRunning, askedAt) => setResult(current => current?.requestGeneration === generation
          ? { ...current, earlierAskStillRunning, workingSince: earlierAskStillRunning ? null : askedAt }
          : current),
      );
      if (requestGeneration.current !== generation || !turn.isCurrent()) return;
      turn.accept(answer.conversation);
      setResult(current => current?.requestGeneration === generation
        ? { ...current, answer, loading: false, error: null }
        : current);
    } catch (error) {
      if (requestGeneration.current !== generation || !turn.isCurrent()) return;
      // Stopped or timed out: nothing came back, so the conversation stands
      // and Try Again repeats this same request.
      if (!isECOSAskStopped(error)) turn.accept(null);
      setResult(current => current?.requestGeneration === generation
        ? { ...current, loading: false, error: error instanceof Error ? error.message : 'Ask ECOS could not complete the question.', canRetry: ecosAskCanRetry(error) }
        : current);
    }
  }, [askWait, projectId, projectName, conversation, knownProjectNames, closedProjectNames]);

  // Runs after the reset effect above, once the named project's conversation exists.
  useEffect(() => {
    if (!pendingQuestion) return;
    setPendingQuestion(null);
    if (pendingQuestion.projectName === projectName) void ask(pendingQuestion.question);
  }, [ask, pendingQuestion, projectName]);

  /** Whether Ask ECOS can ask about this project: it has a cloud record (audit A9 pass 2 F4). */
  const canAskFor = useCallback(
    (name: string) => Boolean(name.trim() && projectIdFor(projectRecords, name.trim())),
    [projectRecords],
  );

  /**
   * Asks one question for a named project, e.g. from a Talk document match
   * (audit A9 pass 1 #3), in a new Ask ECOS conversation. Returns whether it
   * started, so Talk keeps its answer when it did not (audit A9 pass 2 F4).
   */
  const askFor = useCallback((name: string, question: string): boolean => {
    const selectedProjectName = name.trim();
    if (!canAskFor(selectedProjectName)) {
      alertChooseProject();
      return false;
    }
    setProjectName(selectedProjectName);
    setConversationEpoch(epoch => epoch + 1);
    setPendingQuestion({ projectName: selectedProjectName, question });
    return true;
  }, [canAskFor]);

  const sheets = <>
    <DAVEVoiceCaptureSheet
      visible={voiceOpen}
      projectId={projectId}
      projectName={projectName}
      candidateProjects={candidateProjects}
      candidateLocations={[]}
      title="Ask ECOS"
      prompt="What do you want to know?"
      guidance="Ask one project question. ECOS will review current tasks, field updates, and indexed documents, then show the exact proof it used."
      continueLabel="Ask ECOS"
      transcriptionPurpose="question"
      keepSlot="ask"
      showWalkContext={false}
      onMemoryReady={answer => { void ask(answer.transcript); }}
      onProjectChange={name => { dismissResult(); setProjectName(name); }}
      onTypeInstead={() => {
        if (!projectName.trim()) {
          Alert.alert('Choose a project', 'Select the project before typing a question.');
          return;
        }
        setVoiceOpen(false);
        setTypedOpen(true);
      }}
      onCancel={() => setVoiceOpen(false)}
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
      onContinue={question => { void ask(question); }}
      onCancel={() => setTypedOpen(false)}
    />
    <ECOSProjectAnswerSheet
      visible={Boolean(result) && !documentEvidenceVisible}
      projectName={result?.projectName || projectName}
      question={result?.question || ''}
      answer={result?.answer || null}
      loading={result?.loading || false}
      earlierAskStillRunning={result?.earlierAskStillRunning || false}
      workingSince={result?.workingSince ?? null}
      error={result?.error || null}
      onOpenEvidence={evidence => {
        const answerProject = result?.projectName || projectName;
        // A document proof is a temporary child view, not dismissal of the answer.
        // Keep the same result/turn so closing proof restores every source card.
        if (evidence.sourceType !== 'document' || !evidence.documentCitation) dismissResult();
        onOpenEvidence(answerProject, evidence);
      }}
      onAskAnother={suggestedQuestion => {
        if (suggestedQuestion) {
          void ask(suggestedQuestion);
          return;
        }
        dismissResult();
        setVoiceOpen(true);
      }}
      onStop={() => askWait.cancel()}
      onRetry={result?.canRetry ? () => { void ask(result.question); } : undefined}
      // While ECOS is still working the X keeps the question, as Stop does;
      // it closes once the wait is over (Build 231 E1 item 1).
      onClose={result?.loading ? () => askWait.cancel() : dismissResult}
    />
  </>;

  // Closes every Ask ECOS sheet (a panel that failed to render, audit A2 pass 2).
  const close = useCallback(() => {
    setVoiceOpen(false);
    setTypedOpen(false);
    dismissResult();
  }, [dismissResult]);

  // Talk refuses a question naming a closed project with the same list (audit A9 pass 6 L6b).
  return { open, close, askFor, canAskFor, sheets, closedProjectNames };
}
