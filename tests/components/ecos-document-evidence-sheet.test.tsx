import { render } from '@testing-library/react-native';
import { ECOSDocumentEvidenceSheet } from '../../components/ECOSDocumentEvidenceSheet';
import type { DAVEAskEvidence } from '../../services/DAVEAsk';

const evidence: DAVEAskEvidence = {
  sourceType: 'document',
  recordId: 'drawing-1',
  summary: 'A101',
  timelineEventId: null,
  excerpt: 'Provide guardrails.',
  documentCitation: {
    documentId: 'drawing-1',
    projectId: 'project-1',
    sourceSha256: 'a'.repeat(64),
    documentName: 'A101',
    revision: '4',
    pageNumber: 1,
    sheetNumber: 'A101',
    regionId: null,
    label: 'A101, Rev 4',
  },
};

describe('ECOS document evidence sheet', () => {
  it('does not claim verified/current proof when exact source binding is unavailable', () => {
    const screen = render(
      <ECOSDocumentEvidenceSheet
        visible
        evidence={evidence}
        document={null}
        imageUri={null}
        loading={false}
        error="The cited current document is no longer available on this device."
        onOpenDocument={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('SOURCE UNAVAILABLE')).toBeTruthy();
    expect(screen.queryByText('ECOS VERIFIED SOURCE')).toBeNull();
    expect(screen.queryByText(/matched this text to the current document revision/i)).toBeNull();
    expect(screen.queryByText('Cited text')).toBeNull();
  });
});
