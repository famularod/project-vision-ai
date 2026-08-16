import { render } from '@testing-library/react-native';
import { ECOSProjectAnswerSheet } from '../../components/ECOSProjectAnswerSheet';
import type { ECOSProjectQuestionAnswer } from '../../services/ECOSProjectQuestion';

const insufficientAnswer: ECOSProjectQuestionAnswer = {
  schemaVersion: 'ecos-project-question/1.0',
  projectId: 'project-2375',
  projectName: '2375 Compliance Project',
  question: 'How thick is the new concrete on the north side of 2375?',
  answer: 'ECOS could not verify an answer from the current project evidence.',
  confidence: 'low',
  facts: [],
  limitations: ['The indexed evidence did not contain a readable numeric thickness value with a unit.'],
  conflicts: [],
  suggestedQuestions: ['Which indexed drawing sheet or detail should be opened for manual review?'],
  supportingEvidence: [{
    sourceType: 'document',
    recordId: 'drawing-1',
    summary: 'Structural drawings, Sheet S2.1',
    timelineEventId: null,
    excerpt: 'SLAB THICKNESS (T)',
    documentCitation: null,
    documentRegion: null,
  }],
  assurance: {
    status: 'insufficient_evidence',
    checkedSourceCount: 4,
    verifiedFactCount: 0,
    rejectedFactCount: 1,
    message: 'ECOS Assurance did not find enough directly supported evidence to approve a factual answer.',
  },
  generatedAt: '2026-08-04T12:00:00.000Z',
  model: 'test-model',
};

describe('ECOSProjectAnswerSheet', () => {
  it('shows the ECOS thinking brain while project evidence is being checked', () => {
    const screen = render(
      <ECOSProjectAnswerSheet
        visible
        projectName="2375 Compliance Project"
        question="What changed today?"
        answer={null}
        loading
        error={null}
        onOpenEvidence={() => undefined}
        onAskAnother={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByTestId('ecos-thinking-brain')).toBeTruthy();
    expect(screen.getByLabelText('ECOS is thinking and checking project evidence')).toBeTruthy();
    expect(screen.getByText('ECOS is researching your project evidence…')).toBeTruthy();
    expect(screen.getByText('Checking tasks, field updates, and indexed drawings')).toBeTruthy();
  });

  it('does not label insufficient evidence as a verified answer or proof', () => {
    const screen = render(
      <ECOSProjectAnswerSheet
        visible
        projectName={insufficientAnswer.projectName}
        question={insufficientAnswer.question}
        answer={insufficientAnswer}
        loading={false}
        error={null}
        onOpenEvidence={() => undefined}
        onAskAnother={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText('COULD NOT VERIFY')).toBeTruthy();
    expect(screen.getByText('Insufficient evidence')).toBeTruthy();
    expect(screen.getByText('Evidence examined')).toBeTruthy();
    expect(screen.getByText('Why ECOS could not verify this')).toBeTruthy();
    expect(screen.queryByText('VERIFIED ANSWER')).toBeNull();
    expect(screen.queryByText('Proof')).toBeNull();
    expect(screen.getByTestId('ecos-thinking-brain')).toBeTruthy();
    expect(screen.getAllByLabelText('ECOS Brain ready').length).toBeGreaterThan(0);
  });
});
