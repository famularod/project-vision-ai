import { fireEvent, render } from '@testing-library/react-native';

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
      .accessibilityState).toEqual({ selected: true });

    await fireEvent.press(screen.getByRole('radio', { name: 'Classify document as Schedule' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Add document to Project B' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add Other to 1 Project' }));

    expect(onCategoryChange).toHaveBeenCalledWith('Schedule');
    expect(onToggleProject).toHaveBeenCalledWith('Project B');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
