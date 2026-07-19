import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

import { DocumentsWideWorkspace } from '../../components/documents-workspace-layout';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('DocumentsWideWorkspace', () => {
  it('keeps master selection controlled and exposes the selected document', async () => {
    const screen = await render(<DocumentsProbe />);

    expect(screen.getByTestId('documents-wide-workspace')).toBeTruthy();
    expect(screen.getByText('Inspecting Site Plan')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Open document Permit Card' }));

    expect(screen.getByText('Inspecting Permit Card')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Open document Permit Card' }).props
        .accessibilityState,
    ).toEqual({ selected: true });
  });
});

function DocumentsProbe() {
  const [selectedId, setSelectedId] = useState('document-a');
  const documents = [
    { id: 'document-a', name: 'Site Plan', category: 'Drawing', status: 'uploaded' },
    { id: 'document-b', name: 'Permit Card', category: 'Permit Card', status: 'local' },
  ];
  const selected = documents.find(document => document.id === selectedId)!;

  return (
    <DocumentsWideWorkspace
      documents={documents}
      selectedDocumentId={selectedId}
      onSelectDocument={setSelectedId}
      masterHeader={<Text>Document controls</Text>}
      inspector={<Text>{`Inspecting ${selected.name}`}</Text>}
      emptyState={<Text>No documents</Text>}
    />
  );
}
