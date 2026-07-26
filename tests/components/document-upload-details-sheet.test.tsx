import { act, fireEvent, render } from '@testing-library/react-native';

import { DocumentUploadDetailsSheet } from '../../components/document-upload-details-sheet';

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
});
