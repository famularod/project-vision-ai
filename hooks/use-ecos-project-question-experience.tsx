import { useCallback, useMemo, useState } from 'react';
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

type QuestionState = Readonly<{
  projectName: string;
  question: string;
  answer: ECOSProjectQuestionAnswer | null;
  loading: boolean;
  error: string | null;
}>;

export function useECOSProjectQuestionExperience({
  contextualProjectName,
  projectRecords,
  candidateProjects,
  onOpenEvidence,
}: {
  contextualProjectName: string | null;
  projectRecords: readonly ProjectRecord[];
  candidateProjects: readonly string[];
  onOpenEvidence: (projectName: string, evidence: DAVEAskEvidence) => void;
}) {
  const [projectName, setProjectName] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [typedOpen, setTypedOpen] = useState(false);
  const [result, setResult] = useState<QuestionState | null>(null);
  const projectId = useMemo(() => projectRecords.find(project =>
    project.name.trim().toLowerCase() === projectName.trim().toLowerCase(),
  )?.id?.trim() || null, [projectName, projectRecords]);

  const open = useCallback(() => {
    setProjectName(contextualProjectName || '');
    setResult(null);
    setTypedOpen(false);
    setVoiceOpen(true);
  }, [contextualProjectName]);

  const ask = useCallback(async (question: string) => {
    const selectedProjectName = projectName.trim();
    const cleanQuestion = question.replace(/\s+/g, ' ').trim();
    if (!selectedProjectName || !projectId) {
      Alert.alert('Choose a project', 'Ask ECOS needs one synchronized project before it can review project evidence.');
      return;
    }
    setVoiceOpen(false);
    setTypedOpen(false);
    setResult({ projectName: selectedProjectName, question: cleanQuestion, answer: null, loading: true, error: null });
    try {
      const answer = await askECOSProjectQuestion({
        client: getSupabaseClient(),
        projectId,
        projectName: selectedProjectName,
        question: cleanQuestion,
      });
      setResult(current => current?.question === cleanQuestion
        ? { ...current, answer, loading: false, error: null }
        : current);
    } catch (error) {
      setResult(current => current?.question === cleanQuestion
        ? { ...current, loading: false, error: error instanceof Error ? error.message : 'Ask ECOS could not complete the question.' }
        : current);
    }
  }, [projectId, projectName]);

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
      showWalkContext={false}
      onMemoryReady={answer => { void ask(answer.transcript); }}
      onProjectChange={setProjectName}
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
      visible={Boolean(result)}
      projectName={result?.projectName || projectName}
      question={result?.question || ''}
      answer={result?.answer || null}
      loading={result?.loading || false}
      error={result?.error || null}
      onOpenEvidence={evidence => {
        const answerProject = result?.projectName || projectName;
        setResult(null);
        onOpenEvidence(answerProject, evidence);
      }}
      onAskAnother={suggestedQuestion => {
        if (suggestedQuestion) {
          void ask(suggestedQuestion);
          return;
        }
        setResult(null);
        setVoiceOpen(true);
      }}
      onClose={() => setResult(null)}
    />
  </>;

  return { open, sheets };
}
