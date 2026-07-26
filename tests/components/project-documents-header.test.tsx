import { fireEvent, render } from '@testing-library/react-native';

import { ProjectDocumentsHeader } from '../../components/project-documents-header';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('ProjectDocumentsHeader', () => {
  it('provides accessible capture actions and controlled category filtering', async () => {
    const onCategoryChange = jest.fn();
    const onBack = jest.fn();
    const onUpload = jest.fn();
    const onTakePhoto = jest.fn();
    const screen = await render(
      <ProjectDocumentsHeader
        projectName="Project A"
        categories={['Drawing', 'Permit Card'] as const}
        selectedCategory="Drawing"
        onCategoryChange={onCategoryChange}
        onBack={onBack}
        onUpload={onUpload}
        onTakePhoto={onTakePhoto}
      />,
    );

    expect(screen.getByTestId('project-documents-header')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Document Status' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Category' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Show Drawing documents' }).props
      .accessibilityState).toEqual({ selected: true });

    await fireEvent.press(screen.getByRole('button', { name: 'Upload Document' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Take Photo of Document' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Show Permit Card documents' }));

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onTakePhoto).toHaveBeenCalledTimes(1);
    expect(onCategoryChange).toHaveBeenCalledWith('Permit Card');
  });

  it('can move capture actions out of the narrow master column', async () => {
    const screen = await render(
      <ProjectDocumentsHeader
        projectName="Project A"
        categories={[] as const}
        selectedCategory={null}
        onCategoryChange={jest.fn()}
        onBack={jest.fn()}
        onUpload={jest.fn()}
        onTakePhoto={jest.fn()}
        showActions={false}
      />,
    );

    expect(screen.queryByTestId('project-document-actions')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload Document' })).toBeNull();
  });
});
