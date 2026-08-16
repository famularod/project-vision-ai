import { fireEvent, render } from '@testing-library/react-native';

import { ProjectDocumentCard } from '../../components/project-document-card';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const document = {
  id: 'document-a',
  name: 'A-101.pdf',
  category: 'Drawing' as const,
  mimeType: 'application/pdf',
  status: 'uploaded' as const,
  uploadedAt: '2026-08-11T12:00:00.000Z',
  updatedAt: '2026-08-11T12:00:00.000Z',
};

const callbacks = {
  onOpen: jest.fn(),
  onUpdate: jest.fn(),
  onSetCurrentSchedule: jest.fn(),
  onMakeCurrentDocument: jest.fn(),
  onRetry: jest.fn(),
  onReplaceFile: jest.fn(),
  onDelete: jest.fn(),
};

describe('ProjectDocumentCard shared cloud records', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps a cloud-only record downloadable without exposing local-only editing', () => {
    const screen = render(
      <ProjectDocumentCard
        document={document}
        sharedReferenceDocument={null}
        projectAreas={[]}
        updates={[]}
        {...callbacks}
        editable={false}
      />,
    );

    fireEvent.press(screen.getByText('Download & Open'));
    expect(callbacks.onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('preserves editing for device-local project-document records', () => {
    const screen = render(
      <ProjectDocumentCard
        document={document}
        sharedReferenceDocument={null}
        projectAreas={[]}
        updates={[]}
        {...callbacks}
      />,
    );

    fireEvent.press(screen.getByText('Edit'));
    expect(screen.getByText('Delete')).toBeTruthy();
  });
});
