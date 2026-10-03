/**
 * Whole-app audit A9 pass 1 #3 (30 Sep 2026): a Talk answer listed its local
 * document match as a "Verified document source", but Talk citations carry no
 * project, source hash or evidence version, so Ask ECOS proof could never open
 * them. Only a source with a full proof claim is called verified.
 */
import { render } from '@testing-library/react-native';
import {
  DAVEConversationAnswerSheet,
  UNCHECKED_DOCUMENT_SOURCE_LABEL,
  talkEvidenceAccessibilityLabel,
  talkEvidenceTypeLabel,
} from '../../components/DAVEConversationAnswerSheet';
import type { DAVEAskAnswer, DAVEAskEvidence } from '../../services/DAVEAsk';

// The shape ECOSDocumentIntelligence builds for a Talk answer (pinned in ecos-document-intelligence.test.ts).
const talkSource: DAVEAskEvidence = {
  sourceType: 'document',
  recordId: 'drawing-a101',
  summary: 'Architectural drawings, Sheet A101',
  timelineEventId: null,
  excerpt: 'Provide galvanized steel guardrails at all open parking edges.',
  documentCitation: {
    documentId: 'drawing-a101',
    documentName: 'Architectural drawings',
    revision: '2',
    pageNumber: 3,
    sheetNumber: 'A101',
    regionId: 'a101-note-7',
    label: 'Architectural drawings, Sheet A101',
  },
};
const checkedSource: DAVEAskEvidence = {
  ...talkSource,
  recordId: 'drawing-a102',
  documentCitation: {
    ...talkSource.documentCitation!,
    documentId: 'drawing-a102',
    label: 'Architectural drawings, Sheet A102',
    projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
    sourceSha256: 'a'.repeat(64),
    evidenceVersion: 'ecos-hosted-evidence/1.3',
  },
};
const taskSource: DAVEAskEvidence = {
  sourceType: 'schedule', recordId: 'task-1', summary: 'Install guardrails', timelineEventId: null,
};

function answer(supportingEvidence: DAVEAskEvidence[]): DAVEAskAnswer {
  return {
    answer: 'Provide galvanized steel guardrails at all open parking edges.',
    confidence: 'high',
    limitations: [],
    supportingEvidence,
    timelineReferences: [],
    recommendedNextAction: null,
    navigationTargets: [],
  };
}

describe('Talk answer source label (audit A9 pass 1 #3)', () => {
  it('calls a document source verified only when an Ask ECOS proof claim can be built', () => {
    expect(talkEvidenceTypeLabel(talkSource)).toBe(UNCHECKED_DOCUMENT_SOURCE_LABEL);
    expect(talkEvidenceTypeLabel(checkedSource)).toBe('Verified document source');
    expect(talkEvidenceTypeLabel(taskSource)).toBe('schedule');
  });

  it('shows the Talk match as not checked, not as a verified source', () => {
    const screen = render(
      <DAVEConversationAnswerSheet
        visible
        projectName="2321 Compliance Project"
        question="What guardrail protection is required at the parking edge?"
        answer={answer([talkSource])}
        onOpenEvidence={jest.fn()}
        onAskAnother={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText('Document match – not checked by Ask ECOS')).toBeTruthy();
    expect(screen.queryByText('Verified document source')).toBeNull();
  });

  it('still calls a source with a full proof claim verified', () => {
    const screen = render(
      <DAVEConversationAnswerSheet
        visible
        projectName="2321 Compliance Project"
        question="What guardrail protection is required at the parking edge?"
        answer={answer([checkedSource, taskSource])}
        onOpenEvidence={jest.fn()}
        onAskAnother={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText('Verified document source')).toBeTruthy();
    expect(screen.queryByText(UNCHECKED_DOCUMENT_SOURCE_LABEL)).toBeNull();
    expect(screen.getByText('schedule')).toBeTruthy();
  });
});

// Whole-app audit A9 pass 2 F6 (30 Sep 2026): VoiceOver read a Talk document
// match as "Open supporting document: …", never hearing that Ask ECOS had not
// checked it, and the close button was not announced as a button.
describe('Talk answer VoiceOver wording (audit A9 pass 2 F6)', () => {
  function renderSheet(evidence: DAVEAskEvidence[]) {
    return render(
      <DAVEConversationAnswerSheet
        visible
        projectName="2321 Compliance Project"
        question="What guardrail protection is required at the parking edge?"
        answer={answer(evidence)}
        onOpenEvidence={jest.fn()}
        onAskAnother={jest.fn()}
        onClose={jest.fn()}
      />,
    );
  }

  it('reads a document source with the words shown on it', () => {
    const screen = renderSheet([talkSource, checkedSource, taskSource]);
    expect(screen.getByLabelText(
      'Open Architectural drawings, Sheet A101. Provide galvanized steel guardrails at all open parking edges. Document match – not checked by Ask ECOS',
    )).toBeTruthy();
    expect(screen.getByLabelText(
      'Open Architectural drawings, Sheet A102. Provide galvanized steel guardrails at all open parking edges. Verified document source',
    )).toBeTruthy();
    expect(screen.getByLabelText('Open supporting schedule: Install guardrails')).toBeTruthy();
    expect(screen.queryByLabelText(/^Open supporting document/)).toBeNull();
    expect(talkEvidenceAccessibilityLabel(talkSource)).toContain(UNCHECKED_DOCUMENT_SOURCE_LABEL);
  });

  it('announces the close control as a button', () => {
    const screen = renderSheet([talkSource]);
    expect(screen.getByLabelText('Close answer').props.accessibilityRole).toBe('button');
  });
});
