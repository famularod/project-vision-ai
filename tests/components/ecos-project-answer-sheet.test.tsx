import { render } from '@testing-library/react-native';
import { ECOSProjectAnswerSheet } from '../../components/ECOSProjectAnswerSheet';
import type { ECOSProjectQuestionAnswer } from '../../services/ECOSProjectQuestion';

const insufficientAnswer: ECOSProjectQuestionAnswer = {
  schemaVersion: 'ecos-project-question/2.0',
  projectId: 'project-2375',
  projectName: '2375 Compliance Project',
  question: 'How thick is the new concrete on the north side of 2375?',
  answer: 'ECOS could not verify an answer from the current project evidence.',
  confidence: 'low',
  facts: [],
  limitations: ['The indexed evidence did not contain a readable numeric thickness value with a unit.'],
  conflicts: [],
  aiReadStatements: [],
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
  diagnostics: {
    schemaVersion: 'ecos-question-trace/1.0',
    traceId: '11111111-1111-4111-8111-111111111111',
    clientRequestId: '22222222-2222-4222-8222-222222222222',
    clientSurface: 'iphone',
    evidenceSnapshotId: '33333333-3333-4333-8333-333333333333',
    evidenceDossierId: '44444444-4444-4444-8444-444444444444',
    replayed: false,
    persisted: true,
  },
};

describe('ECOSProjectAnswerSheet', () => {
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
  });
});
