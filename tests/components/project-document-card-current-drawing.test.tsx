/**
 * Whole-app audit A8 pass 1 F3 (30 Sep 2026): the cloud refuses to move a
 * Current drawing out of Drawing outside Make Current, so the phone card
 * disables the other categories while the shared record is Current.
 */
import { fireEvent, render } from '@testing-library/react-native';

import { ProjectDocumentCard, type ProjectDocumentCardDocument } from '../../components/project-document-card';
import type { ReferenceDocument } from '../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const LOCK_NOTICE = 'This drawing is Current for ECOS. Make another revision current before changing its category.';

const cardDocument: ProjectDocumentCardDocument = {
  id: 'phone-drawing-a201',
  name: 'A-201.pdf',
  category: 'Drawing',
  mimeType: 'application/pdf',
  status: 'uploaded',
  updatedAt: '2026-09-30T09:00:00.000Z',
  drawingNumber: 'A-201',
};

const sharedDrawing: ReferenceDocument = {
  id: 'drawing-a201',
  name: 'A-201',
  originalFileName: 'A-201.pdf',
  uri: '',
  category: 'Drawing',
  notes: '',
  isCurrent: true,
  importedAt: '2026-09-01T12:00:00.000Z',
  drawingNumber: 'A-201',
};

function renderCard(sharedReferenceDocument: ReferenceDocument | null) {
  const onUpdate = jest.fn();
  const screen = render(
    <ProjectDocumentCard
      document={cardDocument}
      sharedReferenceDocument={sharedReferenceDocument}
      projectAreas={[]}
      updates={[]}
      onOpen={jest.fn()}
      onUpdate={onUpdate}
      onSetCurrentSchedule={jest.fn()}
      onMakeCurrentDocument={jest.fn()}
      onRetry={jest.fn()}
      onReplaceFile={jest.fn()}
      onDelete={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByText('Edit'));
  return { screen, onUpdate };
}

describe('the category of a Current drawing on the phone card', () => {
  it('is locked to Drawing while the shared record is Current', () => {
    const { screen, onUpdate } = renderCard(sharedDrawing);

    expect(screen.getByText(LOCK_NOTICE)).toBeTruthy();
    fireEvent.press(screen.getByText('Schedule'));
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Drawing'));
    expect(onUpdate).toHaveBeenCalledWith({ category: 'Drawing' });
    // Other chips stay available.
    fireEvent.press(screen.getByText('For Construction'));
    expect(onUpdate).toHaveBeenLastCalledWith({ drawingStatus: 'For Construction' });
  });

  it('can change while the shared record is not Current, or when there is none', () => {
    for (const shared of [{ ...sharedDrawing, isCurrent: false }, null]) {
      const { screen, onUpdate } = renderCard(shared);
      expect(screen.queryByText(LOCK_NOTICE)).toBeNull();
      fireEvent.press(screen.getByText('Schedule'));
      expect(onUpdate).toHaveBeenCalledWith({ category: 'Schedule' });
      screen.unmount();
    }
  });
});
