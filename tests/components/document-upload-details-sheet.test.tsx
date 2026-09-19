import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';

import { DocumentUploadDetailsSheet } from '../../components/document-upload-details-sheet';
import {
  createECOSMobileDrawingControls,
  type ECOSMobileDrawingControls,
} from '../../services/ECOSMobileDrawingOnboarding';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('DocumentUploadDetailsSheet', () => {
  it('requires a visible document type choice before confirming projects', async () => {
    const onCategoryChange = jest.fn();
    const onToggleProject = jest.fn();
    const onConfirm = jest.fn();
    const screen = await render(
      <DocumentUploadDetailsSheet
        visible
        projects={['Project A', 'Project B']}
        selectedProjects={new Set(['Project A'])}
        categories={['Schedule', 'Other']}
        selectedCategory="Other"
        onCategoryChange={onCategoryChange}
        onToggleProject={onToggleProject}
        onConfirm={onConfirm}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Document Type')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Classify document as Other' }).props
      .accessibilityState).toEqual(expect.objectContaining({ selected: true }));

    await fireEvent.press(screen.getByRole('radio', { name: 'Classify document as Schedule' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Add document to Project B' }));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Add Other to 1 Project' }));
      await Promise.resolve();
    });

    expect(onCategoryChange).toHaveBeenCalledWith('Schedule');
    expect(onToggleProject).toHaveBeenCalledWith('Project B');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps a schedule upload visibly busy while its tasks are being extracted', async () => {
    let finishConfirm: (() => void) | null = null;
    const onConfirm = jest.fn(() => new Promise<void>(resolve => {
      finishConfirm = resolve;
    }));
    const screen = render(
      <DocumentUploadDetailsSheet
        visible
        projects={['Project A']}
        selectedProjects={new Set(['Project A'])}
        categories={['Schedule', 'Other']}
        selectedCategory="Schedule"
        onCategoryChange={jest.fn()}
        onToggleProject={jest.fn()}
        onConfirm={onConfirm}
        onClose={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Add Schedule to 1 Project' }));
    expect(screen.getByText('Reading Schedule…')).toBeTruthy();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => finishConfirm?.());
  });

  it('collects required drawing control and an explicit safe replacement intent', async () => {
    const onConfirm = jest.fn();
    const observedControls: ECOSMobileDrawingControls[] = [];

    function Harness() {
      const [controls, setControls] = useState(createECOSMobileDrawingControls());
      return (
        <DocumentUploadDetailsSheet
          visible
          projects={['2375 Compliance Project']}
          selectedProjects={new Set(['2375 Compliance Project'])}
          categories={['Drawing', 'Other']}
          selectedCategory="Drawing"
          drawingControls={controls}
          replacementDocuments={[{
            id: 'drawing-current',
            name: '2375 Civil',
            revision: '2',
            isCurrent: true,
          }]}
          onCategoryChange={jest.fn()}
          onDrawingControlsChange={next => {
            observedControls.push(next);
            setControls(next);
          }}
          onToggleProject={jest.fn()}
          onConfirm={onConfirm}
          onClose={jest.fn()}
        />
      );
    }

    const screen = render(<Harness />);
    const incomplete = screen.getByRole('button', { name: 'Complete Drawing Details' });
    expect(incomplete.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));

    fireEvent.changeText(screen.getByLabelText('Drawing number'), 'A2.01');
    fireEvent.changeText(screen.getByLabelText('Revision'), '3');
    fireEvent.changeText(screen.getByLabelText('Discipline'), 'Architectural');
    fireEvent.changeText(screen.getByLabelText('Issue date'), '2026-08-09');
    fireEvent.press(screen.getByRole('radio', {
      name: 'Upload as the next revision of 2375 Civil',
    }));

    const confirm = screen.getByRole('button', { name: 'Add Drawing to 1 Project' });
    expect(confirm.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    await act(async () => {
      fireEvent.press(confirm);
      await Promise.resolve();
    });

    expect(observedControls.at(-1)).toMatchObject({
      drawingNumber: 'A2.01',
      drawingRevision: '3',
      drawingDiscipline: 'Architectural',
      drawingStatus: 'For Review',
      drawingIssuedAt: '2026-08-09',
      replacementDocumentId: 'drawing-current',
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
