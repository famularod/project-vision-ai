import { fireEvent, render } from '@testing-library/react-native';

import { DesktopDocumentOnboarding } from '../../components/web-shell/desktop-document-onboarding';
import type { ReferenceDocument } from '../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function document(
  id: string,
  status: NonNullable<ReferenceDocument['ecosHostedIndexStatus']>,
): ReferenceDocument {
  return {
    id,
    name: `Drawing ${id}`,
    originalFileName: `${id}.pdf`,
    uri: `file:///${id}.pdf`,
    category: 'Drawing',
    notes: '',
    isCurrent: true,
    importedAt: '2026-08-08T12:00:00.000Z',
    projectName: 'Project A',
    drawingNumber: id,
    drawingRevision: '1',
    drawingStatus: 'For Construction',
    extractionStatus: 'pending',
    ecosHostedIndexStatus: status,
    ecosHostedIndexLimitationCount: status.includes('with limitations') ? 2 : 0,
  };
}

describe('DesktopDocumentOnboarding', () => {
  it('offers one primary add action and review-by-exception statuses', async () => {
    const onAddDocuments = jest.fn();
    const onCloseAddDocuments = jest.fn();
    const onReviewExceptions = jest.fn();
    const onContinuePreparation = jest.fn();
    const screen = await render(
      <DesktopDocumentOnboarding
        documents={[
          document('waiting', 'Waiting'),
          document('preparing', 'Preparing'),
          document('prepared', 'Prepared'),
          document('prepared-limited', 'Prepared with limitations'),
          document('ready', 'Ready for ECOS'),
          document('ready-limited', 'Ready with limitations'),
          document('review', 'Needs Review'),
          document('reconnect', 'Reconnect Files'),
          document('unavailable', 'Temporarily Unavailable'),
        ]}
        uploadOpen
        preparationPendingCount={2}
        progress={null}
        onAddDocuments={onAddDocuments}
        onCloseAddDocuments={onCloseAddDocuments}
        onReviewExceptions={onReviewExceptions}
        onContinuePreparation={onContinuePreparation}
      />,
    );

    expect(screen.getByTestId('desktop-document-onboarding')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add Project Documents' })).toHaveLength(1);
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.getByText('Preparing')).toBeTruthy();
    expect(screen.getByText('Prepared')).toBeTruthy();
    expect(screen.getByText('Prepared with limitations')).toBeTruthy();
    expect(screen.getByText('Ready for ECOS')).toBeTruthy();
    expect(screen.getByText('Ready with limitations')).toBeTruthy();
    expect(screen.getAllByText('2 accepted pages passed ECOS Assurance with review limitations.')).toHaveLength(2);
    expect(screen.getByText('Needs Review')).toBeTruthy();
    expect(screen.getByText('Reconnect Files')).toBeTruthy();
    expect(screen.getByText('Temporarily Unavailable')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Add Project Documents' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Close document form' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Review 4 document items' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Continue preparing 2 project documents' }));

    expect(onAddDocuments).toHaveBeenCalledTimes(1);
    expect(onCloseAddDocuments).toHaveBeenCalledTimes(1);
    expect(onReviewExceptions).toHaveBeenCalledTimes(1);
    expect(onContinuePreparation).toHaveBeenCalledTimes(1);
  });

  it('keeps progress provider-neutral and explains background continuation', async () => {
    const screen = await render(
      <DesktopDocumentOnboarding
        documents={[document('preparing', 'Preparing')]}
        uploadOpen={false}
        preparationPendingCount={1}
        progress={{
          running: false,
          total: 1,
          processed: 1,
          failed: 1,
          currentDocumentName: null,
          currentDocumentProgress: 0.4,
        }}
        onAddDocuments={jest.fn()}
        onCloseAddDocuments={jest.fn()}
        onReviewExceptions={jest.fn()}
        onContinuePreparation={jest.fn()}
      />,
    );

    expect(screen.getByText('Some documents will continue automatically')).toBeTruthy();
    expect(screen.getByText(/saved completed work and will retry unfinished preparation/i)).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/Gemini|OpenAI|Google Cloud|Supabase|API|quota|credit|provider/i);
  });
});
